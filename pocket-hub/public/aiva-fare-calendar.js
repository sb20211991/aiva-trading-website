'use strict';
/* Aiva Search six-month flight price calendar.
   Shown under the flight results once a one-way or round-trip search has run. Each day's price is the cheapest real
   offer the connected flight provider returned for that day (via /api/travel/flight-calendar); prices are loaded month
   by month, on demand, and cached for up to 6 hours, with the check time shown. Green / orange / red mark the cheaper,
   middle and dearer thirds of the prices loaded so far; ★ marks the cheapest day of each month and 🏆 the cheapest day
   of the six months. Tapping a day runs a full live search for it inside Aiva Search; the fare is verified again before
   payment. Days with no flights, days that could not be checked and days not yet checked are all labelled as such:
   no price is ever estimated or invented. */
(function (root) {
  const doc = root.document;
  const byId = (id) => doc.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAYS_AHEAD = 184, CHUNK = 7, PARALLEL = 2;
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => isoOf(new Date(Date.parse(`${s}T12:00:00Z`) + n * 864e5));
  const monthOf = (s) => s.slice(0, 7);
  const monthName = (m, style = 'long') => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: style, year: style === 'long' ? 'numeric' : undefined, timeZone: 'UTC' });
  const dayName = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const money = (n, c, whole) => {
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c || 'GBP', maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2 }).format(n); }
    catch { return `${c || ''} ${whole ? Math.round(n) : n.toFixed(2)}`; }
  };
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

  const C = { key: '', route: null, trip: 'oneway', stay: 7, month: '', days: new Map(), loading: new Set(), open: false, seq: 0, provider: '', testMode: false };

  /* ---------- pure helpers (exported for tests) ---------- */
  function monthsFrom(today) {
    const last = addDays(today, DAYS_AHEAD), out = [];
    for (let m = monthOf(today); m <= monthOf(last);) { out.push(m); const d = new Date(`${m}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); m = isoOf(d).slice(0, 7); }
    return out;
  }
  function datesOfMonth(m, today) {
    const last = addDays(today, DAYS_AHEAD), out = [];
    for (let d = `${m}-01`; monthOf(d) === m; d = addDays(d, 1)) if (d >= today && d <= last) out.push(d);
    return out;
  }
  /* Bands from the loaded prices: cheapest third green, middle orange, dearest red; with too few prices to tell, green. */
  function bands(prices) {
    const p = prices.filter(Number.isFinite).sort((a, b) => a - b);
    if (p.length < 3 || p[0] === p[p.length - 1]) return () => 'low';
    const lo = p[Math.floor((p.length - 1) / 3)], hi = p[Math.floor(2 * (p.length - 1) / 3)];
    return (x) => (x <= lo ? 'low' : x <= hi ? 'mid' : 'high');
  }
  function cheapest(days) {
    let best = null;
    for (const d of days) if (d.status === 'live' && (!best || d.price < best.price || (d.price === best.price && d.date < best.date))) best = d;
    return best;
  }

  /* ---------- data ---------- */
  // Aiva Search keeps its state in a top-level const of app.js (shared by classic scripts, not a window property).
  // eslint-disable-next-line no-undef
  function appState() { try { return typeof AS === 'object' ? AS : null; } catch { return null; } }
  function routeFromSearch() {
    const AS = appState(), q = AS && AS.q;
    if (!q || q.trip === 'multi' || AS.kind !== 'flights') return null;
    const from = AS.fromCode, to = AS.toCode || (AS.airport && AS.airport.iata);
    if (!from || !to || !q.depart) return null;
    return { from, to, depart: q.depart, ret: q.trip === 'return' ? q.ret : '', adults: Number(q.pax) || 1, children: Number(q.children) || 0, infants: Number(q.infants) || 0, cabin: q.cabin || 'economy', currency: 'GBP' };
  }
  const settingsKey = () => [C.route.from, C.route.to, C.route.adults, C.route.children, C.route.infants, C.route.cabin, C.trip, C.trip === 'return' ? C.stay : 0].join('|');

  async function fetchDates(dates, fresh) {
    const r = C.route, my = C.seq;
    dates.forEach((d) => C.loading.add(d));
    draw();
    const qs = new URLSearchParams({ from: r.from, to: r.to, dates: dates.join(','), adults: r.adults, children: r.children, infants: r.infants, cabin: r.cabin, currency: r.currency,
      ...(C.trip === 'return' ? { stay: C.stay } : {}), ...(fresh ? { fresh: '1' } : {}) });
    try {
      const res = await root.fetch(`/api/travel/flight-calendar?${qs}`, { signal: root.AbortSignal && root.AbortSignal.timeout ? root.AbortSignal.timeout(90000) : undefined });
      const d = await res.json();
      if (my !== C.seq) return;
      if (d.configured === false) { C.notConnected = d.error || 'Live flight fares are not connected yet.'; }
      C.provider = d.provider || C.provider; C.testMode = !!d.testMode;
      for (const day of d.days || []) C.days.set(day.date, day);
      if (!res.ok) for (const x of dates) if (!C.days.has(x)) C.days.set(x, { date: x, status: 'unavailable' });
    } catch {
      if (my !== C.seq) return;
      for (const x of dates) if (!C.days.has(x) || fresh) C.days.set(x, { date: x, status: 'unavailable' });
    } finally {
      if (my === C.seq) { dates.forEach((x) => C.loading.delete(x)); draw(); }
    }
  }
  async function loadMonths(months, fresh) {
    const today = isoOf(new Date());
    const todo = months.flatMap((m) => datesOfMonth(m, today)).filter((d) => fresh || (!C.days.has(d) && !C.loading.has(d)));
    const chunks = [];
    for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
    const my = C.seq;
    await Promise.all(Array.from({ length: PARALLEL }, async () => { while (chunks.length && my === C.seq) await fetchDates(chunks.shift(), fresh); }));
  }

  /* ---------- view ---------- */
  function ensureBox() {
    let box = byId('asFareCal');
    if (box) return box;
    const anchor = byId('asFlexDays');
    if (!anchor) return null;
    box = doc.createElement('section');
    box.id = 'asFareCal'; box.className = 'fc'; box.hidden = true; box.setAttribute('aria-label', 'Six-month price calendar');
    anchor.after(box);
    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    const st = doc.createElement('style');
    st.textContent = `.fc{border:1px solid #e3e1ee;border-radius:14px;background:#fff;margin:10px 0;padding:10px 12px;color:#1c2554}
.fc-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.fc-head b{font-size:15px}
.fc-toggle{border:1px solid #d6d3e6;background:#f6f5fb;border-radius:10px;padding:8px 12px;font-weight:700;color:#1c2554}
.fc-opts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 4px;font-size:13px}.fc-opts select{border:1px solid #d6d3e6;border-radius:8px;padding:6px 8px;background:#fff;font-size:14px}
.fc-seg{display:inline-flex;border:1px solid #d6d3e6;border-radius:9px;overflow:hidden}.fc-seg button{border:0;background:#fff;padding:7px 11px;font-size:13px;color:#1c2554}.fc-seg button.on{background:#1c2554;color:#fff}
.fc-months{display:flex;gap:6px;overflow-x:auto;padding:8px 0 6px;-webkit-overflow-scrolling:touch}.fc-months button{flex:0 0 auto;border:1px solid #e3e1ee;background:#fff;border-radius:10px;padding:6px 10px;font-size:12px;color:#1c2554;text-align:center;min-width:64px}
.fc-months button.on{border-color:#1c2554;box-shadow:inset 0 0 0 1px #1c2554;font-weight:700}.fc-months button small{display:block;color:#0f7a4d;font-weight:700}
.fc-nav{display:flex;justify-content:space-between;align-items:center;margin:4px 0}.fc-nav button{border:1px solid #e3e1ee;background:#fff;border-radius:9px;width:38px;height:34px;font-size:16px}.fc-nav button:disabled{opacity:.35}
.fc-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.fc-wd{font-size:11px;color:#6b7390;text-align:center;padding:2px 0}
.fc-day{position:relative;border:1px solid #ecebf3;background:#fafafc;border-radius:9px;min-height:52px;padding:4px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;color:#1c2554}
.fc-day .n{font-weight:700;font-size:13px}.fc-day .p{font-weight:700;font-size:11.5px;margin-top:2px;white-space:nowrap}.fc-day .s{font-size:10px;color:#8a90a8;margin-top:2px}
button.fc-day{cursor:pointer}.fc-day.low{background:#e7f6ee;border-color:#9fd8b9}.fc-day.low .p{color:#0f7a4d}.fc-day.mid{background:#fff4e5;border-color:#f3c98b}.fc-day.mid .p{color:#a25a00}.fc-day.high{background:#fdecec;border-color:#f1aaaa}.fc-day.high .p{color:#b42318}
.fc-day.sel{outline:2px solid #1c2554;outline-offset:1px}.fc-day.off{background:transparent;border-color:transparent;color:#c2c5d3}.fc-day .b{position:absolute;top:2px;right:3px;font-size:10px}
.fc-day.wait .p{width:60%;height:9px;border-radius:5px;background:linear-gradient(90deg,#eceaf3,#f7f6fb,#eceaf3);background-size:200% 100%;animation:fcsh 1.1s infinite}@keyframes fcsh{to{background-position:-200% 0}}
.fc-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11.5px;color:#4b5270;margin-top:8px}.fc-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
.fc-sum{font-size:12.5px;line-height:1.5;margin-top:8px;color:#2a3256}.fc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.fc-actions button{border:1px solid #d6d3e6;background:#f6f5fb;border-radius:9px;padding:7px 11px;font-size:12.5px;color:#1c2554}
.fc-note{font-size:11.5px;color:#6b7390;margin-top:6px;line-height:1.45}
.fc-day.none .p,.fc-day.unk .p{color:#9aa0b5}.fc-legend .k{color:#6b7390}
@media(max-width:420px){.fc-day{min-height:48px}.fc-day .p{font-size:10.5px}.fc-day .s{display:none}}`;
    doc.head.appendChild(st);
    return box;
  }

  function draw() {
    const box = ensureBox();
    if (!box || !C.route) return;
    const today = isoOf(new Date()), months = monthsFrom(today);
    if (!months.includes(C.month)) C.month = months[0];
    const head = `<div class="fc-head"><div><b>📅 Price calendar · 6 months</b><div class="mini">${esc(C.route.from)} → ${esc(C.route.to)} · ${C.trip === 'return' ? `round trip, ${C.stay} night${C.stay === 1 ? '' : 's'}` : 'one way'} · ${esc(C.route.currency)}</div></div>
<button type="button" class="fc-toggle" data-fc="toggle" aria-expanded="${C.open}">${C.open ? 'Hide calendar' : 'Show prices by day'}</button></div>`;
    if (!C.open) { box.innerHTML = head; box.hidden = false; return; }
    if (C.notConnected) { box.innerHTML = head + `<div class="fc-note">${esc(C.notConnected)}</div>`; return; }
    const all = [...C.days.values()].filter((d) => monthOf(d.date) >= months[0]);
    const live = all.filter((d) => d.status === 'live');
    const band = bands(live.map((d) => d.price));
    const best = cheapest(live);
    const perMonth = Object.fromEntries(months.map((m) => [m, cheapest(live.filter((d) => monthOf(d.date) === m))]));
    const allDates = months.flatMap((m) => datesOfMonth(m, today));
    const complete = allDates.every((d) => C.days.has(d) && C.days.get(d).status !== 'unavailable');
    const mi = months.indexOf(C.month);
    const tabs = months.map((m) => `<button type="button" data-fc-month="${m}" class="${m === C.month ? 'on' : ''}">${esc(monthName(m, 'short'))}<small>${perMonth[m] ? esc(money(perMonth[m].price, perMonth[m].currency, true)) : '&nbsp;'}</small></button>`).join('');
    // Monday-first grid
    const first = new Date(`${C.month}-01T12:00:00Z`), lead = (first.getUTCDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="fc-day off" aria-hidden="true"></div>');
    const selDep = C.route.depart;
    for (let d = `${C.month}-01`; monthOf(d) === C.month; d = addDays(d, 1)) {
      const n = +d.slice(8);
      const inRange = d >= today && d <= addDays(today, DAYS_AHEAD);
      if (!inRange) { cells.push(`<div class="fc-day off"><span class="n">${n}</span></div>`); continue; }
      const x = C.days.get(d), wait = C.loading.has(d);
      let cls = 'fc-day', price = '', sub = '', badge = '', label = dayName(d);
      if (wait && !x) { cls += ' wait'; price = ''; label += ', checking price'; }
      else if (!x) { sub = 'tap'; label += ', price not checked yet'; }
      else if (x.status === 'live') {
        cls += ` ${band(x.price)}`; price = money(x.price, x.currency, true); sub = x.stops ? `${x.stops} stop${x.stops > 1 ? 's' : ''}` : 'direct';
        if (best && best.date === d) badge = '🏆'; else if (perMonth[C.month] && perMonth[C.month].date === d) badge = '★';
        label += `, from ${money(x.price, x.currency)}${badge === '🏆' ? ', cheapest in six months so far' : badge === '★' ? ', cheapest this month' : ''}`;
      } else if (x.status === 'none') { price = '—'; sub = 'no flights'; cls += ' none'; label += ', no flights'; }
      else { price = '?'; sub = 'not checked'; cls += ' unk'; label += ', price could not be checked'; }
      if (d === selDep) cls += ' sel';
      cells.push(`<button type="button" class="${cls}" data-fc-day="${d}" aria-label="${esc(label)}">${badge ? `<span class="b">${badge}</span>` : ''}<span class="n">${n}</span><span class="p">${esc(price)}</span><span class="s">${esc(sub)}</span></button>`);
    }
    const mdays = datesOfMonth(C.month, today), checked = mdays.filter((d) => C.days.has(d)).length, busy = mdays.some((d) => C.loading.has(d));
    const monthBest = perMonth[C.month];
    const oldest = live.filter((d) => monthOf(d.date) === C.month).reduce((t, d) => (!t || d.checkedAt < t ? d.checkedAt : t), '');
    const stays = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 28].map((n) => `<option value="${n}" ${n === C.stay ? 'selected' : ''}>${n} night${n === 1 ? '' : 's'}</option>`).join('');
    box.innerHTML = head + `
<div class="fc-opts"><span class="fc-seg" role="radiogroup" aria-label="Calendar trip type"><button type="button" role="radio" data-fc-trip="oneway" class="${C.trip === 'oneway' ? 'on' : ''}" aria-checked="${C.trip === 'oneway'}">One way</button><button type="button" role="radio" data-fc-trip="return" class="${C.trip === 'return' ? 'on' : ''}" aria-checked="${C.trip === 'return'}">Round trip</button></span>
${C.trip === 'return' ? `<label>Stay <select data-fc-stay aria-label="Nights away">${stays}</select></label>` : ''}</div>
<div class="fc-months" role="tablist" aria-label="Months">${tabs}</div>
<div class="fc-nav"><button type="button" data-fc-step="-1" aria-label="Previous month" ${mi <= 0 ? 'disabled' : ''}>‹</button><b>${esc(monthName(C.month))}</b><button type="button" data-fc-step="1" aria-label="Next month" ${mi >= months.length - 1 ? 'disabled' : ''}>›</button></div>
<div class="fc-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="fc-wd">${w}</div>`).join('')}${cells.join('')}</div>
<div class="fc-legend"><span><i style="background:#9fd8b9"></i>Cheapest</span><span><i style="background:#f3c98b"></i>Moderate</span><span><i style="background:#f1aaaa"></i>Expensive</span><span>★ cheapest this month</span><span class="k">— no flights</span><span class="k">? not checked</span><span>🏆 cheapest of the six months</span></div>
<div class="fc-sum">${busy ? `Checking live prices… ${checked} of ${mdays.length} days in ${esc(monthName(C.month, 'long'))}. ` : `${checked} of ${mdays.length} days checked. `}
${monthBest ? `Cheapest in ${esc(monthName(C.month, 'long'))}: <b>${esc(money(monthBest.price, monthBest.currency))}</b> on ${esc(dayName(monthBest.date))}. ` : ''}
${best ? `${complete ? 'Cheapest of the six months' : 'Cheapest found so far'}: <b>${esc(money(best.price, best.currency))}</b> on ${esc(dayName(best.date))}${best.airline ? ` (${esc(best.airline)})` : ''}.` : ''}</div>
<div class="fc-actions"><button type="button" data-fc="refresh">⟳ Refresh ${esc(monthName(C.month, 'short'))} prices</button>${complete ? '' : '<button type="button" data-fc="all">Check all 6 months</button>'}</div>
<div class="fc-note">Prices are the lowest live fares ${esc(C.provider || 'the flight provider')} returned for ${esc(C.route.adults + C.route.children + C.route.infants)} traveller${C.route.adults + C.route.children + C.route.infants > 1 ? 's' : ''}, including taxes and airline charges${oldest ? `, checked ${esc(ago(oldest))}` : ''}. Fares change: tap a day to see that day's flights live, and the fare is confirmed again before you pay. "No flights" means the provider has none that day; "not checked" means it could not be reached.${C.testMode ? ' Test fares (sandbox provider key).' : ''}</div>`;
    box.hidden = false;
  }

  /* ---------- interaction ---------- */
  function resetFor(route) {
    C.route = route;
    const trip = route.ret ? 'return' : 'oneway';
    const stay = route.ret ? Math.max(1, Math.min(60, Math.round((Date.parse(route.ret) - Date.parse(route.depart)) / 864e5))) : C.stay;
    const changed = !C.key || C.trip !== trip || C.stay !== stay;
    C.trip = trip; C.stay = stay;
    const key = settingsKey();
    if (key !== C.key || changed) { C.key = key; C.seq++; C.days = new Map(); C.loading = new Set(); C.notConnected = ''; }
    C.month = monthOf(route.depart);
    draw();
    if (C.open) loadMonths([C.month]);
  }
  function settingsChanged() { C.key = settingsKey(); C.seq++; C.days = new Map(); C.loading = new Set(); draw(); loadMonths([C.month]); }

  function onClick(e) {
    const t = e.target.closest('[data-fc],[data-fc-month],[data-fc-step],[data-fc-trip],[data-fc-day]');
    if (!t) return;
    const months = monthsFrom(isoOf(new Date()));
    if (t.dataset.fc === 'toggle') { C.open = !C.open; draw(); if (C.open) loadMonths([C.month]); return; }
    if (t.dataset.fc === 'refresh') { loadMonths([C.month], true); return; }
    if (t.dataset.fc === 'all') { loadMonths(months); return; }
    if (t.dataset.fcMonth) { C.month = t.dataset.fcMonth; draw(); loadMonths([C.month]); return; }
    if (t.dataset.fcStep) { const i = months.indexOf(C.month) + Number(t.dataset.fcStep); if (months[i]) { C.month = months[i]; draw(); loadMonths([C.month]); } return; }
    if (t.dataset.fcTrip) { if (C.trip !== t.dataset.fcTrip) { C.trip = t.dataset.fcTrip; settingsChanged(); } return; }
    if (t.dataset.fcDay) {
      const d = t.dataset.fcDay, x = C.days.get(d);
      if (x && x.status === 'none') return;
      // Search that exact day live, in Aiva Search: same route, trip type and passengers.
      if (typeof root.asSetTrip === 'function') root.asSetTrip(C.trip);
      const dep = byId('asDepart'), ret = byId('asReturn');
      if (dep) dep.value = d;
      if (ret && C.trip === 'return') ret.value = addDays(d, C.stay);
      C.route.depart = d; draw();
      if (typeof root.asSearch === 'function') root.asSearch();
      const res = byId('asFlights'); if (res && res.scrollIntoView) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  function onChange(e) {
    if (e.target.matches('[data-fc-stay]')) { C.stay = Number(e.target.value) || 7; settingsChanged(); }
  }

  /* A finished flight search (results re-rendered) shows the calendar for that route. */
  function watch() {
    const results = byId('asFlights');
    if (!results || !root.MutationObserver) return;
    let last = '';
    new root.MutationObserver(() => {
      const r = routeFromSearch();
      const box = byId('asFareCal');
      if (!r) { if (box) box.hidden = true; return; }
      const sig = [r.from, r.to, r.depart, r.ret, r.adults, r.children, r.infants, r.cabin].join('|');
      if (sig === last) return;
      last = sig;
      resetFor(r);
    }).observe(results, { childList: true, subtree: false });
  }

  root.AivaFareCalendar = { _test: { monthsFrom, datesOfMonth, bands, cheapest, addDays }, state: C };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', watch); else watch();
})(window);
