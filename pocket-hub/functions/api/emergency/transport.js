/* GET /api/emergency/transport?lat=&lon=&radius=<m>
   London (TfL area): live arrivals for buses, Tube, trams, DLR, Overground and Elizabeth line plus live line status
   (delays, part closures, cancellations) from the TfL Unified API. Elsewhere: nearby stations and stops from
   OpenStreetMap, flagged as unverified with links to the official live boards. Nothing is estimated. */
import { TFL, NOMINATIM, json, coords, distanceM, fetchJSON, cached, overpass } from '../../_lib/emergency.js';

export const inLondon = ({ lat, lon }) => lat > 51.25 && lat < 51.72 && lon > -0.56 && lon < 0.35;
const CLOSED = new Set([1, 2, 4, 16, 20]); // Closed, Suspended, Planned Closure, Not Running, Service Closed
const DISRUPTED = new Set([3, 5, 6, 11, 12, 13, 14, 15, 17]);
const LIVE_MODES = new Set(['bus', 'tube', 'tram', 'dlr', 'overground', 'elizabeth-line']);
const withKey = (u, env) => env?.TFL_APP_KEY ? u + (u.includes('?') ? '&' : '?') + 'app_key=' + encodeURIComponent(env.TFL_APP_KEY) : u;

export function lineState(severity) { return CLOSED.has(severity) ? 'closed' : DISRUPTED.has(severity) ? 'disrupted' : 'ok'; }

async function tflStops(origin, radius, env, fetcher) {
  const url = withKey(`${TFL}/StopPoint?lat=${origin.lat}&lon=${origin.lon}&radius=${radius}&returnLines=true` +
    '&stopTypes=NaptanPublicBusCoachTram,NaptanMetroStation,NaptanRailStation', env);
  const data = await fetchJSON(url, {}, fetcher);
  // Nearest stations (Tube, rail, DLR, tram) and nearest bus stops, so a busy bus corridor never hides the station.
  const all = (data?.stopPoints || []).filter(s => s.lines?.length).sort((a, b) => a.distance - b.distance);
  const isBus = s => (s.modes || []).every(m => m === 'bus' || m === 'coach');
  const stops = [...all.filter(s => !isBus(s)).slice(0, 3), ...all.filter(isBus).slice(0, 4)].sort((a, b) => a.distance - b.distance);
  const lineIds = [...new Set(stops.flatMap(s => s.lines.map(l => l.id)))];
  const [arrivals, statuses] = await Promise.all([
    Promise.all(stops.map(s => fetchJSON(withKey(`${TFL}/StopPoint/${encodeURIComponent(s.naptanId)}/Arrivals`, env), {}, fetcher).catch(() => null))),
    lineIds.length ? fetchJSON(withKey(`${TFL}/Line/${lineIds.map(encodeURIComponent).join(',')}/Status`, env), {}, fetcher).catch(() => []) : []
  ]);
  const status = new Map((Array.isArray(statuses) ? statuses : []).map(l => {
    const worst = [...(l.lineStatuses || [])].sort((a, b) => a.statusSeverity - b.statusSeverity)[0] || {};
    return [l.id, { id: l.id, name: l.name, mode: l.modeName, severity: worst.statusSeverity, status: worst.statusSeverityDescription || 'Status not reported',
      reason: [...new Set((l.lineStatuses || []).map(s => s.reason).filter(Boolean))].join(' ').slice(0, 400),
      state: Number.isFinite(worst.statusSeverity) ? lineState(worst.statusSeverity) : 'unknown' }];
  }));
  const now = Date.now();
  return stops.map((s, i) => {
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
    return { id: r.id, name: t.name, indicator: t.local_ref || t.ref && mode === 'bus' ? (t.local_ref || '') : '', modes: [mode], distance: distanceM(origin, r),
      lat: r.lat, lon: r.lon, state: 'unverified', label: 'Live times not verified in Aiva for this area', departures: [], lines: [], links, timetable: false };
  }).sort((a, b) => (a.modes[0] === 'bus') - (b.modes[0] === 'bus') || a.distance - b.distance)
    .filter((s, i, list) => !list.slice(0, i).some(o => o.name === s.name && o.modes[0] === s.modes[0] && distanceM(o, s) < 250)).slice(0, 10);
}

export async function onRequestGet({ request, env }, fetcher = fetch) {
  const url = new URL(request.url), origin = coords(url);
  if (!origin) return json({ error: 'Location is required' }, 400);
  const radius = Math.min(1000, Math.max(200, Math.round(Number(url.searchParams.get('radius')) || 600)));
  try {
    if (inLondon(origin)) {
      const stops = await cached(`tfl-${radius}-${origin.lat},${origin.lon}`, 30, () => tflStops(origin, radius, env, fetcher));
      return json({ provider: 'tfl', live: true, stops, source: 'Powered by TfL Open Data', retrieved: new Date().toISOString() });
    }
    const stops = await cached(`osm-stops-${radius}-${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}`, 3600, () => osmStops(origin, radius, fetcher));
    return json({ provider: 'osm', live: false, stops, source: 'OpenStreetMap', retrieved: new Date().toISOString() });
  } catch { return json({ error: 'Transport data is temporarily unavailable. Please try again shortly.' }, 502); }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
