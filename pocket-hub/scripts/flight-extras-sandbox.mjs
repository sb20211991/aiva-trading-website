#!/usr/bin/env node
/* Nuitee SANDBOX run of the Aiva flight baggage and services flow, against a preview deployment (which uses the sandbox
   LiteAPI key: test bookings only, nothing is ever charged). Run by the deploy workflow on pull requests:
     search -> verify -> prebook (fictitious sandbox traveller) -> list the airline's seats / bags / services -> attach one bag
     (+ one seat and one other service when offered) -> check the airline returned a new, higher total.
   Payment and ticketing need the card form in a browser, so the run stops before payment.
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

const routes = [['LGW', 'BCN'], ['STN', 'DUB'], ['LHR', 'CDG'], ['LTN', 'BUD'], ['MAN', 'AMS']];
let done = false;
for (const [from, to] of routes) {
  const s = await fetch(`${U}/api/travel/flights?from=${from}&to=${to}&depart=${day(35)}&adults=1&currency=GBP`, { signal: AbortSignal.timeout(60000) }).then((r) => r.json()).catch(() => ({}));
  if (!s.testMode) { log('preview is not on the sandbox key; stopping so no real booking is touched'); process.exit(1); }
  for (const o of (s.offers || []).slice(0, 3)) {
    const v = await post({ action: 'verify', offerId: o.id });
    if (v.status !== 200) continue;
    const p = await post({ action: 'prebook', offerId: v.d.offerId || o.id,
      contact: { firstName: 'Oliver', lastName: 'Bennett', email: 'sandbox.test@example.com', phoneCountryCode: '44', phoneNumber: '7700900123' },
      passengers: [{ passengerType: 0, firstName: 'Oliver', lastName: 'Bennett', birthday: '1990-01-15', gender: 'M', nationality: 'GB' }] });
    if (p.status !== 200) { log(`${from}-${to} ${o.airline}: prebook ${p.status} ${p.d.error || ''}`); continue; }
    const sv = p.d.services || {};
    log(`${from}-${to} ${o.airline}: prebook ${p.d.prebookId} £${p.d.price} · offered seats=${(sv.seats || []).length} bags=${(sv.bags || []).length} services=${(sv.others || []).length}`);
    log('bag options:', JSON.stringify((sv.bags || []).slice(0, 8).map((b) => [b.kind, b.name, b.weightKg, b.size, b.price?.amount, b.segmentKey])));
    log('other services:', JSON.stringify((sv.others || []).slice(0, 8).map((b) => [b.kind, b.name, b.price?.amount, b.segmentKey])));
    const bag = (sv.bags || []).find((b) => b.price && b.price.amount > 0);
    if (!bag) continue;
    const seat = (sv.seats || []).find((x) => x.available && x.price && x.price.amount > 0);
    const other = (sv.others || []).find((x) => x.price && x.price.amount > 0);
    const selected = [{ passengerIndex: 0, serviceId: bag.serviceId, quantity: 1 }, ...(seat ? [{ passengerIndex: 0, serviceId: seat.serviceId, quantity: 1 }] : []),
      ...(other ? [{ passengerIndex: 0, serviceId: other.serviceId, quantity: 1 }] : [])];
    const a = await post({ action: 'services', prebookId: p.d.prebookId, extrasToken: p.d.extrasToken, passengers: 1, selected });
    if (a.status !== 200) { log(`attach refused ${a.status}: ${a.d.error || ''}`); continue; }
    const ok = Number.isFinite(a.d.price) && a.d.price > p.d.price && a.d.currency && a.d.transactionId && a.d.secretKey;
    log(`attach ${ok ? 'PASSED' : 'FAILED'}: ${selected.length} item(s) [${[bag.name, seat && `seat ${seat.number}`, other?.name].filter(Boolean).join(', ')}] · total £${p.d.price} -> £${a.d.price} ${a.d.currency}`);
    if (!ok) process.exit(1);
    done = true; break;
  }
  if (done) break;
}
if (!done) { log('no sandbox fare offered a paid bag to attach; the attach flow was not exercised'); process.exit(3); }
