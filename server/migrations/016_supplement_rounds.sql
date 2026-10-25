BEGIN;

CREATE TABLE IF NOT EXISTS departure_supplement_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL UNIQUE REFERENCES departures(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'collecting_consent'
    CHECK (status IN ('collecting_consent','collecting_payment','succeeded','failed','expired')),
  response_deadline_at timestamptz NOT NULL,
  threshold_fen integer NOT NULL CHECK (threshold_fen > 0),
  ticket_net_fen bigint NOT NULL CHECK (ticket_net_fen >= 0),
  penalty_pool_fen bigint NOT NULL CHECK (penalty_pool_fen >= 0),
  shortfall_fen integer NOT NULL CHECK (shortfall_fen > 0),
  source_order_ids uuid[] NOT NULL,
  participant_count integer NOT NULL CHECK (participant_count > 0),
  failure_reason varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS departure_supplement_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES departure_supplement_rounds(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  paid_seat_count smallint NOT NULL CHECK (paid_seat_count > 0),
  amount_fen integer NOT NULL CHECK (amount_fen >= 0),
  consent_status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending','accepted','rejected','timed_out')),
  payment_status varchar(16) NOT NULL DEFAULT 'not_started'
    CHECK (payment_status IN ('not_started','pending','succeeded','failed','refund_pending','manual_required','refunded')),
  responded_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id,order_id)
);

ALTER TABLE payment_transactions
  ALTER COLUMN order_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS purpose varchar(16) NOT NULL DEFAULT 'booking'
    CHECK (purpose IN ('booking','supplement')),
  ADD COLUMN IF NOT EXISTS supplement_participant_id uuid
    REFERENCES departure_supplement_participants(id) ON DELETE RESTRICT;

ALTER TABLE payment_transactions
  ADD CONSTRAINT payment_transactions_purpose_target_check CHECK (
    (purpose='booking' AND order_id IS NOT NULL AND supplement_participant_id IS NULL)
    OR (purpose='supplement' AND order_id IS NULL AND supplement_participant_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_supplement_active_idx
  ON payment_transactions (supplement_participant_id)
  WHERE supplement_participant_id IS NOT NULL AND status IN ('pending','succeeded');

CREATE INDEX IF NOT EXISTS supplement_rounds_deadline_idx
  ON departure_supplement_rounds (response_deadline_at,id)
  WHERE status IN ('collecting_consent','collecting_payment');

CREATE TABLE IF NOT EXISTS admin_manual_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(40) NOT NULL CHECK (event_type IN ('refund_manual_required')),
  refund_obligation_id uuid NOT NULL UNIQUE REFERENCES refund_obligations(id) ON DELETE RESTRICT,
  detail varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

COMMIT;
