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

async function waitForStep5DepartureLockWaiters(expectedCount = 2) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await scalar(
      `SELECT count(*)::integer AS count FROM pg_stat_activity
       WHERE datname=current_database() AND wait_event_type='Lock' AND state='active'
         AND query ILIKE '%FROM departures d WHERE d.id=$1 FOR UPDATE OF d%'`,
    );
    if (result.count >= expectedCount) return result.count;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return Number((await scalar(
    `SELECT count(*)::integer AS count FROM pg_stat_activity
     WHERE datname=current_database() AND wait_event_type='Lock' AND state='active'
       AND query ILIKE '%FROM departures d WHERE d.id=$1 FOR UPDATE OF d%'`,
  )).count);
}

async function holdDepartureRow(departureId) {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [departureId]);
  return client;
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
  const youngAngler = { user: await createUser() };
  const supplementAngler = { user: await createUser() };
  const raceAngler = { user: await createUser() };
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
  const youngTrip = await createTrip({
    captain, boatId, dateDaysAgo: 20, passengers: [youngAngler],
  });
  const supplementTrip = await createTrip({
    captain, boatId, dateDaysAgo: 89, passengers: [supplementAngler],
  });
  const raceTrip = await createTrip({
    captain, boatId, dateDaysAgo: 90.25, passengers: [raceAngler],
  });
  const unreportedTrip = await createTrip({
    captain, boatId, dateDaysAgo: 30, passengers: [],
  });
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
  const secondTripPassengerA = secondTrip.orderIds.find((row) => row.user.id === anglerA.user.id);
  const review = await request('POST', `/step5/orders/${passengerA.orderId}/review`, anglerA.user.token, {
    captainTags: ['clear_guidance'], boatTags: ['clean_deck'], body: '行程信息清楚，甲板整洁。',
  });
  check(review.status, 201, 'completed passenger order can submit structured, text-only review');
  check((await request('POST', `/step5/orders/${passengerA.orderId}/review`, anglerA.user.token, {
    captainTags: ['clear_guidance'], boatTags: [], body: '',
  })).status, 409, 'review is append-only and one per order');
  const reviewB = await request('POST', `/step5/orders/${passengerB.orderId}/review`, anglerB.user.token, {
    captainTags: ['clear_guidance', 'on_time'], boatTags: ['facilities_match'], body: '',
  });
  check(reviewB.status, 201, 'a second passenger can submit multiple service tags');
  const secondTripReview = await request(
    'POST', `/step5/orders/${secondTripPassengerA.orderId}/review`, anglerA.user.token,
    { captainTags: [], boatTags: ['comfortable_space'], body: '' },
  );
  check(secondTripReview.status, 201, 'a boat-only review is accepted without a captain service tag');
  const taggedCaptainFacts = await request('GET', '/step5/me/captain-facts', captain.token);
  check(taggedCaptainFacts.body.serviceReviews.sampleCount, 3,
    'service sample count includes a review containing only boat-condition tags');
  check(taggedCaptainFacts.body.serviceReviews.tagCounts, [
    { tag: 'clear_guidance', count: 2 },
    { tag: 'on_time', count: 1 },
  ], 'captain service tags aggregate counts across passengers and exclude boat-only tags');

  const lowerPassengerCatch = await request(
    'POST', `/step5/departures/${firstTrip.departureId}/passenger-catch`, anglerA.user.token,
    { catchReport: { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 1, maxLengthMm: 280 }] } },
  );
  check(lowerPassengerCatch.status, 201, 'passenger can submit a lower quantity without creating a mismatch');
  check(lowerPassengerCatch.body.reconciliation.conflict, false,
    'a passenger quantity below the vessel total is not an automatic mismatch');
  check((await request(
    'POST', `/step5/departures/${firstTrip.departureId}/passenger-catch`, anglerA.user.token,
    { captainResponse: { action: 'confirm' } },
  )).status, 201, 'passenger can confirm the captain record after submitting their own catch');
  const stateA = await request('GET', `/step5/departures/${firstTrip.departureId}/me`, anglerA.user.token);
  check(stateA.body.reconciliation, 'confirmed', 'consistent passenger report is reconciled as confirmed');
  const atlasA = await request('GET', '/step5/me/fish-atlas', anglerA.user.token);
  check(atlasA.body.items.map((row) => row.fishCode), ['yellow_croaker'], 'own or explicitly confirmed fish lights the atlas');

  check((await request(
    'POST', `/step5/departures/${firstTrip.departureId}/passenger-catch`, anglerB.user.token,
    { catchReport: { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 3 }] } },
  )).status, 201, 'allowed passenger can submit own independent source');
  const stateB = await request('GET', `/step5/departures/${firstTrip.departureId}/me`, anglerB.user.token);
  check(stateB.body.reconciliation, 'pending_review', 'a passenger quantity above the vessel total is marked for review');
  check((await request('GET', '/step5/me/fish-atlas', anglerB.user.token)).body.items.map((row) => row.fishCode),
    ['yellow_croaker'], 'a passenger own report lights their personal atlas even when pending review');
  const atlasB = await request('GET', '/step5/me/fish-atlas', anglerB.user.token);
  check(atlasB.body.items.map((row) => row.fishCode), ['yellow_croaker'],
    'a passenger own report lights their atlas while the cross-source result is pending');

  const youngCaptainReport = await request(
    'POST', `/step5/departures/${youngTrip.departureId}/captain-catch`, captain.token,
    { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 2 }] },
  );
  check(youngCaptainReport.status, 201, 'captain can record a trip with a recent first-time passenger');
  const youngDispute = await request(
    'POST', `/step5/departures/${youngTrip.departureId}/passenger-catch`, youngAngler.user.token,
    { captainResponse: { action: 'dispute' } },
  );
  check(youngDispute.status, 201, 'a passenger with a recent first trip can dispute the captain source');
  check((await request(
    'GET', `/step5/departures/${youngTrip.departureId}/me`, youngAngler.user.token,
  )).body.captainReport.items[0].quantity, 2, 'dispute leaves the captain source unchanged');
  check((await request('GET', '/step5/me/fish-atlas', youngAngler.user.token)).body.items, [],
    'a dispute alone does not light a captain-only fish in the personal atlas');
  const lateOwnCatch = await request(
    'POST', `/step5/departures/${youngTrip.departureId}/passenger-catch`, youngAngler.user.token,
    { catchReport: { outcome: 'caught', items: [{ fishCode: 'sea_bass', quantity: 1 }] } },
  );
  check(lateOwnCatch.status, 201, 'passenger can add their own source after a separate captain response');
  check(lateOwnCatch.body.reconciliation.conflict, true,
    'a passenger species missing from the captain list is marked as a discrepancy');
  const lateOwnState = await request(
    'GET', `/step5/departures/${youngTrip.departureId}/me`, youngAngler.user.token,
  );
  check(lateOwnState.body.captainResponse.action, 'dispute',
    'adding a passenger source preserves the already-submitted dispute');
  check(lateOwnState.body.captainReport.items[0].quantity, 2,
    'adding a passenger source does not overwrite the captain original');
  check((await request('GET', '/step5/me/fish-atlas', youngAngler.user.token)).body.items.map((row) => row.fishCode),
    ['sea_bass'], 'an independent passenger report lights their own species after a captain dispute');

  const supplementCaptainReport = await request(
    'POST', `/step5/departures/${supplementTrip.departureId}/captain-catch`, captain.token,
    { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 2 }] },
  );
  check(supplementCaptainReport.status, 201, 'captain can submit source for supplement review');
  const passengerSupplement = await request(
    'POST', `/step5/departures/${supplementTrip.departureId}/passenger-catch`, supplementAngler.user.token,
    { captainResponse: { action: 'supplement', items: [{ fishCode: 'sea_bass', quantity: 1 }] } },
  );
  check(passengerSupplement.status, 201, 'passenger can submit an explicit supplement');
  check(passengerSupplement.body.reconciliation.status, 'pending_review',
    'a supplemental species absent from the vessel record is marked for review');
  const supplementState = await request(
    'GET', `/step5/departures/${supplementTrip.departureId}/me`, supplementAngler.user.token,
  );
  check(supplementState.body.captainReport.items.map((row) => row.fishCode), ['yellow_croaker'],
    'the supplement preserves the original captain source');
  check(supplementState.body.captainResponse.items.map((row) => row.fishCode), ['sea_bass'],
    'the supplement is preserved as a separate response source');
  check((await request('GET', '/step5/me/fish-atlas', supplementAngler.user.token)).body.items.map((row) => row.fishCode),
    ['sea_bass'], 'a passenger supplement lights only that passenger atlas');

  const departureLock = await holdDepartureRow(raceTrip.departureId);
  let raceWaiterCount = 0;
  let raceResponses;
  const captainRaceRequest = request(
    'POST', `/step5/departures/${raceTrip.departureId}/captain-catch`, captain.token,
    { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 1 }] },
  );
  const passengerRaceRequest = request(
    'POST', `/step5/departures/${raceTrip.departureId}/passenger-catch`, raceAngler.user.token,
    { catchReport: { outcome: 'caught', items: [{ fishCode: 'yellow_croaker', quantity: 2 }] } },
  );
  try {
    raceWaiterCount = await waitForStep5DepartureLockWaiters(2);
  } finally {
    await departureLock.query('COMMIT');
    departureLock.release();
  }
  raceResponses = await Promise.all([captainRaceRequest, passengerRaceRequest]);
  check(raceWaiterCount, 2, 'both concurrent source submissions wait on the shared departure lock');
  check(raceResponses.map((response) => response.status), [201, 201],
    'concurrent captain and passenger reports both commit after serialization');
  const raceState = await request('GET', `/step5/departures/${raceTrip.departureId}/me`, raceAngler.user.token);
  check(raceState.body.reconciliation, 'pending_review',
    'serialized cross-source writes leave reconciliation aware of both committed reports');
  check((await scalar(
    'SELECT count(*)::integer AS count FROM step5_catch_reports WHERE departure_id=$1',
    [raceTrip.departureId],
  )).count, 2, 'both append-only source reports survive concurrent submission');

  const zeroTrip = await request(
    'POST', `/step5/departures/${secondTrip.departureId}/captain-catch`, captain.token,
    { outcome: 'zero_catch', items: [] },
  );
  check(zeroTrip.status, 201, 'zero catch is an explicit accepted report');
  const zeroState = await request('GET', `/step5/departures/${secondTrip.departureId}/me`, captain.token);
  check(zeroState.body.captainReport.outcome, 'zero_catch', 'zero catch is distinguishable from missing report');
  check((await request('GET', `/step5/departures/${secondTrip.departureId}/me`, anglerA.user.token)).body.captainReport.outcome,
    'zero_catch', 'passenger sees the explicit zero-catch report');
  const explicitDispute = await request(
    'POST', `/step5/departures/${secondTrip.departureId}/passenger-catch`, anglerA.user.token,
    { captainResponse: { action: 'dispute' } },
  );
  check(explicitDispute.status, 201, 'passenger can explicitly dispute the captain report');
  check(explicitDispute.body.reconciliation.status, 'pending_review', 'an explicit dispute is marked for review');
  const disputeState = await request(
    'GET', `/step5/departures/${secondTrip.departureId}/me`, anglerA.user.token,
  );
  check(disputeState.body.captainResponse.action, 'dispute', 'the passenger dispute is preserved as a separate response');
  check(disputeState.body.captainReport.outcome, 'zero_catch', 'the dispute does not alter the captain original record');

  const boatFacts = await request('GET', `/step5/boats/${boatId}/facts`);
  check(boatFacts.body.conditionTagCounts,
    [
      { tag: 'clean_deck', count: 1 },
      { tag: 'comfortable_space', count: 1 },
      { tag: 'facilities_match', count: 1 },
    ], 'boat condition tags are aggregated separately from captain ability');
  check(boatFacts.body.crossSourceChecks.pendingReviewCount, 5,
    'boat facts keep passenger disputes separate from captain facts');
  check(boatFacts.body.crossSourceChecks.sampleCount, 6,
    'cross-source facts include the trip passengers with source reports');

  const facts = await request('GET', '/step5/me/captain-facts', captain.token);
  check(facts.status, 200, 'captain facts are available to the captain');
  check(facts.body.completedTripCount, 6, 'completed facts count returned trips with passengers and without reports');
  check(facts.body.catchReports, {
    reportedTripCount: 5, missingReportCount: 1, zeroCatchTripCount: 1, zeroCatchRatePercent: 20,
  }, 'zero-catch rate excludes unreported completed departures from its denominator');
  check(facts.body.repeatBookings.cohortPassengerCount, 3,
    'mature passengers enter the repeat cohort while first trips under 90 days old do not');
  check(facts.body.repeatBookings.repeatPassengerCount, 1, 'repeat fact counts a second completed sailing by the same identity');
  check(facts.body.crossSourceChecks, {
    sampleWindowMonths: 12, sampleCount: 6, pendingReviewCount: 5, pendingReviewRatePercent: 83.3,
  }, 'pending cross-source review is surfaced with its sample denominator');
  check(facts.body.serviceReviews.sampleCount, 3, 'captain service sample count includes reviews without service tags');
  check(facts.body.serviceReviews.tagCounts, [
    { tag: 'clear_guidance', count: 2 },
    { tag: 'on_time', count: 1 },
  ], 'service tags aggregate counts across reviews and exclude boat-only tags');

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
