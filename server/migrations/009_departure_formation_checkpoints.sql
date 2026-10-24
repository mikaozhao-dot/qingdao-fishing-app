BEGIN;

ALTER TABLE departures
  DROP CONSTRAINT IF EXISTS departures_status_check;
ALTER TABLE departures
  ADD CONSTRAINT departures_status_check CHECK (
    status IN ('draft','open','forming','confirmed','captain_confirmed','handling_shortfall',
      'weather_cancelled','in_progress','cancelled','completed')
  );

-- Only server-verified, idempotent events enter the automatic platform account.
CREATE TABLE IF NOT EXISTS departure_formation_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  adjustment_type varchar(24) NOT NULL CHECK (adjustment_type IN ('penalty_pool','successful_supplement')),
  amount_fen integer NOT NULL CHECK (amount_fen > 0 AND amount_fen <= 2000000000),
  source_reference varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (departure_id,adjustment_type,source_reference)
);

CREATE INDEX IF NOT EXISTS departure_formation_adjustments_type_idx
  ON departure_formation_adjustments (departure_id,adjustment_type);

CREATE TABLE IF NOT EXISTS departure_formation_snapshots (
  departure_id uuid PRIMARY KEY REFERENCES departures(id) ON DELETE RESTRICT,
  confirmation_at timestamptz NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  threshold_fen integer NOT NULL CHECK (threshold_fen > 0),
  platform_ticket_net_fen bigint NOT NULL CHECK (platform_ticket_net_fen >= 0),
  penalty_pool_fen bigint NOT NULL CHECK (penalty_pool_fen >= 0),
  successful_supplement_fen bigint NOT NULL CHECK (successful_supplement_fen >= 0),
  platform_verifiable_fen bigint NOT NULL CHECK (platform_verifiable_fen >= 0),
  captain_offline_declared_fen bigint NOT NULL CHECK (captain_offline_declared_fen >= 0),
  outcome varchar(24) NOT NULL CHECK (outcome IN ('automatic_confirmed','shortfall')),
  CHECK (platform_verifiable_fen = platform_ticket_net_fen + penalty_pool_fen + successful_supplement_fen)
);

CREATE TABLE IF NOT EXISTS departure_captain_formation_decisions (
  departure_id uuid PRIMARY KEY REFERENCES departures(id) ON DELETE RESTRICT,
  captain_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  threshold_fen integer NOT NULL CHECK (threshold_fen > 0),
  platform_verifiable_fen bigint NOT NULL CHECK (platform_verifiable_fen >= 0),
  captain_offline_declared_fen bigint NOT NULL CHECK (captain_offline_declared_fen >= 0),
  basis_note varchar(200) NOT NULL CHECK (length(btrim(basis_note)) BETWEEN 1 AND 200),
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (platform_verifiable_fen + captain_offline_declared_fen >= threshold_fen)
);

COMMIT;
