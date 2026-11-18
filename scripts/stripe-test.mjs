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
import { CURRENCIES, currencyCode, normaliseCatalogue, minorFromMajor, formatMoney } from '../assets/aiva-money.js';
import { readLimitedText, BodyTooLarge } from '../functions/_lib/body.js';

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
  if (url.includes('/line_items?')) return new Response(JSON.stringify({
    data: [{ description: 'Test fixture', quantity: 1, amount_total: 100, currency: current.currency,
      price: { product: { metadata: { sku: fixture.products[0].sku } } } }], has_more: false
  }));
  return new Response(JSON.stringify(current), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
function checkout(data = {}, overrides = {}, url = base, headers = {}) {
  return handleCreateCheckout(new Request(url + '/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: url, ...headers },
    body: JSON.stringify({ items: [{ sku: fixture.products[0].sku, quantity: 1 }], ...data })
  }), { ...env, ...overrides });
}
async function signedEvent(event, { timestamp = Math.floor(Date.now() / 1000), raw, extra = '', bad = false,
  secret = env.STRIPE_WEBHOOK_SECRET, origin = base } = {}) {
  const body = raw ?? JSON.stringify(event);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + '.' + body)));
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return new Request(origin + '/api/stripe-webhook', {
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
  assert.equal(sent.get('cancel_url'), base + '/order-cancelled.html');
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
  assert.equal(JSON.parse(row.line_items_json)[0].quantity, 1);
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

test('currency helpers use exact integer minor units, including zero-decimal JPY', async () => {
  assert.equal(Object.keys(CURRENCIES).length, 16);
  assert.equal(currencyCode('eur'), 'EUR');
  assert.equal(currencyCode('XXX'), '');
  assert.equal(minorFromMajor('12.34', 'EUR'), 1234);
  assert.equal(minorFromMajor('12', 'JPY'), 12);
  assert.equal(minorFromMajor('0.10', 'GBP'), 10);
  assert.ok(Number.isNaN(minorFromMajor('1.005', 'USD')));
  assert.ok(Number.isNaN(minorFromMajor('1.5', 'JPY')));
  assert.ok(Number.isNaN(minorFromMajor('1e3', 'GBP')));
  assert.ok(Number.isNaN(minorFromMajor('-1', 'GBP')));
  assert.match(formatMoney(100, 'JPY'), /100/);
  assert.doesNotMatch(formatMoney(100, 'JPY'), /1\.00/);
});
test('non-GBP prices cannot silently reuse legacy pence or mix currencies', async () => {
  const cat = normaliseCatalogue({
    ...fixture, currency: 'EUR',
    products: [{ ...fixture.products[0], currency: 'USD', priceMinor: 100 }],
    shipping: { allowedCountries: ['GB'], flatRateMinor: 0 }
  });
  assert.equal(cat.products[0].available, false);
  assert.equal(normaliseCatalogue({ ...fixture, currency: 'JPY' }).products[0].pricePence, null);
  assert.throws(() => normaliseCatalogue({ ...fixture, currency: 'INVALID' }));
});
test('Stripe uses server-side EUR and JPY minor units without exchange conversion', async () => {
  for (const currency of ['EUR', 'JPY']) {
    const cat = {
      ...fixture, currency,
      products: [{ ...fixture.products[0], priceMinor: 1250 }],
      shipping: { allowedCountries: ['GB'], flatRateMinor: 50, freeShippingThresholdMinor: null }
    };
    current = { ...session, currency: currency.toLowerCase(), amount_total: 1300 };
    calls = [];
    const response = await checkout({}, { ASSETS: { fetch() { return new Response(JSON.stringify(cat)); } } });
    assert.equal(response.status, 200);
    const sent = new URLSearchParams(calls[0].init.body);
    assert.equal(sent.get('line_items[0][price_data][currency]'), currency.toLowerCase());
    assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '1250');
    assert.equal(sent.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '50');
  }
  current = structuredClone(session);
});
test('oversized request body is rejected even without Content-Length', async () => {
  calls = [];
  assert.equal((await checkout({ padding: 'x'.repeat(9000) })).status, 413);
  assert.equal(calls.length, 0);
});
test('streaming body limit cancels oversized input despite a false length header', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(9000)); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(() => readLimitedText(new Request(base, {
    method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Length': '0' }
  }), 8192), BodyTooLarge);
  assert.equal(cancelled, true);
});
test('bounded UTF-8 reads preserve raw signature text across byte boundaries', async () => {
  const bytes = new TextEncoder().encode('é');
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 1)); controller.enqueue(bytes.slice(1)); controller.close();
  } });
  assert.equal(await readLimitedText(new Request(base, {
    method: 'POST', body: stream, duplex: 'half'
  }), 2), 'é');
  await assert.rejects(() => readLimitedText(new Request(base, { method: 'POST', body: 'éé' }), 3), BodyTooLarge);
});

const liveSqlite = new DatabaseSync(':memory:');
liveSqlite.exec(schema);
const liveDb = {
  prepare(sql) {
    return { bind(...params) { return { sql, params, first() { return liveSqlite.prepare(sql).get(...params); } }; } };
  },
  batch(statements) {
    liveSqlite.exec('BEGIN');
    try {
      for (const { sql, params } of statements) liveSqlite.prepare(sql).run(...params);
      liveSqlite.exec('COMMIT');
    } catch (error) { liveSqlite.exec('ROLLBACK'); throw error; }
  }
};
const liveOrigin = 'https://aivatrading.uk';
const liveCat = { ...fixture, testOnly: false };
const liveEnv = {
  STRIPE_MODE: 'live', STRIPE_LIVE_PAYMENTS_APPROVED: 'true',
  STRIPE_LIVE_SECRET_KEY: 'sk_live_syntheticunitfixture',
  STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_syntheticlivefixture',
  STRIPE_LIVE_ORDERS_DB: liveDb, STRIPE_LIVE_ORIGIN: liveOrigin,
  ASSETS: { fetch() { return new Response(JSON.stringify(liveCat)); } }
};
const liveSession = {
  ...session, id: 'cs_live_synthetic123456', livemode: true,
  metadata: { source: 'aivatrading.uk', integration: 'stripe-live-v1' },
  url: 'https://checkout.stripe.com/c/pay/cs_live_synthetic123456',
  shipping_details: { name: 'Synthetic fixture', address: { country: 'GB' } }
};
const accountReady = {
  object: 'account', charges_enabled: true, payouts_enabled: true,
  details_submitted: true, capabilities: { card_payments: 'active' }
};
let account = accountReady;
let liveReads = [];
const stripeMock = globalThis.fetch;
const liveMock = async (input, init = {}) => {
  const url = String(input);
  assert.ok(url.startsWith('https://api.stripe.com/v1/'), 'Unexpected live-test HTTP destination');
  liveReads.push({ url, init });
  if (url.endsWith('/account')) return new Response(JSON.stringify(account));
  if (url.includes('/line_items?')) return new Response(JSON.stringify({
    data: [{ description: 'Synthetic live-path fixture', quantity: 1, amount_total: 100, currency: 'gbp',
      price: { product: { metadata: { sku: 'SYNTHETIC-ONLY' } } } }], has_more: false
  }));
  return new Response(JSON.stringify(liveSession));
};
test('live approval, mode, separate secrets and separate database all fail closed by default', async () => {
  globalThis.fetch = liveMock;
  liveReads = [];
  for (const overrides of [
    { STRIPE_LIVE_PAYMENTS_APPROVED: 'false' }, { STRIPE_LIVE_PAYMENTS_APPROVED: '' },
    { STRIPE_LIVE_SECRET_KEY: '' }, { STRIPE_LIVE_WEBHOOK_SECRET: '' },
    { STRIPE_LIVE_ORDERS_DB: null }, { STRIPE_LIVE_ORDERS_DB: db },
    { STRIPE_LIVE_SECRET_KEY: 'sk_test_syntheticfixture' }, { STRIPE_MODE: 'production' }
  ]) assert.equal((await checkout({}, { ...liveEnv, ...overrides }, liveOrigin)).status, 503);
  assert.equal(liveReads.length, 0);
});
test('fully configured live path still refuses preview origins and arbitrary origins', async () => {
  liveReads = [];
  assert.equal((await checkout({}, liveEnv, base)).status, 503);
  assert.equal((await checkout({}, { ...liveEnv, STRIPE_LIVE_ORIGIN: 'https://foreign.invalid' }, liveOrigin)).status, 503);
  assert.equal(liveReads.length, 0);
});
test('live mode can never select the temporary test fixture', async () => {
  assert.equal(stripeTestCataloguePath(new Request(base), { ...env, ...liveEnv }), '/data/aiva-products.json');
  liveReads = [];
  assert.equal((await checkout({}, {
    ...liveEnv, ASSETS: { fetch() { return new Response(JSON.stringify(fixture)); } }
  }, liveOrigin)).status, 503);
  assert.equal(liveReads.length, 0);
});
test('unapproved Stripe account states cannot create a live Checkout Session', async () => {
  for (const change of [
    { charges_enabled: false }, { payouts_enabled: false },
    { details_submitted: false }, { capabilities: { card_payments: 'pending' } }
  ]) {
    account = { ...accountReady, ...change };
    liveReads = [];
    assert.equal((await checkout({}, liveEnv, liveOrigin)).status, 503);
    assert.ok(liveReads.every(call => call.url.endsWith('/account')));
  }
  account = accountReady;
});
test('synthetic approved live path creates card Checkout with independent live metadata', async () => {
  liveReads = [];
  const response = await checkout({}, liveEnv, liveOrigin);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, 'live');
  const request = liveReads.find(call => call.init.method === 'POST');
  const body = new URLSearchParams(request.init.body);
  assert.equal(body.get('payment_method_types[0]'), 'card');
  assert.equal(body.get('metadata[integration]'), 'stripe-live-v1');
  assert.equal(body.get('custom_text[submit][message]'), null);
  assert.equal(body.get('cancel_url'), liveOrigin + '/order-cancelled.html');
});
test('live session verification does not confuse test references with real ones', async () => {
  const ready = { ...env, ...liveEnv };
  const response = await handleOrderStatus(new Request(liveOrigin + '/api/order-status?session_id=' + liveSession.id), ready);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, 'live');
  assert.equal((await handleOrderStatus(new Request(liveOrigin + '/api/order-status?session_id=' + session.id), ready)).status, 400);
});
test('live webhook persistence is separate and includes product and shipping details', async () => {
  liveSession.payment_status = 'paid';
  liveSession.status = 'complete';
  const ready = { ...env, ...liveEnv };
  const e = {
    id: 'evt_syntheticlive01', type: 'checkout.session.completed', livemode: true,
    data: { object: { ...liveSession, payment_status: 'paid' } }
  };
  const countBefore = sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const request = await signedEvent(e, { secret: liveEnv.STRIPE_LIVE_WEBHOOK_SECRET, origin: liveOrigin });
  const response = await handleStripeWebhook(request, ready);
  assert.equal(response.status, 200);
  const row = liveSqlite.prepare('SELECT * FROM orders').get();
  assert.equal(row.session_id, liveSession.id);
  assert.equal(row.payment_status, 'paid');
  assert.equal(JSON.parse(row.shipping_details_json).address.country, 'GB');
  assert.equal(JSON.parse(row.line_items_json)[0].sku, 'SYNTHETIC-ONLY');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n, countBefore);
});
test('test events cannot enter the live database and live webhooks refuse preview origins', async () => {
  const ready = { ...env, ...liveEnv };
  assert.equal((await handleStripeWebhook(await signedEvent(event(), {
    secret: liveEnv.STRIPE_LIVE_WEBHOOK_SECRET, origin: liveOrigin
  }), ready)).status, 400);
  assert.equal((await handleStripeWebhook(await signedEvent(event(), {
    secret: liveEnv.STRIPE_LIVE_WEBHOOK_SECRET, origin: base
  }), ready)).status, 503);
  globalThis.fetch = stripeMock;
});

try {
  for (const [name, run] of tests) {
    await run();
    console.log('PASS:', name);
  }
  console.log(`${tests.length} PAYMENT TEST GROUPS PASSED — all test/live HTTP mocked, real isolated SQLite; no payment was run.`);
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  liveSqlite.close();
}
