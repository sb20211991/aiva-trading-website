import { handleShopifyWebhook } from '../_lib/commerce.js';

export async function onRequest(context) {
  return handleShopifyWebhook(context.request, context.env);
}
