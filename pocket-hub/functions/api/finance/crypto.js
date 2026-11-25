/* GET /api/finance/crypto?currency=GBP -> {currency, coins:[{symbol,name,price,change24h,marketCap,updated}], source, note} */
import { cryptoHandler } from '../../_lib/finance.js';
export const onRequestGet = ({ request }) => cryptoHandler(request);
