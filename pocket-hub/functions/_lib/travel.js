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
const DUFFEL_PAX = (adults, children, infants) => [...Array.from({ length: adults }, () => ({ type: 'adult' })), ...Array.from({ length: children }, () => ({ type: 'child' })), ...Array.from({ length: infants }, () => ({ type: 'infant_without_seat' }))];
export async function duffelFlights({ legs, adults, children = 0, infants = 0, cabin = 'economy', currency }, env, fetcher = fetch) {
  const slices = legs.map((l) => ({ origin: l.from, destination: l.to, departure_date: l.date }));
  const data = await fetchJSON(`${DUFFEL}/air/offer_requests?return_offers=true&supplier_timeout=20000`, {
    method: 'POST', body: JSON.stringify({ data: { slices, passengers: DUFFEL_PAX(adults, children, infants), cabin_class: cabin, max_connections: 2 } }),
    headers: { Authorization: `Bearer ${env.DUFFEL_ACCESS_TOKEN}`, 'Duffel-Version': 'v2', 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' }
  }, fetcher, 28000);
  const offers = (data?.data?.offers || []).map(shapeOffer).filter((o) => Number.isFinite(o.price));
  offers.sort((a, b) => a.price - b.price);
  return { offers: offers.slice(0, 10), currency: offers[0]?.currency || currency, live: !!data?.data?.live_mode };
}

/* Nuitee (LiteAPI) flights: same X-API-Key as hotels; journeys are shaped like Duffel offers. */
export const isSandboxKey = (k) => /^sand_/.test(k || '');
const segOf = (g) => ({ from: g.originCode || '', fromName: g.originName || '', to: g.destinationCode || '', toName: g.destinationName || '', departing: g.departureTime || '', arriving: g.arrivalTime || '',
  flight: `${g.carrier?.marketingCode || ''}${g.flight?.marketingNumber || ''}`, airline: g.carrier?.marketingName || '', operator: g.carrier?.operatingName || '', minutes: g.duration?.minutes || 0 });
/* Splits a journey's segments into one slice per requested leg: by direction for returns; for multi-city, at the requested
   leg endpoints when the airport codes match, otherwise (city codes such as PAR) on/after the next leg's date when the
   segment leaves from the next leg's origin or after a stopover of 6 h or more, unless a later open-jaw break marks the
   real boundary. A segment that does not start where the previous one ended always starts a new leg. */
export function journeySlices(segs, legs = []) {
  const groups = [];
  if (legs.length > 2 || (legs.length === 2 && segs.every((g) => (g.direction || 'OUTBOUND') === 'OUTBOUND'))) {
    let k = 0;
    segs.forEach((g, i) => {
      const prev = segs[i - 1], next = legs[k + 1];
      if (i && next) {
        const exact = prev.destinationCode === legs[k].to;
        const known = segs.some((x) => x.destinationCode === legs[k].to);
        const gap = Date.parse(g.departureTime) - Date.parse(prev.arrivalTime);
        const onDate = String(g.departureTime).slice(0, 10) >= next.date;
        const broken = g.originCode !== prev.destinationCode;
        const laterBreak = segs.slice(i + 1).some((x, j) => x.originCode !== segs[i + j].destinationCode);
        if (exact || broken || (!known && onDate && !laterBreak && (g.originCode === next.from || gap >= 6 * 3600e3))) k++;
      }
      (groups[k] ||= []).push(g);
    });
  } else for (const d of [...new Set(segs.map((g) => g.direction || 'OUTBOUND'))]) groups.push(segs.filter((g) => (g.direction || 'OUTBOUND') === d));
  return groups.filter(Boolean);
}
/* Elapsed minutes of one slice: flight times plus layovers (each layover is measured in one airport's local clock). */
export const sliceMinutes = (ss) => ss.reduce((n, g, i) => n + (g.duration?.minutes || 0) + (i ? Math.max(0, Math.round((Date.parse(g.departureTime) - Date.parse(ss[i - 1].arrivalTime)) / 60000)) : 0), 0);
/* Paid bag options arrive once per segment, passenger and weight band, so one fare can list 30+ near-identical
   lines. They are grouped by bag type with the lowest price the airline offers: "Checked bag from 25.14 GBP". */
export function paidBags(list) {
  const by = new Map();
  for (const b of Array.isArray(list) ? list : []) {
    const type = String(b?.description || b?.bagType || '').trim();
    const amount = Number(b?.pricing?.display?.amount), currency = String(b?.pricing?.display?.currency || '');
    if (!type) continue;
    const cur = by.get(type);
    if (!Number.isFinite(amount) || !currency) { if (!cur) by.set(type, null); continue; }
    if (!cur || amount < cur.amount) by.set(type, { amount, currency });
  }
  return [...by].map(([type, p]) => p ? `${type} from ${p.amount} ${p.currency}` : type);
}

export function shapeJourney(j, legs) {
  const o = j.cheapestOffer || j.offers?.[0] || {}, segs = j.segments || [], c = segs[0]?.carrier || {};
  const groups = journeySlices(segs, legs);
  const slices = groups.map((ss, i) => {
    const first = ss[0] || {}, last = ss.at(-1) || {}, dir = first.direction || 'OUTBOUND';
    const byDir = groups.length <= 2 && new Set(groups.map((x) => x[0]?.direction || 'OUTBOUND')).size === groups.length;
    const legMin = byDir ? j.legDurations?.find((l) => l.direction === dir)?.duration?.minutes : 0;
    return { from: first.originCode || '', to: last.destinationCode || '', departing: first.departureTime || '', arriving: last.arrivalTime || '', arrivingTz: '',
      minutes: legMin || sliceMinutes(ss), stops: Math.max(0, ss.length - 1),
      flights: ss.map((g) => `${g.carrier?.marketingCode || ''}${g.flight?.marketingNumber || ''}`).filter(Boolean), segments: ss.map(segOf) };
  });
  const bag = o.baggage || {}, money = (b) => b.pricing?.display ? ` (${b.pricing.display.amount} ${b.pricing.display.currency})` : '';
  const bags = (bag.included || []).map((b) => `${b.pieces || 1}× ${b.description || b.bagType}`).join(', ');
  const per = o.pricing?.display?.perPassenger || {};
  return { id: o.offerId || j.journeyKey, airline: c.marketingName || '', airlineCode: c.marketingCode || '', logo: c.marketingLogo || '',
    price: Number(o.pricing?.display?.total), currency: o.pricing?.display?.currency || '', expires: o.expiration || '', slices,
    cabin: [o.segmentFares?.[0]?.cabin, o.fare?.family].filter(Boolean).join(' · '), baggage: bags || (bag.hasCheckedBag === false ? 'No checked bag included' : ''),
    bags: !o.baggage ? null : { carryOn: typeof bag.hasCarryOnBag === 'boolean' ? bag.hasCarryOnBag : null, checked: typeof bag.hasCheckedBag === 'boolean' ? bag.hasCheckedBag : null, included: (bag.included || []).map((b) => `${b.pieces || 1}× ${b.description || b.bagType}${b.size ? ' · ' + b.size : ''}`),
      paid: paidBags(bag.paid) },
    seatsLeft: Number.isFinite(o.fare?.seatsRemaining) ? o.fare.seatsRemaining : null,
    perPassenger: Object.fromEntries(Object.entries(per).filter(([, v]) => Number.isFinite(v?.total)).map(([k, v]) => [k, v.total])),
    refundable: !!o.terms?.refundable, changeable: !!o.terms?.changeable };
}
/* A slice matches its leg when each endpoint equals the requested code, or the code is a city code (never an airport in the offer). */
const slicesMatch = (x, leg, all) => { const codes = new Set(all.flatMap((s) => [s.from, s.to, ...(s.segments || []).flatMap((g) => [g.from, g.to])]));
  return (x.from === leg.from || !codes.has(leg.from)) && (x.to === leg.to || !codes.has(leg.to)); };
const NUITEE_CABIN = { economy: 'ECONOMY', premium_economy: 'PREMIUM_ECONOMY', business: 'BUSINESS', first: 'FIRST' };
export async function nuiteeFlights({ legs, adults, children = 0, infants = 0, cabin = 'economy', currency }, env, fetcher = fetch) {
  const ret = legs.length === 2 && legs[1].from === legs[0].to && legs[1].to === legs[0].from;
  const body = { legs: legs.map((l, i) => ({ origin: l.from, destination: l.to, date: l.date, ...(ret ? { direction: i ? 'INBOUND' : 'OUTBOUND' } : {}) })),
    adults, ...(children ? { children } : {}), ...(infants ? { infants } : {}), cabinClass: NUITEE_CABIN[cabin] || 'ECONOMY', currency, country: 'GB', sort: { sortBy: 'price', sortOrder: 'asc' } };
  const data = await fetchJSON(`${LITEAPI}/flights/rates`, {
    method: 'POST', headers: { 'X-API-Key': env.LITEAPI_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }, fetcher, 28000);
  const offers = (data?.data?.[0]?.journeys || []).map((j) => shapeJourney(j, legs)).filter((o) => Number.isFinite(o.price) && o.slices.length === legs.length && o.slices.every((x, i) => slicesMatch(x, legs[i], o.slices)));
  offers.sort((a, b) => a.price - b.price);
  return { offers: offers.slice(0, 10), currency: offers[0]?.currency || currency, live: !isSandboxKey(env.LITEAPI_KEY) };
}

/* ---------- Hotels ---------- */
const commons = (f) => f ? 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(String(f).replace(/^File:/i, '')) + '?width=480' : '';
/* LiteAPI facility ids (GET /data/facilities) grouped into the filters shown in Aiva Search. */
export const FACILITIES = { wifi: [47, 107], parking: [2, 161, 674], pool: [103, 104, 120, 122, 192, 193, 195, 301], gym: [11, 492], spa: [54],
  restaurant: [3, 115, 116], shuttle: [17], ac: [109], pets: [4], accessible: [25, 185], family: [28], ev: [182] };
export const hotelFacilities = (ids = []) => { const set = new Set(ids.map(Number)); return Object.keys(FACILITIES).filter((k) => FACILITIES[k].some((i) => set.has(i))); };
export async function liteHotels({ lat, lon, checkin, checkout, adults, children = [], currency }, env, fetcher = fetch) {
  const headers = { 'X-API-Key': env.LITEAPI_KEY, 'Content-Type': 'application/json' };
  const list = await fetchJSON(`${LITEAPI}/data/hotels?latitude=${lat}&longitude=${lon}&radius=8000&limit=25`, { headers }, fetcher, 15000);
  const hotels = (list?.data || []).filter((h) => h.id && h.name);
  if (!hotels.length) return [];
  const getTypes = async () => {
    const result = await fetchJSON(`${LITEAPI}/data/hotelTypes`, { headers }, fetcher, 8000);
    return Object.fromEntries((result.data || []).map(type => [
      type.hotelTypeId ?? type.typeId ?? type.id, type.name ?? type.hotelTypeName ?? type.hotelType ?? type.type
    ]));
  };
  const typesPromise = hotels.some(h => h.hotelTypeId != null)
    ? cached('liteapi-hotel-types-en-v1', 86400, getTypes).catch(() => ({}))
    : Promise.resolve({});
  const rates = await fetchJSON(`${LITEAPI}/hotels/rates`, {
    method: 'POST', headers,
    body: JSON.stringify({ hotelIds: hotels.map((h) => h.id), occupancies: [{ adults, ...(children.length ? { children } : {}) }], currency, guestNationality: 'GB', checkin, checkout, timeout: 12 })
  }, fetcher, 20000);
  const price = {}, rooms = {};
  for (const r of rates?.data || []) {
    for (const rt of r.roomTypes || []) {
      const a = Number(rt.offerRetailRate?.amount ?? rt.rates?.[0]?.retailRate?.total?.[0]?.amount);
      if (!Number.isFinite(a)) continue;
      const room = { total: a, currency: rt.offerRetailRate?.currency || rt.rates?.[0]?.retailRate?.total?.[0]?.currency || currency, room: rt.rates?.[0]?.name || '', offerId: rt.offerId || '',
        refundable: rt.rates?.[0]?.cancellationPolicies?.refundableTag === 'RFN', board: rt.rates?.[0]?.boardName || '',
        cancelBy: rt.rates?.[0]?.cancellationPolicies?.cancelPolicyInfos?.[0]?.cancelTime || '',
        taxesDue: (rt.rates?.[0]?.retailRate?.taxesAndFees || []).filter((t) => t.included === false).reduce((n, t) => n + (Number(t.amount) || 0), 0) };
      (rooms[r.hotelId] ||= []).push(room);
      if (!price[r.hotelId] || a < price[r.hotelId].total) price[r.hotelId] = room;
    }
  }
  const roomOptions = (list = []) => {
    const seen = new Set();
    return list.sort((a, b) => a.total - b.total).filter((x) => { const k = `${x.room}|${x.board}|${x.refundable}`; return x.offerId && !seen.has(k) && seen.add(k); }).slice(0, 8);
  };
  const types = await typesPromise;
  return hotels.map((h) => ({
    propertyType: accommodationType(types[h.hotelTypeId] || h.hotelTypeName || h.hotelType),
    id: h.id, name: h.name, stars: Number(h.stars) || null, rating: Number(h.rating) || null, address: h.address || '',
    lat: Number(h.latitude), lon: Number(h.longitude), image: h.main_photo || h.thumbnail || '', facilities: hotelFacilities(h.facilityIds || []), distance: distanceM({ lat, lon }, { lat: Number(h.latitude), lon: Number(h.longitude) }),
    available: !!price[h.id], price: price[h.id] || null, rooms: roomOptions(rooms[h.id])
  })).sort((a, b) => (b.available - a.available) || ((a.price?.total ?? 1e12) - (b.price?.total ?? 1e12)) || a.distance - b.distance).slice(0, 15);
}
/* Nominatim fallback when Overpass is overloaded: bounded phrase search around a point, shaped like Overpass elements. */
export async function nominatimNear(phrase, { lat, lon }, km, fetcher = fetch) {
  const d = km / 111, e = d / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const list = await fetchJSON(`${NOMINATIM}/search?format=jsonv2&extratags=1&namedetails=1&accept-language=en&bounded=1&limit=40&viewbox=${lon - e},${lat + d},${lon + e},${lat - d}&q=${encodeURIComponent(phrase)}`, {}, fetcher);
  return (list || []).map((r) => ({ type: r.osm_type, id: r.osm_id, lat: Number(r.lat), lon: Number(r.lon),
    tags: { ...(r.extratags || {}), name: r.namedetails?.['name:en'] || r.name || r.namedetails?.name, [r.category]: r.type } }));
}
function accommodationType(value) {
  const label = String(value || '').toLowerCase().replace(/[_-]/g, ' ');
  if (/aparthotel|apart hotel|apartment hotel|serviced apartment/.test(label)) return 'Aparthotel';
  if (/apartment|flat/.test(label)) return 'Apartment';
  if (/hostel/.test(label)) return 'Hostel';
  if (/guest house|guesthouse|bed and breakfast/.test(label)) return 'Guest house';
  if (/resort/.test(label)) return 'Resort';
  if (/hotel/.test(label)) return 'Hotel';
  return '';
}

export async function osmHotels({ lat, lon }, fetcher = fetch) {
  const els = await overpass(`[out:json][timeout:20];nwr["tourism"~"^(hotel|apartment|hostel|guest_house|resort)$"]["name"](around:6000,${lat},${lon});out center tags 80;`, fetcher)
    .catch(() => nominatimNear('hotel', { lat, lon }, 7, fetcher));
  return els.map((e) => {
    const t = e.tags || {}, p = { lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon };
    return {
      propertyType: accommodationType(t['hotel:type'] || t.tourism), id: `osm-${e.type}-${e.id}`, name: t['name:en'] || t.name, stars: Number(t.stars) || null, rating: null,
      address: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(', '), lat: p.lat, lon: p.lon,
      image: /^https:\/\/upload\.wikimedia\.org\//.test(t.image || '') ? t.image : commons(t.wikimedia_commons?.startsWith('File:') ? t.wikimedia_commons : ''),
      distance: distanceM({ lat, lon }, p), available: null, price: null
    };
  }).filter((h) => h.name && !/^(test|hotel|fixme)$/i.test(h.name.trim()) && Number.isFinite(h.lat))
    .sort((a, b) => (!!b.image - !!a.image) || ((b.stars || 0) - (a.stars || 0)) || a.distance - b.distance).slice(0, 15);
}

/* ---------- Airport -> hotel routes ---------- */
const VEHICLE = { BUS: 'bus', INTERCITY_BUS: 'bus', TROLLEYBUS: 'bus', SHARE_TAXI: 'bus', HEAVY_RAIL: 'train', COMMUTER_TRAIN: 'train', HIGH_SPEED_TRAIN: 'train', LONG_DISTANCE_TRAIN: 'train', RAIL: 'train', METRO_RAIL: 'metro', SUBWAY: 'metro', MONORAIL: 'metro', TRAM: 'tram', LIGHT_RAIL: 'tram', FERRY: 'ferry' };
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
const turn = (st) => {
  const m = st.maneuver || {}, road = st.name ? ` onto ${st.name}` : '', mod = m.modifier ? ` ${m.modifier}` : '';
  if (m.type === 'depart') return `Head ${m.modifier || 'out'}${st.name ? ' on ' + st.name : ''}`;
  if (m.type === 'arrive') return 'Arrive at your destination';
  if (m.type === 'roundabout' || m.type === 'rotary') return `At the roundabout take exit ${m.exit || 1}${road}`;
  return `${m.type === 'turn' || m.type === 'end of road' ? 'Turn' : m.type === 'continue' || m.type === 'new name' ? 'Continue' : 'Keep'}${mod}${road}`;
};
export async function osrm(from, to, profile, fetcher = fetch, steps = false, stepLimit = 25) {
  const data = await fetchJSON(`${FOSSGIS}/routed-${profile}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false${steps ? '&steps=true' : ''}`, {}, fetcher, 12000);
  const r = data?.routes?.[0];
  if (!r) return null;
  const out = { minutes: Math.round(r.duration / 60), distance: Math.round(r.distance) };
  if (steps) out.steps = (r.legs?.[0]?.steps || []).filter((st) => stepLimit === Infinity || st.distance > 15 || st.maneuver?.type === 'arrive').slice(0, stepLimit).map((st) => ({ text: turn(st), distance: Math.round(st.distance || 0) }));
  return out;
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
