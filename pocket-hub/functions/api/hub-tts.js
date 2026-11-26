/* GET /api/hub-tts?lang=ar&text=...  -> audio/mpeg (natural AI voice for Aiva Translate)
   GET /api/hub-tts?info=1           -> {premium, providers, voices: [language codes voiced here]}

   Providers, tried in order for each request, each falling through to the next on any failure:
   1. Google Cloud Text-to-Speech (official API, Chirp 3 HD voices) when the GOOGLE_TTS_API_KEY Pages secret is set.
      Covers English, Arabic, Turkish, French, German, Spanish, Italian, Chinese, Portuguese, Russian, Japanese, Hindi.
   2. OpenAI speech (official API, gpt-4o-mini-tts) when the OPENAI_API_KEY Pages secret is set. Covers every Aiva
      language, Kurdish Sorani and Persian included.
   Nothing is charged by either until the owner adds its key.
   3. Google's keyless neural voice (the same engine family as the translation endpoint) for the languages it voices.
   Languages neither provider can voice answer 404 {fallback:'device'}, and the app uses the best voice on the device.
   Keys never reach the browser. Replies are cached at the edge so a repeated phrase is not generated twice. */
import { TARGETS } from '../_lib/languages.js';

export const MAX_CHARS = 600;
const GOOGLE = 'https://translate.googleapis.com/translate_tts';
// Languages Google's keyless voice answers (checked: Kurdish Sorani and Persian return 400).
export const GOOGLE_VOICES = new Set(['en', 'ar', 'tr', 'fr', 'de', 'es', 'it', 'zh-CN', 'pt', 'ru', 'ja', 'hi']);
const NAMES = { en: 'British English', ckb: 'Central Kurdish (Sorani), as spoken in Sulaymaniyah and Erbil', ar: 'Arabic',
  tr: 'Turkish', fa: 'Persian (Farsi)', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', 'zh-CN': 'Mandarin Chinese',
  pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', hi: 'Hindi' };
const CACHE_VERSION = 'v2';
// Google Cloud language codes and the Chirp 3 HD voice tried first; without that voice the language default is used.
export const CLOUD_VOICES = { en: 'en-GB', ar: 'ar-XA', tr: 'tr-TR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT',
  'zh-CN': 'cmn-CN', pt: 'pt-PT', ru: 'ru-RU', ja: 'ja-JP', hi: 'hi-IN' };
const CHIRP = 'Chirp3-HD-Aoede';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

function allowed(request) {
  // Audio elements on other sites must not use Aiva as a free voice service.
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return false;
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (hostname === new URL(request.url).hostname) return true;
    if (protocol === 'https:' && /^app\.aivatrading\.uk$|(^|\.)aiva-pocket-hub\.pages\.dev$/.test(hostname)) return true;
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch { return false; }
}

/* Splits text into pieces of at most `max` characters, preferring sentence ends, then commas, then spaces. */
export function chunkText(text, max = 190) {
  const out = [];
  let rest = text.replace(/\s+/g, ' ').trim();
  while (rest.length > max) {
    const slice = rest.slice(0, max + 1);
    let cut = -1;
    for (const re of [/[.!?؟。！？\n](?=\s|$)/g, /[,،;؛:、，](?=\s|$)/g, /\s/g]) {
      let m; while ((m = re.exec(slice))) if (m.index > 0 && m.index < max) cut = m.index + 1;
      if (cut > max * 0.4) break;
    }
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

async function openaiSpeech(text, lang, env, fetcher) {
  const res = await fetcher('https://api.openai.com/v1/audio/speech', {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: env.OPENAI_TTS_VOICE || 'coral', input: text,
      response_format: 'mp3',
      instructions: `Speak in ${NAMES[lang] || lang} with natural native pronunciation and accent, a warm, clear and friendly tone, and a relaxed conversational rhythm with natural pauses. Read the text exactly as written.`
    })
  });
  if (!res.ok) throw new Error(`premium voice ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function cloudSpeech(text, lang, env, fetcher) {
  const languageCode = CLOUD_VOICES[lang];
  const call = async (voice) => {
    const res = await fetcher(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.GOOGLE_TTS_API_KEY)}`, {
      method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000, effectsProfileId: ['handset-class-device'] } })
    });
    if (!res.ok) throw Object.assign(new Error(`cloud voice ${res.status}`), { status: res.status });
    const data = await res.json();
    if (!data?.audioContent) throw new Error('cloud voice: no audio');
    return Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0));
  };
  try { return await call({ languageCode, name: `${languageCode}-${CHIRP}` }); }
  catch (e) { if (e.status !== 400 && e.status !== 404) throw e; return call({ languageCode }); }
}

async function googleSpeech(text, lang, fetcher) {
  const parts = [];
  for (const piece of chunkText(text)) {
    const url = `${GOOGLE}?client=gtx&ie=UTF-8&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(piece)}`;
    const res = await fetcher(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 (Aiva Pocket Hub)' } });
    if (!res.ok) throw new Error(`voice ${res.status}`);
    parts.push(new Uint8Array(await res.arrayBuffer()));
  }
  // MP3 is a stream of independent frames, so the pieces play back to back as one clip.
  const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.byteLength; }
  return all;
}

export async function onRequestGet(context, fetcher = fetch) {
  const { request, env = {} } = context;
  if (!allowed(request)) return json({ error: 'Origin not allowed' }, 403);
  const url = new URL(request.url);
  const cloud = Boolean(env.GOOGLE_TTS_API_KEY), openai = Boolean(env.OPENAI_API_KEY), premium = cloud || openai;
  const chain = (l) => [cloud && CLOUD_VOICES[l] ? 'google-cloud' : '', openai ? 'openai' : '', GOOGLE_VOICES.has(l) ? 'google' : ''].filter(Boolean);
  if (url.searchParams.has('info')) {
    const voices = [...TARGETS].filter((l) => chain(l).length);
    return json({ premium, providers: Object.fromEntries(voices.map((l) => [l, chain(l)])), voices,
      premiumVoices: voices.filter((l) => chain(l)[0] !== 'google') });
  }
  const lang = url.searchParams.get('lang') || '';
  const text = (url.searchParams.get('text') || '').replace(/\s+/g, ' ').trim();
  if (!TARGETS.has(lang)) return json({ error: 'Unsupported language' }, 400);
  if (!text) return json({ error: 'Nothing to read' }, 400);
  if (text.length > MAX_CHARS) return json({ error: `Text is too long (max ${MAX_CHARS} characters)` }, 413);
  const order = chain(lang);
  if (!order.length) return json({ error: 'No natural voice for this language yet', fallback: 'device' }, 404);

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(`https://aiva-tts.cache/${CACHE_VERSION}/${order[0]}/${encodeURIComponent(lang)}?t=${encodeURIComponent(text)}`);
  if (cache) {
    try { const hit = await cache.match(cacheKey); if (hit) return hit; } catch {}
  }

  let audio = null, provider = '';
  const run = { 'google-cloud': () => cloudSpeech(text, lang, env, fetcher), openai: () => openaiSpeech(text, lang, env, fetcher), google: () => googleSpeech(text, lang, fetcher) };
  for (const name of order) {
    try { audio = await run[name](); provider = name; break; } catch {}
  }
  if (!audio || !audio.byteLength) return json({ error: 'The voice service is busy. Using the device voice instead.', fallback: 'device' }, 502);

  const response = new Response(audio, { headers: {
    'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400', 'X-Aiva-Voice': provider,
    'Content-Length': String(audio.byteLength)
  } });
  if (cache) {
    const put = cache.put(cacheKey, response.clone()).catch(() => {});
    if (typeof context.waitUntil === 'function') context.waitUntil(put);
  }
  return response;
}

export function onRequest() {
  return json({ error: 'Method not allowed' }, 405);
}
