import { randomUUID } from 'node:crypto';
import { createSecurity, verifyChineseIdentityNumber } from './security.js';
import { createSandboxInsuranceAdapter, createSandboxPaymentAdapter } from './step3-adapters.js';

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

async function expireHolds(pool, redis, departureId = null) {
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
        `SELECT order_id FROM seat_holds
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
      expired.push({ id: row.id, seatIds: await releaseHoldInTransaction(client, row.id, 'expired') });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  for (const hold of expired) await deleteHoldKeys(redis, hold.id, hold.seatIds).catch(() => {});
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
  const [seatResult, passengerResult] = await Promise.all([
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
  ]);
  const passengers = passengerResult.rows.map((passenger) => ({
    seatNumber: passenger.seat_number === null ? null : Number(passenger.seat_number),
    name: maskName(security.decrypt(passenger.full_name_ciphertext)),
    identityNumber: maskIdentity(security.decrypt(passenger.identity_number_ciphertext)),
    phone: maskPhone(security.decrypt(passenger.phone_ciphertext)),
  }));
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
      status: row.insurance_status ?? 'not_started',
      checkoutUrl: row.checkout_url,
      policyReference: row.provider_policy_reference,
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

async function handlePaymentEvent({ pool, redis, adapter, event, signature, log }) {
  if (!adapter.verifyCallback(event, signature)) return { statusCode: 401, body: { error: '支付回调签名无效' } };
  if (!validUuid(event.eventId) || !validUuid(event.orderId)
      || typeof event.transactionReference !== 'string'
      || !Number.isSafeInteger(event.amountFen) || !ALLOWED_OUTCOMES.has(event.outcome)
      || Number.isNaN(Date.parse(event.createdAt))) {
    return { statusCode: 400, body: { error: '支付回调字段无效' } };
  }
  const client = await pool.connect();
  let releasedHold = null;
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
      'SELECT order_id FROM payment_transactions WHERE provider_reference=$1',
      [event.transactionReference],
    );
    if (!paymentReference.rowCount) {
      await client.query('ROLLBACK');
      return { statusCode: 404, body: { error: '支付记录不存在' } };
    }
    if (paymentReference.rows[0].order_id !== event.orderId) {
      await client.query('ROLLBACK');
      return { statusCode: 400, body: { error: '支付订单或金额不匹配' } };
    }
    await lockOrderTransaction(client, event.orderId);
    const paymentResult = await client.query(
      `SELECT id,order_id,amount_fen,status FROM payment_transactions
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
    if (payment.status !== 'pending') {
      await client.query('COMMIT');
      return { statusCode: 200, body: { duplicate: true, paymentStatus: payment.status } };
    }
    const orderResult = await client.query(
      `SELECT id,status,hold_id,total_amount_fen FROM booking_orders WHERE id=$1 FOR UPDATE`,
      [event.orderId],
    );
    if (!orderResult.rowCount || orderResult.rows[0].status !== 'pending_payment'
        || Number(orderResult.rows[0].total_amount_fen) !== event.amountFen) {
      await client.query('ROLLBACK');
      return { statusCode: 409, body: { error: '订单已结束或金额已变更' } };
    }
    const order = orderResult.rows[0];
    const holdResult = await client.query(
      `SELECT id,status,expires_at FROM seat_holds WHERE id=$1 FOR UPDATE`,
      [order.hold_id],
    );
    if (!holdResult.rowCount || holdResult.rows[0].status !== 'active'
        || new Date(holdResult.rows[0].expires_at) <= new Date()) {
      await client.query('ROLLBACK');
      return { statusCode: 409, body: { error: '座位锁定已失效，订单无法支付' } };
    }
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
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    log.error({ err: error }, 'Step 3 payment callback failed');
    return { statusCode: 500, body: { error: '支付状态处理失败' } };
  } finally {
    client.release();
  }
  if (releasedHold) await deleteHoldKeys(redis, releasedHold.id, releasedHold.seatIds).catch(() => {});
  return { statusCode: 200, body: { paymentStatus: event.outcome === 'success' ? 'succeeded' : event.outcome === 'timeout' ? 'timed_out' : 'failed' } };
}

export function registerStep3Routes(app, { pool, redis, config, requireUser }) {
  const security = createSecurity(config);
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
  const reaper = setInterval(() => {
    if (pool) expireHolds(pool, redis).catch((error) => app.log.warn({ err: error }, 'Seat hold reaper failed'));
  }, 15000);
  reaper.unref();
  app.addHook('onClose', async () => clearInterval(reaper));

  app.get('/departures/:id/seats', { preHandler: [requireUser, requireRedis] }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '活动编号无效');
    try {
      await expireHolds(pool, redis, request.params.id);
      const departure = await pool.query(
        `SELECT id FROM departures WHERE id=$1 AND status='open' AND departure_at>now()
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
      return {
        expiresInSeconds: 600,
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
      const departure = await client.query(
        `SELECT id FROM departures WHERE id=$1 AND status='open' AND departure_at>now()
           AND booking_deadline>now() AND ${formationCutoffOpenSql} FOR UPDATE`,
        [request.params.id],
      );
      if (!departure.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, '活动不存在或已截止报名');
      }
      const seats = await client.query(
        `SELECT id,seat_number,price_fen,is_premium,status,hold_id
         FROM seat_inventory WHERE departure_id=$1 AND sale_channel='platform' AND id=ANY($2::uuid[])
         ORDER BY seat_number FOR UPDATE`,
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
      lockedSeatIds = seats.rows.map((seat) => seat.id);
      holdId = randomUUID();
      const hold = await client.query(
        `INSERT INTO seat_holds (id,departure_id,user_id,expires_at)
         VALUES ($1,$2,$3,now()+interval '10 minutes') RETURNING expires_at`,
        [holdId, request.params.id, request.user.id],
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
        arguments: [holdId, String(HOLD_MS)],
      });
      if (Number(result) !== 1) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '所选座位正在被其他钓友锁定，请刷新座位图');
      }
      redisSet = true;
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
        `SELECT id,departure_id,status,expires_at,order_id FROM seat_holds
         WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [holdId, request.user.id],
      );
      if (!holdResult.rowCount || holdResult.rows[0].status !== 'active'
          || new Date(holdResult.rows[0].expires_at) <= new Date()) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '选位锁定已失效，请重新选择座位');
      }
      const hold = holdResult.rows[0];
      if (hold.order_id) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '该座位锁定已用于创建订单');
      }
      const departure = await client.query(
        `SELECT id FROM departures
         WHERE id=$1 AND status='open' AND departure_at>now() AND booking_deadline>now()
           AND ${formationCutoffOpenSql}
         FOR UPDATE`,
        [hold.departure_id],
      );
      if (!departure.rowCount) {
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
           discount_fen,platform_fee_fen,total_amount_fen,hold_expires_at,hold_id,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,'pending_payment',$6,0,0,$6,$7,$8,$9)
         RETURNING id`,
        [orderId, orderNumber, hold.departure_id, seatIds[0], request.user.id,
          seatFeeFen, hold.expires_at, holdId, idempotencyKey],
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
        `INSERT INTO insurance_policies (order_id,provider_code,status)
         VALUES ($1,'sandbox','not_started')`,
        [orderId],
      );
      await client.query('UPDATE seat_holds SET order_id=$2 WHERE id=$1', [holdId, orderId]);
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
        signature: signed.signature, log: request.log,
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
        signature: String(request.headers['x-sandbox-signature'] ?? ''), log: request.log,
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
      return { adapter: 'sandbox', checkoutUrl: url, status: 'checkout_started', premiumCollectedByPlatform: false };
    } catch (error) {
      request.log.warn({ err: error }, 'Sandbox insurance adapter is not configured');
      return sendError(reply, error.statusCode ?? 503, error.message);
    }
  });

  app.get('/orders/:id/insurance/status', { preHandler: requireUser }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '订单编号无效');
    const result = await pool.query(
      `SELECT ip.status,ip.provider_code,ip.provider_policy_reference,ip.issued_at
       FROM insurance_policies ip JOIN booking_orders o ON o.id=ip.order_id
       WHERE o.id=$1 AND o.buyer_user_id=$2`,
      [request.params.id, request.user.id],
    );
    if (!result.rowCount) return sendError(reply, 404, '订单投保记录不存在');
    return { insurance: {
      status: result.rows[0].status, adapter: result.rows[0].provider_code,
      policyReference: result.rows[0].provider_policy_reference,
      issuedAt: result.rows[0].issued_at, premiumCollectedByPlatform: false,
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
    return { insurance: {
      status: result.rows[0].status, policyReference: result.rows[0].provider_policy_reference,
      issuedAt: result.rows[0].issued_at, premiumCollectedByPlatform: false,
    } };
  });
}
