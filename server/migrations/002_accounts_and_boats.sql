BEGIN;

ALTER TABLE users
  ADD COLUMN identity_status varchar(24) NOT NULL DEFAULT 'not_submitted'
    CHECK (identity_status IN ('not_submitted', 'pending', 'verified', 'rejected')),
  ADD COLUMN identity_rejection_reason text,
  ADD COLUMN identity_submitted_at timestamptz;

ALTER TABLE captain_profiles
  ALTER COLUMN captain_name DROP NOT NULL,
  ADD COLUMN captain_name_ciphertext bytea,
  ADD COLUMN license_reference_ciphertext bytea,
  ADD COLUMN certificate_uri text;

ALTER TABLE boats
  ALTER COLUMN seat_count DROP NOT NULL,
  ADD COLUMN comfort_spacing_cm numeric(6,1),
  ADD COLUMN template_status varchar(24) NOT NULL DEFAULT 'manual_review'
    CHECK (template_status IN ('ready', 'manual_review'));

CREATE TABLE IF NOT EXISTS sms_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash bytea NOT NULL,
  code_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_verification_codes_latest_idx
  ON sms_verification_codes (phone_hash, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id, expires_at);

CREATE TABLE IF NOT EXISTS uploaded_objects (
  object_key varchar(80) PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_kind varchar(24) NOT NULL
    CHECK (object_kind IN ('exterior', 'deck', 'cabin', 'toilet', 'certificate', 'registration')),
  content_type varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seat_templates (
  code varchar(40) PRIMARY KEY,
  version smallint NOT NULL,
  seat_count smallint NOT NULL CHECK (seat_count BETWEEN 1 AND 30),
  layout jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO seat_templates (code, version, seat_count, layout)
VALUES (
  'qingdao-12-seat-v1',
  1,
  12,
  '[
    {"number":1,"side":"port","section":"bow","premium":false},
    {"number":2,"side":"port","section":"bow","premium":false},
    {"number":3,"side":"port","section":"mid","premium":false},
    {"number":4,"side":"port","section":"mid","premium":false},
    {"number":5,"side":"port","section":"stern","premium":false},
    {"number":6,"side":"port","section":"stern","premium":true},
    {"number":7,"side":"starboard","section":"stern","premium":true},
    {"number":8,"side":"starboard","section":"stern","premium":false},
    {"number":9,"side":"starboard","section":"mid","premium":false},
    {"number":10,"side":"starboard","section":"mid","premium":false},
    {"number":11,"side":"starboard","section":"bow","premium":false},
    {"number":12,"side":"starboard","section":"bow","premium":false}
  ]'::jsonb
)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS captain_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_user_id uuid NOT NULL REFERENCES captain_profiles(user_id) ON DELETE RESTRICT,
  boat_id uuid NOT NULL UNIQUE REFERENCES boats(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS captain_applications_queue_idx
  ON captain_applications (status, submitted_at);

CREATE TABLE IF NOT EXISTS review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES captain_applications(id) ON DELETE RESTRICT,
  admin_actor varchar(80) NOT NULL DEFAULT 'environment-admin',
  decision varchar(16) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'rejected' OR length(trim(reason)) > 0)
);
CREATE INDEX IF NOT EXISTS review_events_application_idx
  ON review_events (application_id, created_at DESC);

COMMIT;
