BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS identity_number_hash bytea;

CREATE UNIQUE INDEX IF NOT EXISTS users_identity_number_hash_unique_idx
  ON users (identity_number_hash)
  WHERE identity_status = 'verified' AND identity_number_hash IS NOT NULL;

ALTER TABLE promotion_codes
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by varchar(80),
  ADD COLUMN IF NOT EXISTS review_note text;

CREATE UNIQUE INDEX IF NOT EXISTS promotion_codes_owner_channel_unique_idx
  ON promotion_codes (owner_user_id, channel);

ALTER TABLE promotion_attributions
  ADD COLUMN IF NOT EXISTS source_channel varchar(24) NOT NULL DEFAULT 'qr'
    CHECK (source_channel IN ('qr', 'share', 'link')),
  ADD COLUMN IF NOT EXISTS qualification_status varchar(32) NOT NULL DEFAULT 'pending'
    CHECK (qualification_status IN ('pending', 'qualified', 'self_referral', 'existing_buyer', 'refunded')),
  ADD COLUMN IF NOT EXISTS qualified_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS promotion_attributions_user_unique_idx
  ON promotion_attributions (attributed_user_id)
  WHERE attributed_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS promotion_attributions_visitor_unique_idx
  ON promotion_attributions (attribution_key_hash)
  WHERE attribution_key_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS promotion_touch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_key_hash bytea NOT NULL,
  promotion_code_id uuid NOT NULL REFERENCES promotion_codes(id) ON DELETE RESTRICT,
  source_channel varchar(24) NOT NULL
    CHECK (source_channel IN ('qr', 'share', 'link')),
  claimed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(24) NOT NULL DEFAULT 'scanned'
    CHECK (status IN ('scanned', 'claimed', 'self_excluded', 'ignored')),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (visitor_key_hash, promotion_code_id)
);
CREATE INDEX IF NOT EXISTS promotion_touch_events_visitor_idx
  ON promotion_touch_events (visitor_key_hash, scanned_at, id);
CREATE INDEX IF NOT EXISTS promotion_touch_events_code_idx
  ON promotion_touch_events (promotion_code_id, scanned_at DESC);

ALTER TABLE booking_orders
  ADD COLUMN IF NOT EXISTS ticket_refunded_fen integer NOT NULL DEFAULT 0
    CHECK (ticket_refunded_fen >= 0 AND ticket_refunded_fen <= seat_fee_fen - discount_fen);

ALTER TABLE commission_ledger
  ADD COLUMN IF NOT EXISTS net_ticket_amount_fen integer NOT NULL DEFAULT 0
    CHECK (net_ticket_amount_fen >= 0),
  ADD COLUMN IF NOT EXISTS rate_basis_points smallint NOT NULL DEFAULT 500
    CHECK (rate_basis_points = 500),
  ADD COLUMN IF NOT EXISTS refund_after_release boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_request_id uuid;

ALTER TABLE commission_ledger
  DROP CONSTRAINT IF EXISTS commission_ledger_status_check;
ALTER TABLE commission_ledger
  ADD CONSTRAINT commission_ledger_status_check
    CHECK (status IN ('frozen', 'pending_unlock', 'available', 'withdrawal_pending', 'paid', 'reversed'));

CREATE UNIQUE INDEX IF NOT EXISTS commission_ledger_attribution_unique_idx
  ON commission_ledger (promotion_attribution_id);

CREATE TABLE IF NOT EXISTS promotion_commission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_ledger_id uuid NOT NULL REFERENCES commission_ledger(id) ON DELETE RESTRICT,
  event_type varchar(40) NOT NULL,
  amount_fen integer NOT NULL CHECK (amount_fen >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promotion_commission_events_ledger_idx
  ON promotion_commission_events (commission_ledger_id, created_at, id);

CREATE TABLE IF NOT EXISTS promotion_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  status varchar(24) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'paid_marked', 'rejected')),
  admin_actor varchar(80),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  paid_marked_at timestamptz
);
CREATE INDEX IF NOT EXISTS promotion_payout_requests_user_idx
  ON promotion_payout_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS promotion_payout_requests_review_idx
  ON promotion_payout_requests (status, created_at, id);

ALTER TABLE commission_ledger
  ADD CONSTRAINT commission_ledger_payout_request_fk
    FOREIGN KEY (payout_request_id) REFERENCES promotion_payout_requests(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS promotion_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_request_id uuid NOT NULL REFERENCES promotion_payout_requests(id) ON DELETE RESTRICT,
  commission_ledger_id uuid NOT NULL REFERENCES commission_ledger(id) ON DELETE RESTRICT,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payout_request_id, commission_ledger_id)
);
CREATE INDEX IF NOT EXISTS promotion_payout_items_request_idx
  ON promotion_payout_items (payout_request_id, id);

COMMIT;
