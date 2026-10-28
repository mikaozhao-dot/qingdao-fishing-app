import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { config } from '../src/config.js';

if (process.env.STEP4_ACCEPTANCE !== 'true' || !config.databaseUrl) {
  throw new Error('Set STEP4_ACCEPTANCE=true and DATABASE_URL to an isolated acceptance database.');
}
if (config.nodeEnv === 'production') {
  throw new Error('Migration acceptance cannot run with NODE_ENV=production.');
}

const { Client } = pg;
const client = new Client({ connectionString: config.databaseUrl });
const migrationsDirectory = new URL('../migrations/', import.meta.url);
const schema = `g_guardian_${randomUUID().replaceAll('-', '')}`;
let assertions = 0;

function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}

async function applyMigration(file) {
  await client.query(await readFile(new URL(file, migrationsDirectory), 'utf8'));
  await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
}

await client.connect();
try {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}",public`);
  await client.query(`
    CREATE TABLE schema_migrations (
      version varchar(120) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const beforeGuardianHandling = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(file) && Number(file.slice(0, 3)) < 26)
    .sort();
  for (const file of beforeGuardianHandling) await applyMigration(file);
  check(beforeGuardianHandling.length, 25, 'fixture begins at the exact pre-026 schema');

  const migration026 = '026_g_insurance_failure_handling.sql';
  const migration027 = '027_g_insurance_failure_review_fixback.sql';
  const migration028 = '028_g_insurance_guardian_legacy_replay_backfill.sql';
  await applyMigration(migration026);

  const captainId = randomUUID();
  const buyerId = randomUUID();
  const boatId = randomUUID();
  const departureId = randomUUID();
  const seatId = randomUUID();
  const guardianSeatId = randomUUID();
  const orderId = randomUUID();
  const childId = randomUUID();
  const guardianId = randomUUID();
  const legacyDecisionKey = 'legacy-guardian-exit-026';
  const legacyRefundKey = `insurance-guardian-exit:${guardianId}`;

  await client.query(
    `INSERT INTO users(id,phone_ciphertext,phone_hash,display_name)
     VALUES($1,$2,$3,'migration fixture captain'),($4,$5,$6,'migration fixture buyer')`,
    [captainId, Buffer.from('captain-phone'), Buffer.alloc(32, 1),
      buyerId, Buffer.from('buyer-phone'), Buffer.alloc(32, 2)],
  );
  await client.query(
    `INSERT INTO captain_profiles(user_id,captain_name,verification_status)
     VALUES($1,'migration fixture captain','approved')`, [captainId],
  );
  await client.query(
    `INSERT INTO boats(id,captain_user_id,name,length_cm,home_marina_code,seat_template_code,
                       seat_count,review_status)
     VALUES($1,$2,'migration fixture boat',900,'xiaogang','qingdao-12-seat-v1',12,'approved')`,
    [boatId, captainId],
  );
  await client.query(
    `INSERT INTO departures(id,boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,
                            target_area_code,marina_code,minimum_sailing_total_fen,price_per_seat_fen,
                            booking_deadline,status,seat_template_count,platform_quota_seats,
                            offline_quota_seats,manual_supply)
     VALUES($1,$2,$3,'pro_fishing',now()+interval '72 hours',now()+interval '71 hours 30 minutes',
            now()+interval '78 hours','qd_coast','xiaogang',10000,5000,now()+interval '69 hours',
            'confirmed',12,12,0,false)`,
    [departureId, boatId, captainId],
  );
  await client.query(
    `INSERT INTO seat_inventory(id,departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES($1,$2,1,5000,'port','mid','booked'),($3,$2,2,5000,'starboard','mid','booked')`,
    [seatId, departureId, guardianSeatId],
  );
  await client.query(
    `INSERT INTO booking_orders(id,order_number,departure_id,seat_inventory_id,buyer_user_id,
                                status,seat_fee_fen,discount_fen,platform_fee_fen,total_amount_fen,paid_at)
     VALUES($1,$2,$3,$4,$5,'paid',5000,0,0,5000,now())`,
    [orderId, `G-LEGACY-${randomUUID().slice(0, 12)}`, departureId, seatId, buyerId],
  );
  await client.query(
    `INSERT INTO booking_order_seats(order_id,seat_inventory_id,seat_number,price_fen,status)
     VALUES($1,$2,1,5000,'paid'),($1,$3,2,5000,'paid')`, [orderId, seatId, guardianSeatId],
  );
  await client.query(
    `INSERT INTO order_passengers(id,order_id,seat_inventory_id,full_name_ciphertext,
                                  identity_number_ciphertext,phone_ciphertext,identity_verified_at)
     VALUES($1,$3,$4,$5,$6,$7,now()),($2,$3,$8,$9,$10,$11,now())`,
    [childId, guardianId, orderId, seatId, Buffer.from('legacy-child'), Buffer.from('child-id'),
      Buffer.from('child-phone'), guardianSeatId, Buffer.from('legacy-guardian'), Buffer.from('guardian-id'),
      Buffer.from('guardian-phone')],
  );

  // Recreate the exact 026-era persisted decision and the passenger-scoped refund it created.
  await client.query(
    `INSERT INTO insurance_guardian_exit_decisions
       (order_id,child_passenger_id,guardian_passenger_id,request_key,relationship_confirmed)
     VALUES($1,$2,$3,$4,true)`, [orderId, childId, guardianId, legacyDecisionKey],
  );
  await client.query(
    `INSERT INTO refund_obligations(order_id,passenger_id,amount_fen,reason,status,request_key)
     VALUES($1,$2,5000,'insurance_failure','sandbox_succeeded',$3)`,
    [orderId, guardianId, legacyRefundKey],
  );

  await applyMigration(migration027);
  const after027 = (await client.query(
    `SELECT refund_fen,departure_cancelled FROM insurance_guardian_exit_decisions WHERE order_id=$1`,
    [orderId],
  )).rows[0];
  check(after027, { refund_fen: 0, departure_cancelled: false },
    'fixture reproduces migration 027 defaults before the compatibility backfill');

  await applyMigration(migration028);
  const after028 = (await client.query(
    `SELECT refund_fen,departure_cancelled,departure_outcome_known
     FROM insurance_guardian_exit_decisions WHERE order_id=$1`, [orderId],
  )).rows[0];
  check(after028, { refund_fen: 5000, departure_cancelled: false, departure_outcome_known: false },
    'migration 028 restores the historical refund and keeps the unavailable trip outcome marked unknown');

  // A retry is safe for installations that need to verify/reapply the idempotent SQL.
  await client.query(await readFile(new URL(migration028, migrationsDirectory), 'utf8'));
  check((await client.query(
    `SELECT refund_fen,departure_cancelled,departure_outcome_known
     FROM insurance_guardian_exit_decisions WHERE order_id=$1`, [orderId],
  )).rows[0], after028, 'migration 028 is idempotent for the legacy decision');
  console.log(`G guardian migration acceptance passed: ${assertions} assertions.`);
} finally {
  await client.query('RESET search_path').catch(() => {});
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await client.end();
}
