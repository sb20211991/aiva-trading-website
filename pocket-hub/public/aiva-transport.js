/* Aiva Transport — plan any journey between two places.
   Everything shown comes from /api/emergency/plan (Transitous / MOTIS over open GTFS and GTFS-real-time feeds):
   real departure and arrival times in the local clock at each stop, platforms, operators, transfers and walking
   legs. No price or availability is invented: the operator's own site shows the fare when you book. */
(() => {
  const root = document.getElementById('asPlan');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const out = $('asPlanOut'), form = $('asPlanForm');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = { train: '🚆', metro: '🚇', tram: '🚊', bus: '🚌', ferry: '⛴️', walk: '🚶', bike: '🚲', car: '🚗', flight: '✈️' };
  const NAME = { train: 'train', metro: 'metro', tram: 'tram', bus: 'bus or coach', ferry: 'ferry', walk: 'walking', bike: 'bike', car: 'car' };
  const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
  const dist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`);
  let pinned = { from: null, to: null }, seq = 0, busy = false;

  const style = document.createElement('style');
  style.textContent = `.as-plan-form{display:grid;gap:8px;margin:0 0 10px}.as-plan-row{display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap}`
    + `.as-plan-field{display:grid;gap:3px;flex:1 1 150px;min-width:0}.as-plan-field>span{font-size:11px;letter-spacing:.02em;color:#8b8fa8;font-weight:600}`
    + `.as-plan-field input,.as-plan-field select{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #dfe3ee;border-radius:10px;background:#fff;font:inherit;color:#0c1530}`
    + `.as-plan-chips{display:flex;flex-wrap:wrap;gap:6px}.as-plan-chips button{display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border:1px solid #dfe3ee;border-radius:999px;background:#fff;font:inherit;font-size:13px;color:#0c1530;cursor:pointer}`
    + `.as-plan-chips button i{font-style:normal}.as-plan-chips button.active{background:var(--asl,#eef1fe);border-color:var(--as,#3b5bdb);color:var(--as,#3b5bdb);font-weight:600}`
    + `.as-plan-out{display:grid;gap:10px}.as-plan-card{border:1px solid #e6e9f2;border-radius:14px;padding:10px 12px;background:#fff}`
    + `.as-plan-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}.as-plan-head b{font-size:16px}.as-plan-head .as-plan-badge{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--asl,#eef1fe);color:var(--as,#3b5bdb);font-weight:600}`
    + `.as-plan-leg{display:grid;grid-template-columns:22px 1fr;gap:7px;padding:6px 0;border-top:1px dashed #eceff7;align-items:start}`
    + `.as-plan-leg:first-of-type{border-top:0}.as-plan-leg .t{font-variant-numeric:tabular-nums;font-weight:600}.as-plan-leg .mini{display:block}`
    + `.as-plan-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.as-plan-links a,.as-plan-links button{white-space:normal;text-align:left;font:inherit;cursor:pointer}`;
  document.head.appendChild(style);

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const soon = () => { const d = new Date(Date.now() + 15 * 60000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  if ($('asPlanDate')) $('asPlanDate').value = today();
  if ($('asPlanTime')) $('asPlanTime').value = soon();

  const status = (text, isError) => {
    root.querySelectorAll('.as-plan-status').forEach((n) => n.remove());
    if (!text) return;
    const p = document.createElement('div');
    p.className = 'mini as-plan-status';
    p.style.margin = '0 0 8px';
    p.style.color = isError ? '#b42318' : '';
    p.textContent = text;
    out.before(p);
  };

  async function place(q) {
    const res = await fetch('/api/travel/place?q=' + encodeURIComponent(q));
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `“${q}” was not found. Try a city name or station.`);
    if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon)) throw new Error(`“${q}” has no location. Try a city name or station.`);
    return { lat: d.lat, lon: d.lon, cc: String(d.countryCode || '').toLowerCase(), label: q, name: d.city || q };
  }

  $('asPlanModes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-plan-mode]');
    if (!b) return;
    b.classList.toggle('active');
    b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
  });

  $('asPlanGeo')?.addEventListener('click', () => {
    if (!navigator.geolocation) return status('This device cannot share its location.', true);
    status('Finding your location…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      pinned.from = { lat, lon, cc: '', label: 'My location', name: 'My location' };
      $('asPlanFrom').value = 'My location';
      status('');
    }, () => status('Location permission was refused. Type a place instead.', true), { timeout: 12000 });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const fromText = $('asPlanFrom').value.trim(), toText = $('asPlanTo').value.trim();
    if (!fromText || !toText) return status('Enter where you are travelling from and to.', true);
    busy = true;
    const mine = ++seq;
    $('asPlanGo').disabled = true;
    status('Planning your journey…');
    out.innerHTML = '<div class="empty">Checking timetables…</div>';
    try {
      const [a, b] = await Promise.all([
        pinned.from && pinned.from.label === fromText ? pinned.from : place(fromText),
        pinned.to && pinned.to.label === toText ? pinned.to : place(toText)
      ]);
      const modes = [...root.querySelectorAll('[data-plan-mode].active')].map((x) => x.dataset.planMode);
      const qs = new URLSearchParams({
        from: `${a.lat},${a.lon}`, to: `${b.lat},${b.lon}`,
        arriveBy: $('asPlanWhen').value === 'arrive' ? '1' : '0',
        cc: a.cc || b.cc || '', tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
        fromName: a.name, toName: b.name
      });
      const date = $('asPlanDate').value || today(), at = $('asPlanTime').value;
      const when = new Date(`${date}T${at || '00:00'}:00`);
      if (Number.isFinite(when.getTime())) qs.set('time', when.toISOString());
      if (modes.length) qs.set('modes', modes.join(','));
      const res = await fetch('/api/emergency/plan?' + qs);
      const d = await res.json().catch(() => ({}));
      if (mine !== seq) return;
      if (!res.ok) throw new Error(d.error || 'Journey planning is unavailable right now.');
      render(d, a, b);
      status('');
    } catch (err) {
      if (mine === seq) {
        out.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
        status('');
      }
    } finally {
      if (mine === seq) { busy = false; $('asPlanGo').disabled = false; }
    }
  });

  /* Train and tram journeys are never sold through an external tab. They hand over to Aiva Train or
     Aiva Tram, which run the real search inside Aiva. Any carrier booking link the planner returns for
     those two modes is dropped here and never rendered. */
  const HANDOFF = ['train', 'tram'];
  let ends = { from: '', to: '' };

  function bookings(it, links) {
    const seen = new Set(), list = [];
    for (const mode of [...it.modes, 'walk']) {
      if (HANDOFF.includes(mode)) continue;
      for (const l of (links[mode]?.book || [])) {
        if (l.kind !== 'book' || !l.url || seen.has(l.url)) continue;
        seen.add(l.url);
        list.push(l);
      }
    }
    return list.slice(0, 3);
  }

  function leg(l) {
    if (l.kind === 'walk') {
      return `<div class="as-plan-leg"><span>🚶</span><span><span class="t">${esc(l.departure || '')}${l.arrival ? ` → ${esc(l.arrival)}` : ''}</span>`
        + ` Walk ${l.minutes} min${l.distance ? ` · ${dist(l.distance)}` : ''}`
        + `<span class="mini">${esc(l.from)} → ${esc(l.to)}</span></span></div>`;
    }
    const meta = [l.operator, l.stops ? `${l.stops} stop${l.stops > 1 ? 's' : ''}` : '', l.platform ? `Platform ${l.platform}` : '']
      .filter(Boolean).map(esc).join(' · ');
    return `<div class="as-plan-leg"><span>${ICON[l.kind] || '🚏'}</span><span>`
      + `<span class="t">${esc(l.departure || '')} → ${esc(l.arrival || '')}</span> ${l.line ? `<b>${esc(l.line)}</b>` : ''}`
      + `${l.direction ? ` to ${esc(l.direction)}` : ''}${l.cancelled ? ' · <b>Cancelled</b>' : l.realtime ? ' · <span class="mini">live</span>' : ''}`
      + `<span class="mini">${esc(l.from)} → ${esc(l.to)}${meta ? ` · ${meta}` : ''}</span></span></div>`;
  }

  function card(it, links) {
    const first = it.legs[0] || {}, last = it.legs[it.legs.length - 1] || {};
    const rail = HANDOFF.find((m) => (it.modes || []).includes(m)) || null;
    const badges = [
      it.transfers === 0 ? 'Direct' : `${it.transfers} change${it.transfers > 1 ? 's' : ''}`,
      it.realtime ? 'live times' : 'timetabled',
      it.cancelled ? 'partly cancelled' : ''
    ].filter(Boolean);
    const modes = it.modes.length ? it.modes.map((m) => ICON[m] || '').join(' ') + ' ' + it.modes.map((m) => NAME[m] || m).join(' + ') : 'walking';
    const books = bookings(it, links);
    const dirs = (links.walk?.book || []).find((x) => x.kind === 'directions');
    return `<div class="as-plan-card"><div class="as-plan-head"><b>${esc(first.departure || '')} → ${esc(last.arrival || '')}</b>`
      + `<span>${dur(it.minutes)}</span>${badges.map((b) => `<span class="as-plan-badge">${esc(b)}</span>`).join('')}</div>`
      + `<div class="mini" style="margin:2px 0 4px">${esc(modes)}${first.tzFrom && last.tzTo && first.tzFrom !== last.tzTo ? ` · local time at each stop (${esc(first.tzFrom.split('/').pop())} → ${esc(last.tzTo.split('/').pop())})` : ''}</div>`
      + it.legs.map(leg).join('')
      + (rail || books.length || dirs ? `<div class="as-plan-links">`
        + `${rail ? `<button type="button" class="as-btn" data-aiva-rail="${rail}">${rail === 'train' ? '🚆' : '🚊'} Search in Aiva ${rail === 'train' ? 'Train' : 'Tram'}</button>` : ''}`
        + `${books.map((l) => `<a class="as-btn" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}`
        + `${dirs ? `<a class="as-btn ghost" href="${esc(dirs.url)}" target="_blank" rel="noopener noreferrer">Walking &amp; station directions ↗</a>` : ''}</div>` : '')
      + `</div>`;
  }

  /* Hand a planned journey to Aiva Train or Aiva Tram: fills both ends plus the planner's date and
     time, then runs Aiva's own search. Nothing opens outside Aiva. */
  function railGo(mode, from, to) {
    const key = mode === 'tram' ? 'Tram' : 'Train';
    const cardEl = document.getElementById('asRail' + key);
    const railForm = document.getElementById('rail' + key + 'Form');
    const fromEl = document.getElementById('rail' + key + 'From');
    const toEl = document.getElementById('rail' + key + 'To');
    if (!cardEl || !railForm || !fromEl || !toEl) {
      status(`Aiva ${key} is not on this page. Open Aiva ${key} in Aiva Search and search there.`, true);
      return;
    }
    const dateEl = document.getElementById('rail' + key + 'Date');
    const timeEl = document.getElementById('rail' + key + 'Time');
    if (to) { toEl.value = to; toEl.dispatchEvent(new Event('input', { bubbles: true })); }
    if (dateEl && $('asPlanDate') && $('asPlanDate').value) dateEl.value = $('asPlanDate').value;
    if (timeEl && $('asPlanTime') && $('asPlanTime').value) timeEl.value = $('asPlanTime').value;
    cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (/^my location$/i.test(from)) {
      /* The origin is the device's position, not a name: let Aiva ${key} use the same location. */
      status(`Using your current location. Pick the nearest ${key.toLowerCase()} station, then search.`);
      cardEl.querySelector('[data-rail-geo]')?.click();
      return;
    }
    if (from) { fromEl.value = from; fromEl.dispatchEvent(new Event('input', { bubbles: true })); }
    status(`Live ${key.toLowerCase()} times for ${from} → ${to} are loading in Aiva ${key}.`);
    if (railForm.requestSubmit) railForm.requestSubmit();
    else railForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  $('asPlanOut').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aiva-rail]');
    if (b) railGo(b.dataset.aivaRail, ends.from, ends.to);
  });

  function render(d, a, b) {
    const list = d.itineraries || [], links = d.links || {};
    ends = { from: a.name || a.label || '', to: b.name || b.label || '' };
    $('asPlanMeta').textContent = `${a.name} → ${b.name}`;
    if (!list.length) { out.innerHTML = `<div class="empty">${esc(d.note || 'No journey was found for this route and time.')}</div>`; return; }
    out.innerHTML = `<div class="mini">${list.length} journey${list.length > 1 ? 's' : ''} · ${esc(a.name)} → ${esc(b.name)} · ${esc(d.source || '')}</div>`
      + list.map((it) => card(it, links)).join('')
      + (d.note ? `<div class="mini">${esc(d.note)}</div>` : '');
  }
})();
