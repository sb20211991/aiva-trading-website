import { json, osrm, point } from '../../_lib/travel.js';

export async function onRequestGet({ request }, fetcher = fetch) {
  const params = new URL(request.url).searchParams;
  const from = point(params.get('from'));
  const to = point(params.get('to'));
  const profile = params.get('profile');
  if (!from || !to || !['car', 'bike', 'foot'].includes(profile)) {
    return json({ error: 'Choose two places and a road travel mode.' }, 400);
  }
  try {
    const route = await osrm(from, to, profile, fetcher, true, Infinity);
    if (!route) return json({ error: 'No route found for this mode.' }, 404);
    return json(route);
  } catch {
    return json({ error: 'Directions are temporarily unavailable.' }, 503);
  }
}
