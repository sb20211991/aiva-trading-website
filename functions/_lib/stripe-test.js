/* Stripe hosted Checkout, TEST MODE ONLY. No live-mode code path.
   Existing Square/PayPal implementations and order records are left intact. */
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const text = value => typeof value === 'string' ? value.trim() : '';
const sessionId = value => /^cs_test_[A-Za-z0-9]+$/.test(text(value));
const SOURCE = 'aivatrading.uk';
const API_VERSION = '2025-02-24.acacia';

export function stripeTestConfigured(env) {
  return /^(sk|rk)_test_[A-Za-z0-9]+$/.test(text(env.STRIPE_SECRET_KEY));
}
export function stripeTestReady(env) {
  return stripeTestConfigured(env) &&
    /^whsec_[A-Za-z0-9]+$/.test(text(env.STRIPE_WEBHOOK_SECRET)) &&
    typeof env.STRIPE_TEST_ORDERS_DB?.prepare === 'function' &&
    typeof env.STRIPE_TEST_ORDERS_DB?.batch === 'function';
}
export function stripeTestCataloguePath(request, env) {
  const url = new URL(request.url);
  let allowed = false;
  try {
    const preview = new URL(text(env.STRIPE_TEST_ORIGIN));
    allowed = preview.origin === url.origin && (
      (preview.protocol === 'https:' && preview.hostname.endsWith('.pages.dev')) ||
      (preview.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(preview.hostname))
    );
  } catch { /* No explicit preview origin: keep the empty public catalogue. */ }
  return env.CHECKOUT_PROVIDER === 'stripe' &&
    env.STRIPE_TEST_CHECKOUT_ENABLED === 'true' && allowed
    ? '/data/aiva-products.stripe-test.json' : '/data/aiva-products.json';
}

async function stripeRequest(env, path, body) {
  if (!stripeTestConfigured(env)) throw Error('STRIPE_TEST_NOT_CONFIGURED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = {
      Authorization: 'Bearer ' + text(env.STRIPE_SECRET_KEY),
      'Stripe-Version': API_VERSION
    };
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Idempotency-Key'] = 'aiva_test_' + crypto.randomUUID();
    }
    const response = await fetch('https://api.stripe.com/v1' + path, {
      method: body ? 'POST' : 'GET', headers,
      body: body ? body.toString() : undefined, signal: controller.signal
    });
    if (!response.ok) throw Error('STRIPE_API_FAILED');
    const result = await response.json();
    if (result.livemode === true) throw Error('LIVE_MODE_REFUSED');
    return result;
  } finally { clearTimeout(timeout); }
}

function ours(session) {
  return session && sessionId(session.id) && session.livemode === false &&
    session.mode === 'payment' && session.currency === 'gbp' &&
    session.metadata?.source === SOURCE &&
    session.metadata?.integration === 'stripe-test-v1';
}

export async function createStripeTestCheckout(env, site, basket) {
  if (!stripeTestReady(env)) return json({ error: 'Stripe test checkout requires a test key, webhook signing secret and separate test database.' }, 503);
  const body = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    success_url: site.origin + '/order-success.html?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: site.origin + '/shop.html?cancelled=1#aiva-basket',
    'metadata[source]': SOURCE,
    'metadata[integration]': 'stripe-test-v1',
    'payment_intent_data[metadata][source]': SOURCE,
    'payment_intent_data[metadata][integration]': 'stripe-test-v1',
    'custom_text[submit][message]': 'TEST ONLY — no real money is charged and no goods will be shipped.'
  });
  basket.lines.forEach(({ product, qty }, index) => {
    body.set(`line_items[${index}][quantity]`, String(qty));
    body.set(`line_items[${index}][price_data][currency]`, 'gbp');
    body.set(`line_items[${index}][price_data][unit_amount]`, String(product.pricePence));
    body.set(`line_items[${index}][price_data][product_data][name]`, product.name);
    body.set(`line_items[${index}][price_data][product_data][metadata][sku]`, product.sku);
  });
  basket.shipping.allowedCountries.forEach((country, index) =>
    body.set(`shipping_address_collection[allowed_countries][${index}]`, country));
  body.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  body.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(basket.shippingPrice));
  body.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'gbp');
  body.set('shipping_options[0][shipping_rate_data][display_name]', 'Test delivery — no goods dispatched');
  try {
    const session = await stripeRequest(env, '/checkout/sessions', body);
    const url = new URL(session.url);
    if (!ours(session) || url.origin !== 'https://checkout.stripe.com' ||
      url.username || url.password || !url.pathname.startsWith('/c/pay/')) throw Error('INVALID_CHECKOUT');
    return json({ provider: 'stripe', mode: 'test', orderId: session.id, url: url.href });
  } catch {
    return json({ error: 'Stripe test checkout could not be started. No live checkout was attempted.' }, 502);
  }
}

export async function stripeTestOrderStatus(env, id) {
  if (!sessionId(id)) return json({ error: 'Only Stripe test checkout references are accepted.' }, 400);
  if (!stripeTestConfigured(env)) return json({ error: 'Stripe test verification is not configured.' }, 503);
  try {
    const session = await stripeRequest(env, '/checkout/sessions/' + encodeURIComponent(id));
    if (!ours(session) || session.id !== id) return json({ error: 'Unknown test order.' }, 404);
    return json({
      paid: session.payment_status === 'paid',
      status: session.payment_status === 'paid' ? 'complete' : session.status === 'expired' ? 'expired' : 'pending',
      reference: id.slice(-10), mode: 'test', provider: 'stripe'
    });
  } catch {
    return json({ error: 'Could not verify this test payment. Please do not pay again while checking.' }, 502);
  }
}

async function validSignature(raw, header, secret) {
  const pairs = header.split(',').map(part => part.trim().split('='));
  const timestamps = pairs.filter(([key]) => key === 't').map(([, value]) => value);
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0])) return false;
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const signatures = pairs.filter(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/.test(value)).map(([, value]) => value);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const hex of signatures) {
    const bytes = Uint8Array.from(hex.match(/../g), byte => parseInt(byte, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(timestamp + '.' + raw))) return true;
  }
  return false;
}

export async function stripeTestWebhook(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!stripeTestReady(env)) return json({ error: 'Stripe test webhook is not configured.' }, 503);
  if (Number(request.headers.get('Content-Length')) > 128000) return json({ error: 'Payload too large.' }, 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 128000) return json({ error: 'Payload too large.' }, 413);
  if (!await validSignature(raw, request.headers.get('Stripe-Signature') || '', text(env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: 'Invalid signature.' }, 400);
  }
  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!/^evt_[A-Za-z0-9]+$/.test(text(event?.id)) || event.id.length > 191 || event.livemode !== false) {
    return json({ error: 'Only Stripe test events are accepted.' }, 400);
  }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) return json({ received: true });
  if (!ours(event.data?.object)) return json({ received: true, ignored: true });
  try {
    const db = env.STRIPE_TEST_ORDERS_DB;
    if (await db.prepare('SELECT event_id FROM payment_events WHERE event_id=?').bind(event.id).first()) {
      return json({ received: true, duplicate: true });
    }
    // Retrieve current state, not arrival order: an expired/failed event must not undo a paid order.
    const session = await stripeRequest(env, '/checkout/sessions/' + encodeURIComponent(event.data.object.id));
    if (!ours(session) || session.id !== event.data.object.id ||
      !Number.isSafeInteger(session.amount_total) || session.amount_total < 1) throw Error('INVALID_ORDER');
    const paid = session.payment_status === 'paid';
    const status = paid ? 'paid' : event.type === 'checkout.session.async_payment_failed' ? 'failed' : 'pending';
    const now = Math.floor(Date.now() / 1000);
    // D1 batch is atomic. Event marker is written last so failures remain retryable.
    await db.batch([
      db.prepare(`INSERT INTO orders
        (session_id,last_event_id,payment_status,customer_email,customer_name,amount_total,currency,payment_id,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM payment_events WHERE event_id=?)
        ON CONFLICT(session_id) DO UPDATE SET
        last_event_id=excluded.last_event_id,
        payment_status=CASE WHEN orders.payment_status IN ('paid','refunded') THEN orders.payment_status ELSE excluded.payment_status END,
        customer_email=excluded.customer_email,customer_name=excluded.customer_name,
        amount_total=excluded.amount_total,currency=excluded.currency,
        payment_id=COALESCE(excluded.payment_id,orders.payment_id),updated_at=excluded.updated_at`
      ).bind(session.id, event.id, status,
        text(session.customer_details?.email).slice(0, 320),
        text(session.customer_details?.name).slice(0, 160),
        session.amount_total, session.currency,
        typeof session.payment_intent === 'string' ? session.payment_intent : null, now, now, event.id),
      db.prepare('INSERT OR IGNORE INTO payment_events (event_id,processed_at) VALUES (?,?)').bind(event.id, now)
    ]);
    return json({ received: true });
  } catch {
    return json({ error: 'Test order could not be saved. Please retry this event.' }, 503);
  }
}
