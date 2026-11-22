/* GET /api/travel/transfers?from=<lat,lon airport>&to=<lat,lon hotel>&time=<ISO>
   Airport-to-hotel options: public transport with schedules (Google Routes API, GOOGLE_MAPS_API_KEY), taxi and car-hire
   driving time, walking, plus train/bus stations, taxi ranks and car-hire desks at the airport (OpenStreetMap). */
import { json, point, googleRoutes, osrm, airportServices } from '../../_lib/travel.js';

export async function onRequestGet({ request, env }, fetcher = fetch) {
  const u = new URL(request.url).searchParams, from = point(u.get('from')), to = point(u.get('to'));
  if (!from || !to) return json({ error: 'Airport and hotel locations are required' }, 400);
  const time = Date.parse(u.get('time') || '') > Date.now() ? new Date(u.get('time')).toISOString() : undefined;
  const errors = [], google = !!env?.GOOGLE_MAPS_API_KEY, soft = (tag) => (e) => { errors.push(`${tag}-${e.status || 'error'}`); return null; };
  const [transit, drive, walk, services] = await Promise.all([
    google ? googleRoutes(from, to, 'TRANSIT', env, fetcher, time).catch(soft('google-transit')) : null,
    (google ? googleRoutes(from, to, 'DRIVE', env, fetcher).then((r) => r[0] || null) : osrm(from, to, 'car', fetcher)).catch(soft('drive')),
    (google ? googleRoutes(from, to, 'WALK', env, fetcher).then((r) => r[0] || null) : osrm(from, to, 'foot', fetcher)).catch(soft('walk')),
    airportServices(from, fetcher).catch(soft('osm'))
  ]);
  const routes = (transit || []).filter((r) => r.steps.length).slice(0, 4);
  const has = (k) => routes.some((r) => r.steps.some((s) => s.kind === k));
  const s = services || { stations: [], busStations: [], carRental: [], taxiRanks: [] };
  const modes = {
    train: { available: has('train') || (!google && s.stations.length ? null : false), routes: routes.filter((r) => r.steps.some((x) => x.kind === 'train')), places: s.stations },
    bus: { available: has('bus') || (!google && s.busStations.length ? null : false), routes: routes.filter((r) => r.steps.some((x) => x.kind === 'bus') && !r.steps.some((x) => x.kind === 'train')), places: s.busStations },
    taxi: { available: drive ? true : null, minutes: drive?.minutes ?? null, distance: drive?.distance ?? null, places: s.taxiRanks },
    car: { available: s.carRental.length ? true : null, minutes: drive?.minutes ?? null, distance: drive?.distance ?? null, places: s.carRental },
    walk: { available: walk ? walk.distance <= 6000 : null, minutes: walk?.minutes ?? null, distance: walk?.distance ?? null }
  };
  const sources = [google ? 'Routes and schedules: Google Maps Platform' : 'Road and walking routes: FOSSGIS OSRM (routing.openstreetmap.de)', 'Stations, taxi ranks and car hire: © OpenStreetMap contributors'];
  return json({ modes, schedules: google, upstreamErrors: errors, source: sources.join(' · '), retrieved: new Date().toISOString(),
    note: google ? '' : 'Live train and bus timetables between airport and hotel need the Google Routes connection; stations at the airport are listed below.' });
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
