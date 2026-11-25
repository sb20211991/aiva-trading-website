/* Aiva Flights seats and extra bags. Offline: the Nuitee replies are local stubs; nothing is booked or charged. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestPost, shapeServices, selection } from '../functions/api/travel/flight-book.js';

const env = { LITEAPI_KEY: 'sand_test' };
const req = (b) => new Request('https://app.aivatrading.uk/api/travel/flight-book', { method: 'POST', body: JSON.stringify(b), headers: { Origin: 'https://app.aivatrading.uk', 'content-type': 'application/json' } });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const attachable = { groups: [
  { type: 'SEAT', segmentKey: 'LGW-BCN', services: [
    { serviceId: 'seat_12A', category: 'seat', name: 'Seat 12A', segmentKey: 'LGW-BCN', passengerType: 'ADT', pricing: { display: { amount: 9.99, currency: 'GBP' } }, metadata: { seat: { seatColumn: 'A', seatRow: 12, seatNumber: '12A', seatType: 'standard', position: 'window', available: true } } },
    { serviceId: 'seat_12B', category: 'seat', segmentKey: 'LGW-BCN', pricing: { display: { amount: 0, currency: 'GBP' } }, metadata: { seat: { seatColumn: 'B', seatRow: 12, available: false } } },
    { serviceId: 'seat_bad', category: 'seat', metadata: { seat: { seatRow: 'x' } } }] },
  { type: 'BAGGAGE', segmentKey: 'LGW-BCN', services: [
    { serviceId: 'bag_20', category: 'baggage', name: 'Checked bag', pricing: { display: { amount: 32, currency: 'GBP' } }, metadata: { baggage: { weight: 20, maxQuantity: 2 } } }] }] };

// Only the airline's own seats and bags are shaped, with their prices; malformed seats are dropped.
{
  const s = shapeServices(attachable);
  assert.deepEqual(s.seats.map((x) => [x.number, x.available, x.price?.amount]), [['12A', true, 9.99], ['12B', false, 0]]);
  assert.equal(s.bags[0].weightKg, 20); assert.equal(s.bags[0].quantityMax, 2); assert.equal(s.bags[0].price.amount, 32);
  assert.deepEqual(shapeServices(undefined), { seats: [], bags: [] });
}
// Selections must name a listed traveller and a sane quantity.
assert.deepEqual(selection([{ passengerIndex: 0, serviceId: 'seat_12A' }], 1), [{ passengerIndex: 0, serviceId: 'seat_12A', quantity: 1 }]);
assert.equal(selection([{ passengerIndex: 1, serviceId: 'seat_12A' }], 1), null);
assert.equal(selection([{ passengerIndex: 0, serviceId: 'bag_20', quantity: 9 }], 1), null);
assert.equal(selection([], 1), null);

// Prebook returns the extras; the services action attaches them and returns the new payment secret and total.
{
  const pax = [{ passengerType: 0, firstName: 'Ana', lastName: 'Test', birthday: '1990-01-01', gender: 'F', nationality: 'GB' }];
  const contact = { firstName: 'Ana', lastName: 'Test', email: 'ana@example.com', phoneCountryCode: '44', phoneNumber: '7700900000' };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([String(url), init?.body ? JSON.parse(init.body) : null]);
    if (String(url).endsWith('/flights/prebooks')) return reply({ data: [{ prebookId: 'pb_1234', transactionId: 'tr_1111', secretKey: 'sk_1', price: 120, currency: 'GBP', servicesAttachable: attachable }] });
    if (String(url).endsWith('/flights/prebooks/pb_1234/services')) return reply({ data: [{ transactionId: 'tr_2222', secretKey: 'sk_2', price: 161.99, currency: 'GBP' }] });
    return reply({ error: { description: 'unexpected' } }, 500);
  };
  const p = await (await onRequestPost({ request: req({ action: 'prebook', offerId: 'off_1234', contact, passengers: pax }), env }, fetcher)).json();
  assert.equal(p.services.seats.length, 2); assert.equal(p.services.bags.length, 1); assert.equal(p.passengers, 1); assert.equal(p.testMode, true);
  const r = await onRequestPost({ request: req({ action: 'services', prebookId: 'pb_1234', extrasToken: p.extrasToken, passengers: 1, selected: [{ passengerIndex: 0, serviceId: 'seat_12A' }, { passengerIndex: 0, serviceId: 'bag_20', quantity: 1 }] }), env }, fetcher);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual([d.transactionId, d.secretKey, d.price], ['tr_2222', 'sk_2', 161.99]);
  assert.deepEqual(calls.at(-1)[1], { selectedServices: [{ passengerIndex: 0, serviceId: 'seat_12A', quantity: 1 }, { passengerIndex: 0, serviceId: 'bag_20', quantity: 1 }] });
  // A bad selection never reaches the airline.
  const n = calls.length;
  assert.equal((await onRequestPost({ request: req({ action: 'services', prebookId: 'pb_1234', extrasToken: p.extrasToken, passengers: 1, selected: [{ passengerIndex: 3, serviceId: 'seat_12A' }] }), env }, fetcher)).status, 400);
  assert.equal(calls.length, n);
  // Another caller's prebook (no or wrong token) is refused before the airline is called.
  const sel = [{ passengerIndex: 0, serviceId: 'bag_20', quantity: 1 }];
  assert.equal((await onRequestPost({ request: req({ action: 'services', prebookId: 'pb_1234', passengers: 1, selected: sel }), env }, fetcher)).status, 403);
  assert.equal((await onRequestPost({ request: req({ action: 'services', prebookId: 'pb_1234', extrasToken: 'f'.repeat(40), passengers: 1, selected: sel }), env }, fetcher)).status, 403);
  assert.equal(calls.length, n);
  // No confirmed total from the airline: no payment session is handed out.
  const noTotal = async (url) => String(url).endsWith('/services') ? reply({ data: [{ transactionId: 'tr_3', secretKey: 'sk_3' }] }) : fetcher(url);
  const u = await onRequestPost({ request: req({ action: 'services', prebookId: 'pb_1234', extrasToken: p.extrasToken, passengers: 1, selected: sel }), env }, noTotal);
  const ud = await u.json();
  assert.equal(u.status, 502); assert.equal(ud.unknown, true); assert.ok(!ud.secretKey);
}
// The picker filters seats by traveller type, groups bags by flight, locks while attaching and never reuses an old total.
{
  const js = readFileSync(new URL('../public/aiva-flight-extras.js', import.meta.url), 'utf8');
  assert.match(js, /s\.passengerType === type/); assert.match(js, /flightNo\(sk\)/); assert.match(js, /if \(st\.busy\) return/);
  assert.match(js, /did not confirm the new total/); assert.ok(!js.includes("forEach((x) => { x.disabled = false; })")); assert.ok(!js.includes('...(Number.isFinite(r.price)'));
}
// The page loads the picker before app.js, and checkout waits for it after the prebook.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('src="aiva-flight-extras.js"') > -1 && html.indexOf('src="aiva-flight-extras.js"') < html.indexOf('src="app.js"'));
assert.match(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), /window\.aivaFlightExtras\(p,box,passengers\)/);
// With a live key, paid extras stay off (no services offered, attach refused) until FLIGHT_EXTRAS_LIVE is "true".
{
  const live = { LITEAPI_KEY: 'prod_live_key', FLIGHT_BOOKING_LIVE: 'true' };
  const pax = [{ passengerType: 0, firstName: 'Ana', lastName: 'Test', birthday: '1990-01-01', gender: 'F', nationality: 'GB' }];
  const contact = { firstName: 'Ana', lastName: 'Test', email: 'ana@example.com', phoneCountryCode: '44', phoneNumber: '7700900000' };
  const calls = [];
  const f = async (url) => { calls.push(String(url)); return reply({ data: [{ prebookId: 'pb_9999', transactionId: 'tr_9', secretKey: 'sk_9', price: 120, currency: 'GBP', servicesAttachable: attachable }] }); };
  const p = await (await onRequestPost({ request: req({ action: 'prebook', offerId: 'offer_123', contact, passengers: pax }), env: live }, f)).json();
  assert.deepEqual(p.services, { seats: [], bags: [] });
  const s = await onRequestPost({ request: req({ action: 'services', prebookId: 'pb_9999', passengers: 1, selected: [{ passengerIndex: 0, serviceId: 'bag_20', quantity: 1 }] }), env: live }, f);
  assert.equal(s.status, 403); assert.ok(!calls.some((u) => u.includes('/services')));
  const on = await (await onRequestPost({ request: req({ action: 'prebook', offerId: 'offer_123', contact, passengers: pax }), env: { ...live, FLIGHT_EXTRAS_LIVE: 'true' } }, f)).json();
  assert.equal(on.services.bags.length, 1);
}
console.log('FLIGHT EXTRAS CHECKS PASSED');
