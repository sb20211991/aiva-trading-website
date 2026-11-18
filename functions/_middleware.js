import { withSecurityHeaders } from './_lib/security-headers.js';

export async function onRequest(context) {
  return withSecurityHeaders(await context.next(), context.request);
}
