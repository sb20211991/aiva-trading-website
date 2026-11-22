/* GET /api/emergency/transport?lat=&lon=&radius=<m>
   London (TfL area): live arrivals for buses, Tube, trams, DLR, Overground and Elizabeth line plus live line status
   (delays, part closures, cancellations) from the TfL Unified API. Norway (Entur) and Switzerland (opendata.ch): live
   departures for every mode. Elsewhere: nearby stations and stops from OpenStreetMap, with live trains added from
   National Rail (Great Britain, when RAIL_DATA_LDB_KEY is set) and iRail (Belgium); everything else stays unverified
   with links to the official live boards. Nothing is estimated. */
import { TFL, NOMINATIM, json, coords, distanceM, fetchJSON, cached, overpass } from '../../_lib/emergency.js';
import { entur, swiss, irail, darwin, verdict } from '../../_lib/transit.js';

export const inLondon = ({ lat, lon }) => lat > 51.25 && lat < 51.72 && lon > -0.56 && lon < 0.35;
const CLOSED = new Set([1, 2, 4, 16, 20]); // Closed, Suspended, Planned Closure, Not Running, Service Closed
const OK = new Set([10, 18, 19]); // Good Service, No Issues, Information
const LIVE_MODES = new Set(['bus', 'tube', 'tram', 'dlr', 'overground', 'elizabeth-line']);
const withKey = (u, env) => env?.TFL_APP_KEY ? u + (u.includes('?') ? '&' : '?') + 'app_key=' + encodeURIComponent(env.TFL_APP_KEY) : u;

export function lineState(severity) { return CLOSED.has(severity) ? 'closed' : OK.has(severity) ? 'ok' : 'disrupted'; }

async function tflStops(origin, radius, env, fetcher) {
  const upstream = new Set();
  const url = withKey(`${TFL}/StopPoint?lat=${origin.lat}&lon=${origin.lon}&radius=${radius}&returnLines=true` +
    '&stopTypes=NaptanPublicBusCoachTram,NaptanMetroStation,NaptanRailStation', env);
  const data = await fetchJSON(url, {}, fetcher);
  // Nearest stations (Tube, rail, DLR, tram) and nearest bus stops, so a busy bus corridor never hides the station.
  const all = (data?.stopPoints || []).filter(s => s.lines?.length).sort((a, b) => a.distance - b.distance);
  const isBus = s => (s.modes || []).every(m => m === 'bus' || m === 'coach');
  const stops = [...all.filter(s => !isBus(s)).slice(0, 3), ...all.filter(isBus).slice(0, 4)].sort((a, b) => a.distance - b.distance);
  const lineIds = [...new Set(stops.flatMap(s => s.lines.map(l => l.id)))];
  const [arrivals, statuses] = await Promise.all([
    Promise.all(stops.map(s => fetchJSON(withKey(`${TFL}/StopPoint/${encodeURIComponent(s.naptanId)}/Arrivals`, env), {}, fetcher).catch(e => { upstream.add(e.status || e.name); return null; }))),
    lineIds.length ? fetchJSON(withKey(`${TFL}/Line/${lineIds.map(encodeURIComponent).join(',')}/Status`, env), {}, fetcher).catch(e => { upstream.add(e.status || e.name); return []; }) : []
  ]);
  const status = new Map((Array.isArray(statuses) ? statuses : []).map(l => {
    const worst = [...(l.lineStatuses || [])].sort((a, b) => a.statusSeverity - b.statusSeverity)[0] || {};
    return [l.id, { id: l.id, name: l.name, mode: l.modeName, severity: worst.statusSeverity, status: worst.statusSeverityDescription || 'Status not reported',
      reason: [...new Set((l.lineStatuses || []).map(s => s.reason).filter(Boolean))].join(' ').slice(0, 400),
      state: Number.isFinite(worst.statusSeverity) ? lineState(worst.statusSeverity) : 'unknown' }];
  }));
  const now = Date.now();
  const result = stops.map((s, i) => {
    const modes = s.modes || [];
    const lines = s.lines.map(l => status.get(l.id) || { id: l.id, name: l.name, status: 'Status not reported', state: 'unknown' });
    const feed = arrivals[i];
    const departures = (Array.isArray(feed) ? feed : []).map(a => ({ line: a.lineName, lineId: a.lineId, destination: a.destinationName || a.towards || '',
      platform: a.platformName && a.platformName !== 'null' ? a.platformName : '', expected: a.expectedArrival,
      minutes: Math.max(0, Math.round((Date.parse(a.expectedArrival) - now) / 60000)) }))
      .filter(d => Number.isFinite(d.minutes)).sort((a, b) => a.minutes - b.minutes).slice(0, 8);
    const liveCapable = modes.some(m => LIVE_MODES.has(m));
    let state, label;
    if (lines.length && lines.every(l => l.state === 'closed')) { state = 'closed'; label = 'No service: ' + lines[0].status; }
    else if (!liveCapable || feed === null) { state = 'unverified'; label = feed === null ? 'Live feed did not respond' : 'No TfL live feed for this station'; }
    else if (departures.length) { state = 'live'; label = `Live · next ${departures[0].line} in ${departures[0].minutes ? departures[0].minutes + ' min' : 'under 1 min'}`; }
    else { state = 'none'; label = 'No live departures reported for the next 30 minutes'; }
    return { id: s.naptanId, name: s.commonName, indicator: s.indicator || '', modes, distance: Math.round(s.distance),
      lat: s.lat, lon: s.lon, state, label, departures, lines, timetable: liveCapable };
  });
  return { stops: result, upstream: [...upstream] };
}

async function osmStops(origin, radius, fetcher) {
  let raw;
  try {
    const a = `(around:${radius},${origin.lat},${origin.lon})`;
    const els = await overpass(`[out:json][timeout:12];(nwr${a}["railway"~"^(station|halt)$"];nwr${a}["railway"="tram_stop"];node${a}["highway"="bus_stop"];);out center tags 80;`, fetcher);
    raw = els.map(e => ({ id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: e.tags || {} }));
  } catch {
    const d = radius / 111320, dl = d / Math.max(0.2, Math.cos(origin.lat * Math.PI / 180));
    const box = [origin.lon - dl, origin.lat + d, origin.lon + dl, origin.lat - d].map(n => n.toFixed(5)).join(',');
    raw = [];
    for (const phrase of ['railway station', 'tram stop', 'bus stop']) {
      const list = await fetchJSON(`${NOMINATIM}/search?format=jsonv2&extratags=1&bounded=1&limit=30&viewbox=${box}&amenity=${encodeURIComponent(phrase)}`, {}, fetcher);
      for (const r of list || []) raw.push({ id: `${r.osm_type}/${r.osm_id}`, lat: Number(r.lat), lon: Number(r.lon), tags: { ...(r.extratags || {}), name: r.name, [r.category]: r.type } });
    }
  }
  return raw.filter(r => Number.isFinite(r.lat) && r.tags.name).map(r => {
    const t = r.tags, mode = t.railway === 'tram_stop' ? 'tram' : t.highway === 'bus_stop' ? 'bus' : 'train';
    const links = [];
    if (mode === 'train' && /^[A-Z]{3}$/.test(t['ref:crs'] || '')) links.push({ label: 'Live departures (National Rail)', url: `https://www.nationalrail.co.uk/live-trains/departures/${t['ref:crs']}/` });
    if (mode === 'bus' && t['naptan:AtcoCode']) links.push({ label: 'Live times (bustimes.org)', url: `https://bustimes.org/stops/${encodeURIComponent(t['naptan:AtcoCode'])}` });
    return { id: r.id, name: t.name, crs: mode === 'train' && /^[A-Z]{3}$/.test(t['ref:crs'] || '') ? t['ref:crs'] : '',
      uic: mode === 'train' && /^\d{7}$/.test(t.uic_ref || '') ? t.uic_ref : '', indicator: t.local_ref || t.ref && mode === 'bus' ? (t.local_ref || '') : '', modes: [mode], distance: distanceM(origin, r),
      lat: r.lat, lon: r.lon, state: 'unverified', label: 'Live times not verified in Aiva for this area', departures: [], lines: [], links, timetable: false };
  }).sort((a, b) => (a.modes[0] === 'bus') - (b.modes[0] === 'bus') || a.distance - b.distance)
    .filter((s, i, list) => !list.slice(0, i).some(o => o.name === s.name && o.modes[0] === s.modes[0] && distanceM(o, s) < 250)).slice(0, 10);
}

/* Adds live departures to OSM train stations where an open live feed exists for the country. */
async function enrichRail(stops, cc, env, fetcher) {
  const upstream = new Set(), sources = new Set();
  const feed = cc === 'gb' && env?.RAIL_DATA_LDB_KEY ? { key: 'crs', name: 'National Rail', source: 'National Rail Enquiries (Darwin)',
      get: s => darwin(s.crs, env, fetcher) }
    : cc === 'be' ? { key: 'uic', name: 'iRail', source: 'iRail (SNCB/NMBS)', get: async s => ({ departures: await irail(s.uic, fetcher), alerts: [] }) } : null;
  if (!feed) return { stops, upstream: [], sources: [] };
  const targets = stops.filter(s => s[feed.key]).slice(0, 3);
  await Promise.all(targets.map(async s => {
    try {
      const r = await cached(`${feed.key}-${s[feed.key]}`, 30, () => feed.get(s));
      Object.assign(s, verdict(r.departures, feed.name), { departures: r.departures, alerts: r.alerts });
      sources.add(feed.source);
    } catch (e) { upstream.add(e.status || e.name); s.label = 'Live feed did not respond'; }
  }));
  return { stops, upstream: [...upstream], sources: [...sources] };
}

const SOURCE = { tfl: 'Powered by TfL Open Data', entur: 'Entur (Norway)', swiss: 'transport.opendata.ch (Switzerland)' };

export async function onRequestGet({ request, env }, fetcher = fetch) {
  const url = new URL(request.url), origin = coords(url);
  if (!origin) return json({ error: 'Location is required' }, 400);
  const radius = Math.min(1000, Math.max(200, Math.round(Number(url.searchParams.get('radius')) || 600)));
  const cc = (url.searchParams.get('cc') || '').toLowerCase();
  const key = `${radius}-${origin.lat},${origin.lon}`, now = () => new Date().toISOString();
  const live = stops => stops.some(s => s.state === 'live');
  const provider = inLondon(origin) ? 'tfl' : cc === 'no' ? 'entur' : cc === 'ch' || cc === 'li' ? 'swiss' : 'osm';
  let upstreamErrors = [];
  try {
    if (provider === 'tfl') {
      const { stops, upstream } = await cached(`tfl2-${key}`, 30, () => tflStops(origin, radius, env, fetcher));
      return json({ provider, live: true, stops, upstreamErrors: upstream, source: SOURCE.tfl, retrieved: now() });
    }
    if (provider !== 'osm') {
      try {
        const { stops, upstream } = provider === 'entur'
          ? { stops: await cached(`entur-${key}`, 30, () => entur(origin, radius, fetcher)), upstream: [] }
          : await cached(`swiss-${key}`, 30, () => swiss(origin, radius, fetcher));
        if (stops.length) return json({ provider, live: live(stops), stops, upstreamErrors: upstream, source: SOURCE[provider], retrieved: now() });
      } catch (e) { upstreamErrors = [e.status || e.name]; }
    }
    const base = await cached(`osm-stops2-${radius}-${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}`, 3600, () => osmStops(origin, radius, fetcher));
    const { stops, upstream, sources } = await enrichRail(base.map(s => ({ ...s })), cc, env, fetcher);
    return json({ provider: 'osm', live: live(stops), stops, upstreamErrors: [...upstreamErrors, ...upstream],
      source: ['OpenStreetMap', ...sources].join(' · '), retrieved: now() });
  } catch { return json({ error: 'Transport data is temporarily unavailable. Please try again shortly.' }, 503); }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
