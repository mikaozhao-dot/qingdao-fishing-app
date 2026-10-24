BEGIN;

CREATE TABLE IF NOT EXISTS seat_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'released', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE INDEX IF NOT EXISTS seat_holds_user_idx ON seat_holds (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS seat_holds_expiry_idx ON seat_holds (expires_at) WHERE status = 'active';

ALTER TABLE seat_inventory
  ADD COLUMN IF NOT EXISTS hold_id uuid REFERENCES seat_holds(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS seat_inventory_hold_idx ON seat_inventory (hold_id) WHERE hold_id IS NOT NULL;

ALTER TABLE booking_orders
  ADD COLUMN IF NOT EXISTS hold_id uuid REFERENCES seat_holds(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(100);
ALTER TABLE seat_holds
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES booking_orders(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS booking_orders_buyer_idempotency_idx
  ON booking_orders (buyer_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS seat_hold_items (
  hold_id uuid NOT NULL REFERENCES seat_holds(id) ON DELETE CASCADE,
  seat_inventory_id uuid NOT NULL REFERENCES seat_inventory(id) ON DELETE RESTRICT,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 30),
  price_fen integer NOT NULL CHECK (price_fen >= 0),
  is_premium boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'released')),
  PRIMARY KEY (hold_id, seat_inventory_id),
  UNIQUE (hold_id, seat_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS seat_hold_items_active_seat_idx
  ON seat_hold_items (seat_inventory_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS booking_order_seats (
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE CASCADE,
  seat_inventory_id uuid NOT NULL REFERENCES seat_inventory(id) ON DELETE RESTRICT,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 30),
  price_fen integer NOT NULL CHECK (price_fen >= 0),
  status varchar(20) NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, seat_inventory_id),
  UNIQUE (order_id, seat_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_order_seats_active_seat_idx
  ON booking_order_seats (seat_inventory_id)
  WHERE status IN ('pending_payment', 'paid');

ALTER TABLE order_passengers
  ADD COLUMN IF NOT EXISTS seat_inventory_id uuid REFERENCES seat_inventory(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS order_passengers_order_seat_idx
  ON order_passengers (order_id, seat_inventory_id) WHERE seat_inventory_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  adapter_code varchar(24) NOT NULL DEFAULT 'sandbox'
    CHECK (adapter_code = 'sandbox'),
  provider_reference varchar(100) NOT NULL UNIQUE,
  amount_fen integer NOT NULL CHECK (amount_fen >= 0),
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'timed_out')),
  callback_event_id varchar(120) UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_order_active_idx
  ON payment_transactions (order_id) WHERE status IN ('pending', 'succeeded');

COMMIT;
