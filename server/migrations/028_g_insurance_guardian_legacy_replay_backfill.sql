BEGIN;

ALTER TABLE insurance_guardian_exit_decisions
  ADD COLUMN IF NOT EXISTS departure_outcome_known boolean NOT NULL DEFAULT false;

UPDATE insurance_guardian_exit_decisions AS decision
SET refund_fen = COALESCE((
  SELECT SUM(obligation.amount_fen)::integer
  FROM refund_obligations AS obligation
  WHERE obligation.passenger_id = decision.guardian_passenger_id
    AND obligation.reason = 'insurance_failure'
    AND obligation.request_key = 'insurance-guardian-exit:' || decision.guardian_passenger_id::text
), 0)
WHERE decision.departure_outcome_known = false;

-- A true value cannot come from 027's false default, so it is a reliable stored outcome.
UPDATE insurance_guardian_exit_decisions
SET departure_outcome_known = true
WHERE departure_cancelled = true;

COMMIT;
