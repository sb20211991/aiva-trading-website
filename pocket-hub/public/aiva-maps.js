function aivaDirectionsButton(place, origin) {
  const coords = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
  if (!coords(place) || !coords(origin)) return '';
  return `<button type="button" class="btn light" data-aiva-from="${origin.lat},${origin.lon}" data-aiva-to="${place.lat},${place.lon}" data-aiva-name="${escapeHTML(place.name || 'Destination')}">🧭 Directions</button>`;
}

async function showAivaMap(to, from, name) {
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'width:min(94vw,42rem);max-height:85vh;border:0;border-radius:1rem;padding:1rem';
  dialog.innerHTML = '<form method="dialog"><button class="btn light" style="float:right">Close</button></form><h2>Aiva Maps</h2><p></p><iframe title="Destination map" sandbox="allow-scripts allow-same-origin" style="width:100%;height:30vh;border:0"></iframe><section aria-live="polite"></section>';
  dialog.setAttribute('aria-label', 'Aiva Maps');
  dialog.querySelector('p').textContent = name;
  const [lat, lon] = to.split(',');
  dialog.querySelector('iframe').src = '/api/travel/map?' + new URLSearchParams({ lat, lon });
  const controller = new AbortController();
  dialog.addEventListener('close', () => { controller.abort(); dialog.remove(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  if (!from) return;
  const section = dialog.querySelector('section');
  section.textContent = 'Finding walking directions…';
  try {
    const response = await fetch('/api/travel/walking?' + new URLSearchParams({ from, to }), { signal: controller.signal });
    const route = await response.json();
    if (!response.ok) throw new Error(route.error || 'Walking directions unavailable.');
    section.textContent = `Walking · ${route.minutes} min · ${(route.distance / 1000).toFixed(1)} km`;
    const list = document.createElement('ol');
    for (const step of route.steps) {
      const item = document.createElement('li');
      item.textContent = step.text + (step.distance ? ` · ${step.distance} m` : '');
      list.append(item);
    }
    section.append(list, 'Directions from FOSSGIS OSRM · © OpenStreetMap contributors');
  } catch (error) {
    if (!controller.signal.aborted) section.textContent = error.message;
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-aiva-to]');
  if (button) showAivaMap(button.dataset.aivaTo, button.dataset.aivaFrom, button.dataset.aivaName);
});
const sharedAivaPoint = new URLSearchParams(location.search).get('aivaMap');
if (sharedAivaPoint && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(sharedAivaPoint)) {
  const [lat, lon] = sharedAivaPoint.split(',').map(Number);
  if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) showAivaMap(sharedAivaPoint, null, 'Shared location');
}
