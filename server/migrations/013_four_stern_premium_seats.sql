BEGIN;

DO $$
DECLARE
  current_layout jsonb;
BEGIN
  SELECT layout
    INTO current_layout
    FROM seat_templates
   WHERE code = 'qingdao-12-seat-v1'
     AND version = 1
     AND seat_count = 12
   FOR UPDATE;

  IF current_layout IS NULL THEN
    RAISE EXCEPTION 'Expected the 12-seat qingdao-12-seat-v1 template before migration 013';
  END IF;

  IF jsonb_typeof(current_layout) <> 'array' THEN
    RAISE EXCEPTION 'Expected qingdao-12-seat-v1 layout to be a JSON array';
  END IF;

  IF jsonb_array_length(current_layout) <> 12 THEN
    RAISE EXCEPTION 'Expected the 12-seat qingdao-12-seat-v1 template before migration 013';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(current_layout) AS seat(item)
        WHERE (item->>'number')::integer = 5
          AND item->>'side' = 'port' AND item->>'section' = 'stern'
     ) OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(current_layout) AS seat(item)
        WHERE (item->>'number')::integer = 8
          AND item->>'side' = 'starboard' AND item->>'section' = 'stern'
     ) THEN
    RAISE EXCEPTION 'Seat 5 or 8 no longer matches the approved stern layout';
  END IF;

  UPDATE seat_templates AS template
     SET layout = (
       SELECT jsonb_agg(
                CASE
                  WHEN (item->>'number')::integer IN (5, 8)
                    THEN jsonb_set(item, '{premium}', 'true'::jsonb, true)
                  ELSE item
                END
                ORDER BY ordinal
              )
         FROM jsonb_array_elements(template.layout) WITH ORDINALITY AS seats(item, ordinal)
     )
   WHERE template.code = 'qingdao-12-seat-v1'
     AND template.version = 1
     AND template.seat_count = 12;
END;
$$;

COMMIT;
