-- Aiva Trading order database (Cloudflare D1, binding ORDERS_DB). Safe to re-run.
CREATE TABLE IF NOT EXISTS orders (
  session_id TEXT PRIMARY KEY,
  last_event_id TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  fulfillment_status TEXT NOT NULL DEFAULT 'new',
  customer_email TEXT,
  customer_name TEXT,
  amount_total INTEGER,
  currency TEXT,
  shipping_details_json TEXT,
  line_items_json TEXT,
  payment_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expected_total INTEGER, stock_applied INTEGER NOT NULL DEFAULT 0, payment_link_id TEXT, mode TEXT,
  paid_at INTEGER, refund_status TEXT, refunded_total INTEGER, review_reason TEXT
);
CREATE TABLE IF NOT EXISTS payment_events (event_id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inventory (sku TEXT PRIMARY KEY, stock INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS orders_payment_created ON orders(payment_status,created_at);
CREATE INDEX IF NOT EXISTS orders_payment_id ON orders(payment_id);
