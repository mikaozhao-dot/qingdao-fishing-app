import { createSecurity } from './security.js';
import {
  FCompensationCouponError,
  F_COMPENSATION_SCENARIOS,
  issueFCompensationCoupon,
} from './f-compensation-coupon-service.js';

const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;

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

export function registerFCompensationCouponRoutes(app, { pool, config, requireUser }) {
  const security = createSecurity(config);
  const requireSandbox = async (_request, reply) => {
    if (config.nodeEnv === 'production' || config.demoSandboxEnabled !== true) {
      return sendError(reply, 404, 'F 补偿券沙盒当前不可用');
    }
  };
  const requirePool = async (_request, reply) => {
    if (!pool) return sendError(reply, 503, '数据库未配置');
  };
  const requireAdmin = async (request, reply) => {
    if (!config.adminPassword) return sendError(reply, 503, '未配置 ADMIN_PASSWORD');
    const provided = String(request.headers['x-admin-password'] ?? '');
    if (!security.safeEqual(provided, config.adminPassword)) {
      return sendError(reply, 401, '管理员口令无效');
    }
  };

  app.post('/admin/f-compensation-coupons/issue', {
    preHandler: [requireSandbox, requirePool, requireAdmin],
  }, async (request, reply) => {
    const orderId = String(request.body?.orderId ?? '').trim();
    const sourceEventKey = String(request.body?.sourceEventKey ?? '').trim();
    const scenario = String(request.body?.scenario ?? '').trim();
    const issueNote = String(request.body?.issueNote ?? '').trim();
    const issuedBy = String(request.headers['x-admin-actor'] ?? 'sandbox_admin').trim();
    if (!UUID_PATTERN.test(orderId)) return sendError(reply, 400, '订单编号无效');
    if (!EVENT_KEY_PATTERN.test(sourceEventKey)) return sendError(reply, 400, '事件编号无效');
    if (!Object.hasOwn(F_COMPENSATION_SCENARIOS, scenario)) {
      return sendError(reply, 400, 'F 补偿券场景不适用');
    }
    if (issueNote.length < 6 || issueNote.length > 500) {
      return sendError(reply, 400, '请填写 6 至 500 个字符的审核说明');
    }
    if (issuedBy.length < 1 || issuedBy.length > 80) {
      return sendError(reply, 400, '操作人标记无效');
    }

    try {
      const result = await withTransaction(pool, (client) => issueFCompensationCoupon(client, {
        orderId, sourceEventKey, scenario, issueNote, issuedBy,
      }));
      return reply.code(result.replayed ? 200 : 201).send({ coupon: result });
    } catch (error) {
      if (error instanceof FCompensationCouponError) {
        return sendError(reply, error.statusCode, error.message);
      }
      request.log.error({ err: error }, 'F compensation coupon issue failed');
      return sendError(reply, 503, 'F 补偿券登记失败，请稍后重试');
    }
  });

  app.get('/compensation-coupons/me', {
    preHandler: [requireSandbox, requirePool, requireUser],
  }, async (request, reply) => {
    try {
      const result = await pool.query(
        `SELECT c.id,c.scenario,c.responsible_party,c.ticket_paid_fen,c.amount_fen,c.issued_at,c.expires_at,
                CASE WHEN active.status='reserved' THEN 'reserved'
                     WHEN active.status='redeemed' THEN 'redeemed'
                     WHEN c.expires_at<=now() THEN 'expired'
                     ELSE 'available' END AS status
           FROM f_compensation_coupon_ledger c
           LEFT JOIN LATERAL (
             SELECT r.status FROM order_coupon_redemptions r
             WHERE r.f_coupon_id=c.id AND r.status IN ('reserved','redeemed') LIMIT 1
           ) active ON TRUE
          WHERE c.beneficiary_user_id=$1
          ORDER BY c.issued_at DESC,c.id DESC`, [request.user.id],
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,
          scenario: row.scenario,
          responsibleParty: row.responsible_party,
          ticketPaidFen: Number(row.ticket_paid_fen),
          amountFen: Number(row.amount_fen),
          issuedAt: row.issued_at,
          expiresAt: row.expires_at,
          status: row.status,
        })),
      };
    } catch (error) {
      request.log.error({ err: error }, 'F compensation coupon wallet read failed');
      return sendError(reply, 503, '补偿券列表暂不可用');
    }
  });
}
