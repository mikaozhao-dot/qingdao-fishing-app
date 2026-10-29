export class MemberCouponError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'MemberCouponError';
    this.statusCode = statusCode;
  }
}

function couponEventValues({ couponKind, couponId, redemptionId = null, userId, orderId = null,
  eventType, eventKey, details = {} }) {
  return [couponKind, couponKind === 'member' ? couponId : null,
    couponKind === 'f' ? couponId : null, redemptionId, userId, orderId,
    eventType, eventKey, JSON.stringify(details)];
}

async function logCouponEvent(client, values) {
  await client.query(
    `INSERT INTO coupon_ledger_events
       (coupon_kind,member_coupon_id,f_coupon_id,redemption_id,user_id,order_id,event_type,event_key,details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (event_key) DO NOTHING`, values,
  );
}

export async function issueWelcomeMemberCoupon(client, userId) {
  const result = await client.query(
    `INSERT INTO member_coupons (user_id,coupon_type,milestone,amount_fen,issued_at,expires_at)
     SELECT id,'first_order',0,1500,now(),now()+interval '1 year'
     FROM users WHERE id=$1 AND identity_status='verified' AND identity_verified_at IS NOT NULL
     ON CONFLICT (user_id,coupon_type,milestone) DO NOTHING
     RETURNING *`, [userId],
  );
  if (result.rowCount) {
    const row = result.rows[0];
    await logCouponEvent(client, couponEventValues({ couponKind: 'member', couponId: row.id,
      userId, eventType: 'issued', eventKey: `member-coupon-issued:${row.id}`,
      details: { couponType: 'first_order', amountFen: 1500 } }));
    return row;
  }
  const existing = await client.query(
    `SELECT * FROM member_coupons WHERE user_id=$1 AND coupon_type='first_order' AND milestone=0`,
    [userId],
  );
  return existing.rows[0] ?? null;
}

async function backfillBuyerSeats(client, userId, security) {
  if (!security) return;
  const user = await client.query(
    `SELECT identity_status,identity_number_hash FROM users WHERE id=$1`, [userId],
  );
  if (!user.rowCount || user.rows[0].identity_status !== 'verified' || !user.rows[0].identity_number_hash) return;
  const identityHash = Buffer.from(user.rows[0].identity_number_hash);
  const passengers = await client.query(
    `SELECT o.id,op.seat_inventory_id,op.identity_number_ciphertext
     FROM booking_orders o JOIN order_passengers op ON op.order_id=o.id
     WHERE o.buyer_user_id=$1 AND o.buyer_seat_inventory_id IS NULL
       AND op.seat_inventory_id IS NOT NULL ORDER BY o.created_at,o.id,op.id`, [userId],
  );
  for (const passenger of passengers.rows) {
    let passengerIdentity;
    try {
      passengerIdentity = security.decrypt(passenger.identity_number_ciphertext);
    } catch {
      continue;
    }
    if (security.identityHash(passengerIdentity).equals(identityHash)) {
      await client.query(
        `UPDATE booking_orders SET buyer_seat_inventory_id=$2
         WHERE id=$1 AND buyer_seat_inventory_id IS NULL`, [passenger.id, passenger.seat_inventory_id],
      );
    }
  }
}

function buyerSeatPrincipalAfterDiscount(seats, discountFen, buyerSeatId) {
  const totalPrice = seats.reduce((sum, seat) => sum + Number(seat.price_fen), 0);
  const discount = Number(discountFen ?? 0);
  if (!Number.isSafeInteger(totalPrice) || !Number.isSafeInteger(discount)
      || totalPrice < 0 || discount < 0 || discount > totalPrice) {
    throw new MemberCouponError(409, '订单船费折扣金额无效');
  }
  const totalPriceBigInt = BigInt(totalPrice);
  const discountBigInt = BigInt(discount);
  const allocations = seats.map((seat) => {
    const numerator = discountBigInt * BigInt(Number(seat.price_fen));
    return {
      seat,
      discountFen: totalPrice === 0 ? 0 : Number(numerator / totalPriceBigInt),
      remainder: totalPrice === 0 ? 0n : numerator % totalPriceBigInt,
    };
  });
  let remainder = discount - allocations.reduce((sum, allocation) => sum + allocation.discountFen, 0);
  for (const allocation of [...allocations].sort((left, right) =>
    Number(right.remainder - left.remainder)
      || Number(left.seat.seat_number) - Number(right.seat.seat_number))) {
    if (!remainder) break;
    allocation.discountFen += 1;
    remainder -= 1;
  }
  const buyerAllocation = allocations.find((allocation) => allocation.seat.seat_inventory_id === buyerSeatId);
  if (!buyerAllocation) throw new MemberCouponError(409, '本人乘坐座位不属于当前订单');
  return Number(buyerAllocation.seat.price_fen) - buyerAllocation.discountFen;
}

export async function syncMemberRewardsForUser(client, userId, security = null) {
  await backfillBuyerSeats(client, userId, security);
  const countResult = await client.query(
    `SELECT count(DISTINCT o.id)::integer AS valid_order_count
     FROM booking_orders o
     JOIN departures d ON d.id=o.departure_id AND d.status='completed'
     JOIN departure_checkins dc ON dc.departure_id=d.id AND dc.event='returned'
     JOIN order_passengers op ON op.order_id=o.id
       AND op.seat_inventory_id=o.buyer_seat_inventory_id AND op.booking_status='active'
     WHERE o.buyer_user_id=$1 AND o.buyer_seat_inventory_id IS NOT NULL
       AND o.status NOT IN ('cancelled','refunded')
       AND NOT EXISTS (
         SELECT 1 FROM member_reward_facts f
         WHERE f.order_id=o.id AND f.fact_type='completed_order_full_ticket_refund'
       )`, [userId],
  );
  const validOrderCount = Number(countResult.rows[0]?.valid_order_count ?? 0);
  const existing = await client.query(
    `SELECT lifetime_stars FROM member_reward_accounts WHERE user_id=$1 FOR UPDATE`, [userId],
  );
  const previousStars = Number(existing.rows[0]?.lifetime_stars ?? 0);
  const earnedStars = Math.floor(validOrderCount / 10);
  const lifetimeStars = Math.max(previousStars, earnedStars);
  await client.query(
    `INSERT INTO member_reward_accounts (user_id,valid_order_count,lifetime_stars,updated_at)
     VALUES ($1,$2,$3,now())
     ON CONFLICT (user_id) DO UPDATE SET valid_order_count=EXCLUDED.valid_order_count,
       lifetime_stars=GREATEST(member_reward_accounts.lifetime_stars,EXCLUDED.lifetime_stars),updated_at=now()`,
    [userId, validOrderCount, lifetimeStars],
  );
  for (let milestone = 1; milestone <= lifetimeStars; milestone += 1) {
    const issued = await client.query(
      `INSERT INTO member_coupons (user_id,coupon_type,milestone,amount_fen,issued_at,expires_at)
       VALUES ($1,'upgrade',$2,2000,now(),now()+interval '1 year')
       ON CONFLICT (user_id,coupon_type,milestone) DO NOTHING RETURNING id`, [userId, milestone],
    );
    if (issued.rowCount) {
      await logCouponEvent(client, couponEventValues({ couponKind: 'member',
        couponId: issued.rows[0].id, userId, eventType: 'issued',
        eventKey: `member-coupon-issued:${issued.rows[0].id}`,
        details: { couponType: 'upgrade', milestone, amountFen: 2000 } }));
    }
  }
  return { validOrderCount, lifetimeStars };
}

export async function syncMemberRewardsForDeparture(client, departureId, security = null) {
  const users = await client.query(
    `SELECT DISTINCT o.buyer_user_id
     FROM booking_orders o
     WHERE o.departure_id=$1 AND EXISTS (
       SELECT 1 FROM order_passengers op WHERE op.order_id=o.id AND op.booking_status='active'
     )`, [departureId],
  );
  for (const row of users.rows) await syncMemberRewardsForUser(client, row.buyer_user_id, security);
}

export async function reserveOrderCoupon(client, { couponKind, couponId, userId, orderId,
  seatInventoryId }) {
  if (!['member', 'f'].includes(couponKind)) throw new MemberCouponError(400, '优惠券类型无效');
  const order = await client.query(
    `SELECT o.id,o.discount_fen,bos.seat_inventory_id,bos.seat_number,bos.price_fen
     FROM booking_orders o JOIN booking_order_seats bos ON bos.order_id=o.id
     WHERE o.id=$1 AND o.buyer_user_id=$2 AND o.status='pending_payment'
       AND o.buyer_seat_inventory_id=$3
       AND EXISTS (SELECT 1 FROM booking_order_seats buyer_seat
         WHERE buyer_seat.order_id=o.id AND buyer_seat.seat_inventory_id=$3)
     ORDER BY bos.seat_number FOR UPDATE OF o`, [orderId, userId, seatInventoryId],
  );
  if (!order.rowCount) throw new MemberCouponError(409, '优惠券只能用于本人乘坐且待支付的订单');
  const seatPriceFen = buyerSeatPrincipalAfterDiscount(order.rows,
    order.rows[0].discount_fen, seatInventoryId);
  const coupon = couponKind === 'member'
    ? await client.query(
      `SELECT id,user_id AS beneficiary_user_id,coupon_type,milestone,amount_fen,expires_at
       FROM member_coupons WHERE id=$1 AND user_id=$2 FOR UPDATE`, [couponId, userId],
    )
    : await client.query(
      `SELECT id,beneficiary_user_id,amount_fen,expires_at
       FROM f_compensation_coupon_ledger WHERE id=$1 AND beneficiary_user_id=$2 FOR UPDATE`,
      [couponId, userId],
    );
  if (!coupon.rowCount) throw new MemberCouponError(404, '该优惠券不存在或不属于当前账号');
  const row = coupon.rows[0];
  if (new Date(row.expires_at) <= new Date()) throw new MemberCouponError(409, '该优惠券已过期');
  if (Number(row.amount_fen) > Number(seatPriceFen)) {
    throw new MemberCouponError(409, '本人座位船费不足以使用这张优惠券');
  }
  if (couponKind === 'member' && row.coupon_type === 'first_order') {
    const priorOrder = await client.query(
      `SELECT 1 FROM booking_orders o
       WHERE o.buyer_user_id=$1 AND o.paid_at IS NOT NULL AND o.id<>$2
         AND o.buyer_seat_inventory_id IS NOT NULL
         AND o.status IN ('paid','completed','cancelled','refunded')
         AND (o.ticket_refunded_fen < o.seat_fee_fen-o.discount_fen-o.coupon_discount_fen
           OR (o.seat_fee_fen-o.discount_fen-o.coupon_discount_fen=0
             AND o.status IN ('paid','completed')))
       LIMIT 1`, [userId, orderId],
    );
    if (priorOrder.rowCount) throw new MemberCouponError(409, '首单券仅限本人首个有效订单使用');
  }
  const redemption = await client.query(
    `INSERT INTO order_coupon_redemptions
       (order_id,user_id,seat_inventory_id,coupon_kind,member_coupon_id,f_coupon_id,amount_fen,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved') RETURNING id`,
    [orderId, userId, seatInventoryId, couponKind,
      couponKind === 'member' ? row.id : null, couponKind === 'f' ? row.id : null, row.amount_fen],
  );
  await logCouponEvent(client, couponEventValues({ couponKind, couponId: row.id,
    redemptionId: redemption.rows[0].id, userId, orderId, eventType: 'reserved',
    eventKey: `coupon-reserved:${redemption.rows[0].id}`,
    details: { amountFen: Number(row.amount_fen), seatInventoryId } }));
  return { id: redemption.rows[0].id, amountFen: Number(row.amount_fen), couponKind, couponId: row.id };
}

export async function redeemReservedCouponForOrder(client, orderId) {
  const result = await client.query(
    `UPDATE order_coupon_redemptions SET status='redeemed',updated_at=now()
     WHERE order_id=$1 AND status='reserved'
     RETURNING id,user_id,coupon_kind,member_coupon_id,f_coupon_id,amount_fen`, [orderId],
  );
  for (const row of result.rows) {
    await logCouponEvent(client, couponEventValues({ couponKind: row.coupon_kind,
      couponId: row.member_coupon_id ?? row.f_coupon_id, redemptionId: row.id,
      userId: row.user_id, orderId, eventType: 'redeemed',
      eventKey: `coupon-redeemed:${row.id}`, details: { amountFen: Number(row.amount_fen) } }));
  }
}

export async function releaseReservedCouponsForOrders(client, orderIds, reason) {
  if (!orderIds?.length) return;
  const result = await client.query(
    `UPDATE order_coupon_redemptions SET status='released',updated_at=now()
     WHERE order_id=ANY($1::uuid[]) AND status='reserved'
     RETURNING id,order_id,user_id,coupon_kind,member_coupon_id,f_coupon_id,amount_fen`, [orderIds],
  );
  for (const row of result.rows) {
    await logCouponEvent(client, couponEventValues({ couponKind: row.coupon_kind,
      couponId: row.member_coupon_id ?? row.f_coupon_id, redemptionId: row.id,
      userId: row.user_id, orderId: row.order_id, eventType: 'released',
      eventKey: `coupon-released:${row.id}`, details: { reason, amountFen: Number(row.amount_fen) } }));
  }
}

export async function reconcileCouponAfterRefund(client, orderId, security = null) {
  const orderResult = await client.query(
    `SELECT o.id,o.buyer_user_id,o.status,o.seat_fee_fen,o.discount_fen,o.coupon_discount_fen,
            o.ticket_refunded_fen,d.status AS departure_status,
            EXISTS (SELECT 1 FROM departure_checkins dc
              WHERE dc.departure_id=d.id AND dc.event='returned') AS has_returned
     FROM booking_orders o JOIN departures d ON d.id=o.departure_id WHERE o.id=$1 FOR UPDATE OF o`,
    [orderId],
  );
  if (!orderResult.rowCount) return { restored: false, fullRefund: false };
  const order = orderResult.rows[0];
  const ticketPrincipalFen = Number(order.seat_fee_fen) - Number(order.discount_fen)
    - Number(order.coupon_discount_fen ?? 0);
  const fullRefund = Number(order.ticket_refunded_fen) >= ticketPrincipalFen;
  if (!fullRefund) return { restored: false, fullRefund: false };
  const completed = order.departure_status === 'completed' || order.has_returned;
  if (completed) {
    await client.query(
      `INSERT INTO member_reward_facts (user_id,order_id,fact_type,fact_key,details)
       VALUES ($1,$2,'completed_order_full_ticket_refund',$3,$4::jsonb)
       ON CONFLICT (fact_key) DO NOTHING`,
      [order.buyer_user_id, order.id, `completed-full-refund:${order.id}`,
        JSON.stringify({ ticketPrincipalFen, ticketRefundedFen: Number(order.ticket_refunded_fen) })],
    );
    await syncMemberRewardsForUser(client, order.buyer_user_id, security);
    return { restored: false, fullRefund: true, completed: true };
  }
  if (order.status !== 'cancelled') return { restored: false, fullRefund: true };
  const unsettled = await client.query(
    `SELECT 1 FROM refund_obligations WHERE order_id=$1 AND reason<>'supplement_failure'
       AND status<>'sandbox_succeeded' LIMIT 1`, [orderId],
  );
  if (unsettled.rowCount) return { restored: false, fullRefund: true };
  const restored = await client.query(
    `UPDATE order_coupon_redemptions SET status='restored',updated_at=now()
     WHERE order_id=$1 AND status='redeemed'
     RETURNING id,user_id,coupon_kind,member_coupon_id,f_coupon_id,amount_fen`, [orderId],
  );
  for (const row of restored.rows) {
    await logCouponEvent(client, couponEventValues({ couponKind: row.coupon_kind,
      couponId: row.member_coupon_id ?? row.f_coupon_id, redemptionId: row.id,
      userId: row.user_id, orderId, eventType: 'restored',
      eventKey: `coupon-restored:${row.id}`, details: { amountFen: Number(row.amount_fen) } }));
  }
  return { restored: restored.rowCount > 0, fullRefund: true, completed: false };
}

export async function recordCouponReuseConflict(pool, {
  couponKind, couponId, userId, requestKey, orderId = null, constraint = null,
}) {
  if (!['member', 'f'].includes(couponKind) || !couponId || !userId || !requestKey) return;
  await pool.query(
    `INSERT INTO coupon_redemption_attempt_facts
       (user_id,coupon_kind,member_coupon_id,f_coupon_id,fact_type,request_key,details)
     VALUES ($1,$2,$3,$4,'active_coupon_reuse_conflict',$5,$6::jsonb)
     ON CONFLICT (request_key) DO NOTHING`,
    [userId, couponKind, couponKind === 'member' ? couponId : null,
      couponKind === 'f' ? couponId : null, requestKey,
      JSON.stringify({ orderId, constraint, result: 'rejected_by_active_redemption_unique_constraint' })],
  );
}
