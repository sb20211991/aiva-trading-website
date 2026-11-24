/* Aiva Transport planner checks: worldwide journeys from open GTFS/GTFS-RT feeds (Transitous / MOTIS).
   Upstream calls are mocked, so this runs offline as part of the deploy. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const pub = (f) => new URL('../public/' + f, import.meta.url);

{
  const { onRequestGet: plan } = await import('../functions/api/emergency/plan.js');
  const rq = (p) => ({ request: new Request('https://app.aivatrading.uk/api/emergency/plan' + p), env: {} });
  const itin = { duration: 4020, startTime: '2026-12-01T07:40:00Z', endTime: '2026-12-01T08:47:00Z', transfers: 1, legs: [
    { mode: 'WALK', duration: 180, distance: 210, startTime: '2026-12-01T07:40:00Z', endTime: '2026-12-01T07:43:00Z',
      from: { name: 'START', lat: 52.52, lon: 13.36, tz: 'Europe/Berlin', departure: '2026-12-01T07:40:00Z' },
      to: { name: 'S+U Berlin Hauptbahnhof', lat: 52.525, lon: 13.369, tz: 'Europe/Berlin', arrival: '2026-12-01T07:43:00Z' } },
    { mode: 'HIGHSPEED_RAIL', duration: 3600, distance: 300000, realTime: true, routeShortName: 'ICE 371', headsign: 'Paris Est', agencyName: 'DB Fernverkehr',
      startTime: '2026-12-01T07:45:00Z', endTime: '2026-12-01T08:45:00Z', intermediateStops: [{ name: 'Mannheim Hbf' }, { name: 'Karlsruhe Hbf' }],
      from: { name: 'S+U Berlin Hauptbahnhof', lat: 52.525, lon: 13.369, tz: 'Europe/Berlin', departure: '2026-12-01T07:45:00Z', track: '12' },
      to: { name: 'Paris Est', lat: 48.876, lon: 2.359, tz: 'Europe/Paris', arrival: '2026-12-01T08:45:00Z', track: '4' } },
    { mode: 'WALK', duration: 120, distance: 90, startTime: '2026-12-01T08:45:00Z', endTime: '2026-12-01T08:47:00Z',
      from: { name: 'END', tz: 'Europe/Paris', departure: '2026-12-01T08:45:00Z' }, to: { name: 'END', tz: 'Europe/Paris', arrival: '2026-12-01T08:47:00Z' } }] };
  let call = '';
  const motis = (body) => async (url) => { call = String(url); return new Response(JSON.stringify(body)); };
  let r = await plan(rq('?from=52.52,13.36&to=48.8566,2.3522&time=2026-12-01T07:40:00Z&cc=de'), motis({ itineraries: [itin] }));
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.provider, 'transitous'); assert.equal(d.live, true); assert.equal(d.itineraries.length, 1);
  const it = d.itineraries[0];
  assert.equal(it.transfers, 1); assert.deepEqual(it.modes, ['train']); assert.match(it.departs, /^2026-12-01T07:40:00/); assert.equal(it.minutes, 67);
  assert.equal(it.legs[0].from, 'Start'); assert.equal(it.legs[0].to, 'S+U Berlin Hauptbahnhof'); assert.equal(it.legs[0].kind, 'walk'); assert.equal(it.legs[0].distance, 210);
  const rail = it.legs[1];
  assert.equal(rail.kind, 'train'); assert.equal(rail.line, 'ICE 371'); assert.equal(rail.platform, '12'); assert.equal(rail.arrivalPlatform, '4');
  assert.equal(rail.stops, 2); assert.equal(rail.realtime, true); assert.equal(rail.operator, 'DB Fernverkehr');
  assert.equal(rail.departure, '08:45'); assert.equal(rail.arrival, '09:45'); // the clock at each stop, not UTC
  assert.equal(it.legs[2].to, 'Destination');
  assert.match(decodeURIComponent(call), /transitModes=[^&]*RAIL/); assert.match(decodeURIComponent(call), /arriveBy=false/);
  assert.match(decodeURIComponent(call), /time=2026-12-01T07:40:00Z/); // whole seconds, no milliseconds
  assert.match(d.source, /Transitous/); assert.match(d.note, /Fares are not published/);
  assert.ok(d.links.train.book.some((x) => x.kind === 'book' && x.url.startsWith('https://int.bahn.de/')));
  // Arrive-by and mode filters.
  await plan(rq('?from=52.52,13.36&to=48.8566,2.3522&arriveBy=1&modes=train,bus'), motis({ itineraries: [] }));
  assert.match(decodeURIComponent(call), /arriveBy=true/); assert.match(decodeURIComponent(call), /transitModes=[^&]*COACH/);
  // Walk-only: no transit modes at all, so MOTIS walks the whole way.
  d = await (await plan(rq('?from=52.52,13.36&to=52.53,13.37&modes=walk'), motis({ direct: [itin] }))).json();
  assert.match(decodeURIComponent(call), /transitModes=&directModes=WALK/);
  assert.equal(d.itineraries.length, 1);
  // No journey: an honest empty list with a note, never an invented route.
  r = await plan(rq('?from=52.52,13.36&to=48.8566,2.3522'), motis({ itineraries: [] }));
  d = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(d.itineraries, []); assert.match(d.note, /No journey was found/);
  assert.equal((await plan(rq('?from=x&to=48.8,2.3'))).status, 400);
  assert.equal((await plan(rq('?from=52.5,13.3'))).status, 400);
  // Upstream failure is a 503, not an empty success.
  r = await plan(rq('?from=52.52,13.36&to=48.8566,2.3522'), async () => { throw Object.assign(new Error('HTTP 502'), { status: 502 }); });
  assert.equal(r.status, 503); assert.match((await r.json()).error, /temporarily unavailable/);
  // The planner ships in the app shell with its own script.
  const html = readFileSync(pub('index.html'), 'utf8');
  assert.match(html, /id="asPlan"/); assert.match(html, /data-plan-mode="train"/); assert.match(html, /Aiva Train/); assert.match(html, /src="aiva-transport.js"/);
  assert.ok(existsSync(pub('aiva-transport.js'))); assert.match(readFileSync(pub('service-worker.js'), 'utf8'), /aiva-transport\.js/);
}
console.log('AIVA TRANSPORT PLANNER CHECKS PASSED');

// Airport transfers outside Norway and Switzerland plan on the same open feeds instead of reporting no data.
{
  const { onRequestGet: tf } = await import('../functions/api/travel/transfers.js');
  const reply = async (url) => {
    const u = String(url);
    if (u.includes('/plan?')) return new Response(JSON.stringify({ itineraries: [{
      duration: 2100, startTime: '2026-12-01T09:00:00Z', endTime: '2026-12-01T09:35:00Z', transfers: 0,
      legs: [{ mode: 'REGIONAL_RAIL', duration: 1980, realTime: true, routeShortName: 'B', agencyName: 'RATP', headsign: 'Châtelet', intermediateStops: [{ name: 'Gare du Nord' }],
        startTime: '2026-12-01T09:02:00Z', endTime: '2026-12-01T09:35:00Z',
        from: { name: 'Aéroport CDG 1', tz: 'Europe/Paris', departure: '2026-12-01T09:02:00Z' },
        to: { name: 'Châtelet', tz: 'Europe/Paris', arrival: '2026-12-01T09:35:00Z' } }] }] }));
    if (u.includes('routing.openstreetmap.de')) return new Response(JSON.stringify({ code: 'Ok', routes: [{ duration: 1800, distance: 24000 }] }));
    if (u.includes('overpass')) return new Response(JSON.stringify({ elements: [] }));
    throw new Error('unexpected ' + u);
  };
  const d = await (await tf({ request: new Request('https://x/api/travel/transfers?from=49.0038,2.5708&to=48.8566,2.3522&cc=fr'), env: {} }, reply)).json();
  assert.equal(d.schedules, true); assert.equal(d.modes.train.available, true);
  assert.equal(d.modes.train.routes[0].steps[0].line, 'B'); assert.equal(d.modes.train.routes[0].steps[0].departs, '10:02');
  assert.equal(d.modes.tram.available, false); assert.match(d.source, /Transitous/);
}
console.log('WORLDWIDE TRANSFER CHECKS PASSED');
