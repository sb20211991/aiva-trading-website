/* Aiva Car Rental — live car hire searched, compared and booked inside Aiva.
   Every price, vehicle, deposit and reservation comes from /api/car, which talks only to an authorised car
   rental supplier. With no supplier connected the section says so and offers nothing to book; it never
   invents availability, prices or confirmations.
   Payment: the supplier's payment session is mounted in this tab through its own SDK, which must expose
     window.AivaCarPay.mount(container, { sessionId, method, amount, currency }) -> Promise<paymentToken>
   Aiva never sees or stores card data; the token is passed to POST /api/car once. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE = 'aiva.car.bookings.v1';
  const METHODS = { card: ['💳', 'Card'], apple_pay: ['\u{F8FF}', 'Apple Pay'], google_pay: ['G', 'Google Pay'] };
  const TRANSMISSION = { automatic: 'Automatic', manual: 'Manual', unknown: 'Transmission not stated' };
  const api = async (url, opts) => {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(45000) });
    let data = {};
    try { data = await res.json(); } catch { /* empty or non-JSON reply */ }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Car hire is unavailable right now. Please try again.'), { data });
    return data;
  };
  const money = (m) => (m && m.amount != null
    ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: m.currency || 'GBP', maximumFractionDigits: 2 }).format(m.amount)
    : '—');
  const when = (iso) => (iso
    ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—');
  const ymd = (d) => d.toISOString().slice(0, 10);

  const CAR = { offers: [], chosen: null, query: null, busy: false, status: '' };

  const CSS = `
  .cr-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}
  .cr-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#4a5163;font-weight:600}
  .cr-form input,.cr-form select{height:44px;border:1px solid #d7dbe7;border-radius:11px;padding:0 11px;font-size:15px;background:#fff;color:#16181d;min-width:0}
  .cr-form .cr-wide{grid-column:1/-1}
  .cr-pair{display:grid;grid-template-columns:1.4fr 1fr;gap:8px}
  .cr-check{flex-direction:row!important;align-items:center;gap:8px!important;font-weight:500!important;color:#2c3242!important;height:44px}
  .cr-check input{height:18px;width:18px}
  .cr-go{grid-column:1/-1;height:50px;border:0;border-radius:13px;background:#16181d;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
  .cr-go[disabled]{opacity:.55;cursor:default}
  .cr-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}
  .cr-filters select{height:38px;border:1px solid #d7dbe7;border-radius:10px;padding:0 9px;font-size:13px;background:#fff}
  .cr-offer{border:1px solid #e6e9f2;border-radius:14px;padding:12px;margin-bottom:10px;background:#fff;display:grid;grid-template-columns:96px 1fr;gap:12px}
  .cr-offer img{width:96px;height:72px;object-fit:cover;border-radius:10px;background:#f2f4fa}
  .cr-offer h4{margin:0 0 2px;font-size:15px}
  .cr-tags{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
  .cr-tags span{font-size:11px;background:#f2f4fa;border:1px solid #e6e9f2;border-radius:999px;padding:2px 8px;color:#3b4252}
  .cr-offer ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:3px;font-size:12px;color:#4a5163}
  .cr-price{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;border-top:1px solid #eef0f6;padding-top:10px;margin-top:2px}
  .cr-price b{font-size:19px}
  .cr-badges{display:flex;gap:5px;flex-wrap:wrap}
  .cr-badges i{font-style:normal;font-size:10px;font-weight:700;border:1px solid #d7dbe7;border-radius:6px;padding:2px 6px;color:#3b4252;background:#fff}
  .cr-pick{height:42px;padding:0 16px;border:0;border-radius:11px;background:#0b6b3a;color:#fff;font-weight:700;cursor:pointer}
  .cr-note{font-size:12px;color:#4a5163;margin:4px 0}
  .cr-checkout{border:1px solid #d7dbe7;border-radius:14px;padding:12px;background:#fbfcfe}
  .cr-checkout h4{margin:0 0 8px}
  .cr-lines{display:grid;gap:2px;font-size:13px;margin-bottom:10px}
  .cr-pays{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
  .cr-pays label{display:flex;align-items:center;gap:6px;border:1px solid #d7dbe7;border-radius:10px;padding:8px 11px;font-size:13px;background:#fff;cursor:pointer}
  .cr-pay{width:100%;height:52px;border:0;border-radius:13px;background:#0b6b3a;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
  .cr-confirm{border:1px solid #b7e0c8;background:#f2fbf6;border-radius:14px;padding:12px}
  .cr-confirm b{font-size:16px}
  @media(max-width:520px){.cr-form{grid-template-columns:1fr}.cr-offer{grid-template-columns:80px 1fr}.cr-offer img{width:80px;height:64px}}
  `;

  function ensureCSS() {
    if (document.getElementById('crCss')) return;
    const s = document.createElement('style');
    s.id = 'crCss'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function defaults() {
    const now = new Date();
    now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 3);
    const back = new Date(now); back.setDate(back.getDate() + 3);
    return { from: now, to: back };
  }

  function shell() {
    const d = defaults();
    return `<form class="cr-form" id="crForm" autocomplete="off">
      <label class="cr-wide">Pick-up location<input id="crPickup" placeholder="Airport, city or address" maxlength="120" value="${esc(localStorage.getItem('aiva.car.pickup') || '')}"></label>
      <label class="cr-check cr-wide"><input type="checkbox" id="crSame" checked> Return the car to the same place</label>
      <label class="cr-wide" id="crDropWrap" hidden>Drop-off location<input id="crDropoff" placeholder="Return airport, city or address" maxlength="120"></label>
      <label>Pick-up date<input type="date" id="crFromDate" value="${ymd(d.from)}" min="${ymd(new Date())}"></label>
      <label>Pick-up time<input type="time" id="crFromTime" value="${String(d.from.getHours()).padStart(2, '0')}:00"></label>
      <label>Return date<input type="date" id="crToDate" value="${ymd(d.to)}" min="${ymd(d.from)}"></label>
      <label>Return time<input type="time" id="crToTime" value="${String(d.to.getHours()).padStart(2, '0')}:00"></label>
      <label>Driver age<input type="number" id="crAge" min="18" max="99" step="1" value="35" inputmode="numeric"></label>
      <label>Currency<select id="crCurrency"><option>GBP</option><option>EUR</option><option>USD</option></select></label>
      <button class="cr-go" type="submit" id="crGo">🔍 Search cars</button>
    </form>
    <div id="crStatus" class="cr-note" role="status" aria-live="polite"></div>
    <div id="crResults"></div>
    <div id="crCheckout"></div>
    <div id="crBookings"></div>`;
  }

  function readForm() {
    const from = new Date(`${$('crFromDate').value}T${$('crFromTime').value || '10:00'}:00`);
    const to = new Date(`${$('crToDate').value}T${$('crToTime').value || '10:00'}:00`);
    return {
      pickup: $('crPickup').value.trim(),
      dropoff: $('crSame').checked ? $('crPickup').value.trim() : $('crDropoff').value.trim(),
      from: Number.isFinite(from.getTime()) ? from.toISOString() : '',
      to: Number.isFinite(to.getTime()) ? to.toISOString() : '',
      age: Number($('crAge').value),
      currency: $('crCurrency').value,
      country: (navigator.language.split('-')[1] || 'GB').toUpperCase()
    };
  }

  function status(msg, kind = '') {
    const el = $('crStatus');
    if (!el) return;
    el.className = 'cr-note' + (kind === 'error' ? ' cr-error' : '');
    el.innerHTML = msg;
  }

  function payBadges(payment) {
    const methods = payment && Array.isArray(payment.methods) ? payment.methods : [];
    if (!payment || !payment.sessionId || !methods.length) return '';
    return `<div class="cr-badges">${methods.filter((m) => METHODS[m]).map((m) => `<i>${METHODS[m][0]} ${METHODS[m][1]}</i>`).join('')}</div>`;
  }

  function offerHTML(o) {
    const perDay = o.price.days ? `<span class="cr-note">${money({ ...o.price, amount: o.price.amount / o.price.days })} / day</span>` : '';
    return `<article class="cr-offer" data-offer="${esc(o.id)}">
      ${o.vehicle.imageUrl ? `<img src="${esc(o.vehicle.imageUrl)}" alt="${esc(o.vehicle.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '<span></span>'}
      <div>
        <h4>${esc(o.vehicle.name)}</h4>
        <div class="cr-note">${esc(o.supplier)}${o.vehicle.category ? ' · ' + esc(o.vehicle.category) : ''}${o.vehicle.seats ? ' · ' + o.vehicle.seats + ' seats' : ''}${o.vehicle.bags ? ' · ' + o.vehicle.bags + ' bags' : ''}</div>
        <div class="cr-tags"><span>${esc(TRANSMISSION[o.vehicle.transmission] || TRANSMISSION.unknown)}</span>${o.insurance ? `<span>🛡 ${esc(o.insurance)}</span>` : ''}${o.cancellation ? `<span>↩ ${esc(o.cancellation)}</span>` : ''}</div>
        <ul>
          ${o.pickup.name || o.pickup.address ? `<li>📍 ${esc([o.pickup.name, o.pickup.address].filter(Boolean).join(', '))}</li>` : ''}
          <li>💳 Deposit: ${o.deposit ? esc(money(o.deposit)) : 'not stated by the supplier'}</li>
          <li>🛣 Mileage: ${esc(o.mileage || 'not stated by the supplier')}</li>
          ${o.termsUrl ? `<li><a href="${esc(o.termsUrl)}" target="_blank" rel="noopener noreferrer">Supplier rental terms</a></li>` : ''}
        </ul>
      </div>
      <div class="cr-price"><div><b>${esc(money(o.price))}</b> ${perDay}</div>${payBadges(o.payment)}<button class="cr-pick" type="button" data-pick="${esc(o.id)}">Select this car</button></div>
    </article>`;
  }

  function renderResults() {
    const box = $('crResults');
    if (!box) return;
    if (!CAR.offers.length) { box.innerHTML = ''; return; }
    const sort = $('crSort')?.value || 'price';
    const gear = $('crGear')?.value || '';
    let list = CAR.offers.filter((o) => !gear || o.vehicle.transmission === gear);
    list = [...list].sort((a, b) => (sort === 'deposit' ? (a.deposit?.amount ?? 0) - (b.deposit?.amount ?? 0) : a.price.amount - b.price.amount));
    box.innerHTML = `<div class="cr-filters"><label class="cr-note">Sort <select id="crSort"><option value="price"${sort === 'price' ? ' selected' : ''}>Cheapest first</option><option value="deposit"${sort === 'deposit' ? ' selected' : ''}>Lowest deposit</option></select></label><label class="cr-note">Transmission <select id="crGear"><option value="">Any</option><option value="automatic"${gear === 'automatic' ? ' selected' : ''}>Automatic</option><option value="manual"${gear === 'manual' ? ' selected' : ''}>Manual</option></select></label><span class="cr-note">${list.length} of ${CAR.offers.length} cars</span></div>`
      + (list.length ? list.map(offerHTML).join('') : '<div class="empty">No car matches this transmission. Choose Any.</div>');
    $('crSort').onchange = renderResults;
    $('crGear').onchange = renderResults;
    box.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => openCheckout(b.dataset.pick); });
  }

  function summary(q) {
    return `<div class="cr-lines"><span>📍 ${esc(q.pickup)}${q.dropoff !== q.pickup ? ' → ' + esc(q.dropoff) : ''}</span><span>🗓 ${esc(when(q.from))} → ${esc(when(q.to))}</span><span>👤 Driver aged ${esc(String(q.age))}</span></div>`;
  }

  function openCheckout(id) {
    const o = CAR.offers.find((x) => x.id === id);
    if (!o) return;
    CAR.chosen = o;
    const methods = (o.payment?.methods || []).filter((m) => METHODS[m]);
    const ready = !!o.payment?.sessionId;
    const box = $('crCheckout');
    box.innerHTML = `<div class="cr-checkout"><h4>${esc(o.vehicle.name)} · ${esc(o.supplier)}</h4>${summary(CAR.query)}
      <div class="cr-lines"><span>Total ${esc(money(o.price))}</span><span>Deposit ${o.deposit ? esc(money(o.deposit)) : 'set by the supplier at the counter'}</span></div>
      <form id="crDriver" class="cr-form" autocomplete="on">
        <label>First name<input id="crFirst" required maxlength="40" autocomplete="given-name"></label>
        <label>Last name<input id="crLast" required maxlength="40" autocomplete="family-name"></label>
        <label class="cr-wide">Email<input id="crEmail" type="email" required maxlength="190" autocomplete="email"></label>
        <label>Driver age<input id="crDAge" type="number" min="18" max="99" required value="${esc(String(CAR.query.age))}"></label>
        <label>Licence country<select id="crCountry"><option>GB</option><option>IE</option><option>FR</option><option>DE</option><option>ES</option><option>IT</option><option>NL</option><option>BE</option><option>US</option><option>Other</option></select></label>
      </form>
      ${ready ? `<div class="cr-pays" role="radiogroup" aria-label="Payment method">${methods.map((m, i) => `<label><input type="radio" name="crMethod" value="${m}"${i === 0 ? ' checked' : ''}> ${METHODS[m][0]} ${METHODS[m][1]}</label>`).join('')}</div><div id="crPaySlot"></div><button class="cr-pay" type="button" id="crPay">🔒 Pay ${esc(money(o.price))} and reserve</button>` : '<div class="notice warn">This supplier has not attached a payment session to the car, so Aiva cannot take payment or hold it. Nothing has been reserved.</div>'}
      <div class="cr-note">Booked with ${esc(o.supplier)}, the rental supplier. Aiva Trading Limited arranges the booking as agent; the rental agreement, deposit and insurance are with ${esc(o.supplier)}.</div>
      <div id="crPayStatus" class="cr-note" role="status" aria-live="polite"></div></div>`;
    if (ready) $('crPay').onclick = pay;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function pay() {
    if (CAR.busy || !CAR.chosen) return;
    const o = CAR.chosen;
    const btn = $('crPay'), out = $('crPayStatus');
    const driver = {
      firstName: $('crFirst').value.trim(), lastName: $('crLast').value.trim(), email: $('crEmail').value.trim(),
      age: Number($('crDAge').value), country: $('crCountry').value
    };
    if (!driver.firstName || !driver.lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(driver.email)) {
      out.textContent = 'Enter the driver’s first name, last name and email.'; return;
    }
    const method = document.querySelector('input[name="crMethod"]:checked')?.value || 'card';
    CAR.busy = true; btn.disabled = true; btn.textContent = 'Reserving…'; out.textContent = 'Securing your payment…';
    try {
      const token = await paymentToken(o, method);
      out.textContent = 'Confirming with the supplier…';
      const booking = await api('/api/car', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'order', offerId: o.id, driver, paymentToken: token, method })
      });
      save({ ...booking, vehicle: booking.vehicle || o.vehicle.name, supplier: booking.supplier || o.supplier, collection: CAR.query });
      $('crCheckout').innerHTML = `<div class="cr-confirm"><b>✅ Car reserved${booking.testMode ? ' (test booking)' : ''}</b>
        <div class="cr-lines"><span>Reference ${esc(booking.reference || booking.bookingId)}</span><span>${esc(o.vehicle.name)} · ${esc(o.supplier)}</span><span>${esc(when(CAR.query.from))} → ${esc(when(CAR.query.to))}</span><span>${esc(money(booking.total || o.price))} paid</span></div>
        <div class="cr-note">A confirmation from ${esc(o.supplier)} is on its way to ${esc(driver.email)}. Show the supplier’s voucher at the desk with your driving licence and a card in the driver’s name.</div></div>`;
      renderBookings();
    } catch (err) {
      out.textContent = err.message;
      if (err.data?.restriction) out.textContent += ' Nothing was charged.';
      btn.disabled = false; btn.textContent = `🔒 Pay ${money(o.price)} and reserve`;
    } finally {
      CAR.busy = false;
    }
  }

  async function paymentToken(o, method) {
    if (!o.payment?.sessionId) throw new Error('This car has no payment session, so it cannot be paid for yet.');
    if (o.payment.sdkUrl && !document.querySelector(`script[data-car-pay="${o.payment.sdkUrl}"]`)) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = o.payment.sdkUrl; s.async = true; s.dataset.carPay = o.payment.sdkUrl;
        s.onload = resolve; s.onerror = () => reject(new Error('The supplier’s secure payment form could not load. Check your connection and try again.'));
        document.head.appendChild(s);
      });
    }
    if (typeof window.AivaCarPay?.mount !== 'function') throw new Error('The supplier’s secure payment form is not available for this car yet.');
    const token = await window.AivaCarPay.mount($('crPaySlot'), { sessionId: o.payment.sessionId, method, amount: o.price.amount, currency: o.price.currency });
    if (!token || typeof token !== 'string') throw new Error('The payment was not completed, so nothing was reserved.');
    return token;
  }

  function save(b) {
    let all = [];
    try { all = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { all = []; }
    all.unshift({ ...b, saved: new Date().toISOString() });
    localStorage.setItem(STORE, JSON.stringify(all.slice(0, 20)));
  }

  function renderBookings() {
    const box = $('crBookings');
    if (!box) return;
    let all = [];
    try { all = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { all = []; }
    if (!all.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="result-title">🚗 My car bookings</div>' + all.map((b) => `<div class="cr-confirm" style="margin-bottom:8px">
      <b>${esc(b.reference || b.bookingId)}</b>
      <div class="cr-lines"><span>${esc(b.vehicle || 'Car')} · ${esc(b.supplier || '')}</span><span>${esc(b.collection?.pickup || '')}${b.collection?.from ? ' · ' + esc(when(b.collection.from)) + ' → ' + esc(when(b.collection.to)) : ''}</span><span>${esc(money(b.total))}</span></div></div>`).join('');
  }

  async function search(event) {
    event?.preventDefault();
    const q = readForm();
    localStorage.setItem('aiva.car.pickup', q.pickup);
    if (q.pickup.length < 2) return status('Enter where you want to collect the car.', 'error');
    if (!q.from || !q.to) return status('Choose a collection and return date and time.', 'error');
    const box = $('crResults');
    CAR.query = q; CAR.offers = []; CAR.chosen = null;
    $('crCheckout').innerHTML = '';
    status('Searching live car hire prices…');
    box.innerHTML = '<div class="empty">Searching cars from authorised suppliers…</div>';
    $('crGo').disabled = true;
    try {
      const params = new URLSearchParams({ action: 'search', ...q });
      const data = await api('/api/car?' + params.toString());
      CAR.offers = Array.isArray(data.offers) ? data.offers : [];
      if (!data.sales?.available) {
        const s = data.sales || {};
        status(`<b>Car hire is not open for booking in Aiva yet.</b> ${esc(s.reason || '')}`, 'error');
        box.innerHTML = `<div class="notice warn">${esc(s.requirement || '')}<div class="cr-note">Suppliers Aiva can connect: ${(s.suppliers || []).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>`).join(' · ')}</div></div>`;
      } else if (!CAR.offers.length) {
        status(esc(data.note || 'No car was available for these dates.'), 'error');
        box.innerHTML = '';
      } else {
        status(`${CAR.offers.length} cars from ${new Set(CAR.offers.map((o) => o.supplier)).size} suppliers · live prices, cheapest first · ${esc(when(data.retrieved))}`);
        renderResults();
      }
    } catch (err) {
      status(esc(err.message), 'error');
      box.innerHTML = '';
    } finally {
      $('crGo').disabled = false;
    }
  }

  function mount() {
    const body = $('asCarBody');
    if (!body) return;
    ensureCSS();
    body.innerHTML = shell();
    $('crForm').onsubmit = search;
    $('crSame').onchange = () => { $('crDropWrap').hidden = $('crSame').checked; if ($('crSame').checked) $('crDropoff').value = ''; };
    $('crFromDate').onchange = () => { $('crToDate').min = $('crFromDate').value; if ($('crToDate').value < $('crFromDate').value) $('crToDate').value = $('crFromDate').value; };
    renderBookings();
    if (location.hash === '#car') body.closest('.as-card')?.scrollIntoView();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
