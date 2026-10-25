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
  assert.deepEqual(cancellationAmounts(50000, '2026-10-25T10:00:00.000Z', '2026-10-22T09:00:00.000Z'), {
    penaltyFen: 0, refundFen: 50000, penaltyRate: 0,
  });
  assert.deepEqual(cancellationAmounts(50000, '2026-10-25T10:00:00.000Z', '2026-10-24T04:00:00.000Z'), {
    penaltyFen: 15000, refundFen: 35000, penaltyRate: 0.3,
  });
  assert.deepEqual(cancellationAmounts(50000, '2026-10-25T10:00:00.000Z', '2026-10-24T10:00:00.000Z'), {
    penaltyFen: 30000, refundFen: 20000, penaltyRate: 0.6,
  });
  assert.deepEqual(cancellationAmounts(50000, '2026-10-25T10:00:00.000Z', '2026-10-25T04:00:00.000Z'), {
    penaltyFen: 50000, refundFen: 0, penaltyRate: 1,
  });
});
