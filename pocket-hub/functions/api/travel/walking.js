import { json, osrm, point } from '../../_lib/travel.js';

export async function onRequestGet({ request }, fetcher = fetch) {
  const params = new URL(request.url).searchParams;
  const from = point(params.get('from'));
  const to = point(params.get('to'));
  if (!from || !to) return json({ error: 'Choose a starting point and destination.' }, 400);
  try {
    const route = await osrm(from, to, 'foot', fetcher, true, Infinity);
    return route ? json(route) : json({ error: 'No walking route found.' }, 404);
  } catch {
    return json({ error: 'Walking directions are temporarily unavailable.' }, 503);
  }
}
