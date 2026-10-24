BEGIN;

ALTER TABLE departures
  ADD COLUMN IF NOT EXISTS seat_layout_snapshot jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations
     WHERE version = '013_four_stern_premium_seats.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 013 must be recorded before departure seat layouts can be snapshotted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'departures_seat_layout_snapshot_array_check'
       AND conrelid = 'departures'::regclass
  ) THEN
    ALTER TABLE departures
      ADD CONSTRAINT departures_seat_layout_snapshot_array_check
      CHECK (seat_layout_snapshot IS NULL OR jsonb_typeof(seat_layout_snapshot) = 'array');
  END IF;
END;
$$;

WITH premium_change AS (
  SELECT applied_at
    FROM schema_migrations
   WHERE version = '013_four_stern_premium_seats.sql'
)
UPDATE departures AS departure
   SET seat_layout_snapshot = (
     SELECT jsonb_agg(
              jsonb_build_object(
                'number', (position.value->>'number')::smallint,
                'side', COALESCE(inventory.seat_side, position.value->>'side'),
                'section', COALESCE(inventory.seat_section, position.value->>'section'),
                'premium', COALESCE(
                  inventory.is_premium,
                  CASE
                    WHEN departure.created_at < premium_change.applied_at
                     AND (position.value->>'number')::integer IN (5, 8) THEN false
                    ELSE COALESCE((position.value->>'premium')::boolean, false)
                  END
                )
              ) ORDER BY position.ordinality
            )
       FROM boats AS boat
       JOIN seat_templates AS template
         ON template.code = boat.seat_template_code
        AND template.seat_count = departure.seat_template_count
       CROSS JOIN LATERAL jsonb_array_elements(template.layout)
         WITH ORDINALITY AS position(value, ordinality)
       LEFT JOIN seat_inventory AS inventory
         ON inventory.departure_id = departure.id
        AND inventory.seat_number = (position.value->>'number')::smallint
      WHERE boat.id = departure.boat_id
   )
  FROM premium_change
 WHERE departure.seat_layout_snapshot IS NULL
   AND EXISTS (
     SELECT 1
       FROM boats AS boat
       JOIN seat_templates AS template
         ON template.code = boat.seat_template_code
        AND template.seat_count = departure.seat_template_count
      WHERE boat.id = departure.boat_id
        AND jsonb_typeof(template.layout) = 'array'
        AND jsonb_array_length(template.layout) = departure.seat_template_count
   );

COMMENT ON COLUMN departures.seat_layout_snapshot IS
  'Immutable position and premium layout captured when the departure is published; used when offline quota seats later enter platform inventory.';

COMMIT;
