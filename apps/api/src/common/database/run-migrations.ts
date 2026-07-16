import { config } from 'dotenv';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

config({
  path: resolve(process.cwd(), '../../.env'),
});

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL no está configurada.');
  }

  const migrationsDirectory = resolve(
  process.cwd(),
  '../../database/migrations',
);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS core;
      CREATE TABLE IF NOT EXISTS core.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    for (const filename of files) {
      const exists = await client.query<{ filename: string }>(
        'SELECT filename FROM core.schema_migrations WHERE filename = $1',
        [filename],
      );

      if (exists.rowCount && exists.rowCount > 0) {
        console.log(`Omitida: ${filename}`);
        continue;
      }

      const sql = await readFile(resolve(migrationsDirectory, filename), 'utf8');
      await client.query('BEGIN');

      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO core.schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
        console.log(`Aplicada: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});