/* POST /api/travel/hotel-book — in-app hotel booking through Nuitee (LiteAPI) with the Nuitee payment SDK.
   {action:'prebook', offerId} -> prebookId, transactionId and the payment-form secret, plus the final price and terms.
   {action:'book', prebookId, transactionId, holder:{firstName,lastName,email}} -> confirmed booking (after the SDK payment).
   Sandbox keys make test bookings only. A production key books for real only when HOTEL_BOOKING_LIVE is "true". */
import { isSandboxKey } from '../../_lib/travel.js';

const BOOK = 'https://book.liteapi.travel/v3.0';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const allowedOrigin = (request) => {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (hostname === new URL(request.url).hostname) return true;
    if (protocol === 'https:' && /^app\.aivatrading\.uk$|(^|\.)aiva-pocket-hub\.pages\.dev$/.test(hostname)) return true;
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch { return false; }
};
const clean = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const id = (s) => /^[A-Za-z0-9_\-=.]{4,4000}$/.test(s || '') ? s : '';
const email = (s) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s || '') ? s : '';

async function call(path, body, env, fetcher, timeout) {
  const res = await fetcher(`${BOOK}${path}`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
    headers: { 'X-API-Key': env.LITEAPI_KEY, 'Content-Type': 'application/json', Accept: 'application/json' } });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON upstream reply */ }
  if (!res.ok || data?.error) throw Object.assign(new Error(clean(data?.error?.description || data?.error?.message || data?.message || `HTTP ${res.status}`, 200)), { status: res.status });
  return data?.data ?? data;
}
async function existing(clientReference, env, fetcher) {
  const res = await fetcher(`${BOOK}/bookings?clientReference=${encodeURIComponent(clientReference)}`, { signal: AbortSignal.timeout(20000), headers: { 'X-API-Key': env.LITEAPI_KEY, Accept: 'application/json' } });
  const data = res.ok ? await res.json() : null;
  return (data?.data || []).find((b) => b?.bookingId && !/FAIL|CANCEL/i.test(b.status || '')) || null;
}
export const shapePrebook = (p) => {
  const r = p.roomTypes?.[0]?.rates?.[0] || {}, cp = r.cancellationPolicies || {};
  return { prebookId: p.prebookId, transactionId: p.transactionId, secretKey: p.secretKey, hotelId: p.hotelId, price: Number(p.price), currency: p.currency,
    checkin: p.checkin, checkout: p.checkout, room: r.name || '', board: r.boardName || '', refundable: cp.refundableTag === 'RFN',
    cancelBy: cp.cancelPolicyInfos?.[0]?.cancelTime || '', priceChanged: Number(p.priceDifferencePercent) !== 0, cancellationChanged: !!p.cancellationChanged,
    taxesDue: (r.retailRate?.taxesAndFees || []).filter((t) => t.included === false).reduce((n, t) => n + (Number(t.amount) || 0), 0),
    terms: clean(p.termsAndConditions, 2000) };
};
export const shapeBooking = (b) => ({ bookingId: b.bookingId, status: b.status, confirmation: b.hotelConfirmationCode || b.supplierBookingId || '',
  hotel: b.hotel?.name || '', checkin: b.checkin, checkout: b.checkout, price: Number(b.price), currency: b.currency,
  room: b.bookedRooms?.[0]?.roomType?.name || '', refundable: b.cancellationPolicies?.refundableTag === 'RFN',
  cancelBy: b.cancellationPolicies?.cancelPolicyInfos?.[0]?.cancelTime || '' });

export async function onRequestPost({ request, env }, fetcher = fetch) {
  if (!allowedOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
  if (!env?.LITEAPI_KEY) return json({ error: 'Hotel booking is not connected yet (Nuitee key missing).' }, 503);
  const testMode = isSandboxKey(env.LITEAPI_KEY);
  if (!testMode && env.HOTEL_BOOKING_LIVE !== 'true')
    return json({ error: 'Real hotel bookings are waiting for the owner\'s approval to take live payments. Nothing was booked or charged.', blocked: 'approval' }, 403);
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 8000)); } catch { return json({ error: 'Invalid request' }, 400); }
  try {
    if (body?.action === 'prebook') {
      const offerId = id(body.offerId);
      if (!offerId) return json({ error: 'Choose a room first.' }, 400);
      const p = await call('/rates/prebook', { offerId, usePaymentSdk: true }, env, fetcher, 30000);
      if (!p?.prebookId || !p.transactionId || !p.secretKey) return json({ error: 'This room is no longer available. Please choose another.' }, 409);
      return json({ ...shapePrebook(p), testMode, paymentEnv: testMode ? 'sandbox' : 'live' });
    }
    if (body?.action === 'book') {
      const prebookId = id(body.prebookId), transactionId = id(body.transactionId), h = body.holder || {};
      const holder = { firstName: clean(h.firstName), lastName: clean(h.lastName), email: email(clean(h.email, 254)) };
      if (!prebookId || !transactionId) return json({ error: 'Booking reference missing. Please start again.' }, 400);
      if (!holder.firstName || !holder.lastName || !holder.email) return json({ error: 'Enter the guest\'s first name, last name and email.' }, 400);
      const clientReference = `aiva-${prebookId}`;
      let b;
      try {
        b = await call('/rates/book', { prebookId, clientReference, holder, payment: { method: 'TRANSACTION_ID', transactionId },
          guests: [{ occupancyNumber: 1, ...holder }] }, env, fetcher, 60000);
      } catch (e) {
        b = await existing(clientReference, env, fetcher).catch(() => null);
        if (!b) throw e;
      }
      if (!b?.bookingId) return json({ error: 'The hotel did not confirm the booking. If you were charged, the hold is released within 1-2 business days.' }, 503);
      return json({ ...shapeBooking(b), testMode });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    const timeout = e.name === 'TimeoutError';
    return json({ error: timeout ? 'The booking service took too long. Check "My bookings" before trying again.' : (e.message || 'Booking failed.'),
      upstream: e.status || (timeout ? 'timeout' : 'error') }, e.status >= 400 && e.status < 500 ? 409 : 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
