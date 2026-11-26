/* Aiva Pay: buy Aiva Trading products inside the Super App (Trade tab).
   Shows the accepted payment methods with their icons, lets the buyer pick one (card, Apple Pay, Google Pay,
   Alipay 支付宝, WeChat Pay 微信支付, Bitcoin & crypto) and a currency (GBP or Chinese yuan), then opens the
   provider's secure payment page. Only methods the merchant account has really activated can be chosen; the others
   are shown greyed with the reason. Prices come from the server, never from this page. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PENDING = 'aiva-pay-pending', ORDERS = 'aiva-pay-orders';
  const P = { data: null, sku: '', method: '', currency: 'GBP', qty: 1 };
  const money = (minor, c) => { try { return new Intl.NumberFormat(c === 'CNY' ? 'zh-CN' : 'en-GB', { style: 'currency', currency: c }).format(minor / 100); } catch { return `${c} ${(minor / 100).toFixed(2)}`; } };
  const store = (k, f) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? f; } catch { return f; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  /* Simple text badges in each method's own colours (not reproductions of the brands' logos). */
  const ICON = {
    card: '<span class="ap-ic" style="background:#1c2554;color:#fff">💳 Card</span>',
    apple_pay: '<span class="ap-ic" style="background:#000;color:#fff">Apple Pay</span>',
    google_pay: '<span class="ap-ic" style="background:#fff;color:#3c4043;border:1px solid #dadce0"><b style="color:#4285f4">G</b> Google Pay</span>',
    alipay: '<span class="ap-ic" style="background:#1677ff;color:#fff">支付宝 Alipay</span>',
    wechat_pay: '<span class="ap-ic" style="background:#07c160;color:#fff">微信支付 WeChat Pay</span>',
    crypto: '<span class="ap-ic" style="background:#f7931a;color:#fff">₿ Bitcoin · crypto</span>'
  };
  const CSS = `
  #apCard .ap-icons{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}
  #apCard .ap-ic{display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:7px;font:700 12px/1.3 system-ui,-apple-system,sans-serif;white-space:nowrap}
  #apCard .ap-off{opacity:.45;filter:grayscale(.6)}
  #apCard .ap-prod{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid #e3e7f0;border-radius:12px;padding:10px 12px;margin:8px 0;background:#fff}
  #apCard .ap-methods{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0}
  #apCard .ap-m{display:flex;flex-direction:column;align-items:flex-start;gap:5px;border:2px solid #e3e7f0;border-radius:12px;padding:9px;background:#fff;cursor:pointer;text-align:left;font:inherit;color:inherit}
  #apCard .ap-m[aria-checked="true"]{border-color:#1c2554;box-shadow:0 0 0 3px #1c255422}
  #apCard .ap-m[disabled]{cursor:not-allowed;opacity:.55}
  #apCard .ap-m small{color:#6b7791;font-size:11px;line-height:1.3}
  #apCard .ap-cur{display:inline-flex;border:1px solid #d7dbe7;border-radius:10px;overflow:hidden}
  #apCard .ap-cur button{border:0;background:#fff;padding:7px 12px;font:inherit;cursor:pointer}
  #apCard .ap-cur button[aria-pressed="true"]{background:#1c2554;color:#fff}
  #apCard .ap-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0}
  `;

  function mount() {
    const panel = $('trade');
    if (!panel || $('apCard')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    panel.insertAdjacentHTML('afterbegin', `<div class="card" id="apCard"><h3 style="margin:0 0 4px">🛍️ Aiva Shop &amp; Pay</h3>
      <p class="helper" style="margin:0">Buy Aiva Trading products in the app. 支持支付宝、微信支付和人民币付款。</p>
      <div class="ap-icons" id="apIcons" aria-label="Accepted payment methods">${Object.values(ICON).join('')}</div>
      <div id="apNotice"></div><div id="apProducts"><div class="empty">Loading products…</div></div><div id="apCheckout"></div></div>`);
    load();
    finishReturn();
  }

  async function load() {
    try {
      const r = await fetch('/api/pay/methods', { signal: AbortSignal.timeout(20000) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      P.data = d; draw();
    } catch (e) { $('apProducts').innerHTML = `<div class="notice warn">The shop could not be loaded. ${esc(e.message)}</div>`; }
  }

  function draw() {
    const d = P.data;
    $('apIcons').innerHTML = d.methods.map((m) => `<span class="${m.available ? '' : 'ap-off'}" title="${esc(m.available ? m.label : m.label + ': ' + m.reason)}">${ICON[m.icon] || esc(m.label)}</span>`).join('');
    const test = d.methods.some((m) => m.available && m.testMode);
    $('apNotice').innerHTML = (test ? '<div class="notice warn"><b>Test mode:</b> payments use the providers\' test systems and no real money is taken.</div>' : '')
      + (!d.methods.some((m) => m.available) ? '<div class="notice">Online payment is being connected. Products are shown, and checkout opens as soon as a payment method is activated.</div>' : '');
    $('apProducts').innerHTML = d.products.length ? d.products.map((p) => `<div class="ap-prod"><div><b>${esc(p.name)}</b><div class="mini">${esc(p.category)}${p.description ? ' · ' + esc(p.description) : ''}</div></div>
      <div style="text-align:right"><b>${money(p.pricePence, 'GBP')}</b><br><button type="button" class="btn gold" data-ap-buy="${esc(p.sku)}"${d.open ? '' : ' disabled'}>Buy</button></div></div>`).join('')
      : `<div class="empty">${esc(d.catalogueError || 'No products are on sale right now.')}</div>`;
  }

  function drawCheckout() {
    const d = P.data, p = d.products.find((x) => x.sku === P.sku), box = $('apCheckout');
    if (!p) { box.innerHTML = ''; return; }
    const usable = d.methods.filter((m) => m.available);
    if (!usable.find((m) => m.id === P.method)) P.method = usable[0]?.id || '';
    const m = d.methods.find((x) => x.id === P.method);
    if (m && !m.currencies.includes(P.currency)) P.currency = m.currencies[0];
    const ship = d.shipping?.flatRatePence || 0;
    P.email = $('apEmail')?.value ?? P.email ?? '';
    box.innerHTML = `<div class="card" style="margin:12px 0 0;border:1px solid #d7dbe7"><div class="row"><h4 style="margin:0">Checkout · ${esc(p.name)}</h4><button type="button" class="btn light" data-ap-close aria-label="Close checkout">✕</button></div>
      <div class="ap-row"><label>Quantity <input type="number" id="apQty" min="1" max="${Math.min(10, p.stock)}" value="${P.qty}" style="width:70px"></label>
        <span>Currency</span><span class="ap-cur" role="group" aria-label="Currency">${['GBP', 'CNY'].map((c) => `<button type="button" data-ap-cur="${c}" aria-pressed="${P.currency === c}"${m && !m.currencies.includes(c) ? ' disabled' : ''}>${c === 'CNY' ? '¥ 人民币 CNY' : '£ GBP'}</button>`).join('')}</span></div>
      <div class="mini">${money(p.pricePence * P.qty + ship, 'GBP')} total${ship ? ' including delivery' : ''}${P.currency === 'CNY' ? ' · charged in Chinese yuan at the live rate shown on the payment page; settled to Aiva in GBP' : ''}</div>
      <h5 style="margin:12px 0 4px">Choose how to pay · 选择支付方式</h5>
      <div class="ap-methods" role="radiogroup" aria-label="Payment method">${d.methods.map((x) => `<button type="button" class="ap-m" role="radio" data-ap-method="${esc(x.id)}" aria-checked="${x.id === P.method}"${x.available ? '' : ' disabled'}>
        ${ICON[x.icon] || ''}<small>${x.available ? (x.wallet ? 'Shown on the secure payment page on supported devices' : x.id === 'crypto' ? 'Bitcoin, Ethereum and other coins via BitPay, priced in GBP' : x.id === 'card' ? 'Visa, Mastercard, Amex and UnionPay' : 'Opens ' + esc(x.label)) : esc(x.reason)}</small></button>`).join('')}</div>
      <div class="field"><label for="apEmail">Email for the receipt (optional)</label><input id="apEmail" type="email" maxlength="120" autocomplete="email" value="${esc(P.email)}"></div>
      <div id="apMsg"></div>
      <button type="button" class="btn gold" id="apPay"${P.method ? '' : ' disabled'} style="margin-top:8px">Pay securely${m ? ' with ' + esc(m.label) : ''}</button>
      <p class="mini">Delivery: ${esc(d.deliveryPolicy || 'confirmed by email')} ${d.returnsPolicy ? '· Returns: ' + esc(d.returnsPolicy) : ''}</p></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function pay() {
    const btn = $('apPay'), msg = $('apMsg');
    btn.disabled = true; btn.textContent = 'Opening the secure payment page…'; msg.innerHTML = '';
    try {
      const r = await fetch('/api/pay/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: P.sku, qty: P.qty, method: P.method, currency: P.currency, email: $('apEmail').value.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || `HTTP ${r.status}`);
      const pend = store(PENDING, {}); pend[d.ref] = { provider: d.provider, invoiceId: d.invoiceId || '', sessionId: d.sessionId || '', ts: Date.now() }; save(PENDING, pend);
      location.assign(d.url);
    } catch (e) { msg.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; btn.disabled = false; btn.textContent = 'Pay securely'; }
  }

  /* Back from Stripe or BitPay: the payment is read back from the provider before anything is shown as paid. */
  async function finishReturn() {
    const u = new URLSearchParams(location.search), kind = u.get('aivaPay');
    if (!kind) return;
    history.replaceState(null, '', location.pathname + '#trade');
    if (typeof window.go === 'function') { try { window.go('trade'); } catch {} }
    const box = $('apCheckout');
    if (kind === 'cancelled') { box.innerHTML = '<div class="notice">Payment cancelled. Nothing was charged.</div>'; return; }
    let q = '';
    if (kind === 'stripe') q = 'session_id=' + encodeURIComponent(u.get('session_id') || '');
    if (kind === 'crypto') q = 'invoice=' + encodeURIComponent(store(PENDING, {})[u.get('ref') || '']?.invoiceId || '');
    box.innerHTML = '<div class="empty">Checking your payment…</div>';
    try {
      const r = await fetch('/api/pay/status?' + q), d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const pend = store(PENDING, {}); delete pend[d.ref]; save(PENDING, pend);
      if (d.paid) {
        const list = store(ORDERS, []).filter((o) => o.ref !== d.ref); list.unshift({ ...d, at: new Date().toISOString() }); save(ORDERS, list.slice(0, 30));
        box.innerHTML = `<div class="notice"><b>✅ Payment received${d.testMode ? ' (test)' : ''}</b> · ${money(d.total, d.currency)} · Order ${esc(d.ref)}. A receipt is sent by email. 付款成功。</div>`;
      } else box.innerHTML = `<div class="notice warn">The payment is ${esc(d.status || 'not complete')}. ${d.provider === 'bitpay' ? 'Crypto payments can take a few minutes to confirm on the network.' : 'Nothing has been charged.'} Order ${esc(d.ref)}.</div>`;
    } catch (e) { box.innerHTML = `<div class="notice warn">The payment status could not be checked. ${esc(e.message)}</div>`; }
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    const buy = t.closest('[data-ap-buy]'); if (buy) { P.sku = buy.dataset.apBuy; P.qty = 1; drawCheckout(); return; }
    if (t.closest('[data-ap-close]')) { P.sku = ''; $('apCheckout').innerHTML = ''; return; }
    const me = t.closest('[data-ap-method]'); if (me && !me.disabled) { P.method = me.dataset.apMethod; drawCheckout(); return; }
    const cu = t.closest('[data-ap-cur]'); if (cu && !cu.disabled) { P.currency = cu.dataset.apCur; drawCheckout(); return; }
    if (t.closest('#apPay')) pay();
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'apQty') { const p = P.data?.products.find((x) => x.sku === P.sku); P.qty = Math.max(1, Math.min(10, p?.stock || 1, Math.floor(Number(e.target.value) || 1))); drawCheckout(); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
