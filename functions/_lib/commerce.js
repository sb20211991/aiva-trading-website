/* Shared checkout for Cloudflare Pages Functions.
   Square is the primary provider. PayPal is optional. Stripe is retired. */
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};
const SQUARE_VERSION = '2025-10-16';
export const respond = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
const str = (x) => (typeof x === 'string' ? x.trim() : '');
const validPrice = (n) => Number.isSafeInteger(n) && n > 0 && n <= 100000000;
const validStock = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100000;
const validSku = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{2,60}$/.test(s);
const safeCountries = (c) =>
  Array.isArray(c) &&
  c.length > 0 &&
  c.length <= 12 &&
  c.every((x) => typeof x === 'string' && /^[A-Z]{2}$/.test(x));

function squareEnvName(env) {
  const v = str(env.SQUARE_ENVIRONMENT).toLowerCase();
  if (v === 'production' || v === 'live') return 'production';
  if (v === 'sandbox' || v === 'test') return 'sandbox';
  return '';
}
function paypalEnvName(env) {
  const v = str(env.PAYPAL_ENVIRONMENT).toLowerCase();
  if (v === 'production' || v === 'live') return 'live';
  if (v === 'sandbox' || v === 'test') return 'sandbox';
  return '';
}
function squareConfigured(env) {
  return !!(str(env.SQUARE_ACCESS_TOKEN) && str(env.SQUARE_LOCATION_ID) && squareEnvName(env));
}
function paypalConfigured(env) {
  return !!(str(env.PAYPAL_CLIENT_ID) && str(env.PAYPAL_CLIENT_SECRET) && paypalEnvName(env));
}

/** Default checkout provider: Square first. PayPal is opt-in per request. */
export function getDefaultProvider(env) {
  if (squareConfigured(env)) return 'square';
  if (paypalConfigured(env)) return 'paypal';
  return 'none';
}

export function availableProviders(env) {
  const list = [];
  if (squareConfigured(env)) list.push('square');
  if (paypalConfigured(env)) list.push('paypal');
  return list;
}

export function getModeForProvider(env, provider) {
  if (provider === 'square') return squareEnvName(env) === 'production' ? 'live' : squareConfigured(env) ? 'test' : 'disabled';
  if (provider === 'paypal') return paypalEnvName(env) === 'live' ? 'live' : paypalConfigured(env) ? 'test' : 'disabled';
  return 'disabled';
}

function squareApiBase(env) {
  return getModeForProvider(env, 'square') === 'live'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}
function paypalApiBase(env) {
  return getModeForProvider(env, 'paypal') === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}
function squareHeaders(env) {
  return {
    Authorization: 'Bearer ' + str(env.SQUARE_ACCESS_TOKEN),
    'Content-Type': 'application/json',
    'Square-Version': SQUARE_VERSION
  };
}

function isLiveInfraReady(env, provider) {
  const db = !!env.ORDERS_DB && typeof env.ORDERS_DB.prepare === 'function';
  if (provider === 'square') return db && str(env.SQUARE_WEBHOOK_SIGNATURE_KEY).length >= 16;
  if (provider === 'paypal') return db; // capture verified via order-status; webhook optional
  return false;
}

async function liveAccountReadiness(env, provider) {
  if (getModeForProvider(env, provider) !== 'live') return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    if (provider === 'square') {
      const response = await fetch(
        squareApiBase(env) + '/v2/locations/' + encodeURIComponent(str(env.SQUARE_LOCATION_ID)),
        { headers: squareHeaders(env), signal: controller.signal }
      );
      if (!response.ok) return false;
      const data = await response.json();
      const location = data?.location;
      return (
        location?.status === 'ACTIVE' &&
        location?.id === str(env.SQUARE_LOCATION_ID) &&
        Array.isArray(location?.capabilities) &&
        location.capabilities.includes('CREDIT_CARD_PROCESSING')
      );
    }
    if (provider === 'paypal') {
      const token = await paypalAccessToken(env);
      return !!token;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function validPolicy(c) {
  return (
    c &&
    c.shopEnabled === true &&
    c.currency === 'GBP' &&
    Array.isArray(c.products) &&
    str(c.businessAddress).length >= 8 &&
    str(c.deliveryPolicy).length >= 15 &&
    str(c.returnsPolicy).length >= 15 &&
    c.shipping &&
    safeCountries(c.shipping.allowedCountries) &&
    Number.isSafeInteger(c.shipping.flatRatePence) &&
    c.shipping.flatRatePence >= 0 &&
    c.shipping.flatRatePence <= 100000 &&
    (c.shipping.freeShippingThresholdPence === null ||
      c.shipping.freeShippingThresholdPence === undefined ||
      validPrice(c.shipping.freeShippingThresholdPence))
  );
}

function buyable(p) {
  return (
    p &&
    validSku(p.sku) &&
    typeof p.name === 'string' &&
    p.name.trim().length > 1 &&
    p.name.length <= 140 &&
    typeof p.description === 'string' &&
    p.description.length <= 700 &&
    typeof p.category === 'string' &&
    p.category.length <= 80 &&
    p.available === true &&
    validPrice(p.pricePence) &&
    validStock(p.stock) &&
    p.stock > 0
  );
}

async function getCatalogue(request, env) {
  const url = new URL(request.url);
  url.pathname = '/data/aiva-products.json';
  url.search = '';
  const r = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  if (!r.ok) throw Error('CATALOGUE_UNAVAILABLE');
  return await r.json();
}

function isTrustedCheckoutUrl(value, provider) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (provider === 'square') {
      return (
        host === 'square.link' ||
        host.endsWith('.square.link') ||
        host === 'checkout.square.site' ||
        host.endsWith('.checkout.square.site') ||
        host.endsWith('.squareup.com') ||
        host.endsWith('.squareupsandbox.com')
      );
    }
    if (provider === 'paypal') {
      return (
        host === 'www.paypal.com' ||
        host.endsWith('.paypal.com') ||
        host === 'www.sandbox.paypal.com' ||
        host.endsWith('.sandbox.paypal.com')
      );
    }
    return false;
  } catch {
    return false;
  }
}

function parseBasket(data, cat) {
  if (!data || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 20) {
    return { error: 'Choose 1–20 products.' };
  }
  const prices = new Map(cat.products.filter(buyable).map((p) => [p.sku, p]));
  const used = new Set();
  let itemTotal = 0;
  let totalUnits = 0;
  const lines = [];
  for (const item of data.items) {
    const sku = item && item.sku;
    const qty = item && item.quantity;
    const product = prices.get(sku);
    if (
      !validSku(sku) ||
      !product ||
      used.has(sku) ||
      !Number.isSafeInteger(qty) ||
      qty < 1 ||
      qty > 10 ||
      qty > product.stock
    ) {
      return { error: 'Your basket contains an unavailable product or quantity.' };
    }
    used.add(sku);
    totalUnits += qty;
    itemTotal += product.pricePence * qty;
    if (itemTotal > 200000000 || totalUnits > 50) {
      return { error: 'Order total exceeds the online limit; request a quotation.' };
    }
    lines.push({ product, qty });
  }
  const shipping = cat.shipping;
  const shippingPrice =
    Number.isSafeInteger(shipping.freeShippingThresholdPence) &&
    itemTotal >= shipping.freeShippingThresholdPence
      ? 0
      : shipping.flatRatePence;
  return { lines, itemTotal, shipping, shippingPrice };
}

async function paypalAccessToken(env) {
  const auth = btoa(str(env.PAYPAL_CLIENT_ID) + ':' + str(env.PAYPAL_CLIENT_SECRET));
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 10000);
  try {
    const response = await fetch(paypalApiBase(env) + '/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials',
      signal: ctl.signal
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw Error('PayPal auth failed');
    return data.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

async function createSquareCheckout(env, site, basket, mode) {
  if (mode === 'live' && !(await liveAccountReadiness(env, 'square'))) {
    return respond(
      { error: 'Merchant live payments are not yet enabled by Square. Please contact Aiva.' },
      503
    );
  }
  const lineItems = basket.lines.map(({ product, qty }) => ({
    name: product.name.trim().slice(0, 512),
    quantity: String(qty),
    item_type: 'ITEM',
    note: ('SKU ' + product.sku).slice(0, 500),
    base_price_money: { amount: product.pricePence, currency: 'GBP' }
  }));
  if (basket.shippingPrice > 0) {
    lineItems.push({
      name: 'Standard delivery',
      quantity: '1',
      item_type: 'ITEM',
      note: 'SKU SHIPPING',
      base_price_money: { amount: basket.shippingPrice, currency: 'GBP' }
    });
  }
  const body = {
    idempotency_key: 'aiva_' + crypto.randomUUID(),
    description: 'Aiva Trading online order',
    order: {
      location_id: str(env.SQUARE_LOCATION_ID),
      reference_id: 'aivatrading.uk',
      line_items: lineItems,
      metadata: {
        source: 'aivatrading.uk',
        shipping: basket.shippingPrice === 0 ? 'included' : 'charged'
      }
    },
    checkout_options: {
      redirect_url: site.origin + '/order-success.html',
      ask_for_shipping_address: true,
      accepted_payment_methods: { apple_pay: true, google_pay: true, card: true }
    },
    payment_note: 'Aiva Trading Limited order'
  };
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 10000);
  try {
    const response = await fetch(squareApiBase(env) + '/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: squareHeaders(env),
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    const result = await response.json();
    if (!response.ok || !result?.payment_link?.url) {
      console.error('Square create failed', response.status, result?.errors?.[0]?.code);
      return respond({ error: 'Secure checkout could not be started. Try again or contact Aiva.' }, 502);
    }
    if (!isTrustedCheckoutUrl(result.payment_link.url, 'square')) {
      return respond({ error: 'Invalid payment provider response.' }, 502);
    }
    return respond({
      url: result.payment_link.url,
      orderId: result.payment_link.order_id || null,
      provider: 'square'
    });
  } catch (e) {
    console.error('Square checkout network error', String(e));
    return respond({ error: 'Payment service is temporarily unavailable.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function createPayPalCheckout(env, site, basket, mode) {
  if (mode === 'live' && !(await liveAccountReadiness(env, 'paypal'))) {
    return respond({ error: 'PayPal live payments are not ready. Please contact Aiva.' }, 503);
  }
  const itemTotal = basket.itemTotal;
  const shipping = basket.shippingPrice;
  const total = itemTotal + shipping;
  const items = basket.lines.map(({ product, qty }) => ({
    name: product.name.trim().slice(0, 127),
    sku: product.sku,
    quantity: String(qty),
    unit_amount: { currency_code: 'GBP', value: (product.pricePence / 100).toFixed(2) },
    category: 'PHYSICAL_GOODS'
  }));
  const orderBody = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: 'aivatrading.uk',
        custom_id: 'aivatrading.uk',
        amount: {
          currency_code: 'GBP',
          value: (total / 100).toFixed(2),
          breakdown: {
            item_total: { currency_code: 'GBP', value: (itemTotal / 100).toFixed(2) },
            shipping: { currency_code: 'GBP', value: (shipping / 100).toFixed(2) }
          }
        },
        items
      }
    ],
    application_context: {
      brand_name: 'Aiva Trading Limited',
      landing_page: 'NO_PREFERENCE',
      user_action: 'PAY_NOW',
      shipping_preference: 'GET_FROM_FILE',
      return_url: site.origin + '/order-success.html',
      cancel_url: site.origin + '/shop.html?cancelled=1#aiva-basket'
    }
  };
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 10000);
  try {
    const token = await paypalAccessToken(env);
    const response = await fetch(paypalApiBase(env) + '/v2/checkout/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(orderBody),
      signal: ctl.signal
    });
    const result = await response.json();
    const approve = Array.isArray(result?.links)
      ? result.links.find((l) => l.rel === 'approve' && typeof l.href === 'string')
      : null;
    if (!response.ok || !approve?.href) {
      console.error('PayPal create failed', response.status, result?.message || result?.name);
      return respond({ error: 'Secure checkout could not be started. Try again or contact Aiva.' }, 502);
    }
    if (!isTrustedCheckoutUrl(approve.href, 'paypal')) {
      return respond({ error: 'Invalid payment provider response.' }, 502);
    }
    return respond({ url: approve.href, orderId: result.id || null, provider: 'paypal' });
  } catch (e) {
    console.error('PayPal checkout network error', String(e));
    return respond({ error: 'Payment service is temporarily unavailable.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleShopStatus(request, env) {
  try {
    const cat = await getCatalogue(request, env);
    const providers = availableProviders(env);
    const provider = getDefaultProvider(env);
    const mode = getModeForProvider(env, provider);
    const merchantReady =
      mode === 'live' ? await liveAccountReadiness(env, provider) : mode === 'test';
    return respond({
      ready:
        merchantReady &&
        validPolicy(cat) &&
        cat.products.some(buyable) &&
        (mode === 'test' || isLiveInfraReady(env, provider)),
      mode,
      provider: provider === 'none' ? null : provider,
      providers,
      merchantReady,
      webhookConfigured:
        provider === 'square'
          ? str(env.SQUARE_WEBHOOK_SIGNATURE_KEY).length >= 16
          : false,
      orderDatabaseConfigured: !!env.ORDERS_DB && typeof env.ORDERS_DB.prepare === 'function',
      publishedProducts: Array.isArray(cat.products) ? cat.products.filter(buyable).length : 0,
      shopEnabled: cat.shopEnabled === true
    });
  } catch {
    return respond({
      ready: false,
      mode: 'disabled',
      provider: null,
      providers: [],
      publishedProducts: 0,
      shopEnabled: false
    });
  }
}

export async function handleCreateCheckout(request, env) {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  let data;
  try {
    data = await request.json();
  } catch {
    return respond({ error: 'Invalid order format.' }, 400);
  }
  const requested = str(data?.provider).toLowerCase();
  let provider = requested || getDefaultProvider(env);
  if (provider === 'paypal' && !paypalConfigured(env)) {
    return respond({ error: 'PayPal checkout is not configured.' }, 503);
  }
  if (provider === 'square' && !squareConfigured(env)) {
    return respond({ error: 'Square checkout is not configured.' }, 503);
  }
  if (!['square', 'paypal'].includes(provider)) {
    provider = getDefaultProvider(env);
  }
  const mode = getModeForProvider(env, provider);
  let cat;
  try {
    cat = await getCatalogue(request, env);
  } catch {
    return respond({ error: 'Checkout is currently unavailable.' }, 503);
  }
  if (
    mode === 'disabled' ||
    provider === 'none' ||
    !validPolicy(cat) ||
    (mode === 'live' && !isLiveInfraReady(env, provider))
  ) {
    return respond({ error: 'Online checkout is not enabled. Contact Aiva for a quotation.' }, 503);
  }
  const origin = request.headers.get('Origin');
  const site = new URL(request.url);
  if (origin && origin !== site.origin) return respond({ error: 'Untrusted request origin.' }, 403);
  if (!/application\/json/i.test(request.headers.get('Content-Type') || '')) {
    return respond({ error: 'Send JSON checkout items.' }, 415);
  }
  if (Number(request.headers.get('Content-Length')) > 8192) {
    return respond({ error: 'Order too large.' }, 413);
  }
  const basket = parseBasket(data, cat);
  if (basket.error) return respond({ error: basket.error }, 400);
  if (provider === 'square') return createSquareCheckout(env, site, basket, mode);
  if (provider === 'paypal') return createPayPalCheckout(env, site, basket, mode);
  return respond({ error: 'Online checkout is not enabled. Contact Aiva for a quotation.' }, 503);
}

async function getSquareOrderStatus(env, orderId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(squareApiBase(env) + '/v2/orders/' + encodeURIComponent(orderId), {
      headers: squareHeaders(env),
      signal: controller.signal
    });
    if (!r.ok) return respond({ error: 'Could not verify this payment.' }, r.status === 404 ? 404 : 502);
    const data = await r.json();
    const order = data?.order;
    if (!order || order.metadata?.source !== 'aivatrading.uk') {
      return respond({ error: 'Unknown order origin.' }, 404);
    }
    const completed = order.state === 'COMPLETED';
    const hasTender =
      Array.isArray(order.tenders) &&
      order.tenders.some((t) => Number(t?.amount_money?.amount || 0) > 0);
    return respond({
      paid: Boolean(completed || (order.state === 'OPEN' && hasTender)),
      status: completed ? 'complete' : 'pending',
      reference: orderId.slice(-10),
      mode: getModeForProvider(env, 'square'),
      provider: 'square'
    });
  } catch {
    return respond({ error: 'Could not check payment status.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function getPayPalOrderStatus(env, orderId) {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 10000);
  try {
    const token = await paypalAccessToken(env);
    let response = await fetch(paypalApiBase(env) + '/v2/checkout/orders/' + encodeURIComponent(orderId), {
      headers: { Authorization: 'Bearer ' + token },
      signal: ctl.signal
    });
    let data = await response.json();
    if (!response.ok) return respond({ error: 'Could not verify this payment.' }, response.status === 404 ? 404 : 502);
    const unit = data?.purchase_units?.[0];
    if (unit?.custom_id !== 'aivatrading.uk' && unit?.reference_id !== 'aivatrading.uk') {
      return respond({ error: 'Unknown order origin.' }, 404);
    }
    if (data.status === 'APPROVED') {
      response = await fetch(
        paypalApiBase(env) + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          signal: ctl.signal
        }
      );
      data = await response.json();
    }
    const paid = data.status === 'COMPLETED';
    return respond({
      paid,
      status: paid ? 'complete' : 'pending',
      reference: orderId.slice(-10),
      mode: getModeForProvider(env, 'paypal'),
      provider: 'paypal'
    });
  } catch {
    return respond({ error: 'Could not check payment status.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleOrderStatus(request, env) {
  if (request.method !== 'GET') return respond({ error: 'Method not allowed.' }, 405);
  const params = new URL(request.url).searchParams;
  const id = str(
    params.get('order_id') ||
      params.get('orderId') ||
      params.get('session_id') ||
      params.get('token') ||
      params.get('transactionId')
  );
  if (!id || id.length < 8 || id.length > 191 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return respond({ error: 'Invalid checkout reference.' }, 400);
  }
  if (/^cs_(test_|live_)[A-Za-z0-9]+$/.test(id)) {
    return respond({ error: 'Stripe checkout is retired. Use Square order references.' }, 410);
  }
  if (/^[A-Z0-9]{10,}$/.test(id) && paypalConfigured(env) && !squareConfigured(env)) {
    return getPayPalOrderStatus(env, id);
  }
  // PayPal order ids are typically 17 chars alphanumeric uppercase; Square ids vary.
  if (params.get('token') || params.get('PayerID') || params.get('provider') === 'paypal') {
    if (!paypalConfigured(env)) return respond({ error: 'PayPal verification is not configured.' }, 503);
    return getPayPalOrderStatus(env, id);
  }
  if (squareConfigured(env)) return getSquareOrderStatus(env, id);
  if (paypalConfigured(env)) return getPayPalOrderStatus(env, id);
  return respond({ error: 'Payment verification is not configured.' }, 503);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

async function verifySquareSignature(raw, signature, signatureKey, notificationUrl) {
  if (!signatureKey || signatureKey.length < 16 || !signature || !notificationUrl) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(notificationUrl + raw))
  );
  let binary = '';
  for (const byte of signed) binary += String.fromCharCode(byte);
  return timingSafeEqual(btoa(binary), signature);
}

export async function handleSquareWebhook(request, env) {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  if (
    str(env.SQUARE_WEBHOOK_SIGNATURE_KEY).length < 16 ||
    !env.ORDERS_DB ||
    typeof env.ORDERS_DB.prepare !== 'function'
  ) {
    return respond({ error: 'Webhook not configured.' }, 503);
  }
  if (Number(request.headers.get('Content-Length')) > 128000) {
    return respond({ error: 'Webhook payload too large.' }, 413);
  }
  const raw = await request.text();
  if (raw.length > 128000) return respond({ error: 'Webhook payload too large.' }, 413);
  const notificationUrl = str(env.SQUARE_WEBHOOK_NOTIFICATION_URL) || new URL(request.url).href;
  const signature = request.headers.get('x-square-hmacsha256-signature') || '';
  if (
    !(await verifySquareSignature(
      raw,
      signature,
      str(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
      notificationUrl
    ))
  ) {
    return respond({ error: 'Invalid signature.' }, 400);
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return respond({ error: 'Invalid JSON.' }, 400);
  }
  const eventId = str(event?.event_id || event?.eventId);
  if (!eventId || eventId.length > 191) return respond({ error: 'Invalid event.' }, 400);
  if (!['payment.updated', 'order.updated', 'order.fulfillment.updated', 'refund.created', 'refund.updated'].includes(str(event?.type))) {
    return respond({ received: true });
  }
  const refundObject = event?.data?.object?.refund;
  if (refundObject && ['PENDING', 'COMPLETED'].includes(str(refundObject.status))) {
    const refundOrderId = str(refundObject.order_id);
    const refundPaymentId = str(refundObject.payment_id);
    const refundAmount = Number.isSafeInteger(refundObject.amount_money?.amount)
      ? refundObject.amount_money.amount
      : null;
    if (refundOrderId || refundPaymentId) {
      await markOrderRefunded(
        env,
        refundOrderId || refundPaymentId,
        refundPaymentId,
        refundAmount,
        eventId
      );
    }
    return respond({ received: true, refunded: true });
  }
  const payment = event?.data?.object?.payment;
  const orderObject = event?.data?.object?.order_updated?.order || event?.data?.object?.order;
  const orderId = str(payment?.order_id || orderObject?.id);
  let paid = payment?.status === 'COMPLETED';
  let amountTotal = Number.isSafeInteger(payment?.amount_money?.amount)
    ? payment.amount_money.amount
    : null;
  let currency = str(payment?.amount_money?.currency || 'GBP').toLowerCase().slice(0, 5);
  let customerEmail = str(payment?.buyer_email_address).slice(0, 320);
  let customerName = '';
  let shippingJson = null;
  let lineItemsJson = null;
  let confirmedAivaOrder = false;
  if (orderId && squareConfigured(env)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const orderRes = await fetch(
        squareApiBase(env) + '/v2/orders/' + encodeURIComponent(orderId),
        { headers: squareHeaders(env), signal: controller.signal }
      );
      if (orderRes.ok) {
        const orderData = await orderRes.json();
        const order = orderData?.order;
        if (order?.metadata?.source === 'aivatrading.uk') {
          confirmedAivaOrder = true;
          if (order.state === 'COMPLETED') paid = true;
          if (Number.isSafeInteger(order.total_money?.amount)) amountTotal = order.total_money.amount;
          currency = str(order.total_money?.currency || currency).toLowerCase().slice(0, 5);
          const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
          const ship = fulfillments.find((f) => f?.shipment_details || f?.type === 'SHIPMENT');
          if (ship) shippingJson = JSON.stringify(ship).slice(0, 5000);
          if (Array.isArray(order.line_items)) {
            lineItemsJson = JSON.stringify(
              order.line_items.map((x) => ({
                description: String(x.name || '').slice(0, 200),
                quantity: Number(x.quantity || 0),
                subtotal: Number(x.total_money?.amount || 0),
                currency: String(x.total_money?.currency || 'GBP').toLowerCase(),
                sku: String(x.note || '').replace(/^SKU\s+/i, '').slice(0, 60)
              }))
            ).slice(0, 20000);
          }
          const recipient = ship?.shipment_details?.recipient;
          customerName = str(recipient?.display_name || '').slice(0, 160);
          customerEmail = str(recipient?.email_address || customerEmail).slice(0, 320);
        } else if (order) {
          return respond({ received: true });
        }
      }
    } catch (e) {
      console.error('Square webhook order lookup failed', String(e));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!orderId) return respond({ received: true });
  const now = Math.floor(Date.now() / 1000);
  // Do not acknowledge an event until its order can be verified and persisted.
  // A 503 lets Square retry after a temporary API failure.
  if (!confirmedAivaOrder) {
    return respond({ error: 'Order verification unavailable. Retry this notification.' }, 503);
  }
  await env.ORDERS_DB.batch([
    env.ORDERS_DB.prepare(
      'INSERT OR IGNORE INTO payment_events (event_id, processed_at) VALUES (?,?)'
    ).bind(eventId, now),
    env.ORDERS_DB.prepare(
      `INSERT INTO orders
      (session_id,last_event_id,payment_status,customer_email,customer_name,amount_total,currency,shipping_details_json,line_items_json,payment_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET
       last_event_id=excluded.last_event_id,
       payment_status=CASE
         WHEN orders.payment_status='refunded' THEN 'refunded'
         WHEN orders.payment_status='paid' THEN 'paid'
         ELSE excluded.payment_status END,
       customer_email=COALESCE(NULLIF(excluded.customer_email,''),orders.customer_email),
       customer_name=COALESCE(NULLIF(excluded.customer_name,''),orders.customer_name),
       amount_total=COALESCE(excluded.amount_total,orders.amount_total),
       currency=COALESCE(excluded.currency,orders.currency),
       shipping_details_json=COALESCE(excluded.shipping_details_json,orders.shipping_details_json),
       line_items_json=CASE WHEN excluded.payment_status='paid' THEN excluded.line_items_json ELSE orders.line_items_json END,
       payment_id=COALESCE(NULLIF(excluded.payment_id,''),orders.payment_id),
       updated_at=excluded.updated_at`
    ).bind(
      orderId,
      eventId,
      paid ? 'paid' : 'pending',
      customerEmail,
      customerName,
      amountTotal,
      currency,
      shippingJson,
      paid ? lineItemsJson : null,
      str(payment?.id) || null,
      now,
      now
    )
  ]);
  return respond({ received: true });
}


async function markOrderRefunded(env, orderId, paymentId, amountTotal, eventId) {
  if (!env.ORDERS_DB || typeof env.ORDERS_DB.prepare !== 'function' || !orderId) return;
  const now = Math.floor(Date.now() / 1000);
  const statements = [];
  if (eventId) {
    statements.push(
      env.ORDERS_DB.prepare(
        'INSERT OR IGNORE INTO payment_events (event_id, processed_at) VALUES (?,?)'
      ).bind(eventId, now)
    );
  }
  statements.push(
    env.ORDERS_DB.prepare(
      `INSERT INTO orders
      (session_id,last_event_id,payment_status,fulfillment_status,customer_email,customer_name,amount_total,currency,shipping_details_json,line_items_json,payment_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET
       last_event_id=COALESCE(excluded.last_event_id,orders.last_event_id),
       payment_status='refunded',
       fulfillment_status='refunded',
       amount_total=COALESCE(excluded.amount_total,orders.amount_total),
       payment_id=COALESCE(NULLIF(excluded.payment_id,''),orders.payment_id),
       updated_at=excluded.updated_at`
    ).bind(
      orderId,
      eventId || ('refund_' + paymentId + '_' + now),
      'refunded',
      'refunded',
      '',
      '',
      amountTotal,
      'gbp',
      null,
      null,
      paymentId || null,
      now,
      now
    )
  );
  await env.ORDERS_DB.batch(statements);
}

/** Merchant refund for a completed Square payment. Requires MERCHANT_REFUND_SECRET. */
export async function handleCreateRefund(request, env) {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  const secret = str(env.MERCHANT_REFUND_SECRET);
  const provided = str(request.headers.get('X-Aiva-Merchant-Key'));
  if (secret.length < 24 || !provided || !timingSafeEqual(secret, provided)) {
    return respond({ error: 'Unauthorized.' }, 401);
  }
  if (!squareConfigured(env)) return respond({ error: 'Square is not configured.' }, 503);
  let data;
  try {
    data = await request.json();
  } catch {
    return respond({ error: 'Invalid JSON.' }, 400);
  }
  const paymentId = str(data?.paymentId || data?.payment_id);
  const orderId = str(data?.orderId || data?.order_id);
  const reason = str(data?.reason || 'Customer refund').slice(0, 192);
  const amountPence = data?.amountPence;
  if (!paymentId || paymentId.length < 8 || paymentId.length > 191 || !/^[A-Za-z0-9_-]+$/.test(paymentId)) {
    return respond({ error: 'A valid Square paymentId is required.' }, 400);
  }
  if (
    amountPence !== undefined &&
    amountPence !== null &&
    (!Number.isSafeInteger(amountPence) || amountPence < 1 || amountPence > 100000000)
  ) {
    return respond({ error: 'amountPence must be a positive integer in pence.' }, 400);
  }
  const body = {
    idempotency_key: 'aiva_refund_' + crypto.randomUUID(),
    payment_id: paymentId,
    reason
  };
  if (Number.isSafeInteger(amountPence)) {
    body.amount_money = { amount: amountPence, currency: 'GBP' };
  }
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 10000);
  try {
    const response = await fetch(squareApiBase(env) + '/v2/refunds', {
      method: 'POST',
      headers: squareHeaders(env),
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    const result = await response.json();
    if (!response.ok || !result?.refund) {
      console.error('Square refund failed', response.status, result?.errors?.[0]?.code);
      return respond({ error: 'Refund could not be created in Square.' }, 502);
    }
    const refund = result.refund;
    const refundedAmount = Number.isSafeInteger(refund.amount_money?.amount)
      ? refund.amount_money.amount
      : amountPence || null;
    if (orderId) {
      await markOrderRefunded(env, orderId, paymentId, refundedAmount, refund.id || null);
    }
    return respond({
      ok: true,
      refundId: refund.id || null,
      status: refund.status || null,
      paymentId,
      orderId: orderId || null,
      amountPence: refundedAmount,
      mode: getModeForProvider(env, 'square'),
      provider: 'square'
    });
  } catch (e) {
    console.error('Square refund network error', String(e));
    return respond({ error: 'Refund service is temporarily unavailable.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

/** Legacy Stripe webhook path — retired. */
export async function handleStripeWebhook(request, env) {
  return respond(
    {
      error: 'Stripe webhooks are retired. Configure Square webhooks at /api/square-webhook.'
    },
    410
  );
}
