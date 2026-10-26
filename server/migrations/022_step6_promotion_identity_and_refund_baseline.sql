BEGIN;

ALTER TABLE promotion_attributions
  DROP CONSTRAINT IF EXISTS promotion_attributions_qualification_status_check;
ALTER TABLE promotion_attributions
  ADD CONSTRAINT promotion_attributions_qualification_status_check
    CHECK (qualification_status IN (
      'pending', 'qualified', 'self_referral', 'existing_buyer', 'refunded',
      'identity_already_qualified'
    ));

CREATE TABLE IF NOT EXISTS promotion_identity_qualifications (
  identity_number_hash bytea PRIMARY KEY CHECK (octet_length(identity_number_hash) = 32),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  promotion_attribution_id uuid NOT NULL UNIQUE
    REFERENCES promotion_attributions(id) ON DELETE RESTRICT,
  consumed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promotion_identity_qualifications_attribution_idx
  ON promotion_identity_qualifications (promotion_attribution_id);

-- The historical record cannot recover identities that were already replaced before this migration.
-- Seed currently verified identities for existing positive qualifications so they cannot be reused.
INSERT INTO promotion_identity_qualifications
  (identity_number_hash,user_id,promotion_attribution_id,consumed_at)
SELECT u.identity_number_hash,u.id,a.id,COALESCE(a.qualified_at,a.attributed_at)
FROM promotion_attributions a
JOIN commission_ledger l ON l.promotion_attribution_id=a.id AND l.amount_fen>0
JOIN users u ON u.id=a.attributed_user_id
WHERE u.identity_status='verified' AND u.identity_number_hash IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE commission_ledger
  ADD COLUMN IF NOT EXISTS release_refund_baseline_fen integer NOT NULL DEFAULT 0
    CHECK (release_refund_baseline_fen >= 0);

-- Existing released rows use the refund total already present when this migration is applied.
UPDATE commission_ledger l
SET release_refund_baseline_fen=COALESCE(o.ticket_refunded_fen,0)
FROM promotion_attributions a
LEFT JOIN booking_orders o ON o.id=a.order_id
WHERE a.id=l.promotion_attribution_id
  AND l.status IN ('available','withdrawal_pending','paid');

COMMIT;
