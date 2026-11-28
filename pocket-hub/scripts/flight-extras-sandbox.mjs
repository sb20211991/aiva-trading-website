#!/usr/bin/env node
/* Nuitee SANDBOX run of the Aiva flight baggage flow, against a preview deployment (which uses the sandbox LiteAPI key:
   test bookings only, nothing is ever charged). Run by the deploy workflow on pull requests.
     1. One way: search -> verify -> prebook (fictitious sandbox traveller) -> list the airline's bags (weights, prices)
        ADD     attach one bag              -> airline total = fare + that bag's listed price
        CHANGE  hold again, attach another weight -> airline total = fare + the new bag only
        REMOVE  hold again with no extras   -> fare unchanged (what "Remove all extras" / "Change baggage" relies on)
     2. Return trip: bags offered per flight (outbound and return segment keys), one bag attached on each.
     3. Booking: POST book with the bag-inclusive transaction. Without the card step the sandbox normally refuses (payment is
        made in the Nuitee card form in a browser); any booking it does return is listed with the services it confirms.
   Usage: node scripts/flight-extras-sandbox.mjs <preview base URL> */
const U = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https:\/\//.test(U)) { console.error('Usage: flight-extras-sandbox.mjs https://<preview>'); process.exit(2); }
const H = { 'Content-Type': 'application/json', Origin: U };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const post = async (body) => {
  const r = await fetch(`${U}/api/travel/flight-book`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const d = await r.json().catch(() => ({})); return { status: r.status, d };
};
const log = (...a) => console.log('extras-sandbox:', ...a);
const near = (a, b) => Math.abs(a - b) < 0.011;
const contact = { firstName: 'Oliver', lastName: 'Bennett', email: 'sandbox.test@example.com', phoneCountryCode: '44', phoneNumber: '7700900123' };
const passengers = [{ passengerType: 0, firstName: 'Oliver', lastName: 'Bennett', birthday: '1990-01-15', gender: 'M', nationality: 'GB' }];
const results = {};
const hold = async (offerId) => {
  const v = await post({ action: 'verify', offerId });
  if (v.status !== 200) return null;
  const p = await post({ action: 'prebook', offerId: v.d.offerId || offerId, contact, passengers });
  return p.status === 200 ? p.d : (log(`prebook ${p.status} ${p.d.error || ''}`), null);
};
const attach = (p, list) => post({ action: 'services', prebookId: p.prebookId, extrasToken: p.extrasToken, passengers: 1, selected: list.map((b) => ({ passengerIndex: 0, serviceId: b.serviceId, quantity: 1 })) });
const search = (from, to, ret) => fetch(`${U}/api/travel/flights?from=${from}&to=${to}&depart=${day(35)}${ret ? `&return=${day(42)}` : ''}&adults=1&currency=GBP`, { signal: AbortSignal.timeout(60000) }).then((r) => r.json()).catch(() => ({}));
const paid = (p) => (p.services?.bags || []).filter((b) => b.price && b.price.amount > 0);

const routes = [['LGW', 'BCN'], ['STN', 'DUB'], ['LHR', 'CDG'], ['LTN', 'BUD'], ['MAN', 'AMS']];
let booked = null;
/* 1. One way: add, change, remove. */
outer: for (const [from, to] of routes) {
  const s = await search(from, to, false);
  if (!s.testMode) { log('preview is not on the sandbox key; stopping so no real booking is touched'); process.exit(1); }
  for (const o of (s.offers || []).slice(0, 4)) {
    const p = await hold(o.id);
    if (!p) continue;
    const bags = paid(p);
    log(`${from}-${to} ${o.airline}: prebook £${p.price} · bags offered=${bags.length} · extrasOn=${p.extrasOn} · included=${JSON.stringify(o.bags?.allowance || [])}`);
    if (p.servicesShape) log('Nuitee service fields:', JSON.stringify(p.servicesShape));
    if (bags.length < 2) { log('  fewer than two paid bags: add/change needs two weights, trying the next fare'); results.noBags = (results.noBags || []).concat(`${o.airline} ${from}-${to}`); continue; }
    log('  bag options:', JSON.stringify(bags.map((b) => [b.kind, b.weightKg, b.price.amount, b.segmentKey, b.segment])));
    const [a, b] = [bags[0], bags.find((x) => x.serviceId !== bags[0].serviceId && x.weightKg !== bags[0].weightKg) || bags[1]];
    const add = await attach(p, [a]);
    results.add = add.status === 200 && near(add.d.price, p.price + a.price.amount);
    log(`  ADD ${a.weightKg} kg £${a.price.amount}: ${add.status} total £${p.price} -> £${add.d.price} ${results.add ? 'PASSED' : 'FAILED ' + (add.d.error || '')}`);
    const p2 = await hold(o.id);
    if (p2) {
      const b2 = paid(p2).find((x) => x.kind === b.kind && x.weightKg === b.weightKg) || b;
      const ch = await attach(p2, [b2]);
      results.change = ch.status === 200 && near(ch.d.price, p2.price + b2.price.amount);
      log(`  CHANGE to ${b2.weightKg} kg £${b2.price.amount} (fare held again): total £${p2.price} -> £${ch.d.price} ${results.change ? 'PASSED (only the new bag is charged)' : 'FAILED ' + (ch.d.error || '')}`);
      if (results.change) booked = { p: p2, t: ch.d };
    }
    const p3 = await hold(o.id);
    results.remove = !!p3 && near(p3.price, p.price);
    log(`  REMOVE (hold again, no extras): fare £${p3?.price} vs original £${p.price} ${results.remove ? 'PASSED' : 'FAILED'}`);
    break outer;
  }
}
/* 2. Return trip: bags per direction. */
outer2: for (const [from, to] of routes) {
  const s = await search(from, to, true);
  for (const o of (s.offers || []).slice(0, 4)) {
    if ((o.slices || []).length !== 2) continue;
    const p = await hold(o.id);
    if (!p) continue;
    const bags = paid(p), keys = [...new Set(bags.map((b) => b.segmentKey))];
    const segCount = o.slices.reduce((n, sl) => n + Math.max(1, (sl.segments || []).length), 0);
    log(`RETURN ${from}-${to} ${o.airline}: ${o.slices.map((x) => `${x.from}→${x.to}`).join(' / ')} · flight segments=${segCount} · bag segment keys=${keys.length} ${JSON.stringify(keys)} · airports on services=${bags.some((b) => b.segment)}`);
    if (keys.length < 2) { log('  bags not offered per direction for this fare, trying the next'); continue; }
    log('  bag options:', JSON.stringify(bags.map((b) => [b.kind, b.name, b.weightKg, b.price.amount, b.segmentKey, b.segment])));
    const pick = keys.map((k) => bags.filter((b) => b.segmentKey === k).sort((x, y) => x.price.amount - y.price.amount)[0]);
    const r = await attach(p, pick);
    const want = p.price + pick.reduce((n, b) => n + b.price.amount, 0);
    results.returnTrip = r.status === 200 && near(r.d.price, want);
    results.directionsMapped = keys.length === segCount || keys.length === 2 || bags.some((b) => b.segment);
    log(`  OUTBOUND + RETURN bag (${pick.map((b) => `${b.weightKg} kg £${b.price.amount}`).join(' + ')}): total £${p.price} -> £${r.d.price} ${results.returnTrip ? 'PASSED' : 'FAILED ' + (r.d.error || '')} · labelled by ${bags.some((b) => b.segment) ? 'airports' : keys.length === segCount ? 'segment order' : 'journey order'}`);
    break outer2;
  }
}
/* 3. Booking with the bag-inclusive transaction (card step not done here). */
if (booked) {
  const b = await post({ action: 'book', prebookId: booked.p.prebookId, transactionId: booked.t.transactionId });
  if (b.status === 200 && b.d.bookingId) {
    log(`BOOK: sandbox booking ${b.d.bookingId} status ${b.d.status} · services on the booking: ${JSON.stringify(b.d.services)} · services reply fields ${JSON.stringify(b.d.servicesReplyShape)} · locks ${b.d.servicesReplyLocks}`);
    results.bagOnBooking = (b.d.services || []).some((x) => /bag|kg|lugg/i.test(x.name));
    const st = await post({ action: 'status', bookingId: b.d.bookingId, email: contact.email });
    log(`STATUS: ${st.status} ${st.d.status || st.d.error || ''} · services: ${JSON.stringify(st.d.services || [])}`);
  }
  else log(`BOOK: ${b.status} ${b.d.error || ''} (expected without the card step: payment is made in the Nuitee card form)`);
}
log('RESULTS', JSON.stringify(results));
if (results.add === false || results.change === false || results.remove === false || results.returnTrip === false) process.exit(1);
if (results.add === undefined) { log('no sandbox fare offered two paid bags; add/change was not exercised'); process.exit(3); }
