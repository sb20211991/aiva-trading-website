#!/usr/bin/env node
/**
 * Local checkout flow test with mocked Square/PayPal APIs.
 * Does not charge real money and does not publish a live shop.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commerceUrl = pathToFileURL(path.join(root, 'functions/_lib/commerce.js')).href;
const {
  handleShopStatus,
  handleCreateCheckout,
  handleOrderStatus,
  handleCreateRefund,
  handleSquareWebhook,
  handleStripeWebhook
} = await import(commerceUrl);

const catalogue = JSON.parse(readFileSync(path.join(root, 'data/aiva-products.json'), 'utf8'));
const testCat = {
  ...catalogue,
  shopEnabled: true,
  businessAddress: '153 Whitehill Road, Gravesend, DA12 5LS',
  deliveryPolicy: 'UK mainland delivery within 5–10 working days after dispatch confirmation.',
  returnsPolicy: 'Unused items may be returned within 14 days of delivery subject to written confirmation.',
  shipping: { allowedCountries: ['GB'], flatRatePence: 495, freeShippingThresholdPence: 10000 },
  products: [
    {
      sku: 'TEST-POWER-01',
      name: 'Sandbox portable power station',
      category: 'Energy & power',
      description: 'Local sandbox-only test listing. Not for live sale.',
      pricePence: 19900,
      stock: 3,
      available: true
    },
    {
      sku: 'TEST-POUND-01',
      name: 'Sandbox £1 verification charge',
      category: 'Energy & power',
      description: 'One-pound sandbox verification item. Not for live sale.',
      pricePence: 100,
      stock: 10,
      available: true
    }
  ]
};

const env = {
  SQUARE_ACCESS_TOKEN: 'sandbox-token',
  SQUARE_LOCATION_ID: 'LOC_TEST',
  SQUARE_ENVIRONMENT: 'sandbox',
  PAYPAL_CLIENT_ID: 'paypal-client',
  PAYPAL_CLIENT_SECRET: 'paypal-secret',
  PAYPAL_ENVIRONMENT: 'sandbox',
  MERCHANT_REFUND_SECRET: 'local-merchant-refund-secret-key-32',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'local-square-webhook-signature-key',
  SQUARE_WEBHOOK_NOTIFICATION_URL: 'http://127.0.0.1:8799/api/square-webhook',
  ORDERS_DB: null,
  ASSETS: {
    async fetch() {
      return new Response(JSON.stringify(testCat), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes('squareupsandbox.com') && url.includes('/payment-links')) {
    return new Response(
      JSON.stringify({
        payment_link: {
          id: 'PK_TEST',
          order_id: 'SQ_ORDER_TEST_12345',
          url: 'https://square.link/u/TESTCHECKOUT'
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (url.includes('squareupsandbox.com') && url.includes('/orders/')) {
    return new Response(
      JSON.stringify({
        order: {
          id: 'SQ_ORDER_TEST_12345',
          state: 'COMPLETED',
          metadata: { source: 'aivatrading.uk' },
          tenders: [{ amount_money: { amount: 20395, currency: 'GBP' } }]
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (url.includes('paypal.com') && url.endsWith('/v1/oauth2/token')) {
    return new Response(JSON.stringify({ access_token: 'paypal-access' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (
    url.includes('paypal.com') &&
    /\/v2\/checkout\/orders\/?$/.test(new URL(url).pathname) &&
    (init.method || 'GET').toUpperCase() === 'POST'
  ) {
    return new Response(
      JSON.stringify({
        id: 'PAYPALORDERTEST001',
        status: 'CREATED',
        links: [
          {
            rel: 'approve',
            href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALORDERTEST001'
          }
        ]
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (url.includes('paypal.com') && url.includes('/v2/checkout/orders/PAYPALORDERTEST001') && !url.includes('/capture')) {
    return new Response(
      JSON.stringify({
        id: 'PAYPALORDERTEST001',
        status: 'APPROVED',
        purchase_units: [{ reference_id: 'aivatrading.uk', custom_id: 'aivatrading.uk' }]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (url.includes('/capture')) {
    return new Response(
      JSON.stringify({
        id: 'PAYPALORDERTEST001',
        status: 'COMPLETED',
        purchase_units: [{ reference_id: 'aivatrading.uk', custom_id: 'aivatrading.uk' }]
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (url.includes('squareupsandbox.com') && url.includes('/v2/refunds')) {
    const body = JSON.parse(init.body || '{}');
    return new Response(
      JSON.stringify({
        refund: {
          id: 'REFUND_TEST_1',
          status: 'COMPLETED',
          payment_id: body.payment_id,
          order_id: 'SQ_ORDER_TEST_12345',
          amount_money: body.amount_money || { amount: 100, currency: 'GBP' }
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return originalFetch(input, init);
};

const base = 'http://127.0.0.1:8799';

async function run() {
  const statusRes = await handleShopStatus(new Request(base + '/api/shop-status'), env);
  const status = await statusRes.json();
  assert.equal(status.ready, true);
  assert.equal(status.provider, 'square');
  assert.ok(status.providers.includes('square'));
  assert.ok(status.providers.includes('paypal'));
  console.log('shop-status ok', status.provider, status.providers.join(','));

  const squareCheckout = await handleCreateCheckout(
    new Request(base + '/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ items: [{ sku: 'TEST-POWER-01', quantity: 1 }] })
    }),
    env
  );
  const squareBody = await squareCheckout.json();
  assert.equal(squareCheckout.status, 200);
  assert.equal(squareBody.provider, 'square');
  assert.match(squareBody.url, /^https:\/\/square\.link\//);
  console.log('square checkout ok');

  const paypalCheckout = await handleCreateCheckout(
    new Request(base + '/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({
        provider: 'paypal',
        items: [{ sku: 'TEST-POWER-01', quantity: 1 }]
      })
    }),
    env
  );
  const paypalBody = await paypalCheckout.json();
  assert.equal(paypalCheckout.status, 200);
  assert.equal(paypalBody.provider, 'paypal');
  assert.match(paypalBody.url, /sandbox\.paypal\.com/);
  console.log('paypal checkout ok');

  const squareStatus = await handleOrderStatus(
    new Request(base + '/api/order-status?order_id=SQ_ORDER_TEST_12345'),
    env
  );
  const squarePaid = await squareStatus.json();
  assert.equal(squarePaid.paid, true);
  assert.equal(squarePaid.provider, 'square');
  console.log('square order-status ok');

  const paypalStatus = await handleOrderStatus(
    new Request(base + '/api/order-status?token=PAYPALORDERTEST001&PayerID=TESTPAYER'),
    env
  );
  const paypalPaid = await paypalStatus.json();
  assert.equal(paypalPaid.paid, true);
  assert.equal(paypalPaid.provider, 'paypal');
  console.log('paypal order-status ok');

  const poundCheckout = await handleCreateCheckout(
    new Request(base + '/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ items: [{ sku: 'TEST-POUND-01', quantity: 1 }] })
    }),
    env
  );
  const poundBody = await poundCheckout.json();
  assert.equal(poundCheckout.status, 200);
  assert.equal(poundBody.provider, 'square');
  console.log('£1 sandbox checkout session ok');

  const badRefund = await handleCreateRefund(
    new Request(base + '/api/create-refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Aiva-Merchant-Key': 'wrong' },
      body: JSON.stringify({ paymentId: 'PAYMENT_TEST_1', amountPence: 100 })
    }),
    env
  );
  assert.equal(badRefund.status, 401);
  console.log('refund auth rejection ok');

  const refundRes = await handleCreateRefund(
    new Request(base + '/api/create-refund', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Aiva-Merchant-Key': env.MERCHANT_REFUND_SECRET
      },
      body: JSON.stringify({
        paymentId: 'PAYMENT_TEST_1',
        orderId: 'SQ_ORDER_TEST_12345',
        amountPence: 100,
        reason: 'Sandbox £1 refund test'
      })
    }),
    env
  );
  const refundBody = await refundRes.json();
  assert.equal(refundRes.status, 200);
  assert.equal(refundBody.ok, true);
  assert.equal(refundBody.refundId, 'REFUND_TEST_1');
  console.log('square refund api ok');

  // Signed webhook retries must not be lost when Square's order API is unavailable.
  const mockCheckoutFetch = globalThis.fetch;
  const writes = [];
  const webhookEnv = { ...env, ORDERS_DB: {
    prepare(sql) {
      return { bind(...values) {
        return { sql, values, async run() { writes.push({ sql, values }); } };
      } };
    },
    async batch(statements) { writes.push(...statements); }
  } };
  const eventBody = JSON.stringify({
    event_id: 'EVENT_RETRY_01', type: 'payment.updated',
    data: { object: { payment: {
      id: 'PAYMENT_TEST_1', order_id: 'SQ_ORDER_TEST_12345', status: 'COMPLETED',
      amount_money: { amount: 20395, currency: 'GBP' }
    } } }
  });
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha256', env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(env.SQUARE_WEBHOOK_NOTIFICATION_URL + eventBody).digest('base64');
  const notification = () => new Request(env.SQUARE_WEBHOOK_NOTIFICATION_URL, {
    method: 'POST', body: eventBody,
    headers: { 'x-square-hmacsha256-signature': signature }
  });
  try {
    for (const failure of ['http', 'network', 'malformed']) {
      globalThis.fetch = async () => {
        if (failure === 'network') throw new Error('Simulated outage');
        return new Response(failure === 'malformed' ? '{}' : 'Unavailable', {
          status: failure === 'http' ? 503 : 200
        });
      };
      assert.equal((await handleSquareWebhook(notification(), webhookEnv)).status, 503);
      assert.equal(writes.length, 0, 'Unverified events must remain eligible for retry');
    }
    globalThis.fetch = async () => new Response(JSON.stringify({
      order: { id: 'OTHER_ORDER', metadata: { source: 'another-store' } }
    }));
    assert.equal((await handleSquareWebhook(notification(), webhookEnv)).status, 200);
    assert.equal(writes.length, 0, 'Other stores must not be persisted');
    globalThis.fetch = mockCheckoutFetch;
    assert.equal((await handleSquareWebhook(notification(), webhookEnv)).status, 200);
    assert.equal(writes.length, 2, 'Recovered delivery must persist the event and order');
    console.log('signed Square webhook outage and recovery checks passed');
  } finally {
    globalThis.fetch = mockCheckoutFetch;
  }

  const retired = await handleStripeWebhook(
    new Request(base + '/api/stripe-webhook', { method: 'POST', body: '{}' }),
    env
  );
  assert.equal(retired.status, 410);
  console.log('stripe webhook retired ok');

  // Closed-shop safety: real catalogue file remains shopEnabled=false
  const liveCat = JSON.parse(readFileSync(path.join(root, 'data/aiva-products.json'), 'utf8'));
  assert.equal(liveCat.shopEnabled, false);
  assert.deepEqual(liveCat.products, []);
  console.log('live catalogue remains closed');

  console.log('ALL LOCAL CHECKOUT TESTS PASSED');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
  });
