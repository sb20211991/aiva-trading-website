/* Pocket Hub offline checks: website API forwarding, static app shell and project isolation. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { onRequest as forward } from '../functions/api/[[path]].js';

const realFetch = globalThis.fetch;
let seen;
globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return new Response('ok'); };
await forward({ request: new Request('https://app.aivatrading.uk/api/square-webhook?x=1', { method: 'POST', body: '{"a":1}',
  headers: { 'x-square-hmacsha256-signature': 'sig', 'content-type': 'application/json' } }), env: { WEBSITE_ORIGIN: 'https://aiva-trading.pages.dev' } });
assert.equal(seen.url, 'https://aiva-trading.pages.dev/api/square-webhook?x=1');
assert.equal(seen.init.method, 'POST');
assert.equal(new TextDecoder().decode(seen.init.body), '{"a":1}');
assert.equal(seen.init.headers.get('x-square-hmacsha256-signature'), 'sig');
assert.equal(seen.init.headers.get('x-forwarded-host'), 'app.aivatrading.uk');
await forward({ request: new Request('https://app.aivatrading.uk/api/shop-status'), env: {} });
assert.equal(seen.url, 'https://aiva-trading.pages.dev/api/shop-status');
assert.equal(seen.init.body, undefined);
globalThis.fetch = realFetch;

const pub = (f) => new URL('../public/' + f, import.meta.url);
for (const f of ['index.html', 'app.js', 'service-worker.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', '_routes.json', '_headers'])
  assert.ok(existsSync(pub(f)), 'Missing ' + f);
const html = readFileSync(pub('index.html'), 'utf8');
assert.match(html, /<meta name="application-name" content="Aiva"><meta name="apple-mobile-web-app-title" content="Aiva"><title>Aiva<\/title>/);
assert.equal(JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8')).name, 'Aiva');
for (const id of ['home', 'translate', 'trade', 'calculator', 'travel', 'finance', 'emergency', 'settings']) assert.match(html, new RegExp(`id="${id}"`));
assert.deepEqual(JSON.parse(readFileSync(pub('_routes.json'), 'utf8')).include, ['/api/*']);
assert.match(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), /^name = "aiva-pocket-hub"$/m);
console.log('POCKET HUB CHECKS PASSED');
