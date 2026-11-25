/* Aiva Finance: preferred display currency, a converter for every currency the rate feeds publish, a multi-currency
   comparison, and a separate cryptocurrency section with live prices and a crypto converter.
   Prices are still charged in the currency the supplier quotes; the preferred currency adds an indicative
   "≈" conversion beside them. Rates come from /api/finance/fx and crypto prices from /api/finance/crypto.
   Information only: Aiva does not exchange money or buy, sell or hold cryptocurrency. */
(() => {
  const KEY = 'aiva-display-currency', MULTI_KEY = 'aiva-fx-compare';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const F = { pref: 'GBP', rates: null, names: {}, base: null, meta: null, cache: {}, coins: [], crypto: null, multi: ['USD', 'EUR', 'IQD', 'TRY', 'AED', 'SAR', 'CNY', 'JPY'] };
  try { F.pref = localStorage.getItem(KEY) || 'GBP'; } catch {}
  try { const m = JSON.parse(localStorage.getItem(MULTI_KEY) || 'null'); if (Array.isArray(m) && m.length) F.multi = m.filter((c) => /^[A-Z]{3}$/.test(c)).slice(0, 20); } catch {}

  const money = (n, c, digits) => {
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c, maximumFractionDigits: digits ?? (n >= 100 ? 2 : n >= 1 ? 4 : 8) }).format(n); }
    catch { return `${c} ${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 8 })}`; }
  };
  const num = (n, d = 6) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
  const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };
  const srcLabel = (s, d) => s === 'live' ? `live mid-market rate (Coinbase), ${d.live ? new Date(d.live).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'just now'}`
    : s === 'ecb' ? `European Central Bank reference rate, ${d.date || 'latest'}` : s === 'base' ? 'same currency' : `ExchangeRate-API daily rate${d.updated ? ', updated ' + d.updated : ''}`;

  /* All rates for one base, kept for five minutes on the page. */
  async function ratesOf(base, force) {
    const hit = F.cache[base];
    if (!force && hit && Date.now() - hit.at < 300000) return hit.d;
    const d = await get(`/api/finance/fx?base=${encodeURIComponent(base)}`);
    F.cache[base] = { at: Date.now(), d };
    if (d.names) F.names = { ...F.names, ...d.names };
    return d;
  }
  async function loadRates() {
    const d = await ratesOf(F.pref);
    F.rates = d.rates; F.base = F.pref; F.meta = d;
    return F.rates;
  }

  /* Called by app.js asFmtMoney: returns " (≈ €123)" when the preferred currency differs from the quoted one. */
  window.aivaFxSuffix = (n, c) => {
    if (!F.rates || F.base !== F.pref || !c || c === F.pref || !Number.isFinite(n)) return '';
    const r = F.rates[c];
    if (!Number.isFinite(r) || r <= 0) return '';
    return ` (≈ ${money(n / r, F.pref, 0)})`;
  };

  const order = (a, b) => a === 'GBP' ? -1 : b === 'GBP' ? 1 : a.localeCompare(b);
  const options = (names, sel) => Object.keys(names).sort(order).map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${c} — ${esc(names[c])}</option>`).join('');

  function fillSelects() {
    const names = F.names;
    if (!Object.keys(names).length) return;
    for (const [id, val] of [['fxBase', $('fxBase')?.value || 'GBP'], ['fxTarget', $('fxTarget')?.value || 'USD'], ['afPref', F.pref], ['afMultiAdd', '']]) {
      const el = $(id); if (!el) continue;
      const extra = { ...names }; if (val && !(val in extra)) extra[val] = val;
      el.innerHTML = (id === 'afMultiAdd' ? '<option value="">+ Add a currency…</option>' : '') + options(extra, val);
    }
    const n = $('afCount'); if (n) n.textContent = `${Object.keys(names).length} currencies available`;
  }

  async function convert() {
    const base = $('fxBase').value, target = $('fxTarget').value, amount = Number($('fxAmount').value), out = $('fxOutput');
    if (!Number.isFinite(amount) || amount < 0) { out.textContent = 'Enter a valid amount.'; return; }
    out.textContent = 'Loading rate…';
    try {
      const d = await ratesOf(base);
      const rate = d.rates?.[target];
      if (!Number.isFinite(rate)) throw new Error(`${target} is not published against ${base}`);
      out.textContent = `${num(amount, 4)} ${base} ≈ ${num(amount * rate, 4)} ${target}\n1 ${base} ≈ ${num(rate)} ${target} · 1 ${target} ≈ ${num(1 / rate)} ${base}\nSource: ${srcLabel(d.sources?.[target], d)}. Indicative only, not a dealing rate.`;
    } catch (err) { out.textContent = `Could not load this rate. ${err.message}.`; }
    drawMulti();
  }

  async function drawMulti() {
    const el = $('afMulti'); if (!el) return;
    const base = $('fxBase')?.value || F.pref, amount = Number($('fxAmount')?.value) || 0;
    try {
      const d = await ratesOf(base);
      el.innerHTML = F.multi.filter((c) => c !== base).map((c) => {
        const r = d.rates?.[c];
        return `<div class="item row"><span><b>${esc(c)}</b> <span class="mini">${esc(F.names[c] || c)}</span></span><span>${Number.isFinite(r) ? `<b>${esc(money(amount * r, c))}</b> <span class="mini">${d.sources?.[c] === 'live' ? 'live' : d.sources?.[c] === 'ecb' ? 'ECB' : 'daily'}</span>` : '<span class="mini">not published</span>'} <button type="button" class="btn light" style="padding:2px 8px" data-af-rm="${esc(c)}" aria-label="Remove ${esc(c)}">✕</button></span></div>`;
      }).join('') || '<div class="empty">Add currencies to compare.</div>';
    } catch (err) { el.innerHTML = `<div class="notice warn">Rates could not be loaded. ${esc(err.message)}.</div>`; }
  }
  const saveMulti = () => { try { localStorage.setItem(MULTI_KEY, JSON.stringify(F.multi)); } catch {} };

  /* ---- Cryptocurrency ---- */
  function drawCrypto() {
    const el = $('afCrypto'), d = F.crypto; if (!el || !d) return;
    const q = ($('afCryptoSearch')?.value || '').trim().toLowerCase();
    const list = d.coins.filter((c) => !q || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    el.innerHTML = `<div class="results" style="max-height:420px;overflow:auto">${list.map((c) => `<div class="item row"><span>${c.rank ? `<span class="mini">#${c.rank}</span> ` : ''}<b>${esc(c.symbol)}</b> ${esc(c.name)}</span><span><b>${money(c.price, d.currency)}</b>${Number.isFinite(c.change24h) ? ` <span class="mini" style="color:${c.change24h >= 0 ? 'var(--ok)' : '#b42318'}">${c.change24h >= 0 ? '▲' : '▼'} ${Math.abs(c.change24h).toFixed(2)}% 24h</span>` : ''}</span></div>`).join('') || '<div class="empty">No coin matches.</div>'}</div><p class="mini">${d.coins.length} coins · Source: ${esc(d.source)}${d.coins[0]?.updated ? ' · ' + esc(new Date(d.coins[0].updated).toLocaleString('en-GB')) : ''}. ${esc(d.note || '')}</p>`;
  }
  function fillCryptoSelects() {
    const d = F.crypto; if (!d) return;
    const opts = (sel) => `<option value="fiat:${esc(d.currency)}"${sel === 'fiat:' + d.currency ? ' selected' : ''}>${esc(d.currency)} — ${esc(F.names[d.currency] || d.currency)}</option>` + d.coins.map((c) => `<option value="${esc(c.id)}"${sel === c.id ? ' selected' : ''}>${esc(c.symbol)} — ${esc(c.name)}</option>`).join('');
    const a = $('afCcFrom'), b = $('afCcTo');
    if (a) a.innerHTML = opts(a.value && a.value !== 'fiat:' ? a.value : d.coins[0]?.id);
    if (b) b.innerHTML = opts(b.value && b.value.startsWith('fiat:') ? 'fiat:' + d.currency : b.value || 'fiat:' + d.currency);
  }
  function cryptoConvert() {
    const d = F.crypto, out = $('afCcOut'); if (!d || !out) return;
    const price = (v) => v?.startsWith('fiat:') ? 1 : d.coins.find((c) => c.id === v)?.price;
    const label = (v) => v?.startsWith('fiat:') ? d.currency : d.coins.find((c) => c.id === v)?.symbol || v;
    const from = $('afCcFrom').value, to = $('afCcTo').value, amount = Number($('afCcAmount').value);
    const pf = price(from), pt = price(to);
    if (!Number.isFinite(amount) || amount < 0) { out.textContent = 'Enter a valid amount.'; return; }
    if (!Number.isFinite(pf) || !Number.isFinite(pt) || pt <= 0) { out.textContent = 'This pair is not available right now.'; return; }
    const v = amount * pf / pt;
    out.textContent = `${num(amount, 8)} ${label(from)} ≈ ${num(v, v >= 1 ? 4 : 10)} ${label(to)}\nBased on ${d.source} prices in ${d.currency}. Indicative only; exchanges charge fees and spreads.`;
  }
  async function loadCrypto() {
    const el = $('afCrypto'); if (!el) return;
    if (!F.crypto) el.innerHTML = '<div class="empty">Loading crypto prices…</div>';
    try {
      F.crypto = await get(`/api/finance/crypto?currency=${encodeURIComponent(F.pref)}&limit=50`);
      drawCrypto(); fillCryptoSelects(); cryptoConvert();
    } catch (err) { el.innerHTML = `<div class="notice warn">Crypto prices could not be loaded. ${esc(err.message)}.</div><button type="button" class="btn light" id="afCryptoRetry">Try again</button>`; $('afCryptoRetry').onclick = loadCrypto; }
  }

  async function setPref(c) {
    F.pref = c; F.crypto = null; try { localStorage.setItem(KEY, c); } catch {}
    const note = $('afPrefNote');
    try { await loadRates(); fillSelects(); if (note) note.textContent = `Prices quoted in other currencies now also show an indicative ≈ ${c} amount. You are always charged in the currency the airline, hotel or operator quotes.`; }
    catch (err) { if (note) note.textContent = `Rates for ${c} could not be loaded (${err.message}). Prices show in the supplier's currency only.`; }
    loadCrypto();
    document.dispatchEvent(new CustomEvent('aiva:currency', { detail: { currency: c } }));
  }

  function mount() {
    const fin = $('finance'); if (!fin || $('afPref')) return;
    const card = fin.querySelector('.card');
    const helper = card?.querySelector('.helper');
    if (helper) helper.innerHTML = 'Convert between every currency the rate feeds publish. <span id="afCount"></span>. Rates are indicative and not guaranteed for transactions.';
    const notice = card?.querySelector('.notice');
    if (notice) notice.textContent = 'Sources: live mid-market rates from Coinbase (refreshed every few minutes), European Central Bank reference rates (via Frankfurter) and, for anything else, the ExchangeRate-API daily feed. Each result names its source. No real-time execution or money transfer.';
    const actions = card?.querySelector('.actions');
    actions?.insertAdjacentHTML('afterbegin', '<button type="button" class="btn light" id="fxSwap" aria-label="Swap currencies">⇄ Swap</button>');
    $('fxOutput')?.insertAdjacentHTML('afterend', `<div class="section-head" style="margin-top:16px"><h3 style="margin:0">Compare in several currencies</h3></div><div id="afMulti" class="results"></div><div class="field" style="margin-top:8px"><label for="afMultiAdd">Add currency</label><select id="afMultiAdd"><option value="">+ Add a currency…</option></select></div>`);
    card?.insertAdjacentHTML('beforebegin', `<div class="card" id="afPrefCard"><h3 style="margin-top:0">Display currency</h3><p class="helper">Choose the currency you prefer to see. Flight, hotel and transport prices keep the supplier's own currency and add an indicative conversion.</p><div class="field"><label for="afPref">Preferred currency</label><select id="afPref"><option value="${esc(F.pref)}">${esc(F.pref)}</option></select></div><p class="mini" id="afPrefNote"></p></div>`);
    card?.insertAdjacentHTML('afterend', `<div class="section-head"><h3>Cryptocurrency</h3></div><div class="card" id="afCryptoCard"><h3 style="margin-top:0">Crypto prices</h3><p class="helper">Leading coins by market value (up to 50), priced in your display currency and refreshed every minute while this page is open. Information only: Aiva does not buy, sell or hold cryptocurrency, and crypto values can fall as well as rise.</p><div class="field"><label for="afCryptoSearch">Find a coin</label><input id="afCryptoSearch" type="search" placeholder="Bitcoin, ETH, SOL…" autocomplete="off"></div><div id="afCrypto"></div><div class="actions"><button type="button" class="btn light" id="afCryptoRefresh">Refresh prices</button></div></div>
      <div class="card" id="afCcCard"><h3 style="margin-top:0">Crypto converter</h3><p class="helper">Convert between coins, or between a coin and your display currency.</p><div class="formgrid"><div class="field"><label for="afCcFrom">From</label><select id="afCcFrom"></select></div><div class="field"><label for="afCcTo">To</label><select id="afCcTo"></select></div><div class="field"><label for="afCcAmount">Amount</label><input id="afCcAmount" type="number" min="0" step="any" value="1"></div></div><div class="actions"><button type="button" class="btn light" id="afCcSwap">⇄ Swap</button></div><div id="afCcOut" class="results" style="margin-top:12px;white-space:pre-line"></div></div>`);
    $('fxOutput').style.whiteSpace = 'pre-line';
    $('afPref').onchange = (e) => setPref(e.target.value);
    $('afCryptoRefresh').onclick = loadCrypto;
    $('afCryptoSearch').oninput = drawCrypto;
    for (const id of ['afCcFrom', 'afCcTo', 'afCcAmount']) $(id).addEventListener('input', cryptoConvert);
    $('afCcSwap').onclick = () => { const a = $('afCcFrom'), b = $('afCcTo'), v = a.value; a.value = b.value; b.value = v; cryptoConvert(); };
    const btn = $('fxFetch'); if (btn) { btn.textContent = 'Convert'; btn.onclick = convert; }
    $('fxSwap').onclick = () => { const a = $('fxBase'), b = $('fxTarget'), v = a.value; a.value = b.value; b.value = v; convert(); };
    for (const id of ['fxBase', 'fxTarget']) $(id)?.addEventListener('change', convert);
    $('fxAmount')?.addEventListener('input', () => { clearTimeout(F.t); F.t = setTimeout(convert, 350); });
    $('afMultiAdd').onchange = (e) => { const c = e.target.value; if (c && !F.multi.includes(c)) { F.multi.push(c); saveMulti(); } e.target.value = ''; drawMulti(); };
    $('afMulti').onclick = (e) => { const c = e.target.closest('[data-af-rm]')?.dataset.afRm; if (c) { F.multi = F.multi.filter((x) => x !== c); saveMulti(); drawMulti(); } };
    ratesOf('GBP').then(() => { fillSelects(); convert(); }).catch(() => {});
    setPref(F.pref);
    // Live refresh while the page is visible: crypto every minute, currency rates every five minutes.
    setInterval(() => { if (document.visibilityState === 'visible' && fin.offsetParent !== null) loadCrypto(); }, 60000);
    setInterval(() => { if (document.visibilityState === 'visible' && fin.offsetParent !== null) { F.cache = {}; loadRates().then(convert).catch(() => {}); } }, 300000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 0));
  else setTimeout(mount, 0);
})();
