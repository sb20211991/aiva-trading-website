/* Live public-transport providers used outside the TfL area. Each one is an official or community-run open API
   with real-time data; a stop only turns green when the provider itself reports a live departure. */
import { fetchJSON } from './emergency.js';

export const ENTUR = 'https://api.entur.io/journey-planner/v3/graphql';
export const SWISS = 'https://transport.opendata.ch/v1';
export const IRAIL = 'https://api.irail.be/v1';
export const LDB = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120';

const mins = (t, now) => Math.max(0, Math.round((t - now) / 60000));
const late = d => d >= 1 ? `${d} min late` : '';

/* Common stop verdict: green only for live departures, red when every reported departure is cancelled. */
export function verdict(departures, providerName) {
  const running = departures.filter(d => !d.cancelled);
  const live = running.filter(d => d.realtime);
  if (departures.length && !running.length) return { state: 'closed', label: 'Cancelled · every listed departure is cancelled' };
  if (live.length) {
    const n = departures.length - running.length;
    return { state: 'live', label: `Live · next ${live[0].line} in ${live[0].minutes ? live[0].minutes + ' min' : 'under 1 min'}${n ? ` · ${n} cancelled` : ''}` };
  }
  if (running.length) return { state: 'unverified', label: `Timetabled times only · ${providerName} reports no live tracking` };
  return { state: 'none', label: 'No departures reported for the next 2 hours' };
}

const ENTUR_MODE = { rail: 'train', metro: 'tube', tram: 'tram', bus: 'bus', coach: 'bus', water: 'ferry' };
export async function entur(origin, radius, fetcher, now = Date.now()) {
  const query = `{ nearest(latitude:${origin.lat},longitude:${origin.lon},maximumDistance:${radius},maximumResults:12,filterByPlaceTypes:[stopPlace],multiModalMode:parent){edges{node{distance place{... on StopPlace{id name latitude longitude transportMode estimatedCalls(numberOfDepartures:8,timeRange:7200){realtime cancellation aimedDepartureTime expectedDepartureTime quay{publicCode} destinationDisplay{frontText} situations{summary{value language}} serviceJourney{line{id publicCode name transportMode}}}}}}}}}`;
  const data = await fetchJSON(ENTUR, { method: 'POST', body: JSON.stringify({ query }),
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'aivatrading-pockethub' } }, fetcher);
  if (data?.errors?.length) throw Object.assign(new Error('Entur error'), { status: 'entur-error' });
  return (data?.data?.nearest?.edges || []).map(e => ({ d: e.node.distance, p: e.node.place })).filter(x => x.p?.name).slice(0, 7).map(({ d, p }) => {
    const calls = p.estimatedCalls || [];
    const departures = calls.map(c => {
      const t = Date.parse(c.expectedDepartureTime || c.aimedDepartureTime), line = c.serviceJourney?.line || {};
      return { line: line.publicCode || line.name || '', lineId: line.id || '', destination: c.destinationDisplay?.frontText || '',
        platform: c.quay?.publicCode || '', expected: new Date(t).toISOString(), minutes: mins(t, now), realtime: !!c.realtime,
        cancelled: !!c.cancellation, status: c.cancellation ? 'Cancelled' : late(Math.round((t - Date.parse(c.aimedDepartureTime)) / 60000)) };
    }).filter(x => Number.isFinite(x.minutes));
    const alerts = [...new Set(calls.flatMap(c => (c.situations || []).map(s => (s.summary?.find(v => v.language === 'en') || s.summary?.[0])?.value).filter(Boolean)))].slice(0, 2);
    const modes = [...new Set((p.transportMode || []).map(m => ENTUR_MODE[m]).filter(Boolean))];
    return { id: p.id, name: p.name, indicator: '', modes: modes.length ? modes : ['bus'], distance: Math.round(d), lat: p.latitude, lon: p.longitude,
      ...verdict(departures, 'Entur'), departures: departures.slice(0, 8), lines: [], alerts, timetable: false,
      links: [{ label: 'Live board (Entur)', url: `https://entur.no/nearby-stop-place-detail?id=${encodeURIComponent(p.id)}` }] };
  });
}

const SWISS_MODE = { train: 'train', tram: 'tram', bus: 'bus', ship: 'ferry', cableway: 'train' };
export async function swiss(origin, radius, fetcher, now = Date.now()) {
  const loc = await fetchJSON(`${SWISS}/locations?x=${origin.lat}&y=${origin.lon}&type=station`, {}, fetcher);
  const stations = (loc?.stations || []).filter(s => s.id && s.name && (s.distance ?? 0) <= radius).slice(0, 5);
  const upstream = new Set();
  const boards = await Promise.all(stations.map(s => fetchJSON(`${SWISS}/stationboard?id=${encodeURIComponent(s.id)}&limit=8`, {}, fetcher)
    .catch(e => { upstream.add(e.status || e.name); return null; })));
  const stops = stations.map((s, i) => {
    const board = boards[i];
    const departures = (board?.stationboard || []).map(j => {
      const plan = Date.parse(j.stop?.departure), prog = Date.parse(j.stop?.prognosis?.departure || ''), t = Number.isFinite(prog) ? prog : plan;
      return { line: `${j.category || ''} ${j.number || ''}`.trim(), lineId: j.name || '', destination: j.to || '', platform: j.stop?.prognosis?.platform || j.stop?.platform || '',
        expected: Number.isFinite(t) ? new Date(t).toISOString() : '', minutes: mins(t, now), realtime: Number.isFinite(prog) || Number.isFinite(j.stop?.delay),
        cancelled: false, status: late(Number(j.stop?.delay) || 0) };
    }).filter(x => Number.isFinite(x.minutes));
    const base = { id: s.id, name: s.name, indicator: '', modes: [SWISS_MODE[s.icon] || 'train'], distance: Math.round(s.distance ?? 0),
      lat: s.coordinate?.x, lon: s.coordinate?.y, departures: departures.slice(0, 8), lines: [], alerts: [], timetable: false,
      links: [] };
    return board === null ? { ...base, state: 'unverified', label: 'Live feed did not respond' } : { ...base, ...verdict(departures, 'opendata.ch') };
  });
  return { stops, upstream: [...upstream] };
}

/* Belgian rail (SNCB/NMBS) live departures by the station's UIC code from OpenStreetMap. */
export async function irail(uic, fetcher, now = Date.now()) {
  const id = 'BE.NMBS.00' + String(uic).replace(/\D/g, '').slice(-7).padStart(7, '0');
  const d = await fetchJSON(`${IRAIL}/liveboard/?id=${id}&format=json&lang=en&arrdep=departure`, {}, fetcher);
  return (d?.departures?.departure || []).map(x => {
    const delay = Number(x.delay) || 0, t = (Number(x.time) + delay) * 1000, cancelled = x.canceled === '1';
    return { line: x.vehicleinfo?.shortname || '', lineId: x.vehicle || '', destination: x.station || '', platform: x.platform || '',
      expected: new Date(t).toISOString(), minutes: mins(t, now), realtime: true, cancelled,
      status: cancelled ? 'Cancelled' : late(Math.round(delay / 60)) };
  }).filter(x => Number.isFinite(x.minutes) && (t => t >= now - 60000)(Date.parse(x.expected))).slice(0, 8);
}

/* Great Britain National Rail (Darwin, via the Rail Data Marketplace) by CRS code. Needs RAIL_DATA_LDB_KEY. */
const hhmm = s => /^\d{2}:\d{2}$/.test(s || '');
export function darwinTime(hm, generatedAt) {
  const g = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?([+-]\d{2}:\d{2}|Z)?/.exec(generatedAt || '');
  if (!g || !hhmm(hm)) return NaN;
  let t = Date.parse(`${g[1]}T${hm}:00${g[2] || 'Z'}`);
  const ref = Date.parse(generatedAt);
  if (t < ref - 12 * 3600e3) t += 864e5; else if (t > ref + 12 * 3600e3) t -= 864e5;
  return t;
}
export async function darwin(crs, env, fetcher, now = Date.now()) {
  const base = env.RAIL_DATA_LDB_URL || LDB;
  const d = await fetchJSON(`${base}/GetDepBoardWithDetails/${encodeURIComponent(crs)}?numRows=8&timeWindow=120`, { headers: { 'x-apikey': env.RAIL_DATA_LDB_KEY } }, fetcher);
  const departures = (d?.trainServices || []).map(s => {
    const etd = s.etd || '', cancelled = !!s.isCancelled || /cancel/i.test(etd);
    const plan = darwinTime(s.std, d.generatedAt), exp = hhmm(etd) ? darwinTime(etd, d.generatedAt) : plan;
    const status = cancelled ? 'Cancelled' + (s.cancelReason ? ` · ${s.cancelReason}` : '')
      : /delayed/i.test(etd) ? 'Delayed' + (s.delayReason ? ` · ${s.delayReason}` : '') : late(Math.round((exp - plan) / 60000));
    return { line: s.operator || 'Train', lineId: s.serviceID || '', destination: (s.destination || []).map(x => x.locationName).join(' & '),
      platform: s.platform ? 'Platform ' + s.platform : '', expected: Number.isFinite(exp) ? new Date(exp).toISOString() : '', minutes: mins(exp, now),
      realtime: /on time/i.test(etd) || hhmm(etd) || /delayed/i.test(etd), cancelled, status: /on time/i.test(etd) ? 'On time' : status };
  }).filter(x => Number.isFinite(x.minutes));
  const alerts = (d?.nrccMessages || []).map(m => String(m.Value ?? m.value ?? '').replace(/<[^>]*>/g, '').trim()).filter(Boolean).slice(0, 2);
  return { departures, alerts };
}
