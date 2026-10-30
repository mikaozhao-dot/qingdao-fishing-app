import { step1Options } from './step1-routes.js';
import { FISH_CATALOG, TARGET_AREAS } from './step2-catalog.js';
import {
  serializeMemberActivityRequest,
  validateMemberActivityRequestFilters,
  validateMemberActivityRequest,
} from './member-activity-service.js';

const REQUEST_COLUMNS = `id,member_user_id,departure_date,requested_start_at,requested_end_at,
  marina_code,target_area_code,party_size,booking_type,fish_codes,fishing_methods,
  min_budget_fen,max_budget_fen,gear_requirements,beginner_friendly,children_allowed,
  notes,status,expires_at,converted_departure_id,created_at,updated_at`;
const MAX_ACTIVE_REQUESTS = 3;
const MAX_DAILY_REQUESTS = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sendError(reply, statusCode, message) {
  return reply.code(statusCode).send({ error: message });
}

function validateBody(body, now) {
  return validateMemberActivityRequest(body, {
    marinaCodes: new Set(Object.keys(step1Options.marinas)),
    targetAreaCodes: new Set(Object.keys(TARGET_AREAS)),
    fishCodes: new Set(FISH_CATALOG.map(({ code }) => code)),
    now,
  });
}

function validateFilters(query) {
  return validateMemberActivityRequestFilters(query, {
    marinaCodes: new Set(Object.keys(step1Options.marinas)),
    fishCodes: new Set(FISH_CATALOG.map(({ code }) => code)),
  });
}

function valuesForRequest(value) {
  return [
    value.departureDate,
    value.requestedStartAt.toISOString(),
    value.requestedEndAt.toISOString(),
    value.marinaCode,
    value.targetAreaCode,
    value.partySize,
    value.bookingType,
    value.fishCodes,
    value.fishingMethods,
    value.minBudgetFen,
    value.maxBudgetFen,
    value.gearRequirements,
    value.beginnerFriendly,
    value.childrenAllowed,
    value.notes,
  ];
}

async function recordFact(client, { requestId, actorUserId = null, factType, details = {} }) {
  await client.query(
    `INSERT INTO member_activity_facts (request_id,actor_user_id,fact_type,details)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [requestId, actorUserId, factType, JSON.stringify(details)],
  );
}

export async function expireMemberActivityRequests(db) {
  const result = await db.query(
    `WITH expired AS (
       UPDATE member_activity_requests
       SET status='expired',updated_at=now()
       WHERE status='published' AND expires_at<=now()
       RETURNING id
     )
     INSERT INTO member_activity_facts (request_id,fact_type,details)
     SELECT id,'request_expired','{"source":"automatic_expiry"}'::jsonb FROM expired
     RETURNING request_id`,
  );
  return result.rowCount;
}

function registerExpiryWorker(app, { pool, config }) {
  if (!pool || config.nodeEnv === 'test') return;
  const timer = setInterval(() => {
    expireMemberActivityRequests(pool).catch((error) =>
      app.log.warn({ err: error }, 'Member activity expiry worker failed'));
  }, 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

export function registerMemberActivityRoutes(app, { pool, config, requireUser, clockNow = () => new Date() }) {
  registerExpiryWorker(app, { pool, config });

  app.post('/member/activity-requests', { preHandler: requireUser }, async (request, reply) => {
    const validated = validateBody(request.body, clockNow());
    if (validated.error) return sendError(reply, 400, validated.error);
    await expireMemberActivityRequests(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const member = await client.query(
        `SELECT id FROM users
         WHERE id=$1 AND identity_status='verified' AND identity_verified_at IS NOT NULL
         FOR UPDATE`, [request.user.id],
      );
      if (!member.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 403, '请先完成实名核验后再发布需求');
      }
      const activeCount = await client.query(
        `SELECT count(*)::integer AS count FROM member_activity_requests
         WHERE member_user_id=$1 AND status='published' AND expires_at>now()`,
        [request.user.id],
      );
      if (Number(activeCount.rows[0]?.count ?? 0) >= MAX_ACTIVE_REQUESTS) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '同时有效的需求单最多 3 条');
      }
      const dailyCount = await client.query(
        `SELECT count(*)::integer AS count FROM member_activity_requests
         WHERE member_user_id=$1
           AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
           AND created_at < (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') + interval '1 day') AT TIME ZONE 'Asia/Shanghai'`,
        [request.user.id],
      );
      if (Number(dailyCount.rows[0]?.count ?? 0) >= MAX_DAILY_REQUESTS) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '自然日新发需求单最多 3 条');
      }

      const value = validated.value;
      const inserted = await client.query(
        `INSERT INTO member_activity_requests
           (member_user_id,departure_date,requested_start_at,requested_end_at,marina_code,
            target_area_code,party_size,booking_type,fish_codes,fishing_methods,min_budget_fen,
            max_budget_fen,gear_requirements,beginner_friendly,children_allowed,notes,expires_at)
         VALUES ($1,$2::date,$3::timestamptz,$4::timestamptz,$5,$6,$7,$8,$9::varchar[],$10::text[],
            $11,$12,$13,$14,$15,$16,
            LEAST($3::timestamptz, now()+interval '7 days'))
         RETURNING ${REQUEST_COLUMNS}`,
        [request.user.id, ...valuesForRequest(value)],
      );
      const activity = inserted.rows[0];
      await recordFact(client, {
        requestId: activity.id,
        actorUserId: request.user.id,
        factType: 'request_published',
        details: { bookingType: activity.booking_type, partySize: Number(activity.party_size) },
      });
      await client.query('COMMIT');
      return reply.code(201).send({ request: serializeMemberActivityRequest(activity) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Member activity request publish failed');
      return sendError(reply, 500, '需求单发布失败，请稍后重试');
    } finally {
      client.release();
    }
  });

  app.get('/captain/member/activity-requests', { preHandler: requireUser }, async (request, reply) => {
    const filters = validateFilters(request.query ?? {});
    if (filters.error) return sendError(reply, 400, filters.error);
    const captain = await pool.query(
      `SELECT 1 FROM captain_profiles
       WHERE user_id=$1 AND verification_status='approved'`, [request.user.id],
    );
    if (!captain.rowCount) return sendError(reply, 403, '仅已审核船长可以浏览需求广场');

    await expireMemberActivityRequests(pool);
    const values = [clockNow().toISOString()];
    const conditions = ["status='published'", 'expires_at > $1'];
    const addFilter = (condition, value) => {
      values.push(value);
      conditions.push(condition.replace('?', `$${values.length}`));
    };
    if (filters.value.marinaCode) addFilter('marina_code=?', filters.value.marinaCode);
    if (filters.value.departureDate) addFilter('departure_date=?::date', filters.value.departureDate);
    if (filters.value.partySize !== null) addFilter('party_size=?::smallint', filters.value.partySize);
    if (filters.value.fishCode) addFilter('fish_codes @> ARRAY[?::varchar]', filters.value.fishCode);
    if (filters.value.bookingType) addFilter('booking_type=?', filters.value.bookingType);

    const result = await pool.query(
      `SELECT ${REQUEST_COLUMNS} FROM member_activity_requests
       WHERE ${conditions.join(' AND ')}
       ORDER BY requested_start_at ASC,created_at DESC,id ASC LIMIT 100`,
      values,
    );
    return { items: result.rows.map(serializeMemberActivityRequest) };
  });

  app.get('/member/activity-requests', { preHandler: requireUser }, async (request) => {
    await expireMemberActivityRequests(pool);
    const result = await pool.query(
      `SELECT ${REQUEST_COLUMNS} FROM member_activity_requests
       WHERE member_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,
      [request.user.id],
    );
    return { items: result.rows.map(serializeMemberActivityRequest) };
  });

  app.get('/member/activity-requests/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!UUID_PATTERN.test(request.params.id)) return sendError(reply, 400, '需求单编号无效');
    await expireMemberActivityRequests(pool);
    const result = await pool.query(
      `SELECT ${REQUEST_COLUMNS} FROM member_activity_requests
       WHERE id=$1 AND member_user_id=$2`, [request.params.id, request.user.id],
    );
    if (!result.rowCount) return sendError(reply, 404, '需求单不存在');
    return { request: serializeMemberActivityRequest(result.rows[0]) };
  });

  app.put('/member/activity-requests/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!UUID_PATTERN.test(request.params.id)) return sendError(reply, 400, '需求单编号无效');
    const validated = validateBody(request.body, clockNow());
    if (validated.error) return sendError(reply, 400, validated.error);
    await expireMemberActivityRequests(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const member = await client.query(
        `SELECT id FROM users
         WHERE id=$1 AND identity_status='verified' AND identity_verified_at IS NOT NULL
         FOR UPDATE`, [request.user.id],
      );
      if (!member.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 403, '请先完成实名核验后再编辑需求');
      }
      const value = validated.value;
      const updated = await client.query(
        `UPDATE member_activity_requests SET
           departure_date=$3::date,requested_start_at=$4::timestamptz,requested_end_at=$5::timestamptz,
           marina_code=$6,target_area_code=$7,party_size=$8,booking_type=$9,fish_codes=$10::varchar[],
           fishing_methods=$11::text[],min_budget_fen=$12,max_budget_fen=$13,gear_requirements=$14,
           beginner_friendly=$15,children_allowed=$16,notes=$17,
           expires_at=LEAST($4::timestamptz,created_at+interval '7 days'),
           updated_at=now()
         WHERE id=$1 AND member_user_id=$2 AND status='published' AND expires_at>now()
         RETURNING ${REQUEST_COLUMNS}`,
        [request.params.id, request.user.id, ...valuesForRequest(value)],
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '需求单已关闭、转化或下架，不能编辑');
      }
      await recordFact(client, {
        requestId: request.params.id,
        actorUserId: request.user.id,
        factType: 'request_edited',
        details: { updatedAt: updated.rows[0].updated_at },
      });
      await client.query('COMMIT');
      return { request: serializeMemberActivityRequest(updated.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Member activity request edit failed');
      return sendError(reply, 500, '需求单编辑失败，请稍后重试');
    } finally {
      client.release();
    }
  });

  app.post('/member/activity-requests/:id/close', { preHandler: requireUser }, async (request, reply) => {
    if (!UUID_PATTERN.test(request.params.id)) return sendError(reply, 400, '需求单编号无效');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const closed = await client.query(
        `UPDATE member_activity_requests SET status='closed',updated_at=now()
         WHERE id=$1 AND member_user_id=$2 AND status='published' AND expires_at>now()
         RETURNING id`, [request.params.id, request.user.id],
      );
      if (!closed.rowCount) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, '需求单已关闭、转化或下架');
      }
      await recordFact(client, {
        requestId: request.params.id,
        actorUserId: request.user.id,
        factType: 'request_closed',
        details: { source: 'member_action' },
      });
      await client.query('COMMIT');
      return { id: closed.rows[0].id, status: 'closed' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Member activity request close failed');
      return sendError(reply, 500, '需求单关闭失败，请稍后重试');
    } finally {
      client.release();
    }
  });
}
