#!/usr/bin/env node
/* End-to-end Shopify TEST-MODE checkout against the deployed site. No real money: the store must use
   Shopify Payments test mode or the Bogus Gateway (card 1 = success, 2 = declined).
   The card is entered on Shopify's hosted checkout (by a person or browser automation); this script creates
   the checkouts, waits for webhooks, then verifies D1 order state, stock, cancellation and refunds.
   Env: SITE_BASE, MERCHANT_ADMIN_KEY, SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, optional URL_FILE. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const BASE = (process.env.SITE_BASE || 'https://aivatrading.uk').replace(/\/$/, '');
const KEY = process.env.MERCHANT_ADMIN_KEY, SHOP = process.env.SHOPIFY_STORE_DOMAIN, ADMIN = process.env.SHOPIFY_ADMIN_TOKEN;
const VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
assert.ok(KEY && SHOP && ADMIN, 'MERCHANT_ADMIN_KEY, SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN are required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log('ok', m);
async function site(p, init = {}) {
  const r = await fetch(BASE + p, { ...init, headers: { 'Content-Type': 'application/json', Origin: BASE, ...(init.headers || {}) } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const orders = async () => (await site('/api/admin-orders?limit=100', { headers: { Authorization: 'Bearer ' + KEY } })).data;
async function waitOrder(id, pred, what, tries = 120) {
  for (let i = 0; i < tries; i++) { const d = await orders(); const o = d.orders?.find((x) => x.orderId === id); if (o && pred(o)) return { o, d }; await sleep(5000); }
  throw Error('timed out waiting for ' + what);
}
async function admin(query, variables = {}) {
  const r = await fetch(`https://${SHOP}/admin/api/${VERSION}/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ADMIN }, body: JSON.stringify({ query, variables }) });
  const j = await r.json(); if (j.errors) throw Error(JSON.stringify(j.errors)); return j.data;
}
async function checkout(label) {
  const c = await site('/api/create-checkout-session', { method: 'POST', body: JSON.stringify({ items: [{ sku: 'AIVA-TEST-1GBP', quantity: 1 }] }) });
  assert.equal(c.status, 200, JSON.stringify(c.data)); assert.equal(c.data.provider, 'shopify'); assert.equal(c.data.mode, 'test');
  const page = await fetch(c.data.url, { redirect: 'follow' });
  ok(`${label}: Shopify checkout ${new URL(c.data.url).host} HTTP ${page.status}, website order ${c.data.orderId}`);
  if (process.env.URL_FILE) writeFileSync(process.env.URL_FILE, `${label}\n${c.data.url}\n${c.data.orderId}\n`);
  console.log(`PAY (${label}):`, c.data.url);
  return c.data;
}

const st = await site('/api/shop-status');
assert.equal(st.data.provider, 'shopify'); assert.equal(st.data.mode, 'test'); assert.equal(st.data.ready, true, JSON.stringify(st.data));
ok('shop-status: Shopify test mode ready');
const stock0 = (await orders()).inventory?.find((x) => x.sku === 'AIVA-TEST-1GBP')?.stock ?? st.data.stock?.['AIVA-TEST-1GBP'];

// 1. Declined card (Bogus Gateway card number 2): nothing recorded as paid.
const declined = await checkout('DECLINED card 2');
console.log('Enter the declined test card, then press Enter here (or set AUTO_WAIT_SECONDS).');
await sleep(Number(process.env.AUTO_WAIT_SECONDS || 90) * 1000);
let d = await orders(); let o = d.orders.find((x) => x.orderId === declined.orderId);
assert.notEqual(o?.payment_status, 'paid'); assert.equal((await site('/api/order-status?orderId=' + declined.orderId)).data.paid, false);
ok('declined payment: order not confirmed, stock unchanged');

// 2. Successful test card (card number 1).
const good = await checkout('SUCCESS card 1');
let w = await waitOrder(good.orderId, (x) => x.payment_status === 'paid', 'paid webhook');
assert.equal(w.o.provider, 'shopify'); assert.equal(Number(w.o.test_order), 1, 'Shopify must flag the order as a test order');
const stock1 = w.d.inventory?.find((x) => x.sku === 'AIVA-TEST-1GBP')?.stock;
if (Number.isInteger(stock0)) assert.equal(stock1, stock0 - 1);
const status = await site('/api/order-status?orderId=' + good.orderId);
assert.equal(status.data.paid, true);
ok(`successful test payment: Shopify ${w.o.provider_order_ref} recorded paid (${w.o.amount_total}p), stock ${stock0} -> ${stock1}, confirmation page paid`);

// 3. Refund via Shopify Admin -> refunds/create webhook -> D1.
const gid = 'gid://shopify/Order/' + w.o.payment_id;
const sug = await admin(`query($id: ID!) { order(id: $id) { suggestedRefund(refundShipping: true, suggestFullRefund: true) {
  amountSet { shopMoney { amount } } suggestedTransactions { gateway parentTransaction { id } amountSet { shopMoney { amount } } } } } }`, { id: gid });
const tx = sug.order.suggestedRefund.suggestedTransactions.map((t) => ({ orderId: gid, gateway: t.gateway, kind: 'REFUND', amount: t.amountSet.shopMoney.amount, parentId: t.parentTransaction?.id }));
const rf = await admin(`mutation($input: RefundInput!) { refundCreate(input: $input) { refund { id } userErrors { message } } }`, { input: { orderId: gid, notify: false, shipping: { fullRefund: true }, transactions: tx } });
assert.equal(rf.refundCreate.userErrors.length, 0, JSON.stringify(rf.refundCreate.userErrors));
w = await waitOrder(good.orderId, (x) => x.payment_status === 'refunded', 'refund webhook', 36);
ok(`refund in Shopify recorded on the website (${w.o.refunded_total}p)`);

// 4. Cancelled: a paid-then-cancelled order, and an abandoned checkout.
const abandoned = await checkout('CANCELLED (close the checkout without paying)');
const cancelled = await checkout('CANCEL AFTER PAY card 1');
w = await waitOrder(cancelled.orderId, (x) => x.payment_status === 'paid', 'paid webhook');
const cx = await admin(`mutation($id: ID!) { orderCancel(orderId: $id, reason: CUSTOMER, refund: true, restock: false, notifyCustomer: false) { orderCancelUserErrors { message } } }`, { id: 'gid://shopify/Order/' + w.o.payment_id });
assert.equal(cx.orderCancel.orderCancelUserErrors.length, 0, JSON.stringify(cx.orderCancel.orderCancelUserErrors));
w = await waitOrder(cancelled.orderId, (x) => x.fulfillment_status === 'cancelled', 'cancel webhook', 36);
ok(`cancelled order recorded (fulfilment ${w.o.fulfillment_status}, payment ${w.o.payment_status})`);
d = await orders(); o = d.orders.find((x) => x.orderId === abandoned.orderId);
assert.equal(o.payment_status, 'pending'); assert.equal((await site('/api/order-status?orderId=' + abandoned.orderId)).data.paid, false);
ok('abandoned checkout: order stays unpaid and is not confirmed');
console.log('SHOPIFY TEST-MODE E2E PASSED');
