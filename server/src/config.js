import { fileURLToPath } from 'node:url';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const config = Object.freeze({
  appVersion: process.env.APP_VERSION ?? '0.1.0',
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  demoSandboxEnabled: process.env.ENABLE_DEMO_SANDBOX === 'true',
  demoSmsCode: process.env.DEMO_SMS_CODE ?? '246810',
  piiEncryptionKeyHex: process.env.PII_ENCRYPTION_KEY_HEX ?? '',
  phoneHashKeyHex: process.env.PHONE_HASH_KEY_HEX ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  uploadDir: process.env.UPLOAD_DIR ?? fileURLToPath(new URL('../.local-uploads/', import.meta.url)),
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  required,
});
