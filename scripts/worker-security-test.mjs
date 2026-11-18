import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../workers/entry.js';
import { securityHeaders } from '../functions/_lib/security-headers.js';
import { onRequest as pagesMiddleware } from '../functions/_middleware.js';

const catalogue = JSON.parse(readFileSync('data/aiva-products.json', 'utf8'));
let assetReads = 0;
const env = { CHECKOUT_PROVIDER: 'stripe', STRIPE_MODE: 'test', STRIPE_LIVE_PAYMENTS_APPROVED: 'false',
  ASSETS: { async fetch(request) {
    assetReads++;
    return new URL(request.url).pathname.startsWith('/data/')
      ? Response.json(catalogue) : new Response('Existing website asset');
  } }
};
for (const [path, method, expected] of [
  ['/api/shop-status', 'GET', 200], ['/api/shop-status', 'HEAD', 200],
  ['/api/shop-status', 'POST', 405], ['/api/create-checkout-session', 'GET', 405],
  ['/api/create-checkout-session', 'POST', 503], ['/api/stripe-webhook', 'GET', 405],
  ['/api/stripe-webhook', 'POST', 503], ['/api/create-refund', 'POST', 401],
  ['/api/order-status', 'POST', 405], ['/api/unknown', 'GET', 404]
]) {
  const request = new Request('https://aivatrading.uk' + path, { method,
    ...(method === 'POST' ? { body: '{}', headers: { 'Content-Type': 'application/json' } } : {}) });
  const result = await worker.fetch(request, env);
  assert.equal(result.status, expected, path + ' ' + method);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  for (const [header, value] of Object.entries(securityHeaders)) assert.equal(result.headers.get(header), value);
  if (method === 'HEAD') assert.equal(await result.text(), '');
  if (path === '/api/shop-status' && method === 'GET') {
    const status = await result.json();
    assert.equal(status.ready, false); assert.equal(status.livePaymentsApproved, false);
  }
}
for (const path of ['/merchant-tools', '/merchant-tools/catalogue-builder.html', '/merchant-tools/refunds.html']) {
  const before = assetReads;
  assert.equal((await worker.fetch(new Request('https://aivatrading.uk' + path), env)).status, 404);
  assert.equal(assetReads, before, 'Administration must not fall through to public assets.');
}
const homepage = await worker.fetch(new Request('https://aivatrading.uk/'), env);
assert.equal(await homepage.text(), 'Existing website asset');
const middleware = await pagesMiddleware({ request: new Request('https://aivatrading.uk/api/shop-status'),
  next: async () => new Response('{}') });
assert.equal(middleware.headers.get('X-Frame-Options'), 'DENY');
assert.equal(middleware.headers.get('Cache-Control'), 'no-store');
const headersFile = readFileSync('_headers', 'utf8');
for (const [name, value] of Object.entries(securityHeaders)) {
  assert.ok(headersFile.includes('  ' + name + ': ' + value), 'Pages/static header drift: ' + name);
}
console.log('WORKER AND SECURITY CHECKS PASSED: existing handlers reused; merchant tools denied; headers agree across both runtimes.');
