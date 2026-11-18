#!/usr/bin/env bash
# Reviewed, closed-shop production deployment only. Never promotes implicitly.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-aiva-trading}" != "aiva-trading" ]]; then
  echo "Refusing a different project: continue through the existing Aiva repository."
  exit 1
fi
npm test
node scripts/promote-production.mjs
