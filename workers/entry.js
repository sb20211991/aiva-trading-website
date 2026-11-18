// Adapt the existing, tested Pages handlers. Do not create a second payment engine.
import * as shop from '../functions/api/shop-status.js';
import * as checkout from '../functions/api/create-checkout-session.js';
import * as order from '../functions/api/order-status.js';
import * as stripe from '../functions/api/stripe-webhook.js';
import * as square from '../functions/api/square-webhook.js';
import * as refund from '../functions/api/create-refund.js';
import { withSecurityHeaders } from '../functions/_lib/security-headers.js';

const routes = {
  '/api/shop-status': { module: shop, allow: 'GET, HEAD' },
  '/api/create-checkout-session': { module: checkout, allow: 'POST' },
  '/api/order-status': { module: order, allow: 'GET, HEAD' },
  '/api/stripe-webhook': { module: stripe, allow: 'POST' },
  '/api/square-webhook': { module: square, allow: 'POST' },
  '/api/create-refund': { module: refund, allow: 'POST' }
};

export default {
  async fetch(request, env, executionContext) {
    const path = new URL(request.url).pathname;
    let response;
    try {
      const route = routes[path];
      if (route) {
        const method = request.method === 'HEAD' ? 'GET' : request.method;
        if (!route.allow.split(', ').includes(request.method)) {
          response = Response.json({ error: 'Method not allowed.' }, {
            status: 405, headers: { Allow: route.allow }
          });
        } else {
          const handler = route.module['onRequest' + method[0] + method.slice(1).toLowerCase()]
            || route.module.onRequest;
          response = await handler({ request, env, waitUntil: executionContext?.waitUntil?.bind(executionContext) });
        }
      } else if (path === '/merchant-tools' || path.startsWith('/merchant-tools/') || path.startsWith('/api/')) {
        response = Response.json({ error: 'Not found.' }, { status: 404 });
      } else {
        response = await env.ASSETS.fetch(request);
      }
    } catch {
      // Do not expose provider responses, credentials, or customer information.
      response = Response.json({ error: 'Service temporarily unavailable. Please try again.' }, { status: 503 });
    }
    return withSecurityHeaders(response, request);
  }
};
