/* Live departures from Transitous, a public MOTIS instance that aggregates open GTFS and GTFS-realtime feeds
   (DELFI/VBB Germany, Switzerland, Netherlands, Belgium, France, Italy, Spain, Nordics and more). Keyless.
   Used where Aiva has no national feed of its own (TfL, Entur, opendata.ch); OpenStreetMap stays the fallback.
   Nothing is estimated: a stop only turns green when the feed reports a real-time departure. */
import { fetchJSON, distanceM } from './emergency.js';
import { verdict } from './transit.js';

export const TRANSITOUS = 'https://api.transitous.org/api/v1';

/* MOTIS modes -> the mode names the rest of Pocket Hub already uses. */
const MODE = {
  BUS: 'bus', COACH: 'bus', TROLLEYBUS: 'bus', RAIL_REPLACEMENT_BUS: 'bus',
  TRAM: 'tram', SUBWAY: 'metro', METRO: 'metro', FUNICULAR: 'train', CABLE_CAR: 'train',
  REGIONAL_RAIL: 'train', REGIONAL_FAST_RAIL: 'train', LONG_DISTANCE: 'train', HIGHSPEED_RAIL: 'train',
  NIGHT_RAIL: 'train', FERRY: 'ferry', AIRPLANE: 'flight'
};
const modeOf = m => MODE[m] || (/RAIL/i.test(String(m)) ? 'train' : 'bus');
const parentOf = s => String(s.parentId || s.stopId).replace(/::\d+$/, '');

/* Nearest stops inside the search radius, one per station (a station has several platform-level ids). */
function nearestStations(list, origin, radius, limit) {
  const seen = new Set(), out = [];
  for (const s of (Array.isArray(list) ? list : [])) {
    if (!s?.stopId || !s.name || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const distance = distanceM(origin, { lat: s.lat, lon: s.lon });
    if (distance > radius) continue;
    const key = parentOf(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...s, distance });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.distance - b.distance);
}

export async function transitousStops(origin, radius, fetcher, now = Date.now()) {
  const dLat = radius / 111320, dLon = dLat / Math.max(0.2, Math.cos(origin.lat * Math.PI / 180));
  const bbox = `min=${(origin.lat - dLat).toFixed(5)},${(origin.lon - dLon).toFixed(5)}&max=${(origin.lat + dLat).toFixed(5)},${(origin.lon + dLon).toFixed(5)}`;
  const near = await fetchJSON(`${TRANSITOUS}/map/stops?${bbox}&limit=60`, {}, fetcher);
  const stations = nearestStations(near, origin, radius, 3);
  if (!stations.length) return { stops: [], upstream: [] };

  const upstream = new Set();
  const boards = await Promise.all(stations.map(s => fetchJSON(
    `${TRANSITOUS}/stoptimes?stopId=${encodeURIComponent(s.stopId)}&n=10`, {}, fetcher, 10000
  ).catch(e => { upstream.add(e.status || e.name); return null; })));

  const stops = stations.map((s, i) => {
    const board = boards[i];
    const departures = ((board?.stopTimes) || []).map(t => {
      const place = t.place || {};
      const when = Date.parse(place.departure || place.scheduledDeparture || '');
      const planned = Date.parse(place.scheduledDeparture || place.departure || '');
      const cancelled = !!(t.cancelled || t.tripCancelled || place.cancelled);
      const late = Number.isFinite(when) && Number.isFinite(planned) ? Math.round((when - planned) / 60000) : 0;
      return {
        line: t.routeShortName || t.displayName || t.tripShortName || '',
        lineId: t.routeId || '',
        destination: t.headsign || '',
        platform: place.track || place.scheduledTrack || '',
        expected: Number.isFinite(when) ? new Date(when).toISOString() : '',
        minutes: Number.isFinite(when) ? Math.max(0, Math.round((when - now) / 60000)) : NaN,
        realtime: !!t.realTime,
        cancelled,
        status: cancelled ? 'Cancelled' : late > 0 ? `${late} min late` : ''
      };
    }).filter(x => Number.isFinite(x.minutes)).sort((a, b) => a.minutes - b.minutes).slice(0, 8);

    const modes = [...new Set((s.modes || []).map(modeOf))];
    const base = {
      id: s.stopId, name: s.name, indicator: '', modes: modes.length ? modes : ['bus'],
      distance: Math.round(s.distance), lat: s.lat, lon: s.lon,
      departures, lines: [], alerts: [], timetable: false, links: []
    };
    if (board === null) return { ...base, state: 'unverified', label: 'Live feed did not respond' };
    return { ...base, ...verdict(departures, 'Transitous') };
  });

  return { stops, upstream: [...upstream] };
}
