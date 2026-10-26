import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createSecurity, makeSandboxIdentityNumber } from '../src/security.js';

if (process.env.STEP6_PROMOTION_ACCEPTANCE !== 'true') {
  throw new Error('Set STEP6_PROMOTION_ACCEPTANCE=true and use an isolated acceptance database.');
}
if (!config.databaseUrl || !config.redisUrl) {
  throw new Error('DATABASE_URL and REDIS_URL are required.');
}

const testConfig = {
  ...config,
  nodeEnv: 'test',
  logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
  adminPassword: 'step6-promotion-acceptance-admin',
  piiEncryptionKeyHex: config.piiEncryptionKeyHex || '11'.repeat(32),
  phoneHashKeyHex: config.phoneHashKeyHex || '22'.repeat(32),
  paymentSandboxSecretHex: config.paymentSandboxSecretHex || '33'.repeat(32),
  promotionPublicBaseUrl: 'https://promotion.acceptance.invalid',
};
const security = createSecurity(testConfig);
const { Pool } = pg;
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
const app = buildApp(testConfig);
let sequence = 0;
let assertions = 0;

function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}

async function request(method, path, token, payload, adminPassword = null, extraHeaders = {}) {
  const response = await app.inject({
    method,
    url: path,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(adminPassword ? { 'x-admin-password': adminPassword } : {}),
      ...extraHeaders,
    },
    ...(payload === undefined ? {} : { payload }),
  });
  const contentType = response.headers['content-type'] ?? '';
  return {
    status: response.statusCode,
    body: contentType.includes('application/json') ? response.json() : response.body,
    headers: response.headers,
  };
}

async function expect(method, path, token, payload, status = 200, adminPassword = null) {
  const response = await request(method, path, token, payload, adminPassword);
  check(response.status, status, `${method} ${path}`);
  return response;
}

async function scalar(sql, values = []) {
  return (await pool.query(sql, values)).rows[0];
}

async function makeUser(name, { captain = false } = {}) {
  sequence += 1;
  const id = randomUUID();
  const phone = `139${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const token = security.newToken();
  await pool.query(
    `INSERT INTO users (id,phone_ciphertext,phone_hash,display_name)
     VALUES ($1,$2,$3,$4)`,
    [id, security.encrypt(phone), security.phoneHash(phone), name],
  );
  await pool.query(
    `INSERT INTO user_sessions (token_hash,user_id,expires_at)
     VALUES ($1,$2,now()+interval '2 days')`, [security.tokenHash(token), id],
  );
  if (captain) {
    await pool.query(
      `INSERT INTO captain_profiles (user_id,captain_name,verification_status,verified_at)
       VALUES ($1,$2,'approved',now())`, [id, name],
    );
  }
  return { id, token };
}

async function verifyIdentity(user, suffix = null) {
  const sequenceValue = suffix ?? String(sequence + 1).padStart(3, '0');
  return expect('POST', '/identity', user.token, {
    legalName: '海钓验收用户',
    identityNumber: makeSandboxIdentityNumber(sequenceValue),
  }, 200);
}

async function makeDeparture(captain, hoursUntilDeparture, ticketFen = 10_000) {
  const boatId = randomUUID();
  const departureId = randomUUID();
  const departureAt = new Date(Date.now() + hoursUntilDeparture * 3_600_000);
  await pool.query(
    `INSERT INTO boats (id,captain_user_id,name,length_cm,home_marina_code,seat_count,review_status)
     VALUES ($1,$2,$3,900,'xiaogang',12,'approved')`,
    [boatId, captain.id, `推广验收船${sequence}`],
  );
  await pool.query(
    `INSERT INTO departures
       (id,boat_id,captain_user_id,trip_type,departure_at,meeting_at,return_at,target_area_code,
        marina_code,minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,$3,'pro_fishing',$4::timestamptz,$4::timestamptz-interval '30 minutes',
        $4::timestamptz+interval '6 hours','qd_coast','xiaogang',10000,$5,
        $4::timestamptz-interval '45 minutes','open',12,12,0,false)`,
    [departureId, boatId, captain.id, departureAt, ticketFen],
  );
  const seat = (await pool.query(
    `INSERT INTO seat_inventory
       (departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,1,$2,'port','mid','available','platform') RETURNING id,seat_number,price_fen`,
    [departureId, ticketFen],
  )).rows[0];
  return { id: departureId, seat, departureAt };
}

async function makePaidOrder(buyer, captain, hoursUntilDeparture = 72, ticketFen = 10_000) {
  const departure = await makeDeparture(captain, hoursUntilDeparture, ticketFen);
  const hold = await expect(
    'POST', `/departures/${departure.id}/seat-holds`, buyer.token,
    { seatIds: [departure.seat.id] }, 201,
  );
  const orderResult = await expect('POST', '/orders', buyer.token, {
    holdId: hold.body.holdId,
    idempotencyKey: `step6-${randomUUID()}`,
    passengers: [{
      seatId: departure.seat.id,
      fullName: '海钓验收乘客',
      identityNumber: makeSandboxIdentityNumber(String((sequence % 900) + 1).padStart(3, '0')),
      phone: `138${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
    }],
  }, 201);
  const orderId = orderResult.body.order.id;
  await expect('POST', `/orders/${orderId}/payment-intents`, buyer.token, {}, 201);
  const paid = await expect('POST', `/orders/${orderId}/sandbox-payment`, buyer.token,
    { outcome: 'success' }, 200);
  check(paid.body.paymentStatus, 'succeeded', 'sandbox payment callback settles successfully');
  return { ...departure, orderId };
}

async function getCode(user, channel = 'member') {
  if (channel === 'member') {
    const dashboard = await expect('GET', '/promotions/me', user.token, undefined, 200);
    const code = dashboard.body.codes.find((item) => item.channel === 'member');
    assert.ok(code?.code, 'member dashboard returns an automatic promotion code');
    assertions += 1;
    return code;
  }
  const result = await expect('POST', '/promotions/codes', user.token, { channel }, 201);
  return result.body.code;
}

async function scan(code, cookie = null) {
  const response = await request('GET', `/p/${code}?source=qr`, null, undefined,
    null, cookie ? { cookie } : {});
  const cookieHeader = response.headers['set-cookie'];
  const html = String(response.body);
  const visitorToken = html.match(/ref=([A-Za-z0-9_.-]+)/)?.[1];
  assert.ok(visitorToken, 'H5 landing page includes the signed visitor referral token');
  assertions += 1;
  return {
    status: response.status,
    visitorToken,
    cookie: cookie ?? String(cookieHeader ?? '').split(';')[0],
    html,
  };
}

async function claim(user, visitorToken) {
  return expect('POST', '/promotions/attribution/claim', user.token, { visitorToken }, 200);
}

try {
  await app.ready();
  const captain = await makeUser('验收船长', { captain: true });
  const referrer = await makeUser('一级推广员');
  const secondReferrer = await makeUser('第二位推广员');
  const firstCode = await getCode(referrer);
  const secondCode = await getCode(secondReferrer);
  check(firstCode.status, 'active', 'member code activates automatically');

  const guest = await makeUser('首次归因会员');
  const firstScan = await scan(firstCode.code);
  const repeatedScan = await request('GET', `/p/${firstCode.code}?source=link`, null, undefined,
    null, { cookie: firstScan.cookie });
  check(repeatedScan.status, 200, 'repeated H5 scan returns the landing page');
  const secondScan = await scan(secondCode.code, firstScan.cookie);
  check(secondScan.status, 200, 'later scan of a second code returns the landing page');
  const scanned = await scalar(
    `SELECT count(*)::integer AS count FROM promotion_touch_events
     WHERE visitor_key_hash=$1`, [security.promotionVisitorHash(security.promotionVisitorId(firstScan.visitorToken))],
  );
  check(scanned.count, 2, 'repeat scans of one code deduplicate while a later code is recorded');
  check(firstScan.html.includes('yuediaozhe://promotion'), true, 'H5 offers the app deep link');
  const firstClaim = await claim(guest, firstScan.visitorToken);
  check(firstClaim.body.claimed, true, 'first valid referral is claimed');
  check(firstClaim.body.promotionCode, firstCode.code, 'earliest scanned valid code wins');
  const secondClaim = await claim(guest, firstScan.visitorToken);
  check(secondClaim.body.claimed, false, 'repeat claims cannot create a second attribution');
  check(secondClaim.body.reason, 'already_attributed', 'repeat claim reports existing attribution');
  check((await scalar(
    `SELECT c.code FROM promotion_attributions a JOIN promotion_codes c ON c.id=a.promotion_code_id
     WHERE a.attributed_user_id=$1`, [guest.id],
  )).code, firstCode.code, 'later code does not replace first attribution');

  const selfOwner = await makeUser('自推排除用户');
  const selfCode = await getCode(selfOwner);
  const selfScan = await scan(selfCode.code);
  const selfClaim = await claim(selfOwner, selfScan.visitorToken);
  check(selfClaim.body.reason, 'self_referral', 'self referral is excluded');
  check((await scalar('SELECT count(*)::integer AS count FROM promotion_attributions WHERE attributed_user_id=$1',
    [selfOwner.id])).count, 0, 'self referral creates no attribution or commission');

  await verifyIdentity(guest, '101');
  const paidTrip = await makePaidOrder(guest, captain, 72, 10_000);
  let commission = await scalar(
    `SELECT l.id,l.status,l.amount_fen,l.net_ticket_amount_fen,a.order_id
     FROM commission_ledger l JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     WHERE a.attributed_user_id=$1`, [guest.id],
  );
  check(commission.status, 'frozen', 'successful first payment creates a frozen commission');
  check(Number(commission.amount_fen), 500, 'commission is five percent of the net ticket amount');
  check(Number(commission.net_ticket_amount_fen), 10_000, 'platform fee is excluded from commission basis');
  check(commission.order_id, paidTrip.orderId, 'commission traces to the first paid order');

  await pool.query('UPDATE booking_orders SET ticket_refunded_fen=2000 WHERE id=$1', [paidTrip.orderId]);
  await expect('GET', '/promotions/me', guest.token, undefined, 200);
  commission = await scalar('SELECT id,status,amount_fen,net_ticket_amount_fen FROM commission_ledger WHERE id=$1',
    [commission.id]);
  check(Number(commission.amount_fen), 400, 'partial refund recalculates five percent from net ticket');
  check(Number(commission.net_ticket_amount_fen), 8_000, 'partial refund reduces net ticket amount');

  await pool.query('UPDATE departures SET status=\'in_progress\' WHERE id=$1', [paidTrip.id]);
  const returned = await expect('POST', `/captain/departures/${paidTrip.id}/checkin`, captain.token,
    { event: 'returned' }, 200);
  check(returned.body.status, 'completed', 'captain return check-in completes the trip');
  check((await scalar('SELECT status FROM commission_ledger WHERE id=$1', [commission.id])).status,
    'pending_unlock', 'trip completion starts the seven-day unlock period');
  await pool.query('UPDATE commission_ledger SET release_at=now()-interval \'1 second\' WHERE id=$1',
    [commission.id]);
  const matureDashboard = await expect('GET', '/promotions/me', referrer.token, undefined, 200);
  check(matureDashboard.body.commissions[0].status, 'available', 'dashboard releases a matured commission');
  check(matureDashboard.body.commissions[0].amountFen, 400, 'matured commission keeps the refund-adjusted amount');
  await expect('POST', '/promotions/payout-requests', referrer.token,
    { commissionLedgerIds: [commission.id] }, 201);
  check((await scalar('SELECT status FROM commission_ledger WHERE id=$1', [commission.id])).status,
    'withdrawal_pending', 'payout request reserves only available commission');
  const payout = (await scalar('SELECT id FROM promotion_payout_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
    [referrer.id])).id;
  await expect('POST', `/admin/promotions/payout-requests/${payout}/decision`, null,
    { decision: 'approved', note: 'sandbox acceptance' }, 200, testConfig.adminPassword);
  await expect('POST', `/admin/promotions/payout-requests/${payout}/decision`, null,
    { decision: 'paid_marked', note: 'sandbox only' }, 200, testConfig.adminPassword);
  check((await scalar('SELECT status FROM commission_ledger WHERE id=$1', [commission.id])).status,
    'paid', 'sandbox payout mark moves the ledger to paid');
  await pool.query('UPDATE booking_orders SET ticket_refunded_fen=10000 WHERE id=$1', [paidTrip.orderId]);
  await expect('GET', '/promotions/me', guest.token, undefined, 200);
  const afterReleaseRefund = await scalar(
    'SELECT status,amount_fen,refund_after_release FROM commission_ledger WHERE id=$1', [commission.id],
  );
  check(afterReleaseRefund.refund_after_release, true, 'post-release refund is recorded as an exception');
  check(Number(afterReleaseRefund.amount_fen), 400, 'post-release refund does not claw back sandbox payout');

  const hotelCode = await getCode(referrer, 'hotel');
  check(hotelCode.status, 'pending', 'business channel code waits for review');
  check(hotelCode.landingUrl, null, 'pending business code cannot be used for scans');
  await expect('GET', `/p/${hotelCode.code}`, null, undefined, 404);
  const decision = await expect('POST', `/admin/promotions/codes/${hotelCode.id}/decision`, null,
    { decision: 'approved', note: 'acceptance approved' }, 200, testConfig.adminPassword);
  check(decision.body.code.status, 'active', 'approved business code becomes active');
  const captainCode = await getCode(captain, 'captain');
  check(captainCode.status, 'active', 'approved captain can request a captain code');

  const noSaleVerified = await makeUser('实名未成交');
  const noSaleScan = await scan(firstCode.code);
  await claim(noSaleVerified, noSaleScan.visitorToken);
  await verifyIdentity(noSaleVerified, '102');
  await expect('GET', '/promotions/me', noSaleVerified.token, undefined, 200);
  check((await scalar('SELECT count(*)::integer AS count FROM commission_ledger l JOIN promotion_attributions a ON a.id=l.promotion_attribution_id WHERE a.attributed_user_id=$1',
    [noSaleVerified.id])).count, 0, 'identity and scan without a paid first order create no commission');

  const unverifiedPaid = await makeUser('未实名成交排除');
  const unverifiedScan = await scan(firstCode.code);
  await claim(unverifiedPaid, unverifiedScan.visitorToken);
  const unverifiedDeparture = await makeDeparture(captain, 72, 10_000);
  await pool.query(
    `INSERT INTO booking_orders (order_number,departure_id,seat_inventory_id,buyer_user_id,status,
       seat_fee_fen,total_amount_fen,paid_at)
     VALUES ($1,$2,$3,$4,'paid',10000,10000,now())`,
    [`S6U-${sequence}-${randomUUID().slice(0, 8)}`, unverifiedDeparture.id,
      unverifiedDeparture.seat.id, unverifiedPaid.id],
  );
  await expect('GET', '/promotions/me', unverifiedPaid.token, undefined, 200);
  check((await scalar('SELECT count(*)::integer AS count FROM commission_ledger l JOIN promotion_attributions a ON a.id=l.promotion_attribution_id WHERE a.attributed_user_id=$1',
    [unverifiedPaid.id])).count, 0, 'paid order without verified identity creates no commission');

  const duplicateIdentity = await makeUser('重复实名账号');
  const duplicateIdentityResponse = await request('POST', '/identity', duplicateIdentity.token, {
    legalName: '海钓验收用户', identityNumber: makeSandboxIdentityNumber('101'),
  });
  check(duplicateIdentityResponse.status, 409, 'same verified identity cannot qualify a second account');

  const existingBuyer = await makeUser('历史成交用户');
  await verifyIdentity(existingBuyer, '103');
  await makePaidOrder(existingBuyer, captain, 72, 10_000);
  const existingBuyerScan = await scan(firstCode.code);
  const existingBuyerClaim = await claim(existingBuyer, existingBuyerScan.visitorToken);
  check(existingBuyerClaim.body.qualificationStatus, 'existing_buyer', 'pre-attribution buyer is excluded');
  check((await scalar('SELECT count(*)::integer AS count FROM commission_ledger l JOIN promotion_attributions a ON a.id=l.promotion_attribution_id WHERE a.attributed_user_id=$1',
    [existingBuyer.id])).count, 0, 'existing buyer produces no commission');

  const fullRefundBuyer = await makeUser('全额退款用户');
  await verifyIdentity(fullRefundBuyer, '104');
  const fullRefundScan = await scan(firstCode.code);
  await claim(fullRefundBuyer, fullRefundScan.visitorToken);
  const fullRefundTrip = await makePaidOrder(fullRefundBuyer, captain, 96, 10_000);
  await expect('POST', `/orders/${fullRefundTrip.orderId}/cancel`, fullRefundBuyer.token, {}, 200);
  const fullRefundLedger = await scalar(
    `SELECT l.status,l.amount_fen,o.ticket_refunded_fen
     FROM commission_ledger l JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     JOIN booking_orders o ON o.id=a.order_id WHERE a.attributed_user_id=$1`, [fullRefundBuyer.id],
  );
  check(fullRefundLedger.status, 'reversed', 'full cancellation refund reverses the frozen commission');
  check(Number(fullRefundLedger.amount_fen), 0, 'full cancellation refund leaves no commission balance');
  check(Number(fullRefundLedger.ticket_refunded_fen), 10_000, 'full ticket refund is recorded separately from fees');

  const secondLevelBuyer = await makeUser('二级场景测试会员');
  await verifyIdentity(secondLevelBuyer, '105');
  const guestCode = await getCode(guest);
  const secondLevelScan = await scan(guestCode.code);
  await claim(secondLevelBuyer, secondLevelScan.visitorToken);
  const secondLevelTrip = await makePaidOrder(secondLevelBuyer, captain, 72, 10_000);
  const guestDirectLedger = await scalar(
    `SELECT l.payee_user_id,l.amount_fen,a.attributed_user_id
     FROM commission_ledger l JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     WHERE a.attributed_user_id=$1`, [secondLevelBuyer.id],
  );
  check(guestDirectLedger.payee_user_id, guest.id, 'second purchase pays only its direct referrer');
  check(guestDirectLedger.attributed_user_id, secondLevelBuyer.id, 'ledger remains tied to the direct attribution');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     WHERE a.attributed_user_id=$1 AND l.payee_user_id=$2`, [secondLevelBuyer.id, referrer.id],
  )).count, 0, 'no second-level commission is created');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN ('promotion_attributions','commission_ledger')
       AND column_name IN ('parent_attribution_id','commission_level','level')`,
  )).count, 0, 'schema contains no multi-level commission relationship fields');
  check((await scalar('SELECT status FROM booking_orders WHERE id=$1', [secondLevelTrip.orderId])).status,
    'paid', 'second-level acceptance fixture settled through sandbox payment');

  console.info(`Step 6 slice 1 promotion acceptance passed: ${assertions} assertions.`);
} finally {
  await app.close().catch(() => {});
  await pool.end().catch(() => {});
}
