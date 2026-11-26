# Aiva Crypto Pay — "₿ Pay with Cryptocurrency"

Status: **built and tested against a mocked BitPay. Not live.** Live crypto payments stay off until every item under
"Before live transactions" is done.

## What it does

- A **₿ Pay with Cryptocurrency** button sits beside the existing checkout buttons on:
  - aivatrading.uk `shop.html` (basket) and `buying-guide.html` (direct checkout)
  - app.aivatrading.uk, Aiva Shop & Pay checkout (next to "Pay securely")
- Coins: Bitcoin (BTC), Ethereum (ETH), Tether (USDT), USD Coin (USDC), Litecoin (LTC), Solana (SOL).
- The customer stays in an Aiva dialog: coin choice with live GBP estimates, then the exact amount, a QR code, an
  "Open in my wallet app" link, an optional embedded BitPay panel for WalletConnect / MetaMask / Coinbase / Phantom,
  a price-hold countdown and automatic confirmation. The BitPay page is only a fallback link.
- Existing card, Apple Pay, Google Pay, Alipay, WeChat Pay and the app's existing BitPay option are untouched.

## One shared backend

`functions/_lib/crypto-pay.js` (website Pages project `aiva-trading`), endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/crypto-rates?amountPence=` | Live GBP rates (BitPay, then Coinbase) and availability |
| `POST /api/crypto-checkout` | Prices the basket from the server catalogue, creates the BitPay invoice, records the order in D1 `ORDERS_DB` (`provider='bitpay'`) |
| `GET /api/crypto-status?orderId=` | Reads the invoice back from BitPay and confirms the order when paid |
| `POST /api/crypto-webhook` | BitPay notification; the body is never trusted — the invoice is re-read from BitPay |

The Super App reaches the same endpoints through its existing `/api/*` forwarder
(`pocket-hub/functions/api/[[path]].js`), so both platforms share one backend, one order database and one credential.

Safety: server-side prices and stock; GBP amount must match the order exactly; partial / late / invalid payments go to
manual review; test-network payments never change live stock; live stock is reduced exactly once.

## Gateway: BitPay

UK merchants are accepted, invoices are priced in GBP and BitPay can settle to a UK bank account in GBP. It supports all
six coins (USDT/USDC on several networks, including Solana). Coinbase Commerce is closed to UK merchants and Stripe's
crypto acceptance is US-only stablecoins, so BitPay is the fit here.

## Configuration

`wrangler.toml` (committed, website project):

```
BITPAY_ENV = "test"                      # "prod" for live
CRYPTO_LIVE_PAYMENTS_APPROVED = "false"  # "true" only after approval + passed test run
```

Cloudflare Pages **secret** on project `aiva-trading` (never committed):

- `BITPAY_TOKEN` — BitPay API token, *merchant* (POS) facade. Test token from test.bitpay.com while `BITPAY_ENV="test"`.
- Optional `CRYPTO_WEBHOOK_URL` — defaults to `https://<website>/api/crypto-webhook`.

Add it with: `npx wrangler pages secret put BITPAY_TOKEN --project-name aiva-trading`
(or Cloudflare dashboard → Workers & Pages → aiva-trading → Settings → Variables and Secrets → Encrypt).

Without a token the button is shown but disabled with "being connected"; nothing else changes.

## Testing

- `npm run test:crypto` — backend flow (mocked BitPay, real SQLite D1): gates, rates, website and app-forwarded
  checkout, QR/wallet details, polling, verified webhook, forged webhook, amount mismatch, partial, expiry, stock once.
- `npm run test:crypto-browser` — Chrome + Playwright, both platforms: add product → ₿ button → choose coin → QR →
  confirmation.
- Still required (needs the BitPay test token): a real test.bitpay.com run on a preview deployment of **both**
  platforms, paying with testnet coins, and confirming the order flips to paid via `/api/crypto-webhook`.

## Before live transactions (owner)

1. Open / finish a BitPay merchant account for Aiva Trading Limited (company 17485509): KYB documents, director ID,
   proof of address, business website review, and the UK bank account for GBP settlement.
2. In BitPay settings: enable BTC, ETH, USDT, USDC, LTC, SOL; set settlement to **GBP, 100%** to the UK bank account.
3. Create the API token(s): test token on test.bitpay.com and production token on bitpay.com (merchant facade).
4. Store the test token as `BITPAY_TOKEN`, deploy a preview, and run the real testnet payment on both platforms.
5. Check the terms: BitPay's processing fee, refunds (crypto refunds go via BitPay to the buyer's wallet) and the
   shop's returns policy wording (the current text is marked "DRAFT FOR REVIEW").
6. Only then: production token as `BITPAY_TOKEN`, `BITPAY_ENV = "prod"`, `CRYPTO_LIVE_PAYMENTS_APPROVED = "true"`.
