import { handleStripeWebhook } from '../_lib/commerce.js';

/** Signed Stripe test events only. Live events are rejected. */
export async function onRequestPost(context) {
  return handleStripeWebhook(context.request, context.env);
}

export async function onRequest(context) {
  return handleStripeWebhook(context.request, context.env);
}
