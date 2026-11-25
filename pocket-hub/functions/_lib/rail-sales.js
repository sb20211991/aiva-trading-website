/* Ticket sales for Aiva Train and Aiva Tram.
   Aiva does not resell rail tickets itself: fares and tickets must come from an authorised distributor.
   Trainline Partner Solutions' Global API and Distribusion are the two rail distributors that sell
   multi-carrier European tickets (SNCF, UK operators, Renfe, SBB, ÖBB and others) to travel sellers, and
   both are partner-only — no public sandbox, no self-serve key, and Trainline quotes roughly 12 weeks from
   signature to live integration. SNCF sells through those distributors and its own B2B programme.

   Until such a contract exists, salesStatus() reports unavailable and the app shows live times with no price
   and no payment button: Aiva never invents a fare, availability or ticket.

   When the contract is signed, two bindings connect it without touching the rest of the app:
     RAIL_SALES_GATEWAY_URL  https origin of the distributor gateway (a small adapter, or the distributor's
                             own API base when it matches the contract below)
     RAIL_SALES_GATEWAY_KEY  secret sent as the X-API-Key header (Cloudflare Pages secret)
   Contract used by this client:
     POST /fares   {mode, from, to, depart, passengers, itineraries:[ids]} -> {fares:[{itineraryId, quoteId,
                   amount, currency, description, refundable, conditions,
                   payment:{provider, sessionId, sdkUrl, methods:['card','apple_pay','google_pay']}}]}
                   methods lists what the payment session can actually take (card = Visa/Mastercard);
                   omitting it offers card only.
     POST /orders  {quoteId, passengers:[{firstName,lastName,email}], paymentToken} -> {orderId, pnr, status,
                   operator, from, to, depart, arrive, fare, ticket:{barcode, qrPayload}, testMode}
   Card, Apple Pay and Google Pay are offered by the distributor's payment session (sdkUrl), mounted inside
   Aiva — never by an external checkout page, and never by Aiva storing card data. */
export const DISTRIBUTORS = [
  { name: 'Trainline Partner Solutions', product: 'Global API', scope: '270+ carriers across Europe and the UK, booking and aftersales', url: 'https://tps.thetrainline.com/our-products/global-api/' },
  { name: 'Distribusion', product: 'Rail and coach distribution API', scope: 'Multi-carrier ground transport ticketing', url: 'https://www.distribusion.com/' }
];

export function salesStatus(env) {
  const url = String(env?.RAIL_SALES_GATEWAY_URL || '').trim();
  const key = String(env?.RAIL_SALES_GATEWAY_KEY || '').trim();
  if (url && key && /^https:\/\//.test(url)) {
    return { available: true, provider: String(env?.RAIL_SALES_PROVIDER || 'rail distributor').slice(0, 80), paymentMethods: ['card', 'apple_pay', 'google_pay'] };
  }
  return {
    available: false, provider: '', paymentMethods: [],
    reason: 'Ticket prices and sales need an authorised rail distributor. Trainline Partner Solutions and Distribusion are partner-only, so Aiva shows live times, platforms and changes without a price until that agreement and its API credentials exist.',
    requirement: 'A signed distribution agreement and its API credentials, set as RAIL_SALES_GATEWAY_URL and the RAIL_SALES_GATEWAY_KEY secret.',
    distributors: DISTRIBUTORS
  };
}

export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (hostname === new URL(request.url).hostname) return true;
    if (protocol === 'https:' && /^app\.aivatrading\.uk$|(^|\.)aiva-pocket-hub\.pages\.dev$/.test(hostname)) return true;
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch { return false; }
}

const boom = (message, status) => Object.assign(new Error(message), { status });
const clean = (s, n = 80) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

async function post(env, path, body, fetcher, timeout = 25000) {
  const res = await fetcher(`${String(env.RAIL_SALES_GATEWAY_URL).replace(/\/+$/, '')}${path}`, {
    method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
    headers: { 'X-API-Key': env.RAIL_SALES_GATEWAY_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON upstream reply */ }
  if (!res.ok) throw boom(clean(data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`, 200), res.status);
  return data?.data ?? data ?? {};
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
export const PAYMENT_METHODS = ['card', 'apple_pay', 'google_pay'];

/* Fares for the itineraries the open feeds returned. Only real quotes are passed through; an itinerary with no
   quote simply has no price in the app. */
export async function quoteFares(env, { mode, from, to, depart, passengers, itineraries }, fetcher = fetch) {
  const body = { mode, from: clean(from, 120), to: clean(to, 120), depart: clean(depart, 40), passengers: Math.min(9, Math.max(1, Number(passengers) || 1)), itineraries: itineraries.slice(0, 10) };
  const data = await post(env, '/fares', body, fetcher);
  const wanted = new Set(body.itineraries);
  const fares = (Array.isArray(data.fares) ? data.fares : []).map((f) => {
    const amount = num(f.amount), code = String(f.currency || '').trim(), currency = code.toUpperCase();
    if (!f.itineraryId || !wanted.has(String(f.itineraryId)) || amount === null || !/^[A-Za-z]{3}$/.test(code)) return null;
    return {
      itineraryId: String(f.itineraryId).slice(0, 200), quoteId: String(f.quoteId || '').slice(0, 200), amount, currency,
      description: clean(f.description, 120), refundable: f.refundable === true, conditions: clean(f.conditions, 400),
      payment: f.payment && typeof f.payment === 'object' ? {
        provider: clean(f.payment.provider, 40), sessionId: clean(f.payment.sessionId, 300),
        sdkUrl: /^https:\/\//.test(String(f.payment.sdkUrl || '')) ? String(f.payment.sdkUrl).slice(0, 500) : '',
        /* Exactly the methods the distributor says this session can take. An unknown or invented method is
           dropped, so the checkout can never advertise a wallet the payment session cannot process. */
        methods: (Array.isArray(f.payment.methods) ? f.payment.methods : [])
          .map((m) => String(m || '').toLowerCase()).filter((m) => PAYMENT_METHODS.includes(m))
          .filter((m, i, a) => a.indexOf(m) === i)
      } : null
    };
  }).filter(Boolean);
  return fares;
}

/* Creates the order after the traveller has paid in the distributor's payment session. */
export async function createOrder(env, { quoteId, passengers, paymentToken }, fetcher = fetch) {
  const data = await post(env, '/orders', {
    quoteId: clean(quoteId, 200), paymentToken: clean(paymentToken, 400),
    passengers: passengers.slice(0, 9).map((p) => ({ firstName: clean(p.firstName, 40), lastName: clean(p.lastName, 40), email: clean(p.email, 190) }))
  }, fetcher, 40000);
  if (!data?.orderId) throw boom('The distributor did not confirm the ticket.', 503);
  const barcode = clean(data.ticket?.barcode, 200), payload = clean(data.ticket?.qrPayload, 400);
  return {
    orderId: String(data.orderId).slice(0, 80), pnr: clean(data.pnr, 40), status: clean(data.status || 'UNKNOWN', 40),
    operator: clean(data.operator, 80), from: clean(data.from, 120), to: clean(data.to, 120),
    depart: clean(data.depart, 40), arrive: clean(data.arrive, 40),
    fare: { amount: num(data.fare?.amount), currency: String(data.fare?.currency || '').toUpperCase().slice(0, 3) },
    ticket: { barcode, qrPayload: payload || barcode }, testMode: data.testMode === true
  };
}
