/* POST /api/rail/order
   {action:'order', quoteId, passengers:[{firstName,lastName,email}], paymentToken}
   Completes an in-app rail purchase through the authorised distributor that quoted the fare and took the
   payment in its own session (card, Apple Pay or Google Pay where the distributor supports them). The
   reply is the digital ticket Aiva renders, including the distributor's barcode / QR payload.
   With no distributor contract in place the endpoint refuses honestly: nothing is sold, charged or invented. */
import { json } from '../../_lib/emergency.js';
import { salesStatus, createOrder, sameOrigin } from '../../_lib/rail-sales.js';

const email = (s) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s || '');
const clean = (s, n = 80) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export async function onRequestPost({ request, env }, fetcher = fetch) {
  if (!sameOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
  const sales = salesStatus(env);
  if (!sales.available) {
    return json({ error: 'Rail ticket sales are not enabled in Aiva yet: no authorised rail distributor is connected, so nothing was sold or charged.',
      restriction: sales }, 503);
  }
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 12000)); } catch { return json({ error: 'Invalid request' }, 400); }
  if (body?.action !== 'order') return json({ error: 'Unknown action' }, 400);
  const quoteId = clean(body.quoteId, 200), paymentToken = clean(body.paymentToken, 400);
  const passengers = (Array.isArray(body.passengers) ? body.passengers : []).map((p) => ({
    firstName: clean(p?.firstName, 40), lastName: clean(p?.lastName, 40), email: clean(p?.email, 190)
  }));
  if (!quoteId || !paymentToken) return json({ error: 'The fare quote or the payment session is missing. Please choose the journey again.' }, 400);
  if (!passengers.length || passengers.some((p) => !p.firstName || !p.lastName || !email(p.email))) {
    return json({ error: 'Enter each traveller’s first name, last name and email.' }, 400);
  }
  try {
    const ticket = await createOrder(env, { quoteId, passengers, paymentToken }, fetcher);
    return json({ ...ticket, provider: sales.provider, retrieved: new Date().toISOString() });
  } catch (e) {
    const timeout = e?.name === 'TimeoutError';
    return json({ error: timeout ? 'The distributor took too long to confirm. Check “My tickets” before trying again.' : (e.message || 'The ticket could not be issued.'),
      upstream: e?.status || (timeout ? 'timeout' : 'error') }, timeout || e?.status >= 500 ? 503 : 409);
  }
}
export const onRequest = () => json({ error: 'Method not allowed' }, 405);
