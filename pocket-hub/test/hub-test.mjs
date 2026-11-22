/* Pocket Hub offline checks: website API forwarding, static app shell and project isolation. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { onRequest as forward } from '../functions/api/[[path]].js';
import { onRequestPost as hubTranslate } from '../functions/api/hub-translate.js';
import { SOURCES } from '../functions/_lib/languages.js';

const realFetch = globalThis.fetch;
let seen;
globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return new Response('ok'); };
await forward({ request: new Request('https://app.aivatrading.uk/api/square-webhook?x=1', { method: 'POST', body: '{"a":1}',
  headers: { 'x-square-hmacsha256-signature': 'sig', 'content-type': 'application/json' } }), env: { WEBSITE_ORIGIN: 'https://aiva-trading.pages.dev' } });
assert.equal(seen.url, 'https://aiva-trading.pages.dev/api/square-webhook?x=1');
assert.equal(seen.init.method, 'POST');
assert.equal(new TextDecoder().decode(seen.init.body), '{"a":1}');
assert.equal(seen.init.headers.get('x-square-hmacsha256-signature'), 'sig');
assert.equal(seen.init.headers.get('x-forwarded-host'), 'app.aivatrading.uk');
await forward({ request: new Request('https://app.aivatrading.uk/api/shop-status'), env: {} });
assert.equal(seen.url, 'https://aiva-trading.pages.dev/api/shop-status');
assert.equal(seen.init.body, undefined);
globalThis.fetch = realFetch;

const pub = (f) => new URL('../public/' + f, import.meta.url);
for (const f of ['index.html', 'app.js', 'service-worker.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', '_routes.json', '_headers'])
  assert.ok(existsSync(pub(f)), 'Missing ' + f);
const html = readFileSync(pub('index.html'), 'utf8');
assert.match(html, /<meta name="application-name" content="Aiva"><meta name="apple-mobile-web-app-title" content="Aiva"><title>Aiva<\/title>/);
assert.equal(JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8')).name, 'Aiva');
for (const id of ['home', 'translate', 'trade', 'calculator', 'travel', 'finance', 'emergency', 'settings']) assert.match(html, new RegExp(`id="${id}"`));
assert.deepEqual(JSON.parse(readFileSync(pub('_routes.json'), 'utf8')).include, ['/api/*']);
assert.match(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), /^name = "aiva-pocket-hub"$/m);

// In-app translation endpoint: server-side engine call, validation, error handling.
const tReq = (body, origin = 'https://app.aivatrading.uk') => new Request('https://app.aivatrading.uk/api/hub-translate',
  { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Origin: origin, 'content-type': 'application/json' } });
let call;
const engine = (reply, ok = true) => async (url, init) => { call = { url, body: String(init.body) }; return new Response(JSON.stringify(reply), { status: ok ? 200 : 503 }); };
let r = await hubTranslate({ request: tReq({ text: ' Hello ', source: 'auto', target: 'ckb' }) }, engine([['سڵاو', 'en']]));
assert.equal(r.status, 200); assert.deepEqual(await r.json(), { translation: 'سڵاو', detected: 'en' });
assert.match(call.url, /^https:\/\/translate\.googleapis\.com\/translate_a\/t\?client=gtx&sl=auto&tl=ckb&format=text$/);
assert.equal(new URLSearchParams(call.body).get('q'), 'Hello');
r = await hubTranslate({ request: tReq({ text: 'كم السعر؟', source: 'ar', target: 'en' }) }, engine(['How much is the price?']));
assert.deepEqual(await r.json(), { translation: 'How much is the price?', detected: 'ar' });
assert.equal((await hubTranslate({ request: tReq({ text: 'x', source: 'en', target: 'xx' }) }, engine([]))).status, 400);
assert.equal((await hubTranslate({ request: tReq({ text: '   ', target: 'ar' }) }, engine([]))).status, 400);
assert.equal((await hubTranslate({ request: tReq({ text: 'a'.repeat(5001), target: 'ar' }) }, engine([]))).status, 413);
assert.equal((await hubTranslate({ request: tReq('not json') }, engine([]))).status, 400);
assert.equal((await hubTranslate({ request: tReq('x'.repeat(30000)) }, engine([]))).status, 413);
assert.equal((await hubTranslate({ request: tReq({ text: 'hi', target: 'ar' }, 'https://evil.example') }, engine([]))).status, 403);
assert.equal((await hubTranslate({ request: tReq({ text: 'hi', target: 'ar' }) }, engine({}, false))).status, 502);
assert.equal((await hubTranslate({ request: tReq({ text: 'hi', target: 'ar' }) }, async () => { throw new TypeError('down'); })).status, 502);

// The app translates in place (no external translator tab) and offers the same languages as the endpoint.
const app = readFileSync(pub('app.js'), 'utf8');
assert.doesNotMatch(app + html, /translate\.google\.com/);
assert.match(app, /fetch\('\/api\/hub-translate'/);
const appLangs = [...app.match(/const LANG=\[(.*?)\];/)[1].matchAll(/\['([^']+)'/g)].map((m) => m[1]);
assert.deepEqual(appLangs.sort(), [...SOURCES].sort());
for (const id of ['langFrom', 'langTo', 'swapLang', 'sourceText', 'openTranslate', 'speakInput', 'voiceStatus', 'translationOutput']) assert.match(html, new RegExp(`id="${id}"`));

// Emergency section: opening hours, places, live TfL transport, timetables. All upstream calls are mocked.
{
  const { openingStatus, parseOpeningHours } = await import('../functions/_lib/emergency.js');
  const { onRequestGet: places } = await import('../functions/api/emergency/places.js');
  const { onRequestGet: transport, lineState } = await import('../functions/api/emergency/transport.js');
  const { onRequestGet: timetable, scheduleDays } = await import('../functions/api/emergency/timetable.js');
  const { onRequestGet: geocode } = await import('../functions/api/emergency/geocode.js');
  const at = (day, h, m = 0) => ({ day, minutes: h * 60 + m });
  assert.equal(openingStatus('24/7', at(2, 3)).state, 'open');
  assert.deepEqual(openingStatus('Mo-Fr 09:00-18:00', at(0, 10)), { state: 'open', label: 'Open now · closes 18:00' });
  assert.deepEqual(openingStatus('Mo-Fr 09:00-18:00', at(6, 10)), { state: 'closed', label: 'Closed now · opens Mon 09:00' });
  assert.equal(openingStatus('Mo-Su 18:00-02:00', at(1, 1)).label, 'Open now · closes 02:00');
  assert.equal(openingStatus('Mo,Tu,Th 09:00-18:30, We 09:00-17:30, Fr 09:00-13:00, Fr 14:00-18:30', at(4, 13, 30)).label, 'Closed now · opens 14:00');
  assert.match(openingStatus('Mo-Fr 08:00-20:00; PH off', at(0, 9)).label, /public holidays/);
  assert.equal(openingStatus('Jan-Mar Mo 10:00-12:00', at(0, 11)).state, 'unknown');
  assert.equal(openingStatus('', at(0, 11)).state, 'unknown');
  assert.equal(openingStatus('Mo-Fr 09:00-18:00', null).state, 'unknown');
  assert.equal(parseOpeningHours('sunrise-sunset'), null);
  assert.equal(openingStatus('Mo-Su 18:00-02:00; Tu off', at(2, 1)).state, 'closed');
  assert.equal(openingStatus('Mo-Su 18:00-02:00; Tu off', at(1, 1)).state, 'open');

  const req = (path) => ({ request: new Request('https://app.aivatrading.uk/api/emergency/' + path), env: {} });
  const fake = (routes) => async (url) => {
    const u = String(url), hit = routes.find(([re]) => re.test(u));
    if (!hit) throw new Error('unexpected ' + u);
    return typeof hit[1] === 'number' ? new Response('busy', { status: hit[1] }) : new Response(JSON.stringify(hit[1]));
  };
  let r = await places(req('places?lat=53.4774&lon=-2.2309&category=pharmacy&radius=1500&cc=gb'), fake([[/overpass/, { elements: [
    { type: 'node', id: 1, lat: 53.4775, lon: -2.2309, tags: { amenity: 'pharmacy', name: 'Always Pharmacy', opening_hours: '24/7' } },
    { type: 'node', id: 2, lat: 53.48, lon: -2.23, tags: { amenity: 'pharmacy', name: 'No Hours Chemist' } },
    { type: 'node', id: 3, lat: 53.47, lon: -2.23, tags: { amenity: 'pharmacy' } }] }]]));
  let d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(d.places.map(p => [p.name, p.status.state]), [['Always Pharmacy', 'open'], ['No Hours Chemist', 'unknown']]);
  assert.equal(d.timeZone, 'Europe/London');
  assert.ok(!('price' in d.places[0]));
  // Overpass down -> Nominatim fallback; unknown country -> time zone unknown -> grey.
  r = await places(req('places?lat=10&lon=10&category=pharmacy&cc=zz'), fake([[/overpass/, 429], [/nominatim/, [
    { osm_type: 'node', osm_id: 9, lat: '10.001', lon: '10', name: 'Fallback Pharmacy', category: 'amenity', type: 'pharmacy', extratags: { opening_hours: 'Mo-Su 08:00-20:00' }, address: {} }]]]));
  d = await r.json();
  assert.equal(d.places[0].name, 'Fallback Pharmacy');
  assert.equal(d.places[0].status.state, 'unknown');
  assert.match(d.source, /Nominatim/);
  assert.equal((await places(req('places?lat=x&lon=1'))).status, 400);
  assert.equal((await places(req('places?lat=1&lon=1&category=nope'))).status, 400);

  const soon = new Date(Date.now() + 4 * 60000).toISOString();
  r = await transport(req('transport?lat=51.5033&lon=-0.1196'), fake([
    [/StopPoint\?lat/, { stopPoints: [
      { naptanId: 'B1', commonName: 'County Hall', indicator: 'Stop E', modes: ['bus'], distance: 100, lat: 51.5, lon: -0.12, lines: [{ id: '12', name: '12' }] },
      { naptanId: 'T1', commonName: 'Waterloo Underground Station', modes: ['tube'], distance: 300, lat: 51.5, lon: -0.11, lines: [{ id: 'waterloo-city', name: 'Waterloo & City' }] },
      { naptanId: 'T2', commonName: 'Lambeth North', modes: ['tube'], distance: 400, lat: 51.5, lon: -0.11, lines: [{ id: 'bakerloo', name: 'Bakerloo' }] }] }],
    [/StopPoint\/B1\/Arrivals/, [{ lineName: '12', lineId: '12', destinationName: 'Dulwich', platformName: 'E', expectedArrival: soon }]],
    [/StopPoint\/T1\/Arrivals/, []], [/StopPoint\/T2\/Arrivals/, []],
    [/Line\/.*\/Status/, [
      { id: '12', name: '12', lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service' }] },
      { id: 'waterloo-city', name: 'Waterloo & City', lineStatuses: [{ statusSeverity: 4, statusSeverityDescription: 'Planned Closure', reason: 'Weekdays only' }] },
      { id: 'bakerloo', name: 'Bakerloo', lineStatuses: [{ statusSeverity: 9, statusSeverityDescription: 'Minor Delays', reason: 'Train cancellations' }] }]]]));
  d = await r.json();
  assert.equal(d.provider, 'tfl');
  assert.deepEqual(d.stops.map(s => s.state), ['live', 'closed', 'none']);
  assert.deepEqual(d.upstreamErrors, []);
  assert.match(d.stops[0].label, /^Live · next 12 in [34] min$/);
  assert.equal(d.stops[1].lines[0].reason, 'Weekdays only');
  assert.equal(lineState(9), 'disrupted'); assert.equal(lineState(7), 'disrupted'); assert.equal(lineState(10), 'ok'); assert.equal(lineState(20), 'closed'); assert.equal(lineState(6), 'disrupted');
  // Outside London: OSM stops, never presented as live; official National Rail link from the CRS code.
  r = await transport(req('transport?lat=53.4774&lon=-2.2309'), fake([[/overpass/, { elements: [
    { type: 'node', id: 5, lat: 53.4774, lon: -2.2309, tags: { railway: 'station', name: 'Manchester Piccadilly', 'ref:crs': 'MAN' } }] }]]));
  d = await r.json();
  assert.equal(d.live, false);
  assert.equal(d.stops[0].state, 'unverified');
  assert.equal(d.stops[0].links[0].url, 'https://www.nationalrail.co.uk/live-trains/departures/MAN/');

  // Live providers outside London: Entur (Norway), opendata.ch (Switzerland), iRail (Belgium), National Rail (GB, keyed).
  const inMin = m => new Date(Date.now() + m * 60000).toISOString();
  r = await transport(req('transport?lat=59.9111&lon=10.7528&cc=no'), fake([[/entur/, { data: { nearest: { edges: [
    { node: { distance: 40, place: { id: 'NSR:StopPlace:1', name: 'Oslo S', latitude: 59.91, longitude: 10.75, transportMode: ['rail'], estimatedCalls: [
      { realtime: true, cancellation: false, aimedDepartureTime: inMin(3), expectedDepartureTime: inMin(8), quay: { publicCode: '5' }, destinationDisplay: { frontText: 'Drammen' },
        situations: [{ summary: [{ value: 'Sporarbeid', language: 'no' }, { value: 'Track works', language: 'en' }] }], serviceJourney: { line: { id: 'L1', publicCode: 'R13' } } }] } } },
    { node: { distance: 90, place: { id: 'NSR:StopPlace:2', name: 'Cancelled Stop', transportMode: ['bus'], estimatedCalls: [
      { realtime: true, cancellation: true, aimedDepartureTime: inMin(4), expectedDepartureTime: inMin(4), destinationDisplay: { frontText: 'X' }, serviceJourney: { line: { publicCode: '60' } } }] } } },
    { node: { distance: 120, place: { id: 'NSR:StopPlace:3', name: 'Rural', transportMode: ['bus'], estimatedCalls: [
      { realtime: false, cancellation: false, aimedDepartureTime: inMin(30), destinationDisplay: { frontText: 'Y' }, serviceJourney: { line: { publicCode: '7' } } }] } } }] } } }]]));
  d = await r.json();
  assert.equal(d.provider, 'entur'); assert.equal(d.live, true);
  assert.deepEqual(d.stops.map(s => s.state), ['live', 'closed', 'unverified']);
  assert.match(d.stops[0].departures[0].status, /^5 min late$/);
  assert.deepEqual(d.stops[0].alerts, ['Track works']);
  assert.match(d.stops[2].label, /^Timetabled times only/);
  r = await transport(req('transport?lat=47.378&lon=8.540&cc=ch'), fake([
    [/locations/, { stations: [{ id: '8503000', name: 'Zürich HB', icon: 'train', distance: 25, coordinate: { x: 47.378, y: 8.54 } }, { id: '9', name: 'Far', distance: 5000 }] }],
    [/stationboard/, { stationboard: [{ category: 'S', number: '7', to: 'Winterthur', stop: { departure: inMin(2), delay: 2, platform: '41', prognosis: { departure: inMin(4) } } }] }]]));
  d = await r.json();
  assert.equal(d.provider, 'swiss'); assert.equal(d.stops.length, 1);
  assert.equal(d.stops[0].state, 'live'); assert.equal(d.stops[0].departures[0].line, 'S 7'); assert.equal(d.stops[0].departures[0].status, '2 min late');
  r = await transport(req('transport?lat=50.8456&lon=4.357&cc=be'), fake([
    [/overpass/, { elements: [{ type: 'node', id: 7, lat: 50.8456, lon: 4.357, tags: { railway: 'station', name: 'Bruxelles-Central', uic_ref: '8813003' } }] }],
    [/irail.*id=BE\.NMBS\.008813003/, { departures: { departure: [
      { station: 'Ostend', time: String(Math.floor(Date.now() / 1000) + 300), delay: '0', canceled: '1', vehicleinfo: { shortname: 'IC 1' }, platform: '3' },
      { station: 'Liège', time: String(Math.floor(Date.now() / 1000) + 600), delay: '600', canceled: '0', vehicleinfo: { shortname: 'IC 2' }, platform: '1' },
      { station: 'Ghent', time: String(Math.floor(Date.now() / 1000) + 900), delay: '0', canceled: '0', vehicleinfo: { shortname: 'IC 3' }, platform: '2' }] } }]]));
  d = await r.json();
  assert.equal(d.stops[0].state, 'live'); assert.match(d.stops[0].label, /1 cancelled$/); assert.match(d.source, /iRail/);
  assert.deepEqual(d.stops[0].departures.map(x => [x.line, x.status]), [['IC 1', 'Cancelled'], ['IC 3', ''], ['IC 2', '10 min late']]);
  assert.match(d.stops[0].label, /^Live · next IC 3 in 1[45] min/);
  const manc = fake([[/overpass/, { elements: [{ type: 'node', id: 5, lat: 53.4774, lon: -2.2309, tags: { railway: 'station', name: 'Manchester Piccadilly', 'ref:crs': 'MAN' } }] }],
    [/raildata.*GetDepBoardWithDetails\/MAN/, { generatedAt: new Date().toISOString(), nrccMessages: [{ Value: '<p>Engineering works</p>' }], trainServices: [
      { std: new Date(Date.now() + 10 * 60000).toISOString().slice(11, 16), etd: 'Cancelled', isCancelled: true, cancelReason: 'a fault', operator: 'Northern', destination: [{ locationName: 'Leeds' }] },
      { std: new Date(Date.now() + 20 * 60000).toISOString().slice(11, 16), etd: 'On time', platform: '4', operator: 'Avanti', destination: [{ locationName: 'London Euston' }] }] }]]);
  r = await transport({ request: new Request('https://app.aivatrading.uk/api/emergency/transport?lat=53.4774&lon=-2.2309&cc=gb'), env: { RAIL_DATA_LDB_KEY: 'k' } }, manc);
  d = await r.json();
  assert.equal(d.stops[0].state, 'live'); assert.deepEqual(d.stops[0].alerts, ['Engineering works']);
  assert.deepEqual(d.stops[0].departures.map(x => x.status), ['Cancelled · a fault', 'On time']);
  assert.equal(d.stops[0].departures[1].platform, 'Platform 4');
  r = await transport({ request: new Request('https://app.aivatrading.uk/api/emergency/transport?lat=53.4774&lon=-2.2309&cc=gb'), env: { RAIL_DATA_LDB_KEY: 'k' } },
    fake([[/overpass/, { elements: [{ type: 'node', id: 5, lat: 53.4774, lon: -2.2309, tags: { railway: 'station', name: 'Manchester Piccadilly', 'ref:crs': 'MAN' } }] }],
      [/raildata/, { generatedAt: new Date().toISOString(), trainServices: [{ std: new Date(Date.now() - 5 * 60000).toISOString().slice(11, 16), etd: 'Delayed', operator: 'Northern', destination: [{ locationName: 'Leeds' }] },
        { std: new Date(Date.now() + 5 * 60000).toISOString().slice(11, 16), etd: '', operator: 'Northern', destination: [{ locationName: 'York' }] }] }]]));
  d = await r.json();
  assert.equal(d.stops[0].state, 'unverified'); assert.equal(d.live, false); assert.equal(d.stops[0].departures[0].unknownTime, true);
  assert.deepEqual(d.stops[0].departures.map(x => [x.status, x.realtime]), [['Delayed', true], ['No estimate reported', false]]);
  r = await transport(req('transport?lat=53.4774&lon=-2.2309&cc=gb'), manc);
  assert.equal((await r.json()).stops[0].state, 'unverified');
  r = await transport(req('transport?lat=59.9111&lon=10.7528&cc=no'), fake([[/entur/, { errors: [{ message: 'x' }] }],
    [/overpass/, { elements: [{ type: 'node', id: 8, lat: 59.91, lon: 10.75, tags: { railway: 'station', name: 'Oslo S' } }] }]]));
  d = await r.json();
  assert.equal(d.provider, 'osm'); assert.deepEqual(d.upstreamErrors, ['entur-error']); assert.equal(d.stops[0].state, 'unverified');

  assert.deepEqual([...scheduleDays('Monday - Thursday')], [0, 1, 2, 3]);
  assert.deepEqual([...scheduleDays('Saturday (also Good Friday)')], [5]);
  const sched = (name, hours) => ({ name, firstJourney: { hour: String(hours[0]), minute: '5' }, lastJourney: { hour: String(hours.at(-1)), minute: '10' }, knownJourneys: hours.map(h => ({ hour: String(h), minute: '0' })) });
  const all = Array.from({ length: 24 }, (_, i) => i);
  const week = ['Monday - Friday', 'Saturday', 'Sunday'];
  r = await timetable(req('timetable?line=12&stop=490005646E'), fake([[/Timetable/, { direction: 'outbound', timetable: { routes: [{ schedules: week.map(n => sched(n, all)) }] } }]]));
  d = await r.json();
  assert.equal(d.directions[0].runs24h, true);
  r = await timetable(req('timetable?line=jubilee&stop=940GZZLUWLO'), fake([
    [/direction=inbound/, { direction: 'inbound', timetable: { routes: [{ schedules: week.map(n => sched(n, [5, 6, 7, 24])) }] } }],
    [/direction=outbound/, { direction: 'outbound', timetable: { routes: [{ schedules: week.map(n => sched(n, [6, 23])) }] } }],
    [/Timetable\/940GZZLUWLO\?/, { disambiguation: { disambiguationOptions: [
      { description: 'Stratford Underground Station - Stanmore Underground Station', uri: '/Line/jubilee/Timetable/940GZZLUWLO?direction=inbound' },
      { description: 'Stratford Underground Station - Willesden Green Underground Station', uri: '/Line/jubilee/Timetable/940GZZLUWLO?direction=inbound&x=1' },
      { description: 'Stanmore Underground Station - Stratford Underground Station', uri: '/Line/jubilee/Timetable/940GZZLUWLO?direction=outbound' }] } }]]));
  d = await r.json();
  assert.deepEqual(d.directions.map(x => [x.towards, x.first, x.last, x.runs24h]),
    [['Stratford → Stanmore', '05:05', '00:10 (after midnight)', false], ['Stanmore → Stratford', '06:05', '23:10', false]]);
  assert.equal((await timetable(req('timetable?line=../x&stop=1'))).status, 400);

  r = await geocode(req('geocode?q=Waterloo'), fake([[/nominatim.*search/, [{ lat: '51.5', lon: '-0.11', display_name: 'Waterloo, London, England, UK, Earth', address: { country_code: 'GB' } }]]]));
  assert.deepEqual(await r.json(), { lat: 51.5, lon: -0.11, label: 'Waterloo, London, England, UK', countryCode: 'gb', source: 'OpenStreetMap Nominatim' });
  assert.equal((await geocode(req('geocode'))).status, 400);
  for (const id of ['emLocate', 'emQuery', 'emSearch', 'emRadius', 'emNumbers', 'emTransport', 'emPlaces']) assert.match(html, new RegExp(`id="${id}"`));
}
console.log('POCKET HUB CHECKS PASSED');

// Aiva Search: travel endpoints stay in-app and use provider data only.
{
  const { onRequestGet: flights } = await import('../functions/api/travel/flights.js');
  const { onRequestGet: hotels } = await import('../functions/api/travel/hotels.js');
  const { onRequestGet: transfers } = await import('../functions/api/travel/transfers.js');
  const { onRequestGet: tmap } = await import('../functions/api/travel/map.js');
  const rq = (p) => new Request('https://app.aivatrading.uk/api/travel/' + p);
  const fk = (routes) => async (url) => { const hit = routes.find(([re]) => re.test(String(url))); return hit ? new Response(JSON.stringify(hit[1])) : new Response('{}', { status: 404 }); };
  let r = await flights({ request: rq('flights?from=LHR&to=CAN&depart=2027-04-15'), env: {} });
  assert.equal((await r.json()).configured, false);
  assert.equal((await flights({ request: rq('flights?from=LH&to=CAN&depart=2027-04-15'), env: {} })).status, 400);
  r = await flights({ request: rq('flights?from=LHR&to=CAN&depart=2027-04-15&return=2027-04-19&adults=1'), env: { DUFFEL_ACCESS_TOKEN: 't' } }, fk([[/duffel/, { data: { live_mode: true, offers: [
    { id: 'o2', total_amount: '712.00', total_currency: 'GBP', owner: { name: 'Cathay Pacific', iata_code: 'CX' }, slices: [{ duration: 'PT12H30M', segments: [{ origin: { iata_code: 'LHR' }, destination: { iata_code: 'HKG' }, departing_at: '2027-04-15T21:35:00', arriving_at: '2027-04-16T17:05:00' }, { origin: { iata_code: 'HKG' }, destination: { iata_code: 'CAN' } }] }] },
    { id: 'o1', total_amount: '689.00', total_currency: 'GBP', owner: { name: 'China Southern', iata_code: 'CZ' }, slices: [{ duration: 'PT12H35M', segments: [{ origin: { iata_code: 'LHR' }, destination: { iata_code: 'CAN' }, departing_at: '2027-04-15T11:00:00', arriving_at: '2027-04-16T06:35:00', marketing_carrier: { iata_code: 'CZ' }, marketing_carrier_flight_number: '304' }] }] }] } }]]));
  let d = await r.json();
  assert.deepEqual(d.offers.map((o) => [o.airline, o.price, o.slices[0].stops, o.slices[0].minutes]), [['China Southern', 689, 0, 755], ['Cathay Pacific', 712, 1, 750]]);
  assert.deepEqual(d.offers[0].slices[0].flights, ['CZ304']);
  r = await hotels({ request: rq('hotels?lat=23.13&lon=113.26&checkin=2027-04-15&checkout=2027-04-19'), env: { LITEAPI_KEY: 'k' } }, fk([
    [/data\/hotels/, { data: [{ id: 'h1', name: 'Langham Place Guangzhou', stars: 5, latitude: 23.1, longitude: 113.3, main_photo: 'https://img/1.jpg' }, { id: 'h2', name: 'Full', latitude: 23.13, longitude: 113.26 }] }],
    [/hotels\/rates/, { data: [{ hotelId: 'h1', roomTypes: [{ offerRetailRate: { amount: 432, currency: 'GBP' }, rates: [{ name: 'Deluxe King' }] }] }] }]]));
  d = await r.json();
  assert.equal(d.priced, true); assert.equal(d.hotels[0].name, 'Langham Place Guangzhou'); assert.equal(d.hotels[0].price.total, 432); assert.equal(d.hotels[1].available, false);
  r = await hotels({ request: rq('hotels?lat=23.13&lon=113.26'), env: {} }, fk([[/overpass/, { elements: [{ type: 'node', id: 1, lat: 23.13, lon: 113.27, tags: { tourism: 'hotel', name: 'White Swan', stars: '5', wikimedia_commons: 'File:Swan.jpg' } }] }]]));
  d = await r.json();
  assert.equal(d.priced, false); assert.equal(d.hotels[0].price, null); assert.match(d.hotels[0].image, /Special:FilePath\/Swan\.jpg/);
  r = await transfers({ request: rq('transfers?from=23.39,113.30&to=23.13,113.27'), env: {} }, fk([[/routed-car/, { routes: [{ duration: 2700, distance: 38000 }] }], [/routed-foot/, { routes: [{ duration: 30000, distance: 37000 }] }],
    [/overpass/, { elements: [{ type: 'node', id: 2, lat: 23.392, lon: 113.30, tags: { railway: 'station', name: 'Airport South' } }, { type: 'node', id: 3, lat: 23.39, lon: 113.301, tags: { amenity: 'car_rental', name: 'Hertz' } }] }]]));
  d = await r.json();
  assert.equal(d.modes.taxi.minutes, 45); assert.equal(d.modes.walk.available, false); assert.equal(d.modes.car.places[0].name, 'Hertz'); assert.equal(d.modes.train.places[0].name, 'Airport South');
  r = await transfers({ request: rq('transfers?from=23.39,113.30&to=23.13,113.27'), env: { GOOGLE_MAPS_API_KEY: 'g' } }, async (url, init) => {
    if (/routes\.googleapis/.test(url)) { const mode = JSON.parse(init.body).travelMode; return new Response(JSON.stringify({ routes: [{ duration: mode === 'TRANSIT' ? '3000s' : '2400s', distanceMeters: 38000,
      legs: [{ steps: mode === 'TRANSIT' ? [{ travelMode: 'TRANSIT', transitDetails: { transitLine: { nameShort: '3', vehicle: { type: 'SUBWAY' } }, stopDetails: { departureStop: { name: 'Airport South' }, arrivalStop: { name: 'Tiyu Xilu' }, departureTime: '2027-04-16T07:30:00Z' }, stopCount: 14 } }] : [] }] }] })); }
    return new Response(JSON.stringify({ elements: [] })); });
  d = await r.json();
  assert.equal(d.schedules, true); assert.equal(d.modes.train.routes[0].steps[0].line, '3'); assert.equal(d.modes.train.routes[0].minutes, 50); assert.equal(d.modes.taxi.minutes, 40);
  assert.match((await tmap({ request: rq('map?lat=23.13&lon=113.26'), env: {} })).headers.get('Location'), /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html/);
  assert.match((await tmap({ request: rq('map?from=1,2&to=3,4'), env: { GOOGLE_MAPS_EMBED_KEY: 'e' } })).headers.get('Location'), /^https:\/\/www\.google\.com\/maps\/embed\/v1\/directions\?key=e&origin=1,2&destination=3,4/);
  const travel = html.slice(html.indexOf('<section id="travel"'), html.indexOf('</section>', html.indexOf('<section id="travel"')));
  assert.doesNotMatch(travel, /<a [^>]*href="https?:/); assert.match(travel, /Aiva Search/);
  for (const id of ['asForm', 'asFrom', 'asTo', 'asDepart', 'asReturn', 'asPax', 'asTabs', 'asFlights', 'asHotels', 'asTransport', 'asTransfers', 'asMap', 'asTrip', 'asAttrib']) assert.match(html, new RegExp(`id="${id}"`));
  for (const t of ['flights', 'hotels', 'transport', 'maps', 'transfers']) assert.match(html, new RegExp(`data-as-tab="${t}"`));
}
console.log('AIVA SEARCH CHECKS PASSED');
