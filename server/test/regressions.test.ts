/**
 * Regression tests for defects found in the September 2026 reliability review.
 *
 *   npm test
 *
 * These boot the real Express app in-process against a DISPOSABLE database and
 * exercise it over HTTP. They refuse to run unless the database name ends in
 * `_qa` or `_test`, so they can never touch a church's data. By default the
 * database is the one in server/.env with its name suffixed `_qa` (create it
 * with `DATABASE_URL=...churchconnect_qa npm run setup`); override with
 * TEST_DATABASE_URL.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

// --- environment must be settled BEFORE the app modules load ----------------
const envFile = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const fromEnv = envFile.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^"|"$/g, '');
const dbUrl = process.env.TEST_DATABASE_URL ?? fromEnv?.replace(/\/([^/?]+)(\?.*)?$/, '/$1_qa$2');
if (!dbUrl || !/_(qa|test)(\?.*)?$/.test(dbUrl)) {
  throw new Error(`Refusing to run tests against "${dbUrl}": the database name must end in _qa or _test.`);
}
process.env.DATABASE_URL = dbUrl;
process.env.NODE_ENV = 'test';
process.env.ENABLE_JOBS = 'false';
process.env.API_RATE_LIMIT_PER_MINUTE = '1000000';
process.env.UPLOAD_DIR = path.join(tmpdir(), 'rtag-connect-test-uploads');

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/config/db.js');

const PASSWORD = 'ChurchConnect#2026';
const ADMIN = 'admin@churchconnect.demo';
const VIEWER = 'viewer@churchconnect.demo';
const CHOIR_LEADER = 'choir.lead@churchconnect.demo';

let server: import('node:http').Server;
let base = '';
const created = { members: [] as number[], services: [] as number[], followUps: [] as number[] };

interface Res { status: number; json: any; text: string; setCookie: string[] }
async function api(method: string, p: string, opts: { token?: string; body?: unknown; raw?: string; cookie?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.Cookie = opts.cookie;
  let body: string | undefined;
  if (opts.raw !== undefined) { body = opts.raw; headers['Content-Type'] = 'application/json'; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + p, { method, headers, body });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, setCookie: r.headers.getSetCookie() };
}
const cookieOf = (set: string[]) => set.find((c) => c.startsWith('cc_refresh='))?.split(';')[0] ?? '';
async function login(email: string, headers?: Record<string, string>) {
  const r = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD, rememberMe: true }, headers });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return { token: r.json.accessToken as string, cookie: cookieOf(r.setCookie), user: r.json.user };
}
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const year = new Date().getFullYear();
const stamp = Date.now().toString(36);

before(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  // Hard-delete what the tests created (QA database only - the guard above).
  if (created.followUps.length) await pool.query('DELETE FROM follow_ups WHERE id = ANY($1)', [created.followUps]);
  if (created.services.length) await pool.query('DELETE FROM attendance_services WHERE id = ANY($1)', [created.services]);
  if (created.members.length) await pool.query('DELETE FROM members WHERE id = ANY($1)', [created.members]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

// ---------------------------------------------------------------------------
test('health reports database reachability and is not rate limited', async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.database, 'ok');
});

test('malformed JSON body -> 400, oversized body -> 413 (never 500)', async () => {
  const bad = await api('POST', '/api/auth/login', { raw: '{"email": "a@b.c", ' });
  assert.equal(bad.status, 400, bad.text);
  const big = await api('POST', '/api/auth/login', { raw: 'x'.repeat(1_100_000) });
  assert.equal(big.status, 413, big.text);
});

test('ids beyond BIGINT and impossible dates are client errors, not 500s', async () => {
  const { token } = await login(ADMIN);
  const overflow = await api('GET', '/api/members/99999999999999999999', { token });
  assert.equal(overflow.status, 400, overflow.text);
  const badDate = await api('POST', '/api/attendance/services', { token, body: { serviceDate: '2026-02-30', serviceType: 'sunday_service' } });
  assert.equal(badDate.status, 422, badDate.text);
  const badQuery = await api('GET', '/api/members?joinedFrom=2026-13-45', { token });
  assert.equal(badQuery.status, 422, badQuery.text);
});

test('member-code generator survives a manually typed non-numeric code', async () => {
  const { token } = await login(ADMIN);
  const manual = await api('POST', '/api/members', { token, body: { firstName: 'Reg', lastName: `Manual-${stamp}`, gender: 'male', dateJoined: '2026-01-01', memberCode: `CC-${year}-ZZZZ` } });
  assert.equal(manual.status, 201, manual.text);
  created.members.push(manual.json.member.id);
  try {
    for (let i = 0; i < 2; i++) {
      const auto = await api('POST', '/api/members', { token, body: { firstName: 'Reg', lastName: `Auto-${stamp}-${i}`, gender: 'female', dateJoined: '2026-01-01' } });
      assert.equal(auto.status, 201, auto.text);
      created.members.push(auto.json.member.id);
      assert.match(auto.json.member.memberCode, new RegExp(`^CC-${year}-\\d{4,}$`), `got ${auto.json.member.memberCode}`);
    }
  } finally {
    // The ZZZZ code must not leak into other tests' numbering.
    await pool.query(`UPDATE members SET member_code = 'TEST-' || id WHERE id = $1`, [manual.json.member.id]);
  }
});

test('refresh-token replay: a late replay revokes every session; a race within the grace window does not', async () => {
  const s = await login(VIEWER);
  const first = await api('POST', '/api/auth/refresh', { cookie: s.cookie });
  assert.equal(first.status, 200);
  const second = cookieOf(first.setCookie);
  assert.ok(second && second !== s.cookie, 'cookie rotates');

  // Immediate replay = another tab lost the race: 401, but the winner survives.
  const race = await api('POST', '/api/auth/refresh', { cookie: s.cookie });
  assert.equal(race.status, 401);
  const winnerStillOk = await api('POST', '/api/auth/refresh', { cookie: second });
  assert.equal(winnerStillOk.status, 200, 'winner must survive a racing tab');
  const third = cookieOf(winnerStillOk.setCookie);

  // Age the rotated-away token past the grace window, then replay it: theft.
  await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() - interval '1 minute' WHERE token_hash = $1`, [sha256(second.slice('cc_refresh='.length))]);
  const theft = await api('POST', '/api/auth/refresh', { cookie: second });
  assert.equal(theft.status, 401);
  const familyDead = await api('POST', '/api/auth/refresh', { cookie: third });
  assert.equal(familyDead.status, 401, 'the whole family must be revoked after a genuine replay');
});

test('audit-log and session IP cannot be forged with X-Forwarded-For', async () => {
  const marker = '203.0.113.77';
  await login(VIEWER, { 'X-Forwarded-For': `${marker}, 10.0.0.1` });
  const audit = await pool.query(`SELECT ip_address FROM audit_logs WHERE action = 'auth.login' ORDER BY id DESC LIMIT 1`);
  assert.notEqual(audit.rows[0]?.ip_address, marker);
  const session = await pool.query(`SELECT ip_address FROM refresh_tokens ORDER BY id DESC LIMIT 1`);
  assert.notEqual(session.rows[0]?.ip_address, marker);
});

test('access token is only accepted from the Authorization header (any case of "bearer")', async () => {
  const { token } = await login(ADMIN);
  const viaQuery = await api('GET', `/api/auth/me?access_token=${encodeURIComponent(token)}`);
  assert.equal(viaQuery.status, 401);
  const lower = await api('GET', '/api/auth/me', { headers: { Authorization: `bearer ${token}` } });
  assert.equal(lower.status, 200);
});

test('department leader cannot reach other departments through sub-resources, cases, rosters, reports or registers', async () => {
  const admin = await login(ADMIN);
  const leader = await login(CHOIR_LEADER);
  const choirId = leader.user.departmentId as number;
  const other = (await pool.query(`SELECT id, department_id FROM members WHERE deleted_at IS NULL AND department_id IS NOT NULL AND department_id <> $1 LIMIT 1`, [choirId])).rows[0];
  assert.ok(other, 'seed has a member outside the Choir');

  for (const p of [`/api/members/${other.id}/timeline`, `/api/members/${other.id}/attendance`, `/api/members/${other.id}/follow-ups`, `/api/departments/${other.department_id}`]) {
    const r = await api('GET', p, { token: leader.token });
    assert.equal(r.status, 403, `${p} -> ${r.status}`);
  }
  const open = await api('POST', '/api/follow-ups', { token: leader.token, body: { memberId: other.id } });
  assert.equal(open.status, 403, open.text);

  // A case for an outside member, opened by an admin, must be invisible and immutable to the leader.
  const adminCase = await api('POST', '/api/follow-ups', { token: admin.token, body: { memberId: other.id, note: 'admin opened' } });
  if (adminCase.status === 201) {
    created.followUps.push(adminCase.json.followUp.id);
    const fid = adminCase.json.followUp.id;
    assert.equal((await api('GET', `/api/follow-ups/${fid}`, { token: leader.token })).status, 403);
    assert.equal((await api('PATCH', `/api/follow-ups/${fid}`, { token: leader.token, body: { status: 'resolved' } })).status, 403);
    assert.equal((await api('POST', `/api/follow-ups/${fid}/notes`, { token: leader.token, body: { note: 'leader wrote here' } })).status, 403);
  }

  for (const key of ['absentees', 'low-attendance', 'new-members?from=2000-01-01', 'follow-ups', 'birthdays?range=upcoming&windowDays=366']) {
    const r = await api('GET', `/api/reports/${key}`, { token: leader.token });
    assert.equal(r.status, 200, r.text);
    const depts = new Set(r.json.rows.map((row: any) => row.departmentName ?? row.department));
    for (const d of depts) assert.ok(d === 'Choir' || d === undefined, `report ${key} leaked department ${String(d)}`);
  }

  const congregation = await api('POST', '/api/attendance/services', { token: leader.token, body: { serviceDate: '2026-09-11', serviceType: 'special_programme' } });
  assert.equal(congregation.status, 403, congregation.text);
  const own = await api('POST', '/api/attendance/services', { token: leader.token, body: { serviceDate: '2026-09-11', serviceType: 'special_programme', departmentId: choirId } });
  assert.equal(own.status, 201, own.text);
  created.services.push(own.json.service.id);

  const sunday = (await pool.query(`SELECT id FROM attendance_services WHERE department_id IS NULL ORDER BY service_date DESC LIMIT 1`)).rows[0];
  const reg = await api('GET', `/api/attendance/services/${sunday.id}/register`, { token: leader.token });
  assert.equal(reg.status, 200);
  assert.ok(reg.json.entries.every((e: any) => e.departmentName === 'Choir'), 'congregation register filtered to the leader\'s department');
  const outsideMark = await api('POST', `/api/attendance/services/${sunday.id}/register`, { token: leader.token, body: { marks: [{ memberId: other.id, status: 'present' }] } });
  assert.equal(outsideMark.status, 403, outsideMark.text);
});

test('a register containing the same member twice is de-duplicated instead of failing', async () => {
  const { token } = await login(ADMIN);
  const svc = await api('POST', '/api/attendance/services', { token, body: { serviceDate: '2026-09-04', serviceType: 'youth_service', title: 'regression' } });
  assert.equal(svc.status, 201, svc.text);
  created.services.push(svc.json.service.id);
  const r = await api('POST', `/api/attendance/services/${svc.json.service.id}/register`, { token, body: { marks: [{ memberId: 1, status: 'present' }, { memberId: 1, status: 'absent' }] } });
  assert.equal(r.status, 200, r.text);
  const rows = await pool.query('SELECT status FROM attendance WHERE service_id = $1 AND member_id = 1', [svc.json.service.id]);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].status, 'absent', 'last mark wins');
});

test('the wildcard permission cannot be granted to a non-administrator role', async () => {
  const { token } = await login(ADMIN);
  const viewerRole = (await pool.query(`SELECT id FROM roles WHERE name = 'viewer'`)).rows[0].id;
  const r = await api('PUT', `/api/users/roles/${viewerRole}`, { token, body: { permissions: ['*'] } });
  assert.equal(r.status, 400, r.text);
});

test('absence notifications carry the episode (last attendance date) in their dedupe key', async () => {
  const { token } = await login(ADMIN);
  const scan = await api('POST', '/api/follow-ups/alerts/scan', { token });
  assert.equal(scan.status, 200);
  const keyed = await pool.query(`SELECT dedupe_key FROM notifications WHERE type = 'absence_alert' AND dedupe_key ~ ':(\\d{4}-\\d{2}-\\d{2}|never)$' LIMIT 1`);
  assert.ok(keyed.rowCount, 'at least one episode-keyed absence notification exists after a scan');
});
