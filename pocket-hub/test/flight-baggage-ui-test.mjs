/* Aiva Flights baggage section and international phone numbers. Offline: the picker runs against a tiny DOM stand-in and
   a stubbed /api/travel/flight-book; nothing is booked or charged. Bag data mirrors a real Nuitee sandbox reply
   (Vueling LGW-BCN: checked bags 15/20/25/30 kg). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { onRequestPost, shapeServices, segmentOf, contact } from '../functions/api/travel/flight-book.js';

const src = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const sent = [];
const ctx = { window: {}, console, Intl, AbortSignal, navigator: { language: 'en-GB' }, String, Number, Math, Map, Set, Object, Array, JSON, Promise, Error,
  fetch: async (url, init) => { const b = JSON.parse(init.body); sent.push(b); const sum = 30 + b.selected.reduce((n, x) => n + ({ b20o: 68.45, b25o: 72.72, b20r: 70.1, b23r: 74 }[x.serviceId] || 0) * x.quantity, 0);
    return { ok: true, json: async () => ({ transactionId: 'tr_new', secretKey: 'sk_new', price: Math.round(sum * 100) / 100, currency: 'GBP' }) }; } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(src('aiva-flight-extras.js'), ctx);
vm.runInContext(src('aiva-phone.js'), ctx);

/* Minimal box: innerHTML is kept as a string; clicks are dispatched with a target whose closest() finds the attribute. */
function makeBox() {
  const box = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  box.click = async (attr, value, id) => {
    const target = { id: id || '', textContent: '', closest: (sel) => { const m = sel.match(/^\[data-([a-z-]+)\]$/); if (!m || m[1] !== attr) return null;
      const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/^fx/, 'fx'); return { dataset: { [key]: value, ...(attr === 'fx-opt' ? { fxGroup: value.group } : {}) } }; } };
    if (attr === 'fx-opt') target.closest = (sel) => sel === '[data-fx-opt]' ? { dataset: { fxOpt: value.id, fxGroup: value.group } } : null;
    await box.onclick({ target });
  };
  return box;
}
const bag = (serviceId, kg, amount, segmentKey) => ({ serviceId, segmentKey, segment: null, passengerType: '', name: `Standard Check In Baggage ${kg}kg`, kind: 'checked', weightKg: kg, size: '', quantityMax: 2, price: { amount, currency: 'GBP' } });
const offer = { airline: 'Vueling Airlines', price: 30, currency: 'GBP', slices: [{ from: 'LGW', to: 'BCN', departing: '2027-01-12T07:00', segments: [{ from: 'LGW', to: 'BCN' }] }, { from: 'BCN', to: 'LGW', departing: '2027-01-19T18:00', segments: [{ from: 'BCN', to: 'LGW' }] }],
  bags: { carryOn: false, checked: false, allowance: [{ kind: 'personal', pieces: 1, weightKg: null, size: '40 × 20 × 30 cm' }], extras: [] } };
const prebook = { prebookId: 'pb_1', extrasToken: 'tok', price: 30, currency: 'GBP', extrasOn: true,
  services: { seats: [], others: [], bags: [bag('b20o', 20, 68.45, '0113b59d'), bag('b25o', 25, 72.72, '0113b59d'), bag('b20r', 20, 70.1, 'a77f0e21'), bag('b23r', 23, 74, 'a77f0e21')] } };
const pax = [{ passengerType: 0, firstName: 'Oliver', lastName: 'Bennett' }, { passengerType: 0, firstName: 'Ana', lastName: 'Bennett' }];

// Included bags, outbound/return sections with the airline's weights and prices, and a live total.
{
  const box = makeBox();
  const done = ctx.aivaFlightExtras(prebook, box, pax, offer, null);
  let h = box.innerHTML;
  assert.match(h, /🧳 Baggage/); assert.match(h, /Personal item<\/b> · 40 × 20 × 30 cm<\/span><em>✓ Included/); assert.match(h, /Checked bag<\/b><\/span><em>Not included/);
  assert.match(h, /✈️ Outbound · LGW → BCN/); assert.match(h, /✈️ Return · BCN → LGW/);
  assert.match(h, /20 kg · <b>£68\.45<\/b>/); assert.match(h, /25 kg · <b>£72\.72<\/b>/); assert.match(h, /23 kg · <b>£74\.00<\/b>/);
  assert.match(h, /id="fxTotal">£30\.00</); assert.match(h, /Continue to payment without extras/);
  // Add 20 kg outbound for traveller 1: total updates.
  await box.click('fx-opt', { id: 'b20o', group: '0113b59d|checked' });
  assert.match(box.innerHTML, /id="fxTotal">£98\.45</); assert.match(box.innerHTML, /Baggage<\/span><b>£68\.45/);
  // Change it to 25 kg: replaces, never adds.
  await box.click('fx-opt', { id: 'b25o', group: '0113b59d|checked' });
  assert.match(box.innerHTML, /id="fxTotal">£102\.72</);
  // Two bags of 25 kg, then back to one.
  await box.click('fx-inc', 'b25o'); assert.match(box.innerHTML, /id="fxTotal">£175\.44</); assert.match(box.innerHTML, /2 bags/);
  await box.click('fx-dec', 'b25o'); assert.match(box.innerHTML, /id="fxTotal">£102\.72</);
  // Remove it.
  await box.click('fx-none', '0113b59d|checked'); assert.match(box.innerHTML, /id="fxTotal">£30\.00</);
  // Traveller 2 adds 20 kg out; copy to the return picks the same weight only where the airline sells it (20 kg yes).
  await box.click('fx-pax', '1');
  await box.click('fx-opt', { id: 'b20o', group: '0113b59d|checked' });
  await box.click('fx-copy', '1');
  h = box.innerHTML;
  assert.match(h, /id="fxTotal">£168\.55</, '30 + 68.45 + 70.10'); assert.match(h, /Ana Bennett · 🧳2/);
  // Confirm: one attach call with the exact selection; result carries the airline total and readable labels.
  await box.onclick({ target: { id: 'fxGo', textContent: '', closest: () => null } });
  const r = await done;
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).selected)), [{ passengerIndex: 1, serviceId: 'b20o', quantity: 1 }, { passengerIndex: 1, serviceId: 'b20r', quantity: 1 }]);
  assert.equal(r.price, 168.55); assert.equal(r.transactionId, 'tr_new'); assert.equal(r.differs, false);
  assert.deepEqual(JSON.parse(JSON.stringify(r.labels.map((l) => [l.name, l.traveller, l.flight]))), [['Standard Check In Baggage 20kg', 'Ana Bennett', 'Outbound · LGW → BCN'], ['Standard Check In Baggage 20kg', 'Ana Bennett', 'Return · BCN → LGW']]);
  // Re-held fare (Change baggage): earlier choices are pre-selected on the new prebook's services.
  const box2 = makeBox();
  ctx.aivaFlightExtras({ ...prebook, services: { ...prebook.services, bags: prebook.services.bags.map((b) => ({ ...b, serviceId: b.serviceId + 'x' })) } }, box2, pax, offer, { memo: r.memo });
  assert.match(box2.innerHTML, /id="fxTotal">£168\.55</);
}
// No bags sold through the provider: said plainly, and payment can continue at the fare.
{
  const box = makeBox();
  const done = ctx.aivaFlightExtras({ ...prebook, services: { seats: [], bags: [], others: [] } }, box, pax.slice(0, 1), { ...offer, airline: 'easyJet' }, null);
  assert.match(box.innerHTML, /Extra baggage can't be added for this fare in Aiva/); assert.match(box.innerHTML, /easyJet does not sell additional bags/);
  await box.onclick({ target: { id: 'fxGo', textContent: '', closest: () => null } });
  assert.deepEqual(JSON.parse(JSON.stringify(await done)), { extras: [], memo: [] });
}
// Airports on a service win over order matching.
assert.deepEqual(segmentOf({ segment: { originCode: 'bcn', destinationCode: 'LGW' } }), { from: 'BCN', to: 'LGW' });
assert.equal(segmentOf({ origin: 'Barcelona' }), null);
assert.deepEqual(shapeServices({ groups: [{ type: 'BAGGAGE', segmentKey: 'k1', origin: { iataCode: 'LGW' }, destination: { iataCode: 'BCN' }, services: [{ serviceId: 'bag_1', category: 'baggage', pricing: { display: { amount: 10, currency: 'GBP' } }, metadata: { baggage: { weight: 20 } } }] }] }).bags[0].segment, { from: 'LGW', to: 'BCN' });

// Phone: flags and +codes, international form, trunk 0 dropped (kept for Italy), validation.
{
  const P = ctx.aivaPhone;
  assert.equal(P.flag('GB'), '🇬🇧'); assert.equal(P.code('gb'), '44'); assert.equal(P.code('IQ'), '964'); assert.equal(P.code('US'), '1');
  assert.ok(Object.keys(P.DIAL).length >= 240);
  assert.match(P.options('GB'), /<option value="GB" data-dial="44" label="🇬🇧 \+44" selected>🇬🇧 United Kingdom \(\+44\)<\/option>/);
  assert.equal(P.national('44', '07700 900123'), '7700900123'); assert.equal(P.national('44', '+44 (0)7700 900123'), '7700900123'); assert.equal(P.national('44', '0044 7700 900123'), '7700900123');
  assert.equal(P.national('39', '06 1234 5678'), '0612345678');
  assert.equal(P.format('GB', '44', '7700900123'), '+44 7700 900123'); assert.equal(P.format('GB', '44', '2079460000'), '+44 20 7946 0000');
  assert.equal(P.format('US', '1', '2025550143'), '+1 202 555 0143'); assert.equal(P.format('FR', '33', '612345678'), '+33 6 12 34 56 78');
  assert.equal(P.format('IQ', '964', '7701234567'), '+964 770 123 4567');
  assert.equal(P.valid('44', '7700900123'), true); assert.equal(P.valid('44', '77009'), false); assert.equal(P.valid('1', '202555014'), false);
  assert.equal(P.guess('', '44'), 'GB'); assert.equal(P.guess('IQ', ''), 'IQ');
}
// Backend: the contact phone is sent to the airline in international form.
assert.deepEqual(contact({ firstName: 'Ana', lastName: 'Test', email: 'a@example.com', phoneCountryCode: '+44', phoneNumber: '07700 900123' }),
  { firstName: 'Ana', lastName: 'Test', email: 'a@example.com', phoneCountryCode: '44', phoneNumber: '7700900123' });
assert.equal(contact({ firstName: 'Ana', lastName: 'Test', email: 'a@example.com', phoneCountryCode: '39', phoneNumber: '06 1234 5678' }).phoneNumber, '0612345678');
assert.equal(contact({ firstName: 'Ana', lastName: 'Test', email: 'a@example.com', phoneCountryCode: '44', phoneNumber: '1234567890123456' }), null);

// Page wiring: phone script before app.js, the form shows the 🇬🇧 +44 picker and a baggage section before the pay button,
// and date fields can no longer force a wide column on phones.
{
  const html = src('index.html'), app = src('app.js');
  assert.ok(html.indexOf('src="aiva-phone.js"') > -1 && html.indexOf('src="aiva-phone.js"') < html.indexOf('src="app.js"'));
  assert.match(html, /\.as-book-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/); assert.match(html, /\.as-book input\[type=date\]\{-webkit-appearance:none/);
  assert.match(html, /@media\(max-width:700px\)\{\n  \.as-book-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  const form = app.slice(app.indexOf('function asFlightFormHTML('), app.indexOf('\nasync function asFlightPay'));
  assert.match(form, /name="cPhoneIso"/); assert.ok(!form.includes('name="cPhoneCc"'));
  assert.ok(form.indexOf('asBagPreviewHTML(AS.flight)') < form.indexOf('id="asFPayBtn"'));
  assert.match(app, /id="asFChangeBags"/);
  assert.match(src('service-worker.js'), /'\.\/aiva-phone\.js'/);
}
// prebook reports whether extras are on, and (sandbox only) the field names Nuitee uses for services.
{
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const req = (b) => new Request('https://app.aivatrading.uk/api/travel/flight-book', { method: 'POST', body: JSON.stringify(b), headers: { Origin: 'https://app.aivatrading.uk' } });
  const body = { action: 'prebook', offerId: 'off_1234', contact: { firstName: 'Ana', lastName: 'Test', email: 'a@example.com', phoneCountryCode: '44', phoneNumber: '7700900000' }, passengers: [{ passengerType: 0, firstName: 'Ana', lastName: 'Test', birthday: '1990-01-01', gender: 'F', nationality: 'GB' }] };
  const f = async () => reply({ data: [{ prebookId: 'pb_1234', transactionId: 'tr_1', secretKey: 'sk_1', price: 30, currency: 'GBP', servicesAttachable: { groups: [{ type: 'BAGGAGE', segmentKey: 'k', services: [{ serviceId: 'bag_1', category: 'baggage', metadata: { baggage: { weight: 20 } } }] }] } }] });
  const sb = await (await onRequestPost({ request: req(body), env: { LITEAPI_KEY: 'sand_x' } }, f)).json();
  assert.equal(sb.extrasOn, true); assert.deepEqual(sb.servicesShape.group, ['type', 'segmentKey', 'services']);
  const live = await (await onRequestPost({ request: req(body), env: { LITEAPI_KEY: 'live_x', FLIGHT_BOOKING_LIVE: 'true', FLIGHT_EXTRAS_LIVE: 'true' } }, f)).json();
  assert.equal(live.servicesShape, undefined);
}
console.log('FLIGHT BAGGAGE + PHONE CHECKS PASSED');
// Real sandbox shapes: Ryanair bags without metadata weight ("20kg" in the name), flights named in the group label, and the
// booking's services read from GET /flights/bookings/{id}/services when the booking reply has none.
{
  const s = shapeServices({ groups: [{ category: 'BAGGAGE', label: 'STN - DUB', services: [{ serviceId: 'bag_ry1', name: '20kg Check-in Bag', category: 'BAGGAGE', segmentKey: '50ba1e33', pricing: { display: { amount: 15, currency: 'GBP' } }, metadata: {} }] }] });
  assert.equal(s.bags[0].weightKg, 20); assert.deepEqual(s.bags[0].segment, { from: 'STN', to: 'DUB' });
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const req = (b) => new Request('https://app.aivatrading.uk/api/travel/flight-book', { method: 'POST', body: JSON.stringify(b), headers: { Origin: 'https://app.aivatrading.uk' } });
  const f = async (url) => String(url).endsWith('/services') ? reply({ data: { bookedServices: [{ name: '20kg Check-in Bag', quantity: 1, passengerIndex: 0, segmentKey: '50ba1e33', pricing: { display: { amount: 15, currency: 'GBP' } } }] } })
    : reply({ data: [{ booking: { bookingId: 'bk_1234', status: 'CONFIRMED' } }] });
  const d = await (await onRequestPost({ request: req({ action: 'book', prebookId: 'pb_1234', transactionId: 'tr_1234' }), env: { LITEAPI_KEY: 'sand_x' } }, f)).json();
  assert.equal(d.services[0].name, '20kg Check-in Bag'); assert.deepEqual(d.servicesReplyShape, ['bookedServices']);
}
console.log('SANDBOX SHAPE CHECKS PASSED');
