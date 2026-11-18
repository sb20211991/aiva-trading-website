# Aiva Trading Limited — aivatrading.uk

Cloudflare Pages website for **Aiva Trading Limited** (company no. 17485509), served at [aivatrading.uk](https://aivatrading.uk).

## Checkout

The requested payment provider is now **Stripe in test mode only**, via Cloudflare Pages Functions under `functions/`. Existing Square Payment Links and optional PayPal code are preserved. `CHECKOUT_PROVIDER=stripe` prevents fallback to those providers.

See **[STRIPE-TEST-SETUP.md](STRIPE-TEST-SETUP.md)** for the test preview, separate test database, encrypted secret names, validation, and required approvals. Stripe live keys and live events are refused. No real products have been added.

The shop catalogue stays closed until real products are published:

- `data/aiva-products.json` has `shopEnabled: false` and `products: []`
- No live charges are taken from this repository alone

## Required Cloudflare secrets

For Stripe: encrypted **preview-only** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`,
with a separate `STRIPE_TEST_ORDERS_DB` binding. Do not reuse the Square database.
The public shop stays closed. The £1 fixture is available only on an explicitly enabled matching preview origin.

The preserved Square integration uses the following (never commit values):

- `SQUARE_ACCESS_TOKEN`
- `SQUARE_LOCATION_ID`
- `SQUARE_ENVIRONMENT` (`sandbox` until go-live)
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SQUARE_WEBHOOK_NOTIFICATION_URL`
- D1 binding `ORDERS_DB` (see `ORDER-DATABASE-SETUP.sql`)
- `MERCHANT_REFUND_SECRET` (for merchant refund tool)

Optional: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT`.

## Hardware

Website Payment Links do **not** require a physical Square card reader. In-person Tap to Pay / terminals are separate and are not part of this deploy.

## Local checks

```bash
npm test
```

## Deploy

Use Cloudflare Pages with this repository as the project root (Functions from `functions/`). Do not restore a root `_worker.js`.

### GitHub Actions (preview only)

Workflows under `.github/workflows/` run tests and can deploy a **Cloudflare Pages preview**:

- `square-sandbox-preflight.yml` — read-only project/config check
- `cloudflare-pages-preview.yml` — preview deploy (never production promote)

Required encrypted repository secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Workflows fail clearly if either secret name is missing or empty. Values must never be committed.
