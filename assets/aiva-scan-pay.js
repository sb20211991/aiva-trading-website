/* AIVA-branded handoff to Stripe, not a new wallet or payment network.
   QR codes are generated locally. No card data, API key or admin token is encoded. */
export function validateStripeCheckout(value, mode = 'test') {
  if (!['test', 'live'].includes(mode) || typeof value !== 'string' || value.length > 4096) {
    throw Error('Invalid secure checkout link.');
  }
  let url;
  try { url = new URL(value); } catch { throw Error('Invalid secure checkout link.'); }
  const match = url.pathname.match(/^\/c\/pay\/(cs_(test|live)_[A-Za-z0-9]+)$/);
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' ||
      url.username || url.password || url.port || !match || match[2] !== mode) {
    throw Error('Unrecognized secure Stripe checkout destination.');
  }
  return { url, reference: match[1] };
}

export function productPaymentUrl(sku, quantity = 1) {
  if (typeof sku !== 'string' || !/^[A-Za-z0-9_-]{2,60}$/.test(sku) ||
      !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
    throw Error('A confirmed product SKU and valid quantity are required.');
  }
  const url = new URL('https://aivatrading.uk/buying-guide.html');
  url.searchParams.set('sku', sku);
  url.searchParams.set('quantity', String(quantity));
  url.hash = 'direct-checkout';
  return url.href; // Never put a customer-supplied price or payment secret in a QR.
}

export async function checkoutQrMatrix(value, mode = 'test') {
  const { url } = validateStripeCheckout(value, mode);
  return encodeQr(url.href);
}

export async function productQrMatrix(sku, quantity = 1) {
  return encodeQr(productPaymentUrl(sku, quantity));
}

async function encodeQr(value) {
  const { default: encoder } = await import('./aiva-qr-encoder.js');
  const code = encoder(0, 'M');
  code.addData(value, 'Byte');
  code.make();
  return Array.from({ length: code.getModuleCount() }, (_, row) =>
    Array.from({ length: code.getModuleCount() }, (_, column) => code.isDark(row, column)));
}

export function verifiedScanPayment(data, reference, mode) {
  return data?.paid === true && data?.provider === 'stripe' && data?.mode === mode &&
    data?.reference === reference.slice(-10);
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export async function showScanToPay({ url: value, mode = 'test', reference: suppliedReference,
  returnFocus = document.activeElement, poll = true } = {}) {
  const { url, reference } = validateStripeCheckout(value, mode);
  if (suppliedReference && suppliedReference !== reference) throw Error('Checkout reference mismatch.');
  const previousDialog = document.getElementById('aiva-scan-pay-dialog');
  if (previousDialog?.close) previousDialog.close();
  else previousDialog?.remove();
  const dialog = element('dialog', '', 'aiva-scan-pay-dialog');
  dialog.id = 'aiva-scan-pay-dialog';
  dialog.setAttribute('aria-labelledby', 'aiva-scan-pay-heading');
  const brand = element('p', 'AIVA', 'aiva-scan-pay-brand');
  const heading = element('h2', 'Scan to pay securely');
  heading.id = 'aiva-scan-pay-heading';
  const badge = element('p', mode === 'test'
    ? 'TEST MODE — no real money is charged.' : 'Secure checkout by Stripe.', 'aiva-scan-pay-badge');
  const explanation = element('p', 'Scan with your phone camera. Card, Apple Pay or Google Pay may be offered by Stripe, depending on your device and account eligibility.');
  const image = element('div', 'Preparing your checkout code…', 'aiva-scan-pay-image');
  const link = element('a', 'Open secure checkout on this device', 'aiva-scan-pay-link');
  link.href = url.href;
  link.referrerPolicy = 'no-referrer';
  const copy = element('button', 'Copy payment link');
  copy.type = 'button';
  const status = element('p', 'No payment is confirmed just by displaying or scanning this code.', 'aiva-scan-pay-status');
  status.setAttribute('role', 'status');
  const expiry = element('p', 'This code is only for this basket and expires with its Checkout Session. If it expires, close this panel and generate a fresh code.', 'aiva-scan-pay-expiry');
  const close = element('button', 'Close', 'aiva-scan-pay-close');
  close.type = 'button';
  dialog.append(brand, heading, badge, explanation, image, link, copy, status, expiry, close);
  document.body.append(dialog);
  let timer, request, stopped = false;
  const cleanup = () => {
    stopped = true;
    clearTimeout(timer);
    request?.abort();
    dialog.remove();
    if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus();
  };
  const dismiss = () => {
    if (typeof dialog.close === 'function') dialog.close();
    else cleanup();
  };
  close.addEventListener('click', dismiss);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', cleanup, { once: true });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right ||
          event.clientY < box.top || event.clientY > box.bottom) dismiss();
    }
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url.href);
      status.textContent = 'Secure checkout link copied. A copied link is not proof of payment.';
    } catch { status.textContent = 'Copy is unavailable here. Use the secure checkout link above.'; }
  });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); }
  try {
    const matrix = await checkoutQrMatrix(url.href, mode);
    if (stopped) return dialog;
    const count = matrix.length, size = count + 8; // Four white modules on each side.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'AIVA secure Stripe checkout QR code');
    svg.setAttribute('shape-rendering', 'crispEdges');
    const background = document.createElementNS(svg.namespaceURI, 'rect');
    background.setAttribute('width', String(size)); background.setAttribute('height', String(size));
    background.setAttribute('fill', '#fff');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    let squares = '';
    matrix.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) squares += `M${x + 4},${y + 4}h1v1h-1z`;
    }));
    path.setAttribute('d', squares); path.setAttribute('fill', '#000');
    svg.append(background, path); image.replaceChildren(svg);
  } catch {
    image.textContent = 'The QR image is unavailable. Use the secure checkout link below instead.';
  }
  const started = Date.now();
  async function check() {
    if (stopped || !dialog.isConnected) return;
    if (Date.now() - started > 300000) {
      status.textContent = 'Automatic checking has paused. Verify your payment on the confirmation page; do not pay again just because this panel is still open.';
      return;
    }
    request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 12000);
    try {
      const response = await fetch('/api/order-status?session_id=' + encodeURIComponent(reference), {
        cache: 'no-store', signal: request.signal
      });
      const data = await response.json();
      if (stopped) return;
      if (response.ok && verifiedScanPayment(data, reference, mode)) {
        dismiss();
        location.assign('/order-success.html?session_id=' + encodeURIComponent(reference));
        return;
      }
      if (response.ok && data.status === 'expired') {
        status.textContent = 'This checkout has expired. No payment is confirmed. Close this panel and generate a new code.';
        return;
      }
      status.textContent = response.ok
        ? 'Waiting for Stripe to confirm payment. An unpaid checkout can be retried on Stripe’s page.'
        : 'Payment status is temporarily unavailable. Check your confirmation before attempting another payment.';
    } catch {
      if (!stopped) status.textContent = 'Cannot verify payment right now. Do not assume it succeeded, and check before paying again.';
    } finally { clearTimeout(timeout); }
    if (!stopped) timer = setTimeout(check, 4000);
  }
  if (poll && !stopped) timer = setTimeout(check, 4000);
  return dialog;
}
