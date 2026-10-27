BEGIN;

ALTER TABLE promotion_attributions
  DROP CONSTRAINT IF EXISTS promotion_attributions_source_channel_check;
ALTER TABLE promotion_attributions
  ADD CONSTRAINT promotion_attributions_source_channel_check
    CHECK (source_channel IN ('qr', 'share', 'link', 'certificate'));

ALTER TABLE promotion_touch_events
  DROP CONSTRAINT IF EXISTS promotion_touch_events_source_channel_check;
ALTER TABLE promotion_touch_events
  ADD CONSTRAINT promotion_touch_events_source_channel_check
    CHECK (source_channel IN ('qr', 'share', 'link', 'certificate'));

CREATE TABLE IF NOT EXISTS step6_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  departure_id uuid NOT NULL REFERENCES departures(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES booking_orders(id) ON DELETE RESTRICT,
  passenger_id uuid NOT NULL REFERENCES order_passengers(id) ON DELETE RESTRICT,
  promotion_code_id uuid NOT NULL REFERENCES promotion_codes(id) ON DELETE RESTRICT,
  promotion_code_snapshot varchar(40) NOT NULL,
  template_version varchar(32) NOT NULL CHECK (template_version = 'qd-cert-v1'),
  source_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, departure_id)
);

CREATE INDEX IF NOT EXISTS step6_certificates_owner_list_idx
  ON step6_certificates (owner_user_id, generated_at DESC, id)
  WHERE hidden_at IS NULL;

COMMIT;
