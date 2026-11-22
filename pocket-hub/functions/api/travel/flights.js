/* GET /api/travel/flights?from=LHR&to=CAN&depart=YYYY-MM-DD&return=YYYY-MM-DD&adults=1&currency=GBP
   Airline offers from Duffel (DUFFEL_ACCESS_TOKEN) or Nuitee/LiteAPI flights (LITEAPI_KEY). Without either: {configured:false}.
   testMode=true while LITEAPI_KEY is a sandbox key (non-production fares). */
import { json, iata, isDate, clampInt, duffelFlights, nuiteeFlights, isSandboxKey } from '../../_lib/travel.js';

export async function onRequestGet({ request, env }, fetcher = fetch) {
  const u = new URL(request.url).searchParams;
  const q = { from: iata(u.get('from')), to: iata(u.get('to')), depart: u.get('depart'), ret: u.get('return') || '', adults: clampInt(u.get('adults'), 1, 9, 1),
    currency: /^[A-Z]{3}$/.test(u.get('currency') || '') ? u.get('currency') : 'GBP' };
  if (!q.from || !q.to) return json({ error: 'Choose departure and destination airports' }, 400);
  if (!isDate(q.depart) || (q.ret && (!isDate(q.ret) || q.ret < q.depart))) return json({ error: 'Choose valid travel dates' }, 400);
  const duffel = !!env?.DUFFEL_ACCESS_TOKEN, nuitee = !duffel && !!env?.LITEAPI_KEY;
  if (!duffel && !nuitee) return json({ configured: false, offers: [], provider: 'Nuitee', error: 'Live flight fares are not connected yet (flight provider key missing).' });
  const meta = duffel ? { provider: 'Duffel', source: 'Flight offers by Duffel — prices direct from airlines', testMode: false }
    : { provider: 'Nuitee', source: 'Flight offers by Nuitee (LiteAPI)', testMode: isSandboxKey(env.LITEAPI_KEY) };
  try {
    const r = await (duffel ? duffelFlights : nuiteeFlights)(q, env, fetcher);
    return json({ configured: true, ...r, query: q, ...meta, retrieved: new Date().toISOString() });
  } catch (e) {
    const none = e.status === 422 || e.status === 400 || e.status === 404;
    return json({ configured: true, offers: [], ...meta, upstreamErrors: [`${meta.provider.toLowerCase()}-${e.status || 'error'}`],
      error: none ? 'No flights found for this route and date.' : 'Flight search is temporarily unavailable. Please try again.' }, none ? 200 : 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
