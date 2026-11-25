/* Aiva Finance: exchange rates and crypto prices. Offline: every provider reply is a local stub. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fxHandler, cryptoHandler, ratesFor, CURRENCIES, COINS, currencyName } from '../functions/_lib/finance.js';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const stub = (routes) => async (url) => { for (const [k, v] of routes) if (String(url).includes(k)) return typeof v === 'function' ? v(url) : v.clone(); return reply({}, 404); };
const req = (q) => new Request('https://app.aivatrading.uk' + q);

// ECB rates win; currencies the ECB lacks (IQD) come from open.er-api.com and are labelled.
{
  const f = stub([['frankfurter', reply({ base: 'GBP', date: '2026-11-25', rates: { USD: 1.27, EUR: 1.18 } })],
    ['open.er-api', reply({ result: 'success', time_last_update_utc: 'Wed, 25 Nov 2026 00:02:31 +0000', rates: { GBP: 1, USD: 1.30, IQD: 1660.5 } })]]);
  const r = await fxHandler(req('/api/finance/fx?base=GBP&symbols=USD,IQD,XXX'), f, false);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.rates.USD, 1.27); assert.equal(d.sources.USD, 'ecb');
  assert.equal(d.rates.IQD, 1660.5); assert.equal(d.sources.IQD, 'er');
  assert.deepEqual(d.missing, ['XXX']);
  assert.equal(d.date, '2026-11-25');
}
// One provider down still answers; both down is an honest 502, never invented rates.
{
  const r = await ratesFor('GBP', stub([['frankfurter', reply({}, 500)], ['open.er-api', reply({ result: 'success', rates: { USD: 1.3 } })]]));
  assert.equal(r.rates.USD, 1.3); assert.equal(r.rates.GBP, 1);
  const bad = await fxHandler(req('/api/finance/fx?base=GBP'), stub([]), false);
  assert.equal(bad.status, 502); assert.ok((await bad.json()).error);
  assert.equal((await fxHandler(req('/api/finance/fx?base=pounds'), stub([]), false)).status, 400);
}
// Crypto: CoinGecko first, with 24h change; zero or missing prices are dropped.
{
  const f = stub([['coingecko', reply({ bitcoin: { gbp: 71000, gbp_24h_change: -1.5, gbp_market_cap: 1.4e12, last_updated_at: 1764028800 }, ethereum: { gbp: 2600, gbp_24h_change: 2.1 }, tether: { gbp: 0 } })]]);
  const d = await (await cryptoHandler(req('/api/finance/crypto?currency=GBP'), f, false)).json();
  assert.equal(d.source, 'CoinGecko');
  assert.deepEqual(d.coins.map((c) => c.symbol), ['BTC', 'ETH']);
  assert.equal(d.coins[0].price, 71000); assert.equal(d.coins[0].change24h, -1.5);
  assert.match(d.note, /does not buy, sell/);
}
// CoinGecko refused (as it often is from shared cloud IPs): Coinbase's exchange-rate feed prices the wider list.
{
  const f = stub([['coingecko', reply({}, 429)], ['exchange-rates?currency=GBP', reply({ data: { currency: 'GBP', rates: { BTC: '0.0000200', ETH: '0.0005', SOL: '0.01', XRP: '0.5', GBP: '1' } } })]]);
  const d = await (await cryptoHandler(req('/api/finance/crypto?currency=GBP'), f, false)).json();
  assert.equal(d.source, 'Coinbase exchange rates');
  assert.deepEqual(d.coins.map((c) => [c.symbol, Math.round(c.price)]), [['BTC', 50000], ['ETH', 2000], ['SOL', 100], ['XRP', 2]]);
  assert.equal(d.coins[0].change24h, null);
  // An optional CoinGecko key is sent as a header, never in the URL.
  let seen = null;
  await cryptoHandler(req('/api/finance/crypto?currency=GBP'), async (u, init) => { seen = seen || { u: String(u), h: init?.headers }; return reply([]); }, false, { COINGECKO_API_KEY: 'k123' });
  assert.equal(seen.h['x-cg-demo-api-key'], 'k123'); assert.ok(!seen.u.includes('k123'));
}
// CoinGecko down: Coinbase spot for BTC and ETH. Everything down: 502.
{
  const f = stub([['coingecko', reply({}, 429)], ['BTC-EUR', reply({ data: { amount: '82000.12' } })], ['ETH-EUR', reply({ data: { amount: '3000.5' } })]]);
  const d = await (await cryptoHandler(req('/api/finance/crypto?currency=EUR'), f, false)).json();
  assert.equal(d.source, 'Coinbase spot price');
  assert.deepEqual(d.coins.map((c) => [c.symbol, c.price]), [['BTC', 82000.12], ['ETH', 3000.5]]);
  assert.equal((await cryptoHandler(req('/api/finance/crypto?currency=GBP'), stub([]), false)).status, 502);
}
// Live Coinbase rates win over the ECB for the same currency; crypto and metals in that feed are never shown as currencies.
{
  const f = stub([['exchange-rates?currency=GBP', reply({ data: { currency: 'GBP', rates: { USD: '1.2712', EUR: '1.1801', IQD: '1665.2', BTC: '0.0000141', XAU: '0.0004', JPY: '195.3' } } })],
    ['frankfurter', reply({ base: 'GBP', date: '2026-11-25', rates: { USD: 1.27, EUR: 1.18, JPY: 195 } })],
    ['open.er-api', reply({ result: 'success', rates: { GBP: 1, USD: 1.30, IQD: 1660.5, KMF: 560.2, JPY: 194, XDR: 0.9, HRK: 8.9, SLL: 29000 } })]]);
  const d = await (await fxHandler(req('/api/finance/fx?base=GBP'), f, false)).json();
  assert.ok(!('XDR' in d.rates) && !('HRK' in d.rates) && !('SLL' in d.rates));
  assert.equal(d.rates.USD, 1.2712); assert.equal(d.sources.USD, 'live');
  assert.equal(d.rates.IQD, 1665.2); assert.equal(d.sources.IQD, 'live');
  assert.equal(d.rates.KMF, 560.2); assert.equal(d.sources.KMF, 'er');
  assert.ok(!('BTC' in d.rates) && !('XAU' in d.rates));
  assert.equal(currencyName('GGP'), 'Guernsey pound'); assert.equal(currencyName('CNH'), 'Chinese yuan (offshore)');
  assert.ok(d.live); assert.equal(d.count, Object.keys(d.rates).length);
  // Every returned currency has an English name, not only the curated list.
  assert.equal(d.names.KMF, currencyName('KMF')); assert.notEqual(d.names.KMF, 'KMF');
  // A live reply for a different base is ignored.
  const g = stub([['exchange-rates', reply({ data: { currency: 'USD', rates: { EUR: '0.9' } } })], ['frankfurter', reply({ base: 'GBP', rates: { EUR: 1.18 } })]]);
  assert.equal((await ratesFor('GBP', g)).sources.EUR, 'ecb');
}
// Crypto: the CoinGecko market list (top coins by market cap) is used when available.
{
  const f = stub([['coins/markets', reply([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 71000, price_change_percentage_24h: 1.2, market_cap: 1.4e12, market_cap_rank: 1 },
    { id: 'pepe', symbol: 'pepe', name: 'Pepe', current_price: 0.0000081, market_cap_rank: 30 }, { id: 'dead', symbol: 'ded', name: 'Dead', current_price: 0 }])]]);
  const d = await (await cryptoHandler(req('/api/finance/crypto?currency=GBP&limit=50'), f, false)).json();
  assert.deepEqual(d.coins.map((c) => c.symbol), ['BTC', 'PEPE']);
  assert.equal(d.coins[0].rank, 1);
}
// The Finance page offers multi-currency comparison, a swap button and a crypto converter.
{
  const js = readFileSync(new URL('../public/aiva-finance.js', import.meta.url), 'utf8');
  for (const id of ['fxSwap', 'afMulti', 'afCcFrom', 'afCcTo', 'afCcAmount', 'afCryptoSearch']) assert.ok(js.includes(id), id);
}
assert.ok(Object.keys(CURRENCIES).length >= 50 && CURRENCIES.IQD && CURRENCIES.TRY && CURRENCIES.CNY);
assert.deepEqual(COINS.slice(0, 2).map((c) => c.symbol), ['BTC', 'ETH']);
// The page loads the finance script before app.js, and app.js asks it for the indicative conversion.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('src="aiva-finance.js"') > -1 && html.indexOf('src="aiva-finance.js"') < html.indexOf('src="app.js"'));
assert.match(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), /window\.aivaFxSuffix/);
assert.match(readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8'), /aiva-finance\.js/);
console.log('FINANCE CHECKS PASSED');
