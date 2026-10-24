BEGIN;

ALTER TABLE departures
  ADD COLUMN seat_template_count smallint,
  ADD COLUMN platform_quota_seats smallint,
  ADD COLUMN offline_quota_seats smallint,
  ADD COLUMN manual_supply boolean;

WITH snapshot AS (
  SELECT d.id,
         GREATEST(COALESCE(b.seat_count, 0), COALESCE(max(s.seat_number), 0), 1)::smallint AS template_count,
         count(DISTINCT s.seat_number)::smallint AS inventory_count
  FROM departures d
  JOIN boats b ON b.id = d.boat_id
  LEFT JOIN seat_inventory s ON s.departure_id = d.id
  GROUP BY d.id, b.seat_count
)
UPDATE departures d
SET seat_template_count = snapshot.template_count,
    platform_quota_seats = LEAST(snapshot.template_count, snapshot.inventory_count),
    offline_quota_seats = snapshot.template_count - LEAST(snapshot.template_count, snapshot.inventory_count),
    manual_supply = snapshot.inventory_count = 0
FROM snapshot
WHERE snapshot.id = d.id;

ALTER TABLE departures
  ALTER COLUMN seat_template_count SET NOT NULL,
  ALTER COLUMN platform_quota_seats SET NOT NULL,
  ALTER COLUMN offline_quota_seats SET NOT NULL,
  ALTER COLUMN manual_supply SET NOT NULL,
  ADD CONSTRAINT departures_quota_counts_check CHECK (
    seat_template_count BETWEEN 1 AND 30
    AND platform_quota_seats >= 0
    AND offline_quota_seats >= 0
    AND platform_quota_seats + offline_quota_seats <= seat_template_count
    AND manual_supply = (platform_quota_seats = 0)
  );

ALTER TABLE seat_inventory
  ADD COLUMN sale_channel varchar(12) NOT NULL DEFAULT 'platform'
    CHECK (sale_channel IN ('platform', 'offline'));

CREATE TABLE departure_seat_quotas (
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE CASCADE,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 30),
  sale_channel varchar(12) NOT NULL CHECK (sale_channel IN ('platform', 'offline')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (departure_id, seat_number)
);
CREATE INDEX departure_seat_quotas_channel_idx
  ON departure_seat_quotas (departure_id, sale_channel, seat_number);

INSERT INTO departure_seat_quotas (departure_id, seat_number, sale_channel)
SELECT d.id, slot.seat_number,
       CASE WHEN inventory.departure_id IS NOT NULL THEN 'platform' ELSE 'offline' END
FROM departures d
JOIN generate_series(1, d.seat_template_count) AS slot(seat_number) ON true
LEFT JOIN seat_inventory inventory
  ON inventory.departure_id = d.id AND inventory.seat_number = slot.seat_number;

CREATE TABLE departure_quota_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 30),
  source_channel varchar(12) NOT NULL CHECK (source_channel IN ('platform', 'offline')),
  target_channel varchar(12) NOT NULL CHECK (target_channel IN ('platform', 'offline')),
  request_key varchar(80) NOT NULL,
  platform_quota_after smallint NOT NULL CHECK (platform_quota_after >= 0),
  offline_quota_after smallint NOT NULL CHECK (offline_quota_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (departure_id, request_key),
  CHECK (source_channel <> target_channel)
);
CREATE INDEX departure_quota_transfers_history_idx
  ON departure_quota_transfers (departure_id, created_at DESC);

CREATE FUNCTION initialize_departure_seat_quotas() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  boat_seat_count smallint;
BEGIN
  SELECT seat_count INTO boat_seat_count FROM boats WHERE id = NEW.boat_id;
  IF boat_seat_count IS NULL THEN
    RAISE EXCEPTION 'departure boat does not exist';
  END IF;
  IF NEW.seat_template_count IS NULL THEN
    NEW.seat_template_count := boat_seat_count;
  ELSIF NEW.seat_template_count <> boat_seat_count THEN
    RAISE EXCEPTION 'departure seat template count does not match its boat';
  END IF;
  IF NEW.platform_quota_seats IS NULL AND NEW.offline_quota_seats IS NULL THEN
    NEW.platform_quota_seats := 0;
    NEW.offline_quota_seats := boat_seat_count;
    NEW.manual_supply := true;
  ELSIF NEW.platform_quota_seats IS NULL OR NEW.offline_quota_seats IS NULL THEN
    RAISE EXCEPTION 'both quota counts must be provided';
  END IF;
  IF NEW.manual_supply IS NULL THEN
    NEW.manual_supply := NEW.platform_quota_seats = 0;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER departures_quota_defaults_before_insert
  BEFORE INSERT ON departures
  FOR EACH ROW EXECUTE FUNCTION initialize_departure_seat_quotas();

CREATE FUNCTION seed_departure_seat_quotas() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO departure_seat_quotas (departure_id, seat_number, sale_channel)
  SELECT NEW.id, slot.seat_number,
         CASE WHEN slot.seat_number <= NEW.platform_quota_seats THEN 'platform' ELSE 'offline' END
  FROM generate_series(1, NEW.platform_quota_seats + NEW.offline_quota_seats) AS slot(seat_number);
  RETURN NEW;
END;
$$;
CREATE TRIGGER departures_quota_seed_after_insert
  AFTER INSERT ON departures
  FOR EACH ROW EXECUTE FUNCTION seed_departure_seat_quotas();

COMMIT;
