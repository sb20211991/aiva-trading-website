import { handleAdminProducts } from '../_lib/commerce.js';

export async function onRequest(context) {
  return handleAdminProducts(context.request, context.env);
}
