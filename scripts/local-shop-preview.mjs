#!/usr/bin/env node
/**
 * Local shop preview with mocked Square APIs.
 * Does NOT touch aivatrading.uk and does NOT charge real money.
 *
 *   node website/scripts/local-shop-preview.mjs
 *   open http://127.0.0.1:8787/shop.html
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const catalogue = JSON.parse(await readFile(path.join(ROOT, 'data/aiva-products.json'), 'utf8'));
const commerceUrl = pathToFileURL(path.join(ROOT, 'functions/_lib/commerce.js')).href;
const {
  handleShopStatus,
  handleCreateCheckout,
  handleOrderStatus,
  handleStripeWebhook
} = await import(commerceUrl);

const paidOrders = new Map();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

const env = {
  SQUARE_ACCESS_TOKEN: 'sandbox-token',
  SQUARE_LOCATION_ID: 'LOC_LOCAL_PREVIEW',
  SQUARE_ENVIRONMENT: 'sandbox',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'local-preview-webhook-signature-key',
  SQUARE_WEBHOOK_NOTIFICATION_URL: `http://${HOST}:${PORT}/api/square-webhook`,
  MERCHANT_REFUND_SECRET: 'local-preview-merchant-refund-secret-32',
  ORDERS_DB: null,
  ASSETS: {
    async fetch() {
      return new Response(JSON.stringify(catalogue), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes('squareupsandbox.com') && url.includes('/payment-links') && !url.match(/payment-links\/[^/]+$/)) {
    const orderId = 'LOCAL_ORDER_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    paidOrders.set(orderId, { paid: false });
    return new Response(
      JSON.stringify({
        payment_link: {
          id: 'PK_LOCAL_' + orderId.slice(-8),
          order_id: orderId,
          /* Trusted Square host so commerce.js accepts it; preview server rewrites to local success. */
          url: `https://checkout.square.site/merchant/ML_LOCAL_PREVIEW/checkout/${orderId}`
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (url.includes('squareupsandbox.com') && /\/v2\/orders\//.test(url)) {
    const orderId = decodeURIComponent(url.split('/v2/orders/')[1].split(/[?#]/)[0]);
    const known = paidOrders.get(orderId);
    return new Response(
      JSON.stringify({
        order: {
          id: orderId,
          state: known ? 'COMPLETED' : 'OPEN',
          metadata: { source: 'aivatrading.uk' },
          tenders: known ? [{ amount_money: { amount: 100, currency: 'GBP' } }] : [],
          total_money: { amount: 100, currency: 'GBP' }
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return originalFetch(input, init);
};

async function readPublic(rel) {
  const parts = rel.split('/');
  if (!rel || parts.some((part) => !part || part === '.' || part === '..')) return null;
  const ext = path.posix.extname(parts.at(-1)).toLowerCase() || '.html';
  if (!Object.hasOwn(MIME, ext) && !rel.endsWith('.html')) return null;
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  try {
    const info = await stat(abs);
    if (!info.isFile()) return null;
    return { body: await readFile(abs), type: MIME[ext] || 'application/octet-stream' };
  } catch {
    return null;
  }
}

function toRequest(req, body) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  return new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/shop') pathname = '/shop.html';

    if (pathname.startsWith('/api/')) {
      const raw = await readBody(req);
      const request = toRequest(req, raw.length ? raw : undefined);
      let response;
      if (pathname === '/api/shop-status') response = await handleShopStatus(request, env);
      else if (pathname === '/api/create-checkout-session') {
        response = await handleCreateCheckout(request, env);
        if (response.ok) {
          const data = await response.json();
          if (data.orderId) paidOrders.set(data.orderId, { paid: true });
          const localSuccess =
            `http://${HOST}:${PORT}/order-success.html?orderId=` +
            encodeURIComponent(data.orderId || '') +
            '&preview=1';
          response = new Response(
            JSON.stringify({ ...data, url: localSuccess, preview: true }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
            }
          );
        }
      } else if (pathname === '/api/order-status') response = await handleOrderStatus(request, env);
      else if (pathname === '/api/stripe-webhook') response = await handleStripeWebhook(request, env);
      else {
        response = new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      const buf = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(buf);
      return;
    }

    const file = await readPublic(pathname.replace(/^\//, ''));
    if (!file) {
      const missing = await readPublic('404.html');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(missing?.body || 'Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-store' });
    res.end(file.body);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Local preview error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local shop preview (mock Square) http://${HOST}:${PORT}/shop.html`);
  console.log('Does not change aivatrading.uk. Ctrl+C to stop.');
});
