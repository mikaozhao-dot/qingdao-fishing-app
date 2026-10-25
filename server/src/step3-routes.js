import { randomUUID } from 'node:crypto';
import { createSecurity, verifyChineseIdentityNumber } from './security.js';
import { createSandboxInsuranceAdapter, createSandboxPaymentAdapter } from './step3-adapters.js';
import { settleSupplementPayment } from './step4-routes.js';
import { registerStep3WaitlistRoutes } from './step3-waitlist-routes.js';
import { configuredStep3Clock, readStep3Clock } from './step3-clock.js';
import {
  closeoutAtSql,
  confirmationAtSql,
  dispatchWaitlistCandidates,
  effectivePaymentAtOrBeforeDeadline,
  processWaitlistDispatches,
} from './step3-waitlist.js';

const HOLD_MS = 10 * 60 * 1000;
const HOLD_KEY_PREFIX = 'fishing:step3:seat:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_PATTERN = /^[\p{Script=Han}·]{2,32}$/u;
const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const ALLOWED_OUTCOMES = new Set(['success', 'failure', 'timeout']);
const formationCutoffOpenSql =
  "((((departure_at AT TIME ZONE 'Asia/Shanghai')::date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai') > now()";

const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });
const holdKey = (seatId) => `${HOLD_KEY_PREFIX}${seatId}`;

function validUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function bookingWindowOpen(departure, now) {
  return departure?.status === 'open'
    && new Date(departure.departure_at) > new Date(now)
    && new Date(departure.booking_deadline) > new Date(now)
    && new Date(departure.confirmation_at) > new Date(now);
}

function orderWindowOpen(departure, waitlistEntry, hold, now) {
  if (new Date(hold.expires_at) <= new Date(now)
      || departure?.status !== 'open' || new Date(departure.departure_at) <= new Date(now)) return false;
  if (!hold.waitlist_entry_id) return bookingWindowOpen(departure, now);
  return waitlistEntry?.status === 'authorized' && waitlistEntry.accepted_at
    && new Date(waitlistEntry.authorization_expires_at) > new Date(now)
    && !departure.waitlist_window_closed_at && new Date(departure.closeout_at) > new Date(now);
}

function maskName(value) {
  const name = String(value ?? '');
  if (name.length < 2) return '*';
  return `${name[0]}${'*'.repeat(Math.min(name.length - 1, 4))}`;
}

function maskIdentity(value) {
  const identity = String(value ?? '');
  return identity.length < 8 ? '********' : `${identity.slice(0, 3)}***********${identity.slice(-4)}`;
}

function maskPhone(value) {
  const phone = String(value ?? '');
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '***********';
}

async function ensureRedis(redis) {
  if (!redis) return false;
  if (!redis.isOpen) await redis.connect();
  await redis.ping();
  return true;
}

async function deleteHoldKeys(redis, holdId, seatIds) {
  if (!redis?.isOpen || seatIds.length === 0) return;
  const script = `for i,key in ipairs(KEYS) do if redis.call('GET',key)==ARGV[1] then redis.call('DEL',key) end end return 1`;
  await redis.eval(script, { keys: seatIds.map(holdKey), arguments: [holdId] });
}

async function lockOrderTransaction(client, orderId) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`step3-order:${orderId}`],
  );
}

async function releaseHoldInTransaction(client, holdId, terminalStatus) {
  await client.query(
    `UPDATE departure_waitlist_entries SET status='expired',updated_at=now()
     WHERE hold_id=$1 AND status='authorized'`,
    [holdId],
  );
  const itemResult = await client.query(
    'SELECT seat_inventory_id FROM seat_hold_items WHERE hold_id=$1',
    [holdId],
  );
  const seatIds = itemResult.rows.map((row) => row.seat_inventory_id);
  const orderResult = await client.query(
    `SELECT id FROM booking_orders WHERE hold_id=$1 AND status='pending_payment' FOR UPDATE`,
    [holdId],
  );
  const orderIds = orderResult.rows.map((row) => row.id);
  if (orderIds.length) {
    await client.query(
      `UPDATE payment_transactions SET status='timed_out', updated_at=now(), completed_at=now()
       WHERE order_id=ANY($1::uuid[]) AND status='pending'`,
      [orderIds],
    );
    await client.query(
      `UPDATE booking_orders SET status='cancelled', cancelled_at=now(), updated_at=now()
       WHERE id=ANY($1::uuid[])`,
      [orderIds],
    );
    await client.query(
      `UPDATE booking_order_seats SET status='released'
       WHERE order_id=ANY($1::uuid[]) AND status='pending_payment'`,
      [orderIds],
    );
  }
  await client.query(
    `UPDATE seat_inventory SET status='available', hold_id=NULL, hold_expires_at=NULL, updated_at=now()
     WHERE hold_id=$1 AND status='held'`,
    [holdId],
  );
  await client.query(
    `UPDATE seat_hold_items SET status='released' WHERE hold_id=$1 AND status='active'`,
    [holdId],
  );
  await client.query(
    `UPDATE seat_holds SET status=$2, released_at=now() WHERE id=$1 AND status='active'`,
    [holdId, terminalStatus],
  );
  return seatIds;
}

async function expireHolds(pool, redis, departureId = null, clockNow = null) {
  const client = await pool.connect();
  const expired = [];
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id FROM seat_holds
       WHERE status='active' AND expires_at<=now() AND ($1::uuid IS NULL OR departure_id=$1)
       ORDER BY expires_at LIMIT 100`,
      [departureId],
    );
    for (const row of result.rows) {
      const candidate = await client.query(
        `SELECT order_id,departure_id FROM seat_holds
         WHERE id=$1 AND status='active' AND expires_at<=now()`,
        [row.id],
      );
      if (!candidate.rowCount) continue;
      const orderId = candidate.rows[0].order_id;
      if (orderId) {
        await lockOrderTransaction(client, orderId);
        const order = await client.query(
          'SELECT id,status FROM booking_orders WHERE id=$1 FOR UPDATE SKIP LOCKED',
          [orderId],
        );
        if (!order.rowCount) continue;
      }
      const hold = await client.query(
        `SELECT id,status,expires_at,order_id FROM seat_holds
         WHERE id=$1 AND status='active' AND expires_at<=now() FOR UPDATE SKIP LOCKED`,
        [row.id],
      );
      if (!hold.rowCount || hold.rows[0].order_id !== orderId) continue;
      if (orderId) {
        const order = await client.query(
          'SELECT status FROM booking_orders WHERE id=$1',
          [orderId],
        );
        if (!order.rowCount || order.rows[0].status === 'paid') continue;
      }
      expired.push({
        id: row.id,
        departureId: candidate.rows[0].departure_id,
        seatIds: await releaseHoldInTransaction(client, row.id, 'expired'),
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  for (const hold of expired) await deleteHoldKeys(redis, hold.id, hold.seatIds).catch(() => {});
  for (const departureId of new Set(expired.map((hold) => hold.departureId))) {
    await dispatchWaitlistCandidates(pool, redis, departureId, new Date(), clockNow).catch(() => {});
  }
  await processWaitlistDispatches(pool, redis, new Date(), clockNow).catch(() => {});
  return expired.length;
}

function seatState(row, currentUserId) {
  if (row.status === 'booked') return 'sold';
  if (row.status === 'blocked') return 'blocked';
  if (row.status === 'held' && row.hold_id) {
    return row.hold_user_id === currentUserId ? 'held-by-me' : 'locked';
  }
  return 'available';
}

function serializeSeat(row, currentUserId) {
  return {
    id: row.id,
    number: Number(row.seat_number),
    side: row.seat_side,
    section: row.seat_section,
    isPremium: row.is_premium,
    priceFen: Number(row.price_fen),
    status: seatState(row, currentUserId),
  };
}

async function loadOrder(pool, orderId, userId, security) {
  const orderResult = await pool.query(
    `SELECT o.id,o.order_number,o.status,o.seat_fee_fen,o.discount_fen,o.platform_fee_fen,
            o.total_amount_fen,o.hold_expires_at,o.created_at,o.paid_at,
            d.departure_at,d.return_at,d.marina_code,d.trip_type,b.name AS boat_name,
            ip.status AS insurance_status,ip.checkout_url,ip.provider_policy_reference
     FROM booking_orders o JOIN departures d ON d.id=o.departure_id
     JOIN boats b ON b.id=d.boat_id LEFT JOIN insurance_policies ip ON ip.order_id=o.id
     WHERE o.id=$1 AND o.buyer_user_id=$2`,
    [orderId, userId],
  );
  if (!orderResult.rowCount) return null;
  const row = orderResult.rows[0];
  const [seatResult, passengerResult, coverageResult] = await Promise.all([
    pool.query(
      `SELECT seat_number,price_fen FROM booking_order_seats
       WHERE order_id=$1 ORDER BY seat_number`,
      [orderId],
    ),
    pool.query(
      `SELECT op.seat_inventory_id,s.seat_number,op.full_name_ciphertext,
              op.identity_number_ciphertext,op.phone_ciphertext
       FROM order_passengers op LEFT JOIN seat_inventory s ON s.id=op.seat_inventory_id
       WHERE op.order_id=$1 ORDER BY s.seat_number NULLS LAST,op.id`,
      [orderId],
    ),
    pool.query(
      `SELECT s.seat_number,c.status,c.failure_reason,c.coverage_start_at,c.coverage_end_at,
              c.provider_policy_reference,c.verified_at
       FROM passenger_insurance_coverages c
       JOIN order_passengers op ON op.id=c.passenger_id
       LEFT JOIN seat_inventory s ON s.id=op.seat_inventory_id
       WHERE c.order_id=$1 ORDER BY s.seat_number NULLS LAST,op.id`,
      [orderId],
    ),
  ]);
  const passengers = passengerResult.rows.map((passenger) => ({
    seatNumber: passenger.seat_number === null ? null : Number(passenger.seat_number),
    name: maskName(security.decrypt(passenger.full_name_ciphertext)),
    identityNumber: maskIdentity(security.decrypt(passenger.identity_number_ciphertext)),
    phone: maskPhone(security.decrypt(passenger.phone_ciphertext)),
  }));
  const coverageStatuses = coverageResult.rows.map((coverage) => coverage.status);
  const aggregatedInsuranceStatus = coverageStatuses.length === 0
    ? (row.insurance_status ?? 'not_started')
    : coverageStatuses.every((status) => status === 'effective')
      ? 'issued'
      : coverageStatuses.includes('failed')
        ? 'failed'
        : coverageStatuses.includes('pending_verification')
          ? 'checkout_started'
          : 'not_started';
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    boatName: row.boat_name,
    departureAt: row.departure_at,
    returnAt: row.return_at,
    marinaCode: row.marina_code,
    tripType: row.trip_type,
    seats: seatResult.rows.map((seat) => ({
      number: Number(seat.seat_number),
      priceFen: Number(seat.price_fen),
    })),
    passengers,
    amount: {
      seatFeeFen: Number(row.seat_fee_fen),
      discountFen: Number(row.discount_fen),
      platformFeeFen: Number(row.platform_fee_fen),
      totalFen: Number(row.total_amount_fen),
    },
    holdExpiresAt: row.hold_expires_at,
    paidAt: row.paid_at,
    insurance: {
      status: aggregatedInsuranceStatus,
      checkoutUrl: row.checkout_url,
      policyReference: row.provider_policy_reference,
      passengerCoverages: coverageResult.rows.map((coverage) => ({
        seatNumber: coverage.seat_number === null ? null : Number(coverage.seat_number),
        status: coverage.status,
        failureReason: coverage.failure_reason,
        coverageStartAt: coverage.coverage_start_at,
        coverageEndAt: coverage.coverage_end_at,
        policyReference: coverage.provider_policy_reference,
        verifiedAt: coverage.verified_at,
      })),
      premiumCollectedByPlatform: false,
    },
    createdAt: row.created_at,
  };
}

function validPassengers(value, seatIds) {
  if (!Array.isArray(value) || value.length !== seatIds.length) return { error: '乘船人数量必须与选中座位一致' };
  const passengers = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !validUuid(item.seatId) || !seatIds.includes(item.seatId)) {
      return { error: '乘船人必须对应本次锁定的座位' };
    }
    const fullName = String(item.fullName ?? '').trim();
    const identityNumber = String(item.identityNumber ?? '').trim().toUpperCase();
    const phone = String(item.phone ?? '').trim();
    if (!NAME_PATTERN.test(fullName)) return { error: '请填写有效的乘船人姓名' };
    if (!verifyChineseIdentityNumber(identityNumber)) return { error: '乘船人身份证号码格式或校验位不正确' };
    if (!PHONE_PATTERN.test(phone)) return { error: '请填写有效的乘船人手机号' };
    passengers.push({ seatId: item.seatId, fullName, identityNumber, phone });
  }
  if (new Set(passengers.map((passenger) => passenger.seatId)).size !== seatIds.length) {
    return { error: '每个座位都需要填写一位乘船人' };
  }
  return { value: passengers };
}

async function handlePaymentEvent({ pool, redis, adapter, event, signature, log, clockNow = null }) {
  if (!adapter.verifyCallback(event, signature)) return { statusCode: 401, body: { error: '支付回调签名无效' } };
  if (!validUuid(event.eventId) || !validUuid(event.orderId)
      || typeof event.transactionReference !== 'string'
      || !Number.isSafeInteger(event.amountFen) || !ALLOWED_OUTCOMES.has(event.outcome)
      || Number.isNaN(Date.parse(event.createdAt))) {
    return { statusCode: 400, body: { error: '支付回调字段无效' } };
  }
  const client = await pool.connect();
  let releasedHold = null;
  let departureId = null;
  let responseBody = null;
  try {
    await client.query('BEGIN');
    const duplicate = await client.query(
      'SELECT id,status FROM payment_transactions WHERE callback_event_id=$1',
      [event.eventId],
    );
    if (duplicate.rowCount) {
      await client.query('COMMIT');
      return { statusCode: 200, body: { duplicate: true, paymentStatus: duplicate.rows[0].status } };
    }
    const paymentReference = await client.query(
      `SELECT order_id,purpose,supplement_participant_id FROM payment_transactions
       WHERE provider_reference=$1`,
      [event.transactionReference],
    );
    if (!paymentReference.rowCount) {
      await client.query('ROLLBACK');
      return { statusCode: 404, body: { error: '支付记录不存在' } };
    }
    if (paymentReference.rows[0].purpose === 'supplement') {
      if (paymentReference.rows[0].supplement_participant_id !== event.orderId) {
        await client.query('ROLLBACK');
        return { statusCode: 400, body: { error: '补差订单或金额不匹配' } };
      }
      const target = await client.query(
        `SELECT r.departure_id FROM departure_supplement_rounds r
         JOIN departure_supplement_participants p ON p.round_id=r.id
         WHERE p.id=$1`, [event.orderId],
      );
      if (!target.rowCount) {
        await client.query('ROLLBACK');
        return { statusCode: 404, body: { error: '补差记录不存在' } };
      }
      await client.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [target.rows[0].departure_id]);
      const paymentResult = await client.query(
        `SELECT id,order_id,amount_fen,status,late_success,supplement_participant_id
         FROM payment_transactions WHERE provider_reference=$1 FOR UPDATE`,
        [event.transactionReference],
      );
      if (!paymentResult.rowCount || Number(paymentResult.rows[0].amount_fen) !== event.amountFen) {
        await client.query('ROLLBACK');
        return { statusCode: 400, body: { error: '补差订单或金额不匹配' } };
      }
      const settled = await settleSupplementPayment(client, paymentResult.rows[0], event);
      if (settled.error) {
        await client.query('ROLLBACK');
        return { statusCode: settled.error[0], body: { error: settled.error[1] } };
      }
      await client.query('COMMIT');
      return { statusCode: 200, body: settled };
    }
    if (paymentReference.rows[0].order_id !== event.orderId) {
      await client.query('ROLLBACK');
      return { statusCode: 400, body: { error: '支付订单或金额不匹配' } };
    }
    const departure = await client.query(
      `SELECT d.id FROM departures d JOIN booking_orders o ON o.departure_id=d.id
       WHERE o.id=$1 FOR UPDATE OF d`,
      [event.orderId],
    );
    if (!departure.rowCount) {
      await client.query('ROLLBACK');
      return { statusCode: 404, body: { error: '订单不存在' } };
    }
    departureId = departure.rows[0].id;
    await lockOrderTransaction(client, event.orderId);
    const paymentResult = await client.query(
      `SELECT id,order_id,amount_fen,status,late_success FROM payment_transactions
       WHERE provider_reference=$1 FOR UPDATE`,
      [event.transactionReference],
    );
    if (!paymentResult.rowCount) {
      await client.query('ROLLBACK');
      return { statusCode: 404, body: { error: '支付记录不存在' } };
    }
    const payment = paymentResult.rows[0];
    if (payment.order_id !== event.orderId || Number(payment.amount_fen) !== event.amountFen) {
      await client.query('ROLLBACK');
      return { statusCode: 400, body: { error: '支付订单或金额不匹配' } };
    }
    const orderResult = await client.query(
      `SELECT o.id,o.status,o.hold_id,o.total_amount_fen,o.waitlist_entry_id,
              h.status AS hold_status,h.expires_at AS hold_expires_at,
              w.authorization_expires_at
       FROM booking_orders o
       LEFT JOIN seat_holds h ON h.id=o.hold_id
       LEFT JOIN departure_waitlist_entries w ON w.id=o.waitlist_entry_id
       WHERE o.id=$1 FOR UPDATE OF o`,
      [event.orderId],
    );
    if (!orderResult.rowCount || Number(orderResult.rows[0].total_amount_fen) !== event.amountFen) {
      await client.query('ROLLBACK');
      return { statusCode: 409, body: { error: '订单已结束或金额已变更' } };
    }
    const order = orderResult.rows[0];
    const lateRefundReason = order.waitlist_entry_id
      ? 'late_waitlist_payment' : 'late_booking_payment';
    const lateRefundRequestKey = order.waitlist_entry_id
      ? `late-waitlist:${payment.id}` : `late-booking:${payment.id}`;
    let timedOutWaitlistCallbackRestored = false;
    async function callbackMatchesActiveHold() {
      const deadline = order.authorization_expires_at ?? order.hold_expires_at;
      const receivedAt = await readStep3Clock(client, clockNow);
      const seatCounts = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM booking_order_seats
            WHERE order_id=$1 AND status='pending_payment') AS expected,
           (SELECT count(*)::integer FROM seat_inventory s
            JOIN booking_order_seats os ON os.seat_inventory_id=s.id
            WHERE os.order_id=$1 AND os.status='pending_payment'
              AND s.status='held' AND s.hold_id=$2) AS held`,
        [order.id, order.hold_id],
      );
      const expected = Number(seatCounts.rows[0].expected);
      return effectivePaymentAtOrBeforeDeadline(event.createdAt, deadline)
        && order.status === 'pending_payment'
        && order.hold_status === 'active'
        && new Date(order.hold_expires_at) > new Date(receivedAt)
        && expected > 0
        && Number(seatCounts.rows[0].held) === expected;
    }
    async function recordLateBookingSuccess() {
      if (order.hold_id) {
        let seatIds;
        if (order.hold_status === 'active') {
          seatIds = await releaseHoldInTransaction(client, order.hold_id, 'expired');
        } else {
          const heldItems = await client.query(
            'SELECT seat_inventory_id FROM seat_hold_items WHERE hold_id=$1', [order.hold_id],
          );
          seatIds = heldItems.rows.map((seat) => seat.seat_inventory_id);
        }
        releasedHold = { id: order.hold_id, seatIds };
      }
      await client.query(
        `UPDATE booking_orders SET status='cancelled',cancelled_at=COALESCE(cancelled_at,now()),updated_at=now()
         WHERE id=$1 AND status='pending_payment'`, [order.id],
      );
      await client.query(
        `UPDATE booking_order_seats SET status='released'
         WHERE order_id=$1 AND status='pending_payment'`, [order.id],
      );
      await client.query(
        `UPDATE payment_transactions SET status='succeeded',late_success=true,callback_event_id=$2,
          updated_at=now(),completed_at=now() WHERE id=$1`, [payment.id, event.eventId],
      );
      await client.query(
        `INSERT INTO refund_obligations
          (order_id,payment_transaction_id,amount_fen,reason,status,attempt_count,request_key,settled_at)
         VALUES ($1,$2,$3,$4,'sandbox_succeeded',1,$5,now())
         ON CONFLICT (payment_transaction_id,reason) DO NOTHING`,
        [order.id, payment.id, event.amountFen, lateRefundReason, lateRefundRequestKey],
      );
      if (order.waitlist_entry_id) {
        await client.query(
          `UPDATE departure_waitlist_entries SET status='expired',updated_at=now()
           WHERE id=$1 AND status IN ('authorized','converted')`, [order.waitlist_entry_id],
        );
      }
      await client.query('COMMIT');
      responseBody = {
        paymentStatus: 'succeeded', latePaymentRefundRequired: true,
        refundStatus: 'sandbox_succeeded', includedInFormation: false,
      };
    }

    if ((payment.status === 'pending' || payment.status === 'timed_out')
        && event.outcome === 'success') {
      const onTime = await callbackMatchesActiveHold();
      if (!onTime) {
        await recordLateBookingSuccess();
      } else if (payment.status === 'timed_out' && order.waitlist_entry_id) {
        // A delayed webhook for an on-time waitlist payment may still settle while its hold is active.
        await client.query(
          `UPDATE payment_transactions SET status='pending',callback_event_id=NULL,updated_at=now()
           WHERE id=$1`, [payment.id],
        );
        timedOutWaitlistCallbackRestored = true;
      } else if (payment.status === 'timed_out') {
        await client.query('COMMIT');
        return { statusCode: 200, body: { duplicate: true, paymentStatus: payment.status } };
      }
    }
    if (payment.status !== 'pending' && !responseBody && !timedOutWaitlistCallbackRestored) {
      await client.query('COMMIT');
      return { statusCode: 200, body: { duplicate: true, paymentStatus: payment.status } };
    }
    if (responseBody) {
      // The timed-out authorization was recorded and refunded above.
    } else if (order.status !== 'pending_payment') {
      await client.query('ROLLBACK');
      return { statusCode: 409, body: { error: '订单已结束或金额已变更' } };
    }
    if (responseBody) {
      // Continue to post-commit cleanup.
    } else {
    const holdResult = await client.query(
      `SELECT id,status,expires_at,waitlist_entry_id FROM seat_holds WHERE id=$1 FOR UPDATE`,
      [order.hold_id],
    );
    const holdCheckedAt = await readStep3Clock(client, clockNow);
    if (!holdResult.rowCount || holdResult.rows[0].status !== 'active'
        || new Date(holdResult.rows[0].expires_at) <= new Date(holdCheckedAt)) {
      if (event.outcome === 'success' && order.waitlist_entry_id) {
        await client.query(
          `UPDATE booking_orders SET status='cancelled',cancelled_at=COALESCE(cancelled_at,now()),updated_at=now()
           WHERE id=$1`, [order.id],
        );
        await client.query(
          `UPDATE booking_order_seats SET status='released'
           WHERE order_id=$1 AND status='pending_payment'`, [order.id],
        );
        await client.query(
          `UPDATE payment_transactions SET status='succeeded',late_success=true,
            callback_event_id=$2,updated_at=now(),completed_at=now() WHERE id=$1`,
          [payment.id, event.eventId],
        );
        await client.query(
          `INSERT INTO refund_obligations
            (order_id,payment_transaction_id,amount_fen,reason,status,attempt_count,request_key,settled_at)
           VALUES ($1,$2,$3,'late_waitlist_payment','sandbox_succeeded',1,$4,now())
           ON CONFLICT (payment_transaction_id,reason) DO NOTHING`,
          [order.id, payment.id, event.amountFen, `late-waitlist:${payment.id}`],
        );
        await client.query(
          `UPDATE departure_waitlist_entries SET status='expired',updated_at=now()
           WHERE id=$1 AND status IN ('authorized','converted')`, [order.waitlist_entry_id],
        );
        await client.query('COMMIT');
        responseBody = {
          paymentStatus: 'succeeded', latePaymentRefundRequired: true,
          refundStatus: 'sandbox_succeeded', includedInFormation: false,
        };
      } else {
        await client.query('ROLLBACK');
        return { statusCode: 409, body: { error: '座位锁定已失效，订单无法支付' } };
      }
    }
    if (!responseBody) {
    const seatResult = await client.query(
      `SELECT s.id FROM seat_inventory s JOIN booking_order_seats os ON os.seat_inventory_id=s.id
       WHERE os.order_id=$1 AND os.status='pending_payment' AND s.hold_id=$2 AND s.status='held'
       ORDER BY s.seat_number FOR UPDATE OF s`,
      [event.orderId, order.hold_id],
    );
    const expectedSeats = await client.query(
      `SELECT count(*)::integer AS count FROM booking_order_seats WHERE order_id=$1 AND status='pending_payment'`,
      [event.orderId],
    );
    if (!seatResult.rowCount || seatResult.rowCount !== Number(expectedSeats.rows[0].count)) {
      await client.query('ROLLBACK');
      return { statusCode: 409, body: { error: '锁定座位已失效，订单无法支付' } };
    }
    const nextStatus = event.outcome === 'success' ? 'succeeded' : event.outcome === 'timeout' ? 'timed_out' : 'failed';
    await client.query(
      `UPDATE payment_transactions SET status=$2,callback_event_id=$3,updated_at=now(),completed_at=now()
       WHERE id=$1`,
      [payment.id, nextStatus, event.eventId],
    );
    if (event.outcome === 'success') {
      const holdSeats = await client.query(
        'SELECT seat_inventory_id FROM seat_hold_items WHERE hold_id=$1',
        [order.hold_id],
      );
      releasedHold = { id: order.hold_id, seatIds: holdSeats.rows.map((row) => row.seat_inventory_id) };
      await client.query(
        `UPDATE booking_orders SET status='paid',paid_at=now(),updated_at=now() WHERE id=$1`,
        [event.orderId],
      );
      await client.query(
        `UPDATE booking_order_seats SET status='paid' WHERE order_id=$1 AND status='pending_payment'`,
        [event.orderId],
      );
      await client.query(
        `UPDATE seat_inventory SET status='booked',hold_id=NULL,hold_expires_at=NULL,updated_at=now()
         WHERE hold_id=$1 AND status='held'`,
        [order.hold_id],
      );
      await client.query(
        `UPDATE seat_hold_items SET status='consumed' WHERE hold_id=$1 AND status='active'`,
        [order.hold_id],
      );
      await client.query(
        `UPDATE seat_holds SET status='consumed',released_at=now() WHERE id=$1`,
        [order.hold_id],
      );
    } else {
      releasedHold = { id: order.hold_id, seatIds: await releaseHoldInTransaction(client, order.hold_id, 'released') };
    }
    await client.query('COMMIT');
    responseBody = { paymentStatus: event.outcome === 'success' ? 'succeeded' : event.outcome === 'timeout' ? 'timed_out' : 'failed' };
    }
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    log.error({ err: error }, 'Step 3 payment callback failed');
    return { statusCode: 500, body: { error: '支付状态处理失败' } };
  } finally {
    client.release();
  }
  if (releasedHold) await deleteHoldKeys(redis, releasedHold.id, releasedHold.seatIds).catch(() => {});
  if (departureId && (event.outcome !== 'success' || responseBody?.latePaymentRefundRequired)) {
    await dispatchWaitlistCandidates(pool, redis, departureId, new Date(), clockNow).catch((error) =>
      log.warn({ err: error }, 'Waitlist dispatch after payment release failed'));
  }
  return { statusCode: 200, body: responseBody };
}

export function registerStep3Routes(app, { pool, redis, config, requireUser }) {
  const security = createSecurity(config);
  const clockNow = configuredStep3Clock(config);
  const paymentAdapter = createSandboxPaymentAdapter(config);
  const insuranceAdapter = createSandboxInsuranceAdapter(config);
  const requireRedis = async (_request, reply) => {
    try {
      if (!await ensureRedis(redis)) return sendError(reply, 503, 'Redis 未配置，暂时无法锁位');
    } catch (error) {
      app.log.warn({ err: error }, 'Step 3 Redis unavailable');
      return sendError(reply, 503, '锁位服务暂不可用，请稍后重试');
    }
  };
  if (config.nodeEnv !== 'test') {
    const reaper = setInterval(() => {
      if (pool) expireHolds(pool, redis, null, clockNow)
        .catch((error) => app.log.warn({ err: error }, 'Seat hold reaper failed'));
    }, 15000);
    reaper.unref();
    app.addHook('onClose', async () => clearInterval(reaper));
  }
  registerStep3WaitlistRoutes(app, { pool, redis, config, requireUser });

  app.get('/departures/:id/seats', { preHandler: [requireUser, requireRedis] }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '活动编号无效');
    try {
      await expireHolds(pool, redis, request.params.id, clockNow);
      const departure = await pool.query(
        `SELECT id,seat_template_count,seat_layout_snapshot FROM departures WHERE id=$1 AND status='open' AND departure_at>now()
           AND booking_deadline>now() AND ${formationCutoffOpenSql}`,
        [request.params.id],
      );
      if (!departure.rowCount) return sendError(reply, 404, '活动不存在或已截止报名');
      const result = await pool.query(
        `SELECT s.id,s.seat_number,s.seat_side,s.seat_section,s.is_premium,s.price_fen,s.status,
                h.id AS hold_id,h.user_id AS hold_user_id,h.expires_at AS hold_expires_at
         FROM seat_inventory s LEFT JOIN seat_holds h ON h.id=s.hold_id AND h.status='active'
         WHERE s.departure_id=$1 AND s.sale_channel='platform'
         ORDER BY s.seat_number`,
        [request.params.id],
      );
      const quotaResult = await pool.query(
        `SELECT seat_number,sale_channel FROM departure_seat_quotas
         WHERE departure_id=$1 ORDER BY seat_number`,
        [request.params.id],
      );
      const channelByNumber = new Map(
        quotaResult.rows.map((row) => [Number(row.seat_number), row.sale_channel]),
      );
      const seatLayout = Array.isArray(departure.rows[0].seat_layout_snapshot)
        ? departure.rows[0].seat_layout_snapshot.map((seat) => ({
          number: Number(seat.number),
          side: seat.side,
          section: seat.section,
          isPremium: Boolean(seat.premium),
          saleChannel: channelByNumber.get(Number(seat.number)) ?? 'unassigned',
        }))
        : [];
      return {
        expiresInSeconds: 600,
        seatCount: Number(departure.rows[0].seat_template_count),
        seatLayout,
        seats: result.rows.map((row) => serializeSeat(row, request.user.id)),
      };
    } catch (error) {
      request.log.error({ err: error }, 'Seat status query failed');
      return sendError(reply, 503, '座位状态暂不可用');
    }
  });

  app.post('/departures/:id/seat-holds', { preHandler: [requireUser, requireRedis] }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '活动编号无效');
    const seatIds = request.body?.seatIds;
    if (!Array.isArray(seatIds) || seatIds.length < 1 || seatIds.length > 6
        || seatIds.some((id) => !validUuid(id)) || new Set(seatIds).size !== seatIds.length) {
      return sendError(reply, 400, '请选择 1–6 个不同座位');
    }
    const client = await pool.connect();
    let holdId;
    let redisSet = false;
    let lockedSeatIds = [];
    try {
      await client.query('BEGIN');
      const departureLock = await client.query(
        'SELECT id FROM departures WHERE id=$1 FOR UPDATE',
        [request.params.id],
      );
      if (!departureLock.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '活动不存在或已截止报名');
      }
      const departureResult = await client.query(
        `SELECT d.status,d.departure_at,d.booking_deadline,
                ${confirmationAtSql('d')} AS confirmation_at
         FROM departures d WHERE d.id=$1`, [request.params.id],
      );
      const departure = departureResult.rows[0];
      const lockedAt = await readStep3Clock(client, clockNow);
      if (!bookingWindowOpen(departure, lockedAt)) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '活动不存在或已截止报名');
      }
      const seats = await client.query(
        `SELECT s.id,s.seat_number,s.price_fen,s.is_premium,s.status,s.hold_id,
                (s.waitlist_released_at IS NOT NULL AND EXISTS (
                  SELECT 1 FROM departure_waitlist_entries w
                  WHERE w.departure_id=s.departure_id AND w.status='waiting'
                )) AS waitlist_priority
         FROM seat_inventory s WHERE s.departure_id=$1 AND s.sale_channel='platform' AND s.id=ANY($2::uuid[])
         ORDER BY s.seat_number FOR UPDATE`,
        [request.params.id, seatIds],
      );
      if (seats.rowCount !== seatIds.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '部分座位不属于该活动');
      }
      if (seats.rows.some((seat) => seat.status !== 'available' || seat.hold_id)) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '所选座位刚被其他钓友锁定，请刷新座位图');
      }
      if (seats.rows.some((seat) => seat.waitlist_priority)) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '该座位正在按候补顺序授权，请刷新座位图');
      }
      const seatLockAt = await readStep3Clock(client, clockNow);
      if (!bookingWindowOpen(departure, seatLockAt)) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '活动不存在或已截止报名');
      }
      lockedSeatIds = seats.rows.map((seat) => seat.id);
      holdId = randomUUID();
      const expiresAt = new Date(new Date(seatLockAt).getTime() + HOLD_MS);
      const hold = await client.query(
        `INSERT INTO seat_holds (id,departure_id,user_id,expires_at)
         VALUES ($1,$2,$3,$4) RETURNING expires_at`,
        [holdId, request.params.id, request.user.id, expiresAt],
      );
      for (const seat of seats.rows) {
        await client.query(
          `INSERT INTO seat_hold_items (hold_id,seat_inventory_id,seat_number,price_fen,is_premium)
           VALUES ($1,$2,$3,$4,$5)`,
          [holdId, seat.id, seat.seat_number, seat.price_fen, seat.is_premium],
        );
      }
      await client.query(
        `UPDATE seat_inventory SET status='held',hold_id=$1,hold_expires_at=$2,updated_at=now()
         WHERE id=ANY($3::uuid[])`,
        [holdId, hold.rows[0].expires_at, seats.rows.map((seat) => seat.id)],
      );
      const script = `for i,key in ipairs(KEYS) do if redis.call('EXISTS',key)==1 then return 0 end end for i,key in ipairs(KEYS) do redis.call('SET',key,ARGV[1],'PX',ARGV[2]) end return 1`;
      const result = await redis.eval(script, {
        keys: seats.rows.map((seat) => holdKey(seat.id)),
        arguments: [holdId, String(Math.max(1, expiresAt.getTime() - new Date(seatLockAt).getTime()))],
      });
      if (Number(result) !== 1) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '所选座位正在被其他钓友锁定，请刷新座位图');
      }
      redisSet = true;
      const commitAt = await readStep3Clock(client, clockNow);
      if (!bookingWindowOpen(departure, commitAt)) {
        await client.query('ROLLBACK');
        await deleteHoldKeys(redis, holdId, lockedSeatIds).catch(() => {});
        redisSet = false;
        return sendError(reply, 404, '活动不存在或已截止报名');
      }
      await client.query('COMMIT');
      return reply.code(201).send({
        holdId,
        expiresAt: hold.rows[0].expires_at,
        expiresInSeconds: 600,
        seats: seats.rows.map((seat) => ({
          id: seat.id,
          number: Number(seat.seat_number),
          priceFen: Number(seat.price_fen),
          isPremium: seat.is_premium,
        })),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (redisSet && holdId) {
        await deleteHoldKeys(redis, holdId, lockedSeatIds).catch(() => {});
      }
      if (error.code === '23505') return sendError(reply, 409, '座位刚被其他钓友锁定，请刷新座位图');
      request.log.error({ err: error }, 'Seat hold failed');
      return sendError(reply, 503, '锁位失败，请稍后重试');
    } finally {
      client.release();
    }
  });

  app.post('/orders', { preHandler: [requireUser, requireRedis] }, async (request, reply) => {
    if (request.user.identity_status !== 'verified') return sendError(reply, 403, '请先完成实名核验后再下单');
    const holdId = request.body?.holdId;
    const idempotencyKey = String(request.body?.idempotencyKey ?? '').trim();
    if (!validUuid(holdId)) return sendError(reply, 400, '座位锁定信息无效，请重新选位');
    if (!/^[a-zA-Z0-9._:-]{8,100}$/.test(idempotencyKey)) return sendError(reply, 400, '订单请求编号无效');
    const existing = await pool.query(
      'SELECT id FROM booking_orders WHERE buyer_user_id=$1 AND idempotency_key=$2',
      [request.user.id, idempotencyKey],
    );
    if (existing.rowCount) {
      const order = await loadOrder(pool, existing.rows[0].id, request.user.id, security);
      return reply.code(200).send({ order, idempotentReplay: true });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const holdResult = await client.query(
        `SELECT id,departure_id,status,expires_at,order_id,waitlist_entry_id FROM seat_holds
         WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [holdId, request.user.id],
      );
      if (!holdResult.rowCount || holdResult.rows[0].status !== 'active') {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '选位锁定已失效，请重新选择座位');
      }
      const hold = holdResult.rows[0];
      if (hold.order_id) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '该座位锁定已用于创建订单');
      }
      const departureLock = await client.query(
        'SELECT id FROM departures WHERE id=$1 FOR UPDATE', [hold.departure_id],
      );
      if (!departureLock.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '班次已停止报名，不能创建订单');
      }
      const departureResult = await client.query(
        `SELECT d.status,d.departure_at,d.booking_deadline,d.waitlist_window_closed_at,
                ${confirmationAtSql('d')} AS confirmation_at,
                ${closeoutAtSql('d')} AS closeout_at
         FROM departures d WHERE d.id=$1`, [hold.departure_id],
      );
      const waitlistResult = hold.waitlist_entry_id ? await client.query(
        `SELECT status,accepted_at,authorization_expires_at FROM departure_waitlist_entries
         WHERE id=$1 AND user_id=$2 FOR UPDATE`, [hold.waitlist_entry_id, request.user.id],
      ) : { rowCount: 0, rows: [] };
      const departure = departureResult.rows[0];
      const waitlistEntry = waitlistResult.rows[0] ?? null;
      const departureLockAt = await readStep3Clock(client, clockNow);
      if (!orderWindowOpen(departure, waitlistEntry, hold, departureLockAt)) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '班次已停止报名，不能创建订单');
      }
      const seatResult = await client.query(
        `SELECT i.seat_inventory_id,i.seat_number,i.price_fen,i.is_premium,s.status,s.hold_id
         FROM seat_hold_items i JOIN seat_inventory s ON s.id=i.seat_inventory_id
         WHERE i.hold_id=$1 AND i.status='active' ORDER BY i.seat_number FOR UPDATE OF s`,
        [holdId],
      );
      if (seatResult.rowCount < 1 || seatResult.rowCount > 6
          || seatResult.rows.some((seat) => seat.status !== 'held' || seat.hold_id !== holdId)) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '选位锁定已失效，请重新选择座位');
      }
      const seatIds = seatResult.rows.map((seat) => seat.seat_inventory_id);
      const passengerResult = validPassengers(request.body?.passengers, seatIds);
      if (passengerResult.error) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, passengerResult.error);
      }
      const lockValues = await redis.mGet(seatIds.map(holdKey));
      if (lockValues.some((value) => value !== holdId)) {
        const seatIdsToRelease = await releaseHoldInTransaction(client, holdId, 'released');
        await client.query('COMMIT');
        await deleteHoldKeys(redis, holdId, seatIdsToRelease).catch(() => {});
        return sendError(reply, 409, '座位锁定服务已过期，请重新选位');
      }
      const orderCommitCheckAt = await readStep3Clock(client, clockNow);
      if (!orderWindowOpen(departure, waitlistEntry, hold, orderCommitCheckAt)) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '班次已停止报名，不能创建订单');
      }
      const seatFeeFen = seatResult.rows.reduce((sum, seat) => sum + Number(seat.price_fen), 0);
      if (!Number.isSafeInteger(seatFeeFen) || seatFeeFen > 2_000_000_000) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, '订单金额超出支持范围');
      }
      const orderId = randomUUID();
      const orderNumber = `QD${Date.now()}${randomUUID().slice(0, 8).toUpperCase()}`;
      const orderResult = await client.query(
        `INSERT INTO booking_orders
          (id,order_number,departure_id,seat_inventory_id,buyer_user_id,status,seat_fee_fen,
           discount_fen,platform_fee_fen,total_amount_fen,hold_expires_at,hold_id,idempotency_key,waitlist_entry_id)
         VALUES ($1,$2,$3,$4,$5,'pending_payment',$6,0,0,$6,$7,$8,$9,$10)
         RETURNING id`,
        [orderId, orderNumber, hold.departure_id, seatIds[0], request.user.id,
          seatFeeFen, hold.expires_at, holdId, idempotencyKey, hold.waitlist_entry_id],
      );
      for (const seat of seatResult.rows) {
        await client.query(
          `INSERT INTO booking_order_seats (order_id,seat_inventory_id,seat_number,price_fen)
           VALUES ($1,$2,$3,$4)`,
          [orderResult.rows[0].id, seat.seat_inventory_id, seat.seat_number, seat.price_fen],
        );
      }
      for (const passenger of passengerResult.value) {
        await client.query(
          `INSERT INTO order_passengers
            (order_id,seat_inventory_id,full_name_ciphertext,identity_number_ciphertext,phone_ciphertext)
           VALUES ($1,$2,$3,$4,$5)`,
          [orderId, passenger.seatId, security.encrypt(passenger.fullName),
            security.encrypt(passenger.identityNumber), security.encrypt(passenger.phone)],
        );
      }
      await client.query(
        `INSERT INTO passenger_insurance_coverages
           (departure_id,order_id,passenger_id,coverage_start_at,coverage_end_at,status)
         SELECT d.id,$1,op.id,d.departure_at,d.return_at,'not_insured'
         FROM order_passengers op JOIN departures d ON d.id=$2
         WHERE op.order_id=$1
         ON CONFLICT (passenger_id,departure_id,coverage_start_at,coverage_end_at) DO NOTHING`,
        [orderId, hold.departure_id],
      );
      await client.query(
        `INSERT INTO insurance_policies (order_id,provider_code,status)
         VALUES ($1,'sandbox','not_started')`,
        [orderId],
      );
      await client.query('UPDATE seat_holds SET order_id=$2 WHERE id=$1', [holdId, orderId]);
      if (hold.waitlist_entry_id) {
        await client.query(
          `UPDATE departure_waitlist_entries SET status='converted',order_id=$2,updated_at=now()
           WHERE id=$1 AND status='authorized'`,
          [hold.waitlist_entry_id, orderId],
        );
      }
      await client.query('COMMIT');
      const order = await loadOrder(pool, orderId, request.user.id, security);
      return reply.code(201).send({ order, idempotentReplay: false });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') {
        const duplicate = await pool.query(
          'SELECT id FROM booking_orders WHERE buyer_user_id=$1 AND idempotency_key=$2',
          [request.user.id, idempotencyKey],
        ).catch(() => ({ rows: [] }));
        if (duplicate.rows[0]) {
          return reply.code(200).send({ order: await loadOrder(pool, duplicate.rows[0].id, request.user.id, security), idempotentReplay: true });
        }
        return sendError(reply, 409, '座位或订单请求刚被处理，请刷新后重试');
      }
      request.log.error({ err: error }, 'Order creation failed');
      return sendError(reply, 500, '创建订单失败，请稍后重试');
    } finally {
      client.release();
    }
  });

  app.get('/orders', { preHandler: requireUser }, async (request) => {
    const result = await pool.query(
      `SELECT o.id,o.order_number,o.status,o.total_amount_fen,o.created_at,
              b.name AS boat_name,d.departure_at,count(os.seat_inventory_id)::integer AS seat_count
       FROM booking_orders o JOIN departures d ON d.id=o.departure_id JOIN boats b ON b.id=d.boat_id
       LEFT JOIN booking_order_seats os ON os.order_id=o.id
       WHERE o.buyer_user_id=$1 GROUP BY o.id,b.name,d.departure_at
       ORDER BY o.created_at DESC LIMIT 100`,
      [request.user.id],
    );
    return { items: result.rows.map((row) => ({
      id: row.id, orderNumber: row.order_number, status: row.status,
      totalFen: Number(row.total_amount_fen), seatCount: Number(row.seat_count),
      boatName: row.boat_name, departureAt: row.departure_at, createdAt: row.created_at,
    })) };
  });

  app.get('/orders/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '订单编号无效');
    const order = await loadOrder(pool, request.params.id, request.user.id, security);
    if (!order) return sendError(reply, 404, '订单不存在');
    return { order };
  });

  app.post('/orders/:id/payment-intents', { preHandler: requireUser }, async (request, reply) => {
    if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒支付入口未开放');
    if (!validUuid(request.params.id)) return sendError(reply, 400, '订单编号无效');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockOrderTransaction(client, request.params.id);
      const orderResult = await client.query(
        `SELECT id,status,total_amount_fen FROM booking_orders
         WHERE id=$1 AND buyer_user_id=$2 FOR UPDATE`,
        [request.params.id, request.user.id],
      );
      if (!orderResult.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '订单不存在');
      }
      const order = orderResult.rows[0];
      if (order.status !== 'pending_payment') {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '该订单当前不能发起支付');
      }
      const existing = await client.query(
        `SELECT id,provider_reference,amount_fen,status FROM payment_transactions
         WHERE order_id=$1 AND status='pending'`,
        [order.id],
      );
      if (existing.rowCount) {
        await client.query('COMMIT');
        return { payment: {
          id: existing.rows[0].id, reference: existing.rows[0].provider_reference,
          amountFen: Number(existing.rows[0].amount_fen), status: existing.rows[0].status,
          adapter: 'sandbox', checkoutUrl: `sandbox-pay://checkout/${order.id}`,
        } };
      }
      const intent = paymentAdapter.createIntent({ orderId: order.id, amountFen: Number(order.total_amount_fen) });
      const inserted = await client.query(
        `INSERT INTO payment_transactions (order_id,provider_reference,amount_fen)
         VALUES ($1,$2,$3) RETURNING id,status,created_at`,
        [order.id, intent.reference, intent.amountFen],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ payment: {
        id: inserted.rows[0].id, reference: intent.reference, amountFen: intent.amountFen,
        status: inserted.rows[0].status, adapter: 'sandbox', checkoutUrl: intent.checkoutUrl,
      } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Payment intent creation failed');
      return sendError(reply, error.statusCode ?? 500, error.statusCode === 503 ? error.message : '创建支付请求失败');
    } finally {
      client.release();
    }
  });

  app.post('/orders/:id/supplement-rounds/:roundId/payment-intents',
    { preHandler: requireUser }, async (request, reply) => {
      if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒补差支付入口未开放');
      if (!validUuid(request.params.id) || !validUuid(request.params.roundId)) {
        return sendError(reply, 400, '订单或补差编号无效');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const participantResult = await client.query(
          `SELECT p.id,p.amount_fen,p.consent_status,p.payment_status,r.status AS round_status,
                  r.response_deadline_at
           FROM booking_orders o JOIN departure_supplement_participants p ON p.order_id=o.id
           JOIN departure_supplement_rounds r ON r.id=p.round_id
           WHERE o.id=$1 AND o.buyer_user_id=$2 AND r.id=$3 FOR UPDATE OF p,r`,
          [request.params.id, request.user.id, request.params.roundId],
        );
        if (!participantResult.rowCount) {
          await client.query('ROLLBACK');
          return sendError(reply, 404, '本订单没有对应的补差报价');
        }
        const participant = participantResult.rows[0];
        if (participant.consent_status !== 'accepted' || participant.round_status !== 'collecting_payment'
            || participant.payment_status === 'failed'
            || new Date(participant.response_deadline_at) <= new Date()) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '当前补差轮次不能发起支付');
        }
        if (Number(participant.amount_fen) <= 0) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '本订单无需支付补差');
        }
        const existing = await client.query(
          `SELECT id,provider_reference,amount_fen,status FROM payment_transactions
           WHERE supplement_participant_id=$1 AND status IN ('pending','succeeded')
           ORDER BY CASE status WHEN 'succeeded' THEN 0 ELSE 1 END,created_at DESC LIMIT 1`,
          [participant.id],
        );
        if (existing.rowCount) {
          const row = existing.rows[0];
          await client.query('COMMIT');
          return reply.code(200).send({ payment: {
            id: row.id, reference: row.provider_reference, amountFen: Number(row.amount_fen),
            status: row.status, adapter: 'sandbox',
            checkoutUrl: row.status === 'pending' ? `sandbox-pay://supplement/${participant.id}` : null,
            idempotentReplay: true,
          } });
        }
        const intent = paymentAdapter.createIntent({ orderId: participant.id, amountFen: Number(participant.amount_fen) });
        const payment = await client.query(
          `INSERT INTO payment_transactions
             (purpose,supplement_participant_id,adapter_code,provider_reference,amount_fen)
           VALUES ('supplement',$1,'sandbox',$2,$3) RETURNING id,status`,
          [participant.id, intent.reference, intent.amountFen],
        );
        await client.query(
          `UPDATE departure_supplement_participants SET payment_status='pending',updated_at=now()
           WHERE id=$1`, [participant.id],
        );
        await client.query('COMMIT');
        return reply.code(201).send({ payment: {
          id: payment.rows[0].id, reference: intent.reference, amountFen: intent.amountFen,
          status: payment.rows[0].status, adapter: 'sandbox', checkoutUrl: intent.checkoutUrl,
        } });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        request.log.error({ err: error }, 'Supplement payment intent failed');
        return sendError(reply, 500, '创建补差支付请求失败');
      } finally {
        client.release();
      }
    });

  app.post('/orders/:id/supplement-rounds/:roundId/sandbox-payment',
    { preHandler: requireUser }, async (request, reply) => {
      if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒补差支付入口未开放');
      if (!validUuid(request.params.id) || !validUuid(request.params.roundId)
          || !ALLOWED_OUTCOMES.has(request.body?.outcome)) {
        return sendError(reply, 400, '沙盒补差支付结果无效');
      }
      const payment = await pool.query(
        `SELECT t.provider_reference,t.amount_fen,t.status,p.id AS participant_id
         FROM booking_orders o
         JOIN departure_supplement_participants p ON p.order_id=o.id
         JOIN departure_supplement_rounds r ON r.id=p.round_id
         JOIN payment_transactions t ON t.supplement_participant_id=p.id
         WHERE o.id=$1 AND o.buyer_user_id=$2 AND r.id=$3 AND t.status='pending'
         ORDER BY t.created_at DESC LIMIT 1`,
        [request.params.id, request.user.id, request.params.roundId],
      );
      if (!payment.rowCount) return sendError(reply, 409, '没有可处理的沙盒补差支付请求');
      try {
        const signed = paymentAdapter.buildCallback({
          transactionReference: payment.rows[0].provider_reference,
          orderId: payment.rows[0].participant_id,
          amountFen: Number(payment.rows[0].amount_fen),
          outcome: request.body.outcome,
        });
        const result = await handlePaymentEvent({
          pool, redis, adapter: paymentAdapter, event: signed.event,
          signature: signed.signature, log: request.log, clockNow,
        });
        return reply.code(result.statusCode).send(result.body);
      } catch (error) {
        request.log.warn({ err: error }, 'Sandbox supplement payment adapter is not configured');
        return sendError(reply, error.statusCode ?? 503, error.message);
      }
    });

  app.post('/orders/:id/sandbox-payment', { preHandler: requireUser }, async (request, reply) => {
    if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒支付入口未开放');
    if (!validUuid(request.params.id) || !ALLOWED_OUTCOMES.has(request.body?.outcome)) {
      return sendError(reply, 400, '沙盒支付结果无效');
    }
    const payment = await pool.query(
      `SELECT p.provider_reference,p.amount_fen,p.status,o.id AS order_id
       FROM payment_transactions p JOIN booking_orders o ON o.id=p.order_id
       WHERE o.id=$1 AND o.buyer_user_id=$2 AND p.status='pending'
       ORDER BY p.created_at DESC LIMIT 1`,
      [request.params.id, request.user.id],
    );
    if (!payment.rowCount) return sendError(reply, 409, '没有可处理的沙盒支付请求');
    try {
      const signed = paymentAdapter.buildCallback({
        transactionReference: payment.rows[0].provider_reference,
        orderId: payment.rows[0].order_id,
        amountFen: Number(payment.rows[0].amount_fen),
        outcome: request.body.outcome,
      });
      const result = await handlePaymentEvent({
        pool, redis, adapter: paymentAdapter, event: signed.event,
        signature: signed.signature, log: request.log, clockNow,
      });
      return reply.code(result.statusCode).send(result.body);
    } catch (error) {
      request.log.warn({ err: error }, 'Sandbox payment adapter is not configured');
      return sendError(reply, error.statusCode ?? 503, error.message);
    }
  });

  app.post('/payment-adapters/sandbox/callback', async (request, reply) => {
    try {
      const result = await handlePaymentEvent({
        pool, redis, adapter: paymentAdapter, event: request.body,
        signature: String(request.headers['x-sandbox-signature'] ?? ''), log: request.log, clockNow,
      });
      return reply.code(result.statusCode).send(result.body);
    } catch (error) {
      request.log.warn({ err: error }, 'Sandbox callback secret is not configured');
      return sendError(reply, error.statusCode ?? 503, error.message);
    }
  });

  app.post('/orders/:id/insurance/checkout', { preHandler: requireUser }, async (request, reply) => {
    if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒保险入口未开放');
    if (!validUuid(request.params.id)) return sendError(reply, 400, '订单编号无效');
    try {
      const result = await pool.query(
        `SELECT o.order_number,o.status,ip.id AS policy_id,ip.status AS insurance_status
         FROM booking_orders o JOIN insurance_policies ip ON ip.order_id=o.id
         WHERE o.id=$1 AND o.buyer_user_id=$2`,
        [request.params.id, request.user.id],
      );
      if (!result.rowCount) return sendError(reply, 404, '订单不存在');
      if (result.rows[0].status !== 'paid') return sendError(reply, 409, '订单支付后才能打开投保入口');
      if (result.rows[0].insurance_status === 'issued') return sendError(reply, 409, '该订单已记录沙盒投保状态');
      const url = insuranceAdapter.createCheckout({ policyId: result.rows[0].policy_id, orderNumber: result.rows[0].order_number });
      await pool.query(
        `UPDATE insurance_policies SET status='checkout_started',provider_code='sandbox',checkout_url=$2,
          provider_policy_reference=COALESCE(provider_policy_reference,$3),updated_at=now()
         WHERE id=$1`,
        [result.rows[0].policy_id, url, `sandbox_policy_${result.rows[0].policy_id}`],
      );
      await pool.query(
        `UPDATE passenger_insurance_coverages SET status='pending_verification',failure_reason=NULL,
           updated_at=now()
         WHERE order_id=$1 AND status <> 'effective'`,
        [request.params.id],
      );
      return { adapter: 'sandbox', checkoutUrl: url, status: 'checkout_started', premiumCollectedByPlatform: false };
    } catch (error) {
      request.log.warn({ err: error }, 'Sandbox insurance adapter is not configured');
      return sendError(reply, error.statusCode ?? 503, error.message);
    }
  });

  app.get('/orders/:id/insurance/status', { preHandler: requireUser }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '订单编号无效');
    const result = await pool.query(
      `SELECT ip.status,ip.provider_code,ip.provider_policy_reference,ip.issued_at,o.id AS order_id
       FROM insurance_policies ip JOIN booking_orders o ON o.id=ip.order_id
       WHERE o.id=$1 AND o.buyer_user_id=$2`,
      [request.params.id, request.user.id],
    );
    if (!result.rowCount) return sendError(reply, 404, '订单投保记录不存在');
    const coverages = await pool.query(
      `SELECT s.seat_number,c.status,c.failure_reason,c.coverage_start_at,c.coverage_end_at,
              c.provider_policy_reference,c.verified_at
       FROM passenger_insurance_coverages c
       JOIN order_passengers op ON op.id=c.passenger_id
       LEFT JOIN seat_inventory s ON s.id=op.seat_inventory_id
       WHERE c.order_id=$1 ORDER BY s.seat_number NULLS LAST,op.id`,
      [result.rows[0].order_id],
    );
    const coverageStatuses = coverages.rows.map((coverage) => coverage.status);
    const aggregatedStatus = coverageStatuses.length === 0
      ? result.rows[0].status
      : coverageStatuses.every((status) => status === 'effective')
        ? 'issued'
        : coverageStatuses.includes('failed')
          ? 'failed'
          : coverageStatuses.includes('pending_verification')
            ? 'checkout_started'
            : 'not_started';
    return { insurance: {
      status: aggregatedStatus, adapter: result.rows[0].provider_code,
      policyReference: result.rows[0].provider_policy_reference,
      issuedAt: result.rows[0].issued_at,
      passengerCoverages: coverages.rows.map((coverage) => ({
        seatNumber: coverage.seat_number === null ? null : Number(coverage.seat_number),
        status: coverage.status,
        failureReason: coverage.failure_reason,
        coverageStartAt: coverage.coverage_start_at,
        coverageEndAt: coverage.coverage_end_at,
        policyReference: coverage.provider_policy_reference,
        verifiedAt: coverage.verified_at,
      })),
      premiumCollectedByPlatform: false,
    } };
  });

  app.post('/orders/:id/insurance/sandbox', { preHandler: requireUser }, async (request, reply) => {
    if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒保险状态入口未开放');
    if (!validUuid(request.params.id) || !['issued', 'not_started'].includes(request.body?.status)) {
      return sendError(reply, 400, '沙盒保险状态无效');
    }
    const policy = await pool.query(
      `SELECT ip.id,ip.status,o.status AS order_status
       FROM insurance_policies ip JOIN booking_orders o ON o.id=ip.order_id
       WHERE o.id=$1 AND o.buyer_user_id=$2`,
      [request.params.id, request.user.id],
    );
    if (!policy.rowCount) return sendError(reply, 404, '订单投保记录不存在');
    if (policy.rows[0].order_status !== 'paid') return sendError(reply, 409, '订单支付后才能模拟投保');
    const issued = request.body.status === 'issued';
    const result = await pool.query(
      `UPDATE insurance_policies SET status=$2,provider_code='sandbox',
         provider_policy_reference=CASE WHEN $3 THEN COALESCE(provider_policy_reference,$4) ELSE NULL END,
         issued_at=CASE WHEN $3 THEN now() ELSE NULL END,updated_at=now()
       WHERE id=$1 RETURNING status,provider_policy_reference,issued_at`,
      [policy.rows[0].id, issued ? 'issued' : 'not_started', issued, `sandbox_policy_${policy.rows[0].id}`],
    );
    await pool.query(
      `UPDATE passenger_insurance_coverages SET status=$2,failure_reason=NULL,
         provider_code='sandbox',provider_policy_reference=$3,
         verified_at=CASE WHEN $2::varchar(24)='effective' THEN now() ELSE NULL END,updated_at=now()
       WHERE order_id=$1`,
      [request.params.id, issued ? 'effective' : 'not_insured',
        issued ? result.rows[0].provider_policy_reference : null],
    );
    return { insurance: {
      status: result.rows[0].status, policyReference: result.rows[0].provider_policy_reference,
      issuedAt: result.rows[0].issued_at, premiumCollectedByPlatform: false,
    } };
  });

  app.post('/orders/:id/passengers/:passengerId/insurance/sandbox',
    { preHandler: requireUser }, async (request, reply) => {
      if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒保险状态入口未开放');
      if (!validUuid(request.params.id) || !validUuid(request.params.passengerId)) {
        return sendError(reply, 400, '订单或乘客编号无效');
      }
      const status = request.body?.status;
      const failureReason = request.body?.failureReason ?? null;
      const allowedStatuses = ['not_insured','pending_verification','effective','failed'];
      const allowedReasons = ['platform_supplier_fault','data_error','insurer_rejected','payment_failed'];
      if (!allowedStatuses.includes(status)
          || (status === 'failed' && !allowedReasons.includes(failureReason))
          || (status !== 'failed' && failureReason !== null)) {
        return sendError(reply, 400, '沙盒保险状态或失败原因无效');
      }
      const result = await pool.query(
        `UPDATE passenger_insurance_coverages c
         SET status=$3,failure_reason=$4,provider_code='sandbox',
             provider_policy_reference=CASE WHEN $3::varchar(24)='effective' THEN COALESCE(c.provider_policy_reference,
               'sandbox_passenger_' || c.passenger_id::text) ELSE c.provider_policy_reference END,
             verified_at=CASE WHEN $3::varchar(24)='effective' THEN now() ELSE NULL END,updated_at=now()
         FROM booking_orders o
         WHERE c.order_id=o.id AND o.id=$1 AND o.buyer_user_id=$2
           AND o.status='paid' AND c.passenger_id=$5
         RETURNING c.status,c.failure_reason,c.coverage_start_at,c.coverage_end_at,c.verified_at`,
        [request.params.id, request.user.id, status, failureReason, request.params.passengerId],
      );
      if (!result.rowCount) return sendError(reply, 404, '已支付订单中的乘客投保记录不存在');
      return { insurance: {
        status: result.rows[0].status,
        failureReason: result.rows[0].failure_reason,
        coverageStartAt: result.rows[0].coverage_start_at,
        coverageEndAt: result.rows[0].coverage_end_at,
        verifiedAt: result.rows[0].verified_at,
        premiumCollectedByPlatform: false,
      } };
    });
}
