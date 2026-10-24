BEGIN;

ALTER TABLE departures
  DROP CONSTRAINT IF EXISTS departures_status_check;
ALTER TABLE departures
  ADD CONSTRAINT departures_status_check
    CHECK (status IN ('draft', 'open', 'forming', 'confirmed', 'handling_shortfall', 'in_progress', 'cancelled', 'completed')),
  ADD COLUMN IF NOT EXISTS weather_note text NOT NULL DEFAULT '出航前更新海况';

CREATE TABLE IF NOT EXISTS departure_pretrip_checklists (
  departure_id uuid PRIMARY KEY REFERENCES departures(id) ON DELETE RESTRICT,
  checklist jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departure_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  captain_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event varchar(16) NOT NULL CHECK (event IN ('departed', 'returned')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (departure_id, event)
);

CREATE TABLE IF NOT EXISTS manifest_export_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  captain_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  format varchar(16) NOT NULL CHECK (format IN ('masked', 'full')),
  row_count integer NOT NULL CHECK (row_count >= 0),
  exported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  departure_id uuid REFERENCES departures(id) ON DELETE RESTRICT,
  kind varchar(40) NOT NULL,
  channel varchar(16) NOT NULL DEFAULT 'sandbox' CHECK (channel='sandbox'),
  payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'sandbox_recorded' CHECK (status='sandbox_recorded'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_user_id,departure_id,kind)
);
CREATE INDEX IF NOT EXISTS notification_outbox_user_idx
  ON notification_outbox (recipient_user_id, created_at DESC);

COMMIT;
