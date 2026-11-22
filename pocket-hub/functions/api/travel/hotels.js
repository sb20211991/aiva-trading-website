/* GET /api/travel/hotels?lat=&lon=&checkin=&checkout=&adults=&currency=
   LiteAPI live rates and photos when LITEAPI_KEY is set; otherwise real hotels from OpenStreetMap without prices. */
import { json, point, isDate, clampInt, liteHotels, osmHotels, isSandboxKey } from '../../_lib/travel.js';

export async function onRequestGet({ request, env }, fetcher = fetch) {
  const u = new URL(request.url).searchParams, p = point(`${u.get('lat')},${u.get('lon')}`);
  if (!p) return json({ error: 'Destination is required' }, 400);
  const q = { ...p, checkin: u.get('checkin'), checkout: u.get('checkout'), adults: clampInt(u.get('adults'), 1, 9, 1),
    currency: /^[A-Z]{3}$/.test(u.get('currency') || '') ? u.get('currency') : 'GBP' };
  const dated = isDate(q.checkin) && isDate(q.checkout) && q.checkout > q.checkin;
  const errors = [];
  if (env?.LITEAPI_KEY && dated) {
    try {
      const hotels = await liteHotels(q, env, fetcher);
      if (hotels.length) return json({ priced: true, hotels, provider: 'LiteAPI', testMode: isSandboxKey(env.LITEAPI_KEY), source: 'Hotel rates and photos by LiteAPI (Nuitee)', retrieved: new Date().toISOString() });
    } catch (e) { errors.push('liteapi-' + (e.status || 'error')); }
  }
  try {
    const hotels = await osmHotels(p, fetcher);
    return json({ priced: false, hotels, provider: 'OpenStreetMap', upstreamErrors: errors, source: 'Hotels © OpenStreetMap contributors; photos Wikimedia Commons',
      note: env?.LITEAPI_KEY ? 'Live room prices are temporarily unavailable.' : 'Live room prices are not connected yet (LiteAPI key missing).' }, 200, 1800);
  } catch { return json({ error: 'Hotel search is temporarily unavailable. Please try again.' }, 503); }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
