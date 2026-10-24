BEGIN;

CREATE OR REPLACE FUNCTION prevent_departure_price_change_after_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(NEW.minimum_sailing_total_fen, NEW.price_per_seat_fen,
         NEW.stern_surcharge_fen, NEW.whole_boat_price_fen)
     IS DISTINCT FROM
     ROW(OLD.minimum_sailing_total_fen, OLD.price_per_seat_fen,
         OLD.stern_surcharge_fen, OLD.whole_boat_price_fen)
     AND EXISTS (SELECT 1 FROM booking_orders WHERE departure_id=OLD.id)
  THEN
    RAISE EXCEPTION 'departure_price_frozen_after_order'
      USING ERRCODE='23514', CONSTRAINT='departure_price_frozen_after_order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS departures_price_freeze_after_order ON departures;
CREATE TRIGGER departures_price_freeze_after_order
  BEFORE UPDATE OF minimum_sailing_total_fen, price_per_seat_fen,
                   stern_surcharge_fen, whole_boat_price_fen
  ON departures
  FOR EACH ROW EXECUTE FUNCTION prevent_departure_price_change_after_order();

COMMIT;
