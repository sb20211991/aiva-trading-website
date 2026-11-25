/* Aiva Finance: exchange rates and cryptocurrency prices for app.aivatrading.uk.
   Every rate and price comes from a public provider reply, with its source and time; nothing is invented.
   Currencies: live mid-market rates from Coinbase's public exchange-rate feed (refreshed every few minutes) for every
   world currency it publishes; then Frankfurter (European Central Bank daily reference rates); then the open.er-api.com
   daily feed (160+ currencies, including IQD, AED, SAR) for anything else. Each rate is labelled with its source.
   Crypto: CoinGecko market list (top coins by market cap), then CoinGecko simple prices, then Coinbase spot for BTC/ETH.
   Indicative only: no currency exchange, transfer or crypto purchase happens here. */
import { json, fetchJSON, cached } from './emergency.js';

export const FRANKFURTER = 'https://api.frankfurter.dev/v1';
export const ER_API = 'https://open.er-api.com/v6/latest';
export const COINGECKO = 'https://api.coingecko.com/api/v3';
export const COINBASE = 'https://api.coinbase.com/v2';

/* English names for every ISO 4217 code, from the runtime's own Intl data; the curated list above wins. */
let DN = null;
try { DN = new Intl.DisplayNames(['en'], { type: 'currency' }); } catch {}
export const currencyName = (c) => CURRENCIES[c] || (DN ? DN.of(c) : '') || c;
let ISO = null;
try { ISO = new Set(Intl.supportedValuesOf('currency')); } catch {}
/* Codes Coinbase lists that are not national currencies (crypto, metals, special drawing rights). */
const NOT_FIAT = new Set(['XAU', 'XAG', 'XPT', 'XPD', 'XDR', 'BTC', 'ETH', 'USDC', 'USDT']);
const isFiat = (c) => isCurrency(c) && !NOT_FIAT.has(c) && (!ISO || ISO.has(c));

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
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' },
  { id: 'tron', symbol: 'TRX', name: 'TRON' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot' },
  { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu' },
  { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash' },
  { id: 'stellar', symbol: 'XLM', name: 'Stellar' },
  { id: 'uniswap', symbol: 'UNI', name: 'Uniswap' },
  { id: 'near', symbol: 'NEAR', name: 'NEAR Protocol' },
  { id: 'aptos', symbol: 'APT', name: 'Aptos' },
  { id: 'sui', symbol: 'SUI', name: 'Sui' },
  { id: 'internet-computer', symbol: 'ICP', name: 'Internet Computer' },
  { id: 'ethereum-classic', symbol: 'ETC', name: 'Ethereum Classic' },
  { id: 'hedera-hashgraph', symbol: 'HBAR', name: 'Hedera' },
  { id: 'cosmos', symbol: 'ATOM', name: 'Cosmos' },
  { id: 'filecoin', symbol: 'FIL', name: 'Filecoin' },
  { id: 'arbitrum', symbol: 'ARB', name: 'Arbitrum' },
  { id: 'optimism', symbol: 'OP', name: 'Optimism' },
  { id: 'aave', symbol: 'AAVE', name: 'Aave' },
  { id: 'pepe', symbol: 'PEPE', name: 'Pepe' },
  { id: 'render-token', symbol: 'RENDER', name: 'Render' },
  { id: 'algorand', symbol: 'ALGO', name: 'Algorand' },
  { id: 'tezos', symbol: 'XTZ', name: 'Tezos' },
  { id: 'dai', symbol: 'DAI', name: 'Dai' }
];

const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/* All rates against `base`. Live Coinbase mid-market rates are preferred; currencies it lacks come from the ECB
   (Frankfurter), then open.er-api.com. Every rate says which source it came from: 'live', 'ecb' or 'er'. */
export async function ratesFor(base, fetcher = fetch) {
  const out = { base, rates: {}, sources: {}, date: null, updated: null, live: null };
  const [live, ecb, er] = await Promise.all([
    fetchJSON(`${COINBASE}/exchange-rates?currency=${base}`, {}, fetcher, 8000).catch(() => null),
    fetchJSON(`${FRANKFURTER}/latest?base=${base}`, {}, fetcher, 10000).catch(() => null),
    fetchJSON(`${ER_API}/${base}`, {}, fetcher, 10000).catch(() => null)
  ]);
  const erOk = er?.result === 'success' && er.rates;
  const known = new Set([...Object.keys(ecb?.rates || {}), ...Object.keys(erOk ? er.rates : {})]);
  const lr = live?.data?.currency === base ? live.data.rates : null;
  if (lr) {
    for (const [c, v] of Object.entries(lr)) {
      const r = Number(v);
      if (finite(r) && (known.has(c) || (!known.size && isFiat(c))) && isFiat(c)) { out.rates[c] = r; out.sources[c] = 'live'; }
    }
    if (Object.keys(out.rates).length) out.live = new Date().toISOString();
  }
  if (ecb?.rates) {
    out.date = ecb.date || null;
    for (const [c, r] of Object.entries(ecb.rates)) if (finite(r) && !(c in out.rates)) { out.rates[c] = r; out.sources[c] = 'ecb'; }
  }
  if (erOk) {
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
    const all = useCache ? await cached(`aiva-fx-v2-${base}`, 300, () => ratesFor(base, fetcher)) : await ratesFor(base, fetcher);
    const pick = symbols.length ? symbols : Object.keys(all.rates);
    const rates = {}, sources = {};
    for (const c of pick) if (c in all.rates) { rates[c] = all.rates[c]; sources[c] = all.sources[c]; }
    const missing = pick.filter((c) => !(c in rates));
    const names = Object.fromEntries(Object.keys(all.rates).sort().map((c) => [c, currencyName(c)]));
    return json({ base, rates, sources, missing, date: all.date, updated: all.updated, live: all.live, names, count: Object.keys(all.rates).length,
      source: 'Live mid-market rates from Coinbase; European Central Bank reference rates via Frankfurter and open.er-api.com (ExchangeRate-API) for the rest. Indicative, not a dealing rate.' }, 200, 120);
  } catch (err) {
    return json({ error: err.message || 'Exchange rates are unavailable right now' }, err.status || 502);
  }
}

/* Crypto prices in the chosen fiat currency. CoinGecko first; Coinbase spot for BTC and ETH if CoinGecko fails. */
export async function cryptoPrices(vs, fetcher = fetch, limit = 50, key = '') {
  const v = vs.toLowerCase(), cg = key ? { headers: { 'x-cg-demo-api-key': key } } : {};
  try {
    const m = await fetchJSON(`${COINGECKO}/coins/markets?vs_currency=${v}&order=market_cap_desc&per_page=${limit}&page=1&price_change_percentage=24h`, cg, fetcher, 10000);
    const coins = (Array.isArray(m) ? m : []).filter((c) => finite(c?.current_price) && c.id && c.symbol).map((c) => ({
      id: String(c.id).slice(0, 60), symbol: String(c.symbol).toUpperCase().slice(0, 12), name: String(c.name || c.symbol).slice(0, 60),
      price: c.current_price, change24h: Number.isFinite(c.price_change_percentage_24h) ? c.price_change_percentage_24h : null,
      marketCap: finite(c.market_cap) ? c.market_cap : null, rank: Number.isFinite(c.market_cap_rank) ? c.market_cap_rank : null,
      updated: c.last_updated || null }));
    if (coins.length) return { currency: vs, coins, source: 'CoinGecko' };
  } catch {}
  try {
    const d = await fetchJSON(`${COINGECKO}/simple/price?ids=${COINS.map((c) => c.id).join(',')}&vs_currencies=${v}&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true`, cg, fetcher, 10000);
    const coins = COINS.filter((c) => finite(d?.[c.id]?.[v])).map((c) => ({
      ...c, price: d[c.id][v],
      change24h: Number.isFinite(d[c.id][`${v}_24h_change`]) ? d[c.id][`${v}_24h_change`] : null,
      marketCap: finite(d[c.id][`${v}_market_cap`]) ? d[c.id][`${v}_market_cap`] : null,
      updated: d[c.id].last_updated_at ? new Date(d[c.id].last_updated_at * 1000).toISOString() : null
    }));
    if (coins.length) return { currency: vs, coins, source: 'CoinGecko' };
  } catch {}
  /* Coinbase's public exchange-rate feed lists crypto against every fiat currency (units per 1 `vs`), so one call
     prices the whole fallback list. No 24h change or market cap is available from it, and none is shown. */
  try {
    const d = await fetchJSON(`${COINBASE}/exchange-rates?currency=${vs}`, {}, fetcher, 8000);
    const r = d?.data?.currency === vs ? d.data.rates || {} : {};
    const now = new Date().toISOString();
    const coins = COINS.filter((c) => finite(Number(r[c.symbol]))).map((c) => ({ ...c, price: 1 / Number(r[c.symbol]), change24h: null, marketCap: null, rank: null, updated: now }));
    if (coins.length >= 3) return { currency: vs, coins, source: 'Coinbase exchange rates' };
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

export async function cryptoHandler(request, fetcher = fetch, useCache = true, env = {}) {
  const u = new URL(request.url), vs = (u.searchParams.get('currency') || 'GBP').toUpperCase();
  const limit = Math.min(100, Math.max(10, Number(u.searchParams.get('limit')) || 50));
  if (!isCurrency(vs)) return json({ error: 'Choose a three-letter currency code, for example GBP' }, 400);
  try {
    const data = useCache ? await cached(`aiva-crypto-v2-${vs}-${limit}`, 60, () => cryptoPrices(vs, fetcher, limit, env.COINGECKO_API_KEY)) : await cryptoPrices(vs, fetcher, limit, env.COINGECKO_API_KEY);
    return json({ ...data, note: 'Indicative market prices. Aiva does not buy, sell, hold or exchange cryptocurrency.' }, 200, 60);
  } catch (err) {
    return json({ error: err.message || 'Crypto prices are unavailable right now' }, err.status || 502);
  }
}
