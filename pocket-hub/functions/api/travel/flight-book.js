/* POST /api/travel/flight-book — in-app flight booking through Nuitee (LiteAPI flights) with the Nuitee payment SDK.
   {action:'verify', offerId} -> live fare, changes and expiry.
   {action:'prebook', offerId, contact, passengers} -> prebookId, transactionId and the payment-form secret, plus the final price.
   {action:'book', prebookId, transactionId} -> booking reference and airline status (after the SDK payment; idempotent per prebook).
   {action:'status', bookingId, email} -> latest airline status and PNR (the booking's contact email must match).
   Sandbox keys make test bookings only. A production key books for real only when FLIGHT_BOOKING_LIVE is "true". */
import { isSandboxKey } from '../../_lib/travel.js';
import { json, allowedOrigin, clean, id, email, readinessCheck } from './hotel-book.js';

const API = 'https://api.liteapi.travel/v3.0';
const day = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(Date.parse(s)) ? s : '';
const cc = (s) => /^[A-Z]{2}$/.test(String(s || '').toUpperCase()) ? String(s).toUpperCase() : '';
const name = (s) => { const v = clean(s, 50); return /^[\p{L}][\p{L}' .-]*$/u.test(v) ? v : ''; };

async function call(method, path, body, env, fetcher, timeout) {
  const res = await fetcher(`${API}${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout),
    headers: { 'X-API-Key': env.LITEAPI_KEY, 'Content-Type': 'application/json', Accept: 'application/json' } });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON upstream reply */ }
  if (!res.ok || data?.error) throw Object.assign(new Error(clean(data?.error?.description || data?.error?.message || data?.message || `HTTP ${res.status}`, 200)), { status: res.status });
  const d = data?.data ?? data;
  return Array.isArray(d) ? d[0] : d;
}
const findKey = (o, k, depth = 0) => {
  if (!o || typeof o !== 'object' || depth > 6) return '';
  if (typeof o[k] === 'string' && o[k]) return o[k];
  for (const v of Object.values(o)) { const r = findKey(v, k, depth + 1); if (r) return r; }
  return '';
};
const segs = (j) => (j?.segments || []).map((s) => ({ from: s.originCode, to: s.destinationCode, departing: s.departureTime, arriving: s.arrivalTime,
  airline: s.carrier?.marketingName || '', flight: `${s.carrier?.marketingCode || ''}${s.flight?.marketingNumber || ''}` }));
export const shapeFlightBooking = (raw) => {
  const b = raw?.booking || raw || {}, p = b.journey?.pricing?.display || b.pricing?.display || {};
  return { bookingId: b.bookingId || '', bookingRef: b.bookingRef || '', status: b.status || '', pnr: b.pnr || findKey(b, 'pnr') || findKey(b, 'airlinePnr'),
    price: Number(p.total ?? b.price), currency: p.currency || b.currency || '', segments: segs(b.journey), paymentScheduledAt: b.paymentScheduledAt || '' };
};
export function passengers(list) {
  if (!Array.isArray(list) || !list.length || list.length > 9) return null;
  const out = [];
  for (const p of list) {
    const type = [0, 1, 2].includes(Number(p?.passengerType)) ? Number(p.passengerType) : -1;
    const v = { passengerType: type, firstName: name(p?.firstName), lastName: name(p?.lastName), birthday: day(p?.birthday),
      gender: /^[MF]$/.test(p?.gender || '') ? p.gender : '', nationality: cc(p?.nationality) };
    if (type < 0 || Object.values(v).some((x) => x === '')) return null;
    const doc = String(p?.documentNumber || '').replace(/\s/g, '').toUpperCase();
    if (doc) {
      if (!/^[A-Z0-9]{5,20}$/.test(doc) || !day(p.documentExpiry) || !cc(p.documentIssueCountry)) return null;
      Object.assign(v, { documentType: 'passport', documentNumber: doc, documentExpiry: p.documentExpiry, documentIssueCountry: cc(p.documentIssueCountry) });
    }
    out.push(v);
  }
  return out.some((p) => p.passengerType === 0) ? out : null;
}
export function contact(c) {
  const v = { firstName: name(c?.firstName), lastName: name(c?.lastName), email: email(clean(c?.email, 254)),
    phoneCountryCode: String(c?.phoneCountryCode || '').replace(/\D/g, '').slice(0, 4), phoneNumber: String(c?.phoneNumber || '').replace(/\D/g, '').slice(0, 15) };
  return Object.values(v).every(Boolean) && v.phoneNumber.length >= 5 ? v : null;
}

export async function onRequestPost({ request, env }, fetcher = fetch) {
  if (!allowedOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
  if (!env?.LITEAPI_KEY) return json({ error: 'Flight booking is not connected yet (Nuitee key missing).' }, 503);
  const testMode = isSandboxKey(env.LITEAPI_KEY);
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 20000)); } catch { return json({ error: 'Invalid request' }, 400); }
  if (!testMode && env.FLIGHT_BOOKING_LIVE !== 'true' && !(body?.action === 'verify' && readinessCheck(request, env)))
    return json({ error: 'Real flight tickets are waiting for the owner\'s approval with Nuitee to take live payments. Nothing was booked or charged.', blocked: 'approval' }, 403);
  try {
    if (body?.action === 'verify') {
      const offerId = id(body.offerId);
      if (!offerId) return json({ error: 'Choose a flight first.' }, 400);
      const v = await call('POST', '/flights/verify', { offerId }, env, fetcher, 30000);
      const p = v?.journey?.pricing?.display || {};
      return json({ offerId, price: Number(p.total), currency: p.currency || '', changes: v?.changes || null, expires: v?.journey?.expiration || '', testMode });
    }
    if (body?.action === 'prebook') {
      const offerId = id(body.offerId), c = contact(body.contact), pax = passengers(body.passengers);
      if (!offerId) return json({ error: 'Choose a flight first.' }, 400);
      if (!c) return json({ error: 'Enter the contact first name, last name, email and phone number.' }, 400);
      if (!pax) return json({ error: 'Enter every traveller\'s name, date of birth, gender and nationality exactly as on the passport.' }, 400);
      const p = await call('POST', '/flights/prebooks', { offerId, usePaymentSdk: true, contact: c, passengers: pax }, env, fetcher, 45000);
      if (!p?.prebookId || !p.transactionId || !p.secretKey) return json({ error: 'This fare is no longer available. Please choose another flight.' }, 409);
      const d = p.booking?.journey?.pricing?.display || {};
      return json({ prebookId: p.prebookId, transactionId: p.transactionId, secretKey: p.secretKey, price: Number(p.price ?? d.total), currency: p.currency || d.currency || '',
        segments: segs(p.booking?.journey), testMode, paymentEnv: testMode ? 'sandbox' : 'live' });
    }
    if (body?.action === 'book') {
      const prebookId = id(body.prebookId), transactionId = id(body.transactionId);
      if (!prebookId || !transactionId) return json({ error: 'Booking reference missing. Please start again.' }, 400);
      const b = await call('POST', '/flights/bookings', { prebookId, clientReference: `aiva-${prebookId}`.slice(0, 64), payment: { method: 'TRANSACTION_ID', transactionId } }, env, fetcher, 90000);
      const s = shapeFlightBooking(b);
      if (!s.bookingId) return json({ error: 'The airline did not confirm the booking. Check "My bookings" before trying again; retrying never charges twice.' }, 503);
      return json({ ...s, testMode });
    }
    if (body?.action === 'status') {
      const bookingId = id(body.bookingId), mail = email(clean(body.email, 254));
      if (!bookingId || !mail) return json({ error: 'Booking reference and email are needed.' }, 400);
      const raw = await call('GET', `/flights/bookings/${encodeURIComponent(bookingId)}`, null, env, fetcher, 20000);
      if (findKey(raw, 'email').toLowerCase() !== mail.toLowerCase()) return json({ error: 'No booking found for this reference and email.' }, 404);
      return json({ ...shapeFlightBooking(raw), testMode });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    const timeout = e.name === 'TimeoutError';
    // Name the failing stage (verify / prebook / book / status) and the sanitised upstream status, so a 503 can be traced
    // without reading card, passenger or key data. No request body is logged.
    const stage = ['verify', 'prebook', 'book', 'status'].includes(body?.action) ? body.action : 'unknown';
    const upstream = Number.isInteger(e.status) ? e.status : (timeout ? 'timeout' : 'error');
    console.error(`flight-book stage=${stage} upstream=${upstream}`);
    return json({ error: timeout ? 'The airline took too long to answer. Check "My bookings" before trying again.' : (e.message || 'Booking failed.'),
      stage, upstream }, e.status >= 400 && e.status < 500 ? 409 : 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
