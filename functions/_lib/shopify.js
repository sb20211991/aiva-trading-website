/* Shopify Storefront Cart checkout and Admin webhook verification for Cloudflare Pages Functions.
   Tokens come from Pages secrets only; nothing here is sent to the browser. */
const str = (x) => (typeof x === 'string' ? x.trim() : '');
export const SHOPIFY_DEFAULT_API_VERSION = '2026-10';
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/;

export const validVariantId = (s) => typeof s === 'string' && VARIANT_GID.test(s);
export function shopDomain(env) {
  const d = str(env.SHOPIFY_STORE_DOMAIN).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(d) ? d : '';
}
export function shopifyConfigured(env) {
  return !!(shopDomain(env) && str(env.SHOPIFY_STOREFRONT_TOKEN));
}
export function shopifyWebhookConfigured(env) {
  return str(env.SHOPIFY_WEBHOOK_SECRET).length >= 16;
}
function apiVersion(env) {
  const v = str(env.SHOPIFY_API_VERSION);
  return /^\d{4}-(01|04|07|10)$/.test(v) ? v : SHOPIFY_DEFAULT_API_VERSION;
}
/* Extra checkout hosts (e.g. a custom Shopify checkout domain), comma separated. */
export function checkoutHosts(env) {
  const extra = str(env.SHOPIFY_CHECKOUT_DOMAINS).toLowerCase().split(',').map((h) => h.trim())
    .filter((h) => /^[a-z0-9.-]{4,253}$/.test(h));
  return [shopDomain(env), ...extra].filter(Boolean);
}
export function isTrustedShopifyCheckout(env, value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host.endsWith('.myshopify.com') || checkoutHosts(env).includes(host));
  } catch {
    return false;
  }
}

export async function storefront(env, query, variables = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(`https://${shopDomain(env)}/api/${apiVersion(env)}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': str(env.SHOPIFY_STOREFRONT_TOKEN) },
      body: JSON.stringify({ query, variables }),
      signal: ctl.signal
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok && !data.errors, status: res.status, data: data.data, errors: data.errors };
  } finally {
    clearTimeout(timer);
  }
}

export async function shopifyStoreReachable(env) {
  try {
    const r = await storefront(env, '{ shop { name paymentSettings { currencyCode } } }');
    return r.ok && r.data?.shop?.paymentSettings?.currencyCode === 'GBP';
  } catch {
    return false;
  }
}

const CART_CREATE = `mutation AivaCart($input: CartInput!) {
  cartCreate(input: $input) {
    cart { id checkoutUrl cost { subtotalAmount { amount currencyCode } }
      lines(first: 50) { nodes { quantity merchandise { ... on ProductVariant { id availableForSale price { amount currencyCode } } } } } }
    userErrors { code field message }
    warnings { code message }
  }
}`;

/* Creates a Shopify cart for server-validated lines and checks Shopify agrees on every price and quantity. */
export async function createShopifyCart(env, lines, orderId, itemTotal, toMinor) {
  const input = {
    lines: lines.map(({ product, qty }) => ({ merchandiseId: product.shopifyVariantId, quantity: qty })),
    attributes: [{ key: 'aiva_order_id', value: orderId }],
    buyerIdentity: { countryCode: 'GB' },
    note: 'Aiva Trading website order ' + orderId
  };
  const r = await storefront(env, CART_CREATE, { input });
  const payload = r.data?.cartCreate;
  const cart = payload?.cart;
  if (!r.ok || !cart || payload.userErrors?.length) {
    return { error: 'create_failed', detail: payload?.userErrors?.[0]?.code || r.errors?.[0]?.message || r.status };
  }
  const got = new Map((cart.lines?.nodes || []).map((n) => [n.merchandise?.id, n]));
  for (const { product, qty } of lines) {
    const n = got.get(product.shopifyVariantId);
    if (!n || n.quantity !== qty || n.merchandise.availableForSale !== true ||
        n.merchandise.price?.currencyCode !== 'GBP' || toMinor(n.merchandise.price.amount) !== product.pricePence) {
      return { error: 'catalogue_mismatch', detail: product.sku };
    }
  }
  const sub = cart.cost?.subtotalAmount;
  if (sub?.currencyCode !== 'GBP' || toMinor(sub.amount) !== itemTotal) return { error: 'catalogue_mismatch', detail: 'subtotal' };
  if (!isTrustedShopifyCheckout(env, cart.checkoutUrl)) return { error: 'untrusted_checkout_url' };
  return { cartId: cart.id, url: cart.checkoutUrl };
}

/* Shopify signs webhooks with base64(HMAC-SHA256(app secret, raw body)). */
export async function shopifyHmac(raw, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(raw)));
  let binary = '';
  for (const b of sig) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function noteAttribute(order, name) {
  const a = (Array.isArray(order?.note_attributes) ? order.note_attributes : []).find((x) => x?.name === name);
  return str(a?.value);
}
