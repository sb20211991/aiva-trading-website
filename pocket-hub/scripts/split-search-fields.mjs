/* Aiva Search: From and To are two separate fields.
   The template still ships one route pill holding both inputs, so this build step rewrites that
   pill into two pills (From / To, each with its own icon) plus standalone styles for the arrow.
   It runs before the deploy and fails loudly if the markup it expects is not found exactly once,
   so an intermittent template edit can never silently ship the merged pill again.
   Running it twice is a no-op. */
import { readFileSync, writeFileSync } from 'node:fs';

const file = `${process.cwd()}/public/index.html`;

const MARKUP = [
  '<label class="as-seg as-route"><span aria-hidden="true">🔍</span><input id="asFrom" placeholder="From (city or airport)" value="London (LON)" maxlength="80" aria-label="From"><span class="as-arrow" aria-hidden="true">→</span><input id="asTo" placeholder="To (city or airport)" value="Guangzhou (CAN)" maxlength="80" aria-label="To"></label>',
  '<label class="as-seg as-route as-from"><span aria-hidden="true">🛫</span><input id="asFrom" placeholder="From (city or airport)" value="London (LON)" maxlength="80" aria-label="From"></label><span class="as-arrow" aria-hidden="true">→</span><label class="as-seg as-route as-to"><span aria-hidden="true">🛬</span><input id="asTo" placeholder="To (city or airport)" value="Guangzhou (CAN)" maxlength="80" aria-label="To"></label>'
];

const DESKTOP_CSS = [
  '.as-route{flex:2}.as-route input{flex:1;width:100%}.as-arrow,.as-dash{color:#8b8fa8;font-weight:700}',
  '.as-route{flex:1}.as-route input{flex:1;width:100%}.as-route.as-from{border-right:0}.as-route:has(input[hidden]){display:none}.as-arrow,.as-dash{color:#8b8fa8;font-weight:700}.as-bar>.as-arrow{display:flex;align-items:center;padding:0 4px}'
];

const HEAD_ICON = [
  '<link rel="icon" href="icon-192.png"><meta name="application-name" content="Aiva">',
  '<link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png"><meta name="application-name" content="Aiva">'
];

const MOBILE_CSS = [
  '.as-route{display:grid;grid-template-columns:26px 1fr;align-items:center;column-gap:8px;row-gap:0}.as-route input{width:100%}.as-route .as-arrow{transform:rotate(90deg);text-align:center}',
  '.as-route{display:grid;grid-template-columns:26px 1fr;align-items:center;column-gap:8px;row-gap:0}.as-route input{width:100%}.as-bar>.as-arrow{transform:rotate(90deg);text-align:center;padding:2px 0}'
];

let html = readFileSync(file, 'utf8');

for (const [label, from, to] of [['route fields', ...MARKUP], ['desktop styles', ...DESKTOP_CSS], ['mobile styles', ...MOBILE_CSS], ['iOS icon', ...HEAD_ICON]]) {
  if (html.includes(to)) { console.log(`split-search-fields: ${label} already split`); continue; }
  const hits = html.split(from).length - 1;
  if (hits !== 1) throw new Error(`split-search-fields: expected exactly one ${label} match in public/index.html, found ${hits}`);
  html = html.replace(from, to);
  console.log(`split-search-fields: split ${label}`);
}

writeFileSync(file, html);
