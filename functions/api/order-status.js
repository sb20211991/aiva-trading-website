import { handleOrderStatus } from '../_lib/commerce.js';

export async function onRequestGet(context) {
  return handleOrderStatus(context.request, context.env);
}
