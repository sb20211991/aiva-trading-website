import { handleAdminOrders } from '../_lib/commerce.js';

export async function onRequest(context) {
  return handleAdminOrders(context.request, context.env);
}
