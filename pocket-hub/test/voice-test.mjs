// Aiva Translate voice upgrade: natural voice endpoint, 3-minute continuous recorder, voice choice and helpers.
// Every upstream call and every browser API is simulated, so this runs offline and deterministically.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { onRequestGet as tts, chunkText, GOOGLE_VOICES, MAX_CHARS } from '../functions/api/hub-tts.js';
import { TARGETS } from '../functions/_lib/languages.js';

const pub = (f) => new URL(`../public/${f}`, import.meta.url);

/* ---------- /api/hub-tts ---------- */
const req = (qs, headers = {}) => new Request(`https://app.aivatrading.uk/api/hub-tts?${qs}`, { headers });
const mp3 = (tag) => new Response(new TextEncoder().encode(tag), { headers: { 'Content-Type': 'audio/mpeg' } });
function upstream(handler) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init, calls.length); };
  f.calls = calls;
  return f;
}

{
  // Without a premium key: the keyless neural voice covers its languages; Kurdish Sorani and Persian go to the device.
  let r = await tts({ request: req('info=1'), env: {} });
  let d = await r.json();
  assert.equal(d.premium, false);
  assert.ok(d.voices.includes('ar') && d.voices.includes('en'));
  assert.ok(!d.voices.includes('ckb') && !d.voices.includes('fa'));
  for (const l of d.voices) assert.ok(TARGETS.has(l));

  // With the premium key every Aiva language, Kurdish Sorani included, gets the natural AI voice.
  d = await (await tts({ request: req('info=1'), env: { OPENAI_API_KEY: 'sk-test' } })).json();
  assert.equal(d.premium, true);
  assert.deepEqual(d.voices.sort(), [...TARGETS].sort());

  // Arabic through the keyless voice.
  let up = upstream(() => mp3('AR'));
  r = await tts({ request: req('lang=ar&text=' + encodeURIComponent('كم السعر؟')), env: {} }, up);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(r.headers.get('X-Aiva-Voice'), 'google');
  assert.equal(new TextDecoder().decode(await r.arrayBuffer()), 'AR');
  assert.match(up.calls[0].url, /^https:\/\/translate\.googleapis\.com\/translate_tts\?client=gtx&ie=UTF-8&tl=ar&q=/);

  // Long text is spoken in pieces and joined into one clip.
  const long = Array.from({ length: 20 }, (_, i) => `This is sentence number ${i + 1}.`).join(' ');
  assert.ok(long.length <= MAX_CHARS);
  up = upstream((u, i, n) => mp3(`#${n}`));
  r = await tts({ request: req('lang=en&text=' + encodeURIComponent(long)), env: {} }, up);
  const joined = new TextDecoder().decode(await r.arrayBuffer());
  assert.ok(up.calls.length >= 4, 'split into several requests');
  assert.equal(joined, up.calls.map((_, i) => `#${i + 1}`).join(''));
  for (const c of up.calls) assert.ok(decodeURIComponent(new URL(c.url).searchParams.get('q')).length <= 190);

  // Kurdish Sorani without a premium key: honest device fallback, no upstream call.
  up = upstream(() => mp3('x'));
  r = await tts({ request: req('lang=ckb&text=' + encodeURIComponent('سڵاو')), env: {} }, up);
  assert.equal(r.status, 404); assert.equal((await r.json()).fallback, 'device'); assert.equal(up.calls.length, 0);

  // Premium voice: OpenAI speech with natural-voice instructions for Kurdish Sorani.
  up = upstream(() => mp3('CKB'));
  r = await tts({ request: req('lang=ckb&text=' + encodeURIComponent('سڵاو، چۆنی؟')), env: { OPENAI_API_KEY: 'sk-test' } }, up);
  assert.equal(r.status, 200); assert.equal(r.headers.get('X-Aiva-Voice'), 'openai');
  assert.equal(up.calls[0].url, 'https://api.openai.com/v1/audio/speech');
  const body = JSON.parse(up.calls[0].init.body);
  assert.equal(body.model, 'gpt-4o-mini-tts'); assert.equal(body.input, 'سڵاو، چۆنی؟');
  assert.match(body.instructions, /Sorani/); assert.match(body.instructions, /natural native pronunciation/);
  assert.equal(up.calls[0].init.headers.Authorization, 'Bearer sk-test');

  // Premium outage: Arabic falls back to the keyless voice, Kurdish reports the device fallback.
  up = upstream((u) => (u.includes('openai') ? new Response('no', { status: 500 }) : mp3('AR2')));
  r = await tts({ request: req('lang=ar&text=hi'), env: { OPENAI_API_KEY: 'sk-test' } }, up);
  assert.equal(r.status, 200); assert.equal(r.headers.get('X-Aiva-Voice'), 'google');
  r = await tts({ request: req('lang=ckb&text=hi'), env: { OPENAI_API_KEY: 'sk-test' } }, up);
  assert.equal(r.status, 502); assert.equal((await r.json()).fallback, 'device');

  // Google Cloud Text-to-Speech (official): Chirp 3 HD voice first, language default if that voice is not offered.
  const b64 = (t) => Buffer.from(t).toString('base64');
  up = upstream((u, init) => {
    if (u.startsWith('https://texttospeech.googleapis.com/')) return Response.json({ audioContent: b64('CLOUD') });
    return mp3('OTHER');
  });
  r = await tts({ request: req('lang=ar&text=' + encodeURIComponent('أهلاً')), env: { GOOGLE_TTS_API_KEY: 'g-key', OPENAI_API_KEY: 'sk' } }, up);
  assert.equal(r.headers.get('X-Aiva-Voice'), 'google-cloud');
  assert.equal(new TextDecoder().decode(await r.arrayBuffer()), 'CLOUD');
  assert.match(up.calls[0].url, /text:synthesize\?key=g-key$/);
  let cb = JSON.parse(up.calls[0].init.body);
  assert.deepEqual([cb.voice.languageCode, cb.voice.name, cb.audioConfig.audioEncoding], ['ar-XA', 'ar-XA-Chirp3-HD-Aoede', 'MP3']);
  up = upstream((u, init) => JSON.parse(init.body || '{}').voice?.name ? new Response('{}', { status: 400 }) : Response.json({ audioContent: b64('DEFAULT') }));
  r = await tts({ request: req('lang=tr&text=Merhaba'), env: { GOOGLE_TTS_API_KEY: 'g-key' } }, up);
  assert.equal(new TextDecoder().decode(await r.arrayBuffer()), 'DEFAULT');
  assert.equal(JSON.parse(up.calls[1].init.body).voice.name, undefined);
  // Automatic fallback: Google Cloud down -> OpenAI -> keyless voice.
  up = upstream((u) => u.includes('texttospeech') ? new Response('', { status: 503 }) : u.includes('openai') ? mp3('OAI') : mp3('FREE'));
  r = await tts({ request: req('lang=fr&text=Bonjour'), env: { GOOGLE_TTS_API_KEY: 'g', OPENAI_API_KEY: 'sk' } }, up);
  assert.deepEqual([r.headers.get('X-Aiva-Voice'), new TextDecoder().decode(await r.arrayBuffer())], ['openai', 'OAI']);
  up = upstream((u) => u.includes('texttospeech') || u.includes('openai') ? new Response('', { status: 500 }) : mp3('FREE'));
  r = await tts({ request: req('lang=fr&text=Bonjour'), env: { GOOGLE_TTS_API_KEY: 'g', OPENAI_API_KEY: 'sk' } }, up);
  assert.deepEqual([r.headers.get('X-Aiva-Voice'), new TextDecoder().decode(await r.arrayBuffer())], ['google', 'FREE']);
  // Kurdish Sorani skips Google Cloud (no Sorani voice there) and goes straight to OpenAI.
  up = upstream((u) => u.includes('openai') ? mp3('CKB') : mp3('WRONG'));
  r = await tts({ request: req('lang=ckb&text=' + encodeURIComponent('سڵاو')), env: { GOOGLE_TTS_API_KEY: 'g', OPENAI_API_KEY: 'sk' } }, up);
  assert.equal(up.calls.length, 1); assert.equal(r.headers.get('X-Aiva-Voice'), 'openai');
  d = await (await tts({ request: req('info=1'), env: { GOOGLE_TTS_API_KEY: 'g', OPENAI_API_KEY: 'sk' } })).json();
  assert.deepEqual(d.providers.ar, ['google-cloud', 'openai', 'google']); assert.deepEqual(d.providers.ckb, ['openai']);
  assert.equal(d.premiumVoices.length, TARGETS.size);
  d = await (await tts({ request: req('info=1'), env: { GOOGLE_TTS_API_KEY: 'g' } })).json();
  assert.ok(!d.voices.includes('ckb')); assert.deepEqual(d.providers.en, ['google-cloud', 'google']);

  // Validation and abuse protection.
  assert.equal((await tts({ request: req('lang=xx&text=hi'), env: {} }, upstream(() => mp3('')))).status, 400);
  assert.equal((await tts({ request: req('lang=ar&text=%20'), env: {} }, upstream(() => mp3('')))).status, 400);
  assert.equal((await tts({ request: req('lang=ar&text=' + 'a'.repeat(MAX_CHARS + 1)), env: {} }, upstream(() => mp3('')))).status, 413);
  assert.equal((await tts({ request: req('lang=ar&text=hi', { 'Sec-Fetch-Site': 'cross-site' }), env: {} }, upstream(() => mp3('')))).status, 403);
  assert.equal((await tts({ request: req('lang=ar&text=hi', { Origin: 'https://evil.example' }), env: {} }, upstream(() => mp3('')))).status, 403);
  assert.equal((await tts({ request: req('lang=ar&text=hi'), env: {} }, upstream(() => new Response('', { status: 503 })))).status, 502);
  assert.equal((await tts({ request: req('lang=ar&text=hi'), env: {} }, async () => { throw new TypeError('down'); })).status, 502);

  // Chunking keeps every piece within the limit and loses no words.
  const words = 'نرخی ئەم کاڵایە چەندە؟ '.repeat(40);
  const parts = chunkText(words);
  assert.ok(parts.every((p) => p.length <= 190));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), words.trim());
  assert.ok(!GOOGLE_VOICES.has('ckb') && !GOOGLE_VOICES.has('fa'));
}

/* ---------- Browser engine (public/aiva-voice.js) in a simulated browser ---------- */
function browser({ unprefixed = false } = {}) {
  let now = 1_000_000, nextId = 1;
  const timers = new Map();
  const add = (fn, ms, every) => { const id = nextId++; timers.set(id, { fn, at: now + Math.max(0, ms || 0), every }); return id; };
  const clock = {
    now: () => now,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let due = null;
        for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due[1].at)) due = [id, t];
        if (!due) break;
        const [id, t] = due;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
      }
      now = end;
    }
  };
  const recs = [];
  class FakeRecognition {
    constructor() { recs.push(this); this.started = false; this.results = []; }
    start(track) { if (this.started) throw new Error('InvalidStateError'); this.started = true; this.track = track; add(() => this.onstart && this.onstart(), 0); }
    stop() { add(() => this.end(), 300); }
    abort() { this.aborted = true; }
    say(text, final = true) { const r = Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: final }); if (this.results.length && !this.results.at(-1).isFinal) this.results[this.results.length - 1] = r; else this.results.push(r); this.onresult && this.onresult({ results: this.results }); }
    end() { if (this.ended) return; this.ended = true; this.onend && this.onend(); }
    error(code) { this.onerror && this.onerror({ error: code }); }
  }
  const win = {
    setTimeout: (fn, ms) => add(fn, ms), clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => add(fn, ms, ms), clearInterval: (id) => timers.delete(id),
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140', language: 'en-GB' },
    webkitSpeechRecognition: FakeRecognition, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    fetch: async () => ({ ok: false })
  };
  if (unprefixed) win.SpeechRecognition = FakeRecognition;
  const ctx = vm.createContext({ window: win, Date: { now: () => now }, console, Math, Number, String, Array, Object, Set, Map, Promise, Uint8Array, DataView, encodeURIComponent, JSON });
  vm.runInContext(readFileSync(pub('aiva-voice.js'), 'utf8'), ctx, { filename: 'aiva-voice.js' });
  return { AV: win.AivaVoice, clock, recs, win };
}

for (const lang of ['en-GB', 'ckb-IQ', 'ar-SA']) {
  // Same 3-minute session in each direction / language a conversation uses.
  const { AV, clock, recs } = browser();
  let ended = null;
  const rec = AV.createRecorder({ onEnd: (r) => { ended = r; } });
  await rec.start({ lang }); clock.advance(10);
  for (let t = 0; t < 175000; t += 25000) { const r = recs.at(-1); r.say(`part ${t / 1000}`, true); clock.advance(12000); r.error('no-speech'); r.end(); clock.advance(13000); }
  assert.equal(rec.state(), 'listening', `${lang}: still recording at ${clock.now() - 1_000_010} ms`);
  clock.advance(6000);
  assert.ok(ended && ended.limit && ended.ms === 180000, `${lang}: stopped at 03:00`);
  assert.ok(recs.every((r) => r.lang === lang));
  console.log(`180-second recording in ${lang}: ${recs.length} sessions, stopped at ${ended.ms / 1000}s, text "${ended.text.slice(0, 40)}…"`);
}

{
  const { AV, clock, recs } = browser();
  assert.equal(AV.MAX_MS, 180000);
  const ticks = [], states = [];
  let ended = null, live = '';
  const rec = AV.createRecorder({ onTick: (ms) => ticks.push(ms), onState: (s) => states.push(s), onText: (t) => { live = t; }, onEnd: (r) => { ended = r; } });
  await rec.start({ lang: 'ckb-IQ' });
  clock.advance(10);
  assert.equal(rec.state(), 'listening');
  assert.equal(recs[0].lang, 'ckb-IQ'); assert.equal(recs[0].continuous, true); assert.equal(recs[0].interimResults, true);

  // A full 3-minute session with natural pauses: the browser ends a session on each pause and Aiva restarts it.
  const phrases = ['Hello, I would like a quotation', 'for five hundred solar panels', 'delivered to Erbil', 'by the end of next month', 'please include shipping'];
  let t = 0;
  for (const [i, p] of phrases.entries()) {
    const r = recs.at(-1);
    r.say(p.split(' ').slice(0, 2).join(' '), false);           // interim words appear live
    clock.advance(4000); t += 4000;
    r.say(p, true);
    clock.advance(6000); t += 6000;                               // long pause: no-speech, then the session ends
    r.error('no-speech'); r.end();
    clock.advance(200); t += 200;
    assert.equal(rec.state(), 'listening', `still listening after pause ${i + 1}`);
  }
  assert.equal(recs.length, phrases.length + 1, 'one new session per pause');
  assert.equal(live, phrases.join(' '));
  // Keep going until the 3-minute limit stops the microphone by itself.
  clock.advance(180000 - t - 1000);
  assert.equal(rec.state(), 'listening', 'still recording just before 03:00');
  const before = ticks.at(-1);
  assert.ok(before >= 178000 && before < 180000, `timer shows ${before}`);
  clock.advance(1250);
  assert.equal(rec.state(), 'stopping', 'stops itself at 03:00');
  clock.advance(400);
  assert.equal(rec.state(), 'idle');
  assert.ok(ended && ended.limit === true && !ended.cancelled && !ended.error);
  assert.equal(ended.text, phrases.join(' '));
  assert.equal(ended.ms, 180000);
  assert.equal(Math.max(...ticks), 180000);
  assert.ok(ticks.length >= 710, 'timer updated four times a second');
  console.log(`180-second simulated recording: ${phrases.length} pauses survived, ${recs.length} sessions, stopped at ${ended.ms / 1000}s, ${ended.text.split(' ').length} words kept`);
}

{
  // Stop flushes the last words; Cancel discards everything.
  const { AV, clock, recs } = browser();
  let ended = null;
  const rec = AV.createRecorder({ onEnd: (r) => { ended = r; } });
  await rec.start({ lang: 'ar-SA' }); clock.advance(10);
  recs[0].say('مرحبا', true); recs[0].say('كيف حالك', false);
  rec.stop();
  assert.equal(rec.state(), 'stopping');
  clock.advance(400);
  assert.equal(ended.text, 'مرحبا كيف حالك'); assert.equal(ended.limit, false);

  ended = null;
  await rec.start({ lang: 'en-GB' }); clock.advance(10);
  recs.at(-1).say('do not keep this', true);
  rec.cancel();
  assert.equal(rec.state(), 'idle');
  assert.deepEqual([ended.text, ended.cancelled], ['', true]);

  // A hard error with no speech is reported; blocked microphone does not loop.
  ended = null;
  await rec.start({ lang: 'en-GB' }); clock.advance(10);
  recs.at(-1).error('not-allowed'); recs.at(-1).end();
  assert.equal(ended.error, 'not-allowed'); assert.equal(rec.state(), 'idle');
  const sessions = recs.length; clock.advance(5000); assert.equal(recs.length, sessions);

  // A browser that ends sessions instantly cannot spin forever.
  ended = null;
  await rec.start({ lang: 'en-GB' });
  for (let i = 0; i < 20 && rec.state() !== 'idle'; i++) { clock.advance(10); recs.at(-1).end(); clock.advance(100); }
  assert.equal(rec.state(), 'idle'); assert.equal(ended.error, 'restart-loop');

  // Starting one recorder cancels another (only one microphone user at a time).
  let a = null, b = null;
  const ra = AV.createRecorder({ onEnd: (r) => { a = r; } }), rb = AV.createRecorder({ onEnd: (r) => { b = r; } });
  await ra.start({ lang: 'en-GB' }); clock.advance(10);
  await rb.start({ lang: 'ar-SA' }); clock.advance(10);
  assert.equal(a.cancelled, true); assert.equal(rb.state(), 'listening'); rb.cancel();
}

{
  // Chrome with the unprefixed API gets a noise-suppressed, echo-cancelled microphone track.
  const { AV, clock, recs, win } = browser({ unprefixed: true });
  let constraints = null, stopped = 0;
  const track = { stop: () => { stopped++; } };
  win.navigator.mediaDevices = { getUserMedia: async (c) => { constraints = c; return { getAudioTracks: () => [track], getTracks: () => [track] }; } };
  const rec = AV.createRecorder({ onEnd() {} });
  await rec.start({ lang: 'en-GB' }); clock.advance(10);
  assert.deepEqual(JSON.parse(JSON.stringify(constraints.audio)), { noiseSuppression: true, echoCancellation: true, autoGainControl: true, channelCount: 1 });
  assert.equal(recs[0].track, track);
  rec.cancel(); assert.equal(stopped, 1, 'microphone released');
}

{
  // Helpers: Android duplicate finals, voice choice, text splitting, clock.
  const { AV } = browser();
  const { collect, splitText, pickVoice, clock } = AV._test;
  const fin = (t) => Object.assign([{ transcript: t }], { isFinal: true });
  assert.equal(collect([fin('hello'), fin('hello how are'), fin('hello how are you')]).fin, 'hello how are you');
  assert.equal(collect([fin('hello'), fin('world')]).fin, 'hello world');
  const voices = [
    { name: 'Albert', lang: 'en-US' }, { name: 'Daniel (Compact)', lang: 'en-GB', localService: true },
    { name: 'Microsoft Sonia Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false },
    { name: 'Google UK English Female', lang: 'en-GB' }, { name: 'Maged', lang: 'ar-SA' }, { name: 'Dariush', lang: 'fa-IR' }
  ];
  assert.match(pickVoice(voices, 'en').voice.name, /Natural/);
  assert.deepEqual([pickVoice(voices, 'ar').voice.name, pickVoice(voices, 'ar').approx], ['Maged', false]);
  assert.deepEqual([pickVoice(voices, 'ckb').voice.name, pickVoice(voices, 'ckb').approx], ['Dariush', true]);
  assert.equal(pickVoice([{ name: 'Siri', lang: 'ja-JP' }], 'ckb').voice, null);
  const text = 'One sentence here. '.repeat(60);
  const pieces = splitText(text, 400);
  assert.ok(pieces.every((p) => p.length <= 400)); assert.equal(pieces.join(' '), text.trim());
  assert.deepEqual([clock(0), clock(1000), clock(59000), clock(61000), clock(120000), clock(179400), clock(180000)], ['00:00', '00:01', '00:59', '01:01', '02:00', '03:00', '03:00']);
  assert.match(AV._test.silentWav(), /^data:audio\/wav;base64,UklGR/);
  assert.equal(AV.speechLang('ckb'), 'ckb-IQ');
  assert.match(AV.message('language-not-supported', 'Kurdish Sorani'), /Kurdish Sorani/);
}

{
  // Two-way conversation: Person A -> B and Person B -> A each record continuously for the full 3 minutes,
  // and the countdown starts at 03:00.
  const { AV, clock, recs, win } = browser();
  const els = new Map();
  const node = (id) => {
    const kids = new Map();
    const n = { id, value: '', hidden: true, disabled: false, textContent: '', className: '', innerHTML: '', attrs: {}, style: {},
      classList: { toggle() {}, remove() {} }, setAttribute(k, v) { this.attrs[k] = v; },
      querySelector(sel) { if (!kids.has(sel)) kids.set(sel, node(sel)); return kids.get(sel); },
      addEventListener() {}, checked: false, lastChild: { textContent: '' }, lastElementChild: null };
    return n;
  };
  win.document = { getElementById: (id) => { if (!els.has(id)) els.set(id, node(id)); return els.get(id); } };
  vm.runInContext(readFileSync(pub('aiva-voice.js'), 'utf8'), vm.createContext({ window: win, Date: { now: () => clock.now() }, console, Math, Number, String, Array, Object, Set, Map, Promise, Uint8Array, DataView, encodeURIComponent, JSON }));
  const AV2 = win.AivaVoice, $ = win.document.getElementById;
  const translated = [];
  AV2.setupConversation({ langs: [['en', 'English'], ['ckb', 'Kurdish Sorani'], ['ar', 'Arabic']], langName: (c) => c, a: 'en', b: 'ckb',
    translate: async (text, src, dst) => { translated.push([src, dst, text]); return `[${dst}] ${text}`; } });
  $('convoLangA').value = 'en'; $('convoLangB').value = 'ckb';
  const before = recs.length;
  for (const [side, lang] of [['A', 'en-GB'], ['B', 'ckb-IQ']]) {
    $(`convoMic${side}`).onclick(); clock.advance(10);
    assert.equal($('convoTimer').querySelector('.rec-left').textContent, '03:00 left', `${side}: countdown starts at 03:00`);
    for (let t = 0; t < 175000; t += 25000) { const r = recs.at(-1); r.say(`${side} ${t / 1000}`, true); clock.advance(12000); r.error('no-speech'); r.end(); clock.advance(13000); }
    assert.equal(recs.at(-1).lang, lang);
    assert.match($('convoTimer').querySelector('.rec-elapsed').textContent, /^02:5\d$/, `${side}: still recording near the end`);
    clock.advance(6000); await new Promise((r) => setImmediate(r));
    assert.equal($('convoTimer').querySelector('.rec-left').textContent, '00:00 left');
  }
  assert.ok(recs.slice(before).every((r) => r.lang === 'en-GB' || r.lang === 'ckb-IQ'));
  assert.deepEqual(translated.map((x) => x.slice(0, 2)), [['en', 'ckb'], ['ckb', 'en']], 'both directions translated');
  assert.ok(translated.every((x) => x[2].split(' ').length === 14), 'all seven phrases kept in each direction');
  console.log('two-way conversation: A->B and B->A each recorded the full 03:00 and were translated');
}

{
  // Persian: a Dari (prs) device voice is used when no fa voice is installed.
  const { AV } = browser();
  assert.deepEqual([AV._test.pickVoice([{ name: 'Dari', lang: 'prs-AF' }], 'fa').voice?.name, AV._test.pickVoice([{ name: 'Dari', lang: 'prs-AF' }], 'fa').approx], ['Dari', true]);
  assert.equal(AV._test.pickVoice([{ name: 'Dariush', lang: 'fa-IR' }, { name: 'Dari', lang: 'prs-AF' }], 'fa').voice.name, 'Dariush');
}

{
  // Page wiring: controls exist, the voice engine loads before app.js and is cached offline.
  const html = readFileSync(pub('index.html'), 'utf8'), app = readFileSync(pub('app.js'), 'utf8'), sw = readFileSync(pub('service-worker.js'), 'utf8');
  for (const id of ['speakInput', 'stopInput', 'cancelInput', 'recTimer', 'voiceRate', 'readInput', 'listenTranslation',
    'convoLangA', 'convoLangB', 'convoMicA', 'convoMicB', 'convoStop', 'convoCancel', 'convoAuto', 'convoRate', 'convoLog', 'convoStatus', 'convoTimer'])
    assert.match(html, new RegExp(`id="${id}"`), id);
  assert.ok(html.indexOf('src="aiva-voice.js"') > 0 && html.indexOf('src="aiva-voice.js"') < html.indexOf('src="app.js"'));
  assert.match(sw, /'\.\/aiva-voice\.js'/);
  assert.match(app, /AV\.setupConversation\(/);
  assert.doesNotMatch(app, /stopListening|maxTimer/, 'old 30-second voice cap removed');
}

console.log('voice-test: all passed');
