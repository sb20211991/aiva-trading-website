/* Aiva Search build step. It runs before the tests and the deploy and fails loudly if the markup it expects is
   not found exactly once, so an intermittent template edit can never silently ship a half-applied change.
   Running it twice is a no-op.
   1. From and To are two separate fields: the template ships one route pill holding both inputs, so it is
      rewritten into two pills (From / To, each with its own icon) plus standalone styles for the arrow.
   2. The worldwide journey planner card (Aiva Transport, powered by /api/emergency/plan) and the Aiva-branded
      section names are added to the Aiva Search grid. */
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
  '.as-route{display:grid;grid-template-columns:26px 1fr;align-items:center;column-gap:8px;row-gap:0}.as-route input{width:100%}.as-bar>.as-arrow{transform:rotate(90deg);text-align:center;padding:2px 0;align-self:center;width:auto;height:auto}'
];

/* The stacked bar has no horizontal room to spare: a nowrap ghost button inside a card widens the whole page
   and makes mobile Safari drift sideways. Let it wrap. */
const BUTTON_WRAP = [
  '.as-btn.ghost{background:var(--asl);color:var(--as)}',
  '.as-btn.ghost{background:var(--asl);color:var(--as)}.as-body .as-btn.ghost{white-space:normal;text-align:left;line-height:1.35}'
];

const ATTRIB = [
  '· Google Maps Platform, Entur, opendata.ch (routes and timetables) ·',
  '· Google Maps Platform, Entur, opendata.ch, Transitous (routes and timetables) ·'
];

/* Aiva-branded section names inside Aiva Search, so every transport category is an Aiva section. */
const BRAND = [
  ['<h3>Aiva Routes <span aria-hidden="true">·</span>', '<h3>🚆 Aiva Transport <span aria-hidden="true">·</span>'],
  ['<i>🚕</i>Taxi &amp; transfers</button>', '<i>🚕</i>Aiva Taxi</button>'],
  ['<i>🚗</i>Car &amp; rental</button>', '<i>🚗</i>Aiva Car</button>'],
  ['<i>🚆</i>Train</button>', '<i>🚆</i>Aiva Train</button>'],
  ['<i>🚇</i>Metro</button>', '<i>🚇</i>Aiva Metro</button>'],
  ['<i>🚊</i>Tram</button>', '<i>🚊</i>Aiva Tram</button>'],
  ['<i>🚌</i>Bus &amp; shuttle</button>', '<i>🚌</i>Aiva Bus</button>'],
  ['<i>🚶</i>Walking</button>', '<i>🚶</i>Aiva Walk</button>'],
  ['<i>🚘</i>Ride-hailing</button>', '<i>🚘</i>Aiva Ride</button>']
];

const PLANNER_ANCHOR = '<div class="as-card" data-as="maps">';
const PLANNER = '<div class="as-card" data-as="transport"><div class="as-card-head"><h3>🌍 Aiva Transport <span aria-hidden="true">·</span> plan any journey</h3><span class="mini" id="asPlanMeta"></span></div>'
  + '<div class="as-body" id="asPlan"><form class="as-plan-form" id="asPlanForm" autocomplete="off">'
  + '<div class="as-plan-row"><label class="as-plan-field"><span>From</span><input id="asPlanFrom" placeholder="City, station or address" maxlength="120" aria-label="Travelling from"></label><button type="button" class="as-link" id="asPlanGeo" aria-label="Use my current location">📍</button></div>'
  + '<div class="as-plan-row"><label class="as-plan-field"><span>To</span><input id="asPlanTo" placeholder="City, station or address" maxlength="120" aria-label="Travelling to"></label></div>'
  + '<div class="as-plan-row"><label class="as-plan-field"><span>Date</span><input id="asPlanDate" type="date" aria-label="Travel date"></label><label class="as-plan-field"><span>Time</span><input id="asPlanTime" type="time" aria-label="Travel time"></label><label class="as-plan-field"><span>When</span><select id="asPlanWhen" aria-label="Leave at or arrive by"><option value="depart">Leave at</option><option value="arrive">Arrive by</option></select></label></div>'
  + '<div class="as-plan-chips" id="asPlanModes" role="group" aria-label="Transport modes"><button type="button" data-plan-mode="train" aria-pressed="false"><i>🚆</i>Aiva Train</button><button type="button" data-plan-mode="bus" aria-pressed="false"><i>🚌</i>Aiva Coach</button><button type="button" data-plan-mode="metro" aria-pressed="false"><i>🚇</i>Aiva Metro</button><button type="button" data-plan-mode="tram" aria-pressed="false"><i>🚊</i>Aiva Tram</button><button type="button" data-plan-mode="ferry" aria-pressed="false"><i>⛴️</i>Aiva Ferry</button><button type="button" data-plan-mode="walk" aria-pressed="false"><i>🚶</i>Aiva Walk</button></div>'
  + '<button class="as-btn" id="asPlanGo" type="submit">Plan journey</button></form>'
  + '<div id="asPlanOut" class="as-plan-out"><div class="empty">Plan any journey worldwide: trains, coaches, metro, trams, ferries and walking, with live times wherever the operator publishes them.</div></div></div></div>';

const SCRIPT = [
  '<script src="aiva-maps.js" defer></script>',
  '<script src="aiva-maps.js" defer></script><script src="aiva-transport.js" defer></script>'
];

let html = readFileSync(file, 'utf8');

for (const [label, from, to] of [['route fields', ...MARKUP], ['desktop styles', ...DESKTOP_CSS], ['mobile styles', ...MOBILE_CSS], ['button wrapping', ...BUTTON_WRAP], ['iOS icon', ...HEAD_ICON], ['attribution', ...ATTRIB], ['planner script', ...SCRIPT]]) {
  if (html.includes(to)) { console.log(`split-search-fields: ${label} already split`); continue; }
  const hits = html.split(from).length - 1;
  if (hits !== 1) throw new Error(`split-search-fields: expected exactly one ${label} match in public/index.html, found ${hits}`);
  html = html.replace(from, to);
  console.log(`split-search-fields: split ${label}`);
}

for (const [from, to] of BRAND) {
  if (html.includes(to)) continue;
  const hits = html.split(from).length - 1;
  if (hits !== 1) throw new Error(`split-search-fields: expected exactly one Aiva section name "${from}", found ${hits}`);
  html = html.replace(from, to);
  console.log('split-search-fields: branded ' + from.slice(from.indexOf('</i>') + 4));
}

if (!html.includes('id="asPlan"')) {
  const hits = html.split(PLANNER_ANCHOR).length - 1;
  if (hits !== 1) throw new Error(`split-search-fields: expected exactly one Aiva Maps card, found ${hits}`);
  html = html.replace(PLANNER_ANCHOR, PLANNER + PLANNER_ANCHOR);
  console.log('split-search-fields: added Aiva Transport planner');
}

writeFileSync(file, html);
