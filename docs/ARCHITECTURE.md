# Architecture

## Shape

```
Browser (React 18 + TypeScript + Tailwind)
    │  fetch, Bearer access token in memory
    │  httpOnly refresh cookie on /api/auth
    ▼
Express API (Node 20 + TypeScript)
    │  helmet → cors → parsers → rate limit → route
    │  authenticate → requirePermission → validate → handler
    ▼
Service layer (all SQL lives here)
    ▼
PostgreSQL 14+          Local disk (member photos)
    ▲
    │  node-cron: nightly absence scan, morning birthday reminders
```

Three layers, and the boundary between them is enforced by convention that is
easy to check in review:

| Layer | May do | May not do |
|---|---|---|
| **Routes** | Parse HTTP, check permissions, validate input, write audit entries, shape the response | Contain SQL |
| **Services** | All SQL, all business rules | Know about `req`/`res` |
| **Utilities** | Pure functions | Touch the database |

`members`, `attendance` and `followups` keep the route/service split because
they are large. `departments`, `groups`, `notifications`, `search`, `audit` and
`settings` are single files — splitting them would add indirection without
adding clarity.

---

## Decisions worth explaining

### Permissions are re-read on every request

`middleware/auth.ts` verifies the JWT, then loads the role and permission list
**from the database** rather than trusting the token payload.

That costs one indexed query per request. In exchange, revoking a permission or
deactivating an account takes effect immediately instead of whenever the user's
15-minute token happens to expire. For a system holding personal data about a
congregation, that trade is correct.

### The refresh token rotates, and replay is treated as theft

Presenting an already-revoked refresh token revokes **every** session for that
user, not just the one presented. This is the standard detection for a stolen
token: the legitimate user and the attacker cannot both keep using a rotating
token, so the second use is evidence something is wrong.

### Row-level scoping happens in SQL

A Department Leader holds `members:read` like everyone else, but
`departmentScope()` in `middleware/rbac.ts` returns a SQL fragment that the
service appends to its `WHERE` clause. Filtering in the UI would leave the API
open to anyone who reads the network tab.

A leader with no department assigned is scoped to `department_id = -1` — they
see nothing rather than everything. Failing closed matters more here than
convenience.

### Errors are translated once, centrally

`utils/errors.ts` maps PostgreSQL error codes to messages a church
administrator can act on:

| PG code | Becomes |
|---|---|
| `23505` on `member_code` | "That Member ID is already in use." |
| `23505` on `one_open_per_member` | "This member already has an open follow-up." |
| `23503` | "A linked record no longer exists. Refresh the page and try again." |
| anything else | A 500 with a short reference code, logged in full server-side |

The brief asked never to show `ERROR: SQL constraint violation`. This is the
mechanism that guarantees it, rather than relying on every handler remembering.

### Calendar dates are strings, end to end

`node-postgres` returns `DATE` as a JS `Date` in the server's timezone, which
shifts a birthday by a day for anyone west of UTC. `config/db.ts` overrides the
parser for OID 1082, and `utils/dates.ts` (server) and `utils/format.ts`
(client) both work on `YYYY-MM-DD` strings. The client parses with explicit
`new Date(y, m-1, d)` rather than `new Date(string)`, which would treat a bare
date as UTC.

### Upload safety is structural, not a check

```
multer memoryStorage (hard byte cap — nothing oversized reaches disk)
  → MIME allow-list (cheap early rejection)
  → sharp metadata probe (is it really an image?)
  → sharp re-encode to 512px JPEG      ← the important step
  → random filename, fixed extension
```

The re-encode is what matters: the file written to disk is a **new image
produced by a decoder**, so a polyglot file with a JPEG header and a script
payload appended cannot survive the round trip. The client's filename is never
used in a path, so traversal is not expressible.

Serving goes through an authenticated route, not `express.static`, so photos
require a session and the `Content-Type` is pinned regardless of what is on
disk.

### One dashboard endpoint, not eight

`GET /api/dashboard` returns every tile and chart series from one
`Promise.all` over indexed queries. Eight parallel round trips from the browser
on every page load would be slower and harder to reason about.

### Reports are defined once, rendered three ways

Each report is `{ key, title, category, description, columns, fetch }`. The same
definition drives the JSON response, the XLSX writer and the PDF writer. Adding
a report is one array entry; the client renders whatever columns come back, so
it needs no change at all.

### Charts

`components/charts/theme.ts` holds the palette and mark specs; every chart is
wrapped in `ChartFrame`, which supplies the title, legend, and a **table-view
twin** so no value is reachable only by hovering a coloured mark.

Encoding rules actually applied:

- Present / absent / excused are **states**, so they use a reserved status
  palette, always with a legend.
- Single-series charts (department, age, growth) use **one hue for every bar** —
  colouring bars darker-where-bigger would double-encode length as hue.
- **No dual-axis chart anywhere.** New members per month and total membership
  differ by an order of magnitude, so they are separate figures, not two
  y-scales sharing a plot.
- Grid and axes are solid hairlines, never dashed.

**Validated** against RT AG Connect's own surfaces (`#ffffff` / `#0A1C33`),
not the reference defaults — the commands and full results are in the header of
`theme.ts`. Categorical slots pass every check in both modes (worst adjacent
colour-vision ΔE 9.2 light / 9.4 dark, against a floor of 8).

One finding stands: status amber `#fab219` measures 1.83:1 on white. That is a
sub-3:1 warning, which obligates relief rather than being dismissable — so every
chart ships a legend and a **table-view twin**, and no value is ever reachable
only by telling two coloured marks apart. The status hexes themselves are a
fixed reserved set and are not re-themed per surface.

---

## Scheduled jobs

`jobs/scheduler.ts`, in-process `node-cron`:

| Job | Default schedule | What it does |
|---|---|---|
| `absence-scan` | 01:30 daily | Recomputes every streak, raises graded alerts, opens or escalates cases |
| `birthday-reminders` | 06:00 daily | Generates reminder rows for the configured offsets |

Both are **idempotent**, which is the property that makes the whole design work:
a missed run (restart, deploy) self-heals on the next tick, and the absence scan
can also be triggered on every register finalisation and from a "Run now" button
without any risk of duplication.

A `Set` guards against a job overlapping itself. **This guard is in-process.**
Running more than one API instance would let two processes scan concurrently.
The fix is a PostgreSQL advisory lock at the top of `runOnce`:

```ts
const { rows } = await query('SELECT pg_try_advisory_lock(hashtext($1)) AS got', [name]);
if (!rows[0].got) return;
try { await fn(); } finally { await query('SELECT pg_advisory_unlock(hashtext($1))', [name]); }
```

Correctness would still hold without it — the unique indexes prevent duplicate
alerts and cases regardless — but the wasted work is worth avoiding.

---

## Client state

| Concern | Where |
|---|---|
| Server data | TanStack Query, keyed by resource + serialised filters |
| Session | `AuthContext` — the access token lives in a module variable, never in `localStorage`, so an XSS payload cannot read it |
| Filters, pagination, active tab | The **URL**, so any view is bookmarkable and shareable |
| Toasts | `ToastContext`; success text comes from the API's `message` field so wording stays consistent |
| Theme | `useTheme` + a pre-paint inline script in `index.html`, so there is no flash of the wrong theme |

Concurrent 401s share a single in-flight refresh rather than stampeding the
endpoint (`api/client.ts`).

---

## Responsive strategy

Tables are the hard case. `DataTable` takes one set of column definitions and
renders a table above `lg` and a card list below it — the same data, a layout
that works with a thumb. The attendance register uses three large segmented
buttons per member rather than a dropdown, because an usher marking 400 people
before service cannot afford a select menu.

Sidebar collapses behind a scrim below `lg`. Forms stack to one column. Charts
scroll inside their own container so the page body never scrolls horizontally.

---

## Deferred integrations

Each of these has a clear seam. None is stubbed with a dead button.

**Outbound email / SMS / WhatsApp.** `requestPasswordReset` creates a hashed,
one-hour token and returns it only in development. Add a
`services/notify.service.ts` exposing `send(channel, to, template, data)`, call
it from that function and from `generateBirthdayReminders`, and gate it on
`birthday_notifications_enabled`. The setting and the audit trail already exist.

**Cloud photo storage.** `services/storage.service.ts` is deliberately thin —
`storeMemberPhoto`, `resolveStoredPath`, `deleteStoredPhoto`. Swapping local
disk for S3 or Cloudinary means reimplementing those three functions.
`member_photos.storage_path` already holds an opaque string.

**Member documents.** `member_photos` is the template: a `member_documents`
table with the same shape plus a `document_type` column, reusing the upload
pipeline with a different MIME allow-list. The profile tab exists and says so.

**QR-code / biometric attendance.** `attendance` already records `recorded_by`.
Add a `source` column (`manual`/`qr`/`biometric`) and a POST endpoint that
resolves a scanned code to a `member_id`; the register UI and the absence engine
need no change.

**Multiple branches.** Add `branch_id` to `members`, `departments`, `groups` and
`attendance_services`, extend `departmentScope()` into a general
`tenantScope()`, and add it to the JWT claims.

**Donations, tithes, events, counselling records.** Each is a new module folder
following the same route/service pattern, plus one migration. Nothing in the
existing schema blocks them.

---

## What would be built next

In order of value to a church actually running this:

1. **Tests.** Services are pure functions over a pool, so they are
   straightforward to test against a throwaway database. The absence engine's
   four exception rules deserve a case each — they are the logic most likely to
   be broken by a well-meaning change.
2. **Run the palette validator** and re-step the dark steps for the `#0A1C33`
   surface.
3. **Email delivery**, so password reset does not need an administrator.
4. **The advisory lock** on scheduled jobs, before running a second instance.
5. **Bulk member import** from CSV — the single biggest barrier to a church
   adopting this is typing in 800 existing members.
