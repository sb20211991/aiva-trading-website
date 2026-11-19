AIVA TRADING LIMITED — MULTILINGUAL WEBSITE UPDATE — 10 NOV 2026

This ZIP is a full static site built from the earlier Aiva-Trading-Website-Upgrade.zip
and retains its existing HTML pages, images, CSS and JavaScript.

WHAT HAS CHANGED
- Adds a language selector in every website page header.
- Supports English and 25 other language selections, including Kurdish Sorani,
  Arabic, Turkish, Persian, Chinese (Simplified and Traditional), and major world languages.
- Selecting a translation opens Google's translated website version of the
  current page in the same tab. The user can navigate translated content via Google.
- This is not a professionally proofread translation or independently hosted
  multilingual site. Google controls the service and translations and may not
  support every region or language. Test language selections after upload.
- The embedded Google Translate Website Widget has been discontinued, so this
  implementation does not depend on its obsolete script.

HOW TO DEPLOY SAFELY
1. Cloudflare -> Workers & Pages -> your EXISTING site project -> Deployments.
2. Prefer a PREVIEW deployment first, not Production. Upload this ZIP (or extracted
   static site folder if required by Cloudflare) and check all pages and products.
3. Once verified, deploy to Production for the same project. Do NOT create a new
   unrelated project: it would not automatically replace your current domain.
4. Check home, shop, each category, enquiries, contact and language selector.

IMPORTANT
- Third-party translation may be inaccurate, particularly legal, prices,
  product technical details, and commercial terms. English source is authoritative.
- Google Translate may change availability or behaviour; this is not a guaranteed
  native translation integration or 25-language SEO solution.
- Stripe/payment settings are not modified by this package.
- A site's real operational readiness cannot be certified by this code change.
