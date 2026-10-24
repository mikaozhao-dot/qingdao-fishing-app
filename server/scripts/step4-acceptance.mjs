import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createSecurity, makeSandboxIdentityNumber } from '../src/security.js';
import { processConfirmedChecklists, processFormationChecks } from '../src/step4-routes.js';

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
    const passengerResult = await client.query(
      "INSERT INTO order_passengers " +
        "(order_id,seat_inventory_id,full_name_ciphertext,identity_number_ciphertext,phone_ciphertext,identity_verified_at) " +
        'VALUES ($1,$2,$3,$4,$5,now()) RETURNING id',
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
    await client.query(
      `INSERT INTO passenger_insurance_coverages
         (departure_id,order_id,passenger_id,coverage_start_at,coverage_end_at,status,
          provider_code,provider_policy_reference,verified_at)
       SELECT d.id,$1,op.id,d.departure_at,d.return_at,'effective','sandbox','sandbox_policy_' || ($1::uuid)::text,now()
       FROM order_passengers op JOIN departures d ON d.id=$2
       WHERE op.id=$3`,
      [orderId, departureId, passengerResult.rows[0].id],
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

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shanghaiDateAfter(days) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
  const date = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function departureAfterPassedFormationCutoff() {
  const now = new Date();
  const todayLate = new Date(`${shanghaiDateAfter(0)}T23:59:00+08:00`);
  const departureAt = todayLate.getTime() - now.getTime() > 60 * 60 * 1000
    ? todayLate
    : new Date(`${shanghaiDateAfter(1)}T00:30:00+08:00`);
  return { departureAt, bookingDeadline: new Date(departureAt.getTime() - 30 * 60 * 1000) };
}

async function main() {
  const existing = await scalar('SELECT count(*)::integer AS count FROM users');
  if (existing.count !== 0) throw new Error('Acceptance database must be empty; no fixture data was inserted.');
  await app.ready();

  const captain = await makeUser('船长甲', true);
  const angler = await makeUser('钓友甲');
  const secondAngler = await makeUser('钓友乙');
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
    offlineQuotaSeats: 8,
    rigConfig: {
      baitTypes: ['live_shrimp'], baitGramsPerPerson: 200, baitSupply: 'captain_provided',
      mainLinePe: 1.5, leaderLineNumber: 5, sinkerShape: 'water_drop', sinkerMinGrams: 40, sinkerMaxGrams: 80,
    },
  });
  check(quotaPublish.status, 201, 'captain can publish an isolated platform/offline quota');
  const quotaDeparture = quotaPublish.body.departure;
  check(quotaDeparture.platformQuotaSeats, 4, 'published platform quota is four seats');
  check(quotaDeparture.offlineQuotaSeats, 8, 'published offline quota is eight seats');
  check(quotaDeparture.instantConfirmationAvailable, true, 'segregated platform seats allow instant seat selection');
  check(quotaDeparture.seats.map((seat) => seat.number), [1, 2, 3, 4], 'only platform seats enter online inventory');
  const quotaTotal = await scalar(
    'SELECT count(*)::integer AS count FROM departure_seat_quotas WHERE departure_id=$1',
    [quotaDeparture.id],
  );
  check(quotaTotal.count, 12, 'all twelve positions belong to either the platform or offline quota');
  const offlineSeatFive = await scalar(
    "SELECT q.sale_channel, count(s.id)::integer AS inventory_count FROM departure_seat_quotas q " +
      "LEFT JOIN seat_inventory s ON s.departure_id=q.departure_id AND s.seat_number=q.seat_number " +
      "WHERE q.departure_id=$1 AND q.seat_number=5 GROUP BY q.sale_channel",
    [quotaDeparture.id],
  );
  check(offlineSeatFive.sale_channel, 'offline', 'the fifth template seat belongs to the offline quota');
  check(offlineSeatFive.inventory_count, 0, 'offline seats do not receive platform inventory rows');

  const offlineSeats = await expect('GET', `/captain/departures/${quotaDeparture.id}/offline-seats`, captain.token);
  check(offlineSeats.seats.slice(0, 6).map((seat) => seat.state), Array(6).fill('open'),
    'offline seats start open for manual captain status registration');
  check(offlineSeats.factBoundary.includes('不能技术性核验'), true,
    'offline seat UI states the platform cannot verify external sales');
  await expect('GET', `/captain/departures/${quotaDeparture.id}/offline-seats`, angler.token, undefined, 403);
  await expect('GET', `/captain/departures/${quotaDeparture.id}/offline-seats`, otherCaptain.token, undefined, 404);

  const seatsBeforeTransfer = await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token);
  check(seatsBeforeTransfer.seats.length, 4, 'seat API exposes only the four platform quota seats');
  check(seatsBeforeTransfer.seatLayout.length, 12, 'seat API returns the full departure layout for a 4+8 quota');
  check(seatsBeforeTransfer.seatLayout.filter((seat) => seat.saleChannel === 'platform').length, 4,
    'the 4+8 layout marks only four real positions as platform inventory');
  check(seatsBeforeTransfer.seatLayout.find((seat) => seat.number === 5).saleChannel, 'offline',
    'an offline position remains visible without entering the online inventory list');
  check('id' in seatsBeforeTransfer.seatLayout.find((seat) => seat.number === 5), false,
    'a visual offline position has no synthetic inventory identifier');

  const legacyOrderSeat = await scalar(
    'SELECT id,seat_number,price_fen FROM seat_inventory WHERE departure_id=$1 AND seat_number=3',
    [quotaDeparture.id],
  );
  await makePaidOrder(angler.id, quotaDeparture.id, legacyOrderSeat);
  await pool.query(
    `UPDATE departures SET seat_layout_snapshot=NULL,
       created_at=(SELECT applied_at-interval '1 minute' FROM schema_migrations
                    WHERE version='013_four_stern_premium_seats.sql')
     WHERE id=$1`,
    [quotaDeparture.id],
  );
  await pool.query(await readFile(new URL('../migrations/014_departure_seat_layout_snapshot.sql', import.meta.url), 'utf8'));
  const migratedLayout = await scalar(
    'SELECT seat_layout_snapshot FROM departures WHERE id=$1',
    [quotaDeparture.id],
  );
  const migratedSeat = (number) => migratedLayout.seat_layout_snapshot.find((seat) => Number(seat.number) === number);
  check(migratedSeat(5).premium, false, 'migration 014 backfills pre-013 offline seat 5 with its frozen premium value');
  check(migratedSeat(8).premium, false, 'migration 014 backfills pre-013 offline seat 8 with its frozen premium value');
  check(migratedSeat(6).premium, true, 'migration 014 preserves the pre-existing premium flag for seat 6');
  check((await scalar(
    'SELECT price_fen FROM seat_inventory WHERE departure_id=$1 AND seat_number=3',
    [quotaDeparture.id],
  )).price_fen, 50000, 'an order-bearing legacy departure keeps its existing platform price');

  const lockedHold = await expect('POST', '/departures/' + quotaDeparture.id + '/seat-holds', angler.token,
    { seatIds: [seatsBeforeTransfer.seats[0].id] }, 201);
  await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 1, sourceChannel: 'platform', targetChannel: 'offline', requestKey: 'quota-locked-seat' }, 409);
  await pool.query("UPDATE seat_holds SET expires_at=now()-interval '1 second' WHERE id=$1", [lockedHold.holdId]);
  await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token);

  await expect('POST', `/captain/departures/${quotaDeparture.id}/offline-seat-status`, captain.token,
    { seatNumber: 6, state: 'locked' });
  const lockedOffline = await request('POST', `/captain/departures/${quotaDeparture.id}/quota-transfers`, captain.token,
    { seatNumber: 6, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-locked-offline', releaseConfirmed: true });
  check(lockedOffline.status, 409, 'a locked offline seat cannot be transferred');
  check(lockedOffline.body.code, 'offline_seat_locked', 'locked offline seat returns a stable decline code');
  await expect('POST', `/captain/departures/${quotaDeparture.id}/offline-seat-status`, captain.token,
    { seatNumber: 6, state: 'open' });
  await expect('POST', `/captain/departures/${quotaDeparture.id}/offline-seat-status`, captain.token,
    { seatNumber: 7, state: 'sold' });
  const soldOffline = await request('POST', `/captain/departures/${quotaDeparture.id}/quota-transfers`, captain.token,
    { seatNumber: 7, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-sold-offline', releaseConfirmed: true });
  check(soldOffline.body.code, 'offline_seat_sold', 'sold offline seat returns a stable decline code');
  const unconfirmedOffline = await request('POST', `/captain/departures/${quotaDeparture.id}/quota-transfers`, captain.token,
    { seatNumber: 8, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-no-release' });
  check(unconfirmedOffline.body.code, 'offline_release_confirmation_required',
    'open offline seat without release confirmation cannot enter platform inventory');

  const openedOffline = await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 5, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-open-seat-5', releaseConfirmed: true });
  check(openedOffline.platformQuotaSeats, 5, 'transferring one offline seat expands platform quota');
  check(openedOffline.offlineQuotaSeats, 7, 'transferring one offline seat reduces offline quota');
  const openedLegacyFive = await scalar(
    'SELECT is_premium,price_fen FROM seat_inventory WHERE departure_id=$1 AND seat_number=5',
    [quotaDeparture.id],
  );
  check(openedLegacyFive.is_premium, false, 'old seat 5 does not acquire the new template premium flag when opened');
  check(openedLegacyFive.price_fen, 50000, 'old seat 5 keeps the base price after the template migration');
  const layoutAfterOpeningFive = await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token);
  check(layoutAfterOpeningFive.seatLayout.find((seat) => seat.number === 5).saleChannel, 'platform',
    'opening old seat 5 changes only its live quota channel in the full map');
  check(layoutAfterOpeningFive.seats.find((seat) => seat.number === 5).priceFen, 50000,
    'opened old seat 5 is returned with its frozen legacy price');
  const releaseEvidence = await scalar(
    `SELECT c.actor_user_id::text AS actor_id,c.request_key,c.statement_version,c.statement_text,
            q.offline_state,a.next_state
     FROM departure_offline_release_confirmations c
     JOIN departure_seat_quotas q USING (departure_id,seat_number)
     JOIN departure_offline_seat_state_events a ON a.departure_id=c.departure_id
       AND a.seat_number=c.seat_number AND a.transfer_request_key=c.request_key
     WHERE c.departure_id=$1 AND c.request_key='quota-open-seat-5'`,
    [quotaDeparture.id],
  );
  check(releaseEvidence.actor_id, captain.id, 'release evidence records the authenticated captain');
  check(releaseEvidence.statement_version, 'offline-release-v1', 'release evidence stores the statement version');
  check(releaseEvidence.statement_text, '该席位线下未售、未锁，且已停止线下销售', 'release evidence stores the exact attestation');
  check(releaseEvidence.offline_state, 'released', 'released seat state and transfer persist together');
  check(releaseEvidence.next_state, 'released', 'state history links release to the quota transfer');
  const replayedOpen = await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 5, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-open-seat-5', releaseConfirmed: true });
  check(replayedOpen.replayed, true, 'repeating a transfer request is idempotent');
  check((await scalar('SELECT count(*)::integer AS count FROM seat_inventory WHERE departure_id=$1 AND seat_number=5',
    [quotaDeparture.id])).count, 1, 'an idempotent transfer does not create duplicate inventory');
  await expect('POST', '/departures/' + quotaDeparture.id + '/seat-holds', angler.token,
    { seatIds: [(await scalar('SELECT id FROM seat_inventory WHERE departure_id=$1 AND seat_number=5', [quotaDeparture.id])).id] }, 201);
  const holdFive = await scalar('SELECT hold_id FROM seat_inventory WHERE departure_id=$1 AND seat_number=5', [quotaDeparture.id]);
  await pool.query("UPDATE seat_holds SET expires_at=now()-interval '1 second' WHERE id=$1", [holdFive.hold_id]);
  await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token);
  const returnedPlatformSeat = await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 5, sourceChannel: 'platform', targetChannel: 'offline', requestKey: 'quota-return-seat-5' });
  check(returnedPlatformSeat.platformQuotaSeats, 4, 'a free platform seat can return to the offline quota');
  check(returnedPlatformSeat.offlineQuotaSeats, 8, 'returning a free seat restores the offline quota');
  check((await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token)).seats.length, 4,
    'a transferred offline seat disappears from online seat selection');
  check((await scalar("SELECT status || ':' || sale_channel AS state FROM seat_inventory WHERE departure_id=$1 AND seat_number=5",
    [quotaDeparture.id])).state, 'blocked:offline', 'transferred inventory is frozen before it leaves the platform channel');
  const realOfflineInventory = await scalar(
    'SELECT id FROM seat_inventory WHERE departure_id=$1 AND seat_number=5', [quotaDeparture.id],
  );
  await expect('POST', '/departures/' + quotaDeparture.id + '/seat-holds', angler.token,
    { seatIds: [realOfflineInventory.id] }, 404);
  check((await scalar('SELECT offline_state FROM departure_seat_quotas WHERE departure_id=$1 AND seat_number=5',
    [quotaDeparture.id])).offline_state, 'open', 'a returned offline seat can be listed again as open');
  await expect('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
    { seatNumber: 8, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-open-seat-8', releaseConfirmed: true });
  const openedLegacyEight = await scalar(
    'SELECT is_premium,price_fen FROM seat_inventory WHERE departure_id=$1 AND seat_number=8',
    [quotaDeparture.id],
  );
  check(openedLegacyEight.is_premium, false, 'old seat 8 does not acquire the new template premium flag when opened');
  check(openedLegacyEight.price_fen, 50000, 'old seat 8 keeps the base price after the template migration');
  const layoutAfterOpeningEight = await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token);
  check(layoutAfterOpeningEight.seatLayout.find((seat) => seat.number === 8).saleChannel, 'platform',
    'opening old seat 8 changes only its live quota channel in the full map');
  check(layoutAfterOpeningEight.seats.find((seat) => seat.number === 8).priceFen, 50000,
    'opened old seat 8 is returned with its frozen legacy price');

  const eightPlusFourPublish = await request('POST', '/captain/departures', captain.token, {
    boatId: quotaBoatId,
    tripType: 'pro_fishing',
    departureDate: shanghaiDateAfter(6),
    meetingTime: '04:30', departureTime: '05:00', returnTime: '12:00', bookingDeadlineTime: '04:00',
    targetAreaCode: 'qingdao_nearshore', marinaCode: 'xiaogang', fishCodes: ['sea_bass'],
    pricePerSeatFen: 50000, sternSurchargeFen: 10000, minimumTotalFen: 100000, remarks: '',
    manualSupply: false, platformQuotaSeats: 8, offlineQuotaSeats: 4,
    rigConfig: {
      baitTypes: ['live_shrimp'], baitGramsPerPerson: 200, baitSupply: 'captain_provided',
      mainLinePe: 1.5, leaderLineNumber: 5, sinkerShape: 'water_drop', sinkerMinGrams: 40, sinkerMaxGrams: 80,
    },
  });
  check(eightPlusFourPublish.status, 201, 'captain can publish the complementary 8+4 quota split');
  const seatsEightPlusFour = await expect('GET', '/departures/' + eightPlusFourPublish.body.departure.id + '/seats', angler.token);
  check(seatsEightPlusFour.seatLayout.length, 12, '8+4 selection receives the same complete 12-position map');
  check(seatsEightPlusFour.seats.length, 8, '8+4 selection exposes only eight platform inventory rows');
  check(seatsEightPlusFour.seatLayout.filter((seat) => seat.saleChannel === 'platform').length, 8,
    '8+4 map marks eight real platform positions');
  check(seatsEightPlusFour.seatLayout.filter((seat) => seat.saleChannel === 'offline').length, 4,
    '8+4 map marks four offline positions without selling them online');
  const currentSternSeats = seatsEightPlusFour.seats.filter((seat) => [5, 6, 7, 8].includes(seat.number));
  check(currentSternSeats.map((seat) => seat.isPremium), [true, true, true, true],
    'new 8+4 departures preserve the approved 5–8 premium positions');
  check(currentSternSeats.map((seat) => seat.priceFen), [60000, 60000, 60000, 60000],
    'all four premium seats use the same current departure price');

  const platformSeatTwo = await scalar(
    'SELECT id,seat_number,price_fen FROM seat_inventory WHERE departure_id=$1 AND seat_number=2',
    [quotaDeparture.id],
  );
  await makePaidOrder(angler.id, quotaDeparture.id, platformSeatTwo);
  const soldPlatform = await request('POST', `/captain/departures/${quotaDeparture.id}/quota-transfers`, captain.token,
    { seatNumber: 2, sourceChannel: 'platform', targetChannel: 'offline', requestKey: 'quota-sold-platform' });
  check(soldPlatform.status, 409, 'a sold platform seat cannot be moved to offline quota');

  const stateTransferRace = await Promise.all([
    request('POST', `/captain/departures/${quotaDeparture.id}/offline-seat-status`, captain.token,
      { seatNumber: 10, state: 'locked' }),
    request('POST', `/captain/departures/${quotaDeparture.id}/quota-transfers`, captain.token,
      { seatNumber: 10, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-state-race', releaseConfirmed: true }),
  ]);
  check(stateTransferRace.map((result) => result.status).sort(), [200, 409],
    'offline state registration and quota transfer serialize on the departure row');
  const seatTen = await scalar('SELECT sale_channel,offline_state FROM departure_seat_quotas WHERE departure_id=$1 AND seat_number=10',
    [quotaDeparture.id]);
  check(seatTen.offline_state, seatTen.sale_channel === 'offline' ? 'locked' : 'released',
    'a state/transfer race never opens a locked offline seat');

  const competingTransfers = await Promise.all([
    request('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
      { seatNumber: 9, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-race-a', releaseConfirmed: true }),
    request('POST', '/captain/departures/' + quotaDeparture.id + '/quota-transfers', captain.token,
      { seatNumber: 9, sourceChannel: 'offline', targetChannel: 'platform', requestKey: 'quota-race-b', releaseConfirmed: true }),
  ]);
  check(competingTransfers.map((result) => result.status).sort(), [200, 409],
    'concurrent transfers of one seat can only succeed once');
  const winnerIndex = competingTransfers.findIndex((result) => result.status === 200);
  const winningKey = winnerIndex === 0 ? 'quota-race-a' : 'quota-race-b';

  const seatFourRace = await Promise.all([
    request('POST', '/departures/' + quotaDeparture.id + '/seat-holds', angler.token,
      { seatIds: [seatsBeforeTransfer.seats[3].id] }),
    request('POST', `/captain/departures/${quotaDeparture.id}/quota-transfers`, captain.token,
      { seatNumber: 4, sourceChannel: 'platform', targetChannel: 'offline', requestKey: 'quota-lock-transfer-race' }),
  ]);
  check(seatFourRace.filter((result) => result.status === 200 || result.status === 201).length, 1,
    'seat lock and platform quota transfer race has exactly one winner');
  check(seatFourRace.every((result) => [200, 201, 404, 409].includes(result.status)), true,
    'seat lock and quota transfer race returns only expected success or decline statuses');
  const seatFour = await scalar(
    'SELECT q.sale_channel,s.status,s.hold_id FROM departure_seat_quotas q LEFT JOIN seat_inventory s USING(departure_id,seat_number) WHERE q.departure_id=$1 AND q.seat_number=4',
    [quotaDeparture.id],
  );
  check(seatFour.status, seatFour.sale_channel === 'offline' ? 'blocked' : 'held',
    'seat lock/transfer race preserves either a held platform seat or blocked offline seat');
  if (seatFour.hold_id) {
    await pool.query("UPDATE seat_holds SET expires_at=now()-interval '1 second' WHERE id=$1", [seatFour.hold_id]);
    await expect('GET', '/departures/' + quotaDeparture.id + '/seats', angler.token);
  }

  await pool.query("UPDATE departures SET booking_deadline=now()-interval '1 second' WHERE id=$1", [quotaDeparture.id]);
  const postDeadlineReplay = await expect('POST', `/captain/departures/${quotaDeparture.id}/quota-transfers`, captain.token,
    { seatNumber: 9, sourceChannel: 'offline', targetChannel: 'platform', requestKey: winningKey, releaseConfirmed: true });
  check(postDeadlineReplay.replayed, true, 'idempotent quota replay is returned after the booking deadline');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_offline_release_confirmations WHERE departure_id=$1',
    [quotaDeparture.id])).count, 3 + (stateTransferRace[1].status === 200 ? 1 : 0),
    'only successful incoming transfers produce release confirmations');

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
     VALUES ($1,$2,'pro_fishing',now()+interval '24 hours',now()+interval '24 hours'-interval '30 minutes',
        now()+interval '24 hours'+'7 hours','qd_coast','xiaogang',5000,5000,
        now()+interval '20 hours','open',8,8,0,false) RETURNING id`,
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
  const shortfallCheckpoint = await processFormationChecks(pool,
    new Date(initialAccounts.accounts.confirmationAt));
  check(shortfallCheckpoint.checked, 1, 'due departure receives one formation checkpoint');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [formationDepartureId])).status,
    'handling_shortfall', 'platform-only shortfall enters server-managed handling');
  check((await scalar('SELECT outcome FROM departure_formation_snapshots WHERE departure_id=$1',
    [formationDepartureId])).outcome, 'shortfall', 'shortfall snapshot records the automatic ledger outcome');
  const captainDecision = await expect('POST',
    '/captain/departures/' + formationDepartureId + '/formation/decision', captain.token,
    { action: 'captain_confirmed', basisNote: '线下账本与平台账核对一致' });
  check(captainDecision.status, 'captain_confirmed', 'captain confirmation uses the separate offline ledger');
  check(captainDecision.platformGuarantee, false, 'captain confirmation does not imply a platform guarantee');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_captain_formation_decisions WHERE departure_id=$1',
    [formationDepartureId])).count, 1, 'captain confirmation saves its basis and both ledger values');
  await expect('POST', '/captain/departures/' + formationDepartureId + '/formation/decision', captain.token,
    { action: 'captain_confirmed', basisNote: '重复确认' }, 409);

  const overdueDepartureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',now()-interval '2 minutes',now()-interval '32 minutes',
        now()+interval '7 hours','qd_coast','xiaogang',5000,5000,
        now()-interval '2 hours','open',8,8,0,false) RETURNING id`,
    [boatId, captain.id],
  )).rows[0].id;
  const overdueAsOf = new Date();
  const overdueCheckpoint = await processFormationChecks(pool, overdueAsOf);
  check(overdueCheckpoint.overdue, 1, 'a departure just past its sailing time becomes a manual exception');
  check(overdueCheckpoint.checked, 0, 'an overdue departure does not receive a formation decision');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [overdueDepartureId])).status,
    'formation_overdue', 'overdue departure remains explicitly visible for manual handling');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_formation_snapshots WHERE departure_id=$1',
    [overdueDepartureId])).count, 0, 'overdue departure receives no new formation snapshot');
  const overdueRerun = await processFormationChecks(pool, overdueAsOf);
  check(overdueRerun.overdue, 0, 'rerunning the worker does not reopen the overdue exception');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_formation_snapshots WHERE departure_id=$1',
    [overdueDepartureId])).count, 0, 'worker rerun still creates no overdue confirmation');

  const lockCrossing = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',now()+interval '4 seconds',now()-interval '26 minutes',
        now()+interval '7 hours','qd_coast','xiaogang',5000,5000,
        now()-interval '2 hours','open',8,8,0,false) RETURNING id,departure_at`,
    [boatId, captain.id],
  )).rows[0];
  const lockClient = await pool.connect();
  let blockedCheckpoint;
  let workerBlockedOnRow = false;
  try {
    await lockClient.query('BEGIN');
    await lockClient.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [lockCrossing.id]);
    const batchAsOf = new Date();
    blockedCheckpoint = processFormationChecks(pool, batchAsOf);
    const waitDeadline = Date.now() + 3000;
    while (Date.now() < waitDeadline) {
      const waitingQuery = await scalar(
        `SELECT count(*)::integer AS count FROM pg_stat_activity
         WHERE wait_event_type='Lock' AND state='active'
           AND query LIKE 'SELECT d.id,d.status,d.departure_at,%'`,
      );
      if (waitingQuery.count > 0) {
        workerBlockedOnRow = true;
        break;
      }
      await wait(25);
    }
    const remainingMs = new Date(lockCrossing.departure_at).getTime() - Date.now() + 100;
    if (remainingMs > 0) await wait(remainingMs);
    await lockClient.query('COMMIT');
  } finally {
    await lockClient.query('ROLLBACK').catch(() => {});
    lockClient.release();
  }
  check(workerBlockedOnRow, true, 'formation worker waits on the departure row lock');
  const crossedDepartureCheckpoint = await blockedCheckpoint;
  check(crossedDepartureCheckpoint.overdue, 1,
    'worker rechecks the real clock after its row lock passes departure time');
  check(crossedDepartureCheckpoint.checked, 0, 'lock-delayed departure receives no formation decision');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [lockCrossing.id])).status,
    'formation_overdue', 'lock-delayed departure is left for manual handling');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_formation_snapshots WHERE departure_id=$1',
    [lockCrossing.id])).count, 0, 'lock-delayed departure receives no formation snapshot');

  const expiredCaptainDepartureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',now()-interval '2 minutes',now()-interval '32 minutes',
        now()+interval '7 hours','qd_coast','xiaogang',5000,5000,
        now()-interval '2 hours','handling_shortfall',8,8,0,false) RETURNING id`,
    [boatId, captain.id],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO departure_formation_snapshots
       (departure_id,confirmation_at,checked_at,threshold_fen,platform_ticket_net_fen,penalty_pool_fen,
        successful_supplement_fen,platform_verifiable_fen,captain_offline_declared_fen,outcome)
     VALUES ($1,now()-interval '1 day',now()-interval '1 day',5000,4500,0,0,4500,500,'shortfall')`,
    [expiredCaptainDepartureId],
  );
  await pool.query(
    `INSERT INTO departure_offline_ledger_entries
       (departure_id,captain_user_id,amount_delta_fen,note,request_key)
     VALUES ($1,$2,500,'验收模拟线下收入','expired-captain-001')`,
    [expiredCaptainDepartureId, captain.id],
  );
  await expect('POST', '/captain/departures/' + expiredCaptainDepartureId + '/formation/decision', captain.token,
    { action: 'captain_confirmed', basisNote: '线下账本与平台账核对一致' }, 409);
  check((await scalar('SELECT status FROM departures WHERE id=$1', [expiredCaptainDepartureId])).status,
    'handling_shortfall', 'expired captain confirmation leaves the shortfall for manual review');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_captain_formation_decisions WHERE departure_id=$1',
    [expiredCaptainDepartureId])).count, 0, 'expired captain confirmation saves no decision');

  const autoDepartureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',now()+interval '48 hours',now()+interval '48 hours'-interval '30 minutes',
        now()+interval '48 hours'+'7 hours','qd_coast','xiaogang',5000,5000,
        now()+interval '40 hours','open',8,8,0,false) RETURNING id`,
    [boatId, captain.id],
  )).rows[0].id;
  const autoSeat = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,1,5000,'port','mid','booked') RETURNING id,seat_number,price_fen`,
    [autoDepartureId],
  )).rows[0];
  await makePaidOrder(angler.id, autoDepartureId, autoSeat);
  await pool.query(
    `INSERT INTO departure_formation_adjustments (departure_id,adjustment_type,amount_fen,source_reference)
     VALUES ($1,'penalty_pool',600,'acceptance-penalty-001')`, [autoDepartureId]);
  const autoAccounts = await expect('GET',
    '/captain/departures/' + autoDepartureId + '/formation-accounts', captain.token);
  check(autoAccounts.accounts.platform.ticketNetFen, 4500, 'automatic account uses discounted net ticket proceeds');
  check(autoAccounts.accounts.platform.penaltyPoolFen, 600, 'recorded penalty pool joins the platform account');
  const autoCheckpoint = await processFormationChecks(pool,
    new Date(autoAccounts.accounts.confirmationAt));
  check(autoCheckpoint.checked, 1, 'automatic departure receives a checkpoint at its local cutoff');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [autoDepartureId])).status,
    'confirmed', 'platform ledger meeting the threshold automatically confirms the departure');
  check((await scalar('SELECT outcome FROM departure_formation_snapshots WHERE departure_id=$1',
    [autoDepartureId])).outcome, 'automatic_confirmed', 'automatic confirmation preserves its calculation snapshot');

  const pendingSchedule = departureAfterPassedFormationCutoff();
  const pendingDepartureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',$3::timestamptz,$3::timestamptz-interval '30 minutes',$3::timestamptz+interval '7 hours',
        'qd_coast','xiaogang',5000,5000,$4,'open',8,8,0,false) RETURNING id`,
    [boatId, captain.id, pendingSchedule.departureAt, pendingSchedule.bookingDeadline],
  )).rows[0].id;
  const pendingSeatId = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,1,5000,'port','mid','booked') RETURNING id`, [pendingDepartureId],
  )).rows[0].id;
  const pendingOrderId = (await pool.query(
    `INSERT INTO booking_orders
       (order_number,departure_id,seat_inventory_id,buyer_user_id,status,seat_fee_fen,total_amount_fen)
     VALUES ($1,$2,$3,$4,'pending_payment',5000,5000) RETURNING id`,
    ['PENDING' + Date.now(), pendingDepartureId, pendingSeatId, angler.id],
  )).rows[0].id;
  const deferredCheckpoint = await processFormationChecks(pool);
  check(deferredCheckpoint.checked, 0, 'pending payment prevents a stale formation snapshot');
  check(deferredCheckpoint.deferred, 1, 'confirmation waits for an in-flight payment to settle');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_formation_snapshots WHERE departure_id=$1',
    [pendingDepartureId])).count, 0, 'deferred payment does not create a formation snapshot');
  await pool.query("UPDATE booking_orders SET status='cancelled',cancelled_at=now() WHERE id=$1", [pendingOrderId]);
  const settledCheckpoint = await processFormationChecks(pool);
  check(settledCheckpoint.checked, 1, 'settled payment allows the delayed checkpoint to run');

  const cutoffGateSchedule = departureAfterPassedFormationCutoff();
  const cutoffGateDepartureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',$3::timestamptz,$3::timestamptz-interval '30 minutes',$3::timestamptz+interval '7 hours',
        'qd_coast','xiaogang',5000,5000,$4,'open',8,8,0,false) RETURNING id`,
    [boatId, captain.id, cutoffGateSchedule.departureAt, cutoffGateSchedule.bookingDeadline],
  )).rows[0].id;
  await expect('GET', '/departures/' + cutoffGateDepartureId + '/seats', angler.token, undefined, 404);
  check((await scalar('SELECT status FROM departures WHERE id=$1', [cutoffGateDepartureId])).status,
    'open', 'booking cutoff closes seat access before the background worker writes the checkpoint');

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
  check(generated.generated, 4, 'worker generates checklists for all auto- and captain-confirmed trips');
  const repeated = await processConfirmedChecklists(pool);
  check(repeated.generated, 0, 'worker does not regenerate an existing checklist');
  const captainItems = await expect('GET', '/captain/fulfillment', captain.token);
  check(captainItems.items.map((item) => item.id).sort(),
    [departure.id, emptyDepartureId, formationDepartureId, autoDepartureId].sort(),
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

  const gateDeparture = await makeConfirmedDeparture(captain.id, boatId);
  const gateOrderOne = await makePaidOrder(angler.id, gateDeparture.id, gateDeparture.seat);
  const gateSeatTwo = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'port','mid','booked') RETURNING id,seat_number,price_fen`,
    [gateDeparture.id],
  )).rows[0];
  const gateOrderTwo = await makePaidOrder(secondAngler.id, gateDeparture.id, gateSeatTwo);
  const passengerTwo = await scalar('SELECT id FROM order_passengers WHERE order_id=$1', [gateOrderTwo]);
  const missingTripCoverage = await expect('GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token);
  check(missingTripCoverage.requiredCoverage.status, 'not_verified',
    'missing voyage-level required coverage fails closed');
  check(missingTripCoverage.canDepartureProceed, false,
    'unverified voyage-level coverage blocks the whole departure');
  check(missingTripCoverage.passengers.every((passenger) => !passenger.canBoard), true,
    'voyage-level block prevents every passenger from boarding');
  check(missingTripCoverage.manualBypassAllowed, false,
    'captain cannot manually bypass the insurance gate');
  const effectiveTripCoverage = await expect('POST',
    `/captain/departures/${gateDeparture.id}/required-insurance/sandbox`, captain.token,
    { status: 'effective' });
  check(effectiveTripCoverage.requiredCoverage.status, 'effective',
    'sandbox vessel coverage returns the saved successful status');
  const readyTripCoverage = await expect('GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token);
  check(readyTripCoverage.canDepartureProceed, true, 'verified voyage-level coverage permits the remaining trip gate');
  check(readyTripCoverage.passengers.map((passenger) => passenger.canBoard), [true, true],
    'each paid passenger with effective individual coverage can board');
  await expect('POST', `/orders/${gateOrderTwo}/passengers/${passengerTwo.id}/insurance/sandbox`, secondAngler.token,
    { status: 'failed', failureReason: 'insurer_rejected' });
  const onePassengerBlocked = await expect('GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token);
  check(onePassengerBlocked.canDepartureProceed, true,
    'one passenger insurance failure does not unconditionally stop the whole departure');
  check(onePassengerBlocked.passengers.map((passenger) => passenger.canBoard), [true, false],
    'individual insurance failure blocks only the affected passenger');
  check(onePassengerBlocked.passengers[1].failureReason, 'insurer_rejected',
    'passenger-specific failure reason remains visible to the captain');
  const orderInsurance = await expect('GET', `/orders/${gateOrderTwo}/insurance/status`, secondAngler.token);
  check(orderInsurance.insurance.passengerCoverages[0].status, 'failed',
    'order insurance status reports the server-verified passenger result');
  check((await scalar('SELECT status FROM insurance_policies WHERE order_id=$1', [gateOrderTwo])).status,
    'issued', 'a previous order-level success does not override a failed passenger-specific verification');
  await expect('POST', `/captain/departures/${gateDeparture.id}/required-insurance/sandbox`, captain.token,
    { status: 'failed', failureReason: 'platform_supplier_fault' });
  const missingRequiredCoverage = await expect('GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token);
  check(missingRequiredCoverage.canDepartureProceed, false,
    'missing vessel-level required coverage blocks the whole departure');
  check(missingRequiredCoverage.passengers.every((passenger) => !passenger.canBoard), true,
    'whole-departure insurance block supersedes individual passenger readiness');

  const shiftedWindowDeparture = await makeConfirmedDeparture(captain.id, boatId);
  const shiftedWindowOrder = await makePaidOrder(angler.id, shiftedWindowDeparture.id, shiftedWindowDeparture.seat);
  const issuedPolicy = await expect('POST', `/orders/${shiftedWindowOrder}/insurance/sandbox`, angler.token,
    { status: 'issued' });
  check(issuedPolicy.insurance.status, 'issued',
    'order-level sandbox verification saves and returns the issued policy');
  await expect('POST',
    `/captain/departures/${shiftedWindowDeparture.id}/required-insurance/sandbox`, captain.token,
    { status: 'effective' });
  await pool.query(
    "UPDATE departures SET departure_at=departure_at+interval '1 hour',return_at=return_at+interval '1 hour' WHERE id=$1",
    [shiftedWindowDeparture.id],
  );
  const shiftedWindowGate = await expect('GET',
    `/captain/departures/${shiftedWindowDeparture.id}/insurance-gate`, captain.token);
  check((await scalar('SELECT status FROM insurance_policies WHERE order_id=$1', [shiftedWindowOrder])).status,
    'issued', 'the legacy order-level policy remains issued after the sailing window changes');
  check(shiftedWindowGate.passengers[0].status, 'not_insured',
    'an old issued policy does not create effective coverage for a changed sailing window');
  check(shiftedWindowGate.passengers[0].canBoard, false,
    'a passenger without coverage for the current sailing window cannot board');

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
    { action: 'low_seat' }, 400);
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
