import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';

if (process.env.STEP6_PROMOTION_ACCEPTANCE !== 'true' || !config.databaseUrl) {
  throw new Error('Set STEP6_PROMOTION_ACCEPTANCE=true and DATABASE_URL to an isolated acceptance database.');
}
if (config.nodeEnv === 'production') {
  throw new Error('Migration acceptance cannot run with NODE_ENV=production.');
}

const { Client } = pg;
const client = new Client({ connectionString: config.databaseUrl });
const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const migration024 = '024_step6_refund_reorder_commission_orders.sql';
const schemas = [];
let assertions = 0;

function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}

function makeSchemaName() {
  const name = `s6_b024_${randomUUID().replaceAll('-', '')}`;
  schemas.push(name);
  return name;
}

async function prepare023Schema(schema) {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}",public`);
  await client.query(`
    CREATE TABLE schema_migrations (
      version varchar(120) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(name) && Number(name.slice(0, 3)) < 24)
    .sort();
  for (const file of files) {
    await client.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
  }
  check(files.length, 23, 'fixture is at the exact pre-024 schema version');
}

async function seedLegacyLedgerFixture({ unmapped = false } = {}) {
  const referrerId = randomUUID();
  const captainId = randomUUID();
  const codeId = randomUUID();
  const rows = [];

  await client.query(
    `INSERT INTO users(id,phone_ciphertext,phone_hash,display_name)
     VALUES($1,$2,$3,'migration fixture captain')`,
    [captainId, Buffer.from('captain'), Buffer.alloc(32, 1)],
  );
  await client.query(
    `INSERT INTO captain_profiles(user_id,captain_name,verification_status)
     VALUES($1,'migration fixture captain','approved')`, [captainId],
  );
  await client.query(
    `INSERT INTO users(id,phone_ciphertext,phone_hash,display_name)
     VALUES($1,$2,$3,'migration fixture referrer')`,
    [referrerId, Buffer.from('referrer'), Buffer.alloc(32, 2)],
  );
  await client.query(
    `INSERT INTO promotion_codes(id,owner_user_id,code,channel,status)
     VALUES($1,$2,$3,'member','active')`,
    [codeId, referrerId, `S6B024-${randomUUID().slice(0, 12)}`],
  );

  for (let index = 0; index < (unmapped ? 1 : 3); index += 1) {
    const buyerId = randomUUID();
    const boatId = randomUUID();
    const departureId = randomUUID();
    const seatId = randomUUID();
    const orderId = randomUUID();
    const attributionId = randomUUID();
    const ledgerId = randomUUID();
    const now = Date.now();
    const departureAt = new Date(now + (5 + index) * 86_400_000);
    const returnAt = new Date(departureAt.getTime() + 6 * 3_600_000);
    const paidAt = new Date(now - (index + 1) * 3_600_000);

    rows.push({
      index, buyerId, departureId, orderId, attributionId, ledgerId,
      status: unmapped ? 'frozen' : ['frozen', 'reversed', 'available'][index],
      amountFen: unmapped ? 500 : [500, 0, 400][index],
      netTicketAmountFen: unmapped ? 10_000 : [10_000, 0, 8_000][index],
    });

    await client.query(
      `INSERT INTO users(id,phone_ciphertext,phone_hash,display_name)
       VALUES($1,$2,$3,$4)`,
      [buyerId, Buffer.from(`buyer-${index}`), Buffer.alloc(32, index + 10), `migration fixture buyer ${index}`],
    );
    await client.query(
      `INSERT INTO boats(id,captain_user_id,name,length_cm,home_marina_code,seat_template_code,
                         seat_count,review_status)
       VALUES($1,$2,$3,900,'xiaogang','qingdao-12-seat-v1',12,'approved')`,
      [boatId, captainId, `migration fixture boat ${index}`],
    );
    await client.query(
      `INSERT INTO departures(id,boat_id,captain_user_id,trip_type,departure_at,return_at,
                              target_area_code,marina_code,minimum_sailing_total_fen,
                              price_per_seat_fen,booking_deadline,seat_template_count,
                              platform_quota_seats,offline_quota_seats,manual_supply)
       VALUES($1,$2,$3,'pro_fishing',$4,$5,'qd_coast','xiaogang',10000,10000,
              $4::timestamptz-interval '1 hour',12,1,11,false)`,
      [departureId, boatId, captainId, departureAt, returnAt],
    );
    await client.query(
      `INSERT INTO seat_inventory(id,departure_id,seat_number,price_fen,seat_side,seat_section)
       VALUES($1,$2,1,10000,'port','mid')`, [seatId, departureId],
    );
    await client.query(
      `INSERT INTO booking_orders(id,order_number,departure_id,seat_inventory_id,buyer_user_id,
                                  status,seat_fee_fen,discount_fen,platform_fee_fen,total_amount_fen,paid_at)
       VALUES($1,$2,$3,$4,$5,'paid',10000,0,300,10300,$6)`,
      [orderId, `S6B024-${randomUUID().slice(0, 12)}`, departureId, seatId, buyerId, paidAt],
    );
    await client.query(
      `INSERT INTO promotion_attributions(id,promotion_code_id,attributed_user_id,order_id)
       VALUES($1,$2,$3,$4)`,
      [attributionId, codeId, buyerId, unmapped ? null : orderId],
    );
    const reversedAt = rows[index].status === 'reversed' ? new Date(now - 60_000) : null;
    const releasedAt = rows[index].status === 'available' ? new Date(now - 86_400_000) : new Date(now + 7 * 86_400_000);
    await client.query(
      `INSERT INTO commission_ledger(id,promotion_attribution_id,payee_user_id,amount_fen,
                                     net_ticket_amount_fen,rate_basis_points,status,release_at,reversed_at)
       VALUES($1,$2,$3,$4,$5,500,$6,$7,$8)`,
      [ledgerId, attributionId, referrerId, rows[index].amountFen,
        rows[index].netTicketAmountFen, rows[index].status, releasedAt, reversedAt],
    );
    await client.query(
      `INSERT INTO promotion_commission_events(commission_ledger_id,event_type,amount_fen,details)
       VALUES($1,$2,$3,'{}'::jsonb)`,
      [ledgerId, rows[index].status === 'reversed' ? 'commission_reversed_before_release'
        : rows[index].status === 'available' ? 'commission_released' : 'commission_created',
      rows[index].amountFen],
    );
  }
  return rows;
}

async function applyMigration024(schema) {
  const alreadyApplied = await client.query(
    'SELECT 1 FROM schema_migrations WHERE version=$1', [migration024],
  );
  if (alreadyApplied.rowCount) return;
  await client.query(await readFile(new URL(`../migrations/${migration024}`, import.meta.url), 'utf8'));
  await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [migration024]);
}

await client.connect();
try {
  const successSchema = makeSchemaName();
  await prepare023Schema(successSchema);
  const legacyRows = await seedLegacyLedgerFixture();
  await applyMigration024(successSchema);

  const mapped = await client.query(
    `SELECT l.id,l.booking_order_id,a.order_id,l.amount_fen,l.net_ticket_amount_fen,
            l.status,l.release_refund_baseline_fen
     FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     ORDER BY l.id`,
  );
  check(mapped.rowCount, 3, 'migration maps all historical ledger rows');
  for (const legacy of legacyRows) {
    const row = mapped.rows.find((item) => item.id === legacy.ledgerId);
    check(row?.booking_order_id, legacy.orderId, `legacy ${legacy.status} ledger links to its original order`);
    check(row?.order_id, legacy.orderId, `legacy ${legacy.status} attribution remains unchanged`);
    check(Number(row?.amount_fen), legacy.amountFen, `legacy ${legacy.status} amount is preserved`);
    check(Number(row?.net_ticket_amount_fen), legacy.netTicketAmountFen,
      `legacy ${legacy.status} net amount is preserved`);
    check(row?.status, legacy.status, `legacy ${legacy.status} state is preserved`);
  }
  check((await client.query(
    `SELECT count(*)::integer AS count FROM promotion_commission_events
     WHERE commission_ledger_id=ANY($1::uuid[])`, [legacyRows.map((row) => row.ledgerId)],
  )).rows[0].count, 3, 'migration preserves historical event rows');
  check((await client.query(
    `SELECT count(*)::integer AS count FROM schema_migrations WHERE version=$1`, [migration024],
  )).rows[0].count, 1, 'successful upgrade records migration 024 exactly once');
  check((await client.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema=$1 AND table_name='commission_ledger' AND column_name='booking_order_id'`,
    [successSchema],
  )).rows[0].is_nullable, 'NO', 'booking_order_id is required after successful upgrade');
  const indexResult = await client.query(
    `SELECT indexname,indexdef FROM pg_indexes
     WHERE schemaname=$1 AND indexname IN (
       'commission_ledger_booking_order_unique_idx',
       'commission_ledger_one_effective_per_attribution_idx'
     ) ORDER BY indexname`, [successSchema],
  );
  check(indexResult.rowCount, 2, 'upgrade creates both database uniqueness guards');
  check(indexResult.rows.every((row) => row.indexdef.includes('UNIQUE')), true,
    'both refund-reorder guards are unique indexes');
  check(indexResult.rows.some((row) => row.indexname === 'commission_ledger_one_effective_per_attribution_idx'
    && row.indexdef.includes('WHERE')
    && row.indexdef.includes("<> 'reversed'::text")), true,
  'one-effective-ledger index excludes only reversed historical rows');

  const failureSchema = makeSchemaName();
  await prepare023Schema(failureSchema);
  const [unmappedRow] = await seedLegacyLedgerFixture({ unmapped: true });
  let migrationError;
  try {
    await applyMigration024(failureSchema);
  } catch (error) {
    migrationError = error;
    await client.query('ROLLBACK').catch(() => {});
  }
  assert.ok(migrationError, 'unmappable legacy ledger causes the migration to fail');
  assertions += 1;
  check(migrationError.message.includes('Cannot backfill commission_ledger.booking_order_id'), true,
    'unmapped failure identifies the missing historical order association');
  check((await client.query(
    `SELECT count(*)::integer AS count FROM schema_migrations WHERE version=$1`, [migration024],
  )).rows[0].count, 0, 'failed upgrade does not record migration 024');
  check((await client.query(
    `SELECT count(*)::integer AS count FROM information_schema.columns
     WHERE table_schema=$1 AND table_name='commission_ledger' AND column_name='booking_order_id'`,
    [failureSchema],
  )).rows[0].count, 0, 'failed upgrade rolls back the new ledger column');
  check((await client.query(
    `SELECT count(*)::integer AS count FROM pg_indexes
     WHERE schemaname=$1 AND indexname IN (
       'commission_ledger_booking_order_unique_idx',
       'commission_ledger_one_effective_per_attribution_idx'
     )`, [failureSchema],
  )).rows[0].count, 0, 'failed upgrade rolls back both new indexes');
  const unchanged = await client.query(
    'SELECT amount_fen,status FROM commission_ledger WHERE id=$1', [unmappedRow.ledgerId],
  );
  check(Number(unchanged.rows[0].amount_fen), unmappedRow.amountFen,
    'failed upgrade preserves the original ledger amount');
  check(unchanged.rows[0].status, unmappedRow.status,
    'failed upgrade preserves the original ledger state');

  await client.query('UPDATE promotion_attributions SET order_id=$2 WHERE id=$1',
    [unmappedRow.attributionId, unmappedRow.orderId]);
  await applyMigration024(failureSchema);
  check((await client.query(
    `SELECT booking_order_id FROM commission_ledger WHERE id=$1`, [unmappedRow.ledgerId],
  )).rows[0].booking_order_id, unmappedRow.orderId,
  'fixed historical association can be upgraded after the rolled-back failure');
  check((await client.query(
    `SELECT count(*)::integer AS count FROM schema_migrations WHERE version=$1`, [migration024],
  )).rows[0].count, 1, 'retry after correction records migration 024 once');

  process.stdout.write(`Step 6 refund-reorder migration acceptance passed: ${assertions} assertions.\n`);
} finally {
  for (const schema of schemas) {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  }
  await client.end();
}
