BEGIN;

ALTER TABLE captain_profiles
  ADD COLUMN IF NOT EXISTS douyin_handle varchar(80),
  ADD COLUMN IF NOT EXISTS douyin_profile_url varchar(500),
  ADD CONSTRAINT captain_douyin_binding_pair_check
    CHECK ((douyin_handle IS NULL) = (douyin_profile_url IS NULL));

CREATE TABLE IF NOT EXISTS step5_live_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  captain_user_id uuid NOT NULL REFERENCES captain_profiles(user_id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason varchar(32) CHECK (end_reason IN (
    'captain_ended','trip_returned','false_live_report_verified'
  )),
  CHECK ((ended_at IS NULL AND end_reason IS NULL)
      OR (ended_at IS NOT NULL AND end_reason IS NOT NULL)),
  UNIQUE (id, departure_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS step5_live_one_active_session_idx
  ON step5_live_sessions (departure_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS step5_live_captain_history_idx
  ON step5_live_sessions (captain_user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS step5_live_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason varchar(32) NOT NULL CHECK (reason IN (
    'not_live','wrong_account','misleading_content','other'
  )),
  note varchar(500) NOT NULL DEFAULT '',
  processing_status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','false_verified','not_false')),
  processed_by varchar(80),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, departure_id)
    REFERENCES step5_live_sessions(id, departure_id) ON DELETE RESTRICT,
  CHECK ((processing_status='pending' AND processed_by IS NULL AND processed_at IS NULL)
      OR (processing_status<>'pending' AND processed_by IS NOT NULL AND processed_at IS NOT NULL)),
  UNIQUE (departure_id, reporter_user_id)
);
CREATE INDEX IF NOT EXISTS step5_live_reports_queue_idx
  ON step5_live_reports (processing_status, created_at);

CREATE TABLE IF NOT EXISTS step5_captain_live_incident_facts (
  captain_user_id uuid NOT NULL REFERENCES captain_profiles(user_id) ON DELETE RESTRICT,
  departure_id uuid PRIMARY KEY REFERENCES departures(id) ON DELETE RESTRICT,
  verified_at timestamptz NOT NULL DEFAULT now(),
  outcome varchar(40) NOT NULL DEFAULT 'false_live_badge_verified'
    CHECK (outcome='false_live_badge_verified')
);

COMMIT;
