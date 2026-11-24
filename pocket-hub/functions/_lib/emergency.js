/* Shared helpers for the Pocket Hub Emergency endpoints (/api/emergency/*).
   Every value shown to users comes from an external source: OpenStreetMap (Overpass / Nominatim)
   and TfL Unified API. Nothing here invents prices, timetables or availability. */

export const UA = 'AivaPocketHub/1.1 (+https://app.aivatrading.uk; emergency section)';
export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
export const NOMINATIM = 'https://nominatim.openstreetmap.org';
export const TFL = 'https://api.tfl.gov.uk';

export const json = (body, status = 200, maxAge = 0) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' }
});

export function coords(url) {
  const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
  if (!url.searchParams.has('lat') || !url.searchParams.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export async function fetchJSON(url, init = {}, fetcher = fetch, timeout = 12000) {
  const res = await fetcher(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

/* Cloudflare edge cache around an expensive upstream call; silently skipped where the Cache API is unavailable. */
export async function cached(key, ttl, produce) {
  const cache = globalThis.caches?.default, req = new Request('https://aiva-emergency-cache.internal/' + key);
  if (cache) { try { const hit = await cache.match(req); if (hit) return hit.json(); } catch {} }
  const data = await produce();
  if (cache) { try { await cache.put(req, json(data, 200, ttl)); } catch {} }
  return data;
}

/* Overpass first (one query, richest data), each mirror with its own timeout. */
export async function overpass(query, fetcher = fetch) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const data = await fetchJSON(url, { method: 'POST', body: new URLSearchParams({ data: query }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, fetcher, 12000);
      if (Array.isArray(data?.elements)) return data.elements;
      lastErr = new Error('Invalid Overpass reply');
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

/* ---------- Time zones (needed to judge "open now" at the searched place) ---------- */
// Countries that use a single IANA zone for (almost) all of their territory. Multi-zone countries are left out on purpose.
const COUNTRY_TZ = {
  gb: 'Europe/London', ie: 'Europe/Dublin', fr: 'Europe/Paris', de: 'Europe/Berlin', it: 'Europe/Rome', nl: 'Europe/Amsterdam',
  be: 'Europe/Brussels', lu: 'Europe/Luxembourg', ch: 'Europe/Zurich', at: 'Europe/Vienna', dk: 'Europe/Copenhagen', se: 'Europe/Stockholm',
  no: 'Europe/Oslo', fi: 'Europe/Helsinki', is: 'Atlantic/Reykjavik', pl: 'Europe/Warsaw', cz: 'Europe/Prague', sk: 'Europe/Bratislava',
  hu: 'Europe/Budapest', si: 'Europe/Ljubljana', hr: 'Europe/Zagreb', ro: 'Europe/Bucharest', bg: 'Europe/Sofia', gr: 'Europe/Athens',
  cy: 'Asia/Nicosia', mt: 'Europe/Malta', ee: 'Europe/Tallinn', lv: 'Europe/Riga', lt: 'Europe/Vilnius', rs: 'Europe/Belgrade',
  ba: 'Europe/Sarajevo', me: 'Europe/Podgorica', mk: 'Europe/Skopje', al: 'Europe/Tirane', md: 'Europe/Chisinau', ua: 'Europe/Kyiv',
  tr: 'Europe/Istanbul', ge: 'Asia/Tbilisi', am: 'Asia/Yerevan', az: 'Asia/Baku', iq: 'Asia/Baghdad', ir: 'Asia/Tehran',
  sy: 'Asia/Damascus', lb: 'Asia/Beirut', jo: 'Asia/Amman', il: 'Asia/Jerusalem', sa: 'Asia/Riyadh', kw: 'Asia/Kuwait',
  bh: 'Asia/Bahrain', qa: 'Asia/Qatar', ae: 'Asia/Dubai', om: 'Asia/Muscat', eg: 'Africa/Cairo', pk: 'Asia/Karachi',
  in: 'Asia/Kolkata', bd: 'Asia/Dhaka', cn: 'Asia/Shanghai', hk: 'Asia/Hong_Kong', tw: 'Asia/Taipei', jp: 'Asia/Tokyo',
  kr: 'Asia/Seoul', th: 'Asia/Bangkok', vn: 'Asia/Ho_Chi_Minh', my: 'Asia/Kuala_Lumpur', sg: 'Asia/Singapore', ph: 'Asia/Manila',
  ma: 'Africa/Casablanca', za: 'Africa/Johannesburg', ng: 'Africa/Lagos', ke: 'Africa/Nairobi'
};
export const countryTz = cc => COUNTRY_TZ[String(cc || '').toLowerCase()] || null;
export const validTz = tz => { try { if (!tz) return false; new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; } };

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
export function localClock(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(p => [p.type, p.value]));
  return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/* ---------- OpenStreetMap opening_hours ----------
   Supports the common subset (24/7, weekday lists/ranges, several time spans, overnight spans, off/closed,
   ";" and "," rule separators). Anything else (months, weeks, sunrise, comments, open-ended "+") is reported as
   unknown so the UI shows grey instead of guessing. Public-holiday rules are ignored and flagged. */
const TIME = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;
export function parseOpeningHours(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > 255) return null;
  const week = DAYS.map(() => []);
  if (/^24\/7$/.test(text)) { week.forEach(d => d.push([0, 1440])); return { week, holidayCaveat: false, always: true }; }
  let holidayCaveat = false;
  const rules = [];
  for (const part of text.split(';')) {
    const pieces = part.split(/,\s+(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/);
    pieces.forEach((p, i) => { if (p.trim()) rules.push({ text: p.trim(), additional: i > 0 }); });
  }
  if (!rules.length) return null;
  for (const rule of rules) {
    if (/^PH\b/.test(rule.text)) { holidayCaveat = true; continue; }
    const m = rule.text.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?(?:,PH)?\s*(.*)$/);
    if (!m) return null;
    if (/,PH\b/.test(rule.text)) holidayCaveat = true;
    const daysPart = m[1], rest = m[2].trim();
    const days = new Set();
    if (daysPart) for (const sel of daysPart.split(',')) {
      const [a, b] = sel.split('-').map(d => DAYS.indexOf(d));
      if (b === undefined) days.add(a); else for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
    } else DAYS.forEach((_, i) => days.add(i));
    if (!rest) return null;
    const spans = [];
    if (!/^(off|closed)$/i.test(rest)) {
      for (const t of rest.split(/\s*,\s*/)) {
        const tm = t.match(TIME);
        if (!tm) return null;
        const s = Number(tm[1]) * 60 + Number(tm[2]), e = Number(tm[3]) * 60 + Number(tm[4]);
        if (Number(tm[2]) > 59 || Number(tm[4]) > 59 || s >= 1440 || e > 2880) return null;
        spans.push([s, e]);
      }
    }
    for (const d of days) {
      if (!rule.additional) { week[d] = week[d].filter(iv => iv.carry); const n = (d + 1) % 7; week[n] = week[n].filter(iv => !(iv.carry && iv.from === d)); }
      for (const [s, e] of spans) {
        if (e > s && e <= 1440) week[d].push([s, e]);
        else { week[d].push([s, 1440]); const over = e > 1440 ? e - 1440 : e; if (over > 0) week[(d + 1) % 7].push(Object.assign([0, over], { carry: true, from: d })); }
      }
    }
  }
  const always = week.every(d => d.some(([s, e]) => s === 0 && e === 1440));
  return { week, holidayCaveat, always };
}

const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* -> {state:'open'|'closed'|'unknown', label} for a clock {day, minutes} at the place. */
export function openingStatus(raw, clock) {
  if (!raw) return { state: 'unknown', label: 'Opening hours not listed' };
  const oh = parseOpeningHours(raw);
  if (!oh) return { state: 'unknown', label: 'Opening hours not verifiable: ' + String(raw).slice(0, 80) };
  if (!clock) return { state: 'unknown', label: 'Hours: ' + raw + ' (local time unknown)' };
  const note = oh.holidayCaveat ? ' (may differ on public holidays)' : '';
  if (oh.always) return { state: 'open', label: 'Open 24 hours' + note };
  // Flatten the week into absolute minutes from Monday 00:00, merged, so spans that touch across midnight join up.
  const abs = [];
  oh.week.forEach((spans, d) => spans.forEach(([s, e]) => abs.push([d * 1440 + s, d * 1440 + e])));
  abs.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of abs) { const last = merged[merged.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else merged.push([...iv]); }
  if (!merged.length) return { state: 'closed', label: 'Closed (listed as closed all week)' + note };
  const now = clock.day * 1440 + clock.minutes, W = 7 * 1440;
  for (const [s, e] of merged) {
    for (const shift of [0, -W]) if (now >= s + shift && now < e + shift) {
      const end = e + shift, lastIv = merged[merged.length - 1];
      const wraps = end === W && merged[0][0] === 0 ? merged[0][1] : null;
      const closeAt = wraps !== null ? wraps : end;
      return { state: 'open', label: `Open now · closes ${hhmm(closeAt % 1440)}` + note };
    }
  }
  const next = merged.map(([s]) => (s - now + W) % W).sort((a, b) => a - b)[0];
  const at = (now + next) % W, sameDay = next < 1440 && Math.floor(at / 1440) === clock.day;
  return { state: 'closed', label: `Closed now · opens ${sameDay ? '' : DAY_NAMES[Math.floor(at / 1440)] + ' '}${hhmm(at % 1440)}` + note };
}
