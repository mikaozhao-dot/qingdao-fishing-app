BEGIN;

ALTER TABLE booking_orders
  ADD COLUMN IF NOT EXISTS coupon_discount_fen integer NOT NULL DEFAULT 0
    CHECK (coupon_discount_fen >= 0),
  ADD COLUMN IF NOT EXISTS buyer_seat_inventory_id uuid
    REFERENCES seat_inventory(id) ON DELETE RESTRICT;

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid='booking_orders'::regclass AND contype='c'
      AND (pg_get_constraintdef(oid) ILIKE '%total_amount_fen%'
        OR pg_get_constraintdef(oid) ILIKE '%ticket_refunded_fen%')
  LOOP
    EXECUTE format('ALTER TABLE booking_orders DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

ALTER TABLE booking_orders
  ADD CONSTRAINT booking_orders_coupon_discount_limit_check
    CHECK (coupon_discount_fen <= seat_fee_fen - discount_fen),
  ADD CONSTRAINT booking_orders_coupon_total_amount_check
    CHECK (total_amount_fen >= 0
      AND total_amount_fen = seat_fee_fen - discount_fen - coupon_discount_fen + platform_fee_fen),
  ADD CONSTRAINT booking_orders_coupon_ticket_refund_limit_check
    CHECK (ticket_refunded_fen >= 0
      AND ticket_refunded_fen <= seat_fee_fen - discount_fen - coupon_discount_fen);

CREATE TABLE IF NOT EXISTS member_reward_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  valid_order_count integer NOT NULL DEFAULT 0 CHECK (valid_order_count >= 0),
  lifetime_stars integer NOT NULL DEFAULT 0 CHECK (lifetime_stars >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  coupon_type varchar(24) NOT NULL CHECK (coupon_type IN ('first_order','upgrade')),
  milestone integer NOT NULL CHECK (milestone >= 0),
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id,coupon_type,milestone),
  CHECK (expires_at > issued_at),
  CHECK ((coupon_type='first_order' AND milestone=0 AND amount_fen=1500)
      OR (coupon_type='upgrade' AND milestone>0 AND amount_fen=2000))
);

CREATE INDEX IF NOT EXISTS member_coupons_wallet_idx
  ON member_coupons (user_id,issued_at DESC,id);

CREATE TABLE IF NOT EXISTS order_coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat_inventory_id uuid NOT NULL REFERENCES seat_inventory(id) ON DELETE RESTRICT,
  coupon_kind varchar(16) NOT NULL CHECK (coupon_kind IN ('member','f')),
  member_coupon_id uuid REFERENCES member_coupons(id) ON DELETE RESTRICT,
  f_coupon_id uuid REFERENCES f_compensation_coupon_ledger(id) ON DELETE RESTRICT,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  status varchar(16) NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','redeemed','released','restored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((coupon_kind='member' AND member_coupon_id IS NOT NULL AND f_coupon_id IS NULL)
      OR (coupon_kind='f' AND f_coupon_id IS NOT NULL AND member_coupon_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS order_coupon_redemptions_active_order_idx
  ON order_coupon_redemptions (order_id) WHERE status IN ('reserved','redeemed');
CREATE UNIQUE INDEX IF NOT EXISTS order_coupon_redemptions_active_member_coupon_idx
  ON order_coupon_redemptions (member_coupon_id) WHERE member_coupon_id IS NOT NULL
    AND status IN ('reserved','redeemed');
CREATE UNIQUE INDEX IF NOT EXISTS order_coupon_redemptions_active_f_coupon_idx
  ON order_coupon_redemptions (f_coupon_id) WHERE f_coupon_id IS NOT NULL
    AND status IN ('reserved','redeemed');
CREATE INDEX IF NOT EXISTS order_coupon_redemptions_order_idx
  ON order_coupon_redemptions (order_id,created_at,id);

CREATE TABLE IF NOT EXISTS coupon_ledger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_kind varchar(16) NOT NULL CHECK (coupon_kind IN ('member','f')),
  member_coupon_id uuid REFERENCES member_coupons(id) ON DELETE RESTRICT,
  f_coupon_id uuid REFERENCES f_compensation_coupon_ledger(id) ON DELETE RESTRICT,
  redemption_id uuid REFERENCES order_coupon_redemptions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES booking_orders(id) ON DELETE RESTRICT,
  event_type varchar(16) NOT NULL CHECK (event_type IN ('issued','reserved','redeemed','released','restored')),
  event_key varchar(180) NOT NULL UNIQUE,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((coupon_kind='member' AND member_coupon_id IS NOT NULL AND f_coupon_id IS NULL)
      OR (coupon_kind='f' AND f_coupon_id IS NOT NULL AND member_coupon_id IS NULL))
);

CREATE TABLE IF NOT EXISTS member_reward_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  fact_type varchar(48) NOT NULL CHECK (fact_type IN ('completed_order_full_ticket_refund')),
  fact_key varchar(180) NOT NULL UNIQUE,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_reward_facts_user_idx
  ON member_reward_facts (user_id,created_at DESC,id);

INSERT INTO coupon_ledger_events
  (coupon_kind,f_coupon_id,user_id,event_type,event_key,details)
SELECT 'f',id,beneficiary_user_id,'issued','f-coupon-issued:'||id::text,
       jsonb_build_object('scenario',scenario,'responsibleParty',responsible_party,
         'ticketPaidFen',ticket_paid_fen,'amountFen',amount_fen,'issuedAt',issued_at,
         'expiresAt',expires_at,'issuedBy',issued_by)
FROM f_compensation_coupon_ledger
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO coupon_ledger_events
  (coupon_kind,f_coupon_id,user_id,event_type,event_key,details)
SELECT 'f',id,beneficiary_user_id,'issued','f-coupon-issued:'||id::text,
       jsonb_build_object('scenario',scenario,'responsibleParty',responsible_party,
         'ticketPaidFen',ticket_paid_fen,'amountFen',amount_fen,'issuedAt',issued_at,
         'expiresAt',expires_at,'issuedBy',issued_by)
FROM f_compensation_coupon_ledger
ON CONFLICT (event_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS coupon_redemption_attempt_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  coupon_kind varchar(16) NOT NULL CHECK (coupon_kind IN ('member','f')),
  member_coupon_id uuid REFERENCES member_coupons(id) ON DELETE RESTRICT,
  f_coupon_id uuid REFERENCES f_compensation_coupon_ledger(id) ON DELETE RESTRICT,
  fact_type varchar(48) NOT NULL CHECK (fact_type='active_coupon_reuse_conflict'),
  request_key varchar(180) NOT NULL UNIQUE,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((coupon_kind='member' AND member_coupon_id IS NOT NULL AND f_coupon_id IS NULL)
      OR (coupon_kind='f' AND f_coupon_id IS NOT NULL AND member_coupon_id IS NULL))
);

COMMIT;
