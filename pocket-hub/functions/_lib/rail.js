/* Aiva Train and Aiva Tram: real stations, live departure boards and rail/tram journeys.
   The source is Transitous (MOTIS), the keyless aggregator of open GTFS and GTFS-realtime feeds that already
   powers Aiva's worldwide journey planner: real departure and arrival times, real-time delays, platforms,
   cancellations, operators and walking access legs. Open feeds do not publish fares or seat inventory, so
   nothing here estimates a price or a seat. Fares and ticket sales come only from an authorised rail
   distributor through _lib/rail-sales.js. */
import { fetchJSON, distanceM, validTz } from './emergency.js';
import { TRANSITOUS, motisPlan } from './motis.js';

export const RAIL_MODES = ['RAIL', 'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN'];
export const TRAM_MODES = ['TRAM'];
export const MODE_GROUPS = { train: RAIL_MODES, tram: TRAM_MODES };
export const SOURCE = 'Timetables: Transitous (MOTIS) · open GTFS and GTFS-real-time feeds · © OpenStreetMap contributors';

/* MOTIS stop modes -> the names Aiva uses. An unknown mode is dropped rather than guessed. */
const LABEL = {
  RAIL: 'train', HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train', NIGHT_RAIL: 'train', REGIONAL_FAST_RAIL: 'train',
  REGIONAL_RAIL: 'train', SUBURBAN: 'train', TRAM: 'tram', SUBWAY: 'metro', METRO: 'metro', FUNICULAR: 'train',
  CABLE_CAR: 'train', AERIAL_LIFT: 'train', BUS: 'bus', COACH: 'bus', TROLLEYBUS: 'bus', RAIL_REPLACEMENT_BUS: 'bus', FERRY: 'ferry'
};
export const modeOf = (m) => LABEL[String(m || '').toUpperCase()] || (/RAIL|SUBURBAN/i.test(String(m || '')) ? 'train' : 'bus');
const lineOf = (m) => LABEL[String(m || '').toUpperCase()] || '';

export function stationShape(s = {}) {
  const modes = [...new Set((s.modes || []).map(lineOf).filter(Boolean))];
  return {
    id: String(s.id || s.stopId || ''), name: String(s.name || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    lat: Number(s.lat), lon: Number(s.lon), country: String(s.country || '').toUpperCase().slice(0, 2),
    tz: validTz(s.tz) ? s.tz : '', modes, kind: 'station'
  };
}
const usable = (s) => !!s.name && Number.isFinite(s.lat) && Number.isFinite(s.lon) && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180;
export const fitsMode = (s, mode) => !MODE_GROUPS[mode] || (s.modes || []).includes(mode);

/* Stations matching a name, or the nearest stations around a point. A mode filter is applied only when the
   caller asked for one, so a tram section never offers a bus stop as its boarding point. */
export async function findStations({ q, near, radius = 3000, mode = '', limit = 6, fetcher = fetch } = {}) {
  const want = MODE_GROUPS[mode] ? mode : '';
  const max = Math.min(8, Math.max(1, Number(limit) || 6));
  if (q && String(q).trim().length >= 2) {
    const text = String(q).trim().slice(0, 120);
    const data = await fetchJSON(`${TRANSITOUS}/geocode?text=${encodeURIComponent(text)}&type=STOP&limit=${Math.min(50, Math.max(12, max * 4))}`, {}, fetcher, 15000);
    const seen = new Set();
    /* A city name matches a single bus shelter as readily as the main station, and the geocoder's own order
       can put the shelter first. Rank by how many transport modes a stop serves, then by how closely its name
       matches what was typed, so “Paris” leads with a railway station rather than a roadside stop. */
    const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const needle = norm(text);
    const rank = (s) => {
      const name = norm(s.name);
      return [-(s.modes || []).length, name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3, name.length];
    };
    const byRank = (x, y) => {
      const a = rank(x), b = rank(y);
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    };
    return (Array.isArray(data) ? data : []).map(stationShape).filter((s) => usable(s) && fitsMode(s, want))
      .filter((s) => !seen.has(s.name) && seen.add(s.name)).sort(byRank).slice(0, max);
  }
  if (!near || !Number.isFinite(near.lat) || !Number.isFinite(near.lon)) return [];
  const r = Math.min(10000, Math.max(400, Math.round(Number(radius) || 3000)));
  /* A city block can hold hundreds of bus stops, and the map feed returns stops by importance, so one wide
     search buries the tram stop under them. Search a tight ring first and widen only when it finds nothing. */
  const rings = [...new Set([1200, 2500, r].map((x) => Math.min(r, x)))].filter((x) => x >= 400).sort((a, b) => a - b);
  for (const ring of rings) {
    const dLat = ring / 111320, dLon = dLat / Math.max(0.2, Math.cos((near.lat * Math.PI) / 180));
    const bbox = `min=${(near.lat - dLat).toFixed(5)},${(near.lon - dLon).toFixed(5)}&max=${(near.lat + dLat).toFixed(5)},${(near.lon + dLon).toFixed(5)}`;
    const data = await fetchJSON(`${TRANSITOUS}/map/stops?${bbox}&limit=300`, {}, fetcher, 15000);
    const seen = new Set(), out = [];
    for (const raw of Array.isArray(data) ? data : []) {
      const s = stationShape(raw);
      if (!usable(s)) continue;
      const key = String(raw.parentId || raw.stopId || raw.id || s.name).replace(/::\d+$/, '');
      if (seen.has(key)) continue;
      const distance = distanceM(near, s);
      if (distance > ring) continue;
      seen.add(key);
      out.push({ ...s, distance });
    }
    const found = out.filter((s) => fitsMode(s, want)).sort((a, b) => a.distance - b.distance).slice(0, max);
    if (found.length) return found;
  }
  return [];
}

/* Hotels, apartments and street addresses are not stops: search them as places so a journey can start at the
   door, walk to the nearest station and continue by train. Used only when no stop name matches. */
export async function findPlaces({ q, near, mode = '', limit = 4, fetcher = fetch } = {}) {
  const max = Math.min(5, Math.max(1, Number(limit) || 4));
  if (q && String(q).trim().length >= 2) {
    const text = String(q).trim().slice(0, 120);
    const data = await fetchJSON(`${TRANSITOUS}/geocode?text=${encodeURIComponent(text)}&limit=${max * 3}`, {}, fetcher, 15000);
    const seen = new Set();
    return (Array.isArray(data) ? data : []).map((p) => ({
      id: String(p.id || ''), name: String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      lat: Number(p.lat), lon: Number(p.lon), country: String(p.country || '').toUpperCase().slice(0, 2),
      tz: validTz(p.tz) ? p.tz : '', modes: [], kind: String(p.type || 'PLACE').toLowerCase(), distance: null
    })).filter((p) => usable(p) && p.kind !== 'stop' && !seen.has(p.name) && seen.add(p.name)).slice(0, max);
  }
  if (!near || !Number.isFinite(near.lat) || !Number.isFinite(near.lon)) return [];
  return findStations({ near, radius: 800, mode, limit: max, fetcher });
}

/* Rail-only or tram-only journeys: MOTIS is asked for the mode group, then any itinerary that does not
   actually use that mode is dropped (for example a replacement bus on a rail request). */
export async function planRail({ from, to, mode, time, arriveBy = false, fetcher = fetch, results = 5, requireBikes = false } = {}) {
  const list = await motisPlan(from, to, {
    fetcher, time, arriveBy, requireBikes, modes: [mode], numItineraries: Math.min(8, Math.max(2, results + 3)), maxTransfers: 3
  });
  return list.filter((i) => i.legs.some((l) => l.kind === mode && !(l.cancelled))).slice(0, Math.max(1, results));
}

const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

/* Live departure board for one station: only what the feed reports, including cancellations and delays. */
export async function stopBoard(stopId, { fetcher = fetch, n = 10, mode = '', now = Date.now() } = {}) {
  const data = await fetchJSON(`${TRANSITOUS}/stoptimes?stopId=${encodeURIComponent(stopId)}&n=${Math.min(30, Math.max(3, Number(n) || 10))}`, {}, fetcher, 15000);
  const departures = (data?.stopTimes || []).map((t) => {
    const p = t.place || {};
    const when = Date.parse(p.departure || p.scheduledDeparture || '');
    const planned = Date.parse(p.scheduledDeparture || p.departure || '');
    const cancelled = !!(t.cancelled || t.tripCancelled || p.cancelled);
    const delay = Number.isFinite(when) && Number.isFinite(planned) ? Math.round((when - planned) / 60000) : 0;
    return {
      line: String(t.routeShortName || t.displayName || '').slice(0, 40), direction: String(t.headsign || '').slice(0, 120),
      operator: String(t.agencyName || '').slice(0, 80), mode: modeOf(t.mode), platform: String(p.track || '').slice(0, 12),
      expected: iso(when), minutes: Number.isFinite(when) ? Math.max(0, Math.round((when - now) / 60000)) : NaN,
      realtime: !!t.realTime, cancelled, delay
    };
  }).filter((d) => Number.isFinite(d.minutes) && (!mode || d.mode === mode)).sort((a, b) => a.minutes - b.minutes).slice(0, 12);
  const place = data?.place || {};
  return { stop: { id: stopId, name: String(place.name || '').slice(0, 120), tz: validTz(place.tz) ? place.tz : '' }, departures };
}
