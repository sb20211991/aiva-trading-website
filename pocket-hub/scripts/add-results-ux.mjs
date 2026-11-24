/* Build step: place search results directly under their search sections, and load the small script that
   reveals them after a search.
   1. The hotel results card is moved into the first column, immediately after the flight results card, so on a
      phone it sits under the search bar instead of at the bottom of the page (the two-column desktop layout keeps
      flights and hotels side by side in the wide column).
   2. Aiva UX v1 styles are added: 44 px touch targets, 16 px inputs (so mobile Safari does not zoom in), a visible
      keyboard focus ring and respect for reduced motion.
   3. aiva-results.js is loaded last, after app.js and the transport and rail scripts.
   Like the other steps it fails loudly if the markup it expects is not found exactly once, and running it twice
   is a no-op. */
import { readFileSync, writeFileSync } from 'node:fs';

const file = `${process.cwd()}/public/index.html`;

const HOTEL = '<div class="as-card" data-as="hotels">';
const TRANSFERS = '<div class="as-card" data-as="transfers">';
const TRANSPORT = '<div class="as-card" data-as="transport">';

const UX = '<style id="aiva-ux-v1">'
  + '.as-wrap .as-kind button,.as-wrap .as-tab,.as-wrap .as-modes button,.as-wrap .as-body .as-btn,.as-wrap .as-btn{min-height:44px}'
  + '.as-wrap input,.as-wrap select,.as-wrap textarea{font-size:16px}'
  + '.as-wrap :focus-visible{outline:3px solid #3b5bdb;outline-offset:2px;border-radius:10px}'
  + '.as-wrap .as-card:focus{outline:none}'
  + '.as-wrap .as-card.as-reveal{scroll-margin-top:10px}'
  + '@media(max-width:700px){.as-wrap .as-body .as-btn,.as-wrap .as-hotel .as-btn,.as-wrap .as-flight .as-btn{width:100%}}'
  + '@media(prefers-reduced-motion:reduce){.as-wrap *{scroll-behavior:auto!important;animation:none!important;transition:none!important}}'
  + '</style>';

const SCRIPT = '<script src="aiva-results.js" defer></script>';

let html = readFileSync(file, 'utf8');

if (html.indexOf(HOTEL) > -1 && html.indexOf(HOTEL) < html.indexOf(TRANSFERS)) {
  console.log('add-results-ux: hotel results already in the first column');
} else {
  const start = html.indexOf(HOTEL);
  const end = html.indexOf(TRANSPORT);
  const anchor = html.indexOf(TRANSFERS);
  if (start < 0 || end < start || anchor < 0) throw new Error('add-results-ux: hotel, transfers and transport cards were not found in the expected order');
  const block = html.slice(start, end);
  if (!block.includes('id="asHotels"') || !block.trimEnd().endsWith('</div>')) throw new Error('add-results-ux: the hotel results card could not be isolated cleanly');
  html = html.slice(0, start) + html.slice(end);
  html = html.replace(TRANSFERS, block + TRANSFERS);
  console.log('add-results-ux: hotel results moved directly under the search bar');
}

if (!html.includes('id="aiva-ux-v1"')) {
  if (html.split('</style></head>').length !== 2) throw new Error('add-results-ux: expected exactly one end of the inline stylesheet, found ' + (html.split('</style></head>').length - 1));
  html = html.replace('</style></head>', '</style>' + UX + '</head>');
  console.log('add-results-ux: Aiva UX v1 styles added');
}

if (!html.includes('src="aiva-results.js"')) {
  if (html.split('</body>').length !== 2) throw new Error('add-results-ux: expected exactly one closing body tag, found ' + (html.split('</body>').length - 1));
  html = html.replace('</body>', SCRIPT + '</body>');
  console.log('add-results-ux: results script added');
}

writeFileSync(file, html);
