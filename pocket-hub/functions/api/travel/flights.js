/* GET /api/travel/flights?from=LHR&to=CAN&depart=YYYY-MM-DD&return=YYYY-MM-DD&adults=1&currency=GBP
   Live airline offers from Duffel (prices, times, stops, durations). Without DUFFEL_ACCESS_TOKEN: {configured:false}. */
import { json, iata, isDate, clampInt, duffelFlights } from '../../_lib/travel.js';

export async function onRequestGet({ request, env }, fetcher = fetch) {
  const u = new URL(request.url).searchParams;
  const q = { from: iata(u.get('from')), to: iata(u.get('to')), depart: u.get('depart'), ret: u.get('return') || '', adults: clampInt(u.get('adults'), 1, 9, 1),
    currency: /^[A-Z]{3}$/.test(u.get('currency') || '') ? u.get('currency') : 'GBP' };
  if (!q.from || !q.to) return json({ error: 'Choose departure and destination airports' }, 400);
  if (!isDate(q.depart) || (q.ret && (!isDate(q.ret) || q.ret < q.depart))) return json({ error: 'Choose valid travel dates' }, 400);
  if (!env?.DUFFEL_ACCESS_TOKEN) return json({ configured: false, offers: [], provider: 'Duffel', error: 'Live flight fares are not connected yet (Duffel access token missing).' });
  try {
    const r = await duffelFlights(q, env, fetcher);
    return json({ configured: true, ...r, query: q, provider: 'Duffel', source: 'Flight offers by Duffel — prices direct from airlines', retrieved: new Date().toISOString() });
  } catch (e) {
    return json({ configured: true, offers: [], error: e.status === 422 ? 'No flights found for this route and date.' : 'Flight search is temporarily unavailable. Please try again.' }, e.status === 422 ? 200 : 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
