import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFCompensationFen,
  FCompensationCouponError,
  F_COMPENSATION_SCENARIOS,
  issueFCompensationCoupon,
} from '../src/f-compensation-coupon-service.js';

test('F voucher is three percent of paid ticket fare, rounded half-up to fen', () => {
  assert.equal(calculateFCompensationFen(50_000), 1_500);
  assert.equal(calculateFCompensationFen(48_000), 1_440);
  assert.equal(calculateFCompensationFen(50), 2);
  assert.equal(calculateFCompensationFen(49), 1);
  assert.equal(calculateFCompensationFen(0), 0);
});

test('F voucher calculation rejects invalid and out-of-range fares', () => {
  for (const amount of [-1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => calculateFCompensationFen(amount), TypeError);
  }
});

test('only the two approved F scenarios map to their designated subsidy accounts', () => {
  assert.deepEqual(F_COMPENSATION_SCENARIOS, {
    captain_non_weather_cancel: 'captain_guarantee',
    platform_attributable_failure: 'platform',
  });
  assert.equal(F_COMPENSATION_SCENARIOS.weather_cancellation, undefined);
  assert.equal(F_COMPENSATION_SCENARIOS.insurer_decline, undefined);
  assert.equal(F_COMPENSATION_SCENARIOS.charter_displacement, undefined);
});

function fakeClient(order) {
  const rows = new Map();
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM booking_orders o JOIN departures d')) {
        return { rowCount: order ? 1 : 0, rows: order ? [order] : [] };
      }
      if (sql.includes('INSERT INTO f_compensation_coupon_ledger')) {
        const key = `${values[0]}:${values[1]}`;
        if (rows.has(key)) return { rowCount: 0, rows: [] };
        const row = {
          id: 'coupon-id', source_event_key: values[0], source_order_id: values[1],
          beneficiary_user_id: values[2], scenario: values[3], responsible_party: values[4],
          ticket_paid_fen: values[5], amount_fen: values[6], issued_by: values[7],
          issue_note: values[8], issued_at: new Date('2026-10-29T00:00:00Z'),
          expires_at: new Date('2027-10-29T00:00:00Z'),
        };
        rows.set(key, row);
        return { rowCount: 1, rows: [row] };
      }
      if (sql.includes('SELECT * FROM f_compensation_coupon_ledger')) {
        const row = rows.get(`${values[0]}:${values[1]}`);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('F issuance books discounted paid ticket fare, excludes platform/insurance charges, and replays idempotently', async () => {
  const client = fakeClient({
    id: 'order-id', buyer_user_id: 'buyer-id', status: 'cancelled', paid_at: new Date(),
    seat_fee_fen: 50_000, discount_fen: 1_000, platform_fee_fen: 3_000,
    departure_status: 'cancelled',
  });
  const input = {
    orderId: 'order-id', sourceEventKey: 'incident-2026-10-29',
    scenario: 'captain_non_weather_cancel', issueNote: '船长非天气原因取消，经沙盒核验',
  };
  const first = await issueFCompensationCoupon(client, input);
  assert.equal(first.ticketPaidFen, 49_000);
  assert.equal(first.amountFen, 1_470);
  assert.equal(first.responsibleParty, 'captain_guarantee');
  assert.equal(first.replayed, false);
  assert.equal(client.calls.filter(({ sql }) => sql.startsWith('UPDATE')).length, 0);

  const replay = await issueFCompensationCoupon(client, input);
  assert.equal(replay.id, first.id);
  assert.equal(replay.replayed, true);
});

test('platform fault can affect one cancelled booking while the departure remains available', async () => {
  const client = fakeClient({
    id: 'order-id', buyer_user_id: 'buyer-id', status: 'cancelled', paid_at: new Date(),
    seat_fee_fen: 48_000, discount_fen: 0, departure_status: 'open',
  });
  const coupon = await issueFCompensationCoupon(client, {
    orderId: 'order-id', sourceEventKey: 'platform-fault-001',
    scenario: 'platform_attributable_failure', issueNote: '平台故障导致该订单取消',
  });
  assert.equal(coupon.amountFen, 1_440);
  assert.equal(coupon.responsibleParty, 'platform');
});

test('weather cancellations and incompatible replay classifications are rejected', async () => {
  const weatherClient = fakeClient({
    id: 'order-id', buyer_user_id: 'buyer-id', status: 'cancelled', paid_at: new Date(),
    seat_fee_fen: 50_000, discount_fen: 0, departure_status: 'weather_cancelled',
  });
  await assert.rejects(
    issueFCompensationCoupon(weatherClient, {
      orderId: 'order-id', sourceEventKey: 'weather-event-001',
      scenario: 'platform_attributable_failure', issueNote: '天气停航不得发券',
    }), FCompensationCouponError,
  );

  const client = fakeClient({
    id: 'order-id', buyer_user_id: 'buyer-id', status: 'cancelled', paid_at: new Date(),
    seat_fee_fen: 50_000, discount_fen: 0, departure_status: 'cancelled',
  });
  await issueFCompensationCoupon(client, {
    orderId: 'order-id', sourceEventKey: 'same-event-001',
    scenario: 'platform_attributable_failure', issueNote: '平台故障导致该订单取消',
  });
  await assert.rejects(
    issueFCompensationCoupon(client, {
      orderId: 'order-id', sourceEventKey: 'same-event-001',
      scenario: 'captain_non_weather_cancel', issueNote: '船长原因分类不得覆盖原记录',
    }), (error) => error instanceof FCompensationCouponError && error.statusCode === 409,
  );
});
