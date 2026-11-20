/**
 * Captures the screens Reel 7 needs (first sign-in as a Tele Pastor) from the
 * locally running application:
 *
 *   server:  cd server && npm run dev        (http://localhost:4000)
 *   client:  cd client && npx vite           (http://localhost:5173)
 *   then:    node capture-reel7.mjs
 *
 * A throw-away Tele Pastor account (fictional name, example.com address) is
 * created with the temporary password, driven through the real flow, and
 * deleted again at the end - so nothing is left behind in the database apart
 * from audit-log rows whose user becomes NULL.
 *
 * Captures are 2x (viewport 1080x675, device scale 2), matching the earlier
 * screens in assets/screens.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../server');
const srequire = createRequire(path.join(serverDir, 'package.json'));
const { Client } = srequire('pg');
const argon2 = srequire('argon2');
srequire('dotenv').config({ path: path.join(serverDir, '.env') });

const OUT = path.join(here, 'assets/screens');
const BASE = process.env.REEL_BASE_URL || 'http://localhost:5173';
const DEMO = {
  name: 'Abena Mensah',
  email: 'abena.mensah@example.com',
  temp: 'Telepastor123',
  next: 'Shepherd-2026-Care',
};

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

async function removeDemo() {
  const r = await db.query('DELETE FROM users WHERE email = $1', [DEMO.email]);
  if (r.rowCount) console.log(`removed demo account (${r.rowCount})`);
}

async function createDemo() {
  await removeDemo();
  const hash = await argon2.hash(DEMO.temp, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  await db.query(
    `INSERT INTO users (full_name, email, password_hash, role_id, is_active, must_change_password)
     VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = 'tele_pastor'), TRUE, TRUE)`,
    [DEMO.name, DEMO.email, hash],
  );
  console.log('created demo Tele Pastor account');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--hide-scrollbars'] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 675 }, deviceScaleFactor: 2, colorScheme: 'light' });
const page = await ctx.newPage();
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('  captured', name);
};
const settle = async (ms = 900) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); };

try {
  await createDemo();

  // 1. Sign-in page with the temporary password typed and shown.
  await page.goto(`${BASE}/login`);
  await settle(1200);
  await shot('login-empty.png');
  await page.locator('input[name=email]').fill(DEMO.email);
  await page.locator('input[name=password]').fill(DEMO.temp);
  await page.getByRole('button', { name: 'Show password' }).click();
  await page.waitForTimeout(300);
  await shot('login-filled.png');

  // 2. Forced password change.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/change-password', { timeout: 20_000 });
  await settle(1200);
  await shot('change-password.png');
  const pw = page.locator('input[type=password]');
  await pw.nth(0).fill(DEMO.temp);
  await pw.nth(1).fill(DEMO.next);
  await pw.nth(2).fill(DEMO.next);
  await page.waitForTimeout(300);
  await shot('change-password-filled.png');

  // 3. Update -> signed out everywhere -> back at sign-in with the toast.
  await page.getByRole('button', { name: 'Update password' }).click();
  await page.getByText('Password updated', { exact: true }).waitFor({ timeout: 20_000 });
  await page.waitForURL('**/login', { timeout: 20_000 });
  await page.waitForTimeout(500);
  await shot('password-updated.png');

  // 4. Sign in again with the new password -> the Tele Pastor's dashboard.
  await page.locator('input[name=email]').fill(DEMO.email);
  await page.locator('input[name=password]').fill(DEMO.next);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20_000 });
  await page.getByText('Here is where the church stands today').waitFor({ timeout: 90_000 });
  await settle(1500);
  await shot('dashboard-telepastor.png');
} finally {
  await browser.close();
  await removeDemo();
  await db.end();
}
