import { handleSquareWebhook } from '../_lib/commerce.js';

export async function onRequestPost(context) {
  return handleSquareWebhook(context.request, context.env);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  return handleSquareWebhook(context.request, context.env);
}
