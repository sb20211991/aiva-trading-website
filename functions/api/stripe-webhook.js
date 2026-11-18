import { handleStripeWebhook } from '../_lib/commerce.js';

/** Signed Stripe events. Defaults to test; live requires explicit, separate configuration. */
export async function onRequestPost(context) {
  return handleStripeWebhook(context.request, context.env);
}

export async function onRequest(context) {
  return handleStripeWebhook(context.request, context.env);
}
