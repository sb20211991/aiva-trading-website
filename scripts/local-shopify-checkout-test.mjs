#!/usr/bin/env node
/* Local Shopify checkout flow test: mocked Storefront API, signed webhooks, real SQLite (D1-compatible) orders.
   No network calls and no real money. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(root, 'functions/_lib/commerce.js')).href);
const { shopifyHmac } = await import(pathToFileURL(path.join(root, 'functions/_lib/shopify.js')).href);

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) })
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

const V1 = 'gid://shopify/ProductVariant/1001', V2 = 'gid://shopify/ProductVariant/1002';
const catalogue = {
  version: 1, currency: 'GBP', shopEnabled: true, testOnly: true,
  businessAddress: 'Aiva Trading Limited, London, United Kingdom',
  deliveryPolicy: 'UK delivery in 2-5 working days.', returnsPolicy: '14 day returns on unused items.',
  shipping: { allowedCountries: ['GB'], flatRatePence: 495, freeShippingThresholdPence: 10000 },
  products: [
    { sku: 'AIVA-TEST-1GBP', name: 'TEST £1', category: 'Test', description: 'test', pricePence: 100, stock: 5, available: true, testOnly: true, shopifyVariantId: V1 },
    { sku: 'AIVA-TEST-BIG', name: 'TEST big', category: 'Test', description: 'test', pricePence: 12000, stock: 2, available: true, testOnly: true, shopifyVariantId: V2 },
    { sku: 'AIVA-NO-VARIANT', name: 'Not on Shopify', category: 'Test', description: 'test', pricePence: 500, stock: 9, available: true, testOnly: true }
  ]
};
const base = 'https://aivatrading.uk';
const SHOP = 'aiva-test.myshopify.com';
const env = {
  ASSETS: { fetch: async () => Response.json(catalogue) },
  ORDERS_DB: d1(),
  CHECKOUT_PROVIDER: 'shopify', SHOPIFY_STORE_DOMAIN: SHOP, SHOPIFY_STOREFRONT_TOKEN: 'storefront-test-token',
  SHOPIFY_WEBHOOK_SECRET: 'shopify-webhook-secret-for-tests', MERCHANT_ADMIN_KEY: 'merchant-admin-key-for-tests-0001'
};

const prices = { [V1]: '1.00', [V2]: '120.00' };
let cartSeq = 0, lastCartInput = null, priceDrift = false;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  assert.equal(new URL(url).host, SHOP, 'Shopify store host only: ' + url);
  assert.equal(init.headers['X-Shopify-Storefront-Access-Token'], 'storefront-test-token');
  const { query, variables } = JSON.parse(init.body);
  if (query.includes('shop {')) return Response.json({ data: { shop: { name: 'Aiva', paymentSettings: { currencyCode: 'GBP' } } } });
  assert.ok(query.includes('cartCreate'));
  lastCartInput = variables.input;
  const nodes = variables.input.lines.map((l) => ({ quantity: l.quantity, merchandise: { id: l.merchandiseId, availableForSale: true, price: { amount: priceDrift ? '9.99' : prices[l.merchandiseId], currencyCode: 'GBP' } } }));
  const sub = nodes.reduce((n, x) => n + Math.round(Number(x.merchandise.price.amount) * 100) * x.quantity, 0);
  const id = ++cartSeq;
  return Response.json({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/c' + id, checkoutUrl: `https://${SHOP}/cart/c/c${id}?key=k`, cost: { subtotalAmount: { amount: (sub / 100).toFixed(2), currencyCode: 'GBP' } }, lines: { nodes } }, userErrors: [], warnings: [] } } });
};

const post = (p, body, headers = {}) => new Request(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const checkout = async (items) => { const r = await m.handleCreateCheckout(post('/api/create-checkout-session', { items }), env); return { status: r.status, data: await r.json() }; };
let hookSeq = 0;
async function hook(topic, payload, opts = {}) {
  const raw = JSON.stringify(payload);
  const sig = opts.sig ?? (await shopifyHmac(raw, env.SHOPIFY_WEBHOOK_SECRET));
  const r = await m.handleShopifyWebhook(post('/api/shopify-webhook', raw, {
    'x-shopify-hmac-sha256': sig, 'x-shopify-topic': topic, 'x-shopify-shop-domain': opts.shop || SHOP,
    'x-shopify-webhook-id': opts.id || 'wh-' + (++hookSeq)
  }), env);
  return { status: r.status, data: await r.json() };
}
const shopifyOrder = (orderId, subtotal, total, extra = {}) => ({
  id: 5550000 + hookSeq, name: '#10' + hookSeq, test: true, currency: 'GBP', financial_status: 'paid',
  current_subtotal_price: subtotal, current_total_price: total, contact_email: 'buyer@example.com',
  shipping_address: { name: 'Test Buyer', address1: '1 Test St', city: 'London', zip: 'E1 1AA', country_code: 'GB' },
  note_attributes: [{ name: 'aiva_order_id', value: orderId }], ...extra
});
const row = (id) => env.ORDERS_DB.raw.prepare('SELECT * FROM orders WHERE session_id=?').get(id);
const stock = (sku) => env.ORDERS_DB.raw.prepare('SELECT stock FROM inventory WHERE sku=?').get(sku)?.stock;
const status = async (id) => (await m.handleOrderStatus(new Request(base + '/api/order-status?orderId=' + id), env)).json();
const admin = { Authorization: 'Bearer ' + env.MERCHANT_ADMIN_KEY };

// Status: Shopify test mode, products without a Shopify variant are not published.
let st = await (await m.handleShopStatus(new Request(base + '/api/shop-status'), env)).json();
assert.equal(st.ready, true); assert.equal(st.mode, 'test'); assert.equal(st.provider, 'shopify');
assert.equal(st.publishedProducts, 2); assert.deepEqual(st.checkoutHosts, [SHOP]);
assert.equal(JSON.stringify(st).includes('storefront-test-token'), false, 'token must never reach the browser');
console.log('ok shop-status: Shopify test mode, 2 products with variants, no token exposed');

st = await (await m.handleShopStatus(new Request(base + '/api/shop-status'), { ...env, SHOPIFY_STOREFRONT_TOKEN: '' })).json();
assert.equal(st.mode, 'disabled'); assert.equal(st.ready, false);
st = await (await m.handleShopStatus(new Request(base + '/api/shop-status'), { ...env, SHOPIFY_LIVE_PAYMENTS_APPROVED: 'true' })).json();
assert.equal(st.mode, 'live'); assert.equal(st.ready, false, 'test-only catalogue must never go live');
console.log('ok disabled without credentials; live blocked with test-only catalogue');

// Checkout: server price, Shopify cart attribute, no shipping charged by the site.
let c = await checkout([{ sku: 'AIVA-TEST-1GBP', quantity: 2, pricePence: 1 }]);
assert.equal(c.status, 200, JSON.stringify(c.data)); assert.equal(c.data.provider, 'shopify');
assert.ok(c.data.url.startsWith(`https://${SHOP}/cart/c/`));
assert.deepEqual(lastCartInput.lines, [{ merchandiseId: V1, quantity: 2 }]);
assert.deepEqual(lastCartInput.attributes, [{ key: 'aiva_order_id', value: c.data.orderId }]);
const okOrder = c.data.orderId;
assert.equal(row(okOrder).expected_total, 200); assert.equal(row(okOrder).provider, 'shopify'); assert.equal(row(okOrder).payment_status, 'pending');
console.log('ok checkout creates Shopify cart at server prices and records pending order');

for (const [items, code] of [[[{ sku: 'AIVA-NO-VARIANT', quantity: 1 }], 400], [[{ sku: 'NOPE', quantity: 1 }], 400], [[{ sku: 'AIVA-TEST-BIG', quantity: 3 }], 400], [[{ sku: 'AIVA-TEST-1GBP', quantity: 0 }], 400]]) {
  assert.equal((await checkout(items)).status, code, JSON.stringify(items));
}
priceDrift = true;
assert.equal((await checkout([{ sku: 'AIVA-TEST-1GBP', quantity: 1 }])).status, 409); priceDrift = false;
const badOrigin = await m.handleCreateCheckout(post('/api/create-checkout-session', { items: [{ sku: 'AIVA-TEST-1GBP', quantity: 1 }] }, { Origin: 'https://evil.example' }), env);
assert.equal(badOrigin.status, 403);
console.log('ok rejects unpublished/unknown SKU, over-stock, bad quantity, Shopify price drift, foreign origin');

// Signature and shop checks
assert.equal((await hook('orders/paid', shopifyOrder(okOrder, '2.00', '6.95'), { sig: 'bad' })).status, 401);
assert.equal((await hook('orders/paid', shopifyOrder(okOrder, '2.00', '6.95'), { shop: 'other.myshopify.com' })).status, 401);
assert.equal(row(okOrder).payment_status, 'pending');
console.log('ok invalid signature and foreign shop rejected');

// Successful payment
const s0 = stock('AIVA-TEST-1GBP') ?? 5;
let w = await hook('orders/paid', shopifyOrder(okOrder, '2.00', '6.95'), { id: 'paid-1' });
assert.equal(w.status, 200); assert.equal(w.data.received, true);
let o = row(okOrder);
assert.equal(o.payment_status, 'paid'); assert.equal(o.amount_total, 695); assert.equal(o.customer_email, 'buyer@example.com');
assert.equal(o.test_order, 1); assert.ok(o.provider_order_ref.startsWith('#10'));
assert.equal(stock('AIVA-TEST-1GBP'), s0 - 2);
const os = await status(okOrder); assert.equal(os.paid, true); assert.equal(os.reference, o.provider_order_ref);
console.log(`ok paid webhook: order paid (695p incl. Shopify delivery), stock ${s0} -> ${s0 - 2}, confirmation ${os.reference}`);

// Duplicate delivery
w = await hook('orders/paid', shopifyOrder(okOrder, '2.00', '6.95'), { id: 'paid-1' });
assert.equal(w.data.duplicate, true); assert.equal(stock('AIVA-TEST-1GBP'), s0 - 2);
console.log('ok duplicate webhook ignored, stock unchanged');

// Declined: Shopify creates no paid order, so the website order stays pending and is not confirmed.
c = await checkout([{ sku: 'AIVA-TEST-1GBP', quantity: 1 }]);
const declined = c.data.orderId;
w = await hook('orders/create', shopifyOrder(declined, '1.00', '5.95', { financial_status: 'pending' }));
assert.equal(row(declined).payment_status, 'pending'); assert.equal((await status(declined)).paid, false);
assert.equal(stock('AIVA-TEST-1GBP'), s0 - 2);
console.log('ok declined/unpaid: order not confirmed, no stock taken');

// Cancelled
w = await hook('orders/cancelled', shopifyOrder(declined, '1.00', '5.95', { financial_status: 'voided', cancelled_at: new Date().toISOString() }));
assert.equal(row(declined).payment_status, 'failed'); assert.equal(row(declined).fulfillment_status, 'cancelled');
assert.equal((await status(declined)).paid, false); assert.equal(stock('AIVA-TEST-1GBP'), s0 - 2);
console.log('ok cancelled: order marked failed/cancelled, no stock taken');

// Amount mismatch (e.g. altered cart) is held for review, not marked paid.
c = await checkout([{ sku: 'AIVA-TEST-1GBP', quantity: 1 }]);
w = await hook('orders/paid', shopifyOrder(c.data.orderId, '0.50', '5.45'));
assert.equal(w.data.ignored, 'amount_mismatch'); assert.notEqual(row(c.data.orderId).payment_status, 'paid');
console.log('ok amount mismatch held for review');

// Orders from Shopify's own storefront are ignored.
w = await hook('orders/paid', { ...shopifyOrder('x', '1.00', '1.00'), note_attributes: [] });
assert.equal(w.data.ignored, 'not_website_order');
console.log('ok non-website Shopify orders ignored');

// Refunds come from Shopify admin via webhook
const shopifyId = row(okOrder).payment_id;
w = await hook('refunds/create', { id: 901, order_id: Number(shopifyId), transactions: [{ kind: 'refund', status: 'success', amount: '2.00' }] });
o = row(okOrder); assert.equal(o.refunded_total, 200); assert.equal(o.payment_status, 'paid');
w = await hook('refunds/create', { id: 902, order_id: Number(shopifyId), transactions: [{ kind: 'refund', status: 'success', amount: '4.95' }] });
o = row(okOrder); assert.equal(o.refunded_total, 695); assert.equal(o.payment_status, 'refunded');
const rf = await m.handleCreateRefund(post('/api/create-refund', { orderId: okOrder, amountPence: 1 }, admin), env);
assert.equal(rf.status, 409);
console.log('ok partial + full Shopify refunds recorded; site refund button points to Shopify admin');

// Merchant listing
const list = await (await m.handleAdminOrders(new Request(base + '/api/admin-orders', { headers: admin }), env)).json();
assert.ok(list.orders.some((x) => x.orderId === okOrder && x.provider === 'shopify' && x.provider_order_ref));
assert.equal((await m.handleAdminOrders(new Request(base + '/api/admin-orders'), env)).status, 401);
console.log('ok merchant order list shows Shopify orders; unauthenticated access refused');

console.log('LOCAL SHOPIFY CHECKOUT TESTS PASSED');
