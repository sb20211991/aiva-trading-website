(() => {
  'use strict';
  const PENDING_KEY = 'aiva_pending_checkout_ref';
  const CART_KEY = 'aiva_cart_v2';
  const out = document.getElementById('aiva-order-result');
  if (!out) return;
  const params = new URL(location.href).searchParams;
  let stored = '';
  try {
    stored = sessionStorage.getItem(PENDING_KEY) || '';
  } catch {
    stored = '';
  }
  const ref =
    params.get('order_id') ||
    params.get('orderId') ||
    params.get('session_id') ||
    params.get('transactionId') ||
    (stored && /^[A-Za-z0-9_-]{8,191}$/.test(stored) ? stored : '');
  if (!ref) {
    out.textContent =
      'No checkout reference supplied. If you paid, check your payment email or contact Aiva.';
    return;
  }
  fetch('/api/order-status?order_id=' + encodeURIComponent(ref), { cache: 'no-store' })
    .then(async (r) => {
      const a = await r.json();
      if (!r.ok) throw Error(a.error || 'Status unavailable');
      try {
        sessionStorage.removeItem(PENDING_KEY);
        sessionStorage.removeItem('aiva_pending_checkout_cart');
      } catch {
        /* private browsing */
      }
      if (a.paid === true) {
        try {
          localStorage.removeItem(CART_KEY);
        } catch {
          /* Storage is optional; payment is still verified by the server. */
        }
      }
      const ending =
        typeof a.reference === 'string' && a.reference
          ? ' Your reference ends in ' + a.reference + '.'
          : '';
      if (a.status === 'refunded') {
        out.textContent =
          (a.mode === 'test'
            ? 'TEST REFUND RECORDED — no real money remains charged.'
            : 'This order has been refunded by the payment provider.') +
          ending +
          ' Contact Aiva if you need fulfilment details.';
        return;
      }
      if (a.paid === true) {
        out.textContent =
          (a.mode === 'test'
            ? 'TEST PAYMENT CONFIRMED — no real money charged.'
            : 'Payment confirmed by Square.') +
          ending +
          ' Aiva will review the order and delivery arrangements.';
        return;
      }
      if (a.status === 'failed') {
        out.textContent =
          'This Square payment failed or was declined. Do not pay twice.' +
          ending +
          ' Return to your basket and try again only if you still want to order.';
        return;
      }
      out.textContent =
        'Payment is still pending. Do not assume your order is paid.' +
        ending +
        ' Check your Square receipt or contact Aiva before making another payment.';
    })
    .catch(() => {
      out.textContent =
        'We could not verify this payment automatically. Please check your payment receipt or contact Aiva before making another payment.';
    });
})();
