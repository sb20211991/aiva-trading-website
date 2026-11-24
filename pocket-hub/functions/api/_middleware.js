/* Aiva keeps train, tram, metro and car hire inside the app.
   Train, tram and metro show their stations, departure times, changes and last service in Aiva Train, Aiva Tram
   and the Aiva journey planner, and car hire is priced and booked in Aiva Car Rental, so those four modes never
   offer an external booking site in a new tab. The two endpoints that build those hand-offs still describe every
   mode, so their reply is rewritten here: train, tram, metro and car hire carry no outbound link at all.
   Taxi, ride-hailing, bus and walking keep theirs. Scoped to /api so static files are untouched, and any failure
   returns the original reply unchanged. */
const NO_OUTBOUND = ['train', 'metro', 'tram', 'car'];
const ROUTES = new Set(['/api/travel/transfers', '/api/emergency/plan']);

const quiet = (target) => (target && typeof target === 'object'
  ? { ...target, book: [], tip: '' }
  : target);

export async function onRequest(context) {
  const { request, next } = context;
  const response = await next();
  if (!ROUTES.has(new URL(request.url).pathname)) return response;
  if (!/application\/json/i.test(response.headers.get('content-type') || '')) return response;
  const copy = response.clone();
  try {
    const data = await copy.json();
    if (data && typeof data === 'object') {
      if (data.links && typeof data.links === 'object') {
        for (const mode of NO_OUTBOUND) if (data.links[mode]) data.links[mode] = quiet(data.links[mode]);
      }
      if (data.modes && typeof data.modes === 'object') {
        for (const mode of NO_OUTBOUND) if (data.modes[mode]) data.modes[mode] = quiet(data.modes[mode]);
      }
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify(data), { status: response.status, headers });
  } catch {
    return response;
  }
}
