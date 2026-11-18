#!/usr/bin/env bash
# Deploy Aiva Trading website with Cloudflare Pages Functions (functions/ directory).
# This must NOT upload a root _worker.js as a static asset.
set -euo pipefail
SITE="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${1:-aiva-trading}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in the environment."
  echo "Add them in the Cursor secure secrets form, then re-run."
  exit 1
fi

if [[ -f "$SITE/_worker.js" ]]; then
  echo "Refusing deploy: $SITE/_worker.js exists."
  echo "Use functions/ only so the worker is not served as a static file."
  exit 1
fi

if [[ ! -f "$SITE/functions/api/shop-status.js" ]]; then
  echo "Missing functions/api/shop-status.js"
  exit 1
fi

echo "Deploying Pages project '$PROJECT' WITH Functions Worker backend (functions/)…"
echo "Static design/pages are preserved; only /api/* is handled by the Worker."

cd "$SITE"
node scripts/build-pages-assets.mjs
npx --yes wrangler@4 pages deploy "$SITE/.pages-output" \
  --project-name="$PROJECT" \
  --commit-dirty=true

echo
echo "Post-deploy checks:"
echo "  curl -sS https://aivatrading.uk/api/shop-status"
echo "    → must be JSON (not HTML 404) — then Cloudflare is ready for Square secrets"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' https://aivatrading.uk/_worker.js"
echo "    → must be 404"
echo
echo "Add Square secrets in Cloudflare Pages → Settings → Environment variables"
echo "(Production + Preview), or via Cursor Secrets then re-deploy."
echo "The public catalogue is empty and closed. See STRIPE-TEST-SETUP.md for the separate approved Stripe test preview."
