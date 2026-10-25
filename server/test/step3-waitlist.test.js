import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizationExpiresAt,
  cancellationAmounts,
  effectivePaymentAtOrBeforeDeadline,
  formationConfirmationAt,
  isWaitlistAuthorizationAllowed,
  waitlistWindowClosesAt,
} from '../src/step3-waitlist.js';

const confirmationAt = new Date('2026-10-24T10:00:00.000Z'); // 18:00 Asia/Shanghai
const closeAt = new Date('2026-10-24T10:10:00.000Z'); // 18:10 Asia/Shanghai

test('confirmation point is the day before departure at 18:00 Asia/Shanghai', () => {
  assert.equal(
    formationConfirmationAt('2026-10-25T02:00:00.000Z').toISOString(),
    confirmationAt.toISOString(),
  );
});

test('the 18:00 and 18:10 boundaries are exclusive for new waitlist authorizations', () => {
  assert.equal(waitlistWindowClosesAt(confirmationAt).toISOString(), closeAt.toISOString());
  assert.equal(isWaitlistAuthorizationAllowed({
    queuedAt: '2026-10-24T09:59:59.999Z',
    releasedAt: '2026-10-24T09:59:59.999Z',
    authorizedAt: '2026-10-24T10:09:59.999Z',
    confirmationAt,
  }), true);
  assert.equal(isWaitlistAuthorizationAllowed({
    queuedAt: confirmationAt,
    releasedAt: '2026-10-24T09:59:00.000Z',
    authorizedAt: '2026-10-24T10:00:00.000Z',
    confirmationAt,
  }), false);
  assert.equal(isWaitlistAuthorizationAllowed({
    queuedAt: '2026-10-24T09:59:00.000Z',
    releasedAt: confirmationAt,
    authorizedAt: '2026-10-24T10:00:00.000Z',
    confirmationAt,
  }), false);
  assert.equal(isWaitlistAuthorizationAllowed({
    queuedAt: '2026-10-24T09:59:00.000Z',
    releasedAt: '2026-10-24T09:59:00.000Z',
    authorizedAt: closeAt,
    confirmationAt,
  }), false);
  assert.equal(authorizationExpiresAt('2026-10-24T10:09:00.000Z', confirmationAt).toISOString(), closeAt.toISOString());
});

test('authorization duration is capped to the remaining closeout window', () => {
  assert.equal(
    authorizationExpiresAt('2026-10-24T10:05:00.000Z', confirmationAt).toISOString(),
    closeAt.toISOString(),
  );
  assert.equal(
    authorizationExpiresAt('2026-10-24T10:09:00.000Z', confirmationAt).toISOString(),
    closeAt.toISOString(),
  );
});

test('late payment only counts when the provider timestamp is at or before authorization expiry', () => {
  assert.equal(effectivePaymentAtOrBeforeDeadline('2026-10-24T10:09:59.999Z', closeAt), true);
  assert.equal(effectivePaymentAtOrBeforeDeadline('2026-10-24T10:10:00.001Z', closeAt), false);
});

test('cancellation penalty uses the approved left-open, right-closed bands', () => {
  const departureAt = Date.parse('2026-10-25T10:00:00.000Z');
  const cases = [
    { hoursBefore: 73, penaltyFen: 0, penaltyRate: 0 },
    { hoursBefore: 72, penaltyFen: 15000, penaltyRate: 0.3 },
    { hoursBefore: 24 + 1 / 3_600_000, penaltyFen: 15000, penaltyRate: 0.3 },
    { hoursBefore: 24, penaltyFen: 30000, penaltyRate: 0.6 },
    { hoursBefore: 6 + 1 / 3_600_000, penaltyFen: 30000, penaltyRate: 0.6 },
    { hoursBefore: 6, penaltyFen: 50000, penaltyRate: 1 },
  ];

  for (const { hoursBefore, penaltyFen, penaltyRate } of cases) {
    const cancelledAt = new Date(departureAt - hoursBefore * 3_600_000).toISOString();
    assert.deepEqual(cancellationAmounts(50000, new Date(departureAt).toISOString(), cancelledAt), {
      penaltyFen,
      refundFen: 50000 - penaltyFen,
      penaltyRate,
    }, `${hoursBefore} hours before departure`);
  }
});
