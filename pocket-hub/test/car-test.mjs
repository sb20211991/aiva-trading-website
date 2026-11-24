/* Aiva Car Rental API: no supplier, no offers; every offer must carry an id, a supplier and a real price;
   unknown payment methods are dropped; orders are same-origin only and never created without a supplier. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost, salesStatus, offerShape, sameOrigin, PAYMENT_METHODS } from '../functions/api/car.js';

const LIVE = { CAR_RENTAL_GATEWAY_URL: 'https://cars.example.com/v1', CAR_RENTAL_GATEWAY_KEY: 'k', CAR_RENTAL_PROVIDER: 'Example Cars' };
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const req = (url, init = {}) => new Request('https://app.aivatrading.uk' + url, init);
const ctx = (env, url = '/api/car?action=search&pickup=Heathrow&from=2026-12-01T10:00:00Z&to=2026-12-05T10:00:00Z&age=35') => ({ request: req(url), env });

const OFFER = (over = {}) => ({
  id: 'of-1', supplier: 'Example Cars',
  vehicle: { name: 'VW Polo', category: 'Economy', transmission: 'automatic', seats: 5, bags: 2, imageUrl: 'https://img.example.com/polo.jpg' },
  price: { amount: 120.5, currency: 'gbp', days: 4 },
  deposit: { amount: 200, currency: 'GBP' }, mileage: 'Unlimited', insurance: 'Collision damage waiver included',
  cancellation: 'Free cancellation up to 48 hours before pick-up',
  pickup: { name: 'Heathrow T5', address: 'Heathrow, TW6' },
  payment: { sessionId: 'sess-1', sdkUrl: 'https://pay.example.com/sdk.js', methods: ['card', 'crypto', 'apple_pay'] },
  ...over
});

const search = async (env, offerList = [OFFER()], url) => {
  const calls = [];
  const fetcher = async (u, init) => { calls.push({ u: String(u), init }); return jsonRes({ offers: offerList }); };
  const res = await onRequestGet(ctx(env, url), fetcher);
  return { body: await res.json(), status: res.status, calls };
};

test('no supplier: nothing for sale, and no invented payment methods', async () => {
  const s = salesStatus({});
  assert.equal(s.available, false);
  assert.deepEqual(s.paymentMethods, []);
  assert.ok(s.suppliers.length >= 1);
  const { body, status, calls } = await search({});
  assert.equal(status, 200);
  assert.equal(body.sales.available, false);
  assert.deepEqual(body.offers, []);
  assert.equal(calls.length, 0, 'must not call a supplier that is not configured');
});

test('search input is validated before any supplier call', async () => {
  const bad = [
    '/api/car?action=search&pickup=&from=2026-12-01T10:00:00Z&to=2026-12-05T10:00:00Z&age=35',
    '/api/car?action=search&pickup=Heathrow&from=bad&to=2026-12-05T10:00:00Z&age=35',
    '/api/car?action=search&pickup=Heathrow&from=2026-12-05T10:00:00Z&to=2026-12-01T10:00:00Z&age=35',
    '/api/car?action=search&pickup=Heathrow&from=2026-12-01T10:00:00Z&to=2027-06-05T10:00:00Z&age=35',
    '/api/car?action=search&pickup=Heathrow&from=2026-12-01T10:00:00Z&to=2026-12-05T10:00:00Z&age=17'
  ];
  for (const url of bad) {
    const res = await onRequestGet(ctx(LIVE, url), async () => jsonRes({}));
    assert.equal(res.status, 400, url);
  }
});

test('live offers are cleaned, filtered and cheapest first', async () => {
  const dear = OFFER({ id: 'of-2', supplier: 'Other', price: { amount: 300, currency: 'GBP', days: 4 } });
  const broken = [OFFER({ id: '' }), OFFER({ id: 'of-3', price: { amount: 0, currency: 'GBP' } }), OFFER({ id: 'of-4', price: { amount: 'x', currency: 'GBP' } })];
  const { body } = await search(LIVE, [dear, ...broken, OFFER()]);
  assert.deepEqual(body.offers.map((o) => o.id), ['of-1', 'of-2']);
  assert.equal(body.offers[0].price.currency, 'GBP');
  assert.deepEqual(body.offers[0].payment.methods, ['card', 'apple_pay']);
  assert.equal(body.offers[0].payment.sdkUrl, 'https://pay.example.com/sdk.js');
  assert.equal(body.offers[0].vehicle.transmission, 'automatic');
  assert.equal(body.sales.available, true);
});

test('http-only image and terms URLs are dropped and bad transmission reads unknown', () => {
  const o = offerShape(OFFER({ vehicle: { name: 'Kia', transmission: 'robotic', imageUrl: 'http://insecure/x.jpg' }, termsUrl: 'javascript:alert(1)' }));
  assert.equal(o.vehicle.imageUrl, '');
  assert.equal(o.termsUrl, '');
  assert.equal(o.vehicle.transmission, 'unknown');
  assert.equal(o.id, 'of-1');
});

test('supplier failure is reported, never disguised as no availability', async () => {
  const fetcher = async () => jsonRes({ error: { message: 'supplier down' } }, 502);
  const res = await onRequestGet(ctx(LIVE), fetcher);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /supplier down/);
});

test('orders: cross-origin refused, no supplier refused, driver details required', async () => {
  const order = (env, body, origin = 'https://app.aivatrading.uk') => onRequestPost({
    request: req('/api/car', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }), env
  }, async () => { throw new Error('must not call supplier'); });
  assert.equal((await order(LIVE, { action: 'order' }, 'https://evil.example')).status, 403);
  const off = await order({}, { action: 'order', offerId: 'of-1', paymentToken: 'tok' });
  assert.equal(off.status, 503);
  assert.match((await off.json()).error, /not enabled/i);
  const noDriver = await order(LIVE, { action: 'order', offerId: 'of-1', paymentToken: 'tok' });
  assert.equal(noDriver.status, 400);
});

test('order is confirmed by the supplier and mapped back', async () => {
  const seen = [];
  const fetcher = async (u, init) => { seen.push({ u: String(u), body: JSON.parse(init.body) }); return jsonRes({ bookingId: 'bk-9', reference: 'AIVA-77', status: 'CONFIRMED', supplier: 'Example Cars', vehicle: 'VW Polo', total: { amount: 120.5, currency: 'GBP' }, testMode: true }); };
  const res = await onRequestPost({
    request: req('/api/car', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.aivatrading.uk' }, body: JSON.stringify({ action: 'order', offerId: 'of-1', paymentToken: 'tok_123', method: 'apple_pay', driver: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', age: 36, country: 'gb' } }) }), env: LIVE
  }, fetcher);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reference, 'AIVA-77');
  assert.equal(body.testMode, true);
  assert.equal(seen[0].body.driver.country, 'GB');
  assert.equal(seen[0].body.paymentToken, 'tok_123');
  assert.equal(seen[0].u, 'https://cars.example.com/v1/orders');
  assert.equal(PAYMENT_METHODS.join(','), 'card,apple_pay,google_pay');
});

test('an unconfirmed order is an error, not a booking', async () => {
  const res = await onRequestPost({
    request: req('/api/car', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.aivatrading.uk' }, body: JSON.stringify({ action: 'order', offerId: 'of-1', paymentToken: 'tok', driver: { firstName: 'A', lastName: 'B', email: 'a@b.co', age: 30 } }) }), env: LIVE
  }, async () => jsonRes({ status: 'PENDING' }));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /did not confirm/i);
});

void sameOrigin;
