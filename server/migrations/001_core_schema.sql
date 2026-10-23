BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_ciphertext bytea NOT NULL,
  phone_hash bytea NOT NULL UNIQUE,
  display_name varchar(80),
  legal_name_ciphertext bytea,
  identity_number_ciphertext bytea,
  identity_verified_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS captain_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  captain_name varchar(80) NOT NULL,
  license_reference varchar(160),
  verification_status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'approved', 'rejected', 'suspended')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS boats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_user_id uuid NOT NULL REFERENCES captain_profiles(user_id) ON DELETE RESTRICT,
  name varchar(100) NOT NULL,
  length_cm integer NOT NULL CHECK (length_cm > 0),
  registration_number_ciphertext bytea,
  registration_record_uri text,
  home_marina_code varchar(80) NOT NULL,
  facilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  seat_template_code varchar(40),
  seat_count smallint NOT NULL CHECK (seat_count BETWEEN 1 AND 30),
  comfort_level varchar(20) CHECK (comfort_level IN ('spacious', 'comfortable', 'compact')),
  review_status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS boat_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boat_id uuid NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  photo_kind varchar(24) NOT NULL
    CHECK (photo_kind IN ('exterior', 'deck', 'cabin', 'toilet', 'certificate')),
  object_uri text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boat_id uuid NOT NULL REFERENCES boats(id) ON DELETE RESTRICT,
  captain_user_id uuid NOT NULL REFERENCES captain_profiles(user_id) ON DELETE RESTRICT,
  trip_type varchar(24) NOT NULL CHECK (trip_type IN ('experience', 'pro_fishing')),
  departure_at timestamptz NOT NULL,
  return_at timestamptz NOT NULL,
  target_area_code varchar(80) NOT NULL,
  marina_code varchar(80) NOT NULL,
  minimum_sailing_total_fen integer NOT NULL CHECK (minimum_sailing_total_fen > 0),
  price_per_seat_fen integer NOT NULL CHECK (price_per_seat_fen >= 0),
  whole_boat_price_fen integer CHECK (whole_boat_price_fen >= 0),
  booking_deadline timestamptz NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('draft', 'open', 'forming', 'confirmed', 'handling_shortfall', 'cancelled', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (return_at > departure_at)
);

CREATE INDEX IF NOT EXISTS departures_search_idx
  ON departures (status, departure_at, marina_code, trip_type);
CREATE INDEX IF NOT EXISTS departures_boat_idx ON departures (boat_id, departure_at DESC);

CREATE TABLE IF NOT EXISTS departure_fish_targets (
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE CASCADE,
  fish_code varchar(60) NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (departure_id, fish_code)
);

CREATE TABLE IF NOT EXISTS departure_rig_configs (
  departure_id uuid PRIMARY KEY REFERENCES departures(id) ON DELETE CASCADE,
  bait_types varchar(40)[] NOT NULL DEFAULT '{}',
  bait_grams_per_person integer CHECK (bait_grams_per_person >= 0),
  bait_supply varchar(24) CHECK (bait_supply IN ('captain_provided', 'guest_bring', 'onboard_purchase')),
  main_line_pe numeric(3, 1),
  leader_line_number smallint,
  sinker_shape varchar(30),
  sinker_min_grams smallint,
  sinker_max_grams smallint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sinker_max_grams IS NULL OR sinker_min_grams IS NULL OR sinker_max_grams >= sinker_min_grams)
);

CREATE TABLE IF NOT EXISTS seat_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE CASCADE,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 30),
  price_fen integer NOT NULL CHECK (price_fen >= 0),
  status varchar(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'held', 'booked', 'blocked')),
  hold_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (departure_id, seat_number)
);

CREATE TABLE IF NOT EXISTS booking_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number varchar(40) NOT NULL UNIQUE,
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  seat_inventory_id uuid NOT NULL REFERENCES seat_inventory(id) ON DELETE RESTRICT,
  buyer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'refunded', 'completed')),
  seat_fee_fen integer NOT NULL CHECK (seat_fee_fen >= 0),
  discount_fen integer NOT NULL DEFAULT 0 CHECK (discount_fen >= 0),
  platform_fee_fen integer NOT NULL DEFAULT 0 CHECK (platform_fee_fen >= 0),
  total_amount_fen integer NOT NULL CHECK (total_amount_fen >= 0),
  hold_expires_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, seat_inventory_id),
  CHECK (discount_fen <= seat_fee_fen),
  CHECK (total_amount_fen = seat_fee_fen - discount_fen + platform_fee_fen)
);

CREATE INDEX IF NOT EXISTS booking_orders_user_idx
  ON booking_orders (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_orders_departure_idx
  ON booking_orders (departure_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS booking_orders_active_seat_idx
  ON booking_orders (seat_inventory_id)
  WHERE status IN ('pending_payment', 'paid', 'completed');

CREATE TABLE IF NOT EXISTS order_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE CASCADE,
  full_name_ciphertext bytea NOT NULL,
  identity_number_ciphertext bytea NOT NULL,
  phone_ciphertext bytea NOT NULL,
  identity_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES booking_orders(id) ON DELETE RESTRICT,
  provider_code varchar(80),
  provider_policy_reference varchar(160),
  insured_amount_fen bigint CHECK (insured_amount_fen >= 0),
  status varchar(24) NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'checkout_started', 'issued', 'failed', 'cancelled')),
  checkout_url text,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES booking_orders(id) ON DELETE RESTRICT,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  boat_id uuid NOT NULL REFERENCES boats(id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags varchar(40)[] NOT NULL DEFAULT '{}',
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catch_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source varchar(20) NOT NULL CHECK (source IN ('captain', 'passenger')),
  fish_code varchar(60) NOT NULL,
  quantity smallint NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_weight_grams integer CHECK (total_weight_grams >= 0),
  photo_uri text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code varchar(40) NOT NULL UNIQUE,
  channel varchar(24) NOT NULL
    CHECK (channel IN ('member', 'hotel', 'travel_agency', 'creator', 'captain', 'marina')),
  status varchar(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_code_id uuid NOT NULL REFERENCES promotion_codes(id) ON DELETE RESTRICT,
  attributed_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  order_id uuid REFERENCES booking_orders(id) ON DELETE SET NULL,
  attribution_key_hash bytea,
  attributed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS promotion_attribution_order_idx
  ON promotion_attributions (order_id) WHERE order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS commission_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_attribution_id uuid NOT NULL REFERENCES promotion_attributions(id) ON DELETE RESTRICT,
  payee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_fen integer NOT NULL CHECK (amount_fen >= 0),
  status varchar(20) NOT NULL DEFAULT 'frozen'
    CHECK (status IN ('frozen', 'available', 'paid', 'reversed')),
  release_at timestamptz NOT NULL,
  paid_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commission_ledger_payee_idx
  ON commission_ledger (payee_user_id, status, release_at);

COMMIT;
