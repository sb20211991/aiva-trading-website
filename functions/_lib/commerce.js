/* Aiva Trading checkout for Cloudflare Pages Functions. CHECKOUT_PROVIDER selects Shopify or Square.
   Prices, stock and totals are always taken from the server catalogue, never from the browser. */
import { normaliseCatalogue, minorFromMajor } from '../../assets/aiva-money.js';
import { readLimitedText, BodyTooLarge } from './body.js';
import {
  shopifyConfigured, shopifyWebhookConfigured, shopifyStoreReachable, createShopifyCart, shopifyHmac,
  noteAttribute, validVariantId, checkoutHosts, shopDomain
} from './shopify.js';

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

export function provider(env) {
  return str(env.CHECKOUT_PROVIDER).toLowerCase() === 'shopify' ? 'shopify' : 'square';
}
const toMinor = (v) => minorFromMajor(typeof v === 'number' ? v.toFixed(2) : String(v ?? ''), 'GBP');
function squareEnvName(env) {
  const v = str(env.SQUARE_ENVIRONMENT).toLowerCase();
  if (v === 'production') return 'production';
  if (v === 'sandbox') return 'sandbox';
  return '';
}
/* Production credentials are staged under SQUARE_PRODUCTION_* so the sandbox keeps working until go-live. */
function withSquareCredentials(env) {
  if (squareEnvName(env) !== 'production') return env;
  return {
    ...env,
    SQUARE_ACCESS_TOKEN: str(env.SQUARE_PRODUCTION_ACCESS_TOKEN),
    SQUARE_LOCATION_ID: str(env.SQUARE_PRODUCTION_LOCATION_ID),
    SQUARE_WEBHOOK_SIGNATURE_KEY: str(env.SQUARE_PRODUCTION_WEBHOOK_SIGNATURE_KEY)
  };
}
function squareConfigured(env) {
  return !!(str(env.SQUARE_ACCESS_TOKEN) && str(env.SQUARE_LOCATION_ID) && squareEnvName(env));
}
function hasDb(env) {
  return !!env.ORDERS_DB && typeof env.ORDERS_DB.prepare === 'function';
}
/* Self-migrating schema: older order tables (no payment_id, payment_status CHECK without 'refunded')
   are rebuilt once inside a D1 batch transaction, keeping every existing row. */
const ORDER_COLUMNS = `session_id TEXT PRIMARY KEY, last_event_id TEXT NOT NULL,
  payment_status TEXT NOT NULL CHECK(payment_status IN ('pending','paid','failed','refunded')),
  fulfillment_status TEXT NOT NULL DEFAULT 'new' CHECK(fulfillment_status IN ('new','processing','shipped','cancelled','refunded')),
  customer_email TEXT, customer_name TEXT, amount_total INTEGER, currency TEXT, shipping_details_json TEXT, line_items_json TEXT,
  payment_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expected_total INTEGER,
  stock_applied INTEGER NOT NULL DEFAULT 0, payment_link_id TEXT, mode TEXT, paid_at INTEGER, refund_status TEXT,
  refunded_total INTEGER, review_reason TEXT`;
const ORDER_COLUMN_NAMES = ORDER_COLUMNS.split(/,\s*(?![^()]*\))/).map((c) => c.trim().split(/\s+/)[0]);
const EXTRA_ORDER_COLUMNS = [['provider', 'TEXT'], ['provider_order_ref', 'TEXT'], ['test_order', 'INTEGER']];
const schemaReady = new WeakSet();
async function ensureSchema(env) {
  const db = env.ORDERS_DB;
  if (schemaReady.has(db)) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS orders (' + ORDER_COLUMNS + ')'),
    db.prepare('CREATE TABLE IF NOT EXISTS payment_events (event_id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS refunds (refund_id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS inventory (sku TEXT PRIMARY KEY, stock INTEGER NOT NULL, updated_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  ]);
  const { results } = await db.prepare('PRAGMA table_info(orders)').all();
  const have = (results || []).map((c) => c.name);
  const ddl = (await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").first())?.sql || '';
  const current = ORDER_COLUMN_NAMES.every((c) => have.includes(c)) && /'refunded'\s*\)\s*\)\s*,\s*fulfillment_status/i.test(ddl.replace(/\s+/g, ' '));
  if (!current) {
    const common = ORDER_COLUMN_NAMES.filter((c) => have.includes(c)).join(', ');
    /* The marker insert fails for a concurrent second migrator, rolling back its whole batch. */
    await db.batch([
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES ('orders_v2', ?)").bind(now()),
      db.prepare('DROP TABLE IF EXISTS orders_v2'),
      db.prepare('CREATE TABLE orders_v2 (' + ORDER_COLUMNS + ')'),
      db.prepare(`INSERT INTO orders_v2 (${common}) SELECT ${common} FROM orders`),
      db.prepare('DROP TABLE orders'),
      db.prepare('ALTER TABLE orders_v2 RENAME TO orders'),
      db.prepare('CREATE INDEX IF NOT EXISTS orders_payment_created ON orders(payment_status,created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS orders_payment_id ON orders(payment_id)')
    ]).catch(async (error) => {
      if (!(await db.prepare("SELECT 1 FROM schema_migrations WHERE id='orders_v2'").first())) throw error;
    });
  }
  const cols = new Set(((await db.prepare('PRAGMA table_info(orders)').all()).results || []).map((c) => c.name));
  for (const [name, type] of EXTRA_ORDER_COLUMNS) {
    if (!cols.has(name)) {
      await db.prepare(`ALTER TABLE orders ADD COLUMN ${name} ${type}`).run().catch((e) => {
        if (!/duplicate column/i.test(String(e))) throw e;
      });
    }
  }
  schemaReady.add(db);
}
function webhookConfigured(env) {
  if (provider(env) === 'shopify') return shopifyWebhookConfigured(env);
  return str(env.SQUARE_WEBHOOK_SIGNATURE_KEY).length >= 16 && !!str(env.SQUARE_WEBHOOK_NOTIFICATION_URL);
}
/* Production charges need an explicit approval flag in addition to production credentials. */
/* Mode of a Square order from Square's own environment, independent of the active checkout provider. */
function squareMode(env) {
  return squareEnvName(env) === 'production' ? 'live' : 'test';
}

function getMode(env) {
  if (provider(env) === 'shopify') {
    if (!shopifyConfigured(env)) return 'disabled';
    if (env.SHOPIFY_LIVE_PAYMENTS_APPROVED === 'true') return 'live';
    /* The Storefront API cannot see the store's gateway, so test mode needs the owner to confirm a test gateway. */
    return env.SHOPIFY_TEST_GATEWAY_CONFIRMED === 'true' ? 'test' : 'disabled';
  }
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
function buyable(p, env) {
  return (
    (provider(env) !== 'shopify' || validVariantId(p?.shopifyVariantId)) &&
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
/* Products saved from merchant-tools/products.html live in D1 and replace the catalogue file. */
async function storedCatalogue(env) {
  if (!hasDb(env)) return null;
  try {
    const row = await env.ORDERS_DB.prepare('SELECT json FROM catalogue WHERE id=1').first();
    return row?.json ? JSON.parse(row.json) : null;
  } catch {
    return null;
  }
}
async function rawCatalogue(env, origin) {
  const stored = await storedCatalogue(env);
  if (stored) return stored;
  const r = await env.ASSETS.fetch(new Request(origin + '/data/aiva-products.json', { method: 'GET' }));
  if (!r.ok) throw Error('CATALOGUE_UNAVAILABLE');
  return r.json();
}
async function getCatalogue(request, env) {
  const cat = normaliseCatalogue(await rawCatalogue(env, new URL(request.url).origin));
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

function parseBasket(data, cat, env) {
  if (!data || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 20) {
    return { error: 'Choose 1–20 products.' };
  }
  const products = new Map(cat.products.filter((p) => buyable(p, env)).map((p) => [p.sku, p]));
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
  env = withSquareCredentials(env);
  try {
    const cat = await getCatalogue(request, env);
    const mode = getMode(env);
    const infra = hasDb(env) && webhookConfigured(env);
    const shopify = provider(env) === 'shopify';
    const isBuyable = (p) => buyable(p, env);
    const merchantReady = mode === 'live' ? await (shopify ? shopifyStoreReachable(env) : liveLocationReady(env)) : mode === 'test';
    return respond({
      ready: merchantReady && infra && validPolicy(cat) && cat.products.some(isBuyable) && !(mode === 'live' && cat.testOnly === true) &&
        !(shopify && mode === 'test' && cat.testOnly !== true),
      mode,
      provider: mode === 'disabled' ? null : provider(env),
      ...(shopify && mode !== 'disabled' ? { checkoutHosts: checkoutHosts(env) } : {}),
      currency: cat.currency,
      merchantReady,
      webhookConfigured: webhookConfigured(env),
      orderDatabaseConfigured: hasDb(env),
      publishedProducts: cat.products.filter(isBuyable).length,
      shopEnabled: cat.shopEnabled === true,
      stock: Object.fromEntries(cat.products.filter((p) => validSku(p.sku)).map((p) => [p.sku, validStock(p.stock) ? p.stock : 0])),
      envFlags: {
        checkoutProvider: provider(env),
        hasShopifyStoreDomain: !!shopDomain(env),
        hasShopifyStorefrontToken: str(env.SHOPIFY_STOREFRONT_TOKEN).length > 0,
        hasShopifyWebhookSecret: shopifyWebhookConfigured(env),
        hasSquareAccessToken: str(env.SQUARE_ACCESS_TOKEN).length > 0,
        hasSquareLocationId: str(env.SQUARE_LOCATION_ID).length > 0,
        squareEnvironment: squareEnvName(env) || null,
        hasWebhookSignatureKey: str(env.SQUARE_WEBHOOK_SIGNATURE_KEY).length >= 16,
        hasOrdersDb: hasDb(env),
        hasMerchantKey: str(env.MERCHANT_ADMIN_KEY || env.MERCHANT_REFUND_SECRET).length >= 24
      }
    });
  } catch {
    return respond({ ready: false, mode: 'disabled', provider: null, publishedProducts: 0, shopEnabled: false });
  }
}

export async function handleCreateCheckout(request, env) {
  env = withSquareCredentials(env);
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
  const shopify = provider(env) === 'shopify';
  if (mode === 'live' && !(await (shopify ? shopifyStoreReachable(env) : liveLocationReady(env)))) {
    return respond({ error: 'Live card payments are not yet enabled. Please contact Aiva.' }, 503);
  }
  const basket = parseBasket(data, cat, env);
  if (basket.error) return respond({ error: basket.error }, 400);
  /* Shopify test vs live is store configuration, so test mode only ever sells the labelled test catalogue. */
  if (shopify && mode === 'test' && cat.testOnly !== true) {
    return respond({ error: 'Online checkout is not yet enabled. Please contact Aiva.' }, 503);
  }
  if (shopify) return createShopifyCheckout(env, basket, mode);

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

/* Shopify calculates delivery at checkout, so the recorded expectation is the item subtotal. */
async function createShopifyCheckout(env, basket, mode) {
  const orderId = 'aiva_' + crypto.randomUUID().replace(/-/g, '');
  let cart;
  try {
    cart = await createShopifyCart(env, basket.lines, orderId, basket.itemTotal, toMinor);
  } catch (e) {
    console.error('Shopify checkout network error', String(e));
    return respond({ error: 'Payment service is temporarily unavailable.' }, 502);
  }
  if (cart.error) {
    console.error('Shopify cart failed', cart.error, cart.detail);
    return respond({ error: cart.error === 'catalogue_mismatch'
      ? 'A product price or stock level changed. Refresh the shop and try again.'
      : 'Secure checkout could not be started. Try again or contact Aiva.' }, cart.error === 'catalogue_mismatch' ? 409 : 502);
  }
  await ensureSchema(env);
  const items = basket.lines.map(({ product, qty }) => ({ sku: product.sku, name: product.name, quantity: qty, unitPence: product.pricePence, variantId: product.shopifyVariantId }));
  const t = now();
  await env.ORDERS_DB.prepare(
    `INSERT OR IGNORE INTO orders (session_id,last_event_id,payment_status,amount_total,expected_total,currency,line_items_json,payment_link_id,mode,provider,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(orderId, 'checkout_created', 'pending', basket.itemTotal, basket.itemTotal, 'gbp', JSON.stringify(items), cart.cartId, mode, 'shopify', t, t).run();
  return respond({ url: cart.url, orderId, provider: 'shopify', mode });
}

export async function handleOrderStatus(request, env) {
  env = withSquareCredentials(env);
  if (request.method !== 'GET') return respond({ error: 'Method not allowed.' }, 405);
  const params = new URL(request.url).searchParams;
  const id = str(params.get('orderId') || params.get('order_id') || params.get('session_id'));
  if (!validId(id)) return respond({ error: 'Invalid checkout reference.' }, 400);
  let row = null;
  if (hasDb(env)) {
    await ensureSchema(env);
    row = await env.ORDERS_DB.prepare('SELECT payment_status, mode, provider, provider_order_ref FROM orders WHERE session_id=?').bind(id).first();
  }
  /* Each order is checked with the provider that took it, so switching CHECKOUT_PROVIDER keeps older orders verifiable. */
  if (row ? row.provider === 'shopify' : provider(env) === 'shopify') {
    if (!hasDb(env)) return respond({ error: 'Payment verification is not configured.' }, 503);
    if (!row) return respond({ error: 'Unknown checkout reference.' }, 404);
    const paid = row.payment_status === 'paid' || row.payment_status === 'refunded';
    return respond({ paid, status: paid ? 'complete' : row.payment_status, reference: row.provider_order_ref || id.slice(-10), mode: row.mode, provider: 'shopify' });
  }
  if (!squareConfigured(env)) return respond({ error: 'Payment verification is not configured.' }, 503);
  try {
    const { ok, status, data } = await squareFetch(env, '/v2/orders/' + encodeURIComponent(id));
    if (!ok) return respond({ error: 'Could not verify this payment.' }, status === 404 ? 404 : 502);
    const order = data?.order;
    if (!order || order.metadata?.source !== ORDER_SOURCE) return respond({ error: 'Unknown order origin.' }, 404);
    const paidTender = Array.isArray(order.tenders) && order.tenders.some((t) => Number(t?.amount_money?.amount || 0) > 0);
    const paid = order.state === 'COMPLETED' || (order.state === 'OPEN' && paidTender);
    return respond({ paid, status: paid ? 'complete' : 'pending', reference: id.slice(-10), mode: row?.mode || squareMode(env), provider: 'square' });
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
function squarePaid(payment) {
  const addr = payment?.shipping_address || null;
  return {
    paymentId: str(payment?.id), amount: Number(payment?.amount_money?.amount), currency: payment?.amount_money?.currency,
    email: str(payment?.buyer_email_address), name: str([addr?.first_name, addr?.last_name].filter(Boolean).join(' ')), address: addr
  };
}
/* `amount` must equal expected_total; `amountTotal` (defaults to amount) is what the customer paid in total. */
async function applyPaid(env, origin, orderId, paid, eventId) {
  const db = env.ORDERS_DB;
  const row = await db.prepare('SELECT payment_status, expected_total, line_items_json, stock_applied FROM orders WHERE session_id=?').bind(orderId).first();
  if (!row) return { ignored: 'unknown_order' };
  const amount = paid.amount;
  if (!Number.isSafeInteger(amount) || paid.currency !== 'GBP' || amount !== Number(row.expected_total)) {
    await db.prepare(`UPDATE orders SET review_reason='amount_mismatch', last_event_id=?, updated_at=? WHERE session_id=? AND payment_status IN ('pending','failed')`)
      .bind(eventId, now(), orderId).run();
    console.error('Payment amount mismatch for order', orderId);
    return { ignored: 'amount_mismatch' };
  }
  if (paid.reviewReason) {
    await db.prepare(`UPDATE orders SET review_reason=?, last_event_id=?, updated_at=? WHERE session_id=? AND payment_status IN ('pending','failed')`)
      .bind(paid.reviewReason, eventId, now(), orderId).run();
    console.error('Payment held for review', paid.reviewReason, orderId);
    return { ignored: paid.reviewReason };
  }
  const email = str(paid.email).slice(0, 320);
  const addr = paid.address || null;
  const name = str(paid.name).slice(0, 160);
  const total = Number.isSafeInteger(paid.amountTotal) ? paid.amountTotal : amount;
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
    stmts.push(db.prepare(`UPDATE orders SET review_reason='insufficient_stock' WHERE session_id=? AND ${pendingGuard}
       AND (SELECT stock FROM inventory WHERE sku=?) < ?`).bind(orderId, orderId, it.sku, it.quantity));
    stmts.push(db.prepare(`UPDATE inventory SET stock=MAX(stock-?,0), updated_at=? WHERE sku=? AND ${pendingGuard}`).bind(it.quantity, t, it.sku, orderId));
  }
  stmts.push(db.prepare(
    `UPDATE orders SET payment_status='paid', payment_id=?, amount_total=?, customer_email=COALESCE(NULLIF(?,''),customer_email),
       customer_name=COALESCE(NULLIF(?,''),customer_name), shipping_details_json=COALESCE(?,shipping_details_json),
       provider_order_ref=COALESCE(?,provider_order_ref), test_order=COALESCE(?,test_order),
       last_event_id=?, paid_at=?, updated_at=?, stock_applied=1
     WHERE session_id=? AND stock_applied=0 AND payment_status IN ('pending','failed')`
  ).bind(str(paid.paymentId), total, email, name, addr ? JSON.stringify(addr).slice(0, 4000) : null,
    paid.providerRef || null, typeof paid.test === 'boolean' ? Number(paid.test) : null, eventId, t, t, orderId));
  const results = await db.batch(stmts);
  /* Also on retries, in case reconciliation failed after the paid batch committed. */
  if (paid.paymentId) await reconcileRefunds(db, str(paid.paymentId));
  return results.at(-1)?.meta?.changes ? { paid: true } : { duplicate: true };
}
async function getCatalogueForStock(env, origin) {
  try {
    const cat = await rawCatalogue(env, origin);
    return new Map((cat.products || []).map((p) => [p.sku, Number(p.stock) || 0]));
  } catch {
    return new Map();
  }
}

export async function handleSquareWebhook(request, env) {
  env = withSquareCredentials(env);
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
      if (p.status === 'COMPLETED') return respond({ received: true, ...(await applyPaid(env, origin, orderId, squarePaid(p), eventId)) });
      if (p.status === 'FAILED' || p.status === 'CANCELED') {
        await db.prepare(`UPDATE orders SET payment_status='failed', last_event_id=?, updated_at=? WHERE session_id=? AND payment_status='pending'`)
          .bind(eventId, now(), orderId).run();
      }
      return respond({ received: true });
    }
    if (type === 'refund.created' || type === 'refund.updated') {
      const r = obj.refund;
      const amt = Number(r?.amount_money?.amount);
      if (validId(str(r?.id)) && validId(str(r?.payment_id)) && Number.isSafeInteger(amt) && amt > 0) {
        await recordRefund(db, str(r.id), str(r.payment_id), amt, str(r.status) || 'PENDING', true);
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

/* Shopify order webhooks (orders/paid, orders/cancelled, refunds/create), matched by the cart attribute aiva_order_id. */
export async function handleShopifyWebhook(request, env) {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  if (!shopifyWebhookConfigured(env) || !hasDb(env)) return respond({ error: 'Webhook not configured.' }, 503);
  let raw;
  try { raw = await readLimitedText(request, 512000); } catch { return respond({ error: 'Webhook payload too large.' }, 413); }
  const expected = await shopifyHmac(raw, str(env.SHOPIFY_WEBHOOK_SECRET));
  if (!timingSafeEqual(expected, request.headers.get('x-shopify-hmac-sha256') || '')) return respond({ error: 'Invalid signature.' }, 401);
  const shop = str(request.headers.get('x-shopify-shop-domain')).toLowerCase();
  if (shopDomain(env) && shop && shop !== shopDomain(env)) return respond({ error: 'Unknown shop.' }, 401);
  let body;
  try { body = JSON.parse(raw); } catch { return respond({ error: 'Invalid JSON.' }, 400); }
  const topic = str(request.headers.get('x-shopify-topic'));
  const eventId = 'shopify_' + (str(request.headers.get('x-shopify-webhook-id')) || str(request.headers.get('x-shopify-event-id')));
  if (eventId === 'shopify_' || eventId.length > 191) return respond({ error: 'Invalid event.' }, 400);
  const db = env.ORDERS_DB;
  try { await ensureSchema(env); } catch (e) { console.error('schema', String(e)); return respond({ error: 'Temporary processing error.' }, 500); }
  const seen = await db.prepare('INSERT OR IGNORE INTO payment_events (event_id, processed_at) VALUES (?,?)').bind(eventId, now()).run();
  if (!seen.meta?.changes) return respond({ received: true, duplicate: true });
  try {
    if (topic === 'orders/paid' || topic === 'orders/create') {
      const orderId = noteAttribute(body, 'aiva_order_id');
      if (!validId(orderId)) return respond({ received: true, ignored: 'not_website_order' });
      const ref = str(body.name).slice(0, 40) || null;
      await db.prepare('UPDATE orders SET provider_order_ref=COALESCE(provider_order_ref,?), payment_id=COALESCE(payment_id,?), updated_at=? WHERE session_id=?')
        .bind(ref, String(body.id || '') || null, now(), orderId).run();
      if (topic === 'orders/create' && body.financial_status !== 'paid') return respond({ received: true });
      const addr = body.shipping_address || null;
      const stored = await db.prepare('SELECT line_items_json FROM orders WHERE session_id=?').bind(orderId).first();
      const linesMatch = stored ? shopifyLinesMatch(stored.line_items_json, body.line_items) : true;
      return respond({ received: true, ...(await applyPaid(env, new URL(request.url).origin, orderId, {
        paymentId: String(body.id || ''), amount: toMinor(body.current_subtotal_price ?? body.subtotal_price),
        amountTotal: toMinor(body.current_total_price ?? body.total_price), currency: body.currency,
        email: str(body.contact_email || body.email || body.customer?.email),
        name: str(addr?.name || [addr?.first_name, addr?.last_name].filter(Boolean).join(' ')), address: addr,
        providerRef: ref, test: body.test === true,
        reviewReason: getMode(env) === 'test' && body.test !== true ? 'live_payment_in_test_mode' : linesMatch ? '' : 'line_items_mismatch'
      }, eventId)) });
    }
    if (topic === 'orders/cancelled') {
      const orderId = noteAttribute(body, 'aiva_order_id');
      if (validId(orderId)) {
        await db.prepare(`UPDATE orders SET payment_status=CASE WHEN payment_status='pending' THEN 'failed' ELSE payment_status END,
            fulfillment_status=CASE WHEN fulfillment_status IN ('new','processing') THEN 'cancelled' ELSE fulfillment_status END,
            last_event_id=?, updated_at=? WHERE session_id=?`).bind(eventId, now(), orderId).run();
      }
      return respond({ received: true });
    }
    if (topic === 'refunds/create') {
      const tx = (Array.isArray(body.transactions) ? body.transactions : []).filter((x) => x?.kind === 'refund');
      const amount = tx.filter((x) => x.status !== 'failure' && x.status !== 'error').reduce((n, x) => n + (toMinor(x.amount) || 0), 0);
      const status = tx.some((x) => x.status === 'pending') ? 'PENDING' : tx.length && tx.every((x) => x.status === 'success') ? 'COMPLETED' : 'FAILED';
      if (body.id && body.order_id && Number.isSafeInteger(amount) && amount > 0) {
        await recordRefund(db, 'shopify_' + body.id, String(body.order_id), amount, status, true);
      }
      return respond({ received: true });
    }
    return respond({ received: true });
  } catch (e) {
    await db.prepare('DELETE FROM payment_events WHERE event_id=?').bind(eventId).run();
    console.error('Shopify webhook processing failed', String(e));
    return respond({ error: 'Temporary processing error.' }, 500);
  }
}

/* The buyer can edit a Shopify cart before paying, so paid quantities must equal the stored basket. */
function shopifyLinesMatch(storedJson, lineItems) {
  let want = [];
  try { want = JSON.parse(storedJson || '[]'); } catch { return false; }
  const got = new Map();
  for (const li of Array.isArray(lineItems) ? lineItems : []) {
    const id = 'gid://shopify/ProductVariant/' + li?.variant_id;
    got.set(id, (got.get(id) || 0) + Number(li?.quantity));
  }
  return got.size === want.length && want.every((it) => got.get(it.variantId) === it.quantity);
}

function merchantAuthorised(request, env) {
  const secret = str(env.MERCHANT_ADMIN_KEY || env.MERCHANT_REFUND_SECRET);
  const auth = str(request.headers.get('Authorization')).replace(/^Bearer\s+/i, '');
  return secret.length >= 24 && timingSafeEqual(secret, auth);
}

/* Merchant order management: GET lists orders, POST updates fulfilment status. */
export async function handleAdminOrders(request, env) {
  env = withSquareCredentials(env);
  if (!merchantAuthorised(request, env)) return respond({ error: 'Unauthorized.' }, 401);
  if (!hasDb(env)) return respond({ error: 'Order database not configured.' }, 503);
  await ensureSchema(env);
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const status = str(params.get('status'));
    const limit = Math.min(Math.max(parseInt(params.get('limit') || '50', 10) || 50, 1), 200);
    const sql = 'SELECT session_id AS orderId, provider, provider_order_ref, test_order, payment_status, review_reason, fulfillment_status, customer_email, customer_name, amount_total, refunded_total, currency, line_items_json, shipping_details_json, payment_id, mode, created_at, paid_at, updated_at FROM orders' +
      (status ? ' WHERE payment_status=?' : '') + ' ORDER BY created_at DESC LIMIT ?';
    const stmt = status ? env.ORDERS_DB.prepare(sql).bind(status, limit) : env.ORDERS_DB.prepare(sql).bind(limit);
    const { results } = await stmt.all();
    const inv = await env.ORDERS_DB.prepare('SELECT sku, stock, updated_at FROM inventory ORDER BY sku').all();
    return respond({ orders: results || [], inventory: inv.results || [] });
  }
  if (request.method === 'POST') {
    let data;
    try { data = JSON.parse(await readLimitedText(request, 4096)); } catch { return respond({ error: 'Invalid JSON.' }, 400); }
    if (data?.sku !== undefined) {
      if (!validSku(data.sku) || !validStock(data.stock)) return respond({ error: 'Invalid stock update.' }, 400);
      await env.ORDERS_DB.prepare('INSERT INTO inventory (sku, stock, updated_at) VALUES (?,?,?) ON CONFLICT(sku) DO UPDATE SET stock=excluded.stock, updated_at=excluded.updated_at')
        .bind(data.sku, data.stock, now()).run();
      return respond({ ok: true });
    }
    const orderId = str(data?.orderId), fulfilment = str(data?.fulfillmentStatus);
    if (!validId(orderId) || !['new', 'processing', 'shipped', 'cancelled'].includes(fulfilment)) return respond({ error: 'Invalid update.' }, 400);
    const r = await env.ORDERS_DB.prepare('UPDATE orders SET fulfillment_status=?, updated_at=? WHERE session_id=?').bind(fulfilment, now(), orderId).run();
    return respond({ ok: !!r.meta?.changes });
  }
  return respond({ error: 'Method not allowed.' }, 405);
}

/* Merchant refund of a completed Square payment (full or partial, in pence). */
/* Each refund is tracked by its Square id, so failures only release their own amount and
   Dashboard refunds are counted too. refunded_total = refunds not FAILED/REJECTED. */
async function reconcileRefunds(db, paymentId) {
  const t = now();
  await db.prepare(
    `UPDATE orders SET
       refunded_total=(SELECT COALESCE(SUM(amount),0) FROM refunds WHERE payment_id=? AND status NOT IN ('FAILED','REJECTED')),
       refund_status=(SELECT status FROM refunds WHERE payment_id=? ORDER BY updated_at DESC, rowid DESC LIMIT 1),
       payment_status=CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM refunds WHERE payment_id=? AND status NOT IN ('FAILED','REJECTED')) >= amount_total THEN 'refunded' ELSE 'paid' END,
       fulfillment_status=CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM refunds WHERE payment_id=? AND status='COMPLETED') >= amount_total THEN 'refunded' ELSE fulfillment_status END,
       updated_at=?
     WHERE payment_id=? AND payment_status IN ('paid','refunded')`
  ).bind(paymentId, paymentId, paymentId, paymentId, t, paymentId).run();
}
async function recordRefund(db, refundId, paymentId, amount, status, fromWebhook) {
  const t = now();
  await db.prepare(
    fromWebhook
      ? `INSERT INTO refunds (refund_id, payment_id, amount, status, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(refund_id) DO UPDATE SET status=CASE WHEN refunds.status IN ('COMPLETED','FAILED','REJECTED') THEN refunds.status ELSE excluded.status END, amount=excluded.amount, updated_at=excluded.updated_at`
      : `INSERT INTO refunds (refund_id, payment_id, amount, status, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(refund_id) DO NOTHING`
  ).bind(refundId, paymentId, amount, status, t).run();
  await reconcileRefunds(db, paymentId);
}

export async function handleCreateRefund(request, env) {
  env = withSquareCredentials(env);
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  if (!merchantAuthorised(request, env)) return respond({ error: 'Unauthorized.' }, 401);
  if (!hasDb(env)) return respond({ error: 'Order database is not configured.' }, 503);
  let data;
  try { data = JSON.parse(await readLimitedText(request, 4096)); } catch { return respond({ error: 'Invalid JSON.' }, 400); }
  const orderId = str(data?.orderId);
  if (!validId(orderId)) return respond({ error: 'A valid orderId is required.' }, 400);
  await ensureSchema(env);
  const row = await env.ORDERS_DB.prepare('SELECT provider, mode, payment_id, amount_total, refunded_total, payment_status FROM orders WHERE session_id=?').bind(orderId).first();
  if (row ? row.provider === 'shopify' : provider(env) === 'shopify') {
    return respond({ error: 'Refund Shopify orders in Shopify admin (Orders → Refund). The website records refunds automatically.' }, 409);
  }
  if (!squareConfigured(env)) return respond({ error: 'Square is not configured.' }, 503);
  if (!row || row.payment_status !== 'paid' || !row.payment_id) return respond({ error: 'Only paid orders can be refunded.' }, 409);
  const already = Number(row.refunded_total) || 0;
  const remaining = Number(row.amount_total) - already;
  const amount = data?.amountPence === undefined ? remaining : data.amountPence;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > remaining) return respond({ error: 'Invalid refund amount.' }, 400);
  /* Same key until Square's answer for this attempt is recorded, so a lost response cannot refund twice. */
  const attempts = (await env.ORDERS_DB.prepare('SELECT COUNT(*) AS n FROM refunds WHERE payment_id=?').bind(row.payment_id).first())?.n || 0;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(orderId)));
  const key = ('r' + attempts + '_' + amount + '_' + Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')).slice(0, 45);
  const result = await squareFetch(env, '/v2/refunds', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: key,
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
  await recordRefund(env.ORDERS_DB, str(refund.id), row.payment_id, amount, str(refund.status) || 'PENDING', false);
  return respond({ ok: true, refundId: refund.id, status: refund.status, amountPence: amount, mode: row.mode || squareMode(env) });
}

export async function handlePublicCatalogue(request, env) {
  const stored = await storedCatalogue(env);
  return stored ? respond(stored) : env.ASSETS.fetch(request);
}

const validImageRef = (v) => /^(https:\/\/[^\s"'<>]+|\/api\/product-image\/[a-f0-9-]{36}|assets\/[a-zA-Z0-9_-]+\.(webp|png|jpe?g|avif))$/.test(v);
const optionalText = (v, max) => v === undefined || v === null || v === '' || (typeof v === 'string' && v.length <= max);
function cleanProduct(p) {
  if (!p || !validSku(p.sku) || typeof p.name !== 'string' || p.name.trim().length < 2 || p.name.length > 140) return null;
  if (typeof p.description !== 'string' || p.description.length > 700) return null;
  if (typeof p.category !== 'string' || !p.category.trim() || p.category.length > 80) return null;
  if (!validPrice(p.pricePence) || !validStock(p.stock) || typeof p.available !== 'boolean') return null;
  if (!optionalText(p.image, 500) || (p.image && !validImageRef(p.image))) return null;
  if (!optionalText(p.brand, 80)) return null;
  const out = { sku: p.sku, name: p.name.trim(), description: p.description.trim(), category: p.category.trim(),
    pricePence: p.pricePence, stock: p.stock, available: p.available };
  if (p.hidden === true) out.hidden = true;
  if (p.image) out.image = p.image;
  if (p.brand) out.brand = p.brand.trim();
  if (Array.isArray(p.specifications)) out.specifications = p.specifications.filter((x) => typeof x === 'string' && x.length <= 200).slice(0, 20);
  else if (typeof p.specifications === 'string' && p.specifications.length <= 1000) out.specifications = p.specifications;
  if (validVariantId(p.shopifyVariantId)) out.shopifyVariantId = p.shopifyVariantId;
  return out;
}

/* Merchant product editor: GET returns the live catalogue, POST replaces its product list. */
export async function handleAdminProducts(request, env) {
  if (!merchantAuthorised(request, env)) return respond({ error: 'Unauthorized.' }, 401);
  if (!hasDb(env)) return respond({ error: 'Order database not configured.' }, 503);
  const db = env.ORDERS_DB;
  await ensureSchema(env);
  await db.prepare('CREATE TABLE IF NOT EXISTS catalogue (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  const current = await rawCatalogue(env, new URL(request.url).origin);
  if (request.method === 'GET') {
    const overrides = await stockOverrides(env);
    const products = (current.products || []).map((p) => (overrides.has(p.sku) ? { ...p, stock: Math.max(0, overrides.get(p.sku)) } : p));
    return respond({ catalogue: { ...current, products } });
  }
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  let data;
  try { data = JSON.parse(await readLimitedText(request, 400000)); } catch { return respond({ error: 'Invalid JSON.' }, 400); }
  if (!Array.isArray(data?.products) || data.products.length > 500) return respond({ error: 'Send a list of up to 500 products.' }, 400);
  const products = [], stockChanged = [], skus = new Set();
  for (const [i, raw] of data.products.entries()) {
    const p = cleanProduct(raw);
    if (!p) return respond({ error: 'Product ' + (i + 1) + ' is incomplete or invalid. Check SKU, name, category, price and stock.' }, 400);
    if (skus.has(p.sku)) return respond({ error: 'SKU ' + p.sku + ' is used twice.' }, 400);
    skus.add(p.sku);
    products.push(p);
    /* Only stock the merchant actually changed is written, so sales made while the editor was open are kept. */
    if (raw.loadedStock !== p.stock) stockChanged.push(p);
  }
  const categories = Array.from(new Set([...(Array.isArray(current.categories) ? current.categories : []), ...products.map((p) => p.category)]));
  const next = { ...current, categories, products };
  const t = now();
  await db.batch([
    db.prepare('INSERT INTO catalogue (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at').bind(JSON.stringify(next), t),
    ...stockChanged.map((p) => db.prepare('INSERT INTO inventory (sku, stock, updated_at) VALUES (?,?,?) ON CONFLICT(sku) DO UPDATE SET stock=excluded.stock, updated_at=excluded.updated_at').bind(p.sku, p.stock, t))
  ]);
  return respond({ ok: true, products: products.length });
}

const IMAGE_TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };
async function ensureImageTable(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS product_images (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL)').run();
}

/* Merchant photo upload: the editor sends a resized data URL, stored in D1 and served by handleProductImage. */
export async function handleAdminProductImage(request, env) {
  if (!merchantAuthorised(request, env)) return respond({ error: 'Unauthorized.' }, 401);
  if (!hasDb(env)) return respond({ error: 'Order database not configured.' }, 503);
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  let body;
  try { body = JSON.parse(await readLimitedText(request, 1500000)); } catch { return respond({ error: 'Photo is too large or invalid. Try a smaller photo.' }, 400); }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(str(body?.dataUrl));
  if (!m || !IMAGE_TYPES[m[1]]) return respond({ error: 'Use a JPG, PNG or WebP photo.' }, 400);
  const id = crypto.randomUUID();
  await ensureImageTable(env.ORDERS_DB);
  await env.ORDERS_DB.prepare('INSERT INTO product_images (id, mime, data, created_at) VALUES (?,?,?,?)').bind(id, m[1], m[2], now()).run();
  return respond({ ok: true, url: '/api/product-image/' + id });
}

export async function handleProductImage(request, env, id) {
  if (!hasDb(env) || !/^[a-f0-9-]{36}$/.test(str(id))) return new Response('Not found', { status: 404 });
  let row = null;
  try { row = await env.ORDERS_DB.prepare('SELECT mime, data FROM product_images WHERE id=?').bind(id).first(); } catch { row = null; }
  if (!row) return new Response('Not found', { status: 404 });
  const bin = atob(row.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}
