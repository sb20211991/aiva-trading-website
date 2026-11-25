/* Aiva Ferry sales gate. Offline: no distributor is contacted. */
import assert from 'node:assert/strict';
import { salesStatus, FERRY_DISTRIBUTORS } from '../functions/_lib/ferry-sales.js';

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
console.log('FERRY SALES GATE CHECKS PASSED');
