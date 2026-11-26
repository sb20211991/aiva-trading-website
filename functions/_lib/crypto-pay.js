/* Aiva Crypto Pay: one shared cryptocurrency payment backend for both Aiva platforms.

   - aivatrading.uk (website, Pages project aiva-trading) serves these endpoints directly.
   - app.aivatrading.uk (Aiva Super App, Pages project aiva-pocket-hub) reaches the same endpoints through its existing
     /api/* forwarder (pocket-hub/functions/api/[[path]].js), so both platforms share one backend, one order database
     (D1 ORDERS_DB, provider='bitpay') and one set of credentials.

   Gateway: BitPay (UK merchants accepted; invoices priced in GBP; settlement to the merchant in GBP to a UK bank).
   Coins offered: BTC, ETH, USDT, USDC, LTC, SOL (USDT/USDC on the networks BitPay offers, including Solana).

   Safety
   - Prices, stock and totals come from the server catalogue only (same catalogue and basket rules as card checkout).
   - No wallet keys, seed phrases or card data ever touch Aiva: the customer pays from their own wallet to BitPay.
   - Payment state is always read back from BitPay with the merchant token; webhook bodies are never trusted.
   - Credentials: BITPAY_TOKEN is a Cloudflare Pages secret, never committed. BITPAY_ENV="test" uses test.bitpay.com
     (testnet coins, no real money). Live invoices need BITPAY_ENV="prod" AND CRYPTO_LIVE_PAYMENTS_APPROVED="true". */
import { respond, getCatalogue, parseBasket, validPolicy, hasDb, ensureSchema, applyPaid } from './commerce.js';
import { readLimitedText, BodyTooLarge } from './body.js';

export const COINS = [
  { code: 'BTC', name: 'Bitcoin', network: 'Bitcoin network (Lightning where your wallet supports it)' },
  { code: 'ETH', name: 'Ethereum', network: 'Ethereum network' },
  { code: 'USDT', name: 'Tether', network: 'Stablecoin · Ethereum, Solana and other supported networks', stable: true },
  { code: 'USDC', name: 'USD Coin', network: 'Stablecoin · Ethereum, Solana and other supported networks', stable: true },
  { code: 'LTC', name: 'Litecoin', network: 'Litecoin network' },
  { code: 'SOL', name: 'Solana', network: 'Solana network' }
];
export const BITPAY_HOSTS = { prod: 'https://bitpay.com', test: 'https://test.bitpay.com' };
const BITPAY_VERSION = '2.0.0';
const PAID = ['confirmed', 'complete'];
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const now = () => Math.floor(Date.now() / 1000);
const validInvoiceId = (s) => typeof s === 'string' && /^[A-Za-z0-9]{10,64}$/.test(s);
const validOrderId = (s) => typeof s === 'string' && /^aivacx_[a-f0-9]{32}$/.test(s);

/* ---------- configuration ---------- */
export function cryptoState(env) {
  const token = str(env.BITPAY_TOKEN);
  const prod = str(env.BITPAY_ENV).toLowerCase() === 'prod';
  if (!token) return { ready: false, mode: 'disabled', reason: 'Cryptocurrency payments are being connected and will open shortly.' };
  if (prod && str(env.CRYPTO_LIVE_PAYMENTS_APPROVED) !== 'true') {
    return { ready: false, mode: 'disabled', reason: 'Cryptocurrency payments are awaiting final merchant approval.' };
  }
  return { ready: true, mode: prod ? 'live' : 'test', base: BITPAY_HOSTS[prod ? 'prod' : 'test'], token };
}

/* Browsers on either Aiva platform (and their Pages previews) may call the API. */
const AIVA_HOSTS = /^(aivatrading\.uk|www\.aivatrading\.uk|app\.aivatrading\.uk|([a-z0-9-]+\.)?aiva-trading\.pages\.dev|([a-z0-9-]+\.)?aiva-pocket-hub\.pages\.dev)$/;
export function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (hostname === new URL(request.url).hostname) return true;
    if (protocol === 'https:' && AIVA_HOSTS.test(hostname)) return true;
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch { return false; }
}
/* The page origin the customer is on. Requests forwarded by the Super App carry X-Forwarded-Host; only Aiva hosts count. */
export function publicOrigin(request) {
  const fwd = str(request.headers.get('X-Forwarded-Host')).toLowerCase();
  if (fwd && AIVA_HOSTS.test(fwd)) return 'https://' + fwd;
  return new URL(request.url).origin;
}
const isApp = (origin) => /^https:\/\/(app\.aivatrading\.uk|([a-z0-9-]+\.)?aiva-pocket-hub\.pages\.dev)$/.test(origin);

/* ---------- live exchange rates (GBP per coin) ---------- */
let rateMemo = null;
export function clearRateCache() { rateMemo = null; }
async function getJson(fetcher, url, ms = 10000) {
  const r = await fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw Error('HTTP ' + r.status);
  return r.json();
}
/* BitPay's public rate feed first (the rates BitPay invoices use), then Coinbase's public exchange-rate feed. */
export async function liveRates(fetcher = fetch) {
  if (rateMemo && Date.now() - rateMemo.at < 30000) return rateMemo.value;
  const rates = {};
  try {
    const d = await getJson(fetcher, 'https://bitpay.com/rates/GBP');
    const list = Array.isArray(d?.data) ? d.data : [];
    for (const c of COINS) {
      const row = list.find((x) => x && x.code === c.code);
      if (row && Number(row.rate) > 0) rates[c.code] = { gbp: Number(row.rate), source: 'BitPay' };
    }
  } catch { /* fall through to Coinbase */ }
  if (COINS.some((c) => !rates[c.code])) {
    try {
      const d = await getJson(fetcher, 'https://api.coinbase.com/v2/exchange-rates?currency=GBP');
      for (const c of COINS) {
        const perGbp = Number(d?.data?.rates?.[c.code]);
        if (!rates[c.code] && perGbp > 0) rates[c.code] = { gbp: 1 / perGbp, source: 'Coinbase' };
      }
    } catch { /* rates stay partial */ }
  }
  const value = { rates, at: new Date().toISOString() };
  if (Object.keys(rates).length) rateMemo = { at: Date.now(), value };
  return value;
}
const coinDigits = (code) => (COINS.find((c) => c.code === code)?.stable ? 2 : code === 'BTC' ? 8 : 6);
export function estimate(pence, gbpPerCoin, code) {
  if (!(gbpPerCoin > 0) || !Number.isSafeInteger(pence)) return null;
  const d = coinDigits(code), f = 10 ** d;
  return (Math.ceil((pence / 100 / gbpPerCoin) * f) / f).toFixed(d);
}

/* ---------- BitPay ---------- */
async function bitpay(fetcher, state, method, path, body) {
  const r = await fetcher(state.base + path, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', 'X-Accept-Version': BITPAY_VERSION, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const d = await r.json().catch(() => null);
  return { ok: r.ok && !!d?.data, status: r.status, data: d?.data, error: str(d?.error).slice(0, 200) };
}
const getInvoice = (fetcher, state, id) =>
  bitpay(fetcher, state, 'GET', `/invoices/${encodeURIComponent(id)}?token=${encodeURIComponent(state.token)}`);

/* BitPay keys tokens by network, e.g. USDC, USDC_e or USDC_s; prefer the plain code, else the first network variant. */
function coinKey(obj, code) {
  if (!obj || typeof obj !== 'object') return '';
  if (obj[code] !== undefined) return code;
  return Object.keys(obj).find((k) => k.startsWith(code + '_')) || '';
}
function firstUri(codes) {
  if (!codes || typeof codes !== 'object') return '';
  for (const k of ['BIP72b', 'EIP681', 'BIP21', 'SPL', 'BIP73']) if (typeof codes[k] === 'string') return codes[k];
  return Object.values(codes).find((v) => typeof v === 'string') || '';
}
const safeUri = (u) => (/^(bitcoin|ethereum|litecoin|solana|https):[^\s"'<>]{1,600}$/i.test(u) ? u : '');
function trustedInvoiceUrl(u, state) {
  try { const x = new URL(u); return x.protocol === 'https:' && x.origin === state.base; } catch { return false; }
}
/* Customer-facing view of an invoice for the chosen coin. */
export function invoiceView(inv, coin, state) {
  const key = coinKey(inv.paymentCodes, coin) || coinKey(inv.paymentDisplayTotals, coin);
  const display = key && inv.paymentDisplayTotals ? str(String(inv.paymentDisplayTotals[key] ?? '')) : '';
  const rate = key ? Number(inv.exchangeRates?.[key]?.GBP) : NaN;
  const url = trustedInvoiceUrl(inv.url, state) ? inv.url : '';
  return {
    invoiceId: inv.id, url, coin, network: key && key !== coin ? key.split('_')[1] : '',
    amount: /^[0-9]+(\.[0-9]+)?$/.test(display) ? display : '',
    paymentUri: safeUri(firstUri(key ? inv.paymentCodes?.[key] : null)) || url,
    gbpPerCoin: rate > 0 ? rate : null,
    expiresAt: Number(inv.expirationTime) > 0 ? new Date(Number(inv.expirationTime)).toISOString() : null,
    status: str(inv.status)
  };
}

/* ---------- order reconciliation (shared by status polling and the BitPay webhook) ---------- */
function stateFor(inv) {
  const s = str(inv.status), ex = inv.exceptionStatus;
  if (PAID.includes(s)) return ex && ex !== false && ex !== 'paidOver' ? 'review' : 'confirmed';
  if (s === 'paid') return 'confirming';
  if (s === 'expired') return ex === 'paidPartial' ? 'review' : 'expired';
  if (s === 'invalid') return 'review';
  return 'awaiting_payment';
}
export async function reconcile(env, request, row, inv) {
  const db = env.ORDERS_DB, t = now();
  let pos = {};
  try { pos = JSON.parse(inv.posData || '{}'); } catch { pos = {}; }
  if (pos.orderId !== row.session_id || str(inv.orderId) !== row.session_id || str(inv.id) !== row.payment_link_id) return { state: 'unknown' };
  const pence = Math.round(Number(inv.price) * 100);
  if (str(inv.currency) !== 'GBP' || pence !== Number(row.expected_total)) {
    await db.prepare(`UPDATE orders SET review_reason='amount_mismatch', updated_at=? WHERE session_id=? AND payment_status='pending'`).bind(t, row.session_id).run();
    return { state: 'review' };
  }
  const state = stateFor(inv);
  const email = str(inv.buyerProvidedEmail || inv.buyer?.email).slice(0, 320);
  if (state === 'confirmed') {
    if (row.mode === 'live') {
      await applyPaid(env, new URL(request.url).origin, row.session_id,
        { paymentId: inv.id, amount: pence, currency: 'GBP', email, providerRef: inv.id, test: false }, `bitpay_${inv.id}_${inv.status}`);
    } else {
      /* Test-network payments mark the order paid but never touch live stock. */
      await db.prepare(`UPDATE orders SET payment_status='paid', payment_id=?, amount_total=?, test_order=1, provider_order_ref=?,
          customer_email=COALESCE(NULLIF(?,''),customer_email), last_event_id=?, paid_at=?, updated_at=? WHERE session_id=? AND payment_status IN ('pending','failed')`)
        .bind(inv.id, pence, inv.id, email, `bitpay_${inv.id}_${inv.status}`, t, t, row.session_id).run();
    }
  } else if (state === 'expired') {
    await db.prepare(`UPDATE orders SET payment_status='failed', last_event_id=?, updated_at=? WHERE session_id=? AND payment_status='pending'`)
      .bind(`bitpay_${inv.id}_expired`, t, row.session_id).run();
  } else if (state === 'review') {
    await db.prepare(`UPDATE orders SET review_reason=?, updated_at=? WHERE session_id=? AND payment_status IN ('pending','failed')`)
      .bind('crypto_' + str(String(inv.exceptionStatus || inv.status)).slice(0, 40), t, row.session_id).run();
  }
  const fresh = await db.prepare('SELECT payment_status, review_reason FROM orders WHERE session_id=?').bind(row.session_id).first();
  const paid = fresh?.payment_status === 'paid' || fresh?.payment_status === 'refunded';
  return { state: paid ? 'confirmed' : fresh?.review_reason && state !== 'confirming' ? 'review' : state, paid };
}

const MESSAGES = {
  awaiting_payment: 'Waiting for your payment.',
  confirming: 'Payment received. Waiting for network confirmation — this usually takes a few minutes.',
  confirmed: 'Thank you. A confirmation is on its way to your email.',
  expired: 'This payment window expired before a payment arrived. Nothing was charged; you can start again.',
  review: 'Your payment needs a quick manual check (for example a partial or late payment). Aiva will contact you by email.',
  unknown: 'This payment could not be matched to an Aiva order.'
};

/* ---------- handlers ---------- */

/* GET /api/crypto-rates?amountPence=1234 -> coins with live GBP rates and an estimate, plus availability. */
export async function handleCryptoRates(request, env, fetcher = fetch) {
  const state = cryptoState(env);
  const pence = Number(new URL(request.url).searchParams.get('amountPence'));
  const amount = Number.isSafeInteger(pence) && pence > 0 && pence <= 200000000 ? pence : null;
  const { rates, at } = await liveRates(fetcher);
  return respond({
    enabled: state.ready && hasDb(env), mode: state.mode, reason: state.ready ? (hasDb(env) ? '' : 'Order database is not connected.') : state.reason,
    gateway: 'BitPay', settlement: 'GBP', ratesAt: at,
    coins: COINS.map((c) => ({ code: c.code, name: c.name, network: c.network, gbpPerCoin: rates[c.code]?.gbp ?? null,
      source: rates[c.code]?.source || null, estimate: amount ? estimate(amount, rates[c.code]?.gbp, c.code) : null })),
    note: 'Estimates use live market rates. The exact amount is fixed by BitPay when your payment is created.'
  });
}

/* POST /api/crypto-checkout {items:[{sku,quantity}], coin, email?} -> in-app payment details (amount, QR, wallet link). */
export async function handleCryptoCheckout(request, env, fetcher = fetch) {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  if (!allowedOrigin(request)) return respond({ error: 'Untrusted request origin.' }, 403);
  if (!/application\/json/i.test(request.headers.get('Content-Type') || '')) return respond({ error: 'Send JSON.' }, 415);
  let data;
  try { data = JSON.parse(await readLimitedText(request, 8192)); } catch (e) {
    return respond({ error: e instanceof BodyTooLarge ? 'Order too large.' : 'Invalid order format.' }, e instanceof BodyTooLarge ? 413 : 400);
  }
  const state = cryptoState(env);
  if (!state.ready) return respond({ error: state.reason }, 503);
  if (!hasDb(env)) return respond({ error: 'Cryptocurrency checkout is not available right now.' }, 503);
  const coin = str(data?.coin).toUpperCase();
  if (!COINS.some((c) => c.code === coin)) return respond({ error: 'Choose BTC, ETH, USDT, USDC, LTC or SOL.' }, 400);
  let cat;
  try { cat = await getCatalogue(request, env); } catch { return respond({ error: 'Checkout is currently unavailable.' }, 503); }
  if (!validPolicy(cat) || (state.mode === 'live' && cat.testOnly === true)) return respond({ error: 'Online checkout is not enabled. Contact Aiva for a quotation.' }, 503);
  const basket = parseBasket(data, cat, env);
  if (basket.error) return respond({ error: basket.error }, 400);
  await ensureSchema(env);

  const origin = publicOrigin(request), app = isApp(origin);
  const orderId = 'aivacx_' + crypto.randomUUID().replace(/-/g, '');
  const email = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(str(data?.email)) ? str(data.email) : '';
  const back = app ? `${origin}/?cryptoOrder=${orderId}#trade` : `${origin}/shop.html?cryptoOrder=${orderId}#aiva-basket`;
  const desc = basket.lines.map(({ product, qty }) => `${product.name} × ${qty}`).join(', ');
  const invoice = {
    token: state.token, price: basket.total / 100, currency: 'GBP', orderId,
    itemDesc: ('Aiva Trading: ' + desc).slice(0, 100),
    notificationURL: str(env.CRYPTO_WEBHOOK_URL) || `${new URL(request.url).origin}/api/crypto-webhook`,
    redirectURL: back, closeURL: back, fullNotifications: true, extendedNotifications: true, transactionSpeed: 'medium',
    paymentCurrencies: [coin],
    posData: JSON.stringify({ src: 'aiva', platform: app ? 'app' : 'website', orderId }),
    ...(email ? { buyer: { email, notify: true } } : {})
  };
  let res;
  try {
    res = await bitpay(fetcher, state, 'POST', '/invoices', invoice);
    /* Some accounts name token networks differently; fall back to BitPay's own coin chooser rather than failing. */
    if (!res.ok && res.status < 500) { const { paymentCurrencies, ...rest } = invoice; res = await bitpay(fetcher, state, 'POST', '/invoices', rest); }
  } catch { return respond({ error: 'The crypto payment service could not be reached. Try again shortly.' }, 502); }
  const inv = res.data;
  if (!res.ok || !validInvoiceId(inv?.id) || !trustedInvoiceUrl(inv?.url, state)) {
    console.error('BitPay invoice failed', res.status, res.error);
    return respond({ error: 'The crypto payment could not be started. Try again or contact Aiva.' }, 502);
  }
  const items = basket.lines.map(({ product, qty }) => ({ sku: product.sku, name: product.name, quantity: qty, unitPence: product.pricePence }));
  const t = now();
  await env.ORDERS_DB.prepare(
    `INSERT INTO orders (session_id,last_event_id,payment_status,amount_total,expected_total,currency,customer_email,line_items_json,payment_link_id,mode,provider,test_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(orderId, 'checkout_created', 'pending', basket.total, basket.total, 'gbp', email || null, JSON.stringify(items), inv.id, state.mode, 'bitpay',
    state.mode === 'live' ? 0 : 1, t, t).run();
  return respond({ orderId, mode: state.mode, totalPence: basket.total, currency: 'GBP', platform: app ? 'app' : 'website', ...invoiceView(inv, coin, state) });
}

async function findOrder(env, column, value) {
  await ensureSchema(env);
  return env.ORDERS_DB.prepare(`SELECT session_id, payment_status, expected_total, payment_link_id, mode, review_reason FROM orders WHERE ${column}=? AND provider='bitpay'`)
    .bind(value).first();
}

/* GET /api/crypto-status?orderId=aivacx_... -> payment state, verified with BitPay, and the order confirmed when paid. */
export async function handleCryptoStatus(request, env, fetcher = fetch) {
  const orderId = str(new URL(request.url).searchParams.get('orderId'));
  if (!validOrderId(orderId)) return respond({ error: 'Invalid order reference.' }, 400);
  const state = cryptoState(env);
  if (!hasDb(env)) return respond({ error: 'Payment verification is not configured.' }, 503);
  const row = await findOrder(env, 'session_id', orderId);
  if (!row) return respond({ error: 'Unknown order reference.' }, 404);
  const reference = orderId.slice(-10).toUpperCase();
  if (row.payment_status === 'paid' || row.payment_status === 'refunded') {
    return respond({ orderId, reference, state: 'confirmed', paid: true, message: MESSAGES.confirmed, mode: row.mode });
  }
  if (!state.ready && !str(env.BITPAY_TOKEN)) return respond({ error: 'Payment verification is not configured.' }, 503);
  /* Orders already created stay verifiable even if new crypto checkouts are later switched off. */
  const s = state.ready ? state : cryptoState({ ...env, CRYPTO_LIVE_PAYMENTS_APPROVED: 'true' });
  let res;
  try { res = await getInvoice(fetcher, s, row.payment_link_id); } catch { return respond({ error: 'Could not check the payment right now.' }, 502); }
  if (!res.ok) return respond({ error: 'Could not check the payment right now.' }, 502);
  const r = await reconcile(env, request, row, res.data);
  return respond({ orderId, reference, state: r.state, paid: !!r.paid, message: MESSAGES[r.state] || MESSAGES.awaiting_payment, mode: row.mode,
    expiresAt: Number(res.data.expirationTime) > 0 ? new Date(Number(res.data.expirationTime)).toISOString() : null });
}

/* POST /api/crypto-webhook (BitPay IPN). The body only names the invoice; its state is fetched from BitPay itself. */
export async function handleCryptoWebhook(request, env, fetcher = fetch) {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  let body;
  try { body = JSON.parse(await readLimitedText(request, 65536)); } catch { return respond({ error: 'Invalid notification.' }, 400); }
  const id = str(body?.data?.id || body?.id);
  if (!validInvoiceId(id)) return respond({ error: 'Invalid notification.' }, 400);
  if (!hasDb(env) || !str(env.BITPAY_TOKEN)) return respond({ error: 'Webhook not configured.' }, 503);
  const row = await findOrder(env, 'payment_link_id', id);
  if (!row) return respond({ ignored: 'unknown_invoice' });
  const s = cryptoState({ ...env, CRYPTO_LIVE_PAYMENTS_APPROVED: row.mode === 'live' ? 'true' : env.CRYPTO_LIVE_PAYMENTS_APPROVED });
  if (!s.ready) return respond({ error: 'Webhook not configured.' }, 503);
  let res;
  try { res = await getInvoice(fetcher, s, id); } catch { return respond({ error: 'Verification unavailable.' }, 502); }
  if (!res.ok) return respond({ error: 'Verification unavailable.' }, 502);
  const r = await reconcile(env, request, row, res.data);
  return respond({ received: true, state: r.state });
}
