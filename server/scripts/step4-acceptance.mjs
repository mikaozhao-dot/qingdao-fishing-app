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
  logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
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
        "minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status," +
        "seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply) " +
        "VALUES ($1,$2,'pro_fishing',now()+interval '72 hours',now()+interval '71 hours 30 minutes'," +
        "now()+interval '78 hours','qd_coast','xiaogang',10000,5000,now()+interval '69 hours','confirmed',8,8,0,false) " +
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

async function makeEmptyConfirmedDeparture(captainId, boatId) {
  const result = await pool.query(
    "INSERT INTO departures " +
      "(boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code," +
      "minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status," +
      "seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply) " +
      "VALUES ($1,$2,'pro_fishing',now()+interval '72 hours',now()+interval '71 hours 30 minutes'," +
      "now()+interval '78 hours','qd_coast','xiaogang',10000,5000,now()+interval '69 hours','confirmed',8,0,8,true) " +
      'RETURNING id',
    [boatId, captainId],
  );
  return result.rows[0].id;
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

function shanghaiDateAfter(days) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
  const date = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

async function main() {
  const existing = await scalar('SELECT count(*)::integer AS count FROM users');
  if (existing.count !== 0) throw new Error('Acceptance database must be empty; no fixture data was inserted.');
  await app.ready();

  const captain = await makeUser('船长甲', true);
  const angler = await makeUser('钓友甲');
  const otherCaptain = await makeUser('船长乙', true);
  const boatId = (await pool.query(
    "INSERT INTO boats (captain_user_id,name,length_cm,home_marina_code,seat_count,review_status,template_status) " +
      "VALUES ($1,'验收测试船',1200,'xiaogang',8,'approved','ready') RETURNING id",
    [captain.id],
  )).rows[0].id;

  const quotaBoatId = (await pool.query(
    "INSERT INTO boats (captain_user_id,name,length_cm,home_marina_code,seat_template_code,seat_count,review_status,template_status) " +
      "VALUES ($1,'配额验收船',1200,'xiaogang','qingdao-12-seat-v1',12,'approved','ready') RETURNING id",
    [captain.id],
  )).rows[0].id;
  const quotaPublish = await request('POST', '/captain/departures', captain.token, {
    boatId: quotaBoatId,
    tripType: 'pro_fishing',
    departureDate: shanghaiDateAfter(3),
    meetingTime: '04:30',
    departureTime: '05:00',
    returnTime: '12:00',
    bookingDeadlineTime: '04:00',
    targetAreaCode: 'qingdao_nearshore',
    marinaCode: 'xiaogang',
    fishCodes: ['sea_bass'],
    pricePerSeatFen: 50000,
    sternSurchargeFen: 10000,
    minimumTotalFen: 100000,
    remarks: '',
    manualSupply: false,
    platformQuotaSeats: 4,
    offlineQuotaSeats: 6,
    rigConfig: {
      baitTypes: ['live_shrimp'], baitGramsPerPerson: 200, baitSupply: 'captain_provided',
      mainLinePe: 1.5, leaderLineNumber: 5, sinkerShape: 'water_drop', sinkerMinGrams: 40, sinkerMaxGrams: 80,
    },
  });
  check(quotaPublish.status, 201, 'captain can publish an isolated platform/offline quota');
  const quotaDeparture = quotaPublish.body.departure;
  check(quotaDeparture.platformQuotaSeats, 4, 'published platform quota is four seats');
  check(quotaDeparture.offlineQuotaSeats, 6, 'published offline quota is six seats');
  check(quotaDeparture.instantConfirmationAvailable, true, 'segregated platform seats allow instant seat selection');
  check(quotaDeparture.seats.map((seat) => seat.number), [1, 2, 3, 4], 'only platform seats enter online inventory');
  const unassignedEleventh = await scalar(
    "SELECT count(*)::integer AS count FROM seat_inventory WHERE departure_id=$1 AND seat_number=11",
    [quotaDeparture.id],
  );
  check(unassignedEleventh.count, 0, 'the eleventh template seat is not sold when only ten seats are allocated');
  const offlineSeatFive = await scalar(
    "SELECT q.sale_channel, count(s.id)::integer AS inventory_count FROM departure_seat_quotas q " +
      "LEFT JOIN seat_inventory s ON s.departure_id=q.departure_id AND s.seat_number=q.seat_number " +
      "WHERE q.departure_id=$1 AND q.seat_number=5 GROUP BY q.sale_channel",
    [quotaDeparture.id],
  );
  check(offlineSeatFive.sale_channel, 'offline', 'the fifth template seat belongs to the offline quota');
  check(offlineSeatFive.inventory_count, 0, 'offline seats do not receive platform inventory rows');

  const seatsBeforeTransfer = await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token);
  check(seatsBeforeTransfer.seats.length, 4, 'seat API exposes only the four platform quota seats');
  await expect('POST', '/departures/' + quotaDeparture.id + '/seat-holds', angler.token,
    { seatIds: ['00000000-0000-4000-8000-000000000011'] }, 404);
  const lockedHold = await expect('POST', '/departures/' + quotaDeparture.id + '/seat-holds', angler.token,
    { seatIds: [seatsBeforeTransfer.seats[0].id] }, 201);
  await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 1, sourceChannel: 'platform', targetChannel: 'offline', requestKey: 'quota-locked-seat' }, 409);
  await pool.query("UPDATE seat_holds SET expires_at=now()-interval '1 second' WHERE id=$1", [lockedHold.holdId]);
  await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token);

  const openedOffline = await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 5, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-open-seat-5' });
  check(openedOffline.platformQuotaSeats, 5, 'transferring one offline seat expands platform quota');
  check(openedOffline.offlineQuotaSeats, 5, 'transferring one offline seat reduces offline quota');
  const replayedOpen = await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 5, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-open-seat-5' });
  check(replayedOpen.replayed, true, 'repeating a transfer request is idempotent');
  check((await scalar('SELECT count(*)::integer AS count FROM seat_inventory WHERE departure_id=$1 AND seat_number=5',
    [quotaDeparture.id])).count, 1, 'an idempotent transfer does not create duplicate inventory');
  await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 6, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-open-seat-5' }, 409);
  const returnedPlatformSeat = await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 5, sourceChannel: 'platform', targetChannel: 'offline', requestKey: 'quota-return-seat-5' });
  check(returnedPlatformSeat.platformQuotaSeats, 4, 'a free platform seat can return to the offline quota');
  check(returnedPlatformSeat.offlineQuotaSeats, 6, 'returning a free seat restores the offline quota');
  check((await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token)).seats.length, 4,
    'a transferred offline seat disappears from online seat selection');
  check((await scalar("SELECT status || ':' || sale_channel AS state FROM seat_inventory WHERE departure_id=$1 AND seat_number=5",
    [quotaDeparture.id])).state, 'blocked:offline', 'transferred inventory is frozen before it leaves the platform channel');

  const competingTransfers = await Promise.all([
    request('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
      { seatNumber: 6, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-race-a' }),
    request('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
      { seatNumber: 6, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-race-b' }),
  ]);
  check(competingTransfers.map((result) => result.status).sort(), [200, 409],
    'concurrent transfers of one seat can only succeed once');

  const legacyPublish = await request('POST', '/captain/departures', captain.token, {
    boatId: quotaBoatId,
    tripType: 'pro_fishing',
    departureDate: shanghaiDateAfter(4),
    meetingTime: '04:30', departureTime: '05:00', returnTime: '12:00', bookingDeadlineTime: '04:00',
    targetAreaCode: 'qingdao_nearshore', marinaCode: 'xiaogang', fishCodes: ['sea_bass'],
    pricePerSeatFen: 50000, sternSurchargeFen: 10000, minimumTotalFen: 100000, remarks: '',
    rigConfig: {
      baitTypes: ['live_shrimp'], baitGramsPerPerson: 200, baitSupply: 'captain_provided',
      mainLinePe: 1.5, leaderLineNumber: 5, sinkerShape: 'water_drop', sinkerMinGrams: 40, sinkerMaxGrams: 80,
    },
  });
  check(legacyPublish.status, 201, 'legacy publish request remains supported as manual confirmation supply');
  check(legacyPublish.body.departure.manualSupply, true, 'unsegregated supply is explicitly marked manual');
  check(legacyPublish.body.departure.instantConfirmationAvailable, false,
    'unsegregated supply does not promise instant confirmation');
  check(legacyPublish.body.departure.platformQuotaSeats, 0, 'unsegregated supply opens no platform quota');
  check(legacyPublish.body.departure.seats.length, 0, 'unsegregated supply creates no online inventory');

  const formationDepartureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',now()+interval '10 days',now()+interval '10 days'-interval '30 minutes',
        now()+interval '10 days'+'7 hours','qd_coast','xiaogang',5000,5000,
        now()+interval '9 days','open',8,8,0,false) RETURNING id`,
    [boatId, captain.id],
  )).rows[0].id;
  const formationSeat = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,1,5000,'port','mid','booked') RETURNING id,seat_number,price_fen`,
    [formationDepartureId],
  )).rows[0];
  await makePaidOrder(angler.id, formationDepartureId, formationSeat);
  const initialAccounts = await expect('GET',
    '/captain/departures/' + formationDepartureId + '/formation-accounts', captain.token);
  check(initialAccounts.accounts.platform.ticketNetFen, 4500,
    'formation preview applies the approved 90 percent ticket net');
  check(initialAccounts.accounts.platform.meetsThreshold, false,
    'offline declarations never make the platform ledger automatically meet threshold');
  check(initialAccounts.accounts.captainOffline.supportsCaptainConfirmation, false,
    'captain confirmation path is false before offline evidence is recorded');
  await expect('GET', '/captain/departures/' + formationDepartureId + '/formation-accounts', angler.token,
    undefined, 403);
  await expect('GET', '/captain/departures/' + formationDepartureId + '/formation-accounts', otherCaptain.token,
    undefined, 404);
  const offlineEntry = await expect('POST',
    '/captain/departures/' + formationDepartureId + '/offline-ledger', captain.token,
    { amountDeltaFen: 500, note: '验收模拟线下收入', requestKey: 'formation-offline-001' }, 201);
  check(offlineEntry.accounts.captainOffline.declaredFen, 500,
    'captain-reported offline amount remains on its separate ledger');
  check(offlineEntry.accounts.platform.verifiableTotalFen, 4500,
    'offline entry does not alter platform-verifiable total');
  check(offlineEntry.accounts.captainOffline.supportsCaptainConfirmation, true,
    'offline amount can support only the captain confirmation path');
  const replayedOfflineEntry = await expect('POST',
    '/captain/departures/' + formationDepartureId + '/offline-ledger', captain.token,
    { amountDeltaFen: 500, note: '验收模拟线下收入', requestKey: 'formation-offline-001' });
  check(replayedOfflineEntry.idempotentReplay, true, 'offline ledger request key is idempotent');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_offline_ledger_entries WHERE departure_id=$1',
    [formationDepartureId])).count, 1, 'idempotent replay does not duplicate an offline entry');
  await expect('POST', '/captain/departures/' + formationDepartureId + '/offline-ledger', captain.token,
    { amountDeltaFen: -501, note: '超额冲减', requestKey: 'formation-offline-002' }, 409);
  await expect('POST', '/captain/departures/' + formationDepartureId + '/offline-ledger', captain.token,
    { amountDeltaFen: 600, note: '重用请求编号', requestKey: 'formation-offline-001' }, 409);

  const departure = await makeConfirmedDeparture(captain.id, boatId);
  const orderId = await makePaidOrder(angler.id, departure.id, departure.seat);
  const emptyDepartureId = await makeEmptyConfirmedDeparture(captain.id, boatId);
  const editable = await pool.query(
    'UPDATE departures SET minimum_sailing_total_fen=12000 WHERE id=$1 RETURNING minimum_sailing_total_fen',
    [emptyDepartureId],
  );
  check(Number(editable.rows[0].minimum_sailing_total_fen), 12000,
    'threshold remains editable before the first order');
  let priceFreezeError;
  try {
    await pool.query(
      'UPDATE departures SET minimum_sailing_total_fen=12000,price_per_seat_fen=6000 WHERE id=$1',
      [departure.id],
    );
  } catch (error) {
    priceFreezeError = error;
  }
  check(priceFreezeError?.constraint ?? null, 'departure_price_frozen_after_order',
    'price and threshold are frozen after the first order');

  const generated = await processConfirmedChecklists(pool);
  check(generated.generated, 2, 'worker generates checklists for already-confirmed trips');
  const repeated = await processConfirmedChecklists(pool);
  check(repeated.generated, 0, 'worker does not regenerate an existing checklist');
  const captainItems = await expect('GET', '/captain/fulfillment', captain.token);
  check(captainItems.items.map((item) => item.id).sort(), [departure.id, emptyDepartureId].sort(),
    'captain sees only their confirmed trips');
  check('bookedFen' in captainItems.items[0], false, 'trip list does not expose formation amount');
  const emptyTrip = await expect('GET', '/captain/departures/' + emptyDepartureId + '/fulfillment', captain.token);
  check(emptyTrip.checklist.insurance.status, 'check_before_departure', 'empty trip does not imply insurance is checked');
  check(emptyTrip.checklist.manifest.status, 'review_required', 'empty trip does not imply passenger manifest is matched');

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
  await expect('GET', '/captain/fulfillment', angler.token, undefined, 403);
  const otherCaptainItems = await expect('GET', '/captain/fulfillment', otherCaptain.token);
  check(otherCaptainItems.items.length, 0, 'another captain cannot see the owner trip');
  await expect('GET', '/captain/departures/' + departure.id + '/fulfillment', otherCaptain.token, undefined, 404);
  await expect('GET', '/captain/departures/' + departure.id + '/manifest.csv?format=full', otherCaptain.token, undefined, 404);

  console.log('Step 4 acceptance passed: ' + assertions + ' assertions.');
}

try {
  await main();
} finally {
  await app.close();
  await pool.end();
}
