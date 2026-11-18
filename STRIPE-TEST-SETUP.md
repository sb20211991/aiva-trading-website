# Stripe test checkout — review and approvals

This continues the existing website, based on `cursor/cloudflare-github-deploy-1f19`.
It does not replace the homepage, branding, categories, or existing Square/PayPal implementations.
`main` currently contains only the original ZIP, so do not merge deployment code into
`main`, change the production branch, or promote a build without reviewing the repository setup.
The two existing Square pull requests are not merged or superseded by this change.

## Safety defaults

- `CHECKOUT_PROVIDER=stripe` explicitly selects Stripe. Missing Stripe configuration cannot fall back to Square.
- Stripe accepts **test keys only**. Live keys, live sessions and live webhook events are rejected.
- The public catalogue stays empty with `shopEnabled:false`.
- A clearly labelled £1 fixture is used only when all three conditions match:
  `STRIPE_TEST_CHECKOUT_ENABLED=true`, `CHECKOUT_PROVIDER=stripe`, and the request
  comes from the exact `STRIPE_TEST_ORIGIN`, which must be a `.pages.dev` HTTPS
  preview (or localhost for local development).
- The fixture cannot be purchased through Square/PayPal live mode, even if copied into their catalogue.
- Test orders use **STRIPE_TEST_ORDERS_DB**, never the existing `ORDERS_DB`.
- No test order triggers fulfilment. Test refunds are managed in the Stripe test dashboard;
  the existing Square refund tool is NOT a Stripe refund tool.

## What has been verified locally

Run `npm test` with Node 22.13+ or Node 24. No npm dependencies are needed.

The existing mocked Square/PayPal checkout and static website checks pass.
The Stripe suite uses mocked HTTP and a real in-memory SQLite database loaded
with `ORDER-DATABASE-SETUP.sql`. It covers server-side prices, quantities and stock,
preview-only fixtures, missing/live credentials, foreign origins, trusted Stripe
redirects, API failures, unpaid vs paid session verification, webhook HMAC and
five-minute replay tolerance, signature rotation, duplicates, event ordering,
database failure, atomic rollback, and retry recovery.

Wrangler 4 also compiled the Pages Functions successfully. The preview deployment
helper was checked to refuse execution without its explicit approval flag; no
deployment was made during these checks.

**These checks are not a completed hosted Stripe payment.**
`/api/shop-status` reports local configuration readiness, not proven Stripe
account readiness or successful deployment. A real test-session API call and
Stripe-hosted test checkout are still required after configuration.

## Required approvals and setup

1. **Review the pull request.** It targets the existing deployment-development
   branch, not the ZIP-only `main` branch. Do not run old infrastructure workflows
   that replace Cloudflare environment variables. Existing PR workflows may
   automatically build a closed-shop preview; that is not the configured Stripe test preview.
2. **Restore Cloudflare API access in Replit Integrations.** The saved connection
   returned `Invalid format for Authorization header`. Supply a raw valid API token
   in its credential field, not a `Bearer ` prefix. Never put credentials in chat,
   repository files, documentation, workflow logs, or PR comments.
   GitHub deployment credentials are separate from this conversation's connection.
3. **Approve a separate test D1 database.** Create `aiva_stripe_test_orders`,
   run `ORDER-DATABASE-SETUP.sql` against that database only, and use its ID for
   `STRIPE_TEST_ORDERS_DB`. Do not run migrations or test inserts against the
   existing Square order database. Creating resources may affect Cloudflare usage.
4. **Configure encrypted Cloudflare Pages PREVIEW secrets**, not production:
   `STRIPE_SECRET_KEY` (a Stripe test-mode secret or restricted key with Checkout
   Sessions write/read permissions) and `STRIPE_WEBHOOK_SECRET` (the signing secret
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
4. Cancel: return to the shop without a paid order or fulfilment.
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

## Not authorized or implemented by this test-only change

- No live-mode Stripe payments, real products, shipping/tax decisions, fulfilment,
  production database changes, payout verification, or production promotion.
- Production release needs separate approval of the code/deployment, merchant
  activation, real catalogue and stock, policies, tax/shipping, refund workflow
  and live payment support. This code deliberately refuses live keys.

References: [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create),
[webhook signatures](https://docs.stripe.com/webhooks/signature),
[Stripe testing](https://docs.stripe.com/testing).
