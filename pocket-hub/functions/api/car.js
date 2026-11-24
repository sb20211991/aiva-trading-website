/* Aiva Car Rental: real vehicle availability, prices and in-app booking through an authorised car rental
   supplier. Nothing is priced, held or sold here — every offer and reservation comes from the supplier
   connected through two bindings:
     CAR_RENTAL_GATEWAY_URL   https origin of the supplier gateway (or its API base when it matches the
                              contract below)
     CAR_RENTAL_GATEWAY_KEY   secret sent as the X-API-Key header (Cloudflare Pages secret)
   Contract used by this client:
     GET  /offers  ?pickup&dropoff&from&to&age&currency&country
          -> {offers:[{id, supplier, vehicle:{name, category, transmission, seats, bags, imageUrl},
                       price:{amount, currency, days}, deposit, mileage, insurance, cancellation,
                       pickup:{name, address}, termsUrl, payment:{sessionId, sdkUrl, methods}}]}
     POST /orders  {offerId, driver:{firstName,lastName,email,age,country}, paymentToken}
          -> {bookingId, reference, status, supplier, vehicle, from, to, total, testMode}
   Card, Apple Pay and Google Pay are taken by the supplier's payment session mounted inside Aiva;
   Aiva never sees or stores card data. */
import { json } from '../_lib/emergency.js';

export const PAYMENT_METHODS = ['card', 'apple_pay', 'google_pay'];
const TRANSMISSIONS = ['automatic', 'manual'];

const clean = (s, n = 120) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const boom = (message, status) => Object.assign(new Error(message), { status });
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const money = (m) => {
  const amount = num(m?.amount), code = String(m?.currency || '').trim().toUpperCase();
  return amount === null || !/^[A-Z]{3}$/.test(code) ? null : { amount, currency: code, days: num(m?.days) };
};
const https = (v) => (/^https:\/\//.test(String(v || '')) ? String(v).slice(0, 600) : '');

export function salesStatus(env) {
  const url = String(env?.CAR_RENTAL_GATEWAY_URL || '').trim();
  const key = String(env?.CAR_RENTAL_GATEWAY_KEY || '').trim();
  if (url && key && /^https:\/\//.test(url)) {
    return { available: true, provider: clean(env?.CAR_RENTAL_PROVIDER || 'car rental supplier', 80), paymentMethods: PAYMENT_METHODS };
  }
  return {
    available: false, provider: '', paymentMethods: [],
    reason: 'Car hire prices and bookings need an authorised car rental supplier. Aiva shows nothing it cannot price or reserve, so no cars, prices or deposits are invented.',
    requirement: 'A supplier account with API access, set as CAR_RENTAL_GATEWAY_URL and the CAR_RENTAL_GATEWAY_KEY secret.',
    suppliers: [
      { name: 'Booking.com Demand API (cars)', scope: 'Availability, prices, reservations, order details', url: 'https://developers.booking.com/demand/docs/cars/overview' },
      { name: 'CarTrawler', scope: 'In-app booking flow and reservation API', url: 'https://cartrawler.github.io/' },
      { name: 'Amadeus Cars Quick Connect', scope: 'Shop, book, retrieve and cancel', url: 'https://developers.amadeus.com/enterprise/category/cars-and-transfers' }
    ]
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

async function call(env, path, { method = 'GET', query, body } = {}, fetcher = fetch, timeout = 30000) {
  const base = String(env.CAR_RENTAL_GATEWAY_URL).replace(/\/+$/, '');
  const url = new URL(base + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetcher(url.toString(), {
    method, signal: AbortSignal.timeout(timeout),
    headers: { 'X-API-Key': env.CAR_RENTAL_GATEWAY_KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON upstream reply */ }
  if (!res.ok) throw boom(clean(data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`, 200), res.status);
  return data?.data ?? data ?? {};
}

/* Only the fields the app paints are passed on; an offer without an id, a supplier, a car and a real price
   is dropped rather than shown. */
export function offerShape(o) {
  if (!o || !o.id || !o.supplier) return null;
  const price = money(o.price);
  if (!price || price.amount <= 0) return null;
  const car = o.vehicle || {};
  const transmission = TRANSMISSIONS.includes(String(car.transmission || '').toLowerCase()) ? String(car.transmission).toLowerCase() : 'unknown';
  return {
    id: clean(o.id, 200), supplier: clean(o.supplier, 80),
    vehicle: {
      name: clean(car.name || car.category || 'Vehicle', 80), category: clean(car.category, 60),
      transmission, seats: num(car.seats), bags: num(car.bags), imageUrl: https(car.imageUrl)
    },
    price,
    deposit: money(o.deposit), mileage: clean(o.mileage, 120), insurance: clean(o.insurance, 200),
    cancellation: clean(o.cancellation, 200), pickup: { name: clean(o.pickup?.name, 120), address: clean(o.pickup?.address, 200) },
    termsUrl: https(o.termsUrl),
    payment: o.payment && typeof o.payment === 'object' ? {
      sessionId: clean(o.payment.sessionId, 300), sdkUrl: https(o.payment.sdkUrl),
      methods: (Array.isArray(o.payment.methods) ? o.payment.methods : []).map((m) => String(m || '').toLowerCase())
        .filter((m) => PAYMENT_METHODS.includes(m)).filter((m, i, a) => a.indexOf(m) === i)
    } : null
  };
}

/* GET /api/car?action=search&pickup=..&dropoff=..&from=ISO&to=ISO&age=30&currency=GBP */
export async function onRequestGet({ request, env }, fetcher = fetch) {
  const u = new URL(request.url).searchParams;
  if ((u.get('action') || 'search') !== 'search') return json({ error: 'Unknown action' }, 400);
  const pickup = clean(u.get('pickup'), 120), dropoff = clean(u.get('dropoff') || u.get('pickup'), 120);
  const from = iso(u.get('from')), to = iso(u.get('to')), age = Number(u.get('age'));
  const currency = String(u.get('currency') || 'GBP').toUpperCase().slice(0, 3);
  const country = String(u.get('country') || 'GB').toUpperCase().slice(0, 2);
  if (pickup.length < 2) return json({ error: 'Enter where you want to collect the car.' }, 400);
  if (!from || !to) return json({ error: 'Choose a collection and return date and time.' }, 400);
  const hours = (Date.parse(to) - Date.parse(from)) / 3600000;
  if (hours < 1) return json({ error: 'The return time must be after the collection time.' }, 400);
  if (hours > 90 * 24) return json({ error: 'Aiva books car hire for rentals of up to 90 days.' }, 400);
  if (!(age >= 18 && age <= 99)) return json({ error: 'Enter the driver’s age (18–99).' }, 400);
  if (!/^[A-Z]{3}$/.test(currency)) return json({ error: 'Unsupported currency.' }, 400);

  const sales = salesStatus(env);
  if (!sales.available) return json({ sales, offers: [], retrieved: new Date().toISOString(), note: '' }, 200);
  try {
    const data = await call(env, '/offers', { query: { pickup, dropoff, from, to, age, currency, country } }, fetcher);
    const offers = (Array.isArray(data.offers) ? data.offers : []).map(offerShape).filter(Boolean)
      .sort((a, b) => a.price.amount - b.price.amount).slice(0, 40);
    return json({
      sales, offers, retrieved: new Date().toISOString(),
      note: offers.length ? '' : 'No car was available for these dates with the connected supplier. Nothing is estimated — try different dates or a nearby pick-up point.'
    }, 200);
  } catch (e) {
    const timeout = e?.name === 'TimeoutError';
    return json({ error: timeout ? 'The car rental supplier took too long to answer. Please try again.' : (e.message || 'Car hire search is temporarily unavailable.'), upstream: e?.status || (timeout ? 'timeout' : 'error') }, 503);
  }
}

/* POST /api/car  {action:'order', offerId, driver:{firstName,lastName,email,age,country}, paymentToken} */
export async function onRequestPost({ request, env }, fetcher = fetch) {
  if (!sameOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
  const sales = salesStatus(env);
  if (!sales.available) {
    return json({ error: 'Car hire booking is not enabled in Aiva yet: no authorised car rental supplier is connected, so nothing was reserved or charged.', restriction: sales }, 503);
  }
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 12000)); } catch { return json({ error: 'Invalid request' }, 400); }
  if (body?.action !== 'order') return json({ error: 'Unknown action' }, 400);
  const offerId = clean(body.offerId, 200), paymentToken = clean(body.paymentToken, 400);
  const d = body.driver || {};
  const driver = {
    firstName: clean(d.firstName, 40), lastName: clean(d.lastName, 40), email: clean(d.email, 190),
    age: Number(d.age), country: clean(d.country || 'GB', 2).toUpperCase()
  };
  if (!offerId || !paymentToken) return json({ error: 'The chosen car or the payment is missing. Please search again.' }, 400);
  if (!driver.firstName || !driver.lastName || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(driver.email)) {
    return json({ error: 'Enter the driver’s first name, last name and email.' }, 400);
  }
  if (!(driver.age >= 18 && driver.age <= 99)) return json({ error: 'Enter the driver’s age (18–99).' }, 400);
  try {
    const data = await call(env, '/orders', { method: 'POST', body: { offerId, driver, paymentToken } }, fetcher, 45000);
    if (!data?.bookingId) throw boom('The car rental supplier did not confirm the reservation.', 503);
    return json({
      bookingId: clean(data.bookingId, 80), reference: clean(data.reference, 40), status: clean(data.status || 'CONFIRMED', 40),
      supplier: clean(data.supplier, 80), vehicle: clean(data.vehicle, 80), from: clean(data.from, 40), to: clean(data.to, 40),
      total: money(data.total), testMode: data.testMode === true, provider: sales.provider, retrieved: new Date().toISOString()
    }, 200);
  } catch (e) {
    const timeout = e?.name === 'TimeoutError';
    return json({ error: timeout ? 'The supplier took too long to confirm. Check “My bookings” before trying again.' : (e.message || 'The reservation could not be completed.'), upstream: e?.status || (timeout ? 'timeout' : 'error') }, timeout || e?.status >= 500 ? 503 : 409);
  }
}
