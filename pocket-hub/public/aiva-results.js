/* Aiva Search results placement.
   One job: when a search starts, put the results in front of the traveller instead of leaving them at the
   bottom of the page. It listens for the two search forms and, without touching any search or booking logic:
     1. selects the matching results tab (Hotels, Flights, or Aiva Transport for the journey planner),
     2. scrolls that section to the top of the screen,
     3. moves the keyboard focus to it, so screen readers and keyboards land on the results too.
   It also respects the device's reduced-motion setting. Nothing here renders, prices or books anything. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const calm = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function reveal(kind) {
    const tab = $(`#asTabs [data-as-tab="${kind}"]`);
    if (tab && !tab.hidden && !tab.classList.contains('active')) tab.click();
    const card = $(`#asGrid [data-as="${kind}"]`);
    if (!card || card.classList.contains('as-hidden')) return;
    if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
    const go = () => {
      card.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
      card.focus({ preventScroll: true });
    };
    requestAnimationFrame(go);
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form || !form.id) return;
    let kind = '';
    if (form.id === 'asForm') kind = $('#asKind [data-as-kind].active')?.dataset.asKind === 'hotels' ? 'hotels' : 'flights';
    else if (form.id === 'asPlanForm') kind = 'transport';
    if (!kind) return;
    /* A tick after the search handler has set its loading state, so the reveal happens on the live page. */
    setTimeout(() => reveal(kind), 60);
  }, true);
})();
