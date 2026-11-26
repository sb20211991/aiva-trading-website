/* Aiva Pay: Stripe (card, Apple Pay, Google Pay, Alipay, WeChat Pay; GBP and CNY) and BitPay (crypto).
   Offline: every provider reply is a local stub. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { methodsHandler, checkoutHandler, statusHandler, stripeState, bitpayState, form, quote, METHODS } from '../functions/_lib/payments.js';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const CAT = { version: 1, currency: 'GBP', shopEnabled: true, deliveryPolicy: 'UK delivery in 3-5 days.', returnsPolicy: '14 days.',
  shipping: { allowedCountries: ['GB', 'CN'], flatRatePence: 500, freeShippingThresholdPence: null },
  products: [{ sku: 'LAMP-1', name: 'Smart lamp', description: 'Wi-Fi lamp', category: 'Smart home & security', pricePence: 2500, stock: 4, available: true },
    { sku: 'OLD-1', name: 'Sold out', description: '', category: 'X', pricePence: 900, stock: 0, available: true },
    { sku: 'HID-1', name: 'Hidden', description: '', category: 'X', pricePence: 900, stock: 3, available: true, hidden: true }] };
const caps = (o) => ({ id: 'acct_1', capabilities: { card_payments: 'active', alipay_payments: 'inactive', wechat_pay_payments: 'inactive', ...o } });
/* Records each call; routes are [substring, reply|fn]. */
function stub(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [k, v] of routes) if (String(url).includes(k)) return typeof v === 'function' ? v(String(url), init) : v.clone();
    return reply({}, 404);
  };
  f.calls = calls;
  return f;
}
const get = (q) => new Request('https://app.aivatrading.uk' + q);
const post = (body, origin = 'https://app.aivatrading.uk') => new Request('https://app.aivatrading.uk/api/pay/checkout',
  { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
const TEST = { STRIPE_SECRET_KEY: 'sk_test_abc', WEBSITE_ORIGIN: 'https://aiva-trading.pages.dev' };

// Configuration: no key is closed; a live key needs AIVA_PAY_LIVE; a test key is test mode; publishable keys are refused.
assert.equal(stripeState({}).ready, false);
assert.equal(stripeState({ STRIPE_SECRET_KEY: 'sk_live_x' }).ready, false);
assert.deepEqual(stripeState({ STRIPE_SECRET_KEY: 'sk_live_x', AIVA_PAY_LIVE: 'true' }), { ready: true, testMode: false });
assert.deepEqual(stripeState({ STRIPE_SECRET_KEY: 'rk_test_x' }), { ready: true, testMode: true });
assert.equal(stripeState({ STRIPE_SECRET_KEY: 'pk_live_x', AIVA_PAY_LIVE: 'true' }).ready, false);
assert.equal(bitpayState({ BITPAY_TOKEN: 't', BITPAY_ENV: 'prod' }).ready, false);
assert.equal(bitpayState({ BITPAY_TOKEN: 't', BITPAY_ENV: 'prod', AIVA_PAY_LIVE: 'true' }).base, 'https://bitpay.com');
assert.equal(bitpayState({ BITPAY_TOKEN: 't' }).base, 'https://test.bitpay.com');
assert.deepEqual(METHODS.map((m) => m.id), ['card', 'apple_pay', 'google_pay', 'alipay', 'wechat_pay', 'crypto']);

// Stripe form encoding: nested objects and arrays use bracketed keys.
assert.equal(decodeURIComponent(form({ a: { b: 1 }, l: [{ q: 2 }], t: ['card'] }).toString()), 'a[b]=1&l[0][q]=2&t[0]=card');

// Methods: only buyable products; each method reports its real activation state from Stripe.
{
  const f = stub([['aiva-products.json', reply(CAT)], ['/v1/account', reply(caps({ alipay_payments: 'active', wechat_pay_payments: 'pending' }))]]);
  const d = await (await methodsHandler(get('/api/pay/methods'), TEST, f, false)).json();
  assert.equal(d.open, true);
  assert.deepEqual(d.products.map((p) => p.sku), ['LAMP-1']);
  const by = Object.fromEntries(d.methods.map((m) => [m.id, m]));
  assert.equal(by.card.available, true); assert.equal(by.apple_pay.available, true); assert.equal(by.google_pay.available, true);
  assert.equal(by.alipay.available, true); assert.equal(by.card.testMode, true);
  assert.equal(by.wechat_pay.available, false); assert.match(by.wechat_pay.reason, /approve/);
  assert.equal(by.crypto.available, false); assert.match(by.crypto.reason, /not connected/);
  assert.deepEqual(d.currencies, ['GBP', 'CNY']);
  // The Stripe key is sent only in the Authorization header.
  const acct = f.calls.find((c) => c.url.includes('/v1/account'));
  assert.equal(acct.init.headers.Authorization, 'Bearer sk_test_abc'); assert.ok(!acct.url.includes('sk_test'));
}
// Nothing connected: products still listed, every method closed with a reason, checkout not open.
{
  const d = await (await methodsHandler(get('/api/pay/methods'), {}, stub([['aiva-products.json', reply(CAT)]]), false)).json();
  assert.equal(d.open, false); assert.equal(d.products.length, 1); assert.ok(d.methods.every((m) => !m.available && m.reason));
}

// Card checkout in GBP: server-side price, shipping from the catalogue, Apple Pay/Google Pay ride on the card page.
{
  const f = stub([['aiva-products.json', reply(CAT)], ['/v1/checkout/sessions', reply({ id: 'cs_test_a1b2c3d4e5f6', url: 'https://checkout.stripe.com/c/pay/cs_test_a1' })]]);
  const r = await checkoutHandler(post({ sku: 'LAMP-1', qty: 2, method: 'apple_pay', currency: 'GBP', pricePence: 1 }), TEST, f);
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.url, 'https://checkout.stripe.com/c/pay/cs_test_a1'); assert.equal(d.total, 5500); assert.equal(d.testMode, true);
  const c = f.calls.find((x) => x.url.endsWith('/v1/checkout/sessions')), p = new URLSearchParams(c.init.body);
  assert.equal(p.get('payment_method_types[0]'), 'card');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '2500'); assert.equal(p.get('line_items[0][quantity]'), '2');
  assert.equal(p.get('line_items[0][price_data][currency]'), 'gbp');
  assert.equal(p.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '500');
  assert.equal(p.get('shipping_address_collection[allowed_countries][1]'), 'CN');
  assert.match(p.get('success_url'), /^https:\/\/app\.aivatrading\.uk\/\?aivaPay=stripe&session_id=\{CHECKOUT_SESSION_ID\}#trade$/);
  assert.equal(p.get('metadata[app]'), 'aiva-pocket-hub');
  assert.ok(c.init.headers['Idempotency-Key']);
}
// Alipay in CNY: priced from the live GBP→CNY rate, rounded up to the fen; Chinese locale.
{
  const f = stub([['aiva-products.json', reply(CAT)], ['/v1/account', reply(caps({ alipay_payments: 'active' }))],
    ['exchange-rates?currency=GBP', reply({ data: { currency: 'GBP', rates: { CNY: '9.1234', USD: '1.27' } } })],
    ['frankfurter', reply({ base: 'GBP', rates: { CNY: 9.1, USD: 1.27 } })], ['open.er-api', reply({ result: 'success', rates: { CNY: 9.2 } })],
    ['/v1/checkout/sessions', reply({ id: 'cs_test_zz', url: 'https://checkout.stripe.com/c/pay/cs_test_zz' })]]);
  const d = await (await checkoutHandler(post({ sku: 'LAMP-1', qty: 1, method: 'alipay', currency: 'CNY' }), TEST, f)).json();
  assert.equal(d.currency, 'CNY'); assert.equal(d.rate, 9.1234);
  const p = new URLSearchParams(f.calls.find((x) => x.url.endsWith('/v1/checkout/sessions')).init.body);
  assert.equal(p.get('payment_method_types[0]'), 'alipay'); assert.equal(p.get('line_items[0][price_data][currency]'), 'cny');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), String(Math.ceil(2500 * 9.1234))); // 22809 fen = ¥228.09
  assert.equal(p.get('locale'), 'zh'); assert.equal(p.get('metadata[gbp_total_pence]'), '3000');
}
// WeChat Pay: refused until Stripe activates it; when active, the web client option is sent.
{
  const off = stub([['aiva-products.json', reply(CAT)], ['/v1/account', reply(caps())]]);
  const r = await checkoutHandler(post({ sku: 'LAMP-1', method: 'wechat_pay', currency: 'GBP' }), TEST, off);
  assert.equal(r.status, 503); assert.match((await r.json()).error, /not yet activated/);
  assert.ok(!off.calls.some((c) => c.url.includes('/checkout/sessions')));
  const on = stub([['aiva-products.json', reply(CAT)], ['/v1/account', reply(caps({ wechat_pay_payments: 'active' }))], ['/v1/checkout/sessions', reply({ id: 'cs_test_w', url: 'https://checkout.stripe.com/w' })]]);
  assert.equal((await checkoutHandler(post({ sku: 'LAMP-1', method: 'wechat_pay', currency: 'GBP' }), TEST, on)).status, 200);
  assert.equal(new URLSearchParams(on.calls.find((x) => x.url.endsWith('/checkout/sessions')).init.body).get('payment_method_options[wechat_pay][client]'), 'web');
}
// No live CNY rate: an honest refusal, never an invented price.
{
  const f = stub([['aiva-products.json', reply(CAT)], ['open.er-api', reply({ result: 'success', rates: { CNY: 9.2 } })]]);
  const r = await checkoutHandler(post({ sku: 'LAMP-1', method: 'card', currency: 'CNY' }), TEST, f);
  assert.equal(r.status, 503);
  await assert.rejects(quote(100, 1, 'CNY', 0, stub([])));
}
// Guards: foreign origin, unknown product, out of stock, bad quantity, crypto in CNY, nothing connected.
{
  const f = stub([['aiva-products.json', reply(CAT)]]);
  assert.equal((await checkoutHandler(post({ sku: 'LAMP-1', method: 'card' }, 'https://evil.example'), TEST, f)).status, 403);
  assert.equal((await checkoutHandler(post({ sku: 'NOPE', method: 'card' }), TEST, f)).status, 404);
  assert.equal((await checkoutHandler(post({ sku: 'OLD-1', method: 'card' }), TEST, f)).status, 404);
  assert.equal((await checkoutHandler(post({ sku: 'HID-1', method: 'card' }), TEST, f)).status, 404);
  assert.equal((await checkoutHandler(post({ sku: 'LAMP-1', qty: 5, method: 'card' }), TEST, f)).status, 409);
  assert.equal((await checkoutHandler(post({ sku: 'LAMP-1', qty: 0, method: 'card' }), TEST, f)).status, 400);
  assert.equal((await checkoutHandler(post({ sku: 'LAMP-1', method: 'crypto', currency: 'CNY' }), TEST, f)).status, 400);
  assert.equal((await checkoutHandler(post({ sku: 'LAMP-1', method: 'paypal' }), TEST, f)).status, 400);
  assert.equal((await checkoutHandler(post({ sku: 'LAMP-1', method: 'card' }), {}, f)).status, 503);
  assert.equal((await checkoutHandler(post({ sku: 'LAMP-1', method: 'card' }), { STRIPE_SECRET_KEY: 'sk_live_x' }, f)).status, 503);
}
// Crypto: a BitPay invoice in GBP, test environment unless production is explicitly live.
{
  const f = stub([['aiva-products.json', reply(CAT)], ['test.bitpay.com/invoices', reply({ data: { id: 'Inv1234567890', url: 'https://test.bitpay.com/i/Inv1234567890', status: 'new' } })]]);
  const d = await (await checkoutHandler(post({ sku: 'LAMP-1', qty: 1, method: 'crypto', currency: 'GBP', email: 'a@b.co' }), { BITPAY_TOKEN: 'posTok' }, f)).json();
  assert.equal(d.provider, 'bitpay'); assert.equal(d.invoiceId, 'Inv1234567890'); assert.equal(d.testMode, true);
  const call = f.calls.find((c) => c.url.includes('bitpay')), b = JSON.parse(call.init.body);
  assert.equal(b.price, 30); assert.equal(b.currency, 'GBP'); assert.equal(b.token, 'posTok'); assert.equal(b.buyer.email, 'a@b.co');
  assert.equal(call.init.headers['X-Accept-Version'], '2.0.0');
}
// Status is read back from the provider; only Aiva's own payments are reported.
{
  const f = stub([['/v1/checkout/sessions/cs_test_a1b2c3d4e5f6', reply({ id: 'cs_test_a1b2c3d4e5f6', payment_status: 'paid', amount_total: 5500, currency: 'gbp', livemode: false,
    client_reference_id: 'AIVA-1', metadata: { app: 'aiva-pocket-hub', method: 'card' }, customer_details: { email: 'sam@example.com' } })]]);
  const d = await (await statusHandler(get('/api/pay/status?session_id=cs_test_a1b2c3d4e5f6'), TEST, f)).json();
  assert.equal(d.paid, true); assert.equal(d.total, 5500); assert.equal(d.currency, 'GBP'); assert.equal(d.email, 's…@example.com');
  const other = stub([['/v1/checkout/sessions/', reply({ payment_status: 'paid', metadata: {} })]]);
  assert.equal((await statusHandler(get('/api/pay/status?session_id=cs_test_a1b2c3d4e5f6'), TEST, other)).status, 404);
  const bp = stub([['/invoices/Inv1234567890', reply({ data: { status: 'confirmed', price: 30, currency: 'GBP', orderId: 'AIVA-2', posData: '{"app":"aiva-pocket-hub"}' } })]]);
  const e = await (await statusHandler(get('/api/pay/status?invoice=Inv1234567890'), { BITPAY_TOKEN: 'posTok' }, bp)).json();
  assert.equal(e.paid, true); assert.equal(e.total, 3000);
  assert.equal((await statusHandler(get('/api/pay/status'), TEST, stub([]))).status, 400);
}
// The page loads Aiva Pay after app.js, shows every method's icon, and the service worker caches it.
{
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('src="aiva-pay.js"') > html.indexOf('src="app.js"'));
  const js = readFileSync(new URL('../public/aiva-pay.js', import.meta.url), 'utf8');
  for (const s of ['apCard', 'data-ap-method', 'data-ap-cur', '支付宝', '微信支付', 'Apple', 'Google', 'Bitcoin', '/api/pay/checkout', '/api/pay/status']) assert.ok(js.includes(s), s);
  assert.match(readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8'), /aiva-pay\.js/);
}
console.log('PAY CHECKS PASSED');
