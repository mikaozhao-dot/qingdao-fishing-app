BEGIN;

CREATE TABLE IF NOT EXISTS departure_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','authorized','converted','expired','withdrawn','closed')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  authorized_at timestamptz,
  authorization_expires_at timestamptz,
  accepted_at timestamptz,
  seat_inventory_id uuid REFERENCES seat_inventory(id) ON DELETE RESTRICT,
  hold_id uuid REFERENCES seat_holds(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES booking_orders(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (departure_id,user_id,request_key),
  CHECK ((status <> 'authorized') OR
    (authorized_at IS NOT NULL AND authorization_expires_at IS NOT NULL
      AND seat_inventory_id IS NOT NULL AND hold_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS departure_waitlist_queue_idx
  ON departure_waitlist_entries (departure_id,queued_at,id)
  WHERE status='waiting';
CREATE UNIQUE INDEX IF NOT EXISTS departure_waitlist_one_active_user_idx
  ON departure_waitlist_entries (departure_id,user_id)
  WHERE status IN ('waiting','authorized');

ALTER TABLE departures
  ADD COLUMN IF NOT EXISTS waitlist_window_closed_at timestamptz;

ALTER TABLE seat_inventory
  ADD COLUMN IF NOT EXISTS waitlist_released_at timestamptz;

ALTER TABLE seat_holds
  ADD COLUMN IF NOT EXISTS waitlist_entry_id uuid REFERENCES departure_waitlist_entries(id) ON DELETE RESTRICT;

ALTER TABLE booking_orders
  ADD COLUMN IF NOT EXISTS waitlist_entry_id uuid REFERENCES departure_waitlist_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cancelled_refund_fen integer CHECK (cancelled_refund_fen IS NULL OR cancelled_refund_fen >= 0),
  ADD COLUMN IF NOT EXISTS cancellation_penalty_fen integer CHECK (cancellation_penalty_fen IS NULL OR cancellation_penalty_fen >= 0);

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS late_success boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS refund_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  payment_transaction_id uuid REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  amount_fen integer NOT NULL CHECK (amount_fen > 0 AND amount_fen <= 2000000000),
  reason varchar(32) NOT NULL CHECK (reason IN ('customer_cancellation','late_waitlist_payment','supplement_failure')),
  status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sandbox_succeeded','manual_required')),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  request_key varchar(120) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (payment_transaction_id,reason)
);

CREATE INDEX IF NOT EXISTS refund_obligations_pending_idx
  ON refund_obligations (created_at,id) WHERE status='pending';

COMMIT;
