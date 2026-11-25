/* Aiva Finance: preferred display currency, a full currency converter and a separate crypto price section.
   Prices are still charged in the currency the supplier quotes; the preferred currency adds an indicative
   "≈" conversion beside them. Rates come from /api/finance/fx and crypto prices from /api/finance/crypto. */
(() => {
  const KEY = 'aiva-display-currency';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const F = { pref: 'GBP', rates: null, names: {}, base: null };
  try { F.pref = localStorage.getItem(KEY) || 'GBP'; } catch {}

  const money = (n, c, digits) => {
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c, maximumFractionDigits: digits ?? (n >= 100 ? 0 : n >= 1 ? 2 : 6) }).format(n); }
    catch { return `${c} ${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 6 })}`; }
  };
  const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };

  async function loadRates() {
    if (F.rates && F.base === F.pref) return F.rates;
    const d = await get(`/api/finance/fx?base=${encodeURIComponent(F.pref)}`);
    F.rates = d.rates; F.base = F.pref; F.names = d.names || F.names; F.meta = d;
    return F.rates;
  }

  /* Called by app.js asFmtMoney: returns " (≈ €123)" when the preferred currency differs from the quoted one. */
  window.aivaFxSuffix = (n, c) => {
    if (!F.rates || F.base !== F.pref || !c || c === F.pref || !Number.isFinite(n)) return '';
    const r = F.rates[c];
    if (!Number.isFinite(r) || r <= 0) return '';
    return ` (≈ ${money(n / r, F.pref, 0)})`;
  };

  const options = (names, sel) => Object.keys(names).sort((a, b) => a === 'GBP' ? -1 : b === 'GBP' ? 1 : a.localeCompare(b))
    .map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${c} — ${esc(names[c])}</option>`).join('');

  function fillSelects() {
    const names = F.names;
    if (!Object.keys(names).length) return;
    for (const [id, val] of [['fxBase', $('fxBase')?.value || 'GBP'], ['fxTarget', $('fxTarget')?.value || 'USD'], ['afPref', F.pref]]) {
      const el = $(id); if (!el) continue;
      const extra = { ...names }; if (!(val in extra)) extra[val] = val;
      el.innerHTML = options(extra, val);
    }
  }

  async function convert() {
    const base = $('fxBase').value, target = $('fxTarget').value, amount = Number($('fxAmount').value), out = $('fxOutput');
    if (!Number.isFinite(amount) || amount < 0) { out.textContent = 'Enter a valid amount.'; return; }
    out.textContent = 'Loading reference rate…';
    try {
      const d = await get(`/api/finance/fx?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(target)}`);
      const rate = d.rates?.[target];
      if (!Number.isFinite(rate)) throw new Error(`${target} is not published against ${base}`);
      const src = d.sources?.[target] === 'ecb' ? `European Central Bank reference rate, ${d.date || 'latest'}` : d.sources?.[target] === 'base' ? 'same currency' : `ExchangeRate-API daily rate${d.updated ? ', updated ' + d.updated : ''}`;
      out.textContent = `${amount.toLocaleString('en-GB', { maximumFractionDigits: 4 })} ${base} ≈ ${(amount * rate).toLocaleString('en-GB', { maximumFractionDigits: 4 })} ${target}\n1 ${base} ≈ ${rate.toLocaleString('en-GB', { maximumFractionDigits: 6 })} ${target}\nSource: ${src}. Indicative only, not a dealing rate.`;
    } catch (err) { out.textContent = `Could not load this rate. ${err.message}.`; }
  }

  async function loadCrypto() {
    const el = $('afCrypto'); if (!el) return;
    el.innerHTML = '<div class="empty">Loading crypto prices…</div>';
    try {
      const d = await get(`/api/finance/crypto?currency=${encodeURIComponent(F.pref)}`);
      el.innerHTML = `<div class="results">${d.coins.map((c) => `<div class="item row"><span><b>${esc(c.symbol)}</b> ${esc(c.name)}</span><span><b>${money(c.price, d.currency)}</b>${Number.isFinite(c.change24h) ? ` <span class="mini" style="color:${c.change24h >= 0 ? 'var(--ok)' : '#b42318'}">${c.change24h >= 0 ? '▲' : '▼'} ${Math.abs(c.change24h).toFixed(2)}% 24h</span>` : ''}</span></div>`).join('')}</div><p class="mini">Source: ${esc(d.source)}${d.coins[0]?.updated ? ' · ' + esc(new Date(d.coins[0].updated).toLocaleString('en-GB')) : ''}. ${esc(d.note || '')}</p>`;
    } catch (err) { el.innerHTML = `<div class="notice warn">Crypto prices could not be loaded. ${esc(err.message)}.</div><button type="button" class="btn light" id="afCryptoRetry">Try again</button>`; $('afCryptoRetry').onclick = loadCrypto; }
  }

  async function setPref(c) {
    F.pref = c; try { localStorage.setItem(KEY, c); } catch {}
    const note = $('afPrefNote');
    try { await loadRates(); if (note) note.textContent = `Prices quoted in other currencies now also show an indicative ≈ ${c} amount. You are always charged in the currency the airline, hotel or operator quotes.`; }
    catch (err) { if (note) note.textContent = `Rates for ${c} could not be loaded (${err.message}). Prices show in the supplier's currency only.`; }
    loadCrypto();
    document.dispatchEvent(new CustomEvent('aiva:currency', { detail: { currency: c } }));
  }

  function mount() {
    const fin = $('finance'); if (!fin || $('afPref')) return;
    const card = fin.querySelector('.card');
    const helper = card?.querySelector('.helper');
    if (helper) helper.textContent = 'Indicative reference rates for more than 150 currencies. Rates are not guaranteed for transactions.';
    const notice = card?.querySelector('.notice');
    if (notice) notice.textContent = 'Sources: European Central Bank reference rates (via Frankfurter) and, for currencies the ECB does not publish such as IQD, the ExchangeRate-API daily feed. No real-time execution or money transfer.';
    card?.insertAdjacentHTML('beforebegin', `<div class="card" id="afPrefCard"><h3 style="margin-top:0">Display currency</h3><p class="helper">Choose the currency you prefer to see. Flight, hotel and transport prices keep the supplier's own currency and add an indicative conversion.</p><div class="field"><label for="afPref">Preferred currency</label><select id="afPref"><option value="${esc(F.pref)}">${esc(F.pref)}</option></select></div><p class="mini" id="afPrefNote"></p></div>`);
    card?.insertAdjacentHTML('afterend', `<div class="section-head"><h3>Cryptocurrency prices</h3></div><div class="card" id="afCryptoCard"><p class="helper">Bitcoin, Ethereum and other major coins in your display currency. Information only: Aiva does not buy, sell or hold cryptocurrency, and crypto values can fall as well as rise.</p><div id="afCrypto"></div><div class="actions"><button type="button" class="btn light" id="afCryptoRefresh">Refresh prices</button></div></div>`);
    $('afPref').onchange = (e) => setPref(e.target.value);
    $('afCryptoRefresh').onclick = loadCrypto;
    const btn = $('fxFetch'); if (btn) btn.onclick = convert; // replaces the ECB-only lookup with the wider rate feed
    fetch('/api/finance/fx?base=GBP&symbols=GBP').then((r) => r.json()).then((d) => { F.names = d.names || {}; fillSelects(); }).catch(() => {});
    setPref(F.pref);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 0));
  else setTimeout(mount, 0);
})();
