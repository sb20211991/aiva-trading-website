/* POST /api/hub-stt?lang=<code|auto>   body: one audio clip (16 kHz mono WAV, at most 45 seconds)
     -> {text, language, probability, segments:[{start,end,text}], provider}
   GET  /api/hub-stt?info=1 -> {available, providers, languages}

   Speech recognition for Aiva video translation and live camera captions. The app extracts the audio track on the
   phone and sends it here in short clips; the video itself never leaves the device.
   Providers, tried in order, each falling through to the next:
   1. OpenAI Whisper large-v3-turbo on Cloudflare Workers AI (AI binding in wrangler.toml).
   2. OpenAI's own transcription API (whisper-1) when the OPENAI_API_KEY Pages secret is set.
   With neither, the endpoint says so (available:false) and the app keeps video translation closed: nothing is invented.
   Audio is processed in memory only: it is never cached, stored or logged by Aiva. AIVA_STT_ENABLED="false" turns
   the endpoint off. */
import { LANGUAGES, WHISPER, engineCode, TARGETS } from '../_lib/languages.js';

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 45 s of 16 kHz 16-bit mono WAV is ~1.4 MB
const MODEL = '@cf/openai/whisper-large-v3-turbo';
const NAME_TO_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.name.toLowerCase(), l.engine]));
// Whisper language codes for the engine codes it recognises (engine -> whisper)
const TO_WHISPER = Object.fromEntries(Object.entries(WHISPER).filter(([k]) => k.length <= 3).map(([w, g]) => [g, w]));

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

function allowed(request) {
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

export function providers(env = {}) {
  if (env.AIVA_STT_ENABLED === 'false') return [];
  return [env.AI && typeof env.AI.run === 'function' ? 'workers-ai' : '', env.OPENAI_API_KEY ? 'openai' : ''].filter(Boolean);
}
/* Engine code for whatever a provider reports (ISO code or English name). */
export function languageFromWhisper(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  return WHISPER[v] || NAME_TO_CODE[v] || '';
}
/* Engine codes the recogniser can listen to. */
export const RECOGNISED = [...new Set(Object.values(WHISPER))].filter((c) => TARGETS.has(c) || LANGUAGES.some((l) => l.engine === c));

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const clean = (segments) => (Array.isArray(segments) ? segments : [])
  .map((s) => ({ start: Math.max(0, Number(s.start) || 0), end: Math.max(0, Number(s.end) || 0), text: String(s.text || '').trim() }))
  .filter((s) => s.text && s.end >= s.start);

async function workersAI(audio, hint, env) {
  const input = { audio: toBase64(audio), vad_filter: true };
  if (hint) input.language = hint;
  const out = await env.AI.run(MODEL, input);
  const text = String(out?.text || '').trim();
  const info = out?.transcription_info || {};
  return { text, language: languageFromWhisper(info.language) || (hint ? WHISPER[hint] : ''), probability: Number(info.language_probability) || null,
    segments: clean(out?.segments).length ? clean(out.segments) : (text ? [{ start: 0, end: Number(info.duration) || 0, text }] : []) };
}

async function openai(audio, hint, env, fetcher) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'clip.wav');
  form.append('model', env.OPENAI_STT_MODEL || 'whisper-1');
  form.append('response_format', 'verbose_json');
  if (hint) form.append('language', hint);
  const res = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', body: form, signal: AbortSignal.timeout(40000), headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const d = await res.json();
  const text = String(d?.text || '').trim();
  return { text, language: languageFromWhisper(d?.language) || (hint ? WHISPER[hint] : ''), probability: null,
    segments: clean(d?.segments).length ? clean(d.segments) : (text ? [{ start: 0, end: Number(d?.duration) || 0, text }] : []) };
}

export async function onRequestGet({ request, env = {} }) {
  if (!allowed(request)) return json({ error: 'Origin not allowed' }, 403);
  const list = providers(env);
  return json({ available: list.length > 0, providers: list, languages: RECOGNISED, maxSeconds: 45 });
}

export async function onRequestPost({ request, env = {} }, fetcher = fetch) {
  if (!allowed(request)) return json({ error: 'Origin not allowed' }, 403);
  const list = providers(env);
  if (!list.length) return json({ error: 'Speech recognition for video is not switched on yet.', available: false }, 503);
  const url = new URL(request.url);
  const asked = url.searchParams.get('lang') || 'auto';
  let hint = '';
  if (asked !== 'auto') {
    hint = TO_WHISPER[engineCode(asked)] || '';
    if (!hint) return json({ error: 'This language cannot be recognised from speech yet. Choose "Detect automatically" or another language.' }, 400);
  }
  if (Number(request.headers.get('Content-Length')) > MAX_AUDIO_BYTES) return json({ error: 'Audio clip is too long' }, 413);
  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.byteLength > MAX_AUDIO_BYTES) return json({ error: 'Audio clip is too long' }, 413);
  if (audio.byteLength < 1000) return json({ error: 'No audio was received' }, 400);

  for (const name of list) {
    try {
      const out = name === 'workers-ai' ? await workersAI(audio, hint, env) : await openai(audio, hint, env, fetcher);
      return json({ ...out, provider: name });
    } catch {}
  }
  return json({ error: 'The speech recognition service is busy. Please try again shortly.' }, 502);
}

export function onRequest() {
  return json({ error: 'Method not allowed' }, 405);
}
