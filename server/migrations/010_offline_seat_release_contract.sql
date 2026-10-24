BEGIN;

ALTER TABLE departure_seat_quotas
  ADD COLUMN offline_state varchar(12),
  ADD CONSTRAINT departure_seat_quotas_offline_state_check CHECK (
    (sale_channel = 'offline' AND offline_state IN ('open', 'locked', 'sold'))
    OR (sale_channel = 'platform' AND (offline_state IS NULL OR offline_state = 'released'))
  );

UPDATE departure_seat_quotas
SET offline_state = CASE WHEN sale_channel = 'offline' THEN 'open' ELSE NULL END;

CREATE OR REPLACE FUNCTION seed_departure_seat_quotas() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO departure_seat_quotas (departure_id, seat_number, sale_channel, offline_state)
  SELECT NEW.id, slot.seat_number,
         CASE WHEN slot.seat_number <= NEW.platform_quota_seats THEN 'platform' ELSE 'offline' END,
         CASE WHEN slot.seat_number <= NEW.platform_quota_seats THEN NULL ELSE 'open' END
  FROM generate_series(1, NEW.platform_quota_seats + NEW.offline_quota_seats) AS slot(seat_number);
  RETURN NEW;
END;
$$;

ALTER TABLE departure_quota_transfers
  ADD COLUMN offline_release_confirmed boolean NOT NULL DEFAULT false;

CREATE TABLE departure_offline_seat_state_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL,
  seat_number smallint NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  previous_state varchar(12) CHECK (previous_state IN ('open', 'locked', 'sold', 'released')),
  next_state varchar(12) NOT NULL CHECK (next_state IN ('open', 'locked', 'sold', 'released')),
  event_kind varchar(24) NOT NULL CHECK (event_kind IN ('captain_status', 'quota_transfer', 'quota_return')),
  transfer_request_key varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (departure_id, seat_number)
    REFERENCES departure_seat_quotas(departure_id, seat_number) ON DELETE CASCADE,
  FOREIGN KEY (departure_id, transfer_request_key)
    REFERENCES departure_quota_transfers(departure_id, request_key) ON DELETE CASCADE,
  CHECK ((event_kind = 'captain_status' AND transfer_request_key IS NULL)
      OR (event_kind <> 'captain_status' AND transfer_request_key IS NOT NULL))
);
CREATE INDEX departure_offline_state_events_history_idx
  ON departure_offline_seat_state_events (departure_id, seat_number, created_at DESC);

CREATE TABLE departure_offline_release_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL,
  seat_number smallint NOT NULL,
  request_key varchar(80) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  statement_version varchar(40) NOT NULL,
  statement_text varchar(160) NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (departure_id, request_key),
  FOREIGN KEY (departure_id, seat_number)
    REFERENCES departure_seat_quotas(departure_id, seat_number) ON DELETE CASCADE,
  FOREIGN KEY (departure_id, request_key)
    REFERENCES departure_quota_transfers(departure_id, request_key) ON DELETE CASCADE
);

COMMIT;
