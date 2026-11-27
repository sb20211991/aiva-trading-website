'use strict';
/* Aiva Translate world languages: searchable language menus with clear capability marks and a coverage table.
   Loads /api/hub-languages (what the server really supports today) and upgrades the existing From/To and
   two-way conversation menus in place. It never touches the 3-minute recorder; it only tells the existing voice
   engine which recognition locale belongs to each new language. If the list cannot load, the original 14
   languages simply stay as they are. */
(function (root) {
  const doc = root.document;
  const $ = (id) => doc.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MARK = { voiceIn: '🎙', voiceOut: '🔊', video: '🎬' };
  const marks = (l) => ['voiceIn', 'voiceOut', 'video'].filter((k) => l[k]).map((k) => MARK[k]).join('');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const state = { list: null, byCode: new Map(), data: null, ready: null };

  function load() {
    if (!state.ready) {
      state.ready = root.fetch('/api/hub-languages').then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (!d || !Array.isArray(d.languages) || !d.languages.length) return null;
        state.data = d; state.list = d.languages;
        for (const l of d.languages) state.byCode.set(l.code, l);
        return d;
      }).catch(() => null);
    }
    return state.ready;
  }

  /* Lets the existing app name every language and pick the right recognition locale. */
  function teachApp() {
    try {
      // eslint-disable-next-line no-undef
      if (typeof LANG !== 'undefined' && Array.isArray(LANG)) { const have = new Set(LANG.map((l) => l[0])); for (const l of state.list) if (!have.has(l.code)) LANG.push([l.code, l.name]); }
    } catch {}
    const AV = root.AivaVoice;
    if (AV && typeof AV.speechLang === 'function' && !AV.speechLang.aivaWorld) {
      const original = AV.speechLang;
      const wrapped = (code) => { const l = state.byCode.get(code); return l && !l.core && l.speech ? l.speech : original(code); };
      wrapped.aivaWorld = true;
      AV.speechLang = wrapped;
    }
  }

  function options(list, withAuto, query) {
    const q = norm(query);
    const hit = (l) => !q || norm(l.name).includes(q) || norm(l.code).startsWith(q) || norm(l.region).includes(q);
    const groups = new Map();
    for (const l of list) if (hit(l)) { if (!groups.has(l.region)) groups.set(l.region, []); groups.get(l.region).push(l); }
    let html = withAuto && !q ? '<option value="auto">Detect language</option>' : '';
    for (const [region, items] of groups) {
      const sorted = region === 'Popular' ? items : items.slice().sort((a, b) => a.name.localeCompare(b.name));
      html += `<optgroup label="${esc(region)}">${sorted.map((l) => `<option value="${esc(l.code)}">${esc(l.name)}${marks(l) ? ' ' + marks(l) : ''}</option>`).join('')}</optgroup>`;
    }
    return { html, count: [...groups.values()].reduce((n, g) => n + g.length, 0) };
  }

  /* Upgrades one existing <select>: keeps its id, value and change handlers; adds a search box above it. */
  function upgrade(select, cfg = {}) {
    if (!select || select.dataset.aivaWorld) return;
    select.dataset.aivaWorld = '1';
    const list = cfg.filter ? state.list.filter(cfg.filter) : state.list;
    const withAuto = cfg.auto ?? !![...select.options].some((o) => o.value === 'auto');
    const search = doc.createElement('input');
    search.type = 'search'; search.className = 'lang-search'; search.autocomplete = 'off'; search.enterKeyHint = 'done';
    search.placeholder = `Search ${list.length} languages`;
    search.setAttribute('aria-label', `Search languages for ${select.closest('.field')?.querySelector('label')?.textContent || 'this menu'}`);
    const note = doc.createElement('div'); note.className = 'lang-note'; note.hidden = true;
    select.before(search); select.after(note);
    const render = (q = '') => {
      const keep = select.value;
      const { html, count } = options(list, withAuto, q);
      select.innerHTML = html || '<option value="" disabled>No language matches</option>';
      if ([...select.options].some((o) => o.value === keep)) select.value = keep;
      else if (q && count) { select.selectedIndex = [...select.options].findIndex((o) => !o.disabled); select.dispatchEvent(new Event('change', { bubbles: true })); }
      if (!q && keep && ![...select.options].some((o) => o.value === keep)) { // a value outside this menu's list
        const l = state.byCode.get(keep); if (l) { select.insertAdjacentHTML('afterbegin', `<option value="${esc(l.code)}">${esc(l.name)}</option>`); select.value = keep; }
      }
      describe();
    };
    const describe = () => {
      const l = state.byCode.get(select.value);
      const parts = [];
      if (l && l.variant) { const base = state.byCode.get(l.via); parts.push(`Voice input listens for ${l.name}. Text and voice output use ${base ? base.name : 'the standard language'}${l.via === 'ar' ? ' (Modern Standard Arabic)' : ''}.`); }
      if (l && cfg.voiceHint && !l.voiceIn) parts.push(`Voice input for ${l.name} depends on your phone and is often unavailable; you can always type.`);
      if (l && cfg.voiceHint && !l.voiceOut) parts.push(`No natural server voice for ${l.name} yet: read aloud uses your phone's voice if it has one.`);
      note.hidden = !parts.length; note.textContent = parts.join(' ');
    };
    let timer = null;
    search.addEventListener('input', () => { root.clearTimeout(timer); timer = root.setTimeout(() => render(search.value), 120); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search.blur(); } });
    select.addEventListener('change', describe);
    render();
  }

  function coverage() {
    const host = $('translate');
    if (!host || $('langCoverage')) return;
    const d = state.data, c = d.counts;
    const card = doc.createElement('div');
    card.innerHTML = `<div class="section-head"><h3>Languages and what they support</h3></div>
<div class="card" id="langCoverage"><div class="lang-stats">
<div><b>${c.text}</b><span>text translation</span></div><div><b>${c.voiceOut}</b><span>natural voice 🔊</span></div>
<div><b>${c.voiceIn}</b><span>voice input 🎙</span></div><div><b>${c.video}</b><span>video speech 🎬</span></div></div>
<p class="helper">Every language listed translates text both ways and was checked against the live translation engine${d.verifiedAt ? ` on ${esc(new Date(d.verifiedAt).toLocaleDateString())}` : ''}. ${c.variants} regional and dialect entries (for example Egyptian, Iraqi and Gulf Arabic, Taiwanese Mandarin) choose the voice-input accent; their text and voice output use the standard language. 🎙 means a recognition locale exists, but your phone decides: iPhone and Android do not offer every one. Sign-language video translation is not offered: no provider has technology reliable enough for it yet.</p>
<div class="field"><label for="langTableSearch">Search languages</label><input id="langTableSearch" type="search" placeholder="Try: Kurmanji, Dari, Cantonese, Yoruba…" autocomplete="off"></div>
<div class="table-scroll lang-table-wrap"><table class="lang-table"><thead><tr><th>Language</th><th>Text</th><th title="Voice input">🎙</th><th title="Natural voice">🔊</th><th title="Video speech recognition">🎬</th></tr></thead><tbody id="langTableBody"></tbody></table></div>
<p class="mini" id="langTableCount"></p></div>`;
    const anchor = host.querySelector('.section-head');
    host.insertBefore(card, anchor);
    while (card.firstChild) host.insertBefore(card.firstChild, card);
    card.remove();
    const tick = (b) => (b ? '✓' : '–');
    const draw = (q = '') => {
      const n = norm(q);
      const rows = state.list.filter((l) => !n || norm(l.name).includes(n) || norm(l.code).startsWith(n) || norm(l.region).includes(n));
      const shown = rows.slice(0, n ? 400 : 40);
      $('langTableBody').innerHTML = shown.map((l) => `<tr><td><b>${esc(l.name)}</b> <span class="mini">${esc(l.code)}${l.variant ? ' · dialect entry' : ''}</span></td><td>✓</td><td>${tick(l.voiceIn)}</td><td>${tick(l.voiceOut)}</td><td>${tick(l.video)}</td></tr>`).join('') || '<tr><td colspan="5">No language matches.</td></tr>';
      $('langTableCount').textContent = n ? `${rows.length} match${rows.length === 1 ? '' : 'es'}.` : `Showing ${shown.length} of ${rows.length}. Search to find any language.`;
    };
    $('langTableSearch').addEventListener('input', (e) => draw(e.target.value));
    draw();
  }

  function style() {
    if ($('aivaLangsCss')) return;
    const s = doc.createElement('style'); s.id = 'aivaLangsCss';
    s.textContent = '.lang-search{width:100%;border:1px solid #dbe1eb;border-radius:11px;padding:10px 12px;background:#f9fafc;font-size:16px;-webkit-appearance:none}.lang-search:focus{outline:none;border-color:#b98b3b;box-shadow:0 0 0 3px #e8bc6838}.lang-note{font-size:12px;line-height:1.45;color:#805817;background:#fff6e8;border-radius:9px;padding:7px 9px}.lang-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:6px}.lang-stats div{background:#f4f6fa;border-radius:12px;padding:10px;text-align:center}.lang-stats b{display:block;font-size:22px}.lang-stats span{font-size:11px;color:#627089}.lang-table{min-width:0!important}.lang-table td,.lang-table th{padding:8px 6px!important}.lang-table td:not(:first-child),.lang-table th:not(:first-child){text-align:center!important;width:42px}.lang-table-wrap{max-height:420px;overflow-y:auto;margin-top:10px;-webkit-overflow-scrolling:touch}@media(max-width:540px){.lang-stats{grid-template-columns:repeat(2,1fr)}}';
    doc.head.appendChild(s);
  }

  async function init() {
    const d = await load();
    if (!d) return;
    style(); teachApp();
    upgrade($('langFrom'), { auto: true, voiceHint: true });
    upgrade($('langTo'), { auto: false, voiceHint: true });
    upgrade($('convoLangA'), { auto: false, voiceHint: true });
    upgrade($('convoLangB'), { auto: false, voiceHint: true });
    coverage();
    root.dispatchEvent(new CustomEvent('aiva-languages', { detail: d }));
  }

  root.AivaLanguages = { load, upgrade, get: (code) => state.byCode.get(code), list: () => state.list, data: () => state.data, marks };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
