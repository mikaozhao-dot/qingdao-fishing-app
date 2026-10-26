import { randomBytes } from 'node:crypto';
import { createSecurity } from './security.js';
import {
  backfillIdentityNumberHashes,
  releaseMaturedPromotions,
  syncPromotionForUser,
} from './promotion-service.js';

const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });
const VALID_CHANNELS = new Set(['member', 'hotel', 'travel_agency', 'creator', 'captain', 'marina']);
const BUSINESS_CHANNELS = new Set(['hotel', 'travel_agency', 'marina']);
const TOUCH_SOURCES = new Set(['qr', 'share', 'link']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROMO_COOKIE = 'qd_promo_visitor';
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

const validUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function sourceFromQuery(value) {
  return TOUCH_SOURCES.has(value) ? value : 'qr';
}

function promotionBaseUrl(config) {
  const candidate = String(config.promotionPublicBaseUrl ?? 'http://localhost:3000').trim();
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'http://localhost:3000';
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return 'http://localhost:3000';
  }
}

function landingUrl(baseUrl, code, source = 'qr') {
  return `${baseUrl}/p/${encodeURIComponent(code)}?source=${encodeURIComponent(source)}`;
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function readCookie(request, name) {
  const cookieHeader = String(request.headers.cookie ?? '');
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function createVisitorToken(request, security) {
  const current = readCookie(request, PROMO_COOKIE);
  const currentId = current ? security.promotionVisitorId(current) : null;
  return currentId ? { token: current, visitorId: currentId, isNew: false }
    : { token: security.newPromotionVisitorToken(), visitorId: null, isNew: true };
}

function qrLandingPage({ code, visitorToken, baseUrl, source }) {
  const appLink = `yuediaozhe://promotion?code=${encodeURIComponent(code)}&source=${encodeURIComponent(source)}&ref=${encodeURIComponent(visitorToken)}`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>约钓者推广</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#071c28;color:#eef6f4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:520px;margin:0 auto;padding:36px 22px 48px}.brand{color:#b8f500;font-size:13px;letter-spacing:.18em}.card{margin-top:22px;padding:26px;border:1px solid #294553;border-radius:24px;background:linear-gradient(145deg,#113141,#0b2532 65%,#102d3b);box-shadow:0 22px 60px #0006}.eyebrow{color:#b8f500;font-size:12px}.title{font-size:30px;line-height:1.24;margin:12px 0}.sub{color:#afc2c7;line-height:1.7}.code{margin:24px 0;padding:16px;text-align:center;border:1px dashed #739398;border-radius:14px;font-size:22px;letter-spacing:.16em;color:#f4c679}.button{display:block;margin-top:22px;padding:16px;border-radius:16px;background:#b8f500;color:#09202a;text-align:center;text-decoration:none;font-weight:800}.note{margin-top:18px;color:#78949c;font-size:12px;line-height:1.7}.foot{margin-top:24px;color:#90a8ad;font-size:13px}
</style></head><body><main class="wrap"><div class="brand">约钓者 · 青岛海钓拼船</div><section class="card"><div class="eyebrow">约上同好，一起海钓。</div><h1 class="title">从这里开始你的下一次出海</h1><p class="sub">打开约钓者，完成实名并成功支付首单后，本次推广才会记为有效。扫码和注册本身不会产生佣金。</p><div class="code">${escapeHtml(code)}</div><a class="button" href="${escapeHtml(appLink)}">打开约钓者继续</a><p class="note">推广归因只保留首次有效记录。页面不展示未经核实的船期、价格或口碑数据。</p></section><div class="foot">青岛近海 · 真实船期以 App 内展示为准</div></main></body></html>`;
}

async function ensureMemberCode(client, userId) {
  const inserted = await client.query(
    `INSERT INTO promotion_codes (owner_user_id,code,channel,status)
     VALUES ($1,$2,'member','active')
     ON CONFLICT (owner_user_id,channel) DO NOTHING
     RETURNING id`,
    [userId, randomBytes(8).toString('hex').toUpperCase()],
  );
  if (inserted.rowCount) return;
}

async function loadDashboard(client, userId, baseUrl) {
  await ensureMemberCode(client, userId);
  await syncPromotionForUser(client, userId);
  await releaseMaturedPromotions(client, userId);
  const codesResult = await client.query(
    `SELECT c.id,c.code,c.channel,c.status,c.created_at,c.reviewed_at,c.review_note,
            (SELECT count(*)::integer FROM promotion_touch_events t
             WHERE t.promotion_code_id=c.id) AS scan_count,
            (SELECT count(*)::integer FROM promotion_attributions a
             WHERE a.promotion_code_id=c.id) AS attribution_count,
            (SELECT count(*)::integer FROM promotion_attributions a
             WHERE a.promotion_code_id=c.id AND a.qualification_status='qualified') AS valid_member_count
     FROM promotion_codes c WHERE c.owner_user_id=$1
     ORDER BY CASE c.channel WHEN 'member' THEN 0 WHEN 'captain' THEN 1
       WHEN 'creator' THEN 2 WHEN 'hotel' THEN 3 WHEN 'travel_agency' THEN 4 ELSE 5 END,
       c.created_at,c.id`,
    [userId],
  );
  const totalsResult = await client.query(
    `SELECT
       COALESCE(sum(amount_fen) FILTER (WHERE status<>'reversed'),0)::bigint AS total_fen,
       COALESCE(sum(amount_fen) FILTER (WHERE status IN ('frozen','pending_unlock')),0)::bigint AS frozen_fen,
       COALESCE(sum(amount_fen) FILTER (WHERE status='available'),0)::bigint AS available_fen,
       COALESCE(sum(amount_fen) FILTER (WHERE status='withdrawal_pending'),0)::bigint AS withdrawal_pending_fen,
       COALESCE(sum(amount_fen) FILTER (WHERE status='paid'),0)::bigint AS paid_fen,
       count(*) FILTER (WHERE refund_after_release)::integer AS refund_exception_count
     FROM commission_ledger WHERE payee_user_id=$1`, [userId],
  );
  const ledgerResult = await client.query(
    `SELECT l.id,l.amount_fen,l.net_ticket_amount_fen,l.status,l.release_at,l.paid_at,
            l.refund_after_release,o.id AS order_id,o.order_number,d.departure_at,
            c.channel AS source_channel,c.code AS promotion_code
     FROM commission_ledger l
     JOIN promotion_attributions a ON a.id=l.promotion_attribution_id
     JOIN promotion_codes c ON c.id=a.promotion_code_id
     JOIN booking_orders o ON o.id=a.order_id
     JOIN departures d ON d.id=o.departure_id
     WHERE l.payee_user_id=$1
     ORDER BY l.created_at DESC,l.id DESC
     LIMIT 100`, [userId],
  );
  const attributionsResult = await client.query(
    `SELECT a.id,a.qualification_status,a.attributed_at,a.qualified_at,
            c.code AS promotion_code,c.channel AS source_channel,
            CASE WHEN a.order_id IS NULL THEN NULL ELSE o.order_number END AS order_number
     FROM promotion_attributions a
     JOIN promotion_codes c ON c.id=a.promotion_code_id
     LEFT JOIN booking_orders o ON o.id=a.order_id
     WHERE c.owner_user_id=$1
     ORDER BY a.attributed_at DESC,a.id DESC LIMIT 100`, [userId],
  );
  const payoutsResult = await client.query(
    `SELECT id,amount_fen,status,admin_note,created_at,reviewed_at,paid_marked_at
     FROM promotion_payout_requests WHERE user_id=$1
     ORDER BY created_at DESC,id DESC LIMIT 50`, [userId],
  );
  return {
    codes: codesResult.rows.map((row) => ({
      id: row.id,
      code: row.code,
      channel: row.channel,
      status: row.status,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      scanCount: Number(row.scan_count),
      attributionCount: Number(row.attribution_count),
      validMemberCount: Number(row.valid_member_count),
      landingUrl: row.status === 'active' ? landingUrl(baseUrl, row.code) : null,
    })),
    totals: Object.fromEntries(Object.entries(totalsResult.rows[0]).map(([key, value]) => [
      key, key.endsWith('_fen') || key === 'refund_exception_count' ? Number(value) : value,
    ])),
    commissions: ledgerResult.rows.map((row) => ({
      id: row.id,
      amountFen: Number(row.amount_fen),
      netTicketAmountFen: Number(row.net_ticket_amount_fen),
      status: row.status,
      releaseAt: row.release_at,
      paidAt: row.paid_at,
      refundAfterRelease: row.refund_after_release,
      orderId: row.order_id,
      orderNumber: row.order_number,
      departureAt: row.departure_at,
      sourceChannel: row.source_channel,
      promotionCode: row.promotion_code,
    })),
    attributions: attributionsResult.rows.map((row) => ({
      id: row.id,
      status: row.qualification_status,
      attributedAt: row.attributed_at,
      qualifiedAt: row.qualified_at,
      promotionCode: row.promotion_code,
      sourceChannel: row.source_channel,
      orderNumber: row.order_number,
    })),
    payouts: payoutsResult.rows.map((row) => ({
      id: row.id,
      amountFen: Number(row.amount_fen),
      status: row.status,
      adminNote: row.admin_note,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      paidMarkedAt: row.paid_marked_at,
    })),
  };
}

export function registerPromotionRoutes(app, { pool, config, requireUser }) {
  const security = createSecurity(config);
  const baseUrl = promotionBaseUrl(config);
  const requirePool = async (_request, reply) => {
    if (!pool) return sendError(reply, 503, '推广服务暂不可用');
  };
  const requireAdmin = async (request, reply) => {
    if (!config.adminPassword) return sendError(reply, 503, '未配置 ADMIN_PASSWORD');
    const provided = String(request.headers['x-admin-password'] ?? '');
    if (!security.safeEqual(provided, config.adminPassword)) return sendError(reply, 401, '管理员口令无效');
  };

  if (pool) {
    app.addHook('onReady', async () => {
      await backfillIdentityNumberHashes(pool, security, app.log);
    });
  }

  app.get('/p/:code', { preHandler: requirePool }, async (request, reply) => {
    const code = String(request.params.code ?? '').trim().toUpperCase();
    const codeResult = await pool.query(
      `SELECT id,code FROM promotion_codes WHERE code=$1 AND status='active'`, [code],
    );
    if (!codeResult.rowCount) return sendError(reply, 404, '推广码不存在或暂不可用');
    const visitor = createVisitorToken(request, security);
    const visitorId = visitor.visitorId ?? security.promotionVisitorId(visitor.token);
    const visitorKeyHash = security.promotionVisitorHash(visitorId);
    const source = sourceFromQuery(request.query?.source);
    await pool.query(
      `INSERT INTO promotion_touch_events (visitor_key_hash,promotion_code_id,source_channel)
       VALUES ($1,$2,$3)
       ON CONFLICT (visitor_key_hash,promotion_code_id) DO NOTHING`,
      [visitorKeyHash, codeResult.rows[0].id, source],
    );
    if (visitor.isNew) {
      const secure = request.protocol === 'https' ? '; Secure' : '';
      reply.header('set-cookie', `${PROMO_COOKIE}=${encodeURIComponent(visitor.token)}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`);
    }
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    return reply.type('text/html; charset=utf-8').send(qrLandingPage({
      code, visitorToken: visitor.token, baseUrl, source,
    }));
  });

  app.get('/promotions/me', { preHandler: [requireUser, requirePool] }, async (request, reply) => {
    try {
      const data = await withTransaction(pool, (client) => loadDashboard(client, request.user.id, baseUrl));
      return data;
    } catch (error) {
      request.log.error({ err: error }, 'Promotion dashboard load failed');
      return sendError(reply, 503, '推广数据暂不可用');
    }
  });

  app.post('/promotions/codes', { preHandler: [requireUser, requirePool] }, async (request, reply) => {
    const channel = String(request.body?.channel ?? '');
    if (!VALID_CHANNELS.has(channel)) return sendError(reply, 400, '推广员类型不支持');
    if (channel === 'captain') {
      const captain = await pool.query(
        `SELECT verification_status FROM captain_profiles WHERE user_id=$1`, [request.user.id],
      );
      if (captain.rows[0]?.verification_status !== 'approved') {
        return sendError(reply, 403, '船长资质审核通过后才能申请船长推广码');
      }
    }
    try {
      const result = await withTransaction(pool, async (client) => {
        const status = BUSINESS_CHANNELS.has(channel) ? 'pending' : 'active';
        const inserted = await client.query(
          `INSERT INTO promotion_codes (owner_user_id,code,channel,status)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (owner_user_id,channel) DO NOTHING
           RETURNING id,code,channel,status,created_at,reviewed_at,review_note`,
          [request.user.id, randomBytes(8).toString('hex').toUpperCase(), channel, status],
        );
        if (inserted.rowCount) return inserted.rows[0];
        const existing = await client.query(
          `SELECT id,code,channel,status,created_at,reviewed_at,review_note
           FROM promotion_codes WHERE owner_user_id=$1 AND channel=$2`,
          [request.user.id, channel],
        );
        return existing.rows[0];
      });
      return reply.code(201).send({
        code: {
          id: result.id,
          value: result.code,
          channel: result.channel,
          status: result.status,
          createdAt: result.created_at,
          reviewedAt: result.reviewed_at,
          reviewNote: result.review_note,
          landingUrl: result.status === 'active' ? landingUrl(baseUrl, result.code) : null,
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Promotion code creation failed');
      return sendError(reply, 503, '推广码暂不可用');
    }
  });

  app.post('/promotions/attribution/claim', { preHandler: [requireUser, requirePool] }, async (request, reply) => {
    const token = String(request.body?.visitorToken ?? '');
    const visitorId = security.promotionVisitorId(token);
    if (!visitorId) return sendError(reply, 400, '推广链接已失效，请重新扫码');
    const visitorKeyHash = security.promotionVisitorHash(visitorId);
    try {
      const result = await withTransaction(pool, async (client) => {
        const existing = await client.query(
          `SELECT id,promotion_code_id,qualification_status
           FROM promotion_attributions WHERE attributed_user_id=$1`, [request.user.id],
        );
        if (existing.rowCount) {
          return { claimed: false, reason: 'already_attributed', attributionId: existing.rows[0].id };
        }
        const touches = await client.query(
          `SELECT t.id,t.status,t.source_channel,t.scanned_at,c.id AS code_id,c.code,c.channel,
                  c.owner_user_id,c.status AS code_status
           FROM promotion_touch_events t JOIN promotion_codes c ON c.id=t.promotion_code_id
           WHERE t.visitor_key_hash=$1 AND t.status='scanned'
           ORDER BY t.scanned_at,t.id FOR UPDATE OF t`, [visitorKeyHash],
        );
        let chosen = null;
        let sawSelf = false;
        for (const touch of touches.rows) {
          if (touch.owner_user_id === request.user.id) {
            sawSelf = true;
            await client.query(
              `UPDATE promotion_touch_events SET status='self_excluded',claimed_by_user_id=$2 WHERE id=$1`,
              [touch.id, request.user.id],
            );
            continue;
          }
          if (touch.code_status !== 'active') {
            await client.query(
              `UPDATE promotion_touch_events SET status='ignored',claimed_by_user_id=$2 WHERE id=$1`,
              [touch.id, request.user.id],
            );
            continue;
          }
          chosen = touch;
          break;
        }
        if (!chosen) return { claimed: false, reason: sawSelf ? 'self_referral' : 'no_active_referral' };
        const attribution = await client.query(
          `INSERT INTO promotion_attributions
             (promotion_code_id,attributed_user_id,attribution_key_hash,source_channel,attributed_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT DO NOTHING RETURNING id,qualification_status`,
          [chosen.code_id, request.user.id, visitorKeyHash, chosen.source_channel, chosen.scanned_at],
        );
        if (!attribution.rowCount) {
          return { claimed: false, reason: 'already_attributed' };
        }
        await client.query(
          `UPDATE promotion_touch_events SET status='claimed',claimed_by_user_id=$2 WHERE id=$1`,
          [chosen.id, request.user.id],
        );
        await client.query(
          `UPDATE promotion_touch_events SET status='ignored',claimed_by_user_id=$2
           WHERE visitor_key_hash=$1 AND id<>$3 AND status='scanned'`,
          [visitorKeyHash, request.user.id, chosen.id],
        );
        await syncPromotionForUser(client, request.user.id);
        const updated = await client.query(
          `SELECT qualification_status FROM promotion_attributions WHERE id=$1`,
          [attribution.rows[0].id],
        );
        return {
          claimed: true,
          attributionId: attribution.rows[0].id,
          promotionCode: chosen.code,
          qualificationStatus: updated.rows[0].qualification_status,
        };
      });
      return result;
    } catch (error) {
      request.log.error({ err: error }, 'Promotion attribution claim failed');
      return sendError(reply, 503, '推广归因暂不可用');
    }
  });

  app.post('/promotions/payout-requests', { preHandler: [requireUser, requirePool] }, async (request, reply) => {
    const ledgerIds = request.body?.commissionLedgerIds;
    if (!Array.isArray(ledgerIds) || ledgerIds.length < 1 || ledgerIds.length > 100
        || ledgerIds.some((id) => !validUuid(id)) || new Set(ledgerIds).size !== ledgerIds.length) {
      return sendError(reply, 400, '请选择可提现的佣金记录');
    }
    try {
      const payout = await withTransaction(pool, async (client) => {
        await syncPromotionForUser(client, request.user.id);
        await releaseMaturedPromotions(client, request.user.id);
        const ledgers = await client.query(
          `SELECT id,amount_fen,status,payee_user_id FROM commission_ledger
           WHERE id=ANY($1::uuid[]) AND payee_user_id=$2
           ORDER BY id FOR UPDATE`, [ledgerIds, request.user.id],
        );
        if (ledgers.rowCount !== ledgerIds.length
            || ledgers.rows.some((row) => row.status !== 'available')) {
          return { error: [409, '部分佣金尚未解冻或已提交提现'] };
        }
        const amountFen = ledgers.rows.reduce((sum, row) => sum + Number(row.amount_fen), 0);
        if (!Number.isSafeInteger(amountFen) || amountFen <= 0) return { error: [400, '提现金额无效'] };
        const inserted = await client.query(
          `INSERT INTO promotion_payout_requests (user_id,amount_fen)
           VALUES ($1,$2) RETURNING id,amount_fen,status,created_at`,
          [request.user.id, amountFen],
        );
        const payoutRequest = inserted.rows[0];
        for (const ledger of ledgers.rows) {
          await client.query(
            `INSERT INTO promotion_payout_items (payout_request_id,commission_ledger_id,amount_fen)
             VALUES ($1,$2,$3)`, [payoutRequest.id, ledger.id, ledger.amount_fen],
          );
          await client.query(
            `UPDATE commission_ledger SET status='withdrawal_pending',payout_request_id=$2
             WHERE id=$1`, [ledger.id, payoutRequest.id],
          );
          await client.query(
            `INSERT INTO promotion_commission_events (commission_ledger_id,event_type,amount_fen,details)
             VALUES ($1,'payout_requested',$2,$3::jsonb)`,
            [ledger.id, ledger.amount_fen, JSON.stringify({ payoutRequestId: payoutRequest.id })],
          );
        }
        return payoutRequest;
      });
      if (payout.error) return sendError(reply, payout.error[0], payout.error[1]);
      return reply.code(201).send({
        payout: {
          id: payout.id,
          amountFen: Number(payout.amount_fen),
          status: payout.status,
          createdAt: payout.created_at,
          sandboxOnly: true,
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Promotion payout request failed');
      return sendError(reply, 503, '提现申请暂不可用');
    }
  });

  app.get('/admin/promotions/codes', { preHandler: [requirePool, requireAdmin] }, async (request) => {
    const status = request.query?.status === 'active' ? 'active' : 'pending';
    const result = await pool.query(
      `SELECT c.id,c.code,c.channel,c.status,c.created_at,c.owner_user_id,u.display_name
       FROM promotion_codes c JOIN users u ON u.id=c.owner_user_id
       WHERE c.status=$1 ORDER BY c.created_at,c.id`, [status],
    );
    return { items: result.rows };
  });

  app.post('/admin/promotions/codes/:id/decision', { preHandler: [requirePool, requireAdmin] }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '推广码编号无效');
    const decision = String(request.body?.decision ?? '');
    const reviewNote = String(request.body?.note ?? '').trim().slice(0, 300);
    if (!['approved', 'rejected'].includes(decision)) return sendError(reply, 400, '审核决定无效');
    const result = await pool.query(
      `UPDATE promotion_codes SET status=$2,reviewed_at=now(),reviewed_by='environment-admin',review_note=$3
       WHERE id=$1 AND status='pending'
       RETURNING id,code,channel,status,reviewed_at,review_note`,
      [request.params.id, decision === 'approved' ? 'active' : 'closed', reviewNote || null],
    );
    if (!result.rowCount) return sendError(reply, 409, '推广码不存在或已处理');
    return { code: result.rows[0] };
  });

  app.get('/admin/promotions/payout-requests', { preHandler: [requirePool, requireAdmin] }, async (request) => {
    const status = request.query?.status;
    const params = [];
    const filter = status && ['requested', 'approved', 'paid_marked', 'rejected'].includes(status)
      ? `WHERE p.status=$${params.push(status)}` : '';
    const result = await pool.query(
      `SELECT p.id,p.user_id,p.amount_fen,p.status,p.created_at,
              p.reviewed_at,p.paid_marked_at,p.admin_note
       FROM promotion_payout_requests p ${filter}
       ORDER BY p.created_at,p.id LIMIT 200`, params,
    );
    return { items: result.rows.map((row) => ({ ...row, amount_fen: Number(row.amount_fen) })) };
  });

  app.post('/admin/promotions/payout-requests/:id/decision', { preHandler: [requirePool, requireAdmin] }, async (request, reply) => {
    if (!validUuid(request.params.id)) return sendError(reply, 400, '提现申请编号无效');
    const decision = String(request.body?.decision ?? '');
    const note = String(request.body?.note ?? '').trim().slice(0, 300) || null;
    if (!['approved', 'rejected', 'paid_marked'].includes(decision)) return sendError(reply, 400, '提现处理状态无效');
    try {
      const result = await withTransaction(pool, async (client) => {
        const locked = await client.query(
          `SELECT id,status,amount_fen FROM promotion_payout_requests WHERE id=$1 FOR UPDATE`,
          [request.params.id],
        );
        if (!locked.rowCount) return { error: [404, '提现申请不存在'] };
        const payout = locked.rows[0];
        const valid = (payout.status === 'requested' && ['approved', 'rejected'].includes(decision))
          || (payout.status === 'approved' && decision === 'paid_marked');
        if (!valid) return { error: [409, '提现申请状态已变化，无法执行该操作'] };
        if (decision === 'rejected') {
          await client.query(
            `UPDATE commission_ledger SET status='available',payout_request_id=NULL
             WHERE payout_request_id=$1 AND status='withdrawal_pending'`, [payout.id],
          );
        } else if (decision === 'paid_marked') {
          await client.query(
            `UPDATE commission_ledger SET status='paid',paid_at=now()
             WHERE payout_request_id=$1 AND status='withdrawal_pending'`, [payout.id],
          );
          await client.query(
            `INSERT INTO promotion_commission_events (commission_ledger_id,event_type,amount_fen,details)
             SELECT commission_ledger_id,'payout_marked_paid',amount_fen,$2::jsonb
             FROM promotion_payout_items WHERE payout_request_id=$1`,
            [payout.id, JSON.stringify({ sandboxOnly: true, payoutRequestId: payout.id })],
          );
        }
        const status = decision;
        const updated = await client.query(
          `UPDATE promotion_payout_requests SET status=$2,admin_actor='environment-admin',
             admin_note=$3,reviewed_at=COALESCE(reviewed_at,now()),
             paid_marked_at=CASE WHEN $2::varchar='paid_marked' THEN now() ELSE paid_marked_at END
           WHERE id=$1 RETURNING id,user_id,amount_fen,status,admin_note,reviewed_at,paid_marked_at`,
          [payout.id, status, note],
        );
        return { payout: updated.rows[0] };
      });
      if (result.error) return sendError(reply, result.error[0], result.error[1]);
      return { payout: result.payout };
    } catch (error) {
      request.log.error({ err: error }, 'Promotion payout review failed');
      return sendError(reply, 503, '提现审核暂不可用');
    }
  });
}
