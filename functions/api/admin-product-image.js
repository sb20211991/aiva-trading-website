import { handleAdminProductImage } from '../_lib/commerce.js';

export async function onRequest(context) {
  return handleAdminProductImage(context.request, context.env);
}
