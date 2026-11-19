#!/usr/bin/env node
/* One-off Shopify test-store setup with the Admin API (no secrets printed):
   - checks the store currency is GBP
   - creates the £1 TEST product (untracked in Shopify; stock is enforced by the website D1 database)
   - publishes it to the store's sales channels so the Storefront API can sell it
   - registers order and refund webhooks to the website
   Env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, optional SITE_BASE (default https://aivatrading.uk). */
const shop = process.env.SHOPIFY_STORE_DOMAIN?.trim();
const token = process.env.SHOPIFY_ADMIN_TOKEN?.trim();
const version = process.env.SHOPIFY_API_VERSION || '2026-10';
const site = (process.env.SITE_BASE || 'https://aivatrading.uk').replace(/\/$/, '');
if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop || '') || !token) {
  console.error('Set SHOPIFY_STORE_DOMAIN (xxxx.myshopify.com) and SHOPIFY_ADMIN_TOKEN.');
  process.exit(1);
}
async function gql(query, variables = {}) {
  const r = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw Error(`Admin API ${r.status}: ${JSON.stringify(j.errors || j).slice(0, 400)}`);
  return j.data;
}
const { shop: info } = await gql('{ shop { name currencyCode } }');
console.log('store:', info.name, 'currency:', info.currencyCode);
if (info.currencyCode !== 'GBP') throw Error('Store currency must be GBP.');

const SKU = 'AIVA-TEST-1GBP';
let found = await gql(`{ productVariants(first: 1, query: "sku:${SKU}") { nodes { id product { id } } } }`);
let variant = found.productVariants.nodes[0];
if (!variant) {
  const d = await gql(`mutation($input: ProductSetInput!) { productSet(synchronous: true, input: $input) {
      product { id variants(first: 1) { nodes { id } } } userErrors { field message } } }`, {
    input: {
      title: 'TEST ITEM – Shopify test £1 (not a real product)', status: 'ACTIVE', vendor: 'Aiva Trading Limited',
      descriptionHtml: '<p>Test listing used only to verify the website checkout in Shopify test mode. Will be removed before launch.</p>',
      productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
      variants: [{ optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: '1.00', sku: SKU,
        inventoryPolicy: 'CONTINUE', inventoryItem: { tracked: false, requiresShipping: true } }]
    }
  });
  if (d.productSet.userErrors.length) throw Error(JSON.stringify(d.productSet.userErrors));
  variant = { id: d.productSet.product.variants.nodes[0].id, product: { id: d.productSet.product.id } };
  console.log('created test product', variant.product.id);
} else console.log('test product exists', variant.product.id);

try {
  const pubs = await gql('{ publications(first: 20) { nodes { id name } } }');
  const input = pubs.publications.nodes.map((p) => ({ publicationId: p.id }));
  const d = await gql(`mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }`, { id: variant.product.id, input });
  console.log('published to:', pubs.publications.nodes.map((p) => p.name).join(', '), d.publishablePublish.userErrors.map((e) => e.message).join('; '));
} catch (e) {
  console.log('Could not publish automatically (needs read/write_publications). In Shopify admin, add the product to the sales channel used by the Storefront API.', String(e).slice(0, 200));
}

const callback = site + '/api/shopify-webhook';
const existing = await gql('{ webhookSubscriptions(first: 50) { nodes { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } }');
for (const topic of ['ORDERS_CREATE', 'ORDERS_PAID', 'ORDERS_CANCELLED', 'REFUNDS_CREATE']) {
  if (existing.webhookSubscriptions.nodes.some((w) => w.topic === topic && w.endpoint?.callbackUrl === callback)) { console.log('webhook exists', topic); continue; }
  const d = await gql(`mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { message } } }`,
    { topic, sub: { callbackUrl: callback, format: 'JSON' } });
  const err = d.webhookSubscriptionCreate.userErrors;
  console.log('webhook', topic, err.length ? 'ERROR ' + err.map((e) => e.message).join('; ') : 'registered');
}
console.log('\nAdd to data/aiva-products.json for', SKU + ':', JSON.stringify({ shopifyVariantId: variant.id }));
