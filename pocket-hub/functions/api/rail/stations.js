/* GET /api/rail/stations?q=<station, hotel or address>&mode=train|tram&limit=6
   GET /api/rail/stations?lat=&lon=&radius=3000&mode=train|tram
   Stations by name, or the nearest stations to a point (current location, apartment, hotel or any address).
   Addresses and hotels are returned as places so a journey can start at the door; no station is invented. */
import { json } from '../../_lib/emergency.js';
import { findStations, findPlaces, SOURCE } from '../../_lib/rail.js';

export async function onRequestGet({ request }, fetcher = fetch) {
  const u = new URL(request.url).searchParams;
  const mode = u.get('mode') === 'tram' ? 'tram' : u.get('mode') === 'train' ? 'train' : '';
  const q = String(u.get('q') || '').trim().slice(0, 120);
  const lat = Number(u.get('lat')), lon = Number(u.get('lon'));
  const hasPoint = u.has('lat') && u.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (!q && !hasPoint) return json({ error: 'Enter a station, hotel or address, or share your location.' }, 400);
  const limit = Math.min(8, Math.max(1, Number(u.get('limit')) || 6));
  const radius = Math.min(10000, Math.max(400, Number(u.get('radius')) || 3000));
  try {
    if (hasPoint) {
      const stations = await findStations({ near: { lat, lon }, radius, mode, limit, fetcher });
      return json({ mode: mode || 'any', stations, places: [], source: SOURCE, retrieved: new Date().toISOString() }, 200, 60);
    }
    const stations = await findStations({ q, mode, limit, fetcher });
    /* Only look for door-to-door places when no station matches what was typed. */
    const places = stations.length ? [] : await findPlaces({ q, mode, limit: 3, fetcher });
    return json({ mode: mode || 'any', stations, places, source: SOURCE, retrieved: new Date().toISOString() }, 200, 60);
  } catch (e) {
    return json({ error: 'Station search is temporarily unavailable. Please try again shortly.', upstream: e?.status || e?.name || 'error' }, 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
