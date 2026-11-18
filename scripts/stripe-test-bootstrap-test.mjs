import assert from 'node:assert/strict';
import { bootstrapStripeTest } from './stripe-test-bootstrap.mjs';

const secret = 'sk_test_BootstrapUnitTestNotACredential';
const signing = 'whsec_BootstrapUnitTestNotACredential';
const token = 'BootstrapUnitTestTokenNotACredential';
const database = '11111111-2222-4333-8444-555555555555';
const sessionId = 'cs_test_BootstrapUnitTest123';
const origin = 'https://stripe-test.aiva-trading.pages.dev';
const env = { APPROVE_STRIPE_TEST_SETUP: 'true', STRIPE_TEST_SECRET_KEY: secret,
  CLOUDFLARE_API_TOKEN: token };

async function run(options = {}) {
  const requests = [], logs = [];
  let deployed = false;
  const pages = { name: 'aiva-trading', subdomain: 'aiva-trading.pages.dev',
    production_branch: options.productionBranch || 'main', deployment_configs: {
      production: { d1_databases: { ORDERS_DB: { id: 'd6791133-c5f2-4209-a9ab-91573e123939' } } },
      preview: { d1_databases: options.unsafeDatabase ? {
        STRIPE_TEST_ORDERS_DB: { id: 'd6791133-c5f2-4209-a9ab-91573e123939' }
      } : options.reuseDatabase ? { STRIPE_TEST_ORDERS_DB: { id: database } } : {} }
    } };
  const cfResult = result => Response.json({ success: true, result });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || 'GET';
    const body = init.body;
    requests.push({ path: url.pathname, method, body });
    if (url.hostname === 'api.cloudflare.com') {
      if (url.pathname.endsWith('/pages/projects/aiva-trading')) return cfResult(pages);
      if (url.pathname.endsWith('/d1/database') && method === 'GET') {
        return options.deniedD1 ? Response.json({ success: false }, { status: 403 }) : cfResult([]);
      }
      if (url.pathname.endsWith('/d1/database') && method === 'POST') return cfResult({ uuid: database });
      if (url.pathname.endsWith('/query')) {
        const parsed = JSON.parse(body);
        return cfResult([{ success: true, results: parsed.params ? [{ payment_status: 'pending' }] : [] }]);
      }
    }
    if (url.hostname === 'api.stripe.com') {
      if (url.pathname === '/v1/account') return options.deniedStripe ?
        Response.json({ error: { message: 'Invalid credential: ' + secret } }, { status: 401 }) :
        Response.json({ id: 'acct_UnitTest' });
      if (url.pathname === '/v1/webhook_endpoints') return Response.json({
        id: 'we_UnitTest', secret: signing, livemode: options.liveHook === true,
        url: origin + '/api/stripe-webhook'
      });
      if (url.pathname.endsWith('/expire')) return Response.json({ id: sessionId, status: 'expired', livemode: false });
      if (url.pathname.includes('/checkout/sessions/')) return Response.json({
        id: sessionId, livemode: false, payment_status: 'unpaid', status: 'open'
      });
    }
    if (url.origin === origin) {
      if (url.pathname === '/api/shop-status') return Response.json({
        ready: true, provider: 'stripe', mode: 'test',
        envFlags: { hasStripeTestKey: true, hasStripeTestDatabase: true }
      });
      if (url.pathname === '/api/create-checkout-session') return Response.json({ orderId: sessionId });
    }
    throw Error('Unexpected unit-test request path.');
  };
  let result, failure;
  try {
    result = await bootstrapStripeTest({ env: { ...env, ...(options.env || {}) },
      fetchImpl, log: message => logs.push(message), wait: async () => {},
      deploy: async childEnv => {
        assert.equal(childEnv.STRIPE_TEST_SECRET_KEY, undefined);
        assert.equal(childEnv.STRIPE_TEST_ORIGIN, origin);
        assert.equal(childEnv.APPROVE_STRIPE_TEST_PREVIEW, 'true');
        deployed = true;
      } });
  } catch (error) { failure = error; }
  assert.ok(!logs.some(line => [secret, signing, token].some(value => line.includes(value))));
  if (failure) assert.ok(![secret, signing, token].some(value => failure.message.includes(value)));
  return { result, failure, requests, deployed };
}
const success = await run();
assert.ifError(success.failure);
assert.equal(success.result.configured, true);
assert.equal(success.result.realSessionCreated, true);
assert.equal(success.result.expiredWebhookVerified, true);
assert.equal(success.result.successfulCardPaymentTested, false);
assert.equal(success.result.declinedCardPaymentTested, false);
assert.equal(success.deployed, true);
for (const request of success.requests.filter(item => item.method === 'PATCH')) {
  const body = JSON.parse(request.body);
  assert.deepEqual(Object.keys(body.deployment_configs), ['preview']);
  const vars = body.deployment_configs.preview.env_vars;
  if (vars) {
    assert.equal(vars.STRIPE_SECRET_KEY.type, 'secret_text');
    assert.equal(vars.STRIPE_WEBHOOK_SECRET.type, 'secret_text');
    assert.equal(vars.STRIPE_MODE.value, 'test');
    assert.equal(vars.STRIPE_LIVE_PAYMENTS_APPROVED.value, 'false');
  }
}
for (const options of [
  { productionBranch: 'stripe-test' }, { unsafeDatabase: true }, { deniedD1: true }, { deniedStripe: true },
  { env: { APPROVE_STRIPE_TEST_SETUP: 'false' } },
  { env: { STRIPE_TEST_SECRET_KEY: 'sk_live_UnitTestNotACredential' } },
  { env: { CLOUDFLARE_ACCOUNT_ID: '00000000000000000000000000000000' } }
]) {
  const stopped = await run(options);
  assert.ok(stopped.failure);
  assert.equal(stopped.requests.some(request => request.method !== 'GET'), false);
  assert.equal(stopped.deployed, false);
}
const missing = await run({ env: { STRIPE_TEST_SECRET_KEY: '' } });
assert.equal(missing.result.configured, false);
assert.equal(missing.requests.length, 0);
const reused = await run({ reuseDatabase: true });
assert.ifError(reused.failure);
assert.equal(reused.requests.some(request => request.path.endsWith('/d1/database') && request.method === 'POST'), false);
const liveHook = await run({ liveHook: true });
assert.ok(liveHook.failure);
assert.equal(liveHook.deployed, false);
assert.equal(liveHook.requests.filter(request => request.method === 'PATCH').length, 1,
  'A live-mode webhook must never be saved as a preview secret.');
console.log('SANDBOX BOOTSTRAP CHECKS PASSED: mocked APIs only; encrypted preview secrets, isolated database, no live settings and honest payment-test status.');
