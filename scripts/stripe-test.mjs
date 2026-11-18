#!/usr/bin/env node
/* Mocked Stripe HTTP; real in-memory SQLite using the existing D1 schema.
   Never reads credentials, contacts Stripe, deploys, or charges money. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  handleCreateCheckout, handleShopStatus, handleOrderStatus, handleStripeWebhook
} from '../functions/_lib/commerce.js';
import { stripeTestCataloguePath } from '../functions/_lib/stripe-test.js';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('data/aiva-products.stripe-test.json', root)));
const publicCatalogue = JSON.parse(readFileSync(new URL('data/aiva-products.json', root)));
const schema = readFileSync(new URL('ORDER-DATABASE-SETUP.sql', root), 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(schema);
let dbFailure = false;
const db = {
  prepare(sql) {
    return { bind(...params) {
      return {
        sql, params,
        first() {
          if (dbFailure) throw Error('simulated database outage');
          return sqlite.prepare(sql).get(...params) || null;
        }
      };
    } };
  },
  batch(statements) {
    if (dbFailure) throw Error('simulated database outage');
    sqlite.exec('BEGIN');
    try {
      for (const { sql, params } of statements) sqlite.prepare(sql).run(...params);
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
};
const base = 'https://stripe-test.aiva-trading.pages.dev';
// Deliberately synthetic credentials for local HMAC verification and HTTP mocks.
const env = {
  CHECKOUT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_syntheticunitfixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_syntheticunitfixture',
  STRIPE_TEST_CHECKOUT_ENABLED: 'true',
  STRIPE_TEST_ORIGIN: base,
  STRIPE_TEST_ORDERS_DB: db,
  ASSETS: { fetch(request) {
    const cat = new URL(request.url).pathname.endsWith('.stripe-test.json') ? fixture : publicCatalogue;
    return new Response(JSON.stringify(cat), { headers: { 'Content-Type': 'application/json' } });
  } }
};
const session = {
  id: 'cs_test_aiva123456789',
  object: 'checkout.session',
  mode: 'payment', livemode: false, currency: 'gbp',
  metadata: { source: 'aivatrading.uk', integration: 'stripe-test-v1' },
  url: 'https://checkout.stripe.com/c/pay/cs_test_aiva123456789',
  payment_status: 'unpaid', status: 'open', amount_total: 100,
  payment_intent: 'pi_synthetictest',
  customer_details: { email: 'unit-test@example.invalid', name: 'Test Fixture' }
};
let current = structuredClone(session);
let calls = [];
let failure = '';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });
  assert.ok(url.startsWith('https://api.stripe.com/v1/checkout/sessions'), 'Unexpected outbound HTTP request');
  if (failure === 'network') throw Error('simulated network outage');
  if (failure === 'http') return new Response('{}', { status: 503 });
  if (failure === 'json') return new Response('not-json', { status: 200 });
  return new Response(JSON.stringify(current), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
function checkout(data = {}, overrides = {}, url = base, headers = {}) {
  return handleCreateCheckout(new Request(url + '/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: url, ...headers },
    body: JSON.stringify({ items: [{ sku: fixture.products[0].sku, quantity: 1 }], ...data })
  }), { ...env, ...overrides });
}
async function signedEvent(event, { timestamp = Math.floor(Date.now() / 1000), raw, extra = '', bad = false } = {}) {
  const body = raw ?? JSON.stringify(event);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + '.' + body)));
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return new Request(base + '/api/stripe-webhook', {
    method: 'POST', body,
    headers: { 'Stripe-Signature': `t=${timestamp},v1=${bad ? '0'.repeat(64) : hex}${extra}` }
  });
}
const event = (id = 'evt_aiva01', type = 'checkout.session.completed') => ({
  id, type, livemode: false, data: { object: structuredClone(session) }
});
const tests = [];
const test = (name, run) => tests.push([name, run]);

test('readiness and catalogue routing are preview-only', async () => {
  const status = await (await handleShopStatus(new Request(base + '/api/shop-status'), env)).json();
  assert.equal(status.ready, true);
  assert.equal(status.provider, 'stripe');
  assert.equal(status.mode, 'test');
  assert.deepEqual(status.providers, ['stripe']);
  assert.equal(status.cataloguePath, '/data/aiva-products.stripe-test.json');
  for (const url of ['https://aivatrading.uk', 'https://app.aivatrading.uk', 'https://other.pages.dev']) {
    assert.equal(stripeTestCataloguePath(new Request(url), env), '/data/aiva-products.json');
    assert.equal((await checkout({}, {}, url)).status, 503);
  }
  assert.equal(stripeTestCataloguePath(new Request(base), { ...env, STRIPE_TEST_CHECKOUT_ENABLED: 'false' }), '/data/aiva-products.json');
  assert.equal(stripeTestCataloguePath(new Request(base), { ...env, STRIPE_TEST_ORIGIN: 'https://aivatrading.uk' }), '/data/aiva-products.json');
  assert.equal(stripeTestCataloguePath(new Request(base), { ...env, STRIPE_TEST_ORIGIN: 'not-a-url' }), '/data/aiva-products.json');
  assert.equal(stripeTestCataloguePath(new Request('http://127.0.0.1:8788'), {
    ...env, STRIPE_TEST_ORIGIN: 'http://127.0.0.1:8788'
  }), '/data/aiva-products.stripe-test.json');
});
test('creates hosted test Checkout with authoritative pence and safe return URLs', async () => {
  calls = [];
  const response = await checkout({ pricePence: 1, total: 1, success_url: 'https://untrusted.invalid' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.provider, 'stripe');
  assert.equal(body.orderId, session.id);
  const sent = new URLSearchParams(calls[0].init.body);
  assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '100');
  assert.equal(sent.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '0');
  assert.equal(sent.get('success_url'), base + '/order-success.html?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(sent.get('cancel_url'), base + '/shop.html?cancelled=1#aiva-basket');
  assert.equal(sent.get('shipping_address_collection[allowed_countries][0]'), 'GB');
  assert.equal(sent.get('payment_method_types[0]'), 'card');
  assert.ok(calls[0].init.headers['Idempotency-Key']);
  assert.ok(calls[0].init.signal);
});
test('live keys, missing keys, database and webhook secret fail closed', async () => {
  calls = [];
  for (const override of [
    { STRIPE_SECRET_KEY: '' },
    { STRIPE_SECRET_KEY: 'sk_live_syntheticnotreal' },
    { STRIPE_SECRET_KEY: 'rk_live_syntheticnotreal' },
    { STRIPE_TEST_ORDERS_DB: null },
    { STRIPE_WEBHOOK_SECRET: '' }
  ]) assert.equal((await checkout({}, override)).status, 503);
  assert.equal(calls.length, 0);
});
test('Stripe selection cannot fall back to Square or PayPal', async () => {
  const legacy = { SQUARE_ACCESS_TOKEN: 'synthetic', SQUARE_LOCATION_ID: 'LOC', SQUARE_ENVIRONMENT: 'production' };
  assert.equal((await checkout({ provider: 'square' }, legacy)).status, 400);
  assert.equal((await checkout({ provider: 'paypal' }, legacy)).status, 400);
  assert.equal((await checkout({}, { ...legacy, STRIPE_SECRET_KEY: '' })).status, 503);
});
test('invalid quantities, duplicates, unknown items and foreign origins are rejected', async () => {
  for (const items of [
    [], [{ sku: 'DOES-NOT-EXIST', quantity: 1 }],
    [{ sku: fixture.products[0].sku, quantity: -1 }],
    [{ sku: fixture.products[0].sku, quantity: 11 }],
    [{ sku: fixture.products[0].sku, quantity: 1.5 }],
    [{ sku: fixture.products[0].sku, quantity: 1 }, { sku: fixture.products[0].sku, quantity: 1 }]
  ]) assert.equal((await checkout({ items })).status, 400);
  assert.equal((await checkout({}, {}, base, { Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await checkout({}, {}, base, { 'Content-Type': 'text/plain' })).status, 415);
});
test('unsafe hosted checkout URLs and live responses are rejected', async () => {
  for (const url of ['http://checkout.stripe.com/c/pay/x', 'https://checkout.stripe.com.evil.invalid/c/pay/x',
    'https://evil.invalid/c/pay/x', 'https://user@checkout.stripe.com/c/pay/x', 'https://checkout.stripe.com/not-checkout']) {
    current = { ...session, url };
    assert.equal((await checkout()).status, 502);
  }
  current = { ...session, livemode: true };
  assert.equal((await checkout()).status, 502);
  current = structuredClone(session);
});
test('Stripe HTTP, malformed JSON and network failures return controlled errors', async () => {
  for (const kind of ['http', 'json', 'network']) {
    failure = kind;
    assert.equal((await checkout()).status, 502);
  }
  failure = '';
});
test('order status verifies payment_status, not the success redirect', async () => {
  const request = () => new Request(base + '/api/order-status?session_id=' + session.id);
  let result = await (await handleOrderStatus(request(), env)).json();
  assert.equal(result.paid, false);
  current = { ...session, status: 'complete', payment_status: 'unpaid' };
  assert.equal((await (await handleOrderStatus(request(), env)).json()).paid, false);
  current = { ...session, status: 'complete', payment_status: 'paid' };
  result = await (await handleOrderStatus(request(), env)).json();
  assert.equal(result.paid, true);
  assert.equal(result.mode, 'test');
  assert.equal(Object.hasOwn(result, 'customer_details'), false);
  assert.equal((await handleOrderStatus(new Request(base + '/api/order-status?session_id=cs_live_synthetic'), env)).status, 400);
  current = { ...session, metadata: { source: 'different-site' } };
  assert.equal((await handleOrderStatus(request(), env)).status, 404);
  current = structuredClone(session);
});
test('webhook rejects unsigned, bad, stale, future and oversized payloads', async () => {
  assert.equal((await handleStripeWebhook(new Request(base, { method: 'POST', body: '{}' }), env)).status, 400);
  for (const options of [
    // Keep well outside the tolerance: a busy runner can pause between signing
    // and verification and make a +301s timestamp valid by the time it is checked.
    { bad: true }, { timestamp: Math.floor(Date.now() / 1000) - 3600 },
    { timestamp: Math.floor(Date.now() / 1000) + 3600 }
  ]) assert.equal((await handleStripeWebhook(await signedEvent(event(), options), env)).status, 400);
  assert.equal((await handleStripeWebhook(await signedEvent(event(), { raw: 'x'.repeat(128001) }), env)).status, 413);
  assert.equal((await handleStripeWebhook(await signedEvent(event(), { raw: 'invalid-json' }), env)).status, 400);
  assert.equal((await handleStripeWebhook(new Request(base), env)).status, 405);
});
test('webhook ignores foreign orders and rejects live events', async () => {
  const live = event();
  live.livemode = true;
  assert.equal((await handleStripeWebhook(await signedEvent(live), env)).status, 400);
  const foreign = event();
  foreign.data.object.metadata.source = 'different-site';
  assert.equal((await (await handleStripeWebhook(await signedEvent(foreign), env)).json()).ignored, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
});
test('signed paid event saves a test order atomically in real SQLite', async () => {
  current = { ...session, payment_status: 'paid', status: 'complete' };
  const response = await handleStripeWebhook(await signedEvent(event(), { extra: ',v1=' + '0'.repeat(64) + ',unknown=ignored' }), env);
  assert.equal(response.status, 200);
  const row = sqlite.prepare('SELECT * FROM orders').get();
  assert.equal(row.session_id, session.id);
  assert.equal(row.payment_status, 'paid');
  assert.equal(row.amount_total, 100);
  assert.equal(row.currency, 'gbp');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payment_events').get().n, 1);
});
test('redelivery is idempotent and avoids additional Stripe reads', async () => {
  calls = [];
  const response = await handleStripeWebhook(await signedEvent(event()), env);
  assert.equal((await response.json()).duplicate, true);
  assert.equal(calls.length, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
});
test('out-of-order failure cannot undo a paid order', async () => {
  current = { ...session, payment_status: 'unpaid' };
  const response = await handleStripeWebhook(await signedEvent(event('evt_latefailed', 'checkout.session.async_payment_failed')), env);
  assert.equal(response.status, 200);
  assert.equal(sqlite.prepare('SELECT payment_status FROM orders').get().payment_status, 'paid');
});
test('database outage remains retryable without recording the event', async () => {
  dbFailure = true;
  const response = await handleStripeWebhook(await signedEvent(event('evt_retry')), env);
  assert.equal(response.status, 503);
  dbFailure = false;
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE event_id='evt_retry'").get().n, 0);
  assert.equal((await handleStripeWebhook(await signedEvent(event('evt_retry')), env)).status, 200);
});
test('Stripe lookup failure remains retryable without consuming the event', async () => {
  failure = 'http';
  assert.equal((await handleStripeWebhook(await signedEvent(event('evt_lookupretry')), env)).status, 503);
  failure = '';
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE event_id='evt_lookupretry'").get().n, 0);
  assert.equal((await handleStripeWebhook(await signedEvent(event('evt_lookupretry')), env)).status, 200);
});
test('transaction rollback leaves no event marker when order persistence fails', async () => {
  sqlite.exec("CREATE TRIGGER reject_order BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT,'simulated write outage'); END;");
  assert.equal((await handleStripeWebhook(await signedEvent(event('evt_atomicretry')), env)).status, 503);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE event_id='evt_atomicretry'").get().n, 0);
  sqlite.exec('DROP TRIGGER reject_order');
  assert.equal((await handleStripeWebhook(await signedEvent(event('evt_atomicretry')), env)).status, 200);
});
test('test fixtures cannot be charged through legacy live providers', async () => {
  const legacy = {
    CHECKOUT_PROVIDER: '', STRIPE_SECRET_KEY: '', SQUARE_ENVIRONMENT: 'production',
    SQUARE_ACCESS_TOKEN: 'synthetic', SQUARE_LOCATION_ID: 'LOC',
    SQUARE_WEBHOOK_SIGNATURE_KEY: 'syntheticwebhooksecret',
    ORDERS_DB: db, ASSETS: { fetch() { return new Response(JSON.stringify(fixture)); } }
  };
  assert.equal((await checkout({ provider: 'square' }, legacy)).status, 503);
  const status = await (await handleShopStatus(new Request(base), { ...env, ...legacy })).json();
  assert.equal(status.ready, false);
});

try {
  for (const [name, run] of tests) {
    await run();
    console.log('PASS:', name);
  }
  console.log(`${tests.length} STRIPE TEST GROUPS PASSED — mocked HTTP, real SQLite; no hosted payment was run.`);
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
}
