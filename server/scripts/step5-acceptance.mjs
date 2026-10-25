import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createSecurity, makeSandboxIdentityNumber } from '../src/security.js';

if (process.env.STEP5_ACCEPTANCE !== 'true') {
  throw new Error('Set STEP5_ACCEPTANCE=true and use an isolated acceptance database.');
}
if (!config.databaseUrl) throw new Error('DATABASE_URL is required.');

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
let assertions = 0;
let sequence = 0;

function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}

async function request(method, path, token, payload) {
  const response = await app.inject({
    method,
    url: path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload }),
  });
  return {
    status: response.statusCode,
    body: response.headers['content-type']?.includes('application/json') ? response.json() : response.body,
  };
}

async function scalar(sql, values = []) {
  return (await pool.query(sql, values)).rows[0];
}

async function createUser({ captain = false, identity = null } = {}) {
  sequence += 1;
  const id = randomUUID();
  const phone = `138${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const identityNumber = identity ?? makeSandboxIdentityNumber(String(sequence).padStart(3, '0'));
  await pool.query(
    `INSERT INTO users
       (id,phone_ciphertext,phone_hash,display_name,legal_name_ciphertext,identity_number_ciphertext,
        identity_verified_at,identity_status)
     VALUES ($1,$2,$3,$4,$5,$6,now(),'verified')`,
    [id, security.encrypt(phone), security.phoneHash(phone), captain ? '测试船长' : `测试乘客${sequence}`,
      security.encrypt(captain ? '测试船长' : `测试乘客${sequence}`), security.encrypt(identityNumber)],
  );
  if (captain) {
    await pool.query(
      `INSERT INTO captain_profiles (user_id,verification_status) VALUES ($1,'approved')`, [id],
    );
  }
  const token = security.newToken();
  await pool.query(
    `INSERT INTO user_sessions (token_hash,user_id,expires_at)
     VALUES ($1,$2,now()+interval '1 day')`, [security.tokenHash(token), id],
  );
  return { id, token, identityNumber };
}

async function createBoat(captainId) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO boats (id,captain_user_id,name,length_cm,home_marina_code,seat_count,review_status)
     VALUES ($1,$2,'验收测试船',900,'xiaogang',4,'approved')`, [id, captainId],
  );
  return id;
}

async function createTrip({ captain, boatId, dateDaysAgo = 180, status = 'completed', passengers = [], returned = true }) {
  const departureId = randomUUID();
  const orderIds = [];
  const departureAt = new Date(Date.now() - dateDaysAgo * 86400000);
  const returnAt = new Date(departureAt.getTime() + 4 * 3600000);
  await pool.query(
    `INSERT INTO departures
       (id,boat_id,captain_user_id,trip_type,departure_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status)
     VALUES ($1,$2,$3,'pro_fishing',$4,$5,'qingdao_nearshore','xiaogang',10000,10000,$4,$6)`,
    [departureId, boatId, captain.id, departureAt, returnAt, status],
  );
  await pool.query(
    `INSERT INTO departure_checkins (departure_id,captain_user_id,event,checked_at)
     VALUES ($1,$2,'departed',$3)`, [departureId, captain.id, departureAt],
  );
  if (returned) {
    await pool.query(
      `INSERT INTO departure_checkins (departure_id,captain_user_id,event,checked_at)
       VALUES ($1,$2,'returned',$3)`, [departureId, captain.id, returnAt],
    );
  }
  for (const [index, passenger] of passengers.entries()) {
    const seatId = randomUUID();
    const orderId = randomUUID();
    const passengerId = randomUUID();
    const orderNumber = `S5-${randomUUID().replaceAll('-', '').slice(0, 18)}`;
    await pool.query(
      `INSERT INTO seat_inventory (id,departure_id,seat_number,price_fen,status)
       VALUES ($1,$2,$3,10000,'booked')`, [seatId, departureId, index + 1],
    );
    await pool.query(
      `INSERT INTO booking_orders
         (id,order_number,departure_id,seat_inventory_id,buyer_user_id,status,
          seat_fee_fen,discount_fen,platform_fee_fen,total_amount_fen,paid_at)
       VALUES ($1,$2,$3,$4,$5,'paid',10000,0,0,10000,now())`,
      [orderId, orderNumber, departureId, seatId, passenger.user.id],
    );
    await pool.query(
      `INSERT INTO order_passengers
         (id,order_id,full_name_ciphertext,identity_number_ciphertext,phone_ciphertext,identity_verified_at)
       VALUES ($1,$2,$3,$4,$5,now())`,
      [passengerId, orderId, security.encrypt(`测试乘客${index + 1}`),
        security.encrypt(passenger.user.identityNumber), security.encrypt('13800000000')],
    );
    const effective = passenger.gate !== 'blocked';
    const coverageId = randomUUID();
    await pool.query(
      `INSERT INTO passenger_insurance_coverages
         (id,departure_id,order_id,passenger_id,coverage_start_at,coverage_end_at,status,provider_code,verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'sandbox',CASE WHEN $7::varchar(24)='effective' THEN now() END)`,
      [coverageId, departureId, orderId, passengerId, departureAt, returnAt, effective ? 'effective' : 'failed'],
    );
    await pool.query(
      `INSERT INTO departure_passenger_gate_decisions
         (departure_id,passenger_id,coverage_id,captain_user_id,decision,coverage_status,block_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [departureId, passengerId, coverageId, captain.id,
        effective ? 'allowed' : 'blocked', effective ? 'effective' : 'failed',
        effective ? null : 'passenger_coverage_not_effective'],
    );
    orderIds.push({ orderId, passengerId, user: passenger.user, gate: passenger.gate ?? 'allowed' });
  }
  return { departureId, departureAt, returnAt, orderIds };
}

try {
  await app.ready();
  const captain = await createUser({ captain: true });
  const boatId = await createBoat(captain.id);
  const anglerA = { user: await createUser() };
  const anglerB = { user: await createUser() };
  const blockedAngler = { user: await createUser(), gate: 'blocked' };
  const outsider = await createUser();
  const firstTrip = await createTrip({
    captain, boatId, dateDaysAgo: 180,
    passengers: [anglerA, anglerB, blockedAngler],
  });
  const secondTrip = await createTrip({
    captain, boatId, dateDaysAgo: 120,
    passengers: [anglerA],
  });
  await createTrip({ captain, boatId, dateDaysAgo: 20, passengers: [] });
  const unfinished = await createTrip({
    captain, boatId, dateDaysAgo: 1, status: 'in_progress', returned: false, passengers: [],
  });

  const catalog = await request('GET', '/step5/fish-catalog');
  check(catalog.status, 200, 'standard fish catalog is available');
  check(catalog.body.items.length, 17, 'the atlas uses the 17-species catalog');

  const notReturned = await request(
    'POST', `/step5/departures/${unfinished.departureId}/captain-catch`, captain.token,
    { outcome: 'zero_catch', items: [] },
  );
  check(notReturned.status, 409, 'a departure without return check-in is rejected');
  check((await scalar('SELECT count(*)::integer AS count FROM step5_catch_reports WHERE departure_id=$1', [unfinished.departureId])).count,
    0, 'not-returned rejection leaves no source record');

  const captainReport = await request(
    'POST', `/step5/departures/${firstTrip.departureId}/captain-catch`, captain.token,
    { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 2, totalWeightGrams: 850, maxLengthMm: 310 }] },
  );
  check(captainReport.status, 201, 'captain can record a completed trip');
  check((await request(
    'POST', `/step5/departures/${firstTrip.departureId}/captain-catch`, captain.token,
    { outcome: 'zero_catch', items: [] },
  )).status, 409, 'captain source report cannot be overwritten');

  const captainOnlyAtlas = await request('GET', '/step5/me/fish-atlas', anglerB.user.token);
  check(captainOnlyAtlas.body.items.length, 0, 'captain-only report does not light a passenger atlas');
  const blocked = firstTrip.orderIds.find((row) => row.gate === 'blocked');
  check((await request(
    'POST', `/step5/departures/${firstTrip.departureId}/passenger-catch`, blocked.user.token,
    { catchReport: { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 1 }] } },
  )).status, 403, 'insurance-blocked passenger cannot submit');
  check((await scalar(
    `SELECT count(*)::integer AS count FROM step5_catch_reports
     WHERE departure_id=$1 AND passenger_id=$2`, [firstTrip.departureId, blocked.passengerId],
  )).count, 0, 'blocked passenger rejection leaves no source record');
  check((await request(
    'POST', `/step5/departures/${firstTrip.departureId}/passenger-catch`, outsider.token,
    { catchReport: { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 1 }] } },
  )).status, 403, 'non-manifest outsider cannot submit');
  check((await scalar(
    'SELECT count(*)::integer AS count FROM step5_catch_reports WHERE departure_id=$1 AND author_user_id=$2',
    [firstTrip.departureId, outsider.id],
  )).count, 0, 'outsider rejection leaves no source record');

  const passengerA = firstTrip.orderIds.find((row) => row.user.id === anglerA.user.id);
  const passengerB = firstTrip.orderIds.find((row) => row.user.id === anglerB.user.id);
  check((await request(
    'POST', `/step5/departures/${firstTrip.departureId}/passenger-catch`, anglerA.user.token,
    { captainResponse: { action: 'confirm' } },
  )).status, 201, 'allowed passenger can confirm a captain report');
  check((await request(
    'POST', `/step5/departures/${firstTrip.departureId}/passenger-catch`, anglerA.user.token,
    { catchReport: { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 1, maxLengthMm: 280 }] } },
  )).status, 201, 'passenger can later add their independent catch without replacing that confirmation');
  const stateA = await request('GET', `/step5/departures/${firstTrip.departureId}/me`, anglerA.user.token);
  check(stateA.body.reconciliation, 'confirmed', 'consistent passenger report is reconciled as confirmed');
  const atlasA = await request('GET', '/step5/me/fish-atlas', anglerA.user.token);
  check(atlasA.body.items.map((row) => row.fishCode), ['yellow_croaker'], 'own or explicitly confirmed fish lights the atlas');

  check((await request(
    'POST', `/step5/departures/${firstTrip.departureId}/passenger-catch`, anglerB.user.token,
    { catchReport: { outcome: 'caught', items: [{ fishCode: 'sea_bass', quantity: 1 }] } },
  )).status, 201, 'allowed passenger can submit own independent source');
  const stateB = await request('GET', `/step5/departures/${firstTrip.departureId}/me`, anglerB.user.token);
  check(stateB.body.reconciliation, 'pending_review', 'species absent from the vessel report is marked for review');
  check((await request('GET', '/step5/me/fish-atlas', anglerB.user.token)).body.items.map((row) => row.fishCode),
    ['sea_bass'], 'a passenger own report lights their personal atlas even when pending review');
  check((await request(
    'POST', `/step5/departures/${firstTrip.departureId}/passenger-catch`, anglerB.user.token,
    { captainResponse: { action: 'confirm' } },
  )).status, 201, 'passenger can separately confirm a captain report after submitting own catch');
  const atlasB = await request('GET', '/step5/me/fish-atlas', anglerB.user.token);
  check(atlasB.body.items.map((row) => row.fishCode), ['sea_bass', 'yellow_croaker'],
    'the atlas combines personal reports and explicit captain-record confirmations');

  const zeroTrip = await request(
    'POST', `/step5/departures/${secondTrip.departureId}/captain-catch`, captain.token,
    { outcome: 'zero_catch', items: [] },
  );
  check(zeroTrip.status, 201, 'zero catch is an explicit accepted report');
  const zeroState = await request('GET', `/step5/departures/${secondTrip.departureId}/me`, captain.token);
  check(zeroState.body.captainReport.outcome, 'zero_catch', 'zero catch is distinguishable from missing report');
  check((await request('GET', `/step5/departures/${secondTrip.departureId}/me`, anglerA.user.token)).body.captainReport.outcome,
    'zero_catch', 'passenger sees the explicit zero-catch report');

  const review = await request('POST', `/step5/orders/${passengerA.orderId}/review`, anglerA.user.token, {
    captainTags: ['clear_guidance'], boatTags: ['clean_deck'], body: '行程信息清楚，甲板整洁。',
  });
  check(review.status, 201, 'completed passenger order can submit structured, text-only review');
  check((await request('POST', `/step5/orders/${passengerA.orderId}/review`, anglerA.user.token, {
    captainTags: ['clear_guidance'], boatTags: [], body: '',
  })).status, 409, 'review is append-only and one per order');
  const boatFacts = await request('GET', `/step5/boats/${boatId}/facts`);
  check(boatFacts.body.conditionTagCounts,
    [{ tag: 'clean_deck', count: 1 }], 'boat condition tags are reported separately from captain ability');
  check(boatFacts.body.crossSourceChecks.pendingReviewCount, 1, 'boat facts keep passenger disputes separate from captain facts');

  const facts = await request('GET', '/step5/me/captain-facts', captain.token);
  check(facts.status, 200, 'captain facts are available to the captain');
  check(facts.body.catchReports, {
    reportedTripCount: 2, missingReportCount: 1, zeroCatchTripCount: 1, zeroCatchRatePercent: 50,
  }, 'zero-catch rate excludes unreported completed departures from its denominator');
  check(facts.body.repeatBookings.cohortPassengerCount, 2, 'only mature passengers enter the repeat cohort');
  check(facts.body.repeatBookings.repeatPassengerCount, 1, 'repeat fact counts a second completed sailing by the same identity');
  check(facts.body.crossSourceChecks, {
    sampleWindowMonths: 12, sampleCount: 3, pendingReviewCount: 1, pendingReviewRatePercent: 33.3,
  }, 'pending cross-source review is surfaced with its sample denominator');
  check(facts.body.serviceReviews.sampleCount, 1, 'captain service tags retain their own review sample count');
  check(facts.body.serviceReviews.tagCounts, [{ tag: 'clear_guidance', count: 1 }],
    'service tags are returned separately from boat-condition tags');

  await assert.rejects(
    pool.query('UPDATE step5_catch_reports SET outcome=$1 WHERE id=$2', ['zero_catch', captainReport.body.reportId]),
    /append-only/,
  );
  assertions += 1;
  check((await scalar('SELECT outcome FROM step5_catch_reports WHERE id=$1', [captainReport.body.reportId])).outcome,
    'caught', 'source row remains unchanged after attempted mutation');

  console.info(`Step 5 acceptance passed: ${assertions} assertions; positive, negative, consistency, facts, atlas and immutability cases.`);
} finally {
  await app.close();
  await pool.end();
}
