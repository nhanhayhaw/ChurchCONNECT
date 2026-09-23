/**
 * Server entry point.
 *
 * Verifies the database is reachable before binding a port - failing fast with
 * a clear message beats accepting traffic that will 500 on the first query.
 */
import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool, closePool } from './config/db.js';
import { ensureStorageReady } from './services/storage.service.js';
import { startScheduledJobs, stopScheduledJobs } from './jobs/scheduler.js';

async function main(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    console.log('[db] connected');
  } catch (err) {
    console.error(
      '\n[db] could not connect to PostgreSQL.\n' +
        `      ${(err as Error).message}\n\n` +
        '      Check that PostgreSQL is running and DATABASE_URL in server/.env is correct.\n',
    );
    process.exit(1);
  }

  // Confirm the schema exists so a fresh clone gets a useful message rather
  // than "relation users does not exist" on the first login attempt.
  const { rows } = await pool.query(
    `SELECT to_regclass('public.users') IS NOT NULL AS ready`,
  );
  if (!rows[0]?.ready) {
    console.error('\n[db] schema not found. Run:  npm run migrate  (then: npm run seed)\n');
    process.exit(1);
  }

  await ensureStorageReady();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`\n  RT AG Connect API`);
    console.log(`  environment : ${env.NODE_ENV}`);
    console.log(`  listening   : http://localhost:${env.PORT}`);
    console.log(`  client      : ${env.CLIENT_ORIGIN}`);
    console.log(`  uploads     : ${env.uploadDir}\n`);
  });

  startScheduledJobs();

  const shutdown = (signal: string) => {
    console.log(`\n[server] ${signal} received - shutting down.`);
    stopScheduledJobs();
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // Do not let a hung connection block the shutdown indefinitely.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled promise rejection:', reason);
  });
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
