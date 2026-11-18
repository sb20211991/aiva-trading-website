/* Shared server/browser currency rules. Prices are integer minor units, never floats. */
export const CURRENCIES = Object.freeze({
  GBP: 2, EUR: 2, USD: 2, CAD: 2, AUD: 2, NZD: 2, CHF: 2, JPY: 0,
  SEK: 2, NOK: 2, DKK: 2, SGD: 2, HKD: 2, AED: 2, SAR: 2, QAR: 2
});
export function currencyCode(value) {
  const code = typeof value === 'string' ? value.toUpperCase() : '';
  return Object.hasOwn(CURRENCIES, code) ? code : '';
}
export function formatMoney(amount, currency = 'GBP') {
  const code = currencyCode(currency);
  if (!code || !Number.isSafeInteger(amount)) throw Error('Invalid monetary amount.');
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code })
    .format(amount / 10 ** CURRENCIES[code]);
}
export function minorFromMajor(value, currency = 'GBP') {
  const code = currencyCode(currency);
  if (!code) return NaN;
  const source = String(value).trim();
  if (source === '') return null;
  const decimals = CURRENCIES[code];
  if (!(new RegExp(decimals ? '^\\d+(?:\\.\\d{1,' + decimals + '})?$' : '^\\d+$')).test(source)) return NaN;
  const [whole, fraction = ''] = source.split('.');
  const result = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0'));
  return Number.isSafeInteger(result) && result >= 0 && result <= 100000000 ? result : NaN;
}
function amount(source, modern, legacy, currency) {
  return source?.[modern] !== undefined ? source[modern] : currency === 'GBP' ? source?.[legacy] : null;
}
export function normaliseCatalogue(catalogue) {
  if (!catalogue || !currencyCode(catalogue.currency)) throw Error('Unsupported catalogue currency.');
  const currency = currencyCode(catalogue.currency);
  return {
    ...catalogue,
    currency,
    products: Array.isArray(catalogue.products) ? catalogue.products.filter(product => product && typeof product === 'object').map(product => ({
      ...product,
      // The alias keeps existing basket arithmetic and the legacy GBP providers intact.
      pricePence: amount(product, 'priceMinor', 'pricePence', currency),
      available: product?.available === true &&
        (!product.currency || currencyCode(product.currency) === currency)
    })) : [],
    shipping: {
      ...catalogue.shipping,
      flatRatePence: amount(catalogue.shipping, 'flatRateMinor', 'flatRatePence', currency),
      freeShippingThresholdPence: amount(catalogue.shipping, 'freeShippingThresholdMinor', 'freeShippingThresholdPence', currency)
    }
  };
}
