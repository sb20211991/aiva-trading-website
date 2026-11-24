/* Build step: add the Aiva Car Rental card and its script to public/index.html. It lives beside the other
   build steps so each one owns a single change and fails loudly on its own. Running it twice is a no-op,
   and it works whether or not the rail build step has already added aiva-rail.js.
   The card carries no "Live" badge: until an authorised supplier is connected there is no live car hire data,
   and the card itself says so. */
import { readFileSync, writeFileSync } from 'node:fs';

const file = `${process.cwd()}/public/index.html`;
const CAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 13.4l1.3-3.9A2.6 2.6 0 0 1 8.4 7.8h7.2a2.6 2.6 0 0 1 2.5 1.7l1.3 3.9"/><path d="M3.6 13.4h16.8v4.2H3.6z"/><circle cx="7.2" cy="17.6" r="1.7"/><circle cx="16.8" cy="17.6" r="1.7"/><path d="M6.6 13.4h10.8"/></svg>';
const CARD = '<div class="as-card rail-card" data-car-rental="1" id="asCar"><div class="as-card-head"><div class="rail-brand"><span class="rail-mark" aria-hidden="true">' + CAR_ICON + '</span><div><h3>Aiva Car Rental</h3><p>Live cars, real prices and deposits, booked inside Aiva</p></div></div></div><div class="as-body rail-body" id="asCarBody"></div></div>';
const ANCHOR = '<div class="as-card as-review" id="asFReview" hidden></div>';
const CAR_SCRIPT = '<script src="aiva-car.js" defer></script>';
const AFTER = ['<script src="aiva-rail.js" defer></script>', '<script src="aiva-transport.js" defer></script>'];

let html = readFileSync(file, 'utf8');

if (!html.includes('id="asCar"')) {
  const hits = html.split(ANCHOR).length - 1;
  if (hits !== 1) throw new Error(`add-car-section: expected exactly one review-card anchor, found ${hits}`);
  html = html.replace(ANCHOR, CARD + ANCHOR);
  console.log('add-car-section: added Aiva Car Rental');
}

if (!html.includes('src="aiva-car.js"')) {
  const after = AFTER.find((tag) => html.includes(tag));
  if (!after) throw new Error('add-car-section: found neither the aiva-rail.js nor the aiva-transport.js script tag');
  if (html.split(after).length - 1 !== 1) throw new Error(`add-car-section: expected exactly one ${after} tag`);
  html = html.replace(after, after + CAR_SCRIPT);
  console.log('add-car-section: added the car rental script');
}

writeFileSync(file, html);
