BEGIN;

CREATE TABLE IF NOT EXISTS f_compensation_coupon_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_key varchar(120) NOT NULL
    CHECK (source_event_key ~ '^[A-Za-z0-9._:-]{8,120}$'),
  source_order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  beneficiary_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scenario varchar(48) NOT NULL
    CHECK (scenario IN ('captain_non_weather_cancel', 'platform_attributable_failure')),
  responsible_party varchar(32) NOT NULL
    CHECK (responsible_party IN ('captain_guarantee', 'platform')),
  ticket_paid_fen integer NOT NULL CHECK (ticket_paid_fen > 0),
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  issued_by varchar(80) NOT NULL CHECK (length(issued_by) BETWEEN 1 AND 80),
  issue_note varchar(500) NOT NULL CHECK (length(issue_note) BETWEEN 6 AND 500),
  UNIQUE (source_event_key, source_order_id),
  CHECK (amount_fen::bigint = (ticket_paid_fen::bigint * 3 + 50) / 100),
  CHECK (expires_at > issued_at),
  CHECK (
    (scenario = 'captain_non_weather_cancel' AND responsible_party = 'captain_guarantee') OR
    (scenario = 'platform_attributable_failure' AND responsible_party = 'platform')
  )
);

CREATE INDEX IF NOT EXISTS f_compensation_coupon_wallet_idx
  ON f_compensation_coupon_ledger (beneficiary_user_id, issued_at DESC, id);

COMMIT;
