#!/usr/bin/env node
/* Aiva Translate checks: every language offered in the selector has a complete, verified
   dictionary; every customer-facing page loads the translator; /api/translate validates input. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, NATIVE, RTL } from '../functions/_lib/translate-languages.js';
import { richPlaceholdersValid } from '../functions/_lib/translate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const js = read('assets/language-switcher.js');
const langs = JSON.parse(js.match(/\/\*AIVA_LANGS\*\/([\s\S]*?)\/\*END_AIVA_LANGS\*\//)[1]);
const sourceHash = js.match(/\/\*AIVA_SOURCE\*\/'([0-9a-f]*)'/)[1];
const sourceText = read('i18n/source.json').trim();
const source = JSON.parse(sourceText);
assert.equal(hash(sourceText), sourceHash, 'i18n/source.json changed without rebuilding (run npm run i18n:build)');
assert.ok(source.t.length > 300, 'Source dictionary looks incomplete');
assert.equal(LANGUAGES.length, 49, 'Aiva Translate offers English plus 49 languages');
assert.equal(langs.length, LANGUAGES.length, 'Every catalogue language must be verified and offered');

const report = JSON.parse(read('i18n/verification-report.json'));
for (const [code, native, english, rtl, htmlLang, h] of langs) {
  const body = read(`i18n/${code}.json`).trim();
  assert.equal(hash(body), h, `${code}: dictionary hash mismatch`);
  const dict = JSON.parse(body);
  assert.equal(dict.t.length, source.t.length, `${code}: text entries misaligned`);
  assert.equal(dict.h.length, source.h.length, `${code}: rich entries misaligned`);
  dict.t.forEach((v, i) => assert.ok(typeof v === 'string' && v.trim(), `${code}: missing translation for "${source.t[i]}"`));
  dict.h.forEach((v, i) => assert.ok(richPlaceholdersValid(source.h[i], v), `${code}: broken markup in "${source.h[i]}"`));
  assert.equal(native, NATIVE[code], `${code}: native name`);
  assert.equal(rtl, RTL.has(code) ? 1 : 0, `${code}: direction`);
  assert.ok(htmlLang, `${code}: html lang`);
  assert.equal(report.languages[code]?.ok, true, `${code}: failed verification`);
  assert.ok(english);
}
for (const required of ['ckb', 'ku', 'ar', 'zh-CN', 'yue', 'hi', 'ur', 'bn', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'tr',
  'fa', 'ja', 'ko', 'pl', 'uk', 'nl', 'el', 'sv', 'ro', 'iw', 'th', 'vi', 'id', 'ms', 'sw', 'am', 'ha', 'yo', 'ig', 'zu']) {
  assert.ok(langs.some((l) => l[0] === required), 'Priority language missing: ' + required);
}
const files = readdirSync(path.join(root, 'i18n')).filter((f) => /^[a-z]{2,3}(-[A-Z]{2})?\.json$/.test(f));
assert.deepEqual(files.map((f) => f.replace('.json', '')).sort(), langs.map((l) => l[0]).sort(), 'Unexpected dictionaries in i18n/');

const version = /language-switcher\.js\?v=([\w-]+)/;
const pages = readdirSync(root).filter((f) => /^[a-z0-9-]+\.html$/.test(f));
for (const page of pages) {
  const html = read(page);
  assert.match(html, version, `${page}: Aiva Translate script missing`);
  assert.match(html, /language-switcher\.css\?v=/, `${page}: Aiva Translate styles missing`);
  assert.match(html, /aiva-tx-pending/, `${page}: saved-language pre-render hint missing`);
  assert.doesNotMatch(html, /translate\.google\.com|aiva-language-switcher/, `${page}: legacy external translation redirect`);
  if (page !== '404.html') assert.match(html, /data-aiva-translate/, `${page}: Aiva Translate selector missing`);
}
assert.doesNotMatch(js, /translate\.google|location\.assign/, 'Translator must keep visitors on aivatrading.uk');

/* /api/translate: validation and engine call with a mocked upstream (no network). */
const { onRequestPost } = await import('../functions/api/translate.js');
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push(String(url));
  const qs = new URLSearchParams(String(init.body)).getAll('q');
  return new Response(JSON.stringify(qs.map((q) => 'ZZ:' + q)), { headers: { 'Content-Type': 'application/json' } });
};
const post = (body, origin = 'https://aivatrading.uk') => onRequestPost({
  request: new Request('https://aivatrading.uk/api/translate', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  waitUntil() {}
});
let res = await post({ target: 'ckb', text: ['New product'], html: ['See <a i=0>details</a> now'] });
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), { text: ['ZZ:New product'], html: ['ZZ:See <a i=0>details</a> now'] });
assert.match(calls[0], /tl=ckb&format=text/);
assert.equal((await post({ target: 'xx', text: ['Hi'] })).status, 400, 'unknown language rejected');
assert.equal((await post({ target: 'fr', text: ['x'.repeat(3001)] })).status, 400, 'oversized string rejected');
assert.equal((await post({ target: 'fr', text: Array(61).fill('Hi') })).status, 400, 'too many strings rejected');
assert.equal((await post({ target: 'fr', text: ['Hi'] }, 'https://evil.example')).status, 403, 'foreign origin rejected');
console.log(`Aiva Translate checks passed: ${langs.length + 1} languages, ${source.t.length + source.h.length} segments, ${pages.length} pages.`);
