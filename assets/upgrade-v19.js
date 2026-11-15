(() => {
  const menu = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#site-navigation');
  if (menu && nav) {
    menu.hidden = false;
    document.documentElement.classList.add('navigation-ready');
    const close = () => { menu.setAttribute('aria-expanded','false'); nav.classList.remove('is-open'); };
    menu.addEventListener('click', () => { const open=menu.getAttribute('aria-expanded')!=='true'; menu.setAttribute('aria-expanded',String(open)); nav.classList.toggle('is-open',open); });
    nav.addEventListener('click', e => { if(e.target.closest('a')) close(); });
    document.addEventListener('keydown', e => { if(e.key==='Escape' && menu.getAttribute('aria-expanded')==='true'){close();menu.focus();} });
    document.addEventListener('click', e => { if(!e.target.closest('header')) close(); });
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
