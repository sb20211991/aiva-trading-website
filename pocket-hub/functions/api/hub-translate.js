/* POST /api/hub-translate {text, source, target} -> {translation, detected, provider}
   In-app translation for Aiva on app.aivatrading.uk. Runs server-side, so no credentials ever reach the browser.
   Providers are tried in order and each falls through to the next on any failure:
   1. Google Cloud Translation (official API) when the GOOGLE_TRANSLATE_API_KEY Pages secret is set.
   2. Google's keyless engine, the same one the Aiva Trading website already uses (always available).
   3. Microsoft Translator (official API) when the AZURE_TRANSLATOR_KEY Pages secret is set (AZURE_TRANSLATOR_REGION
      for regional keys), for the languages Microsoft publishes.
   Text is sent only to the provider that translates it and is never stored or logged by Aiva. */
import { SOURCES, TARGETS, engineCode } from '../_lib/languages.js';
import { microsoftCode, fromMicrosoft } from '../_lib/translate-providers.js';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/t?client=gtx';
const MAX_CHARS = 5000, MAX_BODY_BYTES = MAX_CHARS * 4 + 512;

/* Reads at most `limit` bytes of the body; returns null as soon as it is exceeded. */
async function readLimited(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader(), parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { reader.cancel().catch(() => {}); return null; }
      parts.push(value);
    }
  } catch { return ''; }
  const all = new Uint8Array(size);
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.byteLength; }
  return new TextDecoder().decode(all);
}
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

async function keyless(text, sl, tl, fetcher) {
  let res;
  try {
    res = await fetcher(`${ENDPOINT}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&format=text`, {
      method: 'POST', body: new URLSearchParams({ q: text }), signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
    });
  } catch { throw Object.assign(new Error('Translation service is unreachable. Please try again.'), { soft: true }); }
  if (!res.ok) throw new Error('Translation service is busy. Please try again shortly.');
  let data;
  try { data = await res.json(); } catch { throw new Error('Translation service returned an invalid reply'); }
  const first = Array.isArray(data) ? data[0] : data;
  const translation = Array.isArray(first) ? first[0] : first;
  if (typeof translation !== 'string' || !translation.trim()) throw new Error('No translation was returned. Please try again.');
  const detected = Array.isArray(first) && typeof first[1] === 'string' ? first[1] : sl;
  return { translation, detected };
}

async function googleCloud(text, sl, tl, env, fetcher) {
  const body = { q: text, target: tl, format: 'text' };
  if (sl !== 'auto') body.source = sl;
  const res = await fetcher(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(env.GOOGLE_TRANSLATE_API_KEY)}`, {
    method: 'POST', signal: AbortSignal.timeout(12000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`cloud ${res.status}`);
  const t = (await res.json())?.data?.translations?.[0];
  if (!t || typeof t.translatedText !== 'string' || !t.translatedText.trim()) throw new Error('cloud: empty');
  return { translation: t.translatedText, detected: t.detectedSourceLanguage || sl };
}

async function microsoft(text, sl, tl, env, fetcher) {
  const to = microsoftCode(tl), from = sl === 'auto' ? '' : microsoftCode(sl);
  if (!to || (sl !== 'auto' && !from)) throw new Error('microsoft: language not offered');
  const headers = { 'Ocp-Apim-Subscription-Key': env.AZURE_TRANSLATOR_KEY, 'Content-Type': 'application/json' };
  if (env.AZURE_TRANSLATOR_REGION) headers['Ocp-Apim-Subscription-Region'] = env.AZURE_TRANSLATOR_REGION;
  const res = await fetcher(`https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(to)}${from ? `&from=${encodeURIComponent(from)}` : ''}`, {
    method: 'POST', signal: AbortSignal.timeout(12000), headers, body: JSON.stringify([{ Text: text }])
  });
  if (!res.ok) throw new Error(`microsoft ${res.status}`);
  const d = (await res.json())?.[0];
  const out = d?.translations?.[0]?.text;
  if (typeof out !== 'string' || !out.trim()) throw new Error('microsoft: empty');
  return { translation: out, detected: d.detectedLanguage ? fromMicrosoft(d.detectedLanguage.language) : sl };
}

/* Runs the provider chain for engine codes sl -> tl. Exported for the video subtitle path and tests. */
export async function translateWithFallback(text, sl, tl, env = {}, fetcher = fetch) {
  const chain = [];
  if (env.GOOGLE_TRANSLATE_API_KEY) chain.push(['google-cloud', () => googleCloud(text, sl, tl, env, fetcher)]);
  chain.push(['google', () => keyless(text, sl, tl, fetcher)]);
  if (env.AZURE_TRANSLATOR_KEY) chain.push(['microsoft', () => microsoft(text, sl, tl, env, fetcher)]);
  let firstError = null;
  for (const [provider, run] of chain) {
    try { return { ...(await run()), provider }; } catch (e) { if (!firstError || (firstError.soft && provider === 'google')) firstError = e; }
  }
  throw firstError || new Error('Translation service is busy. Please try again shortly.');
}

export async function onRequestPost({ request, env = {} }, fetcher = fetch) {
  if (!allowedOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
  const raw = await readLimited(request, MAX_BODY_BYTES);
  if (raw === null) return json({ error: 'Text is too long' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid request' }, 400); }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const source = body?.source || 'auto', target = body?.target;
  if (!text) return json({ error: 'Enter text to translate' }, 400);
  if (text.length > MAX_CHARS) return json({ error: `Text is too long (max ${MAX_CHARS} characters)` }, 413);
  if (!SOURCES.has(source) || !TARGETS.has(target)) return json({ error: 'Unsupported language' }, 400);
  if (source === target) return json({ translation: text, detected: source });

  const sl = engineCode(source), tl = engineCode(target);
  if (sl === tl) return json({ translation: text, detected: source });
  try {
    const out = await translateWithFallback(text, sl, tl, env, fetcher);
    return json({ translation: out.translation, detected: source === 'auto' ? out.detected : source, provider: out.provider });
  } catch (e) {
    return json({ error: e.message && !/^(cloud|microsoft)/.test(e.message) ? e.message : 'Translation service is busy. Please try again shortly.' }, 502);
  }
}

export function onRequest() {
  return json({ error: 'Method not allowed' }, 405);
}
