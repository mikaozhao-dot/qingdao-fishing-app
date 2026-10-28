BEGIN;

ALTER TABLE order_passengers
  ADD COLUMN IF NOT EXISTS booking_status varchar(24) NOT NULL DEFAULT 'active'
    CHECK (booking_status IN ('active','insurance_rejected','guardian_exit','departure_cancelled')),
  ADD COLUMN IF NOT EXISTS cancellation_reason varchar(40),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE passenger_insurance_coverages
  ADD COLUMN IF NOT EXISTS insurer_rejection_streak smallint NOT NULL DEFAULT 0
    CHECK (insurer_rejection_streak BETWEEN 0 AND 3);

CREATE TABLE IF NOT EXISTS passenger_insurance_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  passenger_id uuid NOT NULL REFERENCES order_passengers(id) ON DELETE RESTRICT,
  coverage_id uuid NOT NULL REFERENCES passenger_insurance_coverages(id) ON DELETE RESTRICT,
  attempt_key varchar(100) NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  result_status varchar(24) NOT NULL CHECK (result_status IN ('effective','failed')),
  failure_reason varchar(32) CHECK (failure_reason IS NULL OR failure_reason IN (
    'platform_supplier_fault','data_error','insurer_rejected','payment_failed'
  )),
  rejection_streak smallint NOT NULL CHECK (rejection_streak BETWEEN 0 AND 3),
  seat_cancelled boolean NOT NULL DEFAULT false,
  refund_fen integer NOT NULL DEFAULT 0 CHECK (refund_fen >= 0),
  departure_cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (passenger_id,attempt_key),
  UNIQUE (passenger_id,attempt_number),
  CHECK ((result_status='failed' AND failure_reason IS NOT NULL)
      OR (result_status='effective' AND failure_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS passenger_insurance_attempts_order_idx
  ON passenger_insurance_attempts (order_id,created_at,id);

CREATE TABLE IF NOT EXISTS insurance_guardian_exit_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  child_passenger_id uuid NOT NULL REFERENCES order_passengers(id) ON DELETE RESTRICT,
  guardian_passenger_id uuid NOT NULL REFERENCES order_passengers(id) ON DELETE RESTRICT,
  request_key varchar(100) NOT NULL,
  relationship_confirmed boolean NOT NULL CHECK (relationship_confirmed),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id,request_key),
  UNIQUE (child_passenger_id),
  CHECK (child_passenger_id <> guardian_passenger_id)
);

ALTER TABLE refund_obligations
  ADD COLUMN IF NOT EXISTS passenger_id uuid REFERENCES order_passengers(id) ON DELETE RESTRICT;

ALTER TABLE refund_obligations
  DROP CONSTRAINT refund_obligations_reason_check,
  ADD CONSTRAINT refund_obligations_reason_check CHECK (
    reason IN ('customer_cancellation','late_waitlist_payment','late_booking_payment',
      'supplement_failure','insurance_failure')
  );

CREATE INDEX IF NOT EXISTS refund_obligations_passenger_idx
  ON refund_obligations (passenger_id,created_at,id) WHERE passenger_id IS NOT NULL;

COMMIT;
