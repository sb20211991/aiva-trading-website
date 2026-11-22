/* GET /api/emergency/timetable?line=<TfL line id>&stop=<TfL stop id>
   Today's first and last scheduled departures (and whether the line runs all night) from the TfL timetable. */
import { TFL, json, fetchJSON, cached, localClock } from '../../_lib/emergency.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
/* Days (0 = Monday) named by a TfL schedule such as "Monday - Thursday", "Saturday (also Good Friday)". */
export function scheduleDays(name) {
  const s = String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ');
  const days = new Set();
  const range = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:-|–|to)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/g;
  let m;
  for (const r of s.matchAll(range)) { for (let d = DAYS.indexOf(r[1]); ; d = (d + 1) % 7) { days.add(d); if (d === DAYS.indexOf(r[2])) break; } }
  const rest = s.replace(range, ' ');
  DAYS.forEach((d, i) => { if (new RegExp('\\b' + d + '\\b').test(rest)) days.add(i); });
  return days;
}
const t = j => j ? `${String(Number(j.hour) % 24).padStart(2, '0')}:${String(Number(j.minute)).padStart(2, '0')}${Number(j.hour) >= 24 ? ' (after midnight)' : ''}` : null;

export function summarise(data, today, label = '') {
  const route = data?.timetable?.routes?.[0];
  if (!route) return null;
  const options = (route.schedules || []).map(s => ({ s, days: scheduleDays(s.name) })).filter(o => o.days.has(today)).sort((a, b) => a.days.size - b.days.size);
  const sch = options[0]?.s;
  const towards = label.replace(/ (Underground|DLR|Rail) Station/g, '').replace(' - ', ' → ');
  if (!sch) return { direction: data.direction, towards, schedule: null };
  const hours = new Set((sch.knownJourneys || []).map(j => Number(j.hour) % 24));
  return { direction: data.direction, towards, schedule: sch.name, first: t(sch.firstJourney), last: t(sch.lastJourney), runs24h: hours.size === 24 };
}

export async function onRequestGet({ request, env }, fetcher = fetch) {
  const url = new URL(request.url), line = url.searchParams.get('line') || '', stop = url.searchParams.get('stop') || '';
  if (!/^[a-z0-9-]{1,40}$/i.test(line) || !/^[A-Z0-9]{4,20}$/i.test(stop)) return json({ error: 'Invalid line or stop' }, 400);
  const key = env?.TFL_APP_KEY ? `&app_key=${encodeURIComponent(env.TFL_APP_KEY)}` : '';
  const today = localClock('Europe/London').day;
  try {
    const directions = await cached(`tt-${line}-${stop}-${today}`, 3600, async () => {
      const first = await fetchJSON(`${TFL}/Line/${line}/Timetable/${stop}?${key.slice(1)}`, {}, fetcher, 20000);
      if (!first?.disambiguation) return [summarise(first, today)].filter(Boolean);
      const all = first.disambiguation.disambiguationOptions || [], seen = new Set();
      const options = all.filter(o => { const d = /direction=(\w+)/.exec(o.uri || '')?.[1] || o.uri; return !seen.has(d) && seen.add(d); }).slice(0, 2);
      const pages = await Promise.all(options.map(o => fetchJSON(`${TFL}${o.uri}${key}`, {}, fetcher, 20000).catch(() => null)));
      return pages.map((p, i) => summarise(p, today, options[i].description || '')).filter(Boolean);
    });
    if (!directions.length) return json({ error: 'No timetable is published for this stop' }, 404);
    return json({ line, stop, directions, source: 'Powered by TfL Open Data' }, 200, 600);
  } catch { return json({ error: 'Timetable is temporarily unavailable' }, 502); }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
