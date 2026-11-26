// Transitous (MOTIS) journey planner: one quick retry on a transient failure, never on a real answer.
import assert from 'node:assert/strict';
import { planWithRetry, transientError } from '../functions/_lib/motis.js';

const ok = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const noWait = async () => {};
let calls = 0;

// Timeout / dropped connection, then success: the journey still arrives.
calls = 0;
let d = await planWithRetry('https://api.transitous.org/api/v1/plan?x', async () => { if (calls++ === 0) throw new DOMException('timed out', 'TimeoutError'); return ok({ itineraries: [1] }); }, noWait);
assert.deepEqual([calls, d.itineraries.length], [2, 1]);

// 503 then success.
calls = 0;
d = await planWithRetry('u', async () => (calls++ === 0 ? new Response('', { status: 503 }) : ok({ itineraries: [] })), noWait);
assert.equal(calls, 2);

// A real 4xx answer is not retried, and two failures in a row are still reported.
calls = 0;
await assert.rejects(planWithRetry('u', async () => { calls++; return new Response('', { status: 400 }); }, noWait), (e) => e.status === 400);
assert.equal(calls, 1);
calls = 0;
await assert.rejects(planWithRetry('u', async () => { calls++; throw new TypeError('network'); }, noWait));
assert.equal(calls, 2);
assert.equal(transientError({ status: 429 }), true); assert.equal(transientError({ status: 404 }), false); assert.equal(transientError(new Error('x')), true);
console.log('transit-retry-test: all passed');
