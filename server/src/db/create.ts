/**
 * Create the application database if it does not already exist.
 *
 *   npm run db:create
 *
 * This exists because `createdb` requires the PostgreSQL client tools to be on
 * PATH, which is not the case on a default Windows install where only the
 * server was installed. Connecting to the maintenance database through the
 * driver we already depend on avoids that requirement entirely.
 *
 * CREATE DATABASE cannot run inside a transaction block, so this deliberately
 * uses a plain Client rather than the pooled helpers in config/db.ts.
 */
import pg from 'pg';
import { env } from '../config/env.js';

const { Client } = pg;

async function run(): Promise<void> {
  const url = new URL(env.DATABASE_URL);
  const targetDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!targetDatabase) {
    throw new Error('DATABASE_URL does not name a database.');
  }

  // Same server and credentials, but the always-present maintenance database.
  const maintenanceUrl = new URL(env.DATABASE_URL);
  maintenanceUrl.pathname = '/postgres';

  const client = new Client({
    connectionString: maintenanceUrl.toString(),
    ssl: env.pgSsl ? { rejectUnauthorized: false } : undefined,
  });

  console.log('\nRT AG Connect - database creation');
  console.log(`  server   : ${url.host}`);
  console.log(`  database : ${targetDatabase}`);

  try {
    await client.connect();
  } catch (err) {
    console.error(
      `\n  Could not reach PostgreSQL at ${url.host}.\n` +
        `  ${(err as Error).message}\n\n` +
        '  Check that the server is running and that DATABASE_URL in server/.env is correct.\n',
    );
    process.exit(1);
  }

  const version = await client.query('SHOW server_version');
  console.log(`  version  : PostgreSQL ${version.rows[0].server_version}`);

  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDatabase]);

  if (existing.rowCount && existing.rowCount > 0) {
    console.log(`\n  Database "${targetDatabase}" already exists - nothing to do.\n`);
  } else {
    // The database name comes from our own .env, not from user input, and
    // identifiers cannot be parameterised. Quote it defensively anyway.
    await client.query(`CREATE DATABASE "${targetDatabase.replace(/"/g, '""')}"`);
    console.log(`\n  Created database "${targetDatabase}".\n`);
  }

  console.log('  Next:  npm run migrate  then  npm run seed\n');
  await client.end();
}

run().catch((err) => {
  console.error('\nDatabase creation failed:', err.message, '\n');
  process.exit(1);
});
