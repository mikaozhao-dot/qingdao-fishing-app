import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createClient } from 'redis';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { makeSandboxIdentityNumber } from '../src/security.js';
import {
  issueWelcomeMemberCoupon,
  reconcileCouponAfterRefund,
  redeemReservedCouponForOrder,
  releaseReservedCouponsForOrders,
  reserveOrderCoupon,
  syncMemberRewardsForDeparture,
  syncMemberRewardsForUser,
} from '../src/member-coupon-service.js';
import { createSecurity } from '../src/security.js';

if (process.env.MEMBER_COUPON_ACCEPTANCE !== 'true') {
  throw new Error('Set MEMBER_COUPON_ACCEPTANCE=true and use an isolated acceptance database.');
}
if (!config.databaseUrl || !config.redisUrl) throw new Error('DATABASE_URL and REDIS_URL are required.');

const { Pool } = pg;
const testConfig = {
  ...config,
  nodeEnv: 'test',
  logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
  demoSandboxEnabled: true,
  piiEncryptionKeyHex: config.piiEncryptionKeyHex || '11'.repeat(32),
  phoneHashKeyHex: config.phoneHashKeyHex || '22'.repeat(32),
};
const security = createSecurity(testConfig);
const pool = new Pool({ connectionString: config.databaseUrl, max: 6 });
const app = buildApp(testConfig);
const users = [];
const boats = [];
const departures = [];
const orders = [];
const couponIds = [];
const fCouponIds = [];
const holdIds = [];
const seatIds = [];
const tokens = [];
let assertions = 0;

function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}

async function makeUser(label) {
  const id = randomUUID();
  const token = security.newToken();
  await pool.query(
    `INSERT INTO users
       (id,phone_ciphertext,phone_hash,display_name,identity_status,identity_verified_at,identity_number_hash)
     VALUES ($1,$2,$3,$4,'verified',now(),$5)`,
    [id, Buffer.from(`member-coupon:${id}`), randomBytes(32), label, randomBytes(32)],
  );
  await pool.query(
    `INSERT INTO user_sessions (token_hash,user_id,expires_at)
     VALUES ($1,$2,now()+interval '2 days')`, [security.tokenHash(token), id],
  );
  users.push(id);
  tokens.push(token);
  return { id, token };
}

async function uniqueSandboxIdentityNumber() {
  for (let attempt = 0; attempt < 998; attempt += 1) {
    const identityNumber = makeSandboxIdentityNumber(String(randomInt(1, 999)));
    const duplicate = await pool.query(
      `SELECT 1 FROM users WHERE identity_number_hash=$1`, [security.identityHash(identityNumber)],
    );
    if (!duplicate.rowCount) return identityNumber;
  }
  throw new Error('No unused sandbox identity number remains.');
}

async function verifySandboxIdentity(user) {
  const identityNumber = await uniqueSandboxIdentityNumber();
  const response = await app.inject({
    method: 'POST', url: '/identity',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { legalName: '会员券验收本人', identityNumber },
  });
  check(response.statusCode, 200, 'sandbox identity verification succeeds');
  check(response.json().status, 'verified', 'verified identity status is returned');
  return identityNumber;
}

async function makeDeparture(captain, { completed = false, status = 'confirmed', seatCount = 2,
  seatPriceFen = 10_000 } = {}) {
  const boatId = randomUUID();
  const departureId = randomUUID();
  const departureAt = completed ? new Date(Date.now() - 6 * 3_600_000) : new Date(Date.now() + 72 * 3_600_000);
  await pool.query(
    `INSERT INTO captain_profiles (user_id,captain_name,verification_status,verified_at)
     VALUES ($1,$2,'approved',now()) ON CONFLICT (user_id) DO NOTHING`, [captain.id, `会员券验收船长-${boatId.slice(0, 6)}`],
  );
  await pool.query(
    `INSERT INTO boats (id,captain_user_id,name,length_cm,home_marina_code,seat_count,review_status)
     VALUES ($1,$2,$3,900,'xiaogang',12,'approved')`, [boatId, captain.id, `会员券验收船-${boatId.slice(0, 6)}`],
  );
  const returnAt = completed ? new Date(Date.now() - 3_600_000) : new Date(departureAt.getTime() + 6 * 3_600_000);
  await pool.query(
    `INSERT INTO departures
       (id,boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,
        marina_code,minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,$3,'pro_fishing',$4,$5,$6,'qd_coast','xiaogang',10000,10000,$7,$8,12,12,0,false)`,
    [departureId, boatId, captain.id, departureAt, new Date(departureAt.getTime() - 30 * 60_000), returnAt,
      completed ? departureAt : new Date(departureAt.getTime() - 45 * 60_000), completed ? 'completed' : status],
  );
  const seats = [];
  for (let seatNumber = 1; seatNumber <= seatCount; seatNumber += 1) {
    const seat = await pool.query(
      `INSERT INTO seat_inventory
         (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
       VALUES ($1,$2,$3,'port','mid','available','platform') RETURNING id`,
      [departureId, seatNumber, seatPriceFen],
    );
    seats.push(seat.rows[0].id);
    seatIds.push(seat.rows[0].id);
  }
  if (completed) {
    await pool.query(
      `INSERT INTO departure_checkins (departure_id,captain_user_id,event,checked_at)
       VALUES ($1,$2,'returned',$3)`, [departureId, captain.id, returnAt],
    );
  }
  boats.push(boatId);
  departures.push(departureId);
  return { id: departureId, boatId, seatIds: seats };
}

async function makeOrder(user, departure, seatId, {
  status = 'pending_payment', couponDiscountFen = 0, seatFeeFen = 10_000,
  discountFen = 0, paid = status !== 'pending_payment', passengerIdentityNumber = null,
} = {}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO booking_orders
       (id,order_number,departure_id,seat_inventory_id,buyer_user_id,buyer_seat_inventory_id,status,
        seat_fee_fen,discount_fen,coupon_discount_fen,platform_fee_fen,total_amount_fen,paid_at)
     VALUES ($1,$2,$3,$4,$5,$4,$6,$7,$8,$9,0,$10,CASE WHEN $11 THEN now() ELSE NULL END)`,
    [id, `MC-${id}`, departure.id, seatId, user.id, status, seatFeeFen, discountFen,
      couponDiscountFen, seatFeeFen - discountFen - couponDiscountFen, paid],
  );
  await pool.query(
    `INSERT INTO order_passengers
       (order_id,seat_inventory_id,full_name_ciphertext,identity_number_ciphertext,phone_ciphertext)
     VALUES ($1,$2,$3,$4,$5)`, [id, seatId, security.encrypt('验收乘客'),
       security.encrypt(passengerIdentityNumber ?? 'not-a-sandbox-identity'), security.encrypt('13900000000')],
  );
  await pool.query(
    `INSERT INTO booking_order_seats (order_id,seat_inventory_id,seat_number,price_fen,status)
     SELECT $1,id,seat_number,$2,$3 FROM seat_inventory WHERE id=$4`,
    [id, seatFeeFen, paid ? 'paid' : 'pending_payment', seatId],
  );
  orders.push(id);
  return id;
}

async function transaction(operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function couponStatus(userToken, path) {
  const response = await app.inject({ method: 'GET', url: path,
    headers: { authorization: `Bearer ${userToken}` } });
  return { status: response.statusCode, body: response.json() };
}

async function expectCouponError(operation, statusCode, label) {
  await assert.rejects(operation, (error) => {
    check(error.statusCode, statusCode, label);
    return true;
  });
}

async function expectUniqueConflict(operation, label) {
  await assert.rejects(operation, (error) => {
    check(error.code, '23505', label);
    return true;
  });
}

async function cancelFixtureOrder(orderId) {
  await pool.query(
    `UPDATE booking_orders SET status='cancelled',cancelled_at=now() WHERE id=$1`, [orderId],
  );
  await pool.query(
    `UPDATE booking_order_seats SET status='released' WHERE order_id=$1`, [orderId],
  );
}

try {
  await app.ready();
  const buyer = await makeUser('会员券验收本人');
  const captain = await makeUser('会员券验收船长');
  const other = await makeUser('会员券验收其他账号');
  const buyerIdentityNumber = await verifySandboxIdentity(buyer);
  const welcome = await transaction(async (client) => {
    const first = await issueWelcomeMemberCoupon(client, buyer.id);
    const replay = await issueWelcomeMemberCoupon(client, buyer.id);
    check(replay.id, first.id, 'identity verification replay returns the same first-order coupon');
    return first;
  });
  couponIds.push(welcome.id);
  check(Number(welcome.amount_fen), 1500, 'welcome coupon face value is ¥15');
  check((await pool.query(`SELECT expires_at=issued_at+interval '1 year' AS valid
    FROM member_coupons WHERE id=$1`, [welcome.id])).rows[0].valid, true,
  'welcome coupon expires one year after issue');
  check((await pool.query(`SELECT count(*)::integer AS count FROM member_coupons
    WHERE user_id=$1 AND coupon_type='first_order'`, [buyer.id])).rows[0].count, 1,
  'welcome coupon is issued once per verified member');

  const privateWallet = await couponStatus(buyer.token, '/member-coupons/me');
  check(privateWallet.status, 200, 'member can read own wallet');
  check(privateWallet.body.items[0].status, 'available', 'unexpired coupon is available');
  check((await couponStatus(other.token, '/member-coupons/me')).body.items.length, 0,
    'another account cannot read the member coupon');
  check((await couponStatus(buyer.token, '/member-rewards/me')).body.stars, 0,
    'new member starts with zero lifetime stars');

  const apiDeparture = await makeDeparture(captain, { seatCount: 4, status: 'open' });
  const otherPassengerIdentity = await uniqueSandboxIdentityNumber();
  const apiHold = await app.inject({
    method: 'POST', url: `/departures/${apiDeparture.id}/seat-holds`,
    headers: { authorization: `Bearer ${buyer.token}` },
    payload: { seatIds: apiDeparture.seatIds.slice(0, 2) },
  });
  check(apiHold.statusCode, 201, 'buyer can hold seats for a multi-passenger order');
  const apiHoldId = apiHold.json().holdId;
  holdIds.push(apiHoldId);
  const apiOrderResponse = await app.inject({
    method: 'POST', url: '/orders',
    headers: { authorization: `Bearer ${buyer.token}` },
    payload: {
      holdId: apiHoldId,
      idempotencyKey: `member-coupon:${randomUUID()}`,
      coupon: { kind: 'member', id: welcome.id },
      passengers: [
        { seatId: apiDeparture.seatIds[0], fullName: '同行乘客甲',
          identityNumber: otherPassengerIdentity, phone: '13900000001' },
        { seatId: apiDeparture.seatIds[1], fullName: '会员本人',
          identityNumber: buyerIdentityNumber, phone: '13900000002' },
      ],
    },
  });
  check(apiOrderResponse.statusCode, 201, 'member coupon is reserved through the order API');
  const apiOrder = apiOrderResponse.json().order;
  orders.push(apiOrder.id);
  check(apiOrder.amount.couponDiscountFen, 1500, 'API applies the coupon discount to the order');
  check(apiOrder.coupon.status, 'reserved', 'coupon remains reserved until successful payment');
  check(apiOrder.coupon.kind, 'member', 'coupon redemption is linked to the member coupon');
  check((await couponStatus(buyer.token, '/member-coupons/me')).body.items
    .find((item) => item.id === welcome.id)?.status,
  'reserved', 'wallet reflects the reservation state');

  const replayHold = await app.inject({
    method: 'POST', url: `/departures/${apiDeparture.id}/seat-holds`,
    headers: { authorization: `Bearer ${buyer.token}` },
    payload: { seatIds: [apiDeparture.seatIds[2]] },
  });
  check(replayHold.statusCode, 201, 'buyer can hold a second seat for a reuse attempt');
  holdIds.push(replayHold.json().holdId);
  const couponReuse = await app.inject({
    method: 'POST', url: '/orders',
    headers: { authorization: `Bearer ${buyer.token}` },
    payload: {
      holdId: replayHold.json().holdId,
      idempotencyKey: `member-reuse:${randomUUID()}`,
      coupon: { kind: 'member', id: welcome.id },
      passengers: [{ seatId: apiDeparture.seatIds[2], fullName: '会员本人',
        identityNumber: buyerIdentityNumber, phone: '13900000004' }],
    },
  });
  check(couponReuse.statusCode, 409, 'an already reserved coupon cannot be used on another order');
  check(Number((await pool.query(`SELECT count(*)::integer AS count FROM coupon_redemption_attempt_facts
    WHERE user_id=$1 AND member_coupon_id=$2 AND fact_type='active_coupon_reuse_conflict'`,
    [buyer.id, welcome.id])).rows[0].count), 1, 'a rejected active coupon reuse is recorded as a fact');

  const nonPassengerHold = await app.inject({
    method: 'POST', url: `/departures/${apiDeparture.id}/seat-holds`,
    headers: { authorization: `Bearer ${buyer.token}` },
    payload: { seatIds: [apiDeparture.seatIds[3]] },
  });
  check(nonPassengerHold.statusCode, 201, 'buyer can hold a seat for another passenger');
  holdIds.push(nonPassengerHold.json().holdId);
  const nonPassengerOrder = await app.inject({
    method: 'POST', url: '/orders',
    headers: { authorization: `Bearer ${buyer.token}` },
    payload: {
      holdId: nonPassengerHold.json().holdId,
      idempotencyKey: `member-nonpassenger:${randomUUID()}`,
      coupon: { kind: 'member', id: welcome.id },
      passengers: [{ seatId: apiDeparture.seatIds[3], fullName: '同行乘客乙',
        identityNumber: otherPassengerIdentity, phone: '13900000003' }],
    },
  });
  check(nonPassengerOrder.statusCode, 409, 'coupon is rejected when the buyer is not a passenger');
  await transaction((client) => releaseReservedCouponsForOrders(client, [apiOrder.id], 'acceptance_api_cleanup'));
  await cancelFixtureOrder(apiOrder.id);
  check((await couponStatus(buyer.token, '/member-coupons/me')).body.items
    .find((item) => item.id === welcome.id)?.status,
  'available', 'released reservations make the original coupon available again');

  const unfinished = await makeDeparture(captain, { seatCount: 6 });
  const nonOwnerOrder = await makeOrder(other, unfinished, unfinished.seatIds[3]);
  await expectCouponError(() => transaction((client) => reserveOrderCoupon(client, {
    couponKind: 'member', couponId: welcome.id, userId: other.id, orderId: nonOwnerOrder,
    seatInventoryId: unfinished.seatIds[3],
  })), 404, 'a coupon belonging to another user is rejected');
  await cancelFixtureOrder(nonOwnerOrder);

  const expiredCoupon = await pool.query(
    `INSERT INTO member_coupons (user_id,coupon_type,milestone,amount_fen,issued_at,expires_at)
     VALUES ($1,'upgrade',11,2000,now()-interval '2 years',now()-interval '1 year') RETURNING id`,
    [buyer.id],
  );
  couponIds.push(expiredCoupon.rows[0].id);
  const expiredOrder = await makeOrder(buyer, unfinished, unfinished.seatIds[3]);
  await expectCouponError(() => transaction((client) => reserveOrderCoupon(client, {
    couponKind: 'member', couponId: expiredCoupon.rows[0].id, userId: buyer.id,
    orderId: expiredOrder, seatInventoryId: unfinished.seatIds[3],
  })), 409, 'an expired coupon is rejected');
  check((await couponStatus(buyer.token, '/member-coupons/me')).body.items
    .find((item) => item.id === expiredCoupon.rows[0].id)?.status,
  'expired', 'the wallet marks expired coupons accurately');
  await cancelFixtureOrder(expiredOrder);

  const tooLargeCoupon = await pool.query(
    `INSERT INTO member_coupons (user_id,coupon_type,milestone,amount_fen,expires_at)
     VALUES ($1,'upgrade',12,2000,now()+interval '1 year') RETURNING id`, [buyer.id],
  );
  couponIds.push(tooLargeCoupon.rows[0].id);
  const smallDeparture = await makeDeparture(captain, { seatCount: 1, seatPriceFen: 3000 });
  const smallSeatOrder = await makeOrder(buyer, smallDeparture, smallDeparture.seatIds[0], {
    seatFeeFen: 3000, discountFen: 1500,
  });
  await expectCouponError(() => transaction((client) => reserveOrderCoupon(client, {
    couponKind: 'member', couponId: tooLargeCoupon.rows[0].id, userId: buyer.id,
    orderId: smallSeatOrder, seatInventoryId: smallDeparture.seatIds[0],
  })), 409, 'a coupon larger than the buyer seat fare is rejected');
  await cancelFixtureOrder(smallSeatOrder);

  const priorProxyOrder = await makeOrder(buyer, unfinished, unfinished.seatIds[5], { status: 'paid' });
  await pool.query(`UPDATE booking_orders SET buyer_seat_inventory_id=NULL WHERE id=$1`, [priorProxyOrder]);

  const firstOrder = await makeOrder(buyer, unfinished, unfinished.seatIds[0], { couponDiscountFen: 1500 });
  const firstReservation = await transaction((client) => reserveOrderCoupon(client, {
    couponKind: 'member', couponId: welcome.id, userId: buyer.id, orderId: firstOrder,
    seatInventoryId: unfinished.seatIds[0],
  }));
  check(firstReservation.amountFen, 1500, 'reservation takes the full coupon amount on the buyer seat');
  const replayOrder = await makeOrder(buyer, unfinished, unfinished.seatIds[4]);
  await expectUniqueConflict(() => transaction((client) => reserveOrderCoupon(client, {
    couponKind: 'member', couponId: welcome.id, userId: buyer.id, orderId: replayOrder,
    seatInventoryId: unfinished.seatIds[4],
  })), 'the same active coupon cannot be reserved by a second order');
  await cancelFixtureOrder(replayOrder);
  await pool.query(`UPDATE booking_orders SET status='paid' WHERE id=$1`, [firstOrder]);
  await transaction((client) => redeemReservedCouponForOrder(client, firstOrder));
  check((await pool.query(`SELECT status FROM order_coupon_redemptions WHERE order_id=$1`, [firstOrder])).rows[0].status,
    'redeemed', 'successful payment converts the reservation to redemption');

  await pool.query(`UPDATE booking_orders SET status='cancelled',ticket_refunded_fen=8500 WHERE id=$1`, [firstOrder]);
  await pool.query(`UPDATE booking_order_seats SET status='released' WHERE order_id=$1`, [firstOrder]);
  const refundId = randomUUID();
  await pool.query(
    `INSERT INTO refund_obligations (order_id,amount_fen,reason,status,request_key)
     VALUES ($1,8500,'customer_cancellation','pending',$2)`, [firstOrder, `member-refund-${refundId}`],
  );
  check((await transaction((client) => reconcileCouponAfterRefund(client, firstOrder))).restored,
    false, 'pending refund does not restore a coupon');
  await pool.query(`UPDATE refund_obligations SET status='sandbox_succeeded' WHERE order_id=$1`, [firstOrder]);
  check((await transaction((client) => reconcileCouponAfterRefund(client, firstOrder))).restored,
    true, 'successful full ticket refund before completion restores the same coupon');
  const restoredExpiry = (await pool.query(`SELECT c.expires_at,r.status
      FROM member_coupons c JOIN order_coupon_redemptions r ON r.member_coupon_id=c.id
      WHERE c.id=$1 AND r.order_id=$2`, [welcome.id, firstOrder])).rows[0];
  check(restoredExpiry.status, 'restored', 'the original redemption is marked restored');
  check(new Date(restoredExpiry.expires_at).getTime(), new Date(welcome.expires_at).getTime(),
    'restoring the coupon preserves its original expiry');

  const secondOrder = await makeOrder(buyer, unfinished, unfinished.seatIds[1], { couponDiscountFen: 1500 });
  await transaction((client) => reserveOrderCoupon(client, {
    couponKind: 'member', couponId: welcome.id, userId: buyer.id, orderId: secondOrder,
    seatInventoryId: unfinished.seatIds[1],
  }));
  await transaction((client) => releaseReservedCouponsForOrders(client, [secondOrder], 'acceptance_payment_timeout'));
  check((await pool.query(`SELECT status FROM order_coupon_redemptions WHERE order_id=$1`, [secondOrder])).rows[0].status,
    'released', 'payment timeout releases a reservation');
  await cancelFixtureOrder(secondOrder);

  const partialCoupon = await pool.query(
    `INSERT INTO member_coupons (user_id,coupon_type,milestone,amount_fen,expires_at)
     VALUES ($1,'upgrade',1,2000,now()+interval '1 year') RETURNING id`, [buyer.id],
  );
  couponIds.push(partialCoupon.rows[0].id);
  const partialOrder = await makeOrder(buyer, unfinished, unfinished.seatIds[0], { couponDiscountFen: 2000 });
  await transaction((client) => reserveOrderCoupon(client, {
    couponKind: 'member', couponId: partialCoupon.rows[0].id, userId: buyer.id, orderId: partialOrder,
    seatInventoryId: unfinished.seatIds[0],
  }));
  await pool.query(`UPDATE booking_orders SET status='paid' WHERE id=$1`, [partialOrder]);
  await transaction((client) => redeemReservedCouponForOrder(client, partialOrder));
  await pool.query(`UPDATE booking_orders SET status='cancelled',ticket_refunded_fen=500 WHERE id=$1`, [partialOrder]);
  const partialRefundId = randomUUID();
  await pool.query(
    `INSERT INTO refund_obligations (order_id,amount_fen,reason,status,request_key)
     VALUES ($1,500,'customer_cancellation','sandbox_succeeded',$2)`, [partialOrder, `member-partial-${partialRefundId}`],
  );
  check((await transaction((client) => reconcileCouponAfterRefund(client, partialOrder))).restored,
    false, 'partial cash refund does not restore the coupon');

  const fSource = await makeOrder(buyer, unfinished, unfinished.seatIds[2], { status: 'cancelled' });
  const fCoupon = await pool.query(
    `INSERT INTO f_compensation_coupon_ledger
       (source_event_key,source_order_id,beneficiary_user_id,scenario,responsible_party,
        ticket_paid_fen,amount_fen,issued_by,issue_note,expires_at)
     VALUES ($1,$2,$3,'captain_non_weather_cancel','captain_guarantee',5000,150,'member_coupon_acceptance',
        '会员券互斥核验的沙盒 F 券',now()+interval '1 year') RETURNING id`,
    [`member-f-source-${randomUUID()}`, fSource, buyer.id],
  );
  fCouponIds.push(fCoupon.rows[0].id);
  const secondMemberCoupon = await pool.query(
    `INSERT INTO member_coupons (user_id,coupon_type,milestone,amount_fen,expires_at)
     VALUES ($1,'upgrade',2,2000,now()+interval '1 year') RETURNING id`, [buyer.id],
  );
  couponIds.push(secondMemberCoupon.rows[0].id);
  const fOrder = await makeOrder(buyer, unfinished, unfinished.seatIds[1], { couponDiscountFen: 150 });
  const fClient = await pool.connect();
  try {
    await fClient.query('BEGIN');
    await reserveOrderCoupon(fClient, { couponKind: 'f', couponId: fCoupon.rows[0].id,
      userId: buyer.id, orderId: fOrder, seatInventoryId: unfinished.seatIds[1] });
    await fClient.query('SAVEPOINT second_coupon');
    let conflict;
    try {
      await reserveOrderCoupon(fClient, { couponKind: 'member', couponId: secondMemberCoupon.rows[0].id,
        userId: buyer.id, orderId: fOrder, seatInventoryId: unfinished.seatIds[1] });
    } catch (error) {
      conflict = error;
      await fClient.query('ROLLBACK TO SAVEPOINT second_coupon');
    }
    check(conflict?.code, '23505', 'member and F coupons cannot both reserve the same order');
    await fClient.query('COMMIT');
  } catch (error) {
    await fClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    fClient.release();
  }
  await pool.query(`UPDATE booking_orders SET status='paid' WHERE id=$1`, [fOrder]);
  await transaction((client) => redeemReservedCouponForOrder(client, fOrder));
  const fWallet = await couponStatus(buyer.token, '/compensation-coupons/me');
  check(fWallet.body.items.find((item) => item.id === fCoupon.rows[0].id)?.status,
    'redeemed', 'F wallet reflects its shared redemption state');

  const rewardMember = await makeUser('会员星级验收本人');
  const rewardIdentityNumber = await uniqueSandboxIdentityNumber();
  await pool.query(`UPDATE users SET identity_number_hash=$2 WHERE id=$1`,
    [rewardMember.id, security.identityHash(rewardIdentityNumber)]);
  const completedOrderIds = [];
  for (let trip = 1; trip <= 3; trip += 1) {
    const completed = await makeDeparture(captain, { completed: true, seatCount: 10 });
    for (const seatId of completed.seatIds) {
      const orderId = await makeOrder(rewardMember, completed, seatId, {
        status: 'paid', passengerIdentityNumber: rewardIdentityNumber,
      });
      await pool.query(`UPDATE booking_orders SET buyer_seat_inventory_id=NULL WHERE id=$1`, [orderId]);
      completedOrderIds.push(orderId);
    }
    await transaction((client) => syncMemberRewardsForDeparture(client, completed.id, security));
  }
  await transaction(async (client) => {
    for (const departureId of departures.slice(-3)) {
      await syncMemberRewardsForDeparture(client, departureId, security);
    }
  });
  const account = (await pool.query(`SELECT valid_order_count,lifetime_stars
    FROM member_reward_accounts WHERE user_id=$1`, [rewardMember.id])).rows[0];
  check([Number(account.valid_order_count), Number(account.lifetime_stars)], [30, 3],
    'ten, twenty and thirty personal completed orders grant three permanent stars');
  check(Number((await pool.query(`SELECT count(*)::integer AS count FROM member_coupons
    WHERE user_id=$1 AND coupon_type='upgrade'`, [rewardMember.id])).rows[0].count), 3,
  'repeated completion sync issues each of three milestone coupons once');

  const completedRefundOrder = completedOrderIds[0];
  await pool.query(`UPDATE booking_orders SET status='cancelled',ticket_refunded_fen=10000 WHERE id=$1`, [completedRefundOrder]);
  const completedRefundId = randomUUID();
  await pool.query(
    `INSERT INTO refund_obligations (order_id,amount_fen,reason,status,request_key)
     VALUES ($1,10000,'customer_cancellation','sandbox_succeeded',$2)`,
    [completedRefundOrder, `member-complete-refund-${completedRefundId}`],
  );
  const postCompletion = await transaction((client) => reconcileCouponAfterRefund(client, completedRefundOrder));
  check(postCompletion.completed, true, 'post-completion full refund is recorded as a fact');
  const afterRefund = (await pool.query(`SELECT valid_order_count,lifetime_stars
    FROM member_reward_accounts WHERE user_id=$1`, [rewardMember.id])).rows[0];
  check([Number(afterRefund.valid_order_count), Number(afterRefund.lifetime_stars)], [29, 3],
    'full-refunded completed order leaves valid count but never downgrades stars');
  check(Number((await pool.query(`SELECT count(*)::integer AS count FROM member_coupons
    WHERE user_id=$1 AND coupon_type='upgrade'`, [rewardMember.id])).rows[0].count), 3,
  'a later count change never reissues an already-earned milestone coupon');

  const nonSandboxApp = buildApp({ ...testConfig, demoSandboxEnabled: false });
  try {
    const disabled = await nonSandboxApp.inject({ method: 'GET', url: '/member-coupons/me',
      headers: { authorization: `Bearer ${buyer.token}` } });
    check(disabled.statusCode, 404, 'member coupon wallet requires the explicit sandbox flag');
  } finally {
    await nonSandboxApp.close();
  }

  console.info(`Member coupon sandbox acceptance passed (${assertions} assertions).`);
} finally {
  await app.close().catch(() => {});
  const cleanupOrders = new Set(orders);
  const cleanupHolds = new Set(holdIds);
  if (users.length && departures.length) {
    const orderRows = await pool.query(
      `SELECT id FROM booking_orders WHERE buyer_user_id=ANY($1::uuid[]) AND departure_id=ANY($2::uuid[])`,
      [users, departures],
    ).catch(() => ({ rows: [] }));
    const holdRows = await pool.query(
      `SELECT id FROM seat_holds WHERE user_id=ANY($1::uuid[]) AND departure_id=ANY($2::uuid[])`,
      [users, departures],
    ).catch(() => ({ rows: [] }));
    for (const row of orderRows.rows) cleanupOrders.add(row.id);
    for (const row of holdRows.rows) cleanupHolds.add(row.id);
  }
  const cleanupOrderIds = [...cleanupOrders];
  const cleanupHoldIds = [...cleanupHolds];
  if (cleanupOrderIds.length) {
    await pool.query(`UPDATE booking_orders SET hold_id=NULL WHERE id=ANY($1::uuid[])`, [cleanupOrderIds]).catch(() => {});
    if (cleanupHoldIds.length) {
      await pool.query(`UPDATE seat_holds SET order_id=NULL WHERE id=ANY($1::uuid[])`, [cleanupHoldIds]).catch(() => {});
    }
    await pool.query(`DELETE FROM coupon_redemption_attempt_facts WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM coupon_ledger_events WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM member_reward_facts WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM order_coupon_redemptions WHERE order_id=ANY($1::uuid[])`, [cleanupOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM refund_obligations WHERE order_id=ANY($1::uuid[])`, [cleanupOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM passenger_insurance_coverages WHERE order_id=ANY($1::uuid[])`, [cleanupOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM insurance_policies WHERE order_id=ANY($1::uuid[])`, [cleanupOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM order_passengers WHERE order_id=ANY($1::uuid[])`, [cleanupOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM booking_order_seats WHERE order_id=ANY($1::uuid[])`, [cleanupOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM f_compensation_coupon_ledger WHERE source_order_id=ANY($1::uuid[])`, [cleanupOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM booking_orders WHERE id=ANY($1::uuid[])`, [cleanupOrderIds]).catch(() => {});
  }
  if (couponIds.length) await pool.query(`DELETE FROM member_coupons WHERE id=ANY($1::uuid[])`, [couponIds]).catch(() => {});
  if (fCouponIds.length) await pool.query(`DELETE FROM f_compensation_coupon_ledger WHERE id=ANY($1::uuid[])`, [fCouponIds]).catch(() => {});
  if (users.length) {
    await pool.query(`DELETE FROM coupon_redemption_attempt_facts WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM member_reward_facts WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM coupon_ledger_events WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM order_coupon_redemptions WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM member_coupons WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM member_reward_accounts WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM departure_checkins WHERE captain_user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM user_sessions WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
  }
  if (departures.length) {
    if (cleanupHoldIds.length) {
      await pool.query(`DELETE FROM seat_hold_items WHERE hold_id=ANY($1::uuid[])`, [cleanupHoldIds]).catch(() => {});
      await pool.query(`DELETE FROM seat_holds WHERE id=ANY($1::uuid[])`, [cleanupHoldIds]).catch(() => {});
    }
    await pool.query(`DELETE FROM seat_inventory WHERE departure_id=ANY($1::uuid[])`, [departures]).catch(() => {});
    await pool.query(`DELETE FROM departures WHERE id=ANY($1::uuid[])`, [departures]).catch(() => {});
  }
  if (boats.length) await pool.query(`DELETE FROM boats WHERE id=ANY($1::uuid[])`, [boats]).catch(() => {});
  if (users.length) {
    await pool.query(`DELETE FROM captain_profiles WHERE user_id=ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [users]).catch(() => {});
  }
  if (seatIds.length) {
    const redis = createClient({ url: config.redisUrl });
    try {
      await redis.connect();
      await redis.del(seatIds.map((id) => `fishing:step3:seat:${id}`));
    } catch {
      // Acceptance seat keys have a ten-minute TTL if the ephemeral Redis is unavailable.
    } finally {
      if (redis.isOpen) await redis.quit().catch(() => {});
    }
  }
  await pool.end();
}
