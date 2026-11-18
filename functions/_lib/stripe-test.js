/* Stripe hosted Checkout. Test mode is the default.
   Live mode requires separate credentials/database, explicit owner approval,
   the real site origin and an enabled Stripe account. Historical filename kept. */
import { currencyCode } from '../../assets/aiva-money.js';
import { readLimitedText, BodyTooLarge } from './body.js';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const text = value => typeof value === 'string' ? value.trim() : '';
const sessionId = (value, live = false) =>
  new RegExp('^cs_' + (live ? 'live' : 'test') + '_[A-Za-z0-9]+$').test(text(value));
const SOURCE = 'aivatrading.uk';
const API_VERSION = '2025-02-24.acacia';

export function stripeTestConfigured(env) {
  return /^(sk|rk)_test_[A-Za-z0-9]+$/.test(text(env.STRIPE_SECRET_KEY));
}
function profile(env) {
  const live = env.STRIPE_MODE === 'live';
  return {
    live,
    key: text(live ? env.STRIPE_LIVE_SECRET_KEY : env.STRIPE_SECRET_KEY),
    secret: text(live ? env.STRIPE_LIVE_WEBHOOK_SECRET : env.STRIPE_WEBHOOK_SECRET),
    db: live ? env.STRIPE_LIVE_ORDERS_DB : env.STRIPE_TEST_ORDERS_DB,
    integration: live ? 'stripe-live-v1' : 'stripe-test-v1'
  };
}
export function stripeConfigured(env) {
  if (env.STRIPE_MODE && !['test', 'live'].includes(env.STRIPE_MODE)) return false;
  const p = profile(env);
  return p.live
    ? env.STRIPE_LIVE_PAYMENTS_APPROVED === 'true' && /^(sk|rk)_live_[A-Za-z0-9]+$/.test(p.key)
    : stripeTestConfigured(env);
}
export function stripeMode(env) {
  return stripeConfigured(env) ? profile(env).live ? 'live' : 'test' : 'disabled';
}
export function stripeReady(env) {
  const p = profile(env);
  return stripeConfigured(env) &&
    /^whsec_[A-Za-z0-9]+$/.test(p.secret) &&
    typeof p.db?.prepare === 'function' && typeof p.db?.batch === 'function' &&
    (!p.live || (p.db !== env.STRIPE_TEST_ORDERS_DB && p.db !== env.ORDERS_DB));
}
export function stripeOriginAllowed(env, origin) {
  return !profile(env).live || (
    ['https://aivatrading.uk', 'https://www.aivatrading.uk'].includes(env.STRIPE_LIVE_ORIGIN) &&
    origin === env.STRIPE_LIVE_ORIGIN
  );
}
export async function stripeLiveAccountReady(env) {
  if (!profile(env).live || !stripeReady(env)) return false;
  try {
    const account = await stripeRequest(env, '/account');
    return account.charges_enabled === true && account.payouts_enabled === true &&
      account.details_submitted === true && account.capabilities?.card_payments === 'active';
  } catch { return false; }
}
export function stripeTestCataloguePath(request, env) {
  const url = new URL(request.url);
  let allowed = false;
  try {
    const preview = new URL(text(env.STRIPE_TEST_ORIGIN));
    allowed = preview.origin === text(env.STRIPE_TEST_ORIGIN) && preview.origin === url.origin && (
      (preview.protocol === 'https:' && (preview.hostname.endsWith('.pages.dev') ||
        preview.hostname.endsWith('.sb20211991.workers.dev'))) ||
      (preview.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(preview.hostname))
    );
  } catch { /* No explicit preview origin: keep the empty public catalogue. */ }
  return env.CHECKOUT_PROVIDER === 'stripe' &&
    env.STRIPE_MODE !== 'live' &&
    env.STRIPE_TEST_CHECKOUT_ENABLED === 'true' && allowed
    ? '/data/aiva-products.stripe-test.json' : '/data/aiva-products.json';
}

async function stripeRequest(env, path, body) {
  if (!stripeConfigured(env)) throw Error('STRIPE_NOT_CONFIGURED_OR_APPROVED');
  const p = profile(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = {
      Authorization: 'Bearer ' + p.key,
      'Stripe-Version': API_VERSION
    };
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Idempotency-Key'] = 'aiva_' + (p.live ? 'live_' : 'test_') + crypto.randomUUID();
    }
    const response = await fetch('https://api.stripe.com/v1' + path, {
      method: body ? 'POST' : 'GET', headers,
      body: body ? body.toString() : undefined, signal: controller.signal
    });
    if (!response.ok) throw Error('STRIPE_API_FAILED');
    const result = await response.json();
    if (typeof result.livemode === 'boolean' && result.livemode !== p.live) throw Error('MODE_MISMATCH');
    return result;
  } finally { clearTimeout(timeout); }
}

function ours(session, env) {
  const p = profile(env);
  return session && sessionId(session.id, p.live) && session.livemode === p.live &&
    session.mode === 'payment' && !!currencyCode(session.currency) &&
    session.metadata?.source === SOURCE &&
    session.metadata?.integration === p.integration;
}

export async function createStripeCheckout(env, site, basket) {
  const p = profile(env);
  if (!stripeReady(env) || !stripeOriginAllowed(env, site.origin)) return json({ error: 'Stripe checkout is not configured or approved for this environment.' }, 503);
  if (p.live && !await stripeLiveAccountReady(env)) return json({ error: 'Live card payments are not enabled for this Stripe account.' }, 503);
  const currency = currencyCode(basket.currency)?.toLowerCase();
  if (!currency) return json({ error: 'Unsupported order currency.' }, 400);
  const body = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    success_url: site.origin + '/order-success.html?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: site.origin + '/order-cancelled.html',
    'metadata[source]': SOURCE,
    'metadata[integration]': p.integration,
    'payment_intent_data[metadata][source]': SOURCE,
    'payment_intent_data[metadata][integration]': p.integration
  });
  if (!p.live) body.set('custom_text[submit][message]', 'TEST ONLY — no real money is charged and no goods will be shipped.');
  basket.lines.forEach(({ product, qty }, index) => {
    body.set(`line_items[${index}][quantity]`, String(qty));
    body.set(`line_items[${index}][price_data][currency]`, currency);
    body.set(`line_items[${index}][price_data][unit_amount]`, String(product.pricePence));
    body.set(`line_items[${index}][price_data][product_data][name]`, product.name);
    body.set(`line_items[${index}][price_data][product_data][metadata][sku]`, product.sku);
  });
  basket.shipping.allowedCountries.forEach((country, index) =>
    body.set(`shipping_address_collection[allowed_countries][${index}]`, country));
  body.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  body.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(basket.shippingPrice));
  body.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', currency);
  body.set('shipping_options[0][shipping_rate_data][display_name]', p.live ? 'Standard delivery' : 'Test delivery — no goods dispatched');
  try {
    const session = await stripeRequest(env, '/checkout/sessions', body);
    const url = new URL(session.url);
    if (!ours(session, env) || session.currency !== currency || url.origin !== 'https://checkout.stripe.com' ||
      url.username || url.password || !url.pathname.startsWith('/c/pay/')) throw Error('INVALID_CHECKOUT');
    return json({ provider: 'stripe', mode: p.live ? 'live' : 'test', orderId: session.id, url: url.href });
  } catch {
    return json({ error: 'Stripe checkout could not be started. Please try again or contact Aiva.' }, 502);
  }
}

export async function stripeOrderStatus(env, id) {
  const p = profile(env);
  if (!sessionId(id, p.live)) return json({ error: 'Checkout reference belongs to a different payment environment.' }, 400);
  if (!stripeConfigured(env)) return json({ error: 'Stripe verification is not configured.' }, 503);
  try {
    const session = await stripeRequest(env, '/checkout/sessions/' + encodeURIComponent(id));
    if (!ours(session, env) || session.id !== id) return json({ error: 'Unknown order.' }, 404);
    return json({
      paid: session.payment_status === 'paid',
      status: session.payment_status === 'paid' ? 'complete' : session.status === 'expired' ? 'expired' : 'pending',
      reference: id.slice(-10), mode: p.live ? 'live' : 'test', provider: 'stripe'
    });
  } catch {
    return json({ error: 'Could not verify this payment. Please do not pay again while checking.' }, 502);
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

export async function stripeWebhook(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!stripeReady(env) || !stripeOriginAllowed(env, new URL(request.url).origin)) return json({ error: 'Stripe webhook is not configured for this environment.' }, 503);
  const p = profile(env);
  let raw;
  try { raw = await readLimitedText(request, 128000); }
  catch (error) { return json({ error: error instanceof BodyTooLarge ? 'Payload too large.' : 'Invalid request body.' },
    error instanceof BodyTooLarge ? 413 : 400); }
  if (!await validSignature(raw, request.headers.get('Stripe-Signature') || '', p.secret)) {
    return json({ error: 'Invalid signature.' }, 400);
  }
  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!/^evt_[A-Za-z0-9]+$/.test(text(event?.id)) || event.id.length > 191 || event.livemode !== p.live) {
    return json({ error: 'Webhook event belongs to a different payment environment.' }, 400);
  }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) return json({ received: true });
  if (!ours(event.data?.object, env)) return json({ received: true, ignored: true });
  try {
    const db = p.db;
    if (await db.prepare('SELECT event_id FROM payment_events WHERE event_id=?').bind(event.id).first()) {
      return json({ received: true, duplicate: true });
    }
    // Retrieve current state, not arrival order: an expired/failed event must not undo a paid order.
    const session = await stripeRequest(env, '/checkout/sessions/' + encodeURIComponent(event.data.object.id));
    if (!ours(session, env) || session.id !== event.data.object.id ||
      !Number.isSafeInteger(session.amount_total) || session.amount_total < 1) throw Error('INVALID_ORDER');
    const lineItems = await stripeRequest(env, '/checkout/sessions/' +
      encodeURIComponent(session.id) + '/line_items?limit=100&expand%5B%5D=data.price.product');
    if (!Array.isArray(lineItems.data) || !lineItems.data.length || lineItems.has_more) throw Error('INCOMPLETE_LINE_ITEMS');
    const lines = lineItems.data.map(item => ({
      description: text(item.description).slice(0, 200),
      sku: text(item.price?.product?.metadata?.sku).slice(0, 60),
      quantity: item.quantity,
      amountTotal: item.amount_total,
      currency: item.currency
    }));
    if (lines.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
      !Number.isSafeInteger(item.amountTotal) || item.amountTotal < 0 || item.currency !== session.currency)) throw Error('INVALID_LINE_ITEMS');
    const shipping = session.shipping_details || session.collected_information?.shipping_details || null;
    const paid = session.payment_status === 'paid';
    const status = paid ? 'paid' : event.type === 'checkout.session.async_payment_failed' ? 'failed' : 'pending';
    const now = Math.floor(Date.now() / 1000);
    // D1 batch is atomic. Event marker is written last so failures remain retryable.
    await db.batch([
      db.prepare(`INSERT INTO orders
        (session_id,last_event_id,payment_status,customer_email,customer_name,amount_total,currency,payment_id,created_at,updated_at,line_items_json,shipping_details_json)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM payment_events WHERE event_id=?)
        ON CONFLICT(session_id) DO UPDATE SET
        last_event_id=excluded.last_event_id,
        payment_status=CASE WHEN orders.payment_status IN ('paid','refunded') THEN orders.payment_status ELSE excluded.payment_status END,
        customer_email=excluded.customer_email,customer_name=excluded.customer_name,
        amount_total=excluded.amount_total,currency=excluded.currency,
        payment_id=COALESCE(excluded.payment_id,orders.payment_id),updated_at=excluded.updated_at,
        line_items_json=excluded.line_items_json,shipping_details_json=COALESCE(excluded.shipping_details_json,orders.shipping_details_json)`
      ).bind(session.id, event.id, status,
        text(session.customer_details?.email).slice(0, 320),
        text(session.customer_details?.name).slice(0, 160),
        session.amount_total, session.currency,
        typeof session.payment_intent === 'string' ? session.payment_intent : null, now, now,
        JSON.stringify(lines), shipping ? JSON.stringify(shipping) : null, event.id),
      db.prepare('INSERT OR IGNORE INTO payment_events (event_id,processed_at) VALUES (?,?)').bind(event.id, now)
    ]);
    return json({ received: true });
  } catch {
    return json({ error: 'Order could not be saved. Please retry this event.' }, 503);
  }
}
