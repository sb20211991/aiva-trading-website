/* Aiva Translate engine client, shared by /api/translate and scripts/i18n-build.mjs.
   Plain strings use format=text; rich strings carry <a i=N>/<b i=N>/<br i=N> placeholders
   for inline markup and use format=html so the placeholders survive translation. */
import { LANGUAGES } from './translate-languages.js';

export const TARGETS = new Set(LANGUAGES.map(([code]) => code));
const ENDPOINT = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=en';
const CHUNK_CHARS = 4500;

function chunks(items) {
  const out = [];
  let cur = [], size = 0;
  for (const item of items) {
    if (cur.length && (size + item.length > CHUNK_CHARS || cur.length >= 100)) { out.push(cur); cur = []; size = 0; }
    cur.push(item); size += item.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function request(target, format, batch, fetcher) {
  const body = new URLSearchParams();
  for (const q of batch) body.append('q', q);
  const res = await fetcher(`${ENDPOINT}&tl=${encodeURIComponent(target)}&format=${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body
  });
  if (!res.ok) throw Object.assign(new Error('Translation engine HTTP ' + res.status), { status: res.status });
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];
  if (list.length !== batch.length) throw new Error('Translation engine returned ' + list.length + ' of ' + batch.length);
  return list.map((v) => (Array.isArray(v) ? v[0] : v)).map((v) => (typeof v === 'string' ? v : null));
}

/** Translate English strings into `target`. Returns an array aligned with `items` (null on failure). */
export async function translateStrings(target, items, { html = false, fetcher = fetch } = {}) {
  if (!TARGETS.has(target)) throw new Error('Unsupported language: ' + target);
  const out = [];
  for (const batch of chunks(items)) out.push(...await request(target, html ? 'html' : 'text', batch, fetcher));
  return html ? out.map(tidyRich) : out;
}

/** The engine sometimes inserts a space between a closing tag and following punctuation. */
export function tidyRich(value) {
  return typeof value === 'string' ? value.replace(/(<\/(?:a|b)>) +([.,;:!?)\u3001\u3002\uff0c\uff1a\u060c\u061f])/g, '$1$2') : value;
}

/** Rich translations must keep every placeholder exactly once. */
export function richPlaceholdersValid(source, translated) {
  if (typeof translated !== 'string') return false;
  const ids = (s) => [...s.matchAll(/<(a|b|br) i=(\d+)>/g)].map((m) => m[1] + m[2]).sort().join(',');
  const closes = (s) => (s.match(/<\/(a|b)>/g) || []).length;
  return ids(source) === ids(translated) && closes(source) === closes(translated);
}
