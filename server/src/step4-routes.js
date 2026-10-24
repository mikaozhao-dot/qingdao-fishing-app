import { createSecurity } from './security.js';

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
      penaltyPool: 'schema_ready_no_workflow',
      successfulSupplement: 'schema_ready_no_workflow',
    },
  };
}

/** Capture the approved T-1 18:00 Asia/Shanghai checkpoint once per departure. */
export async function processFormationChecks(pool, asOf = new Date(), onError = () => {}) {
  if (!pool) return { checked: 0, deferred: 0, overdue: 0 };
  const due = await pool.query(
    `SELECT d.id FROM departures d
     WHERE d.status IN ('open','forming') AND ${confirmationAtSql('d')} <= $1
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
          `SELECT d.id,d.status,d.departure_at,
                  (d.departure_at <= $2::timestamptz) AS is_overdue,
                  ${confirmationAtSql('d')} AS confirmation_at
           FROM departures d WHERE d.id=$1 AND d.status IN ('open','forming')
             AND ${confirmationAtSql('d')} <= $2
             AND NOT EXISTS (SELECT 1 FROM departure_formation_snapshots s WHERE s.departure_id=d.id)
           FOR UPDATE`,
          [candidate.id, asOf],
        );
        if (!departure.rowCount) return 'already_checked';
        if (departure.rows[0].is_overdue) {
          await client.query(
            "UPDATE departures SET status='formation_overdue',updated_at=now() WHERE id=$1",
            [candidate.id],
          );
          return 'overdue';
        }
        const pending = await client.query(
          `SELECT EXISTS (SELECT 1 FROM booking_orders
             WHERE departure_id=$1 AND status='pending_payment') AS has_pending_payment`,
          [candidate.id],
        );
        if (pending.rows[0].has_pending_payment) return 'deferred';
        const accounts = await loadFormationAccounts(client, candidate.id);
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

export function registerStep4Routes(app, { pool, config, requireUser }) {
  const security = createSecurity(config);
  const requireCaptain = captainPreHandler(pool);

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
      'd.marina_code,d.trip_type,c.checklist ' +
      'FROM booking_orders o JOIN departures d ON d.id=o.departure_id ' +
      'LEFT JOIN departure_pretrip_checklists c ON c.departure_id=d.id ' +
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

  const interval = setInterval(() => {
    processConfirmedChecklists(pool, (error) => {
      app.log.error({ err: error }, 'Step 4 checklist pass failed');
    });
    processFormationChecks(pool, new Date(), (error) => {
      app.log.error({ err: error }, 'Step 4 formation check failed');
    });
  }, 60_000);
  interval.unref?.();
  app.addHook('onClose', async () => clearInterval(interval));
}
