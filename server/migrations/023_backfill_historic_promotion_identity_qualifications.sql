BEGIN;

-- Migration 022 seeded currently positive ledgers. Also backfill qualifications
-- that were historically created and later fully reversed before the upgrade.
WITH historical_commission_events AS (
  SELECT commission_ledger_id, MIN(created_at) AS first_created_at
  FROM promotion_commission_events
  WHERE event_type='commission_created' AND amount_fen > 0
  GROUP BY commission_ledger_id
)
INSERT INTO promotion_identity_qualifications
  (identity_number_hash,user_id,promotion_attribution_id,consumed_at)
SELECT u.identity_number_hash,u.id,a.id,
       COALESCE(a.qualified_at,hce.first_created_at,a.attributed_at)
FROM promotion_attributions a
JOIN commission_ledger l ON l.promotion_attribution_id=a.id
JOIN users u ON u.id=a.attributed_user_id
LEFT JOIN historical_commission_events hce ON hce.commission_ledger_id=l.id
WHERE u.identity_status='verified'
  AND u.identity_number_hash IS NOT NULL
  AND (l.amount_fen > 0 OR a.qualified_at IS NOT NULL OR hce.first_created_at IS NOT NULL)
ON CONFLICT DO NOTHING;

COMMIT;
