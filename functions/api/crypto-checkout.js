/* Aiva Crypto Pay (shared by aivatrading.uk and app.aivatrading.uk): see functions/_lib/crypto-pay.js. */
import { handleCryptoCheckout } from '../_lib/crypto-pay.js';
import { respond } from '../_lib/commerce.js';

export const onRequestPost = (context) => handleCryptoCheckout(context.request, context.env);
export const onRequest = () => respond({ error: 'Method not allowed.' }, 405);
