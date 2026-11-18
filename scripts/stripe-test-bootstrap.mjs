#!/usr/bin/env node
// Existing-project sandbox setup only. Never print provider payloads or credentials.
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ACCOUNT = 'b2c18cf1451c6d64889a0b1f6e885f33';
const PROJECT = 'aiva-trading';
const SQUARE_DATABASE = 'd6791133-c5f2-4209-a9ab-91573e123939';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const schema = readFileSync(new URL('../ORDER-DATABASE-SETUP.sql', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('../data/aiva-products.stripe-test.json', import.meta.url), 'utf8'));

export async function bootstrapStripeTest({
  env = process.env, fetchImpl = fetch, log = console.log,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  deploy = async deploymentEnv => {
    const child = spawnSync(process.execPath, ['scripts/stripe-test-preview.mjs'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: deploymentEnv, stdio: 'inherit'
    });
    if (child.error || child.status !== 0) throw Error('Isolated Stripe preview deployment failed.');
  }
} = {}) {
  env = { ...env,
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN?.trim(),
    STRIPE_TEST_SECRET_KEY: env.STRIPE_TEST_SECRET_KEY?.trim() };
  if (env.APPROVE_STRIPE_TEST_SETUP !== 'true') throw Error('Sandbox setup requires its explicit approval flag.');
  const missing = ['CLOUDFLARE_API_TOKEN', 'STRIPE_TEST_SECRET_KEY'].filter(key => !env[key]);
  if (missing.length) {
    log('SETUP NOT RUN: missing encrypted GitHub secret names: ' + missing.join(', ') +
      '. No hosted payment has been tested.');
    return { configured: false, missing };
  }
  if (!/^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_TEST_SECRET_KEY)) {
    throw Error('Only a standard Stripe test-mode secret key is accepted. No changes made.');
  }
  const account = env.CLOUDFLARE_ACCOUNT_ID || ACCOUNT;
  if (account !== ACCOUNT) throw Error('This setup is restricted to the existing Aiva Cloudflare account.');

  async function jsonRequest(url, options, provider) {
    let response, payload;
    try {
      response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) });
      payload = await response.json();
    } catch { throw Error(provider + ' request or response failed. No credential values are logged.'); }
    if (!response.ok || (provider === 'Cloudflare' && payload.success !== true)) {
      throw Error(provider + ' request rejected (HTTP ' + response.status + '). Check account permissions and encrypted credentials.');
    }
    return provider === 'Cloudflare' ? payload.result : payload;
  }
  const cf = (path, method = 'GET', body) => jsonRequest(
    'https://api.cloudflare.com/client/v4/accounts/' + account + path, {
      method, headers: { Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN,
        'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
    }, 'Cloudflare');
  const stripe = (path, method = 'GET', body, idempotency) => jsonRequest(
    'https://api.stripe.com/v1' + path, {
      method, headers: { Authorization: 'Bearer ' + env.STRIPE_TEST_SECRET_KEY,
        'Stripe-Version': '2025-02-24.acacia', ...(body ? {
          'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) },
      ...(body ? { body: new URLSearchParams(body).toString() } : {})
    }, 'Stripe');

  // All authorization/readiness checks run before creating any resource.
  const pages = await cf('/pages/projects/' + PROJECT);
  if (pages?.name !== PROJECT || !pages.production_branch || pages.production_branch === 'stripe-test' ||
      pages.subdomain !== 'aiva-trading.pages.dev') {
    throw Error('Cannot prove the selected target is the existing, non-production Pages preview.');
  }
  const origin = 'https://stripe-test.' + pages.subdomain;
  const preview = pages.deployment_configs?.preview || {};
  const protectedIds = new Set([SQUARE_DATABASE,
    ...Object.values(pages.deployment_configs?.production?.d1_databases || {}).map(binding => binding?.id),
    preview.d1_databases?.ORDERS_DB?.id].filter(Boolean));
  let databaseId = preview.d1_databases?.STRIPE_TEST_ORDERS_DB?.id;
  if (databaseId && (!uuid.test(databaseId) || protectedIds.has(databaseId))) {
    throw Error('Refusing to use an existing production or Square database for Stripe tests.');
  }
  await cf('/d1/database'); // Permission preflight, before Stripe/webhook/database writes.
  const stripeAccount = await stripe('/account');
  if (!/^acct_[A-Za-z0-9]+$/.test(stripeAccount?.id || '')) {
    throw Error('Stripe test account verification failed.');
  }
  if (!databaseId) {
    const created = await cf('/d1/database', 'POST', {
      name: 'aiva_stripe_test_orders_' + randomUUID().replaceAll('-', '').slice(0, 8)
    });
    databaseId = created?.uuid;
    if (!uuid.test(databaseId || '') || protectedIds.has(databaseId)) {
      throw Error('Cloudflare did not return an isolated test database.');
    }
    // Record the isolated binding immediately, so a retry can reuse it safely.
    await cf('/pages/projects/' + PROJECT, 'PATCH', { deployment_configs: { preview: {
      d1_databases: { ...(preview.d1_databases || {}), STRIPE_TEST_ORDERS_DB: { id: databaseId } }
    } } });
  }
  const migrated = await cf('/d1/database/' + databaseId + '/query', 'POST', { sql: schema });
  if (!Array.isArray(migrated) || !migrated.length || migrated.some(result => result.success !== true)) {
    throw Error('Dedicated test database schema verification failed.');
  }
  const webhookUrl = origin + '/api/stripe-webhook';
  const webhookBody = { url: webhookUrl, api_version: '2025-02-24.acacia',
    'metadata[aiva_integration]': 'aiva-trading-test-v1',
    'enabled_events[0]': 'checkout.session.completed',
    'enabled_events[1]': 'checkout.session.async_payment_succeeded',
    'enabled_events[2]': 'checkout.session.async_payment_failed',
    'enabled_events[3]': 'checkout.session.expired' };
  const day = Math.floor(Date.now() / 86400000);
  const idempotency = 'aiva-test-webhook-' + createHash('sha256').update(origin).digest('hex').slice(0, 20) + '-' + day;
  const hook = await stripe('/webhook_endpoints', 'POST', webhookBody, idempotency);
  if (hook?.livemode !== false || !/^we_[A-Za-z0-9]+$/.test(hook?.id || '') ||
      !/^whsec_[A-Za-z0-9]+$/.test(hook?.secret || '') || hook.url !== webhookUrl) {
    throw Error('Stripe did not return a valid, test-only webhook endpoint.');
  }
  await cf('/pages/projects/' + PROJECT, 'PATCH', { deployment_configs: { preview: {
    env_vars: {
      STRIPE_SECRET_KEY: { type: 'secret_text', value: env.STRIPE_TEST_SECRET_KEY },
      STRIPE_WEBHOOK_SECRET: { type: 'secret_text', value: hook.secret },
      CHECKOUT_PROVIDER: { type: 'plain_text', value: 'stripe' },
      STRIPE_MODE: { type: 'plain_text', value: 'test' },
      STRIPE_LIVE_PAYMENTS_APPROVED: { type: 'plain_text', value: 'false' },
      STRIPE_TEST_CHECKOUT_ENABLED: { type: 'plain_text', value: 'true' },
      STRIPE_TEST_ORIGIN: { type: 'plain_text', value: origin }
    },
    d1_databases: { ...(preview.d1_databases || {}), STRIPE_TEST_ORDERS_DB: { id: databaseId } }
  } } });
  const deploymentEnv = { ...env, CLOUDFLARE_ACCOUNT_ID: account,
    APPROVE_STRIPE_TEST_PREVIEW: 'true', STRIPE_TEST_ORIGIN: origin,
    STRIPE_TEST_ORDERS_DB_ID: databaseId };
  delete deploymentEnv.STRIPE_TEST_SECRET_KEY; // The deploy child only needs Cloudflare authentication.
  await deploy(deploymentEnv);
  let ready = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const r = await fetchImpl(origin + '/api/shop-status', { signal: AbortSignal.timeout(10000) });
      const status = await r.json();
      ready = r.ok && status.provider === 'stripe' && status.mode === 'test' &&
        status.ready === true && status.envFlags?.hasStripeTestKey === true &&
        status.envFlags?.hasStripeTestDatabase === true;
      if (ready) break;
    } catch { /* Allow deployment propagation, but never assume readiness. */ }
    await wait(2000);
  }
  if (!ready) throw Error('Sandbox deployed, but test-only checkout readiness could not be verified.');

  // A real test API session and real expired-session webhook, not a card-payment claim.
  const product = fixture.products.find(item => item.available === true && item.sku);
  if (!product) throw Error('The existing synthetic test fixture is unavailable.');
  const response = await fetchImpl(origin + '/api/create-checkout-session', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ sku: product.sku, quantity: 1 }] }),
    signal: AbortSignal.timeout(15000)
  });
  let createdSession;
  try { createdSession = await response.json(); } catch { throw Error('Test session response was invalid.'); }
  if (!response.ok || !/^cs_test_[A-Za-z0-9]+$/.test(createdSession?.orderId || '')) {
    throw Error('Real Stripe test-session creation failed. No live payment was attempted.');
  }
  const session = await stripe('/checkout/sessions/' + createdSession.orderId);
  if (session.livemode !== false || session.payment_status !== 'unpaid' || session.status !== 'open') {
    throw Error('The test session did not have the expected unpaid, test-only state.');
  }
  await stripe('/checkout/sessions/' + session.id + '/expire', 'POST', {});
  let webhookVerified = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const result = await cf('/d1/database/' + databaseId + '/query', 'POST', {
      sql: 'SELECT o.payment_status FROM orders o JOIN payment_events e ON e.event_id=o.last_event_id WHERE o.session_id=?',
      params: [session.id]
    });
    const rows = result?.[0]?.results;
    if (Array.isArray(rows) && rows.some(row => row.payment_status === 'pending')) {
      webhookVerified = true; break;
    }
    await wait(2000);
  }
  if (!webhookVerified) throw Error('Real test session created, but Stripe webhook delivery was not confirmed in D1.');
  log('SANDBOX CONFIGURED: ' + origin);
  log('Verified: real test-session API creation and expired-session webhook persisted in isolated D1.');
  log('Actual successful and declined card transactions still require hosted checkout testing. Production and live charges unchanged.');
  return { configured: true, origin, realSessionCreated: true, expiredWebhookVerified: true,
    successfulCardPaymentTested: false, declinedCardPaymentTested: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { await bootstrapStripeTest(); }
  catch (error) {
    // Our own errors have sanitized messages; unexpected provider errors are not echoed.
    const safe = /^(Sandbox|Cloudflare|Stripe|Only a standard|This setup|Cannot prove|Refusing|Dedicated|Isolated|The existing|Test session|Real Stripe|Real test|The test)/.test(error?.message || '');
    console.error(safe ? error.message : 'Sandbox setup failed. Credential values and provider payloads were suppressed.');
    process.exitCode = 1;
  }
}
