const COMMISSION_RATE_BASIS_POINTS = 500;
const COMMISSION_DENOMINATOR = 10_000;

export function calculateNetTicketFen(order) {
  const ticketFen = Math.max(0, Number(order.seat_fee_fen) - Number(order.discount_fen ?? 0));
  const refundedFen = Math.min(ticketFen, Number(order.ticket_refunded_fen ?? 0));
  return ticketFen - refundedFen;
}

export function calculateCommissionFen(netTicketAmountFen) {
  return Math.floor((Number(netTicketAmountFen) * COMMISSION_RATE_BASIS_POINTS)
    / COMMISSION_DENOMINATOR);
}

async function logCommissionEvent(client, ledgerId, eventType, amountFen, details = {}) {
  await client.query(
    `INSERT INTO promotion_commission_events
       (commission_ledger_id,event_type,amount_fen,details)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [ledgerId, eventType, Math.max(0, Number(amountFen) || 0), JSON.stringify(details)],
  );
}

export async function syncPromotionForUser(client, userId) {
  const userResult = await client.query(
    `SELECT id,identity_status,identity_number_hash
     FROM users WHERE id=$1`, [userId],
  );
  if (!userResult.rowCount) return;
  const user = userResult.rows[0];
  const attributionResult = await client.query(
    `SELECT a.id,a.promotion_code_id,a.attributed_at,a.order_id,a.qualification_status,
            c.owner_user_id
     FROM promotion_attributions a
     JOIN promotion_codes c ON c.id=a.promotion_code_id
     WHERE a.attributed_user_id=$1
     FOR UPDATE OF a`,
    [userId],
  );
  if (!attributionResult.rowCount) return;
  const attribution = attributionResult.rows[0];
  if (attribution.owner_user_id === userId) {
    await client.query(
      `UPDATE promotion_attributions
       SET qualification_status='self_referral'
       WHERE id=$1 AND qualification_status<>'self_referral'`,
      [attribution.id],
    );
    return;
  }

  const firstPaidOrderResult = await client.query(
    `SELECT o.id,o.status,o.seat_fee_fen,o.discount_fen,o.ticket_refunded_fen,o.paid_at,
            d.return_at,d.status AS departure_status,dc.checked_at AS returned_at
     FROM booking_orders o
     JOIN departures d ON d.id=o.departure_id
     LEFT JOIN departure_checkins dc ON dc.departure_id=d.id AND dc.event='returned'
     WHERE o.buyer_user_id=$1 AND o.paid_at IS NOT NULL
     ORDER BY o.paid_at,o.created_at,o.id
     LIMIT 1`,
    [userId],
  );
  if (!firstPaidOrderResult.rowCount) {
    if (attribution.qualification_status !== 'pending') {
      await client.query(
        `UPDATE promotion_attributions SET qualification_status='pending' WHERE id=$1`,
        [attribution.id],
      );
    }
    return;
  }
  const order = firstPaidOrderResult.rows[0];
  if (new Date(order.paid_at) < new Date(attribution.attributed_at)) {
    await client.query(
      `UPDATE promotion_attributions
       SET qualification_status='existing_buyer'
       WHERE id=$1 AND qualification_status<>'existing_buyer'`,
      [attribution.id],
    );
    return;
  }
  if (user.identity_status !== 'verified' || !user.identity_number_hash) {
    await client.query(
      `UPDATE promotion_attributions SET qualification_status='pending' WHERE id=$1`,
      [attribution.id],
    );
    return;
  }

  const netTicketFen = calculateNetTicketFen(order);
  const commissionFen = ['cancelled', 'refunded'].includes(order.status)
    ? 0 : calculateCommissionFen(netTicketFen);
  await client.query(
    `UPDATE promotion_attributions
     SET order_id=COALESCE(order_id,$2),qualification_status=$3,
         qualified_at=CASE WHEN $3::varchar='qualified' THEN COALESCE(qualified_at,now()) ELSE qualified_at END
     WHERE id=$1`,
    [attribution.id, order.id, commissionFen > 0 ? 'qualified' : 'refunded'],
  );

  let ledgerResult = await client.query(
    `SELECT id,amount_fen,net_ticket_amount_fen,status,release_at,refund_after_release
     FROM commission_ledger WHERE promotion_attribution_id=$1 FOR UPDATE`,
    [attribution.id],
  );
  if (!ledgerResult.rowCount) {
    const releaseAt = new Date(new Date(order.return_at).getTime() + 7 * 86400_000);
    const inserted = await client.query(
      `INSERT INTO commission_ledger
         (promotion_attribution_id,payee_user_id,amount_fen,net_ticket_amount_fen,
          rate_basis_points,status,release_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (promotion_attribution_id) DO NOTHING
       RETURNING id,amount_fen,net_ticket_amount_fen,status,release_at,refund_after_release`,
      [attribution.id, attribution.owner_user_id, commissionFen, netTicketFen,
        COMMISSION_RATE_BASIS_POINTS, commissionFen > 0 ? 'frozen' : 'reversed', releaseAt],
    );
    ledgerResult = inserted.rowCount ? inserted : await client.query(
      `SELECT id,amount_fen,net_ticket_amount_fen,status,release_at,refund_after_release
       FROM commission_ledger WHERE promotion_attribution_id=$1 FOR UPDATE`,
      [attribution.id],
    );
    if (inserted.rowCount) {
      await logCommissionEvent(client, inserted.rows[0].id,
        commissionFen > 0 ? 'commission_created' : 'commission_refunded_before_creation',
        commissionFen, { orderId: order.id, netTicketAmountFen: netTicketFen, rateBasisPoints: 500 });
    }
  }

  const ledger = ledgerResult.rows[0];
  if (['frozen', 'pending_unlock'].includes(ledger.status)) {
    const nextStatus = commissionFen > 0 ? ledger.status : 'reversed';
    if (Number(ledger.amount_fen) !== commissionFen
        || Number(ledger.net_ticket_amount_fen) !== netTicketFen
        || ledger.status !== nextStatus) {
      await client.query(
        `UPDATE commission_ledger
         SET amount_fen=$2,net_ticket_amount_fen=$3,status=$4
         WHERE id=$1`,
        [ledger.id, commissionFen, netTicketFen, nextStatus],
      );
      await logCommissionEvent(client, ledger.id,
        commissionFen > 0 ? 'commission_recalculated_before_release' : 'commission_reversed_before_release',
        commissionFen, { orderId: order.id, netTicketAmountFen: netTicketFen });
    }
  } else if (Number(order.ticket_refunded_fen) > 0 && !ledger.refund_after_release) {
    await client.query(
      `UPDATE commission_ledger SET refund_after_release=true WHERE id=$1`, [ledger.id],
    );
    await logCommissionEvent(client, ledger.id, 'refund_after_release_exception',
      Number(ledger.amount_fen), { orderId: order.id, ticketRefundFen: Number(order.ticket_refunded_fen) });
  }

  if (order.departure_status === 'completed' && order.returned_at) {
    await syncCompletedCommission(client, ledger.id, order.returned_at);
  }
}

async function syncCompletedCommission(client, ledgerId, returnedAt) {
  const ledgerResult = await client.query(
    `SELECT id,status,amount_fen,release_at FROM commission_ledger
     WHERE id=$1 FOR UPDATE`, [ledgerId],
  );
  if (!ledgerResult.rowCount) return;
  const ledger = ledgerResult.rows[0];
  if (!['frozen', 'pending_unlock'].includes(ledger.status)) return;
  const releaseAt = new Date(new Date(returnedAt).getTime() + 7 * 86400_000);
  const nextStatus = releaseAt.getTime() <= Date.now() ? 'available' : 'pending_unlock';
  if (ledger.status === nextStatus && new Date(ledger.release_at).getTime() === releaseAt.getTime()) return;
  await client.query(
    `UPDATE commission_ledger SET status=$2,release_at=$3 WHERE id=$1`,
    [ledger.id, nextStatus, releaseAt],
  );
  await logCommissionEvent(client, ledger.id,
    nextStatus === 'available' ? 'commission_released' : 'trip_completed_waiting_release',
    Number(ledger.amount_fen), { returnedAt: new Date(returnedAt).toISOString(), releaseAt: releaseAt.toISOString() });
}

export async function releaseMaturedPromotions(client, payeeUserId) {
  const result = await client.query(
    `SELECT id,amount_fen,release_at FROM commission_ledger
     WHERE payee_user_id=$1 AND status='pending_unlock' AND release_at<=now()
     ORDER BY release_at,id FOR UPDATE`, [payeeUserId],
  );
  for (const row of result.rows) {
    const updated = await client.query(
      `UPDATE commission_ledger SET status='available'
       WHERE id=$1 AND status='pending_unlock' AND release_at<=now()`, [row.id],
    );
    if (!updated.rowCount) continue;
    await logCommissionEvent(client, row.id, 'commission_released', Number(row.amount_fen), {
      releaseAt: new Date(row.release_at).toISOString(),
      releasedAt: new Date().toISOString(),
    });
  }
  return result.rowCount;
}

export async function syncPromotionsForDeparture(client, departureId) {
  const result = await client.query(
    `SELECT l.id,dc.checked_at AS returned_at
     FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     JOIN booking_orders o ON o.id=a.order_id
     JOIN departures d ON d.id=o.departure_id
     JOIN departure_checkins dc ON dc.departure_id=d.id AND dc.event='returned'
     WHERE d.id=$1 AND d.status='completed' AND l.status IN ('frozen','pending_unlock')
     ORDER BY l.id`, [departureId],
  );
  for (const row of result.rows) {
    await syncCompletedCommission(client, row.id, row.returned_at);
  }
}

export async function backfillIdentityNumberHashes(pool, security, log = null) {
  const result = await pool.query(
    `SELECT id,identity_number_ciphertext FROM users
     WHERE identity_status='verified' AND identity_number_hash IS NULL
       AND identity_number_ciphertext IS NOT NULL
     ORDER BY identity_verified_at,id`,
  );
  const seen = new Set();
  let updated = 0;
  for (const row of result.rows) {
    const identityNumber = security.decrypt(row.identity_number_ciphertext);
    const hash = security.identityHash(identityNumber);
    const digest = hash.toString('hex');
    if (seen.has(digest)) {
      log?.warn({ userId: row.id }, 'Duplicate verified identity excluded from promotion qualification');
      continue;
    }
    seen.add(digest);
    try {
      await pool.query(
        `UPDATE users SET identity_number_hash=$2
         WHERE id=$1 AND identity_status='verified' AND identity_number_hash IS NULL`,
        [row.id, hash],
      );
      updated += 1;
    } catch (error) {
      if (error.code !== '23505') throw error;
      log?.warn({ userId: row.id }, 'Duplicate verified identity excluded from promotion qualification');
    }
  }
  return updated;
}
