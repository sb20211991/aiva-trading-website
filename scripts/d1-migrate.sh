#!/usr/bin/env bash
# Optional manual D1 migration (needs a token with D1 edit). The Functions also self-migrate at runtime.
set -uo pipefail
DB=aiva_orders
npx --yes wrangler@4 d1 execute "$DB" --remote --file=ORDER-DATABASE-SETUP.sql -y
# Columns added after the first schema; "duplicate column" errors are expected on re-runs.
for col in "expected_total INTEGER" "stock_applied INTEGER NOT NULL DEFAULT 0" "payment_link_id TEXT" \
           "mode TEXT" "paid_at INTEGER" "refund_status TEXT" "refunded_total INTEGER" "review_reason TEXT"; do
  npx --yes wrangler@4 d1 execute "$DB" --remote -y --command "ALTER TABLE orders ADD COLUMN $col" >/dev/null 2>&1 \
    && echo "added column: $col" || echo "column present: ${col%% *}"
done
npx --yes wrangler@4 d1 execute "$DB" --remote -y --command "SELECT COUNT(*) AS orders FROM orders"
