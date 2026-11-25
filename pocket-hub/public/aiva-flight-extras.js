/* Aiva Flights: seat selection and extra baggage, between "holding your seats" and payment.
   Shows only the seats and bags the airline returned for this prebook, at the airline's price. Choosing nothing is
   always allowed. When extras are chosen they are attached with the airline first, and the payment uses the new total. */
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (p) => { if (!p) return ''; if (p.amount === 0) return 'Free'; try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: p.currency || 'GBP' }).format(p.amount); } catch { return `${p.currency} ${p.amount}`; } };
  const post = async (body) => {
    const r = await fetch('/api/travel/flight-book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d;
  };
  const TYPE = ['ADT', 'CHD', 'INF'];

  function seatGrid(seats, seg, pax, picked) {
    const type = window.__fxType || '', list = seats.filter((s) => s.segmentKey === seg && (!s.passengerType || !type || s.passengerType === type));
    const cols = [...new Set(list.map((s) => s.col))].sort(), rows = [...new Set(list.map((s) => s.row))].sort((a, b) => a - b);
    const at = new Map(list.map((s) => [`${s.row}-${s.col}`, s]));
    const aisle = new Set(cols.filter((c, i) => i < cols.length - 1 && at.get(`${rows[0]}-${c}`)?.position === 'aisle' && at.get(`${rows[0]}-${cols[i + 1]}`)?.position === 'aisle'));
    const taken = new Set(Object.entries(picked).filter(([k]) => k.startsWith(seg + '|') && !k.endsWith('|' + pax)).map(([, v]) => v));
    return `<div class="fx-grid" role="grid" aria-label="Seat map">${rows.map((r) => `<div class="fx-row"><span class="fx-rn">${r}</span>${cols.map((c) => {
      const s = at.get(`${r}-${c}`), mine = s && picked[`${seg}|${pax}`] === s.serviceId, off = !s || !s.available || taken.has(s?.serviceId);
      return `${s ? `<button type="button" class="fx-seat${mine ? ' on' : ''}${s.type === 'exit_row' ? ' exit' : ''}" data-fx-seat="${esc(s.serviceId)}" data-fx-seg="${esc(seg)}" ${off ? 'disabled' : ''} title="${esc(s.number)} · ${esc(fmt(s.price) || 'price on request')}${s.type === 'exit_row' ? ' · exit row' : ''}">${esc(c)}</button>` : '<span class="fx-gap"></span>'}${aisle.has(c) ? '<span class="fx-aisle"></span>' : ''}`;
    }).join('')}</div>`).join('')}</div>`;
  }

  window.aivaFlightExtras = (p, box, travellers) => new Promise((resolve) => {
    const sv = p?.services || {}, seats = Array.isArray(sv.seats) ? sv.seats : [], bags = Array.isArray(sv.bags) ? sv.bags : [];
    if (!box || (!seats.length && !bags.length)) { if (box && p?.testMode && p?.servicesSummary) (box.parentElement || box).insertAdjacentHTML('beforeend', `<details class="mini"><summary>Sandbox diagnostics: no seats or bags mapped</summary><pre style="white-space:pre-wrap;font-size:11px" id="fxDiag">${esc(JSON.stringify(p.servicesSummary, null, 1))}</pre></details>`); return resolve({ extras: [] }); }
    const segsKeys = [...new Set(seats.map((s) => s.segmentKey))];
    const names = (travellers || []).map((t, i) => `${t.firstName || 'Traveller'} ${t.lastName || i + 1}`.trim());
    const types = (travellers || []).map((t) => TYPE[t.passengerType] || 'ADT');
    const diag = p?.testMode && p?.servicesSummary ? `<details class="mini" style="margin-top:8px"><summary>Sandbox diagnostics: provider service structure</summary><pre style="white-space:pre-wrap;font-size:11px" id="fxDiag">${esc(JSON.stringify(p.servicesSummary, null, 1))}</pre></details>` : '';
    const st = { pax: 0, seg: segsKeys[0], picked: {}, bags: {} };
    const seatById = new Map(seats.map((s) => [s.serviceId, s])), bagById = new Map(bags.map((b) => [b.serviceId, b]));
    const total = () => {
      let sum = 0, cur = '';
      for (const v of Object.values(st.picked)) { const s = seatById.get(v); if (s?.price) { sum += s.price.amount; cur = s.price.currency; } }
      for (const [k, q] of Object.entries(st.bags)) { const b = bagById.get(k.split('|')[1]); if (b?.price && q) { sum += b.price.amount * q; cur = b.price.currency; } }
      return { sum, cur };
    };
    const draw = () => {
      const t = total(), segBags = bags.filter((b) => !b.passengerType || b.passengerType === types[st.pax]);
      const bagSegs = [...new Set(segBags.map((b) => b.segmentKey || ''))], flightNo = (k) => { const i = segsKeys.indexOf(k); return i >= 0 ? `Flight ${i + 1}` : k ? k.replace(/[-_]/g, ' → ') : 'Whole trip'; };
      box.innerHTML = `<style>.fx-grid{overflow-x:auto;padding:6px 0}.fx-row{display:flex;gap:4px;align-items:center;margin:3px 0}.fx-rn{width:24px;font-size:12px;color:var(--muted)}.fx-seat{width:30px;height:30px;border-radius:7px;border:1px solid var(--line);background:#fff;font-size:12px;cursor:pointer}.fx-seat.on{background:var(--navy);color:#fff}.fx-seat.exit{border-color:var(--gold)}.fx-seat:disabled{background:#eceff4;color:#b6bdc9;cursor:not-allowed}.fx-gap{width:30px}.fx-aisle{width:14px}.fx-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}</style>
        <div class="item"><b>Seats and extra baggage</b><div class="mini">Optional. These prices were confirmed by the airline for this held fare and are added to your total before payment. Your seats stay held while you choose.</div></div>
        ${names.length > 1 ? `<div class="fx-tabs">${names.map((n, i) => `<button type="button" class="as-btn ${i === st.pax ? '' : 'ghost'}" data-fx-pax="${i}">${esc(n)}</button>`).join('')}</div>` : ''}
        ${seats.length && types[st.pax] !== 'INF' ? `${segsKeys.length > 1 ? `<div class="fx-tabs">${segsKeys.map((k, i) => `<button type="button" class="as-btn ${k === st.seg ? '' : 'ghost'}" data-fx-segtab="${esc(k)}">Flight ${i + 1}</button>`).join('')}</div>` : ''}${(window.__fxType = types[st.pax], seatGrid(seats, st.seg, st.pax, st.picked))}<div class="mini">${st.picked[`${st.seg}|${st.pax}`] ? `Seat ${esc(seatById.get(st.picked[`${st.seg}|${st.pax}`])?.number)} · ${esc(fmt(seatById.get(st.picked[`${st.seg}|${st.pax}`])?.price))}` : 'No seat chosen: the airline assigns one at check-in.'}</div>` : seats.length ? '<div class="mini">Infants travel on an adult\'s lap, so no seat is needed.</div>' : '<div class="mini">This airline does not offer seat selection for this fare.</div>'}
        ${segBags.length ? `<div class="mini" style="margin-top:10px"><b>Extra bags</b> · cabin and checked bags this airline sells for this traveller</div>${bagSegs.map((sk) => `${bagSegs.length > 1 || sk ? `<div class="mini" style="margin-top:6px"><b>${esc(flightNo(sk))}</b></div>` : ''}${segBags.filter((b) => (b.segmentKey || '') === sk).map((b) => { const k = `${st.pax}|${b.serviceId}`, q = st.bags[k] || 0; return `<div class="row mini" style="margin:4px 0"><span>${b.kind === 'cabin' ? '🎒' : '🧳'} ${esc(b.name)}${b.weightKg ? ` · ${b.weightKg} kg` : ''} · ${esc(fmt(b.price) || 'price on request')}</span><select data-fx-bag="${esc(k)}">${Array.from({ length: b.quantityMax + 1 }, (_, n) => `<option value="${n}"${n === q ? ' selected' : ''}>${n}</option>`).join('')}</select></div>`; }).join('')}`).join('')}` : ''}
        <div class="row" style="margin-top:10px"><span>Extras total</span><b>${t.sum ? esc(fmt({ amount: t.sum, currency: t.cur })) : '—'}</b></div>
        ${diag}<div id="fxMsg"></div><div class="actions"><button type="button" class="as-btn" id="fxGo">${t.sum || Object.keys(st.picked).length ? 'Add extras and continue to payment' : 'Continue without extras'}</button>${t.sum || Object.keys(st.picked).length ? '<button type="button" class="as-btn ghost" id="fxSkip">Skip extras</button>' : ''}</div>`;
    };
    box.onclick = async (e) => {
      if (st.busy) return;
      const pax = e.target.closest('[data-fx-pax]'), seg = e.target.closest('[data-fx-segtab]'), seat = e.target.closest('[data-fx-seat]');
      if (pax) { st.pax = +pax.dataset.fxPax; return draw(); }
      if (seg) { st.seg = seg.dataset.fxSegtab; return draw(); }
      if (seat) { const k = `${seat.dataset.fxSeg}|${st.pax}`; st.picked[k] = st.picked[k] === seat.dataset.fxSeat ? undefined : seat.dataset.fxSeat; if (!st.picked[k]) delete st.picked[k]; return draw(); }
      if (e.target.id === 'fxSkip') { box.onclick = box.onchange = null; return resolve({ extras: [] }); }
      if (e.target.id !== 'fxGo') return;
      const selected = [...Object.entries(st.picked).map(([k, v]) => ({ passengerIndex: +k.split('|')[1], serviceId: v, quantity: 1 })),
        ...Object.entries(st.bags).filter(([, q]) => q > 0).map(([k, q]) => ({ passengerIndex: +k.split('|')[0], serviceId: k.split('|')[1], quantity: q }))];
      if (!selected.length) { box.onclick = box.onchange = null; return resolve({ extras: [] }); }
      box.querySelectorAll('button,select').forEach((x) => { x.disabled = true; }); st.busy = true; e.target.textContent = 'Adding extras with the airline…';
      try {
        const r = await post({ action: 'services', prebookId: p.prebookId, extrasToken: p.extrasToken, passengers: names.length || 1, selected });
        if (!Number.isFinite(r.price) || !r.currency) throw Object.assign(new Error('The airline did not confirm the new total'), { unknown: true });
        box.onclick = box.onchange = null;
        resolve({ transactionId: r.transactionId, secretKey: r.secretKey, price: r.price, currency: r.currency, extras: selected });
      } catch (err) {
        st.busy = false;
        if (err.unknown) { box.onclick = box.onchange = null; $msg(`${esc(err.message)}. To avoid paying the wrong amount, please search again and choose this flight again. Nothing has been charged.`); return resolve({ abort: true }); }
        // Redraw rather than re-enable: the grid re-applies which seats are unavailable or taken.
        draw();
        $msg(`${esc(err.message)} You can try again or skip the extras.`);
        const go = box.querySelector('#fxGo'); if (go) go.textContent = 'Try again';
      }
    };
    const $msg = (h) => { const m = box.querySelector('#fxMsg'); if (m) m.innerHTML = `<div class="notice warn">${h}</div>`; };
    box.onchange = (e) => { if (st.busy) return; const b = e.target.closest('[data-fx-bag]'); if (b) { st.bags[b.dataset.fxBag] = +b.value; draw(); } };
    draw();
  });
})();
