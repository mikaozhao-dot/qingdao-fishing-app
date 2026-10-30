import Fastify from 'fastify';
import pg from 'pg';
import { createClient } from 'redis';
import { config } from './config.js';
import { registerStep1Routes } from './step1-routes.js';
import { registerStep2Routes } from './step2-routes.js';
import { registerMemberActivityRoutes } from './member-activity-routes.js';
import { registerStep3Routes } from './step3-routes.js';
import { registerStep4Routes } from './step4-routes.js';
import { registerStep5Routes } from './step5-routes.js';
import { registerPromotionRoutes } from './promotion-routes.js';
import { registerStep6CertificateRoutes } from './step6-certificate-routes.js';
import { registerFCompensationCouponRoutes } from './f-compensation-coupon-routes.js';
import { registerMemberCouponRoutes } from './member-coupon-routes.js';

const { Pool } = pg;

export function buildApp(runtimeConfig = config) {
  const app = Fastify({
    logger: { level: runtimeConfig.logLevel },
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
  });

  const pool = runtimeConfig.databaseUrl
    ? new Pool({ connectionString: runtimeConfig.databaseUrl, max: 10 })
    : null;
  const redis = runtimeConfig.redisUrl
    ? createClient({
        url: runtimeConfig.redisUrl,
        socket: {
          connectTimeout: 1500,
          reconnectStrategy: (retries) =>
            retries >= 2 ? new Error('Redis unavailable') : 250,
        },
      })
    : null;

  redis?.on('error', (error) => app.log.warn({ err: error }, 'Redis connection error'));

  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin) {
      reply.header('access-control-allow-origin', '*');
      reply.header('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
      reply.header('access-control-allow-headers', 'content-type,authorization,x-admin-password,x-admin-actor,x-sandbox-signature');
      reply.header('access-control-max-age', '600');
    }
  });
  app.options('/*', async (_request, reply) => reply.code(204).send());

  app.get('/health', async () => ({
    status: 'ok',
    version: runtimeConfig.appVersion,
    time: new Date().toISOString(),
  }));

  app.get('/ready', async (_request, reply) => {
    const dependencies = { postgres: 'not_configured', redis: 'not_configured' };

    if (pool) {
      try {
        await pool.query('select 1');
        dependencies.postgres = 'ok';
      } catch (error) {
        dependencies.postgres = 'error';
        app.log.warn({ err: error }, 'PostgreSQL readiness check failed');
      }
    }

    if (redis) {
      try {
        if (!redis.isOpen) await redis.connect();
        await redis.ping();
        dependencies.redis = 'ok';
      } catch (error) {
        dependencies.redis = 'error';
        app.log.warn({ err: error }, 'Redis readiness check failed');
        if (redis.isOpen) await redis.quit().catch(() => {});
      }
    }

    const ready = Object.values(dependencies).every((state) => state === 'ok');
    reply.code(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not_ready',
      version: runtimeConfig.appVersion,
      time: new Date().toISOString(),
      dependencies,
    };
  });

  const { requireUser } = registerStep1Routes(app, { pool, config: runtimeConfig });
  registerPromotionRoutes(app, { pool, config: runtimeConfig, requireUser });
  registerStep2Routes(app, { pool, config: runtimeConfig, requireUser });
  registerMemberActivityRoutes(app, { pool, config: runtimeConfig, requireUser });
  registerStep3Routes(app, { pool, redis, config: runtimeConfig, requireUser });
  registerStep4Routes(app, { pool, redis, config: runtimeConfig, requireUser });
  registerStep5Routes(app, { pool, config: runtimeConfig, requireUser });
  registerStep6CertificateRoutes(app, { pool, config: runtimeConfig, requireUser });
  registerFCompensationCouponRoutes(app, { pool, config: runtimeConfig, requireUser });
  registerMemberCouponRoutes(app, { pool, config: runtimeConfig, requireUser });

  app.addHook('onClose', async () => {
    await pool?.end();
    if (redis?.isOpen) await redis.quit();
  });

  return app;
}
