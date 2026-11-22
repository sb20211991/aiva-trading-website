/* GET /api/emergency/places?lat=&lon=&category=health|pharmacy|stay|police|essentials&radius=<m>&tz=<IANA>&gps=1&cc=<country>
   Nearby services from OpenStreetMap (Overpass, Nominatim fallback). "Open now" is computed from the listed
   opening_hours in the place's local time; when hours or time zone are unknown the status is "unknown" (grey). */
import { NOMINATIM, json, coords, distanceM, fetchJSON, cached, overpass, countryTz, validTz, localClock, openingStatus } from '../../_lib/emergency.js';

export const CATEGORIES = {
  health: { filters: ['amenity=hospital', 'amenity=clinic', 'amenity=doctors', 'healthcare=urgent_care'], phrases: ['hospital', 'clinic'] },
  pharmacy: { filters: ['amenity=pharmacy'], phrases: ['pharmacy'] },
  stay: { filters: ['tourism=hotel', 'tourism=hostel', 'tourism=guest_house', 'tourism=motel', 'social_facility=shelter'], phrases: ['hotel', 'hostel', 'guest house'] },
  police: { filters: ['amenity=police', 'office=diplomatic', 'amenity=embassy'], phrases: ['police', 'embassy'] },
  essentials: { filters: ['amenity=atm', 'amenity=toilets', 'shop=supermarket', 'shop=convenience', 'amenity=fuel', 'amenity=drinking_water'], phrases: ['atm', 'supermarket', 'toilets'] }
};
const KIND = {
  hospital: 'Hospital', clinic: 'Clinic', doctors: 'Doctor / GP', urgent_care: 'Urgent care', pharmacy: 'Pharmacy', hotel: 'Hotel',
  hostel: 'Hostel', guest_house: 'Guest house', motel: 'Motel', shelter: 'Emergency shelter', police: 'Police', diplomatic: 'Embassy / consulate',
  embassy: 'Embassy / consulate', atm: 'Cash machine (ATM)', toilets: 'Public toilets', supermarket: 'Supermarket', convenience: 'Convenience shop',
  fuel: 'Fuel station', drinking_water: 'Drinking water'
};
const kindOf = t => KIND[t.social_facility === 'shelter' ? 'shelter' : t.healthcare === 'urgent_care' ? 'urgent_care' : t.amenity || t.tourism || t.shop || t.office] ||
  'Service';

function toPlace(tags, lat, lon, id, origin, clock) {
  const t = tags || {}, kind = kindOf(t);
  const name = t.name || t['name:en'] || t.brand || t.operator || '';
  if (!name && !['Cash machine (ATM)', 'Public toilets', 'Drinking water'].includes(kind)) return null;
  const address = [t['addr:housenumber'], t['addr:street'], t['addr:city'] || t['addr:town'], t['addr:postcode']].filter(Boolean).join(', ');
  return {
    id, name: name || kind, kind, lat, lon, distance: distanceM(origin, { lat, lon }), address,
    city: t['addr:city'] || t['addr:town'] || '', phone: t.phone || t['contact:phone'] || '', website: t.website || t['contact:website'] || '',
    openingHours: t.opening_hours || '', checked: t['check_date:opening_hours'] || t.check_date || '',
    emergency: t.emergency === 'yes', status: openingStatus(t.opening_hours, clock)
  };
}

export async function onRequestGet({ request }, fetcher = fetch) {
  const url = new URL(request.url), origin = coords(url), category = url.searchParams.get('category') || 'health';
  const cat = CATEGORIES[category];
  if (!origin) return json({ error: 'Location is required' }, 400);
  if (!cat) return json({ error: 'Unknown category' }, 400);
  const radius = Math.min(10000, Math.max(300, Math.round(Number(url.searchParams.get('radius')) || 2000)));
  // Local time zone: trust the device zone when the user shared their GPS position, otherwise use the place's country.
  const deviceTz = url.searchParams.get('tz'), gps = url.searchParams.get('gps') === '1';
  const tz = gps && validTz(deviceTz) ? deviceTz : countryTz(url.searchParams.get('cc'));
  const clock = tz ? localClock(tz) : null;

  let raw, source;
  try {
    ({ raw, source } = await cached(`places-${category}-${radius}-${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}`, 900, async () => {
      try {
        const q = `[out:json][timeout:12];(${cat.filters.map(f => { const [k, v] = f.split('='); return `nwr(around:${radius},${origin.lat},${origin.lon})["${k}"="${v}"];`; }).join('')});out center tags 120;`;
        const els = await overpass(q, fetcher);
        return { source: 'OpenStreetMap (Overpass API)', raw: els.map(e => ({ id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: e.tags })) };
      } catch {
        const d = radius / 111320, dl = d / Math.max(0.2, Math.cos(origin.lat * Math.PI / 180));
        const box = [origin.lon - dl, origin.lat + d, origin.lon + dl, origin.lat - d].map(n => n.toFixed(5)).join(',');
        const out = [];
        for (const phrase of cat.phrases) {
          const list = await fetchJSON(`${NOMINATIM}/search?format=jsonv2&extratags=1&addressdetails=1&bounded=1&limit=40&viewbox=${box}&amenity=${encodeURIComponent(phrase)}`, {}, fetcher);
          for (const r of list || []) out.push({ id: `${r.osm_type}/${r.osm_id}`, lat: Number(r.lat), lon: Number(r.lon),
            tags: { ...(r.extratags || {}), name: r.name, [r.category]: r.type, 'addr:street': r.address?.road, 'addr:housenumber': r.address?.house_number,
              'addr:city': r.address?.city || r.address?.town || r.address?.village, 'addr:postcode': r.address?.postcode } });
        }
        return { source: 'OpenStreetMap (Nominatim)', raw: out };
      }
    }));
  } catch { return json({ error: 'Place data is temporarily unavailable. Please try again shortly.' }, 502); }

  const seen = new Set();
  const places = raw.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon) && !seen.has(r.id) && seen.add(r.id))
    .map(r => toPlace(r.tags, r.lat, r.lon, r.id, origin, clock)).filter(p => p && p.distance <= radius * 1.2)
    .sort((a, b) => (b.emergency - a.emergency) * (category === 'health' ? 1 : 0) || a.distance - b.distance).slice(0, 30);
  return json({ places, category, radius, timeZone: tz, localTimeKnown: !!clock, source, retrieved: new Date().toISOString() });
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
