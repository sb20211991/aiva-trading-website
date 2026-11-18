#!/usr/bin/env node
/* Local Square checkout flow test: mocked Square API, real SQLite (D1-compatible) order database.
   No network calls and no real money. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(root, 'functions/_lib/commerce.js')).href);

function d1() {
  const db = new DatabaseSync(':memory:');
  // Legacy production schema (with CHECK constraints) to prove the in-place self-migration.
  db.exec(`CREATE TABLE orders (session_id TEXT PRIMARY KEY, last_event_id TEXT NOT NULL,
    payment_status TEXT NOT NULL CHECK(payment_status IN ('pending','paid','failed')),
    fulfillment_status TEXT NOT NULL DEFAULT 'new' CHECK(fulfillment_status IN ('new','processing','shipped','cancelled','refunded')),
    customer_email TEXT, customer_name TEXT, amount_total INTEGER, currency TEXT, shipping_details_json TEXT, line_items_json TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE stripe_events (event_id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL);
    CREATE INDEX orders_payment_created ON orders(payment_status,created_at);
    INSERT INTO orders (session_id,last_event_id,payment_status,created_at,updated_at) VALUES ('LEGACY_ORDER_0001','evt','paid',1,1);`);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) })
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

const catalogue = {
  ...JSON.parse(readFileSync(path.join(root, 'data/aiva-products.json'), 'utf8')),
  shipping: { allowedCountries: ['GB'], flatRatePence: 495, freeShippingThresholdPence: 10000 },
  products: [
    { sku: 'AIVA-TEST-1GBP', name: 'TEST £1', category: 'Test', description: 'test', pricePence: 100, stock: 5, available: true, testOnly: true },
    { sku: 'AIVA-TEST-BIG', name: 'TEST big', category: 'Test', description: 'test', pricePence: 12000, stock: 2, available: true, testOnly: true }
  ]
};
const base = 'https://aivatrading.uk';
const NOTIFY = base + '/api/square-webhook';
const env = {
  ASSETS: { fetch: async () => new Response(JSON.stringify(catalogue), { headers: { 'Content-Type': 'application/json' } }) },
  ORDERS_DB: d1(),
  SQUARE_ACCESS_TOKEN: 'sandbox-token', SQUARE_LOCATION_ID: 'LOC_TEST', SQUARE_ENVIRONMENT: 'sandbox',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'test-signature-key-123456', SQUARE_WEBHOOK_NOTIFICATION_URL: NOTIFY,
  MERCHANT_ADMIN_KEY: 'merchant-admin-key-for-tests-0001'
};

const calls = [];
let orderSeq = 0, refundSeq = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input), body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, body });
  assert.ok(url.startsWith('https://connect.squareupsandbox.com/'), 'sandbox host only: ' + url);
  if (url.endsWith('/v2/online-checkout/payment-links')) {
    const id = 'ORDER_TEST_' + String(++orderSeq).padStart(4, '0');
    return Response.json({ payment_link: { id: 'PL_' + orderSeq, order_id: id, url: 'https://sandbox.square.link/u/test' + orderSeq } });
  }
  if (url.endsWith('/v2/refunds')) return Response.json({ refund: { id: 'RF_TEST_000' + (++refundSeq), status: 'PENDING' } });
  if (url.includes('/v2/orders/')) return Response.json({ order: { id: url.split('/').pop(), state: 'COMPLETED', metadata: { source: 'aivatrading.uk' }, tenders: [{ amount_money: { amount: 595 } }] } });
  return Response.json({ errors: [{ code: 'NOT_FOUND' }] }, { status: 404 });
};

const post = (p, body, headers = {}) => new Request(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const checkout = (items) => m.handleCreateCheckout(post('/api/create-checkout-session', { items }), env);
async function webhook(event, sig) {
  const raw = JSON.stringify(event);
  const s = sig ?? (await m.squareSignature(raw, env.SQUARE_WEBHOOK_SIGNATURE_KEY, NOTIFY));
  return m.handleSquareWebhook(post('/api/square-webhook', raw, { 'x-square-hmacsha256-signature': s }), env);
}
const payment = (order, amount, status = 'COMPLETED') => ({ id: 'PAY_' + order, order_id: order, status, amount_money: { amount, currency: 'GBP' }, buyer_email_address: 'buyer@example.com' });
const order = (id) => env.ORDERS_DB.raw.prepare('SELECT * FROM orders WHERE session_id=?').get(id);
const stock = (sku) => env.ORDERS_DB.raw.prepare('SELECT stock FROM inventory WHERE sku=?').get(sku)?.stock;
const admin = { Authorization: 'Bearer ' + env.MERCHANT_ADMIN_KEY };

// Shop status
let st = await (await m.handleShopStatus(new Request(base + '/api/shop-status'), env)).json();
assert.equal(st.ready, true); assert.equal(st.mode, 'test'); assert.equal(st.provider, 'square');
console.log('ok shop-status sandbox ready');

// Production without approval stays disabled
st = await (await m.handleShopStatus(new Request(base + '/api/shop-status'), { ...env, SQUARE_ENVIRONMENT: 'production' })).json();
assert.equal(st.mode, 'disabled'); assert.equal(st.ready, false);
st = await (await m.handleShopStatus(new Request(base + '/api/shop-status'), { ...env, SQUARE_ENVIRONMENT: 'production', SQUARE_LIVE_PAYMENTS_APPROVED: 'true' })).json();
assert.equal(st.ready, false, 'test-only catalogue must never go live');
console.log('ok live payments blocked without approval / with test catalogue');

// Server-side pricing: browser-supplied price is ignored
let r = await checkout([{ sku: 'AIVA-TEST-1GBP', quantity: 1, pricePence: 1 }]);
let j = await r.json();
assert.equal(r.status, 200); assert.match(j.url, /square\.link/);
const created = calls.at(-1).body;
assert.equal(created.order.line_items[0].base_price_money.amount, 100);
assert.equal(created.checkout_options.shipping_fee.charge.amount, 495);
assert.equal(order(j.orderId).expected_total, 595);
const o1 = j.orderId;
console.log('ok £1 checkout created with server price + delivery = £5.95');

// Free delivery threshold, invalid quantity, unknown SKU, over-stock, bad origin
r = await checkout([{ sku: 'AIVA-TEST-BIG', quantity: 1 }]); j = await r.json();
assert.equal(calls.at(-1).body.checkout_options.shipping_fee, undefined); assert.equal(order(j.orderId).expected_total, 12000);
for (const items of [[{ sku: 'AIVA-TEST-1GBP', quantity: 0 }], [{ sku: 'NOPE-SKU', quantity: 1 }], [{ sku: 'AIVA-TEST-BIG', quantity: 3 }], [{ sku: 'AIVA-TEST-1GBP', quantity: 1.5 }]]) {
  assert.equal((await checkout(items)).status, 400);
}
assert.equal((await m.handleCreateCheckout(post('/api/create-checkout-session', { items: [{ sku: 'AIVA-TEST-1GBP', quantity: 1 }] }, { Origin: 'https://evil.example' }), env)).status, 403);
console.log('ok basket validation (quantity, SKU, stock, origin)');

// Webhook signature
const evt = (id, type, obj) => ({ event_id: id, type, data: { object: obj } });
assert.equal((await webhook(evt('E0', 'payment.updated', { payment: payment(o1, 595) }), 'bad')).status, 401);
assert.equal(order(o1).payment_status, 'pending');
console.log('ok invalid signature rejected');

// Successful payment, then duplicate delivery
j = await (await webhook(evt('E1', 'payment.updated', { payment: payment(o1, 595) }))).json();
assert.equal(j.paid, true); assert.equal(order(o1).payment_status, 'paid'); assert.equal(stock('AIVA-TEST-1GBP'), 4);
j = await (await webhook(evt('E1', 'payment.updated', { payment: payment(o1, 595) }))).json();
assert.equal(j.duplicate, true);
j = await (await webhook(evt('E1b', 'payment.created', { payment: payment(o1, 595) }))).json();
assert.equal(j.duplicate, true); assert.equal(stock('AIVA-TEST-1GBP'), 4);
console.log('ok payment recorded once, stock 5 -> 4, duplicates ignored');

// Stock override now visible to shop
st = await (await m.handleShopStatus(new Request(base + '/api/shop-status'), env)).json();
assert.equal(st.stock['AIVA-TEST-1GBP'], 4);

// Failed / cancelled payment
j = await (await checkout([{ sku: 'AIVA-TEST-1GBP', quantity: 2 }])).json();
const o2 = j.orderId;
await webhook(evt('E2', 'payment.updated', { payment: payment(o2, 695, 'FAILED') }));
assert.equal(order(o2).payment_status, 'failed'); assert.equal(stock('AIVA-TEST-1GBP'), 4);
j = await (await checkout([{ sku: 'AIVA-TEST-1GBP', quantity: 1 }])).json();
await webhook(evt('E3', 'payment.updated', { payment: payment(j.orderId, 595, 'CANCELED') }));
assert.equal(order(j.orderId).payment_status, 'failed');
console.log('ok failed and cancelled payments recorded, no stock change');

// Amount mismatch goes to review
j = await (await checkout([{ sku: 'AIVA-TEST-1GBP', quantity: 1 }])).json();
await webhook(evt('E4', 'payment.updated', { payment: payment(j.orderId, 1, 'COMPLETED') }));
assert.equal(order(j.orderId).payment_status, 'pending'); assert.equal(order(j.orderId).review_reason, 'amount_mismatch'); assert.equal(stock('AIVA-TEST-1GBP'), 4);
console.log('ok amount mismatch flagged for review');

// Order status
j = await (await m.handleOrderStatus(new Request(base + '/api/order-status?orderId=' + o1), env)).json();
assert.equal(j.paid, true);

// Merchant admin + refunds
assert.equal((await m.handleAdminOrders(new Request(base + '/api/admin-orders'), env)).status, 401);
j = await (await m.handleAdminOrders(new Request(base + '/api/admin-orders?status=paid', { headers: admin }), env)).json();
assert.equal(j.orders.length, 2); assert.equal(j.orders[0].orderId, o1); assert.equal(j.orders[1].orderId, 'LEGACY_ORDER_0001', 'legacy rows kept by migration');
j = await (await m.handleAdminOrders(new Request(base + '/api/admin-orders', { method: 'POST', headers: admin, body: JSON.stringify({ orderId: o1, fulfillmentStatus: 'shipped' }) }), env)).json();
assert.equal(j.ok, true); assert.equal(order(o1).fulfillment_status, 'shipped');
j = await (await m.handleAdminOrders(new Request(base + '/api/admin-orders', { method: 'POST', headers: admin, body: JSON.stringify({ sku: 'AIVA-TEST-1GBP', stock: 4 }) }), env)).json();
assert.equal(j.ok, true); assert.equal(stock('AIVA-TEST-1GBP'), 4);
assert.equal((await m.handleAdminOrders(new Request(base + '/api/admin-orders', { method: 'POST', headers: admin, body: JSON.stringify({ sku: 'AIVA-TEST-1GBP', stock: -1 }) }), env)).status, 400);
assert.equal((await m.handleCreateRefund(post('/api/create-refund', { orderId: o1 }), env)).status, 401);
assert.equal((await m.handleCreateRefund(post('/api/create-refund', { orderId: o1, amountPence: 600 }, admin), env)).status, 400);
j = await (await m.handleCreateRefund(post('/api/create-refund', { orderId: o1, amountPence: 95 }, admin), env)).json();
assert.equal(j.ok, true); assert.equal(order(o1).payment_status, 'paid'); assert.equal(order(o1).refunded_total, 95);
j = await (await m.handleCreateRefund(post('/api/create-refund', { orderId: o1 }, admin), env)).json();
assert.equal(j.amountPence, 500); assert.equal(order(o1).payment_status, 'refunded'); assert.equal(order(o1).fulfillment_status, 'shipped');
assert.equal((await m.handleCreateRefund(post('/api/create-refund', { orderId: o1 }, admin), env)).status, 409);
const rf = (id, status, amount) => ({ refund: { id, status, payment_id: 'PAY_' + o1, amount_money: { amount, currency: 'GBP' } } });
await webhook(evt('E5', 'refund.updated', rf('RF_DASH_0001', 'FAILED', 300)));
assert.equal(order(o1).refunded_total, 595, 'unrelated failed refund must not release website refunds');
await webhook(evt('E6', 'refund.updated', rf('RF_TEST_0002', 'FAILED', 500)));
await webhook(evt('E6b', 'refund.created', rf('RF_TEST_0002', 'PENDING', 500)));
assert.equal(order(o1).payment_status, 'paid'); assert.equal(order(o1).refunded_total, 95); assert.equal(order(o1).fulfillment_status, 'shipped');
const k1 = calls.filter((c) => c.url.endsWith('/v2/refunds')).at(-1).body.idempotency_key;
j = await (await m.handleCreateRefund(post('/api/create-refund', { orderId: o1 }, admin), env)).json();
assert.equal(j.refundId, 'RF_TEST_0003'); assert.notEqual(calls.at(-1).body.idempotency_key, k1);
await webhook(evt('E7', 'refund.updated', rf('RF_TEST_0003', 'COMPLETED', 500)));
await webhook(evt('E8', 'refund.updated', rf('RF_TEST_0001', 'COMPLETED', 95)));
assert.equal(order(o1).payment_status, 'refunded'); assert.equal(order(o1).refund_status, 'COMPLETED'); assert.equal(order(o1).fulfillment_status, 'refunded');
console.log('ok merchant listing, fulfilment update, partial + full refunds, failed refund restored');

console.log('LOCAL SQUARE CHECKOUT TESTS PASSED');
