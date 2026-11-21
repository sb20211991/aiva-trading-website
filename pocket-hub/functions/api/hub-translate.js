/* POST /api/hub-translate {text, source, target} -> {translation, detected}
   In-app translation for Aiva on app.aivatrading.uk. Runs server-side with the same keyless engine
   the Aiva Trading website already uses, so no credentials ever reach the browser. */
import { SOURCES, TARGETS } from '../_lib/languages.js';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/t?client=gtx';
const MAX_CHARS = 5000;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (hostname === new URL(request.url).hostname) return true;
    if (protocol === 'https:' && /^app\.aivatrading\.uk$|(^|\.)aiva-pocket-hub\.pages\.dev$/.test(hostname)) return true;
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch { return false; }
}

export async function onRequestPost({ request }, fetcher = fetch) {
  if (!allowedOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_CHARS * 4 + 200) return json({ error: 'Text is too long' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid request' }, 400); }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const source = body?.source || 'auto', target = body?.target;
  if (!text) return json({ error: 'Enter text to translate' }, 400);
  if (text.length > MAX_CHARS) return json({ error: `Text is too long (max ${MAX_CHARS} characters)` }, 413);
  if (!SOURCES.has(source) || !TARGETS.has(target)) return json({ error: 'Unsupported language' }, 400);
  if (source === target) return json({ translation: text, detected: source });

  const form = new URLSearchParams({ q: text });
  let res;
  try {
    res = await fetcher(`${ENDPOINT}&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&format=text`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
    });
  } catch { return json({ error: 'Translation service is unreachable. Please try again.' }, 502); }
  if (!res.ok) return json({ error: 'Translation service is busy. Please try again shortly.' }, 502);
  let data;
  try { data = await res.json(); } catch { return json({ error: 'Translation service returned an invalid reply' }, 502); }
  const first = Array.isArray(data) ? data[0] : data;
  const translation = Array.isArray(first) ? first[0] : first;
  if (typeof translation !== 'string' || !translation.trim()) return json({ error: 'No translation was returned. Please try again.' }, 502);
  const detected = Array.isArray(first) && typeof first[1] === 'string' ? first[1] : source;
  return json({ translation, detected });
}

export function onRequest() {
  return json({ error: 'Method not allowed' }, 405);
}
