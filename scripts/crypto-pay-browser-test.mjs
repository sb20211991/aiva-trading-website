#!/usr/bin/env node
/* Browser end-to-end test of "₿ Pay with Cryptocurrency" on the website (shop.html) and in the Aiva Super App
   (pocket-hub/public), both calling the one shared backend (functions/_lib/crypto-pay.js). BitPay is mocked and the
   order database is in-memory SQLite: no network, no real money. Needs Chrome + Playwright:
     node scripts/crypto-pay-browser-test.mjs [screenshot-dir] */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] || '';
const cp = await import(pathToFileURL(path.join(root, 'functions/_lib/crypto-pay.js')).href);

const catalogue = { ...JSON.parse(await readFile(path.join(root, 'data/aiva-products.json'), 'utf8')),
  shipping: { allowedCountries: ['GB'], flatRatePence: 495, freeShippingThresholdPence: null }, categories: ['Smart home'],
  products: [{ sku: 'LAMP-1', name: 'Smart lamp', category: 'Smart home', description: 'Wi-Fi lamp', pricePence: 2500, stock: 5, available: true }] };
const db = new DatabaseSync(':memory:');
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
const D1 = { prepare: (s) => stmt(s), batch: async (l) => { db.exec('BEGIN'); try { const o = []; for (const s of l) o.push(await s.run()); db.exec('COMMIT'); return o; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const env = { ASSETS: { fetch: async () => reply(catalogue) }, ORDERS_DB: D1, BITPAY_TOKEN: 'bp-token', BITPAY_ENV: 'test', CRYPTO_LIVE_PAYMENTS_APPROVED: 'false' };
const invoices = new Map(); let seq = 0;
const bitpay = async (input, init = {}) => {
  const url = String(input);
  if (url.includes('/rates/GBP')) return reply({ data: ['BTC:50000', 'ETH:2500', 'USDT:0.79', 'USDC:0.79', 'LTC:70', 'SOL:197'].map((x) => ({ code: x.split(':')[0], rate: +x.split(':')[1] })) });
  if (init.method === 'POST') {
    const b = JSON.parse(init.body), id = 'Inv' + String(++seq).padStart(12, '0');
    const inv = { id, url: `https://test.bitpay.com/invoice?id=${id}`, status: 'new', price: b.price, currency: 'GBP', orderId: b.orderId, posData: b.posData,
      expirationTime: Date.now() + 900000, paymentCodes: { [b.paymentCurrencies[0]]: { BIP72b: `bitcoin:?r=https://test.bitpay.com/i/${id}` } },
      paymentDisplayTotals: { [b.paymentCurrencies[0]]: '0.150000' }, exchangeRates: {} };
    invoices.set(id, inv); return reply({ data: inv });
  }
  return reply({ data: invoices.get(url.split('/invoices/')[1].split('?')[0]) });
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function server(dir, port, appMode) {
  return new Promise((ok) => createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const send = async (r) => { res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); };
    try {
      if (url.pathname.startsWith('/api/crypto-')) {
        const chunks = []; for await (const c of req) chunks.push(c);
        /* The app forwards to the website backend with X-Forwarded-Host, exactly as pocket-hub/functions/api/[[path]].js does. */
        const headers = { ...req.headers, ...(appMode ? { 'x-forwarded-host': 'app.aivatrading.uk' } : {}) };
        const request = new Request('https://aivatrading.uk' + url.pathname + url.search, { method: req.method, headers: { ...headers, origin: appMode ? 'https://app.aivatrading.uk' : 'https://aivatrading.uk' }, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const h = { '/api/crypto-rates': cp.handleCryptoRates, '/api/crypto-checkout': cp.handleCryptoCheckout, '/api/crypto-status': cp.handleCryptoStatus }[url.pathname];
        return send(await h(request, env, bitpay));
      }
      if (url.pathname === '/api/shop-status') return send(reply({ ready: true, mode: 'test', provider: 'square', stock: { 'LAMP-1': 5 } }));
      if (url.pathname === '/data/aiva-products.json') return send(reply(catalogue));
      if (url.pathname === '/api/pay/methods') return send(reply({ open: true, products: catalogue.products, shipping: { countries: ['GB'], flatRatePence: 495 }, currencies: ['GBP'],
        methods: [{ id: 'card', label: 'Card', icon: 'card', currencies: ['GBP'], available: true, testMode: true }], note: '' }));
      if (url.pathname.startsWith('/api/')) return send(reply({ error: 'offline test' }, 503));
      const file = path.join(dir, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      if (!file.startsWith(dir)) throw Error('path');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('not found'); }
  }).listen(port, '127.0.0.1', ok));
}
await server(root, 8791, false);
await server(path.join(root, 'pocket-hub/public'), 8792, true);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
async function flow(page, label) {
  await page.getByRole('button', { name: '₿ Pay with Cryptocurrency' }).first().click();
  await page.getByRole('radio', { name: /Solana/ }).click();
  await page.getByRole('radio', { name: /Solana/ }).waitFor();
  await page.getByText('≈ 0.150').first().waitFor().catch(() => {});
  if (shots) await page.screenshot({ path: path.join(shots, label + '-1-choose.png') });
  await page.fill('#acpEmail', 'buyer@example.com');
  await page.click('#acpGo');
  await page.waitForSelector('.acp-qr svg');
  assert.equal(await page.textContent('.acp-amt'), '0.150000 SOL');
  assert.ok(await page.locator('a', { hasText: 'Open in my wallet app' }).count());
  if (shots) await page.screenshot({ path: path.join(shots, label + '-2-pay.png') });
  for (const inv of invoices.values()) if (inv.status === 'new') inv.status = 'confirmed';
  await page.getByText(/payment confirmed/i).first().waitFor({ timeout: 20000 });
  if (shots) await page.screenshot({ path: path.join(shots, label + '-3-confirmed.png') });
}
const errors = [];
// Website
{
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  page.on('pageerror', (e) => errors.push('website: ' + e.message));
  await page.goto('http://127.0.0.1:8791/shop.html');
  await page.getByRole('button', { name: 'Add to basket' }).first().click();
  assert.ok(await page.locator('#aiva-checkout').isVisible(), 'existing card checkout button still present');
  await page.waitForFunction(() => !document.querySelector('#aiva-crypto-pay')?.disabled);
  await flow(page, 'website');
  await page.close();
}
// Super App
{
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  page.on('pageerror', (e) => errors.push('app: ' + e.message));
  await page.goto('http://127.0.0.1:8792/#trade');
  await page.evaluate(() => typeof window.go === 'function' && window.go('trade'));
  await page.locator('[data-ap-buy="LAMP-1"]').click();
  await page.waitForSelector('#apPay');
  await page.waitForFunction(() => document.querySelector('#aiva-crypto-pay-app') && !document.querySelector('#aiva-crypto-pay-app').disabled);
  await flow(page, 'app');
  await page.close();
}
await browser.close();
const rows = db.prepare("SELECT payment_status, provider, expected_total FROM orders WHERE provider='bitpay'").all();
assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.payment_status === 'paid'));
assert.deepEqual(rows.map((r) => r.expected_total), [2995, 2995]);
console.log('BROWSER CRYPTO PAY E2E PASSED: website and Super App, choose coin → QR + wallet link → verified confirmation.');
if (errors.length) console.log('Page errors seen (unrelated offline APIs may cause these):\n' + errors.join('\n'));
process.exit(0);
