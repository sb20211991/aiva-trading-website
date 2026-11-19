import { handleShopStatus } from '../_lib/commerce.js';

export async function onRequestGet(context) {
  return handleShopStatus(context.request, context.env);
}
