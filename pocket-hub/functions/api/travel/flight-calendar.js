/* GET /api/travel/flight-calendar?from=LHR&to=DUB&dates=2027-01-01,2027-01-02,...(max 7)[&stay=7]&adults=1&children=0&infants=0
       &cabin=economy&currency=GBP[&fresh=1]
   Daily prices for the Aiva six-month price calendar. Every price is the cheapest REAL offer the connected flight
   provider (Nuitee/LiteAPI or Duffel, as /api/travel/flights) returned for that day; nothing is estimated or invented.
   stay=N prices a round trip returning N days later; without it the fare is one way.
   Each day is cached at the edge for up to 6 hours and returned with the time it was checked, so the app can say how
   fresh it is; fresh=1 re-checks. A day with no flights says so ("none"); a day that could not be checked says so
   ("unavailable"). The final fare is always re-verified by /api/travel/flight-book before payment. */
import { json, iata, isDate, clampInt, duffelFlights, nuiteeFlights, isSandboxKey } from '../../_lib/travel.js';

export const MAX_DAYS_AHEAD = 184, MAX_DATES = 7, TTL_S = 6 * 3600;
const CABINS = ['economy', 'premium_economy', 'business', 'first'];
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T12:00:00Z`) + n * 864e5));

export function calendarKey(q, date) {
  return `https://aiva-fare-calendar.cache/v1/${q.from}-${q.to}/${date}/${q.stay || 0}/${q.adults}-${q.children}-${q.infants}/${q.cabin}/${q.currency}`;
}
/* Cheapest offer of a search reply, reduced to what a calendar day shows. */
export function dayFromOffers(date, offers, provider, now = new Date()) {
  const ok = (offers || []).filter((o) => Number.isFinite(o.price) && o.price > 0).sort((a, b) => a.price - b.price);
  if (!ok.length) return { date, status: 'none', checkedAt: now.toISOString(), provider };
  const o = ok[0];
  return { date, status: 'live', price: Math.round(o.price * 100) / 100, currency: o.currency, airline: o.airline || '',
    stops: Math.max(0, ...(o.slices || []).map((s) => +s.stops || 0)), checkedAt: now.toISOString(), provider };
}
export async function remember(q, day, context) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (!cache || day.status === 'unavailable') return;
  const put = cache.put(new Request(calendarKey(q, day.date)), new Response(JSON.stringify(day), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL_S}` } })).catch(() => {});
  if (typeof context?.waitUntil === 'function') context.waitUntil(put); else await put;
}

export async function onRequestGet(context, fetcher = fetch) {
  const { request, env = {} } = context;
  const u = new URL(request.url).searchParams;
  const q = { from: iata(u.get('from')), to: iata(u.get('to')), stay: clampInt(u.get('stay'), 0, 60, 0), adults: clampInt(u.get('adults'), 1, 9, 1),
    children: clampInt(u.get('children'), 0, 8, 0), infants: clampInt(u.get('infants'), 0, 4, 0),
    cabin: CABINS.includes(u.get('cabin')) ? u.get('cabin') : 'economy', currency: /^[A-Z]{3}$/.test(u.get('currency') || '') ? u.get('currency') : 'GBP' };
  q.infants = Math.min(q.infants, q.adults);
  if (!q.from || !q.to || q.from === q.to) return json({ error: 'Choose departure and destination airports' }, 400);
  const today = iso(new Date()), last = addDays(today, MAX_DAYS_AHEAD);
  const dates = [...new Set(String(u.get('dates') || '').split(',').filter(isDate))].slice(0, MAX_DATES);
  if (!dates.length) return json({ error: 'Choose the dates to price' }, 400);
  const duffel = !!env.DUFFEL_ACCESS_TOKEN, nuitee = !duffel && !!env.LITEAPI_KEY;
  if (!duffel && !nuitee) return json({ configured: false, days: [], error: 'Live flight fares are not connected yet.' });
  const provider = duffel ? 'Duffel' : 'Nuitee', search = duffel ? duffelFlights : nuiteeFlights;
  const fresh = u.get('fresh') === '1';
  const cache = typeof caches !== 'undefined' ? caches.default : null;

  const days = await Promise.all(dates.map(async (date) => {
    if (date < today || date > last) return { date, status: 'outside', provider };
    if (cache && !fresh) {
      try { const hit = await cache.match(new Request(calendarKey(q, date))); if (hit) return { ...(await hit.json()), cached: true }; } catch {}
    }
    const legs = [{ from: q.from, to: q.to, date }, ...(q.stay ? [{ from: q.to, to: q.from, date: addDays(date, q.stay) }] : [])];
    try {
      const r = await search({ ...q, legs }, env, fetcher);
      const day = dayFromOffers(date, r.offers, provider);
      if (duffel || !isSandboxKey(env.LITEAPI_KEY)) await remember(q, day, context);
      return day;
    } catch (e) {
      const none = e.status === 422 || e.status === 400 || e.status === 404;
      const day = none ? { date, status: 'none', checkedAt: new Date().toISOString(), provider } : { date, status: 'unavailable', provider };
      if (none) await remember(q, day, context);
      return day;
    }
  }));
  return json({ configured: true, provider, testMode: !duffel && isSandboxKey(env.LITEAPI_KEY), currency: q.currency, trip: q.stay ? 'return' : 'oneway', stay: q.stay, days, firstDate: today, lastDate: last });
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
