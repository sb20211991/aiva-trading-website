#!/usr/bin/env bash
# Deploy Aiva Trading website with Cloudflare Pages Functions (functions/ directory).
# This must NOT upload a root _worker.js as a static asset.
#
# Usage:
#   ./scripts/deploy-pages.sh [project-name] [preview-branch]
# If preview-branch is set, wrangler deploys that Pages branch (preview).
# Omit preview-branch only for intentional production deploys outside CI.
set -euo pipefail
SITE="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${1:-aiva-trading}"
PREVIEW_BRANCH="${2:-}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in the environment."
  echo "Add them as GitHub Actions secrets (or Cursor secure secrets), then re-run."
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

DEPLOY_ARGS=(
  --project-name="$PROJECT"
  --commit-dirty=true
)
if [[ -n "$PREVIEW_BRANCH" ]]; then
  echo "Deploying Cloudflare Pages PREVIEW branch: $PREVIEW_BRANCH"
  DEPLOY_ARGS+=(--branch="$PREVIEW_BRANCH")
fi

npx --yes wrangler@4 pages deploy "$SITE" "${DEPLOY_ARGS[@]}"

echo
echo "Post-deploy checks:"
echo "  curl -sS https://aivatrading.uk/api/shop-status"
echo "    → must be JSON (not HTML 404)"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' https://aivatrading.uk/_worker.js"
echo "    → must be 404"
echo "Keep shopEnabled=false until Square sandbox payment succeeds."
