import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';
import { createClient } from 'redis';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createSecurity, makeSandboxIdentityNumber } from '../src/security.js';
import { createSandboxPaymentAdapter } from '../src/step3-adapters.js';
import {
  loadFormationAccounts,
  processConfirmedChecklists,
  processFormationChecks,
  processSupplementDeadlines,
  processSandboxRefundObligations,
} from '../src/step4-routes.js';
import {
  dispatchWaitlistCandidates,
  formationConfirmationAt,
  processWaitlistCloseouts,
} from '../src/step3-waitlist.js';

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
let simulatedStep3Time = null;
testConfig.step3ClockNow = () => simulatedStep3Time ?? new Date();
const security = createSecurity(testConfig);
const { Pool } = pg;
const pool = new Pool({ connectionString: config.databaseUrl, max: 4 });
const acceptanceRedis = createClient({ url: config.redisUrl });
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

async function signedPaymentCallback(event) {
  const adapter = createSandboxPaymentAdapter(testConfig);
  const response = await app.inject({
    method: 'POST',
    url: '/payment-adapters/sandbox/callback',
    headers: { 'x-sandbox-signature': adapter.signCallback(event) },
    payload: event,
  });
  return { status: response.statusCode, body: response.json() };
}

async function waitForLockedQuery(prefix, minimumCount = 1) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await scalar(
      `SELECT count(*)::integer AS count FROM pg_stat_activity
       WHERE datname=current_database() AND wait_event_type='Lock' AND state='active' AND query LIKE $1`,
      [`${prefix}%`],
    );
    if (result.count >= minimumCount) return true;
    await wait(20);
  }
  return false;
}

async function holdDepartureRow(departureId) {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [departureId]);
  return client;
}

async function expect(method, path, token, payload, status = 200) {
  const response = await request(method, path, token, payload);
  check(response.status, status, method + ' ' + path);
  return response.body;
}

async function expectDepartedInsuranceBlocked(
  departureId, captainToken, expectedMessage, label, passengerIds = [], blockedPassengerDecisions = [],
) {
  const response = await request(
    'POST', `/captain/departures/${departureId}/checkin`, captainToken,
    { event: 'departed', passengerIds },
  );
  check(response.status, 409, `${label}: departed check-in returns a conflict`);
  check(response.body.error, expectedMessage, `${label}: departed check-in explains the insurance block`);
  check((await scalar('SELECT status FROM departures WHERE id=$1', [departureId])).status, 'confirmed',
    `${label}: rejected check-in leaves the departure status unchanged`);
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_checkins
     WHERE departure_id=$1 AND event='departed'`, [departureId],
  )).count, 0, `${label}: rejected check-in records no departed event`);
  check((await scalar(
    'SELECT count(*)::integer AS count FROM departure_passenger_gate_decisions WHERE departure_id=$1',
    [departureId],
  )).count, blockedPassengerDecisions.length, `${label}: records only the passenger-level gate decisions`);
  for (const blockedPassenger of blockedPassengerDecisions) {
    const decision = await scalar(
      `SELECT decision,coverage_status FROM departure_passenger_gate_decisions
       WHERE departure_id=$1 AND passenger_id=$2`, [departureId, blockedPassenger.id],
    );
    check(decision, { decision: 'blocked', coverage_status: blockedPassenger.status },
      `${label}: records the passenger's server-verified block reason`);
  }
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
  sequence += 1;
  const identitySuffix = String(sequence).padStart(3, '0');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderId = (await client.query(
      "INSERT INTO booking_orders " +
        "(order_number,departure_id,seat_inventory_id,buyer_user_id,status,seat_fee_fen,total_amount_fen,paid_at) " +
        "VALUES ($1,$2,$3,$4,'paid',$5,$5,now()) RETURNING id",
      ['SMOKE' + Date.now() + '-' + identitySuffix, departureId, seat.id, userId, seat.price_fen],
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
        security.encrypt(makeSandboxIdentityNumber(identitySuffix)),
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

function makeIdentityForBirthDate(birthDate, sequence) {
  const body = `990000${birthDate}${String(sequence).padStart(3, '0').slice(-3)}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return `${body}${checks[sum % 11]}`;
}

async function makeMultiPassengerPaidOrder(userId, departureId, seats, passengers, discountFen = 0) {
  sequence += 1;
  const seatFeeFen = seats.reduce((sum, seat) => sum + Number(seat.price_fen), 0);
  const orderId = (await pool.query(
    `INSERT INTO booking_orders
       (order_number,departure_id,seat_inventory_id,buyer_user_id,status,seat_fee_fen,discount_fen,
        total_amount_fen,paid_at)
     VALUES ($1,$2,$3,$4,'paid',$5,$6,$7,now()) RETURNING id`,
    [`SMOKEMULTI${Date.now()}-${sequence}`, departureId, seats[0].id, userId,
      seatFeeFen, discountFen, seatFeeFen - discountFen],
  )).rows[0].id;
  const passengerIds = [];
  for (let index = 0; index < seats.length; index += 1) {
    const seat = seats[index];
    const person = passengers[index];
    await pool.query(
      `INSERT INTO booking_order_seats (order_id,seat_inventory_id,seat_number,price_fen,status)
       VALUES ($1,$2,$3,$4,'paid')`, [orderId, seat.id, seat.seat_number, seat.price_fen],
    );
    const passengerId = (await pool.query(
      `INSERT INTO order_passengers
         (order_id,seat_inventory_id,full_name_ciphertext,identity_number_ciphertext,
          phone_ciphertext,identity_verified_at)
       VALUES ($1,$2,$3,$4,$5,now()) RETURNING id`,
      [orderId, seat.id, security.encrypt(person.name), security.encrypt(person.identity),
        security.encrypt(`139${String(sequence).padStart(8, '0').slice(-8)}`)],
    )).rows[0].id;
    passengerIds.push(passengerId);
    await pool.query(
      `INSERT INTO passenger_insurance_coverages
         (departure_id,order_id,passenger_id,coverage_start_at,coverage_end_at,status,
          provider_code,provider_policy_reference,verified_at)
       SELECT d.id,$1::uuid,$2::uuid,d.departure_at,d.return_at,'effective','sandbox',
         'sandbox_multi_'||$2::text,now() FROM departures d WHERE d.id=$3`,
      [orderId, passengerId, departureId],
    );
  }
  await pool.query(
    `INSERT INTO insurance_policies (order_id,provider_code,status)
     VALUES ($1,'sandbox','issued')`, [orderId],
  );
  return { orderId, passengerIds };
}

async function makeOpenCancellationFixture(captain, boatId, label, hoursUntilDeparture) {
  const departureAt = new Date(Date.now() + hoursUntilDeparture * 3_600_000);
  const departureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',$3::timestamptz,$3::timestamptz-interval '30 minutes',
        $3::timestamptz+interval '7 hours','qd_coast','xiaogang',10000,50000,
        $3::timestamptz-interval '30 minutes','open',12,12,0,false)
     RETURNING id`, [boatId, captain.id, departureAt.toISOString()],
  )).rows[0].id;
  const seat = (await pool.query(
    `INSERT INTO seat_inventory
       (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,1,50000,'port','mid','booked','platform') RETURNING id,seat_number,price_fen`,
    [departureId],
  )).rows[0];
  const user = await makeUser(label);
  const orderId = await makePaidOrder(user.id, departureId, seat);
  return { departureId, orderId, seatId: seat.id, user };
}

async function makeConfirmedCancellationFixture(captain, boatId, label, now, hoursUntilDeparture, status) {
  const departureAt = new Date(now.getTime() + hoursUntilDeparture * 3_600_000);
  const thresholdFen = status === 'captain_confirmed' ? 100000 : 90000;
  const departureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',$3::timestamptz,$3::timestamptz-interval '30 minutes',
        $3::timestamptz+interval '7 hours','qd_coast','xiaogang',$4,50000,
        $3::timestamptz-interval '30 minutes',$5,12,2,0,false) RETURNING id`,
    [boatId, captain.id, departureAt.toISOString(), thresholdFen, status],
  )).rows[0].id;
  const seats = (await pool.query(
    `INSERT INTO seat_inventory
       (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,1,50000,'port','mid','booked','platform'),
       ($1,2,50000,'starboard','mid','booked','platform') RETURNING id,seat_number,price_fen`,
    [departureId],
    )).rows.sort((left, right) => left.seat_number - right.seat_number);
  const firstUser = await makeUser(`${label}取消人`);
  const remainingUser = await makeUser(`${label}保留人`);
  const orderId = await makePaidOrder(firstUser.id, departureId, seats.find((seat) => seat.seat_number === 1));
  const remainingOrderId = await makePaidOrder(
    remainingUser.id, departureId, seats.find((seat) => seat.seat_number === 2),
  );
  const confirmationAt = formationConfirmationAt(departureAt);
  const captainOfflineFen = status === 'captain_confirmed' ? 10000 : 0;
  await pool.query(
    `INSERT INTO departure_formation_snapshots
       (departure_id,confirmation_at,threshold_fen,platform_ticket_net_fen,penalty_pool_fen,
        successful_supplement_fen,platform_verifiable_fen,captain_offline_declared_fen,outcome)
     VALUES ($1,$2,$3,90000,0,0,90000,$4,$5)`,
    [departureId, confirmationAt, thresholdFen, captainOfflineFen,
      status === 'captain_confirmed' ? 'shortfall' : 'automatic_confirmed'],
  );
  if (status === 'captain_confirmed') {
    await pool.query(
      `INSERT INTO departure_offline_ledger_entries
         (departure_id,captain_user_id,amount_delta_fen,note,request_key)
       VALUES ($1,$2,$3,'验收模拟线下收入',$4)`,
      [departureId, captain.id, captainOfflineFen, `${label}-offline`],
    );
    await pool.query(
      `INSERT INTO departure_captain_formation_decisions
         (departure_id,captain_user_id,threshold_fen,platform_verifiable_fen,
          captain_offline_declared_fen,basis_note)
       VALUES ($1,$2,$3,90000,$4,'验收模拟线下账依据')`,
      [departureId, captain.id, thresholdFen, captainOfflineFen],
    );
  }
  return {
    departureId, orderId, remainingOrderId, seatId: seats[0].id, remainingSeatId: seats[1].id,
    confirmationAt, departureAt, user: firstUser,
  };
}

async function makeSupplementFixture(captain, boatId, label) {
  const departureAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const bookingDeadline = new Date(departureAt.getTime() - 30 * 60 * 1000);
  const departureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',$3::timestamptz,$3::timestamptz-interval '30 minutes',
        $3::timestamptz+interval '7 hours',
        'qd_coast','xiaogang',50000,50000,$4,'open',12,12,0,false) RETURNING id`,
    [boatId, captain.id, departureAt.toISOString(), bookingDeadline.toISOString()],
  )).rows[0].id;
  const seat = (await pool.query(
    `INSERT INTO seat_inventory
       (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,1,50000,'port','mid','booked','platform') RETURNING id,seat_number,price_fen`,
    [departureId],
  )).rows[0];
  const user = await makeUser(label);
  const orderId = await makePaidOrder(user.id, departureId, seat);
  const closeoutAt = new Date(formationConfirmationAt(departureAt).getTime() + 10 * 60 * 1000);
  await pool.query('UPDATE departures SET waitlist_window_closed_at=$2 WHERE id=$1', [departureId, closeoutAt]);
  await processFormationChecks(pool, closeoutAt);
  check((await scalar('SELECT status FROM departures WHERE id=$1', [departureId])).status,
    'handling_shortfall', `${label}: server checkpoint freezes a shortfall before supplement`);
  const response = await expect('POST', `/captain/departures/${departureId}/supplement-rounds`,
    captain.token, { responseDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, 201);
  check(response.round.shortfallFen, 5000, `${label}: frozen one-seat shortfall is ¥50`);
  return { departureId, user, orderId, round: response.round };
}

async function makeMultiSupplementFixture(captain, boatId, label, {
  participantCount = 2, shortfallFen = 5000, minimumTotalFen = null,
} = {}) {
  const departureAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const closeoutAt = new Date(formationConfirmationAt(departureAt).getTime() + 10 * 60 * 1000);
  const ticketNetFen = participantCount * 45000;
  const thresholdFen = minimumTotalFen ?? ticketNetFen + shortfallFen;
  const departureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,waitlist_window_closed_at,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',$3::timestamptz,$3::timestamptz-interval '30 minutes',
        $3::timestamptz+interval '7 hours','qd_coast','xiaogang',$4,50000,$5,'open',$6,
        12,12,0,false) RETURNING id`,
    [boatId, captain.id, departureAt.toISOString(), thresholdFen,
      new Date(departureAt.getTime() - 30 * 60 * 1000).toISOString(), closeoutAt],
  )).rows[0].id;
  const user = await makeUser(label);
  const orders = [];
  for (let index = 1; index <= participantCount; index += 1) {
    const seat = (await pool.query(
      `INSERT INTO seat_inventory
         (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
       VALUES ($1,$2,50000,'port','mid','booked','platform') RETURNING id,seat_number,price_fen`,
      [departureId, index],
    )).rows[0];
    orders.push(await makePaidOrder(user.id, departureId, seat));
  }
  const checkpoint = await processFormationChecks(pool, closeoutAt);
  check(checkpoint.checked, 1, `${label}: prepared a frozen shortfall snapshot`);
  const roundResponse = await expect(
    'POST', `/captain/departures/${departureId}/supplement-rounds`, captain.token,
    { responseDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, 201,
  );
  return { departureId, user, orders, round: roundResponse.round };
}

async function makeWaitlistPaymentFixture(captain, boatId, label, clockOffsets = null) {
  const departureAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const bookingDeadline = new Date(departureAt.getTime() - 30 * 60 * 1000);
  const confirmationAt = formationConfirmationAt(departureAt);
  const departureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',$3::timestamptz,$3::timestamptz-interval '30 minutes',
        $3::timestamptz+interval '7 hours','qd_coast','xiaogang',500000,50000,$4,'open',12,12,0,false)
     RETURNING id`,
    [boatId, captain.id, departureAt.toISOString(), bookingDeadline.toISOString()],
  )).rows[0].id;
  const seat = (await pool.query(
    `INSERT INTO seat_inventory
       (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,1,50000,'port','mid','booked','platform') RETURNING id,seat_number,price_fen`,
    [departureId],
  )).rows[0];
  const seller = await makeUser(`${label}原订单`);
  const sellerOrderId = await makePaidOrder(seller.id, departureId, seat);
  const candidate = await makeUser(`${label}候补`);
  if (clockOffsets) simulatedStep3Time = new Date(confirmationAt.getTime() + clockOffsets.registrationOffsetMs);
  const registration = await expect('POST', `/departures/${departureId}/waitlist`, candidate.token,
    { requestKey: `wait-${sequence}-${Date.now()}` }, 201);
  if (clockOffsets) simulatedStep3Time = new Date(confirmationAt.getTime() + clockOffsets.releaseOffsetMs);
  await expect('POST', `/orders/${sellerOrderId}/cancel`, seller.token, {});
  const authorized = await expect('GET', `/waitlist/${registration.entry.id}`, candidate.token);
  check(authorized.entry.status, 'authorized', `${label}: pre-cutoff queue receives the released seat`);
  await expect('POST', `/waitlist/${authorized.entry.id}/accept`, candidate.token, {});
  const order = await expect('POST', '/orders', candidate.token, {
    holdId: authorized.entry.holdId,
    idempotencyKey: `waitlist-order-${sequence}-${Date.now()}`,
    passengers: [{
      seatId: authorized.entry.seatId,
      fullName: '候补钓友',
      identityNumber: makeSandboxIdentityNumber(String(sequence + 1).padStart(3, '0')),
      phone: '13900009999',
    }],
  }, 201);
  const intent = await expect('POST', `/orders/${order.order.id}/payment-intents`, candidate.token, {}, 201);
  return {
    departureId, departureAt, confirmationAt,
    entryId: authorized.entry.id, orderId: order.order.id, candidate,
    intent: intent.payment, authorizationExpiresAt: authorized.entry.authorizationExpiresAt,
  };
}

async function makeOrdinaryPendingPaymentFixture(captain, boatId, label) {
  const departure = await makeWindowDeparture(captain, boatId, label);
  const buyer = await makeUser(`${label}钓友`);
  simulatedStep3Time = new Date(departure.confirmationAt.getTime() - 60_000);
  const hold = await expect('POST', `/departures/${departure.departureId}/seat-holds`, buyer.token,
    { seatIds: [departure.seat.id] }, 201);
  const order = await expect('POST', '/orders', buyer.token, {
    holdId: hold.holdId,
    idempotencyKey: `ordinary-window-order-${sequence}-${Date.now()}`,
    passengers: [{
      seatId: departure.seat.id,
      fullName: '普通订单钓友',
      identityNumber: makeSandboxIdentityNumber(String(sequence + 1).padStart(3, '0')),
      phone: '13900009999',
    }],
  }, 201);
  const intent = await expect('POST', `/orders/${order.order.id}/payment-intents`, buyer.token, {}, 201);
  return {
    ...departure,
    buyer,
    holdId: hold.holdId,
    orderId: order.order.id,
    intent: intent.payment,
  };
}

async function makeWindowDeparture(captain, boatId, label) {
  const departureAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const bookingDeadline = new Date(departureAt.getTime() - 30 * 60 * 1000);
  const departureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',$3::timestamptz,$3::timestamptz-interval '30 minutes',
        $3::timestamptz+interval '7 hours','qd_coast','xiaogang',500000,50000,$4,'open',12,12,0,false)
     RETURNING id`,
    [boatId, captain.id, departureAt.toISOString(), bookingDeadline.toISOString()],
  )).rows[0].id;
  const seat = (await pool.query(
    `INSERT INTO seat_inventory
       (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,1,50000,'port','mid','available','platform') RETURNING id,seat_number,price_fen`,
    [departureId],
  )).rows[0];
  return {
    departureId, departureAt, bookingDeadline,
    confirmationAt: formationConfirmationAt(departureAt), seat,
    label,
  };
}

async function createSupplementScreenshotFixture(
  captain, boatId, outputPath, captainConfirmedTrip, captainConfirmedToken,
) {
  simulatedStep3Time = null;
  const departureAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const confirmationAt = formationConfirmationAt(departureAt);
  const closeoutAt = new Date(confirmationAt.getTime() + 10 * 60 * 1000);
  const user = await makeUser('补差本地API截图验收钓友');
  const departureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,waitlist_window_closed_at,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',$3::timestamptz,$3::timestamptz-interval '30 minutes',
        $3::timestamptz+interval '7 hours','qd_coast','xiaogang',90001,50000,
        $4,'open',$5,12,12,0,false) RETURNING id`,
    [boatId, captain.id, departureAt.toISOString(),
      new Date(departureAt.getTime() - 30 * 60 * 1000).toISOString(), closeoutAt],
  )).rows[0].id;
  const orders = [];
  for (let seatNumber = 1; seatNumber <= 2; seatNumber += 1) {
    const seat = (await pool.query(
      `INSERT INTO seat_inventory
         (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
       VALUES ($1,$2,50000,'port','mid','booked','platform') RETURNING id,seat_number,price_fen`,
      [departureId, seatNumber],
    )).rows[0];
    orders.push(await makePaidOrder(user.id, departureId, seat));
  }
  const checkpoint = await processFormationChecks(pool, new Date(closeoutAt.getTime() + 1000));
  check(checkpoint.checked >= 1, true, 'local screenshot fixture is included in the due formation pass');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_formation_snapshots WHERE departure_id=$1',
    [departureId])).count, 1, 'local screenshot fixture receives its shortfall snapshot');
  const roundResponse = await expect(
    'POST', `/captain/departures/${departureId}/supplement-rounds`, captain.token,
    { responseDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, 201,
  );
  const first = roundResponse.round.participants[0];
  const alreadyAccepted = roundResponse.round.participants[1];
  check(first.amountFen, 1, 'local screenshot fixture makes the displayed supplement exactly one fen');
  await pool.query(
    `UPDATE departure_supplement_participants
     SET consent_status='accepted',responded_at=now(),updated_at=now() WHERE id=$1`,
    [alreadyAccepted.id],
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({
    apiBaseUrl: process.env.STEP4_SCREENSHOT_API_BASE_URL ?? 'http://127.0.0.1:3000',
    token: user.token,
    orderId: first.orderId,
    departureId,
    roundId: roundResponse.round.id,
    captainToken: captain.token,
    captainConfirmedToken,
    captainConfirmedDepartureId: captainConfirmedTrip.departureId,
    captainConfirmedOrderId: captainConfirmedTrip.orderId,
  }, null, 2), { mode: 0o600 });
}

async function scalar(sql, values = []) {
  return (await pool.query(sql, values)).rows[0];
}

async function processFormationChecksAt(asOf) {
  simulatedStep3Time = new Date(asOf);
  try {
    return await processFormationChecks(pool, asOf, undefined, {
      redis: acceptanceRedis,
      clockNow: testConfig.step3ClockNow,
    });
  } finally {
    simulatedStep3Time = null;
  }
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
  if (!acceptanceRedis.isOpen) await acceptanceRedis.connect();

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
     VALUES ($1,$2,'pro_fishing',now()+interval '48 hours',now()+interval '48 hours'-interval '30 minutes',
        now()+interval '48 hours'+'7 hours','qd_coast','xiaogang',5000,5000,
        now()+interval '44 hours','open',8,8,0,false) RETURNING id`,
    [boatId, captain.id],
  )).rows[0].id;
  const formationSeats = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     SELECT $1,n,500,'port','mid','booked' FROM generate_series(1,8) AS n
     RETURNING id,seat_number,price_fen`,
    [formationDepartureId],
  )).rows.sort((left, right) => left.seat_number - right.seat_number);
  const formationOrderIds = [];
  for (const seat of formationSeats) {
    formationOrderIds.push(await makePaidOrder(angler.id, formationDepartureId, seat));
  }
  const formationOrderId = formationOrderIds[0];
  const formationBeforeCutoff = await expect('GET', `/orders/${formationOrderId}/fulfillment`, angler.token);
  check(formationBeforeCutoff.departure.status, 'open', 'the paid trip remains awaiting the server checkpoint before local 18:00');
  check(formationBeforeCutoff.departure.preConfirmationMeetsThreshold, false,
    'pre-checkpoint fulfillment reports the live platform amount is below threshold');
  check(formationBeforeCutoff.departure.formationShortfallFen, null,
    'no shortfall amount is exposed before the server freezes a shortfall snapshot');

  const thresholdMetDepartureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',now()+interval '72 hours',now()+interval '71 hours 30 minutes',
        now()+interval '79 hours','qd_coast','xiaogang',90000,50000,now()+interval '71 hours',
        'open',8,2,0,false) RETURNING id`,
    [boatId, captain.id],
  )).rows[0].id;
  const thresholdMetSeats = (await pool.query(
    `INSERT INTO seat_inventory
       (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,1,50000,'port','mid','booked','platform'),
       ($1,2,50000,'starboard','mid','booked','platform') RETURNING id,seat_number,price_fen`,
    [thresholdMetDepartureId],
  )).rows;
  const thresholdMetOrderId = await makePaidOrder(
    angler.id, thresholdMetDepartureId, thresholdMetSeats.find((seat) => seat.seat_number === 1),
  );
  await makePaidOrder(
    angler.id, thresholdMetDepartureId, thresholdMetSeats.find((seat) => seat.seat_number === 2),
  );
  const thresholdMetBeforeCutoff = await expect(
    'GET', `/orders/${thresholdMetOrderId}/fulfillment`, angler.token,
  );
  check(thresholdMetBeforeCutoff.departure.preConfirmationMeetsThreshold, true,
    'pre-checkpoint fulfillment distinguishes a live platform amount already meeting threshold');
  check(thresholdMetBeforeCutoff.departure.status, 'open',
    'meeting threshold before the scheduled checkpoint remains pending rather than confirmed');
  const initialAccounts = await expect('GET',
    '/captain/departures/' + formationDepartureId + '/formation-accounts', captain.token);
  check(initialAccounts.accounts.platform.ticketNetFen, 3600,
    'full eight-seat departure calculates its approved 90 percent ticket net');
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
    { amountDeltaFen: 1400, note: '验收模拟线下收入', requestKey: 'formation-offline-001' }, 201);
  check(offlineEntry.accounts.captainOffline.declaredFen, 1400,
    'captain-reported offline amount remains on its separate ledger');
  check(offlineEntry.accounts.platform.verifiableTotalFen, 3600,
    'offline entry does not alter platform-verifiable total');
  check(offlineEntry.accounts.captainOffline.supportsCaptainConfirmation, true,
    'offline amount can support only the captain confirmation path');
  const replayedOfflineEntry = await expect('POST',
    '/captain/departures/' + formationDepartureId + '/offline-ledger', captain.token,
    { amountDeltaFen: 1400, note: '验收模拟线下收入', requestKey: 'formation-offline-001' });
  check(replayedOfflineEntry.idempotentReplay, true, 'offline ledger request key is idempotent');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_offline_ledger_entries WHERE departure_id=$1',
    [formationDepartureId])).count, 1, 'idempotent replay does not duplicate an offline entry');
  await expect('POST', '/captain/departures/' + formationDepartureId + '/offline-ledger', captain.token,
    { amountDeltaFen: -1401, note: '超额冲减', requestKey: 'formation-offline-002' }, 409);
  await expect('POST', '/captain/departures/' + formationDepartureId + '/offline-ledger', captain.token,
    { amountDeltaFen: 600, note: '重用请求编号', requestKey: 'formation-offline-001' }, 409);
  const shortfallCheckpoint = await processFormationChecksAt(
    new Date(Date.parse(initialAccounts.accounts.confirmationAt) + 10 * 60 * 1000));
  check(shortfallCheckpoint.checked, 1, 'departure receives its formation checkpoint after the 18:10 waitlist closeout');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [formationDepartureId])).status,
    'handling_shortfall', 'platform-only shortfall enters server-managed handling');
  check((await scalar('SELECT outcome FROM departure_formation_snapshots WHERE departure_id=$1',
    [formationDepartureId])).outcome, 'shortfall', 'shortfall snapshot records the automatic ledger outcome');
  const shortfallFlow = await expect('GET', `/orders/${formationOrderId}/fulfillment`, angler.token);
  check(shortfallFlow.departure.status, 'handling_shortfall',
    'the full but below-threshold departure remains in its server-calculated shortfall state');
  check(shortfallFlow.departure.formationShortfallFen, 1400,
    'angler receives the frozen server-calculated ¥14.00 shortfall');
  const captainDecision = await expect('POST',
    '/captain/departures/' + formationDepartureId + '/formation/decision', captain.token,
    { action: 'captain_confirmed', basisNote: '线下账本与平台账核对一致' });
  check(captainDecision.status, 'captain_confirmed', 'captain confirmation uses the separate offline ledger');
  check(captainDecision.platformGuarantee, false, 'captain confirmation does not imply a platform guarantee');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_captain_formation_decisions WHERE departure_id=$1',
    [formationDepartureId])).count, 1, 'captain confirmation saves its basis and both ledger values');
  const captainConfirmedFlow = await expect('GET', `/orders/${formationOrderId}/fulfillment`, angler.token);
  check(captainConfirmedFlow.departure.status, 'captain_confirmed',
    'the trip page distinguishes a captain-confirmed departure from platform confirmation');
  check(captainConfirmedFlow.departure.platformGuarantee, false,
    'captain-confirmed passenger fulfillment explicitly disclaims platform guarantee');
  check(captainConfirmedFlow.departure.formationShortfallFen, null,
    'captain confirmation clears the displayed shortfall without changing the recorded snapshot');
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
           AND (query LIKE 'SELECT d.id,d.status,d.departure_at,%'
             OR query LIKE 'SELECT d.id FROM departures d WHERE d.id=$1%'
             OR query LIKE 'SELECT id FROM departures WHERE id=$1 AND status IN (%')`,
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
  const crossedDepartureCheckpoint = await blockedCheckpoint;
  check(workerBlockedOnRow, true, 'formation worker waits on the departure row lock');
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
  const autoOrderId = await makePaidOrder(angler.id, autoDepartureId, autoSeat);
  await pool.query(
    `INSERT INTO departure_formation_adjustments (departure_id,adjustment_type,amount_fen,source_reference)
     VALUES ($1,'penalty_pool',600,'acceptance-penalty-001')`, [autoDepartureId]);
  const autoAccounts = await expect('GET',
    '/captain/departures/' + autoDepartureId + '/formation-accounts', captain.token);
  check(autoAccounts.accounts.platform.ticketNetFen, 4500, 'automatic account uses discounted net ticket proceeds');
  check(autoAccounts.accounts.platform.penaltyPoolFen, 600, 'recorded penalty pool joins the platform account');
  const autoCheckpoint = await processFormationChecksAt(
    new Date(Date.parse(autoAccounts.accounts.confirmationAt) + 10 * 60 * 1000));
  check(autoCheckpoint.checked, 1, 'automatic departure receives a checkpoint at its local cutoff');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [autoDepartureId])).status,
    'confirmed', 'platform ledger meeting the threshold automatically confirms the departure');
  check((await scalar('SELECT outcome FROM departure_formation_snapshots WHERE departure_id=$1',
    [autoDepartureId])).outcome, 'automatic_confirmed', 'automatic confirmation preserves its calculation snapshot');
  const autoFlow = await expect('GET', `/orders/${autoOrderId}/fulfillment`, angler.token);
  check(autoFlow.departure.status, 'confirmed', 'the trip page shows server-confirmed automatic formation');
  check(autoFlow.departure.formationShortfallFen, null,
    'an automatically confirmed trip does not display a shortfall');

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
  const captainConfirmedItem = captainItems.items.find((item) => item.id === formationDepartureId);
  check(captainConfirmedItem.platformGuarantee, false,
    'captain-confirmed trip list explicitly disclaims platform guarantee');
  const emptyTrip = await expect('GET', '/captain/departures/' + emptyDepartureId + '/fulfillment', captain.token);
  check(emptyTrip.checklist.insurance.status, 'check_before_departure', 'empty trip does not imply insurance is checked');
  check(emptyTrip.checklist.manifest.status, 'review_required', 'empty trip does not imply passenger manifest is matched');

  const detail = await expect('GET', '/captain/departures/' + departure.id + '/fulfillment', captain.token);
  check(detail.checklist.manifest.status, 'matched', 'passenger and seat counts match');
  check(detail.checklist.insurance.status, 'checked', 'issued insurance is reflected');
  const captainConfirmedDetail = await expect(
    'GET', '/captain/departures/' + formationDepartureId + '/fulfillment', captain.token,
  );
  check(captainConfirmedDetail.departure.platformGuarantee, false,
    'captain-confirmed fulfillment detail explicitly disclaims platform guarantee');
  const orderFlow = await expect('GET', '/orders/' + orderId + '/fulfillment', angler.token);
  check(orderFlow.departure.status, 'confirmed', 'angler sees confirmed trip status');
  check(Boolean(orderFlow.checklist), true, 'angler can read the generated checklist');

  const preWeatherSnapshot = await scalar(
    `SELECT outcome,threshold_fen,platform_verifiable_fen FROM departure_formation_snapshots
     WHERE departure_id=$1`, [autoDepartureId],
  );
  await pool.query("UPDATE departures SET status='weather_cancelled',updated_at=now() WHERE id=$1", [autoDepartureId]);
  const weatherCancelledFlow = await expect('GET', `/orders/${autoOrderId}/fulfillment`, angler.token);
  check(weatherCancelledFlow.departure.status, 'weather_cancelled',
    'a weather-cancelled trip remains a distinct server-owned state after formation');
  check(weatherCancelledFlow.departure.formationShortfallFen, null,
    'weather cancellation does not show an obsolete shortfall');
  const postWeatherSnapshot = await scalar(
    `SELECT outcome,threshold_fen,platform_verifiable_fen FROM departure_formation_snapshots
     WHERE departure_id=$1`, [autoDepartureId],
  );
  check(postWeatherSnapshot, preWeatherSnapshot,
    'weather cancellation preserves the original automatic formation snapshot');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1', [autoOrderId])).status, 'paid',
    'the status fixture does not invent a weather refund or rewrite the paid order');

  const gateDeparture = await makeConfirmedDeparture(captain.id, boatId);
  const gateOrderOne = await makePaidOrder(angler.id, gateDeparture.id, gateDeparture.seat);
  const passengerOne = await scalar('SELECT id FROM order_passengers WHERE order_id=$1', [gateOrderOne]);
  const gateSeatTwo = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'port','mid','booked') RETURNING id,seat_number,price_fen`,
    [gateDeparture.id],
  )).rows[0];
  const gateOrderTwo = await makePaidOrder(secondAngler.id, gateDeparture.id, gateSeatTwo);
  const passengerTwo = await scalar('SELECT id FROM order_passengers WHERE order_id=$1', [gateOrderTwo]);
  const missingPassengerList = await request(
    'POST', `/captain/departures/${gateDeparture.id}/checkin`, captain.token, { event: 'departed' },
  );
  check(missingPassengerList.status, 400, 'departure check-in requires an explicit passenger list');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [gateDeparture.id])).status, 'confirmed',
    'missing passenger list leaves departure status unchanged');
  await expectDepartedInsuranceBlocked(
    gateDeparture.id, captain.token, '航次必需保障未生效，暂不能出航', 'missing vessel coverage record',
    [passengerOne.id, passengerTwo.id],
  );
  const missingTripCoverage = await expect('GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token);
  check(missingTripCoverage.requiredCoverage.status, 'not_verified',
    'missing voyage-level required coverage fails closed');
  check(missingTripCoverage.canDepartureProceed, false,
    'unverified voyage-level coverage blocks the whole departure');
  check(missingTripCoverage.passengers.every((passenger) => !passenger.canBoard), true,
    'voyage-level block prevents every passenger from boarding');
  check(missingTripCoverage.manualBypassAllowed, false,
    'captain cannot manually bypass the insurance gate');
  await expectDepartedInsuranceBlocked(
    gateDeparture.id, captain.token, '航次必需保障未生效，暂不能出航', 'missing vessel coverage',
    [passengerOne.id, passengerTwo.id],
  );
  const effectiveTripCoverage = await expect('POST',
    `/captain/departures/${gateDeparture.id}/required-insurance/sandbox`, captain.token,
    { status: 'effective' });
  check(effectiveTripCoverage.requiredCoverage.status, 'effective',
    'sandbox vessel coverage returns the saved successful status');
  const readyTripCoverage = await expect('GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token);
  check(readyTripCoverage.canDepartureProceed, true, 'verified voyage-level coverage permits the remaining trip gate');
  check(readyTripCoverage.passengers.map((passenger) => passenger.canBoard), [true, true],
    'each paid passenger with effective individual coverage can board');
  const incompletePassengerRoster = await request(
    'POST', `/captain/departures/${gateDeparture.id}/checkin`, captain.token,
    { event: 'departed', passengerIds: [passengerOne.id] },
  );
  check(incompletePassengerRoster.status, 409, 'a partial client roster is rejected');
  check(incompletePassengerRoster.body.error, '乘船名单已变化，请刷新后重试',
    'the server requires a complete paid-passenger roster');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [gateDeparture.id])).status, 'confirmed',
    'a stale roster leaves departure unchanged');
  for (const passengerStatus of ['pending_verification', 'not_insured']) {
    await expect('POST', `/orders/${gateOrderTwo}/passengers/${passengerTwo.id}/insurance/sandbox`, secondAngler.token,
      { status: passengerStatus });
    const notEffectivePassengerGate = await expect(
      'GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token,
    );
    check(notEffectivePassengerGate.canDepartureProceed, true,
      `${passengerStatus} for one passenger does not unconditionally stop the whole departure`);
    check(notEffectivePassengerGate.passengers.map((passenger) => passenger.canBoard), [true, false],
      `${passengerStatus} blocks only the affected passenger`);
    check(notEffectivePassengerGate.passengers[1].status, passengerStatus,
      `${passengerStatus} remains visible in the captain's gate result`);
  }
  await expect('POST', `/orders/${gateOrderTwo}/passengers/${passengerTwo.id}/insurance/sandbox`, secondAngler.token,
    { status: 'failed', failureReason: 'insurer_rejected', attemptKey: 'gate-insurer-rejection-1' });
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
    { status: 'pending_verification' });
  const pendingTripCoverage = await expect('GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token);
  check(pendingTripCoverage.requiredCoverage.status, 'pending_verification',
    'pending voyage-level coverage remains explicitly unverified');
  check(pendingTripCoverage.canDepartureProceed, false,
    'pending voyage-level required coverage blocks the whole departure');
  check(pendingTripCoverage.passengers.every((passenger) => !passenger.canBoard), true,
    'pending voyage-level coverage prevents every passenger from boarding');
  await expectDepartedInsuranceBlocked(
    gateDeparture.id, captain.token, '航次必需保障未生效，暂不能出航', 'pending vessel coverage',
    [passengerOne.id, passengerTwo.id],
  );
  await expect('POST', `/captain/departures/${gateDeparture.id}/required-insurance/sandbox`, captain.token,
    { status: 'failed', failureReason: 'platform_supplier_fault' });
  const missingRequiredCoverage = await expect('GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token);
  check(missingRequiredCoverage.canDepartureProceed, false,
    'missing vessel-level required coverage blocks the whole departure');
  check(missingRequiredCoverage.passengers.every((passenger) => !passenger.canBoard), true,
    'whole-departure insurance block supersedes individual passenger readiness');
  await expectDepartedInsuranceBlocked(
    gateDeparture.id, captain.token, '航次必需保障未生效，暂不能出航', 'failed vessel coverage',
    [passengerOne.id, passengerTwo.id],
  );
  await expect('POST', `/captain/departures/${gateDeparture.id}/required-insurance/sandbox`, captain.token,
    { status: 'effective' });
  const partialInsuranceReady = await expect(
    'GET', `/captain/departures/${gateDeparture.id}/insurance-gate`, captain.token,
  );
  check(partialInsuranceReady.passengers.map((passenger) => passenger.canBoard), [true, false],
    'one failed passenger remains blocked while another passenger is ready');
  const partialDeparture = await expect('POST', `/captain/departures/${gateDeparture.id}/checkin`, captain.token,
    { event: 'departed', passengerIds: [passengerOne.id, passengerTwo.id] });
  check(partialDeparture.status, 'in_progress',
    'an eligible passenger can depart while an ineligible passenger stays ashore');
  check(partialDeparture.boardedPassengerCount, 1,
    'departure response reports only the effective passenger as boarded');
  check(partialDeparture.blockedPassengerCount, 1,
    'departure response reports the failed passenger as blocked');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [gateDeparture.id])).status, 'in_progress',
    'the departed check-in advances after required coverage and selected passengers are effective');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_checkins
     WHERE departure_id=$1 AND event='departed'`, [gateDeparture.id],
  )).count, 1, 'a valid insurance-gated departure records one check-in');
  check((await scalar(
    `SELECT decision,coverage_status FROM departure_passenger_gate_decisions
     WHERE departure_id=$1 AND passenger_id=$2`, [gateDeparture.id, passengerOne.id],
  )), { decision: 'allowed', coverage_status: 'effective' },
  'the effective passenger is recorded on the permitted boarding list');
  check((await scalar(
    `SELECT decision,coverage_status FROM departure_passenger_gate_decisions
     WHERE departure_id=$1 AND passenger_id=$2`, [gateDeparture.id, passengerTwo.id],
  )), { decision: 'blocked', coverage_status: 'failed' },
  'the failed passenger receives an auditable block and is not on the permitted list');
  const blockedIdentity = security.decrypt((await scalar(
    'SELECT identity_number_ciphertext FROM order_passengers WHERE id=$1', [passengerTwo.id],
  )).identity_number_ciphertext);
  const allowedIdentity = security.decrypt((await scalar(
    'SELECT identity_number_ciphertext FROM order_passengers WHERE id=$1', [passengerOne.id],
  )).identity_number_ciphertext);
  const partialManifest = await request(
    'GET', `/captain/departures/${gateDeparture.id}/manifest.csv?format=full`, captain.token,
  );
  check(partialManifest.body.includes(allowedIdentity), true,
    'post-departure manifest contains the passenger who was allowed to board');
  check(partialManifest.body.includes(blockedIdentity), false,
    'post-departure manifest excludes the passenger who was blocked');

  const allReadyDeparture = await makeConfirmedDeparture(captain.id, boatId);
  await makePaidOrder(angler.id, allReadyDeparture.id, allReadyDeparture.seat);
  const allReadySeatTwo = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'starboard','mid','booked') RETURNING id,seat_number,price_fen`,
    [allReadyDeparture.id],
  )).rows[0];
  await makePaidOrder(secondAngler.id, allReadyDeparture.id, allReadySeatTwo);
  const allReadyPassengerIds = (await pool.query(
    `SELECT op.id FROM order_passengers op JOIN booking_orders o ON o.id=op.order_id
     WHERE o.departure_id=$1 AND o.status='paid' ORDER BY op.id`, [allReadyDeparture.id],
  )).rows.map((row) => row.id);
  check(allReadyPassengerIds.length, 2, 'all-effective case includes both paid passengers');
  await expect('POST', `/captain/departures/${allReadyDeparture.id}/required-insurance/sandbox`, captain.token,
    { status: 'effective' });
  const allInsuranceReady = await expect(
    'GET', `/captain/departures/${allReadyDeparture.id}/insurance-gate`, captain.token,
  );
  check(allInsuranceReady.passengers.map((passenger) => passenger.canBoard), [true, true],
    'all current passenger coverages are effective before departure');
  await pool.query("UPDATE departures SET status='captain_confirmed' WHERE id=$1", [allReadyDeparture.id]);
  await expect('POST', `/captain/departures/${allReadyDeparture.id}/checkin`, captain.token,
    { event: 'departed', passengerIds: allReadyPassengerIds });
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_passenger_gate_decisions
     WHERE departure_id=$1 AND decision='allowed'`,
    [allReadyDeparture.id],
  )).count, 2, 'all current effective passengers are recorded as allowed to board');

  const blockedDeparture = await makeConfirmedDeparture(captain.id, boatId);
  const blockedOrder = await makePaidOrder(angler.id, blockedDeparture.id, blockedDeparture.seat);
  const blockedPassenger = await scalar('SELECT id FROM order_passengers WHERE order_id=$1', [blockedOrder]);
  await expect('POST', `/captain/departures/${blockedDeparture.id}/required-insurance/sandbox`, captain.token,
    { status: 'effective' });
  for (const status of ['pending_verification', 'not_insured', 'failed']) {
    await expect('POST', `/orders/${blockedOrder}/passengers/${blockedPassenger.id}/insurance/sandbox`, angler.token,
      status === 'failed'
        ? { status, failureReason: 'platform_supplier_fault', attemptKey: 'blocked-supplier-fault-1' }
        : { status });
    await expectDepartedInsuranceBlocked(
      blockedDeparture.id, captain.token, '没有保障已生效的乘客可登船',
      `${status} passenger cannot board`, [blockedPassenger.id],
      [{ id: blockedPassenger.id, status }],
    );
  }
  const forgedPassengerStatus = await request(
    'POST', `/captain/departures/${blockedDeparture.id}/checkin`, captain.token,
    { event: 'departed', passengerIds: [blockedPassenger.id], status: 'effective' },
  );
  check(forgedPassengerStatus.status, 409,
    'client-supplied insurance status cannot override the server verification');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [blockedDeparture.id])).status, 'confirmed',
    'forged passenger status leaves departure unchanged');
  await expect('POST', `/orders/${blockedOrder}/passengers/${blockedPassenger.id}/insurance/sandbox`, angler.token,
    { status: 'effective', attemptKey: 'blocked-effective-1' });
  await expect('POST', `/captain/departures/${blockedDeparture.id}/checkin`, captain.token,
    { event: 'departed', passengerIds: [blockedPassenger.id] });
  check((await scalar(
    `SELECT decision,coverage_status FROM departure_passenger_gate_decisions
     WHERE departure_id=$1 AND passenger_id=$2`, [blockedDeparture.id, blockedPassenger.id],
  )), { decision: 'allowed', coverage_status: 'effective' },
  'a later valid verification updates the blocked passenger to allowed before departure');

  const updateFirstDeparture = await makeConfirmedDeparture(captain.id, boatId);
  const updateFirstOrderOne = await makePaidOrder(angler.id, updateFirstDeparture.id, updateFirstDeparture.seat);
  const updateFirstSeatTwo = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'starboard','mid','booked') RETURNING id,seat_number,price_fen`,
    [updateFirstDeparture.id],
  )).rows[0];
  const updateFirstOrderTwo = await makePaidOrder(secondAngler.id, updateFirstDeparture.id, updateFirstSeatTwo);
  const updateFirstPassenger = await scalar(
    'SELECT id FROM order_passengers WHERE order_id=$1', [updateFirstOrderTwo],
  );
  const updateFirstPassengerIds = (await pool.query(
    `SELECT op.id FROM order_passengers op JOIN booking_orders o ON o.id=op.order_id
     WHERE o.departure_id=$1 AND o.status='paid' ORDER BY op.id`, [updateFirstDeparture.id],
  )).rows.map((row) => row.id);
  await expect('POST', `/captain/departures/${updateFirstDeparture.id}/required-insurance/sandbox`, captain.token,
    { status: 'effective' });
  await expect('POST', `/orders/${updateFirstOrderTwo}/passengers/${updateFirstPassenger.id}/insurance/sandbox`,
    secondAngler.token, { status: 'pending_verification' });
  const updateFirstLock = await holdDepartureRow(updateFirstDeparture.id);
  const insuranceUpdateFirst = request(
    'POST', `/orders/${updateFirstOrderTwo}/passengers/${updateFirstPassenger.id}/insurance/sandbox`,
    secondAngler.token, { status: 'effective', attemptKey: 'update-first-effective-1' },
  );
  check(await waitForLockedQuery('SELECT status FROM departures WHERE id=$1 FOR UPDATE'), true,
    'passenger insurance update waits behind the departure row lock');
  const departureAfterUpdateFirst = request(
    'POST', `/captain/departures/${updateFirstDeparture.id}/checkin`, captain.token,
    { event: 'departed', passengerIds: updateFirstPassengerIds },
  );
  check(await waitForLockedQuery('SELECT d.id,d.captain_user_id,d.status,d.departure_at'), true,
    'departure waits behind the queued passenger insurance update');
  await updateFirstLock.query('COMMIT');
  updateFirstLock.release();
  const [updatedFirst, departedAfterUpdate] = await Promise.all([
    insuranceUpdateFirst, departureAfterUpdateFirst,
  ]);
  check(updatedFirst.status, 200, 'coverage update commits first in the first race order');
  check(departedAfterUpdate.status, 200, 'departure reads the newly effective coverage');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_passenger_gate_decisions
     WHERE departure_id=$1 AND decision='allowed'`, [updateFirstDeparture.id],
  )).count, 2, 'first race order admits only rows that are effective at the departure check');

  const departureFirst = await makeConfirmedDeparture(captain.id, boatId);
  const departureFirstOrderOne = await makePaidOrder(angler.id, departureFirst.id, departureFirst.seat);
  const departureFirstSeatTwo = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'starboard','mid','booked') RETURNING id,seat_number,price_fen`,
    [departureFirst.id],
  )).rows[0];
  const departureFirstOrderTwo = await makePaidOrder(secondAngler.id, departureFirst.id, departureFirstSeatTwo);
  const departureFirstPassenger = await scalar(
    'SELECT id FROM order_passengers WHERE order_id=$1', [departureFirstOrderTwo],
  );
  const departureFirstPassengerIds = (await pool.query(
    `SELECT op.id FROM order_passengers op JOIN booking_orders o ON o.id=op.order_id
     WHERE o.departure_id=$1 AND o.status='paid' ORDER BY op.id`, [departureFirst.id],
  )).rows.map((row) => row.id);
  await expect('POST', `/captain/departures/${departureFirst.id}/required-insurance/sandbox`, captain.token,
    { status: 'effective' });
  await expect('POST', `/orders/${departureFirstOrderTwo}/passengers/${departureFirstPassenger.id}/insurance/sandbox`,
    secondAngler.token, { status: 'failed', failureReason: 'insurer_rejected', attemptKey: 'departure-first-rejected-1' });
  const departureFirstLock = await holdDepartureRow(departureFirst.id);
  const departedFirst = request(
    'POST', `/captain/departures/${departureFirst.id}/checkin`, captain.token,
    { event: 'departed', passengerIds: departureFirstPassengerIds },
  );
  check(await waitForLockedQuery('SELECT d.id,d.captain_user_id,d.status,d.departure_at'), true,
    'departure obtains the row lock before a later passenger verification update');
  const insuranceUpdateAfterDeparture = request(
    'POST', `/orders/${departureFirstOrderTwo}/passengers/${departureFirstPassenger.id}/insurance/sandbox`,
    secondAngler.token, { status: 'effective', attemptKey: 'departure-first-effective-after-departure' },
  );
  check(await waitForLockedQuery('SELECT status FROM departures WHERE id=$1 FOR UPDATE'), true,
    'later insurance update waits for the departure gate to finish');
  await departureFirstLock.query('COMMIT');
  departureFirstLock.release();
  const [departedBeforeUpdate, updatedAfterDeparture] = await Promise.all([
    departedFirst, insuranceUpdateAfterDeparture,
  ]);
  check(departedBeforeUpdate.status, 200, 'departure records the server-verified passenger decisions first');
  check(updatedAfterDeparture.status, 409, 'post-departure coverage update is rejected');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [departureFirst.id])).status, 'in_progress',
    'departure-first race finishes with the verified departure status');
  check((await scalar(
    `SELECT decision,coverage_status FROM departure_passenger_gate_decisions
     WHERE departure_id=$1 AND passenger_id=$2`, [departureFirst.id, departureFirstPassenger.id],
  )), { decision: 'blocked', coverage_status: 'failed' },
  'departure-first race preserves the blocked passenger decision');
  check((await scalar(
    'SELECT status FROM passenger_insurance_coverages WHERE passenger_id=$1', [departureFirstPassenger.id],
  )).status, 'failed', 'a queued verification update cannot alter the departed coverage snapshot');

  const cancelledOrderRace = await makeConfirmedDeparture(captain.id, boatId);
  const cancelledOrderRaceId = await makePaidOrder(angler.id, cancelledOrderRace.id, cancelledOrderRace.seat);
  const cancelledOrderRacePassenger = await scalar(
    'SELECT id FROM order_passengers WHERE order_id=$1', [cancelledOrderRaceId],
  );
  const cancelledOrderRaceLock = await holdDepartureRow(cancelledOrderRace.id);
  const staleInsuranceRequest = request(
    'POST', `/orders/${cancelledOrderRaceId}/passengers/${cancelledOrderRacePassenger.id}/insurance/sandbox`,
    angler.token, { status: 'failed', failureReason: 'data_error', attemptKey: 'cancelled-order-lock-race' },
  );
  let cancelledOrderRaceLockCommitted = false;
  try {
    check(await waitForLockedQuery('SELECT status FROM departures WHERE id=$1 FOR UPDATE'), true,
      'insurance verification blocks behind the departure cancellation lock');
    await cancelledOrderRaceLock.query("UPDATE departures SET status='cancelled' WHERE id=$1", [cancelledOrderRace.id]);
    await cancelledOrderRaceLock.query(
      "UPDATE booking_orders SET status='cancelled',ticket_refunded_fen=seat_fee_fen,"
        + "cancelled_refund_fen=total_amount_fen WHERE id=$1",
      [cancelledOrderRaceId],
    );
    await cancelledOrderRaceLock.query(
      "UPDATE booking_order_seats SET status='released' WHERE order_id=$1 AND status='paid'",
      [cancelledOrderRaceId],
    );
    await cancelledOrderRaceLock.query("UPDATE seat_inventory SET status='available' WHERE id=$1",
      [cancelledOrderRace.seat.id]);
    await cancelledOrderRaceLock.query('COMMIT');
    cancelledOrderRaceLockCommitted = true;
  } catch (error) {
    if (!cancelledOrderRaceLockCommitted) await cancelledOrderRaceLock.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cancelledOrderRaceLock.release();
  }
  const staleInsuranceResult = await staleInsuranceRequest;
  check(staleInsuranceResult.status, 409,
    'insurance verification rereads the cancelled order after the departure lock');
  check((await scalar('SELECT status FROM passenger_insurance_coverages WHERE passenger_id=$1',
    [cancelledOrderRacePassenger.id])).status, 'effective',
  'a stale insurance request cannot modify coverage after the order is cancelled');
  check((await scalar('SELECT count(*)::integer AS count FROM passenger_insurance_attempts WHERE order_id=$1',
    [cancelledOrderRaceId])).count, 0,
  'a stale insurance request cannot append an attempt after the order is cancelled');
  check((await scalar('SELECT count(*)::integer AS count FROM refund_obligations WHERE order_id=$1',
    [cancelledOrderRaceId])).count, 0,
  'the rejected stale insurance request creates no extra refund');

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
  await expectDepartedInsuranceBlocked(
    shiftedWindowDeparture.id, captain.token,
    '没有保障已生效的乘客可登船', 'old policy does not satisfy the current sailing window',
    [shiftedWindowGate.passengers[0].passengerId],
    [{ id: shiftedWindowGate.passengers[0].passengerId, status: 'not_insured' }],
  );

  const companionDeparture = await makeConfirmedDeparture(captain.id, boatId);
  await pool.query('UPDATE departures SET minimum_sailing_total_fen=4000 WHERE id=$1', [companionDeparture.id]);
  const companionSeat = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'starboard','mid','booked') RETURNING id,seat_number,price_fen`,
    [companionDeparture.id],
  )).rows[0];
  const companionOrder = await makeMultiPassengerPaidOrder(
    angler.id, companionDeparture.id, [companionDeparture.seat, companionSeat],
    [
      { name: '未成年钓友', identity: makeIdentityForBirthDate('20160801', '991') },
      { name: '同行钓友', identity: makeIdentityForBirthDate('19900101', '992') },
    ], 1000,
  );
  const missingAttemptKey = await request(
    'POST', `/orders/${companionOrder.orderId}/passengers/${companionOrder.passengerIds[0]}/insurance/sandbox`,
    angler.token, { status: 'failed', failureReason: 'insurer_rejected' },
  );
  check(missingAttemptKey.status, 400, 'a final insurance result requires an idempotency attempt key');
  check((await scalar('SELECT status FROM passenger_insurance_coverages WHERE passenger_id=$1',
    [companionOrder.passengerIds[0]])).status, 'effective',
  'missing attempt key leaves passenger coverage unchanged');
  check((await scalar('SELECT count(*)::integer AS count FROM passenger_insurance_attempts WHERE order_id=$1',
    [companionOrder.orderId])).count, 0, 'missing attempt key does not create an attempt record');
  const firstRejection = await expect(
    'POST', `/orders/${companionOrder.orderId}/passengers/${companionOrder.passengerIds[0]}/insurance/sandbox`,
    angler.token, { status: 'failed', failureReason: 'insurer_rejected', attemptKey: 'companion-rejection-1' },
  );
  check(firstRejection.insurance.consecutiveInsurerRejections, 1,
    'the first insurer rejection records the first consecutive attempt');
  check(firstRejection.insurance.seatCancelled, false, 'the first insurer rejection keeps the seat active');
  const secondRejection = await expect(
    'POST', `/orders/${companionOrder.orderId}/passengers/${companionOrder.passengerIds[0]}/insurance/sandbox`,
    angler.token, { status: 'failed', failureReason: 'insurer_rejected', attemptKey: 'companion-rejection-2' },
  );
  check(secondRejection.insurance.consecutiveInsurerRejections, 2,
    'the second insurer rejection records the two-attempt streak');
  const secondRejectionReplay = await expect(
    'POST', `/orders/${companionOrder.orderId}/passengers/${companionOrder.passengerIds[0]}/insurance/sandbox`,
    angler.token, { status: 'failed', failureReason: 'insurer_rejected', attemptKey: 'companion-rejection-2' },
  );
  check(secondRejectionReplay.insurance.idempotentReplay, true,
    'replaying an insurer response returns the saved attempt');
  check((await scalar('SELECT count(*)::integer AS count FROM passenger_insurance_attempts WHERE order_id=$1',
    [companionOrder.orderId])).count, 2, 'a replay cannot increment the attempt counter');
  const thirdRejection = await expect(
    'POST', `/orders/${companionOrder.orderId}/passengers/${companionOrder.passengerIds[0]}/insurance/sandbox`,
    angler.token, { status: 'failed', failureReason: 'insurer_rejected', attemptKey: 'companion-rejection-3' },
  );
  check(thirdRejection.insurance.consecutiveInsurerRejections, 3,
    'the third consecutive rejection is recorded');
  check(thirdRejection.insurance.seatCancelled, true, 'the third rejection cancels only the affected passenger seat');
  check(thirdRejection.insurance.ticketRefundFen, 4500,
    'the failed passenger receives their discounted ticket principal in full');
  check(thirdRejection.insurance.departureCancelled, false,
    'remaining paid ticket value keeps this trip above its formation threshold');
  check((await scalar('SELECT booking_status FROM order_passengers WHERE id=$1',
    [companionOrder.passengerIds[0]])).booking_status, 'insurance_rejected',
  'only the failed passenger leaves the order');
  check((await scalar('SELECT booking_status FROM order_passengers WHERE id=$1',
    [companionOrder.passengerIds[1]])).booking_status, 'active',
  'a general same-order companion remains booked');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1', [companionOrder.orderId])).status,
    'paid', 'a multi-passenger order stays paid while a companion remains');
  check((await scalar('SELECT seat_inventory_id FROM booking_orders WHERE id=$1',
    [companionOrder.orderId])).seat_inventory_id, companionSeat.id,
  'the active order pointer moves off the released passenger seat');
  check((await scalar('SELECT status FROM seat_inventory WHERE id=$1',
    [companionDeparture.seat.id])).status, 'available', 'the rejected passenger seat returns to inventory');
  check((await scalar('SELECT status FROM booking_order_seats WHERE order_id=$1 AND seat_inventory_id=$2',
    [companionOrder.orderId, companionDeparture.seat.id])).status, 'released',
  'the rejected seat is removed from the active order roster');
  const companionInsuranceStatus = await expect(
    'GET', `/orders/${companionOrder.orderId}/insurance/status`, angler.token,
  );
  const rejectedPassengerCoverage = companionInsuranceStatus.insurance.passengerCoverages
    .find((coverage) => coverage.bookingStatus === 'insurance_rejected');
  check(rejectedPassengerCoverage.attemptCount, 3,
    'the passenger insurance status endpoint exposes the recorded attempt count');
  check(rejectedPassengerCoverage.consecutiveInsurerRejections, 3,
    'the passenger insurance status endpoint exposes the rejection streak');
  check(rejectedPassengerCoverage.attempts.length, 3,
    'the passenger insurance status endpoint exposes the auditable sandbox outcomes');
  check((await scalar('SELECT amount_fen,reason,status FROM refund_obligations WHERE passenger_id=$1',
    [companionOrder.passengerIds[0]])),
  { amount_fen: 4500, reason: 'insurance_failure', status: 'pending' },
  'a full passenger-level sandbox refund obligation is recorded');
  const fourthRejection = await request(
    'POST', `/orders/${companionOrder.orderId}/passengers/${companionOrder.passengerIds[0]}/insurance/sandbox`,
    angler.token, { status: 'failed', failureReason: 'insurer_rejected', attemptKey: 'companion-rejection-4' },
  );
  check(fourthRejection.status, 409, 'a cancelled passenger cannot consume a fourth insurance attempt');
  check((await scalar('SELECT count(*)::integer AS count FROM passenger_insurance_attempts WHERE order_id=$1',
    [companionOrder.orderId])).count, 3, 'a fourth attempt is rejected without changing the attempt history');

  const guardianDeparture = await makeConfirmedDeparture(captain.id, boatId);
  await pool.query('UPDATE departures SET minimum_sailing_total_fen=8000 WHERE id=$1', [guardianDeparture.id]);
  const guardianSeat = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'starboard','mid','booked') RETURNING id,seat_number,price_fen`,
    [guardianDeparture.id],
  )).rows[0];
  const guardianThirdSeat = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,3,5000,'port','stern','booked') RETURNING id,seat_number,price_fen`,
    [guardianDeparture.id],
  )).rows[0];
  const guardianOrder = await makeMultiPassengerPaidOrder(
    secondAngler.id, guardianDeparture.id, [guardianDeparture.seat, guardianSeat, guardianThirdSeat],
    [
      { name: '未成年乘客', identity: makeIdentityForBirthDate('20160801', '993') },
      { name: '家长乘客', identity: makeIdentityForBirthDate('19850101', '994') },
      { name: '同行乘客', identity: makeIdentityForBirthDate('19870101', '995') },
    ],
  );
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await expect(
      'POST', `/orders/${guardianOrder.orderId}/passengers/${guardianOrder.passengerIds[0]}/insurance/sandbox`,
      secondAngler.token, {
        status: 'failed', failureReason: 'insurer_rejected', attemptKey: `guardian-child-rejection-${attempt}`,
      },
    );
  }
  check((await scalar('SELECT booking_status FROM order_passengers WHERE id=$1',
    [guardianOrder.passengerIds[1]])).booking_status, 'active',
  'the parent remains active until choosing the child exception');
  const unconfirmedGuardianExit = await request(
    'POST', `/orders/${guardianOrder.orderId}/passengers/${guardianOrder.passengerIds[0]}/insurance/guardian-exit/sandbox`,
    secondAngler.token, {
      guardianPassengerId: guardianOrder.passengerIds[1], requestKey: 'guardian-exit-confirmation-required',
      relationshipConfirmed: false,
    },
  );
  check(unconfirmedGuardianExit.status, 400, 'guardian relationship confirmation is required');
  check((await scalar('SELECT booking_status FROM order_passengers WHERE id=$1',
    [guardianOrder.passengerIds[1]])).booking_status, 'active',
  'a rejected guardian request leaves the parent seat unchanged');
  const guardianExit = await expect(
    'POST', `/orders/${guardianOrder.orderId}/passengers/${guardianOrder.passengerIds[0]}/insurance/guardian-exit/sandbox`,
    secondAngler.token, {
      guardianPassengerId: guardianOrder.passengerIds[1], requestKey: 'guardian-exit-approved',
      relationshipConfirmed: true,
    },
  );
  check(guardianExit.guardianExited, true, 'a same-order adult guardian may choose to exit with the child');
  check(guardianExit.ticketRefundFen, 5000, 'a guardian who chooses to exit receives the full ticket principal');
  check(guardianExit.departureCancelled, true,
    'removing the guardian after the child leaves drops the trip below its formation threshold');
  check((await scalar('SELECT booking_status FROM order_passengers WHERE id=$1',
    [guardianOrder.passengerIds[1]])).booking_status, 'guardian_exit',
  'the guardian opt-out is separately recorded');
  check((await scalar('SELECT booking_status FROM order_passengers WHERE id=$1',
    [guardianOrder.passengerIds[2]])).booking_status, 'departure_cancelled',
  'a remaining passenger is cancelled when the guardian exit takes the trip below threshold');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [guardianDeparture.id])).status,
    'cancelled', 'insurance-driven threshold failure cancels the departure');
  check((await scalar('SELECT ticket_refunded_fen,status FROM booking_orders WHERE id=$1',
    [guardianOrder.orderId])), { ticket_refunded_fen: 15000, status: 'cancelled' },
  'child, guardian, and remaining passenger ticket principals are each refunded once');
  const guardianReplay = await expect(
    'POST', `/orders/${guardianOrder.orderId}/passengers/${guardianOrder.passengerIds[0]}/insurance/guardian-exit/sandbox`,
    secondAngler.token, {
      guardianPassengerId: guardianOrder.passengerIds[1], requestKey: 'guardian-exit-approved',
      relationshipConfirmed: true,
    },
  );
  check(guardianReplay.idempotentReplay, true, 'guardian exit replay does not issue another refund');
  check(guardianReplay.ticketRefundFen, 5000, 'guardian exit replay returns its original refund amount');
  check(guardianReplay.departureCancelled, true, 'guardian exit replay returns its original departure outcome');
  check((await scalar('SELECT count(*)::integer AS count FROM refund_obligations WHERE order_id=$1',
    [guardianOrder.orderId])).count, 3, 'each of the three passengers has exactly one refund obligation');
  const conflictingGuardianReplay = await request(
    'POST', `/orders/${guardianOrder.orderId}/passengers/${guardianOrder.passengerIds[0]}/insurance/guardian-exit/sandbox`,
    secondAngler.token, {
      guardianPassengerId: guardianOrder.passengerIds[2], requestKey: 'guardian-exit-second-key',
      relationshipConfirmed: true,
    },
  );
  check(conflictingGuardianReplay.status, 409,
    'a new request key cannot create a second guardian decision for the same child');
  check((await scalar('SELECT count(*)::integer AS count FROM insurance_guardian_exit_decisions WHERE order_id=$1',
    [guardianOrder.orderId])).count, 1, 'a conflicting guardian choice does not add a decision');
  check((await scalar('SELECT count(*)::integer AS count FROM refund_obligations WHERE order_id=$1',
    [guardianOrder.orderId])).count, 3, 'a conflicting guardian choice creates no additional refund');

  const insuranceExitDeparture = await makeConfirmedDeparture(captain.id, boatId);
  await pool.query(
    "UPDATE departures SET status='open',minimum_sailing_total_fen=18000 WHERE id=$1",
    [insuranceExitDeparture.id],
  );
  const insuranceExitSeats = await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'starboard','mid','booked'),($1,3,5000,'port','stern','booked'),
       ($1,4,5000,'starboard','stern','booked'),($1,5,5000,'port','stern','booked')
     RETURNING id,seat_number,price_fen`, [insuranceExitDeparture.id],
  );
  const insuranceExitSeatsByNumber = [insuranceExitDeparture.seat, ...insuranceExitSeats.rows]
    .sort((left, right) => left.seat_number - right.seat_number);
  const insuranceExitAngler = await makeUser('保险失败后补差退出原订单');
  const insuranceExitOther = await makeUser('保险失败后补差退出其他订单');
  const insuranceExitRebooker = await makeUser('保险释放座位重新购买');
  const insuranceExitOrder = await makeMultiPassengerPaidOrder(
    insuranceExitAngler.id, insuranceExitDeparture.id, insuranceExitSeatsByNumber.slice(0, 3),
    [
      { name: '保障失败钓友', identity: makeIdentityForBirthDate('19900101', '996') },
      { name: '原订单同行一', identity: makeIdentityForBirthDate('19910101', '997') },
      { name: '原订单同行二', identity: makeIdentityForBirthDate('19920101', '998') },
    ],
  );
  const insuranceExitOtherOrder = await makeMultiPassengerPaidOrder(
    insuranceExitOther.id, insuranceExitDeparture.id, insuranceExitSeatsByNumber.slice(3),
    [
      { name: '另一订单乘客一', identity: makeIdentityForBirthDate('19930101', '999') },
      { name: '另一订单乘客二', identity: makeIdentityForBirthDate('19940101', '001') },
    ],
  );
  const insuranceExitAccountsClient = await pool.connect();
  let insuranceExitInitialAccounts;
  try {
    insuranceExitInitialAccounts = await loadFormationAccounts(insuranceExitAccountsClient, insuranceExitDeparture.id);
  } finally {
    insuranceExitAccountsClient.release();
  }
  check(insuranceExitInitialAccounts.platform.meetsThreshold, true,
    'the five booked seats initially cover the insurance-exit fixture threshold');
  let insuranceExitFailure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    insuranceExitFailure = await expect(
      'POST', `/orders/${insuranceExitOrder.orderId}/passengers/${insuranceExitOrder.passengerIds[0]}/insurance/sandbox`,
      insuranceExitAngler.token, {
        status: 'failed', failureReason: 'insurer_rejected', attemptKey: `g-seat-rejection-${attempt}`,
      },
    );
  }
  check(insuranceExitFailure.insurance.departureCancelled, false,
    'the original two remaining seats and the second order keep the trip at threshold after G');
  check((await scalar('SELECT status FROM booking_order_seats WHERE order_id=$1 AND seat_inventory_id=$2',
    [insuranceExitOrder.orderId, insuranceExitDeparture.seat.id])).status, 'released',
  'the G-rejected seat leaves the original order roster');
  check((await scalar('SELECT status FROM seat_inventory WHERE id=$1',
    [insuranceExitDeparture.seat.id])).status, 'available', 'the G-rejected seat is released for resale');
  const insuranceExitRebookedOrder = await makePaidOrder(
    insuranceExitRebooker.id, insuranceExitDeparture.id, insuranceExitDeparture.seat,
  );
  await pool.query("UPDATE seat_inventory SET status='booked' WHERE id=$1", [insuranceExitDeparture.seat.id]);
  await expect('POST', `/orders/${insuranceExitOtherOrder.orderId}/cancel`, insuranceExitOther.token, {});
  const insuranceExitDepartureAt = new Date((await scalar(
    'SELECT departure_at FROM departures WHERE id=$1', [insuranceExitDeparture.id],
  )).departure_at);
  const insuranceExitCloseout = new Date(
    formationConfirmationAt(insuranceExitDepartureAt).getTime() + 10 * 60 * 1000,
  );
  await pool.query('UPDATE departures SET waitlist_window_closed_at=$2 WHERE id=$1',
    [insuranceExitDeparture.id, insuranceExitCloseout]);
  const insuranceExitCheckpoint = await processFormationChecks(pool, insuranceExitCloseout);
  check(insuranceExitCheckpoint.checked > 0, true,
    'the other order cancellation creates a frozen shortfall after the cutoff');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [insuranceExitDeparture.id])).status,
    'handling_shortfall', 'the post-G cancellation shortfall can open one supplement round');
  const insuranceExitRound = await expect(
    'POST', `/captain/departures/${insuranceExitDeparture.id}/supplement-rounds`, captain.token,
    { responseDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, 201,
  );
  const insuranceExitOrderParticipant = insuranceExitRound.round.participants
    .find((participant) => participant.orderId === insuranceExitOrder.orderId);
  assert.ok(insuranceExitOrderParticipant, 'the partially refunded original order participates in supplement');
  const insuranceExitChoice = await expect(
    'POST', `/orders/${insuranceExitOrder.orderId}/supplement-rounds/${insuranceExitRound.round.id}/decision`,
    insuranceExitAngler.token, { action: 'reject' },
  );
  check(insuranceExitChoice.round.status, 'failed',
    'the original order can exit when it rejects the supplement round');
  check((await scalar('SELECT status,ticket_refunded_fen,cancelled_refund_fen FROM booking_orders WHERE id=$1',
    [insuranceExitOrder.orderId])), { status: 'cancelled', ticket_refunded_fen: 15000, cancelled_refund_fen: 15000 },
  'G partial refund plus supplement exit refunds the original three-seat order exactly once');
  check((await scalar(
    `SELECT COALESCE(SUM(amount_fen),0)::integer AS amount FROM refund_obligations
     WHERE order_id=$1 AND reason='customer_cancellation'`, [insuranceExitOrder.orderId],
  )).amount, 10000, 'supplement exit refunds only the two ticket principals still outstanding');
  check((await scalar('SELECT status FROM seat_inventory WHERE id=$1',
    [insuranceExitDeparture.seat.id])).status, 'booked',
  'supplement exit does not free the G-released seat after another order rebooks it');
  check((await scalar('SELECT status FROM booking_order_seats WHERE order_id=$1 AND seat_inventory_id=$2',
    [insuranceExitRebookedOrder, insuranceExitDeparture.seat.id])).status, 'paid',
  'the replacement order keeps the rebooked seat active');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1',
    [insuranceExitRebookedOrder])).status, 'paid', 'the replacement buyer remains booked after the original exits');

  const insuranceTimeoutDeparture = await makeConfirmedDeparture(captain.id, boatId);
  await pool.query(
    "UPDATE departures SET status='open',minimum_sailing_total_fen=13500 WHERE id=$1",
    [insuranceTimeoutDeparture.id],
  );
  const insuranceTimeoutSeats = await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'starboard','mid','booked'),($1,3,5000,'port','stern','booked'),
       ($1,4,5000,'starboard','stern','booked') RETURNING id,seat_number,price_fen`,
    [insuranceTimeoutDeparture.id],
  );
  const insuranceTimeoutSeatsByNumber = [insuranceTimeoutDeparture.seat, ...insuranceTimeoutSeats.rows]
    .sort((left, right) => left.seat_number - right.seat_number);
  const insuranceTimeoutAngler = await makeUser('保险部分退款后补差超时原订单');
  const insuranceTimeoutOther = await makeUser('保险部分退款后补差超时其他订单');
  const insuranceTimeoutRebooker = await makeUser('保险部分退款后补差超时重订人');
  const insuranceTimeoutOrder = await makeMultiPassengerPaidOrder(
    insuranceTimeoutAngler.id, insuranceTimeoutDeparture.id, insuranceTimeoutSeatsByNumber.slice(0, 2),
    [
      { name: '超时原订单保障失败', identity: makeIdentityForBirthDate('19900101', '002') },
      { name: '超时原订单同行', identity: makeIdentityForBirthDate('19910101', '003') },
    ],
  );
  const insuranceTimeoutOtherOrder = await makeMultiPassengerPaidOrder(
    insuranceTimeoutOther.id, insuranceTimeoutDeparture.id, insuranceTimeoutSeatsByNumber.slice(2),
    [
      { name: '超时其他订单乘客一', identity: makeIdentityForBirthDate('19920101', '004') },
      { name: '超时其他订单乘客二', identity: makeIdentityForBirthDate('19930101', '005') },
    ],
  );
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await expect(
      'POST', `/orders/${insuranceTimeoutOrder.orderId}/passengers/${insuranceTimeoutOrder.passengerIds[0]}/insurance/sandbox`,
      insuranceTimeoutAngler.token, {
        status: 'failed', failureReason: 'insurer_rejected', attemptKey: `g-timeout-seat-rejection-${attempt}`,
      },
    );
  }
  const insuranceTimeoutRebookedOrder = await makePaidOrder(
    insuranceTimeoutRebooker.id, insuranceTimeoutDeparture.id, insuranceTimeoutDeparture.seat,
  );
  await pool.query("UPDATE seat_inventory SET status='booked' WHERE id=$1", [insuranceTimeoutDeparture.seat.id]);
  await expect('POST', `/orders/${insuranceTimeoutOtherOrder.orderId}/cancel`, insuranceTimeoutOther.token, {});
  const insuranceTimeoutDepartureAt = new Date((await scalar(
    'SELECT departure_at FROM departures WHERE id=$1', [insuranceTimeoutDeparture.id],
  )).departure_at);
  const insuranceTimeoutCloseout = new Date(
    formationConfirmationAt(insuranceTimeoutDepartureAt).getTime() + 10 * 60 * 1000,
  );
  await pool.query('UPDATE departures SET waitlist_window_closed_at=$2 WHERE id=$1',
    [insuranceTimeoutDeparture.id, insuranceTimeoutCloseout]);
  await processFormationChecks(pool, insuranceTimeoutCloseout);
  const insuranceTimeoutRound = await expect(
    'POST', `/captain/departures/${insuranceTimeoutDeparture.id}/supplement-rounds`, captain.token,
    { responseDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, 201,
  );
  const insuranceTimeoutRebookerParticipant = insuranceTimeoutRound.round.participants
    .find((participant) => participant.orderId === insuranceTimeoutRebookedOrder);
  assert.ok(insuranceTimeoutRebookerParticipant, 'the replacement buyer participates in the timeout fixture');
  await expect(
    'POST', `/orders/${insuranceTimeoutRebookedOrder}/supplement-rounds/${insuranceTimeoutRound.round.id}/decision`,
    insuranceTimeoutRebooker.token, { action: 'accept' },
  );
  await pool.query("UPDATE departure_supplement_rounds SET response_deadline_at=now()-interval '1 second' WHERE id=$1",
    [insuranceTimeoutRound.round.id]);
  const insuranceTimeoutProcessed = await processSupplementDeadlines(pool, new Date());
  check(insuranceTimeoutProcessed.expired, 1,
    'supplement timeout exits only the pending original order in the insurance fixture');
  check((await scalar('SELECT consent_status FROM departure_supplement_participants WHERE round_id=$1 AND order_id=$2',
    [insuranceTimeoutRound.round.id, insuranceTimeoutOrder.orderId])).consent_status, 'timed_out',
  'the partially refunded original order is recorded as timed out');
  check((await scalar('SELECT status,ticket_refunded_fen,cancelled_refund_fen FROM booking_orders WHERE id=$1',
    [insuranceTimeoutOrder.orderId])), { status: 'cancelled', ticket_refunded_fen: 10000, cancelled_refund_fen: 10000 },
  'G partial refund plus supplement timeout refunds the two-seat order exactly once');
  check((await scalar(
    `SELECT COALESCE(SUM(amount_fen),0)::integer AS amount FROM refund_obligations
     WHERE order_id=$1 AND reason='customer_cancellation'`, [insuranceTimeoutOrder.orderId],
  )).amount, 5000, 'supplement timeout refunds only the remaining active ticket principal');
  check((await scalar('SELECT status FROM seat_inventory WHERE id=$1',
    [insuranceTimeoutDeparture.seat.id])).status, 'booked',
  'supplement timeout preserves a G-released seat after another order rebooks it');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1',
    [insuranceTimeoutRebookedOrder])).status, 'paid', 'the timeout fixture replacement buyer remains booked');

  const thresholdDeparture = await makeConfirmedDeparture(captain.id, boatId);
  await pool.query('UPDATE departures SET minimum_sailing_total_fen=8000 WHERE id=$1', [thresholdDeparture.id]);
  const thresholdSeatTwo = (await pool.query(
    `INSERT INTO seat_inventory (departure_id,seat_number,price_fen,seat_side,seat_section,status)
     VALUES ($1,2,5000,'starboard','mid','booked') RETURNING id,seat_number,price_fen`,
    [thresholdDeparture.id],
  )).rows[0];
  const thresholdOrderOne = await makePaidOrder(angler.id, thresholdDeparture.id, thresholdDeparture.seat);
  const thresholdOrderTwo = await makePaidOrder(secondAngler.id, thresholdDeparture.id, thresholdSeatTwo);
  check((await scalar(
    `SELECT SUM(ROUND((seat_fee_fen-discount_fen-ticket_refunded_fen)::numeric*0.9))::integer AS net
     FROM booking_orders WHERE departure_id=$1 AND status='paid'`, [thresholdDeparture.id],
  )).net, 9000, 'the trip is above threshold before an insurance seat is removed');
  const thresholdPassenger = await scalar('SELECT id FROM order_passengers WHERE order_id=$1', [thresholdOrderOne]);
  let thresholdFailure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    thresholdFailure = await expect(
      'POST', `/orders/${thresholdOrderOne}/passengers/${thresholdPassenger.id}/insurance/sandbox`,
      angler.token, {
        status: 'failed', failureReason: 'insurer_rejected', attemptKey: `threshold-rejection-${attempt}`,
      },
    );
  }
  check(thresholdFailure.insurance.departureCancelled, true,
    'falling below the monetary formation threshold cancels the trip');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [thresholdDeparture.id])).status,
    'cancelled', 'no remaining supplement or manual captain path keeps an underfunded trip open');
  check((await scalar('SELECT status,ticket_refunded_fen FROM booking_orders WHERE id=$1',
    [thresholdOrderOne])), { status: 'cancelled', ticket_refunded_fen: 5000 },
  'the rejected passenger receives their full ticket principal');
  check((await scalar('SELECT status,ticket_refunded_fen FROM booking_orders WHERE id=$1',
    [thresholdOrderTwo])), { status: 'cancelled', ticket_refunded_fen: 5000 },
  'all remaining passengers receive full ticket principal when the trip fails');
  check((await scalar('SELECT booking_status FROM order_passengers WHERE order_id=$1',
    [thresholdOrderTwo])).booking_status, 'departure_cancelled',
  'a remaining passenger is marked as refunded by trip cancellation');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM refund_obligations
     WHERE order_id=ANY($1::uuid[]) AND reason='insurance_failure'`,
    [[thresholdOrderOne, thresholdOrderTwo]],
  )).count, 2,
  'trip failure creates one passenger-scoped refund obligation per ticket');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_formation_adjustments WHERE departure_id=$1',
    [thresholdDeparture.id])).count, 0,
  'insurance failure adds no captain compensation or supplemental contribution');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_captain_formation_decisions WHERE departure_id=$1',
    [thresholdDeparture.id])).count, 0, 'insurance failure does not create captain compensation decisions');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_supplement_rounds WHERE departure_id=$1',
    [thresholdDeparture.id])).count, 0, 'insurance failure does not open a new supplemental collection round');
  await processSandboxRefundObligations(pool);
  check((await scalar(
    `SELECT count(*)::integer AS count FROM refund_obligations
     WHERE order_id=ANY($1::uuid[]) AND reason='insurance_failure' AND status='sandbox_succeeded'`,
    [[thresholdOrderOne, thresholdOrderTwo]],
  )).count, 2, 'sandbox refund obligations settle without invoking a real payment rail');

  await expect('POST', `/captain/departures/${departure.id}/required-insurance/sandbox`, captain.token,
    { status: 'effective' });
  const departurePassengerIds = (await pool.query(
    `SELECT op.id FROM order_passengers op JOIN booking_orders o ON o.id=op.order_id
     WHERE o.departure_id=$1 AND o.status='paid' ORDER BY op.id`, [departure.id],
  )).rows.map((row) => row.id);
  await expect('POST', '/captain/departures/' + departure.id + '/checkin', captain.token,
    { event: 'departed', passengerIds: departurePassengerIds });
  check((await scalar('SELECT status FROM departures WHERE id=$1', [departure.id])).status, 'in_progress',
    'departure check-in advances status');
  await expect('POST', '/captain/departures/' + departure.id + '/checkin', captain.token,
    { event: 'departed', passengerIds: departurePassengerIds }, 409);
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
  const departureIdentity = await scalar(
    `SELECT op.identity_number_ciphertext FROM order_passengers op
     JOIN booking_orders o ON o.id=op.order_id
     WHERE o.departure_id=$1 AND o.buyer_user_id=$2 ORDER BY o.created_at LIMIT 1`,
    [departure.id, angler.id],
  );
  check(full.body.includes(security.decrypt(departureIdentity.identity_number_ciphertext)), true,
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

  // Four approved cancellation bands: verify API amounts, same-departure pool,
  // refund obligation, seat release, captain view, and idempotent retry.
  const cancellationBandCases = [
    { label: '退改四档·72小时外', hours: 80, penaltyFen: 0, refundFen: 50000 },
    { label: '退改四档·30%档', hours: 48, penaltyFen: 15000, refundFen: 35000 },
    { label: '退改四档·60%档', hours: 12, penaltyFen: 30000, refundFen: 20000 },
    { label: '退改四档·6小时内', hours: 4, penaltyFen: 50000, refundFen: 0 },
  ];
  for (const band of cancellationBandCases) {
    const fixture = await makeOpenCancellationFixture(captain, quotaBoatId, band.label, band.hours);
    const cancellationPath = `/orders/${fixture.orderId}/cancel`;
    const cancellation = await expect('POST', cancellationPath, fixture.user.token, {});
    check(cancellation.penaltyFen, band.penaltyFen,
      `${band.label}: API computes the penalty in fen from the departure time`);
    check(cancellation.refundFen, band.refundFen,
      `${band.label}: API returns the remaining ticket amount in fen`);
    check(cancellation.refundStatus, band.refundFen > 0 ? 'sandbox_succeeded' : 'not_required',
      `${band.label}: sandbox refund state matches the amount due`);

    const order = await scalar(
      'SELECT status,cancelled_refund_fen,cancellation_penalty_fen FROM booking_orders WHERE id=$1',
      [fixture.orderId],
    );
    check(order.status, 'cancelled', `${band.label}: paid order is cancelled`);
    check(Number(order.cancelled_refund_fen), band.refundFen,
      `${band.label}: stored refund is fen-denominated`);
    check(Number(order.cancellation_penalty_fen), band.penaltyFen,
      `${band.label}: stored penalty is fen-denominated`);
    check((await scalar('SELECT status FROM seat_inventory WHERE id=$1', [fixture.seatId])).status,
      'available', `${band.label}: cancellation releases the booked seat`);

    const poolEntry = await scalar(
      `SELECT COALESCE(SUM(amount_fen),0)::bigint AS amount
       FROM departure_formation_adjustments
       WHERE departure_id=$1 AND adjustment_type='penalty_pool'
         AND source_reference=$2`,
      [fixture.departureId, `customer-cancel:${fixture.orderId}`],
    );
    check(Number(poolEntry.amount), band.penaltyFen,
      `${band.label}: the full penalty is recorded once in this departure's pool`);
    const captainAccounts = await expect(
      'GET', `/captain/departures/${fixture.departureId}/formation-accounts`, captain.token,
    );
    check(captainAccounts.accounts.platform.penaltyPoolFen, band.penaltyFen,
      `${band.label}: captain's formation ledger exposes the departure penalty pool`);

    const refund = await scalar(
      `SELECT amount_fen,reason,status FROM refund_obligations
       WHERE order_id=$1 AND reason='customer_cancellation'`,
      [fixture.orderId],
    );
    check(Number(refund?.amount_fen ?? 0), band.refundFen,
      `${band.label}: only the refundable amount creates a sandbox refund obligation`);
    if (refund) {
      check(refund.reason, 'customer_cancellation', `${band.label}: refund reason is customer cancellation`);
      check(refund.status, 'sandbox_succeeded', `${band.label}: refund obligation is sandbox-settled`);
    }

    const replay = await expect('POST', cancellationPath, fixture.user.token, {});
    check(replay.idempotentReplay, true, `${band.label}: cancellation retry is idempotent`);
    check(replay.penaltyFen, band.penaltyFen, `${band.label}: retry returns the stored penalty`);
    const poolAfterReplay = await scalar(
      `SELECT COALESCE(SUM(amount_fen),0)::bigint AS amount
       FROM departure_formation_adjustments
       WHERE departure_id=$1 AND adjustment_type='penalty_pool'`, [fixture.departureId],
    );
    check(Number(poolAfterReplay.amount), band.penaltyFen,
      `${band.label}: retry does not duplicate the penalty pool entry`);
  }

  const missedDeparture = await makeOpenCancellationFixture(
    captain, quotaBoatId, '已过出航时刻·不得退款', -1,
  );
  await expect('POST', `/orders/${missedDeparture.orderId}/cancel`, missedDeparture.user.token, {}, 409);
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1', [missedDeparture.orderId])).status,
    'paid', 'post-departure cancellation is rejected and does not mark a no-show order as refunded');
  check(Number((await scalar(
    'SELECT COALESCE(cancelled_refund_fen,0) AS amount FROM booking_orders WHERE id=$1',
    [missedDeparture.orderId],
  )).amount), 0, 'post-departure cancellation creates no refund amount');
  check(Number((await scalar(
    `SELECT COALESCE(SUM(amount_fen),0)::bigint AS amount FROM refund_obligations
     WHERE order_id=$1 AND reason='customer_cancellation'`, [missedDeparture.orderId],
  )).amount), 0, 'post-departure cancellation creates no refund obligation');
  check(Number((await scalar(
    `SELECT COALESCE(SUM(amount_fen),0)::bigint AS amount FROM departure_formation_adjustments
     WHERE departure_id=$1 AND adjustment_type='penalty_pool'`, [missedDeparture.departureId],
  )).amount), 0, 'post-departure cancellation creates no penalty-pool entry');

  // A paid participant may still cancel after either confirmation route. Keep the
  // confirmed roster snapshot as historical evidence and never reopen F01 inventory.
  const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [year, month, day] = shanghaiDate.split('-').map(Number);
  // Tomorrow at 06:00 CST is safely after today's 18:00 confirmation cutoff.
  const cancellationNow = new Date(Date.UTC(year, month - 1, day, 22, 0, 0));
  simulatedStep3Time = cancellationNow;
  try {
    for (const postConfirmation of [
      { status: 'confirmed', hours: 12, penaltyFen: 30000, refundFen: 20000 },
      { status: 'captain_confirmed', hours: 4, penaltyFen: 50000, refundFen: 0 },
    ]) {
      const fixture = await makeConfirmedCancellationFixture(
        captain, quotaBoatId, `确认后退改-${postConfirmation.status}`,
        cancellationNow, postConfirmation.hours, postConfirmation.status,
      );
      check(fixture.confirmationAt <= cancellationNow, true,
        `${postConfirmation.status}: cancellation fixture is at or after the confirmation cutoff`);
      check(cancellationNow < fixture.departureAt, true,
        `${postConfirmation.status}: cancellation fixture remains before departure`);
      const frozenSnapshot = await scalar(
        'SELECT * FROM departure_formation_snapshots WHERE departure_id=$1', [fixture.departureId],
      );
      const cancellation = await expect('POST', `/orders/${fixture.orderId}/cancel`, fixture.user.token, {});
      check(cancellation.penaltyFen, postConfirmation.penaltyFen,
        `${postConfirmation.status}: post-confirmation cancellation keeps the approved time-tier penalty`);
      check(cancellation.refundFen, postConfirmation.refundFen,
        `${postConfirmation.status}: post-confirmation cancellation keeps the approved time-tier refund`);
      check(cancellation.waitlistEligible, false,
        `${postConfirmation.status}: cancellation after the cutoff does not reopen waitlist inventory`);
      check(cancellation.waitlistAuthorizations, [],
        `${postConfirmation.status}: cancellation sends no post-cutoff waitlist authorization`);
      check((await scalar('SELECT status FROM departures WHERE id=$1', [fixture.departureId])).status,
        postConfirmation.status, `${postConfirmation.status}: one participant leaving does not rewrite departure state`);
      check((await scalar('SELECT status FROM booking_orders WHERE id=$1', [fixture.remainingOrderId])).status,
        'paid', `${postConfirmation.status}: the other paid participant remains on the confirmed departure`);
      check((await scalar('SELECT status,waitlist_released_at FROM seat_inventory WHERE id=$1', [fixture.seatId])).status,
        'available', `${postConfirmation.status}: cancelled seat is released from the platform quota`);
      check((await scalar('SELECT waitlist_released_at FROM seat_inventory WHERE id=$1', [fixture.seatId])).waitlist_released_at,
        null, `${postConfirmation.status}: released seat receives no waitlist window marker`);
      const liveAccounts = await expect(
        'GET', `/captain/departures/${fixture.departureId}/formation-accounts`, captain.token,
      );
      check(liveAccounts.accounts.platform.ticketNetFen, 45000,
        `${postConfirmation.status}: current ticket ledger reflects the remaining paid order`);
      check(liveAccounts.accounts.platform.penaltyPoolFen, postConfirmation.penaltyFen,
        `${postConfirmation.status}: penalty enters the live ledger once`);
      check(await scalar('SELECT * FROM departure_formation_snapshots WHERE departure_id=$1', [fixture.departureId]),
        frozenSnapshot, `${postConfirmation.status}: cancellation preserves the historical confirmation snapshot`);
      if (postConfirmation.status === 'captain_confirmed') {
        check((await scalar(
          'SELECT count(*)::integer AS count FROM departure_captain_formation_decisions WHERE departure_id=$1',
          [fixture.departureId],
        )).count, 1, 'captain-confirmed cancellation preserves the original captain decision');
      }
      const replay = await expect('POST', `/orders/${fixture.orderId}/cancel`, fixture.user.token, {});
      check(replay.idempotentReplay, true,
        `${postConfirmation.status}: post-confirmation cancellation retry remains idempotent`);
      check((await scalar(
        `SELECT COALESCE(SUM(amount_fen),0)::bigint AS amount FROM departure_formation_adjustments
         WHERE departure_id=$1 AND adjustment_type='penalty_pool'`, [fixture.departureId],
      )).amount, String(postConfirmation.penaltyFen),
      `${postConfirmation.status}: retry does not duplicate the penalty-pool entry`);
    }
  } finally {
    simulatedStep3Time = null;
  }

  // Founder-approved amount example, exercised through cancellation, waitlist,
  // order, sandbox payment, formation closeout, and the one supplement round.
  const exampleDepartureId = (await pool.query(
    `INSERT INTO departures
       (boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,'pro_fishing',now()+interval '30 hours',now()+interval '29 hours 30 minutes',
        now()+interval '37 hours','qd_coast','xiaogang',500000,50000,now()+interval '29 hours','open',12,12,0,false)
     RETURNING id`, [quotaBoatId, captain.id],
  )).rows[0].id;
  const exampleSeats = await pool.query(
    `INSERT INTO seat_inventory
       (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     SELECT $1,n,50000,'port','mid','booked','platform' FROM generate_series(1,12) AS n
     RETURNING id,seat_number,price_fen`, [exampleDepartureId],
  );
  const examplePassengers = [];
  for (let index = 0; index < 12; index += 1) {
    const passenger = await makeUser(`算例钓友${index + 1}`);
    const orderId = await makePaidOrder(passenger.id, exampleDepartureId, exampleSeats.rows[index]);
    examplePassengers.push({ ...passenger, orderId });
  }
  const replacement = await makeUser('算例候补');
  const waitlistRegistration = await expect('POST', `/departures/${exampleDepartureId}/waitlist`, replacement.token,
    { requestKey: 'founder-example-waitlist-20261025' }, 201);
  check(waitlistRegistration.entry.status, 'waiting', 'founder example enters waitlist through the API');

  const cancelledPassengers = examplePassengers.slice(0, 4);
  for (const passenger of cancelledPassengers) {
    const cancellation = await expect('POST', `/orders/${passenger.orderId}/cancel`, passenger.token, {});
    check(cancellation.penaltyFen, 15000, 'a cancellation inside the approved 30 percent band adds ¥150');
    check(cancellation.refundFen, 35000, 'a cancellation inside the approved 30 percent band refunds ¥350');
  }
  check((await scalar(
    `SELECT COALESCE(SUM(amount_fen),0)::bigint AS amount FROM departure_formation_adjustments
     WHERE departure_id=$1 AND adjustment_type='penalty_pool'`, [exampleDepartureId],
  )).amount, '60000', 'four cancellations add ¥600 to the departure penalty pool');
  const authorizedWaitlist = await expect('GET', `/waitlist/${waitlistRegistration.entry.id}`, replacement.token);
  check(authorizedWaitlist.entry.status, 'authorized', 'released platform seat is authorized to the queued candidate');
  check(authorizedWaitlist.entry.seatId !== null, true, 'waitlist authorization identifies the released platform seat');
  await expect('POST', `/waitlist/${authorizedWaitlist.entry.id}/accept`, replacement.token, {});
  const replacementOrder = await expect('POST', '/orders', replacement.token, {
    holdId: authorizedWaitlist.entry.holdId,
    idempotencyKey: 'founder-example-waitlist-order-20261025',
    passengers: [{
      seatId: authorizedWaitlist.entry.seatId,
      fullName: '算例候补',
      identityNumber: makeSandboxIdentityNumber(String(sequence + 1).padStart(3, '0')),
      phone: '13900009999',
    }],
  }, 201);
  const replacementIntent = await expect('POST', `/orders/${replacementOrder.order.id}/payment-intents`, replacement.token, {}, 201);
  check(replacementIntent.payment.amountFen, 50000, 'replacement seat ticket is charged at ¥500');
  await expect('POST', `/orders/${replacementOrder.order.id}/sandbox-payment`, replacement.token, { outcome: 'success' });
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1', [replacementOrder.order.id])).status,
    'paid', 'replacement payment settles through the sandbox callback');

  const exampleDeparture = await scalar('SELECT departure_at FROM departures WHERE id=$1', [exampleDepartureId]);
  const exampleConfirmationAt = formationConfirmationAt(exampleDeparture.departure_at);
  const exampleCloseout = await processFormationChecksAt(
    new Date(exampleConfirmationAt.getTime() + 10 * 60 * 1000));
  check(exampleCloseout.checked >= 1, true, 'the founder example reaches the 18:10 formation closeout');
  const exampleSnapshot = await scalar('SELECT * FROM departure_formation_snapshots WHERE departure_id=$1', [exampleDepartureId]);
  check(Number(exampleSnapshot.platform_ticket_net_fen), 405000, 'nine paid seats produce ¥4,050 platform ticket net');
  check(Number(exampleSnapshot.penalty_pool_fen), 60000, 'the frozen penalty pool is ¥600');
  check(Number(exampleSnapshot.platform_verifiable_fen), 465000, '¥4,050 net plus ¥600 pool equals ¥4,650');
  check(exampleSnapshot.outcome, 'shortfall', '¥4,650 remains below the ¥5,000 sailing threshold');

  const supplementDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const exampleRoundResponse = await expect('POST', `/captain/departures/${exampleDepartureId}/supplement-rounds`,
    captain.token, { responseDeadlineAt: supplementDeadline }, 201);
  const exampleRound = exampleRoundResponse.round;
  check(exampleRound.shortfallFen, 35000, 'one round quotes the exact ¥350 shortfall');
  check(exampleRound.participants.length, 9, 'all nine paid seats are included in the frozen round');
  check(exampleRound.participants.reduce((sum, participant) => sum + participant.amountFen, 0), 35000,
    'per-seat quotes sum to ¥350 without commission');
  const tokenByOrder = new Map([
    ...examplePassengers.filter((passenger) => !cancelledPassengers.includes(passenger))
      .map((passenger) => [passenger.orderId, passenger.token]),
    [replacementOrder.order.id, replacement.token],
  ]);
  for (const participant of exampleRound.participants) {
    await expect('POST', `/orders/${participant.orderId}/supplement-rounds/${exampleRound.id}/decision`,
      tokenByOrder.get(participant.orderId), { action: 'accept' });
  }
  check((await scalar('SELECT status FROM departure_supplement_rounds WHERE id=$1', [exampleRound.id])).status,
    'collecting_payment', 'supplement collection begins only after every participant consents');
  for (const participant of exampleRound.participants) {
    const intent = await expect('POST',
      `/orders/${participant.orderId}/supplement-rounds/${exampleRound.id}/payment-intents`,
      tokenByOrder.get(participant.orderId), {}, 201);
    await expect('POST',
      `/orders/${participant.orderId}/supplement-rounds/${exampleRound.id}/sandbox-payment`,
      tokenByOrder.get(participant.orderId), { outcome: 'success' });
    check(intent.payment.amountFen >= 0, true, 'supplement amount is a non-negative integer number of fen');
  }
  const finalExampleAccounts = await expect('GET',
    `/captain/departures/${exampleDepartureId}/formation-accounts`, captain.token);
  check(finalExampleAccounts.accounts.platform.ticketNetFen, 405000, 'final platform ledger retains ¥4,050 ticket net');
  check(finalExampleAccounts.accounts.platform.penaltyPoolFen, 60000, 'final platform ledger retains the ¥600 penalty pool');
  check(finalExampleAccounts.accounts.platform.successfulSupplementFen, 35000, 'all accepted payments add exactly ¥350');
  check(finalExampleAccounts.accounts.platform.verifiableTotalFen, 500000, 'verified platform receipts reach the ¥5,000 threshold');
  check(finalExampleAccounts.accounts.departureStatus, 'confirmed', 'the server confirms departure after full payment and snapshot recheck');
  check((await scalar('SELECT status FROM departure_supplement_rounds WHERE id=$1', [exampleRound.id])).status,
    'succeeded', 'one full-consent, full-payment round succeeds');

  const refusal = await makeSupplementFixture(captain, quotaBoatId, '补差拒绝用例');
  const refusalChoice = await expect('POST',
    `/orders/${refusal.orderId}/supplement-rounds/${refusal.round.id}/decision`, refusal.user.token,
    { action: 'reject' });
  check(refusalChoice.round.status, 'failed', 'one refusal immediately fails the entire round');
  const refusalOrder = await scalar(
    'SELECT status,cancelled_refund_fen,cancellation_penalty_fen FROM booking_orders WHERE id=$1',
    [refusal.orderId],
  );
  check(refusalOrder.status, 'cancelled', 'a refusing passenger exits the order');
  check(Number(refusalOrder.cancelled_refund_fen), 50000, 'refusal exits with a full ticket refund');
  check(Number(refusalOrder.cancellation_penalty_fen), 0, 'refusal incurs no cancellation penalty');
  check((await scalar(
    `SELECT amount_fen FROM refund_obligations WHERE order_id=$1 AND reason='customer_cancellation'`,
    [refusal.orderId],
  )).amount_fen, 50000, 'refusal records a full refund obligation');
  check((await scalar('SELECT status FROM seat_inventory WHERE departure_id=$1', [refusal.departureId])).status,
    'available', 'refusal releases the passenger seat');
  await expect('POST', `/captain/departures/${refusal.departureId}/supplement-rounds`, captain.token,
    { responseDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, 409);
  await processSandboxRefundObligations(pool);

  const multiRefusal = await makeMultiSupplementFixture(captain, quotaBoatId, '多人补差拒绝退出');
  const firstRefusal = multiRefusal.round.participants[0];
  const remainingRefusal = multiRefusal.round.participants[1];
  const firstRefusalResult = await expect('POST',
    `/orders/${firstRefusal.orderId}/supplement-rounds/${multiRefusal.round.id}/decision`,
    multiRefusal.user.token, { action: 'reject' });
  check(firstRefusalResult.round.status, 'failed', 'first refusal invalidates the entire multi-order round');
  const remainingExit = await expect('POST',
    `/orders/${remainingRefusal.orderId}/supplement-rounds/${multiRefusal.round.id}/decision`,
    multiRefusal.user.token, { action: 'reject' });
  check(remainingExit.round.exitRefundRequested, true,
    'another participant can explicitly exit and request a full refund after round failure');
  const remainingExitReplay = await expect('POST',
    `/orders/${remainingRefusal.orderId}/supplement-rounds/${multiRefusal.round.id}/decision`,
    multiRefusal.user.token, { action: 'reject' });
  check(remainingExitReplay.round.idempotentReplay, true,
    'repeating the post-failure exit request is idempotent');
  const multiRefunds = await pool.query(
    `SELECT o.id,o.status,o.cancelled_refund_fen,o.cancellation_penalty_fen,r.amount_fen,r.status AS refund_status
     FROM booking_orders o JOIN refund_obligations r ON r.order_id=o.id
       AND r.request_key='supplement-exit:'||o.id
     WHERE o.id=ANY($1::uuid[]) ORDER BY o.id`, [multiRefusal.orders],
  );
  check(multiRefunds.rowCount, 2, 'both participants receive a distinct full-refund obligation');
  check(multiRefunds.rows.every((row) => row.status === 'cancelled'), true,
    'both original orders are cancelled after each participant exits');
  check(multiRefunds.rows.every((row) => Number(row.cancelled_refund_fen) === 50000
    && Number(row.cancellation_penalty_fen) === 0 && Number(row.amount_fen) === 50000), true,
  'both participants receive full ticket refunds without a cancellation penalty');
  check((await scalar('SELECT status FROM departure_supplement_rounds WHERE id=$1',
    [multiRefusal.round.id])).status, 'failed', 'post-failure exits do not create another supplement round');

  const failedPayment = await makeSupplementFixture(captain, quotaBoatId, '补差付款失败用例');
  await expect('POST',
    `/orders/${failedPayment.orderId}/supplement-rounds/${failedPayment.round.id}/decision`,
    failedPayment.user.token, { action: 'accept' });
  const failedIntent = await expect('POST',
    `/orders/${failedPayment.orderId}/supplement-rounds/${failedPayment.round.id}/payment-intents`,
    failedPayment.user.token, {}, 201);
  await expect('POST',
    `/orders/${failedPayment.orderId}/supplement-rounds/${failedPayment.round.id}/sandbox-payment`,
    failedPayment.user.token, { outcome: 'failure' });
  check((await scalar('SELECT status FROM departure_supplement_rounds WHERE id=$1',
    [failedPayment.round.id])).status, 'failed', 'one failed payment invalidates the full round');
  check((await scalar('SELECT status FROM payment_transactions WHERE provider_reference=$1',
    [failedIntent.payment.reference])).status, 'failed', 'failed supplement payment is recorded once');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_formation_adjustments
     WHERE departure_id=$1 AND adjustment_type='successful_supplement'`, [failedPayment.departureId],
  )).count, 0, 'failed payment is excluded from formation funds');

  const paymentAdapter = createSandboxPaymentAdapter(testConfig);
  const failedLateSuccess = await makeSupplementFixture(captain, quotaBoatId, '失败后迟到成功');
  await expect('POST',
    `/orders/${failedLateSuccess.orderId}/supplement-rounds/${failedLateSuccess.round.id}/decision`,
    failedLateSuccess.user.token, { action: 'accept' });
  const failedLateIntent = await expect('POST',
    `/orders/${failedLateSuccess.orderId}/supplement-rounds/${failedLateSuccess.round.id}/payment-intents`,
    failedLateSuccess.user.token, {}, 201);
  await expect('POST',
    `/orders/${failedLateSuccess.orderId}/supplement-rounds/${failedLateSuccess.round.id}/sandbox-payment`,
    failedLateSuccess.user.token, { outcome: 'failure' });
  const failedThenSuccessEvent = paymentAdapter.buildCallback({
    transactionReference: failedLateIntent.payment.reference,
    orderId: failedLateSuccess.round.participants[0].id,
    amountFen: failedLateIntent.payment.amountFen,
    outcome: 'success',
  }).event;
  const failedThenSuccess = await signedPaymentCallback(failedThenSuccessEvent);
  check(failedThenSuccess.status, 200, 'failed supplement payment can record a later provider success');
  check(failedThenSuccess.body.latePaymentRefundRequired, true,
    'failed-round late success creates a refund obligation without reviving the round');
  check((await scalar('SELECT status FROM departure_supplement_rounds WHERE id=$1',
    [failedLateSuccess.round.id])).status, 'failed', 'late success does not reopen a failed round');
  check((await scalar('SELECT status FROM payment_transactions WHERE provider_reference=$1',
    [failedLateIntent.payment.reference])).status, 'succeeded', 'late success is recorded as received money');
  check((await scalar('SELECT late_success FROM payment_transactions WHERE provider_reference=$1',
    [failedLateIntent.payment.reference])).late_success, true, 'late failure recovery is audit-marked');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_formation_adjustments
     WHERE departure_id=$1 AND adjustment_type='successful_supplement'`, [failedLateSuccess.departureId],
  )).count, 0, 'failed-round late success never enters the formation ledger');
  const repeatedFailedLateSuccess = await signedPaymentCallback(paymentAdapter.buildCallback({
    transactionReference: failedLateIntent.payment.reference,
    orderId: failedLateSuccess.round.participants[0].id,
    amountFen: failedLateIntent.payment.amountFen,
    outcome: 'success',
  }).event);
  check(repeatedFailedLateSuccess.status, 200, 'a second success notification remains safe');
  check(repeatedFailedLateSuccess.body.duplicate, true,
    'a repeated success with a new event id does not settle twice');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM refund_obligations r
     JOIN payment_transactions t ON t.id=r.payment_transaction_id
     WHERE t.provider_reference=$1 AND r.reason='supplement_failure'`,
    [failedLateIntent.payment.reference],
  )).count, 1, 'failed-round late success creates exactly one refund obligation');
  await processSandboxRefundObligations(pool, 3, async () => false);
  await processSandboxRefundObligations(pool, 3, async () => false);
  await processSandboxRefundObligations(pool, 3, async () => false);
  check((await scalar(
    `SELECT status FROM refund_obligations WHERE payment_transaction_id=(
       SELECT id FROM payment_transactions WHERE provider_reference=$1
     ) AND reason='supplement_failure'`, [failedLateIntent.payment.reference],
  )).status, 'manual_required', 'failed-round late-success refund exhausts retries to manual review');

  const retryAfterSuccess = await makeMultiSupplementFixture(captain, quotaBoatId, '成功后补差重试');
  for (const participant of retryAfterSuccess.round.participants) {
    await expect('POST',
      `/orders/${participant.orderId}/supplement-rounds/${retryAfterSuccess.round.id}/decision`,
      retryAfterSuccess.user.token, { action: 'accept' });
  }
  const firstParticipant = retryAfterSuccess.round.participants[0];
  const succeededIntent = await expect('POST',
    `/orders/${firstParticipant.orderId}/supplement-rounds/${retryAfterSuccess.round.id}/payment-intents`,
    retryAfterSuccess.user.token, {}, 201);
  await expect('POST',
    `/orders/${firstParticipant.orderId}/supplement-rounds/${retryAfterSuccess.round.id}/sandbox-payment`,
    retryAfterSuccess.user.token, { outcome: 'success' });
  check((await scalar('SELECT status FROM departure_supplement_rounds WHERE id=$1',
    [retryAfterSuccess.round.id])).status, 'collecting_payment',
  'one successful payer does not complete a multi-order round while another order is unpaid');
  const retriedSucceededIntent = await expect('POST',
    `/orders/${firstParticipant.orderId}/supplement-rounds/${retryAfterSuccess.round.id}/payment-intents`,
    retryAfterSuccess.user.token, {}, 200);
  check(retriedSucceededIntent.payment.id, succeededIntent.payment.id,
    'refreshing a succeeded supplement payment returns the existing result');
  check(retriedSucceededIntent.payment.status, 'succeeded',
    'retry after success exposes the settled payment state');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM payment_transactions WHERE supplement_participant_id=$1`,
    [firstParticipant.id],
  )).count, 1, 'retry after success does not create another payment transaction');

  const latePayment = await makeSupplementFixture(captain, quotaBoatId, '补差迟到回调用例');
  await expect('POST',
    `/orders/${latePayment.orderId}/supplement-rounds/${latePayment.round.id}/decision`,
    latePayment.user.token, { action: 'accept' });
  const lateIntent = await expect('POST',
    `/orders/${latePayment.orderId}/supplement-rounds/${latePayment.round.id}/payment-intents`,
    latePayment.user.token, {}, 201);
  await expect('POST',
    `/orders/${latePayment.orderId}/supplement-rounds/${latePayment.round.id}/sandbox-payment`,
    latePayment.user.token, { outcome: 'timeout' });
  const lateEvent = paymentAdapter.buildCallback({
    transactionReference: lateIntent.payment.reference,
    orderId: lateIntent.payment.participantId ?? latePayment.round.participants[0].id,
    amountFen: lateIntent.payment.amountFen,
    outcome: 'success',
  }).event;
  const lateResult = await signedPaymentCallback(lateEvent);
  check(lateResult.status, 200, 'late success callback is accepted for accounting');
  check(lateResult.body.latePaymentRefundRequired, true, 'late success creates an immediate refund obligation');
  check(lateResult.body.includedInFormation, false, 'late success is excluded from formation funds');
  check((await scalar('SELECT late_success FROM payment_transactions WHERE provider_reference=$1',
    [lateIntent.payment.reference])).late_success, true, 'late callback is marked for audit');
  check((await scalar(
    `SELECT status FROM refund_obligations WHERE payment_transaction_id=(
       SELECT id FROM payment_transactions WHERE provider_reference=$1
     ) AND reason='supplement_failure'`, [lateIntent.payment.reference],
  )).status, 'pending', 'late supplement payment is not labelled refunded before settlement');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_formation_adjustments
     WHERE departure_id=$1 AND adjustment_type='successful_supplement'`, [latePayment.departureId],
  )).count, 0, 'late supplement payment never enters the formation ledger');
  await processSandboxRefundObligations(pool, 3, async () => false);
  await processSandboxRefundObligations(pool, 3, async () => false);
  await processSandboxRefundObligations(pool, 3, async () => false);
  check((await scalar(
    `SELECT status FROM refund_obligations WHERE payment_transaction_id=(
       SELECT id FROM payment_transactions WHERE provider_reference=$1
     ) AND reason='supplement_failure'`, [lateIntent.payment.reference],
  )).status, 'manual_required', 'refund retry exhaustion remains an unpaid manual obligation');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM admin_manual_review_events e
     JOIN refund_obligations r ON r.id=e.refund_obligation_id
     JOIN payment_transactions t ON t.id=r.payment_transaction_id
     WHERE t.provider_reference=$1`, [lateIntent.payment.reference],
  )).count, 1, 'refund retry exhaustion creates one manual review event');

  const duplicateCallback = await makeSupplementFixture(captain, quotaBoatId, '补差重复回调用例');
  await expect('POST',
    `/orders/${duplicateCallback.orderId}/supplement-rounds/${duplicateCallback.round.id}/decision`,
    duplicateCallback.user.token, { action: 'accept' });
  const duplicateIntent = await expect('POST',
    `/orders/${duplicateCallback.orderId}/supplement-rounds/${duplicateCallback.round.id}/payment-intents`,
    duplicateCallback.user.token, {}, 201);
  const duplicateEvent = paymentAdapter.buildCallback({
    transactionReference: duplicateIntent.payment.reference,
    orderId: duplicateCallback.round.participants[0].id,
    amountFen: duplicateIntent.payment.amountFen,
    outcome: 'success',
  }).event;
  check((await signedPaymentCallback(duplicateEvent)).status, 200, 'first signed payment callback is accepted');
  const duplicateResult = await signedPaymentCallback(duplicateEvent);
  check(duplicateResult.body.duplicate, true, 'replayed callback is identified as a duplicate');
  check((await scalar('SELECT count(*)::integer AS count FROM payment_transactions WHERE provider_reference=$1',
    [duplicateIntent.payment.reference])).count, 1, 'duplicate callback leaves one payment transaction');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_formation_adjustments
     WHERE source_reference=$1`, [`supplement-round:${duplicateCallback.round.id}`],
  )).count, 1, 'duplicate callback adds the supplement ledger once');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [duplicateCallback.departureId])).status,
    'confirmed', 'all successful supplement funds pass server formation recheck');

  const successfulSupplementInsuranceFailure = await makeMultiSupplementFixture(
    captain, quotaBoatId, '成功补差后保险整班失败', { participantCount: 2, shortfallFen: 5000 },
  );
  for (const participant of successfulSupplementInsuranceFailure.round.participants) {
    await expect(
      'POST', `/orders/${participant.orderId}/supplement-rounds/${successfulSupplementInsuranceFailure.round.id}/decision`,
      successfulSupplementInsuranceFailure.user.token, { action: 'accept' },
    );
  }
  for (const participant of successfulSupplementInsuranceFailure.round.participants) {
    await expect(
      'POST', `/orders/${participant.orderId}/supplement-rounds/${successfulSupplementInsuranceFailure.round.id}/payment-intents`,
      successfulSupplementInsuranceFailure.user.token, {}, 201,
    );
    await expect(
      'POST', `/orders/${participant.orderId}/supplement-rounds/${successfulSupplementInsuranceFailure.round.id}/sandbox-payment`,
      successfulSupplementInsuranceFailure.user.token, { outcome: 'success' },
    );
  }
  check((await scalar('SELECT status FROM departure_supplement_rounds WHERE id=$1',
    [successfulSupplementInsuranceFailure.round.id])).status, 'succeeded',
  'all accepted supplement funds first enter the successful formation ledger');
  const successfulSupplementBeforeInsurance = await expect(
    'GET', `/captain/departures/${successfulSupplementInsuranceFailure.departureId}/formation-accounts`, captain.token,
  );
  check(successfulSupplementBeforeInsurance.accounts.platform.successfulSupplementFen, 5000,
    'the formation view exposes the successful supplement before insurance cancellation');
  const refundedSupplementOrder = successfulSupplementInsuranceFailure.orders[0];
  const refundedSupplementPassenger = await scalar(
    'SELECT id FROM order_passengers WHERE order_id=$1', [refundedSupplementOrder],
  );
  let successfulSupplementInsuranceResult;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    successfulSupplementInsuranceResult = await expect(
      'POST', `/orders/${refundedSupplementOrder}/passengers/${refundedSupplementPassenger.id}/insurance/sandbox`,
      successfulSupplementInsuranceFailure.user.token, {
        status: 'failed', failureReason: 'insurer_rejected',
        attemptKey: `successful-supplement-insurance-failure-${attempt}`,
      },
    );
  }
  check(successfulSupplementInsuranceResult.insurance.departureCancelled, true,
    'insurance failure after a successful supplement cancels the underfunded departure');
  check((await scalar('SELECT status FROM departure_supplement_rounds WHERE id=$1',
    [successfulSupplementInsuranceFailure.round.id])).status, 'failed',
  'whole-departure insurance failure marks the previously successful supplement round failed');
  check((await scalar(
    `SELECT COALESCE(SUM(amount_fen),0)::integer AS amount FROM refund_obligations
     WHERE order_id=ANY($1::uuid[]) AND reason='supplement_failure'`,
    [successfulSupplementInsuranceFailure.orders],
  )).amount, 5000, 'the previously successful supplement has its full refund obligation recorded');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_formation_adjustments
     WHERE departure_id=$1 AND adjustment_type='successful_supplement_refund'
       AND source_reference=$2 AND amount_fen=5000`,
    [successfulSupplementInsuranceFailure.departureId,
      `supplement-refund:${successfulSupplementInsuranceFailure.round.id}`],
  )).count, 1, 'the supplement refund is offset in the auditable formation ledger');
  const successfulSupplementAccountsClient = await pool.connect();
  let successfulSupplementAfterInsurance;
  try {
    successfulSupplementAfterInsurance = await loadFormationAccounts(
      successfulSupplementAccountsClient, successfulSupplementInsuranceFailure.departureId,
    );
  } finally {
    successfulSupplementAccountsClient.release();
  }
  check(successfulSupplementAfterInsurance.platform.successfulSupplementFen, 0,
    'formation accounts net the refunded supplement to zero');
  const successfulSupplementReplay = await expect(
    'POST', `/orders/${refundedSupplementOrder}/passengers/${refundedSupplementPassenger.id}/insurance/sandbox`,
    successfulSupplementInsuranceFailure.user.token, {
      status: 'failed', failureReason: 'insurer_rejected',
      attemptKey: 'successful-supplement-insurance-failure-3',
    },
  );
  check(successfulSupplementReplay.insurance.idempotentReplay, true,
    'replaying the final insurance decision does not re-run supplement refunds');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM departure_formation_adjustments
     WHERE departure_id=$1 AND adjustment_type='successful_supplement_refund'`,
    [successfulSupplementInsuranceFailure.departureId],
  )).count, 1, 'replayed insurance decisions do not duplicate the ledger offset');

  const lateWaitlist = await makeWaitlistPaymentFixture(captain, quotaBoatId, '候补迟到到账');
  const nextWaitlistCandidate = await makeUser('候补迟到到账下一位');
  const nextWaitlistEntry = await expect('POST', `/departures/${lateWaitlist.departureId}/waitlist`,
    nextWaitlistCandidate.token, { requestKey: `late-next-${Date.now()}` }, 201);
  check(nextWaitlistEntry.entry.status, 'waiting', 'the next candidate waits while the first seat is held');
  const waitlistLateEvent = paymentAdapter.buildCallback({
    transactionReference: lateWaitlist.intent.reference,
    orderId: lateWaitlist.orderId,
    amountFen: lateWaitlist.intent.amountFen,
    outcome: 'success',
  }).event;
  waitlistLateEvent.createdAt = new Date(
    Date.parse(lateWaitlist.authorizationExpiresAt) + 1,
  ).toISOString();
  const waitlistLateResult = await signedPaymentCallback(waitlistLateEvent);
  check(waitlistLateResult.status, 200, 'late waitlist payment callback is recorded');
  check(waitlistLateResult.body.latePaymentRefundRequired, true,
    'late waitlist success is immediately placed in the refund path');
  check(waitlistLateResult.body.includedInFormation, false,
    'late waitlist payment does not count toward formation');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1', [lateWaitlist.orderId])).status,
    'cancelled', 'late waitlist order cannot reclaim the released seat');
  const nextAuthorization = await expect('GET', `/waitlist/${nextWaitlistEntry.entry.id}`,
    nextWaitlistCandidate.token);
  check(nextAuthorization.entry.status, 'authorized',
    'a late refunded payment releases the eligible seat to the next pre-cutoff candidate');
  check((await scalar('SELECT late_success FROM payment_transactions WHERE provider_reference=$1',
    [lateWaitlist.intent.reference])).late_success, true, 'late waitlist callback is marked for audit');
  check((await scalar(
    `SELECT status FROM refund_obligations WHERE payment_transaction_id=(
       SELECT id FROM payment_transactions WHERE provider_reference=$1
     ) AND reason='late_waitlist_payment'`, [lateWaitlist.intent.reference],
  )).status, 'sandbox_succeeded', 'late waitlist money records its sandbox refund result');
  check((await signedPaymentCallback(waitlistLateEvent)).body.duplicate, true,
    'replayed late waitlist callback cannot create a second refund');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM refund_obligations r
     JOIN payment_transactions t ON t.id=r.payment_transaction_id
     WHERE t.provider_reference=$1 AND r.reason='late_waitlist_payment'`,
    [lateWaitlist.intent.reference],
  )).count, 1, 'late waitlist callback has exactly one refund obligation');

  const lateRelease = await makeWindowDeparture(captain, quotaBoatId, '18时后释放席位');
  const lateReleaseCandidate = await makeUser('18时后释放席位候补');
  const lateReleaseEntry = await expect('POST', `/departures/${lateRelease.departureId}/waitlist`,
    lateReleaseCandidate.token, { requestKey: `post-cutoff-${Date.now()}` }, 201);
  check(lateReleaseEntry.entry.status, 'waiting', 'pre-cutoff candidate remains queued without an eligible seat');
  const lateReleaseSeatId = lateRelease.seat.id;
  await pool.query('UPDATE seat_inventory SET waitlist_released_at=$2 WHERE id=$1',
    [lateReleaseSeatId, new Date(lateRelease.confirmationAt.getTime() + 1).toISOString()]);
  simulatedStep3Time = new Date(lateRelease.confirmationAt.getTime() + 60 * 1000);
  const postCutoffDispatch = await dispatchWaitlistCandidates(
    pool, acceptanceRedis, lateRelease.departureId,
    new Date(lateRelease.confirmationAt.getTime() + 60 * 1000), testConfig.step3ClockNow,
  );
  check(postCutoffDispatch.length, 0, 'a seat released after 18:00 is not assigned in the closeout window');
  check((await scalar('SELECT status FROM seat_inventory WHERE id=$1', [lateReleaseSeatId])).status,
    'available', 'post-cutoff released seat remains outside waitlist holds');
  check((await scalar('SELECT status FROM departure_waitlist_entries WHERE id=$1',
    [lateReleaseEntry.entry.id])).status, 'waiting', 'late seat release does not authorize the queued candidate');
  const lateReleaseCloseAt = new Date(lateRelease.confirmationAt.getTime() + 10 * 60 * 1000);
  simulatedStep3Time = lateReleaseCloseAt;
  const exactCloseout = await processWaitlistCloseouts(
    pool, lateReleaseCloseAt, acceptanceRedis, testConfig.step3ClockNow,
  );
  check(exactCloseout.closed >= 1, true, 'the 18:10 boundary freezes a departure without pending work');
  check((await scalar('SELECT waitlist_window_closed_at FROM departures WHERE id=$1',
    [lateRelease.departureId])).waitlist_window_closed_at.toISOString(), lateReleaseCloseAt.toISOString(),
  'closeout records the exact 18:10 hard deadline');
  check((await scalar('SELECT status FROM departure_waitlist_entries WHERE id=$1',
    [lateReleaseEntry.entry.id])).status, 'closed', 'the 18:10 freeze closes remaining candidates');

  const dispatchCutoff = await makeWindowDeparture(captain, quotaBoatId, '候补派发跨18:10锁竞争');
  const dispatchCandidate = await makeUser('派发跨18:10候补钓友');
  const dispatchCloseoutAt = new Date(dispatchCutoff.confirmationAt.getTime() + 10 * 60 * 1000);
  simulatedStep3Time = new Date(dispatchCutoff.confirmationAt.getTime() - 1000);
  const dispatchRegistration = await expect('POST', `/departures/${dispatchCutoff.departureId}/waitlist`,
    dispatchCandidate.token, { requestKey: `dispatch-closeout-${Date.now()}` }, 201);
  check(dispatchRegistration.entry.status, 'waiting',
    'candidate enters queue before the waitlist dispatch cutoff');
  await pool.query('UPDATE seat_inventory SET waitlist_released_at=$2 WHERE id=$1',
    [dispatchCutoff.seat.id, new Date(dispatchCutoff.confirmationAt.getTime() - 1000).toISOString()]);
  simulatedStep3Time = new Date(dispatchCloseoutAt.getTime() - 1000);
  const dispatchLock = await pool.connect();
  let dispatchPromise;
  let dispatchBlocked = false;
  try {
    await dispatchLock.query('BEGIN');
    await dispatchLock.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE',
      [dispatchCutoff.departureId]);
    dispatchPromise = dispatchWaitlistCandidates(
      pool, acceptanceRedis, dispatchCutoff.departureId,
      new Date(dispatchCloseoutAt.getTime() - 1000), testConfig.step3ClockNow,
    );
    dispatchBlocked = await waitForLockedQuery('SELECT id FROM departures WHERE id=$1 FOR UPDATE');
    simulatedStep3Time = new Date(dispatchCloseoutAt.getTime() + 1000);
  } finally {
    await dispatchLock.query('COMMIT').catch(() => {});
    dispatchLock.release();
  }
  const dispatchAfterCloseout = await dispatchPromise;
  check(dispatchBlocked, true, 'waitlist dispatch itself waits on the departure row lock');
  check(dispatchAfterCloseout.length, 0,
    'dispatch starting at 18:09:59 reads the shared clock after lock wait past 18:10');
  check((await scalar('SELECT status FROM seat_inventory WHERE id=$1', [dispatchCutoff.seat.id])).status,
    'available', 'post-18:10 dispatch leaves the released seat available');
  check((await scalar('SELECT status FROM departure_waitlist_entries WHERE id=$1',
    [dispatchRegistration.entry.id])).status, 'waiting', 'post-18:10 dispatch creates no authorization');
  check((await scalar(`SELECT count(*)::integer AS count FROM seat_holds WHERE departure_id=$1 AND status='active'`,
    [dispatchCutoff.departureId])).count, 0, 'post-18:10 dispatch creates no active hold');
  const dispatchRedisKey = `fishing:step3:seat:${dispatchCutoff.seat.id}`;
  check(await acceptanceRedis.get(dispatchRedisKey), null, 'post-18:10 dispatch creates no Redis hold key');
  check(await acceptanceRedis.pTTL(dispatchRedisKey), -2,
    'post-18:10 dispatch leaves no Redis key with a positive TTL');
  simulatedStep3Time = new Date(dispatchCloseoutAt.getTime() + 1000);
  const dispatchCloseout = await processWaitlistCloseouts(
    pool, dispatchCloseoutAt, acceptanceRedis, testConfig.step3ClockNow,
  );
  check(dispatchCloseout.closed, 1, 'the same injected clock closes the queue after the dispatch cutoff');
  check((await scalar('SELECT status FROM departure_waitlist_entries WHERE id=$1',
    [dispatchRegistration.entry.id])).status, 'closed',
  'cutoff closeout closes the candidate that received no expired authorization');
  simulatedStep3Time = null;

  const registrationCutoff = await makeWindowDeparture(captain, quotaBoatId, '候补登记截止锁竞争');
  const registrationUser = await makeUser('候补截止竞争钓友');
  const registrationLock = await pool.connect();
  let registrationPromise;
  let registrationBlocked = false;
  try {
    simulatedStep3Time = new Date(registrationCutoff.confirmationAt.getTime() - 1000);
    await registrationLock.query('BEGIN');
    await registrationLock.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE',
      [registrationCutoff.departureId]);
    registrationPromise = request('POST', `/departures/${registrationCutoff.departureId}/waitlist`,
      registrationUser.token, { requestKey: `cutoff-register-${Date.now()}` });
    registrationBlocked = await waitForLockedQuery('SELECT id FROM departures WHERE id=$1 FOR UPDATE');
    simulatedStep3Time = new Date(registrationCutoff.confirmationAt.getTime() + 1);
  } finally {
    await registrationLock.query('COMMIT').catch(() => {});
    registrationLock.release();
  }
  const registrationAfterCutoff = await registrationPromise;
  check(registrationBlocked, true, 'waitlist registration waits on the departure row lock');
  check(registrationAfterCutoff.status, 409,
    'waitlist registration reads the clock after waiting past the 18:00 cutoff');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_waitlist_entries WHERE departure_id=$1',
    [registrationCutoff.departureId])).count, 0, 'post-cutoff registration leaves no queue entry');

  const holdCutoff = await makeWindowDeparture(captain, quotaBoatId, '普通锁位截止锁竞争');
  const holdUser = await makeUser('普通锁位截止竞争钓友');
  const holdLock = await pool.connect();
  let holdPromise;
  let holdBlocked = false;
  try {
    simulatedStep3Time = new Date(holdCutoff.confirmationAt.getTime() - 1000);
    await holdLock.query('BEGIN');
    await holdLock.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [holdCutoff.departureId]);
    holdPromise = request('POST', `/departures/${holdCutoff.departureId}/seat-holds`, holdUser.token,
      { seatIds: [holdCutoff.seat.id] });
    holdBlocked = await waitForLockedQuery('SELECT id FROM departures WHERE id=$1 FOR UPDATE');
    simulatedStep3Time = new Date(holdCutoff.confirmationAt.getTime() + 1);
  } finally {
    await holdLock.query('COMMIT').catch(() => {});
    holdLock.release();
  }
  const holdAfterCutoff = await holdPromise;
  check(holdBlocked, true, 'normal seat hold waits on the departure row lock');
  check(holdAfterCutoff.status, 404,
    'normal seat hold reads the clock after waiting past the 18:00 cutoff');
  check((await scalar('SELECT status FROM seat_inventory WHERE id=$1', [holdCutoff.seat.id])).status,
    'available', 'post-cutoff normal seat hold leaves the seat available');
  check((await scalar('SELECT count(*)::integer AS count FROM seat_holds WHERE departure_id=$1',
    [holdCutoff.departureId])).count, 0, 'post-cutoff normal seat hold creates no hold row');

  const orderCutoff = await makeWindowDeparture(captain, quotaBoatId, '订单创建截止锁竞争');
  const orderUser = await makeUser('订单创建截止竞争钓友');
  simulatedStep3Time = new Date(orderCutoff.confirmationAt.getTime() - 1000);
  const orderHold = await expect('POST', `/departures/${orderCutoff.departureId}/seat-holds`,
    orderUser.token, { seatIds: [orderCutoff.seat.id] }, 201);
  const orderLock = await pool.connect();
  let orderPromise;
  let orderBlocked = false;
  const orderIdempotencyKey = `cutoff-order-${Date.now()}`;
  try {
    await orderLock.query('BEGIN');
    await orderLock.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [orderCutoff.departureId]);
    orderPromise = request('POST', '/orders', orderUser.token, {
      holdId: orderHold.holdId,
      idempotencyKey: orderIdempotencyKey,
      passengers: [{
        seatId: orderCutoff.seat.id,
        fullName: '截止钓友',
        identityNumber: makeSandboxIdentityNumber(String(sequence + 1).padStart(3, '0')),
        phone: '13900009999',
      }],
    });
    orderBlocked = await waitForLockedQuery('SELECT id FROM departures WHERE id=$1 FOR UPDATE');
    simulatedStep3Time = new Date(orderCutoff.confirmationAt.getTime() + 1);
  } finally {
    await orderLock.query('COMMIT').catch(() => {});
    orderLock.release();
  }
  const orderAfterCutoff = await orderPromise;
  check(orderBlocked, true, 'order creation waits on the departure row lock');
  check(orderAfterCutoff.status, 409,
    'order creation reads the clock after waiting past the 18:00 cutoff');
  check((await scalar('SELECT count(*)::integer AS count FROM booking_orders WHERE buyer_user_id=$1 AND idempotency_key=$2',
    [orderUser.id, orderIdempotencyKey])).count, 0, 'post-cutoff order attempt creates no booking order');

  const callbackFirst = await makeWaitlistPaymentFixture(captain, quotaBoatId, '回调先于18时10分收尾', {
    registrationOffsetMs: -60_000,
    releaseOffsetMs: -60_000,
  });
  const callbackFirstCloseoutAt = new Date(callbackFirst.confirmationAt.getTime() + 10 * 60 * 1000);
  const callbackFirstEvent = paymentAdapter.buildCallback({
    transactionReference: callbackFirst.intent.reference,
    orderId: callbackFirst.orderId,
    amountFen: callbackFirst.intent.amountFen,
    outcome: 'success',
  }).event;
  callbackFirstEvent.createdAt = new Date(Date.parse(callbackFirst.authorizationExpiresAt) - 1000).toISOString();
  simulatedStep3Time = new Date(callbackFirstEvent.createdAt);
  const callbackFirstResult = await signedPaymentCallback(callbackFirstEvent);
  check(callbackFirstResult.status, 200, 'on-time waitlist callback completes before the 18:10 closeout');
  check(callbackFirstResult.body.paymentStatus, 'succeeded', 'pre-closeout provider success settles the order');
  simulatedStep3Time = callbackFirstCloseoutAt;
  const callbackFirstCloseout = await processWaitlistCloseouts(
    pool, callbackFirstCloseoutAt, acceptanceRedis, testConfig.step3ClockNow,
  );
  check(callbackFirstCloseout.closed >= 1, true, '18:10 closeout completes after the successful callback');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1', [callbackFirst.orderId])).status,
    'paid', 'the callback-first ordering retains the paid booking');

  const closeoutFirst = await makeWaitlistPaymentFixture(captain, quotaBoatId, '18时10分收尾先于回调', {
    registrationOffsetMs: -60_000,
    releaseOffsetMs: -60_000,
  });
  const closeoutFirstAt = new Date(closeoutFirst.confirmationAt.getTime() + 10 * 60 * 1000);
  const closeoutFirstEvent = paymentAdapter.buildCallback({
    transactionReference: closeoutFirst.intent.reference,
    orderId: closeoutFirst.orderId,
    amountFen: closeoutFirst.intent.amountFen,
    outcome: 'success',
  }).event;
  closeoutFirstEvent.createdAt = new Date(Date.parse(closeoutFirst.authorizationExpiresAt) - 1000).toISOString();
  const closeoutLock = await pool.connect();
  let blockedCloseout;
  let closeoutBlocked = false;
  try {
    simulatedStep3Time = new Date(closeoutFirstAt.getTime() - 1000);
    await closeoutLock.query('BEGIN');
    await closeoutLock.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [closeoutFirst.departureId]);
    blockedCloseout = processWaitlistCloseouts(
      pool, closeoutFirstAt, acceptanceRedis, testConfig.step3ClockNow,
    );
    closeoutBlocked = await waitForLockedQuery(
      "SELECT id FROM departures WHERE id=$1 AND status IN ('open','forming')",
    );
    simulatedStep3Time = new Date(closeoutFirstAt.getTime() + 1);
  } finally {
    await closeoutLock.query('COMMIT').catch(() => {});
    closeoutLock.release();
  }
  const closeoutFirstResult = await blockedCloseout;
  check(closeoutBlocked, true, '18:10 worker waits behind the departure row lock');
  check(closeoutFirstResult.closed, 1,
    'worker rechecks current time after lock and closes the window immediately');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1', [closeoutFirst.orderId])).status,
    'cancelled', '18:10 closeout cancels a still-pending waitlist payment without a reaper');
  check((await scalar('SELECT status FROM payment_transactions WHERE provider_reference=$1',
    [closeoutFirst.intent.reference])).status, 'timed_out', 'closeout times out the pending payment directly');
  check((await scalar('SELECT status FROM seat_holds WHERE id=(SELECT hold_id FROM booking_orders WHERE id=$1)',
    [closeoutFirst.orderId])).status, 'expired', 'closeout releases the pending order hold directly');
  const closeoutFirstPayment = await signedPaymentCallback(closeoutFirstEvent);
  check(closeoutFirstPayment.status, 200, 'provider success after closeout is still recorded');
  check(closeoutFirstPayment.body.latePaymentRefundRequired, true,
    'post-closeout success creates a refund obligation instead of reviving the order');
  check((await scalar('SELECT count(*)::integer AS count FROM departure_supplement_rounds WHERE departure_id=$1',
    [closeoutFirst.departureId])).count, 0,
  'post-closeout payment does not create a formation supplement round');
  check((await scalar(
    `SELECT r.status FROM refund_obligations r JOIN payment_transactions p ON p.id=r.payment_transaction_id
     WHERE p.provider_reference=$1 AND r.reason='late_waitlist_payment'`,
    [closeoutFirst.intent.reference],
  )).status, 'sandbox_succeeded', 'post-closeout money is recorded in the refund path');

  const ordinaryCloseout = await makeOrdinaryPendingPaymentFixture(
    captain, quotaBoatId, 'reaper停用时普通订单收口',
  );
  const ordinaryHoldExpiry = (await scalar(
    'SELECT expires_at FROM seat_holds WHERE id=$1', [ordinaryCloseout.holdId],
  )).expires_at;
  const ordinaryCloseAt = new Date(ordinaryCloseout.confirmationAt.getTime() + 10 * 60 * 1000);
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1',
    [ordinaryCloseout.orderId])).status, 'pending_payment',
  'ordinary order remains pending before the 18:10 worker runs');
  check((await scalar('SELECT status FROM payment_transactions WHERE provider_reference=$1',
    [ordinaryCloseout.intent.reference])).status, 'pending',
  'ordinary payment remains pending before the 18:10 worker runs');
  simulatedStep3Time = ordinaryCloseAt;
  const ordinaryCheckpoint = await processFormationChecksAt(ordinaryCloseAt);
  check(ordinaryCheckpoint.deferred, 0,
    'formation does not defer on an expired ordinary payment when the reaper never runs');
  check(ordinaryCheckpoint.checked >= 1, true,
    '18:10 closeout and formation snapshot finish in the same bounded worker pass');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1',
    [ordinaryCloseout.orderId])).status, 'cancelled',
  '18:10 closeout cancels the expired ordinary pending order');
  check((await scalar('SELECT status FROM payment_transactions WHERE provider_reference=$1',
    [ordinaryCloseout.intent.reference])).status, 'timed_out',
  '18:10 closeout times out the expired ordinary payment');
  check((await scalar('SELECT status FROM seat_holds WHERE id=$1',
    [ordinaryCloseout.holdId])).status, 'expired',
  '18:10 closeout expires the ordinary order hold without the reaper');
  check((await scalar('SELECT status FROM seat_inventory WHERE id=$1',
    [ordinaryCloseout.seat.id])).status, 'available',
  '18:10 closeout releases the expired ordinary seat');
  check((await scalar('SELECT status FROM booking_order_seats WHERE order_id=$1',
    [ordinaryCloseout.orderId])).status, 'released',
  '18:10 closeout releases the ordinary order seat record');
  const ordinarySnapshot = await scalar(
    'SELECT outcome,platform_ticket_net_fen FROM departure_formation_snapshots WHERE departure_id=$1',
    [ordinaryCloseout.departureId],
  );
  check(ordinarySnapshot.outcome, 'shortfall',
    'the frozen formation snapshot excludes the unpaid ordinary order');
  check(ordinarySnapshot.platform_ticket_net_fen, '0',
    'unpaid ordinary ticket money is absent from frozen formation funds');
  check((await scalar('SELECT status FROM departures WHERE id=$1',
    [ordinaryCloseout.departureId])).status, 'handling_shortfall',
  'ordinary order closeout leaves the departure in its frozen shortfall state');

  const ordinaryLateEvent = paymentAdapter.buildCallback({
    transactionReference: ordinaryCloseout.intent.reference,
    orderId: ordinaryCloseout.orderId,
    amountFen: ordinaryCloseout.intent.amountFen,
    outcome: 'success',
  }).event;
  ordinaryLateEvent.createdAt = new Date(new Date(ordinaryHoldExpiry).getTime() + 1000).toISOString();
  simulatedStep3Time = new Date(ordinaryCloseAt.getTime() + 1000);
  const ordinaryLateResult = await signedPaymentCallback(ordinaryLateEvent);
  check(ordinaryLateResult.status, 200, 'late ordinary booking success is accepted for refund accounting');
  check(ordinaryLateResult.body.latePaymentRefundRequired, true,
    'late ordinary booking success enters the refund path');
  check(ordinaryLateResult.body.includedInFormation, false,
    'late ordinary booking success is excluded from frozen formation funds');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1',
    [ordinaryCloseout.orderId])).status, 'cancelled',
  'late ordinary success does not revive the cancelled order');
  check((await scalar('SELECT status FROM payment_transactions WHERE provider_reference=$1',
    [ordinaryCloseout.intent.reference])).status, 'succeeded',
  'late ordinary success is recorded exactly as received');
  check((await scalar('SELECT late_success FROM payment_transactions WHERE provider_reference=$1',
    [ordinaryCloseout.intent.reference])).late_success, true,
  'late ordinary success is marked for audit');
  check((await scalar(
    `SELECT status FROM refund_obligations WHERE payment_transaction_id=(
       SELECT id FROM payment_transactions WHERE provider_reference=$1
     ) AND reason='late_booking_payment'`, [ordinaryCloseout.intent.reference],
  )).status, 'sandbox_succeeded',
  'late ordinary booking funds receive a refund obligation');
  check((await scalar('SELECT status FROM seat_inventory WHERE id=$1',
    [ordinaryCloseout.seat.id])).status, 'available',
  'late ordinary success cannot reclaim the released seat');
  check((await scalar('SELECT status FROM booking_order_seats WHERE order_id=$1',
    [ordinaryCloseout.orderId])).status, 'released',
  'late ordinary success cannot restore the cancelled passenger manifest');
  check((await scalar('SELECT status FROM departures WHERE id=$1',
    [ordinaryCloseout.departureId])).status, 'handling_shortfall',
  'late ordinary success cannot alter the frozen departure state');
  check((await signedPaymentCallback(ordinaryLateEvent)).body.duplicate, true,
    'replayed ordinary late success remains idempotent');

  simulatedStep3Time = null;

  if (process.env.STEP4_SCREENSHOT_FIXTURE_PATH) {
    await createSupplementScreenshotFixture(
      captain,
      quotaBoatId,
      process.env.STEP4_SCREENSHOT_FIXTURE_PATH,
      { departureId: formationDepartureId, orderId: formationOrderId },
      angler.token,
    );
  }
  console.log('Step 4 acceptance passed: ' + assertions + ' assertions.');
}

try {
  await main();
} finally {
  await app.close();
  if (acceptanceRedis.isOpen) await acceptanceRedis.quit();
  await pool.end();
}
