/* GET /api/travel/attractions?lat=&lon= -> {attractions:[{name,kind,lat,lon,distance}]}
   Notable sights (OpenStreetMap features with a Wikidata link) within 10 km of a destination, used for hotel distances. */
import { json, overpass, distanceM, cached, point } from '../../_lib/travel.js';

const KINDS = 'attraction|museum|gallery|viewpoint|zoo|theme_park|aquarium';
export const shapeAttractions = (els, p) => {
  const seen = new Set();
  return (els || []).map((e) => ({ name: String(e.tags?.['name:en'] || e.tags?.name || '').slice(0, 80), kind: e.tags?.tourism || 'attraction', famous: !!e.tags?.wikipedia,
    lat: Number(e.lat ?? e.center?.lat), lon: Number(e.lon ?? e.center?.lon) }))
    .filter((a) => a.name && Number.isFinite(a.lat) && Number.isFinite(a.lon) && !seen.has(a.name) && seen.add(a.name))
    .map((a) => ({ ...a, distance: distanceM(p, a) }))
    .sort((a, b) => (b.famous - a.famous) || a.distance - b.distance).slice(0, 12)
    .map(({ famous, ...a }) => a);
};

export async function onRequestGet({ request }, fetcher = fetch) {
  const u = new URL(request.url).searchParams, p = point(`${u.get('lat')},${u.get('lon')}`);
  if (!p) return json({ error: 'Destination is required' }, 400);
  const c = { lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3) };
  try {
    const attractions = await cached(`attractions-${c.lat},${c.lon}`, 86400, async () => shapeAttractions(await overpass(
      `[out:json][timeout:20];nwr["tourism"~"^(${KINDS})$"]["name"]["wikidata"](around:10000,${c.lat},${c.lon});out center tags 200;`, fetcher), c));
    return json({ attractions, source: 'Attractions © OpenStreetMap contributors' }, 200, 86400);
  } catch {
    return json({ attractions: [], error: 'Nearby attractions are temporarily unavailable.' }, 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
