#!/usr/bin/env node
/**
 * Static integrity checks for the recovered Aiva Trading website package.
 * Does not deploy and does not claim live payments.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'assets/language-switcher.js',
  'assets/language-switcher.css',
  'data/aiva-products.json'
];
const requiredFunctions = [
  'functions/api/shop-status.js',
  'functions/api/create-checkout-session.js',
  'functions/api/order-status.js',
  'functions/api/square-webhook.js',
  'functions/api/shopify-webhook.js',
  'functions/_lib/shopify.js',
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
assert.match(shop, /secure hosted checkout/);
for (const rel of ['shop.html', 'buying-guide.html', 'order-success.html', 'assets/aiva-commerce.js', 'assets/aiva-guide-checkout.js']) {
  assert.doesNotMatch(readFileSync(path.join(root, rel), 'utf8'), /stripe/i, 'Obsolete Stripe reference in ' + rel);
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
assert.match(commerce, /SHOPIFY_LIVE_PAYMENTS_APPROVED === 'true'/);
assert.match(commerce, /x-shopify-hmac-sha256/);
assert.doesNotMatch(commerce, /stripe|paypal/i);

const assetCount = readdirSync(path.join(root, 'assets')).filter((name) =>
  /\.(webp|svg|css|js)$/i.test(name)
).length;
assert.ok(assetCount >= 40, 'Expected rich asset set, found ' + assetCount);

console.log('WEBSITE INTEGRITY CHECKS PASSED');
console.log('- pages, assets, company details and payment Functions present');
console.log('- Shopify and Square checkout providers; only labelled TEST products published');
console.log('- root _worker.js absent (Functions deploy path)');
