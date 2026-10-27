import { randomBytes } from 'node:crypto';
import { createSecurity } from './security.js';
import { FISH_CATALOG } from './step2-catalog.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEMPLATE_VERSION = 'qd-cert-v1';
const CANDIDATE_PAGE_SIZE = 100;
const MAX_ELIGIBLE_DEPARTURES = 100;
const FISH_BY_CODE = new Map(FISH_CATALOG.map((fish) => [fish.code, fish]));
const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });

function normalizeIdentity(value) {
  return String(value ?? '').replace(/\s/g, '').toUpperCase();
}

function certificateBaseUrl(config) {
  try {
    const parsed = new URL(String(config.promotionPublicBaseUrl ?? 'http://localhost:3000').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'http://localhost:3000';
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return 'http://localhost:3000';
  }
}

function certificateLandingUrl(baseUrl, code) {
  return `${baseUrl}/p/${encodeURIComponent(code)}?source=certificate`;
}

async function transaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    if (value?.error) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function readVerifiedIdentity(client, userId, security) {
  const result = await client.query(
    `SELECT identity_status,identity_number_ciphertext,display_name
     FROM users WHERE id=$1`, [userId],
  );
  if (!result.rowCount || result.rows[0].identity_status !== 'verified'
      || !result.rows[0].identity_number_ciphertext) {
    return { error: [403, '仅实名验证通过的实际出航乘客可生成证书'] };
  }
  try {
    return {
      identity: normalizeIdentity(security.decrypt(result.rows[0].identity_number_ciphertext)),
      displayName: String(result.rows[0].display_name ?? '').trim() || '钓友',
    };
  } catch {
    return { error: [403, '实名信息无法核对'] };
  }
}

async function loadDeparture(client, departureId, lockForWrite = false) {
  const result = await client.query(
    `SELECT d.id,d.departure_at,d.status,d.captain_user_id,b.name AS boat_name,
            cp.captain_name,
            EXISTS (SELECT 1 FROM departure_checkins dc
                    WHERE dc.departure_id=d.id AND dc.event='departed'
                      AND dc.captain_user_id=d.captain_user_id) AS departed,
            EXISTS (SELECT 1 FROM departure_checkins rc
                    WHERE rc.departure_id=d.id AND rc.event='returned'
                      AND rc.captain_user_id=d.captain_user_id) AS returned
     FROM departures d JOIN boats b ON b.id=d.boat_id
     JOIN captain_profiles cp ON cp.user_id=d.captain_user_id
     WHERE d.id=$1${lockForWrite ? ' FOR UPDATE OF d' : ''}`,
    [departureId],
  );
  if (!result.rowCount) return { error: [404, '班次不存在'] };
  const departure = result.rows[0];
  if (departure.status !== 'completed' || !departure.departed || !departure.returned) {
    return { error: [409, '仅已完成且已完成出返航打卡的班次可生成证书'] };
  }
  return { departure };
}

async function findPassenger(client, departureId) {
  return client.query(
    `SELECT o.id AS order_id,op.id AS passenger_id,op.identity_number_ciphertext
     FROM booking_orders o
     JOIN order_passengers op ON op.order_id=o.id
     JOIN departure_passenger_gate_decisions gate
       ON gate.departure_id=o.departure_id AND gate.passenger_id=op.id AND gate.decision='allowed'
     WHERE o.departure_id=$1 AND o.status IN ('paid','completed')
     ORDER BY op.id`, [departureId],
  );
}

async function matchPassenger(client, departureId, identity, security) {
  const result = await findPassenger(client, departureId);
  for (const row of result.rows) {
    try {
      if (normalizeIdentity(security.decrypt(row.identity_number_ciphertext)) === identity) return row;
    } catch {
      // An unreadable manifest entry is not an authorization match.
    }
  }
  return null;
}

async function queryCatchItems(client, query, values, source) {
  const result = await client.query(query, values);
  return result.rows.map((row) => ({
    fishCode: row.fish_code,
    fishName: FISH_BY_CODE.get(row.fish_code)?.name ?? row.fish_code,
    quantity: Number(row.quantity),
    maxIndividualWeightGrams: row.max_individual_weight_grams == null
      ? null : Number(row.max_individual_weight_grams),
    maxLengthMm: row.max_length_mm == null ? null : Number(row.max_length_mm),
    source,
  }));
}

async function loadCertificateFacts(client, departureId, userId, security, lockForWrite = false) {
  const departureResult = await loadDeparture(client, departureId, lockForWrite);
  if (departureResult.error) return departureResult;
  const identityResult = await readVerifiedIdentity(client, userId, security);
  if (identityResult.error) return identityResult;
  const passenger = await matchPassenger(client, departureId, identityResult.identity, security);
  if (!passenger) return { error: [403, '当前账号不是该班次保险门禁允许的实际乘客'] };

  const passengerId = passenger.passenger_id;
  const ownReportResult = await client.query(
    `SELECT id,outcome FROM step5_catch_reports
     WHERE departure_id=$1 AND source='passenger' AND author_user_id=$2
       AND passenger_id=$3 AND order_id=$4`,
    [departureId, userId, passengerId, passenger.order_id],
  );
  const ownReport = ownReportResult.rows[0] ?? null;
  const ownStateResult = await client.query(
    `SELECT status FROM step5_catch_reconciliations
     WHERE departure_id=$1 AND passenger_id=$2`, [departureId, passengerId],
  );
  const ownPending = ownStateResult.rows[0]?.status === 'pending_review';
  const anyPendingResult = await client.query(
    `SELECT EXISTS (SELECT 1 FROM step5_catch_reconciliations
                    WHERE departure_id=$1 AND status='pending_review') AS value`, [departureId],
  );
  const anyPending = anyPendingResult.rows[0]?.value === true;
  const items = [];
  const sourceRefs = { passengerReportId: null, captainReportId: null, responseIds: [] };

  if (ownReport && ownReport.outcome === 'caught' && !ownPending) {
    const ownItems = await queryCatchItems(
      client,
      `SELECT fish_code,quantity,max_individual_weight_grams,max_length_mm
       FROM step5_catch_items WHERE report_id=$1 ORDER BY fish_code`,
      [ownReport.id], '本人记录',
    );
    items.push(...ownItems);
    if (ownItems.length) sourceRefs.passengerReportId = ownReport.id;
  }

  if (!ownPending) {
    const responseResult = await client.query(
      `SELECT r.id AS captain_report_id,r.outcome,response.id AS response_id,
              response.action,reconciliation.status AS reconciliation_status
       FROM step5_catch_reconciliations reconciliation
       JOIN step5_catch_reports r
         ON r.id=reconciliation.captain_report_id AND r.source='captain'
       JOIN step5_catch_report_responses response
         ON response.captain_report_id=r.id
        AND response.passenger_id=reconciliation.passenger_id
        AND response.responder_user_id=$3
       WHERE reconciliation.departure_id=$1 AND reconciliation.passenger_id=$2`,
      [departureId, passengerId, userId],
    );
    const response = responseResult.rows[0];
    if (response?.action === 'confirm' && response.reconciliation_status === 'confirmed' && !anyPending
        && response.outcome === 'caught') {
      const captainItems = await queryCatchItems(
        client,
        `SELECT fish_code,quantity,max_individual_weight_grams,max_length_mm
         FROM step5_catch_items WHERE report_id=$1 ORDER BY fish_code`,
        [response.captain_report_id], '船长整船记录（本人确认）',
      );
      items.push(...captainItems);
      if (captainItems.length) sourceRefs.captainReportId = response.captain_report_id;
      sourceRefs.responseIds.push(response.response_id);
    } else if (response?.action === 'supplement'
        && response.reconciliation_status === 'supplemented') {
      const supplements = await queryCatchItems(
        client,
        `SELECT item.fish_code,item.quantity,item.max_individual_weight_grams,item.max_length_mm
         FROM step5_catch_response_items item WHERE item.response_id=$1 ORDER BY item.fish_code`,
        [response.response_id], '本人补充',
      );
      items.push(...supplements);
      if (supplements.length) sourceRefs.responseIds.push(response.response_id);
    }
  }

  if (!items.length) return { error: [409, ownPending
    ? '渔获正在待核对，本航次暂不能生成证书'
    : '当前没有可用于证书的已确认渔获记录'] };

  return {
    departureId,
    orderId: passenger.order_id,
    passengerId,
    departure: departureResult.departure,
    displayName: identityResult.displayName,
    items,
    sourceRefs,
  };
}

async function ensureMemberPromotionCode(client, userId) {
  await client.query(
    `INSERT INTO promotion_codes (owner_user_id,code,channel,status)
     VALUES ($1,$2,'member','active')
     ON CONFLICT (owner_user_id,channel) DO NOTHING`,
    [userId, randomBytes(8).toString('hex').toUpperCase()],
  );
  const result = await client.query(
    `SELECT id,code,status FROM promotion_codes
     WHERE owner_user_id=$1 AND channel='member'`, [userId],
  );
  const code = result.rows[0];
  if (!code || code.status !== 'active') return null;
  return code;
}

function publicCertificate(row) {
  return {
    id: row.id,
    templateVersion: row.template_version,
    generatedAt: row.generated_at,
    hidden: row.hidden_at != null,
    snapshot: row.snapshot,
  };
}

export function registerStep6CertificateRoutes(app, { pool, config, requireUser }) {
  const security = createSecurity(config);
  const baseUrl = certificateBaseUrl(config);
  const requirePool = async (_request, reply) => {
    if (!pool) return sendError(reply, 503, '证书服务暂不可用');
  };

  app.get('/step6/certificates/me',
    { preHandler: [requireUser, requirePool] }, async (request, reply) => {
      try {
        return await transaction(pool, async (client) => {
          const existing = await client.query(
            `SELECT id,template_version,generated_at,hidden_at,snapshot
             FROM step6_certificates WHERE owner_user_id=$1 AND hidden_at IS NULL
             ORDER BY generated_at DESC,id DESC`, [request.user.id],
          );
          const certificates = existing.rows.map(publicCertificate);
          const identityResult = await readVerifiedIdentity(client, request.user.id, security);
          if (identityResult.error) return { certificates, eligibleDepartures: [] };
          const eligibleDepartures = [];
          let cursor = null;
          while (eligibleDepartures.length < MAX_ELIGIBLE_DEPARTURES) {
            const cursorClause = cursor
              ? 'AND (d.departure_at,d.id)<($1::timestamptz,$2::uuid)'
              : '';
            const limitParameter = cursor ? '$3' : '$1';
            const values = cursor
              ? [cursor.departure_at, cursor.id, CANDIDATE_PAGE_SIZE]
              : [CANDIDATE_PAGE_SIZE];
            const candidates = await client.query(
              `SELECT DISTINCT d.id,d.departure_at
               FROM departures d
               JOIN booking_orders o ON o.departure_id=d.id AND o.status IN ('paid','completed')
               JOIN order_passengers op ON op.order_id=o.id
               JOIN departure_passenger_gate_decisions gate
                 ON gate.departure_id=d.id AND gate.passenger_id=op.id AND gate.decision='allowed'
               WHERE d.status='completed'
                 AND EXISTS (SELECT 1 FROM departure_checkins dc WHERE dc.departure_id=d.id
                             AND dc.event='departed' AND dc.captain_user_id=d.captain_user_id)
                 AND EXISTS (SELECT 1 FROM departure_checkins rc WHERE rc.departure_id=d.id
                             AND rc.event='returned' AND rc.captain_user_id=d.captain_user_id)
                 ${cursorClause}
               ORDER BY d.departure_at DESC,d.id DESC LIMIT ${limitParameter}`,
              values,
            );
            if (!candidates.rows.length) break;
            for (const candidate of candidates.rows) {
              const alreadyGenerated = await client.query(
                'SELECT 1 FROM step6_certificates WHERE owner_user_id=$1 AND departure_id=$2',
                [request.user.id, candidate.id],
              );
              if (alreadyGenerated.rowCount) continue;
              const facts = await loadCertificateFacts(client, candidate.id, request.user.id, security);
              if (facts.error) continue;
              eligibleDepartures.push({
                departureId: facts.departureId,
                departureAt: facts.departure.departure_at,
                boatName: facts.departure.boat_name,
                captainName: facts.departure.captain_name,
                displayName: facts.displayName,
                fishSummary: facts.items.map((item) => `${item.fishName} × ${item.quantity}`),
              });
              if (eligibleDepartures.length >= MAX_ELIGIBLE_DEPARTURES) break;
            }
            if (candidates.rows.length < CANDIDATE_PAGE_SIZE) break;
            cursor = candidates.rows.at(-1);
          }
          return { certificates, eligibleDepartures };
        });
      } catch (error) {
        request.log.error({ err: error }, 'Step 6 certificate list failed');
        return sendError(reply, 503, '证书列表暂不可用');
      }
    });

  app.get('/step6/certificates/departures/:id/preview',
    { preHandler: [requireUser, requirePool] }, async (request, reply) => {
      const departureId = String(request.params.id ?? '');
      if (!UUID.test(departureId)) return sendError(reply, 400, '班次编号无效');
      try {
        const result = await transaction(pool, async (client) => {
          const existing = await client.query(
            `SELECT id,template_version,generated_at,hidden_at,snapshot
             FROM step6_certificates WHERE owner_user_id=$1 AND departure_id=$2`,
            [request.user.id, departureId],
          );
          if (existing.rowCount) return { certificate: publicCertificate(existing.rows[0]) };
          const facts = await loadCertificateFacts(client, departureId, request.user.id, security);
          if (facts.error) return facts;
          const promotion = await ensureMemberPromotionCode(client, request.user.id);
          if (!promotion) return { error: [409, '会员推广码暂不可用，请联系支持'] };
          const snapshot = {
            templateVersion: TEMPLATE_VERSION,
            departureAt: facts.departure.departure_at,
            boatName: facts.departure.boat_name,
            captainName: facts.departure.captain_name,
            displayName: facts.displayName,
            fishItems: facts.items,
            promotionCode: promotion.code,
            landingUrl: certificateLandingUrl(baseUrl, promotion.code),
          };
          return { preview: snapshot };
        });
        if (result.error) return sendError(reply, result.error[0], result.error[1]);
        if (!result.preview) {
          result.certificate.snapshot.landingUrl ??= certificateLandingUrl(
            baseUrl, result.certificate.snapshot.promotionCode,
          );
        }
        return result;
      } catch (error) {
        request.log.error({ err: error }, 'Step 6 certificate preview failed');
        return sendError(reply, 503, '证书预览暂不可用');
      }
    });

  app.post('/step6/certificates',
    { preHandler: [requireUser, requirePool] }, async (request, reply) => {
      const departureId = String(request.body?.departureId ?? '');
      if (!UUID.test(departureId)) return sendError(reply, 400, '班次编号无效');
      try {
        const result = await transaction(pool, async (client) => {
          const existing = await client.query(
            `SELECT id,template_version,generated_at,hidden_at,snapshot
             FROM step6_certificates WHERE owner_user_id=$1 AND departure_id=$2 FOR UPDATE`,
            [request.user.id, departureId],
          );
          if (existing.rowCount) return { certificate: publicCertificate(existing.rows[0]), created: false };
          const facts = await loadCertificateFacts(client, departureId, request.user.id, security, true);
          if (facts.error) return facts;
          const promotion = await ensureMemberPromotionCode(client, request.user.id);
          if (!promotion) return { error: [409, '会员推广码暂不可用，请联系支持'] };
          const generatedAt = new Date().toISOString();
          const landingUrl = certificateLandingUrl(baseUrl, promotion.code);
          const snapshot = {
            templateVersion: TEMPLATE_VERSION,
            departureAt: facts.departure.departure_at,
            boatName: facts.departure.boat_name,
            captainName: facts.departure.captain_name,
            displayName: facts.displayName,
            fishItems: facts.items,
            promotionCode: promotion.code,
            landingUrl,
            generatedAt,
          };
          const inserted = await client.query(
            `INSERT INTO step6_certificates
               (owner_user_id,departure_id,order_id,passenger_id,promotion_code_id,
                promotion_code_snapshot,template_version,source_refs,snapshot,generated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::timestamptz)
             ON CONFLICT (owner_user_id,departure_id) DO NOTHING
             RETURNING id,template_version,generated_at,hidden_at,snapshot`,
            [request.user.id, departureId, facts.orderId, facts.passengerId, promotion.id,
              promotion.code, TEMPLATE_VERSION, JSON.stringify(facts.sourceRefs),
              JSON.stringify(snapshot), generatedAt],
          );
          if (inserted.rowCount) {
            return { certificate: publicCertificate(inserted.rows[0]), created: true };
          }
          const raced = await client.query(
            `SELECT id,template_version,generated_at,hidden_at,snapshot
             FROM step6_certificates WHERE owner_user_id=$1 AND departure_id=$2`,
            [request.user.id, departureId],
          );
          return { certificate: publicCertificate(raced.rows[0]), created: false };
        });
        if (result.error) return sendError(reply, result.error[0], result.error[1]);
        return reply.code(result.created ? 201 : 200).send(result);
      } catch (error) {
        request.log.error({ err: error }, 'Step 6 certificate generation failed');
        return sendError(reply, 503, '证书暂未生成，请稍后重试');
      }
    });

  app.delete('/step6/certificates/:id',
    { preHandler: [requireUser, requirePool] }, async (request, reply) => {
      const certificateId = String(request.params.id ?? '');
      if (!UUID.test(certificateId)) return sendError(reply, 400, '证书编号无效');
      const result = await pool.query(
        `UPDATE step6_certificates SET hidden_at=COALESCE(hidden_at,now())
         WHERE id=$1 AND owner_user_id=$2 RETURNING id`,
        [certificateId, request.user.id],
      );
      if (!result.rowCount) return sendError(reply, 404, '证书不存在');
      return { ok: true, hidden: true };
    });
}
