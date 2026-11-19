#!/usr/bin/env node
/* Local scan-to-pay checks: Square URL allow-list, QR encode/decode with jsqr, verified payment gate. */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jsQR from 'jsqr';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoderPath = join(root, 'assets/aiva-qr-encoder.js');
if (!existsSync(encoderPath)) {
  copyFileSync(fileURLToPath(import.meta.resolve('qrcode-generator')), encoderPath);
}

const {
  checkoutQrMatrix,
  productPaymentUrl,
  validateSquareCheckout,
  verifiedScanPayment
} = await import(pathToFileURL(join(root, 'assets/aiva-scan-pay.js')).href);

const sandboxUrl = 'https://sandbox.square.link/u/SyntheticQrUnitTest123';
assert.equal(validateSquareCheckout(sandboxUrl, 'test').url.href, sandboxUrl);

for (const value of [
  'javascript:alert(1)',
  'https://checkout.stripe.com/c/pay/cs_test_SyntheticQrUnitTest123456',
  'https://sandbox.square.link.evil.example/u/SyntheticQrUnitTest123',
  'https://user:password@sandbox.square.link/u/SyntheticQrUnitTest123',
  'http://sandbox.square.link/u/SyntheticQrUnitTest123',
  'https://sandbox.square.link:8443/u/SyntheticQrUnitTest123',
  'https://connect.squareup.com/v2/online-checkout/payment-links'
]) {
  assert.throws(() => validateSquareCheckout(value, 'test'), /checkout|Square|Invalid/i);
}
assert.throws(
  () => validateSquareCheckout('https://sandbox.square.link/u/SyntheticQrUnitTest123', 'live'),
  /checkout|Square|Invalid/i
);
assert.throws(
  () => validateSquareCheckout('https://connect.squareup.com/v2/checkout', 'test'),
  /checkout|Square|Invalid/i
);

const matrix = await checkoutQrMatrix(sandboxUrl, 'test');
assert.ok(matrix.length >= 21 && (matrix.length - 21) % 4 === 0);
assert.ok(
  matrix.every((row) => row.length === matrix.length && row.every((value) => typeof value === 'boolean'))
);
const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
assert.deepEqual(
  matrix.slice(0, 7).map((row) => row.slice(0, 7).map(Number).join('')),
  finder
);

const scale = 4;
const dim = matrix.length * scale;
const pixels = new Uint8ClampedArray(dim * dim * 4);
for (let y = 0; y < dim; y++) {
  for (let x = 0; x < dim; x++) {
    const dark = matrix[Math.floor(y / scale)][Math.floor(x / scale)];
    const i = (y * dim + x) * 4;
    const v = dark ? 0 : 255;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
    pixels[i + 3] = 255;
  }
}
const decoded = jsQR(pixels, dim, dim);
assert.ok(decoded, 'jsqr must decode the QR matrix');
assert.equal(decoded.data, sandboxUrl);

const productUrl = new URL(productPaymentUrl('UNIT_TEST_SKU', 2));
assert.equal(productUrl.origin, 'https://aivatrading.uk');
assert.equal(productUrl.searchParams.get('sku'), 'UNIT_TEST_SKU');
assert.equal(productUrl.searchParams.get('quantity'), '2');
assert.equal(productUrl.searchParams.has('amount'), false);
assert.equal(productUrl.searchParams.has('price'), false);
assert.throws(() => productPaymentUrl('invalid/sku'));
assert.throws(() => productPaymentUrl('UNIT_TEST_SKU', 11));

const reference = 'ORDER_TEST_SYNTHETIC01';
assert.equal(
  verifiedScanPayment(
    { paid: true, mode: 'test', provider: 'square', reference: reference.slice(-10) },
    reference,
    'test'
  ),
  true
);
assert.equal(
  verifiedScanPayment(
    { paid: true, mode: 'test', provider: 'stripe', reference: reference.slice(-10) },
    reference,
    'test'
  ),
  false
);
for (const changed of [{ paid: 'true' }, { paid: false }, { mode: 'live' }, { provider: 'shopify' }, { reference: 'wrong' }]) {
  assert.equal(
    verifiedScanPayment(
      {
        paid: true,
        mode: 'test',
        provider: 'square',
        reference: reference.slice(-10),
        ...changed
      },
      reference,
      'test'
    ),
    false
  );
}

console.log(
  'SCAN-TO-PAY CHECKS PASSED: Square URL allow-list, jsqr-decoded sandbox QR, product deep links, verified square-only payment gate.'
);
