#!/usr/bin/env node
/* CI only: real Square SANDBOX end-to-end test against the deployed site. Never prints secrets. */
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL;
const HOOK = process.env.WEBHOOK_URL;
const token = JSON.parse(readFileSync(process.env.SECRETS_FILE, 'utf8')).SQUARE_ACCESS_TOKEN;
const { sigKey, merchant } = JSON.parse(readFileSync(process.env.SECRETS_FILE + '.e2e', 'utf8'));
const SB = 'https://connect.squareupsandbox.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (m) => { results.push('PASS ' + m); console.log('PASS', m); };

async function sq(path, init = {}) {
  const r = await fetch(SB + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2025-10-16', 'Content-Type': 'application/json' } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function site(path, init = {}) {
  const r = await fetch(BASE + path, init);
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, ct, data: ct.includes('json') ? await r.json() : await r.text() };
}
const admin = { Authorization: 'Bearer ' + merchant, 'Content-Type': 'application/json' };
async function orders() { const r = await site('/api/admin-orders', { headers: admin }); assert.equal(r.status, 200, 'admin-orders ' + r.status); return r.data; }
async function waitOrder(id, pred, what) {
  for (let i = 0; i < 30; i++) { const d = await orders(); const o = d.orders.find((x) => x.orderId === id); if (o && pred(o, d)) return { o, d }; await sleep(3000); }
  const d = await orders(); throw new Error('timeout waiting for ' + what + ': ' + JSON.stringify(d.orders.find((x) => x.orderId === id)));
}
async function checkout() {
  const r = await site('/api/create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ items: [{ sku: 'AIVA-TEST-1GBP', quantity: 1 }] }) });
  assert.equal(r.status, 200, 'checkout HTTP ' + r.status + ' ' + JSON.stringify(r.data));
  assert.equal(r.data.mode, 'test'); assert.match(r.data.url, /^https:\/\/(sandbox\.)?square\.link\//);
  return r.data;
}
async function pay(orderId, nonce) {
  const o = await sq('/v2/orders/' + orderId);
  assert.equal(o.status, 200, 'retrieve order ' + o.status);
  const total = o.data.order.total_money;
  const p = await sq('/v2/payments', { method: 'POST', body: JSON.stringify({ idempotency_key: randomUUID(), source_id: nonce, order_id: orderId, amount_money: total, autocomplete: true, location_id: o.data.order.location_id, buyer_email_address: 'sandbox-buyer@example.com' }) });
  return { total, p };
}

// 1. Status
let st;
for (let i = 0; i < 20; i++) { st = await site('/api/shop-status'); if (st.data?.ready && st.data.mode === 'test') break; await sleep(6000); }
assert.equal(st.status, 200); assert.ok(st.ct.includes('json')); assert.equal(st.data.mode, 'test', 'shop-status ' + JSON.stringify(st.data));
assert.equal(st.data.envFlags.hasWebhookSignatureKey, true); assert.equal(st.data.envFlags.hasMerchantKey, true);
ok(`shop-status JSON, sandbox mode, Square configured (${BASE})`);
const stock0 = (await orders()).inventory.find((x) => x.sku === 'AIVA-TEST-1GBP')?.stock ?? st.data.stock['AIVA-TEST-1GBP'];

// 2. £1 checkout + successful sandbox card payment
const c1 = await checkout();
const linkPage = await fetch(c1.url, { redirect: 'follow' });
ok(`£1 checkout created: Square hosted page ${new URL(c1.url).host} HTTP ${linkPage.status}, order ${c1.orderId}`);
const { total, p } = await pay(c1.orderId, 'cnon:card-nonce-ok');
assert.equal(p.status, 200, 'payment ' + p.status + ' ' + JSON.stringify(p.data.errors?.map((e) => e.code)));
assert.equal(p.data.payment.status, 'COMPLETED');
ok(`sandbox payment ${p.data.payment.id} COMPLETED, ${total.amount}p ${total.currency} (Visa test card nonce)`);
let w = await waitOrder(c1.orderId, (o) => o.payment_status === 'paid', 'paid via webhook');
assert.equal(w.o.amount_total, total.amount);
const stock1 = w.d.inventory.find((x) => x.sku === 'AIVA-TEST-1GBP')?.stock;
assert.equal(stock1, stock0 - 1);
ok(`signed webhook recorded order paid in D1 (amount ${w.o.amount_total}p); stock ${stock0} -> ${stock1}`);
const os = await site('/api/order-status?orderId=' + encodeURIComponent(c1.orderId));
assert.equal(os.data.paid, true); ok('order-status confirms paid for the customer confirmation page');

// 3. Duplicate webhook delivery (signed replay with the same event id)
const evt = { merchant_id: 'x', type: 'payment.updated', event_id: 'dup-' + randomUUID(), created_at: new Date().toISOString(), data: { type: 'payment', id: p.data.payment.id, object: { payment: { ...p.data.payment } } } };
const raw = JSON.stringify(evt);
const sig = createHmac('sha256', sigKey).update(HOOK + raw).digest('base64');
const send = (s) => fetch(BASE + '/api/square-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-square-hmacsha256-signature': s }, body: raw });
const bad = await send('AAAA'); assert.equal(bad.status, 401); ok('forged webhook signature rejected (401)');
await (await send(sig)).json(); const d2 = await (await send(sig)).json();
assert.equal(d2.duplicate, true);
w = await waitOrder(c1.orderId, () => true, 'reload');
assert.equal(w.d.inventory.find((x) => x.sku === 'AIVA-TEST-1GBP')?.stock, stock1);
ok('duplicate webhook ignored; stock not reduced twice');

// 4. Declined card
const c2 = await checkout();
const { p: p2 } = await pay(c2.orderId, 'cnon:card-nonce-declined');
assert.notEqual(p2.status, 200);
ok(`declined card rejected by Square (${p2.data.errors?.[0]?.code})`);
await sleep(8000);
const o2 = (await orders()).orders.find((x) => x.orderId === c2.orderId);
assert.ok(o2 && ['failed', 'pending'].includes(o2.payment_status));
ok(`declined order recorded as ${o2.payment_status}, not paid; stock unchanged`);

// 5. Cancelled / abandoned checkout
const c3 = await checkout();
const links = await sq('/v2/online-checkout/payment-links?limit=50');
const link = (links.data.payment_links || []).find((l) => l.order_id === c3.orderId);
if (link) { const del = await sq('/v2/online-checkout/payment-links/' + link.id, { method: 'DELETE' }); assert.equal(del.status, 200); }
const o3 = (await orders()).orders.find((x) => x.orderId === c3.orderId);
assert.equal(o3.payment_status, 'pending');
ok('cancelled checkout: payment link deleted, order stays unpaid, no stock change');

// 6. Partial then full refund
let r = await site('/api/create-refund', { method: 'POST', headers: admin, body: JSON.stringify({ orderId: c1.orderId, amountPence: 50, reason: 'Sandbox partial refund test' }) });
assert.equal(r.status, 200, 'partial refund ' + JSON.stringify(r.data));
r = await site('/api/create-refund', { method: 'POST', headers: admin, body: JSON.stringify({ orderId: c1.orderId, reason: 'Sandbox full refund test' }) });
assert.equal(r.status, 200, 'full refund ' + JSON.stringify(r.data));
w = await waitOrder(c1.orderId, (o) => o.payment_status === 'refunded' && o.refunded_total === total.amount, 'refunds');
ok(`partial (50p) + remaining refund recorded; order refunded ${w.o.refunded_total}p`);
const sqr = await sq('/v2/refunds?location_id=' + encodeURIComponent(p.data.payment.location_id));
const mine = (sqr.data.refunds || []).filter((x) => x.payment_id === p.data.payment.id);
ok(`Square shows ${mine.length} refunds for the payment: ${mine.map((x) => x.amount_money.amount + 'p ' + x.status).join(', ')}`);

const restore = await site('/api/admin-orders', { method: 'POST', headers: admin, body: JSON.stringify({ sku: 'AIVA-TEST-1GBP', stock: stock0 }) });
assert.equal(restore.status, 200);
ok(`merchant stock update: test stock restored to ${stock0}`);
console.log('\nSQUARE SANDBOX E2E PASSED\n' + results.join('\n'));
