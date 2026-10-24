BEGIN;

-- Captain-reported offline sales stay separate from platform-verified money.
-- Entries are append-only; negative entries correct a previous overstatement.
CREATE TABLE IF NOT EXISTS departure_offline_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  captain_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_delta_fen integer NOT NULL CHECK (
    amount_delta_fen <> 0 AND amount_delta_fen BETWEEN -2000000000 AND 2000000000
  ),
  note varchar(200) NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 200),
  request_key varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (departure_id, request_key)
);

CREATE INDEX IF NOT EXISTS departure_offline_ledger_history_idx
  ON departure_offline_ledger_entries (departure_id, created_at, id);

COMMIT;
