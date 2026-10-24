BEGIN;

-- Passenger coverage is scoped to the booked departure and its sailing window.
CREATE TABLE IF NOT EXISTS passenger_insurance_coverages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  passenger_id uuid NOT NULL REFERENCES order_passengers(id) ON DELETE RESTRICT,
  coverage_start_at timestamptz NOT NULL,
  coverage_end_at timestamptz NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'not_insured'
    CHECK (status IN ('not_insured','pending_verification','effective','failed')),
  failure_reason varchar(32)
    CHECK (failure_reason IS NULL OR failure_reason IN (
      'platform_supplier_fault','data_error','insurer_rejected','payment_failed'
    )),
  provider_code varchar(80),
  provider_policy_reference varchar(160),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (passenger_id,departure_id,coverage_start_at,coverage_end_at),
  CHECK (coverage_end_at > coverage_start_at),
  CHECK (status = 'failed' OR failure_reason IS NULL)
);

CREATE INDEX IF NOT EXISTS passenger_insurance_coverages_departure_idx
  ON passenger_insurance_coverages (departure_id,status,coverage_start_at,coverage_end_at);

-- Vessel-level required coverage fails closed until a verified provider result exists.
CREATE TABLE IF NOT EXISTS departure_required_insurance (
  departure_id uuid PRIMARY KEY REFERENCES departures(id) ON DELETE RESTRICT,
  coverage_code varchar(40) NOT NULL DEFAULT 'vessel_liability'
    CHECK (coverage_code = 'vessel_liability'),
  status varchar(24) NOT NULL DEFAULT 'not_verified'
    CHECK (status IN ('not_verified','pending_verification','effective','failed')),
  failure_reason varchar(32)
    CHECK (failure_reason IS NULL OR failure_reason IN (
      'platform_supplier_fault','data_error','insurer_rejected','payment_failed'
    )),
  provider_code varchar(80),
  provider_policy_reference varchar(160),
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'failed' OR failure_reason IS NULL)
);

-- Preserve existing order-level sandbox results when upgrading existing records.
INSERT INTO passenger_insurance_coverages
  (departure_id,order_id,passenger_id,coverage_start_at,coverage_end_at,status,
   provider_code,provider_policy_reference,verified_at)
SELECT o.departure_id,o.id,op.id,d.departure_at,d.return_at,
       CASE ip.status WHEN 'issued' THEN 'effective'
         WHEN 'checkout_started' THEN 'pending_verification'
         ELSE 'not_insured' END,
       ip.provider_code,ip.provider_policy_reference,ip.issued_at
FROM booking_orders o
JOIN departures d ON d.id=o.departure_id
JOIN order_passengers op ON op.order_id=o.id
LEFT JOIN insurance_policies ip ON ip.order_id=o.id
WHERE o.status='paid'
ON CONFLICT (passenger_id,departure_id,coverage_start_at,coverage_end_at) DO NOTHING;

COMMIT;
