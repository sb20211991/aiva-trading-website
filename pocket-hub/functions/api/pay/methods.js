/* GET /api/pay/methods -> products on sale and every Aiva Pay method with its real availability. */
import { methodsHandler } from '../../_lib/payments.js';
export const onRequestGet = ({ request, env }) => methodsHandler(request, env);
