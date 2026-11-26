/* GET /api/pay/status?session_id=cs_... | ?invoice=<BitPay id> -> payment state read back from the provider. */
import { statusHandler } from '../../_lib/payments.js';
export const onRequestGet = ({ request, env }) => statusHandler(request, env);
