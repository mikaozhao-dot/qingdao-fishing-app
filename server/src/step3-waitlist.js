import { randomUUID } from 'node:crypto';

const HOLD_KEY_PREFIX = 'fishing:step3:seat:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const confirmationAtSql = (alias = 'd') =>
  `((((${alias}.departure_at AT TIME ZONE 'Asia/Shanghai')::date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai')`;

export const closeoutAtSql = (alias = 'd') => `${confirmationAtSql(alias)} + interval '10 minutes'`;

export function formationConfirmationAt(departureAt) {
  const departure = new Date(departureAt);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(departure);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1, 10, 0, 0));
}

export function waitlistWindowClosesAt(confirmationAt) {
  return new Date(new Date(confirmationAt).getTime() + 10 * 60 * 1000);
}

export function authorizationExpiresAt(authorizedAt, confirmationAt) {
  const authorized = new Date(authorizedAt);
  const hardClose = waitlistWindowClosesAt(confirmationAt);
  return new Date(Math.min(authorized.getTime() + 10 * 60 * 1000, hardClose.getTime()));
}

export function isWaitlistAuthorizationAllowed({ queuedAt, releasedAt, authorizedAt, confirmationAt }) {
  const cutoff = new Date(confirmationAt).getTime();
  const close = waitlistWindowClosesAt(confirmationAt).getTime();
  return new Date(queuedAt).getTime() < cutoff
    && new Date(releasedAt).getTime() < cutoff
    && new Date(authorizedAt).getTime() < close;
}

export function cancellationAmounts(ticketAmountFen, departureAt, cancelledAt) {
  const ticketAmount = Number(ticketAmountFen);
  if (!Number.isSafeInteger(ticketAmount) || ticketAmount < 0) {
    throw new TypeError('ticketAmountFen must be a non-negative safe integer');
  }
  const hoursBeforeDeparture = (new Date(departureAt).getTime() - new Date(cancelledAt).getTime()) / 3_600_000;
  const penaltyRate = hoursBeforeDeparture > 72 ? 0
    : hoursBeforeDeparture > 24 ? 0.3
      : hoursBeforeDeparture > 6 ? 0.6 : 1;
  const penaltyFen = Math.round(ticketAmount * penaltyRate);
  return { penaltyFen, refundFen: ticketAmount - penaltyFen, penaltyRate };
}

export function effectivePaymentAtOrBeforeDeadline(paymentAt, deadline) {
  const paidAt = Date.parse(paymentAt);
  const deadlineAt = Date.parse(deadline);
  return Number.isFinite(paidAt) && Number.isFinite(deadlineAt) && paidAt <= deadlineAt;
}

async function acquireSeatKey(redis, seatId, holdId, expiresAt, now) {
  if (!redis?.isOpen) return false;
  const ttlMs = Math.max(1, new Date(expiresAt).getTime() - new Date(now).getTime());
  const result = await redis.set(`${HOLD_KEY_PREFIX}${seatId}`, holdId, { NX: true, PX: ttlMs });
  return result === 'OK';
}

/** Offer the oldest released platform seat to the oldest pre-cutoff waitlist entry. */
export async function dispatchWaitlistCandidates(pool, redis, departureId, asOf = new Date()) {
  if (!pool || !redis?.isOpen) return [];
  const assignments = [];
  while (assignments.length < 30) {
    const client = await pool.connect();
    let assigned = null;
    try {
      await client.query('BEGIN');
      const departureResult = await client.query(
        `SELECT d.id,d.status,d.departure_at,d.waitlist_window_closed_at,
                ${confirmationAtSql('d')} AS confirmation_at,
                ${closeoutAtSql('d')} AS closeout_at
         FROM departures d WHERE d.id=$1 FOR UPDATE`,
        [departureId],
      );
      if (!departureResult.rowCount) {
        await client.query('COMMIT');
        break;
      }
      const departure = departureResult.rows[0];
      const now = new Date(asOf);
      if (!['open','forming'].includes(departure.status)
          || new Date(departure.departure_at) <= now
          || now >= new Date(departure.closeout_at)
          || departure.waitlist_window_closed_at) {
        await client.query('COMMIT');
        break;
      }
      const seatResult = await client.query(
        `SELECT s.id,s.seat_number,s.price_fen,s.is_premium,s.waitlist_released_at
         FROM seat_inventory s
         WHERE s.departure_id=$1 AND s.sale_channel='platform' AND s.status='available'
           AND s.waitlist_released_at < $2::timestamptz
         ORDER BY s.waitlist_released_at,s.seat_number
         FOR UPDATE SKIP LOCKED LIMIT 1`,
        [departureId, departure.confirmation_at],
      );
      const candidateResult = await client.query(
        `SELECT id,user_id,queued_at FROM departure_waitlist_entries
         WHERE departure_id=$1 AND status='waiting' AND queued_at < $2::timestamptz
         ORDER BY queued_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
        [departureId, departure.confirmation_at],
      );
      if (!seatResult.rowCount || !candidateResult.rowCount) {
        await client.query('COMMIT');
        break;
      }
      const seat = seatResult.rows[0];
      const candidate = candidateResult.rows[0];
      const holdId = randomUUID();
      const expiresAt = authorizationExpiresAt(now, departure.confirmation_at);
      if (expiresAt <= now) {
        await client.query('COMMIT');
        break;
      }
      const keyAcquired = await acquireSeatKey(redis, seat.id, holdId, expiresAt, now);
      if (!keyAcquired) {
        await client.query('ROLLBACK');
        break;
      }
      try {
        await client.query(
          `INSERT INTO seat_holds (id,departure_id,user_id,status,expires_at,waitlist_entry_id)
           VALUES ($1,$2,$3,'active',$4,$5)`,
          [holdId, departureId, candidate.user_id, expiresAt, candidate.id],
        );
        await client.query(
          `INSERT INTO seat_hold_items (hold_id,seat_inventory_id,seat_number,price_fen,is_premium)
           VALUES ($1,$2,$3,$4,$5)`,
          [holdId, seat.id, seat.seat_number, seat.price_fen, seat.is_premium],
        );
        await client.query(
          `UPDATE seat_inventory SET status='held',hold_id=$2,hold_expires_at=$3,updated_at=now()
           WHERE id=$1 AND status='available'`,
          [seat.id, holdId, expiresAt],
        );
        await client.query(
          `UPDATE departure_waitlist_entries
           SET status='authorized',authorized_at=$2,authorization_expires_at=$3,
               seat_inventory_id=$4,hold_id=$5,updated_at=now()
           WHERE id=$1 AND status='waiting'`,
          [candidate.id, now, expiresAt, seat.id, holdId],
        );
        await client.query('COMMIT');
        assigned = {
          entryId: candidate.id, userId: candidate.user_id, seatId: seat.id,
          holdId, expiresAt: expiresAt.toISOString(),
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        await redis.del(`${HOLD_KEY_PREFIX}${seat.id}`).catch(() => {});
        throw error;
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    if (!assigned) break;
    assignments.push(assigned);
  }
  return assignments;
}

export async function processWaitlistCloseouts(pool, asOf = new Date()) {
  if (!pool) return { closed: 0, waiting: 0 };
  const due = await pool.query(
    `SELECT d.id FROM departures d
     WHERE d.status IN ('open','forming') AND d.waitlist_window_closed_at IS NULL
       AND ${closeoutAtSql('d')} <= $1
     ORDER BY d.departure_at,d.id LIMIT 100`,
    [asOf],
  );
  let closed = 0;
  let waiting = 0;
  for (const row of due.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const departure = await client.query(
        `SELECT d.id FROM departures d WHERE d.id=$1 AND d.status IN ('open','forming')
          AND d.waitlist_window_closed_at IS NULL AND ${closeoutAtSql('d')} <= $2 FOR UPDATE`,
        [row.id, asOf],
      );
      if (!departure.rowCount) {
        await client.query('COMMIT');
        continue;
      }
      const active = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM departure_waitlist_entries w
           JOIN seat_holds h ON h.id=w.hold_id
           WHERE w.departure_id=$1 AND w.status='authorized'
             AND h.status='active' AND h.expires_at > $2
         ) AS has_active_authorization`,
        [row.id, asOf],
      );
      if (active.rows[0].has_active_authorization) {
        waiting += 1;
        await client.query('COMMIT');
        continue;
      }
      await client.query(
        `UPDATE departure_waitlist_entries SET status='closed',updated_at=now()
         WHERE departure_id=$1 AND status='waiting'`, [row.id],
      );
      await client.query(
        `UPDATE departure_waitlist_entries SET status='expired',updated_at=now()
         WHERE departure_id=$1 AND status='authorized' AND authorization_expires_at <= $2`,
        [row.id, asOf],
      );
      const pendingPayment = await client.query(
        `SELECT EXISTS (SELECT 1 FROM booking_orders WHERE departure_id=$1 AND status='pending_payment') AS pending`,
        [row.id],
      );
      if (pendingPayment.rows[0].pending) {
        waiting += 1;
        await client.query('COMMIT');
        continue;
      }
      await client.query(
        `UPDATE departures SET waitlist_window_closed_at=$2,updated_at=now()
         WHERE id=$1 AND waitlist_window_closed_at IS NULL`, [row.id, asOf],
      );
      closed += 1;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return { closed, waiting };
}

export async function processWaitlistDispatches(pool, redis, asOf = new Date()) {
  if (!pool || !redis?.isOpen) return { dispatched: 0 };
  const due = await pool.query(
    `SELECT DISTINCT d.id FROM departures d
     JOIN departure_waitlist_entries w ON w.departure_id=d.id AND w.status='waiting'
     JOIN seat_inventory s ON s.departure_id=d.id AND s.sale_channel='platform'
       AND s.status='available' AND s.waitlist_released_at < ${confirmationAtSql('d')}
     WHERE d.status IN ('open','forming') AND d.waitlist_window_closed_at IS NULL
       AND ${closeoutAtSql('d')} > $1 AND d.departure_at>$1
     ORDER BY d.id LIMIT 100`,
    [asOf],
  );
  let dispatched = 0;
  for (const row of due.rows) {
    dispatched += (await dispatchWaitlistCandidates(pool, redis, row.id, asOf)).length;
  }
  return { dispatched };
}

export function validWaitlistRequestKey(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{8,100}$/.test(value.trim());
}

export function validWaitlistUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
