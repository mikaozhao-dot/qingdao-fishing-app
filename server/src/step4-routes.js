import { createSecurity } from './security.js';
import { closeoutAtSql, processWaitlistCloseouts } from './step3-waitlist.js';
import { configuredStep3Clock } from './step3-clock.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });
const validUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);
const confirmationAtSql = (alias = 'd') =>
  `((((${alias}.departure_at AT TIME ZONE 'Asia/Shanghai')::date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai')`;

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function captainPreHandler(pool) {
  return async (request, reply) => {
    if (request.user?.captain_status !== 'approved') {
      return sendError(reply, 403, '船长资质尚未审核通过');
    }
    if (!pool) return sendError(reply, 503, '数据库未配置');
  };
}

async function requireCaptainOwnership(client, departureId, userId, lock = false) {
  const result = await client.query(
    'SELECT d.id,d.captain_user_id,d.status,d.departure_at,d.meeting_at,d.marina_code,d.weather_note,d.trip_type ' +
    'FROM departures d WHERE d.id=$1 AND d.captain_user_id=$2' + (lock ? ' FOR UPDATE' : ''),
    [departureId, userId],
  );
  return result.rows[0] ?? null;
}

async function loadFormationAccounts(client, departureId) {
  const result = await client.query(
    `SELECT d.id,d.minimum_sailing_total_fen,d.departure_at,d.status,
       ${confirmationAtSql('d')} AS confirmation_at,
       COALESCE((
         SELECT SUM(ROUND((o.seat_fee_fen-o.discount_fen)::numeric * 0.9))
         FROM booking_orders o
         WHERE o.departure_id=d.id AND o.status='paid'
       ),0)::bigint AS platform_ticket_net_fen,
       COALESCE((SELECT SUM(a.amount_fen) FROM departure_formation_adjustments a
         WHERE a.departure_id=d.id AND a.adjustment_type='penalty_pool'),0)::bigint AS penalty_pool_fen,
       COALESCE((SELECT SUM(a.amount_fen) FROM departure_formation_adjustments a
         WHERE a.departure_id=d.id AND a.adjustment_type='successful_supplement'),0)::bigint AS successful_supplement_fen,
       COALESCE((
         SELECT SUM(amount_delta_fen)
         FROM departure_offline_ledger_entries e
         WHERE e.departure_id=d.id
       ),0)::bigint AS offline_declared_fen
     FROM departures d WHERE d.id=$1`,
    [departureId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const platformTicketNetFen = Number(row.platform_ticket_net_fen);
  const penaltyPoolFen = Number(row.penalty_pool_fen);
  const successfulSupplementFen = Number(row.successful_supplement_fen);
  const offlineDeclaredFen = Number(row.offline_declared_fen);
  const thresholdFen = Number(row.minimum_sailing_total_fen);
  const platformVerifiableFen = platformTicketNetFen + penaltyPoolFen + successfulSupplementFen;
  return {
    departureId: row.id,
    departureStatus: row.status,
    departureAt: row.departure_at,
    confirmationAt: row.confirmation_at,
    thresholdFen,
    platform: {
      ticketNetFen: platformTicketNetFen,
      penaltyPoolFen,
      successfulSupplementFen,
      verifiableTotalFen: platformVerifiableFen,
      remainingFen: Math.max(0, thresholdFen - platformVerifiableFen),
      meetsThreshold: platformVerifiableFen >= thresholdFen,
    },
    captainOffline: {
      declaredFen: offlineDeclaredFen,
      remainingAfterDeclarationFen: Math.max(0, thresholdFen - platformVerifiableFen - offlineDeclaredFen),
      supportsCaptainConfirmation: platformVerifiableFen < thresholdFen
        && platformVerifiableFen + offlineDeclaredFen >= thresholdFen,
      statement: '船长自报线下台账，未经平台核验，不计入自动成行金额。',
    },
    sourceCoverage: {
      platformTicketNet: 'live_paid_orders',
      penaltyPool: 'live_sandbox_customer_cancellations',
      successfulSupplement: 'live_sandbox_round_payment',
    },
  };
}

export function refundRetryStatus(attemptNumber, succeeded, maxAttempts = 3) {
  if (succeeded) return 'sandbox_succeeded';
  return attemptNumber >= maxAttempts ? 'manual_required' : 'pending';
}

export function distributeSupplementFen(shortfallFen, orders) {
  const total = Number(shortfallFen);
  const totalSeats = orders.reduce((sum, order) => sum + Number(order.seat_count), 0);
  if (!Number.isSafeInteger(total) || total <= 0 || totalSeats <= 0) {
    throw new TypeError('A positive shortfall and at least one paid seat are required');
  }
  const baseFen = Math.floor(total / totalSeats);
  let remainderFen = total % totalSeats;
  return orders.map((order) => {
    const seatCount = Number(order.seat_count);
    const extraFen = Math.min(remainderFen, seatCount);
    remainderFen -= extraFen;
    return { ...order, seatCount, amountFen: baseFen * seatCount + extraFen };
  });
}

async function failSupplementRound(client, roundId, reason, terminalStatus = 'failed') {
  const roundResult = await client.query(
    `SELECT id,status FROM departure_supplement_rounds WHERE id=$1 FOR UPDATE`, [roundId],
  );
  if (!roundResult.rowCount || !['collecting_consent','collecting_payment'].includes(roundResult.rows[0].status)) {
    return false;
  }
  await client.query(
    `UPDATE departure_supplement_rounds SET status=$2,failure_reason=$3,updated_at=now(),completed_at=now()
     WHERE id=$1`, [roundId, terminalStatus, reason],
  );
  await client.query(
    `UPDATE departure_supplement_participants SET
       consent_status=CASE WHEN consent_status='pending' AND $2='response_deadline_expired'
         THEN 'timed_out' ELSE consent_status END,
       payment_status=CASE WHEN payment_status='pending' THEN 'failed' ELSE payment_status END,
       updated_at=now()
     WHERE round_id=$1`, [roundId, reason],
  );
  await client.query(
    `UPDATE payment_transactions t SET status='timed_out',updated_at=now(),completed_at=now()
     FROM departure_supplement_participants p
     WHERE p.round_id=$1 AND t.supplement_participant_id=p.id AND t.status='pending'`, [roundId],
  );
  await client.query(
    `INSERT INTO refund_obligations
       (order_id,payment_transaction_id,amount_fen,reason,status,request_key)
     SELECT p.order_id,t.id,t.amount_fen,'supplement_failure','pending',
       'supplement-failure:'||t.id
     FROM departure_supplement_participants p
     JOIN payment_transactions t ON t.supplement_participant_id=p.id AND t.status='succeeded'
     WHERE p.round_id=$1
     ON CONFLICT (payment_transaction_id,reason) DO NOTHING`, [roundId],
  );
  await client.query(
    `UPDATE departure_supplement_participants p SET payment_status='refund_pending',updated_at=now()
     WHERE p.round_id=$1 AND EXISTS (
       SELECT 1 FROM payment_transactions t
       WHERE t.supplement_participant_id=p.id AND t.status='succeeded'
     )`, [roundId],
  );
  return true;
}

async function refundSupplementDecliners(client, roundId) {
  const exited = await client.query(
    `SELECT p.order_id
     FROM departure_supplement_participants p
     JOIN booking_orders o ON o.id=p.order_id
     WHERE p.round_id=$1 AND p.consent_status IN ('rejected','timed_out') AND o.status='paid'
     FOR UPDATE OF p,o`, [roundId],
  );
  if (!exited.rowCount) return 0;
  const orderIds = exited.rows.map((row) => row.order_id);
  await client.query(
    `UPDATE booking_orders SET status='cancelled',cancelled_at=COALESCE(cancelled_at,now()),
       cancelled_refund_fen=total_amount_fen,cancellation_penalty_fen=0,updated_at=now()
     WHERE id=ANY($1::uuid[]) AND status='paid'`, [orderIds],
  );
  await client.query(
    `UPDATE booking_order_seats SET status='released'
     WHERE order_id=ANY($1::uuid[]) AND status='paid'`, [orderIds],
  );
  await client.query(
    `UPDATE seat_inventory SET status='available',hold_id=NULL,hold_expires_at=NULL,
       waitlist_released_at=NULL,updated_at=now()
     WHERE id IN (SELECT seat_inventory_id FROM booking_order_seats
       WHERE order_id=ANY($1::uuid[])) AND status='booked'`, [orderIds],
  );
  await client.query(
    `INSERT INTO refund_obligations
       (order_id,payment_transaction_id,amount_fen,reason,status,request_key)
     SELECT o.id,
       (SELECT t.id FROM payment_transactions t
        WHERE t.order_id=o.id AND t.status='succeeded' ORDER BY t.completed_at DESC,t.id DESC LIMIT 1),
       o.total_amount_fen,'customer_cancellation','pending','supplement-exit:'||o.id
     FROM booking_orders o WHERE o.id=ANY($1::uuid[]) AND o.total_amount_fen>0
     ON CONFLICT (request_key) DO NOTHING`, [orderIds],
  );
  await client.query(
    `UPDATE departure_waitlist_entries SET status='closed',updated_at=now()
     WHERE order_id=ANY($1::uuid[]) AND status='converted'`, [orderIds],
  );
  return exited.rowCount;
}

async function finalizeSupplementRound(client, roundId) {
  const roundResult = await client.query(
    `SELECT * FROM departure_supplement_rounds WHERE id=$1 FOR UPDATE`, [roundId],
  );
  if (!roundResult.rowCount) return { status: 'missing' };
  const round = roundResult.rows[0];
  if (!['collecting_consent','collecting_payment'].includes(round.status)) return { status: round.status };
  const participantResult = await client.query(
    `SELECT id,order_id,consent_status,payment_status FROM departure_supplement_participants
     WHERE round_id=$1 ORDER BY order_id`, [roundId],
  );
  if (!participantResult.rowCount || participantResult.rows.some((participant) =>
    participant.consent_status !== 'accepted' || participant.payment_status !== 'succeeded')) {
    return { status: round.status, waiting: true };
  }
  const accounts = await loadFormationAccounts(client, round.departure_id);
  if (accounts.departureStatus !== 'handling_shortfall'
      || participantResult.rowCount !== Number(round.participant_count)) {
    await failSupplementRound(client, roundId, 'formation_state_or_participant_count_changed');
    return { status: 'failed', reason: 'formation_state_or_participant_count_changed' };
  }
  const paidOrders = await client.query(
    `SELECT id FROM booking_orders WHERE departure_id=$1 AND status='paid' ORDER BY id`,
    [round.departure_id],
  );
  const currentOrderIds = paidOrders.rows.map((row) => row.id).sort();
  const frozenOrderIds = [...round.source_order_ids].sort();
  const snapshotValid = accounts.thresholdFen === Number(round.threshold_fen)
    && accounts.platform.ticketNetFen === Number(round.ticket_net_fen)
    && accounts.platform.penaltyPoolFen === Number(round.penalty_pool_fen)
    && accounts.platform.remainingFen === Number(round.shortfall_fen)
    && currentOrderIds.length === frozenOrderIds.length
    && currentOrderIds.every((id, index) => id === frozenOrderIds[index]);
  if (!snapshotValid) {
    await failSupplementRound(client, roundId, 'formation_snapshot_changed');
    return { status: 'failed', reason: 'formation_snapshot_changed' };
  }
  const participantPayments = await client.query(
    `SELECT COALESCE(SUM(amount_fen),0)::bigint AS amount_fen
     FROM payment_transactions WHERE supplement_participant_id=ANY($1::uuid[])
       AND status='succeeded'`,
    [participantResult.rows.map((participant) => participant.id)],
  );
  const paymentTotal = Number(participantPayments.rows[0].amount_fen);
  if (paymentTotal !== Number(round.shortfall_fen)) {
    await failSupplementRound(client, roundId, 'payment_total_mismatch');
    return { status: 'failed', reason: 'payment_total_mismatch' };
  }
  await client.query(
    `INSERT INTO departure_formation_adjustments
       (departure_id,adjustment_type,amount_fen,source_reference)
     VALUES ($1,'successful_supplement',$2,$3)
     ON CONFLICT (departure_id,adjustment_type,source_reference) DO NOTHING`,
    [round.departure_id, round.shortfall_fen, `supplement-round:${roundId}`],
  );
  await client.query(
    `UPDATE departure_supplement_rounds SET status='succeeded',updated_at=now(),completed_at=now()
     WHERE id=$1`, [roundId],
  );
  await client.query(
    `UPDATE departures SET status='confirmed',updated_at=now()
     WHERE id=$1 AND status='handling_shortfall'`, [round.departure_id],
  );
  return { status: 'succeeded', platformVerifiableFen: accounts.platform.verifiableTotalFen + paymentTotal };
}

export async function settleSupplementPayment(client, payment, event) {
  const participantResult = await client.query(
    `SELECT p.id,p.round_id,p.order_id,p.amount_fen,p.consent_status,p.payment_status,
            r.departure_id,r.status AS round_status,r.response_deadline_at
     FROM departure_supplement_participants p
     JOIN departure_supplement_rounds r ON r.id=p.round_id
     WHERE p.id=$1 FOR UPDATE OF p,r`,
    [payment.supplement_participant_id],
  );
  if (!participantResult.rowCount) return { error: [404, '补差记录不存在'] };
  const participant = participantResult.rows[0];
  if (event.orderId !== participant.id || Number(payment.amount_fen) !== event.amountFen
      || Number(participant.amount_fen) !== event.amountFen) {
    return { error: [400, '补差订单或金额不匹配'] };
  }
  const now = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
  const deadlinePassed = new Date(now) >= new Date(participant.response_deadline_at);
  const activeRound = ['collecting_consent','collecting_payment'].includes(participant.round_status)
    && !deadlinePassed;
  if (payment.status !== 'pending') {
    if (['timed_out','failed'].includes(payment.status) && event.outcome === 'success') {
      await failSupplementRound(client, participant.round_id,
        deadlinePassed ? 'response_deadline_expired' : `payment_arrived_after_${payment.status}`,
        deadlinePassed ? 'expired' : 'failed');
      await client.query(
        `UPDATE payment_transactions SET status='succeeded',late_success=true,callback_event_id=$2,
          updated_at=now(),completed_at=now() WHERE id=$1`, [payment.id, event.eventId],
      );
      await client.query(
        `INSERT INTO refund_obligations
          (order_id,payment_transaction_id,amount_fen,reason,status,request_key)
         VALUES ($1,$2,$3,'supplement_failure','pending',$4)
         ON CONFLICT (payment_transaction_id,reason) DO NOTHING`,
        [participant.order_id, payment.id, event.amountFen, `supplement-failure:${payment.id}`],
      );
      await client.query(
        `UPDATE departure_supplement_participants SET payment_status='refund_pending',updated_at=now()
         WHERE id=$1`, [participant.id],
      );
      return { paymentStatus: 'succeeded', latePaymentRefundRequired: true, includedInFormation: false };
    }
    if (payment.status === 'succeeded' && event.outcome === 'success') {
      return { duplicate: true, paymentStatus: 'succeeded', latePaymentRefundRequired: payment.late_success };
    }
    return { duplicate: true, paymentStatus: payment.status };
  }
  if (!activeRound || participant.consent_status !== 'accepted') {
    if (event.outcome !== 'success') {
      await client.query(
        `UPDATE payment_transactions SET status=$2,callback_event_id=$3,updated_at=now(),completed_at=now()
         WHERE id=$1`,
        [payment.id, event.outcome === 'timeout' ? 'timed_out' : 'failed', event.eventId],
      );
      return { paymentStatus: event.outcome === 'timeout' ? 'timed_out' : 'failed' };
    }
    await failSupplementRound(client, participant.round_id,
      deadlinePassed ? 'response_deadline_expired' : 'payment_without_valid_consent',
      deadlinePassed ? 'expired' : 'failed');
    await client.query(
      `UPDATE payment_transactions SET status='succeeded',late_success=true,callback_event_id=$2,
        updated_at=now(),completed_at=now() WHERE id=$1`, [payment.id, event.eventId],
    );
    await client.query(
      `INSERT INTO refund_obligations
        (order_id,payment_transaction_id,amount_fen,reason,status,request_key)
       VALUES ($1,$2,$3,'supplement_failure','pending',$4)
       ON CONFLICT (payment_transaction_id,reason) DO NOTHING`,
      [participant.order_id, payment.id, event.amountFen, `supplement-failure:${payment.id}`],
    );
    await client.query(
      `UPDATE departure_supplement_participants SET payment_status='refund_pending',updated_at=now()
       WHERE id=$1`, [participant.id],
    );
    return { paymentStatus: 'succeeded', latePaymentRefundRequired: true, includedInFormation: false };
  }
  if (event.outcome !== 'success') {
    await client.query(
      `UPDATE payment_transactions SET status=$2,callback_event_id=$3,updated_at=now(),completed_at=now()
       WHERE id=$1`,
      [payment.id, event.outcome === 'timeout' ? 'timed_out' : 'failed', event.eventId],
    );
    await client.query(
      `UPDATE departure_supplement_participants SET payment_status='failed',updated_at=now() WHERE id=$1`,
      [participant.id],
    );
    await failSupplementRound(client, participant.round_id, `payment_${event.outcome}`);
    return { paymentStatus: event.outcome === 'timeout' ? 'timed_out' : 'failed', roundStatus: 'failed' };
  }
  await client.query(
    `UPDATE payment_transactions SET status='succeeded',callback_event_id=$2,updated_at=now(),completed_at=now()
     WHERE id=$1`, [payment.id, event.eventId],
  );
  await client.query(
    `UPDATE departure_supplement_participants SET payment_status='succeeded',paid_at=now(),updated_at=now()
     WHERE id=$1`, [participant.id],
  );
  const completion = await finalizeSupplementRound(client, participant.round_id);
  return { paymentStatus: 'succeeded', roundStatus: completion.status, ...completion };
}

export async function processSupplementDeadlines(pool, asOf = new Date()) {
  const due = await pool.query(
    `SELECT id,departure_id FROM departure_supplement_rounds
     WHERE status IN ('collecting_consent','collecting_payment') AND response_deadline_at <= $1
     ORDER BY response_deadline_at,id LIMIT 100`, [asOf],
  );
  let expired = 0;
  for (const row of due.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [row.departure_id]);
      const result = await failSupplementRound(client, row.id, 'response_deadline_expired', 'expired');
      if (result) await refundSupplementDecliners(client, row.id);
      await client.query('COMMIT');
      if (result) expired += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return { expired };
}

export async function processSandboxRefundObligations(pool, maxAttempts = 3, refundAttempt = async () => true) {
  const pending = await pool.query(
    `SELECT id,request_key,attempt_count FROM refund_obligations
     WHERE status='pending' ORDER BY created_at,id LIMIT 100`,
  );
  let settled = 0;
  for (const obligation of pending.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT id,request_key,attempt_count,status,payment_transaction_id FROM refund_obligations
         WHERE id=$1 AND status='pending' FOR UPDATE SKIP LOCKED`, [obligation.id],
      );
      if (!locked.rowCount) {
        await client.query('COMMIT');
        continue;
      }
      const attempts = Number(locked.rows[0].attempt_count) + 1;
      // This phase is sandbox-only; production refund transport is not authorized or configured.
      const succeeded = await refundAttempt(locked.rows[0]);
      const status = refundRetryStatus(attempts, succeeded, maxAttempts);
      const updated = await client.query(
        `UPDATE refund_obligations SET status=$2::varchar,attempt_count=$3,updated_at=now(),
          settled_at=CASE WHEN $2::varchar IN ('sandbox_succeeded','manual_required') THEN now() ELSE NULL END
         WHERE id=$1 RETURNING id`, [obligation.id, status, attempts],
      );
      if (locked.rows[0].payment_transaction_id) {
        await client.query(
          `UPDATE departure_supplement_participants p SET payment_status=$2,updated_at=now()
           FROM payment_transactions t
           WHERE t.id=$1 AND t.supplement_participant_id=p.id`,
          [locked.rows[0].payment_transaction_id,
            status === 'sandbox_succeeded' ? 'refunded' : status === 'manual_required' ? 'manual_required' : 'refund_pending'],
        );
      }
      if (status === 'manual_required') {
        await client.query(
          `INSERT INTO admin_manual_review_events (event_type,refund_obligation_id,detail)
           VALUES ('refund_manual_required',$1,'Sandbox refund retry limit reached')
           ON CONFLICT (refund_obligation_id) DO NOTHING`, [obligation.id],
        );
      }
      settled += updated.rowCount;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return { settled };
}

async function departureHasPassed(client, departureId) {
  const result = await client.query(
    'SELECT departure_at <= clock_timestamp() AS is_overdue FROM departures WHERE id=$1',
    [departureId],
  );
  return result.rows[0]?.is_overdue === true;
}

async function markFormationOverdue(client, departureId) {
  await client.query(
    "UPDATE departures SET status='formation_overdue',updated_at=now() WHERE id=$1",
    [departureId],
  );
}

/** Capture the approved T-1 18:00 Asia/Shanghai checkpoint once per departure. */
export async function processFormationChecks(pool, asOf = new Date(), onError = () => {},
  { redis = null, clockNow = null } = {}) {
  if (!pool) return { checked: 0, deferred: 0, overdue: 0 };
  await processWaitlistCloseouts(pool, asOf, redis, clockNow);
  await processSupplementDeadlines(pool, asOf);
  await processSandboxRefundObligations(pool);
  const due = await pool.query(
    `SELECT d.id FROM departures d
     WHERE d.status IN ('open','forming') AND ${closeoutAtSql('d')} <= $1
       AND NOT EXISTS (SELECT 1 FROM departure_formation_snapshots s WHERE s.departure_id=d.id)
     ORDER BY d.departure_at,d.id LIMIT 100`,
    [asOf],
  );
  let checked = 0;
  let deferred = 0;
  let overdue = 0;
  for (const candidate of due.rows) {
    try {
      const outcome = await withTransaction(pool, async (client) => {
        const departure = await client.query(
          `SELECT d.id,d.status,d.departure_at,d.waitlist_window_closed_at,
                  ${confirmationAtSql('d')} AS confirmation_at
           FROM departures d WHERE d.id=$1 AND d.status IN ('open','forming')
             AND ${closeoutAtSql('d')} <= $2
             AND NOT EXISTS (SELECT 1 FROM departure_formation_snapshots s WHERE s.departure_id=d.id)
           FOR UPDATE`,
          [candidate.id, asOf],
        );
        if (!departure.rowCount) return 'already_checked';
        if (await departureHasPassed(client, candidate.id)) {
          await markFormationOverdue(client, candidate.id);
          return 'overdue';
        }
        if (!departure.rows[0].waitlist_window_closed_at) return 'deferred';
        const pending = await client.query(
          `SELECT EXISTS (SELECT 1 FROM booking_orders
             WHERE departure_id=$1 AND status='pending_payment') AS has_pending_payment`,
          [candidate.id],
        );
        if (pending.rows[0].has_pending_payment) return 'deferred';
        const accounts = await loadFormationAccounts(client, candidate.id);
        // The batch's asOf only selects due checkpoints. Recheck the real clock
        // after any row-lock wait and account reads, immediately before writing.
        if (await departureHasPassed(client, candidate.id)) {
          await markFormationOverdue(client, candidate.id);
          return 'overdue';
        }
        const result = accounts.platform.meetsThreshold ? 'automatic_confirmed' : 'shortfall';
        await client.query(
          `INSERT INTO departure_formation_snapshots
             (departure_id,confirmation_at,checked_at,threshold_fen,platform_ticket_net_fen,
              penalty_pool_fen,successful_supplement_fen,platform_verifiable_fen,
              captain_offline_declared_fen,outcome)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [candidate.id, departure.rows[0].confirmation_at, asOf, accounts.thresholdFen,
            accounts.platform.ticketNetFen, accounts.platform.penaltyPoolFen,
            accounts.platform.successfulSupplementFen, accounts.platform.verifiableTotalFen,
            accounts.captainOffline.declaredFen, result],
        );
        await client.query('UPDATE departures SET status=$2,updated_at=now() WHERE id=$1',
          [candidate.id, result === 'automatic_confirmed' ? 'confirmed' : 'handling_shortfall']);
        return result;
      });
      if (outcome === 'deferred') deferred += 1;
      else if (outcome === 'overdue') overdue += 1;
      else if (outcome !== 'already_checked') checked += 1;
    } catch (error) {
      onError(error);
    }
  }
  return { checked, deferred, overdue };
}

function checklistFromRow(row) {
  const seatCount = Number(row.seat_count ?? 0);
  const passengerCount = Number(row.passenger_count ?? 0);
  const insuredOrderCount = Number(row.insured_order_count ?? 0);
  const orderCount = Number(row.order_count ?? 0);
  const insuranceReady = orderCount > 0 && insuredOrderCount === orderCount;
  const manifestReady = seatCount > 0 && seatCount === passengerCount;
  return {
    meetingAt: row.meeting_at ?? row.departure_at,
    marinaCode: row.marina_code,
    weather: row.weather_note || '出航前更新海况',
    insurance: {
      insuredOrderCount,
      orderCount,
      status: insuranceReady ? 'checked' : 'check_before_departure',
    },
    manifest: {
      seatCount,
      passengerCount,
      status: manifestReady ? 'matched' : 'review_required',
    },
    items: [
      { key: 'meeting', title: '集合时间与地点', done: true },
      { key: 'equipment', title: '核对随身装备', done: false },
      { key: 'weather', title: '出航前确认海况', done: false },
      { key: 'insurance', title: '确认保险状态', done: insuranceReady },
      { key: 'manifest', title: '核验乘船人名单', done: manifestReady },
    ],
  };
}

async function buildChecklist(client, departureId) {
  const result = await client.query(
    "SELECT d.id,d.departure_at,d.meeting_at,d.marina_code,d.weather_note," +
      "count(DISTINCT os.seat_inventory_id)::integer AS seat_count," +
      "count(DISTINCT op.id)::integer AS passenger_count," +
      "count(DISTINCT o.id) FILTER (WHERE ip.status='issued')::integer AS insured_order_count," +
      "count(DISTINCT o.id)::integer AS order_count " +
    "FROM departures d " +
    "LEFT JOIN booking_orders o ON o.departure_id=d.id AND o.status='paid' " +
    "LEFT JOIN booking_order_seats os ON os.order_id=o.id AND os.status='paid' " +
    "LEFT JOIN order_passengers op ON op.order_id=o.id " +
    "LEFT JOIN insurance_policies ip ON ip.order_id=o.id " +
    "WHERE d.id=$1 GROUP BY d.id",
    [departureId],
  );
  if (!result.rowCount) throw new Error('班次不存在');
  const row = result.rows[0];
  const checklist = checklistFromRow(row);
  await client.query(
    'INSERT INTO departure_pretrip_checklists (departure_id,checklist) VALUES ($1,$2::jsonb) ' +
      'ON CONFLICT (departure_id) DO UPDATE SET checklist=EXCLUDED.checklist,generated_at=now()',
    [departureId, JSON.stringify(checklist)],
  );
  const recipients = await client.query(
    "SELECT DISTINCT buyer_user_id FROM booking_orders WHERE departure_id=$1 AND status='paid'",
    [departureId],
  );
  for (const recipient of recipients.rows) {
    await client.query(
      "INSERT INTO notification_outbox (recipient_user_id,departure_id,kind,payload) " +
      "VALUES ($1,$2,'pretrip_checklist',$3::jsonb) " +
      'ON CONFLICT (recipient_user_id,departure_id,kind) DO NOTHING',
      [recipient.buyer_user_id, departureId, JSON.stringify({
        title: '班次已确认，行前清单已生成',
        meetingAt: checklist.meetingAt,
        marinaCode: checklist.marinaCode,
        weather: checklist.weather,
      })],
    );
  }
  return checklist;
}

/** Generate non-financial pre-trip artifacts for already-confirmed departures. */
export async function processConfirmedChecklists(pool, onError = () => {}) {
  if (!pool) return { generated: 0 };
  const due = await pool.query(
    "SELECT id FROM departures d WHERE d.status IN ('confirmed','captain_confirmed','in_progress','completed') " +
      'AND NOT EXISTS (SELECT 1 FROM departure_pretrip_checklists c WHERE c.departure_id=d.id) ' +
      'ORDER BY d.departure_at,d.id LIMIT 50',
  );
  let generated = 0;
  for (const row of due.rows) {
    try {
      await withTransaction(pool, async (client) => {
        const departure = await client.query(
          "SELECT d.id FROM departures d WHERE d.id=$1 AND d.status IN ('confirmed','captain_confirmed','in_progress','completed') " +
            'AND NOT EXISTS (SELECT 1 FROM departure_pretrip_checklists c WHERE c.departure_id=d.id) FOR UPDATE',
          [row.id],
        );
        if (departure.rowCount) await buildChecklist(client, row.id);
      });
      generated += 1;
    } catch (error) {
      // Retry on the next worker pass; no departure or order state is changed.
      onError(error);
    }
  }
  return { generated };
}

function maskName(value) {
  const name = String(value ?? '');
  return name.length < 2 ? '*' : name[0] + '*'.repeat(Math.min(name.length - 1, 4));
}

function maskIdentity(value) {
  const identity = String(value ?? '');
  return identity.length < 8 ? '******************' : identity.slice(0, 3) + '***********' + identity.slice(-4);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function registerStep4Routes(app, { pool, redis, config, requireUser }) {
  const security = createSecurity(config);
  const requireCaptain = captainPreHandler(pool);
  const clockNow = configuredStep3Clock(config);

  app.get('/captain/departures/:id/formation-accounts',
    { preHandler: [requireUser, requireCaptain] }, async (request, reply) => {
      if (!validUuid(request.params.id)) return sendError(reply, 400, '班次编号无效');
      const result = await withTransaction(pool, async (client) => {
        const departure = await requireCaptainOwnership(client, request.params.id, request.user.id);
        if (!departure) return { error: [404, '班次不存在'] };
        return { accounts: await loadFormationAccounts(client, departure.id) };
      });
      if (result.error) return sendError(reply, result.error[0], result.error[1]);
      return result;
    });

  app.post('/captain/departures/:id/offline-ledger',
    { preHandler: [requireUser, requireCaptain] }, async (request, reply) => {
      if (!validUuid(request.params.id)) return sendError(reply, 400, '班次编号无效');
      const amountDeltaFen = request.body?.amountDeltaFen;
      const note = typeof request.body?.note === 'string' ? request.body.note.trim() : '';
      const requestKey = typeof request.body?.requestKey === 'string' ? request.body.requestKey.trim() : '';
      if (!Number.isSafeInteger(amountDeltaFen) || amountDeltaFen === 0
          || Math.abs(amountDeltaFen) > 2_000_000_000) {
        return sendError(reply, 400, '台账金额需为非零整数分');
      }
      if (!note || note.length > 200) return sendError(reply, 400, '请填写 1–200 字的台账依据');
      if (requestKey.length < 8 || requestKey.length > 100) {
        return sendError(reply, 400, '台账请求编号需为 8–100 个字符');
      }
      const result = await withTransaction(pool, async (client) => {
        const departure = await requireCaptainOwnership(client, request.params.id, request.user.id, true);
        if (!departure) return { error: [404, '班次不存在'] };
        if (!['open', 'forming', 'handling_shortfall'].includes(departure.status)
            || new Date(departure.departure_at) <= new Date()) {
          return { error: [409, '当前班次不能登记线下台账'] };
        }
        const replay = await client.query(
          `SELECT id,amount_delta_fen,note,created_at FROM departure_offline_ledger_entries
           WHERE departure_id=$1 AND request_key=$2`,
          [departure.id, requestKey],
        );
        if (replay.rowCount) {
          const entry = replay.rows[0];
          if (Number(entry.amount_delta_fen) !== amountDeltaFen || entry.note !== note) {
            return { error: [409, '台账请求编号已用于其他内容'] };
          }
          return { entry, idempotentReplay: true,
            accounts: await loadFormationAccounts(client, departure.id) };
        }
        const balance = await client.query(
          `SELECT COALESCE(SUM(amount_delta_fen),0)::bigint AS declared_fen
           FROM departure_offline_ledger_entries WHERE departure_id=$1`,
          [departure.id],
        );
        const nextBalance = Number(balance.rows[0].declared_fen) + amountDeltaFen;
        if (nextBalance < 0) return { error: [409, '冲减金额不能超过已登记的线下台账'] };
        const inserted = await client.query(
          `INSERT INTO departure_offline_ledger_entries
             (departure_id,captain_user_id,amount_delta_fen,note,request_key)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id,amount_delta_fen,note,created_at`,
          [departure.id, request.user.id, amountDeltaFen, note, requestKey],
        );
        return { entry: inserted.rows[0], idempotentReplay: false,
          accounts: await loadFormationAccounts(client, departure.id) };
      });
      if (result.error) return sendError(reply, result.error[0], result.error[1]);
      return reply.code(result.idempotentReplay ? 200 : 201).send(result);
    });

  app.post('/captain/departures/:id/supplement-rounds',
    { preHandler: [requireUser, requireCaptain] }, async (request, reply) => {
      if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒补差尚未开放');
      if (!validUuid(request.params.id)) return sendError(reply, 400, '班次编号无效');
      const deadlineMs = Date.parse(request.body?.responseDeadlineAt ?? '');
      if (!Number.isFinite(deadlineMs)) return sendError(reply, 400, '请明确选择补差响应截止时间');
      const result = await withTransaction(pool, async (client) => {
        const departure = await requireCaptainOwnership(client, request.params.id, request.user.id, true);
        if (!departure) return { error: [404, '班次不存在'] };
        if (departure.status !== 'handling_shortfall' || new Date(departure.departure_at) <= new Date()) {
          return { error: [409, '当前班次不在待补差状态'] };
        }
        const cutoff = await client.query(
          `SELECT d.waitlist_window_closed_at,${confirmationAtSql('d')} AS confirmation_at
           FROM departures d WHERE d.id=$1`, [departure.id],
        );
        if (!cutoff.rows[0].waitlist_window_closed_at) {
          return { error: [409, '候补收尾窗口尚未冻结'] };
        }
        const now = await client.query('SELECT clock_timestamp() AS now');
        if (deadlineMs <= new Date(now.rows[0].now).getTime()
            || deadlineMs >= new Date(departure.departure_at).getTime()) {
          return { error: [400, '补差截止时间必须晚于现在并早于出航时间'] };
        }
        const existing = await client.query(
          `SELECT id,status,response_deadline_at,shortfall_fen
           FROM departure_supplement_rounds WHERE departure_id=$1`, [departure.id],
        );
        if (existing.rowCount) {
          const row = existing.rows[0];
          if (['collecting_consent','collecting_payment'].includes(row.status)) {
            const participants = await client.query(
              `SELECT id,order_id,amount_fen,consent_status,payment_status
               FROM departure_supplement_participants WHERE round_id=$1 ORDER BY order_id`, [row.id],
            );
            return { round: {
              id: row.id, status: row.status, responseDeadlineAt: row.response_deadline_at,
              shortfallFen: Number(row.shortfall_fen), participants: participants.rows.map((item) => ({
                id: item.id, orderId: item.order_id, amountFen: Number(item.amount_fen),
                consentStatus: item.consent_status, paymentStatus: item.payment_status,
              })),
            }, idempotentReplay: true };
          }
          return { error: [409, '本航次的一轮补差已结束，不能发起第二轮'] };
        }
        const snapshot = await client.query(
          `SELECT threshold_fen,platform_ticket_net_fen,penalty_pool_fen,outcome
           FROM departure_formation_snapshots WHERE departure_id=$1 FOR UPDATE`, [departure.id],
        );
        if (!snapshot.rowCount || snapshot.rows[0].outcome !== 'shortfall') {
          return { error: [409, '缺少服务端未达标核算快照'] };
        }
        const accounts = await loadFormationAccounts(client, departure.id);
        if (accounts.platform.remainingFen <= 0
            || Number(snapshot.rows[0].threshold_fen) !== accounts.thresholdFen
            || Number(snapshot.rows[0].platform_ticket_net_fen) !== accounts.platform.ticketNetFen
            || Number(snapshot.rows[0].penalty_pool_fen) !== accounts.platform.penaltyPoolFen) {
          return { error: [409, '核算快照已变化，请先处理班次状态'] };
        }
        const paidOrders = await client.query(
          `SELECT o.id,o.buyer_user_id,COUNT(os.seat_inventory_id)::integer AS seat_count
           FROM booking_orders o JOIN booking_order_seats os ON os.order_id=o.id AND os.status='paid'
           WHERE o.departure_id=$1 AND o.status='paid'
           GROUP BY o.id,o.buyer_user_id ORDER BY MIN(o.created_at),o.id`, [departure.id],
        );
        const totalSeats = paidOrders.rows.reduce((sum, order) => sum + Number(order.seat_count), 0);
        if (!totalSeats || !paidOrders.rowCount) return { error: [409, '没有可参与本轮补差的有效付费席位'] };
        const round = await client.query(
          `INSERT INTO departure_supplement_rounds
             (departure_id,status,response_deadline_at,threshold_fen,ticket_net_fen,penalty_pool_fen,
              shortfall_fen,source_order_ids,participant_count)
           VALUES ($1,'collecting_consent',$2,$3,$4,$5,$6,$7::uuid[],$8)
           RETURNING id,status,response_deadline_at,shortfall_fen`,
          [departure.id, new Date(deadlineMs).toISOString(), accounts.thresholdFen,
            accounts.platform.ticketNetFen, accounts.platform.penaltyPoolFen,
            accounts.platform.remainingFen, paidOrders.rows.map((order) => order.id), paidOrders.rowCount],
        );
        const participants = [];
        const quotes = distributeSupplementFen(accounts.platform.remainingFen, paidOrders.rows);
        for (const order of quotes) {
          const seatCount = order.seatCount;
          const participant = await client.query(
            `INSERT INTO departure_supplement_participants
               (round_id,order_id,user_id,paid_seat_count,amount_fen)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING id,order_id,amount_fen,consent_status,payment_status`,
            [round.rows[0].id, order.id, order.buyer_user_id, seatCount, order.amountFen],
          );
          participants.push({
            id: participant.rows[0].id, orderId: participant.rows[0].order_id,
            amountFen: Number(participant.rows[0].amount_fen), seatCount,
            consentStatus: participant.rows[0].consent_status,
            paymentStatus: participant.rows[0].payment_status,
          });
        }
        return { round: {
          id: round.rows[0].id, status: round.rows[0].status,
          responseDeadlineAt: round.rows[0].response_deadline_at,
          shortfallFen: Number(round.rows[0].shortfall_fen), totalSeatCount: totalSeats,
          participants,
        }, idempotentReplay: false };
      });
      if (result.error) return sendError(reply, result.error[0], result.error[1]);
      return reply.code(result.idempotentReplay ? 200 : 201).send(result);
    });

  app.get('/orders/:id/supplement-round', { preHandler: requireUser }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '订单编号无效');
    const result = await pool.query(
      `SELECT r.id,r.status,r.response_deadline_at,r.shortfall_fen,p.id AS participant_id,
              p.amount_fen,p.paid_seat_count,p.consent_status,p.payment_status
       FROM booking_orders o JOIN departure_supplement_rounds r ON r.departure_id=o.departure_id
       LEFT JOIN departure_supplement_participants p ON p.round_id=r.id AND p.order_id=o.id
       WHERE o.id=$1 AND o.buyer_user_id=$2
       ORDER BY r.created_at DESC LIMIT 1`,
      [request.params.id, request.user.id],
    );
    if (!result.rowCount) return { round: null };
    const row = result.rows[0];
    return { round: {
      id: row.id, status: row.status, responseDeadlineAt: row.response_deadline_at,
      shortfallFen: Number(row.shortfall_fen), participant: row.participant_id ? {
        id: row.participant_id, orderId: request.params.id, amountFen: Number(row.amount_fen),
        seatCount: Number(row.paid_seat_count), consentStatus: row.consent_status,
        paymentStatus: row.payment_status,
      } : null,
    } };
  });

  app.post('/orders/:id/supplement-rounds/:roundId/decision',
    { preHandler: requireUser }, async (request, reply) => {
      if (!validUuid(request.params.id) || !validUuid(request.params.roundId)) {
        return sendError(reply, 400, '订单或补差编号无效');
      }
      const action = request.body?.action;
      if (!['accept','reject'].includes(action)) return sendError(reply, 400, '补差选择无效');
      const result = await withTransaction(pool, async (client) => {
        const lookup = await client.query(
          `SELECT departure_id FROM booking_orders WHERE id=$1 AND buyer_user_id=$2`,
          [request.params.id, request.user.id],
        );
        if (!lookup.rowCount) return { error: [404, '订单不存在'] };
        await client.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [lookup.rows[0].departure_id]);
        const roundResult = await client.query(
          `SELECT * FROM departure_supplement_rounds WHERE id=$1 AND departure_id=$2 FOR UPDATE`,
          [request.params.roundId, lookup.rows[0].departure_id],
        );
        if (!roundResult.rowCount) return { error: [404, '补差轮次不存在'] };
        const round = roundResult.rows[0];
        const participantResult = await client.query(
          `SELECT * FROM departure_supplement_participants
           WHERE round_id=$1 AND order_id=$2 AND user_id=$3 FOR UPDATE`,
          [round.id, request.params.id, request.user.id],
        );
        if (!participantResult.rowCount) return { error: [403, '该订单不属于本轮补差'] };
        const participant = participantResult.rows[0];
        const now = await client.query('SELECT clock_timestamp() AS now');
        if (['failed','expired'].includes(round.status) && action === 'reject') {
          if (['rejected','timed_out'].includes(participant.consent_status)) {
            return { round: {
              id: round.id, status: round.status, rejected: true,
              exitRefundRequested: true, idempotentReplay: true,
            } };
          }
          if (!['pending','accepted'].includes(participant.consent_status)) {
            return { error: [409, '当前补差参与状态不能退出'] };
          }
          await client.query(
            `UPDATE departure_supplement_participants SET consent_status='rejected',
               responded_at=COALESCE(responded_at,$2),updated_at=now() WHERE id=$1`,
            [participant.id, now.rows[0].now],
          );
          await refundSupplementDecliners(client, round.id);
          return { round: {
            id: round.id, status: round.status, rejected: true,
            exitRefundRequested: true,
          } };
        }
        if (!['collecting_consent','collecting_payment'].includes(round.status)) {
          return { error: [409, '本轮补差已结束'] };
        }
        if (new Date(now.rows[0].now) >= new Date(round.response_deadline_at)) {
          await failSupplementRound(client, round.id, 'response_deadline_expired', 'expired');
          await refundSupplementDecliners(client, round.id);
          return { error: [409, '本轮补差已超时并整轮失效'] };
        }
        if (participant.consent_status !== 'pending') {
          if (participant.consent_status === (action === 'accept' ? 'accepted' : 'rejected')) {
            return { round: { id: round.id, status: round.status, idempotentReplay: true } };
          }
          return { error: [409, '该订单已提交相反选择'] };
        }
        await client.query(
          `UPDATE departure_supplement_participants SET consent_status=$2,responded_at=now(),updated_at=now()
           WHERE id=$1`, [participant.id, action === 'accept' ? 'accepted' : 'rejected'],
        );
        if (action === 'reject') {
          await failSupplementRound(client, round.id, 'participant_rejected');
          await refundSupplementDecliners(client, round.id);
          return { round: { id: round.id, status: 'failed', rejected: true } };
        }
        const consent = await client.query(
          `SELECT COUNT(*)::integer AS total,
             COUNT(*) FILTER (WHERE consent_status='accepted')::integer AS accepted
           FROM departure_supplement_participants WHERE round_id=$1`, [round.id],
        );
        if (Number(consent.rows[0].total) === Number(consent.rows[0].accepted)) {
          await client.query(
            `UPDATE departure_supplement_rounds SET status='collecting_payment',updated_at=now()
             WHERE id=$1 AND status='collecting_consent'`, [round.id],
          );
          await client.query(
            `UPDATE departure_supplement_participants SET payment_status='succeeded',paid_at=now(),updated_at=now()
             WHERE round_id=$1 AND amount_fen=0`, [round.id],
          );
          const completion = await finalizeSupplementRound(client, round.id);
          return { round: {
            id: round.id, status: completion.status,
            paymentRequired: completion.status !== 'succeeded' && participant.amount_fen > 0,
            platformVerifiableFen: completion.platformVerifiableFen,
          } };
        }
        return { round: { id: round.id, status: 'collecting_consent', accepted: true } };
      });
      if (result.error) return sendError(reply, result.error[0], result.error[1]);
      return result;
    });

  app.post('/captain/departures/:id/formation/decision',
    { preHandler: [requireUser, requireCaptain] }, async (request, reply) => {
      if (!validUuid(request.params.id)) return sendError(reply, 400, '班次编号无效');
      if (request.body?.action !== 'captain_confirmed') return sendError(reply, 400, '成行处置选项无效');
      const basisNote = typeof request.body?.basisNote === 'string' ? request.body.basisNote.trim() : '';
      if (!basisNote || basisNote.length > 200) return sendError(reply, 400, '请填写 1–200 字的双账确认依据');
      const result = await withTransaction(pool, async (client) => {
        const departure = await requireCaptainOwnership(client, request.params.id, request.user.id, true);
        if (!departure) return { error: [404, '班次不存在'] };
        if (departure.status !== 'handling_shortfall') return { error: [409, '当前班次不在待处置状态'] };
        if (new Date(departure.departure_at) <= new Date()) {
          return { error: [409, '出航时间已过，成行确认需人工处理'] };
        }
        const activeSupplement = await client.query(
          `SELECT id FROM departure_supplement_rounds
           WHERE departure_id=$1 AND status IN ('collecting_consent','collecting_payment')`,
          [departure.id],
        );
        if (activeSupplement.rowCount) {
          return { error: [409, '本轮补差仍在进行，暂不能同时选择船长确认成行'] };
        }
        const snapshot = await client.query(
          'SELECT outcome FROM departure_formation_snapshots WHERE departure_id=$1 FOR UPDATE',
          [departure.id],
        );
        if (!snapshot.rowCount || snapshot.rows[0].outcome !== 'shortfall') {
          return { error: [409, '缺少服务端成团核算快照'] };
        }
        const accounts = await loadFormationAccounts(client, departure.id);
        if (accounts.platform.verifiableTotalFen + accounts.captainOffline.declaredFen < accounts.thresholdFen) {
          return { error: [409, '平台账与船长登记线下账合计仍低于成行门槛'] };
        }
        await client.query(
          `INSERT INTO departure_captain_formation_decisions
             (departure_id,captain_user_id,threshold_fen,platform_verifiable_fen,
              captain_offline_declared_fen,basis_note)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [departure.id, request.user.id, accounts.thresholdFen, accounts.platform.verifiableTotalFen,
            accounts.captainOffline.declaredFen, basisNote],
        );
        await client.query("UPDATE departures SET status='captain_confirmed',updated_at=now() WHERE id=$1",
          [departure.id]);
        return { status: 'captain_confirmed', platformVerifiableFen: accounts.platform.verifiableTotalFen,
          captainOfflineDeclaredFen: accounts.captainOffline.declaredFen,
          thresholdFen: accounts.thresholdFen, platformGuarantee: false };
      });
      if (result.error) return sendError(reply, result.error[0], result.error[1]);
      return result;
    });

  app.get('/captain/departures/:id/insurance-gate',
    { preHandler: [requireUser, requireCaptain] }, async (request, reply) => {
      if (!validUuid(request.params.id)) return sendError(reply, 400, '班次编号无效');
      const result = await withTransaction(pool, async (client) => {
        const departure = await requireCaptainOwnership(client, request.params.id, request.user.id);
        if (!departure) return { error: [404, '班次不存在'] };
        if (!['confirmed','captain_confirmed','in_progress'].includes(departure.status)) {
          return { error: [409, '仅已确认的班次可以核对登船门禁'] };
        }
        await client.query(
          `INSERT INTO departure_required_insurance (departure_id)
           VALUES ($1) ON CONFLICT (departure_id) DO NOTHING`,
          [departure.id],
        );
        // Migration 012 handles one-time legacy sandbox backfill. Order-level
        // policy status alone does not verify coverage for a changed sailing window.
        const [requiredResult, passengerResult] = await Promise.all([
          client.query(
            `SELECT coverage_code,status,failure_reason,provider_policy_reference,verified_at
             FROM departure_required_insurance WHERE departure_id=$1`,
            [departure.id],
          ),
          client.query(
            `SELECT s.seat_number,c.status,c.failure_reason,c.coverage_start_at,c.coverage_end_at,c.verified_at
             FROM booking_orders o
             JOIN departures d ON d.id=o.departure_id
             JOIN order_passengers op ON op.order_id=o.id
             LEFT JOIN seat_inventory s ON s.id=op.seat_inventory_id
             LEFT JOIN passenger_insurance_coverages c ON c.passenger_id=op.id
               AND c.departure_id=o.departure_id
               AND c.coverage_start_at=d.departure_at AND c.coverage_end_at=d.return_at
             WHERE o.departure_id=$1 AND o.status='paid'
             ORDER BY s.seat_number NULLS LAST,op.id`,
            [departure.id],
          ),
        ]);
        const required = requiredResult.rows[0];
        const tripCoverageReady = required?.status === 'effective';
        const passengers = passengerResult.rows.map((row) => {
          const status = row.status ?? 'not_insured';
          return {
            seatNumber: row.seat_number === null ? null : Number(row.seat_number),
            status,
            failureReason: row.failure_reason,
            coverageStartAt: row.coverage_start_at,
            coverageEndAt: row.coverage_end_at,
            canBoard: tripCoverageReady && status === 'effective',
            blockReason: !tripCoverageReady
              ? 'departure_required_coverage_missing'
              : status === 'effective' ? null : 'passenger_coverage_not_effective',
          };
        });
        return {
          departureId: departure.id,
          canDepartureProceed: tripCoverageReady,
          requiredCoverage: {
            code: required?.coverage_code ?? 'vessel_liability',
            status: required?.status ?? 'not_verified',
            failureReason: required?.failure_reason ?? null,
            verifiedAt: required?.verified_at ?? null,
            blocksDeparture: !tripCoverageReady,
          },
          passengers,
          manualBypassAllowed: false,
        };
      });
      if (result.error) return sendError(reply, result.error[0], result.error[1]);
      return result;
    });

  app.post('/captain/departures/:id/required-insurance/sandbox',
    { preHandler: [requireUser, requireCaptain] }, async (request, reply) => {
      if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒保险状态入口未开放');
      if (!validUuid(request.params.id)) return sendError(reply, 400, '班次编号无效');
      const status = request.body?.status;
      const failureReason = request.body?.failureReason ?? null;
      const allowedStatuses = ['not_verified','pending_verification','effective','failed'];
      const allowedReasons = ['platform_supplier_fault','data_error','insurer_rejected','payment_failed'];
      if (!allowedStatuses.includes(status)
          || (status === 'failed' && !allowedReasons.includes(failureReason))
          || (status !== 'failed' && failureReason !== null)) {
        return sendError(reply, 400, '沙盒航次保险状态或失败原因无效');
      }
      const result = await withTransaction(pool, async (client) => {
        const departure = await requireCaptainOwnership(client, request.params.id, request.user.id, true);
        if (!departure) return { error: [404, '班次不存在'] };
        const insuranceResult = await client.query(
          `INSERT INTO departure_required_insurance
             (departure_id,status,failure_reason,provider_code,provider_policy_reference,verified_at,updated_at)
           VALUES ($1,$2,$3,'sandbox',CASE WHEN $2::varchar(24)='effective' THEN 'sandbox_vessel_' || ($1::uuid)::text END,
             CASE WHEN $2::varchar(24)='effective' THEN now() END,now())
           ON CONFLICT (departure_id) DO UPDATE SET status=EXCLUDED.status,
             failure_reason=EXCLUDED.failure_reason,provider_code=EXCLUDED.provider_code,
             provider_policy_reference=EXCLUDED.provider_policy_reference,
             verified_at=EXCLUDED.verified_at,updated_at=now()
           RETURNING coverage_code,status,failure_reason,verified_at`,
          [departure.id, status, failureReason],
        );
        return { requiredCoverage: insuranceResult.rows[0] };
      });
      if (result.error) return sendError(reply, result.error[0], result.error[1]);
      return result;
    });

  app.get('/captain/fulfillment', { preHandler: [requireUser, requireCaptain] }, async (request) => {
    const result = await pool.query(
      "SELECT d.id,d.status,d.trip_type,d.departure_at,d.meeting_at,d.marina_code " +
      "FROM departures d WHERE d.captain_user_id=$1 AND d.status IN ('confirmed','captain_confirmed','in_progress','completed') " +
      'ORDER BY d.departure_at DESC LIMIT 100',
      [request.user.id],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        platformGuarantee: row.status === 'captain_confirmed' ? false : null,
        tripType: row.trip_type,
        departureAt: row.departure_at,
        meetingAt: row.meeting_at,
        marinaCode: row.marina_code,
      })),
    };
  });

  app.get('/captain/departures/:id/fulfillment', { preHandler: [requireUser, requireCaptain] }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '班次编号无效');
    const result = await withTransaction(pool, async (client) => {
      const departure = await requireCaptainOwnership(client, request.params.id, request.user.id);
      if (!departure) return { error: [404, '班次不存在'] };
      if (!['confirmed', 'captain_confirmed', 'in_progress', 'completed'].includes(departure.status)) {
        return { error: [409, '行前清单仅适用于已确认的班次'] };
      }
      const checklist = await buildChecklist(client, departure.id);
      return {
        departure: {
          id: departure.id,
          status: departure.status,
          platformGuarantee: departure.status === 'captain_confirmed' ? false : null,
          departureAt: departure.departure_at,
          meetingAt: departure.meeting_at,
          marinaCode: departure.marina_code,
          tripType: departure.trip_type,
        },
        checklist,
      };
    });
    if (result.error) return sendError(reply, result.error[0], result.error[1]);
    return result;
  });

  app.post('/captain/departures/:id/checkin', { preHandler: [requireUser, requireCaptain] }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '班次编号无效');
    const event = String(request.body?.event ?? '');
    if (!['departed', 'returned'].includes(event)) return sendError(reply, 400, '打卡类型无效');
    const result = await withTransaction(pool, async (client) => {
      const departure = await requireCaptainOwnership(client, request.params.id, request.user.id, true);
      if (!departure) return { error: [404, '班次不存在'] };
      if (event === 'departed' && !['confirmed', 'captain_confirmed'].includes(departure.status)) {
        return { error: [409, '班次确认后才能出航打卡'] };
      }
      if (event === 'returned' && departure.status !== 'in_progress') {
        return { error: [409, '请先完成出航打卡'] };
      }
      if (event === 'departed') {
        const requiredCoverage = await client.query(
          'SELECT status FROM departure_required_insurance WHERE departure_id=$1 FOR UPDATE',
          [departure.id],
        );
        if (requiredCoverage.rows[0]?.status !== 'effective') {
          return { error: [409, '航次必需保障未生效，暂不能出航'] };
        }
        await client.query(
          `SELECT c.id
           FROM passenger_insurance_coverages c
           JOIN booking_orders o ON o.id=c.order_id
           JOIN order_passengers op ON op.id=c.passenger_id AND op.order_id=o.id
           JOIN departures d ON d.id=o.departure_id
           WHERE o.departure_id=$1 AND o.status='paid'
             AND c.departure_id=d.id
             AND c.coverage_start_at=d.departure_at
             AND c.coverage_end_at=d.return_at
           FOR UPDATE OF c`,
          [departure.id],
        );
        const passengerCoverages = await client.query(
          `SELECT op.id,c.status
           FROM booking_orders o
           JOIN departures d ON d.id=o.departure_id
           JOIN order_passengers op ON op.order_id=o.id
           LEFT JOIN passenger_insurance_coverages c ON c.passenger_id=op.id
             AND c.departure_id=d.id
             AND c.coverage_start_at=d.departure_at
             AND c.coverage_end_at=d.return_at
           WHERE o.departure_id=$1 AND o.status='paid'
           ORDER BY op.id`,
          [departure.id],
        );
        if (passengerCoverages.rows.some((passenger) => passenger.status !== 'effective')) {
          return { error: [409, '乘客保障未全部生效，暂不能出航'] };
        }
      }
      const inserted = await client.query(
        'INSERT INTO departure_checkins (departure_id,captain_user_id,event) ' +
        'VALUES ($1,$2,$3) ON CONFLICT (departure_id,event) DO NOTHING RETURNING checked_at',
        [departure.id, request.user.id, event],
      );
      if (!inserted.rowCount) return { error: [409, '该打卡已记录'] };
      const nextStatus = event === 'departed' ? 'in_progress' : 'completed';
      await client.query('UPDATE departures SET status=$2,updated_at=now() WHERE id=$1', [departure.id, nextStatus]);
      return { ok: true, status: nextStatus, checkedAt: inserted.rows[0].checked_at };
    });
    if (result.error) return sendError(reply, result.error[0], result.error[1]);
    return result;
  });

  app.get('/captain/departures/:id/manifest.csv', { preHandler: [requireUser, requireCaptain] }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '班次编号无效');
    const format = request.query?.format === 'full' ? 'full' : 'masked';
    try {
      const exported = await withTransaction(pool, async (client) => {
        const departure = await requireCaptainOwnership(client, request.params.id, request.user.id, true);
        if (!departure) return { error: [404, '班次不存在'] };
        if (!['confirmed', 'captain_confirmed', 'in_progress', 'completed'].includes(departure.status)) {
          return { error: [409, '班次确认后才能导出名单'] };
        }
        const passengers = await client.query(
          "SELECT op.full_name_ciphertext,op.identity_number_ciphertext " +
          "FROM booking_orders o JOIN order_passengers op ON op.order_id=o.id " +
          "WHERE o.departure_id=$1 AND o.status='paid' " +
          'ORDER BY o.created_at,op.id',
          [departure.id],
        );
        const rows = passengers.rows.map((row) => {
          const fullName = security.decrypt(row.full_name_ciphertext);
          const identity = security.decrypt(row.identity_number_ciphertext);
          return format === 'full'
            ? { name: fullName, identity }
            : { name: maskName(fullName), identity: maskIdentity(identity) };
        });
        await client.query(
          'INSERT INTO manifest_export_audit (departure_id,captain_user_id,format,row_count) VALUES ($1,$2,$3,$4)',
          [departure.id, request.user.id, format, rows.length],
        );
        return rows;
      });
      if (exported.error) return sendError(reply, exported.error[0], exported.error[1]);
      const csv = ['乘船人,身份证号', ...exported.map((row) => csvCell(row.name) + ',' + csvCell(row.identity))].join('\r\n');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="manifest-' + format + '-' + request.params.id + '.csv"');
      reply.header('cache-control', 'no-store');
      return reply.send('\uFEFF' + csv);
    } catch (error) {
      request.log.error({ err: error }, 'Captain manifest export failed');
      return sendError(reply, 500, '名单解密失败，未导出');
    }
  });

  app.get('/orders/:id/fulfillment', { preHandler: requireUser }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '订单编号无效');
    const result = await pool.query(
      'SELECT o.id,o.status,d.id AS departure_id,d.status AS departure_status,d.departure_at,d.meeting_at,' +
      'd.marina_code,d.trip_type,c.checklist,' +
      "CASE WHEN d.status='handling_shortfall' AND s.outcome='shortfall' " +
      'THEN GREATEST(s.threshold_fen-s.platform_verifiable_fen,0) ELSE NULL END AS formation_shortfall_fen,' +
      `CASE WHEN d.status IN ('open','forming') AND ${confirmationAtSql('d')} > now() THEN
        COALESCE(formation_tickets.ticket_net_fen,0)
          + COALESCE(formation_adjustments.penalty_pool_fen,0)
          + COALESCE(formation_adjustments.successful_supplement_fen,0)
          >= d.minimum_sailing_total_fen
        ELSE NULL END AS pre_confirmation_meets_threshold ` +
      'FROM booking_orders o JOIN departures d ON d.id=o.departure_id ' +
      'LEFT JOIN departure_formation_snapshots s ON s.departure_id=d.id ' +
      'LEFT JOIN departure_pretrip_checklists c ON c.departure_id=d.id ' +
      `LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(ROUND((paid.seat_fee_fen-paid.discount_fen)::numeric * 0.9)),0)::bigint AS ticket_net_fen
        FROM booking_orders paid WHERE paid.departure_id=d.id AND paid.status='paid'
      ) formation_tickets ON TRUE ` +
      `LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(a.amount_fen) FILTER (WHERE a.adjustment_type='penalty_pool'),0)::bigint AS penalty_pool_fen,
          COALESCE(SUM(a.amount_fen) FILTER (WHERE a.adjustment_type='successful_supplement'),0)::bigint AS successful_supplement_fen
        FROM departure_formation_adjustments a WHERE a.departure_id=d.id
      ) formation_adjustments ON TRUE ` +
      'WHERE o.id=$1 AND o.buyer_user_id=$2',
      [request.params.id, request.user.id],
    );
    if (!result.rowCount) return sendError(reply, 404, '订单不存在');
    const row = result.rows[0];
    return {
      orderStatus: row.status,
      departure: {
        id: row.departure_id,
        status: row.departure_status,
        departureAt: row.departure_at,
        meetingAt: row.meeting_at,
        marinaCode: row.marina_code,
        tripType: row.trip_type,
        formationShortfallFen: row.formation_shortfall_fen === null
          ? null : Number(row.formation_shortfall_fen),
        preConfirmationMeetsThreshold: row.pre_confirmation_meets_threshold,
        platformGuarantee: row.departure_status === 'captain_confirmed' ? false : null,
      },
      checklist: row.checklist,
    };
  });

  app.get('/orders/:id/checklist', { preHandler: requireUser }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '订单编号无效');
    const result = await pool.query(
      'SELECT c.checklist,c.generated_at FROM booking_orders o ' +
      'JOIN departure_pretrip_checklists c ON c.departure_id=o.departure_id ' +
      "WHERE o.id=$1 AND o.buyer_user_id=$2 AND o.status='paid'",
      [request.params.id, request.user.id],
    );
    if (!result.rowCount) return sendError(reply, 404, '行前清单尚未生成');
    return { checklist: result.rows[0].checklist, generatedAt: result.rows[0].generated_at };
  });

  if (config.nodeEnv !== 'test') {
    const interval = setInterval(() => {
      processConfirmedChecklists(pool, (error) => {
        app.log.error({ err: error }, 'Step 4 checklist pass failed');
      }).catch((error) => app.log.error({ err: error }, 'Step 4 checklist worker failed'));
      processFormationChecks(pool, new Date(), (error) => {
        app.log.error({ err: error }, 'Step 4 formation check failed');
      }, { redis, clockNow }).catch((error) => app.log.error({ err: error }, 'Step 4 formation worker failed'));
    }, 60_000);
    interval.unref?.();
    app.addHook('onClose', async () => clearInterval(interval));
  }
}
