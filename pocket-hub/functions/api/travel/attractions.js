/* GET /api/travel/attractions?lat=&lon= -> {attractions:[{name,kind,lat,lon,distance}]}
   Notable sights near a destination (geotagged English Wikipedia articles about museums, monuments, parks…), used for hotel distances. */
import { json, fetchJSON, distanceM, cached, point } from '../../_lib/travel.js';

const WIKI = 'https://en.wikipedia.org/w/api.php';
const SIGHT = /\b(museum|gallery|monument|memorial|square|park|palace|cathedral|abbey|basilica|mosque|temple|shrine|tower|bridge|castle|fort(ress)?|zoo|aquarium|gardens?|landmark|viewpoint|theme park|stadium|opera|theatre|market|beach|lighthouse|statue|column|arch|fountain|wheel|observation deck|skyscraper|pier|harbour|observatory|cemetery|ruins?)\b/i;
export const shapeAttractions = (pages, p) => {
  const seen = new Set();
  return (pages || []).map((x) => ({ name: String(x.title || '').slice(0, 80), kind: (SIGHT.exec(x.description || '')?.[0] || 'attraction').toLowerCase(),
    lat: Number(x.coordinates?.[0]?.lat), lon: Number(x.coordinates?.[0]?.lon), sight: SIGHT.test(x.description || '') }))
    .filter((a) => a.name && a.sight && Number.isFinite(a.lat) && Number.isFinite(a.lon) && !seen.has(a.name) && seen.add(a.name))
    .map(({ sight, ...a }) => ({ ...a, distance: distanceM(p, a) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 12);
};

export async function onRequestGet({ request }, fetcher = fetch) {
  const u = new URL(request.url).searchParams, p = point(`${u.get('lat')},${u.get('lon')}`);
  if (!p) return json({ error: 'Destination is required' }, 400);
  const c = { lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3) };
  try {
    const attractions = await cached(`attractions-wiki-${c.lat},${c.lon}`, 86400, async () => {
      const d = await fetchJSON(`${WIKI}?action=query&format=json&generator=geosearch&ggscoord=${c.lat}%7C${c.lon}&ggsradius=10000&ggslimit=100&prop=coordinates%7Cdescription&colimit=max`, {}, fetcher, 10000);
      return shapeAttractions(Object.values(d?.query?.pages || {}), c);
    });
    return json({ attractions, source: 'Attractions: Wikipedia (CC BY-SA)' }, 200, 86400);
  } catch {
    return json({ attractions: [], error: 'Nearby attractions are temporarily unavailable.' }, 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
