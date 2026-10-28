BEGIN;

ALTER TABLE departure_formation_adjustments
  DROP CONSTRAINT IF EXISTS departure_formation_adjustments_adjustment_type_check,
  ALTER COLUMN adjustment_type TYPE varchar(40),
  ADD CONSTRAINT departure_formation_adjustments_adjustment_type_check
    CHECK (adjustment_type IN ('penalty_pool','successful_supplement','successful_supplement_refund'));

ALTER TABLE insurance_guardian_exit_decisions
  ADD COLUMN IF NOT EXISTS refund_fen integer NOT NULL DEFAULT 0 CHECK (refund_fen >= 0),
  ADD COLUMN IF NOT EXISTS departure_cancelled boolean NOT NULL DEFAULT false;

COMMIT;
