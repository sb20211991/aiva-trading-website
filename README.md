# Aiva Trading Limited — aivatrading.uk

Cloudflare Pages website for **Aiva Trading Limited** (company no. 17485509), served at [aivatrading.uk](https://aivatrading.uk).

## Checkout

Checkout runs in Cloudflare Pages Functions under `functions/`. `CHECKOUT_PROVIDER` in `wrangler.toml` selects **Square** (default, active) or **Shopify**. Prices, stock and totals always come from the server catalogue and the D1 `ORDERS_DB`.

- Square: sandbox until `SQUARE_ENVIRONMENT="production"` and `SQUARE_LIVE_PAYMENTS_APPROVED="true"`.
- Shopify: test mode needs `SHOPIFY_TEST_GATEWAY_CONFIRMED="true"`; live needs `SHOPIFY_LIVE_PAYMENTS_APPROVED="true"`. Both default to `"false"`.
- Existing orders keep using the provider that took them for status checks and refunds.

`YOUR-NEXT-STEP.txt` is the release and live-activation runbook. Production deploys run only on push to `main` (`.github/workflows/deploy-production.yml`).

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

## Cryptocurrency (Aiva Crypto Pay)

A "₿ Pay with Cryptocurrency" button (BTC, ETH, USDT, USDC, LTC, SOL via BitPay, GBP settlement) is shared by this
website and the Super App through one backend (`functions/_lib/crypto-pay.js`). Off until the `BITPAY_TOKEN` secret is
set; live only with `BITPAY_ENV="prod"` and `CRYPTO_LIVE_PAYMENTS_APPROVED="true"`. See `CRYPTO-PAYMENTS.md`.

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

### GitHub Actions

- `ci.yml` — `npm test` on every pull request and branch push.
- `cloudflare-pages-preview.yml` — preview deploy for pull requests (never promotes production).
- `deploy-production.yml` — every push to `main` is tested, deployed to the `aiva-trading` Pages project
  (aivatrading.uk + www) and smoke-checked. Payment secrets can be installed via its encrypted handoff.
- `cloudflare-pages-production.yml` — manual, approval-gated deploy of an exact reviewed commit.

Required encrypted repository secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`. Values must never be committed.

## Payments

`CHECKOUT_PROVIDER` in `wrangler.toml` selects `square` (current) or `shopify`. Live payments stay off
until `SQUARE_LIVE_PAYMENTS_APPROVED` / `SHOPIFY_LIVE_PAYMENTS_APPROVED` is set to `true` with the owner's
approval, and never while the catalogue is `testOnly`.

Shopify (Storefront Cart API + hosted checkout; webhooks to `/api/shopify-webhook`):

1. Pages secrets: `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_WEBHOOK_SECRET` (app API secret key), `SHOPIFY_ADMIN_TOKEN`.
2. Set `SHOPIFY_STORE_DOMAIN` in `wrangler.toml`.
3. `node scripts/shopify-setup.mjs` creates the £1 test product and registers webhooks; add the printed
   `shopifyVariantId` to the product in `data/aiva-products.json`.
4. Set `CHECKOUT_PROVIDER = "shopify"`, deploy, then run `node scripts/shopify-test-e2e.mjs`
   (Shopify test mode / Bogus Gateway: success, declined, cancelled, refund).

Refunds for Shopify orders are made in Shopify admin and recorded on the website automatically.
