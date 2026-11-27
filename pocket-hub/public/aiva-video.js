'use strict';
/* Aiva video translation and live camera captions.
   Video: the sound track is extracted and resampled ON THE PHONE (the video file itself is never uploaded), sent in
   short clips to /api/hub-stt for real speech recognition with automatic language detection, translated with
   /api/hub-translate, and shown as subtitles over the video. Subtitles can be downloaded (SRT / WebVTT), and the
   video can be played with a translated voice reading each subtitle at its time.
   Live camera: camera preview with live captions of what is said, translated as you speak, using the phone's own
   speech recognition through the existing 3-minute Aiva recorder.
   Nothing is simulated: if a service is not available the app says so and stops. */
(function (root) {
  const doc = root.document;
  const $ = (id) => doc.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_BYTES = 300 * 1024 * 1024, MAX_SECONDS = 20 * 60, RATE = 16000, CLIP = 30;
  const AL = () => root.AivaLanguages, AV = () => root.AivaVoice;
  const nameOf = (code) => (AL() && AL().get(code) ? AL().get(code).name : code);

  /* ---------- helpers ---------- */
  function status(el, kind, msg) {
    const AVx = AV();
    if (AVx && AVx.statusIn) AVx.statusIn(el, kind, msg);
    else if (el) { el.hidden = !msg; el.textContent = msg || ''; }
  }
  async function translate(text, source, target) {
    const res = await root.fetch('/api/hub-translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, source, target }) });
    let d = {}; try { d = await res.json(); } catch {}
    if (!res.ok || typeof d.translation !== 'string') throw new Error(d.error || 'Translation failed.');
    return d;
  }
  function wav(samples) {
    const b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Blob([b], { type: 'audio/wav' });
  }
  /* Cuts the track into clips of about CLIP seconds, ending each at the quietest moment of its last 6 seconds. */
  function clips(samples) {
    const out = [], frame = RATE / 10;
    let start = 0;
    while (start < samples.length) {
      let end = Math.min(samples.length, start + CLIP * RATE);
      if (end < samples.length) {
        let best = end, low = Infinity;
        for (let f = end - 6 * RATE; f < end - frame; f += frame) {
          let e = 0; for (let i = f; i < f + frame; i++) e += samples[i] * samples[i];
          if (e < low) { low = e; best = f + frame / 2; }
        }
        end = Math.floor(best);
      }
      out.push({ offset: start / RATE, data: samples.subarray(start, end) });
      start = end;
    }
    return out;
  }
  async function decode(file) {
    const Ctx = root.AudioContext || root.webkitAudioContext, Off = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Ctx || !Off) throw new Error('This browser cannot read the sound of a video. Try Safari or Chrome.');
    const ctx = new Ctx();
    let buf;
    try {
      const bytes = await file.arrayBuffer();
      buf = await new Promise((resolve, reject) => { const p = ctx.decodeAudioData(bytes, resolve, reject); if (p && p.then) p.then(resolve, reject); });
    } catch { throw new Error('The sound of this video could not be read on this device. MP4 (H.264/AAC) and MOV files work best, and the video must contain speech audio.'); }
    finally { try { ctx.close(); } catch {} }
    if (buf.duration > MAX_SECONDS + 1) throw new Error(`Videos up to ${MAX_SECONDS / 60} minutes can be translated. This one is ${Math.round(buf.duration / 60)} minutes.`);
    const off = new Off(1, Math.ceil(buf.duration * RATE), RATE);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const rendered = await new Promise((resolve, reject) => { off.oncomplete = (e) => resolve(e.renderedBuffer); const p = off.startRendering(); if (p && p.then) p.then(resolve, reject); });
    return { samples: rendered.getChannelData(0), duration: buf.duration };
  }
  const ts = (t, sep) => { const ms = Math.max(0, Math.round(t * 1000)); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
  const vtt = (cues, key) => 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${c[key]}\n`).join('\n');
  const srt = (cues, key) => cues.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${c[key]}\n`).join('\n');
  function download(name, text, type) {
    const a = doc.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    doc.body.appendChild(a); a.click(); a.remove(); root.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- UI ---------- */
  function build() {
    const host = $('translate');
    if (!host || $('videoTranslate')) return false;
    const wrap = doc.createElement('div');
    wrap.innerHTML = `<div class="section-head"><h3>Video translation</h3></div>
<div class="card" id="videoTranslate"><p class="helper" style="margin-top:0">Choose a video with speech. Aiva detects the spoken language, writes translated subtitles and can read them aloud in a translated voice. The sound is prepared on your phone and only short audio clips are sent for recognition; your video is not uploaded or stored. Up to ${MAX_SECONDS / 60} minutes.</p>
<div class="field"><label for="vtFile">Video</label><input id="vtFile" type="file" accept="video/*,audio/*"></div>
<div class="formgrid" style="margin-top:12px"><div class="field"><label for="vtFrom">Spoken language</label><select id="vtFrom"><option value="auto">Detect automatically</option></select></div><div class="field"><label for="vtTo">Subtitles and voice in</label><select id="vtTo"></select></div></div>
<div class="actions"><button class="btn voice-btn" type="button" id="vtGo" disabled>🎬 Translate video</button><button class="btn ghost voice-btn" type="button" id="vtCancel" hidden>✕ Cancel</button></div>
<div class="vt-progress" id="vtProgress" hidden><div class="rec-track"><div class="rec-fill" id="vtBar"></div></div></div>
<div id="vtStatus" class="voice-status" role="status" aria-live="polite" hidden></div>
<div class="vt-stage" id="vtStage" hidden><video id="vtVideo" playsinline controls preload="metadata"></video><div class="vt-caption" id="vtCaption" dir="auto" aria-live="off"></div></div>
<div class="actions" id="vtTools" hidden><button class="btn voice-btn" type="button" id="vtDub">🔊 Play with translated voice</button><label class="check"><input type="checkbox" id="vtShowOrig"> Show original too</label><button class="btn light" type="button" id="vtSrt">⬇ Subtitles (.srt)</button><button class="btn light" type="button" id="vtVtt">⬇ Subtitles (.vtt)</button><button class="btn ghost" type="button" id="vtOrigSrt">⬇ Original transcript</button></div>
<div class="notice" id="vtNote">Speech recognition: OpenAI Whisper (run on Cloudflare Workers AI, or OpenAI). Kurdish Sorani and Kurmanji cannot yet be recognised from speech by any provider Aiva uses, but they can be chosen for subtitles and voice. Sign-language video translation is not offered: no provider is reliable enough yet.</div></div>
<div class="section-head"><h3>Live camera translation</h3></div>
<div class="card" id="liveCamera"><p class="helper" style="margin-top:0">Point the camera at the person speaking. Aiva shows what they say and its translation live on the picture, for up to 3 minutes at a time. Live captions use your phone's speech recognition, so they work for the languages your phone recognises (🎙).</p>
<div class="formgrid"><div class="field"><label for="lcFrom">Speaker's language</label><select id="lcFrom"></select></div><div class="field"><label for="lcTo">Translate into</label><select id="lcTo"></select></div></div>
<div class="vt-stage lc-stage" id="lcStage" hidden><video id="lcVideo" playsinline muted autoplay></video><div class="vt-caption" id="lcCaption" dir="auto"></div><div class="lc-orig" id="lcOrig" dir="auto"></div></div>
<div id="lcTimer" class="rec-timer" aria-live="off" hidden></div>
<div class="actions"><button class="btn voice-btn" type="button" id="lcStart">📷 Start live translation</button><button class="btn light voice-btn" type="button" id="lcStop" disabled>⏹ Stop</button><button class="btn ghost" type="button" id="lcFlip" disabled>🔄 Switch camera</button><label class="check"><input type="checkbox" id="lcSpeak"> Read the translation aloud when I stop</label></div>
<div id="lcStatus" class="voice-status" role="status" aria-live="polite" hidden></div></div>`;
    const anchor = [...host.querySelectorAll('.section-head')].find((h) => /Offline phrasebook/.test(h.textContent));
    for (const el of [...wrap.children]) host.insertBefore(el, anchor || null);
    const s = doc.createElement('style');
    s.textContent = '#videoTranslate [hidden],#liveCamera [hidden]{display:none!important}.vt-stage{position:relative;margin-top:13px;border-radius:14px;overflow:hidden;background:#0b1734}.vt-stage video{display:block;width:100%;max-height:60vh;background:#000}.lc-stage video{aspect-ratio:3/4;object-fit:cover;max-height:65vh}.vt-caption{position:absolute;left:8px;right:8px;bottom:54px;text-align:center;pointer-events:none;font-size:18px;line-height:1.35;font-weight:700;color:#fff;text-shadow:0 1px 3px #000,0 0 8px #000}.vt-caption:empty{display:none}.vt-caption small{display:block;font-size:13px;font-weight:600;opacity:.85}.lc-stage .vt-caption{bottom:16px;background:#0b1734b8;border-radius:10px;padding:8px;text-shadow:none}.lc-orig{position:absolute;left:8px;right:8px;top:8px;font-size:13px;color:#fff;background:#0b173480;border-radius:8px;padding:6px 8px}.lc-orig:empty{display:none}.vt-progress{margin-top:12px}';
    doc.head.appendChild(s);
    return true;
  }

  function fillSelects(data) {
    const L = AL();
    const heard = (l) => l.video && !l.variant;
    const from = $('vtFrom');
    from.innerHTML = '<option value="auto">Detect automatically</option>' + data.languages.filter(heard).sort((a, b) => a.name.localeCompare(b.name)).map((l) => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
    const all = data.languages.filter((l) => !l.variant).map((l) => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
    $('vtTo').innerHTML = all; $('vtTo').value = 'en';
    $('lcFrom').innerHTML = data.languages.map((l) => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join(''); $('lcFrom').value = 'ar';
    $('lcTo').innerHTML = all; $('lcTo').value = 'en';
    if (L) {
      L.upgrade($('vtFrom'), { auto: true, filter: heard });
      L.upgrade($('vtTo'), { filter: (l) => !l.variant });
      L.upgrade($('lcFrom'), { voiceHint: true });
      L.upgrade($('lcTo'), { filter: (l) => !l.variant });
    }
  }

  /* ---------- video translation ---------- */
  const vt = { file: null, cues: [], target: 'en', source: 'auto', cancelled: false, url: '', dub: false, dubAudio: null, nextCue: 0, prefetch: new Map(), stt: null };

  function cueAt(t) { return vt.cues.find((c) => t >= c.start && t < c.end + 0.15) || null; }
  function showCaption() {
    const v = $('vtVideo'), c = cueAt(v.currentTime);
    $('vtCaption').innerHTML = c ? `${$('vtShowOrig').checked ? `<small>${esc(c.original)}</small>` : ''}${esc(c.translated)}` : '';
    if (vt.dub && !v.paused) dubTick(v.currentTime);
  }
  function addTracks() {
    const v = $('vtVideo');
    [...v.querySelectorAll('track')].forEach((t) => { URL.revokeObjectURL(t.src); t.remove(); });
    for (const [key, lang, label] of [['translated', vt.target, nameOf(vt.target)], ['original', vt.source, `${nameOf(vt.source)} (original)`]]) {
      const t = doc.createElement('track');
      t.kind = 'subtitles'; t.label = label; t.srclang = String(lang).split('-')[0] || 'und';
      t.src = URL.createObjectURL(new Blob([vtt(vt.cues, key)], { type: 'text/vtt' }));
      v.appendChild(t);
    }
    // Inline, Aiva draws its own captions; the tracks are for the phone's full-screen player.
    const mode = (full) => { const tr = v.textTracks; for (let i = 0; i < tr.length; i++) tr[i].mode = full && i === 0 ? 'showing' : 'hidden'; };
    root.setTimeout(() => mode(false), 50);
    v.addEventListener('webkitbeginfullscreen', () => mode(true));
    v.addEventListener('webkitendfullscreen', () => mode(false));
    doc.addEventListener('fullscreenchange', () => mode(doc.fullscreenElement === v));
  }

  /* Dubbing: each subtitle is read at its time in the translated language. Natural server voices are fetched a few
     subtitles ahead; languages without one use the phone's own voice through the Aiva voice engine. */
  const voiced = () => { const l = AL() && AL().get(vt.target); return !!(l && l.voiceOut); };
  function prefetch(i) {
    if (!voiced() || i >= vt.cues.length || vt.prefetch.has(i)) return;
    const c = vt.cues[i];
    vt.prefetch.set(i, root.fetch(`/api/hub-tts?lang=${encodeURIComponent(vt.target)}&text=${encodeURIComponent(c.translated.slice(0, 590))}`)
      .then((r) => (r.ok && /audio/.test(r.headers.get('Content-Type') || '') ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
  }
  async function dubTick(t) {
    const i = vt.cues.findIndex((c, k) => k >= vt.nextCue && t >= c.start - 0.05 && t < c.end);
    if (i < 0) return;
    vt.nextCue = i + 1;
    for (let k = 1; k <= 3; k++) prefetch(i + k);
    const c = vt.cues[i];
    const span = Math.max(0.6, c.end - c.start);
    if (voiced()) {
      prefetch(i);
      const url = await vt.prefetch.get(i);
      if (!vt.dub || !url) { if (vt.dub && AV()) AV().player.play(c.translated, vt.target, { langName: nameOf }); return; }
      const a = vt.dubAudio;
      a.src = url;
      a.onloadedmetadata = () => { const need = a.duration / span; a.playbackRate = need > 1.05 ? Math.min(1.6, need) : 1; };
      a.play().catch(() => {});
    } else if (AV()) {
      AV().player.play(c.translated, vt.target, { langName: nameOf });
    }
  }
  function setDub(on) {
    const v = $('vtVideo');
    vt.dub = on;
    $('vtDub').textContent = on ? '⏹ Stop translated voice' : '🔊 Play with translated voice';
    v.volume = on ? 0.12 : 1;
    if (!on) { try { vt.dubAudio.pause(); } catch {} AV() && AV().player.stop(); }
    vt.nextCue = Math.max(0, vt.cues.findIndex((c) => c.end > v.currentTime));
  }

  async function run() {
    const st = $('vtStatus');
    const file = vt.file;
    if (!file) return;
    if (file.size > MAX_BYTES) { status(st, 'error', `This file is ${Math.round(file.size / 1048576)} MB. Videos up to ${MAX_BYTES / 1048576} MB can be translated on a phone.`); return; }
    vt.cancelled = false; setDub(false);
    $('vtGo').disabled = true; $('vtCancel').hidden = false; $('vtTools').hidden = true; $('vtProgress').hidden = false;
    const bar = (f) => { $('vtBar').style.width = `${Math.round(f * 100)}%`; };
    bar(0.02);
    try {
      status(st, 'busy', 'Reading the sound of the video on your phone…');
      const { samples, duration } = await decode(file);
      if (vt.cancelled) return;
      const parts = clips(samples);
      const asked = $('vtFrom').value || 'auto';
      const segs = [], langs = {};
      for (let i = 0; i < parts.length; i++) {
        if (vt.cancelled) return;
        status(st, 'busy', `Recognising speech… ${Math.min(Math.round(parts[i].offset + CLIP), Math.round(duration))} of ${Math.round(duration)} seconds`);
        let d = null;
        for (let tries = 0; tries < 3 && !d; tries++) {
          const res = await root.fetch(`/api/hub-stt?lang=${encodeURIComponent(asked)}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(parts[i].data) });
          const body = await res.json().catch(() => ({}));
          if (res.ok) d = body;
          else if (res.status === 400 || res.status === 503) throw new Error(body.error || 'Speech recognition is not available.');
          else await new Promise((r) => root.setTimeout(r, 1500 * (tries + 1)));
        }
        if (!d) throw new Error('The speech recognition service is busy. Please try again shortly.');
        if (d.language) langs[d.language] = (langs[d.language] || 0) + (d.text || '').length;
        for (const s of d.segments || []) segs.push({ start: parts[i].offset + s.start, end: parts[i].offset + Math.max(s.end, s.start + 0.8), original: s.text });
        bar(0.05 + 0.6 * ((i + 1) / parts.length));
      }
      if (!segs.length) throw new Error('No speech was found in this video.');
      const detected = asked !== 'auto' ? asked : Object.entries(langs).sort((a, b) => b[1] - a[1])[0]?.[0] || 'auto';
      const offered = AL() && AL().get(detected);
      vt.source = offered ? detected : 'auto';
      vt.target = $('vtTo').value;
      status(st, 'busy', `${asked === 'auto' ? `Spoken language detected: ${offered ? offered.name : detected}. ` : ''}Translating ${segs.length} subtitles into ${nameOf(vt.target)}…`);
      // Translate in batches of lines; if a batch does not come back line for line, its lines are translated one by one.
      const out = new Array(segs.length);
      for (let i = 0; i < segs.length;) {
        if (vt.cancelled) return;
        let j = i, len = 0;
        while (j < segs.length && j - i < 25 && len + segs[j].original.length < 1800) { len += segs[j].original.length + 1; j++; }
        if (j === i) j = i + 1;
        const lines = segs.slice(i, j).map((s) => s.original.replace(/\s*\n\s*/g, ' '));
        if (vt.source === vt.target) lines.forEach((l, k) => { out[i + k] = l; });
        else {
          let got = null;
          try { got = (await translate(lines.join('\n'), vt.source, vt.target)).translation.split('\n').map((x) => x.trim()); } catch {}
          if (!got || got.length !== lines.length || got.some((x) => !x)) {
            got = [];
            for (const l of lines) got.push((await translate(l, vt.source, vt.target)).translation);
          }
          got.forEach((l, k) => { out[i + k] = l; });
        }
        i = j;
        bar(0.65 + 0.33 * (i / segs.length));
      }
      vt.cues = segs.map((s, k) => ({ ...s, translated: out[k] }));
      for (let k = 0; k < vt.cues.length - 1; k++) vt.cues[k].end = Math.min(vt.cues[k].end, vt.cues[k + 1].start);
      vt.prefetch.forEach((p) => p.then((u) => u && URL.revokeObjectURL(u))); vt.prefetch.clear();
      addTracks(); bar(1);
      $('vtTools').hidden = false; $('vtStage').hidden = false;
      status(st, 'ok', `Done: ${vt.cues.length} subtitles in ${nameOf(vt.target)}${vt.source !== 'auto' ? ` from ${nameOf(vt.source)}` : ''}. ${voiced() ? 'Translated voice uses a natural server voice.' : `No natural server voice for ${nameOf(vt.target)}: the translated voice uses your phone's voice if it has one.`} Machine translation can contain mistakes.`);
    } catch (e) {
      if (!vt.cancelled) status(st, 'error', e.message || 'Video translation failed. Please try again.');
    } finally {
      $('vtGo').disabled = !vt.file || !vt.stt; $('vtCancel').hidden = true; $('vtProgress').hidden = true;
    }
  }

  function setupVideo() {
    vt.dubAudio = new root.Audio(); vt.dubAudio.preload = 'auto';
    const v = $('vtVideo');
    $('vtFile').addEventListener('change', (e) => {
      vt.file = e.target.files && e.target.files[0] || null;
      if (vt.url) URL.revokeObjectURL(vt.url);
      vt.cues = []; $('vtCaption').innerHTML = ''; $('vtTools').hidden = true; setDub(false);
      if (vt.file) { vt.url = URL.createObjectURL(vt.file); v.src = vt.url; $('vtStage').hidden = false; }
      $('vtGo').disabled = !vt.file || !vt.stt;
      status($('vtStatus'), '', vt.file && !vt.stt ? '' : '');
    });
    $('vtGo').onclick = () => { AV() && AV().player.unlock(); run(); };
    $('vtCancel').onclick = () => { vt.cancelled = true; status($('vtStatus'), '', 'Video translation cancelled.'); };
    v.addEventListener('timeupdate', showCaption);
    v.addEventListener('seeked', () => { vt.nextCue = Math.max(0, vt.cues.findIndex((c) => c.end > v.currentTime)); showCaption(); });
    v.addEventListener('pause', () => { try { vt.dubAudio.pause(); } catch {} });
    $('vtShowOrig').onchange = showCaption;
    $('vtDub').onclick = () => {
      if (vt.dub) { setDub(false); return; }
      // Inside the tap, so iPhone allows the translated voice to play.
      try { vt.dubAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='; vt.dubAudio.play().catch(() => {}); } catch {}
      AV() && AV().player.unlock();
      setDub(true); prefetch(vt.nextCue); v.play().catch(() => {});
    };
    $('vtSrt').onclick = () => download(`aiva-subtitles-${vt.target}.srt`, srt(vt.cues, 'translated'), 'application/x-subrip');
    $('vtVtt').onclick = () => download(`aiva-subtitles-${vt.target}.vtt`, vtt(vt.cues, 'translated'), 'text/vtt');
    $('vtOrigSrt').onclick = () => download(`aiva-transcript-${vt.source}.srt`, srt(vt.cues, 'original'), 'application/x-subrip');
  }

  /* ---------- live camera ---------- */
  const lc = { stream: null, facing: 'environment', rec: null, seq: 0, last: '', timer: null, translated: '' };
  function stopCamera() { if (lc.stream) lc.stream.getTracks().forEach((t) => t.stop()); lc.stream = null; $('lcVideo').srcObject = null; }
  async function startCamera() {
    stopCamera();
    lc.stream = await root.navigator.mediaDevices.getUserMedia({ video: { facingMode: lc.facing, width: { ideal: 1280 } }, audio: false });
    $('lcVideo').srcObject = lc.stream; $('lcStage').hidden = false;
    try { await $('lcVideo').play(); } catch {}
  }
  function liveTranslate(text, final) {
    const tail = text.length > 400 ? text.slice(text.length - 400).replace(/^\S*\s/, '') : text;
    $('lcOrig').textContent = tail;
    root.clearTimeout(lc.timer);
    lc.timer = root.setTimeout(async () => {
      if (!tail || tail === lc.last) return;
      lc.last = tail;
      const my = ++lc.seq;
      try {
        const d = await translate(tail, $('lcFrom').value, $('lcTo').value);
        if (my === lc.seq) { lc.translated = d.translation; $('lcCaption').textContent = d.translation; }
      } catch (e) { if (my === lc.seq) status($('lcStatus'), 'error', e.message); }
    }, final ? 0 : 650);
  }
  function setupLive() {
    const AVx = AV();
    const st = $('lcStatus');
    const timer = AVx ? AVx.timerUI($('lcTimer')) : null;
    const ui = (on) => { $('lcStart').disabled = on; $('lcStop').disabled = !on; $('lcFlip').disabled = !on; };
    if (!AVx || !AVx.supported) { $('lcStart').disabled = true; status(st, '', 'Live captions need speech recognition, which this browser does not offer. Try Safari on iPhone or Chrome on Android.'); return; }
    if (!root.navigator.mediaDevices || !root.navigator.mediaDevices.getUserMedia) { $('lcStart').disabled = true; status(st, '', 'The camera is not available in this browser.'); return; }
    lc.rec = AVx.createRecorder({
      onTick: (ms, max) => timer && timer.update(ms, max),
      onText: (t) => liveTranslate(t, false),
      onEnd: (r) => {
        timer && timer.hide(); ui(false); stopCamera(); $('lcStage').hidden = !lc.translated;
        if (r.cancelled) { status(st, '', 'Live translation stopped.'); return; }
        if (r.error && !r.text) { status(st, 'error', AVx.message(r.error, nameOf($('lcFrom').value))); return; }
        if (r.text) liveTranslate(r.text, true);
        status(st, 'ok', r.limit ? 'The 3-minute limit was reached. Tap Start to continue.' : 'Live translation finished.');
        if ($('lcSpeak').checked) root.setTimeout(() => { if (lc.translated) AVx.player.play(lc.translated, $('lcTo').value, { langName: nameOf, onStatus: (k, m) => status(st, k, m) }); }, 900);
      }
    });
    $('lcStart').onclick = async () => {
      AVx.player.unlock();
      lc.last = ''; lc.translated = ''; $('lcCaption').textContent = ''; $('lcOrig').textContent = '';
      try { await startCamera(); }
      catch (e) { status(st, 'error', e && e.name === 'NotAllowedError' ? 'Camera access is blocked. Allow camera access for Aiva in your browser settings, then try again.' : 'The camera could not start. Close other apps using it and try again.'); return; }
      ui(true);
      status(st, 'listening', `Listening for ${nameOf($('lcFrom').value)}… captions appear on the picture.`);
      lc.rec.start({ lang: AVx.speechLang($('lcFrom').value) });
    };
    $('lcStop').onclick = () => lc.rec.stop();
    $('lcFlip').onclick = async () => { lc.facing = lc.facing === 'environment' ? 'user' : 'environment'; try { await startCamera(); } catch {} };
    doc.addEventListener('visibilitychange', () => { if (doc.hidden && lc.rec && lc.rec.state() !== 'idle') lc.rec.cancel(); });
  }

  async function init() {
    if (!build()) return;
    const L = AL();
    const data = L ? await L.load() : null;
    if (data) fillSelects(data);
    setupVideo(); setupLive();
    try {
      const r = await root.fetch('/api/hub-stt?info=1');
      const d = r.ok ? await r.json() : null;
      vt.stt = d && d.available ? d : null;
    } catch { vt.stt = null; }
    if (!vt.stt) {
      $('vtGo').disabled = true;
      status($('vtStatus'), '', 'Video speech recognition is not switched on for Aiva yet, so video translation is unavailable right now. Live camera translation below still works.');
    }
  }
  root.AivaVideo = { _test: { wav, clips, srt, vtt, ts } };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
