/* Aiva Ferry sales gate. Offline: no distributor is contacted. */
import assert from 'node:assert/strict';
import { salesStatus, FERRY_DISTRIBUTORS, FERRY_REQUIRED_DATA } from '../functions/_lib/ferry-sales.js';

// No contract: unavailable, no price or payment is offered, and both official partner programmes are named.
{
  const s = salesStatus({});
  assert.equal(s.available, false);
  assert.deepEqual(s.paymentMethods, []);
  assert.deepEqual(s.distributors.map((d) => d.name), ['Ferryhopper', 'Direct Ferries Connect']);
}
// Half-configured or non-https gateways stay unavailable.
assert.equal(salesStatus({ FERRY_SALES_GATEWAY_URL: 'https://gw.example' }).available, false);
assert.equal(salesStatus({ FERRY_SALES_GATEWAY_URL: 'http://gw.example', FERRY_SALES_GATEWAY_KEY: 'k' }).available, false);
// Full contract configuration is available, with the distributor name taken from config.
{
  const s = salesStatus({ FERRY_SALES_GATEWAY_URL: 'https://gw.example', FERRY_SALES_GATEWAY_KEY: 'k', FERRY_SALES_PROVIDER: 'Ferryhopper' });
  assert.equal(s.available, true);
  assert.equal(s.provider, 'Ferryhopper');
}
assert.equal(FERRY_DISTRIBUTORS.length, 2);
assert.ok(FERRY_REQUIRED_DATA.includes('luggage and baggage allowance'));
assert.deepEqual(salesStatus({}).requiredData, FERRY_REQUIRED_DATA);
// A sailing date without a clock time plans from 08:00 local that day, not from now.
{
  const { onRequestGet } = await import('../functions/api/travel/transfers.js');
  const day = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), bodies = [];
  const f = async (url, init) => { if (String(url).includes('routes')) bodies.push(String(init?.body || '')); return new Response('{}', { status: 500 }); };
  await onRequestGet({ request: new Request(`https://app.aivatrading.uk/api/travel/transfers?from=51.0,1.3&to=50.95,1.85&day=${day}&tz=Europe/London`), env: { GOOGLE_MAPS_API_KEY: 'k' } }, f);
  const times = bodies.map((b) => (b.match(/"departureTime":"([^"]+)"/) || [])[1]).filter(Boolean);
  assert.ok(times.includes(`${day}T08:00:00.000Z`), times.join(','));
}
console.log('FERRY SALES GATE CHECKS PASSED');
