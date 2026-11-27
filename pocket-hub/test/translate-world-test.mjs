// Aiva Translate world languages, provider fallback, speech recognition for video, and the video helpers.
// Every upstream call is simulated so this runs offline; the real engines are checked by scripts/verify-languages.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { buildLanguages, CORE, CORE_CODES, WORLD, VARIANTS, TARGETS, SOURCES, STATUS, engineCode } from '../functions/_lib/languages.js';
import { onRequestPost as translate, translateWithFallback } from '../functions/api/hub-translate.js';
import { onRequestGet as ttsGet, OPENAI_VOICES } from '../functions/api/hub-tts.js';
import { onRequestGet as sttInfo, onRequestPost as stt, languageFromWhisper, MAX_AUDIO_BYTES } from '../functions/api/hub-stt.js';
import { onRequestGet as langs } from '../functions/api/hub-languages.js';
import { microsoftCode, fromMicrosoft } from '../functions/_lib/translate-providers.js';

const here = (f) => new URL(f, import.meta.url);

/* ---------- catalogue ---------- */
{
  const all = [...CORE, ...WORLD].map((r) => r[0]);
  assert.equal(new Set(all).size, all.length, 'no duplicate catalogue codes');
  assert.equal(CORE.length, 14);
  assert.deepEqual(CORE_CODES, ['en', 'ckb', 'ar', 'tr', 'fa', 'fr', 'de', 'es', 'it', 'zh-CN', 'pt', 'ru', 'ja', 'hi']);
  for (const c of ['ku', 'yue', 'zh-TW', 'fa-AF', 'ur', 'ps', 'bal']) assert.ok(all.includes(c), `catalogue has ${c}`);
  assert.ok(all.length >= 240, 'world catalogue');
  // Offered = the original 14 plus exactly what the pre-deploy check verified; unverified status offers only the 14.
  const verified = new Set(Array.isArray(STATUS.text) ? STATUS.text : []);
  assert.deepEqual([...TARGETS].filter((c) => !VARIANTS.some((v) => v[0] === c)).sort(), [...new Set([...CORE_CODES, ...WORLD.map((r) => r[0]).filter((c) => verified.has(c))])].sort());
  assert.deepEqual([...buildLanguages({ text: null }).targets].filter((c) => !VARIANTS.some((v) => v[0] === c)).sort(), [...CORE_CODES].sort());
  assert.ok(SOURCES.has('auto') && !TARGETS.has('auto'));
  // Once verified, every passing language is offered and failing ones are not; core languages are never removed.
  const b = buildLanguages({ text: ['en', 'ku', 'yue', 'sw'] });
  for (const c of [...CORE_CODES, 'ku', 'yue', 'sw']) assert.ok(b.targets.has(c), c);
  assert.ok(!b.targets.has('yo'), 'unverified language not offered');
  assert.ok(b.targets.has('ar-EG') && b.engine['ar-EG'] === 'ar', 'Arabic dialect entries translate through Arabic');
  assert.ok(b.targets.has('sw-TZ') && !buildLanguages({ text: [] }).targets.has('sw-TZ'), 'dialect follows its base');
  assert.equal(engineCode('ar-IQ'), 'ar'); assert.equal(engineCode('auto'), 'auto'); assert.equal(engineCode('ckb'), 'ckb');
}

/* ---------- translation providers ---------- */
const reqT = (body) => new Request('https://app.aivatrading.uk/api/hub-translate', { method: 'POST', body: JSON.stringify(body), headers: { Origin: 'https://app.aivatrading.uk' } });
const recorder = (handler) => { const calls = []; const f = async (u, init = {}) => { calls.push({ url: String(u), init }); return handler(String(u), init); }; f.calls = calls; return f; };
{
  // A dialect entry asks the engine for its base language.
  let up = recorder(() => Response.json([['مرحبا', 'en']]));
  let r = await translate({ request: reqT({ text: 'Hello', source: 'en', target: 'ar-EG' }) }, up);
  assert.equal(r.status, 200); assert.match(up.calls[0].url, /sl=en&tl=ar&/);
  // An unchecked language is refused rather than sent.
  const unchecked = WORLD.map((x) => x[0]).find((c) => !TARGETS.has(c)) || 'not-a-language';
  r = await translate({ request: reqT({ text: 'Hello', source: 'en', target: unchecked }) }, up);
  assert.equal(r.status, 400);
  // Fallback: official Google Cloud first when keyed, then keyless, then Microsoft.
  up = recorder((u) => (u.includes('translation.googleapis.com') ? new Response('{}', { status: 500 })
    : u.includes('translate.googleapis.com') ? new Response('busy', { status: 503 })
    : Response.json([{ detectedLanguage: { language: 'en' }, translations: [{ text: 'سڵاو', to: 'ku' }] }])));
  const out = await translateWithFallback('Hello', 'en', 'ckb', { GOOGLE_TRANSLATE_API_KEY: 'g', AZURE_TRANSLATOR_KEY: 'm', AZURE_TRANSLATOR_REGION: 'uksouth' }, up);
  assert.equal(out.provider, 'microsoft'); assert.equal(out.translation, 'سڵاو');
  assert.deepEqual(up.calls.map((c) => new URL(c.url).hostname), ['translation.googleapis.com', 'translate.googleapis.com', 'api.cognitive.microsofttranslator.com']);
  assert.match(up.calls[2].url, /to=ku&from=en/, 'Sorani is "ku" at Microsoft');
  assert.equal(up.calls[2].init.headers['Ocp-Apim-Subscription-Region'], 'uksouth');
  // Official Google Cloud answer is used when it works.
  up = recorder(() => Response.json({ data: { translations: [{ translatedText: 'Merhaba', detectedSourceLanguage: 'en' }] } }));
  assert.equal((await translateWithFallback('Hello', 'auto', 'tr', { GOOGLE_TRANSLATE_API_KEY: 'g' }, up)).provider, 'google-cloud');
  assert.ok(!JSON.parse(up.calls[0].init.body).source, 'auto detect sends no source');
  // Without keys only the keyless engine is called, and its failure is reported (no invented text).
  up = recorder(() => new Response('x', { status: 503 }));
  r = await translate({ request: reqT({ text: 'Hello', source: 'en', target: 'ar' }), env: {} }, up);
  assert.equal(r.status, 502); assert.equal(up.calls.length, 1);
  assert.equal(microsoftCode('ku'), 'kmr'); assert.equal(microsoftCode('zh-CN'), 'zh-Hans'); assert.equal(microsoftCode('bal'), '');
  assert.equal(fromMicrosoft('zh-Hans'), 'zh-CN'); assert.equal(fromMicrosoft('kmr'), 'ku');
}

/* ---------- voices ---------- */
{
  const req = (qs) => new Request(`https://app.aivatrading.uk/api/hub-tts?${qs}`);
  // A dialect entry is voiced in its base language.
  const up = recorder(() => new Response(new Uint8Array(2000), { headers: { 'Content-Type': 'audio/mpeg' } }));
  const r = await ttsGet({ request: req('lang=ar-EG&text=' + encodeURIComponent('مرحبا')), env: {} }, up);
  assert.equal(r.status, 200); assert.match(up.calls[0].url, /tl=ar&/);
  // OpenAI is only offered for languages OpenAI lists (plus the original 14, as before).
  assert.ok(OPENAI_VOICES.has('ckb') && OPENAI_VOICES.has('sw') && !OPENAI_VOICES.has('bal'));
}

/* ---------- speech recognition for video ---------- */
const reqS = (qs, body, headers = {}) => new Request(`https://app.aivatrading.uk/api/hub-stt?${qs}`, { method: 'POST', body, headers: { Origin: 'https://app.aivatrading.uk', ...headers } });
const audio = new Uint8Array(5000);
{
  // Not switched on: says so, never pretends.
  let r = await sttInfo({ request: new Request('https://app.aivatrading.uk/api/hub-stt?info=1'), env: {} });
  assert.deepEqual((await r.json()).available, false);
  r = await stt({ request: reqS('lang=auto', audio), env: {} });
  assert.equal(r.status, 503);
  // Workers AI: segments and detected language come back normalised.
  let seen = null;
  const AI = { run: async (model, input) => { seen = { model, input }; return { text: 'مرحبا كيف حالك', transcription_info: { language: 'ar', language_probability: 0.97, duration: 3 }, segments: [{ start: 0.2, end: 1.4, text: ' مرحبا ' }, { start: 1.5, end: 2.9, text: 'كيف حالك' }] }; } };
  r = await stt({ request: reqS('lang=auto', audio), env: { AI } });
  let d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.provider, 'workers-ai'); assert.equal(d.language, 'ar'); assert.equal(d.segments.length, 2);
  assert.equal(d.segments[0].text, 'مرحبا'); assert.equal(seen.model, '@cf/openai/whisper-large-v3-turbo'); assert.equal(typeof seen.input.audio, 'string');
  assert.ok(!('language' in seen.input), 'auto detect sends no language');
  assert.equal(r.headers.get('Cache-Control'), 'no-store', 'audio results are never cached');
  // A chosen language is passed as a Whisper hint (Hebrew is "iw" in Aiva, "he" in Whisper).
  await stt({ request: reqS('lang=ar', audio), env: { AI } }); assert.equal(seen.input.language, 'ar');
  // Kurdish Sorani cannot be recognised by Whisper: honest refusal.
  r = await stt({ request: reqS('lang=ckb', audio), env: { AI } }); assert.equal(r.status, 400);
  // Workers AI failure falls back to OpenAI's API.
  const failing = { run: async () => { throw new Error('limit'); } };
  const up = recorder(() => Response.json({ text: 'hello there', language: 'english', duration: 2, segments: [{ start: 0, end: 2, text: 'hello there' }] }));
  r = await stt({ request: reqS('lang=auto', audio), env: { AI: failing, OPENAI_API_KEY: 'k' } }, up);
  d = await r.json(); assert.equal(d.provider, 'openai'); assert.equal(d.language, 'en');
  assert.equal(up.calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  // Limits, origin and kill switch.
  r = await stt({ request: reqS('lang=auto', new Uint8Array(MAX_AUDIO_BYTES + 1)), env: { AI } }); assert.equal(r.status, 413);
  r = await stt({ request: reqS('lang=auto', new Uint8Array(10)), env: { AI } }); assert.equal(r.status, 400);
  r = await stt({ request: reqS('lang=auto', audio, { Origin: 'https://evil.example' }), env: { AI } }); assert.equal(r.status, 403);
  r = await stt({ request: reqS('lang=auto', audio), env: { AI, AIVA_STT_ENABLED: 'false' } }); assert.equal(r.status, 503);
  assert.equal(languageFromWhisper('Persian'), 'fa'); assert.equal(languageFromWhisper('he'), 'iw'); assert.equal(languageFromWhisper(''), '');
}

/* ---------- language list endpoint ---------- */
{
  let d = await (await langs({ request: new Request('https://app.aivatrading.uk/api/hub-languages'), env: {} })).json();
  assert.equal(d.counts.text, [...TARGETS].filter((c) => !VARIANTS.some((v) => v[0] === c)).length); assert.equal(d.counts.video, 0); assert.equal(d.signLanguage, false);
  assert.ok(d.languages.every((l) => l.text && !l.video));
  const ckb = d.languages.find((l) => l.code === 'ckb');
  assert.equal(ckb.voiceIn, false, 'no browser publishes a Sorani recogniser: not advertised');
  d = await (await langs({ request: new Request('https://app.aivatrading.uk/api/hub-languages'), env: { AI: { run() {} } } })).json();
  assert.ok(d.counts.video > 0 && !d.languages.find((l) => l.code === 'ckb').video);
  assert.equal(d.counts.text, d.languages.filter((l) => !l.variant).length);
}

/* ---------- 3-minute recorder untouched ---------- */
{
  const voice = readFileSync(here('../public/aiva-voice.js'), 'utf8');
  assert.match(voice, /const MAX_MS = 180000;/);
  let unchanged = true;
  try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'public/aiva-voice.js'], { cwd: new URL('..', import.meta.url) }); } catch { unchanged = false; }
  assert.ok(unchanged, 'aiva-voice.js (3-minute recording) is not modified');
  const html = readFileSync(here('../public/index.html'), 'utf8');
  assert.match(html, /src="aiva-langs\.js"/); assert.match(html, /src="aiva-video\.js"/);
  assert.ok(html.indexOf('src="app.js"') < html.indexOf('src="aiva-langs.js"'));
  assert.match(readFileSync(here('../public/_headers'), 'utf8'), /microphone=\(self\).*camera=\(self\)/);
  assert.match(readFileSync(here('../public/service-worker.js'), 'utf8'), /'\.\/aiva-video\.js'/);
}

/* ---------- video helpers (run in a sandbox) ---------- */
{
  const ctx = { window: {}, document: { readyState: 'complete', getElementById: () => null, addEventListener() {} }, Blob, URL, console };
  ctx.window = ctx; ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(here('../public/aiva-video.js'), 'utf8'), ctx);
  const { wav, clips, srt, vtt, ts } = ctx.AivaVideo._test;
  const s = new Float32Array(16000 * 75); // 75 s
  for (let i = 0; i < s.length; i++) s[i] = Math.sin(i / 8) * 0.3;
  s.fill(0, 16000 * 27, 16000 * 27.5); // a pause at 27 s
  const parts = clips(s);
  assert.equal(parts.length, 3);
  assert.ok(Math.abs(parts[1].offset - 27.25) < 0.3, 'clip ends in the pause');
  assert.equal(parts.reduce((n, p) => n + p.data.length, 0), s.length, 'no audio lost between clips');
  assert.ok(parts.every((p) => p.data.length <= 30 * 16000));
  const blob = wav(parts[0].data);
  assert.equal(blob.size, 44 + parts[0].data.length * 2);
  assert.ok(blob.size < MAX_AUDIO_BYTES, 'a clip fits the server limit');
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  assert.equal(String.fromCharCode(...head.slice(0, 4)), 'RIFF');
  assert.equal(ts(3723.456, ','), '01:02:03,456');
  const cues = [{ start: 0.5, end: 2, translated: 'Hello', original: 'Hola' }];
  assert.equal(srt(cues, 'translated'), '1\n00:00:00,500 --> 00:00:02,000\nHello\n');
  assert.match(vtt(cues, 'original'), /^WEBVTT\n\n1\n00:00:00\.500 --> 00:00:02\.000\nHola\n/);
}

/* ---------- pre-deploy language check (engine simulated) ---------- */
{
  const stub = new URL('data:text/javascript,' + encodeURIComponent(`
    globalThis.fetch = async (u) => { u = String(u);
      const tl = new URL(u).searchParams.get('tl');
      if (u.includes('translate_tts')) return tl === 'ckb' || tl === 'bal' ? new Response('', { status: 400 }) : new Response(new Uint8Array(3000), { headers: { 'Content-Type': 'audio/mpeg' } });
      if (tl === 'zap' || tl === 'iu-Latn') return new Response('bad', { status: 400 });
      return Response.json([['translated:' + tl, 'en']]);
    };`));
  const out = execFileSync(process.execPath, ['--import', stub.href, new URL('../scripts/verify-languages.mjs', import.meta.url).pathname, '--dry-run'], { encoding: 'utf8', timeout: 120000 });
  assert.match(out, /Not offered[\s\S]*zap/);
  const json = JSON.parse(out.match(/export const STATUS = (.*);/)[1]);
  assert.ok(json.text.includes('ckb') && json.text.includes('ku') && !json.text.includes('zap') && !json.text.includes('iu-Latn'));
  assert.ok(!json.voice.includes('ckb') && json.voice.includes('sw') && json.failedVoice.includes('bal'));
}

console.log('AIVA TRANSLATE WORLD LANGUAGE CHECKS PASSED');
