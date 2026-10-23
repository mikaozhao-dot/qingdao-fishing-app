import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required to apply database migrations.');
}

const { Client } = pg;
const migrationUrl = new URL('../migrations/001_core_schema.sql', import.meta.url);
const migrationSql = await readFile(fileURLToPath(migrationUrl), 'utf8');
const client = new Client({ connectionString: config.databaseUrl });

try {
  await client.connect();
  await client.query(migrationSql);
  console.info('Applied migration 001_core_schema.sql');
} finally {
  await client.end();
}
