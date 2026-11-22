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
