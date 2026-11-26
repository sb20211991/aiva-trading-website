/* Aiva Crypto Pay: "₿ Pay with Cryptocurrency" for both Aiva platforms.
   The same file runs on aivatrading.uk (shop and buying guide basket) and in the Aiva Super App (Aiva Shop & Pay),
   and both call the one shared backend at /api/crypto-* (the app forwards it to the website's Functions).
   It only adds a button beside the existing checkout buttons; existing payment methods are untouched.
   Prices come from the server. The customer pays from their own wallet; Aiva never sees keys or seed phrases.
   (A copy lives at pocket-hub/public/aiva-crypto-pay.js; scripts/crypto-pay-test.mjs keeps the two identical.) */
(() => {
  'use strict';
  if (window.__aivaCryptoPay) return;
  window.__aivaCryptoPay = true;
  const doc = document;
  const $ = (id) => doc.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gbp = (p) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100);
  const read = (k, f) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? f; } catch { return f; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
  const IS_APP = !!$('trade') && !$('aiva-online-store') && !$('direct-checkout');
  const CART_KEY = 'aiva_cart_v2', PENDING = 'aiva_crypto_pending';
  const COIN_ICON = { BTC: '₿', ETH: 'Ξ', USDT: '₮', USDC: '$', LTC: 'Ł', SOL: '◎' };
  const S = { rates: null, coin: 'BTC', items: [], total: 0, order: null, timer: 0, tick: 0, appSku: '' };

  const CSS = `
  .acp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;margin:10px 0 0;padding:12px 18px;border-radius:999px;border:2px solid #f7931a;background:#fff8ef;color:#7a4300;font:700 15px/1.2 inherit;cursor:pointer;width:100%;max-width:420px}
  .acp-btn:hover:not([disabled]){background:#f7931a;color:#fff}
  .acp-btn[disabled]{opacity:.55;cursor:not-allowed}
  .acp-coins-line{display:block;margin:4px 0 0;color:#6b6457;font-size:12px}
  .acp-back{position:fixed;inset:0;background:rgba(10,16,14,.55);z-index:2147483000;display:flex;align-items:flex-end;justify-content:center}
  @media(min-width:640px){.acp-back{align-items:center}}
  .acp-box{background:#fff;color:#1d2420;width:100%;max-width:520px;max-height:94vh;overflow:auto;border-radius:18px 18px 0 0;padding:18px 18px 22px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
  @media(min-width:640px){.acp-box{border-radius:18px}}
  .acp-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px}
  .acp-head h2{font-size:19px;margin:0}
  .acp-x{border:0;background:#eef0ee;border-radius:50%;width:34px;height:34px;font-size:18px;cursor:pointer}
  .acp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin:12px 0}
  .acp-coin{display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:2px solid #e2e5e2;border-radius:12px;padding:9px 10px;background:#fff;cursor:pointer;text-align:left;font:inherit;color:inherit}
  .acp-coin[aria-checked="true"]{border-color:#f7931a;box-shadow:0 0 0 3px #f7931a33}
  .acp-coin b{font-size:15px}.acp-coin small{color:#6b7068;font-size:12px}
  .acp-sym{display:inline-flex;width:24px;height:24px;border-radius:50%;background:#f7931a;color:#fff;align-items:center;justify-content:center;font-weight:800;margin-right:6px;font-size:13px}
  .acp-note{font-size:12.5px;color:#5d635b;margin:8px 0}
  .acp-warn{background:#fff6e5;border:1px solid #f1c27a;border-radius:10px;padding:9px 11px;margin:8px 0;font-size:13.5px}
  .acp-ok{background:#e9f7ef;border:1px solid #7fcf9f;border-radius:10px;padding:11px;margin:8px 0}
  .acp-err{background:#fdecec;border:1px solid #f1a3a3;border-radius:10px;padding:9px 11px;margin:8px 0}
  .acp-field{display:block;margin:10px 0}.acp-field input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #cfd4cf;border-radius:10px;font:inherit}
  .acp-main{display:block;width:100%;padding:13px;border:0;border-radius:12px;background:#f7931a;color:#fff;font:700 16px/1.2 inherit;cursor:pointer;margin-top:6px}
  .acp-main[disabled]{opacity:.6;cursor:wait}
  .acp-sec{display:block;width:100%;text-align:center;padding:11px;border:1px solid #cfd4cf;border-radius:12px;background:#fff;color:#1d2420;font:600 14.5px/1.2 inherit;text-decoration:none;margin-top:8px;cursor:pointer;box-sizing:border-box}
  .acp-qr{display:flex;justify-content:center;margin:12px auto;width:220px;max-width:70vw}.acp-qr svg{width:100%;height:auto}
  .acp-amt{text-align:center;font-size:22px;font-weight:800;margin:4px 0;word-break:break-all}
  .acp-sub{text-align:center;color:#5d635b;font-size:13px}
  .acp-frame{width:100%;height:560px;border:0;border-radius:12px;margin-top:10px;background:#f5f5f5}`;

  /* ---------- basket ---------- */
  function websiteItems() {
    const c = read(CART_KEY, {});
    return c && typeof c === 'object' && !Array.isArray(c)
      ? Object.entries(c).filter(([s, q]) => /^[A-Za-z0-9_-]{2,60}$/.test(s) && Number.isSafeInteger(q) && q > 0 && q <= 10).map(([sku, quantity]) => ({ sku, quantity }))
      : [];
  }
  function appItems() {
    const q = Math.max(1, Math.min(10, parseInt($('apQty')?.value || '1', 10) || 1));
    return S.appSku ? [{ sku: S.appSku, quantity: q }] : [];
  }
  const items = () => (IS_APP ? appItems() : websiteItems());

  /* ---------- availability ---------- */
  async function loadRates(pence) {
    const r = await fetch('/api/crypto-rates' + (pence ? '?amountPence=' + pence : ''), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'HTTP ' + r.status);
    return d;
  }
  let status = null;
  async function refreshStatus() {
    try { status = await loadRates(0); } catch { status = { enabled: false, reason: 'Cryptocurrency payments are temporarily unavailable.' }; }
    syncButtons();
  }

  /* ---------- buttons beside the existing checkout buttons ---------- */
  function makeButton(id) {
    const wrap = doc.createElement('div');
    wrap.className = 'acp-wrap';
    wrap.innerHTML = `<button type="button" class="acp-btn" id="${id}" aria-haspopup="dialog">₿ Pay with Cryptocurrency</button>
      <small class="acp-coins-line">Bitcoin · Ethereum · Tether · USD Coin · Litecoin · Solana — QR code or wallet</small>`;
    wrap.querySelector('button').addEventListener('click', open);
    return wrap;
  }
  function mountWebsite() {
    const anchors = [$('aiva-checkout'), doc.querySelector('#direct-checkout [data-aiva-checkout]')].filter(Boolean);
    anchors.forEach((a, i) => { if (!a.parentElement.querySelector('.acp-btn')) a.insertAdjacentElement('afterend', makeButton('aiva-crypto-pay' + (i ? '-' + i : ''))); });
    const count = $('aiva-cart-count') || $('direct-checkout');
    if (count) new MutationObserver(syncButtons).observe(count, { childList: true, characterData: true, subtree: true });
    window.addEventListener('storage', syncButtons);
    window.addEventListener('pageshow', syncButtons);
  }
  function mountApp() {
    doc.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-ap-buy]'); if (b) S.appSku = b.getAttribute('data-ap-buy') || ''; }, true);
    const place = () => {
      const pay = $('apPay');
      if (pay && !$('aiva-crypto-pay-app')) pay.insertAdjacentElement('afterend', makeButton('aiva-crypto-pay-app'));
      syncButtons();
    };
    const target = $('trade');
    if (target) new MutationObserver(place).observe(target, { childList: true, subtree: true });
    place();
  }
  function syncButtons() {
    const has = items().length > 0;
    /* Only write when something changed: the app watches its panel for changes, so idle writes would loop. */
    doc.querySelectorAll('.acp-btn').forEach((b) => {
      const off = !(status && status.enabled && has);
      const title = !status ? 'Checking availability…' : !status.enabled ? status.reason || 'Not available yet' : has ? '' : 'Add a product to your basket first';
      if (b.disabled !== off) b.disabled = off;
      if (b.title !== title) b.title = title;
      const line = b.parentElement.querySelector('.acp-coins-line');
      const text = status && !status.enabled ? (status.reason || 'Coming soon') : status?.mode === 'test'
        ? 'TEST MODE — test-network coins only, no real money' : 'Bitcoin · Ethereum · Tether · USD Coin · Litecoin · Solana — QR code or wallet';
      if (line && line.textContent !== text) line.textContent = text;
    });
  }

  /* ---------- dialog ---------- */
  let back = null, lastFocus = null;
  function shell(html) {
    if (!back) {
      back = doc.createElement('div');
      back.className = 'acp-back';
      back.addEventListener('click', (e) => { if (e.target === back) close(); });
      doc.addEventListener('keydown', (e) => { if (back?.isConnected && e.key === 'Escape') close(); });
    }
    back.innerHTML = `<div class="acp-box" role="dialog" aria-modal="true" aria-labelledby="acpTitle"><div class="acp-head"><h2 id="acpTitle">₿ Pay with Cryptocurrency</h2>
      <button type="button" class="acp-x" aria-label="Close">✕</button></div><div id="acpBody">${html}</div></div>`;
    back.querySelector('.acp-x').addEventListener('click', close);
    if (!back.isConnected) { lastFocus = doc.activeElement; doc.body.appendChild(back); }
    back.querySelector('.acp-x').focus();
  }
  function close() {
    clearInterval(S.timer); clearInterval(S.tick);
    if (back?.isConnected) back.remove();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  const body = () => $('acpBody');

  async function open() {
    S.items = items();
    if (!S.items.length) return;
    shell('<p>Loading live exchange rates…</p>');
    try {
      const est = await estimateTotal();
      S.total = est;
      S.rates = await loadRates(est || 0);
      if (!S.rates.enabled) { body().innerHTML = `<div class="acp-warn">${esc(S.rates.reason)}</div>`; return; }
      drawChoose();
    } catch (e) { body().innerHTML = `<div class="acp-err">Live rates could not be loaded. ${esc(e.message)}</div>`; }
  }
  /* Display estimate only: the server recalculates the real total from its own catalogue. */
  async function estimateTotal() {
    try {
      /* The app reads the same catalogue through its Aiva Pay endpoint; the website reads the file directly. */
      const r = await fetch(IS_APP ? '/api/pay/methods' : '/data/aiva-products.json', { cache: 'no-store' });
      const c = await r.json();
      const by = new Map((c.products || []).map((p) => [p.sku, p]));
      let t = 0;
      for (const it of S.items) { const p = by.get(it.sku); if (!p || !Number.isSafeInteger(p.pricePence)) return 0; t += p.pricePence * it.quantity; }
      const s = c.shipping || {};
      const ship = Number.isSafeInteger(s.freeShippingThresholdPence) && t >= s.freeShippingThresholdPence ? 0 : (Number.isSafeInteger(s.flatRatePence) ? s.flatRatePence : 0);
      return t + ship;
    } catch { return 0; }
  }
  function drawChoose(err) {
    const d = S.rates;
    const email = $('apEmail')?.value || '';
    body().innerHTML = `${d.mode === 'test' ? '<div class="acp-warn"><b>Test mode:</b> uses BitPay\'s test network. No real money is taken and no goods are sent.</div>' : ''}
      <p style="margin:4px 0">Order total <b>${S.total ? gbp(S.total) : 'calculated securely'}</b>${S.total ? ' incl. delivery' : ''}. Choose a coin:</p>
      <div class="acp-grid" role="radiogroup" aria-label="Cryptocurrency">${d.coins.map((c) => `<button type="button" class="acp-coin" role="radio" data-coin="${esc(c.code)}" aria-checked="${c.code === S.coin}">
        <span><span class="acp-sym" aria-hidden="true">${COIN_ICON[c.code] || '•'}</span><b>${esc(c.name)}</b> ${esc(c.code)}</span>
        <small>${c.estimate ? '≈ ' + esc(c.estimate) + ' ' + esc(c.code) : c.gbpPerCoin ? '1 ' + esc(c.code) + ' ≈ ' + gbp(Math.round(c.gbpPerCoin * 100)) : 'Live rate at payment'}</small></button>`).join('')}</div>
      <p class="acp-note">${esc(d.note)} Rates: ${esc([...new Set(d.coins.map((c) => c.source).filter(Boolean))].join(', ') || 'BitPay')}, ${new Date(d.ratesAt).toLocaleTimeString('en-GB')}.</p>
      <label class="acp-field">Email for your receipt and order confirmation<input id="acpEmail" type="email" autocomplete="email" maxlength="120" value="${esc(email)}" required></label>
      ${err ? `<div class="acp-err" role="alert">${esc(err)}</div>` : ''}
      <button type="button" class="acp-main" id="acpGo">Continue with ${esc(S.coin)}</button>
      <p class="acp-note">Processed by BitPay, a regulated crypto payment processor. Aiva receives GBP. Send only from a wallet you control; network fees are paid by the sender.</p>`;
    body().querySelectorAll('[data-coin]').forEach((b) => b.addEventListener('click', () => { S.coin = b.dataset.coin; drawChoose(); }));
    $('acpGo').addEventListener('click', create);
  }
  async function create() {
    const btn = $('acpGo'), email = $('acpEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { drawChoose('Enter a valid email so we can confirm your order.'); return; }
    btn.disabled = true; btn.textContent = 'Creating your secure payment…';
    try {
      const r = await fetch('/api/crypto-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: S.items, coin: S.coin, email }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.orderId) throw Error(d.error || 'The payment could not be started.');
      S.order = d;
      const pend = read(PENDING, {}); pend[d.orderId] = { at: Date.now(), coin: d.coin }; write(PENDING, pend);
      drawPay();
    } catch (e) { drawChoose(e.message); }
  }
  function qrSvg(text) {
    try {
      if (typeof window.qrcode !== 'function') return '';
      const q = window.qrcode(0, 'M'); q.addData(String(text).slice(0, 600)); q.make();
      return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch { return ''; }
  }
  function drawPay() {
    const o = S.order;
    const qr = qrSvg(o.paymentUri || o.url);
    body().innerHTML = `${o.mode === 'test' ? '<div class="acp-warn"><b>Test mode</b> — use test-network coins only.</div>' : ''}
      <p class="acp-sub">Order ${esc(o.orderId.slice(-10).toUpperCase())} · ${gbp(o.totalPence)}</p>
      ${o.amount ? `<div class="acp-amt">${esc(o.amount)} ${esc(o.coin)}</div>` : ''}
      ${o.network ? `<p class="acp-sub">Network: ${esc(o.network)}</p>` : ''}
      <div class="acp-qr" aria-label="Payment QR code">${qr || '<p class="acp-sub">Open the payment below to see the QR code.</p>'}</div>
      <p class="acp-sub">Scan with your wallet app${o.expiresAt ? ` · <span id="acpLeft"></span>` : ''}</p>
      ${o.paymentUri && !/^https:/i.test(o.paymentUri) ? `<a class="acp-sec" href="${esc(o.paymentUri)}">Open in my wallet app</a>` : ''}
      <button type="button" class="acp-sec" id="acpConnect">Connect a wallet (WalletConnect, MetaMask, Coinbase, Phantom…)</button>
      <div id="acpFrame"></div>
      <div id="acpState" aria-live="polite"><p class="acp-sub">Waiting for your payment…</p></div>
      <a class="acp-sec" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Having trouble? Open the BitPay payment page</a>`;
    $('acpConnect').addEventListener('click', () => {
      $('acpFrame').innerHTML = `<iframe class="acp-frame" title="BitPay secure payment" src="${esc(o.url + (o.url.includes('?') ? '&' : '?') + 'view=iframe')}" allow="clipboard-write; payment"></iframe>`;
      $('acpConnect').remove();
    });
    countdown(); poll(o.orderId);
  }
  function countdown() {
    clearInterval(S.tick);
    const end = Date.parse(S.order?.expiresAt || '');
    if (!end) return;
    const draw = () => { const el = $('acpLeft'); if (!el) return; const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      el.textContent = s ? `price held for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'payment window closed'; };
    draw(); S.tick = setInterval(draw, 1000);
  }
  function poll(orderId) {
    clearInterval(S.timer);
    const check = async () => {
      try {
        const r = await fetch('/api/crypto-status?orderId=' + encodeURIComponent(orderId), { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok) return;
        showState(d);
      } catch { /* try again on the next tick */ }
    };
    check(); S.timer = setInterval(check, 6000);
  }
  function showState(d) {
    const box = $('acpState') || body();
    if (!box) return;
    if (d.paid) {
      clearInterval(S.timer); clearInterval(S.tick);
      const pend = read(PENDING, {}); delete pend[d.orderId]; write(PENDING, pend);
      if (!IS_APP) { try { localStorage.removeItem(CART_KEY); } catch { /* storage unavailable */ } }
      body().innerHTML = `<div class="acp-ok"><b>✅ ${d.mode === 'test' ? 'Test payment confirmed' : 'Payment confirmed'}</b><br>Order ${esc(d.reference)} is confirmed. ${esc(d.message)}</div>
        <button type="button" class="acp-main" id="acpDone">Done</button>`;
      $('acpDone').addEventListener('click', () => { close(); if (!IS_APP) location.reload(); });
      return;
    }
    if (d.state === 'expired' || d.state === 'review' || d.state === 'unknown') { clearInterval(S.timer); clearInterval(S.tick); }
    box.innerHTML = `<div class="${d.state === 'confirming' ? 'acp-ok' : d.state === 'awaiting_payment' ? '' : 'acp-warn'}"><p class="acp-sub" style="margin:6px 0">${esc(d.message)}</p></div>`;
  }

  /* Returning from the BitPay page (?cryptoOrder=...): show the verified state. */
  function resume() {
    const id = new URLSearchParams(location.search).get('cryptoOrder');
    if (!id || !/^aivacx_[a-f0-9]{32}$/.test(id)) return;
    history.replaceState(null, '', location.pathname + location.hash);
    if (IS_APP && typeof window.go === 'function') { try { window.go('trade'); } catch { /* app navigation unavailable */ } }
    S.order = { orderId: id };
    shell('<div id="acpState" aria-live="polite"><p class="acp-sub">Checking your payment with BitPay…</p></div>');
    poll(id);
  }

  function start() {
    const st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    if (IS_APP) mountApp(); else mountWebsite();
    if (typeof window.qrcode !== 'function' && !IS_APP) {
      const s = doc.createElement('script'); s.src = '/assets/qrcode.js'; s.defer = true; doc.head.appendChild(s);
    }
    refreshStatus();
    resume();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
