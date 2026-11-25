/* OSDM mapping checks. Offline: no distributor call is made. Field names come from the osdm-sys models. */
import assert from 'node:assert/strict';
import { buildOfferCollectionRequest, geoPlace, priceToMajor, bookingToOrder, OSDM_ENDPOINTS, tokenRequestBody, createTokenProvider, offerFares } from '../functions/_lib/osdm.js';

const LON = { lat: 51.5308, lon: -0.1238 };
const PAR = { lat: 48.8809, lon: 2.3553 };

// ---- Offer collection request: camelCase, one passenger spec per traveller, GeoPositionRef places.
{
  const body = buildOfferCollectionRequest({ from: LON, to: PAR, depart: '2026-12-02T08:05:00Z', passengers: 2 });
  assert.deepEqual(body.tripSearchCriteria, {
    departureTime: '2026-12-02T08:05:00Z',
    origin: { objectType: 'GeoPositionRef', latitude: LON.lat, longitude: LON.lon },
    destination: { objectType: 'GeoPositionRef', latitude: PAR.lat, longitude: PAR.lon }
  });
  assert.deepEqual(body.anonymousPassengerSpecifications, [
    { externalRef: 'p1', type: 'PERSON' }, { externalRef: 'p2', type: 'PERSON' }
  ]);
}

// ---- Request validation: bad time, passenger counts and missing coordinates are refused before any call.
{
  assert.throws(() => buildOfferCollectionRequest({ from: LON, to: PAR, depart: 'tomorrow' }), /valid date/);
  assert.throws(() => buildOfferCollectionRequest({ from: LON, to: PAR, depart: '2026-12-02T08:05:00Z', passengers: 0 }), /1 to 9/);
  assert.throws(() => buildOfferCollectionRequest({ from: LON, to: PAR, depart: '2026-12-02T08:05:00Z', passengers: 10 }), /1 to 9/);
  assert.throws(() => geoPlace({ lat: 95, lon: 0 }), /coordinates/);
  assert.throws(() => geoPlace({ name: 'no coordinates' }), /coordinates/);
}

// ---- Price: cents with scale (default 2); invalid currency or amount gives null, never a guessed fare.
{
  assert.deepEqual(priceToMajor({ amount: 1234, currency: 'gbp' }), { amount: 12.34, currency: 'GBP' });
  assert.deepEqual(priceToMajor({ amount: 1500, currency: 'JPY', scale: 0 }), { amount: 1500, currency: 'JPY' });
  assert.equal(priceToMajor({ amount: 12.5, currency: 'EUR' }), null);
  assert.equal(priceToMajor({ amount: 100, currency: 'EURO' }), null);
  assert.equal(priceToMajor({ amount: 100, currency: 'EUR', scale: 9 }), null);
  assert.equal(priceToMajor(undefined), null);
}

// ---- Booking to order: control number becomes the barcode, confirmed price wins over provisional.
{
  const order = bookingToOrder({
    id: 'bk-1', bookingCode: 'ABC123', fulfillmentStatus: 'FULFILLED', created_on: 'x',
    fulfillments: [{ id: 'f-1', controlNumber: 'CTRL-9', issuer: '3200' }],
    provisionalPrice: { amount: 2000, currency: 'EUR' }, confirmedPrice: { amount: 2350, currency: 'EUR' }
  }, { testMode: true });
  assert.equal(order.orderId, 'bk-1');
  assert.equal(order.pnr, 'ABC123');
  assert.equal(order.status, 'FULFILLED');
  assert.deepEqual(order.fare, { amount: 23.5, currency: 'EUR' });
  assert.deepEqual(order.ticket, { barcode: 'CTRL-9', qrPayload: 'CTRL-9' });
  assert.equal(order.operator, '', 'issuer is a company code, so it is not shown as the operator');
  assert.equal(order.testMode, true);
}

// ---- Booking with no fulfilment or price: no invented ticket or fare.
{
  const order = bookingToOrder({ id: 'bk-2' });
  assert.deepEqual(order.ticket, { barcode: '', qrPayload: '' });
  assert.deepEqual(order.fare, { amount: null, currency: '' });
  assert.equal(order.status, 'CONFIRMED');
  assert.throws(() => bookingToOrder({}), /did not return a booking/);
}

// ---- Endpoints and token: client credentials form, cached token, refusal when the login fails.
{
  assert.deepEqual(OSDM_ENDPOINTS, { tripCollection: '/trip-collection', offers: '/offers', bookings: '/bookings' });
  const form = tokenRequestBody({ clientId: 'c1', clientSecret: 's3' });
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('client_id'), 'c1');
  assert.throws(() => tokenRequestBody({ clientId: 'c1' }), /client id and secret/);

  let calls = 0, clock = 0;
  const fetcher = async () => { calls++; return new Response(JSON.stringify({ access_token: 'tok-' + calls, expires_in: 300 }), { status: 200 }); };
  const token = createTokenProvider({ tokenUrl: 'https://idp.example/token', clientId: 'c1', clientSecret: 's3', fetcher, now: () => clock });
  assert.equal(await token(), 'tok-1');
  assert.equal(await token(), 'tok-1', 'cached while valid');
  clock = 250000; // inside the 60s margin before expiry
  assert.equal(await token(), 'tok-2', 'refreshed near expiry');
  assert.equal(calls, 2);

  const refused = createTokenProvider({ tokenUrl: 'https://idp.example/token', clientId: 'c1', clientSecret: 'bad',
    fetcher: async () => new Response('{"error":"invalid_client"}', { status: 401 }) });
  await assert.rejects(refused(), /login was refused/);
}

// ---- Fares on an offer: prices are converted from cents; invalid prices are dropped, not guessed.
{
  const fares = offerFares({ offerId: 'o-1', fares: [
    { id: 'f1', type: 'ADULT', travelClass: '2', prices: [{ amount: 2350, currency: 'EUR' }, { amount: 12.5, currency: 'EUR' }] },
    { id: 'f2', type: 'CHILD', prices: [{ amount: 1200, currency: 'gbp', scale: 2 }] }
  ] });
  assert.deepEqual(fares, [
    { offerId: 'o-1', fareId: 'f1', fareType: 'ADULT', travelClass: '2', amount: 23.5, currency: 'EUR' },
    { offerId: 'o-1', fareId: 'f2', fareType: 'CHILD', travelClass: '', amount: 12, currency: 'GBP' }
  ]);
  assert.deepEqual(offerFares({ fares: [] }), []);
  assert.deepEqual(offerFares({ offerId: 'o-2' }), []);
}

console.log('osdm mapping checks passed');
