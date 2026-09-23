/**
 * Migration runner.
 *
 * Applies every `.sql` file in ./migrations in filename order, recording each
 * in a `schema_migrations` table so re-running is a no-op. Each file runs in
 * its own transaction: a failed migration leaves the database untouched.
 *
 *   npm run migrate            apply pending migrations
 *   npm run migrate -- --fresh DROP the public schema first (development only)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from '../config/db.js';
import { env } from '../config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * True when DATABASE_URL points at a hosted Supabase project.
 *
 * Covers both the direct connection (db.<ref>.supabase.co) and the Supavisor
 * pooler (aws-0-<region>.pooler.supabase.com), which is the host most projects
 * actually use because the direct one resolves to IPv6 only.
 */
function targetIsSupabase(): boolean {
  try {
    const host = new URL(env.DATABASE_URL).hostname.toLowerCase();
    return host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
  } catch {
    return false;
  }
}

async function dropEverything(): Promise<void> {
  if (env.isProd) {
    throw new Error('--fresh is refused in production.');
  }

  // `DROP SCHEMA public CASCADE` is merely destructive on a local PostgreSQL:
  // it destroys this application's data, which is what --fresh is for. On a
  // hosted Supabase project it destroys more than that. The schema carries the
  // project's own grants and default-privilege rules for anon, authenticated
  // and service_role, plus anything an extension installed there. Recreating
  // an empty `public` leaves a project whose API layer is subtly broken in
  // ways that do not show up until much later, and NODE_ENV on a developer
  // machine is 'development', so the production guard above does not catch it.
  //
  // Refuse by default. The escape hatch is deliberately awkward to type.
  if (targetIsSupabase() && !process.argv.includes('--yes-drop-supabase-schema')) {
    throw new Error(
      'Refusing to run --fresh against a Supabase project.\n\n' +
        '  DROP SCHEMA public CASCADE would delete your data AND the grants and\n' +
        '  default privileges the Supabase API layer depends on.\n\n' +
        '  To empty the tables without touching the schema, run the seeder instead:\n' +
        '    npm run seed -- --force\n\n' +
        '  To rebuild the schema from nothing, delete the project in the Supabase\n' +
        '  dashboard and create a new one, then run: npm run migrate && npm run seed\n\n' +
        '  If you have read the above and still want the drop, re-run with\n' +
        '    npm run migrate -- --fresh --yes-drop-supabase-schema',
    );
  }

  console.log('  dropping and recreating schema "public" ...');
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

async function run(): Promise<void> {
  const fresh = process.argv.includes('--fresh');

  console.log('\nRT AG Connect - database migration');
  console.log(`  target: ${env.DATABASE_URL.replace(/:[^:@/]+@/, ':****@')}`);

  if (fresh) await dropEverything();
  await ensureMigrationsTable();

  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  = ${file} (already applied)`);
      continue;
    }
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      // The .sql files carry their own BEGIN/COMMIT, so only the bookkeeping
      // insert is wrapped here; if the file fails, nothing is recorded.
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      console.log(`  + ${file}`);
      count += 1;
    } catch (err) {
      console.error(`\n  x ${file} failed: ${(err as Error).message}\n`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(count === 0 ? '\nDatabase already up to date.\n' : `\nApplied ${count} migration(s).\n`);
}

run()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
