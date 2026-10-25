BEGIN;

-- Record the current passenger-level decision made during the captain's
-- departure check-in, including passengers blocked by ineffective coverage.
CREATE TABLE IF NOT EXISTS departure_passenger_gate_decisions (
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  passenger_id uuid NOT NULL REFERENCES order_passengers(id) ON DELETE RESTRICT,
  coverage_id uuid REFERENCES passenger_insurance_coverages(id) ON DELETE RESTRICT,
  captain_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision varchar(16) NOT NULL CHECK (decision IN ('allowed','blocked')),
  coverage_status varchar(24) NOT NULL
    CHECK (coverage_status IN ('not_insured','pending_verification','effective','failed')),
  block_reason varchar(48),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (departure_id, passenger_id),
  CHECK (
    (decision='allowed' AND coverage_status='effective' AND coverage_id IS NOT NULL AND block_reason IS NULL)
    OR (decision='blocked' AND coverage_status<>'effective'
      AND block_reason='passenger_coverage_not_effective')
  )
);

CREATE INDEX IF NOT EXISTS departure_passenger_gate_allowed_idx
  ON departure_passenger_gate_decisions (departure_id,passenger_id)
  WHERE decision='allowed';

COMMIT;
