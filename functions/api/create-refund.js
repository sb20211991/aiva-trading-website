import { handleCreateRefund } from '../_lib/commerce.js';

export async function onRequestPost(context) {
  return handleCreateRefund(context.request, context.env);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  return handleCreateRefund(context.request, context.env);
}
