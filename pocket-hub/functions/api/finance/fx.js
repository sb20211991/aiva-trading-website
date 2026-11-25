/* GET /api/finance/fx?base=GBP[&symbols=USD,EUR] -> {base, rates, sources, missing, date, updated, names, source} */
import { fxHandler } from '../../_lib/finance.js';
export const onRequestGet = ({ request }) => fxHandler(request);
