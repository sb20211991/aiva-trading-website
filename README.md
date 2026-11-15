# Aiva Trading Limited — aivatrading.uk

Cloudflare Pages website for **Aiva Trading Limited** (company no. 17485509), served at [aivatrading.uk](https://aivatrading.uk).

## Checkout

Online checkout uses **Square Payment Links** via Cloudflare Pages Functions under `functions/`. Customers pay on Square-hosted checkout (card, Apple Pay, and Google Pay where eligible). Optional PayPal can be enabled with separate secrets.

The shop catalogue stays closed until real products are published:

- `data/aiva-products.json` has `shopEnabled: false` and `products: []`
- No live charges are taken from this repository alone

## Required Cloudflare secrets

Set these in the Cloudflare Pages project (never commit values):

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
