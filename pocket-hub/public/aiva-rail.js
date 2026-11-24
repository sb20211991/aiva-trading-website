/* Aiva Train and Aiva Tram.
   Two dedicated sections inside Aiva Search: station and address search, nearby station detection from the
   device's location, live train and tram journeys with real platforms, delays and cancellations, and an
   in-app checkout that only appears when an authorised rail distributor can quote a fare and take payment.
   Everything stays inside Aiva: no external page, no new tab, no link out to a carrier's website.
   Data: /api/rail/* (Transitous / MOTIS over open GTFS and GTFS-realtime feeds). Fares and tickets: the
   distributor connected through /api/rail/order, never invented here. */
(() => {
  const SVG = {
    train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2.8" width="14" height="14.2" rx="3.2"/><path d="M5 10.2h14"/><circle cx="9" cy="13.6" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="13.6" r="1.15" fill="currentColor" stroke="none"/><path d="M8.6 20.8l1.9-3.8M15.4 20.8l-1.9-3.8M7.4 20.8h9.2"/></svg>',
    tram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16.6V9.4A3.4 3.4 0 0 1 7.4 6h9.2A3.4 3.4 0 0 1 20 9.4v7.2"/><path d="M4 12.6h16"/><path d="M9 6V3.6h6V6M12 3.6V1.8"/><circle cx="8" cy="17.8" r="1.5"/><circle cx="16" cy="17.8" r="1.5"/><path d="M4 16.6h16M9.4 9.4h1.8M12.8 9.4H14.6"/></svg>',
    walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4" r="1.8"/><path d="M11.5 21l1.6-5.2-2.4-2.1.7-4.3 3 2.1 2.2 1.3M9.4 10.4L8 14l2.3 1.6"/><path d="M13.1 15.8l1.9 5.2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l3-3M17 20l-3-3"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/></svg>',
    live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M6.5 17.5a7.8 7.8 0 0 1 0-11M17.5 6.5a7.8 7.8 0 0 1 0 11"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v1.2a2.3 2.3 0 0 0 0 4.6v1.2A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5v-1.2a2.3 2.3 0 0 0 0-4.6z"/><path d="M12 7v2.4M12 11.6v1.2M12 14.8V17"/></svg>'
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);
  const TICKETS = 'aiva-rail-tickets-v1';
  const dur = (m) => (m == null ? '' : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
  const dist = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`);
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const soon = () => { const d = new Date(Date.now() + 30 * 60000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const money = (n, c) => { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c || 'GBP', maximumFractionDigits: 2 }).format(n); } catch { return `${c} ${n}`; } };
  const dayLabel = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''; };
  const readTickets = () => { try { const d = JSON.parse(localStorage.getItem(TICKETS) || '[]'); return Array.isArray(d) ? d : []; } catch { return []; } };
  const writeTickets = (list) => { try { localStorage.setItem(TICKETS, JSON.stringify(list.slice(0, 40))); } catch { /* storage full or blocked */ } };

  const STYLE = `
  .rail-card{margin-top:18px;border:1px solid #e3e6f3;box-shadow:0 3px 14px #1d29400f}
  .rail-card .as-card-head{align-items:flex-start;border-bottom:0;padding-bottom:0}
  .rail-brand{display:flex;gap:12px;align-items:center;min-width:0}
  .rail-mark{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;flex:none;color:#fff;background:linear-gradient(140deg,#2f4b7c,#12224a)}
  .rail-card[data-rail-section="tram"] .rail-mark{background:linear-gradient(140deg,#1d7a6c,#0d3f47)}
  .rail-mark svg{width:26px;height:26px}
  .rail-brand h3{margin:0;font-size:19px;color:#1c2554;display:flex;align-items:center;gap:8px}
  .rail-brand p{margin:2px 0 0;color:#64708a;font-size:12.5px;line-height:1.4}
  .rail-tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#0f6b52;background:#e8f6ef;border-radius:999px;padding:5px 10px;white-space:nowrap}
  .rail-tag svg{width:13px;height:13px}
  .rail-tag.off{color:#8a5a12;background:#fdf3e2}
  .rail-body{padding-top:0}
  .rail-form{display:grid;gap:10px;margin:12px 0 6px}
  .rail-row{display:grid;grid-template-columns:1.15fr auto 1.15fr;gap:9px;align-items:end}
  .rail-row.second{grid-template-columns:repeat(4,minmax(0,1fr))}
  .rail-row.second .rail-go{grid-column:1/-1}
  .rail-field{display:grid;gap:4px;min-width:0;font-size:12px;font-weight:700;color:#5b6884}
  .rail-field input[type=text],.rail-field input:not([type]),.rail-field input[type=date],.rail-field input[type=time],.rail-field select{width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #dbe1ee;border-radius:11px;background:#fff;font:inherit;font-size:14px;font-weight:600;color:#12203c}
  .rail-field input:focus,.rail-field select:focus{outline:none;border-color:#2f4b7c;box-shadow:0 0 0 3px #2f4b7c22}
  .rail-input{display:flex;align-items:center;gap:4px}
  .rail-input input{flex:1;min-width:0}
  .rail-geo{flex:none;width:38px;height:40px;display:grid;place-items:center;border:1px solid #dbe1ee;background:#f7f8fd;border-radius:10px;color:#2f4b7c;cursor:pointer}
  .rail-geo svg{width:18px;height:18px}
  .rail-geo:hover{background:#eef1fb}
  .rail-swap{width:38px;height:40px;border:1px solid #dbe1ee;background:#fff;border-radius:10px;color:#5b6884;display:grid;place-items:center;cursor:pointer}
  .rail-swap svg{width:17px;height:17px}
  .rail-go{width:100%;border:0;border-radius:11px;padding:12px 16px;font:inherit;font-weight:800;color:#fff;background:linear-gradient(135deg,#2f4b7c,#12224a);display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}
  .rail-card[data-rail-section="tram"] .rail-go{background:linear-gradient(135deg,#1d7a6c,#0d3f47)}
  .rail-go svg{width:17px;height:17px}
  .rail-go:disabled{opacity:.6;cursor:default}
  .rail-suggest{border:1px solid #e1e5f0;border-radius:12px;background:#fff;box-shadow:0 10px 24px #16213c14;padding:5px;display:grid;gap:2px}
  .rail-suggest[hidden]{display:none}
  .rail-suggest button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:none;padding:9px 10px;border-radius:9px;font:inherit;color:#16213c;cursor:pointer}
  .rail-suggest button:hover,.rail-suggest button:focus-visible{background:#f2f5fc;outline:none}
  .rail-suggest small{display:block;color:#6b7791;font-size:11.5px}
  .rail-suggest .rail-kind{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#2f4b7c;background:#eef2fb;border-radius:6px;padding:3px 6px;margin-left:auto}
  .rail-msg{margin:8px 0;font-size:13px;line-height:1.45;border-radius:11px;padding:10px 12px;background:#f1f5fd;color:#33507a}
  .rail-msg.err{background:#fdeeee;color:#9b2335}
  .rail-msg.ok{background:#eaf7f1;color:#0f6b52}
  .rail-msg[hidden]{display:none}
  .rail-nearby{display:flex;flex-wrap:wrap;gap:7px;margin:4px 0 10px}
  .rail-nearby[hidden]{display:none}
  .rail-nearby button{border:1px solid #dbe1ee;background:#fff;border-radius:999px;padding:7px 11px;font:inherit;font-size:12.5px;font-weight:700;color:#22304d;cursor:pointer}
  .rail-nearby button:hover{border-color:#2f4b7c;color:#1c3260}
  .rail-board{border:1px solid #e6e9f2;border-radius:13px;padding:11px 13px;background:#fbfcff;margin:0 0 12px}
  .rail-board h4{margin:0 0 6px;font-size:13px;color:#1c2554;display:flex;align-items:center;gap:7px}
  .rail-board-row{display:grid;grid-template-columns:52px 1fr auto;gap:10px;align-items:baseline;font-size:13px;padding:5px 0;border-top:1px dashed #e7eaf2}
  .rail-board-row:first-of-type{border-top:0}
  .rail-board-row b{font-variant-numeric:tabular-nums}
  .rail-board-row .late{color:#b45309;font-weight:700}
  .rail-board-row .cancelled{color:#aa3246;font-weight:700}
  .rail-summary{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 8px;font-size:12.5px;color:#64708a}
  .rail-trip{display:grid;grid-template-columns:1fr auto;gap:12px;border:1px solid #e6e9f2;border-radius:14px;padding:12px 13px;margin:0 0 10px;background:#fff}
  .rail-trip.best{border-color:#2f4b7c;box-shadow:0 0 0 2px #2f4b7c1f}
  .rail-trip-head{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
  .rail-trip-head .times{font-size:17px;font-weight:900;letter-spacing:-.2px;color:#111d3a;font-variant-numeric:tabular-nums}
  .rail-trip-head .dur{font-size:13px;color:#4d5a75;font-weight:700}
  .rail-badge{font-size:10.5px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;border-radius:999px;padding:4px 8px;background:#eef2fb;color:#2f4b7c}
  .rail-badge.cheap{background:#e8f6ef;color:#0f6b52}
  .rail-badge.live{background:#fdeeee;color:#9b2335}
  .rail-badge.cancel{background:#fdecee;color:#aa3246}
  .rail-leg{display:grid;grid-template-columns:20px 1fr;gap:8px;margin-top:7px;font-size:13px;color:#22304d}
  .rail-leg svg{width:16px;height:16px;margin-top:2px;color:#4d5a75}
  .rail-leg small{display:block;color:#6b7791;font-size:11.5px;margin-top:1px}
  .rail-side{display:flex;flex-direction:column;align-items:flex-end;gap:7px;min-width:112px}
  .rail-price{font-size:20px;font-weight:900;color:#111d3a;letter-spacing:-.4px;text-align:right}
  .rail-price small{display:block;font-size:10.5px;font-weight:700;color:#6b7791;letter-spacing:0;margin-top:2px}
  .rail-nofare{font-size:12px;font-weight:700;color:#6b7791;text-align:right;max-width:132px;line-height:1.35}
  .rail-select{border:0;border-radius:10px;padding:10px 14px;font:inherit;font-weight:800;font-size:13px;background:#2f4b7c;color:#fff;cursor:pointer;white-space:nowrap}
  .rail-card[data-rail-section="tram"] .rail-select,.rail-card[data-rail-section="tram"] .rail-checkout .pay{background:#1d7a6c}
  .rail-checkout{border:2px solid #2f4b7c;border-radius:15px;padding:14px;margin:14px 0}
  .rail-card[data-rail-section="tram"] .rail-checkout{border-color:#1d7a6c}
  .rail-checkout h4{margin:0 0 4px;font-size:16px;color:#1c2554}
  .rail-checkout .close{float:right;border:0;background:#eef1f8;border-radius:9px;padding:7px 11px;font:inherit;font-size:12px;font-weight:800;color:#22304d;cursor:pointer}
  .rail-note{background:#f1f5fd;border-radius:11px;padding:11px 12px;font-size:12.5px;line-height:1.5;color:#33507a;margin:10px 0}
  .rail-note.warn{background:#fff6e8;color:#7a5316}
  .rail-pax{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}
  .rail-pax label{display:grid;gap:3px;font-size:11.5px;font-weight:700;color:#5b6884}
  .rail-pax input{padding:9px 10px;border:1px solid #dbe1ee;border-radius:9px;font:inherit;font-size:13px;font-weight:600;color:#12203c;width:100%;box-sizing:border-box}
  .rail-pay{border:0;border-radius:10px;padding:12px 16px;font:inherit;font-weight:800;color:#fff;background:#2f4b7c;cursor:pointer;width:100%}
  .rail-pay:disabled{opacity:.55;cursor:default}
  .rail-tickets{margin:14px 0 4px}
  .rail-tickets h4{margin:0 0 8px;font-size:14px;color:#1c2554;display:flex;gap:7px;align-items:center}
  .rail-tickets h4 svg{width:16px;height:16px}
  .rail-ticket{display:grid;grid-template-columns:auto 1fr;gap:12px;border:1px solid #dfe5f0;border-radius:13px;padding:11px 12px;margin-bottom:9px;background:#fff}
  .rail-ticket .qr{width:88px;height:88px;background:#fff;border-radius:8px;display:grid;place-items:center;overflow:hidden}
  .rail-ticket .qr svg{width:88px;height:88px;display:block}
  .rail-ticket b{font-size:13.5px;color:#111d3a}
  .rail-ticket small{display:block;color:#64708a;font-size:11.5px;margin-top:2px;line-height:1.4}
  .rail-ticket .pnr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;letter-spacing:.06em;color:#1c2554}
  .rail-attrib{margin:14px 0 0;padding-top:10px;border-top:1px solid #eef1f7;color:#6b7791;line-height:1.5}
  @media(max-width:760px){.rail-row,.rail-row.second{grid-template-columns:1fr}.rail-swap{justify-self:start;width:100%}.rail-trip{grid-template-columns:1fr}.rail-side{flex-direction:row;align-items:center;justify-content:space-between;width:100%}.rail-nofare{text-align:left;max-width:none}.rail-pax{grid-template-columns:1fr}}`;

  function style() {
    if (document.getElementById('aivaRailStyles')) return;
    const el = document.createElement('style');
    el.id = 'aivaRailStyles';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  function mount(mode) {
    const key = mode === 'tram' ? 'Tram' : 'Train';
    const body = $('rail' + key + 'Body');
    if (!body) return null;
    const noun = mode === 'tram' ? 'tram' : 'train';
    body.innerHTML = `<form class="rail-form" id="rail${key}Form" autocomplete="off" novalidate>
      <div class="rail-row">
        <label class="rail-field">From
          <span class="rail-input"><input id="rail${key}From" placeholder="Station, hotel or address" maxlength="120" aria-label="Travelling from">
          <button type="button" class="rail-geo" data-rail-geo aria-label="Use my current location">${SVG.pin}</button></span>
        </label>
        <button type="button" class="rail-swap" data-rail-swap aria-label="Swap starting point and destination">${SVG.swap}</button>
        <label class="rail-field">To
          <input id="rail${key}To" placeholder="Station, hotel or address" maxlength="120" aria-label="Travelling to">
        </label>
      </div>
      <div class="rail-row second">
        <label class="rail-field">Date<input id="rail${key}Date" type="date" aria-label="Travel date"></label>
        <label class="rail-field">Time<input id="rail${key}Time" type="time" aria-label="Travel time"></label>
        <label class="rail-field">Travellers<select id="rail${key}Pax" aria-label="Travellers">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
        <span></span>
        <button class="rail-go" id="rail${key}Go" type="submit">${SVG.search}Search ${noun}s</button>
      </div>
      <div class="rail-suggest" id="rail${key}Suggest" role="listbox" aria-label="Matching stations and places" hidden></div>
    </form>
    <div class="rail-nearby" id="rail${key}Nearby" hidden></div>
    <div class="rail-msg" id="rail${key}Msg" role="status" aria-live="polite" hidden></div>
    <div class="rail-results" id="rail${key}Results"><div class="rail-summary"><span>Search a route to see live ${noun} times.</span></div></div>
    <div class="rail-checkout" id="rail${key}Checkout" hidden></div>
    <div class="rail-tickets" id="rail${key}Tickets" hidden></div>
    <p class="mini rail-attrib">Live ${noun} times, platforms, delays and cancellations: Transitous (MOTIS) over open GTFS and GTFS-real-time feeds · © OpenStreetMap contributors. Operators and carriers are named on every service. Fares and tickets are sold inside Aiva only through an authorised distributor.</p>`;

    const el = {
      form: $('rail' + key + 'Form'), from: $('rail' + key + 'From'), to: $('rail' + key + 'To'),
      date: $('rail' + key + 'Date'), time: $('rail' + key + 'Time'), pax: $('rail' + key + 'Pax'),
      go: $('rail' + key + 'Go'), suggest: $('rail' + key + 'Suggest'), nearby: $('rail' + key + 'Nearby'),
      msg: $('rail' + key + 'Msg'), results: $('rail' + key + 'Results'), checkout: $('rail' + key + 'Checkout'),
      tickets: $('rail' + key + 'Tickets'), tag: $('rail' + key + 'Tag')
    };
    const st = { mode, key, el, from: null, to: null, active: '', timer: null, seq: 0, data: null, selected: -1, busy: false };
    st.el.date.value = today();
    st.el.time.value = soon();

    const say = (text, kind) => {
      if (!text) { el.msg.hidden = true; el.msg.textContent = ''; return; }
      el.msg.hidden = false;
      el.msg.className = 'rail-msg' + (kind ? ' ' + kind : '');
      el.msg.textContent = text;
    };

    const setTag = (text, off) => { if (el.tag) { el.tag.innerHTML = `${SVG.live}${esc(text)}`; el.tag.classList.toggle('off', !!off); } };

    async function api(path, ms = 45000) {
      const res = await fetch(path, { signal: AbortSignal.timeout(ms) });
      let data = {};
      try { data = await res.json(); } catch { /* non-JSON reply */ }
      if (!res.ok) throw new Error(data.error || 'Aiva could not reach the rail service. Please try again.');
      return data;
    }

    function suggestions(which) {
      const input = which === 'from' ? el.from : el.to;
      const text = input.value.trim();
      clearTimeout(st.timer);
      if (text.length < 2) { el.suggest.hidden = true; return; }
      st.timer = setTimeout(async () => {
        const mine = ++st.seq;
        try {
          const d = await api(`/api/rail/stations?q=${encodeURIComponent(text)}&mode=${mode}&limit=6`);
          if (mine !== st.seq) return;
          const list = [...(d.stations || []), ...(d.places || [])].slice(0, 7);
          if (!list.length) { el.suggest.hidden = true; return; }
          st.active = which;
          el.suggest.hidden = false;
          el.suggest.innerHTML = list.map((s, i) => `<button type="button" role="option" data-rail-pick="${i}">
            ${s.kind === 'station' ? SVG[mode] : SVG.pin}
            <span><b>${esc(s.name)}</b><small>${s.kind === 'station' ? esc((s.modes || []).join(' · ') || 'station') + (s.country ? ' · ' + esc(s.country) : '') : 'Address or place · walk to the nearest station'}</small></span>
            <span class="rail-kind">${s.kind === 'station' ? esc(mode) : 'place'}</span></button>`).join('');
          st.list = list;
        } catch { if (mine === st.seq) el.suggest.hidden = true; }
      }, 260);
    }

    function pick(i) {
      const s = st.list?.[i];
      if (!s) return;
      st[st.active] = s;
      (st.active === 'from' ? el.from : el.to).value = s.name;
      el.suggest.hidden = true;
      if (s.kind === 'station') {
        say(`${s.name} selected${s.country ? ' · ' + s.country : ''}.`, 'ok');
        if (st.active === 'from') board(s);
      } else {
        say(`${s.name} selected. Aiva will walk you to the nearest ${noun} station and show the live connection.`, 'ok');
      }
    }

    el.suggest.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rail-pick]');
      if (b) pick(Number(b.dataset.railPick));
    });

    el.from.addEventListener('input', () => { st.from = null; suggestions('from'); });
    el.to.addEventListener('input', () => { st.to = null; suggestions('to'); });

    body.querySelector('[data-rail-swap]').addEventListener('click', () => {
      const a = st.from, b = st.to, at = el.from.value, bt = el.to.value;
      st.from = b; st.to = a; el.from.value = bt; el.to.value = at;
      say('Starting point and destination swapped.');
    });

    body.querySelector('[data-rail-geo]').addEventListener('click', () => {
      if (!navigator.geolocation) { say('This device cannot share its location. Type a station, hotel or address instead.', 'err'); return; }
      say('Finding the nearest ' + noun + ' stations…');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords;
          const d = await api(`/api/rail/stations?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&radius=${mode === 'tram' ? 5000 : 6000}&mode=${mode}&limit=5`);
          const list = d.stations || [];
          if (!list.length) { say(`No ${noun} station was found within a few kilometres. Search by station name instead.`, 'err'); return; }
          st.from = list[0];
          el.from.value = list[0].name;
          el.nearby.hidden = false;
          el.nearby.innerHTML = list.map((s, i) => `<button type="button" data-rail-near="${i}">${SVG[mode]}${esc(s.name)}${s.distance != null ? ' · ' + dist(s.distance) : ''}</button>`).join('');
          st.near = list;
          say(`Nearest ${noun} station: ${list[0].name}${list[0].distance != null ? ', ' + dist(list[0].distance) + ' away' : ''}.`, 'ok');
          board(list[0]);
        } catch (err) { say(err.message, 'err'); }
      }, () => say('Location permission was refused. Type a station, hotel or address instead.', 'err'), { timeout: 12000, maximumAge: 60000 });
    });

    el.nearby.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rail-near]');
      if (!b) return;
      const s = st.near?.[Number(b.dataset.railNear)];
      if (!s) return;
      st.from = s;
      el.from.value = s.name;
      say(`${s.name} selected as your starting station.`, 'ok');
      board(s);
    });

    async function board(station) {
      if (!station?.id || station.kind !== 'station') return;
      try {
        const d = await api(`/api/rail/departures?stopId=${encodeURIComponent(station.id)}&mode=${mode}&n=8`, 25000);
        const rows = d.departures || [];
        if (!rows.length) return;
        setTag(d.live ? 'Live now' : 'Live board');
        const strip = document.createElement('div');
        strip.className = 'rail-board';
        strip.innerHTML = `<h4>${SVG[mode]}Departures now · ${esc(d.stop?.name || station.name)}${d.live ? ' · live' : ''}</h4>` + rows.slice(0, 5).map((r) => `<div class="rail-board-row"><b>${esc(r.minutes === 0 ? 'now' : r.minutes + ' min')}</b>
          <span>${esc(r.line)} → ${esc(r.direction)}${r.platform ? ' · plat. ' + esc(r.platform) : ''}${r.operator ? ' · ' + esc(r.operator) : ''}</span>
          <span class="${r.cancelled ? 'cancelled' : r.delay > 0 ? 'late' : ''}">${r.cancelled ? 'Cancelled' : r.delay > 0 ? '+' + r.delay + ' min' : r.realtime ? 'on time' : 'timetabled'}</span></div>`).join('');
        el.results.querySelector('.rail-board')?.remove();
        el.results.prepend(strip);
      } catch { /* the board is an extra: its failure must not disturb the search */ }
    }

    async function resolve(which) {
      const input = which === 'from' ? el.from : el.to;
      const chosen = st[which];
      if (chosen && input.value.trim() === chosen.name) return chosen;
      const text = input.value.trim();
      if (text.length < 2) throw new Error(which === 'from' ? 'Enter where you are travelling from.' : 'Enter where you are travelling to.');
      const d = await api(`/api/rail/stations?q=${encodeURIComponent(text)}&mode=${mode}&limit=6`);
      const best = (d.stations || [])[0] || (d.places || [])[0];
      if (!best) throw new Error(`Aiva could not find “${text}”. Try a station name, a town, a hotel or a full address.`);
      st[which] = best;
      input.value = best.name;
      return best;
    }

    el.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (st.busy) return;
      clearTimeout(st.timer);
      el.suggest.hidden = true;
      st.busy = true;
      el.go.disabled = true;
      say('Finding live ' + noun + ' journeys…');
      try {
        const [from, to] = await Promise.all([resolve('from'), resolve('to')]);
        const date = el.date.value || today(), time = el.time.value || soon();
        const at = new Date(`${date}T${time}:00`);
        if (!Number.isFinite(at.getTime())) throw new Error('Choose a travel date and time.');
        const qs = new URLSearchParams({
          from: `${from.lat},${from.lon}`, to: `${to.lat},${to.lon}`, mode,
          fromName: from.name, toName: to.name, pax: el.pax.value, time: at.toISOString()
        });
        const d = await api('/api/rail/search?' + qs, 60000);
        st.data = d;
        render();
        say('');
      } catch (err) {
        el.results.innerHTML = `<div class="rail-summary"><span>${esc(err.message)}</span></div>`;
        say(err.message, 'err');
      } finally {
        st.busy = false;
        el.go.disabled = false;
      }
    });

    function fareFor(it) {
      const fare = (st.data?.sales?.fares || []).find((f) => f.itineraryId === it.id);
      return fare && Number.isFinite(fare.amount) ? fare : null;
    }

    function legRow(l) {
      if (l.kind === 'walk') {
        return `<div class="rail-leg">${SVG.walk}<span>Walk ${l.minutes} min${l.distance ? ' · ' + dist(l.distance) : ''}<small>${esc(l.from)} → ${esc(l.to)}</small></span></div>`;
      }
      const meta = [l.operator, l.stops ? `${l.stops} stop${l.stops > 1 ? 's' : ''}` : '', l.platform ? `Platform ${l.platform}` : '', l.cancelled ? 'Cancelled' : l.realtime ? 'live' : 'timetabled'].filter(Boolean).map(esc).join(' · ');
      return `<div class="rail-leg">${SVG[l.kind] || SVG.train}<span><b>${esc(l.line || l.operator || (l.kind === 'tram' ? 'Tram' : 'Train'))}</b>${l.direction ? ' → ' + esc(l.direction) : ''}${l.departure ? ' · ' + esc(l.departure) : ''}${l.arrival ? '–' + esc(l.arrival) : ''}<small>${esc(l.from)} → ${esc(l.to)}${meta ? ' · ' + meta : ''}</small></span></div>`;
    }

    function tripHTML(it, i, best) {
      const ride = it.legs.filter((l) => l.kind !== 'walk');
      const first = it.legs[0] || {}, last = it.legs[it.legs.length - 1] || {};
      const fare = fareFor(it);
      const changes = it.transfers === 0 ? 'Direct' : `${it.transfers} change${it.transfers > 1 ? 's' : ''}`;
      const badges = [`<span class="rail-badge">${esc(changes)}</span>`,
        it.realtime ? '<span class="rail-badge live">Live times</span>' : '<span class="rail-badge">Timetabled</span>',
        fare && best ? '<span class="rail-badge cheap">Cheapest</span>' : '',
        it.cancelled ? '<span class="rail-badge cancel">Part cancelled</span>' : ''].filter(Boolean).join('');
      return `<div class="rail-trip${best ? ' best' : ''}">
        <div>
          <div class="rail-trip-head"><span class="times">${esc(first.departure || '')} → ${esc(last.arrival || '')}</span>
            <span class="dur">${dur(it.minutes)}</span>${badges}</div>
          <div class="mini" style="margin-top:3px">${esc(ride.map((l) => l.line || l.operator || (l.kind === 'tram' ? 'Tram' : 'Train')).join(' · '))}${first.tzFrom && last.tzTo && first.tzFrom !== last.tzTo ? ' · local time at each stop' : ''}</div>
          ${it.legs.filter((l) => l.kind !== 'walk' || l.minutes >= 2).map(legRow).join('')}
        </div>
        <div class="rail-side">
          ${fare ? `<div class="rail-price">${money(fare.amount, fare.currency)}<small>${esc(fare.description || 'per traveller')}</small></div>` : '<div class="rail-nofare">Fares not available</div>'}
          <button type="button" class="rail-select" data-rail-trip="${i}">${fare ? 'Continue' : 'Journey details'}</button>
        </div>
      </div>`;
    }

    function render() {
      const d = st.data, list = d.itineraries || [];
      const sales = d.sales || {};
      const fromName = st.from?.name || d.stations?.from?.[0]?.name || 'your starting point';
      const toName = st.to?.name || d.stations?.to?.[0]?.name || 'your destination';
      setTag(list.some((i) => i.realtime) ? 'Live times' : 'Live timetables', false);
      if (!list.length) {
        el.results.innerHTML = `<div class="rail-summary"><span>${esc(fromName)} → ${esc(toName)}</span></div><div class="empty">${esc(d.note || 'No journey was found.')}</div>`;
        return;
      }
      const fares = sales.fares || [];
      const order = list.map((it, i) => [it, i]).sort((a, b) => {
        const fa = fares.find((f) => f.itineraryId === a[0].id), fb = fares.find((f) => f.itineraryId === b[0].id);
        if (fa && fb) return fa.amount - fb.amount;
        return Date.parse(a[0].departs) - Date.parse(b[0].departs);
      });
      const cheapest = fares.length ? Math.min(...fares.map((f) => f.amount)) : null;
      const cheapestCur = fares[0]?.currency;
      const head = `<div class="rail-summary"><span><b>${esc(fromName)} → ${esc(toName)}</b> · ${esc(dayLabel(d.itineraries[0].departs))} · ${order.length} journey${order.length > 1 ? 's' : ''}</span>
        <span>${cheapest != null ? `Cheapest ${money(cheapest, cheapestCur)} · ` : ''}${d.live ? 'live updates' : 'scheduled times'}</span></div>`;
      const fareNote = sales.available
        ? (sales.fareError ? `<div class="rail-note warn">Fares are temporarily unavailable from the distributor: ${esc(sales.fareError)} Live times below are unaffected.</div>` : '')
        : `<div class="rail-note"><b>Ticket sales are not enabled in Aiva yet.</b> ${esc(sales.reason || 'An authorised rail distributor is required before Aiva can quote or sell tickets.')} Live times, platforms, changes and cancellations below are real, and nothing is estimated or reserved.</div>`;
      el.results.innerHTML = head + fareNote + order.map(([it, i]) => tripHTML(it, i, cheapest != null && fares.find((f) => f.itineraryId === it.id)?.amount === cheapest)).join('')
        + `<p class="mini rail-attrib">${esc(d.source || '')}</p>`;
    }

    el.results.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rail-trip]');
      if (b) openCheckout(Number(b.dataset.railTrip));
    });

    function openCheckout(i) {
      const it = st.data?.itineraries?.[i];
      if (!it) return;
      const fare = fareFor(it);
      const ride = it.legs.filter((l) => l.kind !== 'walk');
      const sales = st.data.sales || {};
      st.selected = i;
      el.checkout.hidden = false;
      el.checkout.innerHTML = `<button type="button" class="close" data-rail-close>Close</button>
        <h4>${SVG[mode]}${mode === 'tram' ? 'Aiva Tram' : 'Aiva Train'} checkout</h4>
        <div class="mini">${esc(ride[0]?.from || '')} → ${esc(ride[ride.length - 1]?.to || '')} · ${esc(dayLabel(it.departs))} · ${esc(ride[0]?.departure || '')}–${esc(ride[ride.length - 1]?.arrival || '')} · ${dur(it.minutes)} · ${it.transfers === 0 ? 'direct' : it.transfers + ' change' + (it.transfers > 1 ? 's' : '')}</div>
        ${it.legs.filter((l) => l.kind !== 'walk').map(legRow).join('')}
        ${fare ? `<div class="rail-note"><b>${money(fare.amount, fare.currency)}</b> ${esc(fare.description || '')}${fare.refundable ? ' · refundable' : ' · non-refundable'}${fare.conditions ? '<br>' + esc(fare.conditions) : ''}</div>
          <div class="rail-pax">
            <label>First name<input id="railPaxFirst" autocomplete="given-name" maxlength="40"></label>
            <label>Last name<input id="railPaxLast" autocomplete="family-name" maxlength="40"></label>
            <label>Email<input id="railPaxEmail" type="email" autocomplete="email" maxlength="190"></label>
          </div>
          <p class="mini">Payment: Visa and Mastercard, plus Apple Pay or Google Pay where the distributor's session supports them. Card details are entered in the distributor's secure session inside Aiva; Aiva never stores them.</p>
          <button type="button" class="rail-pay" data-rail-pay ${fare.payment?.sessionId ? '' : 'disabled'}>${fare.payment?.sessionId ? 'Pay ' + money(fare.amount, fare.currency) : 'Payment session unavailable'}</button>
          ${fare.payment?.sessionId ? '' : '<p class="mini">The distributor did not return a payment session for this fare, so no payment can be taken. Nothing has been charged.</p>'}`
        : `<div class="rail-note warn"><b>No fare to sell on this journey.</b> ${esc(sales.reason || 'Aiva needs an authorised rail distributor before it can quote or sell this ticket.')} Nothing has been charged and no seat is held.</div>`}`;
      el.checkout.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    el.checkout.addEventListener('click', async (e) => {
      if (e.target.closest('[data-rail-close]')) { el.checkout.hidden = true; return; }
      const pay = e.target.closest('[data-rail-pay]');
      if (!pay) return;
      const it = st.data?.itineraries?.[st.selected];
      const fare = it && fareFor(it);
      if (!fare?.payment?.sessionId) return;
      const first = $('railPaxFirst').value.trim(), last = $('railPaxLast').value.trim(), mail = $('railPaxEmail').value.trim();
      if (!first || !last || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { say('Enter each traveller’s first name, last name and email.', 'err'); return; }
      pay.disabled = true;
      say('Opening the secure payment session…');
      try {
        const token = await payWithDistributor(fare);
        const d = await apiOrder({ action: 'order', quoteId: fare.quoteId, paymentToken: token, passengers: [{ firstName: first, lastName: last, email: mail }] });
        const ticket = { ...d, mode, savedAt: new Date().toISOString(), summary: `${it.legs[0]?.from || ''} → ${it.legs[it.legs.length - 1]?.to || ''}`, leg: it.legs.find((l) => l.kind !== 'walk')?.line || '', departs: it.departs };
        const list = readTickets();
        list.unshift(ticket);
        writeTickets(list);
        el.checkout.hidden = true;
        renderTickets();
        say(d.testMode ? 'Test ticket issued by the distributor. No real ticket was sold.' : 'Ticket confirmed. Your digital ticket and QR code are below.', 'ok');
        el.tickets.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        say(err.message, 'err');
      } finally { pay.disabled = false; }
    });

    async function apiOrder(body) {
      const res = await fetch('/api/rail/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
      let data = {};
      try { data = await res.json(); } catch { /* non-JSON reply */ }
      if (!res.ok) throw new Error(data.error || 'The ticket could not be issued. Nothing has been charged twice.');
      return data;
    }

    /* The distributor's payment session (card, Apple Pay, Google Pay) is loaded inside Aiva. It is only ever
       reached with a real quote from the connected distributor, and it returns a single-use payment token. */
    async function payWithDistributor(fare) {
      const sdkUrl = fare.payment?.sdkUrl;
      if (sdkUrl && !document.querySelector(`script[data-aiva-rail-sdk="${sdkUrl}"]`)) {
        await new Promise((ok, no) => {
          const s = document.createElement('script');
          s.src = sdkUrl; s.async = true; s.dataset.aivaRailSdk = sdkUrl;
          s.onload = ok; s.onerror = () => no(new Error('The distributor’s payment session could not be loaded. Nothing has been charged.'));
          document.head.appendChild(s);
        });
      }
      if (typeof window.AivaRailPayments?.confirm !== 'function') {
        throw new Error('The distributor’s payment session is not ready. Nothing has been charged.');
      }
      const out = await window.AivaRailPayments.confirm({ sessionId: fare.payment.sessionId, amount: fare.amount, currency: fare.currency, quoteId: fare.quoteId });
      if (!out?.paymentToken) throw new Error('Payment was not completed. Nothing has been charged.');
      return out.paymentToken;
    }

    function renderTickets() {
      const list = readTickets().filter((t) => t.mode === mode);
      if (!list.length) { el.tickets.hidden = true; return; }
      el.tickets.hidden = false;
      el.tickets.innerHTML = `<h4>${SVG.ticket}My ${noun} tickets</h4>` + list.map((t) => {
        const qr = qrSVG(t.ticket?.qrPayload || t.ticket?.barcode || t.orderId);
        return `<div class="rail-ticket"><div class="qr">${qr}</div><div>
          <b>${esc(t.from || '')} → ${esc(t.to || '')}</b>
          <small>${esc(t.operator || '')}${t.leg ? ' · ' + esc(t.leg) : ''} · ${esc(t.depart || '')}${t.arrive ? '–' + esc(t.arrive) : ''}</small>
          <small>Confirmation <span class="pnr">${esc(t.pnr || t.orderId || '')}</span>${t.fare?.amount != null ? ' · ' + money(t.fare.amount, t.fare.currency) : ''}</small>
          ${t.testMode ? '<small>Test booking — not a valid travel ticket.</small>' : ''}
        </div></div>`;
      }).join('');
    }

    /* QR codes are drawn locally from the distributor's ticket payload (never fetched from a third-party
       image service), so a ticket still opens without a connection once it is on the device. */
    function qrSVG(payload) {
      try {
        if (typeof window.qrcode !== 'function') return `<span class="mini">${esc(String(payload || '').slice(0, 24))}</span>`;
        const qr = window.qrcode(0, 'M');
        qr.addData(String(payload).slice(0, 500));
        qr.make();
        return qr.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
      } catch {
        return `<span class="mini">${esc(String(payload || '').slice(0, 24))}</span>`;
      }
    }

    renderTickets();
    return st;
  }

  function start() {
    if (!$('asRailTrain') && !$('asRailTram')) return;
    style();
    mount('train');
    mount('tram');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
