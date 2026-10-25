BEGIN;

-- Step 5 slice 1 stores source reports and passenger responses separately.
-- Existing Step 1 catch_reports/reviews are legacy tables and remain untouched.
CREATE TABLE IF NOT EXISTS step5_catch_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  source varchar(16) NOT NULL CHECK (source IN ('captain', 'passenger')),
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  passenger_id uuid REFERENCES order_passengers(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES booking_orders(id) ON DELETE RESTRICT,
  outcome varchar(16) NOT NULL CHECK (outcome IN ('caught', 'zero_catch')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source='captain' AND passenger_id IS NULL AND order_id IS NULL)
    OR (source='passenger' AND passenger_id IS NOT NULL AND order_id IS NOT NULL)
  ),
  UNIQUE (id, departure_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS step5_captain_catch_report_once_idx
  ON step5_catch_reports (departure_id) WHERE source='captain';
CREATE UNIQUE INDEX IF NOT EXISTS step5_passenger_catch_report_once_idx
  ON step5_catch_reports (departure_id, passenger_id) WHERE source='passenger';

CREATE TABLE IF NOT EXISTS step5_catch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES step5_catch_reports(id) ON DELETE RESTRICT,
  fish_code varchar(60) NOT NULL,
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  total_weight_grams integer CHECK (total_weight_grams > 0),
  max_individual_weight_grams integer CHECK (max_individual_weight_grams > 0),
  max_length_mm integer CHECK (max_length_mm > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, fish_code)
);

CREATE TABLE IF NOT EXISTS step5_catch_report_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_report_id uuid NOT NULL REFERENCES step5_catch_reports(id) ON DELETE RESTRICT,
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  passenger_id uuid NOT NULL REFERENCES order_passengers(id) ON DELETE RESTRICT,
  responder_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(16) NOT NULL CHECK (action IN ('confirm', 'dispute', 'supplement')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (captain_report_id, passenger_id),
  FOREIGN KEY (captain_report_id, departure_id)
    REFERENCES step5_catch_reports(id, departure_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS step5_catch_response_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES step5_catch_report_responses(id) ON DELETE RESTRICT,
  fish_code varchar(60) NOT NULL,
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  max_individual_weight_grams integer CHECK (max_individual_weight_grams > 0),
  max_length_mm integer CHECK (max_length_mm > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (response_id, fish_code)
);

CREATE TABLE IF NOT EXISTS step5_catch_reconciliations (
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  passenger_id uuid NOT NULL REFERENCES order_passengers(id) ON DELETE RESTRICT,
  captain_report_id uuid NOT NULL REFERENCES step5_catch_reports(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL
    CHECK (status IN ('awaiting_passenger', 'confirmed', 'supplemented', 'pending_review')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (departure_id, passenger_id),
  FOREIGN KEY (captain_report_id, departure_id)
    REFERENCES step5_catch_reports(id, departure_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS step5_trip_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES booking_orders(id) ON DELETE RESTRICT,
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  passenger_id uuid NOT NULL REFERENCES order_passengers(id) ON DELETE RESTRICT,
  captain_user_id uuid NOT NULL REFERENCES captain_profiles(user_id) ON DELETE RESTRICT,
  boat_id uuid NOT NULL REFERENCES boats(id) ON DELETE RESTRICT,
  captain_tags varchar(40)[] NOT NULL DEFAULT '{}',
  boat_tags varchar(40)[] NOT NULL DEFAULT '{}',
  body varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(captain_tags) + cardinality(boat_tags) > 0 OR length(trim(body)) > 0)
);
CREATE INDEX IF NOT EXISTS step5_trip_reviews_captain_idx
  ON step5_trip_reviews (captain_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS step5_trip_reviews_boat_idx
  ON step5_trip_reviews (boat_id, created_at DESC);

-- These tables are source records. Corrections are represented as new source
-- records in a later workflow, never as in-place edits to this slice.
CREATE OR REPLACE FUNCTION step5_reject_source_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Step 5 source records are append-only';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'step5_catch_reports', 'step5_catch_items',
    'step5_catch_report_responses', 'step5_catch_response_items',
    'step5_trip_reviews'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_append_only', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION step5_reject_source_mutation()',
      table_name || '_append_only', table_name
    );
  END LOOP;
END;
$$;

COMMIT;
