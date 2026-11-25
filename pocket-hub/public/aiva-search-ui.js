/* Aiva Search: one category at a time.
   Before this, the travel page opened five search forms at once (flights, journey planner, Aiva Train, Aiva Tram,
   Car Rental) and two extra tab bars repeated the Flights/Hotels switch and the airport-transfer modes.
   This script, loaded last, replaces those with one category bar and shows only the chosen category:
     Flights · Hotels · Trains · Trams · Car rental · Journeys (planner: train, coach, metro, tram, ferry, walk) · SOS
   It renders, prices and books nothing. The original tab elements stay in the page (hidden) and are still used to
   switch the existing views, so all search, booking and payment code paths are unchanged:
     - airport transfers (taxi, car, train, metro, tram, bus, walk, ride) stay in the transfer card after a flight search;
     - departures and Aiva Maps sit under Journeys;
     - secondary fields (children, infants, cabin, flexible dates) and hotel filters move under expandable sections.
   If any code scrolls a section of another category into view (the journey planner handing a trip to Aiva Train,
   a payment return, a #car link), the bar switches to that category first, so nothing opens out of sight. */
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'aiva-search-category';
  const CATS = [
    ['flights', '✈️', 'Flights'], ['hotels', '🏨', 'Hotels'], ['trains', '🚆', 'Trains'], ['trams', '🚊', 'Trams'],
    ['car', '🚗', 'Car rental'], ['journeys', '🧭', 'Journeys'], ['sos', '🆘', 'SOS']
  ];
  const IDS = CATS.map((c) => c[0]);
  let section, current = '';

  const CSS = `
  #travel .asu-bar{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding:2px 2px 10px;margin:2px 0 6px;-webkit-overflow-scrolling:touch}
  #travel .asu-bar::-webkit-scrollbar{display:none}
  #travel .asu-bar button{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 16px;border-radius:999px;
    border:1px solid #dcd8f0;background:#fff;color:#1f2340;font:600 15px/1 inherit;font-family:inherit;cursor:pointer;
    transition:background .15s,color .15s,border-color .15s,box-shadow .15s}
  #travel .asu-bar button:hover{border-color:#b9b0ec}
  #travel .asu-bar button[aria-selected="true"]{background:#5b3fd6;border-color:#5b3fd6;color:#fff;box-shadow:0 6px 16px rgba(91,63,214,.25)}
  #travel .asu-bar button:focus-visible{outline:3px solid #f3c876;outline-offset:2px}
  #travel .asu-bar .asu-sos{border-color:#f1c4c4;color:#b4232a}
  #travel .asu-bar .asu-sos[aria-selected="true"]{background:#b4232a;border-color:#b4232a;color:#fff;box-shadow:0 6px 16px rgba(180,35,42,.25)}
  #travel .asu-more{margin:6px 0 4px}
  #travel .asu-more>summary,#travel .asu-filters>summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;
    min-height:40px;font-weight:600;color:#5b3fd6;padding:0 4px;border-radius:8px}
  #travel .asu-more>summary::-webkit-details-marker,#travel .asu-filters>summary::-webkit-details-marker{display:none}
  #travel .asu-more>summary::after,#travel .asu-filters>summary::after{content:"▾";font-size:12px;transition:transform .15s}
  #travel .asu-more[open]>summary::after,#travel .asu-filters[open]>summary::after{transform:rotate(180deg)}
  #travel .asu-more>summary:focus-visible,#travel .asu-filters>summary:focus-visible{outline:3px solid #f3c876}
  #travel .asu-filters{padding:0 14px 6px}
  #travel[data-asu] #asKind,#travel[data-asu] #asTabs{display:none!important}
  #travel[data-asu]:not([data-asu="flights"]):not([data-asu="hotels"]) :is(#asTripType,#asForm,#asMulti,.asu-more){display:none!important}
  #travel:is([data-asu="trains"],[data-asu="trams"],[data-asu="car"]) #asGrid{display:none!important}
  #travel[data-asu]:not([data-asu="trains"]) #asRailTrain,#travel[data-asu]:not([data-asu="trams"]) #asRailTram,
  #travel[data-asu]:not([data-asu="car"]) #asCar{display:none!important}
  #travel:is([data-asu="flights"],[data-asu="hotels"]):not(.asu-searched) #asGrid :is([data-as="transfers"],[data-as="trip"]){display:none!important}
  @media(max-width:700px){#travel .asu-bar{margin-left:-2px;margin-right:-2px}#travel .asu-bar button{padding:0 14px;font-size:14px}}
  @media(prefers-reduced-motion:reduce){#travel .asu-bar button,#travel .asu-more>summary::after,#travel .asu-filters>summary::after{transition:none}}`;

  const tab = (name) => document.querySelector(`#asTabs [data-as-tab="${name}"]`);
  const kind = () => document.querySelector('#asKind [data-as-kind].active')?.dataset.asKind || 'flights';

  function setKind(k) {
    if (kind() !== k) document.querySelector(`#asKind [data-as-kind="${k}"]`)?.click();
  }

  function apply(cat, { save = true, focus = false } = {}) {
    if (!IDS.includes(cat)) cat = 'flights';
    current = cat;
    section.dataset.asu = cat;
    if (cat === 'flights' || cat === 'hotels') { setKind(cat); tab(cat)?.click(); }
    else if (cat === 'journeys') tab('transport')?.click();
    else if (cat === 'sos') tab('sos')?.click();
    for (const b of section.querySelectorAll('.asu-bar [role="tab"]')) {
      const on = b.dataset.asu === cat;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    if (save) { try { localStorage.setItem(KEY, cat); } catch { /* storage unavailable */ } }
  }

  /* Which category owns an element, or '' when it is shared or outside Aiva Search. */
  function owner(el) {
    if (!el || !section || !section.contains(el)) return '';
    if (el.closest('#asRailTrain')) return 'trains';
    if (el.closest('#asRailTram')) return 'trams';
    if (el.closest('#asCar')) return 'car';
    const card = el.closest('#asGrid [data-as]');
    if (!card) return '';
    const as = card.dataset.as;
    if (as === 'sos') return 'sos';
    if (as === 'hotels') return 'hotels';
    if (as === 'flights') return 'flights';
    if (as === 'transport' || as === 'maps') return 'journeys';
    if (as === 'transfers') return current === 'flights' ? '' : 'flights';
    if (as === 'trip') return current === 'flights' || current === 'hotels' ? '' : kind();
    return '';
  }

  function follow(el) {
    const cat = owner(el);
    if (cat && cat !== current) apply(cat);
    if (cat === 'flights' || cat === 'hotels') section.classList.add('asu-searched');
  }

  function wrap(el, cls, label) {
    if (!el || el.parentElement?.classList.contains(cls)) return;
    const d = document.createElement('details');
    d.className = cls;
    const s = document.createElement('summary');
    s.textContent = label;
    el.parentNode.insertBefore(d, el);
    d.append(s, el);
  }

  function start() {
    section = $('travel');
    if (!section || !$('asKind') || !$('asTabs') || !$('asGrid')) return;
    const style = document.createElement('style');
    style.id = 'aiva-search-ui-v1';
    style.textContent = CSS;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'asu-bar';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'What to search');
    bar.innerHTML = CATS.map(([id, icon, label]) =>
      `<button type="button" role="tab" data-asu="${id}" aria-selected="false" tabindex="-1"${id === 'sos' ? ' class="asu-sos"' : ''}><span aria-hidden="true">${icon}</span>${label}</button>`).join('');
    $('asKind').before(bar);
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-asu]'); if (b) apply(b.dataset.asu); });
    bar.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const i = IDS.indexOf(current);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? IDS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + IDS.length) % IDS.length;
      apply(IDS[next], { focus: true });
    });

    wrap($('asOpts'), 'asu-more', 'More options: children, infants, cabin, flexible dates');
    wrap($('asHotelFilters'), 'asu-filters', 'Filters and sorting');

    /* Results for flights and hotels bring their transfer and trip cards with them once a search has started. */
    $('asForm')?.addEventListener('submit', () => section.classList.add('asu-searched'));

    /* Anything scrolled into view inside Aiva Search switches to its category first. */
    const native = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      try { follow(this); } catch { /* never block the scroll */ }
      return native.apply(this, args);
    };

    let cat = '';
    if (location.hash === '#car') cat = 'car';
    else if (new URLSearchParams(location.search).get('aivaMap')) cat = 'journeys';
    else if (($('asReview') && !$('asReview').hidden) || ($('asFReview') && !$('asFReview').hidden)) cat = kind();
    if (!cat) { try { cat = localStorage.getItem(KEY) || ''; } catch { /* storage unavailable */ } }
    apply(cat || kind(), { save: false });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
