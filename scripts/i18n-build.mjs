#!/usr/bin/env node
/* Aiva Translate dictionary build (run manually when customer-facing text changes):
 *   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs node scripts/i18n-build.mjs
 * 1. Renders every customer-facing page in Chromium (local preview server, mocked APIs) and
 *    collects each translatable segment with the same segmentation code the site uses.
 * 2. Adds visible product data and user-facing strings written by page scripts.
 * 3. Translates new segments into each language (existing translations are reused).
 * 4. Verifies every language (complete, really translated, correct script, engine language
 *    detection) and embeds only verified languages into assets/language-switcher.js.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, NATIVE, RTL, HTML_LANG, POPULAR, SCRIPT } from '../functions/_lib/translate-languages.js';
import { translateStrings, richPlaceholdersValid } from '../functions/_lib/translate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'i18n');
const PORT = 8791;
const only = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/* ---------- 1. Collect segments from rendered pages ---------- */
async function collectPages() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const server = spawn(process.execPath, ['scripts/local-shop-preview.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/index.html`); break; } catch { await sleep(200); } }
    const browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'en-GB' });
    const pages = readdirSync(root).filter((f) => /^[a-z0-9-]+\.html$/.test(f)).sort();
    const segments = { t: new Set(), h: new Set() };
    for (const file of pages) {
      await page.goto(`http://127.0.0.1:${PORT}/${file}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.AivaTranslate && window.AivaTranslate.ready);
      await page.evaluate(() => window.AivaTranslate.ready);
      const got = await page.evaluate(() => window.AivaTranslate.collect());
      got.t.forEach((s) => segments.t.add(s));
      got.h.forEach((s) => segments.h.add(s));
      console.log(`collected ${file}: ${got.t.length} text, ${got.h.length} rich`);
    }
    await browser.close();
    return segments;
  } finally { server.kill(); }
}

/* ---------- 2. Strings that page scripts and product data insert later ---------- */
function scriptStrings() {
  const files = ['aiva-commerce.js', 'aiva-guide-checkout.js', 'aiva-order.js', 'upgrade-v19.js', 'voice-music.js', 'app-v20.js', 'shop.js', 'aiva-money.js'];
  const out = new Set();
  for (const f of files) {
    const src = readFileSync(path.join(root, 'assets', f), 'utf8');
    for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
      if (m[2].includes('${')) continue;
      let s = norm(m[2].replace(/\\(['"`\\])/g, '$1').replace(/\\u2026/g, '…').replace(/\\u00a3/gi, '£'));
      s = s.replace(/[:\s]+$/, (x) => (x.includes(':') ? ':' : ''));
      if (s.length < 4 || s.length > 400 || !/^[A-Z£0-9“"(]/.test(s) || !/[a-z]{2}/.test(s) || !/\s/.test(s)) continue;
      if (/[<>{}=;\\|]|^\w+\(|https?:|\.(js|css|html|json)\b|^[A-Z_]+$/.test(s)) continue;
      out.add(s);
    }
  }
  const catalogue = readJSON(path.join(root, 'data/aiva-products.json'), {});
  for (const s of [catalogue.deliveryPolicy, catalogue.returnsPolicy, ...(catalogue.categories || [])]) if (s) out.add(norm(s));
  for (const p of catalogue.products || []) if (!p.hidden) [p.name, p.description, p.category].forEach((s) => s && out.add(norm(s)));
  return out;
}

/* ---------- 3. Translate ---------- */
async function withRetry(fn, label) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt >= 6) throw e;
      const wait = (e.status === 429 ? 20000 : 3000) * (attempt + 1);
      console.warn(`${label}: ${e.message}; retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}
async function translateRich(code, items) {
  const out = await withRetry(() => translateStrings(code, items, { html: true }), code + ' rich');
  for (let i = 0; i < items.length; i++) {
    if (richPlaceholdersValid(items[i], out[i])) continue;
    const [again] = await withRetry(() => translateStrings(code, [items[i]], { html: true }), code + ' rich retry');
    if (richPlaceholdersValid(items[i], again)) { out[i] = again; continue; }
    // Fall back to translating each piece of text separately while keeping the inline markup.
    const parts = items[i].split(/(<(?:a|b) i=\d+>|<\/(?:a|b)>|<br i=\d+>)/);
    const textIdx = parts.map((p, n) => (n % 2 === 0 && /\p{L}/u.test(p) ? n : -1)).filter((n) => n >= 0);
    const tr = await withRetry(() => translateStrings(code, textIdx.map((n) => parts[n].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))), code + ' rich parts');
    textIdx.forEach((n, k) => {
      const lead = parts[n].match(/^\s*/)[0], trail = parts[n].match(/\s*$/)[0];
      parts[n] = lead + String(tr[k] || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + trail;
    });
    out[i] = parts.join('');
    console.warn(`${code}: rich segment ${i} translated piecewise`);
  }
  return out;
}

/* ---------- 4. Verify ---------- */
const DETECT_OK = { iw: ['iw', 'he'], 'zh-CN': ['zh-CN', 'zh'], 'zh-TW': ['zh-TW', 'zh-CN', 'zh'], yue: ['yue', 'zh-TW', 'zh-CN', 'zh'], tl: ['tl', 'fil'], ms: ['ms', 'id'], ckb: ['ckb'], ku: ['ku'] };
const TRADITIONAL = new Set(['zh-TW', 'yue']);
const SIMPLIFIED_ONLY = /[个产们这证据务关么为价单报质发应选择询购运设备检验动态费条围颁称]/;
async function toTraditional(code, values) {
  const idx = values.map((v, i) => (SIMPLIFIED_ONLY.test(String(v || '')) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return;
  const body = new URLSearchParams();
  for (const i of idx) body.append('q', values[i]);
  const res = await fetch('https://translate.googleapis.com/translate_a/t?client=gtx&sl=zh-CN&tl=zh-TW&format=html', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error('convert HTTP ' + res.status);
  const out = await res.json();
  idx.forEach((i, n) => { const v = Array.isArray(out[n]) ? out[n][0] : out[n]; if (typeof v === 'string' && v.trim()) values[i] = v; });
  console.warn(`${code}: converted ${idx.length} Simplified segments to Traditional`);
}
async function detectLanguage(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error('detect HTTP ' + res.status), { status: res.status });
  return (await res.json())[2];
}
async function verify(code, source, tr) {
  const problems = [];
  const all = [...source.t.map((s, i) => [s, tr.t[i]]), ...source.h.map((s, i) => [s, tr.h[i]])];
  const empty = all.filter(([, v]) => typeof v !== 'string' || !v.trim()).length;
  if (empty) problems.push(`${empty} missing translations`);
  source.h.forEach((s, i) => { if (!richPlaceholdersValid(s, tr.h[i])) problems.push('broken markup in rich segment ' + i); });
  const sentences = all.filter(([s]) => s.split(' ').length >= 4);
  const same = sentences.filter(([s, v]) => norm(v) === s).length;
  const sameRatio = same / Math.max(1, sentences.length);
  if (sameRatio > 0.1) problems.push(`${Math.round(sameRatio * 100)}% of sentences left in English`);
  let scriptRatio = null;
  if (SCRIPT[code]) {
    const re = new RegExp(`(?:${SCRIPT[code].split('|').map((s) => `\\p{Script=${s}}`).join('|')})`, 'u');
    let hit = 0, letters = 0;
    for (const [, v] of all) for (const ch of String(v || '').replace(/<[^>]+>/g, '')) if (/\p{L}/u.test(ch)) { letters++; if (re.test(ch)) hit++; }
    scriptRatio = hit / Math.max(1, letters);
    if (scriptRatio < 0.6) problems.push(`only ${Math.round(scriptRatio * 100)}% of letters in ${SCRIPT[code]} script`);
  }
  const sample = sentences.filter(([s]) => s.split(' ').length >= 8 && !/AIVA|Aiva|Square|£|\d/.test(s)).slice(0, 6)
    .map(([, v]) => String(v || '').replace(/<[^>]+>/g, '')).join(' ').slice(0, 1200);
  let detected = await withRetry(() => detectLanguage(sample), code + ' detect');
  if (TRADITIONAL.has(code)) {
    // Auto-detect does not label Traditional Chinese reliably; check the script directly instead.
    const leaks = all.filter(([, v]) => SIMPLIFIED_ONLY.test(String(v || ''))).length;
    if (leaks) problems.push(`${leaks} segments contain Simplified-only characters`);
    else if (scriptRatio >= 0.6) detected = code;
  }
  if (!(DETECT_OK[code] || [code]).includes(detected)) problems.push(`engine detects "${detected}" instead of "${code}"`);
  return { code, segments: all.length, sameRatio: +sameRatio.toFixed(3), scriptRatio: scriptRatio && +scriptRatio.toFixed(3), detected, ok: problems.length === 0, problems };
}

/* ---------- Main ---------- */
const collected = await collectPages();
for (const s of scriptStrings()) collected.t.add(s);
const source = { t: [...collected.t].sort(), h: [...collected.h].sort() };
const oldSource = readJSON(path.join(dir, 'source.json'), { t: [], h: [] });
const sourceText = JSON.stringify(source);
writeFileSync(path.join(dir, 'source.json'), sourceText + '\n');
const sourceHash = hash(sourceText);
console.log(`source: ${source.t.length} text + ${source.h.length} rich segments, ${sourceText.length} chars`);

const report = readJSON(path.join(dir, 'verification-report.json'), { languages: {} });
const manifest = [];
const queue = LANGUAGES.filter(([code]) => !only.length || only.includes(code));
async function processLanguage([code, english]) {
  const file = path.join(dir, code + '.json');
  const prev = readJSON(file, null);
  const known = new Map();
  if (prev) for (const k of ['t', 'h']) oldSource[k].forEach((s, i) => prev[k]?.[i] && known.set(k + s, prev[k][i]));
  const tr = { t: source.t.map((s) => known.get('t' + s) || null), h: source.h.map((s) => known.get('h' + s) || null) };
  const missT = source.t.map((s, i) => (tr.t[i] ? -1 : i)).filter((i) => i >= 0);
  const missH = source.h.map((s, i) => (tr.h[i] ? -1 : i)).filter((i) => i >= 0);
  if (missT.length) {
    const got = await withRetry(() => translateStrings(code, missT.map((i) => source.t[i])), code);
    missT.forEach((i, n) => { tr.t[i] = got[n]; });
  }
  if (missH.length) {
    const got = await translateRich(code, missH.map((i) => source.h[i]));
    missH.forEach((i, n) => { tr.h[i] = got[n]; });
  }
  if (TRADITIONAL.has(code)) { await toTraditional(code, tr.t); await toTraditional(code, tr.h); }
  const result = await verify(code, source, tr);
  report.languages[code] = { english, native: NATIVE[code], ...result };
  const body = JSON.stringify({ t: tr.t, h: tr.h });
  writeFileSync(file, body + '\n');
  console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${code} (${english}) translated ${missT.length + missH.length} new; same=${result.sameRatio} script=${result.scriptRatio} detected=${result.detected} ${result.problems.join('; ')}`);
  return { code, english, hash: hash(body), ok: result.ok };
}
const results = [];
const workers = Array.from({ length: 4 }, async () => {
  while (queue.length) results.push(await processLanguage(queue.shift()));
});
await Promise.all(workers);

// Embed every verified language (including ones not rebuilt this run) into the runtime script.
for (const [code, english] of LANGUAGES) {
  const r = report.languages[code];
  const f = path.join(dir, code + '.json');
  if (!r || !r.ok || !existsSync(f)) continue;
  const body = readFileSync(f, 'utf8').trim();
  const parsed = JSON.parse(body);
  if (parsed.t.length !== source.t.length || parsed.h.length !== source.h.length) continue;
  manifest.push([code, NATIVE[code], english, RTL.has(code) ? 1 : 0, HTML_LANG[code] || code, hash(body)]);
}
report.generated = new Date().toISOString().slice(0, 10);
report.sourceSegments = source.t.length + source.h.length;
report.verified = manifest.map((l) => l[0]);
report.failed = LANGUAGES.map(([c]) => c).filter((c) => !report.verified.includes(c));
writeFileSync(path.join(dir, 'verification-report.json'), JSON.stringify(report, null, 1) + '\n');

const jsPath = path.join(root, 'assets/language-switcher.js');
let js = readFileSync(jsPath, 'utf8');
js = js.replace(/\/\*AIVA_LANGS\*\/[\s\S]*?\/\*END_AIVA_LANGS\*\//, '/*AIVA_LANGS*/' + JSON.stringify(manifest) + '/*END_AIVA_LANGS*/')
  .replace(/\/\*AIVA_SOURCE\*\/[\s\S]*?\/\*END_AIVA_SOURCE\*\//, `/*AIVA_SOURCE*/'${sourceHash}'/*END_AIVA_SOURCE*/`)
  .replace(/\/\*AIVA_POPULAR\*\/[\s\S]*?\/\*END_AIVA_POPULAR\*\//, '/*AIVA_POPULAR*/' + JSON.stringify(POPULAR) + '/*END_AIVA_POPULAR*/');
writeFileSync(jsPath, js);
console.log(`\nVerified languages embedded: ${manifest.length} + English = ${manifest.length + 1}`);
if (report.failed.length) console.log('Not offered (failed verification): ' + report.failed.join(', '));
