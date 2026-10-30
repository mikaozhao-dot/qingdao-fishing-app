BEGIN;

CREATE TABLE IF NOT EXISTS member_activity_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  departure_date date NOT NULL,
  requested_start_at timestamptz NOT NULL,
  requested_end_at timestamptz NOT NULL,
  marina_code varchar(80) NOT NULL,
  target_area_code varchar(80) NOT NULL,
  party_size smallint NOT NULL CHECK (party_size BETWEEN 1 AND 30),
  booking_type varchar(16) NOT NULL CHECK (booking_type IN ('charter','shared')),
  fish_codes varchar(60)[] NOT NULL CHECK (cardinality(fish_codes) BETWEEN 1 AND 3),
  fishing_methods text[] NOT NULL DEFAULT '{}',
  min_budget_fen integer CHECK (min_budget_fen IS NULL OR min_budget_fen >= 0),
  max_budget_fen integer CHECK (max_budget_fen IS NULL OR max_budget_fen >= 0),
  gear_requirements varchar(500) NOT NULL DEFAULT '',
  beginner_friendly boolean NOT NULL DEFAULT false,
  children_allowed boolean NOT NULL DEFAULT false,
  notes varchar(500) NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'published'
    CHECK (status IN ('published','converted','closed','expired')),
  expires_at timestamptz NOT NULL,
  converted_departure_id uuid REFERENCES departures(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_end_at > requested_start_at),
  CHECK (max_budget_fen IS NULL OR min_budget_fen IS NULL OR max_budget_fen >= min_budget_fen),
  CHECK ((status = 'converted') = (converted_departure_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS member_activity_requests_member_created_idx
  ON member_activity_requests (member_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS member_activity_requests_published_expiry_idx
  ON member_activity_requests (expires_at, departure_date, marina_code)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS member_activity_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES member_activity_requests(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  invitation_id uuid,
  departure_id uuid REFERENCES departures(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES booking_orders(id) ON DELETE RESTRICT,
  fact_type varchar(48) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_activity_facts_request_time_idx
  ON member_activity_facts (request_id, occurred_at, id);

CREATE OR REPLACE FUNCTION reject_member_activity_fact_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'member activity facts are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS member_activity_facts_immutable ON member_activity_facts;
CREATE TRIGGER member_activity_facts_immutable
  BEFORE UPDATE OR DELETE ON member_activity_facts
  FOR EACH ROW EXECUTE FUNCTION reject_member_activity_fact_mutation();

COMMIT;
