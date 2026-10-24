import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required to apply database migrations.');
}

const { Client } = pg;
const migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const client = new Client({ connectionString: config.databaseUrl });

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version varchar(120) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(migrationDirectory))
    .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(name))
    .sort();
  for (const file of files) {
    const alreadyApplied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [file],
    );
    if (alreadyApplied.rowCount) continue;
    await client.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    console.info(`Applied migration ${file}`);
  }
} finally {
  await client.end();
}
