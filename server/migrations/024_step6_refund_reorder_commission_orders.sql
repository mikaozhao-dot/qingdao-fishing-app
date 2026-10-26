BEGIN;

-- Keep each commission's source order stable when the attribution advances to a
-- later eligible order after a full pre-release refund.
ALTER TABLE commission_ledger
  ADD COLUMN IF NOT EXISTS booking_order_id uuid
    REFERENCES booking_orders(id) ON DELETE RESTRICT;

UPDATE commission_ledger l
SET booking_order_id=a.order_id
FROM promotion_attributions a
WHERE a.id=l.promotion_attribution_id
  AND l.booking_order_id IS NULL
  AND a.order_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM commission_ledger WHERE booking_order_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill commission_ledger.booking_order_id from promotion_attributions.order_id';
  END IF;
END $$;

ALTER TABLE commission_ledger
  ALTER COLUMN booking_order_id SET NOT NULL;

DROP INDEX IF EXISTS commission_ledger_attribution_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS commission_ledger_booking_order_unique_idx
  ON commission_ledger (booking_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS commission_ledger_one_effective_per_attribution_idx
  ON commission_ledger (promotion_attribution_id)
  WHERE status<>'reversed';

COMMIT;
