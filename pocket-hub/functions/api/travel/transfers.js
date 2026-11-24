/* GET /api/travel/transfers?from=<lat,lon airport>&to=<lat,lon hotel or city centre>&time=<ISO, airport-local if no offset>&tz=<IANA zone>&cc=<country>&day=YYYY-MM-DD
   Airport-to-destination options: public transport with schedules (Google Routes API with GOOGLE_MAPS_API_KEY, or keyless Entur /
   opendata.ch in Norway and Switzerland) split into train, metro, tram and bus, the last evening departure and night service,
   taxi / car-hire / ride-hailing driving time, walking with directions, plus stations, taxi ranks and car-hire desks at the airport (OpenStreetMap). */
import { json, point, localToUTC, googleRoutes, osrm, airportServices, cached } from '../../_lib/travel.js';
import { openTransit, transitZone, lateSummary } from '../../_lib/transit.js';
import { rideHailing } from '../../_lib/rides.js';
import { transportLinks } from '../../_lib/transport-links.js';

/* Open transport feeds publish a few weeks ahead at most, so "no journey" a long way out is a data horizon, not a missing
   route or an outage. Say which one it is instead of leaving the traveller guessing. */
export function timetableNote(errors, timetabled, time) {
  if (timetabled) return '';
  const farAhead = !!time && Date.parse(time) - Date.now() > 14 * 864e5;
  const noJourney = (errors || []).some((e) => /-no-journey$/.test(e));
  return farAhead && noJourney
    ? 'Live timetables are not published this far ahead yet: open transport feeds usually cover the next few weeks, so train, metro, tram and bus times appear closer to the date. Driving, taxi, ride-hailing and walking times are live.'
    : 'Live public transport timetables are unavailable for this route.';
}

const PUBLIC = ['train', 'metro', 'tram', 'bus'];
const AIRPORT_STATION = /airport|flughafen|a[ée]roport|aeroporto|aeropuerto|lufthavn|flygplats|lentoasema|lotnisko|luchthaven|havaliman/i;
const dayAt = (day, hm, tz, lon) => localToUTC(`${day}T${hm}:00`, tz, lon);

export async function onRequestGet({ request, env }, fetcher = fetch) {
  const u = new URL(request.url).searchParams, from = point(u.get('from')), to = point(u.get('to'));
  if (!from || !to) return json({ error: 'Airport and destination locations are required' }, 400);
  const utc = localToUTC(u.get('time'), u.get('tz'), from.lon), time = utc && Date.parse(utc) > Date.now() ? utc : undefined;
  const tz = u.get('tz') || transitZone(from, to), cc = String(u.get('cc') || '').toLowerCase().slice(0, 2);
  const today = new Date().toISOString().slice(0, 10), day = /^\d{4}-\d{2}-\d{2}$/.test(u.get('day') || '') && u.get('day') >= today ? u.get('day') : (u.get('time') || '').slice(0, 10) >= today ? u.get('time').slice(0, 10) : today;
  const errors = [], google = !!env?.GOOGLE_MAPS_API_KEY, soft = (tag) => (e) => { errors.push(`${tag}-${e.status || 'error'}`); return null; };
  let lateDay = day, lateAt = dayAt(day, '22:00', tz, from.lon);
  if (lateAt && Date.parse(lateAt) <= Date.now()) { lateDay = new Date(Date.parse(day) + 864e5).toISOString().slice(0, 10); lateAt = dayAt(lateDay, '22:00', tz, from.lon); }
  const lateTime = lateAt || undefined;
  const servicesP = cached(`airport-services-v1/${from.lat.toFixed(3)},${from.lon.toFixed(3)}`, 86400, async () => {
    const r = await airportServices(from, fetcher);
    if (!Object.values(r).some((x) => x.length)) throw Object.assign(new Error('No airport services found'), { status: 'empty' });
    return r;
  }).catch(soft('osm'));
  /* Wait at most 6 s for the (usually edge-cached) station lookup before routing, so a slow Overpass miss cannot stall the reply. */
  const early = await Promise.race([servicesP, new Promise((r) => setTimeout(r, 6000))]);
  /* Plan public transport from the airport's own station when OpenStreetMap has one: airport centroids can sit nearer another town's stop. */
  const hub = (early?.stations || []).find((x) => AIRPORT_STATION.test(x.name) && x.distance <= 2500 && Number.isFinite(x.lat));
  const start = hub ? { lat: hub.lat, lon: hub.lon } : from;
  const [transit, late, drive, walk] = await Promise.all([
    google ? googleRoutes(start, to, 'TRANSIT', env, fetcher, time).catch(soft('google-transit')) : openTransit(start, to, fetcher, time).catch(soft('open-transit')),
    google ? (lateTime ? googleRoutes(start, to, 'TRANSIT', env, fetcher, lateTime).catch(soft('google-late')) : null) : openTransit(start, to, fetcher, lateTime, true).catch(soft('open-late')),
    (google ? googleRoutes(from, to, 'DRIVE', env, fetcher).then((r) => r[0] || null) : osrm(from, to, 'car', fetcher)).catch(soft('drive')),
    osrm(from, to, 'foot', fetcher, true).catch(soft('walk'))
  ]);
  const services = await servicesP;
  const list = (x) => ((google ? x : x?.routes) || []).filter((r) => r.steps.some((st) => st.kind !== 'walk'));
  const routes = list(transit).slice(0, 5), lateBy = lateSummary(list(late));
  const open = !google && routes.length ? transit.provider : '', timetabled = google || !!open;
  const s = services || { stations: [], busStations: [], carRental: [], taxiRanks: [] };
  const modes = {};
  for (const k of PUBLIC) {
    const rs = routes.filter((r) => r.steps.some((x) => x.kind === k));
    const places = k === 'bus' ? s.busStations : k === 'train' || k === 'metro' || k === 'tram' ? s.stations : [];
    modes[k] = { available: rs.length ? true : timetabled ? false : null, routes: rs, places, late: lateBy[k] || null };
  }
  Object.assign(modes, {
    taxi: { available: drive ? true : null, minutes: drive?.minutes ?? null, distance: drive?.distance ?? null, places: s.taxiRanks },
    car: { available: s.carRental.length || drive ? true : null, minutes: drive?.minutes ?? null, distance: drive?.distance ?? null, places: s.carRental },
    walk: { available: walk ? walk.distance <= 6000 : null, minutes: walk?.minutes ?? null, distance: walk?.distance ?? null, steps: walk && walk.distance <= 6000 ? walk.steps || [] : [] },
    ride: { available: drive ? (rideHailing(cc).length ? true : null) : null, minutes: drive?.minutes ?? null, distance: drive?.distance ?? null, services: rideHailing(cc) }
  });
  const links = transportLinks(cc, from, to, { from: (u.get('fromName') || '').slice(0, 80), to: (u.get('toName') || '').slice(0, 80) }, rideHailing(cc));
  for (const k of Object.keys(links)) if (modes[k]) Object.assign(modes[k], links[k]);
  const sources = [google ? 'Google Maps · Walking routes: FOSSGIS OSRM' : 'Road and walking routes: FOSSGIS OSRM (routing.openstreetmap.de)',
    ...(open ? [`Train, metro, tram and bus timetables: ${open === 'Entur' ? 'Entur (Norway)' : open === 'Transitous' ? 'Transitous (MOTIS) · open GTFS/GTFS-RT feeds' : 'transport.opendata.ch (Switzerland)'}`] : []),
    'Stations, taxi ranks and car hire: © OpenStreetMap contributors'];
  return json({ modes, schedules: timetabled, lateChecked: !!(late && lateTime), lateDay, transitFrom: hub?.name || '', upstreamErrors: errors, source: sources.join(' · '), retrieved: new Date().toISOString(),
    note: timetableNote(errors, timetabled, time) });
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
