import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCommissionFen, calculateNetTicketFen } from '../src/promotion-service.js';

test('promotion commission is five percent of settled ticket fen, floored to fen', () => {
  assert.equal(calculateCommissionFen(10_000), 500);
  assert.equal(calculateCommissionFen(10_001), 500);
  assert.equal(calculateCommissionFen(0), 0);
});

test('net ticket amount excludes discounts and clamps refunds to the paid ticket amount', () => {
  assert.equal(calculateNetTicketFen({
    seat_fee_fen: 10_000,
    discount_fen: 500,
    ticket_refunded_fen: 2_000,
  }), 7_500);
  assert.equal(calculateNetTicketFen({
    seat_fee_fen: 10_000,
    discount_fen: 500,
    ticket_refunded_fen: 20_000,
  }), 0);
});
