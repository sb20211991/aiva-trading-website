/* Aiva Pay: product checkout inside the Super App (app.aivatrading.uk).
   Products and prices come from the live Aiva Trading catalogue (the website's /data/aiva-products.json), checked
   server-side; the app never trusts a price sent by the browser.

   Payment methods
   - Card, Apple Pay and Google Pay, Alipay (支付宝) and WeChat Pay (微信支付): Stripe Checkout, using Aiva Trading's
     own Stripe account (STRIPE_SECRET_KEY). Apple Pay and Google Pay are offered by Stripe on the card page on devices
     that support them. Alipay and WeChat Pay are only offered once Stripe reports the account's
     alipay_payments / wechat_pay_payments capability as active, so the app never shows a method that would fail.
     GBP and Chinese yuan (CNY) are offered; Stripe settles CNY payments to the account's GBP balance.
   - Bitcoin and other cryptocurrencies: BitPay invoices (BITPAY_TOKEN, a POS-facade token), priced in GBP; BitPay
     settles to the merchant in GBP. Stripe's own crypto payments are stablecoin-only and US-only, and Coinbase
     Commerce closed to UK merchants in March 2026, so BitPay is the eligible provider here.

   Live money only moves with a live key AND AIVA_PAY_LIVE="true" (production). Test keys take test payments only.
   No card, wallet or crypto data ever reaches Aiva's servers: every payment is completed on the provider's page. */
import { json, fetchJSON, cached } from './emergency.js';
import { ratesFor } from './finance.js';

export const STRIPE = 'https://api.stripe.com/v1';
export const STRIPE_VERSION = '2024-06-20';
export const BITPAY = { prod: 'https://bitpay.com', test: 'https://test.bitpay.com' };
export const CURRENCIES = ['GBP', 'CNY'];
export const METHODS = [
  { id: 'card', label: 'Card', icon: 'card', provider: 'stripe', stripe: 'card', currencies: CURRENCIES },
  { id: 'apple_pay', label: 'Apple Pay', icon: 'apple_pay', provider: 'stripe', stripe: 'card', currencies: CURRENCIES, wallet: true },
  { id: 'google_pay', label: 'Google Pay', icon: 'google_pay', provider: 'stripe', stripe: 'card', currencies: CURRENCIES, wallet: true },
  { id: 'alipay', label: 'Alipay 支付宝', icon: 'alipay', provider: 'stripe', stripe: 'alipay', capability: 'alipay_payments', currencies: CURRENCIES },
  { id: 'wechat_pay', label: 'WeChat Pay 微信支付', icon: 'wechat_pay', provider: 'stripe', stripe: 'wechat_pay', capability: 'wechat_pay_payments', currencies: CURRENCIES },
  { id: 'crypto', label: 'Bitcoin & crypto', icon: 'crypto', provider: 'bitpay', currencies: ['GBP'] }
];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const validSku = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{2,60}$/.test(s);
const validPence = (n) => Number.isSafeInteger(n) && n > 0 && n <= 100000000;

/* ---------- configuration ---------- */
export const stripeKey = (env) => str(env.STRIPE_SECRET_KEY);
export const isLiveStripeKey = (k) => /^(sk|rk)_live_/.test(k || '');
export const isTestStripeKey = (k) => /^(sk|rk)_test_/.test(k || '');
export const liveAllowed = (env) => str(env.AIVA_PAY_LIVE).toLowerCase() === 'true';
export function stripeState(env) {
  const k = stripeKey(env);
  if (!k) return { ready: false, reason: 'Stripe is not connected yet' };
  if (isLiveStripeKey(k)) return liveAllowed(env) ? { ready: true, testMode: false } : { ready: false, reason: 'Live Stripe payments are switched off on this deployment' };
  if (isTestStripeKey(k)) return { ready: true, testMode: true };
  return { ready: false, reason: 'The Stripe key is not a secret or restricted key' };
}
export function bitpayState(env) {
  const token = str(env.BITPAY_TOKEN), mode = str(env.BITPAY_ENV).toLowerCase() === 'prod' ? 'prod' : 'test';
  if (!token) return { ready: false, reason: 'Crypto payments are not connected yet' };
  if (mode === 'prod' && !liveAllowed(env)) return { ready: false, reason: 'Live crypto payments are switched off on this deployment' };
  return { ready: true, testMode: mode === 'test', base: BITPAY[mode] };
}

/* ---------- Stripe ---------- */
/* Stripe expects application/x-www-form-urlencoded with bracketed keys for nested objects and arrays. */
export function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === 'object' ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
export async function stripe(env, method, path, body, fetcher = fetch, idem = '') {
  const res = await fetcher(`${STRIPE}${path}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${stripeKey(env)}`, 'Stripe-Version': STRIPE_VERSION, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
    ...(body ? { body: form(body).toString() } : {})
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON reply */ }
  if (!res.ok) throw Object.assign(new Error(str(data?.error?.message).slice(0, 240) || `Stripe HTTP ${res.status}`), { status: res.status >= 500 ? 502 : 400, code: data?.error?.code || '' });
  return data;
}
/* Which Stripe payment capabilities are active on the account, e.g. {card_payments:'active', alipay_payments:'inactive'}. */
export async function stripeCapabilities(env, fetcher = fetch, useCache = true) {
  const load = async () => (await stripe(env, 'GET', '/account', null, fetcher))?.capabilities || {};
  return useCache ? cached(`aiva-pay-caps-${isLiveStripeKey(stripeKey(env)) ? 'live' : 'test'}`, 300, load) : load();
}

/* ---------- catalogue ---------- */
export const catalogueUrl = (env) => `${str(env.WEBSITE_ORIGIN) || 'https://aiva-trading.pages.dev'}/data/aiva-products.json`;
export async function catalogue(env, fetcher = fetch) {
  const c = await fetchJSON(catalogueUrl(env), {}, fetcher, 12000);
  const open = c && c.shopEnabled === true && c.currency === 'GBP' && Array.isArray(c.products);
  const products = open ? c.products.filter((p) => p && validSku(p.sku) && p.available === true && p.hidden !== true &&
    typeof p.name === 'string' && p.name.trim().length > 1 && validPence(p.pricePence) && Number.isSafeInteger(p.stock) && p.stock > 0)
    .map((p) => ({ sku: p.sku, name: p.name.trim().slice(0, 140), description: str(p.description).slice(0, 300), category: str(p.category).slice(0, 80),
      pricePence: p.pricePence, stock: Math.min(p.stock, 99), image: str(p.image).slice(0, 500) })) : [];
  const countries = Array.isArray(c?.shipping?.allowedCountries) ? c.shipping.allowedCountries.filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 50) : [];
  const flat = Number.isSafeInteger(c?.shipping?.flatRatePence) && c.shipping.flatRatePence >= 0 ? c.shipping.flatRatePence : 0;
  return { open: open && products.length > 0, products, shipping: { countries: countries.length ? countries : ['GB'], flatRatePence: flat },
    returnsPolicy: str(c?.returnsPolicy).slice(0, 400), deliveryPolicy: str(c?.deliveryPolicy).slice(0, 400) };
}

/* ---------- pricing ---------- */
/* GBP prices are the catalogue's own. CNY prices are converted server-side from the live mid-market rate (Coinbase,
   then the ECB) at the moment the checkout is created, rounded up to the next fen, and the rate is shown to the payer. */
export async function quote(pricePence, qty, currency, shippingPence, fetcher = fetch) {
  const gbp = pricePence * qty + shippingPence;
  if (currency === 'GBP') return { currency, unit: pricePence, shipping: shippingPence, total: gbp, rate: 1, rateSource: 'catalogue price' };
  const fx = await ratesFor('GBP', fetcher);
  const r = fx.rates.CNY, src = fx.sources.CNY;
  if (!(r > 0) || !['live', 'ecb'].includes(src)) throw Object.assign(new Error('A live GBP to CNY rate is not available right now. Pay in GBP, or try again shortly.'), { status: 503 });
  const conv = (p) => Math.ceil((p * r) - 1e-9);
  const unit = conv(pricePence), shipping = shippingPence ? conv(shippingPence) : 0;
  return { currency, unit, shipping, total: unit * qty + shipping, rate: r, rateSource: src === 'live' ? 'Coinbase live mid-market rate' : 'European Central Bank reference rate', rateAt: fx.live || fx.date };
}

/* ---------- handlers ---------- */
export function sameSite(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (hostname === new URL(request.url).hostname) return true;
    if (protocol === 'https:' && /^app\.aivatrading\.uk$|(^|\.)aiva-pocket-hub\.pages\.dev$/.test(hostname)) return true;
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch { return false; }
}

/* GET /api/pay/methods -> products on sale and every payment method with its real availability. */
export async function methodsHandler(request, env, fetcher = fetch, useCache = true) {
  const st = stripeState(env), bp = bitpayState(env);
  let caps = {}, capsError = '';
  if (st.ready) { try { caps = await stripeCapabilities(env, fetcher, useCache); } catch (e) { capsError = e.message; } }
  const methods = METHODS.map((m) => {
    const base = { id: m.id, label: m.label, icon: m.icon, currencies: m.currencies, wallet: !!m.wallet };
    if (m.provider === 'bitpay') return { ...base, available: bp.ready, testMode: bp.ready ? bp.testMode : undefined, reason: bp.ready ? '' : bp.reason };
    if (!st.ready) return { ...base, available: false, reason: st.reason };
    if (capsError) return { ...base, available: false, reason: 'Stripe could not be reached' };
    const need = m.capability || 'card_payments';
    const ok = caps[need] === 'active';
    return { ...base, available: ok, testMode: ok ? st.testMode : undefined,
      reason: ok ? '' : caps[need] === 'pending' ? 'Waiting for Stripe to approve this payment method' : 'Not yet activated on the Stripe account' };
  });
  let cat = { open: false, products: [], shipping: { countries: ['GB'], flatRatePence: 0 } }, catError = '';
  try { cat = await catalogue(env, fetcher); } catch (e) { catError = 'The product catalogue could not be loaded'; }
  return json({ open: cat.open && methods.some((m) => m.available), products: cat.products, shipping: cat.shipping,
    deliveryPolicy: cat.deliveryPolicy || '', returnsPolicy: cat.returnsPolicy || '', currencies: CURRENCIES, methods,
    ...(catError ? { catalogueError: catError } : {}),
    note: 'Payments are completed on Stripe or BitPay. Aiva never sees card, wallet or crypto details.' });
}

/* POST /api/pay/checkout {sku, qty, method, currency, email?} -> {url} of the provider's payment page. */
export async function checkoutHandler(request, env, fetcher = fetch) {
  if (!sameSite(request)) return json({ error: 'Origin not allowed' }, 403);
  let b = null;
  try { b = await request.json(); } catch { return json({ error: 'Send JSON' }, 400); }
  const m = METHODS.find((x) => x.id === str(b?.method));
  const currency = str(b?.currency).toUpperCase() || 'GBP';
  const qty = Number(b?.qty ?? 1);
  if (!m) return json({ error: 'Choose a payment method' }, 400);
  if (!m.currencies.includes(currency)) return json({ error: `${m.label} is offered in ${m.currencies.join(' or ')}` }, 400);
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 10) return json({ error: 'Choose a quantity from 1 to 10' }, 400);
  const email = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(str(b?.email)) ? str(b.email) : '';
  let cat;
  try { cat = await catalogue(env, fetcher); } catch { return json({ error: 'The product catalogue could not be loaded. Try again shortly.' }, 502); }
  const p = cat.products.find((x) => x.sku === str(b?.sku));
  if (!cat.open || !p) return json({ error: 'This product is not on sale right now' }, 404);
  if (qty > p.stock) return json({ error: `Only ${p.stock} in stock` }, 409);
  const origin = new URL(request.url).origin, ref = `AIVA-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  if (m.provider === 'bitpay') {
    const bp = bitpayState(env);
    if (!bp.ready) return json({ error: bp.reason }, 503);
    const total = p.pricePence * qty + cat.shipping.flatRatePence;
    try {
      const res = await fetcher(`${bp.base}/invoices`, { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Accept-Version': '2.0.0' },
        body: JSON.stringify({ token: str(env.BITPAY_TOKEN), price: total / 100, currency: 'GBP', orderId: ref,
          itemDesc: `${p.name} × ${qty}`.slice(0, 100), ...(email ? { buyer: { email } } : {}),
          redirectURL: `${origin}/?aivaPay=crypto&ref=${encodeURIComponent(ref)}#trade`, closeURL: `${origin}/?aivaPay=cancelled#trade`,
          posData: JSON.stringify({ app: 'aiva-pocket-hub', sku: p.sku, qty }) }) });
      const d = await res.json().catch(() => null);
      const inv = d?.data;
      if (!res.ok || !inv?.url || !inv?.id) return json({ error: str(d?.error).slice(0, 200) || 'BitPay could not create the invoice' }, 502);
      return json({ provider: 'bitpay', url: inv.url, invoiceId: inv.id, ref, testMode: bp.testMode, total, currency: 'GBP' });
    } catch { return json({ error: 'BitPay could not be reached. Try again shortly.' }, 502); }
  }

  const st = stripeState(env);
  if (!st.ready) return json({ error: st.reason }, 503);
  if (m.capability) {
    try { const caps = await stripeCapabilities(env, fetcher); if (caps[m.capability] !== 'active') return json({ error: `${m.label} is not yet activated on the Stripe account` }, 503); }
    catch { return json({ error: 'Stripe could not be reached. Try again shortly.' }, 502); }
  }
  let q;
  try { q = await quote(p.pricePence, qty, currency, cat.shipping.flatRatePence, fetcher); } catch (e) { return json({ error: e.message }, e.status || 502); }
  const body = {
    mode: 'payment', client_reference_id: ref, locale: m.id === 'alipay' || m.id === 'wechat_pay' ? 'zh' : 'auto',
    payment_method_types: [m.stripe],
    ...(m.stripe === 'wechat_pay' ? { payment_method_options: { wechat_pay: { client: 'web' } } } : {}),
    line_items: [{ quantity: qty, price_data: { currency: currency.toLowerCase(), unit_amount: q.unit,
      product_data: { name: p.name, ...(p.description ? { description: p.description } : {}), metadata: { sku: p.sku } } } }],
    shipping_address_collection: { allowed_countries: cat.shipping.countries },
    ...(q.shipping ? { shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', display_name: 'Delivery', fixed_amount: { amount: q.shipping, currency: currency.toLowerCase() } } }] } : {}),
    phone_number_collection: { enabled: true },
    ...(email ? { customer_email: email } : {}),
    success_url: `${origin}/?aivaPay=stripe&session_id={CHECKOUT_SESSION_ID}#trade`,
    cancel_url: `${origin}/?aivaPay=cancelled#trade`,
    metadata: { app: 'aiva-pocket-hub', sku: p.sku, qty: String(qty), method: m.id, ref,
      ...(currency !== 'GBP' ? { gbp_total_pence: String(p.pricePence * qty + cat.shipping.flatRatePence), fx_rate: String(q.rate), fx_source: q.rateSource } : {}) },
    payment_intent_data: { description: `Aiva ${ref}: ${p.name} × ${qty}`.slice(0, 200), metadata: { app: 'aiva-pocket-hub', sku: p.sku, ref } }
  };
  try {
    const s = await stripe(env, 'POST', '/checkout/sessions', body, fetcher, ref);
    if (!s?.url) return json({ error: 'Stripe did not return a payment page' }, 502);
    return json({ provider: 'stripe', url: s.url, sessionId: s.id, ref, testMode: st.testMode, total: q.total, currency, rate: q.rate, rateSource: q.rateSource });
  } catch (e) { return json({ error: e.message || 'Stripe could not start the payment' }, e.status || 502); }
}

/* GET /api/pay/status?session_id=cs_... | ?invoice=... -> whether the payment really completed, read from the provider. */
export async function statusHandler(request, env, fetcher = fetch) {
  const u = new URL(request.url), sid = str(u.searchParams.get('session_id')), inv = str(u.searchParams.get('invoice'));
  if (/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) {
    if (!stripeState(env).ready) return json({ error: 'Stripe is not connected' }, 503);
    try {
      const s = await stripe(env, 'GET', `/checkout/sessions/${encodeURIComponent(sid)}`, null, fetcher);
      if (s?.metadata?.app !== 'aiva-pocket-hub') return json({ error: 'Unknown payment' }, 404);
      return json({ provider: 'stripe', paid: s.payment_status === 'paid', status: s.payment_status, ref: s.client_reference_id || s.metadata.ref || '',
        total: s.amount_total, currency: String(s.currency || '').toUpperCase(), method: s.metadata.method || '', testMode: !s.livemode,
        email: s.customer_details?.email ? s.customer_details.email.replace(/^(.).*(@.*)$/, '$1…$2') : '' });
    } catch (e) { return json({ error: e.message }, e.status || 502); }
  }
  if (/^[A-Za-z0-9]{10,64}$/.test(inv)) {
    const bp = bitpayState(env);
    if (!bp.ready) return json({ error: bp.reason }, 503);
    try {
      const d = await fetchJSON(`${bp.base}/invoices/${encodeURIComponent(inv)}?token=${encodeURIComponent(str(env.BITPAY_TOKEN))}`, { headers: { 'X-Accept-Version': '2.0.0' } }, fetcher, 15000);
      const i = d?.data || {};
      let pos = {}; try { pos = JSON.parse(i.posData || '{}'); } catch {}
      if (pos.app !== 'aiva-pocket-hub') return json({ error: 'Unknown payment' }, 404);
      return json({ provider: 'bitpay', paid: ['paid', 'confirmed', 'complete'].includes(i.status), status: i.status || '', ref: i.orderId || '',
        total: Math.round(Number(i.price) * 100), currency: i.currency || 'GBP', method: 'crypto', testMode: bp.testMode });
    } catch (e) { return json({ error: 'BitPay could not be reached' }, 502); }
  }
  return json({ error: 'Payment reference missing' }, 400);
}
