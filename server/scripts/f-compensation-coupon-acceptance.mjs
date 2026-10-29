import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createSecurity } from '../src/security.js';

if (process.env.F_COMPENSATION_ACCEPTANCE !== 'true') {
  throw new Error('Set F_COMPENSATION_ACCEPTANCE=true and use an isolated acceptance database.');
}
if (!config.databaseUrl) throw new Error('DATABASE_URL is required.');

const { Pool } = pg;
const testConfig = {
  ...config,
  nodeEnv: 'test',
  redisUrl: undefined,
  demoSandboxEnabled: true,
  adminPassword: 'f-compensation-acceptance-admin',
  piiEncryptionKeyHex: config.piiEncryptionKeyHex || '11'.repeat(32),
  phoneHashKeyHex: config.phoneHashKeyHex || '22'.repeat(32),
};
const security = createSecurity(testConfig);
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
const app = buildApp(testConfig);
const testUsers = [];
const testDepartures = [];
const testOrders = [];
let assertions = 0;

function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}

async function requestOn(targetApp, method, path, {
  token = null, adminPassword = null, adminActor = null, payload,
} = {}) {
  const response = await targetApp.inject({
    method,
    url: path,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(adminPassword ? { 'x-admin-password': adminPassword } : {}),
      ...(adminActor ? { 'x-admin-actor': adminActor } : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  });
  return {
    status: response.statusCode,
    body: response.headers['content-type']?.includes('application/json')
      ? response.json() : response.body,
  };
}

async function request(method, path, options = {}) {
  return requestOn(app, method, path, options);
}

async function expect(method, path, options, status = 200) {
  const response = await request(method, path, options);
  check(response.status, status, `${method} ${path}: ${JSON.stringify(response.body)}`);
  return response;
}

async function makeUser(label) {
  const id = randomUUID();
  const token = security.newToken();
  await pool.query(
    `INSERT INTO users (id,phone_ciphertext,phone_hash,display_name)
     VALUES ($1,$2,$3,$4)`,
    [id, Buffer.from(`f-coupon:${id}`), randomBytes(32), label],
  );
  await pool.query(
    `INSERT INTO user_sessions (token_hash,user_id,expires_at)
     VALUES ($1,$2,now()+interval '2 days')`, [security.tokenHash(token), id],
  );
  testUsers.push(id);
  return { id, token };
}

async function makeDeparture(captain, status) {
  const boatId = randomUUID();
  const departureId = randomUUID();
  const departureAt = new Date(Date.now() + 72 * 3_600_000);
  await pool.query(
    `INSERT INTO captain_profiles (user_id,captain_name,verification_status,verified_at)
     VALUES ($1,$2,'approved',now()) ON CONFLICT (user_id) DO NOTHING`,
    [captain.id, `补偿券验收船长${testDepartures.length + 1}`],
  );
  await pool.query(
    `INSERT INTO boats (id,captain_user_id,name,length_cm,home_marina_code,seat_count,review_status)
     VALUES ($1,$2,$3,900,'xiaogang',12,'approved')`,
    [boatId, captain.id, `补偿券验收船${testDepartures.length + 1}`],
  );
  await pool.query(
    `INSERT INTO departures
       (id,boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,
        marina_code,minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,$3,'pro_fishing',$4::timestamptz,$4::timestamptz-interval '30 minutes',
        $4::timestamptz+interval '6 hours','qd_coast','xiaogang',10000,50000,
        $4::timestamptz-interval '45 minutes',$5,12,12,0,false)`,
    [departureId, boatId, captain.id, departureAt, status],
  );
  const seat = (await pool.query(
    `INSERT INTO seat_inventory
       (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,1,50000,'port','mid','available','platform') RETURNING id`, [departureId],
  )).rows[0];
  const departure = { id: departureId, boatId, seatId: seat.id };
  testDepartures.push(departure);
  return departure;
}

async function makeOrder(buyer, departure, {
  status = 'cancelled', paid = true, seatFeeFen = 50_000, discountFen = 1_000,
} = {}) {
  const id = randomUUID();
  const platformFeeFen = 3_000;
  const totalAmountFen = seatFeeFen - discountFen + platformFeeFen;
  await pool.query(
    `INSERT INTO booking_orders
       (id,order_number,departure_id,seat_inventory_id,buyer_user_id,status,
        seat_fee_fen,discount_fen,platform_fee_fen,total_amount_fen,paid_at,cancelled_at,
        ticket_refunded_fen,cancelled_refund_fen,cancellation_penalty_fen)
     VALUES ($1,$2,$3,$4,$5,$6::varchar(24),$7,$8,$9,$10,
        CASE WHEN $11::boolean THEN now() ELSE NULL END,
        CASE WHEN $6::varchar(24)='cancelled' THEN now() ELSE NULL END,3000,3500,0)`,
    [id, `FC-${id}`, departure.id, departure.seatId, buyer.id, status,
      seatFeeFen, discountFen, platformFeeFen, totalAmountFen, paid],
  );
  testOrders.push(id);
  return id;
}

async function countCoupons(orderId) {
  return Number((await pool.query(
    'SELECT count(*)::integer AS count FROM f_compensation_coupon_ledger WHERE source_order_id=$1',
    [orderId],
  )).rows[0].count);
}

try {
  await app.ready();
  const captain = await makeUser('补偿券验收船长账户');
  const buyer = await makeUser('补偿券验收乘客账户');
  const other = await makeUser('补偿券其他乘客账户');

  const captainCancelled = await makeDeparture(captain, 'cancelled');
  const captainOrderId = await makeOrder(buyer, captainCancelled);
  const captainPayload = {
    orderId: captainOrderId,
    sourceEventKey: `captain-${randomUUID()}`,
    scenario: 'captain_non_weather_cancel',
    issueNote: '船长非天气原因取消，沙盒核验记录',
  };
  const issued = await expect('POST', '/admin/f-compensation-coupons/issue', {
    adminPassword: testConfig.adminPassword,
    adminActor: 'f_coupon_acceptance',
    payload: captainPayload,
  }, 201);
  check(issued.body.coupon.ticketPaidFen, 49_000,
    'basis is paid ship fare after ticket discount and excludes platform fee');
  check(issued.body.coupon.amountFen, 1_470, '500 yuan net paid ship fare gives 3 percent voucher');
  check(issued.body.coupon.responsibleParty, 'captain_guarantee', 'captain cancellation is booked to guarantee account');
  check(issued.body.coupon.issuedBy, 'f_coupon_acceptance', 'issue actor is retained for audit');
  check(await countCoupons(captainOrderId), 1, 'one subsidy ledger row is created');

  const expiry = await pool.query(
    `SELECT expires_at = issued_at + interval '1 year' AS one_year,
            ticket_paid_fen,amount_fen FROM f_compensation_coupon_ledger WHERE source_order_id=$1`,
    [captainOrderId],
  );
  check(expiry.rows[0].one_year, true, 'expiry is one calendar year after issuance');
  check(Number(expiry.rows[0].amount_fen), 1_470, 'database enforces the 3 percent formula');
  const refundState = await pool.query(
    `SELECT ticket_refunded_fen,cancelled_refund_fen,cancellation_penalty_fen
       FROM booking_orders WHERE id=$1`, [captainOrderId],
  );
  check(refundState.rows[0], {
    ticket_refunded_fen: 3_000,
    cancelled_refund_fen: 3_500,
    cancellation_penalty_fen: 0,
  }, 'voucher issuance does not change cash refund or cancellation accounting');

  const replay = await expect('POST', '/admin/f-compensation-coupons/issue', {
    adminPassword: testConfig.adminPassword,
    payload: captainPayload,
  }, 200);
  check(replay.body.coupon.id, issued.body.coupon.id, 'same source event replays the existing coupon');
  check(replay.body.coupon.replayed, true, 'idempotent replay is explicit');
  check(await countCoupons(captainOrderId), 1, 'replay does not duplicate the subsidy ledger row');

  const conflictingReplay = await expect('POST', '/admin/f-compensation-coupons/issue', {
    adminPassword: testConfig.adminPassword,
    payload: { ...captainPayload, scenario: 'platform_attributable_failure' },
  }, 409);
  check(conflictingReplay.body.error, '该事件已用不同口径登记，不能覆盖原补偿账',
    'idempotency key cannot be reused with another responsibility');

  const ownWallet = await expect('GET', '/compensation-coupons/me', { token: buyer.token });
  check(ownWallet.body.items.length, 1, 'beneficiary sees the issued coupon');
  check(ownWallet.body.items[0].status, 'available', 'unexpired coupon is available');
  const otherWallet = await expect('GET', '/compensation-coupons/me', { token: other.token });
  check(otherWallet.body.items.length, 0, 'coupon is private to the beneficiary account');
  await expect('GET', '/compensation-coupons/me', {}, 401);

  const platformDeparture = await makeDeparture(captain, 'open');
  const platformOrderId = await makeOrder(buyer, platformDeparture);
  const platformIssued = await expect('POST', '/admin/f-compensation-coupons/issue', {
    adminPassword: testConfig.adminPassword,
    payload: {
      orderId: platformOrderId,
      sourceEventKey: `platform-${randomUUID()}`,
      scenario: 'platform_attributable_failure',
      issueNote: '平台可归责故障导致订单取消，沙盒核验记录',
    },
  }, 201);
  check(platformIssued.body.coupon.responsibleParty, 'platform', 'platform fault is booked to platform account');

  const weatherDeparture = await makeDeparture(captain, 'weather_cancelled');
  const weatherOrderId = await makeOrder(buyer, weatherDeparture);
  await expect('POST', '/admin/f-compensation-coupons/issue', {
    adminPassword: testConfig.adminPassword,
    payload: {
      orderId: weatherOrderId,
      sourceEventKey: `weather-${randomUUID()}`,
      scenario: 'captain_non_weather_cancel',
      issueNote: '天气停航不得发 F 券',
    },
  }, 409);
  check(await countCoupons(weatherOrderId), 0, 'weather cancellation creates no F voucher');

  await expect('POST', '/admin/f-compensation-coupons/issue', {
    adminPassword: testConfig.adminPassword,
    payload: {
      orderId: captainOrderId,
      sourceEventKey: `insurer-${randomUUID()}`,
      scenario: 'insurer_decline',
      issueNote: '保险公司拒保不发 F 券',
    },
  }, 400);
  await expect('POST', '/admin/f-compensation-coupons/issue', {
    adminPassword: 'wrong-password',
    payload: { ...captainPayload, sourceEventKey: `bad-auth-${randomUUID()}` },
  }, 401);

  const pendingDeparture = await makeDeparture(captain, 'cancelled');
  const pendingOrderId = await makeOrder(buyer, pendingDeparture, { paid: false });
  await expect('POST', '/admin/f-compensation-coupons/issue', {
    adminPassword: testConfig.adminPassword,
    payload: {
      orderId: pendingOrderId,
      sourceEventKey: `unpaid-${randomUUID()}`,
      scenario: 'captain_non_weather_cancel',
      issueNote: '未支付订单不具备补偿资格',
    },
  }, 409);
  check(await countCoupons(pendingOrderId), 0, 'unpaid order gets no F voucher');

  const captainOpenDeparture = await makeDeparture(captain, 'open');
  const captainOpenOrderId = await makeOrder(buyer, captainOpenDeparture);
  await expect('POST', '/admin/f-compensation-coupons/issue', {
    adminPassword: testConfig.adminPassword,
    payload: {
      orderId: captainOpenOrderId,
      sourceEventKey: `captain-open-${randomUUID()}`,
      scenario: 'captain_non_weather_cancel',
      issueNote: '船长原因取消要求班次确已取消',
    },
  }, 409);
  check(await countCoupons(captainOpenOrderId), 0, 'captain cancellation voucher requires a cancelled departure');

  const disabledApp = buildApp({ ...testConfig, demoSandboxEnabled: false });
  try {
    const disabledSandbox = await requestOn(disabledApp, 'POST', '/admin/f-compensation-coupons/issue', {
      adminPassword: testConfig.adminPassword,
      payload: captainPayload,
    });
    check(disabledSandbox.status, 404, 'F issuance endpoint requires the explicit sandbox flag');
  } finally {
    await disabledApp.close();
  }
  const productionApp = buildApp({ ...testConfig, nodeEnv: 'production' });
  try {
    const disabledProduction = await requestOn(productionApp, 'POST', '/admin/f-compensation-coupons/issue', {
      adminPassword: testConfig.adminPassword,
      payload: captainPayload,
    });
    check(disabledProduction.status, 404, 'F issuance endpoint stays disabled in production');
  } finally {
    await productionApp.close();
  }

  console.info(`F compensation coupon acceptance passed (${assertions} assertions).`);
} finally {
  await app.close().catch(() => {});
  if (testOrders.length) {
    await pool.query(
      `DELETE FROM coupon_ledger_events
       WHERE f_coupon_id IN (
         SELECT id FROM f_compensation_coupon_ledger WHERE source_order_id=ANY($1::uuid[])
       )`, [testOrders],
    );
    await pool.query('DELETE FROM f_compensation_coupon_ledger WHERE source_order_id=ANY($1::uuid[])', [testOrders]);
    await pool.query('DELETE FROM booking_orders WHERE id=ANY($1::uuid[])', [testOrders]);
  }
  if (testDepartures.length) {
    const departureIds = testDepartures.map((row) => row.id);
    const boatIds = testDepartures.map((row) => row.boatId);
    await pool.query('DELETE FROM seat_inventory WHERE departure_id=ANY($1::uuid[])', [departureIds]);
    await pool.query('DELETE FROM departures WHERE id=ANY($1::uuid[])', [departureIds]);
    await pool.query('DELETE FROM boats WHERE id=ANY($1::uuid[])', [boatIds]);
  }
  if (testUsers.length) {
    await pool.query('DELETE FROM captain_profiles WHERE user_id=ANY($1::uuid[])', [testUsers]);
    await pool.query('DELETE FROM user_sessions WHERE user_id=ANY($1::uuid[])', [testUsers]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [testUsers]);
  }
  await pool.end();
}
