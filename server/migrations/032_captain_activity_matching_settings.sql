BEGIN;

CREATE TABLE IF NOT EXISTS captain_service_marinas (
  captain_user_id uuid NOT NULL REFERENCES captain_profiles(user_id) ON DELETE CASCADE,
  marina_code varchar(80) NOT NULL CHECK (length(trim(marina_code)) > 0),
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (captain_user_id, marina_code),
  UNIQUE (captain_user_id, sort_order)
);

CREATE TABLE IF NOT EXISTS captain_fish_targets (
  captain_user_id uuid NOT NULL REFERENCES captain_profiles(user_id) ON DELETE CASCADE,
  fish_code varchar(60) NOT NULL CHECK (length(trim(fish_code)) > 0),
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (captain_user_id, fish_code),
  UNIQUE (captain_user_id, sort_order)
);

CREATE INDEX IF NOT EXISTS captain_service_marinas_lookup_idx
  ON captain_service_marinas (marina_code, captain_user_id);
CREATE INDEX IF NOT EXISTS captain_fish_targets_lookup_idx
  ON captain_fish_targets (fish_code, captain_user_id);

INSERT INTO captain_service_marinas (captain_user_id, marina_code, sort_order)
SELECT b.captain_user_id, b.home_marina_code,
       row_number() OVER (PARTITION BY b.captain_user_id ORDER BY b.home_marina_code)::smallint - 1
FROM (
  SELECT DISTINCT captain_user_id, home_marina_code
  FROM boats
  WHERE review_status = 'approved'
) b
ON CONFLICT (captain_user_id, marina_code) DO NOTHING;

COMMIT;
