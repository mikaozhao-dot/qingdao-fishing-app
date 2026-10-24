BEGIN;

ALTER TABLE departures
  DROP CONSTRAINT IF EXISTS departures_status_check;
ALTER TABLE departures
  ADD CONSTRAINT departures_status_check CHECK (
    status IN ('draft','open','forming','confirmed','captain_confirmed','handling_shortfall',
      'formation_overdue','weather_cancelled','in_progress','cancelled','completed')
  );

COMMIT;
