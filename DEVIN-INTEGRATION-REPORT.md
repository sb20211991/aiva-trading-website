# Devin integration report — Square-only checkout completion

**Date:** 19 November 2026 (Europe/London)

## Continue from PR #5 (Square-only)

This work continues the Square Payment Links checkout on `devin/1763498400-square-checkout` (PR #5). Do **not** merge PR #6 (dual Shopify provider) for payments. Square remains the only payment provider.

## Delivered here

- Wallet entry points restored on the Buying Guide (Card / Apple Pay / Google Pay) — all open the same Square hosted checkout
- AIVA branded scan-to-pay QR modal (local `qrcode-generator` encoding; no card data in QR)
- Failed / declined payment UX on scan polling, order-success, and order-cancelled pages
- `handleOrderStatus` prefers D1 payment_status before calling Square; maps CANCELED → failed
- Basket cleared only when `/api/order-status` reports `paid === true`
- Live stock from `/api/shop-status` applied on Shop and Buying Guide

## Safety

- Catalogue remains `testOnly`; `SQUARE_LIVE_PAYMENTS_APPROVED` is **not** set to `true`
- No live charges; sandbox / test wording retained
- Shopify and Stripe stay out of customer checkout assets

## Verification

`npm test` green (checkout + integrity + deployment + scan + build:pages).
