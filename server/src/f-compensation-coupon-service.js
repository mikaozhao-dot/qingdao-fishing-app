const MAX_TICKET_PAID_FEN = 2_000_000_000;

export const F_COMPENSATION_SCENARIOS = Object.freeze({
  captain_non_weather_cancel: 'captain_guarantee',
  platform_attributable_failure: 'platform',
});

export class FCompensationCouponError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'FCompensationCouponError';
    this.statusCode = statusCode;
  }
}

export function calculateFCompensationFen(ticketPaidFen) {
  if (!Number.isSafeInteger(ticketPaidFen) || ticketPaidFen < 0
      || ticketPaidFen > MAX_TICKET_PAID_FEN) {
    throw new TypeError('实付船费金额无效');
  }
  return Math.floor((ticketPaidFen * 3 + 50) / 100);
}

function publicCoupon(row, replayed = false) {
  return {
    id: row.id,
    beneficiaryUserId: row.beneficiary_user_id,
    sourceOrderId: row.source_order_id,
    sourceEventKey: row.source_event_key,
    scenario: row.scenario,
    responsibleParty: row.responsible_party,
    ticketPaidFen: Number(row.ticket_paid_fen),
    amountFen: Number(row.amount_fen),
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    issuedBy: row.issued_by,
    replayed,
  };
}

async function recordCouponIssuedEvent(client, coupon) {
  await client.query(
    `INSERT INTO coupon_ledger_events
       (coupon_kind,f_coupon_id,user_id,event_type,event_key,details)
     VALUES ('f',$1,$2,'issued',$3,$4::jsonb)
     ON CONFLICT (event_key) DO NOTHING`,
    [coupon.id, coupon.beneficiary_user_id, `f-coupon-issued:${coupon.id}`,
      JSON.stringify({ scenario: coupon.scenario, responsibleParty: coupon.responsible_party,
        ticketPaidFen: Number(coupon.ticket_paid_fen), amountFen: Number(coupon.amount_fen),
        issuedAt: coupon.issued_at, expiresAt: coupon.expires_at, issuedBy: coupon.issued_by })],
  );
}

export async function issueFCompensationCoupon(client, {
  orderId, sourceEventKey, scenario, issueNote, issuedBy = 'sandbox_admin',
}) {
  const responsibleParty = F_COMPENSATION_SCENARIOS[scenario];
  if (!responsibleParty) {
    throw new FCompensationCouponError(400, 'F 补偿券场景不适用');
  }

  const orderResult = await client.query(
    `SELECT o.id,o.buyer_user_id,o.status,o.paid_at,o.seat_fee_fen,o.discount_fen,o.coupon_discount_fen,
            d.status AS departure_status
       FROM booking_orders o JOIN departures d ON d.id=o.departure_id
      WHERE o.id=$1 FOR UPDATE OF o,d`, [orderId],
  );
  if (!orderResult.rowCount) throw new FCompensationCouponError(404, '订单不存在');
  const order = orderResult.rows[0];
  if (order.departure_status === 'weather_cancelled') {
    throw new FCompensationCouponError(409, '天气停航不发 F 补偿券');
  }
  if (order.status !== 'cancelled' || !order.paid_at) {
    throw new FCompensationCouponError(409, '仅可为已支付且已取消的订单发放');
  }
  if (scenario === 'captain_non_weather_cancel' && order.departure_status !== 'cancelled') {
    throw new FCompensationCouponError(409, '船长原因取消券要求班次已取消');
  }

  const ticketPaidFen = Number(order.seat_fee_fen) - Number(order.discount_fen)
    - Number(order.coupon_discount_fen ?? 0);
  if (!Number.isSafeInteger(ticketPaidFen) || ticketPaidFen <= 0) {
    throw new FCompensationCouponError(409, '订单没有可计入的实付船费');
  }
  const amountFen = calculateFCompensationFen(ticketPaidFen);
  if (amountFen <= 0) throw new FCompensationCouponError(409, '计算出的补偿券面额为零，无法发放');

  const inserted = await client.query(
    `INSERT INTO f_compensation_coupon_ledger
       (source_event_key,source_order_id,beneficiary_user_id,scenario,responsible_party,
        ticket_paid_fen,amount_fen,issued_at,expires_at,issued_by,issue_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now()+interval '1 year',$8,$9)
     ON CONFLICT (source_event_key,source_order_id) DO NOTHING
     RETURNING *`,
    [sourceEventKey, order.id, order.buyer_user_id, scenario, responsibleParty,
      ticketPaidFen, amountFen, issuedBy, issueNote],
  );
  let row;
  let replayed = false;
  if (inserted.rowCount) {
    row = inserted.rows[0];
  } else {
    const existing = await client.query(
      `SELECT * FROM f_compensation_coupon_ledger
        WHERE source_event_key=$1 AND source_order_id=$2`, [sourceEventKey, order.id],
    );
    if (!existing.rowCount) throw new Error('补偿券幂等记录读取失败');
    row = existing.rows[0];
    if (row.scenario !== scenario || row.responsible_party !== responsibleParty
        || Number(row.ticket_paid_fen) !== ticketPaidFen
        || Number(row.amount_fen) !== amountFen
        || row.beneficiary_user_id !== order.buyer_user_id) {
      throw new FCompensationCouponError(409, '该事件已用不同口径登记，不能覆盖原补偿账');
    }
    replayed = true;
  }
  await recordCouponIssuedEvent(client, row);
  return publicCoupon(row, replayed);
}
