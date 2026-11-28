/* Aiva Flights: baggage, seats and services, between "holding your seats" and payment.
   Shows the bags included in the fare, then lets each traveller add, change or remove the bags the airline really sells
   for this held fare (per flight: outbound and return), at the airline's own prices, with a live total.
   Nothing here is simulated: options come only from Nuitee's servicesAttachable for this prebook. When the airline sells no
   extra bags through Nuitee, the section says so. Choices are attached with the airline in one call when the traveller
   confirms, and payment uses the total the airline returns. To change bags after confirming, the fare is held again
   (window.aivaFlightExtras is called with the previous choices, which are pre-selected where the airline still offers them). */
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (p) => {
    if (!p || !Number.isFinite(p.amount)) return '';
    if (p.amount === 0) return 'Free';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: p.currency || 'GBP' }).format(p.amount); } catch { return `${p.currency} ${p.amount.toFixed(2)}`; }
  };
  const round = (n) => Math.round(n * 100) / 100;
  const post = async (body) => {
    const r = await fetch('/api/travel/flight-book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { unknown: !!d.unknown });
    return d;
  };
  const TYPE = ['ADT', 'CHD', 'INF'];
  const KIND = {
    personal: { icon: '👜', label: 'Personal item', hint: 'small bag under the seat in front' },
    cabin: { icon: '🎒', label: 'Cabin bag', hint: 'overhead locker' },
    checked: { icon: '🧳', label: 'Checked bag', hint: 'dropped at the airport, travels in the hold' },
    special: { icon: '⛷️', label: 'Special baggage', hint: 'sports or large items' },
  };
  const OICON = { priority: '⚡', meal: '🍽️', insurance: '🛡️', flexibility: '🔁', airport: '🛋️', other: '✨' };
  /* Airline names often arrive in capitals ("UP TO 44LB/20KG BAGGAGE"): shown in sentence case, units kept. */
  const nice = (t) => { const v = String(t || ''); return v === v.toUpperCase() && /[A-Z]{3}/.test(v) ? v.toLowerCase().replace(/^./, (c) => c.toUpperCase()).replace(/(\d)\s?(kg|lb|cm)\b/gi, (m, d, u) => `${d}${u.toLowerCase()}`) : v; };
  const day = (t) => (t ? new Date(String(t).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

  /* Which flight each service belongs to, labelled Outbound / Return (or Flight 1, 2…) with its airports.
     Nuitee keys services by an opaque segmentKey: airports are used when Nuitee sends them, otherwise the keys are matched
     in order to the offer's flight segments, or to its outbound and return journeys. */
  function flightMap(keys, items, offer) {
    const slices = Array.isArray(offer?.slices) ? offer.slices : [];
    const isReturn = slices.length === 2 && slices[0].from === slices[1].to && slices[0].to === slices[1].from;
    const dir = (si) => (si == null ? '' : isReturn ? (si ? 'Return' : 'Outbound') : slices.length > 1 ? `Flight ${si + 1}` : 'Outbound');
    const flat = slices.flatMap((s, si) => (Array.isArray(s.segments) && s.segments.length ? s.segments : [{ from: s.from, to: s.to, departing: s.departing }])
      .map((g) => ({ from: g.from, to: g.to, departing: g.departing || s.departing, si, multi: (s.segments || []).length > 1 })));
    const out = {};
    keys.forEach((k, i) => {
      const seg = items.find((x) => x.segmentKey === k && x.segment)?.segment;
      let m = seg ? flat.find((f) => f.from === seg.from && f.to === seg.to) : null;
      if (!m && keys.length === flat.length) m = flat[i];
      if (!m && keys.length === slices.length) { const s = slices[i]; m = { from: s.from, to: s.to, departing: s.departing, si: i, multi: false, whole: true }; }
      out[k] = m ? { si: m.si, order: i, label: dir(m.si), route: `${m.from} → ${m.to}`, date: day(m.departing), part: m.multi && !m.whole }
        : { si: null, order: i, label: `Flight ${i + 1}`, route: seg ? `${seg.from} → ${seg.to}` : '', date: '' };
    });
    out[''] = { si: null, order: -1, label: 'Whole trip', route: slices.length ? slices.map((s) => `${s.from} → ${s.to}`).join(' · ') : '', date: '' };
    return out;
  }

  /* Bags included in the fare, from the airline fare data in the search reply (per traveller). */
  function includedHTML(offer, type) {
    const b = offer?.bags;
    if (type === 'INF') return '<div class="fx-inc"><span>👶</span><span>Infant allowance is set by the airline and is not listed in this fare.</span></div>';
    if (!b) return `<div class="fx-inc"><span>ℹ️</span><span>${offer?.baggage ? esc(offer.baggage) : 'The airline did not list the included baggage for this fare.'}</span></div>`;
    const items = Array.isArray(b.allowance) ? b.allowance : [], kinds = new Set(items.map((x) => x.kind));
    const spec = (x) => [x.weightKg ? `up to ${x.weightKg} kg` : '', x.size || ''].filter(Boolean).join(' · ');
    const row = (kind, state, extra = '') => `<div class="fx-inc ${state === true ? 'yes' : state === false ? 'no' : ''}"><span>${KIND[kind].icon}</span><span><b>${KIND[kind].label}</b>${extra ? ' · ' + esc(extra) : ''}</span><em>${state === true ? '✓ Included' : state === false ? 'Not included' : 'Not confirmed'}</em></div>`;
    const rows = items.filter((x) => KIND[x.kind]).map((x) => row(x.kind, true, `${x.pieces > 1 ? x.pieces + '× ' : ''}${spec(x)}`));
    if (!kinds.has('personal') && !kinds.has('cabin') && b.carryOn !== true) rows.unshift(row('personal', b.carryOn === false ? false : null));
    if (!kinds.has('cabin')) rows.push(row('cabin', kinds.has('personal') && b.carryOn !== true ? false : b.carryOn === true ? true : b.carryOn === false ? false : null));
    if (!kinds.has('checked')) rows.push(row('checked', b.checked === true ? true : b.checked === false ? false : null));
    return rows.join('');
  }

  function seatGrid(seats, seg, pax, type, picked) {
    const list = seats.filter((s) => s.segmentKey === seg && (!s.passengerType || !type || s.passengerType === type));
    const cols = [...new Set(list.map((s) => s.col))].sort(), rows = [...new Set(list.map((s) => s.row))].sort((a, b) => a - b);
    const at = new Map(list.map((s) => [`${s.row}-${s.col}`, s]));
    const aisle = new Set(cols.filter((c, i) => i < cols.length - 1 && at.get(`${rows[0]}-${c}`)?.position === 'aisle' && at.get(`${rows[0]}-${cols[i + 1]}`)?.position === 'aisle'));
    const taken = new Set(Object.entries(picked).filter(([k]) => k.startsWith(seg + '|') && !k.endsWith('|' + pax)).map(([, v]) => v));
    return `<div class="fx-grid" role="grid" aria-label="Seat map">${rows.map((r) => `<div class="fx-row"><span class="fx-rn">${r}</span>${cols.map((c) => {
      const s = at.get(`${r}-${c}`), mine = s && picked[`${seg}|${pax}`] === s.serviceId, off = !s || !s.available || taken.has(s?.serviceId);
      return `${s ? `<button type="button" class="fx-seat${mine ? ' on' : ''}${s.type === 'exit_row' ? ' exit' : ''}" data-fx-seat="${esc(s.serviceId)}" data-fx-seg="${esc(seg)}" ${off ? 'disabled' : ''} title="${esc(s.number)} · ${esc(fmt(s.price) || 'price on request')}${s.type === 'exit_row' ? ' · exit row' : ''}">${esc(c)}</button>` : '<span class="fx-gap"></span>'}${aisle.has(c) ? '<span class="fx-aisle"></span>' : ''}`;
    }).join('')}</div>`).join('')}</div>`;
  }

  const CSS = `<style>
    .fx{display:grid;gap:12px}.fx h4{margin:0;font-size:16px}.fx .mini{line-height:1.45}
    .fx-card{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff;min-width:0}
    .fx-tabs{display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px}.fx-tabs .as-btn{flex:0 0 auto;white-space:nowrap}
    .fx-inc{display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:center;font-size:13px;padding:5px 0;border-top:1px solid var(--line)}.fx-inc:first-of-type{border-top:0}
    .fx-inc em{font-style:normal;font-weight:700;color:var(--muted);white-space:nowrap}.fx-inc.yes em{color:var(--ok)}.fx-inc.no em{color:#9a5b00}
    .fx-flight{display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap;margin:2px 0 8px}.fx-flight b{font-size:15px}
    .fx-group{margin:10px 0 0}.fx-group>.mini{margin-bottom:6px}
    .fx-opts{display:flex;flex-wrap:wrap;gap:6px}
    .fx-opt{border:1px solid #dbe1eb;background:#fff;border-radius:11px;padding:9px 11px;font-size:13px;line-height:1.25;color:var(--ink);text-align:left;min-height:44px;max-width:100%}
    .fx-opt small{display:block;color:var(--muted);font-weight:400}.fx-opt.on{background:var(--navy);border-color:var(--navy);color:#fff}.fx-opt.on small{color:#d6dcea}
    .fx-opt:focus-visible,.fx-step button:focus-visible{outline:3px solid #e8bc6880;outline-offset:1px}
    .fx-step{display:inline-flex;align-items:center;gap:0;margin-top:8px;border:1px solid #dbe1eb;border-radius:11px;overflow:hidden}
    .fx-step button{width:44px;height:40px;border:0;background:#f4f6fa;font-size:18px;font-weight:700;color:var(--navy)}.fx-step button:disabled{color:#b6bdc9}
    .fx-step span{min-width:84px;text-align:center;font-size:13px;font-weight:700}
    .fx-none{font-size:13px;color:var(--muted);padding:6px 0}
    .fx-sum{position:sticky;bottom:0;background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px;box-shadow:0 -6px 18px #0c153014;z-index:2}
    .fx-sum .row{display:flex;justify-content:space-between;gap:10px;font-size:14px;margin:3px 0}.fx-sum .tot{font-size:17px;border-top:1px solid var(--line);padding-top:7px;margin-top:6px}
    .fx-sum .actions{display:grid;gap:8px;margin-top:10px}.fx-sum .actions .as-btn{width:100%;min-height:48px}
    .fx-grid{overflow-x:auto;padding:6px 0}.fx-row{display:flex;gap:4px;align-items:center;margin:3px 0}.fx-rn{width:24px;font-size:12px;color:var(--muted)}
    .fx-seat{width:32px;height:32px;border-radius:7px;border:1px solid var(--line);background:#fff;font-size:12px}.fx-seat.on{background:var(--navy);color:#fff}.fx-seat.exit{border-color:var(--gold)}
    .fx-seat:disabled{background:#eceff4;color:#b6bdc9;cursor:not-allowed}.fx-gap{width:32px}.fx-aisle{width:14px}
    .fx details>summary{cursor:pointer;font-weight:800;list-style:none}.fx details>summary::-webkit-details-marker{display:none}.fx details>summary:after{content:' ▾';color:var(--muted)}
    .fx-copy{margin-top:10px;font-size:13px}
    .fx-special{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}.fx-special>summary{font-size:14px}
    @media(max-width:700px){.fx-opt{flex:1 1 calc(50% - 6px)}.fx-opt.none{flex-basis:100%}}
  </style>`;

  /* p: prebook reply. travellers: passengers sent with the prebook. offer: the chosen search offer (slices, included bags).
     prev: choices returned by an earlier run for the same flight, pre-selected again after the fare is re-held. */
  window.aivaFlightExtras = (p, box, travellers, offer, prev) => new Promise((resolve) => {
    if (!box) return resolve({ extras: [] });
    const sv = p?.services || {}, seats = Array.isArray(sv.seats) ? sv.seats : [], bags = Array.isArray(sv.bags) ? sv.bags : [], others = Array.isArray(sv.others) ? sv.others : [];
    const all = [...seats, ...bags, ...others];
    const keys = [...new Set(all.map((x) => x.segmentKey).filter(Boolean))];
    const fmap = flightMap(keys, all, offer);
    const flightOf = (k) => fmap[k || ''] || fmap[''];
    const seatKeys = [...new Set(seats.map((s) => s.segmentKey))];
    const pax = (travellers && travellers.length ? travellers : [{ passengerType: 0 }]);
    const names = pax.map((t, i) => `${t.firstName || 'Traveller'} ${t.lastName || i + 1}`.trim());
    const types = pax.map((t) => TYPE[t.passengerType] || 'ADT');
    const fare = { amount: Number(p?.price), currency: p?.currency || offer?.currency || 'GBP' };
    const byId = new Map(all.map((x) => [x.serviceId, x]));
    const forPax = (list, i) => list.filter((x) => !x.passengerType || x.passengerType === types[i]);
    /* Bag choices are grouped per flight and bag type; within a group the traveller picks one option (a weight) and how many. */
    const groupsFor = (i) => {
      const g = new Map();
      for (const b of forPax(bags, i)) {
        const gk = `${b.segmentKey || ''}|${b.kind === 'special' ? 'special:' + b.serviceId : b.kind}`;
        if (!g.has(gk)) g.set(gk, { key: gk, seg: b.segmentKey || '', kind: b.kind, opts: [] });
        g.get(gk).opts.push(b);
      }
      for (const x of g.values()) x.opts.sort((a, b) => (a.weightKg ?? 0) - (b.weightKg ?? 0) || (a.price?.amount ?? 0) - (b.price?.amount ?? 0));
      return [...g.values()].sort((a, b) => flightOf(a.seg).order - flightOf(b.seg).order || Object.keys(KIND).indexOf(a.kind) - Object.keys(KIND).indexOf(b.kind));
    };
    const st = { pax: 0, seg: seatKeys[0], seats: {}, qty: {}, busy: false };
    const q = (i, id) => st.qty[`${i}|${id}`] || 0;
    const setQ = (i, id, n) => { if (n > 0) st.qty[`${i}|${id}`] = n; else delete st.qty[`${i}|${id}`]; };

    /* Re-apply earlier choices on a re-held fare: same traveller, same flight order, same bag type and weight (or name). */
    if (prev && Array.isArray(prev.memo)) {
      for (const m of prev.memo) {
        if (!(m.pax < pax.length)) continue;
        const segK = m.order >= 0 ? keys[m.order] || '' : '';
        if (m.type === 'seat') { const s = seats.find((x) => x.segmentKey === segK && x.number === m.number && x.available); if (s) st.seats[`${segK}|${m.pax}`] = s.serviceId; continue; }
        const list = m.type === 'bag' ? forPax(bags, m.pax) : forPax(others, m.pax);
        const hit = list.find((x) => (x.segmentKey || '') === segK && (m.type === 'bag' ? x.kind === m.kind && (m.weightKg != null ? x.weightKg === m.weightKg : x.name === m.name) : x.name === m.name));
        if (hit) setQ(m.pax, hit.serviceId, Math.min(hit.quantityMax || 1, m.q || 1));
      }
    }

    const sums = () => {
      const t = { bags: 0, seats: 0, others: 0, cur: fare.currency, count: 0 };
      for (const id of Object.values(st.seats)) { const s = byId.get(id); if (s?.price) { t.seats += s.price.amount; t.cur = s.price.currency || t.cur; t.count++; } }
      for (const [k, n] of Object.entries(st.qty)) {
        const x = byId.get(k.split('|')[1]); if (!x?.price || !n) continue;
        t[bags.includes(x) ? 'bags' : 'others'] += x.price.amount * n; t.cur = x.price.currency || t.cur; t.count += n;
      }
      t.bags = round(t.bags); t.seats = round(t.seats); t.others = round(t.others); t.extras = round(t.bags + t.seats + t.others);
      t.total = Number.isFinite(fare.amount) && t.cur === fare.currency ? round(fare.amount + t.extras) : null;
      return t;
    };
    const bagCount = (i) => Object.entries(st.qty).filter(([k]) => k.startsWith(i + '|') && bags.includes(byId.get(k.split('|')[1]))).reduce((n, [, v]) => n + v, 0);

    const optLabel = (b, group) => {
      const sameName = group.opts.every((o) => o.name === group.opts[0].name);
      const main = b.weightKg ? `${b.weightKg} kg` : group.kind === 'special' ? 'Add' : nice(b.name);
      const sub = [b.weightKg && !sameName && !String(b.name).includes(String(b.weightKg)) ? nice(b.name) : '', b.size].filter(Boolean).join(' · ');
      return `${esc(main)} · <b>${esc(fmt(b.price) || 'price on request')}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    };
    const groupHTML = (g) => {
      const i = st.pax, chosen = g.opts.find((o) => q(i, o.serviceId) > 0), meta = KIND[g.kind] || KIND.checked;
      const title = g.kind === 'special' ? nice(g.opts[0].name) : meta.label;
      return `<div class="fx-group"><div class="mini">${meta.icon} <b>${esc(title)}</b>${g.kind !== 'special' ? ` · ${esc(meta.hint)}` : ''}</div>
        <div class="fx-opts" role="radiogroup" aria-label="${esc(title)} for ${esc(names[i])}, ${esc(flightOf(g.seg).label)}">
          <button type="button" role="radio" aria-checked="${!chosen}" class="fx-opt none${chosen ? '' : ' on'}" data-fx-none="${esc(g.key)}">No extra ${esc(g.kind === 'special' ? 'item' : meta.label.toLowerCase())}</button>
          ${g.opts.map((b) => `<button type="button" role="radio" aria-checked="${chosen === b}" class="fx-opt${chosen === b ? ' on' : ''}" data-fx-opt="${esc(b.serviceId)}" data-fx-group="${esc(g.key)}" ${b.price ? '' : 'disabled'}>${optLabel(b, g)}</button>`).join('')}
        </div>
        ${chosen && chosen.quantityMax > 1 ? `<div class="fx-step" aria-label="Number of bags"><button type="button" data-fx-dec="${esc(chosen.serviceId)}" ${q(i, chosen.serviceId) <= 1 ? 'disabled' : ''} aria-label="One bag fewer">−</button><span>${q(i, chosen.serviceId)} bag${q(i, chosen.serviceId) > 1 ? 's' : ''}</span><button type="button" data-fx-inc="${esc(chosen.serviceId)}" ${q(i, chosen.serviceId) >= chosen.quantityMax ? 'disabled' : ''} aria-label="One more bag">+</button></div>` : ''}
      </div>`;
    };

    const draw = () => {
      const i = st.pax, t = sums(), groups = groupsFor(i);
      const segs = [...new Set(groups.map((g) => g.seg))];
      const hasReturnCopy = segs.length > 1 && groups.some((g) => g.seg === segs[0] && g.opts.some((o) => q(i, o.serviceId) > 0));
      const seatOn = seats.length && types[i] !== 'INF';
      const otherList = forPax(others, i);
      const anySelected = t.count > 0;
      box.innerHTML = `${CSS}<div class="fx" id="fxRoot">
        <div><h4>🧳 Baggage</h4><div class="mini">Choose bags for each traveller and each flight. Prices are the airline's own for this held fare and are added to your total before payment.</div></div>
        ${names.length > 1 ? `<div class="fx-tabs" role="tablist" aria-label="Travellers">${names.map((n, k) => `<button type="button" role="tab" aria-selected="${k === i}" class="as-btn ${k === i ? '' : 'ghost'}" data-fx-pax="${k}">${esc(n)}${bagCount(k) ? ` · 🧳${bagCount(k)}` : ''}</button>`).join('')}</div>` : ''}
        <div class="fx-card"><div class="mini" style="margin-bottom:4px"><b>Included in ${esc(names[i])}'s fare</b>${offer?.airline ? ` · ${esc(offer.airline)}` : ''}</div>${includedHTML(offer, types[i])}</div>
        ${groups.length ? segs.map((sk) => { const f = flightOf(sk); return `<div class="fx-card"><div class="fx-flight"><b>✈️ ${esc(f.label)}${f.route ? ' · ' + esc(f.route) : ''}</b><span class="mini">${esc(f.date)}</span></div>
            <div class="mini">Add extra baggage</div>${groups.filter((g) => g.seg === sk && g.kind !== 'special').map(groupHTML).join('')}
            ${(() => { const sp = groups.filter((g) => g.seg === sk && g.kind === 'special'), on = sp.filter((g) => g.opts.some((o) => q(i, o.serviceId) > 0)).length;
              return sp.length ? `<details class="fx-special"${on ? ' open' : ''}><summary>⛷️ Sports &amp; special items (${sp.length})${on ? ` · ${on} chosen` : ''}</summary>${sp.map(groupHTML).join('')}</details>` : ''; })()}
            ${sk === segs[0] && hasReturnCopy ? `<button type="button" class="as-btn ghost fx-copy" data-fx-copy="1">Use the same bags on the ${esc(flightOf(segs[1]).label.toLowerCase())}</button>` : ''}</div>`; }).join('')
          + (fmap && Object.keys(fmap).length > 2 && segs.length < keys.length ? `<div class="mini">Flights not shown above have no extra bags for sale for this traveller.</div>` : '')
          : `<div class="notice warn"><b>Extra baggage can't be added for this fare in Aiva.</b> ${esc(offer?.airline || 'The airline')} does not sell additional bags for ${types[i] === 'INF' ? 'infants' : 'this traveller'} through our booking provider Nuitée on this flight${bags.length ? '' : 's'}. The included allowance above still applies; any extra bag would have to be bought from the airline after booking (Manage booking).</div>`}
        ${seatOn ? `<details class="fx-card"${Object.keys(st.seats).length ? ' open' : ''}><summary>💺 Seat selection (optional)</summary>${seatKeys.length > 1 ? `<div class="fx-tabs" style="margin-top:8px">${seatKeys.map((k) => `<button type="button" class="as-btn ${k === st.seg ? '' : 'ghost'}" data-fx-segtab="${esc(k)}">${esc(flightOf(k).label)}${flightOf(k).route ? ' ' + esc(flightOf(k).route) : ''}</button>`).join('')}</div>` : ''}${seatGrid(seats, st.seg, i, types[i], st.seats)}<div class="mini">${st.seats[`${st.seg}|${i}`] ? `Seat ${esc(byId.get(st.seats[`${st.seg}|${i}`])?.number)} · ${esc(fmt(byId.get(st.seats[`${st.seg}|${i}`])?.price))} · tap again to remove` : 'No seat chosen: the airline assigns one at check-in.'}</div></details>` : ''}
        ${otherList.length ? `<details class="fx-card"${otherList.some((o) => q(i, o.serviceId)) ? ' open' : ''}><summary>✨ More airline services (optional)</summary>${otherList.map((b) => `<div class="fx-group"><div class="mini">${OICON[b.kind] || '✨'} <b>${esc(b.name)}</b>${b.segmentKey ? ' · ' + esc(flightOf(b.segmentKey).label) : ''} · ${esc(fmt(b.price))}${b.description ? `<br>${esc(b.description)}` : ''}</div><div class="fx-step"><button type="button" data-fx-dec="${esc(b.serviceId)}" ${q(i, b.serviceId) < 1 ? 'disabled' : ''} aria-label="Remove ${esc(b.name)}">−</button><span>${q(i, b.serviceId) || 'None'}</span><button type="button" data-fx-inc="${esc(b.serviceId)}" ${q(i, b.serviceId) >= b.quantityMax ? 'disabled' : ''} aria-label="Add ${esc(b.name)}">+</button></div></div>`).join('')}</details>` : ''}
        <div class="fx-sum" aria-live="polite">
          <div class="row"><span>Flight fare (held)</span><b>${esc(fmt(fare))}</b></div>
          ${t.bags ? `<div class="row"><span>Baggage</span><b>${esc(fmt({ amount: t.bags, currency: t.cur }))}</b></div>` : ''}
          ${t.seats ? `<div class="row"><span>Seats</span><b>${esc(fmt({ amount: t.seats, currency: t.cur }))}</b></div>` : ''}
          ${t.others ? `<div class="row"><span>Other services</span><b>${esc(fmt({ amount: t.others, currency: t.cur }))}</b></div>` : ''}
          <div class="row tot"><span>Total</span><b id="fxTotal">${t.total != null ? esc(fmt({ amount: t.total, currency: fare.currency })) : esc(fmt(fare)) + ' + ' + esc(fmt({ amount: t.extras, currency: t.cur }))}</b></div>
          ${anySelected ? '<div class="mini">The airline confirms this total when your bags are added; you see it again before paying.</div>' : ''}
          <div id="fxMsg"></div>
          <div class="actions"><button type="button" class="as-btn" id="fxGo">${anySelected ? `Add to booking and continue to payment` : 'Continue to payment without extras'}</button>${anySelected ? '<button type="button" class="as-btn ghost" id="fxClear">Remove all extras</button>' : ''}</div>
        </div></div>`;
    };
    const msg = (h) => { const m = box.querySelector('#fxMsg'); if (m) m.innerHTML = `<div class="notice warn">${h}</div>`; };
    const memo = () => [
      ...Object.entries(st.seats).map(([k, id]) => ({ type: 'seat', pax: +k.split('|')[1], order: flightOf(k.split('|')[0]).order, number: byId.get(id)?.number })),
      ...Object.entries(st.qty).map(([k, n]) => { const x = byId.get(k.split('|')[1]); return { type: bags.includes(x) ? 'bag' : 'other', pax: +k.split('|')[0], order: flightOf(x?.segmentKey).order, kind: x?.kind, weightKg: x?.weightKg ?? null, name: x?.name, q: n }; }),
    ];
    const finish = (r) => { box.onclick = null; resolve(r); };

    box.onclick = async (e) => {
      if (st.busy) return;
      const el = (s) => e.target.closest(s), i = st.pax;
      const paxBtn = el('[data-fx-pax]'), segTab = el('[data-fx-segtab]'), seat = el('[data-fx-seat]'), opt = el('[data-fx-opt]'), none = el('[data-fx-none]');
      const inc = el('[data-fx-inc]'), dec = el('[data-fx-dec]');
      if (paxBtn) { st.pax = +paxBtn.dataset.fxPax; return draw(); }
      if (segTab) { st.seg = segTab.dataset.fxSegtab; return draw(); }
      if (seat) { const k = `${seat.dataset.fxSeg}|${i}`; if (st.seats[k] === seat.dataset.fxSeat) delete st.seats[k]; else st.seats[k] = seat.dataset.fxSeat; return draw(); }
      if (opt || none) {
        const g = groupsFor(i).find((x) => x.key === (opt ? opt.dataset.fxGroup : none.dataset.fxNone)); if (!g) return;
        const keep = g.opts.reduce((n, o) => Math.max(n, q(i, o.serviceId)), 0) || 1;
        g.opts.forEach((o) => setQ(i, o.serviceId, 0));
        if (opt) { const b = byId.get(opt.dataset.fxOpt); setQ(i, b.serviceId, Math.min(keep, b.quantityMax || 1)); }
        return draw();
      }
      if (inc || dec) { const id = (inc || dec).dataset[inc ? 'fxInc' : 'fxDec'], x = byId.get(id); setQ(i, id, Math.max(0, Math.min(x?.quantityMax || 1, q(i, id) + (inc ? 1 : -1)))); return draw(); }
      if (el('[data-fx-copy]')) {
        const groups = groupsFor(i), segs = [...new Set(groups.map((g) => g.seg))];
        for (const g of groups.filter((x) => x.seg === segs[0])) {
          const chosen = g.opts.find((o) => q(i, o.serviceId) > 0);
          for (const other of groups.filter((x) => x.seg !== segs[0] && x.kind === g.kind)) {
            other.opts.forEach((o) => setQ(i, o.serviceId, 0));
            const match = chosen && other.opts.find((o) => (chosen.weightKg != null ? o.weightKg === chosen.weightKg : o.name === chosen.name));
            if (match) setQ(i, match.serviceId, Math.min(q(i, chosen.serviceId), match.quantityMax || 1));
          }
        }
        draw(); return;
      }
      if (e.target.id === 'fxClear') { st.seats = {}; st.qty = {}; return draw(); }
      if (e.target.id !== 'fxGo') return;
      const selected = [...Object.entries(st.seats).map(([k, v]) => ({ passengerIndex: +k.split('|')[1], serviceId: v, quantity: 1 })),
        ...Object.entries(st.qty).filter(([, n]) => n > 0).map(([k, n]) => ({ passengerIndex: +k.split('|')[0], serviceId: k.split('|')[1], quantity: n }))];
      if (!selected.length) return finish({ extras: [], memo: [] });
      const expect = sums();
      box.querySelectorAll('button').forEach((x) => { x.disabled = true; }); st.busy = true; e.target.textContent = 'Adding your bags with the airline…';
      try {
        const r = await post({ action: 'services', prebookId: p.prebookId, extrasToken: p.extrasToken, passengers: names.length, selected });
        if (!Number.isFinite(r.price) || !r.currency) throw Object.assign(new Error('The airline did not confirm the new total'), { unknown: true });
        const label = (x) => { const s = byId.get(x.serviceId), f = flightOf(s?.segmentKey);
          return { name: seats.includes(s) ? `Seat ${s.number}` : `${nice(s?.name) || 'Extra'}${s?.weightKg && !String(s?.name).includes(String(s.weightKg)) ? ` ${s.weightKg} kg` : ''}`,
            traveller: names[x.passengerIndex] || '', quantity: x.quantity, flight: [f.label, f.route].filter(Boolean).join(' · '), kind: seats.includes(s) ? 'seat' : bags.includes(s) ? 'bag' : 'service', price: s?.price || null }; };
        const differs = expect.total != null && r.currency === fare.currency && Math.abs(r.price - expect.total) > 0.01;
        finish({ transactionId: r.transactionId, secretKey: r.secretKey, price: r.price, currency: r.currency, extras: selected, labels: selected.map(label), memo: memo(),
          listedTotal: expect.total, differs });
      } catch (err) {
        st.busy = false;
        if (err.unknown) { box.onclick = null; msg(`${esc(err.message)}. To avoid paying the wrong amount, please hold the fare again. Nothing has been charged.`); return resolve({ abort: true }); }
        draw();
        msg(`${esc(err.message)} You can try again, change your choice or continue without extras.`);
        const go = box.querySelector('#fxGo'); if (go) go.textContent = 'Try again';
      }
    };
    draw();
  });
})();
