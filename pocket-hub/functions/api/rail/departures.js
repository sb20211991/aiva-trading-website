/* GET /api/rail/departures?stopId=<Transitous stop id>&mode=train|tram&n=10
   The live departure board at one station: next trains or trams, real-time delays, platforms and
   cancellations exactly as the operator's feed reports them. */
import { json, cached } from '../../_lib/emergency.js';
import { stopBoard, SOURCE } from '../../_lib/rail.js';

export async function onRequestGet({ request }, fetcher = fetch) {
  const u = new URL(request.url).searchParams;
  const stopId = String(u.get('stopId') || '').trim();
  if (!/^[A-Za-z0-9_:.-]{3,200}$/.test(stopId)) return json({ error: 'Choose a station first.' }, 400);
  const mode = u.get('mode') === 'tram' ? 'tram' : u.get('mode') === 'train' ? 'train' : '';
  const n = Math.min(20, Math.max(3, Number(u.get('n')) || 10));
  try {
    const board = await cached(`rail-board-${stopId}-${mode}-${n}`, 20, () => stopBoard(stopId, { fetcher, n, mode }));
    if (!board.departures.length) {
      return json({ ...board, mode: mode || 'any', source: SOURCE, retrieved: new Date().toISOString(),
        note: 'The feed reports no upcoming departures for this station in the next hours.' }, 200, 20);
    }
    return json({ ...board, mode: mode || 'any', live: board.departures.some((d) => d.realtime), source: SOURCE, retrieved: new Date().toISOString() }, 200, 20);
  } catch (e) {
    return json({ error: 'The live departure board is temporarily unavailable.', upstream: e?.status || e?.name || 'error' }, 503);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
