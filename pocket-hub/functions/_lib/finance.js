/* Aiva Finance: exchange rates and cryptocurrency prices for app.aivatrading.uk.
   Every rate and price comes from a public provider reply, with its source and time; nothing is invented.
   Currencies: Frankfurter (European Central Bank reference rates, ~30 major currencies) first, then the
   open.er-api.com daily feed (160+ currencies, including IQD, AED, SAR) for anything the ECB does not publish.
   Crypto: CoinGecko public simple-price API, then Coinbase spot prices as a fallback for BTC and ETH.
   Indicative only: no currency exchange, transfer or crypto purchase happens here. */
import { json, fetchJSON, cached } from './emergency.js';

export const FRANKFURTER = 'https://api.frankfurter.dev/v1';
export const ER_API = 'https://open.er-api.com/v6/latest';
export const COINGECKO = 'https://api.coingecko.com/api/v3';
export const COINBASE = 'https://api.coinbase.com/v2';

/* Display currencies offered in the app: major world currencies plus those Aiva customers use most. */
export const CURRENCIES = {
  GBP: 'British pound', EUR: 'Euro', USD: 'US dollar', IQD: 'Iraqi dinar', TRY: 'Turkish lira', CNY: 'Chinese yuan',
  AED: 'UAE dirham', SAR: 'Saudi riyal', QAR: 'Qatari riyal', KWD: 'Kuwaiti dinar', BHD: 'Bahraini dinar', OMR: 'Omani rial',
  JOD: 'Jordanian dinar', EGP: 'Egyptian pound', IRR: 'Iranian rial', ILS: 'Israeli shekel', JPY: 'Japanese yen',
  KRW: 'South Korean won', INR: 'Indian rupee', PKR: 'Pakistani rupee', BDT: 'Bangladeshi taka', HKD: 'Hong Kong dollar',
  SGD: 'Singapore dollar', MYR: 'Malaysian ringgit', THB: 'Thai baht', IDR: 'Indonesian rupiah', PHP: 'Philippine peso',
  VND: 'Vietnamese dong', AUD: 'Australian dollar', NZD: 'New Zealand dollar', CAD: 'Canadian dollar', MXN: 'Mexican peso',
  BRL: 'Brazilian real', ARS: 'Argentine peso', CLP: 'Chilean peso', COP: 'Colombian peso', ZAR: 'South African rand',
  NGN: 'Nigerian naira', KES: 'Kenyan shilling', MAD: 'Moroccan dirham', CHF: 'Swiss franc', SEK: 'Swedish krona',
  NOK: 'Norwegian krone', DKK: 'Danish krone', PLN: 'Polish zloty', CZK: 'Czech koruna', HUF: 'Hungarian forint',
  RON: 'Romanian leu', BGN: 'Bulgarian lev', ISK: 'Icelandic krona', UAH: 'Ukrainian hryvnia', RUB: 'Russian rouble',
  GEL: 'Georgian lari', AZN: 'Azerbaijani manat', KZT: 'Kazakhstani tenge'
};
export const isCurrency = (c) => /^[A-Z]{3}$/.test(c || '');

export const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'tether', symbol: 'USDT', name: 'Tether' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'usd-coin', symbol: 'USDC', name: 'USD Coin' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' }
];

const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/* All rates against `base`. Frankfurter (ECB) is preferred; currencies it lacks are filled from open.er-api.com,
   and each rate says which source it came from. */
export async function ratesFor(base, fetcher = fetch) {
  const out = { base, rates: {}, sources: {}, date: null, updated: null };
  let ecb = null, er = null;
  try { ecb = await fetchJSON(`${FRANKFURTER}/latest?base=${base}`, {}, fetcher, 10000); } catch {}
  if (ecb?.rates) {
    out.date = ecb.date || null;
    for (const [c, r] of Object.entries(ecb.rates)) if (finite(r)) { out.rates[c] = r; out.sources[c] = 'ecb'; }
  }
  try { er = await fetchJSON(`${ER_API}/${base}`, {}, fetcher, 10000); } catch {}
  if (er?.result === 'success' && er.rates) {
    out.updated = er.time_last_update_utc || null;
    for (const [c, r] of Object.entries(er.rates)) if (finite(r) && !(c in out.rates)) { out.rates[c] = r; out.sources[c] = 'er'; }
  }
  if (!Object.keys(out.rates).length) throw Object.assign(new Error(`No exchange rates are available for ${base} right now`), { status: 502 });
  out.rates[base] = 1; out.sources[base] = 'base';
  return out;
}

export async function fxHandler(request, fetcher = fetch, useCache = true) {
  const url = new URL(request.url);
  const base = (url.searchParams.get('base') || 'GBP').toUpperCase();
  if (!isCurrency(base)) return json({ error: 'Choose a three-letter currency code, for example GBP' }, 400);
  const symbols = (url.searchParams.get('symbols') || '').toUpperCase().split(',').filter(isCurrency);
  try {
    const all = useCache ? await cached(`aiva-fx-v1-${base}`, 1800, () => ratesFor(base, fetcher)) : await ratesFor(base, fetcher);
    const pick = symbols.length ? symbols : Object.keys(all.rates);
    const rates = {}, sources = {};
    for (const c of pick) if (c in all.rates) { rates[c] = all.rates[c]; sources[c] = all.sources[c]; }
    const missing = pick.filter((c) => !(c in rates));
    return json({ base, rates, sources, missing, date: all.date, updated: all.updated, names: CURRENCIES,
      source: 'European Central Bank reference rates via Frankfurter; other currencies from open.er-api.com (ExchangeRate-API). Indicative, not a dealing rate.' }, 200, 900);
  } catch (err) {
    return json({ error: err.message || 'Exchange rates are unavailable right now' }, err.status || 502);
  }
}

/* Crypto prices in the chosen fiat currency. CoinGecko first; Coinbase spot for BTC and ETH if CoinGecko fails. */
export async function cryptoPrices(vs, fetcher = fetch) {
  const v = vs.toLowerCase();
  try {
    const d = await fetchJSON(`${COINGECKO}/simple/price?ids=${COINS.map((c) => c.id).join(',')}&vs_currencies=${v}&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true`, {}, fetcher, 10000);
    const coins = COINS.filter((c) => finite(d?.[c.id]?.[v])).map((c) => ({
      ...c, price: d[c.id][v],
      change24h: Number.isFinite(d[c.id][`${v}_24h_change`]) ? d[c.id][`${v}_24h_change`] : null,
      marketCap: finite(d[c.id][`${v}_market_cap`]) ? d[c.id][`${v}_market_cap`] : null,
      updated: d[c.id].last_updated_at ? new Date(d[c.id].last_updated_at * 1000).toISOString() : null
    }));
    if (coins.length) return { currency: vs, coins, source: 'CoinGecko' };
  } catch {}
  const coins = [];
  for (const c of COINS.slice(0, 2)) {
    try {
      const d = await fetchJSON(`${COINBASE}/prices/${c.symbol}-${vs}/spot`, {}, fetcher, 8000);
      const price = Number(d?.data?.amount);
      if (finite(price)) coins.push({ ...c, price, change24h: null, marketCap: null, updated: new Date().toISOString() });
    } catch {}
  }
  if (coins.length) return { currency: vs, coins, source: 'Coinbase spot price' };
  throw Object.assign(new Error(`Crypto prices in ${vs} are unavailable right now`), { status: 502 });
}

export async function cryptoHandler(request, fetcher = fetch, useCache = true) {
  const vs = (new URL(request.url).searchParams.get('currency') || 'GBP').toUpperCase();
  if (!isCurrency(vs)) return json({ error: 'Choose a three-letter currency code, for example GBP' }, 400);
  try {
    const data = useCache ? await cached(`aiva-crypto-v1-${vs}`, 60, () => cryptoPrices(vs, fetcher)) : await cryptoPrices(vs, fetcher);
    return json({ ...data, note: 'Indicative market prices. Aiva does not buy, sell, hold or exchange cryptocurrency.' }, 200, 60);
  } catch (err) {
    return json({ error: err.message || 'Crypto prices are unavailable right now' }, err.status || 502);
  }
}
