BEGIN;

ALTER TABLE departures
  ADD COLUMN IF NOT EXISTS meeting_at timestamptz,
  ADD COLUMN IF NOT EXISTS stern_surcharge_fen integer NOT NULL DEFAULT 0
    CHECK (stern_surcharge_fen >= 0),
  ADD COLUMN IF NOT EXISTS remarks varchar(500) NOT NULL DEFAULT '';

ALTER TABLE departures
  ADD CONSTRAINT departures_meeting_before_departure_check
    CHECK (meeting_at IS NULL OR meeting_at <= departure_at);

ALTER TABLE seat_inventory
  ADD COLUMN IF NOT EXISTS seat_side varchar(12)
    CHECK (seat_side IN ('port', 'starboard')),
  ADD COLUMN IF NOT EXISTS seat_section varchar(16)
    CHECK (seat_section IN ('bow', 'mid', 'stern')),
  ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS departures_published_date_idx
  ON departures (departure_at, marina_code, trip_type)
  WHERE status = 'open';

COMMIT;
