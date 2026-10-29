import {
  cancellationAmounts,
  closeoutAtSql,
  confirmationAtSql,
  dispatchWaitlistCandidates,
  validWaitlistRequestKey,
  validWaitlistUuid,
} from './step3-waitlist.js';
import { configuredStep3Clock, readStep3Clock } from './step3-clock.js';
import { syncPromotionForUser } from './promotion-service.js';

const HOLD_KEY_PREFIX = 'fishing:step3:seat:';
const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });

async function loadWaitlistEntry(pool, entryId, userId) {
  const result = await pool.query(
    `SELECT w.id,w.departure_id,w.status,w.queued_at,w.authorized_at,
            w.authorization_expires_at,w.accepted_at,w.hold_id,w.order_id,
            w.seat_inventory_id,s.seat_number,s.price_fen,s.is_premium,
            GREATEST(0,EXTRACT(EPOCH FROM (w.authorization_expires_at-now()))::integer) AS seconds_remaining
     FROM departure_waitlist_entries w
     LEFT JOIN seat_inventory s ON s.id=w.seat_inventory_id
     WHERE w.id=$1 AND w.user_id=$2`,
    [entryId, userId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    departureId: row.departure_id,
    status: row.status,
    queuedAt: row.queued_at,
    authorizedAt: row.authorized_at,
    authorizationExpiresAt: row.authorization_expires_at,
    acceptedAt: row.accepted_at,
    holdId: row.hold_id,
    orderId: row.order_id,
    seatNumber: row.seat_number === null ? null : Number(row.seat_number),
    seatId: row.seat_inventory_id ?? null,
    priceFen: row.price_fen === null ? null : Number(row.price_fen),
    isPremium: row.is_premium ?? null,
    secondsRemaining: Number(row.seconds_remaining ?? 0),
    message: row.status === 'authorized' && Number(row.seconds_remaining) < 600
      ? '本次候补授权将在显示的时间到期，窗口结束后不会自动延长。'
      : null,
  };
}

export function registerStep3WaitlistRoutes(app, { pool, redis, config, requireUser }) {
  const clockNow = configuredStep3Clock(config);
  app.post('/departures/:id/waitlist', { preHandler: requireUser }, async (request, reply) => {
    if (!validWaitlistUuid(request.params.id)) return sendError(reply, 400, '活动编号无效');
    if (request.user.identity_status !== 'verified') return sendError(reply, 403, '请先完成实名核验后加入候补');
    const requestKey = String(request.body?.requestKey ?? '').trim();
    if (!validWaitlistRequestKey(requestKey)) return sendError(reply, 400, '候补请求编号无效');
    try {
      const client = await pool.connect();
      let entryId;
      try {
        await client.query('BEGIN');
        const lockedDeparture = await client.query(
          'SELECT id FROM departures WHERE id=$1 FOR UPDATE',
          [request.params.id],
        );
        if (!lockedDeparture.rowCount) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '候补登记已截止');
        }
        const departure = await client.query(
          `SELECT d.status,d.departure_at,d.booking_deadline,d.waitlist_window_closed_at,
                  ${confirmationAtSql('d')} AS confirmation_at
           FROM departures d WHERE d.id=$1`, [request.params.id],
        );
        const now = await readStep3Clock(client, clockNow);
        const row = departure.rows[0];
        if (row.status !== 'open' || new Date(row.departure_at) <= now
            || new Date(row.booking_deadline) <= now || row.waitlist_window_closed_at
            || new Date(row.confirmation_at) <= now) {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '候补登记已截止');
        }
        const inserted = await client.query(
          `INSERT INTO departure_waitlist_entries (departure_id,user_id,request_key)
           VALUES ($1,$2,$3)
           ON CONFLICT (departure_id,user_id,request_key) DO UPDATE SET request_key=EXCLUDED.request_key
           RETURNING id,status`,
          [request.params.id, request.user.id, requestKey],
        );
        entryId = inserted.rows[0].id;
        if (inserted.rows[0].status !== 'waiting' && inserted.rows[0].status !== 'authorized') {
          await client.query('ROLLBACK');
          return sendError(reply, 409, '该候补记录已结束，请重新查看活动');
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') return sendError(reply, 409, '你已在该班次候补队列中');
        throw error;
      } finally {
        client.release();
      }
      await dispatchWaitlistCandidates(pool, redis, request.params.id, new Date(), clockNow);
      return reply.code(201).send({ entry: await loadWaitlistEntry(pool, entryId, request.user.id) });
    } catch (error) {
      request.log.error({ err: error }, 'Waitlist registration failed');
      return sendError(reply, 503, '候补登记暂不可用');
    }
  });

  app.get('/departures/:id/waitlist', { preHandler: requireUser }, async (request, reply) => {
    if (!validWaitlistUuid(request.params.id)) return sendError(reply, 400, '活动编号无效');
    const result = await pool.query(
      `SELECT id FROM departure_waitlist_entries
       WHERE departure_id=$1 AND user_id=$2 ORDER BY queued_at DESC,id DESC LIMIT 1`,
      [request.params.id, request.user.id],
    );
    if (!result.rowCount) return { entry: null };
    return { entry: await loadWaitlistEntry(pool, result.rows[0].id, request.user.id) };
  });

  app.get('/waitlist/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!validWaitlistUuid(request.params.id)) return sendError(reply, 400, '候补编号无效');
    const entry = await loadWaitlistEntry(pool, request.params.id, request.user.id);
    if (!entry) return sendError(reply, 404, '候补记录不存在');
    return { entry };
  });

  app.post('/waitlist/:id/accept', { preHandler: requireUser }, async (request, reply) => {
    if (!validWaitlistUuid(request.params.id)) return sendError(reply, 400, '候补编号无效');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lookup = await client.query(
        'SELECT departure_id FROM departure_waitlist_entries WHERE id=$1 AND user_id=$2',
        [request.params.id, request.user.id],
      );
      if (!lookup.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '候补记录不存在');
      }
      const departureLock = await client.query(
        'SELECT id FROM departures WHERE id=$1 FOR UPDATE', [lookup.rows[0].departure_id],
      );
      if (!departureLock.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '候补授权已失效或已到期');
      }
      const rowResult = await client.query(
        `SELECT w.status,w.accepted_at,w.hold_id,h.status AS hold_status,h.expires_at,
                d.waitlist_window_closed_at,${closeoutAtSql('d')} AS closeout_at
         FROM departure_waitlist_entries w
         JOIN departures d ON d.id=w.departure_id
         LEFT JOIN seat_holds h ON h.id=w.hold_id
         WHERE w.id=$1 AND w.user_id=$2`, [request.params.id, request.user.id],
      );
      const now = await readStep3Clock(client, clockNow);
      const row = rowResult.rows[0];
      if (!row || row.status !== 'authorized' || row.hold_status !== 'active'
          || new Date(row.expires_at) <= now || row.waitlist_window_closed_at
          || new Date(row.closeout_at) <= now) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '候补授权已失效或已到期');
      }
      await client.query(
        `UPDATE departure_waitlist_entries SET accepted_at=COALESCE(accepted_at,$2),updated_at=now()
         WHERE id=$1`, [request.params.id, now],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Waitlist authorization accept failed');
      return sendError(reply, 503, '候补授权暂不可用');
    } finally {
      client.release();
    }
    return { entry: await loadWaitlistEntry(pool, request.params.id, request.user.id) };
  });

  app.post('/waitlist/:id/withdraw', { preHandler: requireUser }, async (request, reply) => {
    if (!validWaitlistUuid(request.params.id)) return sendError(reply, 400, '候补编号无效');
    const client = await pool.connect();
    let hold = null;
    let departureId = null;
    try {
      await client.query('BEGIN');
      const entryResult = await client.query(
        `SELECT w.id,w.departure_id,w.status,w.hold_id FROM departure_waitlist_entries w
         WHERE w.id=$1 AND w.user_id=$2 FOR UPDATE`,
        [request.params.id, request.user.id],
      );
      if (!entryResult.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '候补记录不存在');
      }
      const entry = entryResult.rows[0];
      departureId = entry.departure_id;
      if (!['waiting','authorized'].includes(entry.status)) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '该候补记录已结束');
      }
      if (entry.hold_id) {
        const seats = await client.query(
          `SELECT seat_inventory_id FROM seat_hold_items WHERE hold_id=$1`, [entry.hold_id],
        );
        hold = { id: entry.hold_id, seatIds: seats.rows.map((row) => row.seat_inventory_id) };
        await client.query(
          `UPDATE seat_inventory SET status='available',hold_id=NULL,hold_expires_at=NULL,updated_at=now()
           WHERE hold_id=$1 AND status='held'`, [entry.hold_id],
        );
        await client.query(
          `UPDATE seat_hold_items SET status='released' WHERE hold_id=$1 AND status='active'`, [entry.hold_id],
        );
        await client.query(
          `UPDATE seat_holds SET status='released',released_at=now() WHERE id=$1 AND status='active'`, [entry.hold_id],
        );
      }
      await client.query(
        `UPDATE departure_waitlist_entries SET status='withdrawn',updated_at=now() WHERE id=$1`, [entry.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Waitlist withdrawal failed');
      return sendError(reply, 500, '退出候补失败');
    } finally {
      client.release();
    }
    if (hold) {
      const script = `for i,key in ipairs(KEYS) do if redis.call('GET',key)==ARGV[1] then redis.call('DEL',key) end end return 1`;
      await redis?.eval(script, { keys: hold.seatIds.map((id) => `${HOLD_KEY_PREFIX}${id}`), arguments: [hold.id] }).catch(() => {});
    }
    await dispatchWaitlistCandidates(pool, redis, departureId, new Date(), clockNow)
      .catch((error) => request.log.warn({ err: error }, 'Waitlist handoff failed'));
    return { withdrawn: true };
  });

  app.post('/orders/:id/cancel', { preHandler: requireUser }, async (request, reply) => {
    if (config.nodeEnv === 'production') return sendError(reply, 404, '沙盒订单取消与退款入口未开放');
    if (!validWaitlistUuid(request.params.id)) return sendError(reply, 400, '订单编号无效');
    const client = await pool.connect();
    let departureId = null;
    let result;
    try {
      const lookup = await client.query(
        `SELECT departure_id FROM booking_orders WHERE id=$1 AND buyer_user_id=$2`,
        [request.params.id, request.user.id],
      );
      if (!lookup.rowCount) return sendError(reply, 404, '订单不存在');
      departureId = lookup.rows[0].departure_id;
      await client.query('BEGIN');
      await client.query('SELECT id FROM departures WHERE id=$1 FOR UPDATE', [departureId]);
      const orderResult = await client.query(
        `SELECT o.id,o.status,o.buyer_user_id,o.seat_fee_fen,o.discount_fen,o.coupon_discount_fen,o.platform_fee_fen,o.total_amount_fen,
                o.ticket_refunded_fen,
                o.cancelled_refund_fen,o.cancellation_penalty_fen,d.departure_at,d.status AS departure_status,
                ${confirmationAtSql('d')} AS confirmation_at
         FROM booking_orders o JOIN departures d ON d.id=o.departure_id
         WHERE o.id=$1 AND o.buyer_user_id=$2 FOR UPDATE OF o,d`,
        [request.params.id, request.user.id],
      );
      if (!orderResult.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '订单不存在');
      }
      const order = orderResult.rows[0];
      if (order.status === 'cancelled') {
        await client.query('COMMIT');
        return {
          cancelled: true, idempotentReplay: true,
          refundFen: Number(order.cancelled_refund_fen ?? 0),
          penaltyFen: Number(order.cancellation_penalty_fen ?? 0),
        };
      }
      const now = await readStep3Clock(client, clockNow);
      if (order.status !== 'paid' || !['open', 'confirmed', 'captain_confirmed'].includes(order.departure_status)
          || new Date(order.departure_at) <= now) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '当前订单不能取消');
      }
      const amounts = cancellationAmounts(
        Number(order.seat_fee_fen) - Number(order.discount_fen)
          - Number(order.coupon_discount_fen ?? 0) - Number(order.ticket_refunded_fen ?? 0),
        order.departure_at,
        now,
      );
      const releaseEligible = new Date(now) < new Date(order.confirmation_at);
      const seats = await client.query(
        `SELECT os.seat_inventory_id FROM booking_order_seats os
         JOIN seat_inventory s ON s.id=os.seat_inventory_id
         WHERE os.order_id=$1 AND os.status='paid' AND s.sale_channel='platform'
         ORDER BY os.seat_number FOR UPDATE OF s`,
        [order.id],
      );
      await client.query(
        `UPDATE booking_orders SET status='cancelled',cancelled_at=$2,updated_at=now(),
          cancelled_refund_fen=COALESCE(cancelled_refund_fen,0)+$3,
          cancellation_penalty_fen=$4,ticket_refunded_fen=ticket_refunded_fen+$5
         WHERE id=$1`,
        [order.id, now, amounts.refundFen + Number(order.platform_fee_fen), amounts.penaltyFen,
          amounts.refundFen],
      );
      await client.query(
        `UPDATE booking_order_seats SET status='released' WHERE order_id=$1 AND status='paid'`, [order.id],
      );
      if (seats.rowCount) {
        await client.query(
          `UPDATE seat_inventory SET status='available',hold_id=NULL,hold_expires_at=NULL,
            waitlist_released_at=CASE WHEN $2 THEN $3::timestamptz ELSE NULL::timestamptz END,updated_at=now()
           WHERE id=ANY($1::uuid[])`,
          [seats.rows.map((row) => row.seat_inventory_id), releaseEligible, now],
        );
      }
      if (amounts.penaltyFen > 0) {
        await client.query(
          `INSERT INTO departure_formation_adjustments (departure_id,adjustment_type,amount_fen,source_reference)
           VALUES ($1,'penalty_pool',$2,$3) ON CONFLICT DO NOTHING`,
          [departureId, amounts.penaltyFen, `customer-cancel:${order.id}`],
        );
      }
      const refundFen = amounts.refundFen + Number(order.platform_fee_fen);
      if (refundFen > 0) {
        await client.query(
          `INSERT INTO refund_obligations
            (order_id,amount_fen,reason,status,attempt_count,request_key,settled_at)
           VALUES ($1,$2,'customer_cancellation','sandbox_succeeded',1,$3,$4)
           ON CONFLICT (request_key) DO NOTHING`,
          [order.id, refundFen, `customer-cancel:${order.id}`, now],
        );
      }
      await syncPromotionForUser(client, order.buyer_user_id);
      await client.query('COMMIT');
      result = {
        cancelled: true,
        refundFen,
        penaltyFen: amounts.penaltyFen,
        refundStatus: refundFen > 0 ? 'sandbox_succeeded' : 'not_required',
        waitlistEligible: releaseEligible,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Customer order cancellation failed');
      return sendError(reply, 500, '取消订单失败');
    } finally {
      client.release();
    }
    result.waitlistAuthorizations = result.waitlistEligible
      ? await dispatchWaitlistCandidates(pool, redis, departureId, new Date(), clockNow)
        .catch((error) => {
          request.log.error({ err: error }, 'Waitlist dispatch after cancellation failed');
          return [];
        })
      : [];
    return result;
  });
}
