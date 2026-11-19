/* Aiva Buying Guide payment handoff. The server validates every SKU and price. */
(async () => {
  'use strict';
  const { formatMoney, normaliseCatalogue } = await import('./aiva-money.js');
  const root = document.getElementById('direct-checkout');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const buttons = Array.from(root.querySelectorAll('[data-aiva-checkout]'));
  const view = {
    status: $('aiva-guide-pay-status'),
    basket: $('aiva-guide-basket-status'),
    items: $('aiva-guide-basket-items'),
    total: $('aiva-guide-order-total'),
    error: $('aiva-guide-pay-error')
  };
  const formatPence = (n) => formatMoney(n, catalog?.currency || 'GBP');
  const cartKey = 'aiva_cart_v2';
  const validSku = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{2,60}$/.test(x);
  const validQuantity = (x) => Number.isSafeInteger(x) && x > 0 && x <= 10;
  const validMoney = (x) => Number.isSafeInteger(x) && x > 0 && x <= 100000000;
  let catalog = null,
    online = { ready: false, mode: 'disabled' },
    cart = {},
    busy = false;

  function loadSavedCart() {
    try {
      const data = JSON.parse(localStorage.getItem(cartKey) || '{}');
      if (data && typeof data === 'object' && !Array.isArray(data))
        return Object.fromEntries(
          Object.entries(data).filter(([sku, qty]) => validSku(sku) && validQuantity(qty))
        );
    } catch {
      /* Browser storage disabled. */
    }
    return {};
  }

  function saveCart() {
    try {
      localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      /* Local storage unavailable. */
    }
  }

  function setMessage(message, ready = false) {
    view.status.textContent = message;
    view.status.dataset.ready = String(ready);
  }

  function render() {
    if (!catalog) return;
    const all = Array.isArray(catalog?.products) ? catalog.products : [];
    const map = new Map(all.filter((p) => p && validSku(p.sku)).map((p) => [p.sku, p]));
    let itemTotal = 0,
      unitCount = 0;
    const lines = [];
    const safeCart = {};
    for (const [sku, qty] of Object.entries(cart)) {
      const p = map.get(sku);
      if (
        !p ||
        p.available !== true ||
        !validMoney(p.pricePence) ||
        !Number.isSafeInteger(p.stock) ||
        p.stock < 1
      )
        continue;
      const count = Math.min(qty, p.stock, 10);
      if (!validQuantity(count)) continue;
      safeCart[sku] = count;
      unitCount += count;
      itemTotal += count * p.pricePence;
      const line = document.createElement('div');
      line.className = 'aiva-guide-basket-item';
      const title = document.createElement('strong');
      title.textContent = String(p.name || sku) + ' × ' + count;
      const price = document.createElement('span');
      price.textContent = formatPence(p.pricePence * count);
      line.append(title, price);
      lines.push(line);
    }
    cart = safeCart;
    saveCart();
    view.items.replaceChildren(...lines);
    const ready =
      online.ready === true && ['live', 'test'].includes(online.mode) && unitCount > 0;
    buttons.forEach((button) => {
      button.disabled = busy || !ready;
      button.textContent = busy
        ? 'Opening secure checkout…'
        : button.dataset.aivaOriginalLabel || button.textContent;
    });
    view.basket.textContent = unitCount
      ? `${unitCount} item${unitCount === 1 ? '' : 's'} in your basket.`
      : 'Your basket is empty. Browse the Shop to add confirmed products.';
    if (unitCount) {
      let ship = null;
      const policy = catalog?.shipping;
      if (Number.isSafeInteger(policy?.flatRatePence) && policy.flatRatePence >= 0)
        ship =
          Number.isSafeInteger(policy.freeShippingThresholdPence) &&
          itemTotal >= policy.freeShippingThresholdPence
            ? 0
            : policy.flatRatePence;
      view.total.textContent =
        'Subtotal ' +
        formatPence(itemTotal) +
        (ship === null
          ? ' · Delivery confirmed at checkout'
          : ship === 0
            ? ' · Delivery included · Estimated total ' + formatPence(itemTotal)
            : ' · Estimated delivery ' +
              formatPence(ship) +
              ' · Estimated total ' +
              formatPence(itemTotal + ship));
    } else view.total.textContent = '';
    if (online.ready === true && online.mode === 'live')
      setMessage(
        unitCount
          ? 'Secure card checkout is available. Continue above to pay.'
          : 'Choose an available product in the Shop to enable secure card checkout.',
        true
      );
    else if (online.ready === true && online.mode === 'test')
      setMessage('TEST MODE ONLY — simulated checkout; no real money is charged and no goods are dispatched.');
    else
      setMessage(
        'Card checkout is not yet available. Online orders remain closed while payment setup and products are prepared.'
      );
  }

  async function initialize() {
    buttons.forEach((button) => {
      button.dataset.aivaOriginalLabel = button.textContent;
    });
    cart = loadSavedCart();
    try {
      const r2 = await fetch('/api/shop-status', { cache: 'no-store' });
      if (!r2.ok) throw Error('Cannot verify store readiness.');
      online = await r2.json();
      const cataloguePath = '/data/aiva-products.json';
      const r1 = await fetch(cataloguePath, { cache: 'no-store' });
      if (!r1.ok || !r2.ok) throw Error('Cannot verify store readiness.');
      catalog = normaliseCatalogue(await r1.json());
      if (!Array.isArray(catalog?.products)) throw Error('Invalid catalogue.');
    } catch {
      online = { ready: false, mode: 'disabled' };
      catalog = { products: [] };
    }
    render();
  }

  function trustedCheckout(url) {
    const host = url.hostname.toLowerCase();
    const pageHost = location.hostname.toLowerCase();
    const localPreview = pageHost === '127.0.0.1' || pageHost === 'localhost';
    return (
      host === 'square.link' ||
      host.endsWith('.square.link') ||
      host === 'checkout.square.site' ||
      host.endsWith('.checkout.square.site') ||
      host.endsWith('.squareup.com') ||
      host.endsWith('.squareupsandbox.com') ||
      (online.provider === 'shopify' &&
        (host.endsWith('.myshopify.com') ||
          (Array.isArray(online.checkoutHosts) && online.checkoutHosts.includes(host)))) ||
      (localPreview &&
        (host === '127.0.0.1' || host === 'localhost') &&
        url.pathname.endsWith('/order-success.html'))
    );
  }

  async function checkout() {
    if (
      busy ||
      online.ready !== true ||
      !['live', 'test'].includes(online.mode) ||
      !Object.keys(cart).length
    )
      return;
    busy = true;
    view.error.hidden = true;
    render();
    try {
      const items = Object.entries(cart).map(([sku, quantity]) => ({ sku, quantity }));
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      const data = await response.json();
      if (!response.ok || typeof data.url !== 'string')
        throw Error(data.error || 'Could not start checkout.');
      const url = new URL(data.url);
      const pageHost = location.hostname.toLowerCase();
      const localPreview = pageHost === '127.0.0.1' || pageHost === 'localhost';
      const protocolOk =
        url.protocol === 'https:' || (localPreview && url.protocol === 'http:');
      if (!protocolOk || !trustedCheckout(url))
        throw Error('Unrecognized checkout destination.');
      if (typeof data.orderId === 'string' && /^[A-Za-z0-9_-]{8,191}$/.test(data.orderId)) {
        try {
          sessionStorage.setItem('aiva_pending_checkout_ref', data.orderId);
        } catch {
          /* private browsing */
        }
      }
      window.location.assign(url.href);
    } catch (err) {
      view.error.textContent =
        err instanceof Error ? err.message : 'Unable to open checkout. Please contact Aiva.';
      view.error.hidden = false;
      busy = false;
      render();
    }
  }

  buttons.forEach((btn) => btn.addEventListener('click', checkout));
  window.addEventListener('pageshow', () => {
    if (catalog) {
      busy = false;
      cart = loadSavedCart();
      render();
    }
  });
  initialize();
})();
