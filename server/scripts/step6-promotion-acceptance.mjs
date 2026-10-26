import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
const execFileAsync = promisify(execFile);
const migrationScriptPath = fileURLToPath(new URL('../src/migrate.js', import.meta.url));
const serverWorkingDirectory = fileURLToPath(new URL('../', import.meta.url));
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
  check(response.status, status, `${method} ${path}: ${JSON.stringify(response.body)}`);
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
    'SELECT count(*)::integer AS count FROM promotion_attributions WHERE attributed_user_id=$1',
    [guest.id],
  )).count, 1, 'duplicate claim leaves exactly one persisted attribution');
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
  await pool.query(
    'DELETE FROM promotion_identity_qualifications WHERE user_id=$1', [guest.id],
  );
  const concurrentIdentitySyncs = await Promise.all([
    expect('GET', '/promotions/me', guest.token, undefined, 200),
    expect('GET', '/promotions/me', guest.token, undefined, 200),
  ]);
  check(concurrentIdentitySyncs.length, 2,
    'concurrent real promotion API requests both complete qualification synchronization');
  check((await scalar(
    'SELECT count(*)::integer AS count FROM promotion_identity_qualifications WHERE user_id=$1',
    [guest.id],
  )).count, 1,
  'concurrent API qualification synchronization creates one identity-consumption fact');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     WHERE a.attributed_user_id=$1`, [guest.id],
  )).count, 1,
  'concurrent API qualification synchronization retains one commission ledger');
  const consumedIdentity = makeSandboxIdentityNumber('101');
  const identityQualification = await scalar(
    `SELECT user_id,promotion_attribution_id,identity_number_hash
     FROM promotion_identity_qualifications WHERE user_id=$1`, [guest.id],
  );
  check(identityQualification.user_id, guest.id, 'first paid qualification consumes its verified identity');
  check(identityQualification.promotion_attribution_id,
    (await scalar('SELECT id FROM promotion_attributions WHERE attributed_user_id=$1', [guest.id])).id,
    'identity consumption is tied to the original attribution');
  check(identityQualification.identity_number_hash.toString('hex'), security.identityHash(consumedIdentity).toString('hex'),
    'identity consumption stores only the HMAC digest');

  await verifyIdentity(guest, '106');
  check((await scalar('SELECT identity_number_hash FROM promotion_identity_qualifications WHERE user_id=$1',
    [guest.id])).identity_number_hash.toString('hex'), security.identityHash(consumedIdentity).toString('hex'),
  'identity correction does not replace the consumed identity fact');

  const secondPaidTrip = await makePaidOrder(guest, captain, 96, 12_000);
  check((await scalar(
    'SELECT count(*)::integer AS count FROM commission_ledger WHERE promotion_attribution_id=(SELECT id FROM promotion_attributions WHERE attributed_user_id=$1)',
    [guest.id],
  )).count, 1, 'a normal second paid order does not create another commission ledger');
  check((await scalar('SELECT order_id FROM promotion_attributions WHERE attributed_user_id=$1',
    [guest.id])).order_id, paidTrip.orderId, 'the earliest eligible order remains selected after a second payment');

  const reusedIdentityBuyer = await makeUser('历史实名资格复用排除');
  const reusedIdentityScan = await scan(firstCode.code);
  await claim(reusedIdentityBuyer, reusedIdentityScan.visitorToken);
  await verifyIdentity(reusedIdentityBuyer, '101');
  await makePaidOrder(reusedIdentityBuyer, captain, 72, 10_000);
  await expect('GET', '/promotions/me', reusedIdentityBuyer.token, undefined, 200);
  check((await scalar('SELECT qualification_status FROM promotion_attributions WHERE attributed_user_id=$1',
    [reusedIdentityBuyer.id])).qualification_status, 'identity_already_qualified',
  'an identity used for another buyers first commission is rejected after its owner corrects theirs');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     WHERE a.attributed_user_id=$1`, [reusedIdentityBuyer.id],
  )).count, 0, 'reused identity cannot create a second commission ledger');

  const raceIdentityA = await makeUser('身份资格竞争甲');
  const raceIdentityB = await makeUser('身份资格竞争乙');
  const raceScanA = await scan(firstCode.code);
  const raceScanB = await scan(secondCode.code);
  await claim(raceIdentityA, raceScanA.visitorToken);
  await claim(raceIdentityB, raceScanB.visitorToken);
  const raceAttributions = await pool.query(
    `SELECT attributed_user_id,id FROM promotion_attributions
     WHERE attributed_user_id=ANY($1::uuid[]) ORDER BY attributed_user_id`,
    [[raceIdentityA.id, raceIdentityB.id]],
  );
  const raceHash = Buffer.alloc(32, 0x7f);
  const competingIdentityClaims = await Promise.all(raceAttributions.rows.map((row) => pool.query(
    `INSERT INTO promotion_identity_qualifications
       (identity_number_hash,user_id,promotion_attribution_id)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id`,
    [raceHash, row.attributed_user_id, row.id],
  )));
  check(competingIdentityClaims.reduce((sum, result) => sum + result.rowCount, 0), 1,
    'concurrent qualifications for one identity HMAC have a single database winner');
  check((await scalar('SELECT count(*)::integer AS count FROM promotion_identity_qualifications WHERE identity_number_hash=$1',
    [raceHash])).count, 1, 'database identity uniqueness holds after a concurrent qualification race');

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
  let returnedAt = (await scalar(
    `SELECT checked_at FROM departure_checkins WHERE departure_id=$1 AND event='returned'`, [paidTrip.id],
  )).checked_at;
  const exactReleaseAt = new Date(new Date(returnedAt).getTime() + 7 * 86_400_000);
  check(new Date((await scalar('SELECT release_at FROM commission_ledger WHERE id=$1', [commission.id])).release_at).getTime(),
    exactReleaseAt.getTime(), 'release deadline is exactly return time plus seven days');
  returnedAt = new Date(Date.now() - 7 * 86_400_000 + 60_000);
  await pool.query(
    `UPDATE departure_checkins SET checked_at=$2 WHERE departure_id=$1 AND event='returned'`,
    [paidTrip.id, returnedAt],
  );
  await expect('GET', '/promotions/me', guest.token, undefined, 200);
  let beforeBoundary = await scalar('SELECT status,release_at,release_refund_baseline_fen FROM commission_ledger WHERE id=$1',
    [commission.id]);
  check(beforeBoundary.status, 'pending_unlock', 'commission remains locked just before the seven-day boundary');
  check(new Date(beforeBoundary.release_at).getTime(), returnedAt.getTime() + 7 * 86_400_000,
    'release time follows the returned check-in fixture');
  await expect('GET', '/promotions/me', guest.token, undefined, 200);
  check((await scalar(`SELECT count(*)::integer AS count FROM promotion_commission_events
    WHERE commission_ledger_id=$1 AND event_type='refund_after_release_exception'`, [commission.id])).count,
  0, 'pre-release partial refund does not create an exception during repeated sync');

  returnedAt = new Date(Date.now() - 7 * 86_400_000 - 60_000);
  await pool.query(
    `UPDATE departure_checkins SET checked_at=$2 WHERE departure_id=$1 AND event='returned'`,
    [paidTrip.id, returnedAt],
  );
  await expect('GET', '/promotions/me', guest.token, undefined, 200);
  const matureDashboard = await expect('GET', '/promotions/me', referrer.token, undefined, 200);
  check(matureDashboard.body.commissions[0].status, 'available', 'dashboard releases a matured commission');
  check(matureDashboard.body.commissions[0].amountFen, 400, 'matured commission keeps the refund-adjusted amount');
  const releasedLedger = await scalar(
    'SELECT release_refund_baseline_fen,refund_after_release FROM commission_ledger WHERE id=$1', [commission.id],
  );
  check(Number(releasedLedger.release_refund_baseline_fen), 2_000,
    'release snapshots the refund total accumulated before release');
  check(releasedLedger.refund_after_release, false, 'releasing with an earlier partial refund is not an exception');
  const payoutAttempts = await Promise.all([
    request('POST', '/promotions/payout-requests', referrer.token, { commissionLedgerIds: [commission.id] }),
    request('POST', '/promotions/payout-requests', referrer.token, { commissionLedgerIds: [commission.id] }),
  ]);
  check(payoutAttempts.filter((response) => response.status === 201).length, 1,
    'concurrent payout requests reserve an available ledger once');
  check(payoutAttempts.filter((response) => response.status === 409).length, 1,
    'the losing concurrent payout request is rejected');
  const wrongPayeePayout = await request('POST', '/promotions/payout-requests', guest.token,
    { commissionLedgerIds: [commission.id] });
  check(wrongPayeePayout.status, 409, 'another payee cannot request payout against this ledger');
  check((await scalar('SELECT status FROM commission_ledger WHERE id=$1', [commission.id])).status,
    'withdrawal_pending', 'payout request reserves only available commission');
  let payout = (await scalar('SELECT id FROM promotion_payout_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
    [referrer.id])).id;
  check((await scalar('SELECT count(*)::integer AS count FROM promotion_payout_items WHERE commission_ledger_id=$1',
    [commission.id])).count, 1, 'concurrent payout requests create one reservation item');
  check((await request('POST', `/admin/promotions/payout-requests/${payout}/decision`, null,
    { decision: 'approved', note: 'missing password' })).status, 401,
  'admin payout review requires the administrator password');
  check((await request('POST', `/admin/promotions/payout-requests/${payout}/decision`, null,
    { decision: 'approved', note: 'wrong password' }, 'wrong-password')).status, 401,
  'wrong administrator password is rejected');
  await expect('POST', `/admin/promotions/payout-requests/${payout}/decision`, null,
    { decision: 'paid_marked', note: 'illegal early mark' }, 409, testConfig.adminPassword);
  await expect('POST', `/admin/promotions/payout-requests/${payout}/decision`, null,
    { decision: 'rejected', note: 'sandbox retry test' }, 200, testConfig.adminPassword);
  check((await scalar('SELECT status FROM commission_ledger WHERE id=$1', [commission.id])).status,
    'available', 'rejecting a sandbox payout releases its ledger for retry');
  const retryPayout = await expect('POST', '/promotions/payout-requests', referrer.token,
    { commissionLedgerIds: [commission.id] }, 201);
  payout = retryPayout.body.payout.id;
  await expect('POST', `/admin/promotions/payout-requests/${payout}/decision`, null,
    { decision: 'approved', note: 'sandbox acceptance' }, 200, testConfig.adminPassword);
  await expect('POST', `/admin/promotions/payout-requests/${payout}/decision`, null,
    { decision: 'paid_marked', note: 'sandbox only' }, 200, testConfig.adminPassword);
  await expect('POST', `/admin/promotions/payout-requests/${payout}/decision`, null,
    { decision: 'paid_marked', note: 'duplicate paid mark' }, 409, testConfig.adminPassword);
  check((await scalar('SELECT status FROM commission_ledger WHERE id=$1', [commission.id])).status,
    'paid', 'sandbox payout mark moves the ledger to paid');
  await pool.query('UPDATE booking_orders SET ticket_refunded_fen=10000 WHERE id=$1', [paidTrip.orderId]);
  await expect('GET', '/promotions/me', guest.token, undefined, 200);
  const afterReleaseRefund = await scalar(
    'SELECT status,amount_fen,refund_after_release FROM commission_ledger WHERE id=$1', [commission.id],
  );
  check(afterReleaseRefund.refund_after_release, true, 'post-release refund is recorded as an exception');
  check(Number(afterReleaseRefund.amount_fen), 400, 'post-release refund does not claw back sandbox payout');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM commission_ledger l
     WHERE l.promotion_attribution_id=(SELECT id FROM promotion_attributions WHERE attributed_user_id=$1)`,
    [guest.id],
  )).count, 1, 'a post-release full refund does not create a second commission for the later paid order');
  check((await scalar('SELECT count(*)::integer AS count FROM commission_ledger WHERE booking_order_id=$1',
    [secondPaidTrip.orderId])).count, 0,
  'R3 post-release refund handling keeps the later order outside the commission ledger');
  await expect('GET', '/promotions/me', guest.token, undefined, 200);
  check((await scalar(`SELECT count(*)::integer AS count FROM promotion_commission_events
    WHERE commission_ledger_id=$1 AND event_type='refund_after_release_exception'`, [commission.id])).count,
  1, 'repeated sync records a post-release refund exception exactly once');

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

  const fullRefundNoReorder = await makeUser('全额退款未重订用户');
  await verifyIdentity(fullRefundNoReorder, '104');
  const noReorderScan = await scan(firstCode.code);
  await claim(fullRefundNoReorder, noReorderScan.visitorToken);
  const noReorderTrip = await makePaidOrder(fullRefundNoReorder, captain, 96, 10_000);
  await expect('POST', `/orders/${noReorderTrip.orderId}/cancel`, fullRefundNoReorder.token, {}, 200);
  const fullRefundLedger = await scalar(
    `SELECT l.id,l.status,l.amount_fen,l.net_ticket_amount_fen,o.ticket_refunded_fen
     FROM commission_ledger l JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     JOIN booking_orders o ON o.id=l.booking_order_id WHERE a.attributed_user_id=$1`, [fullRefundNoReorder.id],
  );
  check(fullRefundLedger.status, 'reversed', 'full cancellation refund reverses the frozen commission');
  check(Number(fullRefundLedger.amount_fen), 0, 'full cancellation refund leaves no commission balance');
  check(Number(fullRefundLedger.ticket_refunded_fen), 10_000, 'full ticket refund is recorded separately from fees');
  check(Number(fullRefundLedger.net_ticket_amount_fen), 0, 'the historical reversed ledger records zero net ticket value');
  const fullRefundAttribution = await scalar(
    'SELECT order_id,qualification_status FROM promotion_attributions WHERE attributed_user_id=$1',
    [fullRefundNoReorder.id],
  );
  check(fullRefundAttribution.order_id, null, 'a fully refunded order without a reorder does not remain the current eligible order');
  check(fullRefundAttribution.qualification_status, 'refunded', 'a fully refunded buyer remains eligible for a future reorder');
  await expect('GET', '/promotions/me', fullRefundNoReorder.token, undefined, 200);
  await expect('GET', '/promotions/me', fullRefundNoReorder.token, undefined, 200);
  check((await scalar(
    `SELECT count(*)::integer AS count FROM commission_ledger
     WHERE promotion_attribution_id=(SELECT id FROM promotion_attributions WHERE attributed_user_id=$1)
       AND status<>'reversed'`, [fullRefundNoReorder.id],
  )).count, 0, 'repeated sync without a reorder leaves no effective commission');
  const unchangedRefundLedger = await scalar(
    'SELECT id,status,amount_fen,net_ticket_amount_fen FROM commission_ledger WHERE id=$1',
    [fullRefundLedger.id],
  );
  check(unchangedRefundLedger, {
    id: fullRefundLedger.id, status: 'reversed', amount_fen: 0, net_ticket_amount_fen: 0,
  }, 'repeated sync leaves the original zero ledger unchanged');
  check((await scalar(`SELECT count(*)::integer AS count FROM promotion_commission_events e
    WHERE e.commission_ledger_id=$1 AND e.event_type='refund_after_release_exception'`, [fullRefundLedger.id])).count,
  0, 'repeated sync after a frozen full refund does not append an exception event');
  check((await scalar(`SELECT refund_after_release FROM commission_ledger WHERE promotion_attribution_id=(
    SELECT id FROM promotion_attributions WHERE attributed_user_id=$1)`, [fullRefundNoReorder.id])).refund_after_release,
  false, 'repeated sync after a frozen full refund does not flag a release exception');

  const fullRefundBuyer = await makeUser('全额退款后重订用户');
  await verifyIdentity(fullRefundBuyer, '110');
  const fullRefundScan = await scan(firstCode.code);
  await claim(fullRefundBuyer, fullRefundScan.visitorToken);
  const fullRefundTrip = await makePaidOrder(fullRefundBuyer, captain, 96, 10_000);
  await expect('POST', `/orders/${fullRefundTrip.orderId}/cancel`, fullRefundBuyer.token, {}, 200);
  const historicRefundLedger = await scalar(
    `SELECT id,status,amount_fen,net_ticket_amount_fen
     FROM commission_ledger WHERE booking_order_id=$1`, [fullRefundTrip.orderId],
  );
  check(historicRefundLedger.status, 'reversed', 'the original full-refund ledger remains a historical reversal');
  check(Number(historicRefundLedger.amount_fen), 0, 'the original full-refund ledger stays at zero');

  await verifyIdentity(fullRefundBuyer, '111');
  const reusedRefundIdentity = await makeUser('复用已全退实名用户');
  const reusedRefundScan = await scan(firstCode.code);
  await claim(reusedRefundIdentity, reusedRefundScan.visitorToken);
  await verifyIdentity(reusedRefundIdentity, '110');
  await makePaidOrder(reusedRefundIdentity, captain, 72, 10_000);
  await expect('GET', '/promotions/me', reusedRefundIdentity.token, undefined, 200);
  check((await scalar('SELECT qualification_status FROM promotion_attributions WHERE attributed_user_id=$1',
    [reusedRefundIdentity.id])).qualification_status, 'identity_already_qualified',
  'another account cannot reuse the first account identity even after a full-refund reorder path');
  check((await scalar('SELECT count(*)::integer AS count FROM commission_ledger WHERE promotion_attribution_id=(SELECT id FROM promotion_attributions WHERE attributed_user_id=$1)',
    [reusedRefundIdentity.id])).count, 0, 'the reused identity cannot create a second account ledger');

  const reorderTrip = await makePaidOrder(fullRefundBuyer, captain, 72, 12_000);
  await Promise.all([
    expect('GET', '/promotions/me', fullRefundBuyer.token, undefined, 200),
    expect('GET', '/promotions/me', fullRefundBuyer.token, undefined, 200),
  ]);
  const reorderedLedger = await scalar(
    `SELECT id,status,amount_fen,net_ticket_amount_fen,booking_order_id
     FROM commission_ledger WHERE booking_order_id=$1`, [reorderTrip.orderId],
  );
  check(reorderedLedger.status, 'frozen', 'the same buyer reorder starts a new frozen commission');
  check(Number(reorderedLedger.amount_fen), 600, 'the reorder commission is five percent of its net ticket amount');
  check(Number(reorderedLedger.net_ticket_amount_fen), 12_000, 'the reorder ledger records its own net ticket amount');
  check(reorderedLedger.booking_order_id, reorderTrip.orderId, 'the new ledger stays linked to the reorder');
  check((await scalar('SELECT order_id FROM promotion_attributions WHERE attributed_user_id=$1',
    [fullRefundBuyer.id])).order_id, reorderTrip.orderId, 'the attribution advances to the earliest current eligible order');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM commission_ledger
     WHERE promotion_attribution_id=(SELECT id FROM promotion_attributions WHERE attributed_user_id=$1)
       AND status<>'reversed'`, [fullRefundBuyer.id],
  )).count, 1, 'parallel repeated reorder sync retains exactly one effective ledger');
  const originalAfterReorder = await scalar(
    'SELECT id,status,amount_fen,net_ticket_amount_fen FROM commission_ledger WHERE id=$1',
    [historicRefundLedger.id],
  );
  check(originalAfterReorder, {
    id: historicRefundLedger.id, status: 'reversed', amount_fen: 0, net_ticket_amount_fen: 0,
  }, 'reorder sync leaves the original refunded ledger unchanged');
  const retainedIdentityFact = await scalar(
    'SELECT identity_number_hash FROM promotion_identity_qualifications WHERE user_id=$1',
    [fullRefundBuyer.id],
  );
  check(retainedIdentityFact.identity_number_hash.toString('hex'), security.identityHash(
    makeSandboxIdentityNumber('110'),
  ).toString('hex'), 'identity correction does not erase the first consumed identity fact');
  check((await scalar('SELECT count(*)::integer AS count FROM promotion_commission_events WHERE commission_ledger_id=$1 AND event_type=\'commission_created\'',
    [reorderedLedger.id])).count, 1, 'parallel reorder sync appends only one commission creation event');

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

  const mutualA = await makeUser('互推锁顺序甲');
  const mutualB = await makeUser('互推锁顺序乙');
  await verifyIdentity(mutualA, '107');
  await verifyIdentity(mutualB, '108');
  const mutualACode = await getCode(mutualA);
  const mutualBCode = await getCode(mutualB);
  const mutualAScan = await scan(mutualBCode.code);
  const mutualBScan = await scan(mutualACode.code);
  await claim(mutualA, mutualAScan.visitorToken);
  await claim(mutualB, mutualBScan.visitorToken);
  const mutualATrip = await makePaidOrder(mutualA, captain, 72, 10_000);
  const mutualBTrip = await makePaidOrder(mutualB, captain, 72, 10_000);
  for (const trip of [mutualATrip, mutualBTrip]) {
    await pool.query('UPDATE departures SET status=\'in_progress\' WHERE id=$1', [trip.id]);
    await expect('POST', `/captain/departures/${trip.id}/checkin`, captain.token,
      { event: 'returned' }, 200);
    await pool.query(
      `UPDATE departure_checkins SET checked_at=now()-interval '8 days'
       WHERE departure_id=$1 AND event='returned'`, [trip.id],
    );
  }
  const mutualDashboardReads = await Promise.all([
    request('GET', '/promotions/me', mutualA.token, undefined),
    request('GET', '/promotions/me', mutualB.token, undefined),
  ]);
  check(mutualDashboardReads.map((response) => response.status).sort(), [200, 200],
    'mutual referrals can sync qualifications and release matured ledgers concurrently');
  await expect('GET', '/promotions/me', mutualA.token, undefined, 200);
  await expect('GET', '/promotions/me', mutualB.token, undefined, 200);
  check((await scalar(`SELECT count(*)::integer AS count FROM commission_ledger
    WHERE payee_user_id=ANY($1::uuid[]) AND status='available'`, [[mutualA.id, mutualB.id]])).count,
  2, 'skip-locked release retry makes both reciprocal matured ledgers available');

  const legacyPositiveBuyer = await makeUser('升级夹具：仍有正余额');
  await verifyIdentity(legacyPositiveBuyer, '201');
  const legacyPositiveScan = await scan(firstCode.code);
  await claim(legacyPositiveBuyer, legacyPositiveScan.visitorToken);
  const legacyPositiveTrip = await makePaidOrder(legacyPositiveBuyer, captain, 72, 10_000);
  await expect('GET', '/promotions/me', legacyPositiveBuyer.token, undefined, 200);
  const legacyPositiveLedger = await scalar(
    `SELECT l.id,l.amount_fen,l.status,a.qualified_at
     FROM commission_ledger l JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     WHERE a.attributed_user_id=$1`, [legacyPositiveBuyer.id],
  );
  check(Number(legacyPositiveLedger.amount_fen), 500,
    'upgrade fixture includes a historically qualified ledger with positive balance');
  check(legacyPositiveLedger.status, 'frozen',
    'positive-balance historical qualification remains frozen before return');

  const legacyReversedBuyer = await makeUser('升级夹具：全退后余额归零');
  const legacyIdentityX = makeSandboxIdentityNumber('202');
  await verifyIdentity(legacyReversedBuyer, '202');
  const legacyReversedScan = await scan(firstCode.code);
  await claim(legacyReversedBuyer, legacyReversedScan.visitorToken);
  const legacyReversedTrip = await makePaidOrder(legacyReversedBuyer, captain, 96, 10_000);
  await expect('POST', `/orders/${legacyReversedTrip.orderId}/cancel`,
    legacyReversedBuyer.token, {}, 200);
  const legacyReversedLedger = await scalar(
    `SELECT l.id,l.amount_fen,l.status,a.qualified_at,o.ticket_refunded_fen
     FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     JOIN booking_orders o ON o.id=l.booking_order_id
     WHERE a.attributed_user_id=$1`, [legacyReversedBuyer.id],
  );
  check(legacyReversedLedger.status, 'reversed',
    'upgrade fixture fully refunds the previously qualified commission');
  check(Number(legacyReversedLedger.amount_fen), 0,
    'fully reversed historical qualification has zero current balance');
  check(Boolean(legacyReversedLedger.qualified_at), true,
    'fully reversed historical qualification retains its qualification timestamp');
  check(Number(legacyReversedLedger.ticket_refunded_fen), 10_000,
    'fully reversed upgrade fixture retains the refund fact');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM promotion_commission_events e
     WHERE e.commission_ledger_id=$1 AND e.event_type='commission_created' AND e.amount_fen>0`,
    [legacyReversedLedger.id],
  )).count > 0, true,
  'fully reversed upgrade fixture retains its original positive commission event');

  const legacyEventOnlyBuyer = await makeUser('升级夹具：仅历史事件保留');
  const legacyEventIdentity = makeSandboxIdentityNumber('206');
  await verifyIdentity(legacyEventOnlyBuyer, '206');
  const legacyEventScan = await scan(firstCode.code);
  await claim(legacyEventOnlyBuyer, legacyEventScan.visitorToken);
  const legacyEventTrip = await makePaidOrder(legacyEventOnlyBuyer, captain, 96, 10_000);
  await expect('POST', `/orders/${legacyEventTrip.orderId}/cancel`,
    legacyEventOnlyBuyer.token, {}, 200);
  await pool.query(
    'UPDATE promotion_attributions SET qualified_at=NULL WHERE attributed_user_id=$1',
    [legacyEventOnlyBuyer.id],
  );
  const legacyEventLedger = await scalar(
    `SELECT l.id,l.amount_fen,l.status,a.qualified_at
     FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     WHERE a.attributed_user_id=$1`, [legacyEventOnlyBuyer.id],
  );
  check(legacyEventLedger.status, 'reversed',
    'event-only upgrade fixture fully reverses the previously qualified commission');
  check(Number(legacyEventLedger.amount_fen), 0,
    'event-only historical qualification has zero current balance');
  check(legacyEventLedger.qualified_at, null,
    'event-only upgrade fixture removes the qualification timestamp to isolate fallback');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM promotion_commission_events e
     WHERE e.commission_ledger_id=$1 AND e.event_type='commission_created' AND e.amount_fen>0`,
    [legacyEventLedger.id],
  )).count > 0, true,
  'event-only upgrade fixture retains a positive historical commission event');

  const neverCommissionedBuyer = await makeUser('升级夹具：实名但从未计佣');
  await verifyIdentity(neverCommissionedBuyer, '203');
  const neverCommissionedScan = await scan(firstCode.code);
  await claim(neverCommissionedBuyer, neverCommissionedScan.visitorToken);
  await expect('GET', '/promotions/me', neverCommissionedBuyer.token, undefined, 200);
  check((await scalar(
    `SELECT count(*)::integer AS count FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     WHERE a.attributed_user_id=$1`, [neverCommissionedBuyer.id],
  )).count, 0, 'upgrade contrast has an identity and attribution but no commission ledger');
  check((await scalar(
    'SELECT count(*)::integer AS count FROM promotion_identity_qualifications WHERE user_id=$1',
    [neverCommissionedBuyer.id],
  )).count, 0, 'never-commissioned identity is not consumed before upgrade backfill');

  const migration023 = '023_backfill_historic_promotion_identity_qualifications.sql';
  await pool.query(
    'DELETE FROM promotion_identity_qualifications WHERE user_id=ANY($1::uuid[])',
    [[legacyReversedBuyer.id, legacyEventOnlyBuyer.id]],
  );
  check((await scalar(
    'SELECT count(*)::integer AS count FROM promotion_identity_qualifications WHERE user_id=$1',
    [legacyReversedBuyer.id],
  )).count, 0,
  '022 upgrade-state fixture reproduces the zero-balance qualification missed by its backfill');
  check((await scalar(
    'SELECT count(*)::integer AS count FROM promotion_identity_qualifications WHERE user_id=$1',
    [legacyEventOnlyBuyer.id],
  )).count, 0,
  '022 upgrade-state fixture removes the event-only identity qualification before backfill');
  await pool.query('DELETE FROM schema_migrations WHERE version=$1', [migration023]);
  const migrationResult = await execFileAsync(process.execPath, [migrationScriptPath], {
    cwd: serverWorkingDirectory,
    env: process.env,
    timeout: 30_000,
  });
  check(migrationResult.stdout.includes(`Applied migration ${migration023}`), true,
    'upgrade acceptance executes the registered follow-up migration');
  const backfilledIdentity = await scalar(
    `SELECT identity_number_hash,consumed_at FROM promotion_identity_qualifications
     WHERE user_id=$1`, [legacyReversedBuyer.id],
  );
  check(backfilledIdentity.identity_number_hash.toString('hex'),
    security.identityHash(legacyIdentityX).toString('hex'),
  'upgrade backfill seeds the still-present identity from a zero-balance historical qualification');
  const eventBackfilledIdentity = await scalar(
    `SELECT identity_number_hash,consumed_at FROM promotion_identity_qualifications
     WHERE user_id=$1`, [legacyEventOnlyBuyer.id],
  );
  check(eventBackfilledIdentity.identity_number_hash.toString('hex'),
    security.identityHash(legacyEventIdentity).toString('hex'),
  'upgrade backfill uses the historical commission event when qualified_at is absent');
  check((await scalar(
    'SELECT count(*)::integer AS count FROM promotion_identity_qualifications WHERE user_id=$1',
    [legacyPositiveBuyer.id],
  )).count, 1,
  'upgrade backfill preserves the already-seeded positive-balance historical qualification');
  check((await scalar(
    'SELECT count(*)::integer AS count FROM promotion_identity_qualifications WHERE user_id=$1',
    [neverCommissionedBuyer.id],
  )).count, 0,
  'upgrade backfill does not consume identity for a buyer who never earned commission');

  const qualificationCountAfterFirstRun = Number((await scalar(
    'SELECT count(*)::integer AS count FROM promotion_identity_qualifications',
  )).count);
  await pool.query('DELETE FROM schema_migrations WHERE version=$1', [migration023]);
  const rerunMigrationResult = await execFileAsync(process.execPath, [migrationScriptPath], {
    cwd: serverWorkingDirectory,
    env: process.env,
    timeout: 30_000,
  });
  check(rerunMigrationResult.stdout.includes(`Applied migration ${migration023}`), true,
    'upgrade acceptance can execute migration 023 a second time');
  check(Number((await scalar(
    'SELECT count(*)::integer AS count FROM promotion_identity_qualifications',
  )).count), qualificationCountAfterFirstRun,
  'rerunning migration 023 creates no duplicate identity qualification rows');
  check((await scalar(
    'SELECT count(*)::integer AS count FROM promotion_identity_qualifications WHERE user_id=$1',
    [legacyEventOnlyBuyer.id],
  )).count, 1,
  'rerun preserves exactly one qualification seeded from the historical-event fallback');

  await verifyIdentity(legacyReversedBuyer, '204');
  const postUpgradeReuseBuyer = await makeUser('升级后复用已消费身份');
  const postUpgradeReuseScan = await scan(firstCode.code);
  await claim(postUpgradeReuseBuyer, postUpgradeReuseScan.visitorToken);
  await verifyIdentity(postUpgradeReuseBuyer, '202');
  await makePaidOrder(postUpgradeReuseBuyer, captain, 72, 10_000);
  await expect('GET', '/promotions/me', postUpgradeReuseBuyer.token, undefined, 200);
  check((await scalar(
    'SELECT qualification_status FROM promotion_attributions WHERE attributed_user_id=$1',
    [postUpgradeReuseBuyer.id],
  )).qualification_status, 'identity_already_qualified',
  'after upgrade and identity correction, another account cannot reuse the historical identity');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     WHERE a.attributed_user_id=$1`, [postUpgradeReuseBuyer.id],
  )).count, 0,
  'post-upgrade identity reuse cannot create a second commission ledger');

  console.info(`Step 6 slice 1 promotion acceptance passed: ${assertions} assertions.`);
} finally {
  await app.close().catch(() => {});
  await pool.end().catch(() => {});
}
