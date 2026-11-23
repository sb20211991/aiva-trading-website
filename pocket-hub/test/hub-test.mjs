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
  assert.equal(d.schedules, true); assert.equal(d.modes.metro.routes[0].steps[0].line, '3'); assert.equal(d.modes.metro.routes[0].minutes, 50); assert.equal(d.modes.train.available, false); assert.equal(d.modes.taxi.minutes, 40);
  r = await transfers({ request: rq('transfers?from=60.1976,11.1004&to=59.9127,10.7461'), env: {} }, fk([[/entur/, { data: { trip: { tripPatterns: [{ duration: 3592, distance: 46343, legs: [
    { mode: 'foot', line: null, fromPlace: { name: 'Origin' }, toPlace: { name: 'Oslo lufthavn stasjon' } },
    { mode: 'rail', expectedStartTime: '2026-11-22T23:30:00+01:00', expectedEndTime: '2026-11-22T23:52:00+01:00', fromPlace: { name: 'Oslo lufthavn stasjon' }, toPlace: { name: 'Oslo S' }, line: { publicCode: 'FLY1', authority: { name: 'Flytoget' } }, fromEstimatedCall: { destinationDisplay: { frontText: 'Drammen' } }, intermediateQuays: [{ id: 'q' }] }] }] } } }],
    [/routed-car/, { routes: [{ duration: 2700, distance: 48000 }] }], [/routed-foot/, { routes: [{ duration: 36000, distance: 46000 }] }], [/overpass/, { elements: [] }]]));
  d = await r.json();
  assert.equal(d.schedules, true); assert.equal(d.modes.train.routes[0].steps[0].line, 'FLY1'); assert.equal(d.modes.train.routes[0].steps[0].departs, '23:30'); assert.equal(d.modes.train.routes[0].steps[0].stops, 2); assert.match(d.source, /Entur/);
  r = await transfers({ request: rq('transfers?from=47.4581,8.5555&to=47.3769,8.5417'), env: {} }, fk([[/opendata\.ch\/v1\/connections/, { connections: [{ duration: '00d00:36:00', sections: [{ walk: { duration: 1080 }, journey: null, departure: { station: { name: 'x' } }, arrival: { station: { name: 'y' } } },
    { journey: { category: 'B', number: '510', operator: 'PAG', to: 'Kaiserstuhl', passList: [1, 2, 3] }, departure: { station: { name: 'Zürich Flughafen, Bahnhof' }, departure: '2026-11-22T23:18:00+0100', prognosis: {} }, arrival: { station: { name: 'Kloten Balsberg' }, arrival: '2026-11-22T23:20:00+0100', prognosis: {} } }] }] }],
    [/routed-car/, { routes: [{ duration: 1200, distance: 12000 }] }], [/routed-foot/, { routes: [{ duration: 9000, distance: 11000 }] }], [/overpass/, { elements: [] }]]));
  d = await r.json();
  assert.equal(d.modes.bus.routes[0].minutes, 36); assert.equal(d.modes.bus.routes[0].steps[0].kind, 'walk'); assert.equal(d.modes.bus.routes[0].steps[0].line, 'Walk 18 min'); assert.equal(d.modes.bus.routes[0].steps[1].line, 'B 510'); assert.equal(d.modes.bus.routes[0].steps[1].departs, '23:18'); assert.equal(d.modes.train.available, false);
  assert.match((await tmap({ request: rq('map?lat=23.13&lon=113.26'), env: {} })).headers.get('Location'), /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html/);
  assert.match((await tmap({ request: rq('map?from=1,2&to=3,4'), env: { GOOGLE_MAPS_EMBED_KEY: 'e' } })).headers.get('Location'), /^https:\/\/www\.google\.com\/maps\/embed\/v1\/directions\?key=e&origin=1,2&destination=3,4/);
  { // Nuitee flights: one way, multi-city legs, cabin and children/infants
    let sent;
    const seg = (o, d, dep, arr, n) => ({ originCode: o, destinationCode: d, departureTime: dep, arrivalTime: arr, direction: 'OUTBOUND', carrier: { marketingCode: 'ND', marketingName: 'Nuitee Air' }, flight: { marketingNumber: n }, duration: { minutes: 90 } });
    const nf = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ data: [{ journeys: [{ segments: [seg('LHR', 'CDG', '2027-04-10T08:00:00', '2027-04-10T10:00:00', '1'), seg('CDG', 'FCO', '2027-04-14T09:00:00', '2027-04-14T11:00:00', '2'), seg('FCO', 'MAD', '2027-04-14T12:30:00', '2027-04-14T15:00:00', '3')],
      cheapestOffer: { offerId: 'o1', pricing: { display: { total: 300, currency: 'GBP', perPassenger: { adult: { total: 120 }, child: { total: 60 } } } }, fare: { family: 'Light', seatsRemaining: 3 }, segmentFares: [{ cabin: 'Business' }], baggage: { hasCheckedBag: true, included: [{ pieces: 1, description: 'Checked bag 23kg' }] }, terms: { refundable: true } } }] }] })); };
    let d = await (await flights({ request: rq('flights?legs=LHR:CDG:2027-04-10,CDG:MAD:2027-04-14&adults=2&children=1&infants=3&cabin=business'), env: { LITEAPI_KEY: 'sand_x' } }, nf)).json();
    assert.equal(d.query.trip, 'multi'); assert.equal(sent.legs.length, 2); assert.equal(sent.legs[0].direction, undefined); assert.equal(sent.cabinClass, 'BUSINESS'); assert.equal(sent.children, 1); assert.equal(sent.infants, 2);
    assert.equal(d.offers[0].slices.length, 2); assert.equal(d.offers[0].slices[1].from, 'CDG'); assert.equal(d.offers[0].slices[1].to, 'MAD'); assert.equal(d.offers[0].slices[1].stops, 1);
    assert.equal(d.offers[0].seatsLeft, 3); assert.equal(d.offers[0].bags.checked, true); assert.equal(d.offers[0].perPassenger.child, 60);
    d = await (await flights({ request: rq('flights?from=LHR&to=CDG&depart=2027-04-10'), env: { LITEAPI_KEY: 'sand_x' } }, nf)).json();
    assert.equal(d.query.trip, 'oneway'); assert.equal(sent.legs.length, 1); assert.equal(sent.cabinClass, 'ECONOMY');
    assert.equal((await flights({ request: rq('flights?legs=LHR:CDG:2027-04-10'), env: { LITEAPI_KEY: 'k' } })).status, 400);
    assert.equal((await flights({ request: rq('flights?legs=LHR:CDG:2027-04-10,CDG:MAD:2027-04-01'), env: { LITEAPI_KEY: 'k' } })).status, 400);
    const { journeySlices, shapeJourney } = await import('../functions/_lib/travel.js');
    const s2 = (o, d, dep, arr, m) => ({ originCode: o, destinationCode: d, departureTime: dep, arrivalTime: arr, direction: 'OUTBOUND', duration: { minutes: m } });
    // overnight connection in AMS on the next leg's date must not split leg 1; leg 2 starts at the requested CDG
    const legs = [{ from: 'JFK', to: 'CDG', date: '2027-04-10' }, { from: 'CDG', to: 'FCO', date: '2027-04-11' }];
    const segs = [s2('JFK', 'AMS', '2027-04-10T18:00:00', '2027-04-11T07:00:00', 420), s2('AMS', 'CDG', '2027-04-11T14:00:00', '2027-04-11T15:20:00', 80), s2('CDG', 'FCO', '2027-04-11T22:00:00', '2027-04-12T00:05:00', 125)];
    assert.deepEqual(journeySlices(segs, legs).map((g) => g.length), [2, 1]);
    // open jaw connecting through the next leg's origin: LHR→CDG→FCO, then CDG→MAD
    const oj = [s2('LHR', 'CDG', '2027-04-10T08:00:00', '2027-04-10T10:00:00', 70), s2('CDG', 'FCO', '2027-04-10T11:00:00', '2027-04-10T13:00:00', 120), s2('CDG', 'MAD', '2027-04-14T09:00:00', '2027-04-14T11:00:00', 120)];
    assert.deepEqual(journeySlices(oj, [{ from: 'LHR', to: 'FCO', date: '2027-04-10' }, { from: 'CDG', to: 'MAD', date: '2027-04-14' }]).map((g) => g.length), [2, 1]);
    // city code destination with a same-day 4 h stop: LHR→PAR, CDG→FCO
    const cc = [s2('LHR', 'CDG', '2027-04-10T08:00:00', '2027-04-10T10:00:00', 70), s2('CDG', 'FCO', '2027-04-10T14:00:00', '2027-04-10T16:00:00', 120)];
    assert.deepEqual(journeySlices(cc, [{ from: 'LHR', to: 'PAR', date: '2027-04-10' }, { from: 'CDG', to: 'FCO', date: '2027-04-10' }]).map((g) => g.length), [1, 1]);
    // city destination with a connection at the next leg's origin: LHR→CDG→FCO (ROM), then CDG→MAD the same day
    const rj = [s2('LHR', 'CDG', '2027-04-10T06:00:00', '2027-04-10T08:00:00', 70), s2('CDG', 'FCO', '2027-04-10T10:00:00', '2027-04-10T12:00:00', 120), s2('CDG', 'MAD', '2027-04-10T18:00:00', '2027-04-10T20:00:00', 120)];
    assert.deepEqual(journeySlices(rj, [{ from: 'LHR', to: 'ROM', date: '2027-04-10' }, { from: 'CDG', to: 'MAD', date: '2027-04-10' }]).map((g) => g.length), [2, 1]);
    const sj = shapeJourney({ segments: segs, legDurations: [{ direction: 'OUTBOUND', duration: { minutes: 999 } }], cheapestOffer: { pricing: { display: { total: 1 } } } }, legs);
    assert.equal(sj.slices[0].minutes, 420 + 420 + 80); assert.equal(sj.slices[1].minutes, 125);
    const { onRequestGet: hotelsFn } = await import('../functions/api/travel/hotels.js');
    let occ;
    await hotelsFn({ request: rq('hotels?lat=48.85&lon=2.35&checkin=2027-04-10&checkout=2027-04-12&adults=2&children=8,1'), env: { LITEAPI_KEY: 'sand_x' } }, async (url, init) => {
      if (/data\/hotels/.test(url)) return new Response(JSON.stringify({ data: [{ id: 'h1', name: 'H', latitude: 48.85, longitude: 2.35 }] }));
      occ = JSON.parse(init.body).occupancies; return new Response(JSON.stringify({ data: [] })); });
    assert.deepEqual(occ, [{ adults: 2, children: [8, 1] }]);
    const { lateSummary } = await import('../functions/_lib/transit.js');
    const late = lateSummary([{ steps: [{ kind: 'train', departs: '23:40' }] }, { steps: [{ kind: 'train', departs: '00:50' }] }, { steps: [{ kind: 'bus', departs: '02:10' }] }, { steps: [{ kind: 'metro', departs: '04:55' }] }]);
    assert.deepEqual(late.train, { last: '00:50', night: false }); assert.equal(late.bus.night, true); assert.equal(late.metro, undefined);
    const { rideHailing } = await import('../functions/_lib/rides.js');
    assert.ok(rideHailing('GB').includes('Uber')); assert.deepEqual(rideHailing('zz'), []);
  }
  const { localToUTC, localClock } = await import('../functions/_lib/travel.js');
  assert.equal(localToUTC('2027-04-16T06:10:00', 'Asia/Shanghai'), '2027-04-15T22:10:00.000Z');
  assert.equal(localToUTC('2027-07-16T06:10:00', 'Europe/London'), '2027-07-16T05:10:00.000Z');
  assert.equal(localToUTC('2027-04-16T06:10:00', '', 113.3), '2027-04-15T22:10:00.000Z');
  assert.equal(localClock('2027-04-15T23:30:00Z', { timeZone: 'Asia/Shanghai' }), '07:30');
  const { onRequestGet: place } = await import('../functions/api/travel/place.js');
  assert.equal((await (await place({ request: rq('place?q=MIL') }, async () => new Response('[]'))).json()).city, 'Milan');
  const travel = html.slice(html.indexOf('<section id="travel"'), html.indexOf('</section>', html.indexOf('<section id="travel"')));
  assert.doesNotMatch(travel, /<a [^>]*href="https?:/); assert.match(travel, /Aiva Search/);
  for (const id of ['asForm', 'asFrom', 'asTo', 'asDepart', 'asReturn', 'asPax', 'asTabs', 'asFlights', 'asHotels', 'asTransport', 'asTransfers', 'asMap', 'asTrip', 'asAttrib']) assert.match(html, new RegExp(`id="${id}"`));
  for (const t of ['flights', 'hotels', 'taxi', 'train', 'metro', 'tram', 'bus', 'car', 'walk', 'ride', 'transport', 'maps']) assert.match(html, new RegExp(`data-as-tab="${t}"`));
  for (const t of ['oneway', 'return', 'multi']) assert.match(html, new RegExp(`data-as-trip="${t}"`));
  for (const id of ['asCabin', 'asChildren', 'asInfants', 'asFlex', 'asLegs', 'asFlexDays', 'asModes']) assert.match(html, new RegExp(`id="${id}"`));
}
// In-app hotel booking (Nuitee prebook + payment SDK + book): sandbox only unless HOTEL_BOOKING_LIVE.
{
  const { onRequestPost: hb } = await import('../functions/api/travel/hotel-book.js');
  const req = (b, origin = 'https://app.aivatrading.uk') => new Request('https://app.aivatrading.uk/api/travel/hotel-book', { method: 'POST', body: JSON.stringify(b), headers: { Origin: origin, 'content-type': 'application/json' } });
  let sent;
  const up = (reply, status = 200) => async (url, init) => { sent = { url: String(url), body: JSON.parse(init.body), key: init.headers['X-API-Key'] }; return new Response(JSON.stringify(reply), { status }); };
  const sb = { LITEAPI_KEY: 'sand_x' };
  let r = await hb({ request: req({ action: 'prebook', offerId: 'off_123' }), env: sb }, up({ data: { prebookId: 'PB12345', transactionId: 'tr_12345', secretKey: 'pi_s', price: 329.6, currency: 'GBP', checkin: '2026-12-06', checkout: '2026-12-10', priceDifferencePercent: 0,
    roomTypes: [{ rates: [{ name: 'Double', boardName: 'Breakfast included', cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [{ cancelTime: '2026-12-04 12:00:00' }] }, retailRate: { taxesAndFees: [{ included: false, amount: 12 }] } }] }] } }));
  let d = await r.json();
  assert.equal(r.status, 200); assert.equal(sent.url, 'https://book.liteapi.travel/v3.0/rates/prebook'); assert.deepEqual(sent.body, { offerId: 'off_123', usePaymentSdk: true });
  assert.deepEqual([d.prebookId, d.transactionId, d.secretKey, d.paymentEnv, d.testMode, d.board, d.refundable, d.taxesDue], ['PB12345', 'tr_12345', 'pi_s', 'sandbox', true, 'Breakfast included', true, 12]);
  r = await hb({ request: req({ action: 'book', prebookId: 'PB12345', transactionId: 'tr_12345', holder: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' } }), env: sb },
    up({ data: { bookingId: 'BK9', status: 'CONFIRMED', hotelConfirmationCode: 'HC1', hotel: { name: 'Hotel Paris' }, price: 329.6, currency: 'GBP', checkin: '2026-12-06', checkout: '2026-12-10' } }));
  d = await r.json();
  assert.equal(sent.url, 'https://book.liteapi.travel/v3.0/rates/book'); assert.deepEqual(sent.body.payment, { method: 'TRANSACTION_ID', transactionId: 'tr_12345' }); assert.equal(sent.body.clientReference, 'aiva-PB12345');
  assert.deepEqual([d.bookingId, d.status, d.confirmation, d.hotel], ['BK9', 'CONFIRMED', 'HC1', 'Hotel Paris']);
  assert.equal((await hb({ request: req({ action: 'book', prebookId: 'PB12345', transactionId: 'tr_12345', holder: { firstName: 'A', lastName: 'B', email: 'bad' } }), env: sb }, up({}))).status, 400);
  assert.equal((await hb({ request: req({ action: 'prebook', offerId: 'off_1' }), env: { LITEAPI_KEY: 'prod_x' } }, up({}))).status, 403);
  assert.equal((await hb({ request: req({ action: 'prebook', offerId: 'off_1' }, 'https://evil.example'), env: sb }, up({}))).status, 403);
  assert.equal((await hb({ request: req({ action: 'prebook', offerId: 'off_1' }), env: {} }, up({}))).status, 503);
  r = await hb({ request: req({ action: 'prebook', offerId: 'off_1' }), env: sb }, up({ error: { description: 'Rate no longer available' } }, 400));
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'Rate no longer available');
  assert.equal((await hb({ request: req({ action: 'prebook', offerId: 'off_1' }), env: { LITEAPI_KEY: 'prod_x', HOTEL_BOOKING_LIVE: 'true' } }, up({ data: { prebookId: 'P1234', transactionId: 't1234', secretKey: 's' } }))).status, 200);
  // A confirmed booking whose reply was lost is recovered by clientReference instead of failing the retry.
  r = await hb({ request: req({ action: 'book', prebookId: 'PB12345', transactionId: 'tr_12345', holder: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' } }), env: sb },
    async (url) => String(url).includes('/bookings?clientReference=aiva-PB12345') ? new Response(JSON.stringify({ data: [{ bookingId: 'BK9', status: 'CONFIRMED', hotel: { name: 'Hotel Paris' } }] })) : new Response(JSON.stringify({ error: { description: 'duplicate clientReference' } }), { status: 400 }));
  assert.equal(r.status, 200); assert.equal((await r.json()).bookingId, 'BK9');
  assert.equal((await hb({ request: req({ action: 'prebook', offerId: 'o'.repeat(1600) }), env: sb }, up({ data: { prebookId: 'P1234', transactionId: 't1234', secretKey: 's' } }))).status, 200);
  assert.match(app, /payment-wrapper\.liteapi\.travel\/dist\/liteAPIPayment\.js/); assert.match(html, /id="asBookings"/);
  // Cancellation: holder email must match; then PUT /bookings/{id}. Works even when live booking is switched off.
  const calls = [];
  const cf = async (url, init) => { calls.push([init.method, String(url)]); return new Response(JSON.stringify({ data: init.method === 'GET' ? { bookingId: 'BK9001', status: 'CONFIRMED', currency: 'GBP', holder: { email: 'Ada@Example.com' } } : { status: 'CANCELLED', refund_amount: 329.6, cancellation_fee: 0, currency: 'GBP' } })); };
  r = await hb({ request: req({ action: 'cancel', bookingId: 'BK9001', email: 'ada@example.com' }), env: { LITEAPI_KEY: 'prod_x' } }, cf);
  d = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(calls, [['GET', 'https://book.liteapi.travel/v3.0/bookings/BK9001'], ['PUT', 'https://book.liteapi.travel/v3.0/bookings/BK9001']]);
  assert.deepEqual([d.status, d.refund, d.fee, d.currency], ['CANCELLED', 329.6, 0, 'GBP']);
  calls.length = 0;
  assert.equal((await hb({ request: req({ action: 'cancel', bookingId: 'BK9001', email: 'eve@example.com' }), env: sb }, cf)).status, 404);
  assert.deepEqual(calls.map((c) => c[0]), ['GET']);
  assert.equal((await hb({ request: req({ action: 'cancel', bookingId: 'BK9001' }), env: sb }, cf)).status, 400);
  assert.match(app, /data-as-cancel/); assert.match(app, /action:'cancel'/);
  // Owner readiness check: real prebook in production without payment details; wrong or missing secret stays blocked.
  const ck = (h) => new Request('https://app.aivatrading.uk/api/travel/hotel-book', { method: 'POST', body: JSON.stringify({ action: 'prebook', offerId: 'off_123' }), headers: { 'content-type': 'application/json', ...h } });
  const prodCk = { LITEAPI_KEY: 'prod_x', BOOKING_CHECK_SECRET: 'chk_secret_1' };
  const pb = up({ data: { prebookId: 'PB12345', transactionId: 'tr_12345', secretKey: 'pi_s', price: 65.9, currency: 'GBP' } });
  r = await hb({ request: ck({ 'X-Aiva-Check': 'chk_secret_1' }), env: prodCk }, pb); d = await r.json();
  assert.equal(r.status, 200); assert.deepEqual([d.prebooked, d.paymentForm, d.live, d.secretKey, d.transactionId], [true, true, true, undefined, undefined]);
  assert.equal((await hb({ request: ck({ 'X-Aiva-Check': 'wrong' }), env: prodCk }, pb)).status, 403);
  assert.equal((await hb({ request: ck({}), env: { LITEAPI_KEY: 'prod_x' } }, pb)).status, 403);
}
// In-app flight booking (Nuitee flights verify + prebook + payment SDK + book): sandbox only unless FLIGHT_BOOKING_LIVE.
{
  const { onRequestPost: fb, passengers } = await import('../functions/api/travel/flight-book.js');
  const req = (b, origin = 'https://app.aivatrading.uk') => new Request('https://app.aivatrading.uk/api/travel/flight-book', { method: 'POST', body: JSON.stringify(b), headers: { Origin: origin, 'content-type': 'application/json' } });
  let sent;
  const up = (reply, status = 200) => async (url, init) => { sent = { url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null, key: init.headers['X-API-Key'] }; return new Response(JSON.stringify(reply), { status }); };
  const sb = { LITEAPI_KEY: 'sand_x' };
  const contact = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phoneCountryCode: '+44', phoneNumber: '07700 900123' };
  const pax = [{ passengerType: 0, firstName: 'Ada', lastName: 'Lovelace', birthday: '1990-01-02', gender: 'F', nationality: 'gb', documentNumber: 'ab 123456', documentExpiry: '2031-01-01', documentIssueCountry: 'GB' }];
  let r = await fb({ request: req({ action: 'verify', offerId: 'off_123' }), env: sb }, up({ data: [{ journey: { pricing: { display: { total: 39.6, currency: 'GBP' } }, expiration: '2026-12-01T10:00:00Z' }, changes: { priceChanged: false } }] }));
  let d = await r.json();
  assert.equal(r.status, 200); assert.equal(sent.url, 'https://api.liteapi.travel/v3.0/flights/verify'); assert.deepEqual([d.price, d.currency, d.testMode], [39.6, 'GBP', true]);
  r = await fb({ request: req({ action: 'prebook', offerId: 'off_123', contact, passengers: pax }), env: sb }, up({ data: [{ prebookId: 'PB12345', transactionId: 'tr_12345', secretKey: 'pi_s', price: 39.6, currency: 'GBP', booking: { journey: { segments: [{ originCode: 'LHR', destinationCode: 'CDG', departureTime: '2026-12-23T11:40:00', carrier: { marketingCode: 'BA', marketingName: 'British Airways' }, flight: { marketingNumber: '304' } }] } } }] }));
  d = await r.json();
  assert.equal(r.status, 200); assert.equal(sent.url, 'https://api.liteapi.travel/v3.0/flights/prebooks');
  assert.deepEqual(sent.body.contact, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phoneCountryCode: '44', phoneNumber: '07700900123' });
  assert.equal(sent.body.usePaymentSdk, true); assert.equal(sent.body.passengers[0].nationality, 'GB'); assert.equal(sent.body.passengers[0].documentNumber, 'AB123456');
  assert.deepEqual([d.prebookId, d.secretKey, d.paymentEnv, d.segments[0].flight], ['PB12345', 'pi_s', 'sandbox', 'BA304']);
  r = await fb({ request: req({ action: 'book', prebookId: 'PB12345', transactionId: 'tr_12345' }), env: sb }, up({ data: { booking: { bookingId: 'BK9', bookingRef: 'FH-1', status: 'PENDING_CONFIRMATION', journey: { pricing: { display: { total: 39.6, currency: 'GBP' } }, segments: [{ pnr: 'ABC123' }] } } } }, 201));
  d = await r.json();
  assert.equal(sent.url, 'https://api.liteapi.travel/v3.0/flights/bookings'); assert.deepEqual(sent.body.payment, { method: 'TRANSACTION_ID', transactionId: 'tr_12345' });
  assert.deepEqual([d.bookingId, d.bookingRef, d.status, d.pnr, d.price], ['BK9', 'FH-1', 'PENDING_CONFIRMATION', 'ABC123', 39.6]);
  const st = { data: { bookingId: 'BK9999', status: 'CONFIRMED', pnr: 'XYZ789', contact: { email: 'Ada@Example.com' } } };
  r = await fb({ request: req({ action: 'status', bookingId: 'BK9999', email: 'ada@example.com' }), env: sb }, up(st));
  d = await r.json(); assert.equal(sent.method, 'GET'); assert.deepEqual([d.status, d.pnr], ['CONFIRMED', 'XYZ789']);
  assert.equal((await fb({ request: req({ action: 'status', bookingId: 'BK9999', email: 'eve@example.com' }), env: sb }, up(st))).status, 404, 'status needs the booking email');
  assert.equal((await fb({ request: req({ action: 'status', bookingId: 'BK9999' }), env: sb }, up(st))).status, 400);
  assert.equal(passengers([{ ...pax[0], passengerType: 1 }]), null, 'a child cannot travel alone');
  assert.equal(passengers([{ ...pax[0], birthday: 'soon' }]), null);
  assert.equal((await fb({ request: req({ action: 'prebook', offerId: 'off_1', contact: { ...contact, email: 'bad' }, passengers: pax }), env: sb }, up({}))).status, 400);
  assert.equal((await fb({ request: req({ action: 'prebook', offerId: 'off_1', contact, passengers: [] }), env: sb }, up({}))).status, 400);
  assert.equal((await fb({ request: req({ action: 'verify', offerId: 'off_1' }), env: { LITEAPI_KEY: 'prod_x' } }, up({}))).status, 403);
  {
    const ckReq = (a, k) => new Request('https://app.aivatrading.uk/api/travel/flight-book', { method: 'POST', body: JSON.stringify({ action: a, offerId: 'off_1', prebookId: 'pb_1234', transactionId: 'tr_1234' }), headers: { 'content-type': 'application/json', 'X-Aiva-Check': k } });
    const e = { LITEAPI_KEY: 'prod_x', BOOKING_CHECK_SECRET: 'chk_secret_1' }, v = up({ data: [{ journey: { pricing: { display: { total: 39.6, currency: 'GBP' } } } }] });
    assert.equal((await fb({ request: ckReq('verify', 'chk_secret_1'), env: e }, v)).status, 200);
    assert.equal((await fb({ request: ckReq('verify', 'nope'), env: e }, v)).status, 403);
    assert.equal((await fb({ request: ckReq('book', 'chk_secret_1'), env: e }, v)).status, 403);
  }
  assert.equal((await fb({ request: req({ action: 'verify', offerId: 'off_1' }), env: { LITEAPI_KEY: 'prod_x', HOTEL_BOOKING_LIVE: 'true' } }, up({}))).status, 403, 'hotel approval does not unlock flights');
  assert.equal((await fb({ request: req({ action: 'verify', offerId: 'off_1' }, 'https://evil.example'), env: sb }, up({}))).status, 403);
  assert.equal((await fb({ request: req({ action: 'verify', offerId: 'off_1' }), env: {} }, up({}))).status, 503);
  r = await fb({ request: req({ action: 'verify', offerId: 'off_1' }), env: sb }, up({ error: { description: 'this offer is sold out' } }, 400));
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'this offer is sold out');
  assert.match(app, /flightPaid=1/); assert.doesNotMatch(app, /airline ticketing inside Aiva is not switched on yet/);
  for (const id of ['asSosCountry', 'asSosNums', 'asHotelFilters', 'asHfBreakfast', 'asHfFree', 'asHfPrice', 'asHfDist', 'emCountry', 'emCountryNums']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-as-tab="sos"/);
  // Flight filters (price, stops, airline, departure time) and hotel star / facility filters.
  for (const id of ['asFlightFilters', 'asFfPrice', 'asFfStops', 'asFfAir', 'asFfTime', 'asFfSort', 'asHfStars', 'asHfFac', 'emCountryFind']) assert.match(html, new RegExp(`id="${id}"`));
  const { hotelFacilities } = await import('../functions/_lib/travel.js');
  assert.deepEqual(hotelFacilities([107, 2, 104, 999999]), ['wifi', 'parking', 'pool']);
  assert.deepEqual(hotelFacilities(), []);
}
// Worldwide emergency numbers: generated from a cited source, never guessed.
{
  const em = JSON.parse(readFileSync(pub('emergency-numbers.json'), 'utf8'));
  assert.ok(Object.keys(em.countries).length >= 200); assert.match(em.url, /oldid=\d+/);
  const has = (c, f, n) => assert.ok(em.countries[c][f].includes(n), `${c} ${f} ${n}`);
  has('GB', 'general', '999'); has('US', 'general', '911'); has('AU', 'general', '000'); has('JP', 'police', '110'); has('JP', 'ambulance', '119');
  has('CN', 'ambulance', '120'); has('AE', 'ambulance', '998'); has('BR', 'fire', '193'); has('FR', 'police', '17'); has('DE', 'police', '110'); has('NZ', 'general', '111'); has('CW', 'police', '911'); has('CW', 'ambulance', '912');
  for (const [c, v] of Object.entries(em.countries)) for (const n of [...v.police, ...v.ambulance, ...v.fire]) assert.match(n, /^[#*]?\d[\d ]{0,10}\d$/, `${c} ${n}`);
  assert.match(readFileSync(pub('service-worker.js'), 'utf8'), /emergency-numbers\.json/);
}
// Keyless open planners: tram-only connections count as local transport; an empty planner reply is not timetable coverage.
{
  const { onRequestGet: tf } = await import('../functions/api/travel/transfers.js');
  const osm = () => new Response(JSON.stringify({ elements: [{ type: 'node', id: 1, lat: 59.65, lon: 17.93, tags: { railway: 'station', name: 'Arlanda C' } }] }));
  const enturReply = (patterns) => async (url) => String(url).includes('entur') ? new Response(JSON.stringify({ data: { trip: { tripPatterns: patterns } } }))
    : String(url).includes('routing.openstreetmap.de') ? new Response(JSON.stringify({ code: 'Ok', routes: [{ duration: 1800, distance: 20000 }] })) : osm();
  const tramTrip = [{ duration: 1500, distance: 9000, legs: [{ mode: 'tram', line: { publicCode: '11', authority: { name: 'Ruter' } }, expectedStartTime: '2026-12-06T10:00:00+01:00', expectedEndTime: '2026-12-06T10:25:00+01:00', fromPlace: { name: 'A' }, toPlace: { name: 'B' }, intermediateQuays: [] }] }];
  let d = await (await tf({ request: new Request('https://x/api/travel/transfers?from=59.91,10.75&to=59.92,10.73'), env: {} }, enturReply(tramTrip))).json();
  assert.equal(d.schedules, true); assert.equal(d.modes.tram.available, true); assert.equal(d.modes.tram.routes.length, 1); assert.equal(d.modes.bus.available, false);
  d = await (await tf({ request: new Request('https://x/api/travel/transfers?from=59.91,10.75&to=59.92,10.73'), env: {} }, enturReply([{ duration: 900, distance: 1200, legs: [{ mode: 'foot', distance: 1200, expectedStartTime: '2026-12-06T10:00:00+01:00', expectedEndTime: '2026-12-06T10:15:00+01:00', fromPlace: { name: 'Origin' }, toPlace: { name: 'Destination' } }] }]))).json();
  assert.equal(d.schedules, false); assert.equal(d.modes.train.available, null);
  d = await (await tf({ request: new Request('https://x/api/travel/transfers?from=59.65,17.93&to=59.33,18.06'), env: {} }, enturReply([]))).json();
  assert.equal(d.schedules, false); assert.equal(d.modes.train.available, null);
}
// Aiva Search: flights and hotels book independently (separate checkouts), hotel-only search and attraction distances.
{
  const { onRequestGet: attractions } = await import('../functions/api/travel/attractions.js');
  const rq = (p) => ({ request: new Request('https://app.aivatrading.uk/api/travel/attractions' + p) });
  assert.equal((await attractions(rq('?lat=x&lon=1'))).status, 400);
  let sentUrl = '';
  const pages = { 1: { title: 'British Museum', description: 'Museum in London', coordinates: [{ lat: 51.5194, lon: -0.127 }] },
    2: { title: 'Big Ben', description: 'Clock tower in London', coordinates: [{ lat: 51.5007, lon: -0.1246 }] },
    3: { title: 'Embassy of Brazil, London', description: 'Diplomatic mission', coordinates: [{ lat: 51.507, lon: -0.128 }] },
    4: { title: 'Big Ben', description: 'Clock tower in London', coordinates: [{ lat: 51.5007, lon: -0.1246 }] }, 5: { title: 'No coords', description: 'Museum' } };
  let r = await attractions(rq('?lat=51.5074&lon=-0.1278'), async (url) => { sentUrl = String(url); return new Response(JSON.stringify({ query: { pages } })); });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(d.attractions.map((a) => a.name), ['Big Ben', 'British Museum']);
  assert.ok(d.attractions.every((a) => Number.isFinite(a.distance) && a.distance > 0 && a.distance < 10000));
  assert.match(decodeURIComponent(sentUrl), /generator=geosearch&ggscoord=51\.507\|-0\.128&ggsradius=10000/);
  r = await attractions(rq('?lat=51.5074&lon=-0.1278'), async () => { throw new TypeError('down'); });
  assert.equal(r.status, 503); assert.deepEqual((await r.json()).attractions, []);

  for (const id of ['asKind', 'asFReview', 'asReview']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-as-kind="flights"/); assert.match(html, /data-as-kind="hotels"/);
  assert.match(app, /✈️ Flight checkout/); assert.match(app, /🏨 Hotel checkout/);
  assert.match(app, /async function asSearchHotels\(\)/); assert.match(app, /\/api\/travel\/attractions\?/);
  assert.match(app, /if\(AS\.kind==='hotels'\)return asSearchHotels\(\)/);
  assert.doesNotMatch(app, /are ready below/); assert.doesNotMatch(app, /Your Aiva trip/);
  assert.match(app, /from \$\{escapeHTML\(a\.iata\)\} airport/);
}
console.log('AIVA SEARCH CHECKS PASSED');
