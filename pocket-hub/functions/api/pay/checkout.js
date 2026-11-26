/* POST /api/pay/checkout {sku, qty, method, currency, email?} -> provider payment page URL (Stripe Checkout or BitPay). */
import { checkoutHandler } from '../../_lib/payments.js';
export const onRequestPost = ({ request, env }) => checkoutHandler(request, env);
