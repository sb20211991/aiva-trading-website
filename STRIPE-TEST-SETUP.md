# Stripe test checkout — review and approvals

This continues the existing website, based on `cursor/cloudflare-github-deploy-1f19`.
It does not replace the homepage, branding, categories, or existing Square/PayPal implementations.
`main` currently contains only the original ZIP, so do not merge deployment code into
`main`, change the production branch, or promote a build without reviewing the repository setup.
The two existing Square pull requests are not merged or superseded by this change.

## Safety defaults

- `CHECKOUT_PROVIDER=stripe` explicitly selects Stripe. Missing Stripe configuration cannot fall back to Square.
- Stripe defaults to **test mode**. Live keys/events cannot enter the test environment.
  A future live code path is present but locked behind the independent approval,
  credentials, account and database checks described below. No live settings are enabled.
- The public catalogue stays empty with `shopEnabled:false`.
- A clearly labelled £1 fixture is used only when all three conditions match:
  `STRIPE_TEST_CHECKOUT_ENABLED=true`, `CHECKOUT_PROVIDER=stripe`, and the request
  comes from the exact `STRIPE_TEST_ORIGIN`, which must be a `.pages.dev` HTTPS
  preview, an HTTPS Worker preview on this account's `.sb20211991.workers.dev`
  subdomain, or localhost for local development. Root-domain fixtures stay prohibited.
- The fixture cannot be purchased through Square/PayPal live mode, even if copied into their catalogue.
- Test orders use **STRIPE_TEST_ORDERS_DB**, never the existing `ORDERS_DB`.
- No test order triggers fulfilment. Test refunds are managed in the Stripe test dashboard;
  the existing Square refund tool is NOT a Stripe refund tool.

## What has been verified locally

Use Node 22.13+ or Node 24. Install the pinned dependencies with
`npm ci --include=dev --ignore-scripts`, then run `npm test`.
The only shipped library is the MIT-licensed local QR encoder; the independent QR
decoder is a development-only verification dependency and is not uploaded.

The existing mocked Square/PayPal checkout and static website checks pass.
The Stripe suite uses mocked HTTP and a real in-memory SQLite database loaded
with `ORDER-DATABASE-SETUP.sql`. It covers server-side prices, quantities and stock,
preview-only fixtures, missing/live credentials, foreign origins, trusted Stripe
redirects, API failures, unpaid vs paid session verification, webhook HMAC and
five-minute replay tolerance, signature rotation, duplicates, event ordering,
database failure, atomic rollback, and retry recovery.
There are now 31 payment test groups, including EUR/JPY prices, bounded streaming request-size
limits, line-item/shipping persistence, synthetic live-account approval failures,
strict live origins, and test/live database separation. Every Stripe HTTP call
in these tests is mocked, including those exercising the future live code path.

Wrangler 4 also compiled the Pages Functions successfully. The preview deployment
helper was checked to refuse execution without its explicit approval flag; no
manual deployment was made during these checks. Existing PR automation created a
closed-shop preview, which confirmed the API works and checkout is disabled.

That preview also revealed that Pages does not honor `.assetsignore`: a workflow
file was publicly served. Deployment entry points now build and upload an explicit
`.pages-output` directory instead of the repository root. No existing website
pages/assets are removed. The packaging check prevents repository metadata,
configuration, scripts, documentation and archives from entering the upload directory.

**These checks are not a completed hosted Stripe payment.**

## Buying guide, wallet sections and AIVA scan-to-pay

The card, Apple Pay and Google Pay sections have been restored to the live site's
three-card layout. They use the same Stripe-hosted checkout; actual wallet
availability still depends on Stripe, browser, device and account eligibility.
The non-payment buying-guide content is preserved.

The additional **AIVA · Scan to pay** control creates a QR locally after the server
creates a checkout session. It encodes only a validated HTTPS Stripe checkout URL,
not an API credential, card details, or a caller-supplied amount. The modal clearly
labels test mode, polls the existing verified status endpoint, restores keyboard
focus when dismissed, and never treats a redirect alone as payment confirmation.
Checkout QR codes expire with their Stripe sessions and are not permanent merchant
codes.

`productPaymentUrl` and `productQrMatrix` prepare permanent, branded product links
for future real SKUs. A product link opens the existing buying guide, where a valid,
available catalogue SKU and quantity must be reviewed before payment. No real
products or prices have been invented.

Independent decoding tests recover the exact checkout and future-product URLs.
Real Chromium checks cover 24 page/viewport combinations plus navigation resizing,
the restored wallet sections, QR rendering, dismissal and focus restoration.
These are synthetic/local checks, not completed Stripe transactions.

## Deployment packaging and remaining access

Pages and Workers configuration are deliberately separate. `wrangler.toml` remains
the existing Pages configuration; `wrangler.jsonc` supplies the existing Worker's
entry point and a thin adapter around the same payment handlers. No website is
rebuilt. Pages deployments use `scripts/prepare-pages-deploy.mjs` in an isolated
directory because Pages deploy rejects custom `--config` paths. Backend Functions
remain outside the public upload directory.

New preview uploads exclude merchant administration pages and repository internals.
The existing production deployment and older immutable previews are not changed by
that exclusion. The refund API continues to require the merchant secret.

GitHub's Pages preview now deploys successfully. The separate native Cloudflare
Worker build still fails; the connected account cannot read its build logs or
verify the root Worker domain binding. Do not guess the cause, reassign root DNS,
or promote an unverified build. The production branch guard blocks native Worker
publication while this repair branch is being reviewed.

The inspected Pages preview configuration has no Stripe test API key, webhook
secret or dedicated test orders database. The available GitHub Cloudflare token
cannot administer D1, and the conversational Cloudflare connection currently has
identity/account scope only. Owner authorization is needed to access those
resources. Credentials must use encrypted settings, never chat or repository files.
Until then, actual hosted success, decline and webhook delivery remain **not run**.
Final publication and live-charge activation are separate owner approvals.
`/api/shop-status` reports local configuration readiness, not proven Stripe
account readiness or successful deployment. A real test-session API call and
Stripe-hosted test checkout are still required after configuration.

## Required approvals and setup

1. **Review the pull request.** It targets the existing deployment-development
   branch, not the ZIP-only `main` branch. Do not run old infrastructure workflows
   that replace Cloudflare environment variables. Existing PR workflows may
   automatically build a closed-shop preview; that is not the configured Stripe test preview.
2. **Extend the existing GitHub deployment connection only where necessary.**
   Its encrypted Cloudflare credentials successfully read and deploy the existing
   Pages project. A read-only inventory verified `app.aivatrading.uk` is attached,
   but `aivatrading.uk` is not in that project's domain list. D1 listing returned
   HTTP 401 and Worker custom-domain listing returned HTTP 403. Allow D1 edit for
   the dedicated test database and read access to the actual root zone, DNS and
   Worker routing. Keep the existing Pages access. Confirm the correct owning
   Cloudflare account instead of blindly moving DNS. Update the existing
   encrypted GitHub deployment credential only if needed; never paste it in chat.
   Repairing the separate Replit Cloudflare connection is optional, not a
   prerequisite when the GitHub route has adequate permissions.
3. **Approve a separate test D1 database.** Create `aiva_stripe_test_orders`,
   run `ORDER-DATABASE-SETUP.sql` against that database only, and use its ID for
   `STRIPE_TEST_ORDERS_DB`. Do not run migrations or test inserts against the
   existing Square order database. Creating resources may affect Cloudflare usage.
4. **Configure encrypted Cloudflare Pages PREVIEW secrets**, not production:
   `STRIPE_SECRET_KEY` (a Stripe test-mode server secret; restricted keys must also
   allow the Checkout and expanded product/line-item reads used here) and
   `STRIPE_WEBHOOK_SECRET` (the signing secret
   for the exact test webhook endpoint). Enter them in Cloudflare's encrypted
   secret controls. Hosted Checkout does not need a publishable key in this site.
5. **Approve creation of a Stripe test webhook endpoint** in the Stripe test
   dashboard for `https://stripe-test.aiva-trading.pages.dev/api/stripe-webhook`.
   This is the expected alias for branch `stripe-test` on existing Pages project
   `aiva-trading`; confirm Cloudflare actually provides that alias before registering
   the webhook. Select `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, and `checkout.session.expired`.
   Use snapshot events and API version `2025-02-24.acacia`, matching the server's
   pinned API version. A CLI signing secret is not interchangeable with the
   dashboard endpoint signing secret.
6. **Approve and deploy the Stripe test preview**, with no production promotion.
   The helper below uses a temporary Wrangler config so the default closed-shop
   config is not edited. It binds only the separate Stripe test database and
   always passes `--branch=stripe-test`. Before deployment it reads Cloudflare
   configuration to verify that this branch is not production, the preview
   origin matches the actual project subdomain, both encrypted preview secrets
   exist, and the chosen database is not used by production or Square.
   This changes the shared Pages preview
   environment configuration, not production; coordinate with anyone still testing Square previews.

   Run from the reviewed checkout, with Cloudflare credentials supplied through
   encrypted runner secrets, not literal command-line values:

   ```sh
   npm test
   # Set these non-secret environment variables in the runner:
   # APPROVE_STRIPE_TEST_PREVIEW=true
   # STRIPE_TEST_ORIGIN=https://stripe-test.aiva-trading.pages.dev
   # STRIPE_TEST_ORDERS_DB_ID=<the separate test database ID>
   # Encrypted runner secrets: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
   npm run stripe:preview
   ```

   The normal existing preview workflow intentionally keeps test checkout
   disabled because `wrangler.toml` sets `STRIPE_TEST_CHECKOUT_ENABLED=false`.
   Setting only dashboard plain-text vars may be overwritten on deployment;
   use the explicit preview helper instead. The helper requires `npx` and Wrangler 4.

## Hosted acceptance checks (still required)

1. On `https://aivatrading.uk/api/shop-status`, checkout must remain closed;
   the existing live deployment currently returns HTML 404, not an active API.
   This PR alone does not change that live deployment.
2. On the approved preview, `GET /api/shop-status` must return JSON with
   `provider:"stripe"`, `mode:"test"`, `ready:true`, `webhookConfigured:true`,
   `orderDatabaseConfigured:true`, and the test catalogue path.
3. Add the labelled £1 test fixture to the basket. Continue from both the shop
   and buying guide. Confirm the total on Stripe hosted Checkout and its test-mode
   banner. Use Stripe's documented test card details only, never a real card.
4. Cancel: return to `order-cancelled.html`, with the basket retained. That page
   must not claim an order was paid or imply a refund was issued.
5. Complete a successful test payment. The return page must say
   `TEST PAYMENT CONFIRMED — no real money charged`.
   A visit to the success URL alone must never mark an unpaid session paid.
6. Verify the signed webhook returns HTTP 200 and exactly one paid test order
   exists in the separate D1 database. Replay the event and confirm no duplicate.
   A success-page confirmation proves Stripe verification, not webhook persistence;
   check both independently.
7. Test Stripe's declined-card and authentication-required test scenarios.
   Unpaid sessions must not be shown as paid.
8. Confirm the public domain never exposes a buyable fixture.

## Future currencies and product editing

The existing catalogue builder now imports/exports GBP, EUR, USD, CAD, AUD, NZD,
CHF, JPY, SEK, NOK, DKK, SGD, HKD, AED, SAR and QAR. One catalogue/order uses one
currency; there is no automatic exchange conversion. Currency cannot be changed
over existing products in the editor. Import an independently repriced catalogue
or start empty. Merchant-country, currency minimums and Stripe availability still apply.

Use integer `priceMinor`, `shipping.flatRateMinor` and optional
`shipping.freeShippingThresholdMinor`. For example, EUR 12.50 is `1250`; JPY 1250
is `1250`. Legacy `pricePence`/shipping pence fields remain supported for GBP only.
Mixed-currency products are unavailable; fractional minor units are rejected.
The browser and server share the same rules, but the server remains authoritative.
The public catalogue is still empty and disabled; no real products were invented.

## Future live mode — prepared, NOT activated or verified with Stripe

All of the following are required, not just adding a live key:

- Owner approval **after** the hosted test acceptance checklist succeeds.
- `STRIPE_MODE=live`, `STRIPE_LIVE_PAYMENTS_APPROVED=true`, and
  `STRIPE_LIVE_ORIGIN=https://aivatrading.uk` (or its explicitly selected `www` origin).
- Separate encrypted `STRIPE_LIVE_SECRET_KEY` and `STRIPE_LIVE_WEBHOOK_SECRET`.
- A separate production D1 binding `STRIPE_LIVE_ORDERS_DB`, not the test or Square
  database, initialized with the order schema. Validate the actual database IDs.
- A live-mode webhook for the real site's endpoint. Test/live keys, event modes,
  session IDs, integration metadata and database bindings are kept separate.
- A live Stripe `/account` response confirming submitted business details,
  enabled charges and payouts, and active card-payments capability.
- Owner-approved genuine products, stock, shipping countries/prices, tax treatment,
  address, delivery/returns terms, refund operations and order-fulfilment process.

The live path refuses arbitrary origins and Pages previews, never loads the
temporary test fixture, and does not create a Session for an unapproved account.
It supports card payments through hosted Checkout. Apple Pay/Google Pay are
eligible wallet options on Stripe Checkout, not guaranteed buttons on every
device/account. Their actual appearance still needs supported-device testing.
No real charge, payout, account approval or wallet-device test has been performed.
No automatic stock reservation, order fulfilment or Stripe refund automation is
claimed. Manage refunds in the appropriate Stripe dashboard; do not use the
preserved Square refund tool for Stripe orders.

## Production deployment safeguards

The existing automatic closed-shop PR preview remains available. Historical
infrastructure/recovery workflow files are retained, but their mutating jobs are
disabled: a catalogue merge must not create KV/R2, replace secrets, change root
routing or silently promote production.

The initial production workflow now requires an explicit approval checkbox and
the exact reviewed commit, then reads Cloudflare to verify the requested root
custom domain is attached and active. It explicitly deploys to the verified Pages
production branch; omitting `--branch` does **not** reliably mean production.
It verifies the exact public `deployment.json` revision and closed-shop API state,
not merely an HTTP 200. It never changes DNS.

This initial release helper accepts only the closed, empty public catalogue and
disabled payment flags. Live activation is a separate owner-reviewed release,
not a side effect of approving this code. Do not dispatch it until root ownership
and routing have been investigated and the exact release is approved.
GitHub manual workflows may first need an approved default-branch setup because
the current `main` branch contains only the original ZIP.

References: [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create),
[webhook signatures](https://docs.stripe.com/webhooks/signature),
[Stripe testing](https://docs.stripe.com/testing),
[supported currencies](https://docs.stripe.com/currencies),
[Apple Pay with hosted Checkout](https://docs.stripe.com/apple-pay),
[Google Pay](https://docs.stripe.com/google-pay).
