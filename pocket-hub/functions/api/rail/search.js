/* GET /api/rail/search?from=<lat,lon>&to=<lat,lon>&fromName=&toName=&mode=train|tram&time=<ISO>&arriveBy=1&pax=1
   Live train or tram journeys between any two points, with nearby stations at both ends, real platforms,
   real-time delays and cancellations, and fares only when an authorised distributor is connected.
   Open feeds publish a few weeks ahead; an empty result says so instead of guessing a route or a price. */
import { json, cached } from '../../_lib/emergency.js';
import { planRail, findStations, SOURCE } from '../../_lib/rail.js';
import { salesStatus, quoteFares } from '../../_lib/rail-sales.js';

const point = (v) => {
  const m = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(String(v || '').trim());
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};
const name = (v) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);

export async function onRequestGet({ request, env }, fetcher = fetch) {
  const u = new URL(request.url).searchParams;
  const from = point(u.get('from')), to = point(u.get('to'));
  if (!from || !to) return json({ error: 'Choose a starting point and a destination.' }, 400);
  if (Math.abs(from.lat - to.lat) < 1e-5 && Math.abs(from.lon - to.lon) < 1e-5) return json({ error: 'Starting point and destination are the same.' }, 400);
  const mode = u.get('mode') === 'tram' ? 'tram' : 'train';
  const arriveBy = u.get('arriveBy') === '1' || u.get('arriveBy') === 'true';
  const pax = Math.min(9, Math.max(1, Number(u.get('pax')) || 1));
  const at = Date.parse(u.get('time') || '');
  const time = Number.isFinite(at) ? new Date(at).toISOString() : new Date(Date.now() + 30 * 60000).toISOString();
  const fromName = name(u.get('fromName')), toName = name(u.get('toName'));
  const key = `rail-${mode}-${from.lat},${from.lon}-${to.lat},${to.lon}-${time}-${arriveBy ? 1 : 0}-${pax}`;
  try {
    const result = await cached(key, 20, async () => {
      const itineraries = await planRail({ from, to, mode, time, arriveBy, fetcher, results: 6 });
      /* Nearby stations make it obvious where the journey actually starts and ends. A station lookup failure
         must never blank the journey itself. */
      const [fromStations, toStations] = await Promise.all([
        findStations({ near: from, radius: mode === 'tram' ? 4000 : 5000, mode, limit: 4, fetcher }).catch(() => []),
        findStations({ near: to, radius: mode === 'tram' ? 4000 : 5000, mode, limit: 4, fetcher }).catch(() => [])
      ]);
      const sales = salesStatus(env);
      let fares = [], fareError = '';
      if (sales.available && itineraries.length) {
        try {
          fares = await quoteFares(env, { mode, from: fromName || 'Origin', to: toName || 'Destination', depart: time, passengers: pax,
            itineraries: itineraries.map((i) => i.id) }, fetcher);
        } catch (e) { fareError = e.message || 'Fares are temporarily unavailable.'; }
      }
      return { mode, provider: 'transitous', itineraries, stations: { from: fromStations, to: toStations },
        sales: { ...sales, fares, fareError }, timeZone: fromStations[0]?.tz || '', source: SOURCE, retrieved: new Date().toISOString(),
        note: itineraries.length ? '' : `No ${mode} journey was found for this route at this time in the open timetable feeds. Open feeds usually cover the next few weeks, so try a closer date. Nothing is estimated.` };
    });
    return json({ ...result, live: result.itineraries.some((i) => i.realtime) }, 200, 20);
  } catch (e) {
    return json({ error: `${mode === 'tram' ? 'Tram' : 'Train'} search is temporarily unavailable for this route.`, upstream: e?.status || e?.name || 'error' }, 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
