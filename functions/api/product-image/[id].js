import { handleProductImage } from '../../_lib/commerce.js';

export async function onRequestGet(context) {
  return handleProductImage(context.request, context.env, context.params.id);
}
