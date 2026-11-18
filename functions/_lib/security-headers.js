// Shared by the existing Pages Functions and the existing Worker's adapter.
// Inline scripts/styles are retained for compatibility with the original site.
export const securityHeaders = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; form-action 'self' mailto:",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), usb=(), microphone=(self), payment=(self)',
  'Strict-Transport-Security': 'max-age=86400',
  'X-Permitted-Cross-Domain-Policies': 'none'
});

export function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (name === 'Referrer-Policy' && headers.get(name) === 'no-referrer') continue;
    headers.set(name, value);
  }
  if (new URL(request.url).pathname.startsWith('/api/')) headers.set('Cache-Control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status, statusText: response.statusText, headers
  });
}
