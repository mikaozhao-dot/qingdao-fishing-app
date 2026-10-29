import { createSecurity } from './security.js';
import { syncMemberRewardsForUser } from './member-coupon-service.js';

const sendError = (reply, statusCode, message) => reply.code(statusCode).send({ error: message });

export function registerMemberCouponRoutes(app, { pool, config, requireUser }) {
  const security = createSecurity(config);
  const requireSandbox = async (_request, reply) => {
    if (config.nodeEnv === 'production' || config.demoSandboxEnabled !== true) {
      return sendError(reply, 404, '会员权益沙盒当前不可用');
    }
    if (!pool) return sendError(reply, 503, '数据库未配置');
  };

  app.get('/member-coupons/me', {
    preHandler: [requireSandbox, requireUser],
  }, async (request, reply) => {
    try {
      const result = await pool.query(
        `SELECT c.id,c.coupon_type,c.milestone,c.amount_fen,c.issued_at,c.expires_at,
                CASE WHEN active.status='reserved' THEN 'reserved'
                     WHEN active.status='redeemed' THEN 'redeemed'
                     WHEN c.expires_at<=now() THEN 'expired'
                     ELSE 'available' END AS status
         FROM member_coupons c
         LEFT JOIN LATERAL (
           SELECT r.status FROM order_coupon_redemptions r
           WHERE r.member_coupon_id=c.id AND r.status IN ('reserved','redeemed')
           LIMIT 1
         ) active ON TRUE
         WHERE c.user_id=$1 ORDER BY c.issued_at DESC,c.id DESC`, [request.user.id],
      );
      return { items: result.rows.map((row) => ({
        id: row.id,
        type: row.coupon_type,
        milestone: Number(row.milestone),
        amountFen: Number(row.amount_fen),
        issuedAt: row.issued_at,
        expiresAt: row.expires_at,
        status: row.status,
        transferable: false,
        cashable: false,
      })) };
    } catch (error) {
      request.log.error({ err: error }, 'Member coupon wallet read failed');
      return sendError(reply, 503, '会员券列表暂不可用');
    }
  });

  app.get('/member-rewards/me', {
    preHandler: [requireSandbox, requireUser],
  }, async (request, reply) => {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await syncMemberRewardsForUser(client, request.user.id, security);
      const result = await client.query(
        `SELECT valid_order_count,lifetime_stars
         FROM member_reward_accounts WHERE user_id=$1`, [request.user.id],
      );
      await client.query('COMMIT');
      return {
        validOrderCount: Number(result.rows[0]?.valid_order_count ?? 0),
        stars: Number(result.rows[0]?.lifetime_stars ?? 0),
        benefits: [],
      };
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err: error }, 'Member rewards read failed');
      return sendError(reply, 503, '会员星级暂不可用');
    } finally {
      client?.release();
    }
  });
}
