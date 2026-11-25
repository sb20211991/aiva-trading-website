/* Build step: add the Aiva Train and Aiva Tram sections, their scripts and the drawn Aiva Search mark to
   public/index.html. It lives beside split-search-fields.mjs so each build step owns one change and fails
   loudly on its own. Running it twice is a no-op. */
import { readFileSync, writeFileSync } from 'node:fs';

const file = `${process.cwd()}/public/index.html`;
const ICON = {
  train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2.8" width="14" height="14.2" rx="3.2"/><path d="M5 10.2h14"/><circle cx="9" cy="13.6" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="13.6" r="1.15" fill="currentColor" stroke="none"/><path d="M8.6 20.8l1.9-3.8M15.4 20.8l-1.9-3.8M7.4 20.8h9.2"/></svg>',
  tram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16.6V9.4A3.4 3.4 0 0 1 7.4 6h9.2A3.4 3.4 0 0 1 20 9.4v7.2"/><path d="M4 12.6h16"/><path d="M9 6V3.6h6V6M12 3.6V1.8"/><circle cx="8" cy="17.8" r="1.5"/><circle cx="16" cy="17.8" r="1.5"/><path d="M4 16.6h16M9.4 9.4h1.8M12.8 9.4H14.6"/></svg>'
};
const card = (mode, label, blurb) => `<div class="as-card rail-card" data-rail-section="${mode}" id="asRail${label}"><div class="as-card-head"><div class="rail-brand"><span class="rail-mark" aria-hidden="true">${ICON[mode]}</span><div><h3>Aiva ${label}</h3><p>${blurb}</p></div></div><span class="rail-tag" id="rail${label}Tag">Live</span></div><div class="as-body rail-body" id="rail${label}Body"></div></div>`;
const CARDS = card('train', 'Train', 'Live trains, real platforms and times')
  + card('tram', 'Tram', 'Live trams and light rail, with the exact stop to board');
const ANCHOR = '<div class="as-card as-review" id="asFReview" hidden></div>';
const SCRIPTS = '<script src="vendor/qrcode.js" defer></script><script src="aiva-rail.js" defer></script>';
const TRANSPORT = '<script src="aiva-transport.js" defer></script>';
const LOGO = '<span class="as-logo" aria-hidden="true">✈</span>';
const MARK = '<span class="as-logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.6"/><path d="M20 20l-4.4-4.4"/><path d="M8.4 11h5.2"/><path d="M11 8.4v5.2"/></svg></span>';

let html = readFileSync(file, 'utf8');

if (!html.includes('id="asRailTrain"')) {
  const hits = html.split(ANCHOR).length - 1;
  if (hits !== 1) throw new Error(`add-rail-sections: expected exactly one review-card anchor, found ${hits}`);
  html = html.replace(ANCHOR, CARDS + ANCHOR);
  console.log('add-rail-sections: added Aiva Train and Aiva Tram');
}

if (!html.includes('src="aiva-rail.js"')) {
  const hits = html.split(TRANSPORT).length - 1;
  if (hits !== 1) throw new Error(`add-rail-sections: expected exactly one aiva-transport.js tag, found ${hits}`);
  html = html.replace(TRANSPORT, TRANSPORT + SCRIPTS);
  console.log('add-rail-sections: added the rail scripts');
}

if (html.includes(LOGO)) {
  html = html.replace(LOGO, MARK);
  console.log('add-rail-sections: drew the Aiva Search mark');
}

writeFileSync(file, html);
