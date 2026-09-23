# API reference

Base URL: `http://localhost:4000/api`

All responses are JSON. All dates are `YYYY-MM-DD` strings; all timestamps are
ISO 8601.

---

## Authentication

Two tokens:

- **Access token** — a 15-minute JWT returned in the login response body. The
  client keeps it in memory only and sends it as `Authorization: Bearer <token>`.
  The header is the only place it is accepted; a token in a query string is
  ignored, so it can never land in an access log or browser history.
- **Refresh token** — set as an httpOnly, `SameSite=Strict` cookie scoped to
  `/api/auth`. JavaScript cannot read it, so an XSS payload cannot steal the
  session. It rotates on every use. Presenting a token that was already rotated
  away is treated as theft and revokes every session for that user — unless it
  happens within 10 seconds of the rotation, which is what two browser tabs
  refreshing at once looks like; then only the losing tab is signed out.

Requests must be sent with `credentials: 'include'`.

### Error shape

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Please check the highlighted fields and try again.",
    "fields": { "email": "Please enter a valid email address." }
  }
}
```

`message` is always safe to show a user directly — the server writes it for a
church administrator, not for a developer. `fields` is present only on 422.

| Status | Meaning |
|---|---|
| 400 | Malformed request |
| 401 | Not signed in, or the access token expired — refresh and retry once |
| 403 | Signed in but the role lacks the permission |
| 404 | No such record |
| 409 | Conflict (duplicate Member ID, member already has an open follow-up, …) |
| 413 | Uploaded image too large |
| 422 | Validation failed; see `fields` |
| 429 | Rate limited |
| 500 | Unexpected — includes a `reference` code that appears in the server log |

---

## Endpoints

Legend: **permission** required. Endpoints marked *public* need no session.

### Auth — `/api/auth`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/branding` | *public* | Church name and tagline for the login screen |
| POST | `/login` | *public* | `{ email, password, rememberMe }`. Rate limited 10/15 min |
| POST | `/refresh` | *cookie* | Rotates the refresh token; a replay more than 10 s after rotation revokes all sessions |
| POST | `/logout` | any | Revokes the current refresh token |
| GET | `/me` | any | Current user with live permissions |
| POST | `/change-password` | any | `{ currentPassword, newPassword }`. Signs out everywhere |
| POST | `/forgot-password` | *public* | Always 200, whether or not the address exists. Emails a reset link |
| POST | `/token-info` | *public* | `{ token }` → describes a reset or invitation token so the landing page can greet the right person |
| POST | `/reset-password` | *public* | `{ token, newPassword }`. Serves both resets and invitation acceptance; returns `purpose` |

### Dashboard — `/api/dashboard`

| Method | Path | Permission |
|---|---|---|
| GET | `/?weeks=12` | `dashboard:read` |

Returns every tile and chart series in one payload: `membership`, `attendance`,
`absence`, `followUps`, `birthdays`, `charts` (six series), `recentServices`.

### Members — `/api/members`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | `members:read` | Paginated. Filters: `search`, `status`, `gender`, `departmentId`, `groupId`, `category`, `joinedFrom`, `joinedTo`, `sortBy`, `sortDir`, `page`, `pageSize` |
| GET | `/form-options` | `members:read` | Active departments and groups for the form |
| GET | `/:id` | `members:read` | Full profile. Department Leaders: own department only (403 otherwise) |
| GET | `/:id/attendance` | `attendance:read` | History plus present/absent/excused summary. Same scope rule |
| GET | `/:id/follow-ups` | `followups:read` | All cases for the member. Same scope rule |
| GET | `/:id/timeline` | `members:read` | Audit + attendance + notes, merged and ordered in SQL. Same scope rule |
| POST | `/` | `members:create` | Member ID auto-generated (`CC-YYYY-NNNN`) if omitted |
| PUT | `/:id` | `members:update` | Partial update; omitted fields are untouched |
| DELETE | `/:id` | `members:delete` | Soft delete; closes any open follow-up |
| POST | `/:id/restore` | `members:delete` | Undo a soft delete |
| POST | `/:id/photo` | `members:update` | `multipart/form-data`, field `photo`. JPG/PNG, ≤ 3 MB |
| DELETE | `/:id/photo` | `members:update` | |
| GET | `/photos/:id` | `members:read` | Streams the image with `Content-Type` pinned and `nosniff` |
| GET | `/export/excel` | `members:export` | XLSX, honours the list filters |
| GET | `/export/pdf` | `members:export` | PDF, honours the list filters |

Paginated responses:

```json
{ "data": [], "page": 1, "pageSize": 20, "total": 62, "totalPages": 4 }
```

### Attendance — `/api/attendance`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/service-types` | any | The eight service types |
| GET | `/services` | `attendance:read` | Paginated; filters `from`, `to`, `serviceType`, `departmentId` |
| POST | `/services` | `attendance:record` | **Find-or-create** — re-opening the same date/type continues the existing register. Department Leaders may only open registers for their own department (`departmentId` required and must match) |
| GET | `/services/:id` | `attendance:read` | |
| DELETE | `/services/:id` | `attendance:delete` | Cascades to its marks |
| GET | `/services/:id/register` | `attendance:read` | Every eligible member with their current mark (`null` when unrecorded). A Department Leader sees only their own members, even on a congregation-wide service |
| POST | `/services/:id/register` | `attendance:record` | `{ marks: [{memberId, status, note?}], finalize }`. Upserts in one transaction; a member listed twice is taken once (last mark wins). `finalize: true` runs the absence scan immediately and returns `alertsCreated`. Department Leaders may mark only their own members and may not finalise or reopen a congregation-wide register |
| POST | `/services/:id/reopen` | `attendance:record` | Not for congregation-wide registers when the caller is a Department Leader |
| DELETE | `/services/:id/register/:memberId` | `attendance:record` | Clears one mark back to "not recorded" (scope rule applies) |
| GET | `/stats/snapshot` | `attendance:read` | Today / this week / this month |
| GET | `/stats/trend?weeks=12` | `attendance:read` | |
| GET | `/stats/by-department` | `attendance:read` | |
| GET | `/stats/low-attendance?threshold=50` | `attendance:read` | |

### Follow-ups — `/api/follow-ups`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/meta` | `followups:read` | Status and level catalogues |
| GET | `/officers` | `followups:read` | Users who can be assigned a case |
| **GET** | **`/alerts`** | `followups:read` | **The live absence alert feed** — computed on read, so it always matches current data. Department Leaders see only their own |
| POST | `/alerts/scan` | `followups:manage` | Runs the absence engine now. Idempotent |
| GET | `/summary` | `followups:read` | Absence + follow-up counts for the dashboard |
| GET | `/` | `followups:read` | Paginated; `scope` = `open`/`overdue`/`all`, plus `status`, `level`, `assignedTo`, `search` |
| GET | `/:id` | `followups:read` | Case with its full note history. Department Leaders: own department's members only |
| POST | `/` | `followups:manage` | Opens a case. Weeks-absent is derived server-side; `level` defaults to the live streak level but may be supplied (a pastor can open a Level 3 case by hand). Department Leaders: own members only |
| PATCH | `/:id` | `followups:manage` | Status, assignee, next date, level (scope rule applies) |
| POST | `/:id/notes` | `followups:manage` | `{ note, contactMethod?, newStatus?, nextFollowUpDate? }` (scope rule applies) |

### Birthdays — `/api/birthdays`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/?range=today\|week\|month\|upcoming` | `birthdays:read` | Also `month=1..12`, `windowDays`, `departmentId` |
| GET | `/summary` | `birthdays:read` | Today / week / month counts |
| GET | `/reminders` | `birthdays:read` | Reminders due today |
| POST | `/reminders/:id/dismiss` | `birthdays:read` | |
| POST | `/reminders/generate` | `settings:manage` | Runs the daily job now |

### Departments — `/api/departments`, Groups — `/api/groups`

Both follow the same shape:

| Method | Path | Permission |
|---|---|---|
| GET | `/` | `departments:read` / `groups:read` |
| GET | `/:id` | …`:read` — includes the roster. A Department Leader may open only their own department's roster |
| POST | `/` | …`:manage` |
| PUT | `/:id` | …`:manage` |
| DELETE | `/:id` | …`:manage` — **409 if members are still assigned** |
| POST | `/:id/members` | …`:manage` — bulk assign `{ memberIds: [] }` |
| GET | `/types` | `groups:read` (groups only) |

### Reports — `/api/reports`

| Method | Path | Permission |
|---|---|---|
| GET | `/` | `reports:read` — the catalogue |
| GET | `/:key` | `reports:read` — `{ title, columns, rows }` |
| GET | `/:key/excel` | `reports:export` |
| GET | `/:key/pdf` | `reports:export` |

Report keys: `membership-summary`, `new-members`, `members-by-department`,
`members-by-age`, `attendance-by-service`, `attendance-by-department`,
`low-attendance`, `absentees`, `follow-ups`, `birthdays`.

Query parameters vary by report: `from`, `to`, `month`, `range`, `windowDays`,
`threshold`, `status`.

The row-level reports (`new-members`, `low-attendance`, `absentees`,
`follow-ups`, `birthdays`) return only a Department Leader's own members. The
aggregate reports (counts by department, age band, service) are church-wide for
every role that can read reports.

### Notifications — `/api/notifications`

| Method | Path | Permission |
|---|---|---|
| GET | `/?unreadOnly=true&type=&limit=` | `notifications:read` |
| GET | `/unread-count` | `notifications:read` |
| POST | `/:id/read` | `notifications:read` |
| POST | `/read-all` | `notifications:read` |

### Search — `/api/search`

| Method | Path | Permission |
|---|---|---|
| GET | `/?q=<term>` | `members:read` |

Returns members, departments and groups. Minimum two characters.

### Users & roles — `/api/users`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | `users:read` | |
| GET | `/roles` | `users:read` | Roles plus the full permission catalogue |
| PUT | `/roles/:id` | `users:manage` | Super Administrator's wildcard cannot be reduced |
| POST | `/` | `users:manage` | `sendInvite: true` emails an invitation instead of requiring a `password`. Department Leader requires a `departmentId` |
| POST | `/:id/resend-invite` | `users:manage` | Issues a fresh invitation, superseding any outstanding one |
| PUT | `/:id` | `users:manage` | Cannot change own role or self-deactivate; last Super Admin protected |
| POST | `/:id/reset-password` | `users:manage` | Signs the user out everywhere |
| POST | `/:id/unlock` | `users:manage` | Clears a brute-force lockout |
| DELETE | `/:id` | `users:manage` | Cannot delete self or the last Super Administrator |

### Settings — `/api/settings`

| Method | Path | Permission |
|---|---|---|
| GET | `/` | `settings:read` |
| PATCH | `/` | `settings:manage` |

Only keys in the allow-list are accepted. Absence levels are validated to be
strictly increasing.

### Audit logs — `/api/audit-logs`

| Method | Path | Permission |
|---|---|---|
| GET | `/` | `audit:read` — filters `action`, `entityType`, `userId`, `from`, `to`, `search` |
| GET | `/filters` | `audit:read` — distinct actions and users for the dropdowns |

Read-only. There is no endpoint anywhere that edits or deletes an entry.

### Health

`GET /api/health` — no auth, not rate limited. Probes PostgreSQL with a 2-second
budget and answers `200 { status: "ok", database: "ok", service, time }` or
`503 { status: "degraded", database: "unreachable", ... }`. Point a load
balancer or uptime monitor here: an instance that has lost its database is
taken out of rotation rather than serving 500s.

---

## Permission catalogue

```
members:read     members:create   members:update   members:delete   members:export
attendance:read  attendance:record attendance:delete
followups:read   followups:manage
birthdays:read
departments:read departments:manage
groups:read      groups:manage
reports:read     reports:export   dashboard:read
users:read       users:manage
settings:read    settings:manage
audit:read       notifications:read
```

`*` is the wildcard, held only by the Super Administrator.

### Role defaults

| Role | Holds |
|---|---|
| Super Administrator | `*` |
| Pastor | all `:read` + `followups:manage` + `reports:export` |
| Church Administrator | everything except `users:*`, `settings:manage`, `audit:read`, `members:delete` |
| Department Leader | reads + `attendance:record` + `followups:manage`, **scoped in SQL to their own department** |
| Viewer | reads only |

---

## Rate limits

| Scope | Limit |
|---|---|
| `/api/*` (per client IP) | 300 requests / minute by default — `API_RATE_LIMIT_PER_MINUTE`. A whole church behind one Wi-Fi router shares one bucket; raise it for a large congregation |
| `/api/auth/login` | 20 *failed* attempts / 15 minutes per IP (successful sign-ins are free) |
| `/api/auth/forgot-password` | 5 requests / hour per IP |
| `/api/auth/reset-password`, `/token-info` | 15 attempts / hour per IP |
| Failed sign-ins per account | 5, then a 15-minute lockout |
| `/api/health` | not limited |

---

## Example: the absence alert flow

```
1. POST /api/attendance/services            → open or continue a register
2. POST /api/attendance/services/:id/register
   { marks: [...], finalize: true }         → saves, finalises, runs the scan
                                            → { alertsCreated: 3, ... }
3. GET  /api/follow-ups/alerts              → the graded list
4. POST /api/follow-ups                     → "Start Follow-Up" on one member
   { memberId, note }
5. POST /api/follow-ups/:id/notes           → record what was said
   { note, contactMethod: "phone", newStatus: "responded" }
```
