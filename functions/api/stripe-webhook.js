import { handleStripeWebhook } from '../_lib/commerce.js';

/** Legacy path kept so old Stripe webhook bookmarks return a clear retired response. */
export async function onRequestPost(context) {
  return handleStripeWebhook(context.request, context.env);
}

export async function onRequest(context) {
  return handleStripeWebhook(context.request, context.env);
}
