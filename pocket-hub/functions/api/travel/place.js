/* GET /api/travel/place?q=<city, airport or IATA code> -> {label, city, lat, lon, countryCode, code, airports:[{iata,name,lat,lon,distance}]}
   Airports from the bundled OurAirports list (scheduled service, IATA code); other places via OpenStreetMap Nominatim. */
import { json, fetchJSON, distanceM, cached } from '../../_lib/travel.js';
import { NOMINATIM } from '../../_lib/emergency.js';
import { AIRPORTS } from '../../_lib/airports.js';

const CITY_CODES = { LON: ['LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN'], NYC: ['JFK', 'EWR', 'LGA'], PAR: ['CDG', 'ORY'], TYO: ['HND', 'NRT'], MIL: ['MXP', 'LIN', 'BGY'],
  ROM: ['FCO', 'CIA'], CHI: ['ORD', 'MDW'], WAS: ['IAD', 'DCA', 'BWI'], STO: ['ARN', 'BMA'], MOW: ['SVO', 'DME', 'VKO'], OSA: ['KIX', 'ITM'], SEL: ['ICN', 'GMP'],
  BJS: ['PEK', 'PKX'], SHA: ['PVG', 'SHA'], SAO: ['GRU', 'CGH', 'VCP'], RIO: ['GIG', 'SDU'], BUE: ['EZE', 'AEP'], YTO: ['YYZ', 'YTZ'], YMQ: ['YUL'], BER: ['BER'], IST: ['IST', 'SAW'], DXB: ['DXB', 'DWC'], BKK: ['BKK', 'DMK'], JKT: ['CGK', 'HLP'] };
const CITY_NAMES = { LON: 'London', NYC: 'New York', PAR: 'Paris', TYO: 'Tokyo', MIL: 'Milan', ROM: 'Rome', CHI: 'Chicago', WAS: 'Washington', STO: 'Stockholm', MOW: 'Moscow',
  OSA: 'Osaka', SEL: 'Seoul', BJS: 'Beijing', SHA: 'Shanghai', SAO: 'São Paulo', RIO: 'Rio de Janeiro', BUE: 'Buenos Aires', YTO: 'Toronto', YMQ: 'Montreal', BER: 'Berlin',
  IST: 'Istanbul', DXB: 'Dubai', BKK: 'Bangkok', JKT: 'Jakarta' };
const shape = (a, p) => ({ iata: a[0], name: a[1], city: a[2], country: a[3], lat: a[4], lon: a[5], large: !!a[6], distance: p ? distanceM(p, { lat: a[4], lon: a[5] }) : 0 });
const byCode = new Map(AIRPORTS.map((a) => [a[0], a]));
export const nearAirports = (p, max = 4) => AIRPORTS.map((a) => shape(a, p)).filter((a) => a.distance < 130000)
  .sort((x, y) => (y.large - x.large) || x.distance - y.distance).slice(0, max);

export async function onRequestGet({ request }, fetcher = fetch) {
  const raw = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 120);
  if (!raw) return json({ error: 'Enter a city, airport or IATA code' }, 400);
  const code = (/\(([A-Za-z]{3})\)\s*$/.exec(raw)?.[1] || (/^[A-Za-z]{3}$/.test(raw) ? raw : '')).toUpperCase();
  const name = raw.replace(/\([A-Za-z]{3}\)\s*$/, '').trim();
  const codes = CITY_CODES[code] || (byCode.has(code) ? [code] : []);
  if (codes.length) {
    const first = shape(byCode.get(codes.find((c) => byCode.has(c))));
    const city = name && name.toUpperCase() !== code ? name : CITY_NAMES[code] || first.city.replace(/\s*\(.*\)$/, '');
    const centre = await cached('travel-city-' + encodeURIComponent(`${city}-${first.country}`.toLowerCase()), 86400, async () =>
      (await fetchJSON(`${NOMINATIM}/search?format=jsonv2&limit=1&countrycodes=${first.country}&q=${encodeURIComponent(city)}`, {}, fetcher))?.[0] || null).catch(() => null);
    const p = centre ? { lat: Number(centre.lat), lon: Number(centre.lon) } : { lat: first.lat, lon: first.lon };
    const airports = codes.filter((c) => byCode.has(c)).map((c) => shape(byCode.get(c), p));
    return json({ ...p, city, label: `${city} (${code})`, countryCode: first.country, code, airports, source: 'OurAirports · OpenStreetMap Nominatim' }, 200, 86400);
  }
  try {
    const hit = await cached('travel-place-' + encodeURIComponent(name.toLowerCase()), 86400, async () =>
      (await fetchJSON(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&accept-language=en&limit=1&q=${encodeURIComponent(name)}`, {}, fetcher))?.[0] || null);
    if (!hit) return json({ error: `"${raw}" was not found. Try a city name or airport code.` }, 404);
    const p = { lat: Number(hit.lat), lon: Number(hit.lon) }, ad = hit.address || {};
    const airports = nearAirports(p), city = ad.city || ad.town || ad.village || String(hit.display_name || '').split(',')[0];
    return json({ ...p, city, label: String(hit.display_name || '').split(',').slice(0, 3).join(',').trim(), countryCode: String(ad.country_code || '').toLowerCase(),
      code: airports[0]?.iata || '', airports, source: 'OpenStreetMap Nominatim · OurAirports' }, 200, 3600);
  } catch { return json({ error: 'Place search is unavailable. Please try again.' }, 503); }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
