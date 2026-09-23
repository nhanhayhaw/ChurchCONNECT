/**
 * Scheduled background work (node-cron, in-process).
 *
 * Two jobs run on a schedule:
 *   - Absence scan, nightly. Recomputes every member's consecutive-miss streak
 *     and raises graded alerts.
 *   - Birthday reminders, each morning. Generates reminder rows for the
 *     configured day offsets.
 *
 * Both are idempotent, so a missed run (server restart, deploy) self-heals on
 * the next tick rather than needing a catch-up mechanism.
 *
 * A single-instance guard prevents two overlapping executions of the same job
 * if one run outlasts its interval. If RT AG Connect is ever scaled to more
 * than one Node process, this in-process lock is no longer sufficient - see
 * docs/ARCHITECTURE.md for the advisory-lock upgrade path.
 */
import cron from 'node-cron';
import { env } from '../config/env.js';
import { runAbsenceScan } from '../services/absence.service.js';
import { generateBirthdayReminders } from '../modules/birthdays/birthdays.service.js';
import { pruneAuthTokens } from '../modules/auth/auth.service.js';

const running = new Set<string>();

async function runOnce(name: string, fn: () => Promise<unknown>): Promise<void> {
  if (running.has(name)) {
    console.warn(`[jobs] "${name}" is still running from the previous tick - skipping this one.`);
    return;
  }
  running.add(name);
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`[jobs] "${name}" finished in ${Date.now() - started}ms`, result ?? '');
  } catch (err) {
    // A failing job must never crash the API process.
    console.error(`[jobs] "${name}" failed:`, (err as Error).message);
  } finally {
    running.delete(name);
  }
}

const tasks: cron.ScheduledTask[] = [];

export function startScheduledJobs(): void {
  if (!env.jobsEnabled) {
    console.log('[jobs] disabled (ENABLE_JOBS=false)');
    return;
  }

  for (const [name, expression, fn] of [
    ['absence-scan', env.ABSENCE_JOB_CRON, () => runAbsenceScan()],
    ['birthday-reminders', env.BIRTHDAY_JOB_CRON, () => generateBirthdayReminders()],
    // Token-table housekeeping. Fixed time on purpose: it is not a church
    // decision, and it must never coincide with the absence scan.
    ['auth-token-cleanup', '15 3 * * *', () => pruneAuthTokens()],
  ] as const) {
    if (!cron.validate(expression)) {
      console.error(`[jobs] invalid cron expression for "${name}": "${expression}" - job not scheduled.`);
      continue;
    }
    tasks.push(cron.schedule(expression, () => void runOnce(name, fn), { timezone: env.TZ }));
    console.log(`[jobs] scheduled "${name}" at "${expression}" (${env.TZ})`);
  }
}

export function stopScheduledJobs(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}

/** Exposed for the "Run now" buttons and for tests. */
export const jobs = {
  absenceScan: () => runOnce('absence-scan', () => runAbsenceScan()),
  birthdayReminders: () => runOnce('birthday-reminders', () => generateBirthdayReminders()),
};
