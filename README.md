# Aiva Trading Limited — aivatrading.uk

Cloudflare Pages website for **Aiva Trading Limited** (company no. 17485509), served at [aivatrading.uk](https://aivatrading.uk).

## Checkout

The requested payment provider is **Stripe**, defaulting to test mode via Cloudflare Pages Functions under `functions/`. Existing Square Payment Links and optional PayPal code are preserved. `CHECKOUT_PROVIDER=stripe` prevents fallback to those providers.

See **[STRIPE-TEST-SETUP.md](STRIPE-TEST-SETUP.md)** for setup, remaining access blockers and approvals. Live payments have a separate locked code path requiring explicit owner activation, live-only credentials/database, the real site origin and an approved Stripe account. They are NOT enabled. No real products have been added.

The shop catalogue stays closed until real products are published:

- `data/aiva-products.json` has `shopEnabled: false` and `products: []`
- No live charges are taken from this repository alone
- The catalogue editor and shared money rules support 16 currencies, including zero-decimal JPY; legacy GBP catalogues remain compatible. No currency conversion or mixed-currency basket is performed.

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

Build command: `npm run build:pages`. Upload directory: `.pages-output`.
Pages ignores `.assetsignore`, so never deploy the repository root directly.
The packaging script includes only website assets and the special Functions directory,
not workflow files, scripts, documentation or the original ZIP archive.

### GitHub Actions (preview only)

Workflows under `.github/workflows/` run tests and can deploy a **Cloudflare Pages preview**:

- `square-sandbox-preflight.yml` — read-only project/config check
- `cloudflare-pages-preview.yml` — preview deploy (never production promote)

Required encrypted repository secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Workflows fail clearly if either secret name is missing or empty. Values must never be committed.

### Production remains gated

The verified Pages project currently lists `app.aivatrading.uk`, not the requested
root `aivatrading.uk`. Do not assume a successful Pages upload updates the root.
The initial closed-shop production workflow requires explicit approval, an exact
reviewed commit and active root-domain association, then verifies the deployed
revision. Historical mutating infrastructure workflows are retained but disabled.
No DNS change, production promotion or real Stripe payment has been performed.
