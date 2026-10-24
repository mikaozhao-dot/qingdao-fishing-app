import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createSecurity, makeSandboxIdentityNumber } from '../src/security.js';
import { processConfirmedChecklists } from '../src/step4-routes.js';

if (process.env.STEP4_ACCEPTANCE !== 'true') {
  throw new Error('Set STEP4_ACCEPTANCE=true and use an empty, isolated acceptance database.');
}
if (!config.databaseUrl || !config.redisUrl) throw new Error('DATABASE_URL and REDIS_URL are required.');

const testConfig = {
  ...config,
  nodeEnv: 'test',
  logLevel: 'silent',
  piiEncryptionKeyHex: config.piiEncryptionKeyHex || '11'.repeat(32),
  phoneHashKeyHex: config.phoneHashKeyHex || '22'.repeat(32),
};
const security = createSecurity(testConfig);
const { Pool } = pg;
const pool = new Pool({ connectionString: config.databaseUrl, max: 4 });
const app = buildApp(testConfig);
let sequence = 0;
let assertions = 0;

function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}

async function request(method, path, token, payload) {
  const response = await app.inject({
    method,
    url: path,
    headers: token ? { authorization: 'Bearer ' + token } : {},
    ...(payload === undefined ? {} : { payload }),
  });
  const contentType = response.headers['content-type'] ?? '';
  const body = contentType.includes('application/json') ? response.json() : response.body;
  return { status: response.statusCode, body, headers: response.headers };
}

async function expect(method, path, token, payload, status = 200) {
  const response = await request(method, path, token, payload);
  check(response.status, status, method + ' ' + path);
  return response.body;
}

async function makeUser(name, captain = false) {
  sequence += 1;
  const phone = '138' + String(sequence).padStart(8, '0');
  const token = security.newToken();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(
      "INSERT INTO users (phone_ciphertext,phone_hash,display_name,identity_status) " +
        "VALUES ($1,$2,$3,'verified') RETURNING id",
      [security.encrypt(phone), security.phoneHash(phone), name],
    );
    const userId = user.rows[0].id;
    await client.query(
      "INSERT INTO user_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 day')",
      [security.tokenHash(token), userId],
    );
    if (captain) {
      await client.query(
        "INSERT INTO captain_profiles (user_id,captain_name,verification_status,verified_at) " +
          "VALUES ($1,$2,'approved',now())",
        [userId, name],
      );
    }
    await client.query('COMMIT');
    return { id: userId, token };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function makeConfirmedDeparture(captainId, boatId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const departureId = (await client.query(
      "INSERT INTO departures " +
        "(boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code," +
        "minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status) " +
        "VALUES ($1,$2,'pro_fishing',now()+interval '72 hours',now()+interval '71 hours 30 minutes'," +
        "now()+interval '78 hours','qd_coast','xiaogang',10000,5000,now()+interval '69 hours','confirmed') " +
        'RETURNING id',
      [boatId, captainId],
    )).rows[0].id;
    const seat = (await client.query(
      "INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status) " +
        "VALUES ($1,1,5000,'port','mid','booked') RETURNING id,seat_number,price_fen",
      [departureId],
    )).rows[0];
    await client.query('COMMIT');
    return { id: departureId, seat };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function makePaidOrder(userId, departureId, seat) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderId = (await client.query(
      "INSERT INTO booking_orders " +
        "(order_number,departure_id,seat_inventory_id,buyer_user_id,status,seat_fee_fen,total_amount_fen,paid_at) " +
        "VALUES ($1,$2,$3,$4,'paid',5000,5000,now()) RETURNING id",
      ['SMOKE' + Date.now(), departureId, seat.id, userId],
    )).rows[0].id;
    await client.query(
      "INSERT INTO booking_order_seats (order_id,seat_inventory_id,seat_number,price_fen,status) " +
        "VALUES ($1,$2,$3,$4,'paid')",
      [orderId, seat.id, seat.seat_number, seat.price_fen],
    );
    await client.query(
      "INSERT INTO order_passengers " +
        "(order_id,seat_inventory_id,full_name_ciphertext,identity_number_ciphertext,phone_ciphertext,identity_verified_at) " +
        'VALUES ($1,$2,$3,$4,$5,now())',
      [
        orderId,
        seat.id,
        security.encrypt('张三'),
        security.encrypt(makeSandboxIdentityNumber(String(sequence).padStart(3, '0'))),
        security.encrypt('13900000001'),
      ],
    );
    await client.query(
      "INSERT INTO insurance_policies (order_id,provider_code,status) VALUES ($1,'sandbox','issued')",
      [orderId],
    );
    await client.query('COMMIT');
    return orderId;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function scalar(sql, values = []) {
  return (await pool.query(sql, values)).rows[0];
}

async function main() {
  const existing = await scalar('SELECT count(*)::integer AS count FROM users');
  if (existing.count !== 0) throw new Error('Acceptance database must be empty; no fixture data was inserted.');
  await app.ready();

  const captain = await makeUser('船长甲', true);
  const angler = await makeUser('钓友甲');
  const boatId = (await pool.query(
    "INSERT INTO boats (captain_user_id,name,length_cm,home_marina_code,seat_count,review_status,template_status) " +
      "VALUES ($1,'验收测试船',1200,'xiaogang',8,'approved','ready') RETURNING id",
    [captain.id],
  )).rows[0].id;
  const departure = await makeConfirmedDeparture(captain.id, boatId);
  const orderId = await makePaidOrder(angler.id, departure.id, departure.seat);

  const generated = await processConfirmedChecklists(pool);
  check(generated.generated, 1, 'worker generates a checklist for an already-confirmed trip');
  const repeated = await processConfirmedChecklists(pool);
  check(repeated.generated, 0, 'worker does not regenerate an existing checklist');
  const captainItems = await expect('GET', '/captain/fulfillment', captain.token);
  check(captainItems.items.length, 1, 'captain sees confirmed trip');
  check(captainItems.items[0].id, departure.id, 'trip identity matches');
  check('bookedFen' in captainItems.items[0], false, 'trip list does not expose formation amount');

  const detail = await expect('GET', '/captain/departures/' + departure.id + '/fulfillment', captain.token);
  check(detail.checklist.manifest.status, 'matched', 'passenger and seat counts match');
  check(detail.checklist.insurance.status, 'checked', 'issued insurance is reflected');
  const orderFlow = await expect('GET', '/orders/' + orderId + '/fulfillment', angler.token);
  check(orderFlow.departure.status, 'confirmed', 'angler sees confirmed trip status');
  check(Boolean(orderFlow.checklist), true, 'angler can read the generated checklist');

  await expect('POST', '/captain/departures/' + departure.id + '/checkin', captain.token, { event: 'departed' });
  check((await scalar('SELECT status FROM departures WHERE id=$1', [departure.id])).status, 'in_progress',
    'departure check-in advances status');
  await expect('POST', '/captain/departures/' + departure.id + '/checkin', captain.token, { event: 'departed' }, 409);
  await expect('POST', '/captain/departures/' + departure.id + '/checkin', captain.token, { event: 'returned' });
  check((await scalar('SELECT status FROM departures WHERE id=$1', [departure.id])).status, 'completed',
    'return check-in completes trip');

  const masked = await request('GET', '/captain/departures/' + departure.id + '/manifest.csv?format=masked', captain.token);
  check(masked.status, 200, 'masked manifest downloads');
  check(masked.body.includes('张*'), true, 'masked manifest obscures passenger name');
  check(masked.body.includes('***********'), true, 'masked manifest obscures identity number');
  const full = await request('GET', '/captain/departures/' + departure.id + '/manifest.csv?format=full', captain.token);
  check(full.status, 200, 'full manifest downloads for captain');
  check(full.body.includes('张三'), true, 'full manifest contains authorized passenger name');
  check(full.body.includes(makeSandboxIdentityNumber(String(sequence).padStart(3, '0'))), true,
    'full manifest contains authorized identity number');
  check((await scalar('SELECT count(*)::integer AS count FROM manifest_export_audit WHERE departure_id=$1',
    [departure.id])).count, 2, 'both exports are audited');

  const notifications = await scalar(
    "SELECT count(*)::integer AS count FROM notification_outbox WHERE departure_id=$1 AND kind='pretrip_checklist'",
    [departure.id],
  );
  check(notifications.count, 1, 'pre-trip notice is recorded once');
  await expect('POST', '/captain/departures/' + departure.id + '/formation/decision', captain.token,
    { action: 'low_seat' }, 404);

  console.log('Step 4 non-financial acceptance passed: ' + assertions + ' assertions.');
}

try {
  await main();
} finally {
  await app.close();
  await pool.end();
}
