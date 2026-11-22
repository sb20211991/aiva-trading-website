/* GET /api/emergency/geocode?q=<place>  or  ?lat=&lon=  -> {lat, lon, label, countryCode}
   OpenStreetMap Nominatim (server-side, identified User-Agent, edge-cached to respect its usage policy). */
import { NOMINATIM, json, coords, fetchJSON, cached } from '../../_lib/emergency.js';

const shape = r => r && Number.isFinite(Number(r.lat)) ? {
  lat: Number(r.lat), lon: Number(r.lon), label: String(r.display_name || '').split(',').slice(0, 4).join(',').trim(),
  countryCode: String(r.address?.country_code || '').toLowerCase()
} : null;

export async function onRequestGet({ request }, fetcher = fetch) {
  const url = new URL(request.url), q = (url.searchParams.get('q') || '').trim().slice(0, 160), pos = coords(url);
  if (!q && !pos) return json({ error: 'Enter a place or share your location' }, 400);
  try {
    const result = await cached(q ? 'geo-q-' + encodeURIComponent(q.toLowerCase()) : `geo-r-${pos.lat},${pos.lon}`, 86400, async () => {
      if (q) {
        const list = await fetchJSON(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`, {}, fetcher);
        return shape(list?.[0]);
      }
      const r = await fetchJSON(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=16&lat=${pos.lat}&lon=${pos.lon}`, {}, fetcher);
      return shape(r) || { ...pos, label: `${pos.lat}, ${pos.lon}`, countryCode: '' };
    });
    if (!result) return json({ error: 'Place not found. Try a town, street or postcode.' }, 404);
    return json({ ...result, source: 'OpenStreetMap Nominatim' }, 200, 3600);
  } catch { return json({ error: 'Location service is unavailable. Please try again.' }, 502); }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
