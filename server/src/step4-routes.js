import { createSecurity } from './security.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });
const validUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

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

function checklistFromRow(row) {
  const seatCount = Number(row.seat_count ?? 0);
  const passengerCount = Number(row.passenger_count ?? 0);
  const insuredOrderCount = Number(row.insured_order_count ?? 0);
  const orderCount = Number(row.order_count ?? 0);
  const insuranceReady = insuredOrderCount === orderCount;
  const manifestReady = seatCount === passengerCount;
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
    "SELECT id FROM departures d WHERE d.status IN ('confirmed','in_progress','completed') " +
      'AND NOT EXISTS (SELECT 1 FROM departure_pretrip_checklists c WHERE c.departure_id=d.id) ' +
      'ORDER BY d.departure_at,d.id LIMIT 50',
  );
  let generated = 0;
  for (const row of due.rows) {
    try {
      await withTransaction(pool, async (client) => {
        const departure = await client.query(
          "SELECT d.id FROM departures d WHERE d.id=$1 AND d.status IN ('confirmed','in_progress','completed') " +
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

  app.get('/captain/fulfillment', { preHandler: [requireUser, requireCaptain] }, async (request) => {
    const result = await pool.query(
      "SELECT d.id,d.status,d.trip_type,d.departure_at,d.meeting_at,d.marina_code " +
      "FROM departures d WHERE d.captain_user_id=$1 AND d.status IN ('confirmed','in_progress','completed') " +
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
      if (!['confirmed', 'in_progress', 'completed'].includes(departure.status)) {
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
      if (event === 'departed' && departure.status !== 'confirmed') {
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
        if (!['confirmed', 'in_progress', 'completed'].includes(departure.status)) {
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
  }, 60_000);
  interval.unref?.();
  app.addHook('onClose', async () => clearInterval(interval));
}
