/* Aiva Train and Aiva Tram checks. Upstream rail calls and the distributor gateway are mocked, so this runs
   offline as part of the deploy and proves the app never invents a fare, station or departure. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const pub = (f) => new URL('../public/' + f, import.meta.url);
const url = (p) => 'https://app.aivatrading.uk' + p;
const reply = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });
const router = (table) => async (u) => {
  for (const [needle, body] of table) if (String(u).includes(needle)) return new Response(JSON.stringify(body));
  throw Object.assign(new Error('unexpected upstream ' + u), { status: 599 });
};

const STOP_A = { type: 'STOP', name: 'London St. Pancras Int.', id: 'stop-lon', lat: 51.5308, lon: -0.1238, country: 'GB', tz: 'Europe/London', modes: ['HIGHSPEED_RAIL', 'SUBURBAN', 'BUS'] };
const STOP_B = { type: 'STOP', name: 'St Pancras Way', id: 'stop-way', lat: 51.5417, lon: -0.1371, country: 'GB', modes: ['BUS'] };
const STOP_C = { type: 'STOP', name: 'Paris Nord', id: 'stop-par', lat: 48.8809, lon: 2.3553, country: 'FR', tz: 'Europe/Paris', modes: ['HIGHSPEED_RAIL', 'SUBURBAN'] };

const leg = (mode, over = {}) => ({
  mode, duration: 6900, realTime: true, routeShortName: mode === 'TRAM' ? 'Purple Line' : 'EST 9116',
  agencyName: mode === 'TRAM' ? 'Metrolink' : 'Eurostar', headsign: mode === 'TRAM' ? 'Altrincham' : 'Paris Nord',
  intermediateStops: [{ name: 'Lille Europe' }], startTime: '2026-12-02T08:05:00Z', endTime: '2026-12-02T10:02:00Z',
  from: { name: 'London St. Pancras Int.', tz: 'Europe/London', departure: '2026-12-02T08:05:00Z', track: '9' },
  to: { name: 'Paris Nord', tz: 'Europe/Paris', arrival: '2026-12-02T11:02:00Z', track: '4' }, ...over
});
const walk = (from, to) => ({ mode: 'WALK', duration: 300, distance: 240, startTime: '2026-12-02T08:00:00Z', endTime: '2026-12-02T08:05:00Z',
  from: { name: from, tz: 'Europe/London', departure: '2026-12-02T08:00:00Z' }, to: { name: to, tz: 'Europe/London', arrival: '2026-12-02T08:05:00Z' } });
const itin = (id, mode) => ({ id, duration: 7500, startTime: '2026-12-02T08:00:00Z', endTime: '2026-12-02T10:05:00Z', transfers: 0, legs: [walk('START', 'London St. Pancras Int.'), leg(mode), walk('Paris Nord', 'END')] });

// ---- Stations: names, address fallback, nearby detection and the train/tram filter.
{
  const { onRequestGet: stations } = await import('../functions/api/rail/stations.js');
  let d = await (await stations({ request: new Request(url('/api/rail/stations?q=st%20pancras&mode=train')) }, reply([STOP_A, STOP_B]))).json();
  assert.equal(d.stations.length, 1); assert.equal(d.stations[0].name, 'London St. Pancras Int.');
  assert.deepEqual(d.stations[0].modes, ['train', 'bus']); assert.equal(d.stations[0].country, 'GB');

  // A tram section must not offer a bus stop.
  d = await (await stations({ request: new Request(url('/api/rail/stations?q=piccadilly&mode=tram')) }, reply([{ ...STOP_A, modes: ['TRAM'] }, STOP_B]))).json();
  assert.deepEqual(d.stations.map((s) => s.name), ['London St. Pancras Int.']);
  assert.deepEqual(d.stations[0].modes, ['tram']);

  // No stop matches: hotels and addresses come back as places so the journey can start at the door.
  const place = { type: 'ADDRESS', name: 'Hilton London Metropole', id: 'addr-1', lat: 51.5165, lon: -0.1703, country: 'GB' };
  const fetchPlaces = async (u) => {
    if (String(u).includes('type=STOP')) return new Response(JSON.stringify([]));
    return new Response(JSON.stringify([place]));
  };
  d = await (await stations({ request: new Request(url('/api/rail/stations?q=Hilton%20London%20Metropole&mode=train')) }, fetchPlaces)).json();
  assert.deepEqual(d.stations, []); assert.equal(d.places[0].kind, 'address'); assert.equal(d.places[0].name, 'Hilton London Metropole');

  // Nearby stations: distance-ordered, one entry per station, mode-filtered.
  const near = [
    { stopId: 'p1', parentId: 'p', name: 'Piccadilly (Manchester Metrolink)', lat: 53.4774, lon: -2.2309, modes: ['TRAM'] },
    { stopId: 'p2', parentId: 'p', name: 'Piccadilly (Manchester Metrolink)', lat: 53.4775, lon: -2.231, modes: ['TRAM'] },
    { stopId: 'b1', parentId: 'b', name: 'Piccadilly Gardens bus stop', lat: 53.4808, lon: -2.236, modes: ['BUS'] },
    { stopId: 't1', parentId: 't', name: 'Manchester Piccadilly rail', lat: 53.4774, lon: -2.2309, modes: ['RAIL'] }
  ];
  d = await (await stations({ request: new Request(url('/api/rail/stations?lat=53.4774&lon=-2.2309&mode=tram&radius=2000')) }, reply(near))).json();
  assert.deepEqual(d.stations.map((s) => s.id), ['p1']); assert.equal(d.stations[0].distance, 0);
  assert.equal((await stations({ request: new Request(url('/api/rail/stations')) }, reply([]))).status, 400);
  assert.equal((await stations({ request: new Request(url('/api/rail/stations?q=Paris')) }, async () => { throw new Error('down'); })).status, 503);
}

// ---- Search: train and tram journeys from the open feeds, plus the honest no-distributor state.
{
  const { onRequestGet: search } = await import('../functions/api/rail/search.js');
  const place = (id, name, lat, lon, modes = ['TRAM']) => ({ stopId: id, name, lat, lon, modes });
  const plan = (its) => ({ itineraries: its, direct: [] });
  const table = [['/plan?', plan([itin('a', 'HIGHSPEED_RAIL'), itin('b', 'BUS')])], ['/map/stops', [place('s1', 'London St Pancras', 51.53, -0.12, ['RAIL'])]]];
  let d = await (await search({ request: new Request(url('/api/rail/search?from=51.5308,-0.1238&to=48.8809,2.3553&mode=train&time=2026-12-02T08:00:00Z&pax=2')), env: {} }, router(table))).json();
  assert.equal(d.mode, 'train'); assert.equal(d.itineraries.length, 1); assert.equal(d.itineraries[0].legs[1].line, 'EST 9116');
  assert.equal(d.live, true); assert.equal(d.sales.available, false); assert.match(d.sales.reason, /distributor/);
  assert.deepEqual(d.sales.fares, []); assert.equal(d.stations.from.length, 1); assert.match(d.source, /Transitous/);
  assert.equal(d.note, '');

  // Tram search keeps only tram itineraries.
  d = await (await search({ request: new Request(url('/api/rail/search?from=53.4774,-2.2309&to=53.3874,-2.3477&mode=tram&time=2026-12-02T09:00:00Z')), env: {} }, router([['/plan?', plan([itin('t', 'TRAM'), itin('r', 'REGIONAL_RAIL')])], ['/map/stops', [place('m1', 'Piccadilly (Manchester Metrolink)', 53.4774, -2.2309)]]]))).json();
  assert.equal(d.mode, 'tram'); assert.deepEqual(d.itineraries.map((i) => i.id), ['t']); assert.equal(d.itineraries[0].legs[1].operator, 'Metrolink');

  // Nothing found: an empty list with the feed-horizon note, never an invented journey.
  d = await (await search({ request: new Request(url('/api/rail/search?from=51.5308,-0.1238&to=48.8809,2.3553&time=2026-12-02T08:00:00Z')), env: {} }, router([['/plan?', plan([])], ['/map/stops', []]]))).json();
  assert.deepEqual(d.itineraries, []); assert.match(d.note, /Nothing is estimated/);

  assert.equal((await search({ request: new Request(url('/api/rail/search?from=51.5,-0.1&to=51.5,-0.1')) })).status, 400);
  assert.equal((await search({ request: new Request(url('/api/rail/search?from=bad&to=48.9,2.4')) })).status, 400);
  const down = await search({ request: new Request(url('/api/rail/search?from=51.5,-0.1&to=48.9,2.4')) }, async () => { throw new Error('down'); });
  assert.equal(down.status, 503); assert.match((await down.json()).error, /temporarily unavailable/);

  // With an authorised distributor connected, real quotes are passed through and shown cheapest first.
  const env = { RAIL_SALES_GATEWAY_URL: 'https://rail.example', RAIL_SALES_GATEWAY_KEY: 'secret' };
  const fares = { fares: [
    { itineraryId: 'a', quoteId: 'q1', amount: 86.5, currency: 'GBP', description: 'Standard', refundable: false, payment: { provider: 'card', sessionId: 'sess_1', sdkUrl: 'https://pay.example/sdk.js' } },
    { itineraryId: 'zzz', quoteId: 'q2', amount: 12, currency: 'GBP' },
    { itineraryId: 'a', quoteId: 'q3', amount: 'free', currency: 'GBP' }
  ] };
  d = await (await search({ request: new Request(url('/api/rail/search?from=51.5308,-0.1238&to=48.8809,2.3553&time=2026-12-02T08:00:00Z')), env }, router([...table, ['rail.example/fares', fares]]))).json();
  assert.equal(d.sales.available, true); assert.equal(d.sales.fares.length, 1);
  assert.deepEqual([d.sales.fares[0].amount, d.sales.fares[0].currency, d.sales.fares[0].payment.sessionId], [86.5, 'GBP', 'sess_1']);
}

// ---- Live departure board.
{
  const { onRequestGet: board } = await import('../functions/api/rail/departures.js');
  const rows = { stopTimes: [
    { mode: 'TRAM', routeShortName: 'Blue Line', headsign: 'Ashton-under-Lyne', agencyName: 'Metrolink', realTime: true, cancelled: false,
      place: { name: 'Piccadilly', tz: 'Europe/London', scheduledDeparture: '2026-12-02T09:00:00Z', departure: '2026-12-02T09:03:00Z', track: 'P1' } },
    { mode: 'TRAM', routeShortName: 'Yellow Line', headsign: 'Eccles', agencyName: 'Metrolink', realTime: false, tripCancelled: true,
      place: { name: 'Piccadilly', tz: 'Europe/London', scheduledDeparture: '2026-12-02T09:06:00Z', departure: '2026-12-02T09:06:00Z' } },
    { mode: 'BUS', routeShortName: '192', headsign: 'Stockport', place: { scheduledDeparture: '2026-12-02T09:01:00Z', departure: '2026-12-02T09:01:00Z' } }
  ], place: { name: 'Piccadilly (Manchester Metrolink)', tz: 'Europe/London' } };
  let d = await (await board({ request: new Request(url('/api/rail/departures?stopId=gb-dft-bods_940GZZMAPIC&mode=tram&n=5')) }, reply(rows))).json();
  assert.deepEqual(d.departures.map((x) => x.line), ['Blue Line', 'Yellow Line']);
  assert.equal(d.departures[0].delay, 3); assert.equal(d.departures[0].platform, 'P1'); assert.equal(d.departures[0].mode, 'tram');
  assert.equal(d.departures[1].cancelled, true); assert.equal(d.live, true); assert.equal(d.stop.name, 'Piccadilly (Manchester Metrolink)');
  assert.equal((await board({ request: new Request(url('/api/rail/departures?stopId=..')) })).status, 400);
  const down = await board({ request: new Request(url('/api/rail/departures?stopId=gb-123')) }, async () => { throw new Error('down'); });
  assert.equal(down.status, 503);
}

// ---- Ticket sales: refused without a distributor, complete with one.
{
  const { onRequestPost: order } = await import('../functions/api/rail/order.js');
  const req = (body, origin = 'https://app.aivatrading.uk') => new Request(url('/api/rail/order'), { method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'content-type': 'application/json' } });
  let r = await order({ request: req({ action: 'order', quoteId: 'q1', paymentToken: 'tok', passengers: [{ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }] }), env: {} });
  let d = await r.json();
  assert.equal(r.status, 503); assert.match(d.error, /nothing was sold or charged/i); assert.equal(d.restriction.available, false);
  assert.ok(d.restriction.distributors.some((x) => /Trainline/.test(x.name)));

  const env = { RAIL_SALES_GATEWAY_URL: 'https://rail.example', RAIL_SALES_GATEWAY_KEY: 'k' };
  assert.equal((await order({ request: req({ action: 'order', quoteId: 'q1', paymentToken: 'tok' }, 'https://evil.example'), env }, reply({}))).status, 403);
  assert.equal((await order({ request: req({ action: 'order', quoteId: 'q1', paymentToken: 'tok', passengers: [{ firstName: 'Ada', lastName: '', email: 'ada@example.com' }] }), env }, reply({}))).status, 400);
  assert.equal((await order({ request: req({ action: 'order', quoteId: 'q1', passengers: [] }), env }, reply({}))).status, 400);

  let sent = null;
  const gateway = async (u, init) => { sent = { url: String(u), body: JSON.parse(init.body), key: init.headers['X-API-Key'] }; return new Response(JSON.stringify({ orderId: 'ord_1', pnr: 'PNR9X', status: 'CONFIRMED', operator: 'Eurostar', from: 'London St Pancras', to: 'Paris Nord', depart: '2026-12-02T09:01:00Z', arrive: '2026-12-02T12:20:00Z', fare: { amount: 86.5, currency: 'GBP' }, ticket: { barcode: 'BC-123' } })); };
  r = await order({ request: req({ action: 'order', quoteId: 'q1', paymentToken: 'tok_1', passengers: [{ firstName: ' Ada ', lastName: 'Lovelace', email: 'ada@example.com' }] }), env }, gateway);
  d = await r.json();
  assert.equal(r.status, 200); assert.equal(sent.url, 'https://rail.example/orders'); assert.equal(sent.key, 'k');
  assert.deepEqual([d.orderId, d.pnr, d.status, d.operator], ['ord_1', 'PNR9X', 'CONFIRMED', 'Eurostar']);
  assert.deepEqual(d.ticket, { barcode: 'BC-123', qrPayload: 'BC-123' }); assert.equal(d.fare.amount, 86.5);

  const failing = await order({ request: req({ action: 'order', quoteId: 'q1', paymentToken: 'tok', passengers: [{ firstName: 'A', lastName: 'B', email: 'a@b.co' }] }), env },
    async () => new Response(JSON.stringify({ error: { message: 'Fare expired' } }), { status: 409 }));
  assert.equal(failing.status, 409); assert.match((await failing.json()).error, /Fare expired/);

  const { quoteFares } = await import('../functions/_lib/rail-sales.js');
  const bad = await quoteFares(env, { mode: 'train', from: 'a', to: 'b', depart: '2026-12-02T08:00:00Z', passengers: 2, itineraries: ['a'] },
    async () => new Response(JSON.stringify({ fares: [{ itineraryId: 'a', amount: -1, currency: 'GBP' }, { itineraryId: 'a', amount: 10, currency: 'pounds' }] })));
  assert.deepEqual(bad, []);
}

// ---- The sections ship in the app shell, with no external link anywhere in the booking journey.
{
  const html = readFileSync(pub('index.html'), 'utf8');
  for (const id of ['asRailTrain', 'asRailTram', 'railTrainBody', 'railTramBody']) assert.match(html, new RegExp(`id=\"${id}\"`));
  assert.match(html, /Aiva Train/); assert.match(html, /Aiva Tram/);
  assert.match(html, /data-rail-section=\"train\"/); assert.match(html, /data-rail-section=\"tram\"/);
  assert.match(html, /src=\"aiva-rail\\.js\"/); assert.match(html, /src=\"vendor\\/qrcode\\.js\"/);
  const travel = html.slice(html.indexOf('<section id=\"travel\"'), html.indexOf('</section>', html.indexOf('<section id=\"travel\"')));
  assert.doesNotMatch(travel, /<a [^>]*href=\"https?:/);
  assert.doesNotMatch(travel, /target=\"_blank\"/);
  assert.ok(existsSync(pub('aiva-rail.js'))); assert.ok(existsSync(pub('vendor/qrcode.js')));
  const sw = readFileSync(pub('service-worker.js'), 'utf8');
  assert.match(sw, /aiva-rail\\.js/); assert.match(sw, /vendor\\/qrcode\\.js/);
}

// ---- The vendored QR generator still produces a scannable matrix for a ticket payload.
{
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(pub('vendor/qrcode.js'), 'utf8'), ctx);
  const qr = ctx.qrcode(0, 'M');
  qr.addData('AIVA|PNR9X|London St Pancras-Paris Nord|2026-12-02T09:01Z');
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
  assert.match(svg, /^<svg/); assert.match(svg, /<path/); assert.ok(svg.length > 500);
  assert.equal(qr.getModuleCount() >= 21, true);
}
console.log('AIVA TRAIN AND TRAM CHECKS PASSED');
