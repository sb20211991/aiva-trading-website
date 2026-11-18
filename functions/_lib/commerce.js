/* Aiva Trading checkout for Cloudflare Pages Functions. Square is the only payment provider.
   Prices, stock and totals are always taken from the server catalogue, never from the browser. */
import { normaliseCatalogue } from '../../assets/aiva-money.js';
import { readLimitedText, BodyTooLarge } from './body.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};
const SQUARE_VERSION = '2025-10-16';
const ORDER_SOURCE = 'aivatrading.uk';
export const respond = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
const str = (x) => (typeof x === 'string' ? x.trim() : '');
const now = () => Math.floor(Date.now() / 1000);
const validPrice = (n) => Number.isSafeInteger(n) && n > 0 && n <= 100000000;
const validStock = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100000;
const validSku = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{2,60}$/.test(s);
const validId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,191}$/.test(s);
const safeCountries = (c) =>
  Array.isArray(c) && c.length > 0 && c.length <= 12 && c.every((x) => typeof x === 'string' && /^[A-Z]{2}$/.test(x));

function squareEnvName(env) {
  const v = str(env.SQUARE_ENVIRONMENT).toLowerCase();
  if (v === 'production') return 'production';
  if (v === 'sandbox') return 'sandbox';
  return '';
}
function squareConfigured(env) {
  return !!(str(env.SQUARE_ACCESS_TOKEN) && str(env.SQUARE_LOCATION_ID) && squareEnvName(env));
}
function hasDb(env) {
  return !!env.ORDERS_DB && typeof env.ORDERS_DB.prepare === 'function';
}
/* Self-migrating schema: the Function's D1 binding upgrades older order tables in place.
   payment_status keeps the original pending/paid/failed/refunded values; mismatches use review_reason. */
const SCHEMA_COLUMNS = ['expected_total INTEGER', 'stock_applied INTEGER NOT NULL DEFAULT 0', 'payment_link_id TEXT',
  'mode TEXT', 'paid_at INTEGER', 'refund_status TEXT', 'refunded_total INTEGER', 'review_reason TEXT'];
const schemaReady = new WeakSet();
async function ensureSchema(env) {
  const db = env.ORDERS_DB;
  if (schemaReady.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (session_id TEXT PRIMARY KEY, last_event_id TEXT NOT NULL, payment_status TEXT NOT NULL,
      fulfillment_status TEXT NOT NULL DEFAULT 'new', customer_email TEXT, customer_name TEXT, amount_total INTEGER, currency TEXT,
      shipping_details_json TEXT, line_items_json TEXT, payment_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare('CREATE TABLE IF NOT EXISTS payment_events (event_id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS inventory (sku TEXT PRIMARY KEY, stock INTEGER NOT NULL, updated_at INTEGER NOT NULL)')
  ]);
  const { results } = await db.prepare('PRAGMA table_info(orders)').all();
  const have = new Set((results || []).map((c) => c.name));
  for (const col of SCHEMA_COLUMNS) {
    if (!have.has(col.split(' ')[0])) await db.prepare('ALTER TABLE orders ADD COLUMN ' + col).run();
  }
  schemaReady.add(db);
}
function webhookConfigured(env) {
  return str(env.SQUARE_WEBHOOK_SIGNATURE_KEY).length >= 16 && !!str(env.SQUARE_WEBHOOK_NOTIFICATION_URL);
}
/* Production charges need an explicit approval flag in addition to production credentials. */
function getMode(env) {
  if (!squareConfigured(env)) return 'disabled';
  if (squareEnvName(env) === 'production') return env.SQUARE_LIVE_PAYMENTS_APPROVED === 'true' ? 'live' : 'disabled';
  return 'test';
}
function squareApiBase(env) {
  return squareEnvName(env) === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}
async function squareFetch(env, path, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(squareApiBase(env) + path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + str(env.SQUARE_ACCESS_TOKEN),
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_VERSION
      },
      signal: ctl.signal
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function liveLocationReady(env) {
  try {
    const { ok, data } = await squareFetch(env, '/v2/locations/' + encodeURIComponent(str(env.SQUARE_LOCATION_ID)));
    const loc = data?.location;
    return ok && loc?.id === str(env.SQUARE_LOCATION_ID) && loc?.status === 'ACTIVE' &&
      Array.isArray(loc?.capabilities) && loc.capabilities.includes('CREDIT_CARD_PROCESSING');
  } catch {
    return false;
  }
}

function validPolicy(c) {
  return (
    c && c.shopEnabled === true && c.currency === 'GBP' && Array.isArray(c.products) &&
    str(c.businessAddress).length >= 8 && str(c.deliveryPolicy).length >= 15 && str(c.returnsPolicy).length >= 15 &&
    c.shipping && safeCountries(c.shipping.allowedCountries) &&
    Number.isSafeInteger(c.shipping.flatRatePence) && c.shipping.flatRatePence >= 0 && c.shipping.flatRatePence <= 100000 &&
    (c.shipping.freeShippingThresholdPence === null || c.shipping.freeShippingThresholdPence === undefined ||
      validPrice(c.shipping.freeShippingThresholdPence))
  );
}
function buyable(p) {
  return (
    p && validSku(p.sku) && typeof p.name === 'string' && p.name.trim().length > 1 && p.name.length <= 140 &&
    typeof p.description === 'string' && p.description.length <= 700 &&
    typeof p.category === 'string' && p.category.length <= 80 &&
    p.available === true && validPrice(p.pricePence) && validStock(p.stock) && p.stock > 0
  );
}

/* Live stock: D1 inventory rows override the catalogue file once a SKU has sold. */
async function stockOverrides(env) {
  if (!hasDb(env)) return new Map();
  try {
    await ensureSchema(env);
    const { results } = await env.ORDERS_DB.prepare('SELECT sku, stock FROM inventory').all();
    return new Map((results || []).map((r) => [r.sku, Number(r.stock)]));
  } catch {
    return new Map();
  }
}
async function getCatalogue(request, env) {
  const url = new URL(request.url);
  url.pathname = '/data/aiva-products.json';
  url.search = '';
  const r = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  if (!r.ok) throw Error('CATALOGUE_UNAVAILABLE');
  const cat = normaliseCatalogue(await r.json());
  const overrides = await stockOverrides(env);
  cat.products = cat.products.map((p) => (overrides.has(p.sku) ? { ...p, stock: Math.max(0, overrides.get(p.sku)) } : p));
  return cat;
}

function isTrustedCheckoutUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'square.link' || host.endsWith('.square.link') ||
      host === 'checkout.square.site' || host.endsWith('.checkout.square.site') ||
      host.endsWith('.squareup.com') || host.endsWith('.squareupsandbox.com'));
  } catch {
    return false;
  }
}

function parseBasket(data, cat) {
  if (!data || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 20) {
    return { error: 'Choose 1–20 products.' };
  }
  const products = new Map(cat.products.filter(buyable).map((p) => [p.sku, p]));
  const used = new Set();
  let itemTotal = 0, totalUnits = 0;
  const lines = [];
  for (const item of data.items) {
    const sku = item && item.sku, qty = item && item.quantity, product = products.get(sku);
    if (!validSku(sku) || !product || used.has(sku) || !Number.isSafeInteger(qty) || qty < 1 || qty > 10 || qty > product.stock) {
      return { error: 'Your basket contains an unavailable product or quantity.' };
    }
    used.add(sku);
    totalUnits += qty;
    itemTotal += product.pricePence * qty;
    if (itemTotal > 200000000 || totalUnits > 50) return { error: 'Order total exceeds the online limit; request a quotation.' };
    lines.push({ product, qty });
  }
  const s = cat.shipping;
  const shippingPrice = Number.isSafeInteger(s.freeShippingThresholdPence) && itemTotal >= s.freeShippingThresholdPence ? 0 : s.flatRatePence;
  return { lines, itemTotal, shippingPrice, total: itemTotal + shippingPrice };
}

export async function handleShopStatus(request, env) {
  try {
    const cat = await getCatalogue(request, env);
    const mode = getMode(env);
    const infra = hasDb(env) && webhookConfigured(env);
    const merchantReady = mode === 'live' ? await liveLocationReady(env) : mode === 'test';
    return respond({
      ready: merchantReady && infra && validPolicy(cat) && cat.products.some(buyable) && !(mode === 'live' && cat.testOnly === true),
      mode,
      provider: mode === 'disabled' ? null : 'square',
      currency: cat.currency,
      merchantReady,
      webhookConfigured: webhookConfigured(env),
      orderDatabaseConfigured: hasDb(env),
      publishedProducts: cat.products.filter(buyable).length,
      shopEnabled: cat.shopEnabled === true,
      stock: Object.fromEntries(cat.products.filter((p) => validSku(p.sku)).map((p) => [p.sku, validStock(p.stock) ? p.stock : 0])),
      envFlags: {
        hasSquareAccessToken: str(env.SQUARE_ACCESS_TOKEN).length > 0,
        hasSquareLocationId: str(env.SQUARE_LOCATION_ID).length > 0,
        squareEnvironment: squareEnvName(env) || null,
        hasWebhookSignatureKey: str(env.SQUARE_WEBHOOK_SIGNATURE_KEY).length >= 16,
        hasOrdersDb: hasDb(env),
        hasMerchantKey: str(env.MERCHANT_ADMIN_KEY).length >= 24
      }
    });
  } catch {
    return respond({ ready: false, mode: 'disabled', provider: null, publishedProducts: 0, shopEnabled: false });
  }
}

export async function handleCreateCheckout(request, env) {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  const site = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== site.origin) return respond({ error: 'Untrusted request origin.' }, 403);
  if (!/application\/json/i.test(request.headers.get('Content-Type') || '')) return respond({ error: 'Send JSON checkout items.' }, 415);
  let data;
  try {
    data = JSON.parse(await readLimitedText(request, 8192));
  } catch (error) {
    if (error instanceof BodyTooLarge) return respond({ error: 'Order too large.' }, 413);
    return respond({ error: 'Invalid order format.' }, 400);
  }
  const mode = getMode(env);
  let cat;
  try { cat = await getCatalogue(request, env); } catch { return respond({ error: 'Checkout is currently unavailable.' }, 503); }
  if (mode === 'disabled' || !hasDb(env) || !webhookConfigured(env) || !validPolicy(cat) || (mode === 'live' && cat.testOnly === true)) {
    return respond({ error: 'Online checkout is not enabled. Contact Aiva for a quotation.' }, 503);
  }
  if (mode === 'live' && !(await liveLocationReady(env))) {
    return respond({ error: 'Live card payments are not yet enabled. Please contact Aiva.' }, 503);
  }
  const basket = parseBasket(data, cat);
  if (basket.error) return respond({ error: basket.error }, 400);

  const lineItems = basket.lines.map(({ product, qty }) => ({
    name: product.name.trim().slice(0, 512),
    quantity: String(qty),
    item_type: 'ITEM',
    note: 'SKU ' + product.sku,
    metadata: { sku: product.sku },
    base_price_money: { amount: product.pricePence, currency: 'GBP' }
  }));
  const body = {
    idempotency_key: 'aiva_' + crypto.randomUUID(),
    description: 'Aiva Trading online order',
    order: {
      location_id: str(env.SQUARE_LOCATION_ID),
      reference_id: ORDER_SOURCE,
      line_items: lineItems,
      metadata: { source: ORDER_SOURCE }
    },
    checkout_options: {
      redirect_url: site.origin + '/order-success.html',
      ask_for_shipping_address: true,
      ...(basket.shippingPrice > 0 ? { shipping_fee: { name: 'UK delivery', charge: { amount: basket.shippingPrice, currency: 'GBP' } } } : {}),
      merchant_support_email: str(env.MERCHANT_SUPPORT_EMAIL) || undefined,
      accepted_payment_methods: { apple_pay: true, google_pay: true, cash_app_pay: false, afterpay_clearpay: false }
    },
    payment_note: 'Aiva Trading Limited online order'
  };
  let result;
  try {
    result = await squareFetch(env, '/v2/online-checkout/payment-links', { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    console.error('Square checkout network error', String(e));
    return respond({ error: 'Payment service is temporarily unavailable.' }, 502);
  }
  const link = result.data?.payment_link;
  if (!result.ok || !link?.url || !isTrustedCheckoutUrl(link.url)) {
    console.error('Square create failed', result.status, result.data?.errors?.[0]?.code, result.data?.errors?.[0]?.detail);
    return respond({ error: 'Secure checkout could not be started. Try again or contact Aiva.' }, 502);
  }
  const orderId = str(link.order_id || result.data?.related_resources?.orders?.[0]?.id);
  if (!validId(orderId)) return respond({ error: 'Invalid payment provider response.' }, 502);
  const items = basket.lines.map(({ product, qty }) => ({ sku: product.sku, name: product.name, quantity: qty, unitPence: product.pricePence }));
  const t = now();
  await env.ORDERS_DB.prepare(
    `INSERT OR IGNORE INTO orders (session_id,last_event_id,payment_status,amount_total,expected_total,currency,line_items_json,payment_link_id,mode,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(orderId, 'checkout_created', 'pending', basket.total, basket.total, 'gbp', JSON.stringify(items), str(link.id) || null, mode, t, t).run();
  return respond({ url: link.url, orderId, provider: 'square', mode });
}

export async function handleOrderStatus(request, env) {
  if (request.method !== 'GET') return respond({ error: 'Method not allowed.' }, 405);
  const params = new URL(request.url).searchParams;
  const id = str(params.get('orderId') || params.get('order_id') || params.get('session_id'));
  if (!validId(id)) return respond({ error: 'Invalid checkout reference.' }, 400);
  if (!squareConfigured(env)) return respond({ error: 'Payment verification is not configured.' }, 503);
  try {
    const { ok, status, data } = await squareFetch(env, '/v2/orders/' + encodeURIComponent(id));
    if (!ok) return respond({ error: 'Could not verify this payment.' }, status === 404 ? 404 : 502);
    const order = data?.order;
    if (!order || order.metadata?.source !== ORDER_SOURCE) return respond({ error: 'Unknown order origin.' }, 404);
    const paidTender = Array.isArray(order.tenders) && order.tenders.some((t) => Number(t?.amount_money?.amount || 0) > 0);
    const paid = order.state === 'COMPLETED' || (order.state === 'OPEN' && paidTender);
    return respond({ paid, status: paid ? 'complete' : 'pending', reference: id.slice(-10), mode: getMode(env), provider: 'square' });
  } catch {
    return respond({ error: 'Could not check payment status.' }, 502);
  }
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function squareSignature(raw, signatureKey, notificationUrl) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(signatureKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(notificationUrl + raw)));
  let binary = '';
  for (const b of sig) binary += String.fromCharCode(b);
  return btoa(binary);
}

/* Applies a confirmed payment exactly once: marks the order paid and reduces stock. */
async function applyPaid(env, origin, orderId, payment, eventId) {
  const db = env.ORDERS_DB;
  const row = await db.prepare('SELECT payment_status, expected_total, line_items_json, stock_applied FROM orders WHERE session_id=?').bind(orderId).first();
  if (!row) return { ignored: 'unknown_order' };
  const amount = Number(payment?.amount_money?.amount);
  if (!Number.isSafeInteger(amount) || payment?.amount_money?.currency !== 'GBP' || amount !== Number(row.expected_total)) {
    await db.prepare(`UPDATE orders SET review_reason='amount_mismatch', last_event_id=?, updated_at=? WHERE session_id=? AND payment_status IN ('pending','failed')`)
      .bind(eventId, now(), orderId).run();
    console.error('Square amount mismatch for order', orderId);
    return { ignored: 'amount_mismatch' };
  }
  const email = str(payment?.buyer_email_address).slice(0, 320);
  const addr = payment?.shipping_address || null;
  const name = str([addr?.first_name, addr?.last_name].filter(Boolean).join(' ')).slice(0, 160);
  const t = now();
  let items = [];
  try { items = JSON.parse(row.line_items_json || '[]'); } catch { items = []; }
  const cat = await getCatalogueForStock(env, origin);
  /* One D1 batch = one transaction: stock is reduced exactly when the order flips to paid. */
  const pendingGuard = `EXISTS (SELECT 1 FROM orders WHERE session_id=? AND stock_applied=0 AND payment_status IN ('pending','failed'))`;
  const stmts = [];
  for (const it of items) {
    if (!validSku(it.sku) || !Number.isSafeInteger(it.quantity)) continue;
    stmts.push(db.prepare('INSERT OR IGNORE INTO inventory (sku, stock, updated_at) VALUES (?,?,?)').bind(it.sku, cat.get(it.sku) ?? 0, t));
    stmts.push(db.prepare(`UPDATE inventory SET stock=MAX(stock-?,0), updated_at=? WHERE sku=? AND ${pendingGuard}`).bind(it.quantity, t, it.sku, orderId));
  }
  stmts.push(db.prepare(
    `UPDATE orders SET payment_status='paid', payment_id=?, amount_total=?, customer_email=COALESCE(NULLIF(?,''),customer_email),
       customer_name=COALESCE(NULLIF(?,''),customer_name), shipping_details_json=COALESCE(?,shipping_details_json),
       last_event_id=?, paid_at=?, updated_at=?, stock_applied=1
     WHERE session_id=? AND stock_applied=0 AND payment_status IN ('pending','failed')`
  ).bind(str(payment?.id), amount, email, name, addr ? JSON.stringify(addr).slice(0, 4000) : null, eventId, t, t, orderId));
  const results = await db.batch(stmts);
  if (!results.at(-1)?.meta?.changes) return { duplicate: true };
  return { paid: true };
}
async function getCatalogueForStock(env, origin) {
  try {
    const r = await env.ASSETS.fetch(new Request(origin + '/data/aiva-products.json'));
    const cat = await r.json();
    return new Map((cat.products || []).map((p) => [p.sku, Number(p.stock) || 0]));
  } catch {
    return new Map();
  }
}

export async function handleSquareWebhook(request, env) {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  if (!webhookConfigured(env) || !hasDb(env)) return respond({ error: 'Webhook not configured.' }, 503);
  let raw;
  try { raw = await readLimitedText(request, 128000); } catch { return respond({ error: 'Webhook payload too large.' }, 413); }
  const expected = await squareSignature(raw, str(env.SQUARE_WEBHOOK_SIGNATURE_KEY), str(env.SQUARE_WEBHOOK_NOTIFICATION_URL));
  if (!timingSafeEqual(expected, request.headers.get('x-square-hmacsha256-signature') || '')) {
    return respond({ error: 'Invalid signature.' }, 401);
  }
  let event;
  try { event = JSON.parse(raw); } catch { return respond({ error: 'Invalid JSON.' }, 400); }
  const eventId = str(event?.event_id);
  if (!eventId || eventId.length > 191) return respond({ error: 'Invalid event.' }, 400);
  const origin = new URL(request.url).origin;
  const db = env.ORDERS_DB;
  try { await ensureSchema(env); } catch (e) { console.error('schema', String(e)); return respond({ error: 'Temporary processing error.' }, 500); }
  const seen = await db.prepare('INSERT OR IGNORE INTO payment_events (event_id, processed_at) VALUES (?,?)').bind(eventId, now()).run();
  if (!seen.meta?.changes) return respond({ received: true, duplicate: true });
  try {
    const type = str(event?.type);
    const obj = event?.data?.object || {};
    if (type === 'payment.created' || type === 'payment.updated') {
      const p = obj.payment;
      const orderId = str(p?.order_id);
      if (!validId(orderId)) return respond({ received: true });
      if (p.status === 'COMPLETED') return respond({ received: true, ...(await applyPaid(env, origin, orderId, p, eventId)) });
      if (p.status === 'FAILED' || p.status === 'CANCELED') {
        await db.prepare(`UPDATE orders SET payment_status='failed', last_event_id=?, updated_at=? WHERE session_id=? AND payment_status='pending'`)
          .bind(eventId, now(), orderId).run();
      }
      return respond({ received: true });
    }
    if (type === 'refund.created' || type === 'refund.updated') {
      const r = obj.refund;
      const ids = [str(r?.order_id), str(r?.payment_id)];
      if (r?.status === 'COMPLETED' && (validId(ids[0]) || validId(ids[1]))) {
        /* refunded_total is maintained by the refund API; the webhook only confirms completion. */
        await db.prepare(`UPDATE orders SET refund_status='COMPLETED',
            payment_status=CASE WHEN COALESCE(refunded_total,0) >= amount_total THEN 'refunded' ELSE payment_status END,
            fulfillment_status=CASE WHEN COALESCE(refunded_total,0) >= amount_total THEN 'refunded' ELSE fulfillment_status END,
            last_event_id=?, updated_at=? WHERE session_id=? OR (payment_id IS NOT NULL AND payment_id=?)`)
          .bind(eventId, now(), ...ids).run();
      }
      if ((r?.status === 'FAILED' || r?.status === 'REJECTED') && (validId(ids[0]) || validId(ids[1]))) {
        /* Give back the amount reserved by handleCreateRefund so the merchant can retry. */
        const amt = Number(r.amount_money?.amount) || 0;
        await db.prepare(`UPDATE orders SET refund_status=?, refunded_total=MAX(COALESCE(refunded_total,0)-?,0),
            payment_status='paid', fulfillment_status=CASE WHEN fulfillment_status='refunded' THEN 'new' ELSE fulfillment_status END,
            last_event_id=?, updated_at=? WHERE (session_id=? OR (payment_id IS NOT NULL AND payment_id=?)) AND payment_status IN ('paid','refunded')`)
          .bind(str(r.status), amt, eventId, now(), ...ids).run();
      }
      return respond({ received: true });
    }
    return respond({ received: true });
  } catch (e) {
    /* Let Square retry: forget the event id so the retry is processed. */
    await db.prepare('DELETE FROM payment_events WHERE event_id=?').bind(eventId).run();
    console.error('Square webhook processing failed', String(e));
    return respond({ error: 'Temporary processing error.' }, 500);
  }
}

function merchantAuthorised(request, env) {
  const secret = str(env.MERCHANT_ADMIN_KEY);
  const auth = str(request.headers.get('Authorization')).replace(/^Bearer\s+/i, '');
  return secret.length >= 24 && timingSafeEqual(secret, auth);
}

/* Merchant order management: GET lists orders, POST updates fulfilment status. */
export async function handleAdminOrders(request, env) {
  if (!merchantAuthorised(request, env)) return respond({ error: 'Unauthorized.' }, 401);
  if (!hasDb(env)) return respond({ error: 'Order database not configured.' }, 503);
  await ensureSchema(env);
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const status = str(params.get('status'));
    const limit = Math.min(Math.max(parseInt(params.get('limit') || '50', 10) || 50, 1), 200);
    const sql = 'SELECT session_id AS orderId, payment_status, review_reason, fulfillment_status, customer_email, customer_name, amount_total, refunded_total, currency, line_items_json, shipping_details_json, payment_id, mode, created_at, paid_at, updated_at FROM orders' +
      (status ? ' WHERE payment_status=?' : '') + ' ORDER BY created_at DESC LIMIT ?';
    const stmt = status ? env.ORDERS_DB.prepare(sql).bind(status, limit) : env.ORDERS_DB.prepare(sql).bind(limit);
    const { results } = await stmt.all();
    const inv = await env.ORDERS_DB.prepare('SELECT sku, stock, updated_at FROM inventory ORDER BY sku').all();
    return respond({ orders: results || [], inventory: inv.results || [] });
  }
  if (request.method === 'POST') {
    let data;
    try { data = JSON.parse(await readLimitedText(request, 4096)); } catch { return respond({ error: 'Invalid JSON.' }, 400); }
    const orderId = str(data?.orderId), fulfilment = str(data?.fulfillmentStatus);
    if (!validId(orderId) || !['new', 'processing', 'shipped', 'cancelled'].includes(fulfilment)) return respond({ error: 'Invalid update.' }, 400);
    const r = await env.ORDERS_DB.prepare('UPDATE orders SET fulfillment_status=?, updated_at=? WHERE session_id=?').bind(fulfilment, now(), orderId).run();
    return respond({ ok: !!r.meta?.changes });
  }
  return respond({ error: 'Method not allowed.' }, 405);
}

/* Merchant refund of a completed Square payment (full or partial, in pence). */
export async function handleCreateRefund(request, env) {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  if (!merchantAuthorised(request, env)) return respond({ error: 'Unauthorized.' }, 401);
  if (!squareConfigured(env) || !hasDb(env)) return respond({ error: 'Square is not configured.' }, 503);
  let data;
  try { data = JSON.parse(await readLimitedText(request, 4096)); } catch { return respond({ error: 'Invalid JSON.' }, 400); }
  const orderId = str(data?.orderId);
  if (!validId(orderId)) return respond({ error: 'A valid orderId is required.' }, 400);
  await ensureSchema(env);
  const row = await env.ORDERS_DB.prepare('SELECT payment_id, amount_total, refunded_total, payment_status FROM orders WHERE session_id=?').bind(orderId).first();
  if (!row || row.payment_status !== 'paid' || !row.payment_id) return respond({ error: 'Only paid orders can be refunded.' }, 409);
  const already = Number(row.refunded_total) || 0;
  const remaining = Number(row.amount_total) - already;
  const amount = data?.amountPence === undefined ? remaining : data.amountPence;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > remaining) return respond({ error: 'Invalid refund amount.' }, 400);
  const result = await squareFetch(env, '/v2/refunds', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: ('r' + already + '_' + amount + '_' + orderId).slice(0, 45),
      payment_id: row.payment_id,
      amount_money: { amount, currency: 'GBP' },
      reason: str(data?.reason || 'Customer refund').slice(0, 192)
    })
  });
  const refund = result.data?.refund;
  if (!result.ok || !refund) {
    console.error('Square refund failed', result.status, result.data?.errors?.[0]?.code);
    return respond({ error: 'Refund could not be created in Square.' }, 502);
  }
  const total = already + amount;
  const full = total >= Number(row.amount_total);
  await env.ORDERS_DB.prepare(`UPDATE orders SET refund_status=?, refunded_total=?, payment_status=?, fulfillment_status=CASE WHEN ? THEN 'refunded' ELSE fulfillment_status END, updated_at=? WHERE session_id=? AND COALESCE(refunded_total,0)=?`)
    .bind(str(refund.status), total, full ? 'refunded' : 'paid', full ? 1 : 0, now(), orderId, already).run();
  return respond({ ok: true, refundId: refund.id, status: refund.status, amountPence: amount, mode: getMode(env) });
}
