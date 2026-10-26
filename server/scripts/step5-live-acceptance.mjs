import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createSecurity } from '../src/security.js';

if (process.env.STEP5_LIVE_ACCEPTANCE !== 'true') {
  throw new Error('Set STEP5_LIVE_ACCEPTANCE=true and use an isolated acceptance database.');
}
if (!config.databaseUrl) throw new Error('DATABASE_URL is required.');

const testConfig = {
  ...config,
  nodeEnv: 'test',
  logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
  adminPassword: 'step5-live-acceptance-admin',
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

async function request(method, path, token, payload, adminPassword = null) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (adminPassword) headers['x-admin-password'] = adminPassword;
  const response = await app.inject({
    method,
    url: path,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  return {
    status: response.statusCode,
    body: response.headers['content-type']?.includes('application/json')
      ? response.json() : response.body,
  };
}

async function scalar(sql, values = []) {
  return (await pool.query(sql, values)).rows[0];
}

async function createUser({ captain = false } = {}) {
  sequence += 1;
  const id = randomUUID();
  const phone = `139${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  await pool.query(
    `INSERT INTO users (id,phone_ciphertext,phone_hash,display_name)
     VALUES ($1,$2,$3,$4)`,
    [id, security.encrypt(phone), security.phoneHash(phone), captain ? '直播验收船长' : `直播验收钓友${sequence}`],
  );
  if (captain) {
    await pool.query(
      `INSERT INTO captain_profiles (user_id,captain_name,verification_status)
       VALUES ($1,'直播验收船长','approved')`, [id],
    );
  }
  const token = security.newToken();
  await pool.query(
    `INSERT INTO user_sessions (token_hash,user_id,expires_at)
     VALUES ($1,$2,now()+interval '1 day')`, [security.tokenHash(token), id],
  );
  return { id, token };
}

async function createDeparture(captain, status, withDepartureCheckin = false) {
  const boatId = randomUUID();
  const departureId = randomUUID();
  const now = Date.now();
  const departureAt = new Date(now - 20 * 60_000);
  const returnAt = new Date(now + 3 * 60 * 60_000);
  await pool.query(
    `INSERT INTO boats (id,captain_user_id,name,length_cm,home_marina_code,seat_count,review_status)
     VALUES ($1,$2,$3,900,'xiaogang',4,'approved')`,
    [boatId, captain.id, `直播验收船${sequence}`],
  );
  await pool.query(
    `INSERT INTO departures
       (id,boat_id,captain_user_id,trip_type,departure_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status)
     VALUES ($1,$2,$3,'pro_fishing',$4,$5,'qingdao_nearshore','xiaogang',10000,10000,$4,$6)`,
    [departureId, boatId, captain.id, departureAt, returnAt, status],
  );
  await pool.query(
    `INSERT INTO departure_rig_configs
       (departure_id,bait_types,bait_grams_per_person,bait_supply,main_line_pe,
        leader_line_number,sinker_shape,sinker_min_grams,sinker_max_grams)
     VALUES ($1,'{}',0,'captain_provided',1,2,'round',20,60)`, [departureId],
  );
  if (withDepartureCheckin) {
    await pool.query(
      `INSERT INTO departure_checkins (departure_id,captain_user_id,event,checked_at)
       VALUES ($1,$2,'departed',$3)`, [departureId, captain.id, departureAt],
    );
  }
  return { departureId, departureAt, returnAt };
}

try {
  await app.ready();
  const captain = await createUser({ captain: true });
  const reporter = await createUser();
  const preDeparture = await createDeparture(captain, 'confirmed');
  const blockedBeforeDeparted = await request(
    'POST', `/step5/departures/${preDeparture.departureId}/live/start`, captain.token, {},
  );
  check(blockedBeforeDeparted.status, 409, 'a confirmed trip cannot start a live badge');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [preDeparture.departureId])).status,
    'confirmed', 'blocked start leaves departure status unchanged');

  const liveTrip = await createDeparture(captain, 'in_progress', true);
  const unboundStart = await request(
    'POST', `/step5/departures/${liveTrip.departureId}/live/start`, captain.token, {},
  );
  check(unboundStart.status, 409, 'an unbound captain cannot start a live badge');
  check((await scalar('SELECT count(*)::integer AS count FROM step5_live_sessions WHERE departure_id=$1',
    [liveTrip.departureId])).count, 0, 'blocked unbound start writes no live session');

  const invalidProfile = await request(
    'POST', '/captain/douyin-profile', captain.token,
    { handle: 'test_fishing', profileUrl: 'https://example.com/user/1' },
  );
  check(invalidProfile.status, 400, 'only a Douyin HTTPS profile can be bound');
  const boundProfile = await request(
    'POST', '/captain/douyin-profile', captain.token,
    { handle: '@test_fishing', profileUrl: 'https://www.douyin.com/user/acceptance' },
  );
  check(boundProfile.status, 200, 'captain can bind a Douyin profile');
  check(boundProfile.body.handle, 'test_fishing', 'captain handle is normalized');

  const validStart = await request(
    'POST', `/step5/departures/${liveTrip.departureId}/live/start`, captain.token, {},
  );
  check(validStart.status, 201, 'departed and bound captain can start a live badge');
  check(validStart.body.active, true, 'successful start returns active state');
  const unbindDuringLive = await request(
    'POST', '/captain/douyin-profile', captain.token, { handle: '', profileUrl: '' },
  );
  check(unbindDuringLive.status, 409, 'captain cannot remove the profile while live');
  const secondStart = await request(
    'POST', `/step5/departures/${liveTrip.departureId}/live/start`, captain.token, {},
  );
  check(secondStart.status, 200, 'repeat start is idempotent');
  check((await scalar('SELECT count(*)::integer AS count FROM step5_live_sessions WHERE departure_id=$1',
    [liveTrip.departureId])).count, 1, 'idempotent start creates one active session');

  const publicDetail = await request('GET', `/departures/${liveTrip.departureId}`, reporter.token);
  check(publicDetail.status, 200, 'active live trip detail is visible');
  check(publicDetail.body.departure.liveStatus.active, true, 'detail shows the live badge');
  check(publicDetail.body.departure.liveStatus.profileUrl,
    'https://www.douyin.com/user/acceptance', 'detail uses the bound HTTPS profile');
  const publicList = await request('GET', '/departures', reporter.token);
  check(publicList.body.items.some((item) => item.id === liveTrip.departureId),
    true, 'active live trip appears in activity cards');
  const captainFactsBefore = await request('GET', `/step5/captains/${captain.id}/facts`);
  check(captainFactsBefore.body.activeLive.departureId, liveTrip.departureId,
    'captain facts expose the current live trip');

  const firstReport = await request(
    'POST', `/step5/departures/${liveTrip.departureId}/live-reports`, reporter.token,
    { reason: 'wrong_account', note: 'acceptance fixture' },
  );
  check(firstReport.status, 201, 'angler can report an active live badge');
  check(firstReport.body.processingStatus, 'pending', 'report starts pending');
  const duplicateReport = await request(
    'POST', `/step5/departures/${liveTrip.departureId}/live-reports`, reporter.token,
    { reason: 'not_live', note: 'duplicate request' },
  );
  check(duplicateReport.status, 200, 'same user and trip report is deduplicated');
  check(duplicateReport.body.id, firstReport.body.id, 'duplicate returns the original report');
  check(duplicateReport.body.created, false, 'duplicate does not count twice');
  const captainSelfReport = await request(
    'POST', `/step5/departures/${liveTrip.departureId}/live-reports`, captain.token,
    { reason: 'other' },
  );
  check(captainSelfReport.status, 403, 'captain cannot report their own badge');
  const queue = await request('GET', '/admin/step5/live-reports', null, undefined,
    testConfig.adminPassword);
  check(queue.body.items.some((report) => report.id === firstReport.body.id),
    true, 'admin can read the pending report queue');

  const decision = await request(
    'POST', `/admin/step5/live-reports/${firstReport.body.id}/decision`, null,
    { decision: 'false_verified' }, testConfig.adminPassword,
  );
  check(decision.status, 200, 'admin can process a false live badge');
  check((await scalar('SELECT end_reason FROM step5_live_sessions WHERE departure_id=$1',
    [liveTrip.departureId])).end_reason, 'false_live_report_verified',
  'verified false badge ends the session');
  check((await scalar('SELECT count(*)::integer AS count FROM step5_captain_live_incident_facts WHERE departure_id=$1',
    [liveTrip.departureId])).count, 1, 'verified false badge appends one captain fact');
  const captainFactsAfter = await request('GET', `/step5/captains/${captain.id}/facts`);
  check(captainFactsAfter.body.activeLive, null, 'verified false badge disappears from active profile');
  check(captainFactsAfter.body.liveBadgeFacts.length, 1, 'public captain facts contain the dated incident fact');
  const hiddenDetail = await request('GET', `/departures/${liveTrip.departureId}`, reporter.token);
  check(hiddenDetail.status, 404, 'ended live link is no longer visible from trip detail');

  const manualEndTrip = await createDeparture(captain, 'in_progress', true);
  const manualEndStart = await request(
    'POST', `/step5/departures/${manualEndTrip.departureId}/live/start`, captain.token, {},
  );
  check(manualEndStart.status, 201, 'captain can start another trip session');
  const manualEnd = await request(
    'POST', `/step5/departures/${manualEndTrip.departureId}/live/end`, captain.token, {},
  );
  check(manualEnd.status, 200, 'captain can manually end a live session underway');
  check((await scalar('SELECT end_reason FROM step5_live_sessions WHERE departure_id=$1',
    [manualEndTrip.departureId])).end_reason, 'captain_ended', 'manual end records its reason');
  const hiddenAfterManualEnd = await request(
    'GET', `/departures/${manualEndTrip.departureId}`, reporter.token,
  );
  check(hiddenAfterManualEnd.status, 404, 'manual end removes the activity link');
  const captainTripAfterManualEnd = await request(
    'GET', `/departures/${manualEndTrip.departureId}`, captain.token,
  );
  check(captainTripAfterManualEnd.status, 200, 'captain can still manage their in-progress trip');
  check(captainTripAfterManualEnd.body.departure.liveStatus, null,
    'captain view after manual end has no public live badge');

  const returningTrip = await createDeparture(captain, 'in_progress', true);
  const returningStart = await request(
    'POST', `/step5/departures/${returningTrip.departureId}/live/start`, captain.token, {},
  );
  check(returningStart.status, 201, 'a later departed trip can start a fresh session');
  const returned = await request(
    'POST', `/captain/departures/${returningTrip.departureId}/checkin`, captain.token,
    { event: 'returned' },
  );
  check(returned.status, 200, 'captain can complete return check-in');
  check((await scalar('SELECT end_reason FROM step5_live_sessions WHERE departure_id=$1',
    [returningTrip.departureId])).end_reason, 'trip_returned', 'return check-in automatically ends live');
  const afterReturn = await request('GET', `/departures/${returningTrip.departureId}`, reporter.token);
  check(afterReturn.status, 404, 'returned trip removes the live entry');
  const startAfterReturn = await request(
    'POST', `/step5/departures/${returningTrip.departureId}/live/start`, captain.token, {},
  );
  check(startAfterReturn.status, 409, 'returned captain cannot start a new live session');
  check((await scalar('SELECT status FROM departures WHERE id=$1', [returningTrip.departureId])).status,
    'completed', 'rejected post-return start leaves completed status unchanged');

  console.info(`Step 5 live acceptance passed (${assertions} assertions).`);
} finally {
  await app.close();
  await pool.end();
}
