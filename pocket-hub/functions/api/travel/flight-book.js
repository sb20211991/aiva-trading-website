/* POST /api/travel/flight-book — in-app flight booking through Nuitee (LiteAPI flights) with the Nuitee payment SDK.
   {action:'verify', offerId} -> live fare, changes and expiry.
   {action:'prebook', offerId, contact, passengers} -> prebookId, transactionId and the payment-form secret, plus the final price.
   {action:'services', prebookId, selected:[{passengerIndex, serviceId, quantity}]} -> attaches airline seats / extra bags
     offered in the prebook reply (servicesAttachable) and returns the new transactionId, payment secret and total.
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
/* Seats, bags and other services the airline confirmed in the booking (as Nuitee returns them), for the confirmation page. */
export function bookedServices(b) {
  const list = [b?.services, b?.selectedServices, b?.ancillaries, b?.journey?.services].find(Array.isArray) || [];
  return list.map((x) => ({ name: String(x?.name || x?.description || x?.category || x?.type || '').slice(0, 80), quantity: Number(x?.quantity) || 1,
    passengerIndex: Number.isInteger(x?.passengerIndex) ? x.passengerIndex : null, segmentKey: String(x?.segmentKey || '').slice(0, 80),
    price: (() => { const d = x?.pricing?.display || x?.price || {}; const a = Number(d.amount ?? d.total); return Number.isFinite(a) ? { amount: a, currency: String(d.currency || '').slice(0, 3) } : null; })() }))
    .filter((x) => x.name).slice(0, 60);
}
export const shapeFlightBooking = (raw) => {
  const b = raw?.booking || raw || {}, p = b.journey?.pricing?.display || b.pricing?.display || {};
  return { bookingId: b.bookingId || '', bookingRef: b.bookingRef || '', status: b.status || '', pnr: b.pnr || findKey(b, 'pnr'),
    price: Number(p.total ?? b.price), currency: p.currency || b.currency || '', segments: segs(b.journey), paymentScheduledAt: b.paymentScheduledAt || '',
    services: bookedServices(b) };
};
/* Seats and extra bags the airline offers for this prebook (Nuitee servicesAttachable). Only what the airline returned
   is shown, with its own price; an empty list means the airline offers no paid extras through this channel. */
/* Which flight a service belongs to. Nuitee keys services by an opaque segmentKey; when the group or service also names
   the airports (originCode/destinationCode or nested origin/destination), they are kept so the app can label it
   Outbound or Return. Only 3-letter IATA codes are accepted. */
const code3 = (v) => { const c = typeof v === 'string' ? v : v?.iataCode || v?.code || v?.airportCode || ''; return /^[A-Z]{3}$/.test(String(c).toUpperCase()) ? String(c).toUpperCase() : ''; };
export function segmentOf(...src) {
  for (const o of src) {
    for (const x of [o, o?.segment, o?.flightSegment, o?.metadata?.segment]) {
      if (!x || typeof x !== 'object') continue;
      const from = code3(x.originCode || x.origin || x.departureCode || x.departureAirport || x.from), to = code3(x.destinationCode || x.destination || x.arrivalCode || x.arrivalAirport || x.to);
      if (from && to) return { from, to };
    }
  }
  return null;
}
/* Sandbox only: the field names (never the values) of the first group and service, so the sandbox run can show how
   Nuitee describes segments and bags. No traveller data is in servicesAttachable. */
export function servicesShape(raw) {
  const g = (Array.isArray(raw?.groups) ? raw.groups : [])[0], sv = (Array.isArray(g?.services) ? g.services : [])[0];
  const keys = (o) => (o && typeof o === 'object' ? Object.keys(o).slice(0, 30) : []);
  return { group: keys(g), service: keys(sv), metadata: keys(sv?.metadata), baggage: keys(sv?.metadata?.baggage), segment: keys(g?.segment || sv?.segment) };
}
const money = (pr) => { const d = pr?.display || pr || {}; const a = Number(d.amount ?? d.total ?? d.price); return Number.isFinite(a) && a >= 0 ? { amount: a, currency: String(d.currency || '').slice(0, 3) } : null; };
export function shapeServices(raw) {
  const groups = Array.isArray(raw?.groups) ? raw.groups : Array.isArray(raw) ? raw : [];
  const seats = [], bags = [], others = [];
  for (const g of groups) {
    const kind = String(g?.type || g?.category || '').toLowerCase();
    for (const sv of (Array.isArray(g?.services) ? g.services : Array.isArray(g?.items) ? g.items : [])) {
      const serviceId = id(String(sv?.serviceId || sv?.id || ''));
      if (!serviceId) continue;
      const cat = String(sv?.category || sv?.type || kind).toLowerCase(), price = money(sv?.pricing || sv?.price);
      const segmentKey = clean(sv?.segmentKey || g?.segmentKey || '', 80), passengerType = clean(sv?.passengerType || '', 8), segment = segmentOf(sv, g);
      if (cat.includes('seat')) {
        const m = sv?.metadata?.seat || sv?.seat || {};
        const row = Number(m.seatRow), col = clean(m.seatColumn || '', 2).toUpperCase();
        if (!Number.isFinite(row) || !/^[A-Z]$/.test(col)) continue;
        seats.push({ serviceId, segmentKey, segment, passengerType, row, col, number: clean(m.seatNumber || `${row}${col}`, 5), type: clean(m.seatType || '', 20),
          position: clean(m.position || '', 10), available: m.available !== false, price });
      } else if (cat.includes('bag') || cat.includes('lugg')) {
        const m = sv?.metadata?.baggage || sv?.baggage || {}, text = `${sv?.name || ''} ${sv?.description || ''} ${m.bagType || m.type || ''}`;
        const dims = m.dimensions || m.size || {}, size = typeof dims === 'string' ? clean(dims, 40)
          : [dims.length, dims.width, dims.height].every((v) => Number.isFinite(Number(v))) ? `${dims.length} × ${dims.width} × ${dims.height} ${clean(dims.unit || 'cm', 4)}` : '';
        bags.push({ serviceId, segmentKey, segment, passengerType, name: clean(sv?.name || sv?.description || 'Extra bag', 80),
          kind: /sport|ski|snowboard|golf|bike|bicycle|surf|instrument|special|pram|stroller|wheelchair/i.test(text) ? 'special' : /personal|under.?seat|small bag/i.test(text) ? 'personal' : /cabin|carry|hand|overhead/i.test(text) ? 'cabin' : 'checked',
          weightKg: Number.isFinite(Number(m.weight ?? m.weightKg)) ? Number(m.weight ?? m.weightKg) : null, size,
          quantityMax: Math.min(3, Math.max(1, Number(m.maxQuantity || sv?.maxQuantity) || 1)), price });
      } else if (price) {
        /* Any other paid service the airline offers for this fare (priority boarding, meals, fast track, lounge, insurance,
           flexibility...): shown with the airline's own name and price, attached the same way. Unpriced items are skipped. */
        const name = clean(sv?.name || sv?.description || '', 80);
        if (!name) continue;
        const kindOf = /priority|boarding/i.test(name + cat) ? 'priority' : /meal|food|drink|snack/i.test(name + cat) ? 'meal' : /insur/i.test(name + cat) ? 'insurance'
          : /flex|change|refund|cancel/i.test(name + cat) ? 'flexibility' : /lounge|fast.?track/i.test(name + cat) ? 'airport' : 'other';
        others.push({ serviceId, segmentKey, segment, passengerType, name, kind: kindOf, description: clean(sv?.description && sv.description !== sv?.name ? sv.description : '', 160),
          quantityMax: Math.min(3, Math.max(1, Number(sv?.maxQuantity || sv?.metadata?.maxQuantity) || 1)), price });
      }
    }
  }
  return { seats: seats.slice(0, 1500), bags: bags.slice(0, 60), others: others.slice(0, 40) };
}
export function selection(list, paxCount) {
  if (!Array.isArray(list) || !list.length || list.length > 40) return null;
  const out = [];
  for (const x of list) {
    const serviceId = id(String(x?.serviceId || '')), passengerIndex = Number(x?.passengerIndex), quantity = Number(x?.quantity ?? 1);
    if (!serviceId || !Number.isInteger(passengerIndex) || passengerIndex < 0 || passengerIndex >= paxCount || !Number.isInteger(quantity) || quantity < 1 || quantity > 3) return null;
    out.push({ passengerIndex, serviceId, quantity });
  }
  return out;
}
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
    phoneCountryCode: String(c?.phoneCountryCode || '').replace(/\D/g, '').slice(0, 4), phoneNumber: String(c?.phoneNumber || '').replace(/\D/g, '') };
  /* International form: no trunk 0 after the country code (+44 07700 → +44 7700), except Italy, San Marino and the
     Vatican, whose numbers keep their leading 0. A number typed with its own +code or 00code loses that prefix. */
  if (v.phoneCountryCode && v.phoneNumber.startsWith('00' + v.phoneCountryCode)) v.phoneNumber = v.phoneNumber.slice(2 + v.phoneCountryCode.length);
  else if (v.phoneCountryCode && /^\s*\+/.test(String(c?.phoneNumber || '')) && v.phoneNumber.startsWith(v.phoneCountryCode)) v.phoneNumber = v.phoneNumber.slice(v.phoneCountryCode.length);
  if (!['39', '378'].includes(v.phoneCountryCode)) v.phoneNumber = v.phoneNumber.replace(/^0+/, '');
  return Object.values(v).every(Boolean) && v.phoneNumber.length >= 4 && v.phoneCountryCode.length + v.phoneNumber.length <= 15 ? v : null;
}

/* Ties the extras call to the browser that made the prebook: an HMAC of the prebook id under a server-only key. */
export async function extrasToken(prebookId, env) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(`aiva-extras:${env.LITEAPI_KEY || ''}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(String(prebookId)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
export async function onRequestPost({ request, env }, fetcher = fetch) {
  if (!allowedOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
  if (!env?.LITEAPI_KEY) return json({ error: 'Flight booking is not connected yet (Nuitee key missing).' }, 503);
  const testMode = isSandboxKey(env.LITEAPI_KEY);
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 20000)); } catch { return json({ error: 'Invalid request' }, 400); }
  if (!testMode && env.FLIGHT_BOOKING_LIVE !== 'true' && !(body?.action === 'verify' && readinessCheck(request, env)))
    return json({ error: 'Real flight tickets are waiting for the owner\'s approval with Nuitee to take live payments. Nothing was booked or charged.', blocked: 'approval' }, 403);
  /* Paid seats and extra bags change the amount charged, so with a live key they stay off until the attach flow has
     passed a Nuitee sandbox run and the owner sets FLIGHT_EXTRAS_LIVE = "true". Sandbox previews always offer them. */
  const extrasOn = testMode || env.FLIGHT_EXTRAS_LIVE === 'true';
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
        segments: segs(p.booking?.journey), services: extrasOn ? shapeServices(p.servicesAttachable) : { seats: [], bags: [], others: [] }, extrasOn, ...(testMode ? { servicesShape: servicesShape(p.servicesAttachable) } : {}), extrasToken: extrasOn ? await extrasToken(p.prebookId, env) : undefined, passengers: pax.length, testMode, paymentEnv: testMode ? 'sandbox' : 'live' });
    }
    if (body?.action === 'services') {
      if (!extrasOn) return json({ error: 'Seat and bag add-ons are not available yet. Your fare is unchanged; continue to payment.', blocked: 'extras' }, 403);
      const prebookId = id(body.prebookId), chosen = selection(body.selected, Math.min(9, Math.max(1, Number(body.passengers) || 1)));
      if (!prebookId) return json({ error: 'Booking reference missing. Please start again.' }, 400);
      if (!body.extrasToken || body.extrasToken !== await extrasToken(prebookId, env)) return json({ error: 'This booking session is not yours or has expired. Please start again.' }, 403);
      if (!chosen) return json({ error: 'Choose seats or bags for the listed travellers.' }, 400);
      const r = await call('POST', `/flights/prebooks/${encodeURIComponent(prebookId)}/services`, { selectedServices: chosen }, env, fetcher, 45000);
      if (!r?.transactionId || !r.secretKey) return json({ error: 'The airline did not accept these extras. You can continue without them.' }, 409);
      const price = Number(r.price ?? r.pricing?.display?.total), currency = String(r.currency || r.pricing?.display?.currency || '');
      /* Never hand out a payment session without the airline's new total: the customer must see what they pay. */
      if (!Number.isFinite(price) || price <= 0 || !/^[A-Z]{3}$/.test(currency)) return json({ error: 'The airline did not confirm the new total', unknown: true }, 502);
      return json({ prebookId, transactionId: r.transactionId, secretKey: r.secretKey, price, currency, testMode });
    }
    if (body?.action === 'book') {
      const prebookId = id(body.prebookId), transactionId = id(body.transactionId);
      if (!prebookId || !transactionId) return json({ error: 'Booking reference missing. Please start again.' }, 400);
      const b = await call('POST', '/flights/bookings', { prebookId, clientReference: `aiva-${prebookId}`.slice(0, 64), payment: { method: 'TRANSACTION_ID', transactionId } }, env, fetcher, 90000);
      const s = shapeFlightBooking(b);
      if (!s.bookingId) return json({ error: 'The airline did not confirm the booking. Check "My bookings" and contact Aiva before paying again.' }, 503);
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
    return json({ error: timeout ? 'The airline took too long to answer. Check "My bookings" before trying again.' : (e.message || 'Booking failed.'),
      upstream: e.status || (timeout ? 'timeout' : 'error') }, e.status >= 400 && e.status < 500 ? 409 : 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
