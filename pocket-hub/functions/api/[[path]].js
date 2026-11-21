/* Any other /api/* request on app.aivatrading.uk belongs to the Aiva Trading website
   (for example the Square webhook registered at https://app.aivatrading.uk/api/square-webhook).
   Forward it unchanged to the website's Pages project so those integrations keep working. */
export async function onRequest({ request, env }) {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, env.WEBSITE_ORIGIN || 'https://aiva-trading.pages.dev');
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('X-Forwarded-Host', incoming.host);
  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  return fetch(target, init);
}
