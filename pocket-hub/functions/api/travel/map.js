/* GET /api/travel/map?lat=&lon=&from=<lat,lon>&to=<lat,lon>  -> redirect used as an in-app <iframe> source.
   Google Maps Embed API when GOOGLE_MAPS_EMBED_KEY is set (place or directions view); otherwise the OpenStreetMap embed. */
import { json, point } from '../../_lib/travel.js';

export function onRequestGet({ request, env }) {
  const u = new URL(request.url).searchParams, p = point(`${u.get('lat')},${u.get('lon')}`), a = point(u.get('from')), b = point(u.get('to'));
  if (!p && !(a && b)) return json({ error: 'Location is required' }, 400);
  const key = env?.GOOGLE_MAPS_EMBED_KEY;
  let target;
  if (key) {
    target = a && b ? `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&mode=${u.get('mode') === 'transit' ? 'transit' : 'driving'}`
      : `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(key)}&center=${p.lat},${p.lon}&zoom=12`;
  } else {
    const pts = a && b ? [a, b] : [p], pad = a && b ? 0.02 : 0.06;
    const lats = pts.map((x) => x.lat), lons = pts.map((x) => x.lon), m = b || p;
    target = `https://www.openstreetmap.org/export/embed.html?bbox=${Math.min(...lons) - pad},${Math.min(...lats) - pad},${Math.max(...lons) + pad},${Math.max(...lats) + pad}&layer=mapnik&marker=${m.lat},${m.lon}`;
  }
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
