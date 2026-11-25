/* OSDM (UIC IRS 90918-10) mapping for Aiva's rail-sales gateway.

   Field names were read from the generated osdm-sys models (docs.rs), not from the distributor's own
   OpenAPI file. They must be checked against the signed distributor's specification before any live call.
   Endpoint paths are deliberately not defined here: the distributor's contract supplies them.

   Wire names are camelCase, as on the OSDM models page (offerId, bookingCode, controlNumber).

   Not built yet, because their models are not verified: fare extraction from offers (the crate's Offer model
   has no minimalPrice field, which the published models page names), the booking request body (passenger
   detail fields), and the trip and station fields for the order summary. */

const PASSENGER_TYPE = 'PERSON';
const MAX_PASSENGERS = 9;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/* A place is sent as a GeoPositionRef: Aiva's stop data carries latitude and longitude. */
export function geoPlace(point) {
  const latitude = Number(point?.lat ?? point?.latitude);
  const longitude = Number(point?.lon ?? point?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw fail('OSDM searches need coordinates for both stations.');
  }
  return { objectType: 'GeoPositionRef', latitude, longitude };
}

/* OfferCollectionRequest: one trip search by departure time, plus the passengers it is priced for. */
export function buildOfferCollectionRequest({ from, to, depart, passengers = 1 }) {
  const when = String(depart || '');
  if (!Number.isFinite(Date.parse(when))) throw fail('The departure time is not a valid date and time.');
  const count = Math.floor(Number(passengers));
  if (!Number.isFinite(count) || count < 1 || count > MAX_PASSENGERS) throw fail(`Choose 1 to ${MAX_PASSENGERS} passengers.`);
  return {
    tripSearchCriteria: { departureTime: when, origin: geoPlace(from), destination: geoPlace(to) },
    anonymousPassengerSpecifications: Array.from({ length: count }, (_, i) => ({ externalRef: `p${i + 1}`, type: PASSENGER_TYPE }))
  };
}

/* Price: amount in minor units (cents) with an optional scale, default 2 (OSDM Price model). */
export function priceToMajor(price) {
  if (!price || !Number.isInteger(price.amount) || price.amount < 0) return null;
  const currency = String(price.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const scale = Number.isInteger(price.scale) ? price.scale : 2;
  if (scale < 0 || scale > 6) return null;
  return { amount: Number((price.amount / 10 ** scale).toFixed(scale)), currency };
}

/* Maps a booking to the gateway's /orders reply. Ticket data comes from the first fulfilment; the issuer is
   an ERA or RICS company code, not a name, so it is not presented as the operator. */
export function bookingToOrder(booking, { testMode = false } = {}) {
  if (!booking || typeof booking.id !== 'string' || !booking.id) throw fail('The distributor did not return a booking.', 503);
  const fulfilment = Array.isArray(booking.fulfillments) ? booking.fulfillments[0] : null;
  const control = String(fulfilment?.controlNumber || '').slice(0, 200);
  const price = priceToMajor(booking.confirmedPrice) || priceToMajor(booking.provisionalPrice);
  return {
    orderId: booking.id.slice(0, 80),
    pnr: String(booking.bookingCode || booking.externalRef || '').slice(0, 40),
    status: String(booking.fulfillmentStatus || 'CONFIRMED').slice(0, 40),
    operator: '',
    from: '', to: '', depart: '', arrive: '',
    fare: price ? { amount: price.amount, currency: price.currency } : { amount: null, currency: '' },
    ticket: { barcode: control, qrPayload: control },
    testMode: testMode === true
  };
}

/* Endpoints from the OSDM processes page (osdm.io/spec/processes). Relative to the provider's API base. */
export const OSDM_ENDPOINTS = {
  tripCollection: '/trip-collection',
  offers: '/offers',
  bookings: '/bookings'
};

/* OAuth2 client credentials with client_id and client_secret (RFC 6749 4.4.2). The spec's preferred method is a
   signed JWT (private_key_jwt); that needs the distributor's public key registered and is not built yet. */
export function tokenRequestBody({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) throw fail('The distributor login needs a client id and secret.', 500);
  return new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
}

/* Caches the access token until shortly before expires_in. The spec issues no refresh tokens, so a new token is
   requested when the old one is near expiry. */
export function createTokenProvider({ tokenUrl, clientId, clientSecret, fetcher = fetch, now = () => Date.now(), marginMs = 60000 }) {
  let cached = null;
  return async function accessToken() {
    if (cached && now() < cached.expiresAt - marginMs) return cached.token;
    const res = await fetcher(tokenUrl, {
      method: 'POST', body: tokenRequestBody({ clientId, clientSecret }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || typeof data?.access_token !== 'string' || !Number.isFinite(Number(data?.expires_in))) {
      throw fail('The distributor login was refused.', 503);
    }
    cached = { token: data.access_token, expiresAt: now() + Number(data.expires_in) * 1000 };
    return cached.token;
  };
}

/* Fares on one offer: Offer.fares[] each carry prices[] (Price: amount in cents, currency, scale). Field names
   are camelCase on the wire, as for the other verified models. Prices that fail validation are dropped, and no
   refund or condition terms are inferred: those need the AfterSalesConditions model, which is not verified. */
export function offerFares(offer) {
  const offerId = String(offer?.offerId || '').slice(0, 200);
  if (!offerId) return [];
  const fares = Array.isArray(offer.fares) ? offer.fares : [];
  return fares.flatMap((fare) => (Array.isArray(fare?.prices) ? fare.prices : []).map((price) => {
    const money = priceToMajor(price);
    if (!money) return null;
    return {
      offerId,
      fareId: String(fare.id || '').slice(0, 200),
      fareType: String(fare.type || '').slice(0, 80),
      travelClass: String(fare.travelClass || '').slice(0, 40),
      amount: money.amount,
      currency: money.currency
    };
  })).filter(Boolean);
}
