# System reliability, stress and defect review — September 2026

**System:** RT AG Connect (Node 26 / Express / PostgreSQL 18 API, React client)
**Reviewed:** 15 September 2026, on the development machine (Windows 11, 14 cores, 15 GB RAM, ~0.8 GB free at the time)
**Method:** every test below was executed against a disposable copy of the database (`churchconnect_qa`, seeded identically to the demo data) served by a second API instance on port 4001 with the rate limiter lifted. Your working database was read for inspection only and was verified unchanged at the end (65 members, 768 marks, 80 audit rows before and after; no `QA` rows).
**Evidence:** the harness and raw results live in the session scratchpad (`qa/*.mjs`, `qa/results/*.json`). The regression tests that lock in the fixes are committed at `server/test/regressions.test.ts` and run with `npm test`.

---

## 1. Executive summary

**Verdict: READY WITH WARNINGS.**

The core is sound. Under sustained mixed load the API served 39,633 requests in four minutes with zero errors and flat memory; it survived having every database connection killed mid-traffic (self-healed in 236 ms) and a hard process kill under write load (no partial or duplicated rows). Transactions, unique constraints and the absence engine's idempotency all held up under concurrency.

The review found **14 defects that have been fixed and regression-tested** and **2 that remain open** because they are deployment or product decisions. Three of the fixed defects were serious:

1. **Any Department Leader could read and edit the whole congregation's data** by typing an id into a URL — profile tabs, follow-up cases and notes, other departments' rosters with phone numbers, five reports, and the full Sunday register. Twelve endpoints; all now enforce department scope.
2. **A single manually typed member ID such as `CC-2026-TEMP` broke new-member registration for everyone** (the generator produced `CC-2026-0NaN`, then rejected every registration after it with "Member ID already in use").
3. **The "stolen refresh token revokes every session" control never worked** — the revocation was rolled back by the transaction wrapper the moment the handler threw.

The two open items that matter before a church goes live: the application connects to PostgreSQL as a **superuser** (both locally and in the shipped Docker deployment), and the account-lockout message confirms which email addresses exist.

| Area | Rating | Basis |
|---|---|---|
| Functional correctness | Good after fixes | 234 / 242 API contract checks pass; the 8 remaining are a known harness artefact, covered correctly by a second suite (24 / 27, see §4) |
| Data integrity | Good | No duplicates, orphans or partial writes in any concurrency or crash test |
| Security | Good after fixes; 2 open | IDOR, audit-IP spoofing, replay revocation, wildcard grant, token-in-URL fixed; superuser DB role and lockout enumeration open |
| Performance | Adequate for target scale | Simple reads ≥350 rps, dashboard ~85 rps on a shared dev box; latency is queueing-bound by the 20-connection pool |
| Resilience | Good | Self-heals from connection loss; refuses to boot on bad config; SMTP outage does not affect the API |
| Observability | Improved; still thin | Health now probes the DB; failed jobs and failed emails are still only visible in stdout |

---

## 2. System discovery

### Components

| Component | Implementation | Notes |
|---|---|---|
| Client | React 18 SPA (Vite), single origin via proxy | Calls `/api/*` only; access token in memory, refresh token in an httpOnly cookie |
| API | Node 26, Express 5, TypeScript; one process | 14 route modules, Zod validation, helmet/cors/compression |
| Auth | Argon2id passwords; 15-min HS256 JWT; rotating refresh token (SHA-256 stored) | Permissions re-read from the DB on every request |
| Database | PostgreSQL 18.4, single instance; `pg` pool max 20 | 18 tables, CHECK constraints, partial unique indexes; `statement_timeout` was 0 |
| File storage | Local disk (`UPLOAD_DIR/members`), sharp re-encode | Docker volume in production; not shared across instances |
| Background jobs | node-cron in-process: absence scan 01:30, birthday reminders 06:00 | Now also token cleanup 03:15 |
| Email | nodemailer SMTP, fire-and-forget | Optional; degrades to log output |
| Caching | 60 s in-process settings cache | Invalidated on write; not shared across instances |
| Rate limiting | express-rate-limit, in-memory, per IP | 300/min global (now configurable), tighter on credential endpoints |
| Logging | stdout (morgan in dev, console.*) | No structured logging, no metrics, no alerting |
| Deployment | Docker Compose: Caddy → app → db | `trust proxy = 1` in production |

### Dependency map

```
 browser ──HTTPS──▶ Caddy ──▶ Express API ──pg pool (20)──▶ PostgreSQL
                                 │  │  │
                                 │  │  └──▶ local disk (member photos)
                                 │  └─────▶ SMTP (optional, background, no retry)
                                 └────────▶ node-cron (3 jobs, in-process)
```

Every request-serving path depends on PostgreSQL. Nothing depends on SMTP or the cron jobs to serve a page. There is no queue, no cache server and no second process — which is why the single 20-connection pool is the throughput ceiling (§6).

### Uncertainties

- Production behaviour behind Caddy (`trust proxy = 1`) was reasoned from code and config, not exercised; the review ran with `trust proxy = false`.
- CPU utilisation was not sampled numerically: the load generator shared the 14 cores with the API and PostgreSQL, so absolute throughput figures are indicative only.

---

## 3. Baseline (single user, disposable DB, 15 samples per endpoint)

All 22 read endpoints returned 200. p50 latency 2–12 ms; the slowest p95 was the dashboard at 210 ms (first-request JIT), 12 ms thereafter. Exports (XLSX 11.8 KB, PDF 9.9 KB) completed in ≤37 ms. Login (Argon2id verify) ≈ 30–100 ms.

Database: all key query plans execute in under 1 ms at this size; planning time (3–14 ms) dominates. Pool max 20, `max_connections` 100, `shared_buffers` 128 MB, `work_mem` 4 MB. Statistics had never been analysed (tables below autovacuum thresholds) — harmless now, self-correcting after any sizeable import.

---

## 4. Defects found

Severity: **Critical** = data loss / full compromise; **High** = wrong data, broken core workflow or a broken security control; **Medium** = incorrect behaviour or a security weakness with a precondition; **Low** = wrong status code, hygiene, growth.

| ID | Defect | Severity | Root cause | Status |
|---|---|---|---|---|
| D1 | Member-code generator emits `CC-YYYY-0NaN` after any non-numeric manual code, then every later registration fails with 409 | **High** | `ORDER BY member_code DESC LIMIT 1` + `parseInt` — letters sort above digits; also `CC-2026-10000` would sort below `9999` | **Fixed** — numeric `MAX` over regex-anchored codes |
| D2 | Replaying a used refresh token does not revoke the user's sessions (README and API.md claimed it does) | **High** | Revoke-all `UPDATE` ran inside `tx()`, which rolls back when the handler throws | **Fixed** — decision returned from the transaction, revocation runs after commit; 10 s grace window for racing tabs |
| D3 | Department Leader row-level scope bypass on 12 endpoints (member attendance/follow-ups/timeline, follow-up get/patch/notes/create, department roster, 5 reports, congregation register, creating congregation-wide services) | **High** | Scope applied to list queries only; sub-resources and id-addressed routes had no check | **Fixed** — `middleware/scope.ts` helpers applied to every id-addressed route; reports and registers filtered |
| D4 | Audit-log and session IP address are attacker-controlled via `X-Forwarded-For` | Medium | `clientIp()` parsed the raw header regardless of `trust proxy` | **Fixed** — uses `req.ip` |
| D5 | A member's second absence episode never raises a notification | Medium | `dedupe_key` `absence:<member>:<level>:<role>` is permanent | **Fixed** — key includes last attendance date |
| D6 | `/api/health` returns 200 with the database gone; probes count against the rate limit | Medium | No DB probe; registered after the limiter | **Fixed** — 2 s DB probe → 503 `degraded`; registered before the limiter |
| D7 | Malformed JSON → 500; body > 1 MB → 500 (both logged as bugs with stack traces) | Medium | body-parser errors fell through to the "unexpected" branch | **Fixed** — mapped to 400 / 413 |
| D8 | 500s from ids beyond BIGINT, impossible dates that pass the `YYYY-MM-DD` regex (`2026-02-30`), and a member listed twice in one register batch | Medium | PG codes 22003 / 22007 / 22008 / 21000 / 22P02 not translated; batch not de-duplicated | **Fixed** — translations added; register de-duplicated (last mark wins) |
| D9 | Access token accepted from `?access_token=` (unused by the client; leaks into logs/history); `bearer` scheme case-sensitive | Low | Fallback left in `extractToken` | **Fixed** — header only, case-insensitive |
| D10 | Wildcard `*` grantable to any role | Low | Validation allowed `'*'` unconditionally | **Fixed** — rejected outside the catalogue |
| D11 | Wrong multipart field name answered 413 "too large" | Low | All multer errors mapped to 413 | **Fixed** — 400 |
| D12 | No `statement_timeout` / `idle_in_transaction_session_timeout` | Low | Not set | **Fixed** — 60 s each, pool-level |
| D13 | `refresh_tokens` and `password_resets` grow forever (~96 rows per active user per day) | Low | No pruning | **Fixed** — daily cleanup job, 30-day retention |
| D14 | Global rate limit hard-coded at 300/min per IP — a church on one Wi-Fi shares it | Low | Constant in `app.ts` | **Fixed** — `API_RATE_LIMIT_PER_MINUTE` (default unchanged) |
| O1 | Application connects as PostgreSQL **superuser** (`postgres` locally; `POSTGRES_USER` is the superuser in the official Docker image) | **High** (deployment) | Convenience default | **Open** — see §9 |
| O2 | Locked account answers 403 "Too many failed attempts"; unknown account answers 401 — five wrong guesses confirm an address exists | Low–Medium | Deliberate UX choice conflicts with the enumeration claim | **Open** — options in §9 |

Documentation mismatches corrected along the way: API.md said follow-up `level` is "never trusted from the client" (it is accepted; docs now say so); OPERATIONS.md said outbound email was not implemented (it is).

### Behaviours observed and judged correct (not defects)

- An explicit `absent` mark counts even on an incomplete register; only *missing* rows are governed by the 40 % completeness guard. Verified per member on a fresh Sunday (0 of 86 unmarked members gained a miss).
- A member registered today with `dateJoined` months ago is immediately flagged (services after joining count). Design intent, but worth a note in the registration form.
- A 100-megapixel, 12 KB "decompression bomb" PNG was processed in 0.65–2 s with no measurable memory growth — libvips shrinks on load. No amplification risk found.
- Leap-day birthdays list in February with a valid next date; leader search and birthday lists were already correctly scoped.

---

## 5. Performance results

Ten seconds per level, one scenario at a time, client and server on the same machine. `users` = concurrent closed-loop clients.

| Scenario | Users | rps | p50 ms | p95 ms | p99 ms | Errors |
|---|---|---|---|---|---|---|
| Members list (page of 20) | 1 / 10 / 50 / 100 / 200 / 500 | 80 / 328 / 357 / 364 / 371 / 349 | 10 / 24 / 114 / 234 / 475 / 1313 | 17 / 35 / 171 / 404 / 721 / 1797 | 39 / 55 / 240 / 521 / 895 / 2181 | 0 % at every level |
| Member detail | 1 / 10 / 50 / 100 / 200 / 500 | 192 / 567 / 533 / 494 / 555 / 503 | 5 / 17 / 90 / 182 / 357 / 981 | 6 / 26 / 126 / 257 / 450 / 1150 | 9 / 35 / 168 / 813 / 485 / 1189 | 0 % |
| Alerts (absence engine on read) | 1 / 10 / 50 / 100 | 28 / 100 / 86 / 95 | 33 / 86 / 513 / 962 | 46 / 152 / 963 / 1443 | 54 / 269 / 1036 / 1477 | 0 % |
| Dashboard (12 queries + engine) | 1 / 5 / 10 / 25 / 50 / 100 | 34 / 87 / 83 / 79 / 67 / 83 | 26 / 51 / 109 / 269 / 590 / 1134 | 43 / 82 / 175 / 519 / 1767 / 1589 | 72 / 135 / 298 / 658 / 2025 / 1679 | 0 % |
| Search | 1 / 10 / 50 / 100 | 175 / 352 / 381 / 361 | 5 / 21 / 117 / 237 | 7 / 40 / 154 / 437 | 17 / 94 / 255 / 920 | 0 % |

**Reading the table.** Throughput plateaus by 10–50 users and stays flat to 500; beyond the plateau every extra client only adds queueing delay. The database pool (20) was fully occupied from 50 users upward in every scenario, and no request ever waited long enough to hit the 10 s connection timeout — which is why the error rate is zero throughout. The knee (p95 > 1 s) is at **50 users for the dashboard, 100 for the alert feed, 500 for simple reads**.

**Maximum stable load** (p95 < 1 s, 0 errors) on this machine: ~25 concurrent dashboard users, ~50 alert-feed users, ~200 simple-read users. A church of 600 members with a dozen staff is one to two orders of magnitude below this.

**Memory.** API RSS 117 MB idle; 190–360 MB under load (V8 heap growth, reclaimed between levels); 258 → 219 MB across the four-minute soak. PostgreSQL ~92 MB across 10 processes. **CPU** not sampled numerically (shared box).

**Soak (4 min, 8 workers, 9-endpoint mix):** 39,633 requests, 0 errors; p95 per 20 s window 103–156 ms with no upward trend (first-half mean 118 ms, second-half 134 ms); DB connections never exceeded 20; zero idle-in-transaction sessions; RSS ended 39 MB *below* its start. No leak signature in this window; a multi-hour soak was not run.

**Spike.** Each load level starts cold from an idle pool, which is a 10× step in practice (e.g. 5 → 50 dashboard users): latency rose, no errors, and the next level recovered to its own steady state within 1.5 s of drain time. No requests were lost and no writes were duplicated.

---

## 6. Reliability

### Current failure points

| Point | Observed behaviour | Assessment |
|---|---|---|
| Every DB connection killed mid-traffic (`pg_terminate_backend`) | 8 of 200 in-flight requests failed with 500 + reference id; first success 236 ms later; last failure 48 ms after the kill; no restart needed | **Good.** Pool replaces dead clients transparently |
| Process killed under write load, restarted | ~5.3 s outage (tsx cold start); 144 of 348 writes during the outage failed with ECONNRESET/ECONNREFUSED; the register on disk was either empty or complete (91/91), never partial; no duplicates | **Good.** Register saves are one transaction |
| DB unreachable at boot / wrong DB / short secret / placeholder secrets in production | Exits 1 with a message naming the cause and the fix | **Good** |
| Invalid cron expression | Boots, logs the error, skips that job | Acceptable; nothing alerts |
| SMTP host down | `forgot-password` still answers 200 in 124–323 ms; API unaffected; failure logged once then suppressed | Acceptable by design, but the user is told a link was sent and nobody is told it was not (§8) |
| Graceful drain on SIGTERM | Not exercisable on Windows (`taskkill` is immediate). The handler exists and is reachable in Docker | Untested |
| PostgreSQL service stopped entirely / disk full | Not simulated (no elevated shell; disk-full is not safely simulable here) | Untested |

### Recovery

Self-recovery is automatic for connection loss. Process death relies on the Docker restart policy (`unless-stopped`), which is present. There is no retry for failed email and no catch-up for a missed nightly scan; both are idempotent, so the cost of a miss is a delay, not corruption.

### Resource exhaustion

- **DB pool** is the only shared resource that saturates. It degrades to queueing, not errors, until a request waits > 10 s — never reached here.
- **Memory** has no observed growth path in a 4-minute window; the one theoretical amplifier (image decoding) was tested and did not amplify.
- **Disk**: replaced member photos are deleted; audit logs and (now) token tables are the growth surfaces. Audit is intended to be append-only.
- **Rate limiter** memory is per-IP in-process; bounded by distinct client addresses.

---

## 7. Security findings

Authorised, defensive tests against the disposable instance. Nothing was exploited beyond proof.

| Finding | Result |
|---|---|
| Authentication: wrong password / unknown email / malformed / empty / forged `alg=none` / expired / wrong issuer / deleted user / lower-case scheme / Basic auth | All rejected correctly (401 or 422); unknown and wrong-password messages identical |
| Refresh rotation and replay | Rotation works; **replay revocation did not persist (D2, fixed)**; multi-tab race now handled with a 10 s grace |
| Deactivation / role change | Takes effect on the next request (permissions re-read per request) |
| Cookie attributes | HttpOnly, SameSite=Strict, Path=/api/auth, session cookie without "remember me"; Secure gated on production |
| CORS / headers | Foreign origins get no ACAO; helmet CSP, nosniff, no-referrer, frame-ancestors none; `x-powered-by` absent |
| Authorisation matrix (5 roles × 28 route/permission pairs) | All correct |
| **Row-level scope (Department Leader)** | **12 bypasses (D3, fixed)** |
| **Audit / session IP** | **Spoofable (D4, fixed)** |
| **Lockout enumeration** | **Open (O2)** |
| Uploads | Polyglot payload does not survive re-encode; non-images, wrong MIME, tiny, oversized and traversal filenames all rejected or neutralised; random 32-hex names; no orphan rows |
| Injection | Every statement parameterised; sort columns whitelisted; SQL-ish and multibyte search terms harmless. `%` in a search term acts as a wildcard (harmless) |
| Mass assignment / method override | Unknown fields stripped; password hash not settable; `X-HTTP-Method-Override` ignored |
| Information leakage | FK/constraint text never reaches the client; no hashes in any payload; no plaintext passwords in audit rows; 500s carry a reference id (and a `debug` message only outside production) |
| **Token in URL** | **Accepted and unused (D9, fixed)** |
| **Wildcard grant** | **(D10, fixed)** |
| Timing side-channel on `forgot-password` | Inconclusive — the 5/hour limiter allowed only n = 2 per case |
| **DB privileges** | **Superuser (O1, open)** |

---

## 8. Observability

**Improved in this review:** `/api/health` probes the database and returns 503 when it is unreachable; it is exempt from the rate limiter so a monitor can poll freely.

**Still silent:**

- A nightly scan or birthday job that throws is logged to stdout and nothing else. Weekly log skimming is the only detector (OPERATIONS.md now says so).
- A failed password-reset or invitation email is logged once and then suppressed; the user is told a link was sent.
- The dev-only "slow query" warning measures pool wait plus execution, so under saturation it wrote ~14,000 lines in ten minutes. Production does not emit it; if you enable it there, measure execution separately.
- No structured logs, metrics, error tracking or alert routing exist. For a handful of churches the UptimeRobot + log-skim routine in OPERATIONS.md is defensible; past that, ship logs somewhere searchable and alert on `[jobs] ... failed` and `[email] send failed`.

---

## 9. Remaining risks and recommendations

### O1 — Run the application as a non-superuser database role (before any real deployment)

Locally the app connects as `postgres`; in Docker the `POSTGRES_USER` role the image creates is also a superuser. Any SQL-level compromise would then have the power to read files, run programs and drop databases. Add an init script to the `db` service (`/docker-entrypoint-initdb.d/01-app-role.sql`):

```sql
CREATE ROLE churchconnect_app LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE churchconnect TO churchconnect_app;
GRANT USAGE ON SCHEMA public TO churchconnect_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO churchconnect_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO churchconnect_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO churchconnect_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO churchconnect_app;
```

Run migrations as the owner, serve traffic as `churchconnect_app`, and point the app's `DATABASE_URL` at the new role. Nothing in the application needs more than DML.

### O2 — Lockout message reveals account existence

Five wrong guesses at an address return 403 "Too many failed attempts" if the account exists and 401 otherwise. Two honest options: (a) answer the generic 401 while locked and let administrators see lockouts in the audit log, accepting that a genuinely locked user is not told why; or (b) keep the message but apply the same lockout counter to unknown addresses (an in-memory map keyed by email), so the response is identical. The per-IP limiter (20 failures / 15 min) caps the probing rate at about four addresses per quarter hour, which is why this is rated low.

### Smaller items worth scheduling

- Reject register saves on a finalised service (409) unless it is reopened; the UI already reopens first, the API does not insist.
- Decide whether `level` on a manual follow-up should be client-settable; docs now describe current behaviour.
- Alert on failed jobs and failed emails (a role notification in-app would do).
- The `idx_members_fullname` index does not match the search expression and is never used; drop it, and add `pg_trgm` when member counts pass ~10,000.

### Not tested

Full PostgreSQL service stop (not elevated); disk full; 1,000 concurrent users (client shared the CPU; 500 was the ceiling tested); soak beyond four minutes; SIGTERM drain (Windows); multi-instance behaviour; the browser UI was re-driven only for sign-in and dashboard after the fixes, not every screen.

---

## 10. Future risk forecast

Assumes today's shape: one API process, one PostgreSQL, 20-connection pool, ~65 members / ~800 marks now.

| Growth | Risk | Cause | Expected failure | Detection | Prevention / fix |
|---|---|---|---|---|---|
| **2×** (a second church on the same server, ~1,200 members) | Sunday-morning rate limiting | Many ushers on one Wi-Fi share one IP bucket | Sporadic 429s while taking attendance | 429s in Caddy logs; users report "slow down" message | Raise `API_RATE_LIMIT_PER_MINUTE` per church (now configurable) |
| **5×** (~3,000 members, 5 churches) | Dashboard and alert feed slow under Sunday concurrency | Every dashboard load runs the absence engine over all members × 12 services and fans out 12 queries; pool of 20 saturates at ~25 concurrent dashboards | p95 > 1–2 s on the dashboard; no errors | Health stays 200; only latency monitors notice | Cache the engine result for 30–60 s per church; raise pool to 30–40 with `max_connections` to match; consider a second API replica (then the cron guard needs an advisory lock, as ARCHITECTURE.md already notes) |
| **5×** | Register finalisation takes seconds | The scan runs one transaction per flagged member, plus a fallback query per candidate with no attendance in the window | A 10–20 s finalise request; proxy timeout at 60 s only far beyond this | Slow finalise in the UI | Batch the per-candidate work into set-based SQL; run the scan asynchronously after finalise and notify on completion |
| **10×** (~6,000 members, or one large church) | Member search full-scans | `LIKE '%term%'` on a computed expression cannot use an index | Search p95 climbs to hundreds of ms | Slow-query logging (fix its measurement first) | `pg_trgm` GIN index on the searched expressions |
| **10×** | Export ceilings | Member export hard-caps at 5,000 rows; a register save carries at most 5,000 marks and ~13,000 would exceed PostgreSQL's 65,535-parameter limit | Silently truncated export; 500 on a giant register | Row counts in the audit description vs. expectations | Stream exports; chunk register upserts by 1,000 |
| **10×** | Audit and notification growth | Append-only audit; role notifications never deleted | Larger backups; slower audit page | Dump size trend (OPERATIONS.md health table) | Partition or archive audit by year; prune read role notifications older than N months |
| **Long term** | Single points of failure | One process, one DB, local-disk photos | An outage is total; photos are lost with the volume | Health 503 | Managed PostgreSQL with PITR; object storage for photos (the storage service is a one-file swap by design) |
| **Long term** | Cron in-process | Jobs run only while the API is up; no catch-up | Alerts delayed after a restart around 01:30 | `[jobs]` lines absent from the log | Move jobs to a scheduler that records runs, or add a "last run" row and run on boot if overdue |

---

## 11. Fixes applied (all typechecked; `npm test` 11 / 11 passing)

| Problem | Change | Test | Verified |
|---|---|---|---|
| D1 member-code `NaN` | `nextMemberCode` takes a numeric `MAX` over codes matching `^CC-YYYY-[0-9]+$` (`SUBSTRING … FROM $2::int` — the cast matters; untyped, PostgreSQL picks the regex overload, which the tests caught) | regression #4; 25 parallel registrations → contiguous unique codes | yes |
| D2 replay revocation | `refresh()` returns the replay decision from the transaction and revokes after commit; 10 s grace for racing tabs | regression #5; functional A; concurrency E | yes |
| D3 leader scope | New `middleware/scope.ts`; checks on member tabs, follow-up routes, department roster, attendance register/marks/finalise/reopen, service creation; five reports filtered | regression #8; functional K (12 checks) | yes |
| D4 IP spoofing | `clientIp()` → `req.ip` | regression #6; security A | yes |
| D5 silent second episode | Notification `dedupe_key` includes last attendance date | regression #11 | yes |
| D6 health | DB probe with 2 s budget → 503; registered before the limiter | regression #1; limiter re-check (300 OK then 429 on `/api/auth/branding`; health 20/20) | yes |
| D7 body errors | body-parser `entity.*` errors → 400 / 413; multer non-size errors → 400 | regression #2; security F | yes |
| D8 PG errors | `translatePgError` handles 22003, 22007, 22008, 22P02, 21000; register de-duplicated | regression #3, #9 | yes |
| D9 token in URL | Header-only, case-insensitive scheme | regression #7 | yes |
| D10 wildcard | `'*'` rejected outside the catalogue | regression #10 | yes |
| D12 timeouts | `statement_timeout` / `idle_in_transaction_session_timeout` 60 s on the pool | soak: 0 idle-in-transaction sessions | config |
| D13 pruning | `pruneAuthTokens()` daily at 03:15 (30-day retention) | boot log shows `auth-token-cleanup` scheduled | yes |
| D14 rate limit | `API_RATE_LIMIT_PER_MINUTE` env (default 300); documented in `deploy/.env.example` | main instance still limits at 300; QA instance ran at 1,000,000 | yes |
| Docs | API.md (auth, scope rules, health, limits), OPERATIONS.md (health 503, jobs, email), README (tests) | — | — |

Files changed: `server/src/{app.ts, config/db.ts, config/env.ts, middleware/auth.ts, middleware/error.ts, middleware/scope.ts (new), utils/errors.ts, services/audit.service.ts, services/absence.service.ts, modules/auth/auth.service.ts, modules/members/members.service.ts, modules/members/members.routes.ts, modules/followups/followups.routes.ts, modules/departments/departments.routes.ts, modules/attendance/attendance.service.ts, modules/attendance/attendance.routes.ts, modules/reports/reports.routes.ts, modules/users/users.routes.ts, jobs/scheduler.ts}`, `server/package.json` (`test` script), `server/test/regressions.test.ts` (new), `deploy/.env.example`, `docs/API.md`, `docs/OPERATIONS.md`, `README.md`.

**Behaviour changes to be aware of:** Department Leaders now receive 403 on other departments' rosters and members (the UI shows the message); `/api/health` can return 503; a member listed twice in one register save is taken once; `bearer` is accepted in any case; tokens in query strings are ignored; a role can no longer be given `*`.

---

## 12. Test inventory

| Suite | Scope | Result (after fixes) |
|---|---|---|
| 01 baseline | 22 read endpoints × 15, 4 exports, login cost | 28 / 28 |
| 02 functional | Auth, members, codes, attendance, follow-ups, departments, users, settings, reports, RBAC matrix, leader scope, transport | 234 / 242 — the 8 are one harness artefact (a QA member auto-flagged by the engine), covered correctly by 02b |
| 02b register & follow-ups | Completeness guard, follow-up lifecycle, double-submit, batch duplicate | 24 / 27 before fixes; the 3 were D8 (fixed) and two expectation errors corrected in 02c |
| 02c engine precision | Per-member guard, window slide, birthday job with a due reminder, leap day | 9 / 10 — the 1 is state carried over from the earlier run (notifications already existed) |
| 04 security | XFF, enumeration, limiters, tokens, cookies, uploads, leakage, mass-assignment, timing, global limiter | 42 / 46 — O2 open; 3 are old expectations superseded by intended changes (health exempt, 400 for a bad field) |
| 05 load | 5 scenarios, 26 levels, 10 s each | 5 / 5 (0 % errors everywhere) |
| 06 concurrency | Parallel registrations, scans, register saves, double-submit, tab race, delete-vs-assign, settings | 17 / 19 — the 2 are harness artefacts (an off-by-one slice; a pre-flagged member) |
| 07 jobs | Scan idempotency ×5, settings interplay, birthday idempotency, dedupe episode | 18 / 19 before the D5 fix; D5 now covered by regression #11 |
| 08 soak | 4 min, 8 workers, 9-endpoint mix, sampled every 20 s | 5 / 5 |
| 09 fault | Connection kill, bad boot configs, SMTP down, process kill + restart | 11 / 11 (F1/F5 from the first run; F2–F4 re-verified after a harness correction) |
| `npm test` | 11 committed regression tests | 11 / 11 |
