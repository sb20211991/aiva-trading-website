/* Journeys between two places from Transitous, a public MOTIS instance that aggregates open GTFS and
   GTFS-realtime feeds (Germany/DELFI, Switzerland, Netherlands, Belgium, France, Italy, Spain, Nordics,
   Great Britain, Poland, Czechia and more). Keyless and official-friendly.
   Everything returned here comes from those feeds: real departure and arrival times, real-time delays,
   platforms, agencies and walking legs. No fare is invented — MOTIS does not publish ticket prices. */
import { fetchJSON, validTz } from './emergency.js';

export const TRANSITOUS = 'https://api.transitous.org/api/v1';

/* Aiva mode names -> MOTIS transit modes. WALK is not a transit mode: it is used for access/egress legs. */
export const GROUPS = {
  train: ['RAIL', 'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN'],
  metro: ['SUBWAY'],
  tram: ['TRAM'],
  bus: ['BUS', 'COACH'],
  ferry: ['FERRY']
};
export const ALL_MODES = [...GROUPS.train, ...GROUPS.metro, ...GROUPS.tram, ...GROUPS.bus, ...GROUPS.ferry];

const KIND = {
  BUS: 'bus', COACH: 'bus', TROLLEYBUS: 'bus', RAIL_REPLACEMENT_BUS: 'bus', TRAM: 'tram', SUBWAY: 'metro', METRO: 'metro',
  FUNICULAR: 'train', CABLE_CAR: 'train', AERIAL_LIFT: 'train', FERRY: 'ferry', AIRPLANE: 'flight',
  WALK: 'walk', BIKE: 'bike', RENTAL: 'bike', CAR: 'car'
};
export const kindOf = (m) => KIND[m] || (/RAIL|SUBURBAN/i.test(String(m || '')) ? 'train' : 'bus');

const name = (n) => (!n || n === 'START' ? 'Start' : n === 'END' ? 'Destination' : String(n));
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

/* Every MOTIS place carries its own IANA zone, so a cross-border train shows the real clock at each stop. */
export function clockIn(value, tz) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: validTz(tz) ? tz : 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date(t));
  } catch { return ''; }
}

export function normalise(itinerary) {
  const legs = (itinerary.legs || []).map((l) => {
    const a = l.from || {}, b = l.to || {}, walk = l.mode === 'WALK';
    const start = a.departure || l.startTime, end = b.arrival || l.endTime;
    return {
      kind: kindOf(l.mode), mode: String(l.mode || ''),
      line: walk ? '' : (l.routeShortName || l.routeLongName || ''),
      direction: walk ? '' : (l.headsign || ''),
      operator: l.agencyName || '',
      from: name(a.name), to: name(b.name),
      lat: Number.isFinite(a.lat) ? a.lat : null, lon: Number.isFinite(a.lon) ? a.lon : null,
      departs: iso(start), arrives: iso(end),
      departure: clockIn(start, a.tz), arrival: clockIn(end, b.tz),
      tzFrom: a.tz || '', tzTo: b.tz || '',
      platform: a.track || a.scheduledTrack || '', arrivalPlatform: b.track || b.scheduledTrack || '',
      minutes: Math.max(1, Math.round((l.duration || 0) / 60)),
      distance: walk ? Math.round(l.distance || 0) : null,
      stops: Array.isArray(l.intermediateStops) ? l.intermediateStops.length : null,
      realtime: !!l.realTime, cancelled: !!(l.cancelled || a.cancelled || b.cancelled),
      /* GTFS bikes_allowed: MOTIS sends true only when the operator publishes that bikes are allowed. false covers
         both "not allowed" and "no information", so it is never shown as a ban. */
      bikes: walk ? null : l.bikesAllowed === true
    };
  });
  const ride = legs.filter((l) => l.kind !== 'walk');
  return {
    id: itinerary.id || '',
    departs: iso(itinerary.startTime), arrives: iso(itinerary.endTime),
    minutes: Math.max(1, Math.round((itinerary.duration || 0) / 60)),
    transfers: Number.isFinite(itinerary.transfers) ? itinerary.transfers : Math.max(0, ride.length - 1),
    modes: [...new Set(ride.map((l) => l.kind))],
    realtime: legs.some((l) => l.realtime),
    cancelled: legs.some((l) => l.cancelled),
    legs
  };
}

export async function motisPlan(from, to, { fetcher = fetch, time, arriveBy = false, modes = [], numItineraries = 5, maxTransfers = 4, directOnly = false, requireBikes = false } = {}) {
  const transit = directOnly ? [] : modes.length ? [...new Set(modes.flatMap((m) => GROUPS[m] || []))] : ALL_MODES;
  const q = new URLSearchParams({
    fromPlace: `${from.lat},${from.lon}`, toPlace: `${to.lat},${to.lon}`,
    numItineraries: String(Math.min(8, Math.max(1, numItineraries))), maxTransfers: String(maxTransfers),
    arriveBy: arriveBy ? 'true' : 'false'
  });
  const t = Date.parse(time || '');
  if (requireBikes) q.set('requireBikeTransport', 'true');
  if (Number.isFinite(t)) q.set('time', new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'));
  if (transit.length) q.set('transitModes', transit.join(','));
  /* Walking-only request: an empty transitModes tells MOTIS to consider no transit at all, so the whole
     journey is walked. Without it MOTIS falls back to every mode and returns train/bus itineraries. */
  else { q.set('transitModes', ''); q.set('directModes', 'WALK'); }
  const data = await fetchJSON(`${TRANSITOUS}/plan?${q}`, {}, fetcher, 15000);
  if (data?.error) throw Object.assign(new Error(String(data.error).slice(0, 140)), { status: 'motis-error' });
  const raw = [...(data?.itineraries || []), ...(transit.length ? [] : data?.direct || [])];
  return raw.map(normalise).filter((i) => i.legs.length).sort((a, b) => Date.parse(a.departs) - Date.parse(b.departs));
}

/* Route shape used by the airport-transfer comparison (train / metro / tram / bus / walk). */
export function asRoutes(itineraries) {
  return itineraries
    .filter((i) => i.legs.some((l) => l.kind !== 'walk'))
    .map((i) => ({
      minutes: i.minutes,
      distance: i.legs.reduce((n, l) => n + (l.distance || 0), 0),
      fare: null,
      steps: i.legs
        .filter((l) => l.kind !== 'walk' || l.minutes >= 2)
        .map((l) => ({
          kind: l.kind === 'walk' ? 'walk' : l.kind,
          line: l.kind === 'walk' ? `Walk ${l.minutes} min` : (l.line || l.operator || l.kind),
          operator: l.kind === 'walk' ? '' : l.operator,
          headsign: l.direction, from: l.from, to: l.to,
          departs: l.departure, arrives: l.arrival, stops: l.stops || 0
        }))
    }));
}

/* Airport / city transfer planning for every country with an open feed. Throws when nothing is found,
   so the caller can fall back to "timetables not available here" instead of claiming a route does not exist. */
export async function motisJourneys(from, to, { fetcher = fetch, time, late = false, numItineraries = 4 } = {}) {
  const list = await motisPlan(from, to, { fetcher, time, numItineraries: late ? 6 : numItineraries, maxTransfers: late ? 4 : 3 });
  const routes = asRoutes(list);
  if (!routes.length) throw Object.assign(new Error('No journey found'), { status: 'no-journey' });
  return { provider: 'Transitous', routes };
}
