'use strict';
/* Aiva Translate voice engine: 3-minute continuous recording, natural AI voice playback and two-way conversation.
   Recording uses the browser's speech recognition in continuous mode and quietly restarts it when the browser ends a
   session on a pause, so natural pauses never stop the microphone before the 3-minute limit, Stop or Cancel.
   Playback asks /api/hub-tts for a natural neural voice and falls back to the best voice on the device. */
(function (root) {
  const doc = root.document;
  const nav = root.navigator || {};
  const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
  const MAX_MS = 180000; // 3:00 in both conversation directions
  const SPEECH_LANG = { en: 'en-GB', ckb: 'ckb-IQ', ar: 'ar-SA', tr: 'tr-TR', fa: 'fa-IR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', 'zh-CN': 'zh-CN', pt: 'pt-PT', ru: 'ru-RU', ja: 'ja-JP', hi: 'hi-IN' };
  // Closest device voices when a device has none for a language. Pronunciation is then approximate and the app says so.
  const NEAR = { ckb: ['ku', 'fa', 'ar'], fa: ['prs'] };
  const RATES = [0.75, 0.9, 1, 1.15, 1.3];
  const isIOS = /iP(hone|ad|od)/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const join = (...parts) => parts.map((p) => String(p || '').trim()).filter(Boolean).join(' ');
  const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000 - 0.001)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const speechLang = (code) => SPEECH_LANG[code] || code || nav.language || 'en-GB';

  /* Best transcript for one result list. Android Chrome repeats the whole utterance in each new final result in
     continuous mode, so a final that extends the text so far replaces it instead of doubling it. */
  function collect(results) {
    let fin = '', int = '';
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      let best = r[0];
      for (let j = 1; j < r.length; j++) if ((r[j].confidence || 0) > (best.confidence || 0)) best = r[j];
      const t = String(best && best.transcript || '').trim();
      if (!t) continue;
      if (r.isFinal) fin = fin && t.toLowerCase().startsWith(fin.toLowerCase()) ? t : join(fin, t);
      else int = join(int, t);
    }
    return { fin, int };
  }

  function message(code, langLabel) {
    return ({
      'not-allowed': 'Microphone access is blocked. Allow microphone access for Aiva in your browser settings (iPhone: Settings › Safari › Microphone), then tap Start again. You can still type your text.',
      'service-not-allowed': 'Speech recognition is turned off or not allowed here. On iPhone, turn on Siri & Dictation (Settings › Siri) or open Aiva in Safari, then try again. You can still type, or use the microphone key on your keyboard.',
      'no-speech': 'No speech was detected. Tap Start and talk clearly, or type your text.',
      'audio-capture': 'No microphone is available. It may be in use by another app. Close other apps using the microphone and tap Start again.',
      network: 'Voice recognition needs an internet connection. Check your connection and tap Start again. Typing still works.',
      'language-not-supported': `Voice input for ${langLabel || 'this language'} is not available in this browser. Try Chrome or Safari, use the microphone key on your phone keyboard, or type your text.`,
      'start-failed': 'The microphone could not start. Wait a moment and tap Start again, or type your text.',
      'restart-loop': 'The microphone keeps stopping on this device. Tap Start to try again, or type your text.',
      unsupported: 'Voice input is not supported in this browser. Type your text instead, or use the microphone key on your phone keyboard.'
    })[code] || 'Voice input stopped unexpectedly. Tap Start to try again, or type your text.';
  }

  /* ---------- Recorder ---------- */
  let activeRecorder = null;
  const recorders = new Set();

  function createRecorder(opts) {
    const o = Object.assign({ maxMs: MAX_MS, lang: 'en-GB' }, opts);
    let state = 'idle', rec = null, live = false, t0 = 0, tick = null, safety = null, lang = o.lang;
    let committed = '', sessFin = '', sessInt = '', fatal = null, stopping = false, cancelled = false, limit = false;
    let restarts = [], stream = null, track = null, wake = null;
    const self = {};
    const set = (s) => { state = s; o.onState && o.onState(s); };
    const elapsed = () => (state === 'idle' ? 0 : Date.now() - t0);
    const text = () => join(committed, sessFin, sessInt);
    const emit = () => o.onText && o.onText(text(), sessInt);

    function releaseStream() {
      if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch {} }
      stream = track = null;
    }
    async function keepAwake() { try { wake = await nav.wakeLock?.request('screen'); } catch { wake = null; } }
    function letSleep() { try { wake?.release(); } catch {} wake = null; }
    /* Chrome versions that expose the unprefixed API accept a microphone track, so Aiva can hand recognition a
       noise-suppressed, echo-cancelled, level-controlled signal. Everywhere else the browser's own capture is used. */
    const canCleanAudio = () => !isIOS && typeof root.SpeechRecognition === 'function' && !!nav.mediaDevices?.getUserMedia;

    function session() {
      const r = new Recognition();
      rec = r;
      r.lang = lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 3;
      r.onstart = () => { if (rec === r && state === 'starting') set('listening'); };
      r.onresult = (e) => { if (rec !== r) return; const { fin, int } = collect(e.results); sessFin = fin; sessInt = int; emit(); };
      r.onerror = (e) => {
        if (rec !== r) return;
        const c = e.error || 'unknown';
        if (c === 'no-speech' || c === 'aborted') return; // a pause: the session simply restarts
        if (c === 'audio-capture' && track) { releaseStream(); return; } // retry with the browser's own capture
        if (c === 'network' && (committed || restarts.length) && restarts.length < 3) return;
        fatal = c;
      };
      r.onend = () => {
        if (rec !== r) return;
        live = false;
        committed = join(committed, sessFin, sessInt);
        sessFin = sessInt = '';
        if (stopping || cancelled || fatal || elapsed() >= o.maxMs) { finish(); return; }
        const now = Date.now();
        restarts = restarts.filter((t) => now - t < 10000);
        restarts.push(now);
        if (restarts.length > 8) { if (!committed) fatal = 'restart-loop'; finish(); return; }
        root.setTimeout(() => { if (rec === r && state !== 'idle' && !stopping) begin(); }, 80);
      };
      return r;
    }

    function begin() {
      const r = session();
      try {
        if (track) r.start(track); else r.start();
        live = true;
      } catch (err) {
        if (track) {
          releaseStream();
          try { r.start(); live = true; return; } catch (e2) { err = e2; }
        }
        if (rec !== r) return;
        if (!committed) fatal = err && err.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed';
        finish();
      }
    }

    function finish() {
      if (state === 'idle') return;
      root.clearInterval(tick); root.clearTimeout(safety);
      const r = rec; rec = null; live = false;
      if (r) { r.onstart = r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch {} }
      releaseStream(); letSleep();
      const ms = Math.min(Date.now() - t0, o.maxMs), heard = cancelled ? '' : text();
      if (activeRecorder === self) activeRecorder = null;
      set('idle');
      o.onEnd && o.onEnd({ text: heard, error: cancelled ? null : fatal, cancelled, limit, ms });
    }

    self.state = () => state;
    self.elapsed = elapsed;
    self.start = async (startOpts = {}) => {
      if (state !== 'idle') return false;
      if (startOpts.lang) lang = startOpts.lang;
      if (!Recognition) { o.onEnd && o.onEnd({ text: '', error: 'unsupported', cancelled: false, limit: false, ms: 0 }); return false; }
      for (const other of recorders) if (other !== self && other.state() !== 'idle') other.cancel();
      player.stop();
      activeRecorder = self;
      committed = sessFin = sessInt = ''; fatal = null; stopping = cancelled = limit = false; restarts = [];
      t0 = Date.now();
      set('starting');
      o.onTick && o.onTick(0, o.maxMs);
      tick = root.setInterval(() => {
        const ms = elapsed();
        o.onTick && o.onTick(Math.min(ms, o.maxMs), o.maxMs);
        if (ms >= o.maxMs && !stopping) { limit = true; self.stop(); }
      }, 250);
      keepAwake();
      if (canCleanAudio()) {
        try {
          stream = await nav.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true, channelCount: 1 } });
          track = stream.getAudioTracks()[0] || null;
        } catch (err) {
          if (err && err.name === 'NotAllowedError') { fatal = 'not-allowed'; finish(); return false; }
          track = null;
        }
        if (state !== 'starting' || cancelled) { releaseStream(); return false; }
      }
      begin();
      return state !== 'idle';
    };
    self.stop = () => {
      if (state === 'idle' || state === 'stopping') return;
      stopping = true;
      set('stopping');
      if (!live) { finish(); return; } // between two sessions: nothing left to flush
      try { rec && rec.stop(); } catch {}
      safety = root.setTimeout(finish, 2500);
    };
    self.cancel = () => { if (state !== 'idle') { cancelled = true; finish(); } };
    recorders.add(self);
    return self;
  }

  /* ---------- Player ---------- */
  function silentWav() {
    const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const w = (o, s) => [...s].forEach((c, i) => { b[o + i] = c.charCodeAt(0); });
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true);
    v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
    let s = ''; b.forEach((x) => { s += String.fromCharCode(x); });
    return 'data:audio/wav;base64,' + root.btoa(s);
  }

  function splitText(text, max) {
    const out = [];
    let rest = String(text || '').replace(/\s+/g, ' ').trim();
    while (rest.length > max) {
      const slice = rest.slice(0, max + 1);
      let cut = -1;
      for (const re of [/[.!?؟。！？](?=\s|$)/g, /[,،;؛:、，](?=\s|$)/g, /\s/g]) {
        let m; while ((m = re.exec(slice))) if (m.index > 0 && m.index < max) cut = m.index + 1;
        if (cut > max * 0.4) break;
      }
      if (cut <= 0) cut = max;
      out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out.filter(Boolean);
  }

  const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred\b|kathy/i;
  function voiceScore(v, tag) {
    const n = v.name || '', l = String(v.lang || '').toLowerCase().replace('_', '-');
    let s = 0;
    if (/natural|neural/i.test(n)) s += 60;
    if (/premium|enhanced|siri/i.test(n)) s += 45;
    if (/google/i.test(n)) s += 30;
    if (/online/i.test(n)) s += 20;
    if (/compact|eloquence|espeak/i.test(n) || NOVELTY.test(n)) s -= 60;
    if (l === tag) s += 10;
    if (v.localService === false) s += 5;
    if (v.default) s += 2;
    return s;
  }
  function pickVoice(voices, lang) {
    for (const code of [lang, ...(NEAR[lang] || [])]) {
      const tag = speechLang(code).toLowerCase(), primary = tag.split('-')[0];
      const list = voices.filter((v) => { const l = String(v.lang || '').toLowerCase().replace('_', '-'); return l === tag || l.split('-')[0] === primary; });
      if (list.length) return { voice: list.slice().sort((a, b) => voiceScore(b, tag) - voiceScore(a, tag))[0], approx: code !== lang };
    }
    return { voice: null, approx: false };
  }

  const player = (() => {
    let audio = null, seq = 0, current = null, info = null, infoPromise = null, unlocked = false, rate = 1;
    try { const r = Number(root.localStorage?.getItem('aiva-voice-rate')); if (RATES.includes(r)) rate = r; } catch {}
    const el = () => { if (!audio && root.Audio) { audio = new root.Audio(); audio.preload = 'auto'; } return audio; };
    const synth = () => root.speechSynthesis;

    function loadInfo() {
      if (!infoPromise) {
        infoPromise = root.fetch('/api/hub-tts?info=1').then((r) => (r.ok ? r.json() : null)).then((d) => { info = d && Array.isArray(d.voices) ? d : null; return info; }).catch(() => null);
      }
      return infoPromise;
    }
    const serverVoices = (lang) => !!lang && (!info || info.voices.includes(lang));

    function voicesReady() {
      const s = synth();
      if (!s || s.getVoices().length) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => { s.removeEventListener?.('voiceschanged', done); resolve(); };
        s.addEventListener?.('voiceschanged', done);
        root.setTimeout(done, 1200);
      });
    }

    function playServer(text, lang, my) {
      return new Promise((resolve) => {
        const a = el();
        if (!a) { resolve(false); return; }
        let settled = false, timer = null;
        const done = (v) => { if (settled) return; settled = true; root.clearTimeout(timer); a.onended = a.onerror = null; if (current === stopThis) current = null; resolve(v); };
        const stopThis = () => done('stopped');
        current = stopThis;
        a.onended = () => done(true);
        a.onerror = () => done(false);
        a.defaultPlaybackRate = rate;
        a.src = `/api/hub-tts?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
        a.playbackRate = rate;
        try { a.preservesPitch = true; } catch {}
        timer = root.setTimeout(() => { if (a.currentTime === 0) { try { a.pause(); } catch {} done(false); } }, 15000);
        const p = a.play();
        if (p && p.catch) p.catch(() => done(false));
        if (my !== seq) done('stopped');
      });
    }

    async function playDevice(text, lang, my, o) {
      const s = synth();
      if (!s || !root.SpeechSynthesisUtterance) { o.onStatus?.('error', 'Read aloud is not available in this browser.'); return 'unavailable'; }
      await voicesReady();
      if (my !== seq) return 'stopped';
      const { voice, approx } = pickVoice(s.getVoices(), lang);
      const label = o.langName ? o.langName(lang) : lang;
      if (approx) o.onStatus?.('', `This device has no ${label} voice, so Aiva is using the closest voice available. Pronunciation is approximate.`);
      else if (!voice && lang) o.onStatus?.('', `This device has no ${label} voice installed. Playback may not sound right.`);
      const parts = splitText(text, 180);
      try { s.cancel(); } catch {}
      return new Promise((resolve) => {
        let i = 0;
        current = () => { try { s.cancel(); } catch {} resolve('stopped'); };
        const next = () => {
          if (my !== seq) { resolve('stopped'); return; }
          if (i >= parts.length) { current = null; resolve('done'); return; }
          const u = new root.SpeechSynthesisUtterance(parts[i++]);
          u.lang = voice ? voice.lang : speechLang(lang);
          if (voice) u.voice = voice;
          u.rate = rate; u.pitch = 1;
          u.onend = next;
          u.onerror = (e) => { if (e && (e.error === 'interrupted' || e.error === 'canceled')) resolve('stopped'); else next(); };
          s.speak(u);
        };
        next();
      });
    }

    const api = {
      rates: RATES,
      rate: () => rate,
      setRate(r) {
        r = Number(r); if (!RATES.includes(r)) return;
        rate = r;
        try { root.localStorage?.setItem('aiva-voice-rate', String(r)); } catch {}
        if (audio && !audio.paused) { audio.defaultPlaybackRate = r; audio.playbackRate = r; }
      },
      /* Call inside a tap: lets phones (iPhone in particular) play the translation later without another tap. */
      unlock() {
        if (unlocked) return;
        const a = el();
        if (a && (a.paused || !a.src)) { try { a.src = silentWav(); const p = a.play(); if (p && p.then) p.then(() => { unlocked = true; }, () => {}); } catch {} }
        try { const s = synth(); if (s && root.SpeechSynthesisUtterance && !s.speaking) { const u = new root.SpeechSynthesisUtterance(' '); u.volume = 0; s.speak(u); } } catch {}
      },
      stop() {
        seq++;
        const c = current; current = null;
        if (c) c();
        if (audio) { try { audio.pause(); } catch {} }
        try { synth()?.cancel(); } catch {}
      },
      speaking: () => !!current,
      /* Reads text aloud: natural AI voice first, then the best device voice. Resolves 'done', 'stopped' or 'unavailable'. */
      async play(text, lang, o = {}) {
        api.stop();
        const my = seq;
        const pieces = splitText(text, 400);
        if (!pieces.length) return 'done';
        await loadInfo();
        if (my !== seq) return 'stopped';
        let server = serverVoices(lang);
        for (let i = 0; i < pieces.length; i++) {
          if (my !== seq) return 'stopped';
          if (server) {
            const r = await playServer(pieces[i], lang, my);
            if (r === 'stopped' || my !== seq) return 'stopped';
            if (r === true) continue;
            server = false;
          }
          return playDevice(pieces.slice(i).join(' '), lang, my, o);
        }
        return 'done';
      },
      _info: () => info
    };
    return api;
  })();

  /* ---------- Timer display ---------- */
  function timerUI(el) {
    if (!el) return { update() {}, hide() {} };
    el.innerHTML = `<div class="rec-row"><span class="rec-dot" aria-hidden="true"></span><span><b class="rec-elapsed">00:00</b> / ${clock(MAX_MS)}</span><span class="rec-left">${clock(MAX_MS)} left</span></div><div class="rec-track" role="progressbar" aria-label="Recording time used" aria-valuemin="0" aria-valuemax="${MAX_MS / 1000}" aria-valuenow="0"><div class="rec-fill"></div></div>`;
    const q = (s) => el.querySelector(s);
    return {
      update(ms, max = MAX_MS) {
        el.hidden = false;
        const left = Math.max(0, max - ms);
        q('.rec-elapsed').textContent = clock(Math.floor(ms / 1000) * 1000 + 0.5);
        q('.rec-left').textContent = `${clock(left)} left`;
        q('.rec-fill').style.width = `${Math.min(100, (ms / max) * 100).toFixed(1)}%`;
        q('.rec-track').setAttribute('aria-valuenow', String(Math.floor(ms / 1000)));
        el.classList.toggle('warn', left <= 15000);
      },
      hide() { el.hidden = true; el.classList.remove('warn'); }
    };
  }

  function statusIn(el, kind, msg) {
    if (!el) return;
    if (!msg) { el.hidden = true; el.className = 'voice-status'; el.textContent = ''; return; }
    el.hidden = false; el.className = 'voice-status ' + kind;
    el.innerHTML = '<span class="dot" aria-hidden="true"></span><span></span>';
    el.lastChild.textContent = msg;
  }

  /* ---------- Two-way conversation ---------- */
  function setupConversation(cfg) {
    const $ = (id) => doc.getElementById(id);
    if (!$('convoLog')) return null;
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const name = (c) => cfg.langName(c);
    const opts = cfg.langs.map((l) => `<option value="${esc(l[0])}">${esc(l[1])}</option>`).join('');
    $('convoLangA').innerHTML = opts; $('convoLangB').innerHTML = opts;
    $('convoLangA').value = cfg.a || 'en'; $('convoLangB').value = cfg.b || 'ckb';
    const lang = (side) => $(side === 'a' ? 'convoLangA' : 'convoLangB').value;
    const other = (side) => (side === 'a' ? 'b' : 'a');
    const status = (k, m) => statusIn($('convoStatus'), k, m);
    const timer = timerUI($('convoTimer'));
    let log = [], side = null, nextId = 1;

    function renderButtons(state) {
      for (const s of ['a', 'b']) {
        const b = $(s === 'a' ? 'convoMicA' : 'convoMicB'), mine = side === s && state !== 'idle';
        b.classList.toggle('recording', mine);
        b.setAttribute('aria-pressed', String(mine));
        b.disabled = (side && side !== s && state !== 'idle') || (mine && state === 'stopping');
        b.querySelector('.mic-ico').textContent = mine ? (state === 'stopping' ? '⏳' : '⏹') : '🎙️';
        b.querySelector('.mic-label').textContent = mine ? (state === 'stopping' ? 'Finishing…' : 'Tap to stop') : 'Tap to speak';
      }
      $('convoStop').disabled = state === 'idle' || state === 'stopping';
      $('convoCancel').disabled = state === 'idle';
    }

    function renderLog() {
      $('convoLog').innerHTML = log.length ? log.map((e) => `<div class="bubble side-${e.side}">
<div class="bubble-who">${e.side === 'a' ? 'Person A' : 'Person B'} · ${esc(name(e.src))} → ${esc(name(e.dst))}</div>
<div class="bubble-orig" dir="auto" lang="${esc(e.src)}">${esc(e.original)}</div>
<div class="bubble-tr" dir="auto" lang="${esc(e.dst)}">${e.state === 'translating' ? 'Translating…' : e.state === 'error' ? esc(e.error) : esc(e.translation)}</div>
<div class="bubble-actions">${e.state === 'done' ? `<button type="button" data-convo-play="${e.id}" data-part="translation">🔊 Replay translation</button>` : ''}<button type="button" data-convo-play="${e.id}" data-part="original">🔊 Original</button></div></div>`).join('')
        : '<div class="empty">Your conversation will appear here. Each person taps their own microphone.</div>';
    }

    const rec = createRecorder({
      onState: renderButtons,
      onTick: (ms, max) => timer.update(ms, max),
      onText: (t) => { $('convoLive').hidden = !t; $('convoLive').textContent = t; },
      async onEnd(r) {
        const s = side; side = null; timer.hide(); renderButtons('idle');
        $('convoLive').hidden = true; $('convoLive').textContent = '';
        if (r.cancelled) { status('', 'Recording cancelled.'); return; }
        const src = lang(s), dst = lang(other(s));
        if (!r.text) { status('error', message(r.error || 'no-speech', name(src))); return; }
        const entry = { id: nextId++, side: s, src, dst, original: r.text, translation: '', state: 'translating' };
        log.push(entry); renderLog();
        status('busy', `${r.limit ? 'Reached the 3-minute limit. ' : ''}Translating into ${name(dst)}…`);
        try {
          entry.translation = await cfg.translate(r.text, src, dst);
          entry.state = 'done'; renderLog();
          status('ok', `Translated from ${name(src)} into ${name(dst)}.`);
          if ($('convoAuto').checked) say(entry, 'translation');
        } catch (err) {
          entry.state = 'error'; entry.error = err.message || 'Translation failed. Tap Replay or try again.'; renderLog();
          status('error', entry.error);
        }
        $('convoLog').lastElementChild?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }
    });

    function say(e, part) {
      const text = part === 'original' ? e.original : e.translation, code = part === 'original' ? e.src : e.dst;
      player.play(text, code, { langName: name, onStatus: status });
    }

    function tapMic(s) {
      player.unlock();
      if (side === s && rec.state() !== 'idle') { rec.stop(); return; }
      if (rec.state() !== 'idle') return;
      if (lang('a') === lang('b')) { status('error', 'Choose two different languages, one for each person.'); return; }
      side = s;
      status('listening', `Listening in ${name(lang(s))}… pause naturally, Aiva keeps listening for up to 3 minutes. Tap again to finish.`);
      rec.start({ lang: speechLang(lang(s)) });
    }

    $('convoMicA').onclick = () => tapMic('a');
    $('convoMicB').onclick = () => tapMic('b');
    $('convoStop').onclick = () => rec.stop();
    $('convoCancel').onclick = () => rec.cancel();
    $('convoClear').onclick = () => { player.stop(); log = []; renderLog(); status('', null); };
    $('convoSwap').onclick = () => { if (rec.state() !== 'idle') rec.cancel(); const a = lang('a'); $('convoLangA').value = lang('b'); $('convoLangB').value = a; };
    $('convoLog').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-convo-play]');
      if (!b) return;
      const e = log.find((x) => x.id === Number(b.dataset.convoPlay));
      if (e) { player.unlock(); say(e, b.dataset.part); }
    });
    for (const id of ['convoLangA', 'convoLangB']) $(id).addEventListener('change', () => { if (rec.state() !== 'idle') rec.cancel(); });
    renderButtons('idle'); renderLog();
    return { recorder: rec };
  }

  const cancelAll = () => { for (const r of recorders) r.cancel(); player.stop(); };

  root.AivaVoice = {
    MAX_MS, supported: !!Recognition, speechLang, message, createRecorder, player, timerUI, statusIn, setupConversation,
    cancelAll, _test: { collect, splitText, pickVoice, voiceScore, clock, silentWav }
  };
})(typeof window !== 'undefined' ? window : globalThis);
