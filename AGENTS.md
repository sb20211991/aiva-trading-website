# Aiva Trading website — active payment repair

- Preserve the existing website, design, non-payment content and completed work.
  Do not rebuild the site or replace it with another storefront.
- During this active task, the owner has authorized the main Replit coordinator
  alone to merge or deploy payment-related changes. Coordinate rather than merge
  another AI's competing payment implementation.
- Stripe is the intended provider. Keep test mode explicit, never silently fall
  back to Square, and preserve the existing Square/PayPal source without activating it.
- Keep live charges disabled until the owner's explicit activation approval.
  Final website publication is also awaiting owner approval.
- Preserve the buying guide's card, Apple Pay and Google Pay sections. Their buttons
  open Stripe checkout; do not promise wallet eligibility on every device.
- AIVA scan-to-pay is a branded handoff to Stripe, not a new payment network. Generate
  QR codes locally, validate destinations, and never encode secrets or client prices.
- Do not invent real products or prices. The public catalogue stays empty and closed.
  Synthetic fixtures require the explicit, exact-origin sandbox gates.
- Never print credentials, masked/partial keys or provider errors that repeat keys.
  Use encrypted configuration, not chat or repository files.
- Keep merchant tools and backend source out of public assets. Preserve private API
  authorization and the separate test-orders database.
- Run `npm ci --include=dev --ignore-scripts`, `npm test` and `npm run test:browser`.
  The Stripe HTTP regression tests are mocked; do not call them hosted payments.
- Keep Pages and Worker configuration isolated as documented. Root routing has not
  been verified through account APIs. Do not recreate custom domains or change DNS
  merely because the Pages association reports a pending CNAME.
- `main` still contains the original ZIP. Do not overwrite it or change the production
  branch as a shortcut. Continue the existing pull request and approval gates.
