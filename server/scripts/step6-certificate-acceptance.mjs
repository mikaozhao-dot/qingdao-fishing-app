import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createSecurity, makeSandboxIdentityNumber } from '../src/security.js';

if (process.env.STEP6_CERTIFICATE_ACCEPTANCE !== 'true') {
  throw new Error('Set STEP6_CERTIFICATE_ACCEPTANCE=true and use an isolated acceptance database.');
}
if (!config.databaseUrl) throw new Error('DATABASE_URL is required.');

const testConfig = {
  ...config,
  nodeEnv: 'test',
  logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
  piiEncryptionKeyHex: config.piiEncryptionKeyHex || '11'.repeat(32),
  phoneHashKeyHex: config.phoneHashKeyHex || '22'.repeat(32),
  paymentSandboxSecretHex: config.paymentSandboxSecretHex || '33'.repeat(32),
  promotionPublicBaseUrl: 'https://promotion.acceptance.invalid',
};
const security = createSecurity(testConfig);
const { Pool } = pg;
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
const app = buildApp(testConfig);
let assertions = 0;
let userSequence = 0;

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
  const isJson = response.headers['content-type']?.includes('application/json');
  return { status: response.statusCode, body: isJson ? response.json() : response.body, headers: response.headers };
}

async function expect(method, path, token, payload, expectedStatus) {
  const result = await request(method, path, token, payload);
  check(result.status, expectedStatus, `${method} ${path}: ${JSON.stringify(result.body)}`);
  return result;
}

async function makeUser(name, { captain = false } = {}) {
  userSequence += 1;
  const id = randomUUID();
  const phone = `139${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const identity = makeSandboxIdentityNumber(String(userSequence).padStart(3, '0'));
  const token = security.newToken();
  await pool.query(
    `INSERT INTO users
       (id,phone_ciphertext,phone_hash,display_name,legal_name_ciphertext,
        identity_number_ciphertext,identity_verified_at,identity_status)
     VALUES ($1,$2,$3,$4,$5,$6,now(),'verified')`,
    [id, security.encrypt(phone), security.phoneHash(phone), name,
      security.encrypt(name), security.encrypt(identity)],
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
  return { id, token, identity, name };
}

async function makeTrip({ owner, captain, status = 'completed', returned = true }) {
  const boatId = randomUUID();
  const departureId = randomUUID();
  const departureAt = new Date(Date.now() - 7 * 86400000);
  const returnAt = new Date(departureAt.getTime() + 6 * 3600000);
  const seatId = randomUUID();
  const orderId = randomUUID();
  const passengerId = randomUUID();
  await pool.query(
    `INSERT INTO boats (id,captain_user_id,name,length_cm,home_marina_code,seat_count,review_status)
     VALUES ($1,$2,$3,880,'xiaogang',12,'approved')`,
    [boatId, captain.id, `证书验收船-${departureId.slice(0, 4)}`],
  );
  await pool.query(
    `INSERT INTO departures
       (id,boat_id,captain_user_id,trip_type,departure_at,return_at,target_area_code,marina_code,
        minimum_sailing_total_fen,price_per_seat_fen,booking_deadline,status,
        seat_template_count,platform_quota_seats,offline_quota_seats,manual_supply)
     VALUES ($1,$2,$3,'pro_fishing',$4,$5,'qingdao_nearshore','xiaogang',10000,10000,
        $4-interval '1 hour',$6,12,12,0,false)`,
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
  await pool.query(
    `INSERT INTO seat_inventory
       (id,departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,$2,1,10000,'port','mid','booked','platform')`, [seatId, departureId],
  );
  await pool.query(
    `INSERT INTO booking_orders
       (id,order_number,departure_id,seat_inventory_id,buyer_user_id,status,
        seat_fee_fen,discount_fen,platform_fee_fen,total_amount_fen,paid_at)
     VALUES ($1,$2,$3,$4,$5,'completed',10000,0,0,10000,now())`,
    [orderId, `CERT-${departureId.replaceAll('-', '').slice(0, 20)}`,
      departureId, seatId, owner.id],
  );
  await pool.query(
    `INSERT INTO order_passengers
       (id,order_id,full_name_ciphertext,identity_number_ciphertext,phone_ciphertext,identity_verified_at)
     VALUES ($1,$2,$3,$4,$5,now())`,
    [passengerId, orderId, security.encrypt(owner.name), security.encrypt(owner.identity),
      security.encrypt('13800000000')],
  );
  const coverageId = randomUUID();
  await pool.query(
    `INSERT INTO passenger_insurance_coverages
       (id,departure_id,order_id,passenger_id,coverage_start_at,coverage_end_at,
        status,provider_code,verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,'effective','sandbox',now())`,
    [coverageId, departureId, orderId, passengerId, departureAt, returnAt],
  );
  await pool.query(
    `INSERT INTO departure_passenger_gate_decisions
       (departure_id,passenger_id,coverage_id,captain_user_id,decision,coverage_status)
     VALUES ($1,$2,$3,$4,'allowed','effective')`,
    [departureId, passengerId, coverageId, captain.id],
  );
  return { departureId, departureAt, returnAt, boatId, orderId, passengerId, captain, owner };
}

async function addSecondPassenger(trip, user) {
  const seatId = randomUUID();
  const orderId = randomUUID();
  const passengerId = randomUUID();
  await pool.query(
    `INSERT INTO seat_inventory
       (id,departure_id,seat_number,price_fen,seat_side,seat_section,status,sale_channel)
     VALUES ($1,$2,2,10000,'starboard','mid','booked','platform')`, [seatId, trip.departureId],
  );
  await pool.query(
    `INSERT INTO booking_orders
       (id,order_number,departure_id,seat_inventory_id,buyer_user_id,status,
        seat_fee_fen,discount_fen,platform_fee_fen,total_amount_fen,paid_at)
     VALUES ($1,$2,$3,$4,$5,'completed',10000,0,0,10000,now())`,
    [orderId, `CERT-${orderId.replaceAll('-', '').slice(0, 20)}`,
      trip.departureId, seatId, user.id],
  );
  await pool.query(
    `INSERT INTO order_passengers
       (id,order_id,full_name_ciphertext,identity_number_ciphertext,phone_ciphertext,identity_verified_at)
     VALUES ($1,$2,$3,$4,$5,now())`,
    [passengerId, orderId, security.encrypt(user.name), security.encrypt(user.identity),
      security.encrypt('13700000000')],
  );
  const coverageId = randomUUID();
  await pool.query(
    `INSERT INTO passenger_insurance_coverages
       (id,departure_id,order_id,passenger_id,coverage_start_at,coverage_end_at,
        status,provider_code,verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,'effective','sandbox',now())`,
    [coverageId, trip.departureId, orderId, passengerId, trip.departureAt, trip.returnAt],
  );
  await pool.query(
    `INSERT INTO departure_passenger_gate_decisions
       (departure_id,passenger_id,coverage_id,captain_user_id,decision,coverage_status)
     VALUES ($1,$2,$3,$4,'allowed','effective')`,
    [trip.departureId, passengerId, coverageId, trip.captain.id],
  );
  return { passengerId, orderId };
}

async function addFacts(trip, {
  ownOutcome = null,
  ownItems = [],
  captainItems = null,
  responseAction = null,
  responseItems = [],
  reconciliation = null,
} = {}) {
  let captainReportId = null;
  if (captainItems != null) {
    captainReportId = randomUUID();
    await pool.query(
      `INSERT INTO step5_catch_reports
         (id,departure_id,source,author_user_id,outcome)
       VALUES ($1,$2,'captain',$3,$4)`,
      [captainReportId, trip.departureId, trip.captain.id,
        captainItems.length ? 'caught' : 'zero_catch'],
    );
    for (const item of captainItems) {
      await pool.query(
        `INSERT INTO step5_catch_items
           (report_id,fish_code,quantity,max_individual_weight_grams,max_length_mm)
         VALUES ($1,$2,$3,$4,$5)`,
        [captainReportId, item.fishCode, item.quantity,
          item.maxWeight ?? null, item.maxLength ?? null],
      );
    }
  }

  let passengerReportId = null;
  if (ownOutcome) {
    passengerReportId = randomUUID();
    await pool.query(
      `INSERT INTO step5_catch_reports
         (id,departure_id,source,author_user_id,passenger_id,order_id,outcome)
       VALUES ($1,$2,'passenger',$3,$4,$5,$6)`,
      [passengerReportId, trip.departureId, trip.owner.id, trip.passengerId,
        trip.orderId, ownOutcome],
    );
    for (const item of ownItems) {
      await pool.query(
        `INSERT INTO step5_catch_items
           (report_id,fish_code,quantity,max_individual_weight_grams,max_length_mm)
         VALUES ($1,$2,$3,$4,$5)`,
        [passengerReportId, item.fishCode, item.quantity,
          item.maxWeight ?? null, item.maxLength ?? null],
      );
    }
  }

  if (captainReportId && (responseAction || reconciliation)) {
    const status = reconciliation ?? (responseAction === 'confirm' ? 'confirmed'
      : responseAction === 'supplement' ? 'supplemented' : 'pending_review');
    await pool.query(
      `INSERT INTO step5_catch_reconciliations
         (departure_id,passenger_id,captain_report_id,status)
       VALUES ($1,$2,$3,$4)`,
      [trip.departureId, trip.passengerId, captainReportId, status],
    );
    if (responseAction) {
      const responseId = randomUUID();
      await pool.query(
        `INSERT INTO step5_catch_report_responses
           (id,captain_report_id,departure_id,passenger_id,responder_user_id,action)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [responseId, captainReportId, trip.departureId, trip.passengerId,
          trip.owner.id, responseAction],
      );
      for (const item of responseItems) {
        await pool.query(
          `INSERT INTO step5_catch_response_items
             (response_id,fish_code,quantity,max_individual_weight_grams,max_length_mm)
           VALUES ($1,$2,$3,$4,$5)`,
          [responseId, item.fishCode, item.quantity,
            item.maxWeight ?? null, item.maxLength ?? null],
        );
      }
    }
  }
  return { captainReportId, passengerReportId };
}

try {
  await app.ready();
  const captain = await makeUser('证书船长', { captain: true });

  const noRecordOwner = await makeUser('无记录乘客');
  const noRecordTrip = await makeTrip({ owner: noRecordOwner, captain });
  await expect('GET', `/step6/certificates/departures/${noRecordTrip.departureId}/preview`,
    noRecordOwner.token, undefined, 409);

  const zeroOwner = await makeUser('零渔获乘客');
  const zeroTrip = await makeTrip({ owner: zeroOwner, captain });
  await addFacts(zeroTrip, { ownOutcome: 'zero_catch' });
  await expect('GET', `/step6/certificates/departures/${zeroTrip.departureId}/preview`,
    zeroOwner.token, undefined, 409);

  const pendingOwner = await makeUser('待核对乘客');
  const pendingTrip = await makeTrip({ owner: pendingOwner, captain });
  await addFacts(pendingTrip, {
    ownOutcome: 'caught', ownItems: [{ fishCode: 'yellow_croaker', quantity: 2 }],
    captainItems: [{ fishCode: 'yellow_croaker', quantity: 5 }],
    responseAction: 'dispute', reconciliation: 'pending_review',
  });
  await expect('GET', `/step6/certificates/departures/${pendingTrip.departureId}/preview`,
    pendingOwner.token, undefined, 409);

  const incompleteOwner = await makeUser('未返航乘客');
  const incompleteTrip = await makeTrip({ owner: incompleteOwner, captain, returned: false });
  await addFacts(incompleteTrip, {
    ownOutcome: 'caught', ownItems: [{ fishCode: 'sea_bass', quantity: 1 }],
  });
  await expect('GET', `/step6/certificates/departures/${incompleteTrip.departureId}/preview`,
    incompleteOwner.token, undefined, 409);

  const otherOwner = await makeUser('本人渔获乘客');
  const otherTrip = await makeTrip({ owner: otherOwner, captain });
  await addFacts(otherTrip, {
    ownOutcome: 'caught', ownItems: [{ fishCode: 'blackhead', quantity: 3, maxWeight: 840, maxLength: 360 }],
  });
  const stranger = await makeUser('无关乘客');
  await expect('GET', `/step6/certificates/departures/${otherTrip.departureId}/preview`,
    stranger.token, undefined, 403);

  const owner = await makeUser('海风钓友');
  const personalTrip = await makeTrip({ owner, captain });
  await addFacts(personalTrip, {
    ownOutcome: 'caught', ownItems: [
      { fishCode: 'yellow_croaker', quantity: 2, maxWeight: 1250, maxLength: 410 },
      { fishCode: 'sea_bass', quantity: 1 },
    ],
  });
  const preview = await expect('GET', `/step6/certificates/departures/${personalTrip.departureId}/preview`,
    owner.token, undefined, 200);
  check(preview.body.preview.displayName, '海风钓友', 'certificate uses the account display name');
  check(preview.body.preview.fishItems[0], {
    fishCode: 'yellow_croaker', fishName: '小黄鱼', quantity: 2,
    maxIndividualWeightGrams: 1250, maxLengthMm: 410, source: '本人记录',
  }, 'preview copies source facts without editable or synthesized values');
  assert.ok(preview.body.preview.landingUrl.includes('source=certificate'));
  assertions += 1;
  check(preview.body.preview.promotionCode.length > 0, true, 'certificate reuses the normal member promotion code');

  const created = await expect('POST', '/step6/certificates', owner.token,
    { departureId: personalTrip.departureId }, 201);
  check(created.body.created, true, 'first generation freezes a certificate snapshot');
  const certificateId = created.body.certificate.id;
  const frozenName = created.body.certificate.snapshot.boatName;
  const promotionCode = created.body.certificate.snapshot.promotionCode;
  check(created.body.certificate.snapshot.displayName, '海风钓友', 'snapshot omits real identity fields');
  check(Object.keys(created.body.certificate.snapshot).some((key) => /phone|identity|order/i.test(key)),
    false, 'public certificate snapshot has no phone, identity, or order fields');
  await pool.query("UPDATE boats SET name='修改后的船名' WHERE id=$1", [personalTrip.boatId]);
  await pool.query("UPDATE users SET display_name='修改后的昵称' WHERE id=$1", [owner.id]);
  const duplicate = await expect('POST', '/step6/certificates', owner.token,
    { departureId: personalTrip.departureId }, 200);
  check(duplicate.body.created, false, 'duplicate generation returns the original certificate');
  check(duplicate.body.certificate.snapshot.boatName, frozenName, 'existing certificate remains frozen after source changes');
  check(duplicate.body.certificate.snapshot.displayName, '海风钓友', 'display snapshot remains frozen');

  const scanned = await request('GET', `/p/${promotionCode}?source=certificate`, null);
  check(scanned.status, 200, 'certificate QR resolves to the existing H5 promotion landing');
  const visitor = await pool.query(
    `SELECT source_channel FROM promotion_touch_events
     WHERE promotion_code_id=(SELECT id FROM promotion_codes WHERE code=$1)`, [promotionCode],
  );
  check(visitor.rows[0]?.source_channel, 'certificate', 'certificate marks the touch source without changing attribution rules');

  const hidden = await expect('DELETE', `/step6/certificates/${certificateId}`, owner.token, undefined, 200);
  check(hidden.body.hidden, true, 'deleting a certificate only hides its list item');
  const listAfterHide = await expect('GET', '/step6/certificates/me', owner.token, undefined, 200);
  check(listAfterHide.body.certificates.some((row) => row.id === certificateId), false,
    'hidden certificate is removed from the app list');
  const retained = await pool.query(
    `SELECT c.code,cert.hidden_at,cert.snapshot->>'promotionCode' AS snapshot_code
     FROM step6_certificates cert JOIN promotion_codes c ON c.id=cert.promotion_code_id
     WHERE cert.id=$1`, [certificateId],
  );
  check(retained.rows[0]?.code, promotionCode, 'hidden certificate does not revoke its promotion code');
  check(retained.rows[0]?.snapshot_code, promotionCode, 'hidden certificate snapshot remains stored');

  const confirmedOwner = await makeUser('确认记录钓友');
  const confirmedTrip = await makeTrip({ owner: confirmedOwner, captain });
  await addFacts(confirmedTrip, {
    captainItems: [{ fishCode: 'hairtail', quantity: 4, maxWeight: 1900 }],
    responseAction: 'confirm', reconciliation: 'confirmed',
  });
  const confirmed = await expect('GET', `/step6/certificates/departures/${confirmedTrip.departureId}/preview`,
    confirmedOwner.token, undefined, 200);
  check(confirmed.body.preview.fishItems[0].source, '船长整船记录（本人确认）',
    'captain source appears only after explicit passenger confirmation');

  const supplementedOwner = await makeUser('补充记录钓友');
  const supplementedTrip = await makeTrip({ owner: supplementedOwner, captain });
  await addFacts(supplementedTrip, {
    captainItems: [{ fishCode: 'hairtail', quantity: 8 }],
    responseAction: 'supplement', reconciliation: 'supplemented',
    responseItems: [{ fishCode: 'black_seabream', quantity: 2, maxLength: 330 }],
  });
  const supplemented = await expect('GET', `/step6/certificates/departures/${supplementedTrip.departureId}/preview`,
    supplementedOwner.token, undefined, 200);
  check(supplemented.body.preview.fishItems.length, 1, 'supplement uses the passenger source without copying unconfirmed captain totals');
  check(supplemented.body.preview.fishItems[0].source, '本人补充', 'supplement source is clearly labeled');

  const globallyPendingOwner = await makeUser('全航次待核对乘客');
  const globallyPendingTrip = await makeTrip({ owner: globallyPendingOwner, captain });
  const globalRefs = await addFacts(globallyPendingTrip, {
    captainItems: [{ fishCode: 'greenling', quantity: 3 }],
    responseAction: 'confirm', reconciliation: 'confirmed',
  });
  const secondPassenger = await makeUser('另一位待核对乘客');
  const second = await addSecondPassenger(globallyPendingTrip, secondPassenger);
  await pool.query(
    `INSERT INTO step5_catch_reconciliations (departure_id,passenger_id,captain_report_id,status)
     VALUES ($1,$2,$3,'pending_review')`,
    [globallyPendingTrip.departureId, second.passengerId, globalRefs.captainReportId],
  );
  await expect('GET', `/step6/certificates/departures/${globallyPendingTrip.departureId}/preview`,
    globallyPendingOwner.token, undefined, 409);

  const noAuth = await request('GET', '/step6/certificates/me', null);
  check(noAuth.status, 401, 'certificate list requires an authenticated owner');

  console.log(`Step 6 slice 2 certificate acceptance passed: ${assertions} assertions.`);
} finally {
  await app.close().catch(() => {});
  await pool.end().catch(() => {});
}
