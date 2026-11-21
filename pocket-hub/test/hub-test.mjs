/* Pocket Hub offline checks: website API forwarding, static app shell and project isolation. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { onRequest as forward } from '../functions/api/[[path]].js';
import { onRequestPost as hubTranslate } from '../functions/api/hub-translate.js';
import { SOURCES } from '../functions/_lib/languages.js';

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

// In-app translation endpoint: server-side engine call, validation, error handling.
const tReq = (body, origin = 'https://app.aivatrading.uk') => new Request('https://app.aivatrading.uk/api/hub-translate',
  { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Origin: origin, 'content-type': 'application/json' } });
let call;
const engine = (reply, ok = true) => async (url, init) => { call = { url, body: String(init.body) }; return new Response(JSON.stringify(reply), { status: ok ? 200 : 503 }); };
let r = await hubTranslate({ request: tReq({ text: ' Hello ', source: 'auto', target: 'ckb' }) }, engine([['سڵاو', 'en']]));
assert.equal(r.status, 200); assert.deepEqual(await r.json(), { translation: 'سڵاو', detected: 'en' });
assert.match(call.url, /^https:\/\/translate\.googleapis\.com\/translate_a\/t\?client=gtx&sl=auto&tl=ckb&format=text$/);
assert.equal(new URLSearchParams(call.body).get('q'), 'Hello');
r = await hubTranslate({ request: tReq({ text: 'كم السعر؟', source: 'ar', target: 'en' }) }, engine(['How much is the price?']));
assert.deepEqual(await r.json(), { translation: 'How much is the price?', detected: 'ar' });
assert.equal((await hubTranslate({ request: tReq({ text: 'x', source: 'en', target: 'xx' }) }, engine([]))).status, 400);
assert.equal((await hubTranslate({ request: tReq({ text: '   ', target: 'ar' }) }, engine([]))).status, 400);
assert.equal((await hubTranslate({ request: tReq({ text: 'a'.repeat(5001), target: 'ar' }) }, engine([]))).status, 413);
assert.equal((await hubTranslate({ request: tReq('not json') }, engine([]))).status, 400);
assert.equal((await hubTranslate({ request: tReq('x'.repeat(30000)) }, engine([]))).status, 413);
assert.equal((await hubTranslate({ request: tReq({ text: 'hi', target: 'ar' }, 'https://evil.example') }, engine([]))).status, 403);
assert.equal((await hubTranslate({ request: tReq({ text: 'hi', target: 'ar' }) }, engine({}, false))).status, 502);
assert.equal((await hubTranslate({ request: tReq({ text: 'hi', target: 'ar' }) }, async () => { throw new TypeError('down'); })).status, 502);

// The app translates in place (no external translator tab) and offers the same languages as the endpoint.
const app = readFileSync(pub('app.js'), 'utf8');
assert.doesNotMatch(app + html, /translate\.google\.com/);
assert.match(app, /fetch\('\/api\/hub-translate'/);
const appLangs = [...app.match(/const LANG=\[(.*?)\];/)[1].matchAll(/\['([^']+)'/g)].map((m) => m[1]);
assert.deepEqual(appLangs.sort(), [...SOURCES].sort());
for (const id of ['langFrom', 'langTo', 'swapLang', 'sourceText', 'openTranslate', 'speakInput', 'voiceStatus', 'translationOutput']) assert.match(html, new RegExp(`id="${id}"`));
console.log('POCKET HUB CHECKS PASSED');
