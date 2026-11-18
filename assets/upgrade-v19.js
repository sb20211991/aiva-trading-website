(() => {
  const menu = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#site-navigation');
  if (menu && nav) {
    document.documentElement.classList.add('navigation-ready');
    const narrow = window.matchMedia('(max-width: 1024px)');
    const update = (open = false) => {
      open = narrow.matches && open;
      menu.hidden = !narrow.matches;
      menu.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      nav.hidden = narrow.matches && !open;
      nav.inert = nav.hidden;
      if (nav.hidden) nav.setAttribute('aria-hidden', 'true');
      else nav.removeAttribute('aria-hidden');
    };
    menu.addEventListener('click', () => update(menu.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('click', event => { if (event.target.closest('a')) update(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
        update();
        menu.focus();
      }
    });
    document.addEventListener('click', event => { if (!event.target.closest('header')) update(); });
    if (narrow.addEventListener) narrow.addEventListener('change', () => update());
    else narrow.addListener(() => update());
    update();
  }
  for (const prefix of ['buyer','offer']) {
    const message = document.getElementById(prefix+'-message');
    if(!message) continue;
    message.addEventListener('input', () => {
      const email=document.getElementById(prefix+'-email');
      const whatsapp=document.getElementById(prefix+'-whatsapp');
      const e=new URL(email.href); const subject=e.searchParams.get('subject')||'Aiva Trading enquiry'; email.href=e.protocol+e.pathname+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(message.value);
      const w=new URL(whatsapp.href); w.searchParams.set('text',message.value); whatsapp.href=w.href;
      email.hidden=email.href.length>1800; whatsapp.hidden=whatsapp.href.length>1800;
      document.getElementById(prefix+'-link-note').hidden=!(email.hidden||whatsapp.hidden);
      document.getElementById(prefix==='buyer'?'status':'offer-status').textContent=email.hidden&&whatsapp.hidden?'Edited draft ready. Copy or download it, then send it to Aiva. Nothing has been sent.':'Edited draft ready — not sent. Email and WhatsApp now use your edited message.';
    });
  }
})();
