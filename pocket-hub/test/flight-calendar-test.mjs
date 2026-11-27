// Aiva six-month flight price calendar and flight result de-duplication. Upstream calls are simulated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { onRequestGet as cal, dayFromOffers, calendarKey, MAX_DATES } from '../functions/api/travel/flight-calendar.js';
import { onRequestGet as flights, dedupeOffers } from '../functions/api/travel/flights.js';

const iso = (d) => d.toISOString().slice(0, 10);
const plus = (n) => iso(new Date(Date.now() + n * 864e5));
const req = (qs) => new Request(`https://app.aivatrading.uk/api/travel/flight-calendar?${qs}`);
// Simulated Nuitee replies: price depends on the date, one date has no flights, one fails.
const seg = (o, d, dep, arr, n, dir = 'OUTBOUND') => ({ originCode: o, destinationCode: d, departureTime: dep, arrivalTime: arr, direction: dir, carrier: { marketingCode: 'EI', marketingName: 'Aer Lingus' }, flight: { marketingNumber: n }, duration: { minutes: 80 } });
const journey = (date, price, n = '151', body = null) => {
  const segments = [seg('LHR', 'DUB', `${date}T07:50:00`, `${date}T09:10:00`, n)];
  const back = body?.legs?.[1];
  if (back) segments.push(seg('DUB', 'LHR', `${back.date}T10:00:00`, `${back.date}T11:20:00`, '152', 'INBOUND'));
  return { segments, cheapestOffer: { offerId: `o${n}${price}`, pricing: { display: { total: price, currency: 'GBP', perPassenger: { adult: { total: price } } } }, fare: { family: 'Saver' }, segmentFares: [{ cabin: 'Economy' }], baggage: {}, terms: {} } };
};
function nuitee(map) {
  const calls = [];
  const f = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    const v = map(body?.legs?.[0]?.date || '', body);
    if (v === 'fail') return new Response('busy', { status: 503 });
    if (v === 'none') return Response.json({ data: [{ journeys: [] }] });
    return Response.json({ data: [{ journeys: v }] });
  };
  f.calls = calls;
  return f;
}

{
  // dayFromOffers keeps the cheapest real price; empty -> none.
  const d = dayFromOffers('2027-01-20', [{ price: 80, currency: 'GBP', airline: 'BA', slices: [{ stops: 0 }] }, { price: 52.72, currency: 'GBP', airline: 'Aer Lingus', slices: [{ stops: 1 }] }], 'Nuitee');
  assert.equal(d.status, 'live'); assert.equal(d.price, 52.72); assert.equal(d.stops, 1); assert.equal(d.airline, 'Aer Lingus');
  assert.equal(dayFromOffers('2027-01-20', [], 'Nuitee').status, 'none');
  assert.notEqual(calendarKey({ from: 'LHR', to: 'DUB', stay: 0, adults: 1, children: 0, infants: 0, cabin: 'economy', currency: 'GBP' }, '2027-01-20'),
    calendarKey({ from: 'LHR', to: 'DUB', stay: 7, adults: 1, children: 0, infants: 0, cabin: 'economy', currency: 'GBP' }, '2027-01-20'));
}

{
  // Not connected: says so, no prices.
  const r = await (await cal({ request: req(`from=LHR&to=DUB&dates=${plus(10)}`), env: {} })).json();
  assert.equal(r.configured, false); assert.deepEqual(r.days, []);
  // Validation.
  assert.equal((await cal({ request: req('from=LHR&to=LHR&dates=' + plus(3)), env: { LITEAPI_KEY: 'prod_x' } })).status, 400);
  assert.equal((await cal({ request: req('from=LHR&to=DUB'), env: { LITEAPI_KEY: 'prod_x' } })).status, 400);
}

{
  const d1 = plus(10), d2 = plus(11), d3 = plus(12), past = plus(-2), far = plus(200);
  const up = nuitee((date) => (date === d2 ? 'none' : date === d3 ? 'fail' : [journey(date, date === d1 ? 61.5 : 99)]));
  const r = await (await cal({ request: req(`from=LHR&to=DUB&dates=${[d1, d2, d3, past, far].join(',')}`), env: { LITEAPI_KEY: 'prod_x' } }, up)).json();
  const by = Object.fromEntries(r.days.map((d) => [d.date, d]));
  assert.equal(r.configured, true); assert.equal(r.provider, 'Nuitee'); assert.equal(r.trip, 'oneway');
  assert.equal(by[d1].status, 'live'); assert.equal(by[d1].price, 61.5); assert.equal(by[d1].currency, 'GBP'); assert.ok(by[d1].checkedAt);
  assert.equal(by[d2].status, 'none');
  assert.equal(by[d3].status, 'unavailable'); assert.equal(by[d3].price, undefined, 'no price is invented for a day that failed');
  assert.equal(by[past].status, 'outside'); assert.equal(by[far].status, 'outside');
  assert.equal(up.calls.length, 3, 'only the three dates inside six months are searched');
  // At most 7 dates per call.
  const many = Array.from({ length: 12 }, (_, i) => plus(20 + i)).join(',');
  const up2 = nuitee((date) => [journey(date, 50)]);
  const r2 = await (await cal({ request: req(`from=LHR&to=DUB&dates=${many}`), env: { LITEAPI_KEY: 'prod_x' } }, up2)).json();
  assert.equal(r2.days.length, MAX_DATES); assert.equal(up2.calls.length, MAX_DATES);
  // Round trip: the search carries a return leg `stay` days later.
  const up3 = nuitee((date, body) => [journey(date, 120, '151', body)]);
  const r3 = await (await cal({ request: req(`from=LHR&to=DUB&dates=${d1}&stay=7`), env: { LITEAPI_KEY: 'prod_x' } }, up3)).json();
  assert.equal(r3.trip, 'return'); assert.equal(r3.stay, 7);
  assert.ok(JSON.stringify(up3.calls[0].body).includes(plus(17)), 'return leg 7 days after departure');
  // Sandbox key: marked as test fares.
  const r4 = await (await cal({ request: req(`from=LHR&to=DUB&dates=${d1}`), env: { LITEAPI_KEY: 'sand_x' } }, nuitee((date) => [journey(date, 10)]))).json();
  assert.equal(r4.testMode, true);
}

{
  // De-duplication: the same flights at the same fare appear once; different flights stay.
  const o = (id, flights, price, dep = '2027-01-20T07:50:00') => ({ id, price, cabin: 'Economy', baggage: 'x', refundable: false, changeable: false, slices: [{ flights, departing: dep }] });
  const out = dedupeOffers([o('a', ['EI151'], 52), o('b', ['EI151'], 52), o('c', ['EI173'], 52, '2027-01-20T17:45:00'), o('d', ['BA824'], 78)]);
  assert.deepEqual(out.map((x) => x.id), ['a', 'c', 'd']);
  // The flight search endpoint returns de-duplicated, cheapest-first offers.
  const dup = nuitee((date) => [journey(date, 90, '824'), journey(date, 52.72), journey(date, 52.72)]);
  const r = await (await flights({ request: new Request(`https://app.aivatrading.uk/api/travel/flights?from=LHR&to=DUB&depart=${plus(30)}`), env: { LITEAPI_KEY: 'prod_x' } }, dup)).json();
  assert.equal(r.configured, true);
  assert.deepEqual(r.offers.map((x) => x.price), [52.72, 90]);
}

{
  // Calendar view logic, run in a sandbox.
  const ctx = { window: {}, document: { readyState: 'complete', getElementById: () => null, addEventListener() {} }, console, Intl, URLSearchParams };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../public/aiva-fare-calendar.js', import.meta.url), 'utf8'), ctx);
  const { monthsFrom, datesOfMonth, bands, cheapest } = ctx.AivaFareCalendar._test;
  const months = monthsFrom('2026-11-27');
  assert.deepEqual([...months], ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05']);
  assert.equal(datesOfMonth('2026-11', '2026-11-27').length, 4, 'no past days');
  assert.equal(datesOfMonth('2027-05', '2026-11-27').at(-1), '2027-05-30', 'ends 184 days ahead (six months)');
  const b = bands([10, 20, 30, 40, 50, 60]);
  assert.equal(b(10), 'low'); assert.equal(b(35), 'mid'); assert.equal(b(60), 'high');
  assert.equal(bands([40])(40), 'low');
  const c = cheapest([{ date: '2027-01-02', status: 'live', price: 30 }, { date: '2027-01-01', status: 'live', price: 30 }, { date: '2027-01-03', status: 'none' }]);
  assert.equal(c.date, '2027-01-01');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="aiva-fare-calendar\.js"/);
  assert.doesNotMatch(readFileSync(new URL('../public/aiva-fare-calendar.js', import.meta.url), 'utf8'), /window\.open|target="_blank"/, 'stays inside Aiva Search');
}

console.log('AIVA FLIGHT CALENDAR CHECKS PASSED');
