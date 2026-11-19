#!/usr/bin/env node
/**
 * Static integrity checks for the recovered Aiva Trading website package.
 * Does not deploy and does not claim live payments.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredPages = [
  'index.html',
  'shop.html',
  'company.html',
  'buying-guide.html',
  'privacy.html',
  'order-success.html',
  'order-cancelled.html',
  '404.html',
  'electronics.html',
  'smart-home.html',
  'portable-power.html',
  'vehicles.html',
  'scooters.html',
  'parts.html',
  'computing.html',
  'barber-beauty.html',
  'home-essentials.html'
];
const requiredAssets = [
  'assets/mark.svg',
  'assets/aiva-emerald-gold.webp',
  'assets/style.css',
  'assets/aiva-commerce.js',
  'assets/aiva-money.js',
  'assets/aiva-commerce.css',
  'assets/aiva-scan-pay.js',
  'assets/aiva-scan-pay.css',
  'assets/aiva-qr-license.txt',
  'assets/language-switcher.js',
  'assets/language-switcher.css',
  'data/aiva-products.json'
];
const requiredFunctions = [
  'functions/api/shop-status.js',
  'functions/api/create-checkout-session.js',
  'functions/api/order-status.js',
  'functions/api/square-webhook.js',
  'functions/api/admin-orders.js',
  'functions/api/create-refund.js',
  'functions/_lib/commerce.js',
  '_routes.json',
  'wrangler.toml'
];

for (const rel of [...requiredPages, ...requiredAssets, ...requiredFunctions]) {
  const full = path.join(root, rel);
  assert.ok(existsSync(full), 'Missing required file: ' + rel);
  assert.ok(statSync(full).size > 0, 'Empty required file: ' + rel);
}

assert.equal(existsSync(path.join(root, '_worker.js')), false, 'Root _worker.js must not exist');

const index = readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(index, /Aiva Trading Limited/);
assert.match(index, /17485509/);
assert.match(index, /153 Whitehill Road/);
assert.match(index, /brand-wordmark/);
assert.match(index, /aiva-emerald-gold\.webp/);
assert.match(index, /language-switcher/);
assert.match(index, /#enquiry/);

const shop = readFileSync(path.join(root, 'shop.html'), 'utf8');
assert.match(shop, /Square/);
assert.match(shop, /Pay online securely/);
assert.match(shop, /scan-to-pay|Scan to pay/i);
assert.match(shop, /Apple Pay/);
assert.match(shop, /Google Pay/);

const guide = readFileSync(path.join(root, 'buying-guide.html'), 'utf8');
assert.match(guide, /Apple Pay/);
assert.match(guide, /Google Pay/);
assert.match(guide, /data-aiva-checkout/);
assert.match(guide, /data-aiva-scan-pay/);
assert.match(guide, /AIVA · Scan to pay/);
assert.match(guide, /All three buttons open the same Square/);

const customerCheckoutAssets = [
  'shop.html',
  'buying-guide.html',
  'order-success.html',
  'order-cancelled.html',
  'assets/aiva-commerce.js',
  'assets/aiva-guide-checkout.js',
  'assets/aiva-order.js',
  'assets/aiva-scan-pay.js'
];
for (const rel of customerCheckoutAssets) {
  assert.doesNotMatch(
    readFileSync(path.join(root, rel), 'utf8'),
    /stripe|shopify/i,
    'Forbidden stripe/shopify reference in ' + rel
  );
}

const company = readFileSync(path.join(root, 'company.html'), 'utf8');
assert.match(company, /Chia Sabir/);
assert.match(company, /Aivatradingltd2026@gmail\.com/);

const catalogue = JSON.parse(readFileSync(path.join(root, 'data/aiva-products.json'), 'utf8'));
for (const p of catalogue.products) {
  assert.ok(p.testOnly === true && /TEST/.test(p.name), 'Only clearly labelled test products may be published: ' + p.sku);
}
if (catalogue.products.length) assert.equal(catalogue.testOnly, true, 'Test catalogue must be flagged testOnly');
assert.ok(String(catalogue.businessAddress || '').includes('Whitehill'));
assert.ok(String(catalogue.deliveryPolicy || '').length >= 15);
assert.ok(String(catalogue.returnsPolicy || '').length >= 15);
assert.ok(Number.isSafeInteger(catalogue.shipping?.flatRatePence));
assert.ok(Array.isArray(catalogue.categories) && catalogue.categories.length >= 8);

const commerce = readFileSync(path.join(root, 'functions/_lib/commerce.js'), 'utf8');
assert.match(commerce, /online-checkout\/payment-links/);
assert.match(commerce, /handleCreateRefund/);
assert.match(commerce, /SQUARE_LIVE_PAYMENTS_APPROVED === 'true'/);
assert.match(commerce, /x-square-hmacsha256-signature/);
assert.doesNotMatch(commerce, /stripe|paypal|shopify/i);

const { validateSquareCheckout } = await import(
  pathToFileURL(path.join(root, 'assets/aiva-scan-pay.js')).href
);
assert.equal(
  validateSquareCheckout('https://sandbox.square.link/u/integrity', 'test').url.hostname,
  'sandbox.square.link'
);
assert.throws(() => validateSquareCheckout('https://checkout.stripe.com/c/pay/cs_test_x', 'test'));

const assetCount = readdirSync(path.join(root, 'assets')).filter((name) =>
  /\.(webp|svg|css|js)$/i.test(name)
).length;
assert.ok(assetCount >= 40, 'Expected rich asset set, found ' + assetCount);

console.log('WEBSITE INTEGRITY CHECKS PASSED');
console.log('- pages, assets, company details and payment Functions present');
console.log('- Square-only checkout; wallets + scan-to-pay markup required');
console.log('- stripe/shopify forbidden in customer checkout assets');
console.log('- root _worker.js absent (Functions deploy path)');
