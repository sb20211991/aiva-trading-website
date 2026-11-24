/* Build step: add the Aiva Car Rental card and its script to public/index.html. It lives beside the other
   build steps so each one owns a single change and fails loudly on its own. Running it twice is a no-op. */
import { readFileSync, writeFileSync } from 'node:fs';

const file = `${process.cwd()}/public/index.html`;
const CAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 13.4l1.3-3.9A2.6 2.6 0 0 1 8.4 7.8h7.2a2.6 2.6 0 0 1 2.5 1.7l1.3 3.9"/><path d="M3.6 13.4h16.8v4.2H3.6z"/><circle cx="7.2" cy="17.6" r="1.7"/><circle cx="16.8" cy="17.6" r="1.7"/><path d="M6.6 13.4h10.8"/></svg>';
const CARD = '<div class="as-card rail-card" data-car-rental="1" id="asCar"><div class="as-card-head"><div class="rail-brand"><span class="rail-mark" aria-hidden="true">' + CAR_ICON + '</span><div><h3>Aiva Car Rental</h3><p>Live cars, real prices and deposits, booked inside Aiva</p></div></div><span class="rail-tag" id="crTag">Live</span></div><div class="as-body rail-body" id="asCarBody"></div></div>';
const ANCHOR = '<div class="as-card as-review" id="asFReview" hidden></div>';
const RAIL_SCRIPT = '<script src="aiva-rail.js" defer></script>';
const CAR_SCRIPT = '<script src="aiva-car.js" defer></script>';

let html = readFileSync(file, 'utf8');

if (!html.includes('id="asCar"')) {
  const hits = html.split(ANCHOR).length - 1;
  if (hits !== 1) throw new Error(`add-car-section: expected exactly one review-card anchor, found ${hits}`);
  html = html.replace(ANCHOR, CARD + ANCHOR);
  console.log('add-car-section: added Aiva Car Rental');
}

if (!html.includes('src="aiva-car.js"')) {
  const hits = html.split(RAIL_SCRIPT).length - 1;
  if (hits !== 1) throw new Error(`add-car-section: expected exactly one aiva-rail.js tag, found ${hits}`);
  html = html.replace(RAIL_SCRIPT, RAIL_SCRIPT + CAR_SCRIPT);
  console.log('add-car-section: added the car rental script');
}

writeFileSync(file, html);
