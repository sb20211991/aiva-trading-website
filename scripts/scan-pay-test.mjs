import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { checkoutQrMatrix, productPaymentUrl, validateStripeCheckout, verifiedScanPayment }
  from '../.worker-assets/assets/aiva-scan-pay.js';
import { stripeTestCataloguePath } from '../functions/_lib/stripe-test.js';

const reference = 'cs_test_SyntheticQrUnitTest123456';
const url = 'https://checkout.stripe.com/c/pay/' + reference;
assert.equal(validateStripeCheckout(url).reference, reference);
for (const value of ['javascript:alert(1)', 'https://checkout.stripe.com.evil.example/c/pay/' + reference,
  'https://user:password@checkout.stripe.com/c/pay/' + reference,
  'http://checkout.stripe.com/c/pay/' + reference, 'https://checkout.stripe.com/not-checkout',
  'https://checkout.stripe.com/c/pay/cs_live_SyntheticQrUnitTest123456']) {
  assert.throws(() => validateStripeCheckout(value), /checkout|Stripe/i);
}
const matrix = await checkoutQrMatrix(url);
assert.ok(matrix.length >= 21 && (matrix.length - 21) % 4 === 0);
assert.ok(matrix.every(row => row.length === matrix.length && row.every(value => typeof value === 'boolean')));
const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
assert.deepEqual(matrix.slice(0, 7).map(row => row.slice(0, 7).map(Number).join('')), finder);
const productUrl = new URL(productPaymentUrl('UNIT_TEST_SKU', 2));
assert.equal(productUrl.origin, 'https://aivatrading.uk');
assert.equal(productUrl.searchParams.get('sku'), 'UNIT_TEST_SKU');
assert.equal(productUrl.searchParams.get('quantity'), '2');
assert.equal(productUrl.searchParams.has('amount'), false);
assert.throws(() => productPaymentUrl('invalid/sku'));
assert.throws(() => productPaymentUrl('UNIT_TEST_SKU', 11));
assert.equal(verifiedScanPayment({ paid: true, mode: 'test', provider: 'stripe',
  reference: reference.slice(-10) }, reference, 'test'), true);
for (const changed of [{ paid: 'true' }, { paid: false }, { mode: 'live' }, { provider: 'square' },
  { reference: 'wrong' }]) {
  assert.equal(verifiedScanPayment({ paid: true, mode: 'test', provider: 'stripe',
    reference: reference.slice(-10), ...changed }, reference, 'test'), false);
}
for (const [origin, expected] of [
  ['https://preview-black-scene-993d.sb20211991.workers.dev', true],
  ['https://black-scene-993d.foreign-account.workers.dev', false],
  ['https://aivatrading.uk', false]
]) {
  const actual = stripeTestCataloguePath(new Request(origin + '/api/shop-status'), {
    CHECKOUT_PROVIDER: 'stripe', STRIPE_MODE: 'test', STRIPE_TEST_CHECKOUT_ENABLED: 'true',
    STRIPE_TEST_ORIGIN: origin
  });
  assert.equal(actual.endsWith('.stripe-test.json'), expected);
}
const storedCart = { UNIT_TEST_SKU: 1 };
async function successPage(paid, changeCart = false, pending = true) {
  const local = new Map([['aiva_cart_v2', JSON.stringify(changeCart ? { UNIT_TEST_SKU: 2 } : storedCart)]]);
  const session = new Map(pending ? [['aiva_pending_checkout_ref', reference],
    ['aiva_pending_checkout_cart', JSON.stringify(Object.entries(storedCart).sort())]] : []);
  const storage = map => ({ getItem: key => map.get(key) ?? null, removeItem: key => map.delete(key) });
  const out = { textContent: '' };
  runInNewContext(readFileSync('assets/aiva-order.js', 'utf8'), {
    URL, location: { href: 'https://aivatrading.uk/order-success.html?session_id=' + reference },
    document: { getElementById: () => out }, localStorage: storage(local), sessionStorage: storage(session),
    fetch: async () => Response.json({ paid, mode: 'test', reference: reference.slice(-10) })
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  return { cart: local.get('aiva_cart_v2'), message: out.textContent };
}
assert.equal((await successPage(true)).cart, undefined);
assert.ok((await successPage(false)).cart);
assert.ok((await successPage('true')).cart);
assert.ok((await successPage(true, true)).cart);
assert.ok((await successPage(true, false, false)).cart); // Another device must not lose an unrelated basket.
console.log('SCAN-TO-PAY CHECKS PASSED: local QR encoding, trusted Stripe links, future SKU links, test isolation and verified-payment-only basket clearing.');
