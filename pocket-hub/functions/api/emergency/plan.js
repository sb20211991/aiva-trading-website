/* GET /api/emergency/plan?from=<lat,lon>&to=<lat,lon>&time=<ISO>&arriveBy=1&modes=train,bus&cc=<country>&tz=<IANA zone>
   Planned journeys between any two points from open GTFS/GTFS-realtime feeds (Transitous / MOTIS): every leg with
   its real departure and arrival time in the local clock at that stop, platform or track, operator, real-time
   flag, and walking legs with distance. Fares are not published by these feeds, so none is shown. */
import { json, cached, validTz, countryTz } from '../../_lib/emergency.js';
import { motisPlan, GROUPS } from '../../_lib/motis.js';
import { transportLinks } from '../../_lib/transport-links.js';
import { rideHailing } from '../../_lib/rides.js';

const SOURCE = 'Planned with Transitous (MOTIS) · open GTFS/GTFS-real-time feeds · © OpenStreetMap contributors';
const point = (v) => {
  const m = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(String(v || '').trim());
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};

export async function onRequestGet({ request }, fetcher = fetch) {
  const u = new URL(request.url).searchParams, from = point(u.get('from')), to = point(u.get('to'));
  if (!from || !to) return json({ error: 'Choose a starting point and a destination' }, 400);
  const requested = String(u.get('modes') || '').toLowerCase().split(',').map((m) => m.trim()).filter(Boolean);
  const modes = requested.filter((m) => GROUPS[m]);
  /* Walk-only: no transit mode is selected, so MOTIS walks the whole way instead of falling back to every mode. */
  const walkOnly = !modes.length && requested.includes('walk');
  const at = Date.parse(u.get('time') || '');
  const arriveBy = u.get('arriveBy') === '1' || u.get('arriveBy') === 'true';
  const cc = String(u.get('cc') || '').toLowerCase().slice(0, 2);
  const tz = validTz(u.get('tz')) ? u.get('tz') : countryTz(cc) || '';
  const key = `plan2-${from.lat},${from.lon}-${to.lat},${to.lon}-${Number.isFinite(at) ? at : 0}-${arriveBy ? 1 : 0}-${walkOnly ? 'walk' : modes.join('+') || 'all'}`;
  try {
    const itineraries = await cached(key, 20, () => motisPlan(from, to, {
      fetcher, time: Number.isFinite(at) ? new Date(at).toISOString() : undefined, arriveBy, modes, directOnly: walkOnly, numItineraries: 6
    }));
    const links = transportLinks(cc, from, to,
      { from: String(u.get('fromName') || '').slice(0, 80), to: String(u.get('toName') || '').slice(0, 80) }, rideHailing(cc));
    if (!itineraries.length) {
      return json({ provider: 'transitous', itineraries: [], links, timeZone: tz, source: SOURCE, retrieved: new Date().toISOString(),
        note: 'No journey was found for this route and time in the open timetable feeds. Try another time, or check the operator’s own site.' });
    }
    return json({ provider: 'transitous', live: itineraries.some((i) => i.realtime), timeZone: tz, itineraries, links, source: SOURCE,
      retrieved: new Date().toISOString(),
      note: 'Fares are not published by these open feeds: the operator shows the live price when you book.' }, 200, 20);
  } catch (e) {
    return json({ error: 'Journey planning is temporarily unavailable for this route.', upstream: e?.status || e?.name || 'error' }, 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
