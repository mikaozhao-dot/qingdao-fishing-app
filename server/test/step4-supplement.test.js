import test from 'node:test';
import assert from 'node:assert/strict';
import { distributeSupplementFen, refundRetryStatus } from '../src/step4-routes.js';

test('¥350 across nine paid seats is split in fen and sums to the frozen shortfall', () => {
  const orders = [
    { id: 'a', seat_count: 1 }, { id: 'b', seat_count: 1 }, { id: 'c', seat_count: 1 },
    { id: 'd', seat_count: 1 }, { id: 'e', seat_count: 1 }, { id: 'f', seat_count: 1 },
    { id: 'g', seat_count: 1 }, { id: 'h', seat_count: 1 }, { id: 'i', seat_count: 1 },
  ];
  const quotes = distributeSupplementFen(35000, orders);
  assert.deepEqual(quotes.map((quote) => quote.amountFen), [3889,3889,3889,3889,3889,3889,3889,3889,3888]);
  assert.equal(quotes.reduce((sum, quote) => sum + quote.amountFen, 0), 35000);
});

test('remainder follows seat order and combines correctly for multi-seat orders', () => {
  const quotes = distributeSupplementFen(11, [
    { id: 'first', seat_count: 2 },
    { id: 'second', seat_count: 2 },
  ]);
  assert.deepEqual(quotes.map((quote) => quote.amountFen), [6,5]);
});

test('refund retries stay pending until the third failure, then require manual review', () => {
  assert.equal(refundRetryStatus(1, false), 'pending');
  assert.equal(refundRetryStatus(2, false), 'pending');
  assert.equal(refundRetryStatus(3, false), 'manual_required');
  assert.equal(refundRetryStatus(3, true), 'sandbox_succeeded');
});
