/* Bike carriage on trains and trams, and flight baggage. Offline: upstream replies are mocked.
   Proves Aiva only says "bikes allowed" when the operator publishes it, never shows unknown as "not allowed",
   and never says "no checked bag" when the airline sent no baggage data. */
import assert from 'node:assert/strict';
import { normalise, motisPlan } from '../functions/_lib/motis.js';
import { shapeJourney } from '../functions/_lib/travel.js';

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
  const cabinOnly = shapeJourney(journey({ baggage: { hasCarryOnBag: true, hasCheckedBag: false, included: [] } }), legs);
  assert.equal(cabinOnly.baggage, 'No checked bag included');
  assert.equal(cabinOnly.bags.carryOn, true);
  const checked = shapeJourney(journey({ baggage: { hasCheckedBag: true, included: [{ pieces: 1, description: '23kg checked bag' }] } }), legs);
  assert.equal(checked.baggage, '1× 23kg checked bag');
  assert.equal(checked.bags.checked, true);
}

console.log('BIKE AND BAGGAGE CHECKS PASSED');
