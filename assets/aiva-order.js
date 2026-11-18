(() => {
  'use strict';
  const PENDING_KEY = 'aiva_pending_checkout_ref';
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
      if (a.paid === true && ['test', 'live'].includes(a.mode)) {
        try {
          const snapshot = sessionStorage.getItem('aiva_pending_checkout_cart');
          const current = JSON.stringify(Object.entries(JSON.parse(localStorage.getItem('aiva_cart_v2') || '{}')).sort());
          if (stored === ref && snapshot && snapshot === current) localStorage.removeItem('aiva_cart_v2');
          sessionStorage.removeItem(PENDING_KEY);
          sessionStorage.removeItem('aiva_pending_checkout_cart');
        } catch {
          /* Storage is optional; payment is still verified by the server. */
        }
        out.textContent =
          (a.mode === 'test'
            ? 'TEST PAYMENT CONFIRMED — no real money charged.'
            : 'Payment confirmed by the payment provider.') +
          ' Your reference ends in ' +
          a.reference +
          '. Aiva will review the order and delivery arrangements.';
      } else {
        out.textContent =
          'Payment has not been confirmed. Do not assume your order is paid. Check your payment email or contact Aiva.';
      }
    })
    .catch(() => {
      out.textContent =
        'We could not verify this payment automatically. Please check your payment receipt or contact Aiva before making another payment.';
    });
})();
