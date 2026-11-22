/* Aiva Search (Pocket Hub travel): shared helpers and provider adapters for /api/travel/*.
   Every fare, rate, schedule and duration shown comes from a provider reply; nothing is invented.
   Flights: Duffel (DUFFEL_ACCESS_TOKEN). Hotels: LiteAPI (LITEAPI_KEY), OpenStreetMap fallback without prices.
   Routes: Google Routes API (GOOGLE_MAPS_API_KEY), FOSSGIS OSRM fallback for road and walking routes. */
import { json, fetchJSON, overpass, distanceM, cached, NOMINATIM } from './emergency.js';

export { json, fetchJSON, overpass, distanceM, cached };
export const DUFFEL = 'https://api.duffel.com';
export const LITEAPI = 'https://api.liteapi.travel/v3.0';
export const ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';
export const FOSSGIS = 'https://routing.openstreetmap.de';

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
export const iata = (s) => /^[A-Z]{3}$/.test(String(s || '').toUpperCase()) ? String(s).toUpperCase() : '';
export const point = (s) => {
  const [lat, lon] = String(s || '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};
export const clampInt = (v, min, max, def) => Math.min(max, Math.max(min, Math.round(Number(v)) || def));
/* ISO-8601 duration (PT12H35M / P1DT2H) -> minutes */
export function isoMinutes(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(d || '');
  return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : null;
}
export const secMinutes = (s) => Math.round(parseFloat(String(s || '0')) / 60);

/* ---------- Flights: Duffel offer requests ---------- */
export function shapeOffer(o) {
  const slices = (o.slices || []).map((s) => {
    const segs = s.segments || [], first = segs[0] || {}, last = segs.at(-1) || {};
    return {
      from: first.origin?.iata_code || s.origin?.iata_code || '', to: last.destination?.iata_code || s.destination?.iata_code || '',
      departing: first.departing_at || '', arriving: last.arriving_at || '', arrivingTz: last.destination?.time_zone || '', minutes: isoMinutes(s.duration), stops: Math.max(0, segs.length - 1),
      flights: segs.map((g) => `${g.marketing_carrier?.iata_code || ''}${g.marketing_carrier_flight_number || ''}`).filter(Boolean)
    };
  });
  return {
    id: o.id, airline: o.owner?.name || '', airlineCode: o.owner?.iata_code || '', logo: o.owner?.logo_symbol_url || '',
    price: Number(o.total_amount), currency: o.total_currency, expires: o.expires_at || '', slices,
    cabin: o.slices?.[0]?.segments?.[0]?.passengers?.[0]?.cabin_class_marketing_name || '',
    baggage: o.slices?.[0]?.segments?.[0]?.passengers?.[0]?.baggages?.map((b) => `${b.quantity}× ${b.type.replace('_', ' ')}`).join(', ') || ''
  };
}
export async function duffelFlights({ from, to, depart, ret, adults, currency }, env, fetcher = fetch) {
  const slices = [{ origin: from, destination: to, departure_date: depart }];
  if (ret) slices.push({ origin: to, destination: from, departure_date: ret });
  const data = await fetchJSON(`${DUFFEL}/air/offer_requests?return_offers=true&supplier_timeout=20000`, {
    method: 'POST', body: JSON.stringify({ data: { slices, passengers: Array.from({ length: adults }, () => ({ type: 'adult' })), cabin_class: 'economy', max_connections: 2 } }),
    headers: { Authorization: `Bearer ${env.DUFFEL_ACCESS_TOKEN}`, 'Duffel-Version': 'v2', 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' }
  }, fetcher, 28000);
  const offers = (data?.data?.offers || []).map(shapeOffer).filter((o) => Number.isFinite(o.price));
  offers.sort((a, b) => a.price - b.price);
  return { offers: offers.slice(0, 10), currency: offers[0]?.currency || currency, live: !!data?.data?.live_mode };
}

/* ---------- Hotels ---------- */
const commons = (f) => f ? 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(String(f).replace(/^File:/i, '')) + '?width=480' : '';
export async function liteHotels({ lat, lon, checkin, checkout, adults, currency }, env, fetcher = fetch) {
  const headers = { 'X-API-Key': env.LITEAPI_KEY, 'Content-Type': 'application/json' };
  const list = await fetchJSON(`${LITEAPI}/data/hotels?latitude=${lat}&longitude=${lon}&radius=8000&limit=25`, { headers }, fetcher, 15000);
  const hotels = (list?.data || []).filter((h) => h.id && h.name);
  if (!hotels.length) return [];
  const rates = await fetchJSON(`${LITEAPI}/hotels/rates`, {
    method: 'POST', headers,
    body: JSON.stringify({ hotelIds: hotels.map((h) => h.id), occupancies: [{ adults }], currency, guestNationality: 'GB', checkin, checkout, timeout: 12 })
  }, fetcher, 20000);
  const price = {};
  for (const r of rates?.data || []) {
    for (const rt of r.roomTypes || []) {
      const a = Number(rt.offerRetailRate?.amount ?? rt.rates?.[0]?.retailRate?.total?.[0]?.amount);
      if (Number.isFinite(a) && (!price[r.hotelId] || a < price[r.hotelId].total))
        price[r.hotelId] = { total: a, currency: rt.offerRetailRate?.currency || rt.rates?.[0]?.retailRate?.total?.[0]?.currency || currency, room: rt.rates?.[0]?.name || '', offerId: rt.offerId || '',
          refundable: rt.rates?.[0]?.cancellationPolicies?.refundableTag === 'RFN' };
    }
  }
  return hotels.map((h) => ({
    id: h.id, name: h.name, stars: Number(h.stars) || null, rating: Number(h.rating) || null, address: h.address || '',
    lat: Number(h.latitude), lon: Number(h.longitude), image: h.main_photo || h.thumbnail || '', distance: distanceM({ lat, lon }, { lat: Number(h.latitude), lon: Number(h.longitude) }),
    available: !!price[h.id], price: price[h.id] || null
  })).sort((a, b) => (b.available - a.available) || ((a.price?.total ?? 1e12) - (b.price?.total ?? 1e12)) || a.distance - b.distance).slice(0, 15);
}
/* Nominatim fallback when Overpass is overloaded: bounded phrase search around a point, shaped like Overpass elements. */
export async function nominatimNear(phrase, { lat, lon }, km, fetcher = fetch) {
  const d = km / 111, e = d / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const list = await fetchJSON(`${NOMINATIM}/search?format=jsonv2&extratags=1&namedetails=1&accept-language=en&bounded=1&limit=40&viewbox=${lon - e},${lat + d},${lon + e},${lat - d}&q=${encodeURIComponent(phrase)}`, {}, fetcher);
  return (list || []).map((r) => ({ type: r.osm_type, id: r.osm_id, lat: Number(r.lat), lon: Number(r.lon),
    tags: { ...(r.extratags || {}), name: r.namedetails?.['name:en'] || r.name || r.namedetails?.name, [r.category]: r.type } }));
}
export async function osmHotels({ lat, lon }, fetcher = fetch) {
  const els = await overpass(`[out:json][timeout:20];nwr["tourism"="hotel"]["name"](around:6000,${lat},${lon});out center tags 80;`, fetcher)
    .catch(() => nominatimNear('hotel', { lat, lon }, 7, fetcher));
  return els.map((e) => {
    const t = e.tags || {}, p = { lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon };
    return {
      id: `osm-${e.type}-${e.id}`, name: t['name:en'] || t.name, stars: Number(t.stars) || null, rating: null,
      address: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(', '), lat: p.lat, lon: p.lon,
      image: /^https:\/\/upload\.wikimedia\.org\//.test(t.image || '') ? t.image : commons(t.wikimedia_commons?.startsWith('File:') ? t.wikimedia_commons : ''),
      distance: distanceM({ lat, lon }, p), available: null, price: null
    };
  }).filter((h) => h.name && Number.isFinite(h.lat))
    .sort((a, b) => (!!b.image - !!a.image) || ((b.stars || 0) - (a.stars || 0)) || a.distance - b.distance).slice(0, 15);
}

/* ---------- Airport -> hotel routes ---------- */
const VEHICLE = { BUS: 'bus', INTERCITY_BUS: 'bus', TROLLEYBUS: 'bus', SHARE_TAXI: 'bus', HEAVY_RAIL: 'train', COMMUTER_TRAIN: 'train', HIGH_SPEED_TRAIN: 'train', LONG_DISTANCE_TRAIN: 'train', RAIL: 'train', METRO_RAIL: 'train', SUBWAY: 'train', MONORAIL: 'train', TRAM: 'train', LIGHT_RAIL: 'train', FERRY: 'ferry' };
const tzOffset = (ms, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
};
/* Duffel times are airport-local without an offset; convert to UTC using the airport time zone (or a longitude estimate). */
export function localToUTC(local, tz, lon) {
  const s = String(local || '');
  if (/(Z|[+-]\d\d:?\d\d)$/.test(s)) return Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : '';
  const g = Date.parse(s + 'Z');
  if (!Number.isFinite(g)) return '';
  try { if (tz) return new Date(g - tzOffset(g - tzOffset(g, tz), tz)).toISOString(); } catch { /* unknown zone */ }
  return new Date(g - Math.round((Number(lon) || 0) / 15) * 3600000).toISOString();
}
/* Clock time of a Google UTC timestamp in the stop's own time zone. */
export function localClock(iso, loc) {
  if (!iso) return '';
  try { if (loc?.timeZone) return new Intl.DateTimeFormat('en-GB', { timeZone: loc.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)); } catch { /* fall through */ }
  return loc?.time?.text || String(iso).slice(11, 16);
}
export async function googleRoutes(from, to, mode, env, fetcher = fetch, departure) {
  const body = { origin: { location: { latLng: { latitude: from.lat, longitude: from.lon } } }, destination: { location: { latLng: { latitude: to.lat, longitude: to.lon } } }, travelMode: mode, languageCode: 'en-GB', units: 'METRIC' };
  if (mode === 'TRANSIT') { body.computeAlternativeRoutes = true; if (departure) body.departureTime = departure; }
  if (mode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';
  const data = await fetchJSON(ROUTES, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
    'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.travelAdvisory.transitFare,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.distanceMeters,routes.legs.steps.transitDetails' } }, fetcher, 15000);
  return (data?.routes || []).map((r) => ({
    minutes: secMinutes(r.duration), distance: r.distanceMeters || 0,
    fare: r.travelAdvisory?.transitFare ? { amount: Number(r.travelAdvisory.transitFare.units || 0) + (r.travelAdvisory.transitFare.nanos || 0) / 1e9, currency: r.travelAdvisory.transitFare.currencyCode } : null,
    steps: (r.legs?.[0]?.steps || []).filter((s) => s.travelMode === 'TRANSIT' && s.transitDetails).map((s) => {
      const t = s.transitDetails, line = t.transitLine || {};
      return { kind: VEHICLE[line.vehicle?.type] || 'transit', line: line.nameShort || line.name || '', operator: line.agencies?.[0]?.name || '', headsign: t.headsign || '',
        from: t.stopDetails?.departureStop?.name || '', to: t.stopDetails?.arrivalStop?.name || '', departs: localClock(t.stopDetails?.departureTime, t.localizedValues?.departureTime), arrives: localClock(t.stopDetails?.arrivalTime, t.localizedValues?.arrivalTime), stops: t.stopCount || 0 };
    })
  }));
}
export async function osrm(from, to, profile, fetcher = fetch) {
  const data = await fetchJSON(`${FOSSGIS}/routed-${profile}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`, {}, fetcher, 12000);
  const r = data?.routes?.[0];
  return r ? { minutes: Math.round(r.duration / 60), distance: Math.round(r.distance) } : null;
}
export async function airportServices(p, fetcher = fetch) {
  const els = await overpass(`[out:json][timeout:20];(nwr["railway"~"^(station|halt)$"]["name"](around:2500,${p.lat},${p.lon});nwr["amenity"="bus_station"](around:2500,${p.lat},${p.lon});` +
    `nwr["amenity"="car_rental"](around:4000,${p.lat},${p.lon});nwr["amenity"="taxi"](around:2500,${p.lat},${p.lon}););out center tags 80;`, fetcher)
    .catch(async () => (await Promise.all(['railway station', 'metro station', 'bus station', 'car rental', 'taxi'].map((q) => nominatimNear(q, p, 3, fetcher).catch(() => [])))).flat());
  const out = { stations: [], busStations: [], carRental: [], taxiRanks: [] };
  for (const e of els) {
    const t = e.tags || {}, q = { lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon };
    const item = { name: t['name:en'] || t.name || t.brand || t.operator || '', distance: distanceM(p, q), lat: q.lat, lon: q.lon, hours: t.opening_hours || '' };
    if (t.railway) out.stations.push({ ...item, network: t.network || t.operator || '' });
    else if (t.amenity === 'bus_station') out.busStations.push(item);
    else if (t.amenity === 'car_rental') out.carRental.push({ ...item, name: item.name || 'Car hire desk' });
    else if (t.amenity === 'taxi') out.taxiRanks.push({ ...item, name: item.name || 'Taxi rank' });
  }
  for (const k in out) {
    const seen = new Set();
    out[k] = out[k].sort((a, b) => a.distance - b.distance).filter((x) => !seen.has(x.name) && seen.add(x.name)).slice(0, 6);
  }
  return out;
}
