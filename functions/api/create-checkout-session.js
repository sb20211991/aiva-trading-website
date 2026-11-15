import { handleCreateCheckout } from '../_lib/commerce.js';

export async function onRequestPost(context) {
  return handleCreateCheckout(context.request, context.env);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  return handleCreateCheckout(context.request, context.env);
}
