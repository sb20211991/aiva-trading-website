/* Bike carriage on trains and trams, and flight baggage. Offline: upstream replies are mocked.
   Proves Aiva only says "bikes allowed" when the operator publishes it, never shows unknown as "not allowed",
   and never says "no checked bag" when the airline sent no baggage data. */
import assert from 'node:assert/strict';
import { normalise, motisPlan } from '../functions/_lib/motis.js';
import { shapeJourney, paidBags, bagKind, allowanceItems, extraBagOptions } from '../functions/_lib/travel.js';
import { readFileSync } from 'node:fs';
import { shapeServices } from '../functions/api/travel/flight-book.js';

const leg = (over) => ({ mode: 'REGIONAL_RAIL', from: { name: 'A', departure: '2026-11-27T10:20:00Z', tz: 'Europe/London' },
  to: { name: 'B', arrival: '2026-11-27T11:43:00Z', tz: 'Europe/London' }, duration: 4980, agencyName: 'Thameslink', ...over });

// ---- Bikes: true only when the feed says allowed; walking legs carry no bike claim.
{
  const it = normalise({ id: 'x', startTime: '2026-11-27T10:14:00Z', endTime: '2026-11-27T11:44:00Z', duration: 5400, legs: [
    { mode: 'WALK', from: { name: 'S' }, to: { name: 'A' }, duration: 60 }, leg({ bikesAllowed: true }), leg({ bikesAllowed: false }), leg({})] });
  assert.deepEqual(it.legs.map((l) => l.bikes), [null, true, false, false]);
}

// ---- The bike-only search asks Transitous for bike carriage, and only when requested.
{
  const seen = [];
  const fetcher = async (u) => { seen.push(String(u)); return new Response(JSON.stringify({ itineraries: [] })); };
  await motisPlan({ lat: 51.53, lon: -0.12 }, { lat: 50.83, lon: -0.14 }, { fetcher, modes: ['train'], requireBikes: true });
  await motisPlan({ lat: 51.53, lon: -0.12 }, { lat: 50.83, lon: -0.14 }, { fetcher, modes: ['train'] });
  assert.match(seen[0], /requireBikeTransport=true/);
  assert.doesNotMatch(seen[1], /requireBikeTransport/);
}

// ---- Flight baggage: reported allowances are shown; missing data is not turned into "no checked bag".
{
  const journey = (offer) => ({ cheapestOffer: { offerId: 'o', pricing: { display: { total: 100, currency: 'GBP' } }, ...offer },
    segments: [{ originCode: 'LHR', destinationCode: 'CDG', departureTime: '2026-12-01T10:00:00Z', arrivalTime: '2026-12-01T12:00:00Z', carrier: { marketingName: 'Air' } }] });
  const legs = [{ from: 'LHR', to: 'CDG', date: '2026-12-01' }];
  const none = shapeJourney(journey({}), legs);
  assert.equal(none.bags, null);
  assert.equal(none.baggage, '');
  const partial = shapeJourney(journey({ baggage: { hasCarryOnBag: true } }), legs);
  assert.equal(partial.bags.checked, null);
  assert.equal(partial.baggage, '');
  const cabinOnly = shapeJourney(journey({ baggage: { hasCarryOnBag: true, hasCheckedBag: false, included: [] } }), legs);
  assert.equal(cabinOnly.baggage, 'No checked bag included');
  assert.equal(cabinOnly.bags.carryOn, true);
  const checked = shapeJourney(journey({ baggage: { hasCheckedBag: true, included: [{ pieces: 1, description: '23kg checked bag' }] } }), legs);
  assert.equal(checked.baggage, '1× 23kg checked bag');
  assert.equal(checked.bags.checked, true);
}

// ---- Paid bags: grouped by type at the lowest price offered, not 30 near-duplicate lines.
{
  const p = (description, amount) => ({ description, pricing: { display: { amount, currency: 'GBP' } } });
  assert.deepEqual(paidBags([p('Checked bag', 142.43), p('Checked bag', 25.14), p('Cabin bag', 20.04), p('Cabin bag', 19.61), p('Checked bag', 56.67)]),
    ['Checked bag from 25.14 GBP', 'Cabin bag from 19.61 GBP']);
  assert.deepEqual(paidBags([{ description: 'Sports bag' }]), ['Sports bag']);
  assert.deepEqual(paidBags(undefined), []);
}

// ---- Airline-specific allowance: personal item, cabin bag and checked bag, with the airline's weight and size.
{
  assert.equal(bagKind({ bagType: 'PERSONAL_ITEM' }), 'personal');
  assert.equal(bagKind({ bagType: 'CARRY_ON' }), 'cabin');
  assert.equal(bagKind({ description: 'Checked bag 23kg' }), 'checked');
  const a = allowanceItems([{ bagType: 'PERSONAL_ITEM', pieces: 1, size: { length: 40, width: 30, height: 20 } }, { bagType: 'CARRY_ON', description: 'Cabin bag 10kg' }, { bagType: 'CHECKED', pieces: 2, weight: 23 }]);
  assert.deepEqual(a.map((b) => [b.kind, b.pieces, b.weightKg, b.size]), [['personal', 1, null, '40 × 30 × 20 cm'], ['cabin', 1, 10, ''], ['checked', 2, 23, '']]);
  // Nothing is assumed: no weight in the airline data means no weight shown.
  assert.equal(allowanceItems([{ bagType: 'CHECKED' }])[0].weightKg, null);
  // Paid bags: one option per type and weight at the airline's lowest price; unpriced or bad-currency rows are dropped.
  const x = extraBagOptions([{ description: 'Checked bag 20kg', pricing: { display: { amount: 30, currency: 'GBP' } } }, { description: 'Checked bag 20kg', pricing: { display: { amount: 25.5, currency: 'GBP' } } },
    { description: 'Checked bag 32kg', pricing: { display: { amount: 55, currency: 'GBP' } } }, { bagType: 'CARRY_ON', description: 'Cabin bag 10kg', pricing: { display: { amount: 12, currency: 'GBP' } } },
    { description: 'Checked bag 15kg' }, { description: 'Odd', pricing: { display: { amount: 5, currency: 'pounds' } } }]);
  assert.deepEqual(x.map((b) => [b.kind, b.weightKg, b.amount]), [['cabin', 10, 12], ['checked', 20, 25.5], ['checked', 32, 55]]);
  const j = shapeJourney({ cheapestOffer: { offerId: 'o', pricing: { display: { total: 100, currency: 'GBP' } }, baggage: { hasCarryOnBag: true, hasCheckedBag: false,
    included: [{ bagType: 'PERSONAL_ITEM', pieces: 1 }, { bagType: 'CARRY_ON', pieces: 1, weight: 10 }], paid: [{ description: 'Checked bag 20kg', pricing: { display: { amount: 25, currency: 'EUR' } } }] } },
    segments: [{ originCode: 'STN', destinationCode: 'BCN', departureTime: '2026-12-01T10:00:00Z', arrivalTime: '2026-12-01T12:00:00Z', carrier: { marketingName: 'Example Air' } }] }, [{ from: 'STN', to: 'BCN', date: '2026-12-01' }]);
  assert.deepEqual(j.bags.allowance.map((b) => b.kind), ['personal', 'cabin']);
  assert.equal(j.bags.extras[0].amount, 25); assert.equal(j.bags.extras[0].currency, 'EUR');
  assert.match(j.bags.source, /airline/);
  // Extra bags at prebook carry cabin/checked kind and the airline's price.
  const sv = shapeServices({ groups: [{ type: 'BAGGAGE', services: [{ serviceId: 'bag_cabin10', category: 'baggage', name: 'Cabin bag 10kg', pricing: { display: { amount: 15, currency: 'EUR' } }, metadata: { baggage: { weight: 10 } } },
    { serviceId: 'bag_hold23', category: 'baggage', name: 'Checked bag 23kg', pricing: { display: { amount: 40, currency: 'EUR' } }, metadata: { baggage: { weight: 23, maxQuantity: 2 } } }] }] });
  assert.deepEqual(sv.bags.map((b) => [b.kind, b.weightKg, b.price.amount, b.quantityMax]), [['cabin', 10, 15, 1], ['checked', 23, 40, 2]]);
  // The results card names the airline's allowance and offers add-on bags with prices.
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /baggage allowance/); assert.match(app, /Personal item/); assert.match(app, /Add baggage/);
}
console.log('BIKE AND BAGGAGE CHECKS PASSED');
