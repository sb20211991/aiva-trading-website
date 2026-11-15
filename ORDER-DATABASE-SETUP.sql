-- Run ONCE in Cloudflare D1 Console, then bind database to Pages project as ORDERS_DB.
-- The database holds customer contact, order and delivery data: restrict access.
CREATE TABLE IF NOT EXISTS orders (
  session_id TEXT PRIMARY KEY,
  last_event_id TEXT NOT NULL,
  payment_status TEXT NOT NULL CHECK(payment_status IN ('pending','paid','failed','refunded')),
  fulfillment_status TEXT NOT NULL DEFAULT 'new' CHECK(fulfillment_status IN ('new','processing','shipped','cancelled','refunded')),
  customer_email TEXT,
  customer_name TEXT,
  amount_total INTEGER,
  currency TEXT,
  shipping_details_json TEXT,
  line_items_json TEXT,
  payment_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Square (and any future provider) webhook idempotency table.
CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

-- Kept for older Stripe-era databases; new events write to payment_events.
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_payment_created ON orders(payment_status,created_at);
CREATE INDEX IF NOT EXISTS orders_payment_id ON orders(payment_id);

-- If you already created orders without payment_id / refunded status, run these safely:
-- ALTER TABLE orders ADD COLUMN payment_id TEXT;
-- Recreate the table if SQLite rejects expanding the payment_status CHECK constraint.
