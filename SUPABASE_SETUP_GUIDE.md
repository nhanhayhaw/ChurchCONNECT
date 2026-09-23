# ChurchConnect — Supabase Setup Guide

For whoever creates the Supabase database by hand and then points the
application at it. Every SQL block is meant to be pasted into
**Supabase Dashboard → SQL Editor → New query → Run**, in the order given.

**How this guide was produced.** The whole application under
`C:\Users\ANP\Desktop\churchconnect` was read locally: every server module,
middleware, service, migration and seed file, and every client page, context
and type. Nothing was connected to. No MCP server was used. No table was
created or altered anywhere by this process. The SQL below was checked for
syntax and for the behaviour of its policies against a throw-away *local*
PostgreSQL database with a stub `auth` schema, then that database was dropped.
Your Supabase project has not been touched.

**Read section 0 before anything else.** It contains the one decision that
changes everything that follows.

---

## Contents

0. [The decision you must make first](#0-the-decision-you-must-make-first)
1. [Phase 1 — Application audit](#phase-1--application-audit)
2. [Phase 2 — Required database structure](#phase-2--required-database-structure)
3. [Phase 3 — Authentication design](#phase-3--authentication-design)
4. [Phase 4 — SQL scripts](#phase-4--sql-scripts)
5. [Phase 5 — Row Level Security](#phase-5--row-level-security)
6. [Phase 6 — Entity relationship diagram](#phase-6--entity-relationship-diagram)
7. [Phase 7 — Connecting the application](#phase-7--connecting-the-application)
8. [Phase 8 — Verification](#phase-8--verification)
9. [DANGEROUS / OPTIONAL MIGRATIONS](#dangerous--optional-migrations)
10. [Assumptions register](#assumptions-register)

---

## 0. The decision you must make first

ChurchConnect is **not** a browser application that talks to Supabase. It is a
classic three-tier system:

```
React client  ──HTTP──▶  Express API (Node)  ──pg driver──▶  PostgreSQL
```

The API server owns every rule: who may sign in, which role sees which rows,
what a Department Leader is allowed to touch. The browser never speaks SQL and
never holds a database credential. Supabase is, to this application, simply a
hosted PostgreSQL server with a dashboard.

That produces two very different ways of "connecting Supabase", and your brief
asks for the second one:

| | Track A — hosted PostgreSQL only | Track B — Supabase Auth (this guide) |
|---|---|---|
| What changes | Two lines in `server/.env` | Schema **and** application code |
| Passwords stored in | `public.users.password_hash` (argon2id) | `auth.users`, managed by Supabase |
| Sessions | The API's own JWT + rotating refresh cookie | Supabase sessions |
| Works with today's code | **Yes, unchanged** | **No** — see [Phase 7](#phase-7--connecting-the-application) |
| Where documented | [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md) | This document |

Your brief says: *do not recommend storing passwords in a custom users table;
use Supabase Auth.* This guide therefore designs **Track B**. Its schema has no
`password_hash`, no `refresh_tokens`, no `password_resets`; `public.users`
becomes a profile row linked to `auth.users`.

**The consequence must be stated plainly:** the current server code signs
people in by comparing an argon2 hash in `public.users`, mints its own JWTs,
and rotates its own refresh tokens. Against the Track B schema those code paths
have no columns to read. Until the changes listed in Phase 7 are made, the
application will not start against this database. That is not a flaw in the
design; it is what "use Supabase Auth" means for an application that currently
has its own.

If you want something running on Supabase *today* and the auth migration
later, use Track A now (the existing migrations in `server/src/db/migrations/`
and the guide already in `docs/`), and come back to this document when you
are ready to move authentication. The
[DANGEROUS / OPTIONAL MIGRATIONS](#dangerous--optional-migrations) section
contains the exact `ALTER`s that convert a Track A database into Track B.

---

## Phase 1 — Application audit

### Stack

| # | Item | Finding |
|---|---|---|
| 1 | Framework | **Server:** Express 4. **Client:** React 18 with React Router 6 and TanStack Query 5. |
| 2 | Language | TypeScript throughout (server `"type": "module"`, ESM). |
| 3 | Build system | Server: `tsc` then `scripts/copy-migrations.mjs`. Client: Vite 6 with `tsc -b`. |
| 4 | Package manager | npm. Two separate packages: `server/package.json`, `client/package.json`. No workspace root. |
| 5 | Authentication | **Custom, server-side.** Argon2id password hashes in `public.users.password_hash`. 15-minute HS256 access JWT signed with `JWT_ACCESS_SECRET`. Rotating refresh token, SHA-256 hash stored in `refresh_tokens`, delivered as an `httpOnly; SameSite=Strict` cookie scoped to `/api/auth`. Per-account lockout after 5 failures. Reset and invitation tokens hashed in `password_resets`. Files: `server/src/modules/auth/auth.service.ts`, `auth.routes.ts`, `server/src/middleware/auth.ts`. |
| 6 | API architecture | REST under `/api/*`, one Express router per module. Every request re-reads the caller's role and permissions from the database (`middleware/auth.ts`), so a revoked permission takes effect on the next request. Zod validates bodies and params. |
| 7 | Database implementation | Raw SQL through `node-postgres` (`pg`), a single pool in `server/src/config/db.ts`. Parameterised everywhere. No ORM. Date columns are type-parsed to strings so calendar dates never shift across time zones. |
| 8 | Existing Supabase references | `.mcp.json` at the project root declares an HTTP MCP server for project ref `lwpsjkwgpbeoupilcpzc` — **not used** for this work, per your instruction. `docs/SUPABASE-SETUP.md` (Track A guide). `server/src/db/migrations/003_supabase_hardening.sql` and the `--fresh` guard in `migrate.ts` (both added in the previous session, both inert unless the migration runner is invoked). Commented Supabase lines in `server/.env` and `.env.example`. No `@supabase/supabase-js`, no `createClient`, anywhere in application code. |
| 9 | Environment variables | Validated by Zod at boot in `server/src/config/env.ts`: `NODE_ENV`, `PORT`, `CLIENT_ORIGIN`, `DATABASE_URL`, `PGSSL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_MINUTES`, `API_RATE_LIMIT_PER_MINUTE`, `UPLOAD_DIR`, `MAX_UPLOAD_BYTES`, `SMTP_*`, `MAIL_FROM`, `MAIL_REPLY_TO`, `RESET_TOKEN_TTL_MINUTES`, `INVITE_TOKEN_TTL_DAYS`, `ENABLE_JOBS`, `ABSENCE_JOB_CRON`, `BIRTHDAY_JOB_CRON`, `TZ`, `SEED_DEFAULT_PASSWORD`. The client has **no** environment variables; it reaches the API through Vite's `/api` proxy in development. |
| 10 | `.env` files | `server/.env` (live, local PostgreSQL, git-ignored) and `server/.env.example`. None in `client/`. |
| 11 | Database types / interfaces | No generated types. `client/src/types/index.ts` hand-mirrors the API's JSON (`AuthUser`, `MemberListItem`, `MemberDetail`, `ServiceSummary`, `RegisterEntry`, `AbsenceAlert`, `FollowUp`, `FollowUpNote`, `Birthday`, `Department`, `Group`, `AppNotification`, `DashboardData`, `AdminUser`, `AuditEntry`). Server-side row shapes are inline interfaces per service. The schema of record is `server/src/db/migrations/001_init.sql` plus `002_invitations.sql`. |

### Routes, services and screens

| # | Item | Finding |
|---|---|---|
| 12 | API routes | `/api/auth`, `/api/dashboard`, `/api/members`, `/api/attendance`, `/api/follow-ups`, `/api/birthdays`, `/api/departments`, `/api/groups`, `/api/reports`, `/api/notifications`, `/api/users`, `/api/settings`, `/api/audit-logs`, `/api/search`, plus `/api/health`. Mounted in `server/src/app.ts`. |
| 13 | Services | `absence.service.ts` (streak engine, raises alerts and opens follow-ups), `audit.service.ts`, `settings.service.ts` (60 s cache), `storage.service.ts` (member photos to local disk via `sharp`), `email/` (nodemailer, optional), plus per-module services for members, attendance, follow-ups, birthdays, reports/export. |
| 14 | Data access | All through `query()`, `queryOne()`, `tx()` in `config/db.ts`. No repository layer; SQL lives in the services and routes. |
| 15 | Forms that submit data | Login, forgot/reset password, change password, member create/edit (with photo upload), record attendance register, follow-up notes and status, department and group create/edit, user create/edit/reset/unlock, role permission editor, settings editor, birthday reminder dismissal, notification mark-as-read. |
| 16 | Pages that display database data | Dashboard, Members list and profile, Attendance list and register, Absence Alerts, Follow-ups list and detail, Birthdays, Departments list and detail, Groups list and detail, Reports, Notifications, Users, Settings, Audit Logs. |
| 17 | Dashboards | `DashboardPage.tsx`, fed by `/api/dashboard`: membership totals, attendance today/week/month, absence buckets, follow-up counts, birthdays, six chart series, recent services. All computed from base tables; **no materialised dashboard tables**. |
| 18 | User roles | Five, seeded, in `server/src/config/permissions.ts`: `super_admin`, `pastor`, `church_admin`, `department_leader`, `viewer`. Stored in `roles` with `is_system = true`. |
| 19 | Permissions | 24 `resource:action` strings in `permissions.ts`; a role holds a JSONB array of them; `*` is honoured only for `super_admin`. Routes declare `requirePermission(...)`. **Row scoping:** a `department_leader` is additionally confined to members of their own department (`middleware/rbac.ts` `departmentScope`, `middleware/scope.ts`). |
| 20 | Reports | `/api/reports` — computed on demand from members, attendance and follow-ups; Excel (`exceljs`) and PDF (`pdfkit`) export. **No report tables.** |
| 21 | Attendance | `attendance_services` (one per gathering, may be scoped to a department or group) and `attendance` (one row per member per service, `present / absent / excused`). Absence of a row means *not recorded*. Registers are finalised before feeding the absence engine. |
| 22 | Members | Full profile, soft-deleted via `deleted_at`, code `CC-YYYY-NNNN`, photo via `member_photos`, belongs to at most one department and one group. |
| 23 | Church | Single church per deployment. Identity lives in `system_settings` (`church_name`, `church_tagline`, `church_address`, `church_phone`, `church_email`, `church_logo_url`). **No `churches` table** and none is required. |
| 24 | Events | **None.** The word appears only as DOM events and as `attendance_services`, which is the gathering concept this application uses. No events table is required. |
| 25 | Financial | **None.** No donations, offerings, tithes, payments or expenses anywhere in server or client. No financial tables are required. |
| 26 | Notifications | In-app only. `notifications` addressed to one user *or* one role, with `dedupe_key` so nightly jobs never repeat; `notification_reads` per user. No push, no SMS. |
| 27 | Other persistent data | `audit_logs` (append-only, denormalised actor email), `birthday_reminders` (idempotent daily job), `system_settings` (key → JSONB), `schema_migrations` (the runner's ledger). Member photographs are **files on the API server's disk**, not database rows beyond `member_photos` metadata. |

### Searches performed, and what was not found

Searched all of `server/src` and `client/src` for: `supabase`, `createClient`,
`createServerClient`, `prisma`, `drizzle`, `localStorage`, `sessionStorage`,
`indexedDB`, `mock`, `donation`, `offering`, `tithe`, `payment`, `expense`,
`finance`, `visitor`, `event`.

- `localStorage` is used once, to remember the light/dark theme
  (`client/src/hooks/useTheme.ts`). Access tokens are deliberately kept in a
  module variable, never in storage.
- No mock data, no hard-coded records, no JSON fixtures. The only fictional
  data is generated by `server/src/db/seed.ts`.
- `visitor` exists only as a value of `members.membership_category`.

---

## Phase 2 — Required database structure

Derived from the SQL the code actually runs. Every column below is read or
written somewhere in `server/src`. Tables are grouped by dependency order,
which is also the order the scripts create them.

**Conventions carried over from the application** (and why):

- `bigserial` surrogate keys everywhere. Every foreign key in the code is a
  `bigint`; changing that would touch every query.
- `check` constraints instead of `enum` types — adding a value is one `alter`.
- Explicit `on delete` on every foreign key. Reference data a row merely points
  at → `set null`; data that exists only because of its parent → `cascade`.
- `updated_at` maintained by a trigger, never by the application.

### 2.1 `roles`

Five seeded roles; `permissions` is a JSONB array of `resource:action` strings.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| name | varchar(50) | no | | unique; `super_admin`, `pastor`, `church_admin`, `department_leader`, `viewer` |
| label | varchar(100) | no | | |
| description | text | yes | | |
| permissions | jsonb | no | `'[]'` | array of strings; `"*"` for super admin |
| is_system | boolean | no | `false` | seeded roles; cannot be deleted |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | trigger |

### 2.2 `departments`

What a member *does* (choir, ushering, media).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| name | varchar(120) | no | | unique |
| description | text | yes | | |
| leader_member_id | bigint | yes | | FK → members.id, set null (added after `members`) |
| meeting_day | varchar(20) | yes | | |
| meeting_time | varchar(20) | yes | | |
| is_active | boolean | no | `true` | |
| created_at / updated_at | timestamptz | no | `now()` | trigger on updated_at |

### 2.3 `groups`

Where a member *belongs* (cell, prayer group, zone, fellowship).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| name | varchar(120) | no | | unique |
| group_type | varchar(30) | no | `'cell'` | check: cell, prayer, bible_study, zone, fellowship |
| description | text | yes | | |
| leader_member_id | bigint | yes | | FK → members.id, set null (added later) |
| meeting_day / meeting_time | varchar(20) | yes | | |
| meeting_location | varchar(200) | yes | | |
| is_active | boolean | no | `true` | |
| created_at / updated_at | timestamptz | no | `now()` | trigger |

### 2.4 `members`

The heart of the system. **Soft-deleted**: the API only ever sets
`deleted_at`; it never issues `DELETE FROM members`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| member_code | varchar(30) | no | | unique, e.g. `CC-2026-0001` |
| first_name | varchar(80) | no | | |
| middle_name | varchar(80) | yes | | |
| last_name | varchar(80) | no | | |
| gender | varchar(10) | no | | check: male, female |
| date_of_birth | date | yes | | check: not in the future |
| marital_status | varchar(20) | yes | | check: single, married, divorced, widowed |
| nationality | varchar(60) | yes | `'Ghanaian'` | |
| phone / alt_phone | varchar(30) | yes | | |
| email | varchar(150) | yes | | |
| address | text | yes | | |
| date_joined | date | no | `current_date` | |
| membership_status | varchar(20) | no | `'active'` | check: active, inactive, transferred, deceased |
| baptism_status | varchar(20) | no | `'not_baptised'` | check: baptised, not_baptised, pending |
| communion_status | varchar(20) | no | `'not_communicant'` | check: communicant, not_communicant |
| membership_category | varchar(30) | no | `'full_member'` | check: full_member, associate, new_convert, visitor, child |
| ministry | varchar(120) | yes | | |
| department_id | bigint | yes | | FK → departments, set null |
| group_id | bigint | yes | | FK → groups, set null |
| emergency_name | varchar(120) | yes | | |
| emergency_relationship | varchar(60) | yes | | |
| emergency_phone | varchar(30) | yes | | |
| photo_id | bigint | yes | | FK → member_photos, set null (added later) |
| notes | text | yes | | |
| created_by / updated_by | bigint | yes | | FK → users, set null (added later) |
| deleted_at | timestamptz | yes | | soft delete |
| created_at / updated_at | timestamptz | no | `now()` | trigger |

Indexes (all driven by real queries): status (partial, `deleted_at is null`),
department, group, gender, date_joined, deleted_at, phone, lower(full name),
and `(extract(month), extract(day))` of `date_of_birth` for birthday lookups
that ignore the year.

### 2.5 `member_photos`

One row per uploaded image. `members.photo_id` points at the current one. The
file itself lives on the API server's disk under `UPLOAD_DIR`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| member_id | bigint | no | | FK → members, cascade |
| file_name | varchar(255) | no | | random name on disk |
| storage_path | varchar(500) | no | | relative to UPLOAD_DIR |
| mime_type | varchar(60) | no | | check: image/jpeg, image/png |
| size_bytes | integer | no | | check > 0 |
| uploaded_by | bigint | yes | | FK → users, set null (added later) |
| created_at | timestamptz | no | `now()` | |

### 2.6 `users` — the profile table

A **sign-in**, not a person. Most members never log in; some staff are not
members. In Track B this row holds everything about a user *except*
credentials; those live in `auth.users`. See Phase 3 for the reasoning.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK — kept as `bigint` so the eleven FKs that point here are unchanged |
| auth_user_id | uuid | yes | | **unique**; FK → `auth.users(id)`, set null. Null = profile exists, no login yet |
| full_name | varchar(150) | no | | |
| email | varchar(150) | no | | unique case-insensitively; mirrors `auth.users.email` |
| phone | varchar(30) | yes | | |
| role_id | bigint | no | | FK → roles, **restrict** |
| member_id | bigint | yes | | FK → members, set null |
| department_id | bigint | yes | | FK → departments, set null — the Department Leader's scope |
| is_active | boolean | no | `true` | application-level deactivation |
| must_change_password | boolean | no | `false` | app flag; the change itself happens in Supabase Auth |
| last_login_at | timestamptz | yes | | maintained by the API on `/me`; `auth.users.last_sign_in_at` is the authority |
| created_at / updated_at | timestamptz | no | `now()` | trigger |

**Removed relative to the Track A schema:** `password_hash`,
`failed_login_attempts`, `locked_until` (Supabase Auth owns lockout and rate
limiting). **Removed tables:** `refresh_tokens`, `password_resets` (Supabase
Auth owns sessions, recovery and invitations).

### 2.7 `attendance_services`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| service_date | date | no | | |
| service_type | varchar(40) | no | | check: sunday_service, midweek_service, bible_study, prayer_meeting, youth_service, womens_ministry, mens_ministry, special_programme |
| title | varchar(160) | yes | | |
| department_id | bigint | yes | | FK → departments, set null; null = congregation-wide |
| group_id | bigint | yes | | FK → groups, set null |
| notes | text | yes | | |
| is_finalized | boolean | no | `false` | only finalised registers feed the absence engine |
| recorded_by | bigint | yes | | FK → users, set null |
| created_at / updated_at | timestamptz | no | `now()` | trigger |

Unique index on `(service_date, service_type, coalesce(department_id,0),
coalesce(group_id,0))` — `coalesce` because `null <> null` would otherwise
allow the same Sunday to be registered repeatedly.

### 2.8 `attendance`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| service_id | bigint | no | | FK → attendance_services, cascade |
| member_id | bigint | no | | FK → members, cascade |
| status | varchar(10) | no | | check: present, absent, excused |
| note | varchar(300) | yes | | |
| recorded_by | bigint | yes | | FK → users, set null |
| created_at / updated_at | timestamptz | no | `now()` | trigger |

Unique `(service_id, member_id)`.

### 2.9 `follow_ups`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| member_id | bigint | no | | FK → members, cascade |
| level | smallint | no | | check 1..3 |
| weeks_absent | smallint | no | `0` | |
| last_attendance_date | date | yes | | |
| status | varchar(30) | no | `'pending'` | check: pending, contacted, responded, needs_further_follow_up, resolved, unable_to_reach |
| source | varchar(10) | no | `'auto'` | check: auto, manual |
| assigned_to | bigint | yes | | FK → users, set null |
| assigned_at / last_contact_at / resolved_at | timestamptz | yes | | |
| next_follow_up_date | date | yes | | |
| created_by | bigint | yes | | FK → users, set null |
| created_at / updated_at | timestamptz | no | `now()` | trigger |

**Partial unique index** on `member_id where status not in ('resolved',
'unable_to_reach')` — one open case per member, enforced by the database so
two concurrent scans cannot duplicate an alert.

### 2.10 `follow_up_notes`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| follow_up_id | bigint | no | | FK → follow_ups, cascade |
| author_user_id | bigint | yes | | FK → users, set null |
| note | text | no | | |
| contact_method | varchar(20) | yes | | check: phone, sms, whatsapp, visit, email, in_person, other |
| status_at_time | varchar(30) | yes | | |
| created_at | timestamptz | no | `now()` | |

### 2.11 `birthday_reminders`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| member_id | bigint | no | | FK → members, cascade |
| birthday_date | date | no | | the birthday as it falls this year |
| days_before | smallint | no | | check ≥ 0 |
| remind_on | date | no | | |
| status | varchar(20) | no | `'pending'` | check: pending, shown, dismissed |
| created_at | timestamptz | no | `now()` | |

Unique `(member_id, birthday_date, days_before)` — makes the daily job idempotent.

### 2.12 `notifications`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| user_id | bigint | yes | | FK → users, cascade |
| role_id | bigint | yes | | FK → roles, cascade |
| type | varchar(40) | no | | check: absence_alert, followup_due, followup_overdue, birthday, new_member, system, attendance_missing |
| severity | varchar(10) | no | `'info'` | check: info, warning, critical |
| title | varchar(200) | no | | |
| body | text | yes | | |
| link | varchar(300) | yes | | |
| entity_type | varchar(40) | yes | | |
| entity_id | bigint | yes | | |
| dedupe_key | varchar(180) | yes | | partial unique where not null |
| created_at | timestamptz | no | `now()` | |

Check: exactly one of `user_id`, `role_id` is set.

### 2.13 `notification_reads`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| notification_id | bigint | no | | FK → notifications, cascade; PK part |
| user_id | bigint | no | | FK → users, cascade; PK part |
| read_at | timestamptz | no | `now()` | |

### 2.14 `audit_logs`

Append-only. The application never updates or deletes a row.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| user_id | bigint | yes | | FK → users, set null |
| user_email | varchar(150) | yes | | denormalised — survives account deletion |
| user_role | varchar(50) | yes | | |
| action | varchar(60) | no | | e.g. `member.create` |
| entity_type | varchar(40) | yes | | |
| entity_id | bigint | yes | | |
| description | text | no | | |
| ip_address | varchar(60) | yes | | |
| user_agent | varchar(300) | yes | | |
| metadata | jsonb | yes | | |
| created_at | timestamptz | no | `now()` | |

### 2.15 `system_settings`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigserial | no | | PK |
| key | varchar(80) | no | | unique |
| value | jsonb | no | | string, number, boolean or array |
| category | varchar(40) | no | `'general'` | church, birthdays, absence, followups |
| label | varchar(160) | no | | |
| description | text | yes | | |
| updated_by | bigint | yes | | FK → users, set null |
| updated_at | timestamptz | no | `now()` | trigger |

### 2.16 `schema_migrations`

The migration runner's ledger. Created so `npm run migrate` treats this
database as already up to date rather than trying to recreate tables.

### 2.17 View `v_member_attendance_summary`

Per-member present/absent/excused totals and last present date. Used by
reporting so ad-hoc queries and the application agree on one definition.

### Relationships

**One-to-one (optional):** `users.member_id → members` (a login may be a
member); `users.auth_user_id → auth.users` (a profile may have a login);
`members.photo_id → member_photos` (current photo).

**One-to-many:** roles → users; roles → notifications; users → refresh
history in audit_logs, follow_ups (assigned_to, created_by),
follow_up_notes, attendance_services (recorded_by), attendance (recorded_by),
member_photos (uploaded_by), members (created_by, updated_by),
system_settings (updated_by), notifications, notification_reads;
departments → members, users, attendance_services; groups → members,
attendance_services; members → member_photos, attendance, follow_ups,
birthday_reminders; attendance_services → attendance; follow_ups →
follow_up_notes; notifications → notification_reads.

**Many-to-many:** `members ↔ attendance_services` through `attendance`;
`users ↔ notifications` through `notification_reads`. There are no other
junction tables and none are needed: a member has at most one department and
one group by design.

**Deliberately absent:** events, finance, churches (single tenant), report
tables, dashboard tables, a separate `profiles` table (see Phase 3).

---

## Phase 3 — Authentication design

### 3.1 Does the application need Supabase Auth?

Functionally, no — it has a complete, well-built authentication system of its
own. Your brief requires it, and there are real gains: no password hashes in
your schema, Supabase's own rate limiting, breach-password checks, MFA if you
ever want it, and one less thing for the API to get wrong. The cost is the code
change in Phase 7. This design assumes you have accepted that cost.

### 3.2 How users register and log in

There is **no self-registration**. Accounts are created by a Super
Administrator (today's `POST /api/users`). That stays true. Supabase's public
sign-up must be **disabled**: *Authentication → Providers → Email → "Allow new
users to sign up" → off*. Otherwise anyone can create an `auth.users` row; it
would have no profile and no permissions, but it should not exist at all.

Login: the React client calls `supabase.auth.signInWithPassword({ email,
password })`. Supabase returns a session; the client sends
`session.access_token` as `Authorization: Bearer …` to the Express API exactly
as it sends its own token today. The API verifies the token (Phase 7) and looks
up the profile by `auth_user_id = token.sub`.

Password reset and invitations become Supabase flows:
`resetPasswordForEmail` from the client; `auth.admin.inviteUserByEmail` or
`auth.admin.createUser` from the server. The `password_resets` table and the
custom email templates for those two messages are no longer needed.

### 3.3 Connecting authenticated users to profiles

`public.users` **is** the profile table. It is not renamed to `profiles`
because eleven foreign keys and roughly forty queries reference `users`, and a
rename is a separate, mechanical refactor with no security benefit. If you
prefer the conventional name, create `profiles` as a view over `users` or do
the rename after everything works.

The link is `users.auth_user_id uuid unique references auth.users(id) on
delete set null`. Reasons for each part:

- **A separate `bigint` primary key** rather than reusing the auth UUID as the
  PK. Every FK in the schema and every `req.auth.userId` in the code is a
  `bigint`. Making `users.id` a UUID would change every table.
- **Nullable.** A Super Administrator can create the profile first (choosing
  role and department deliberately) and the login second. Until the person
  accepts their invitation the profile exists with `auth_user_id = null`, which
  is exactly what the Users page shows today as "invitation pending".
- **Unique.** One login, one profile.
- **`on delete set null`**, not cascade. Deleting the auth row must not delete
  the profile, because the profile is what audit logs, follow-up assignments
  and attendance registers point at. See 3.8.

A trigger on `auth.users` links a new auth row to a pre-existing profile with
the same email (case-insensitively), and keeps `users.email` in sync when the
auth email changes. There is deliberately **no** trigger that creates a profile
from a new auth row: a profile needs a role, and a role is a decision an
administrator makes, not something a trigger should default.

### 3.4 Is a profiles table required?

Yes — `public.users`, as above. Supabase's `auth.users` cannot carry role,
department scope, member link or deactivation state, and should not: it is
Supabase's table, and application code should treat its columns beyond `id`
and `email` as private.

### 3.5 How user IDs relate to `auth.users`

| Where | Identifier |
|---|---|
| JWT `sub` claim | `auth.users.id` (uuid) |
| `users.auth_user_id` | same uuid |
| `req.auth.userId`, every FK, every `entity_id` | `users.id` (bigint) |

The API translates once per request, in `middleware/auth.ts`: token `sub` →
`users` row → `req.auth`. Nothing downstream changes.

### 3.6 Roles

Unchanged: the five rows in `roles`, referenced by `users.role_id`. Roles are
**not** put into the JWT (`app_metadata`) because the application's whole
design is that a role change takes effect on the next request, not when a
token expires. The database is the source of truth; the token only proves
identity.

### 3.7 Permissions

Unchanged: `roles.permissions` JSONB, checked by `requirePermission()` in the
API and mirrored by `can()` in the client. In Phase 5 the same strings are
evaluated by SQL helper functions so Row Level Security enforces the identical
rules for any client that reaches PostgREST directly.

### 3.8 What happens when a user is deleted

Two different operations, and the distinction matters:

**Deleting the login (`auth.users` row)** — via Dashboard or
`auth.admin.deleteUser`. The trigger-free FK sets `users.auth_user_id` to
null. The profile remains, shown as inactive/"no login" in the Users page.
History is intact. Re-inviting the same email relinks it.

**Deleting the profile (`public.users` row)** — today's `DELETE /api/users/:id`.
Foreign keys behave as they do now: `set null` on members.created_by,
updated_by, member_photos.uploaded_by, attendance_services.recorded_by,
attendance.recorded_by, follow_ups.assigned_to and created_by,
follow_up_notes.author_user_id, system_settings.updated_by, audit_logs.user_id
(the email is denormalised there so the trail survives); `cascade` on
notifications and notification_reads addressed to that user. The API should
delete the auth user first (Phase 7), otherwise an orphan login remains that
can authenticate but has no profile — the middleware rejects it, but it is
untidy.

The API's existing guard rails — you cannot delete or demote yourself, and
you cannot remove the last active Super Administrator — remain in the API.
Row Level Security in Phase 5 reproduces the self-protection rules and states
which it cannot reproduce.

### 3.9 Are admin/staff/member roles required?

The application's five roles already cover this: `super_admin` and
`church_admin` are admin, `pastor` and `department_leader` are staff with
different scopes, `viewer` is read-only staff. **Members do not log in** and
must not be given `auth.users` rows; a member is a person in the register, not
a user of the system. Nothing in the client offers a member-facing view. Do not
add a "member" role.

---

## Phase 4 — SQL scripts

Paste each step into the SQL Editor and run it before moving to the next. Each
is idempotent where PostgreSQL allows (`create … if not exists`, `drop trigger
if exists` + `create trigger`, `drop policy if exists` + `create policy`,
constraint guards), so re-running a step after a partial failure is safe.
Nothing in Phase 4 drops a table or deletes a row.

> **Before you start:** Authentication → Providers → Email → turn **off**
> "Allow new users to sign up". Turn **on** "Confirm email" only if you intend
> to send invitations rather than set passwords by hand — see step 19.

### Step 1 — Extensions, helper schema, shared trigger

No extension is required. `gen_random_uuid()` is built into PostgreSQL 13+ and
the auth UUIDs are generated by Supabase anyway.

The `app` schema holds functions used by Row Level Security. It is kept out
of `public` so PostgREST does not expose them as RPC endpoints.

```sql
create schema if not exists app;

revoke all on schema app from public;
revoke all on schema app from anon;
grant usage on schema app to authenticated;
grant usage on schema app to service_role;

-- Keeps updated_at honest without trusting the application.
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
```

### Step 2 — `roles`

```sql
create table if not exists public.roles (
  id           bigserial primary key,
  name         varchar(50)  not null unique,
  label        varchar(100) not null,
  description  text,
  permissions  jsonb        not null default '[]'::jsonb,
  is_system    boolean      not null default false,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

drop trigger if exists trg_roles_updated on public.roles;
create trigger trg_roles_updated before update on public.roles
  for each row execute function public.set_updated_at();
```

### Step 3 — `departments` and `groups`

`leader_member_id` gets its foreign key in step 5, after `members` exists.

```sql
create table if not exists public.departments (
  id                bigserial primary key,
  name              varchar(120) not null unique,
  description       text,
  leader_member_id  bigint,
  meeting_day       varchar(20),
  meeting_time      varchar(20),
  is_active         boolean      not null default true,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

drop trigger if exists trg_departments_updated on public.departments;
create trigger trg_departments_updated before update on public.departments
  for each row execute function public.set_updated_at();

create table if not exists public.groups (
  id                bigserial primary key,
  name              varchar(120) not null unique,
  group_type        varchar(30)  not null default 'cell'
                    check (group_type in ('cell','prayer','bible_study','zone','fellowship')),
  description       text,
  leader_member_id  bigint,
  meeting_day       varchar(20),
  meeting_time      varchar(20),
  meeting_location  varchar(200),
  is_active         boolean      not null default true,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

drop trigger if exists trg_groups_updated on public.groups;
create trigger trg_groups_updated before update on public.groups
  for each row execute function public.set_updated_at();
```

### Step 4 — `members`

```sql
create table if not exists public.members (
  id                  bigserial primary key,
  member_code         varchar(30)  not null unique,
  first_name          varchar(80)  not null,
  middle_name         varchar(80),
  last_name           varchar(80)  not null,
  gender              varchar(10)  not null check (gender in ('male','female')),
  date_of_birth       date,
  marital_status      varchar(20)  check (marital_status in ('single','married','divorced','widowed')),
  nationality         varchar(60)  default 'Ghanaian',

  phone               varchar(30),
  alt_phone           varchar(30),
  email               varchar(150),
  address             text,

  date_joined         date         not null default current_date,
  membership_status   varchar(20)  not null default 'active'
                      check (membership_status in ('active','inactive','transferred','deceased')),
  baptism_status      varchar(20)  not null default 'not_baptised'
                      check (baptism_status in ('baptised','not_baptised','pending')),
  communion_status    varchar(20)  not null default 'not_communicant'
                      check (communion_status in ('communicant','not_communicant')),
  membership_category varchar(30)  not null default 'full_member'
                      check (membership_category in ('full_member','associate','new_convert','visitor','child')),
  ministry            varchar(120),

  department_id       bigint references public.departments(id) on delete set null,
  group_id            bigint references public.groups(id)      on delete set null,

  emergency_name          varchar(120),
  emergency_relationship  varchar(60),
  emergency_phone         varchar(30),

  photo_id            bigint,          -- FK added in step 5
  notes               text,

  created_by          bigint,          -- FK added in step 6
  updated_by          bigint,          -- FK added in step 6
  deleted_at          timestamptz,
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),

  constraint chk_members_dob_sane check (date_of_birth is null or date_of_birth <= current_date)
);

drop trigger if exists trg_members_updated on public.members;
create trigger trg_members_updated before update on public.members
  for each row execute function public.set_updated_at();

create index if not exists idx_members_status      on public.members (membership_status) where deleted_at is null;
create index if not exists idx_members_department  on public.members (department_id);
create index if not exists idx_members_group       on public.members (group_id);
create index if not exists idx_members_gender      on public.members (gender);
create index if not exists idx_members_date_joined on public.members (date_joined);
create index if not exists idx_members_deleted     on public.members (deleted_at);
create index if not exists idx_members_birth_md    on public.members (
  extract(month from date_of_birth), extract(day from date_of_birth)
) where date_of_birth is not null;
create index if not exists idx_members_fullname    on public.members (lower(first_name || ' ' || last_name));
create index if not exists idx_members_phone       on public.members (phone);
```

### Step 5 — `member_photos` and the deferred leader / photo keys

```sql
create table if not exists public.member_photos (
  id           bigserial primary key,
  member_id    bigint       not null references public.members(id) on delete cascade,
  file_name    varchar(255) not null,
  storage_path varchar(500) not null,
  mime_type    varchar(60)  not null check (mime_type in ('image/jpeg','image/png')),
  size_bytes   integer      not null check (size_bytes > 0),
  uploaded_by  bigint,      -- FK added in step 6
  created_at   timestamptz  not null default now()
);
create index if not exists idx_member_photos_member on public.member_photos (member_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_members_photo') then
    alter table public.members add constraint fk_members_photo
      foreign key (photo_id) references public.member_photos(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_departments_leader') then
    alter table public.departments add constraint fk_departments_leader
      foreign key (leader_member_id) references public.members(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_groups_leader') then
    alter table public.groups add constraint fk_groups_leader
      foreign key (leader_member_id) references public.members(id) on delete set null;
  end if;
end $$;
```

### Step 6 — `users` (profiles), linked to `auth.users`

No `password_hash`. No lockout columns. Credentials and sessions belong to
Supabase Auth.

```sql
create table if not exists public.users (
  id                    bigserial primary key,
  auth_user_id          uuid unique references auth.users(id) on delete set null,
  full_name             varchar(150) not null,
  email                 varchar(150) not null,
  phone                 varchar(30),
  role_id               bigint       not null references public.roles(id) on delete restrict,
  member_id             bigint       references public.members(id) on delete set null,
  department_id         bigint       references public.departments(id) on delete set null,
  is_active             boolean      not null default true,
  must_change_password  boolean      not null default false,
  last_login_at         timestamptz,
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now()
);

drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated before update on public.users
  for each row execute function public.set_updated_at();

create index        if not exists idx_users_role        on public.users (role_id);
create unique index if not exists idx_users_email_lower on public.users (lower(email));
create index        if not exists idx_users_auth        on public.users (auth_user_id);

comment on column public.users.auth_user_id is
  'Supabase Auth identity. Null = profile created, invitation not yet accepted. Credentials never live in this table.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_members_created_by') then
    alter table public.members add constraint fk_members_created_by
      foreign key (created_by) references public.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_members_updated_by') then
    alter table public.members add constraint fk_members_updated_by
      foreign key (updated_by) references public.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_member_photos_uploader') then
    alter table public.member_photos add constraint fk_member_photos_uploader
      foreign key (uploaded_by) references public.users(id) on delete set null;
  end if;
end $$;
```

### Step 7 — Link profiles to Supabase Auth automatically

When an administrator creates a profile first and then invites the person,
the auth row is created later with the same email. This trigger joins the two.
A second trigger keeps `users.email` in step if the auth email is ever changed.

Both run as the function owner (`security definer`) with a pinned
`search_path`, which is the required pattern for anything that fires from the
`auth` schema.

```sql
create or replace function app.link_profile_to_auth_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.users
     set auth_user_id = new.id
   where auth_user_id is null
     and lower(email) = lower(new.email);
  return new;
end $$;

drop trigger if exists trg_link_profile_on_auth_insert on auth.users;
create trigger trg_link_profile_on_auth_insert
  after insert on auth.users
  for each row execute function app.link_profile_to_auth_user();

create or replace function app.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where auth_user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_profile_email on auth.users;
create trigger trg_sync_profile_email
  after update of email on auth.users
  for each row execute function app.sync_profile_email();
```

### Step 8 — `attendance_services` and `attendance`

```sql
create table if not exists public.attendance_services (
  id             bigserial primary key,
  service_date   date         not null,
  service_type   varchar(40)  not null check (service_type in (
                   'sunday_service','midweek_service','bible_study','prayer_meeting',
                   'youth_service','womens_ministry','mens_ministry','special_programme')),
  title          varchar(160),
  department_id  bigint references public.departments(id) on delete set null,
  group_id       bigint references public.groups(id) on delete set null,
  notes          text,
  is_finalized   boolean      not null default false,
  recorded_by    bigint references public.users(id) on delete set null,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

drop trigger if exists trg_services_updated on public.attendance_services;
create trigger trg_services_updated before update on public.attendance_services
  for each row execute function public.set_updated_at();

create unique index if not exists idx_services_unique on public.attendance_services (
  service_date, service_type, coalesce(department_id, 0), coalesce(group_id, 0)
);
create index if not exists idx_services_date on public.attendance_services (service_date desc);
create index if not exists idx_services_type on public.attendance_services (service_type);

create table if not exists public.attendance (
  id          bigserial primary key,
  service_id  bigint      not null references public.attendance_services(id) on delete cascade,
  member_id   bigint      not null references public.members(id) on delete cascade,
  status      varchar(10) not null check (status in ('present','absent','excused')),
  note        varchar(300),
  recorded_by bigint references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_attendance unique (service_id, member_id)
);

drop trigger if exists trg_attendance_updated on public.attendance;
create trigger trg_attendance_updated before update on public.attendance
  for each row execute function public.set_updated_at();

create index if not exists idx_attendance_member  on public.attendance (member_id);
create index if not exists idx_attendance_service on public.attendance (service_id);
create index if not exists idx_attendance_status  on public.attendance (status);
```

### Step 9 — `follow_ups` and `follow_up_notes`

```sql
create table if not exists public.follow_ups (
  id                   bigserial primary key,
  member_id            bigint      not null references public.members(id) on delete cascade,
  level                smallint    not null check (level between 1 and 3),
  weeks_absent         smallint    not null default 0,
  last_attendance_date date,
  status               varchar(30) not null default 'pending' check (status in (
                         'pending','contacted','responded','needs_further_follow_up',
                         'resolved','unable_to_reach')),
  source               varchar(10) not null default 'auto' check (source in ('auto','manual')),
  assigned_to          bigint references public.users(id) on delete set null,
  assigned_at          timestamptz,
  last_contact_at      timestamptz,
  next_follow_up_date  date,
  resolved_at          timestamptz,
  created_by           bigint references public.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists trg_followups_updated on public.follow_ups;
create trigger trg_followups_updated before update on public.follow_ups
  for each row execute function public.set_updated_at();

-- One OPEN case per member. Enforced here, not in code, so concurrent scans cannot duplicate.
create unique index if not exists idx_followups_one_open_per_member
  on public.follow_ups (member_id)
  where status not in ('resolved','unable_to_reach');

create index if not exists idx_followups_status   on public.follow_ups (status);
create index if not exists idx_followups_level    on public.follow_ups (level);
create index if not exists idx_followups_assignee on public.follow_ups (assigned_to);
create index if not exists idx_followups_next     on public.follow_ups (next_follow_up_date);

create table if not exists public.follow_up_notes (
  id             bigserial primary key,
  follow_up_id   bigint      not null references public.follow_ups(id) on delete cascade,
  author_user_id bigint references public.users(id) on delete set null,
  note           text        not null,
  contact_method varchar(20) check (contact_method in ('phone','sms','whatsapp','visit','email','in_person','other')),
  status_at_time varchar(30),
  created_at     timestamptz not null default now()
);
create index if not exists idx_followup_notes_parent on public.follow_up_notes (follow_up_id, created_at desc);
```

### Step 10 — `birthday_reminders`

```sql
create table if not exists public.birthday_reminders (
  id             bigserial primary key,
  member_id      bigint      not null references public.members(id) on delete cascade,
  birthday_date  date        not null,
  days_before    smallint    not null check (days_before >= 0),
  remind_on      date        not null,
  status         varchar(20) not null default 'pending' check (status in ('pending','shown','dismissed')),
  created_at     timestamptz not null default now(),
  constraint uq_birthday_reminder unique (member_id, birthday_date, days_before)
);
create index if not exists idx_birthday_remind_on on public.birthday_reminders (remind_on, status);
```

### Step 11 — `notifications` and `notification_reads`

```sql
create table if not exists public.notifications (
  id          bigserial primary key,
  user_id     bigint references public.users(id) on delete cascade,
  role_id     bigint references public.roles(id) on delete cascade,
  type        varchar(40)  not null check (type in (
                'absence_alert','followup_due','followup_overdue','birthday',
                'new_member','system','attendance_missing')),
  severity    varchar(10)  not null default 'info' check (severity in ('info','warning','critical')),
  title       varchar(200) not null,
  body        text,
  link        varchar(300),
  entity_type varchar(40),
  entity_id   bigint,
  dedupe_key  varchar(180),
  created_at  timestamptz  not null default now(),
  constraint chk_notification_target check (
    (user_id is not null and role_id is null) or (user_id is null and role_id is not null)
  )
);
create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_role on public.notifications (role_id, created_at desc);
-- Partial unique index: any ON CONFLICT targeting it must repeat "where dedupe_key is not null".
create unique index if not exists idx_notifications_dedupe on public.notifications (dedupe_key)
  where dedupe_key is not null;

create table if not exists public.notification_reads (
  notification_id bigint      not null references public.notifications(id) on delete cascade,
  user_id         bigint      not null references public.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);
```

### Step 12 — `audit_logs`

```sql
create table if not exists public.audit_logs (
  id          bigserial primary key,
  user_id     bigint references public.users(id) on delete set null,
  user_email  varchar(150),
  user_role   varchar(50),
  action      varchar(60)  not null,
  entity_type varchar(40),
  entity_id   bigint,
  description text         not null,
  ip_address  varchar(60),
  user_agent  varchar(300),
  metadata    jsonb,
  created_at  timestamptz  not null default now()
);
create index if not exists idx_audit_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_user    on public.audit_logs (user_id);
create index if not exists idx_audit_action  on public.audit_logs (action);
create index if not exists idx_audit_entity  on public.audit_logs (entity_type, entity_id);
```

### Step 13 — `system_settings`

```sql
create table if not exists public.system_settings (
  id          bigserial primary key,
  key         varchar(80)  not null unique,
  value       jsonb        not null,
  category    varchar(40)  not null default 'general',
  label       varchar(160) not null,
  description text,
  updated_by  bigint references public.users(id) on delete set null,
  updated_at  timestamptz  not null default now()
);

drop trigger if exists trg_settings_updated on public.system_settings;
create trigger trg_settings_updated before update on public.system_settings
  for each row execute function public.set_updated_at();
```

### Step 14 — Attendance summary view

`security_invoker = on` makes the view run with the *caller's* rights. Without
it, a view owned by `postgres` would read straight past every row-level policy
on the tables beneath it.

```sql
create or replace view public.v_member_attendance_summary as
select
  m.id                                    as member_id,
  m.member_code,
  m.first_name || ' ' || m.last_name      as full_name,
  m.membership_status,
  m.department_id,
  count(a.id) filter (where a.status = 'present')  as times_present,
  count(a.id) filter (where a.status = 'absent')   as times_absent,
  count(a.id) filter (where a.status = 'excused')  as times_excused,
  max(s.service_date) filter (where a.status = 'present') as last_attendance_date
from public.members m
left join public.attendance a on a.member_id = m.id
left join public.attendance_services s on s.id = a.service_id and s.is_finalized
where m.deleted_at is null
group by m.id;

alter view public.v_member_attendance_summary set (security_invoker = on);
```

### Step 15 — Migration ledger

The application's migration runner would otherwise try to create `roles` on
its next run and fail. Recording the three files it knows about makes
`npm run migrate` a no-op against this database. **Do not run the application's
`001_init.sql` here** — it creates the Track A `users` table with
`password_hash`, which this design has replaced.

```sql
create table if not exists public.schema_migrations (
  filename   varchar(255) primary key,
  applied_at timestamptz  not null default now()
);

insert into public.schema_migrations (filename)
values ('001_init.sql'), ('002_invitations.sql'), ('003_supabase_hardening.sql')
on conflict (filename) do nothing;
```

### Step 16 — Row Level Security helper functions

These translate a Supabase session into the application's own vocabulary:
*which profile is this, what role, what permissions, which department*. They
are `security definer` so they can read `users` and `roles` without
themselves being subject to the policies they support (which would recurse),
and `stable` so PostgreSQL evaluates each once per statement when written as
`(select app.fn())` inside a policy.

```sql
create or replace function app.current_user_id() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id
    from public.users u
   where u.auth_user_id = auth.uid()
     and u.is_active
$$;

create or replace function app.current_role_id() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select u.role_id
    from public.users u
   where u.auth_user_id = auth.uid()
     and u.is_active
$$;

create or replace function app.current_role_name() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select r.name
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_user_id = auth.uid()
     and u.is_active
$$;

create or replace function app.current_department_id() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select u.department_id
    from public.users u
   where u.auth_user_id = auth.uid()
     and u.is_active
$$;

-- Mirrors hasPermission() in server/src/config/permissions.ts: "*" or an exact match.
create or replace function app.has_permission(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select (r.permissions ? '*') or (r.permissions ? p)
      from public.users u
      join public.roles r on r.id = u.role_id
     where u.auth_user_id = auth.uid()
       and u.is_active
  ), false)
$$;

-- Mirrors departmentScope() in server/src/middleware/rbac.ts:
-- everyone except a Department Leader is unscoped; a leader sees only their
-- own department, and a row with no department is outside every leader's scope.
create or replace function app.in_department_scope(dept bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when app.current_role_name() = 'department_leader'
             then dept is not null and dept = app.current_department_id()
           else true
         end
$$;

create or replace function app.member_in_scope(member bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.in_department_scope((select m.department_id from public.members m where m.id = member))
$$;

create or replace function app.follow_up_in_scope(follow_up bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.member_in_scope((select f.member_id from public.follow_ups f where f.id = follow_up))
$$;

revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;
grant execute on all functions in schema app to authenticated;
grant execute on all functions in schema app to service_role;
```

### Step 17 — Grants and Row Level Security

Three principles, in order:

1. **`anon` gets nothing.** No screen in this application works without a
   signed-in user; even the login page's church name comes from the API.
2. **`authenticated` gets the minimum table privileges the API actually
   exercises**, table by table, column by column where a column is sensitive.
   Supabase's default is `all` on every table; that default is revoked first.
3. **Row Level Security on every table, with policies that reproduce the
   API's rules.** Explanations are in Phase 5.

`service_role` and the `postgres` connection the API uses bypass RLS as table
owner / `bypassrls` holder, so the API's behaviour is unchanged. The policies
protect the *other* door — PostgREST — with the same rules.

```sql
-- 17.1 Take back the defaults ------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke usage on schema public from anon;

revoke all on all tables    in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on tables    from authenticated;
alter default privileges in schema public revoke all on sequences from authenticated;

-- 17.2 Least-privilege grants to authenticated (rows are then filtered by RLS)
grant usage on schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant select                                 on public.roles                to authenticated;
grant update (label, description, permissions) on public.roles              to authenticated;

grant select, insert, delete                 on public.users                to authenticated;
grant update (full_name, email, phone, role_id, department_id, member_id,
              is_active, must_change_password, last_login_at)
                                             on public.users                to authenticated;

grant select, insert, update, delete         on public.departments          to authenticated;
grant select, insert, update, delete         on public.groups               to authenticated;

grant select, insert, update                 on public.members              to authenticated;  -- no DELETE: soft-delete only
grant select, insert, delete                 on public.member_photos        to authenticated;

grant select, insert, update, delete         on public.attendance_services  to authenticated;
grant select, insert, update, delete         on public.attendance           to authenticated;

grant select, insert, update                 on public.follow_ups           to authenticated;
grant select, insert                         on public.follow_up_notes      to authenticated;

grant select                                 on public.birthday_reminders   to authenticated;
grant update (status)                        on public.birthday_reminders   to authenticated;

grant select                                 on public.notifications        to authenticated;
grant select, insert, delete                 on public.notification_reads   to authenticated;

grant select                                 on public.audit_logs           to authenticated;
grant select, insert, update                 on public.system_settings      to authenticated;

grant select                                 on public.v_member_attendance_summary to authenticated;
-- schema_migrations: no grant, no policy. Nobody but the owner touches it.

-- 17.3 Enable RLS everywhere --------------------------------------------------
alter table public.roles                enable row level security;
alter table public.users                enable row level security;
alter table public.departments          enable row level security;
alter table public.groups               enable row level security;
alter table public.members              enable row level security;
alter table public.member_photos        enable row level security;
alter table public.attendance_services  enable row level security;
alter table public.attendance           enable row level security;
alter table public.follow_ups           enable row level security;
alter table public.follow_up_notes      enable row level security;
alter table public.birthday_reminders   enable row level security;
alter table public.notifications        enable row level security;
alter table public.notification_reads   enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.system_settings      enable row level security;
alter table public.schema_migrations    enable row level security;
```

### Step 18 — Row Level Security policies

Each policy names the permission string from `permissions.ts` it enforces.
`(select …)` wrappers make PostgreSQL evaluate the helper once per statement.

```sql
-- roles ----------------------------------------------------------------------
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
  using ((select app.current_user_id()) is not null);

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles for update to authenticated
  using  ((select app.has_permission('users:manage')))
  with check (
    (select app.has_permission('users:manage'))
    -- The Super Administrator wildcard can never be removed (users.routes.ts).
    and (name <> 'super_admin' or permissions ? '*')
  );

-- users ----------------------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (
    auth_user_id = auth.uid()                       -- always your own profile (/me)
    or (select app.has_permission('users:read'))
  );

drop policy if exists users_insert on public.users;
create policy users_insert on public.users for insert to authenticated
  with check ((select app.has_permission('users:manage')));

drop policy if exists users_update on public.users;
create policy users_update on public.users for update to authenticated
  using ((select app.has_permission('users:manage')))
  with check (
    (select app.has_permission('users:manage'))
    -- You may not change your own role or deactivate yourself (users.routes.ts).
    and (
      id <> (select app.current_user_id())
      or (is_active and role_id = (select app.current_role_id()))
    )
  );

drop policy if exists users_delete on public.users;
create policy users_delete on public.users for delete to authenticated
  using (
    (select app.has_permission('users:manage'))
    and id <> (select app.current_user_id())         -- never yourself
  );

-- departments / groups -------------------------------------------------------
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
  using ((select app.has_permission('departments:read')));
drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments for insert to authenticated
  with check ((select app.has_permission('departments:manage')));
drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments for update to authenticated
  using ((select app.has_permission('departments:manage')))
  with check ((select app.has_permission('departments:manage')));
drop policy if exists departments_delete on public.departments;
create policy departments_delete on public.departments for delete to authenticated
  using ((select app.has_permission('departments:manage')));

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using ((select app.has_permission('groups:read')));
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated
  with check ((select app.has_permission('groups:manage')));
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated
  using ((select app.has_permission('groups:manage')))
  with check ((select app.has_permission('groups:manage')));
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated
  using ((select app.has_permission('groups:manage')));

-- members --------------------------------------------------------------------
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (
    (select app.has_permission('members:read'))
    and app.in_department_scope(department_id)      -- leaders: own department only
  );

drop policy if exists members_insert on public.members;
create policy members_insert on public.members for insert to authenticated
  with check (
    (select app.has_permission('members:create'))
    and app.in_department_scope(department_id)
  );

drop policy if exists members_update on public.members;
create policy members_update on public.members for update to authenticated
  using (
    (select app.has_permission('members:update'))
    and app.in_department_scope(department_id)
  )
  with check (
    (select app.has_permission('members:update'))
    and app.in_department_scope(department_id)      -- cannot move a member out of your scope
  );
-- No DELETE policy: the application soft-deletes by setting deleted_at.

-- member_photos --------------------------------------------------------------
drop policy if exists member_photos_select on public.member_photos;
create policy member_photos_select on public.member_photos for select to authenticated
  using ((select app.has_permission('members:read')) and app.member_in_scope(member_id));
drop policy if exists member_photos_insert on public.member_photos;
create policy member_photos_insert on public.member_photos for insert to authenticated
  with check ((select app.has_permission('members:update')) and app.member_in_scope(member_id));
drop policy if exists member_photos_delete on public.member_photos;
create policy member_photos_delete on public.member_photos for delete to authenticated
  using ((select app.has_permission('members:update')) and app.member_in_scope(member_id));

-- attendance_services --------------------------------------------------------
-- A leader may READ congregation-wide services (their members appear on them)
-- but may only CREATE or EDIT a register for their own department (scope.ts).
drop policy if exists services_select on public.attendance_services;
create policy services_select on public.attendance_services for select to authenticated
  using (
    (select app.has_permission('attendance:read'))
    and (department_id is null or app.in_department_scope(department_id))
  );
drop policy if exists services_insert on public.attendance_services;
create policy services_insert on public.attendance_services for insert to authenticated
  with check ((select app.has_permission('attendance:record')) and app.in_department_scope(department_id));
drop policy if exists services_update on public.attendance_services;
create policy services_update on public.attendance_services for update to authenticated
  using      ((select app.has_permission('attendance:record')) and app.in_department_scope(department_id))
  with check ((select app.has_permission('attendance:record')) and app.in_department_scope(department_id));
drop policy if exists services_delete on public.attendance_services;
create policy services_delete on public.attendance_services for delete to authenticated
  using ((select app.has_permission('attendance:delete')) and app.in_department_scope(department_id));

-- attendance -----------------------------------------------------------------
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using ((select app.has_permission('attendance:read')) and app.member_in_scope(member_id));
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated
  with check ((select app.has_permission('attendance:record')) and app.member_in_scope(member_id));
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update to authenticated
  using      ((select app.has_permission('attendance:record')) and app.member_in_scope(member_id))
  with check ((select app.has_permission('attendance:record')) and app.member_in_scope(member_id));
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete to authenticated
  using ((select app.has_permission('attendance:delete')) and app.member_in_scope(member_id));

-- follow_ups -----------------------------------------------------------------
drop policy if exists followups_select on public.follow_ups;
create policy followups_select on public.follow_ups for select to authenticated
  using ((select app.has_permission('followups:read')) and app.member_in_scope(member_id));
drop policy if exists followups_insert on public.follow_ups;
create policy followups_insert on public.follow_ups for insert to authenticated
  with check ((select app.has_permission('followups:manage')) and app.member_in_scope(member_id));
drop policy if exists followups_update on public.follow_ups;
create policy followups_update on public.follow_ups for update to authenticated
  using      ((select app.has_permission('followups:manage')) and app.member_in_scope(member_id))
  with check ((select app.has_permission('followups:manage')) and app.member_in_scope(member_id));
-- No DELETE: the application never deletes a case; it resolves it.

-- follow_up_notes ------------------------------------------------------------
drop policy if exists followup_notes_select on public.follow_up_notes;
create policy followup_notes_select on public.follow_up_notes for select to authenticated
  using ((select app.has_permission('followups:read')) and app.follow_up_in_scope(follow_up_id));
drop policy if exists followup_notes_insert on public.follow_up_notes;
create policy followup_notes_insert on public.follow_up_notes for insert to authenticated
  with check (
    (select app.has_permission('followups:manage'))
    and app.follow_up_in_scope(follow_up_id)
    and author_user_id = (select app.current_user_id())   -- you can only author as yourself
  );
-- No UPDATE or DELETE: notes are a conversation record.

-- birthday_reminders ---------------------------------------------------------
drop policy if exists birthdays_select on public.birthday_reminders;
create policy birthdays_select on public.birthday_reminders for select to authenticated
  using ((select app.has_permission('birthdays:read')) and app.member_in_scope(member_id));
drop policy if exists birthdays_update on public.birthday_reminders;
create policy birthdays_update on public.birthday_reminders for update to authenticated
  using      ((select app.has_permission('birthdays:read')) and app.member_in_scope(member_id))
  with check ((select app.has_permission('birthdays:read')) and app.member_in_scope(member_id));
-- Rows are created only by the scheduled job through the API.

-- notifications --------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (
    (select app.has_permission('notifications:read'))
    and (
      user_id = (select app.current_user_id())
      or role_id = (select app.current_role_id())
    )
  );
-- Created only by the system through the API. No INSERT/UPDATE/DELETE.

-- notification_reads ---------------------------------------------------------
drop policy if exists notification_reads_select on public.notification_reads;
create policy notification_reads_select on public.notification_reads for select to authenticated
  using (user_id = (select app.current_user_id()));
drop policy if exists notification_reads_insert on public.notification_reads;
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (user_id = (select app.current_user_id()));
drop policy if exists notification_reads_delete on public.notification_reads;
create policy notification_reads_delete on public.notification_reads for delete to authenticated
  using (user_id = (select app.current_user_id()));

-- audit_logs -----------------------------------------------------------------
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using ((select app.has_permission('audit:read')));
-- Written only by the API. Never updated or deleted by anyone.

-- system_settings ------------------------------------------------------------
-- Every signed-in user may read the church identity (name in the sidebar);
-- everything else needs settings:read.
drop policy if exists settings_select on public.system_settings;
create policy settings_select on public.system_settings for select to authenticated
  using (
    (select app.has_permission('settings:read'))
    or (category = 'church' and (select app.current_user_id()) is not null)
  );
drop policy if exists settings_insert on public.system_settings;
create policy settings_insert on public.system_settings for insert to authenticated
  with check ((select app.has_permission('settings:manage')));
drop policy if exists settings_update on public.system_settings;
create policy settings_update on public.system_settings for update to authenticated
  using      ((select app.has_permission('settings:manage')))
  with check ((select app.has_permission('settings:manage')));

-- schema_migrations: RLS enabled, no policies, no grants = nobody.
```

### Step 19 — Reference data: the five roles

**Required.** The application cannot authorise a single request without them.
Values are copied from `server/src/config/permissions.ts`.

```sql
insert into public.roles (name, label, description, permissions, is_system) values
('super_admin', 'Super Administrator',
 'Unrestricted access, including user management, settings and audit logs.',
 '["*"]'::jsonb, true),

('pastor', 'Pastor',
 'Full visibility of members, attendance, follow-ups and reports. Read-only on records.',
 '["members:read","attendance:read","followups:read","followups:manage","birthdays:read","departments:read","groups:read","reports:read","reports:export","dashboard:read","notifications:read"]'::jsonb, true),

('church_admin', 'Church Administrator',
 'Day-to-day administration: registration, attendance, departments, groups and follow-ups.',
 '["members:read","members:create","members:update","members:export","attendance:read","attendance:record","attendance:delete","followups:read","followups:manage","birthdays:read","departments:read","departments:manage","groups:read","groups:manage","reports:read","reports:export","dashboard:read","notifications:read"]'::jsonb, true),

('department_leader', 'Department Leader',
 'Sees and follows up members of their own department only.',
 '["members:read","attendance:read","attendance:record","followups:read","followups:manage","birthdays:read","departments:read","groups:read","reports:read","dashboard:read","notifications:read"]'::jsonb, true),

('viewer', 'Viewer',
 'Read-only access to members, attendance and reports.',
 '["members:read","attendance:read","followups:read","birthdays:read","departments:read","groups:read","reports:read","dashboard:read","notifications:read"]'::jsonb, true)

on conflict (name) do update
  set label = excluded.label, description = excluded.description, permissions = excluded.permissions;
```

### Step 20 — Reference data: settings

**Recommended, not strictly required.** `settings.service.ts` falls back to
built-in defaults for any missing key, but the Settings page reads labels and
descriptions from these rows. **Change the church identity values to real
ones.**

```sql
insert into public.system_settings (key, value, category, label, description) values
('church_name',     '"Your Church Name"'::jsonb,                             'church', 'Church name',    'Shown on the login page, reports and exports.'),
('church_tagline',  '"Connecting People. Strengthening the Church."'::jsonb, 'church', 'Tagline',        'Short motto shown under the church name.'),
('church_address',  '"P.O. Box 0000, Accra, Ghana"'::jsonb,                  'church', 'Postal address', 'Printed on report headers.'),
('church_phone',    '"+233 00 000 0000"'::jsonb,                             'church', 'Telephone',      'Church office contact number.'),
('church_email',    '"info@yourchurch.org"'::jsonb,                          'church', 'Email address',  'Church office email address.'),
('church_logo_url', '""'::jsonb,                                             'church', 'Logo URL',       'Optional logo shown in the sidebar and on reports.'),

('birthday_reminder_days',         '[7,3,1,0]'::jsonb, 'birthdays', 'Reminder days before birthday', 'How many days ahead reminders are generated.'),
('birthday_notifications_enabled', 'false'::jsonb,     'birthdays', 'Raise birthday notifications',  'When off, birthdays appear on screen but raise no notifications.'),

('absence_level_1_services',      '2'::jsonb,                  'absence', 'Level 1 threshold (services missed)', 'Consecutive misses that trigger a Follow-Up Reminder.'),
('absence_level_2_services',      '3'::jsonb,                  'absence', 'Level 2 threshold (services missed)', 'Consecutive misses that trigger an Urgent Follow-Up.'),
('absence_level_3_services',      '4'::jsonb,                  'absence', 'Level 3 threshold (services missed)', 'Consecutive misses that trigger a Pastoral Follow-Up.'),
('absence_excused_counts',        'false'::jsonb,              'absence', 'Count excused absences',              'When off, an excused absence resets the streak.'),
('absence_tracked_service_types', '["sunday_service"]'::jsonb, 'absence', 'Services tracked for absence',        'Only these service types feed absence monitoring.'),
('absence_auto_create_followups', 'true'::jsonb,               'absence', 'Open follow-ups automatically',       'When off, alerts are raised but cases are opened by hand.'),

('followup_overdue_days', '7'::jsonb, 'followups', 'Days before a follow-up is overdue', 'Used to flag neglected cases.')

on conflict (key) do nothing;
```

### Step 21 — The first Super Administrator

Two halves: the **profile** (SQL, here) and the **login** (Supabase Auth, in
the dashboard). The trigger from step 7 joins them by email.

**21a — the profile.** Use the real name and the exact email you will use in
21b.

```sql
insert into public.users (full_name, email, role_id, is_active, must_change_password)
values (
  'Your Full Name',
  'you@yourchurch.org',
  (select id from public.roles where name = 'super_admin'),
  true,
  false
)
on conflict do nothing;
```

**21b — the login.** Dashboard → **Authentication → Users → Add user**:

- *Create new user* with the same email and a strong password, and tick
  **Auto Confirm User**, **or**
- *Invite user*, which sends a Supabase invitation email (requires the
  project's email settings to be working).

Either way an `auth.users` row appears, the trigger fires, and
`users.auth_user_id` is filled in. Confirm:

```sql
select u.id, u.email, u.auth_user_id is not null as linked, r.name as role
  from public.users u join public.roles r on r.id = u.role_id;
```

`linked` must be `true`. If it is `false`, the two emails differ — fix the
profile's email and re-run the `update` inside `app.link_profile_to_auth_user`
by hand:

```sql
update public.users u
   set auth_user_id = a.id
  from auth.users a
 where u.auth_user_id is null and lower(u.email) = lower(a.email);
```

Create every other account from the application's **Users** page once Phase 7
is done, never by hand.

---

## Phase 5 — Row Level Security

### Why RLS is on for every table

Every Supabase project publishes the `public` schema over HTTPS through
PostgREST, to anyone who presents the project's anon key — and that key is
designed to live in browser code. This application does not use that door; it
reaches PostgreSQL directly as `postgres`. But the door exists, and behind it
is a congregation's names, phone numbers, home addresses, dates of birth,
emergency contacts and pastoral notes.

Two layers therefore protect it. **Grants** (step 17) remove `anon` entirely
and give `authenticated` only the table privileges the application actually
exercises. **Policies** (step 18) then reproduce, in SQL, the exact rules the
API enforces in `rbac.ts` and `scope.ts`, so that a signed-in user reaching
PostgREST directly can do no more than they could through the API.

The API server itself is unaffected: it connects as the table owner, and
PostgreSQL does not apply row-level policies to a table's owner (RLS is
*enabled*, not *forced* — see the note under Assumptions). `service_role`
holds `bypassrls`. Behaviour of the running application therefore does not
change; the policies govern the second door only.

### How roles are represented and enforced

The policies never mention a role by name except `department_leader`, and even
that only to apply row scoping. They ask the same question the API asks:
*does this user's role hold permission `x`?* — through
`app.has_permission()`, which reads `roles.permissions` for the profile whose
`auth_user_id` matches `auth.uid()`. Change a role's permissions in the
application and both doors change together. Deactivate a profile
(`is_active = false`) and every helper returns null, so every policy denies.

### Policy matrix

| Table | SELECT | INSERT | UPDATE | DELETE | Why |
|---|---|---|---|---|---|
| roles | any active user | — | `users:manage`; super_admin keeps `*` | — | Labels are shown everywhere; editing is the permission editor. No create/delete exists in the app. |
| users | own row, or `users:read` | `users:manage` | `users:manage`; not own role/active flag | `users:manage`; not self | Mirrors `users.routes.ts`. The *last Super Administrator* rule cannot be expressed as a row policy; it stays in the API. |
| departments | `departments:read` | `departments:manage` | same | same | Reference data. |
| groups | `groups:read` | `groups:manage` | same | same | Reference data. |
| members | `members:read` + scope | `members:create` + scope | `members:update` + scope, both before and after | **none** | Soft delete is an update of `deleted_at`. A leader cannot move a member out of their department. |
| member_photos | `members:read` + scope | `members:update` + scope | — | `members:update` + scope | Photo replace deletes the old row. |
| attendance_services | `attendance:read`; leaders also see congregation-wide | `attendance:record` + scope | same | `attendance:delete` + scope | `assertServiceScopeAllowed` in `scope.ts`. |
| attendance | `attendance:read` + member scope | `attendance:record` + member scope | same | `attendance:delete` + member scope | One mark per member per service. |
| follow_ups | `followups:read` + member scope | `followups:manage` + scope | same | **none** | Cases are resolved, never deleted. |
| follow_up_notes | `followups:read` + case scope | `followups:manage` + scope + author is self | **none** | **none** | A conversation record is immutable. |
| birthday_reminders | `birthdays:read` + scope | — (job) | `birthdays:read` + scope, `status` column only | — | Dismiss is the only user action. |
| notifications | `notifications:read`, addressed to me or my role | — (system) | — | — | Read state lives in the next table. |
| notification_reads | own rows | own rows | — | own rows | Per-user read markers. |
| audit_logs | `audit:read` | — (API) | **none** | **none** | Append-only by design. |
| system_settings | `settings:read`, or `church` category for any user | `settings:manage` | `settings:manage` | — | Church name is needed by every screen's sidebar. |
| schema_migrations | — | — | — | — | Runner's ledger. No grant, no policy. |

### Where `using (true)` would have appeared, and why it does not

Nothing here is world-readable. The closest is `roles_select`, which every
*active, signed-in* user may read, because the client displays role labels on
the profile menu and Users page; that is still gated on a resolved profile,
not `true`. `system_settings` church identity is likewise gated on an active
profile. `anon` can select nothing at all.

### What RLS cannot reproduce, and where it lives instead

- **The last active Super Administrator cannot be demoted, deactivated or
  deleted.** Requires counting other rows during a write; stays in
  `users.routes.ts`.
- **Register completeness for absence alerts** (a register covering under 40%
  of the active roll is skipped). Business logic in `absence.service.ts`, not
  access control.
- **Photo files.** Live on the API server's disk, served by an authenticated
  route. Not in the database, so not covered by RLS.

---

## Phase 6 — Entity relationship diagram

```mermaid
erDiagram
    AUTH_USERS ||--o| USERS : "signs in as (auth_user_id)"
    ROLES ||--o{ USERS : "grants"
    ROLES ||--o{ NOTIFICATIONS : "addressed to role"
    USERS ||--o{ NOTIFICATIONS : "addressed to user"
    USERS ||--o{ NOTIFICATION_READS : "reads"
    USERS ||--o{ AUDIT_LOGS : "performs"
    USERS ||--o{ SYSTEM_SETTINGS : "updates"
    USERS ||--o{ FOLLOW_UPS : "assigned / created"
    USERS ||--o{ FOLLOW_UP_NOTES : "authors"
    USERS ||--o{ ATTENDANCE_SERVICES : "records"
    USERS ||--o{ ATTENDANCE : "records"
    USERS ||--o{ MEMBER_PHOTOS : "uploads"
    USERS ||--o{ MEMBERS : "created / updated by"
    DEPARTMENTS ||--o{ USERS : "scopes a leader"

    MEMBERS ||--o| USERS : "may sign in as"
    DEPARTMENTS ||--o{ MEMBERS : "contains"
    GROUPS ||--o{ MEMBERS : "contains"
    MEMBERS ||--o| DEPARTMENTS : "leads"
    MEMBERS ||--o| GROUPS : "leads"
    MEMBERS ||--o{ MEMBER_PHOTOS : "has"
    MEMBER_PHOTOS ||--o| MEMBERS : "current photo"

    DEPARTMENTS ||--o{ ATTENDANCE_SERVICES : "scopes"
    GROUPS ||--o{ ATTENDANCE_SERVICES : "scopes"
    ATTENDANCE_SERVICES ||--o{ ATTENDANCE : "register of"
    MEMBERS ||--o{ ATTENDANCE : "marked in"

    MEMBERS ||--o{ FOLLOW_UPS : "subject of"
    FOLLOW_UPS ||--o{ FOLLOW_UP_NOTES : "conversation"

    MEMBERS ||--o{ BIRTHDAY_REMINDERS : "generates"
    NOTIFICATIONS ||--o{ NOTIFICATION_READS : "read by"
```

`AUTH_USERS` is Supabase's `auth.users`. Everything else is in `public`.

---

## Phase 7 — Connecting the application

> Your brief was cut off after the Phase 6 heading. Phases 7 and 8 are what a
> complete implementation guide needs next: the environment, the code that
> must change for the Track B schema, and how to prove it works. If you had
> different phases in mind, say so and they will be added.

### 7.1 Supabase settings to collect

From the dashboard, for the project you intend to use:

| Setting | Where | Used by |
|---|---|---|
| Project URL `https://<ref>.supabase.co` | Settings → API | server and client |
| anon (publishable) key | Settings → API | client only |
| service_role (secret) key | Settings → API | **server only, never the client** |
| JWT verification: JWKS URL or legacy JWT secret | Settings → API → JWT Keys | server |
| Session pooler connection string, port 5432 | Connect → Session pooler | server |

**Connection string rules** (these cause most first-attempt failures):

- Use the **Session pooler** on port 5432. Not the transaction pooler on 6543
  — `config/db.ts` sets `statement_timeout` and
  `idle_in_transaction_session_timeout` as connection parameters and holds
  multi-statement transactions, which that pooler does not support.
- Not the direct host `db.<ref>.supabase.co`, which is IPv6-only and
  unreachable from most networks.
- Percent-encode punctuation in the password: `@` → `%40`, `#` → `%23`,
  `/` → `%2F`, `:` → `%3A`.

### 7.2 Environment variables

`server/.env` (do not commit):

```ini
# --- Database: Supabase session pooler ---
DATABASE_URL=postgresql://postgres.YOUR-REF:YOUR-PASSWORD@aws-0-YOUR-REGION.pooler.supabase.com:5432/postgres
PGSSL=true

# --- Supabase Auth ---
SUPABASE_URL=https://YOUR-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...            # server only
# One of the two, depending on Settings -> API -> JWT Keys:
SUPABASE_JWT_SECRET=...                     # legacy HS256 projects
# (asymmetric-key projects need nothing here; the server fetches the JWKS)

# JWT_ACCESS_SECRET / JWT_REFRESH_SECRET are no longer used once Phase 7 is done.
# env.ts currently REQUIRES them; leave them set until env.ts is updated.
```

`client/.env` (new file; Vite exposes only `VITE_*`):

```ini
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### 7.3 Code changes required — server

This is the work Track B requires. Files are listed in the order that keeps
the application compiling between steps.

| File | Change |
|---|---|
| `server/package.json` | add `@supabase/supabase-js` and `jose`; `argon2` and `jsonwebtoken` become removable at the end. |
| `server/src/config/env.ts` | add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `SUPABASE_JWT_SECRET`; make `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_MINUTES`, `RESET_TOKEN_TTL_MINUTES`, `INVITE_TOKEN_TTL_DAYS` optional or remove them. |
| `server/src/config/supabase.ts` (new) | one admin client: `createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })`. |
| `server/src/middleware/auth.ts` | verify the **Supabase** token instead of the app's own, then look up the profile by `auth_user_id`. The rest of `req.auth` is unchanged. See snippet below. |
| `server/src/modules/auth/auth.routes.ts` | keep `/branding` and `/me`. Remove `/login`, `/refresh`, `/logout`, `/forgot-password`, `/token-info`, `/reset-password`, `/change-password` and the refresh cookie — all of these are now Supabase Auth calls made by the client. Keep the audit entries for sign-in by recording them in `/me` on first call after a new session if you want them. |
| `server/src/modules/auth/auth.service.ts` | delete `login`, `refresh`, `logout`, `logoutEverywhere`, `changePassword`, `requestPasswordReset`, `completePasswordReset`, `createInvitation`, `getTokenInfo`, `pruneAuthTokens`, `hashPassword`, `verifyPassword`. Keep `getCurrentUser` and `AuthenticatedUser`; drop `passwordHash`, `failedAttempts`, `lockedUntil` from the select. |
| `server/src/modules/users/users.routes.ts` | **create:** `supabase.auth.admin.createUser({ email, password, email_confirm: true })` or `inviteUserByEmail(email, { redirectTo })`, then insert the profile (the trigger links them; or set `auth_user_id` from the admin response directly). **reset-password:** `auth.admin.updateUserById(authUserId, { password })` and set `must_change_password = true`. **delete:** `auth.admin.deleteUser(authUserId)` then `delete from users`. **unlock:** remove; Supabase owns lockout. **list:** replace `invite_pending` (from `password_resets`) with `auth_user_id is null`, and `is_locked` with `false` or drop it. Role change / deactivation: `auth.admin.signOut(authUserId, 'global')` replaces `logoutEverywhere`. |
| `server/src/jobs/scheduler.ts` | remove the `auth-token-cleanup` job. |
| `server/src/db/seed.ts` | demo users must be created through the admin API or skipped; `INSERT INTO users … password_hash` will fail. |
| `server/src/services/email/templates.ts` | `passwordResetEmail` and `invitationEmail` are no longer sent by the app; Supabase's templates (Authentication → Email Templates) replace them. `passwordChangedEmail` can stay if you send it from a Supabase auth hook, or be dropped. |
| `server/src/index.ts` | no change; the startup check `to_regclass('public.users')` still passes. |

Sketch of the new `authenticate` in `middleware/auth.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = `${env.SUPABASE_URL}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const legacyKey = env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET) : null;

async function verifySupabaseToken(token: string): Promise<string> {
  const options = { issuer, audience: 'authenticated' };
  const { payload } = legacyKey
    ? await jwtVerify(token, legacyKey, options)   // HS256 projects
    : await jwtVerify(token, jwks, options);       // asymmetric-key projects
  if (!payload.sub) throw unauthorized('Your session has expired. Please sign in again.');
  return payload.sub;                              // = auth.users.id
}

// then, in authenticate():
const authUserId = await verifySupabaseToken(token);
const user = await queryOne<UserRow>(
  `SELECT u.id, u.email, u.full_name, u.is_active, u.department_id, u.member_id,
          r.id AS role_id, r.name AS role_name, r.permissions
     FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.auth_user_id = $1`,
  [authUserId],
);
if (!user) throw unauthorized('No ChurchConnect profile is linked to this login. Ask a Super Administrator.');
```

Everything below `req.auth = { … }` is unchanged, which is the point of keeping
`users.id` as a `bigint`.

### 7.4 Code changes required — client

| File | Change |
|---|---|
| `client/package.json` | add `@supabase/supabase-js`. |
| `client/src/lib/supabase.ts` (new) | `createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)`. |
| `client/src/api/client.ts` | `accessToken` comes from `supabase.auth.getSession()`; on a 401, call `supabase.auth.refreshSession()` once instead of `POST /api/auth/refresh`. `downloadFile` unchanged apart from the token source. |
| `client/src/context/AuthContext.tsx` | subscribe to `supabase.auth.onAuthStateChange`; when a session exists, call `GET /api/auth/me` to load the profile and permissions into `user`. `login` → `signInWithPassword`; `logout` → `supabase.auth.signOut()` then clear state. `can()` / `canAny()` unchanged. |
| `client/src/pages/LoginPage.tsx` | calls the new `login`; the "remember me" flag maps to nothing (Supabase sessions persist by default) — remove or keep as a no-op. |
| `client/src/pages/AccountPages.tsx` | Forgot password → `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` })`. Change password → `supabase.auth.updateUser({ password })`, then `PATCH` the profile to clear `must_change_password` (a small new API endpoint, or fold it into `/me`). |
| `client/src/pages/ResetPasswordPage.tsx` | Supabase delivers a recovery session on the redirect; the page calls `supabase.auth.updateUser({ password })`. The `/token-info` greeting is replaced by `supabase.auth.getUser()`. |
| `client/vite.config.ts` | unchanged — the `/api` proxy still serves the Express API. |

**Supabase dashboard settings that go with this:** Authentication → URL
Configuration → Site URL = your client origin; Redirect URLs must include
`https://your-client/reset-password`. Authentication → Providers → Email:
sign-ups **off**.

### 7.5 What does not change

- Every module except `auth` and `users`: members, attendance, follow-ups,
  birthdays, departments, groups, reports, notifications, settings, audit,
  dashboard, search. They read `req.auth.userId` and friends, which keep the
  same shape.
- `rbac.ts`, `scope.ts`, `permissions.ts`, `audit.service.ts`,
  `absence.service.ts`, `settings.service.ts`.
- Member photographs still go to the API server's disk under `UPLOAD_DIR`.
  Supabase Storage would be the natural home, but that is a separate change in
  `storage.service.ts`, and it is not required for the database to work.

---

## Phase 8 — Verification

### 8.1 Database, before any code changes

Run in the SQL Editor after step 21.

Every table has RLS on — must return **no rows**:

```sql
select tablename from pg_tables
 where schemaname = 'public' and rowsecurity = false;
```

`anon` holds nothing — must return **no rows**:

```sql
select table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon';
```

The decisive test — become `anon`, then `authenticated` with no session, and
try to read the register. Both must fail or return zero rows:

```sql
set role anon;
select count(*) from public.members;        -- permission denied
reset role;

set role authenticated;
select count(*) from public.members;        -- 0 rows: no session, no profile, no policy passes
reset role;
```

The administrator is linked and can be resolved by the helpers. Substitute the
UUID from `auth.users`:

```sql
set role authenticated;
select set_config('request.jwt.claim.sub', '<auth uuid of your admin>', true);
select app.current_user_id(), app.current_role_name(), app.has_permission('members:read');
-- expect: 1 | super_admin | true
reset role;
```

Dashboard → **Advisors → Security** should show no *"RLS disabled in public"*
findings and no *"function search_path mutable"* findings, because every
function here pins `search_path`. It will show an informational *"RLS enabled,
no policy"* notice for `schema_migrations`. That is intended: the table is
meant to be unreachable from PostgREST.

### 8.2 Application, after Phase 7

```powershell
cd server
npm run dev
```

Expect `[db] connected` and the banner. Then:

```powershell
curl http://localhost:4000/api/health
```

`{"status":"ok","database":"ok",…}`. Sign in at `http://localhost:5173` with
the administrator from step 21. Open **Users** and create a second account
through the UI; confirm a row appears in Authentication → Users and that the
profile shows as linked. Sign in as that user in a private window. Create a
department, a member, a Sunday register; run an absence scan from
**Follow-ups → Alerts**.

### 8.3 Things that will bite you

| Symptom | Cause |
|---|---|
| `ENOTFOUND` naming a host fragment you do not recognise | Unencoded punctuation in the database password split the URL. |
| Connection hangs, or `ENETUNREACH` | Direct host used; switch to the session pooler. |
| `unsupported startup parameter: statement_timeout` | Transaction pooler (6543) used; switch to 5432. |
| `password authentication failed for user "postgres"` | On the pooler the username includes the ref: `postgres.<ref>`. |
| `/me` returns "No ChurchConnect profile is linked" | Profile email and auth email differ, or the profile was never created. Run the relink `update` in step 21. |
| `npm run migrate` tries to create `roles` and fails | Step 15 was skipped. Run it; the runner then reports up to date. |
| `npm run seed` fails on `password_hash` | Expected in Track B; the seeder needs the admin-API change in 7.3, or skip seeding. |
| Advisor: "RLS enabled, no policy" on `schema_migrations` | Intended. |

---

## DANGEROUS / OPTIONAL MIGRATIONS

Nothing in this section is needed for a new project. Read each block twice
before running it. Every statement here deletes something.

### D.1 Converting a Track A database (built by `npm run migrate`) to Track B

For a project where the application's own migrations `001`–`003` have already
run and the tables carry data you want to keep. **Take a backup first**
(Dashboard → Database → Backups, or `pg_dump`).

Effects: every user's password is gone and every session is invalidated. Each
user must be re-invited or given a new password through Supabase Auth. Nothing
about members, attendance, follow-ups or audit history changes.

```sql
-- DANGEROUS: removes all credentials and sessions from the application's tables.
begin;

alter table public.users add column if not exists auth_user_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_auth_user_id_key') then
    alter table public.users add constraint users_auth_user_id_key unique (auth_user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_auth_user_id_fkey') then
    alter table public.users add constraint users_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;
end $$;
create index if not exists idx_users_auth on public.users (auth_user_id);

alter table public.users drop column if exists password_hash;
alter table public.users drop column if exists failed_login_attempts;
alter table public.users drop column if exists locked_until;

drop table if exists public.refresh_tokens;
drop table if exists public.password_resets;

commit;
```

Then run, in this order, **steps 1, 7, 14, 16, 17 and 18** from Phase 4:

| Step | Why it is needed here |
|---|---|
| 1 | Creates the `app` schema. A Track A database has never had it, and steps 7, 16 and 18 put their functions and policies there. Its `set_updated_at` is a no-op re-create. |
| 7 | The `auth.users` triggers that relink existing profiles by email. |
| 14 | Re-creates the view with `security_invoker = on`. |
| 16 | The RLS helper functions. |
| 17 | Grants and RLS enablement (idempotent over what `003` already did). |
| 18 | The policies. |

Step 15 is already satisfied. Finally invite every existing user from
Authentication → Users; the step 7 trigger relinks each one by email as they
are created. This exact sequence was exercised against a database built by the
application's own migrations and then converted.

### D.2 Removing everything this guide created

Only for abandoning the schema in a project you are discarding. **Not** a way
to "start over" on a project with data.

```sql
-- DANGEROUS: destroys all application data. Irreversible.
drop view  if exists public.v_member_attendance_summary;
drop table if exists public.notification_reads, public.notifications,
                     public.birthday_reminders, public.follow_up_notes, public.follow_ups,
                     public.attendance, public.attendance_services,
                     public.member_photos, public.audit_logs, public.system_settings,
                     public.users, public.members, public.groups, public.departments,
                     public.roles, public.schema_migrations cascade;
drop trigger if exists trg_link_profile_on_auth_insert on auth.users;
drop trigger if exists trg_sync_profile_email on auth.users;
drop schema if exists app cascade;
drop function if exists public.set_updated_at();
```

Auth users are not touched by D.2; remove them from Authentication → Users.

### D.3 Never run against Supabase

`npm run migrate -- --fresh` and `npm run db:reset` issue `DROP SCHEMA public
CASCADE`, which on Supabase also destroys the project's own grants. The runner
now refuses when `DATABASE_URL` points at a Supabase host; do not override it.

---

## Assumptions register

Each of these was a judgement call. If one is wrong, the affected section is
named so it can be revised.

| # | Assumption | Affects | If wrong |
|---|---|---|---|
| A1 | You want Track B (Supabase Auth) despite the code changes in Phase 7, because your brief forbids passwords in a custom table. | Whole guide | Use `docs/SUPABASE-SETUP.md` (Track A) instead; the app runs unchanged. |
| A2 | `public.users` keeps its name and `bigint` id and acts as the profile table, rather than a new UUID-keyed `profiles`. | Phase 3, step 6, Phase 7 | A UUID `profiles` table means changing eleven FK columns and every `req.auth.userId`; cost is far higher for no security gain. |
| A3 | The API connects as `postgres` (via the pooler) and therefore bypasses RLS as table owner. | Phase 5 | If you later use a dedicated non-owner role for the API, it *will* be subject to RLS with no matching session and will read nothing. Give that role `bypassrls`, or add `to <role> using (true)` policies for it explicitly. |
| A4 | RLS is `enable`d, not `force`d. | Step 17 | `force` would apply policies to the owner too — the API — turning a role misconfiguration into a total outage while adding nothing against `anon`. |
| A5 | Members never sign in; there is no member-facing screen. | Phase 3.9 | If a member portal is ever built, add a `member` role and policies scoped by `users.member_id`. |
| A6 | Self-registration is disabled in the Supabase dashboard. | Phase 3.2 | With it on, strangers can create `auth.users` rows. They get no profile and every policy denies them, but they should not exist. |
| A7 | Your project's JWT signing method (legacy HS256 secret vs. asymmetric JWKS) is whichever Settings → API → JWT Keys shows; the middleware sketch handles both. | Phase 7.3 | Check that page before choosing which env var to set. |
| A8 | `security_invoker` on the view needs PostgreSQL 15+, which every current Supabase project has. | Step 14 | On an older self-hosted instance, drop that `alter view` and rely on the grant revocation. |
| A9 | The `auth.users` triggers can be created from the SQL Editor as `postgres`. This is Supabase's documented pattern. | Step 7 | If refused, create the link manually with the `update` in step 21 after each invitation. |
| A10 | Member photographs stay on the API server's disk. | Phase 7.5 | Moving them to Supabase Storage is a change to `storage.service.ts` and a `storage.buckets` policy, outside this guide. |
| A11 | Regional choice, connection string form and password encoding follow Supabase's 2026 dashboard layout. | Phase 7.1 | Labels move; the rule (session pooler, port 5432, encode the password) does not. |
| A12 | Your original message was truncated after "Phase 6"; Phases 7 and 8 were inferred as the natural completion. | Phases 7–8 | Tell me what the remaining phases were and they will be written to match. |
