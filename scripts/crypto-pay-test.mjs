#!/usr/bin/env node
/* Aiva Crypto Pay end-to-end flow test (website and Super App) with a mocked BitPay API and a real SQLite (D1-compatible)
   order database. No network calls and no real money. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cp = await import(pathToFileURL(path.join(root, 'functions/_lib/crypto-pay.js')).href);
const forwarder = await import(pathToFileURL(path.join(root, 'pocket-hub/functions/api/[[path]].js')).href);

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) })
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => {
    db.exec('BEGIN');
    try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
  } };
}
const catalogue = {
  ...JSON.parse(readFileSync(path.join(root, 'data/aiva-products.json'), 'utf8')),
  shipping: { allowedCountries: ['GB'], flatRatePence: 495, freeShippingThresholdPence: 10000 },
  products: [{ sku: 'LAMP-1', name: 'Smart lamp', category: 'Smart home', description: 'Wi-Fi lamp', pricePence: 2500, stock: 5, available: true }]
};
const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/* ---------- mocked BitPay ---------- */
const invoices = new Map();
let seq = 0, rejectPaymentCurrencies = false;
const calls = [];
function bitpayFetch(host) {
  return async (input, init = {}) => {
    const url = String(input), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, init });
    if (url === 'https://bitpay.com/rates/GBP') return reply({ data: [{ code: 'BTC', rate: 50000 }, { code: 'ETH', rate: 2500 }, { code: 'USDT', rate: 0.79 }, { code: 'LTC', rate: 70 }] });
    if (url.startsWith('https://api.coinbase.com/v2/exchange-rates')) return reply({ data: { rates: { USDC: '1.27', SOL: '0.008', BTC: '0.00002' } } });
    assert.ok(url.startsWith(host + '/invoices'), 'only the configured BitPay host is called: ' + url);
    assert.equal(init.headers['X-Accept-Version'], '2.0.0');
    if (init.method === 'POST') {
      assert.equal(body.token, 'bp-token');
      if (rejectPaymentCurrencies && body.paymentCurrencies) return reply({ error: 'Unsupported paymentCurrencies' }, 400);
      const id = 'Inv' + String(++seq).padStart(12, '0');
      const inv = { id, url: `${host}/invoice?id=${id}`, status: 'new', price: body.price, currency: body.currency, orderId: body.orderId,
        posData: body.posData, expirationTime: Date.now() + 15 * 60000, exceptionStatus: false, buyer: body.buyer,
        paymentCodes: { BTC: { BIP72b: `bitcoin:?r=${host}/i/${id}`, BIP73: `${host}/i/${id}` }, USDC_e: { EIP681: `ethereum:?r=${host}/i/${id}` }, SOL: { SPL: `solana:${host}/i/${id}` } },
        paymentDisplayTotals: { BTC: '0.000550', USDC_e: '34.81', SOL: '0.150000' }, exchangeRates: { BTC: { GBP: 50000 }, USDC_e: { GBP: 0.79 }, SOL: { GBP: 197 } } };
      invoices.set(id, inv);
      return reply({ data: inv });
    }
    const id = decodeURIComponent(url.split('/invoices/')[1].split('?')[0]);
    assert.ok(url.includes('token=bp-token'), 'invoice reads use the merchant token');
    return invoices.has(id) ? reply({ data: invoices.get(id) }) : reply({ error: 'not found' }, 404);
  };
}
const TEST_HOST = 'https://test.bitpay.com', LIVE_HOST = 'https://bitpay.com';
const mkEnv = (extra = {}) => ({
  ASSETS: { fetch: async () => reply(catalogue) }, ORDERS_DB: d1(), BITPAY_TOKEN: 'bp-token', BITPAY_ENV: 'test',
  CRYPTO_LIVE_PAYMENTS_APPROVED: 'false', CHECKOUT_PROVIDER: 'square', ...extra
});
const post = (pathName, body, headers = {}, base = 'https://aivatrading.uk') => new Request(base + pathName, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body) });
const get = (q, base = 'https://aivatrading.uk') => new Request(base + q);
const j = async (r) => ({ status: r.status, body: await r.json() });

/* ---------- configuration gates ---------- */
assert.equal(cp.cryptoState({}).ready, false);
assert.equal(cp.cryptoState({ BITPAY_TOKEN: 't', BITPAY_ENV: 'prod' }).ready, false, 'live needs explicit approval');
assert.deepEqual(cp.cryptoState({ BITPAY_TOKEN: 't', BITPAY_ENV: 'prod', CRYPTO_LIVE_PAYMENTS_APPROVED: 'true' }).base, LIVE_HOST);
assert.deepEqual(cp.cryptoState({ BITPAY_TOKEN: 't' }).base, TEST_HOST);
assert.deepEqual(cp.COINS.map((c) => c.code), ['BTC', 'ETH', 'USDT', 'USDC', 'LTC', 'SOL']);
const toml = readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
assert.match(toml, /BITPAY_ENV = "test"/);
assert.match(toml, /CRYPTO_LIVE_PAYMENTS_APPROVED = "false"/);
assert.doesNotMatch(toml, /BITPAY_TOKEN\s*=/, 'the BitPay token is a Cloudflare secret, never committed');

/* ---------- live rates: BitPay first, Coinbase for missing coins ---------- */
cp.clearRateCache();
{
  const env = mkEnv();
  const r = await j(await cp.handleCryptoRates(get('/api/crypto-rates?amountPence=2995'), env, bitpayFetch(TEST_HOST)));
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true); assert.equal(r.body.mode, 'test'); assert.equal(r.body.settlement, 'GBP');
  const by = Object.fromEntries(r.body.coins.map((c) => [c.code, c]));
  assert.equal(by.BTC.source, 'BitPay'); assert.equal(by.BTC.estimate, '0.00059900');
  assert.equal(by.USDC.source, 'Coinbase'); assert.equal(by.USDC.estimate, '38.04');
  assert.equal(by.SOL.source, 'Coinbase'); assert.equal(by.SOL.estimate, '0.239600');
  const off = await j(await cp.handleCryptoRates(get('/api/crypto-rates'), mkEnv({ BITPAY_TOKEN: '' }), bitpayFetch(TEST_HOST)));
  assert.equal(off.body.enabled, false); assert.ok(off.body.reason);
}

/* ---------- website: checkout, QR details, polling confirmation (test network: stock untouched) ---------- */
{
  const env = mkEnv(), f = bitpayFetch(TEST_HOST);
  const bad = await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'BTC' }, { Origin: 'https://evil.example' }), env, f));
  assert.equal(bad.status, 403);
  const coin = await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'DOGE' }), env, f));
  assert.equal(coin.status, 400);
  const stock = await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 9 }], coin: 'BTC' }), env, f));
  assert.equal(stock.status, 400, 'basket rules (stock) are the card checkout rules');

  const r = await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'BTC', email: 'buyer@example.com', pricePence: 1 }), env, f));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.totalPence, 2995, 'server price + delivery; browser price ignored');
  assert.equal(r.body.amount, '0.000550'); assert.equal(r.body.paymentUri, `bitcoin:?r=${TEST_HOST}/i/${r.body.invoiceId}`);
  assert.equal(r.body.platform, 'website'); assert.equal(r.body.mode, 'test'); assert.ok(r.body.expiresAt);
  const sent = calls.findLast((c) => c.init.method === 'POST').body;
  assert.equal(sent.price, 29.95); assert.equal(sent.currency, 'GBP'); assert.deepEqual(sent.paymentCurrencies, ['BTC']);
  assert.equal(sent.notificationURL, 'https://aivatrading.uk/api/crypto-webhook');
  assert.equal(sent.redirectURL, `https://aivatrading.uk/shop.html?cryptoOrder=${r.body.orderId}#aiva-basket`);
  const row = env.ORDERS_DB.raw.prepare('SELECT * FROM orders WHERE session_id=?').get(r.body.orderId);
  assert.equal(row.provider, 'bitpay'); assert.equal(row.payment_status, 'pending'); assert.equal(row.expected_total, 2995); assert.equal(row.test_order, 1);

  let s = await j(await cp.handleCryptoStatus(get('/api/crypto-status?orderId=' + r.body.orderId), env, f));
  assert.equal(s.body.state, 'awaiting_payment'); assert.equal(s.body.paid, false);
  invoices.get(r.body.invoiceId).status = 'paid';
  s = await j(await cp.handleCryptoStatus(get('/api/crypto-status?orderId=' + r.body.orderId), env, f));
  assert.equal(s.body.state, 'confirming'); assert.equal(s.body.paid, false);
  invoices.get(r.body.invoiceId).status = 'confirmed';
  s = await j(await cp.handleCryptoStatus(get('/api/crypto-status?orderId=' + r.body.orderId), env, f));
  assert.equal(s.body.state, 'confirmed'); assert.equal(s.body.paid, true);
  const paid = env.ORDERS_DB.raw.prepare('SELECT payment_status, payment_id, test_order, stock_applied FROM orders WHERE session_id=?').get(r.body.orderId);
  assert.deepEqual({ ...paid }, { payment_status: 'paid', payment_id: r.body.invoiceId, test_order: 1, stock_applied: 0 });
  assert.equal(env.ORDERS_DB.raw.prepare('SELECT COUNT(*) n FROM inventory').get().n, 0, 'test payments never change live stock');
}

/* ---------- Super App: request forwarded by the app's /api/* forwarder reaches the same backend ---------- */
{
  const env = mkEnv(), f = bitpayFetch(TEST_HOST);
  let forwarded = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (req, init) => { forwarded = new Request(req, init); return cp.handleCryptoCheckout(forwarded, env, f); };
  const res = await forwarder.onRequest({ request: post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 2 }], coin: 'SOL', email: 'app@example.com' }, {}, 'https://app.aivatrading.uk'),
    env: { WEBSITE_ORIGIN: 'https://aiva-trading.pages.dev' } });
  globalThis.fetch = realFetch;
  assert.equal(new URL(forwarded.url).origin, 'https://aiva-trading.pages.dev');
  const r = await j(res);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.platform, 'app'); assert.equal(r.body.totalPence, 5495); assert.equal(r.body.amount, '0.150000');
  assert.match(r.body.paymentUri, /^solana:/);
  const sent = calls.findLast((c) => c.init.method === 'POST').body;
  assert.equal(sent.redirectURL, `https://app.aivatrading.uk/?cryptoOrder=${r.body.orderId}#trade`);
  assert.equal(JSON.parse(sent.posData).platform, 'app');
}

/* ---------- token network naming fallback (USDC_e) and BitPay rejecting paymentCurrencies ---------- */
{
  const env = mkEnv(), f = bitpayFetch(TEST_HOST);
  let r = await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'USDC' }), env, f));
  assert.equal(r.body.amount, '34.81'); assert.equal(r.body.network, 'e'); assert.match(r.body.paymentUri, /^ethereum:/);
  rejectPaymentCurrencies = true;
  r = await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'LTC' }), env, f));
  rejectPaymentCurrencies = false;
  assert.equal(r.status, 200); assert.equal(r.body.paymentUri, r.body.url, 'falls back to the BitPay page with its own coin chooser');
}

/* ---------- live: webhook verified by re-reading BitPay; forged/mismatched data never confirms; stock reduced once ---------- */
{
  const env = mkEnv({ BITPAY_ENV: 'prod', CRYPTO_LIVE_PAYMENTS_APPROVED: 'true' }), f = bitpayFetch(LIVE_HOST);
  const a = (await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 2 }], coin: 'ETH', email: 'live@example.com' }), env, f))).body;
  assert.equal(a.mode, 'live');
  const hook = (id, extra = {}) => cp.handleCryptoWebhook(post('/api/crypto-webhook', { data: { id, status: 'confirmed', price: 0.01, ...extra } }, { Origin: '' }), env, f);
  // Forged notification: says confirmed, BitPay says new.
  let w = await j(await hook(a.invoiceId));
  assert.equal(w.body.state, 'awaiting_payment');
  assert.equal(env.ORDERS_DB.raw.prepare('SELECT payment_status FROM orders WHERE session_id=?').get(a.orderId).payment_status, 'pending');
  // Unknown invoice ids are ignored.
  assert.equal((await j(await hook('Unknown0000000'))).body.ignored, 'unknown_invoice');
  // Real confirmation, delivered twice.
  invoices.get(a.invoiceId).status = 'confirmed';
  w = await j(await hook(a.invoiceId)); assert.equal(w.body.state, 'confirmed');
  w = await j(await hook(a.invoiceId)); assert.equal(w.body.state, 'confirmed');
  const row = env.ORDERS_DB.raw.prepare('SELECT payment_status, stock_applied, customer_email, amount_total FROM orders WHERE session_id=?').get(a.orderId);
  assert.deepEqual({ ...row }, { payment_status: 'paid', stock_applied: 1, customer_email: 'live@example.com', amount_total: 5495 });
  assert.equal(env.ORDERS_DB.raw.prepare("SELECT stock FROM inventory WHERE sku='LAMP-1'").get().stock, 3, 'stock reduced exactly once');

  // Amount tampering on BitPay's side is held for review, never confirmed.
  const b = (await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'BTC' }), env, f))).body;
  Object.assign(invoices.get(b.invoiceId), { status: 'confirmed', price: 1 });
  w = await j(await hook(b.invoiceId)); assert.equal(w.body.state, 'review');
  assert.equal(env.ORDERS_DB.raw.prepare('SELECT payment_status FROM orders WHERE session_id=?').get(b.orderId).payment_status, 'pending');
  // Partial payment → review; expiry → failed.
  const c = (await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'LTC' }), env, f))).body;
  Object.assign(invoices.get(c.invoiceId), { status: 'expired', exceptionStatus: 'paidPartial' });
  assert.equal((await j(await hook(c.invoiceId))).body.state, 'review');
  const d = (await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'BTC' }), env, f))).body;
  invoices.get(d.invoiceId).status = 'expired';
  assert.equal((await j(await cp.handleCryptoStatus(get('/api/crypto-status?orderId=' + d.orderId), env, f))).body.state, 'expired');
  assert.equal(env.ORDERS_DB.raw.prepare('SELECT payment_status FROM orders WHERE session_id=?').get(d.orderId).payment_status, 'failed');
  // Existing orders stay verifiable after live crypto is switched off again.
  const offEnv = { ...env, CRYPTO_LIVE_PAYMENTS_APPROVED: 'false' };
  assert.equal((await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'BTC' }), offEnv, f))).status, 503);
  assert.equal((await j(await cp.handleCryptoStatus(get('/api/crypto-status?orderId=' + a.orderId), offEnv, f))).body.paid, true);
}
/* Live checkout refuses a test-only catalogue. */
{
  const env = mkEnv({ BITPAY_ENV: 'prod', CRYPTO_LIVE_PAYMENTS_APPROVED: 'true', ASSETS: { fetch: async () => reply({ ...catalogue, testOnly: true }) } });
  assert.equal((await j(await cp.handleCryptoCheckout(post('/api/crypto-checkout', { items: [{ sku: 'LAMP-1', quantity: 1 }], coin: 'BTC' }), env, bitpayFetch(LIVE_HOST)))).status, 503);
}

/* ---------- front end: one shared file, wired into both platforms, existing checkout untouched ---------- */
const web = readFileSync(path.join(root, 'assets/aiva-crypto-pay.js'), 'utf8');
assert.equal(readFileSync(path.join(root, 'pocket-hub/public/aiva-crypto-pay.js'), 'utf8'), web, 'website and app copies must be identical');
assert.equal(readFileSync(path.join(root, 'assets/qrcode.js'), 'utf8'), readFileSync(path.join(root, 'pocket-hub/public/vendor/qrcode.js'), 'utf8'));
execFileSync(process.execPath, ['--check', path.join(root, 'assets/aiva-crypto-pay.js')]);
assert.ok(web.includes('₿ Pay with Cryptocurrency'));
for (const [file, tag] of [['shop.html', 'assets/aiva-crypto-pay.js'], ['buying-guide.html', 'assets/aiva-crypto-pay.js'], ['pocket-hub/public/index.html', 'src="aiva-crypto-pay.js"']]) {
  assert.ok(readFileSync(path.join(root, file), 'utf8').includes(tag), file + ' loads Aiva Crypto Pay');
}
assert.ok(readFileSync(path.join(root, 'shop.html'), 'utf8').includes('id="aiva-checkout"'), 'card checkout button kept');
assert.ok(existsSync(path.join(root, 'functions/api/create-checkout-session.js')));

console.log('CRYPTO PAY CHECKS PASSED: gates, live rates, website + Super App checkout, QR/wallet details, polling, verified webhook, review/expiry paths.');
