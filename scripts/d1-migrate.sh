#!/usr/bin/env bash
# Idempotent D1 migration for the remote aiva_orders database.
set -uo pipefail
DB=aiva_orders
npx --yes wrangler@4 d1 execute "$DB" --remote --file=ORDER-DATABASE-SETUP.sql -y
# Columns added after the first schema; "duplicate column" errors are expected on re-runs.
for col in "expected_total INTEGER" "stock_applied INTEGER NOT NULL DEFAULT 0" "payment_link_id TEXT" \
           "mode TEXT" "paid_at INTEGER" "refund_status TEXT" "refunded_total INTEGER"; do
  npx --yes wrangler@4 d1 execute "$DB" --remote -y --command "ALTER TABLE orders ADD COLUMN $col" >/dev/null 2>&1 \
    && echo "added column: $col" || echo "column present: ${col%% *}"
done
# Older databases had a CHECK constraint on payment_status without 'review'; rebuild if needed.
npx --yes wrangler@4 d1 execute "$DB" --remote -y --json --command "SELECT sql FROM sqlite_master WHERE name='orders'" | grep -q "CHECK(payment_status" && {
  echo "rebuilding orders table without legacy CHECK constraints"
  npx --yes wrangler@4 d1 execute "$DB" --remote -y --command "CREATE TABLE orders_new (session_id TEXT PRIMARY KEY,last_event_id TEXT NOT NULL,payment_status TEXT NOT NULL,fulfillment_status TEXT NOT NULL DEFAULT 'new',customer_email TEXT,customer_name TEXT,amount_total INTEGER,currency TEXT,shipping_details_json TEXT,line_items_json TEXT,payment_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expected_total INTEGER,stock_applied INTEGER NOT NULL DEFAULT 0,payment_link_id TEXT,mode TEXT,paid_at INTEGER,refund_status TEXT,refunded_total INTEGER); INSERT INTO orders_new (session_id,last_event_id,payment_status,fulfillment_status,customer_email,customer_name,amount_total,currency,shipping_details_json,line_items_json,payment_id,created_at,updated_at,expected_total,stock_applied,payment_link_id,mode,paid_at,refund_status,refunded_total) SELECT session_id,last_event_id,payment_status,fulfillment_status,customer_email,customer_name,amount_total,currency,shipping_details_json,line_items_json,payment_id,created_at,updated_at,expected_total,stock_applied,payment_link_id,mode,paid_at,refund_status,refunded_total FROM orders; DROP TABLE orders; ALTER TABLE orders_new RENAME TO orders; CREATE INDEX IF NOT EXISTS orders_payment_created ON orders(payment_status,created_at); CREATE INDEX IF NOT EXISTS orders_payment_id ON orders(payment_id);"
}
npx --yes wrangler@4 d1 execute "$DB" --remote -y --command "SELECT COUNT(*) AS orders FROM orders"
