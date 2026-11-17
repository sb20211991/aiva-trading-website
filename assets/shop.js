const shop = window.aivaShop;
const search = document.querySelector('#shop-search');
const category = document.querySelector('#shop-category');
const results = document.querySelector('#shop-results');
const count = document.querySelector('#shop-count');
const price = new Intl.NumberFormat('en-GB', {style:'currency', currency:'GBP'});

function liveCheckoutUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    const squareHost =
      host === 'square.link' ||
      host.endsWith('.square.link') ||
      host === 'checkout.square.site' ||
      host.endsWith('.checkout.square.site');
    return squareHost && url.pathname.length > 1 ? url.href : '';
  } catch {
    return '';
  }
}

function makeProductCard(product, ordersOpen) {
  const card = document.createElement('article');
  if (typeof product.image === 'string' && /^assets\/[a-zA-Z0-9_-]+\.(webp|png|jpe?g|avif)$/.test(product.image)) {
    const img = document.createElement('img');
    img.src = product.image;
    img.alt = product.name;
    img.loading = 'lazy';
    img.className = 'product-photo';
    card.append(img);
  }
  for (const [tag, value] of [
    ['small', product.category + ' · ' + product.sku],
    ['h3', product.name],
    ['p', product.description],
    ['strong', price.format(product.pricePence / 100)]
  ]) {
    const element = document.createElement(tag);
    element.textContent = value;
    card.append(element);
  }
  if (product.specifications) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const description = document.createElement('p');
    summary.textContent = 'Specifications';
    description.textContent = product.specifications;
    details.append(summary, description);
    card.append(details);
  }
  const checkout = ordersOpen && product.available === true && liveCheckoutUrl(product.checkoutUrl);
  const action = document.createElement('a');
  action.href = checkout || '#order-support';
  action.textContent = checkout ? 'Buy now · Square checkout' : 'Ask about availability';
  card.append(action);
  return card;
}

if (shop && Array.isArray(shop.products)) {
  const products = shop.products.filter(product => product &&
    ['sku','name','category','description'].every(key =>
      typeof product[key] === 'string' && product[key].trim()) &&
    Number.isSafeInteger(product.pricePence) && product.pricePence > 0);
  const policies = [
    ['businessAddress', '#shop-address'],
    ['delivery', '#shop-delivery'],
    ['returns', '#shop-returns']
  ];
  const ordersOpen = policies.every(([key]) => typeof shop[key] === 'string' && shop[key].trim());
  if (ordersOpen) {
    for (const [key, selector] of policies) document.querySelector(selector).textContent = shop[key];
    document.querySelector('#shop-policies').hidden = false;
  }
  if (products.length) {
    document.querySelector('#shop-products').hidden = false;
    document.querySelector('#shop-notice').hidden = ordersOpen &&
      products.some(product => product.available === true && liveCheckoutUrl(product.checkoutUrl));
    const categories = [...new Set(products.map(product => product.category))].sort();
    for (const name of categories) category.add(new Option(name, name));
    const render = () => {
      const query = search.value.trim().toLowerCase();
      const matching = products.filter(product =>
        (!category.value || category.value === product.category) &&
        [product.name, product.sku, product.category, product.description].join(' ').toLowerCase().includes(query));
      results.replaceChildren(...matching.map(product => makeProductCard(product, ordersOpen)));
      count.textContent = matching.length ? matching.length + ' matching products' : 'No matching products.';
    };
    search.addEventListener('input', render);
    category.addEventListener('change', render);
    render();
  }
}
