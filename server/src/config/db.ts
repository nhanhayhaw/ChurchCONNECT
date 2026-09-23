/**
 * PostgreSQL connection pool and query helpers.
 *
 * Every query in the codebase goes through `query()` or `tx()`. Both take
 * parameterised SQL only - string concatenation of user input into SQL is
 * never done anywhere in this project, which is what makes the app immune to
 * SQL injection by construction rather than by review.
 */
import pg from 'pg';
import { env } from './env.js';

const { Pool, types } = pg;

// node-postgres returns DATE columns as JS Date objects in the server's local
// timezone, which silently shifts a birthday by a day for anyone west of UTC.
// Dates in this system are calendar dates, not instants - keep them as strings.
types.setTypeParser(1082, (value: string) => value); // DATE
// BIGINT (int8) arrives as a string to avoid precision loss. Our ids are far
// below 2^53 so converting to number keeps the API JSON clean.
types.setTypeParser(20, (value: string) => Number(value));
// NUMERIC - used only by aggregate averages here; number is the useful shape.
types.setTypeParser(1700, (value: string) => Number(value));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.pgSsl ? { rejectUnauthorized: false } : undefined,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Nothing in this application legitimately runs for a minute. Without these
  // a runaway statement or a transaction abandoned by a crashed request holds
  // its connection (and its locks) forever, and the pool quietly drains.
  statement_timeout: 60_000,
  idle_in_transaction_session_timeout: 60_000,
});

pool.on('error', (err) => {
  // A pooled client failing while idle must not take the process down.
  console.error('[db] idle client error:', err.message);
});

export interface QueryResultLike<T> {
  rows: T[];
  rowCount: number;
}

/** Run a parameterised query. `params` values are always sent out-of-band. */
export async function query<T = any>(text: string, params: unknown[] = []): Promise<QueryResultLike<T>> {
  const started = Date.now();
  const res = await pool.query(text, params as any[]);
  const ms = Date.now() - started;
  if (env.isDev && ms > 300) {
    console.warn(`[db] slow query ${ms}ms: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

/** Convenience: first row or null. */
export async function queryOne<T = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const { rows } = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run a function inside a transaction. Commits on success, rolls back on any
 * thrown error, and always releases the client.
 */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
