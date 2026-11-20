import { handlePublicCatalogue } from '../_lib/commerce.js';

export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);
  if (pathname !== '/data/aiva-products.json' || context.request.method !== 'GET') return context.next();
  return handlePublicCatalogue(context.request, context.env);
}
