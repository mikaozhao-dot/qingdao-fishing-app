import Fastify from 'fastify';
import pg from 'pg';
import { createClient } from 'redis';
import { config } from './config.js';

const { Pool } = pg;

export function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: true,
  });

  const pool = config.databaseUrl
    ? new Pool({ connectionString: config.databaseUrl, max: 10 })
    : null;
  const redis = config.redisUrl
    ? createClient({
        url: config.redisUrl,
        socket: {
          connectTimeout: 1500,
          reconnectStrategy: (retries) =>
            retries >= 2 ? new Error('Redis unavailable') : 250,
        },
      })
    : null;

  redis?.on('error', (error) => app.log.warn({ err: error }, 'Redis connection error'));

  app.get('/health', async () => ({
    status: 'ok',
    version: config.appVersion,
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
      version: config.appVersion,
      time: new Date().toISOString(),
      dependencies,
    };
  });

  app.addHook('onClose', async () => {
    await pool?.end();
    if (redis?.isOpen) await redis.quit();
  });

  return app;
}
