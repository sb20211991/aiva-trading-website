/* POST /api/translate — translates strings that are not in the static /i18n/ dictionaries
   (for example newly added products). Results are cached at the edge per language and string. */
import { readLimitedText, BodyTooLarge } from '../_lib/body.js';
import { TARGETS, translateStrings, richPlaceholdersValid } from '../_lib/translate.js';

const MAX_BODY = 64 * 1024, MAX_ITEMS = 60, MAX_ITEM_CHARS = 3000, MAX_TOTAL_CHARS = 12000;
const CACHE_SECONDS = 30 * 24 * 3600;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (hostname === new URL(request.url).hostname) return true;
    if (protocol === 'https:' && /^(?:(?:www|app)\.)?aivatrading\.uk$|\.aiva-trading\.pages\.dev$|^aiva-trading\.pages\.dev$/.test(hostname)) return true;
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch { return false; }
}

async function digest(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, waitUntil }) {
  if (!allowedOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
  let body;
  try { body = JSON.parse(await readLimitedText(request, MAX_BODY)); } catch (e) {
    return json({ error: e instanceof BodyTooLarge ? 'Request too large' : 'Invalid JSON' }, e instanceof BodyTooLarge ? 413 : 400);
  }
  const target = body?.target;
  const text = Array.isArray(body?.text) ? body.text : [];
  const html = Array.isArray(body?.html) ? body.html : [];
  if (!TARGETS.has(target)) return json({ error: 'Unsupported language' }, 400);
  const all = [...text, ...html];
  if (all.length > MAX_ITEMS || all.some((s) => typeof s !== 'string' || !s.trim() || s.length > MAX_ITEM_CHARS)
    || all.reduce((n, s) => n + s.length, 0) > MAX_TOTAL_CHARS) return json({ error: 'Invalid strings' }, 400);

  const cache = globalThis.caches?.default;
  const origin = new URL(request.url).origin;
  const result = { text: text.map(() => null), html: html.map(() => null) };
  for (const kind of ['text', 'html']) {
    const items = kind === 'text' ? text : html;
    const keys = await Promise.all(items.map(async (s) => new Request(`${origin}/__aiva-translate/v1/${target}/${kind}/${await digest(s)}`)));
    const misses = [];
    await Promise.all(items.map(async (s, i) => {
      const hit = cache ? await cache.match(keys[i]).catch(() => null) : null;
      if (hit) result[kind][i] = await hit.text(); else misses.push(i);
    }));
    if (!misses.length) continue;
    let translated;
    try { translated = await translateStrings(target, misses.map((i) => items[i]), { html: kind === 'html' }); } catch { continue; }
    misses.forEach((i, n) => {
      const value = translated[n];
      if (!value || (kind === 'html' && !richPlaceholdersValid(items[i], value))) return;
      result[kind][i] = value;
      if (cache) waitUntil?.(cache.put(keys[i], new Response(value, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` }
      })).catch(() => {}));
    });
  }
  return json(result);
}

export function onRequest() {
  return json({ error: 'Method not allowed' }, 405);
}
