/* GET /api/travel/flights?from=LHR&to=CAN&depart=YYYY-MM-DD[&return=YYYY-MM-DD]&adults=1&children=0&infants=0&cabin=economy&currency=GBP
   Multi-city: legs=LHR:CDG:2026-12-10,CDG:FCO:2026-12-14 (2-6 flights) instead of from/to/depart/return.
   Airline offers from Duffel (DUFFEL_ACCESS_TOKEN) or Nuitee/LiteAPI flights (LITEAPI_KEY). Without either: {configured:false}.
   testMode=true while LITEAPI_KEY is a sandbox key (non-production fares). */
import { json, iata, isDate, clampInt, duffelFlights, nuiteeFlights, isSandboxKey } from '../../_lib/travel.js';

const CABINS = ['economy', 'premium_economy', 'business', 'first'];
export async function onRequestGet({ request, env }, fetcher = fetch) {
  const u = new URL(request.url).searchParams;
  const legsParam = String(u.get('legs') || '').split(',').filter(Boolean).slice(0, 6).map((x) => { const [from, to, date] = x.split(':'); return { from: iata(from), to: iata(to), date }; });
  const q = { from: iata(u.get('from')), to: iata(u.get('to')), depart: u.get('depart'), ret: u.get('return') || '', adults: clampInt(u.get('adults'), 1, 9, 1),
    children: clampInt(u.get('children'), 0, 8, 0), infants: clampInt(u.get('infants'), 0, 4, 0), cabin: CABINS.includes(u.get('cabin')) ? u.get('cabin') : 'economy',
    currency: /^[A-Z]{3}$/.test(u.get('currency') || '') ? u.get('currency') : 'GBP' };
  q.infants = Math.min(q.infants, q.adults);
  if (legsParam.length) {
    if (legsParam.length < 2 || legsParam.some((l) => !l.from || !l.to || !isDate(l.date))) return json({ error: 'Each multi-city flight needs a from airport, a to airport and a date' }, 400);
    if (legsParam.some((l, i) => i && l.date < legsParam[i - 1].date)) return json({ error: 'Multi-city dates must be in order' }, 400);
    Object.assign(q, { trip: 'multi', legs: legsParam, from: legsParam[0].from, to: legsParam[0].to, depart: legsParam[0].date, ret: '' });
  } else {
    if (!q.from || !q.to) return json({ error: 'Choose departure and destination airports' }, 400);
    if (!isDate(q.depart) || (q.ret && (!isDate(q.ret) || q.ret < q.depart))) return json({ error: 'Choose valid travel dates' }, 400);
    q.trip = q.ret ? 'return' : 'oneway';
    q.legs = [{ from: q.from, to: q.to, date: q.depart }, ...(q.ret ? [{ from: q.to, to: q.from, date: q.ret }] : [])];
  }
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
