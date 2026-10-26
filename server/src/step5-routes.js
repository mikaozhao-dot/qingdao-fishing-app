import { createSecurity } from './security.js';
import { FISH_CATALOG } from './step2-catalog.js';

const FISH_BY_CODE = new Map(FISH_CATALOG.map((fish) => [fish.code, fish]));
const CAPTAIN_TAGS = new Set([
  'on_time', 'clear_guidance', 'transparent_fees', 'safety_briefing',
]);
const BOAT_TAGS = new Set([
  'clean_deck', 'facilities_match', 'comfortable_space',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });

function normalizedIdentity(value) {
  return String(value ?? '').replace(/\s/g, '').toUpperCase();
}

function validateCatch(outcome, items, allowTotalWeight) {
  if (!['caught', 'zero_catch'].includes(outcome) || !Array.isArray(items) || items.length > 17) {
    return '渔获格式不正确';
  }
  if (outcome === 'zero_catch' && items.length !== 0) return '零渔获记录不能包含鱼种';
  if (outcome === 'caught' && items.length === 0) return '请添加鱼种，或明确选择零渔获';
  const seen = new Set();
  for (const item of items) {
    const code = String(item?.fishCode ?? '');
    const quantity = Number(item?.quantity);
    if (!FISH_BY_CODE.has(code) || !Number.isInteger(quantity) || quantity < 1 || quantity > 999 || seen.has(code)) {
      return '鱼种必须来自标准鱼种库，数量为 1–999，且同一鱼种只能提交一次';
    }
    seen.add(code);
    const optional = [
      ['maxIndividualWeightGrams', 1, 200000],
      ['maxLengthMm', 1, 5000],
      ...(allowTotalWeight ? [['totalWeightGrams', 1, 10000000]] : []),
    ];
    for (const [key, min, max] of optional) {
      const value = item[key];
      if (value != null && value !== '' && (!Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max)) {
        return `${key} 数值无效`;
      }
    }
  }
  return null;
}

function validateTags(values, allowed) {
  if (!Array.isArray(values) || values.length > allowed.size) return false;
  return new Set(values).size === values.length && values.every((value) => allowed.has(value));
}

async function transaction(pool, task) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await task(client);
    if (result?.error) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function completedDeparture(client, departureId, lockForWrite = false) {
  const result = await client.query(
    `SELECT d.id,d.captain_user_id,d.boat_id,d.status,
            EXISTS (SELECT 1 FROM departure_checkins dc
                    WHERE dc.departure_id=d.id AND dc.event='departed'
                      AND dc.captain_user_id=d.captain_user_id) AS departed,
            EXISTS (SELECT 1 FROM departure_checkins rc
                    WHERE rc.departure_id=d.id AND rc.event='returned'
                      AND rc.captain_user_id=d.captain_user_id) AS returned
     FROM departures d WHERE d.id=$1${lockForWrite ? ' FOR UPDATE OF d' : ''}`,
    [departureId],
  );
  const departure = result.rows[0];
  if (!departure || departure.status !== 'completed' || !departure.departed || !departure.returned) return null;
  return departure;
}

async function authorizeParticipant(
  client, departureId, user, security, expectedOrderId = null, lockDepartureForWrite = false,
) {
  const departure = await completedDeparture(client, departureId, lockDepartureForWrite);
  if (!departure) return { error: [409, '仅已返航且完成出返航打卡的班次可操作'] };
  if (departure.captain_user_id === user.id) return { role: 'captain', departure };
  if (user.identity_status !== 'verified') return { error: [403, '仅实名验证通过的实际出航乘客可操作'] };

  const identityResult = await client.query(
    'SELECT identity_number_ciphertext FROM users WHERE id=$1 AND identity_status=$2',
    [user.id, 'verified'],
  );
  if (!identityResult.rowCount || !identityResult.rows[0].identity_number_ciphertext) {
    return { error: [403, '仅实名验证通过的实际出航乘客可操作'] };
  }
  let identity;
  try {
    identity = normalizedIdentity(security.decrypt(identityResult.rows[0].identity_number_ciphertext));
  } catch {
    return { error: [403, '实名信息无法核对'] };
  }
  const passengerResult = await client.query(
    `SELECT op.id AS passenger_id,op.order_id,op.identity_number_ciphertext
     FROM booking_orders o
     JOIN order_passengers op ON op.order_id=o.id
     JOIN departure_passenger_gate_decisions gate
       ON gate.departure_id=o.departure_id AND gate.passenger_id=op.id AND gate.decision='allowed'
     WHERE o.departure_id=$1 AND o.status IN ('paid','completed')
       AND ($2::uuid IS NULL OR o.id=$2)
     ORDER BY op.id`,
    [departureId, expectedOrderId],
  );
  for (const passenger of passengerResult.rows) {
    try {
      if (normalizedIdentity(security.decrypt(passenger.identity_number_ciphertext)) === identity) {
        return {
          role: 'passenger', departure,
          passengerId: passenger.passenger_id, orderId: passenger.order_id,
        };
      }
    } catch {
      // A malformed encrypted manifest row is not an authorization match.
    }
  }
  return { error: [403, '仅该班次保险门禁允许且已实际出航的乘客可操作'] };
}

async function insertCatchItems(client, reportId, items, allowTotalWeight) {
  for (const item of items) {
    await client.query(
      `INSERT INTO step5_catch_items
         (report_id,fish_code,quantity,total_weight_grams,max_individual_weight_grams,max_length_mm)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [reportId, item.fishCode, Number(item.quantity),
        allowTotalWeight && item.totalWeightGrams ? Number(item.totalWeightGrams) : null,
        item.maxIndividualWeightGrams ? Number(item.maxIndividualWeightGrams) : null,
        item.maxLengthMm ? Number(item.maxLengthMm) : null],
    );
  }
}

async function insertResponseItems(client, responseId, items) {
  for (const item of items) {
    await client.query(
      `INSERT INTO step5_catch_response_items
         (response_id,fish_code,quantity,max_individual_weight_grams,max_length_mm)
       VALUES ($1,$2,$3,$4,$5)`,
      [responseId, item.fishCode, Number(item.quantity),
        item.maxIndividualWeightGrams ? Number(item.maxIndividualWeightGrams) : null,
        item.maxLengthMm ? Number(item.maxLengthMm) : null],
    );
  }
}

async function passengerReportConflict(client, captainReportId, passengerReportId) {
  const captain = await client.query(
    'SELECT outcome FROM step5_catch_reports WHERE id=$1', [captainReportId],
  );
  const passenger = await client.query(
    'SELECT outcome FROM step5_catch_reports WHERE id=$1', [passengerReportId],
  );
  if (!captain.rowCount || !passenger.rowCount || passenger.rows[0].outcome !== 'caught') return false;
  const passengerItems = await client.query(
    'SELECT fish_code,quantity FROM step5_catch_items WHERE report_id=$1', [passengerReportId],
  );
  if (captain.rows[0].outcome === 'zero_catch' && passengerItems.rowCount) return true;
  const captainItems = await client.query(
    'SELECT fish_code,quantity FROM step5_catch_items WHERE report_id=$1', [captainReportId],
  );
  const vesselQuantities = new Map(captainItems.rows.map((item) => [item.fish_code, Number(item.quantity)]));
  return passengerItems.rows.some((item) => Number(item.quantity) > (vesselQuantities.get(item.fish_code) ?? 0));
}

async function supplementConflict(client, captainReportId, responseId) {
  if (!responseId) return false;
  const captain = await client.query(
    'SELECT outcome FROM step5_catch_reports WHERE id=$1', [captainReportId],
  );
  const supplements = await client.query(
    'SELECT fish_code,quantity FROM step5_catch_response_items WHERE response_id=$1', [responseId],
  );
  if (!supplements.rowCount) return false;
  if (captain.rows[0]?.outcome === 'zero_catch') return true;
  const captainItems = await client.query(
    'SELECT fish_code,quantity FROM step5_catch_items WHERE report_id=$1', [captainReportId],
  );
  const vesselQuantities = new Map(captainItems.rows.map((item) => [item.fish_code, Number(item.quantity)]));
  return supplements.rows.some((item) => Number(item.quantity) > (vesselQuantities.get(item.fish_code) ?? 0));
}

async function syncReconciliation(client, departureId, passengerId, captainReportId, passengerReportId, action = null, responseId = null) {
  const reportMismatch = passengerReportId
    ? await passengerReportConflict(client, captainReportId, passengerReportId)
    : false;
  const responseMismatch = action === 'supplement'
    ? await supplementConflict(client, captainReportId, responseId)
    : false;
  const conflict = reportMismatch || responseMismatch;
  const status = conflict || action === 'dispute'
    ? 'pending_review'
    : action === 'confirm' ? 'confirmed'
      : action === 'supplement' ? 'supplemented'
        : 'awaiting_passenger';
  await client.query(
    `INSERT INTO step5_catch_reconciliations
       (departure_id,passenger_id,captain_report_id,status,checked_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (departure_id,passenger_id) DO UPDATE SET
       captain_report_id=EXCLUDED.captain_report_id,status=EXCLUDED.status,checked_at=now()`,
    [departureId, passengerId, captainReportId, status],
  );
  return { status, conflict };
}

function reportItem(item) {
  return {
    fishCode: item.fish_code,
    fishName: FISH_BY_CODE.get(item.fish_code)?.name ?? item.fish_code,
    quantity: Number(item.quantity),
    totalWeightGrams: item.total_weight_grams == null ? null : Number(item.total_weight_grams),
    maxIndividualWeightGrams: item.max_individual_weight_grams == null ? null : Number(item.max_individual_weight_grams),
    maxLengthMm: item.max_length_mm == null ? null : Number(item.max_length_mm),
  };
}

async function readReport(client, departureId, source, passengerId = null) {
  const result = await client.query(
    `SELECT id,outcome,created_at FROM step5_catch_reports
     WHERE departure_id=$1 AND source=$2 AND ($3::uuid IS NULL OR passenger_id=$3)
     LIMIT 1`, [departureId, source, passengerId],
  );
  if (!result.rowCount) return null;
  const report = result.rows[0];
  const items = await client.query(
    `SELECT fish_code,quantity,total_weight_grams,max_individual_weight_grams,max_length_mm
     FROM step5_catch_items WHERE report_id=$1 ORDER BY fish_code`, [report.id],
  );
  return {
    id: report.id, outcome: report.outcome, createdAt: report.created_at,
    items: items.rows.map(reportItem),
  };
}

async function captainFacts(pool, captainId, security) {
  const completed = await pool.query(
    `SELECT count(*)::integer AS count FROM departures d
     JOIN departure_checkins r ON r.departure_id=d.id AND r.event='returned'
     WHERE d.captain_user_id=$1 AND d.status='completed'`, [captainId],
  );
  const sample = await pool.query(
    `SELECT count(*)::integer AS reported,
            count(*) FILTER (WHERE r.outcome='zero_catch')::integer AS zero_catch
     FROM departures d JOIN departure_checkins rcheck
       ON rcheck.departure_id=d.id AND rcheck.event='returned'
     JOIN step5_catch_reports r ON r.departure_id=d.id AND r.source='captain'
     WHERE d.captain_user_id=$1 AND d.status='completed'
       AND d.return_at >= now() - interval '12 months'`, [captainId],
  );
  const missing = await pool.query(
    `SELECT count(*)::integer AS missing FROM departures d
     JOIN departure_checkins r ON r.departure_id=d.id AND r.event='returned'
     LEFT JOIN step5_catch_reports report ON report.departure_id=d.id AND report.source='captain'
     WHERE d.captain_user_id=$1 AND d.status='completed'
       AND d.return_at >= now() - interval '12 months' AND report.id IS NULL`, [captainId],
  );
  const [serviceReviews, crossSource] = await Promise.all([
    pool.query(
      `WITH review_sample AS (
         SELECT id,captain_tags FROM step5_trip_reviews
         WHERE captain_user_id=$1 AND created_at >= now()-interval '12 months'
       ), tag_aggregates AS (
         SELECT tag,count(*)::integer AS tag_count
         FROM review_sample
         CROSS JOIN LATERAL unnest(review_sample.captain_tags) AS tags(tag)
         GROUP BY tag
       )
       SELECT (SELECT count(*)::integer FROM review_sample) AS sample_count,
              COALESCE((SELECT array_agg(tag ORDER BY tag) FROM tag_aggregates), '{}') AS tags,
              COALESCE((SELECT array_agg(tag_count ORDER BY tag) FROM tag_aggregates), '{}') AS tag_counts`,
      [captainId],
    ),
    pool.query(
      `SELECT count(*)::integer AS sample_count,
              count(*) FILTER (WHERE reconciliation.status='pending_review')::integer AS pending_count
       FROM step5_catch_reconciliations reconciliation
       JOIN departures d ON d.id=reconciliation.departure_id
       JOIN departure_checkins returned ON returned.departure_id=d.id AND returned.event='returned'
       WHERE d.captain_user_id=$1 AND d.status='completed'
         AND d.return_at >= now()-interval '12 months'`, [captainId],
    ),
  ]);
  const recent = await pool.query(
    `SELECT r.id,r.outcome,r.created_at,i.fish_code,i.quantity
     FROM step5_catch_reports r JOIN departures d ON d.id=r.departure_id
     JOIN departure_checkins returned ON returned.departure_id=d.id AND returned.event='returned'
     LEFT JOIN step5_catch_items i ON i.report_id=r.id
     WHERE d.captain_user_id=$1 AND d.status='completed' AND r.source='captain'
     ORDER BY r.created_at DESC,i.fish_code LIMIT 30`, [captainId],
  );
  const repeatTrips = await pool.query(
    `SELECT d.id AS departure_id,d.departure_at,op.identity_number_ciphertext
     FROM departures d
     JOIN departure_checkins r ON r.departure_id=d.id AND r.event='returned'
     JOIN booking_orders o ON o.departure_id=d.id AND o.status IN ('paid','completed')
     JOIN order_passengers op ON op.order_id=o.id
     JOIN departure_passenger_gate_decisions gate
       ON gate.departure_id=d.id AND gate.passenger_id=op.id AND gate.decision='allowed'
     WHERE d.captain_user_id=$1 AND d.status='completed'
     ORDER BY d.departure_at`, [captainId],
  );
  const windowStart = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const matureAt = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const passengerTrips = new Map();
  for (const row of repeatTrips.rows) {
    const at = new Date(row.departure_at).getTime();
    if (!Number.isFinite(at)) continue;
    let identity;
    try { identity = normalizedIdentity(security.decrypt(row.identity_number_ciphertext)); } catch { continue; }
    if (!identity) continue;
    const trips = passengerTrips.get(identity) ?? { firstEver: at, recent: new Map() };
    trips.firstEver = Math.min(trips.firstEver, at);
    if (at >= windowStart) trips.recent.set(row.departure_id, at);
    passengerTrips.set(identity, trips);
  }
  let repeatDenominator = 0;
  let repeatNumerator = 0;
  for (const trips of passengerTrips.values()) {
    if (trips.firstEver < windowStart || trips.firstEver > matureAt) continue;
    repeatDenominator += 1;
    if (trips.recent.size >= 2) repeatNumerator += 1;
  }
  const reported = Number(sample.rows[0].reported);
  const zeroCatch = Number(sample.rows[0].zero_catch);
  const groupedRecent = new Map();
  for (const row of recent.rows) {
    const item = groupedRecent.get(row.id) ?? {
      outcome: row.outcome, reportedAt: row.created_at, items: [],
    };
    if (row.fish_code) item.items.push({
      fishCode: row.fish_code, fishName: FISH_BY_CODE.get(row.fish_code)?.name ?? row.fish_code,
      quantity: Number(row.quantity),
    });
    groupedRecent.set(row.id, item);
  }
  return {
    captainId,
    completedTripCount: Number(completed.rows[0].count),
    sampleWindowMonths: 12,
    catchReports: {
      reportedTripCount: reported,
      missingReportCount: Number(missing.rows[0].missing),
      zeroCatchTripCount: zeroCatch,
      zeroCatchRatePercent: reported ? Math.round((zeroCatch / reported) * 1000) / 10 : null,
    },
    serviceReviews: {
      sampleWindowMonths: 12,
      sampleCount: Number(serviceReviews.rows[0].sample_count),
      tagCounts: serviceReviews.rows[0].tags.map((tag, index) => ({
        tag, count: Number(serviceReviews.rows[0].tag_counts[index]),
      })),
    },
    crossSourceChecks: {
      sampleWindowMonths: 12,
      sampleCount: Number(crossSource.rows[0].sample_count),
      pendingReviewCount: Number(crossSource.rows[0].pending_count),
      pendingReviewRatePercent: Number(crossSource.rows[0].sample_count)
        ? Math.round((Number(crossSource.rows[0].pending_count) / Number(crossSource.rows[0].sample_count)) * 1000) / 10
        : null,
    },
    repeatBookings: {
      observationWindowMonths: 12,
      maturityDays: 90,
      cohortPassengerCount: repeatDenominator,
      repeatPassengerCount: repeatNumerator,
      repeatRatePercent: repeatDenominator ? Math.round((repeatNumerator / repeatDenominator) * 1000) / 10 : null,
      basis: '观察窗内首个历史完成航次距今至少 90 天的实名乘客进入成熟样本；其中观察窗内再次完成出航者计为复订。',
    },
    recentCatches: [...groupedRecent.values()].slice(0, 6),
  };
}

async function fishLeaderboard(pool, requestedMonth) {
  const currentResult = await pool.query(
    `SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') AS month`,
  );
  const currentMonth = currentResult.rows[0].month;
  const month = requestedMonth ?? currentMonth;
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > currentMonth) {
    return { error: [400, '月份格式无效或不能选择未来月份'] };
  }

  const fishCodes = FISH_CATALOG.map((fish) => fish.code);
  const [months, result] = await Promise.all([
    pool.query(
      `SELECT DISTINCT to_char(d.return_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') AS month
       FROM departures d
       WHERE d.status='completed' AND d.return_at <= now()
         AND EXISTS (
           SELECT 1 FROM departure_checkins returned
           WHERE returned.departure_id=d.id AND returned.captain_user_id=d.captain_user_id
             AND returned.event='returned'
         )
       ORDER BY month DESC`,
    ),
    pool.query(
      `WITH candidates AS (
         SELECT r.departure_id,r.id AS report_id,r.source,r.passenger_id,
                i.id AS item_id,i.fish_code,i.max_individual_weight_grams AS weight_grams,
                r.created_at AS recorded_at,d.return_at,
                to_char(d.return_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS departure_date,
                c.captain_name,
                CASE WHEN r.source='passenger'
                     THEN COALESCE(NULLIF(BTRIM(u.display_name),''),'钓友')
                     ELSE NULL END AS angler_nickname
         FROM step5_catch_reports r
         JOIN step5_catch_items i ON i.report_id=r.id
         JOIN departures d ON d.id=r.departure_id
         JOIN captain_profiles c ON c.user_id=d.captain_user_id
         LEFT JOIN users u ON r.source='passenger' AND u.id=r.author_user_id
         WHERE d.status='completed' AND d.return_at <= now()
           AND d.return_at >= (($1 || '-01')::date::timestamp AT TIME ZONE 'Asia/Shanghai')
           AND d.return_at < (((($1 || '-01')::date + INTERVAL '1 month')::timestamp) AT TIME ZONE 'Asia/Shanghai')
           AND i.max_individual_weight_grams IS NOT NULL
           AND i.fish_code=ANY($2::varchar[])
           AND EXISTS (
             SELECT 1 FROM departure_checkins departed
             WHERE departed.departure_id=d.id AND departed.captain_user_id=d.captain_user_id
               AND departed.event='departed'
           )
           AND EXISTS (
             SELECT 1 FROM departure_checkins returned
             WHERE returned.departure_id=d.id AND returned.captain_user_id=d.captain_user_id
               AND returned.event='returned'
           )
           AND NOT EXISTS (
             SELECT 1 FROM step5_catch_reconciliations reconciliation
             WHERE reconciliation.departure_id=r.departure_id
               AND reconciliation.status='pending_review'
               AND (r.source='captain' OR reconciliation.passenger_id=r.passenger_id)
           )
       ), trip_species AS (
         SELECT *,row_number() OVER (
           PARTITION BY departure_id,fish_code
           ORDER BY weight_grams DESC,recorded_at ASC,source ASC,report_id ASC,item_id ASC
         ) AS source_rank
         FROM candidates
       ), board_rows AS (
         SELECT *,row_number() OVER (
           PARTITION BY fish_code
           ORDER BY weight_grams DESC,recorded_at ASC,return_at ASC,departure_id ASC,report_id ASC,item_id ASC
         ) AS board_rank
         FROM trip_species WHERE source_rank=1
       )
       SELECT departure_id,source,fish_code,weight_grams,recorded_at,return_at,departure_date,
              captain_name,angler_nickname,board_rank
       FROM board_rows WHERE board_rank <= 20
       ORDER BY fish_code,board_rank`,
      [month, fishCodes],
    ),
  ]);

  const boards = new Map();
  for (const row of result.rows) {
    const fish = FISH_BY_CODE.get(row.fish_code);
    if (!fish) continue;
    const board = boards.get(row.fish_code) ?? {
      fishCode: row.fish_code, fishName: fish.name, items: [],
    };
    board.items.push({
      rank: Number(row.board_rank),
      maxIndividualWeightGrams: Number(row.weight_grams),
      recordedAt: row.recorded_at,
      returnAt: row.return_at,
      departureDate: row.departure_date,
      captainName: row.captain_name,
      catcherName: row.source === 'captain' ? '船长回填' : row.angler_nickname,
      catchSource: row.source,
      departureId: row.departure_id,
    });
    boards.set(row.fish_code, board);
  }

  return {
    month,
    timeZone: 'Asia/Shanghai',
    availableMonths: [...new Set([currentMonth, ...months.rows.map((row) => row.month)])]
      .sort((left, right) => right.localeCompare(left)),
    boards: [...boards.values()],
    sourceNote: '榜单数据来自船长与乘客的渔获回填记录，不代表平台称重认证。',
  };
}

export function registerStep5Routes(app, { pool, config, requireUser }) {
  const security = createSecurity(config);
  const requirePool = async (_request, reply) => {
    if (!pool) return sendError(reply, 503, '数据库未配置');
  };

  app.get('/step5/fish-leaderboard', { preHandler: requirePool }, async (request, reply) => {
    const result = await fishLeaderboard(pool, request.query?.month);
    if (result.error) return sendError(reply, result.error[0], result.error[1]);
    return result;
  });

  app.get('/step5/fish-catalog', async () => ({
    items: FISH_CATALOG.map(({ code, name }) => ({ code, name })),
  }));

  app.post('/step5/departures/:id/captain-catch',
    { preHandler: [requireUser, requirePool] }, async (request, reply) => {
      const departureId = String(request.params.id ?? '');
      if (!UUID.test(departureId)) return sendError(reply, 400, '班次编号无效');
      const outcome = String(request.body?.outcome ?? '');
      const items = request.body?.items;
      const validation = validateCatch(outcome, items, true);
      if (validation) return sendError(reply, 400, validation);
      try {
        const result = await transaction(pool, async (client) => {
          const participant = await authorizeParticipant(client, departureId, request.user, security, null, true);
          if (participant.error) return participant;
          if (participant.role !== 'captain') return { error: [403, '只有本船船长可提交航次渔获'] };
          const inserted = await client.query(
            `INSERT INTO step5_catch_reports (departure_id,source,author_user_id,outcome)
             VALUES ($1,'captain',$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
            [departureId, request.user.id, outcome],
          );
          if (!inserted.rowCount) return { error: [409, '船长渔获已提交，原始记录不会被覆盖'] };
          const reportId = inserted.rows[0].id;
          await insertCatchItems(client, reportId, items, true);
          const passengers = await client.query(
            `SELECT op.id AS passenger_id FROM booking_orders o
             JOIN order_passengers op ON op.order_id=o.id
             JOIN departure_passenger_gate_decisions gate
               ON gate.departure_id=o.departure_id AND gate.passenger_id=op.id AND gate.decision='allowed'
             WHERE o.departure_id=$1 AND o.status IN ('paid','completed') ORDER BY op.id`, [departureId],
          );
          for (const row of passengers.rows) {
            const ownReport = await client.query(
              `SELECT id FROM step5_catch_reports
               WHERE departure_id=$1 AND passenger_id=$2 AND source='passenger'`,
              [departureId, row.passenger_id],
            );
            await syncReconciliation(client, departureId, row.passenger_id, reportId, ownReport.rows[0]?.id ?? null);
          }
          return { reportId, reconciliationCount: passengers.rowCount };
        });
        if (result.error) return sendError(reply, result.error[0], result.error[1]);
        return reply.code(201).send({ ok: true, ...result });
      } catch (error) {
        request.log.error({ err: error }, 'Step 5 captain catch report failed');
        return sendError(reply, 500, '渔获记录暂时未能保存');
      }
    });

  app.post('/step5/departures/:id/passenger-catch',
    { preHandler: [requireUser, requirePool] }, async (request, reply) => {
      const departureId = String(request.params.id ?? '');
      if (!UUID.test(departureId)) return sendError(reply, 400, '班次编号无效');
      const catchReport = request.body?.catchReport ?? null;
      const captainResponse = request.body?.captainResponse ?? null;
      if (!catchReport && !captainResponse) return sendError(reply, 400, '请提交本人渔获或回应船长记录');
      if (catchReport) {
        const validation = validateCatch(String(catchReport.outcome ?? ''), catchReport.items, false);
        if (validation) return sendError(reply, 400, validation);
      }
      if (captainResponse) {
        if (!['confirm', 'dispute', 'supplement'].includes(captainResponse.action)) {
          return sendError(reply, 400, '船长记录回应类型无效');
        }
        const responseItems = captainResponse.items ?? [];
        if (captainResponse.action === 'supplement') {
          const validation = validateCatch('caught', responseItems, false);
          if (validation) return sendError(reply, 400, validation);
        } else if (!Array.isArray(responseItems) || responseItems.length) {
          return sendError(reply, 400, '确认或异议回应不能携带补充鱼种');
        }
      }
      try {
        const result = await transaction(pool, async (client) => {
          const participant = await authorizeParticipant(client, departureId, request.user, security, null, true);
          if (participant.error) return participant;
          if (participant.role !== 'passenger') return { error: [403, '该操作仅限实际出航乘客'] };
          let passengerReportId = null;
          if (catchReport) {
            const inserted = await client.query(
              `INSERT INTO step5_catch_reports
                 (departure_id,source,author_user_id,passenger_id,order_id,outcome)
               VALUES ($1,'passenger',$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
              [departureId, request.user.id, participant.passengerId, participant.orderId, catchReport.outcome],
            );
            if (!inserted.rowCount) return { error: [409, '本人渔获已提交，原始记录不会被覆盖'] };
            passengerReportId = inserted.rows[0].id;
            await insertCatchItems(client, passengerReportId, catchReport.items, false);
          }
          let responseId = null;
          let captainReport = null;
          if (captainResponse) {
            const captain = await client.query(
              `SELECT id FROM step5_catch_reports
               WHERE departure_id=$1 AND source='captain'`, [departureId],
            );
            if (!captain.rowCount) return { error: [409, '船长尚未提交本航渔获，暂时不能回应'] };
            captainReport = captain.rows[0].id;
            const inserted = await client.query(
              `INSERT INTO step5_catch_report_responses
                 (captain_report_id,departure_id,passenger_id,responder_user_id,action)
               VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
              [captainReport, departureId, participant.passengerId, request.user.id, captainResponse.action],
            );
            if (!inserted.rowCount) return { error: [409, '对船长记录的回应已提交，原始回应不会被覆盖'] };
            responseId = inserted.rows[0].id;
            await insertResponseItems(client, responseId, captainResponse.items ?? []);
          }
          if (!captainReport) {
            const captain = await client.query(
              `SELECT id FROM step5_catch_reports WHERE departure_id=$1 AND source='captain'`, [departureId],
            );
            captainReport = captain.rows[0]?.id ?? null;
          }
          let reconciliation = null;
          if (captainReport) {
            let action = captainResponse?.action ?? null;
            let reconciliationResponseId = responseId;
            if (!action) {
              const previousResponse = await client.query(
                `SELECT id,action FROM step5_catch_report_responses
                 WHERE captain_report_id=$1 AND passenger_id=$2`,
                [captainReport, participant.passengerId],
              );
              action = previousResponse.rows[0]?.action ?? null;
              reconciliationResponseId = previousResponse.rows[0]?.id ?? null;
            }
            const resolvedPassengerReport = passengerReportId ?? (await client.query(
              `SELECT id FROM step5_catch_reports
               WHERE departure_id=$1 AND passenger_id=$2 AND source='passenger'`,
              [departureId, participant.passengerId],
            )).rows[0]?.id ?? null;
            reconciliation = await syncReconciliation(
              client, departureId, participant.passengerId, captainReport, resolvedPassengerReport, action, reconciliationResponseId,
            );
          }
          return { passengerReportId, responseId, reconciliation };
        });
        if (result.error) return sendError(reply, result.error[0], result.error[1]);
        return reply.code(201).send({ ok: true, ...result });
      } catch (error) {
        request.log.error({ err: error }, 'Step 5 passenger report failed');
        return sendError(reply, 500, '本人记录暂时未能保存');
      }
    });

  app.get('/step5/departures/:id/me',
    { preHandler: [requireUser, requirePool] }, async (request, reply) => {
      const departureId = String(request.params.id ?? '');
      if (!UUID.test(departureId)) return sendError(reply, 400, '班次编号无效');
      const result = await transaction(pool, async (client) => {
        const participant = await authorizeParticipant(client, departureId, request.user, security);
        if (participant.error) return participant;
        const captain = await readReport(client, departureId, 'captain');
        const own = participant.role === 'passenger'
          ? await readReport(client, departureId, 'passenger', participant.passengerId) : null;
        let response = null;
        let reconciliation = null;
        let review = null;
        if (participant.role === 'passenger' && captain) {
          const responseResult = await client.query(
            `SELECT id,action,created_at FROM step5_catch_report_responses
             WHERE captain_report_id=$1 AND passenger_id=$2`, [captain.id, participant.passengerId],
          );
          if (responseResult.rowCount) {
            const row = responseResult.rows[0];
            const items = await client.query(
              `SELECT fish_code,quantity,max_individual_weight_grams,max_length_mm
               FROM step5_catch_response_items WHERE response_id=$1 ORDER BY fish_code`, [row.id],
            );
            response = {
              action: row.action, createdAt: row.created_at,
              items: items.rows.map(reportItem),
            };
          }
          const state = await client.query(
            `SELECT status FROM step5_catch_reconciliations
             WHERE departure_id=$1 AND passenger_id=$2`, [departureId, participant.passengerId],
          );
          reconciliation = state.rows[0]?.status ?? null;
        }
        if (participant.role === 'passenger') {
          const reviewResult = await client.query(
            `SELECT id,captain_tags,boat_tags,body,created_at
             FROM step5_trip_reviews WHERE order_id=$1 AND reviewer_user_id=$2`,
            [participant.orderId, request.user.id],
          );
          if (reviewResult.rowCount) {
            const row = reviewResult.rows[0];
            review = { id: row.id, captainTags: row.captain_tags, boatTags: row.boat_tags, body: row.body, createdAt: row.created_at };
          }
        }
        return { role: participant.role, departureId, captainReport: captain, ownReport: own, captainResponse: response, reconciliation, review };
      });
      if (result.error) return sendError(reply, result.error[0], result.error[1]);
      return result;
    });

  app.post('/step5/orders/:id/review',
    { preHandler: [requireUser, requirePool] }, async (request, reply) => {
      const orderId = String(request.params.id ?? '');
      if (!UUID.test(orderId)) return sendError(reply, 400, '订单编号无效');
      const captainTags = request.body?.captainTags ?? [];
      const boatTags = request.body?.boatTags ?? [];
      const body = String(request.body?.body ?? '').trim();
      if (!validateTags(captainTags, CAPTAIN_TAGS) || !validateTags(boatTags, BOAT_TAGS) || body.length > 1000) {
        return sendError(reply, 400, '评价标签或文字格式不正确');
      }
      if (!captainTags.length && !boatTags.length && !body) return sendError(reply, 400, '请至少选择一项标签或填写评价');
      try {
        const result = await transaction(pool, async (client) => {
          const order = await client.query('SELECT departure_id FROM booking_orders WHERE id=$1', [orderId]);
          if (!order.rowCount) return { error: [404, '订单不存在'] };
          const participant = await authorizeParticipant(
            client, order.rows[0].departure_id, request.user, security, orderId,
          );
          if (participant.error) return participant;
          if (participant.role !== 'passenger' || participant.orderId !== orderId) {
            return { error: [403, '仅本人实际出航订单可评价'] };
          }
          const saved = await client.query(
            `INSERT INTO step5_trip_reviews
               (order_id,departure_id,reviewer_user_id,passenger_id,captain_user_id,boat_id,captain_tags,boat_tags,body)
             SELECT o.id,d.id,$2,$3,d.captain_user_id,d.boat_id,$4,$5,$6
             FROM booking_orders o JOIN departures d ON d.id=o.departure_id
             WHERE o.id=$1 ON CONFLICT (order_id) DO NOTHING RETURNING id,created_at`,
            [orderId, request.user.id, participant.passengerId, captainTags, boatTags, body],
          );
          if (!saved.rowCount) return { error: [409, '该订单的返港评价已提交，原始评价不会被覆盖'] };
          return saved.rows[0];
        });
        if (result.error) return sendError(reply, result.error[0], result.error[1]);
        return reply.code(201).send({ ok: true, review: result });
      } catch (error) {
        request.log.error({ err: error }, 'Step 5 trip review failed');
        return sendError(reply, 500, '评价暂时未能保存');
      }
    });

  app.get('/step5/me/fish-atlas', { preHandler: [requireUser, requirePool] }, async (request) => {
    const result = await pool.query(
      `WITH personal AS (
         SELECT i.fish_code,min(r.created_at) AS first_caught
         FROM step5_catch_reports r JOIN step5_catch_items i ON i.report_id=r.id
         WHERE r.author_user_id=$1 AND r.source='passenger' GROUP BY i.fish_code
       ), confirmed AS (
         SELECT i.fish_code,min(response.created_at) AS first_caught
         FROM step5_catch_report_responses response
         JOIN step5_catch_items i ON i.report_id=response.captain_report_id
         WHERE response.responder_user_id=$1 AND response.action='confirm' GROUP BY i.fish_code
       ), supplements AS (
         SELECT i.fish_code,min(response.created_at) AS first_caught
         FROM step5_catch_report_responses response
         JOIN step5_catch_response_items i ON i.response_id=response.id
         WHERE response.responder_user_id=$1 AND response.action='supplement' GROUP BY i.fish_code
       ), all_sources AS (
         SELECT fish_code,first_caught FROM personal
         UNION ALL SELECT fish_code,first_caught FROM confirmed
         UNION ALL SELECT fish_code,first_caught FROM supplements
       )
       SELECT fish_code,min(first_caught) AS first_caught FROM all_sources GROUP BY fish_code ORDER BY fish_code`,
      [request.user.id],
    );
    return {
      items: result.rows.map((row) => ({
        fishCode: row.fish_code,
        fishName: FISH_BY_CODE.get(row.fish_code)?.name ?? row.fish_code,
        firstCaughtAt: row.first_caught,
      })),
      sourceRule: '本人渔获、本人补充，或本人确认的船长记录；船长单方记录不会点亮。',
    };
  });

  app.get('/step5/me/captain-facts', { preHandler: [requireUser, requirePool] }, async (request, reply) => {
    if (!request.user.captain_status) return sendError(reply, 403, '仅船长账号可查看船长事实');
    return captainFacts(pool, request.user.id, security);
  });

  app.get('/step5/captains/:id/facts', { preHandler: requirePool }, async (request, reply) => {
    const captainId = String(request.params.id ?? '');
    if (!UUID.test(captainId)) return sendError(reply, 400, '船长编号无效');
    const exists = await pool.query('SELECT 1 FROM captain_profiles WHERE user_id=$1', [captainId]);
    if (!exists.rowCount) return sendError(reply, 404, '船长档案不存在');
    return captainFacts(pool, captainId, security);
  });

  app.get('/step5/boats/:id/facts', { preHandler: requirePool }, async (request, reply) => {
    const boatId = String(request.params.id ?? '');
    if (!UUID.test(boatId)) return sendError(reply, 400, '船档案编号无效');
    const boat = await pool.query('SELECT id FROM boats WHERE id=$1', [boatId]);
    if (!boat.rowCount) return sendError(reply, 404, '船档案不存在');
    const [reviews, reviewCount, crossSource, recent] = await Promise.all([
      pool.query(
        `SELECT tag,count(*)::integer AS count FROM (
           SELECT unnest(boat_tags) AS tag FROM step5_trip_reviews
           WHERE boat_id=$1 AND created_at >= now()-interval '12 months'
         ) tags GROUP BY tag ORDER BY tag`, [boatId],
      ),
      pool.query(
        `SELECT count(*)::integer AS count FROM step5_trip_reviews
         WHERE boat_id=$1 AND created_at >= now()-interval '12 months'`, [boatId],
      ),
      pool.query(
        `SELECT count(*)::integer AS sample_count,
                count(*) FILTER (WHERE reconciliation.status='pending_review')::integer AS pending_count
         FROM step5_catch_reconciliations reconciliation
         JOIN departures d ON d.id=reconciliation.departure_id
         JOIN departure_checkins returned ON returned.departure_id=d.id AND returned.event='returned'
         WHERE d.boat_id=$1 AND d.status='completed'
           AND d.return_at >= now()-interval '12 months'`, [boatId],
      ),
      pool.query(
        `SELECT r.id,r.outcome,r.created_at,i.fish_code,i.quantity
         FROM step5_catch_reports r JOIN departures d ON d.id=r.departure_id
         LEFT JOIN step5_catch_items i ON i.report_id=r.id
         JOIN departure_checkins returned ON returned.departure_id=d.id AND returned.event='returned'
         WHERE d.boat_id=$1 AND d.status='completed' AND r.source='captain'
         ORDER BY r.created_at DESC,i.fish_code LIMIT 24`, [boatId],
      ),
    ]);
    const recentReports = new Map();
    for (const row of recent.rows) {
      const key = row.id;
      const entry = recentReports.get(key) ?? { outcome: row.outcome, reportedAt: row.created_at, items: [] };
      if (row.fish_code) entry.items.push({
        fishCode: row.fish_code, fishName: FISH_BY_CODE.get(row.fish_code)?.name ?? row.fish_code,
        quantity: Number(row.quantity),
      });
      recentReports.set(key, entry);
    }
    return {
      boatId,
      reviewSampleWindowMonths: 12,
      reviewCount: Number(reviewCount.rows[0].count),
      conditionTagCounts: reviews.rows.map((row) => ({ tag: row.tag, count: Number(row.count) })),
      crossSourceChecks: {
        sampleWindowMonths: 12,
        sampleCount: Number(crossSource.rows[0].sample_count),
        pendingReviewCount: Number(crossSource.rows[0].pending_count),
        pendingReviewRatePercent: Number(crossSource.rows[0].sample_count)
          ? Math.round((Number(crossSource.rows[0].pending_count) / Number(crossSource.rows[0].sample_count)) * 1000) / 10
          : null,
      },
      recentCatchReports: [...recentReports.values()].slice(0, 6),
      note: '船况标签与船长能力事实分开呈现，不生成评分或排名。',
    };
  });
}
