/* Aiva Ferry sales gate. Offline: no distributor is contacted. */
import assert from 'node:assert/strict';
import { salesStatus, FERRY_DISTRIBUTORS, FERRY_REQUIRED_DATA } from '../functions/_lib/ferry-sales.js';

// No contract: unavailable, no price or payment is offered, and both official partner programmes are named.
{
  const s = salesStatus({});
  assert.equal(s.available, false);
  assert.deepEqual(s.paymentMethods, []);
  assert.deepEqual(s.distributors.map((d) => d.name), ['Ferryhopper', 'Direct Ferries Connect']);
}
// Half-configured or non-https gateways stay unavailable.
assert.equal(salesStatus({ FERRY_SALES_GATEWAY_URL: 'https://gw.example' }).available, false);
assert.equal(salesStatus({ FERRY_SALES_GATEWAY_URL: 'http://gw.example', FERRY_SALES_GATEWAY_KEY: 'k' }).available, false);
// Full contract configuration is available, with the distributor name taken from config.
{
  const s = salesStatus({ FERRY_SALES_GATEWAY_URL: 'https://gw.example', FERRY_SALES_GATEWAY_KEY: 'k', FERRY_SALES_PROVIDER: 'Ferryhopper' });
  assert.equal(s.available, true);
  assert.equal(s.provider, 'Ferryhopper');
}
assert.equal(FERRY_DISTRIBUTORS.length, 2);
assert.ok(FERRY_REQUIRED_DATA.includes('luggage and baggage allowance'));
assert.deepEqual(salesStatus({}).requiredData, FERRY_REQUIRED_DATA);
// A sailing date without a clock time plans from 08:00 local that day, not from now.
{
  const { onRequestGet } = await import('../functions/api/travel/transfers.js');
  const day = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), bodies = [];
  const f = async (url, init) => { if (String(url).includes('routes')) bodies.push(String(init?.body || '')); return new Response('{}', { status: 500 }); };
  await onRequestGet({ request: new Request(`https://app.aivatrading.uk/api/travel/transfers?from=51.0,1.3&to=50.95,1.85&day=${day}&tz=Europe/London`), env: { GOOGLE_MAPS_API_KEY: 'k' } }, f);
  const times = bodies.map((b) => (b.match(/"departureTime":"([^"]+)"/) || [])[1]).filter(Boolean);
  assert.ok(times.includes(`${day}T08:00:00.000Z`), times.join(','));
}

// Ferry search (ferry=1): a ferry-only search of the open feeds finds real crossings even when the mixed search prefers
// trains, slow detours are dropped, and a route the open feeds do not cover is "unknown" (null), never "no ferry".
{
  const { onRequestGet, ferryCrossings } = await import('../functions/api/travel/transfers.js');
  const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const leg = (mode, from, to, dep, arr, extra = {}) => ({ mode, from: { name: from, departure: dep, tz: 'Europe/Helsinki' }, to: { name: to, arrival: arr, tz: 'Europe/Helsinki' },
    startTime: dep, endTime: arr, duration: (Date.parse(arr) - Date.parse(dep)) / 1000, ...extra });
  const it = (dep, hours, via) => ({ duration: hours * 3600, startTime: dep, endTime: new Date(Date.parse(dep) + hours * 3600e3).toISOString(), transfers: via ? 1 : 0,
    legs: [leg('FERRY', 'Helsinki', via || 'Tallinn', dep, new Date(Date.parse(dep) + hours * 3600e3).toISOString(), { routeShortName: via ? 'Helsinki-Mariehamn' : 'Helsinki-Tallinn', agencyName: 'Tallink Grupp AS', headsign: 'Tallinn' })] });
  const plans = [];
  const f = async (url) => { url = String(url);
    if (url.includes('transitous') && url.includes('/plan')) { plans.push(url); const ferryOnly = /transitModes=FERRY(&|$)/.test(url);
      return Response.json({ itineraries: ferryOnly ? [it(`${day}T07:30:00Z`, 2), it(`${day}T10:30:00Z`, 2), it(`${day}T14:45:00Z`, 42, 'Mariehamn')] : [] }); }
    return new Response('{}', { status: 500 }); };
  const r = await (await onRequestGet({ request: new Request(`https://app.aivatrading.uk/api/travel/transfers?from=60.16,24.95&to=59.44,24.77&day=${day}&ferry=1`), env: {} }, f)).json();
  assert.equal(r.modes.ferry.available, true);
  assert.equal(r.modes.ferry.routes.length, 2, 'the 42-hour detour is dropped');
  assert.ok(r.modes.ferry.routes.every((x) => x.steps.some((s) => s.kind === 'ferry' && s.operator === 'Tallink Grupp AS')));
  assert.ok(plans.some((u) => /transitModes=FERRY(&|$)/.test(u)), 'a ferry-only search was made');
  // Without ferry=1 (airport transfers), no extra ferry search is made.
  plans.length = 0;
  await onRequestGet({ request: new Request(`https://app.aivatrading.uk/api/travel/transfers?from=60.16,24.95&to=59.44,24.77&day=${day}`), env: {} }, f);
  assert.ok(!plans.some((u) => /transitModes=FERRY(&|$)/.test(u)));
  // Not in the open feeds: unknown, not "no ferry".
  const none = async (url) => (String(url).includes('/plan') ? Response.json({ itineraries: [] }) : new Response('{}', { status: 500 }));
  const r2 = await (await onRequestGet({ request: new Request(`https://app.aivatrading.uk/api/travel/transfers?from=51.12,1.33&to=50.96,1.86&day=${day}&ferry=1`), env: {} }, none)).json();
  assert.equal(r2.modes.ferry.available, null); assert.deepEqual(r2.modes.ferry.routes, []);
  assert.deepEqual(await ferryCrossings({ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, none), []);
}
console.log('FERRY SALES GATE CHECKS PASSED');
