# RT AG Connect

**Church Membership, Attendance & Follow-Up Management System**
*A Smart Digital Platform for Effective Church Membership Management*

RT AG Connect turns a church's member register into information leadership can act
on. It answers seven questions every pastor and administrator asks:

- Who are our members?
- Who attended church?
- Who has been absent?
- Who needs follow-up?
- Whose birthday is coming up?
- How is membership growing?
- Which departments and groups are active?

---

## Status — verified running

Built and exercised end to end on **Node 26.7.0 / npm 11.19 / PostgreSQL 18.4
(Windows 11)**:

| Check | Result |
|---|---|
| Server typecheck & build | Clean |
| Client typecheck & production build | Clean |
| Migration `001_init.sql` | Applied |
| Seed | 62 members, 12 Sunday registers, 768 attendance marks |
| API smoke test | **112 / 112 passed** — auth, RBAC, members, attendance, absence engine, follow-ups, birthdays, reports, exports, notifications, audit, settings, security headers |
| Absence engine | 13 members flagged (L1 = 5, L2 = 2, L3 = 6); re-running produced 0 duplicates |
| Client dev server + API proxy | Serving, branding fetched live from the database |

Requirements: **Node 20+**, **PostgreSQL 14+**. Git is optional.

---

## Setup

### 1. Configure the API

```powershell
cd server
copy .env.example .env
```

Edit `server\.env`:

- `DATABASE_URL` — your own connection string.
- Generate two **different** secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **Quote any value containing `#`.** dotenv treats an unquoted `#` as the start
> of an inline comment, so `SEED_DEFAULT_PASSWORD=ChurchConnect#2026` would
> silently become `ChurchConnect`. The example file quotes it correctly.

### 2. Install and set up

```powershell
npm install
```

**npm 11 and newer block package install scripts by default.** `argon2`, `sharp`
and `esbuild` all need theirs, and the server will not start without them. If npm
warns about `install-scripts`, approve them:

```powershell
npm install-scripts approve argon2
npm install-scripts approve sharp
npm install-scripts approve esbuild
```

Then create the database, apply the schema and load the demo data:

```powershell
npm run setup       # = db:create + migrate + seed
npm run dev         # http://localhost:4000
```

`npm run db:create` connects through the `pg` driver rather than shelling out to
`createdb`, so the PostgreSQL client tools do **not** need to be on PATH — on a
default Windows server-only install, they are not.

### 3. Start the client

In a second terminal:

```powershell
cd client
npm install
npm install-scripts approve esbuild   # if npm warns
npm run dev                            # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:4000`, so the browser sees one origin
and the refresh-token cookie stays first-party.

### 4. Sign in

All demo accounts share the password in `SEED_DEFAULT_PASSWORD`
(default `ChurchConnect#2026`).

| Email | Role | What they can do |
|---|---|---|
| `admin@churchconnect.demo` | Super Administrator | Everything, including users, settings and audit logs |
| `pastor@churchconnect.demo` | Pastor | Read members, attendance, alerts, reports; manage follow-ups |
| `registry@churchconnect.demo` | Church Administrator | Register members, record attendance, manage departments/groups |
| `choir.lead@churchconnect.demo` | Department Leader | Only sees the Choir department |
| `viewer@churchconnect.demo` | Viewer | Read-only |

**Change these passwords before any real deployment.**

### 5. See the absence engine work

The seed deliberately shapes attendance so every follow-up level has real
examples. After signing in:

1. Open **Follow-Up → Alerts**.
2. Press **Run absence scan**.

You should see roughly six Level 1, four Level 2 and five Level 3 members, plus
four already-worked follow-up cases under **Follow-Up → Pending**.

### 6. Run the regression tests (optional)

The tests boot the real API against a **separate** database so they can never
touch your data. Create it once, then run them whenever you change the server:

```powershell
cd server
$env:DATABASE_URL = "postgresql://postgres:<password>@localhost:5432/churchconnect_qa"
npm run setup                          # creates + migrates + seeds churchconnect_qa
Remove-Item Env:DATABASE_URL
npm test                               # boots the API in-process against churchconnect_qa
```

The suite refuses to run unless the database name ends in `_qa` or `_test`.

---

## What is in the box

```
churchconnect/
├── server/                 Node + Express + TypeScript API
│   └── src/
│       ├── config/         env validation, pg pool, permission catalogue
│       ├── db/             migrations, migration runner, seed script
│       ├── middleware/     auth, RBAC, validation, error translation
│       ├── modules/        one folder per resource (auth, members, …)
│       ├── services/       absence engine, storage, audit, settings
│       ├── jobs/           node-cron scheduler
│       └── utils/          errors, HTTP helpers, calendar-date helpers
└── client/                 React 18 + TypeScript + Tailwind + Recharts
    └── src/
        ├── api/            fetch client with silent token refresh
        ├── components/     ui kit, layout, charts, attendance register
        ├── context/        auth, toasts
        ├── hooks/          theme, debounce
        ├── pages/          one file per screen
        └── utils/          display formatting
```

| Document | For whom |
|---|---|
| [`docs/ChurchConnect-Leadership-Presentation.pptx`](docs/ChurchConnect-Leadership-Presentation.pptx) | **Pastors, elders and church council** — a ready-to-present 21-slide deck with speaker notes. Add seven screenshots and your own figures. |
| [`docs/PRESENTATION.md`](docs/PRESENTATION.md) | The written guide behind that deck — slide-by-slide content, a five-minute live demo script, and answers to the questions leadership will ask. |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | **Putting it online** — step by step from a Namecheap domain to working HTTPS, on a managed platform or your own server. Read the first section before buying hosting. |
| [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md) | **Using Supabase as the database** — picking the right connection string, creating the schema, and closing the public REST API that would otherwise publish your member register. |
| [`docs/QA-SCAN-2026-09-24.md`](docs/QA-SCAN-2026-09-24.md) | **Latest full-system scan** — what was run against the live Vercel + Render + Supabase deployment, the connection-pool defect it found and fixed, and what remains open. |
| [`docs/EMAIL.md`](docs/EMAIL.md) | **Turning on self-service password reset** — provider choice, SMTP settings, and the SPF/DKIM/DMARC records that keep mail out of spam. |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | **Running it live** — backups, the restore drill, updates, incident procedures. Written to be read under pressure. |
| [`docs/GOING-COMMERCIAL.md`](docs/GOING-COMMERCIAL.md) | **Selling to multiple churches** — the single/multi-tenant decision, what must be built before charging anyone, pricing, onboarding, support and Ghanaian data-protection duties. |
| [`docs/ONBOARDING-DATA.md`](docs/ONBOARDING-DATA.md) | **Getting a church's 600 members in** — the single biggest obstacle to adoption. Includes a ready-to-send [import template](docs/templates/member-import-template.csv) you can give a church today. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Developers — design decisions and why they were made |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Developers — ERD, schema reasoning, the absence query |
| [`docs/API.md`](docs/API.md) | Developers — every endpoint and permission |

---

## The features that matter

### Automatic absence monitoring

For every active member the engine counts **consecutive missed services** among
finalised, congregation-wide services of a tracked type (Sunday Service by
default) and raises a graded alert:

| Consecutive misses | Level | Meaning |
|---|---|---|
| 2 | Level 1 | Follow-Up Reminder |
| 3 | Level 2 | Urgent Follow-Up |
| 4 (about a month) | Level 3 | Pastoral Follow-Up |

Four rules keep it honest, and they are the difference between a useful tool and
one the church stops trusting:

1. **Only finalised registers count.** A half-completed register never makes the
   congregation look absent.
2. **A missing attendance row means "not recorded", not "absent".** Churches that
   only tick who came are handled by a completeness guard: a register covering
   under 40% of the active roll is ignored entirely.
3. **An excused absence resets the streak** (configurable). Someone who told the
   church they would be away is not a pastoral concern.
4. **Services before a member joined are not their absences.**

The engine **never** changes a member's status, never marks anyone as having
left, and never contacts anyone. Its only output is an alert addressed to a
church worker. Duplicate suppression is enforced in the database: one open
follow-up per member (partial unique index) and one notification per
member/level/role (unique dedupe key).

It runs nightly at 01:30 via `node-cron`, immediately whenever a register is
finalised, and on demand from the Alerts screen.

### Follow-up management

A follow-up is a conversation, not a flag. Cases carry a level, an assigned
officer, a next-contact date and a full note history with contact method, so the
next worker to pick a case up knows exactly what was said.

### Birthdays

Reminders are generated each morning at 06:00 for the configured day offsets
(7, 3, 1 and 0 by default). The unique constraint on
`(member_id, birthday_date, days_before)` makes the job idempotent. Nothing is
ever sent to the member — outbound messaging is deliberately not implemented.

### Reports

Ten reports across membership, attendance, absentees and birthdays. Each is
defined **once** on the server as `{ title, columns, fetch }` and rendered three
ways — JSON for the screen, XLSX and PDF for download. Adding a report is one
entry in `server/src/modules/reports/reports.routes.ts`; the client picks it up
with no change.

---

## Security

| Control | Implementation |
|---|---|
| Password hashing | Argon2id, 19 MiB / t=2 (OWASP baseline) |
| Sessions | 15-minute access JWT in memory + rotating refresh token in an httpOnly, SameSite=Strict cookie |
| Refresh-token theft | Only the SHA-256 hash is stored; replaying a used token revokes the whole family |
| Brute force | Account lockout after 5 failures; 10 requests / 15 min on credential endpoints |
| User enumeration | Sign-in and password-reset responses are identical whether or not the address exists |
| Authorisation | Permission strings checked per route, re-read from the database on **every** request so a revoked role takes effect immediately |
| Row-level scoping | Department Leaders are constrained in SQL, not in the UI |
| SQL injection | Every statement is parameterised; sort columns come from a fixed whitelist |
| Upload safety | Memory storage → MIME allow-list → **`sharp` re-encode** → random filename. The file written to disk is a new image produced by a decoder, so a polyglot payload cannot survive |
| XSS | React escaping, no `dangerouslySetInnerHTML` anywhere, strict CSP via Helmet, images served with `Content-Type` pinned and `nosniff` |
| Audit | Append-only log with actor, action, entity, IP and user agent. No endpoint edits or deletes an entry |
| Self-lockout | A user cannot change their own role or deactivate themselves, and the last Super Administrator cannot be removed |

---

## Known gaps and where to pick them up

These are stated plainly rather than hidden, and each has a documented path in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#deferred-integrations):

| Gap | Status |
|---|---|
| **Browser UI not visually inspected** | Every screen is served and its data verified through the API, and the production build succeeds — but no human or browser has looked at the rendered pages. Expect cosmetic adjustments. |
| ~~Chart palette not validated~~ | **Closed.** Validated against RT AG Connect's own surfaces; categorical slots pass every check in both light and dark. One sub-3:1 status colour is mitigated by the legend + table-view twin every chart carries. Results in `client/src/components/charts/theme.ts`. |
| ~~No unit test suite~~ | **Partly closed.** `npm test` (in `server/`) runs a committed regression suite that boots the real API in-process against a disposable `_qa` database — it refuses any other database name — and covers every defect fixed in the September 2026 reliability review (see `docs/QA-REPORT-2026-09.md`). Broad unit coverage of the services is still open. |
| **Outbound email / SMS** | Password reset generates a token but cannot deliver it. A Super Administrator resets passwords from Users & Roles instead. |
| **Member documents tab** | The UI and data model anticipate it; upload is not wired. |
| **Multi-instance jobs** | The `node-cron` single-run guard is in-process. Running more than one API instance needs a PostgreSQL advisory lock — one function call, described in the architecture doc. |

Everything else listed in the brief — member management with photos, attendance
with bulk marking, absence detection, follow-ups, birthdays, departments,
groups, reports with PDF/Excel export, notifications, audit logs, dashboard
charts, responsive layout, seed data — is implemented.

---

## Future features the architecture is ready for

SMS/WhatsApp/email delivery (one `NotificationChannel` interface), QR-code and
biometric attendance (attendance rows already carry `recorded_by` and a source
field can be added without migration pain), online self-registration, donations
and tithes, events, children's records, counselling notes, multiple branches
(add `branch_id` to the four root tables), and a mobile app against the same API.

---

## Licence & data protection

Member records contain personal data and photographs. Before deploying:

- change every seeded password,
- put the API behind HTTPS,
- restrict database access to the application user only,
- review who holds Super Administrator rights,
- confirm your handling meets Ghana's Data Protection Act, 2012 (Act 843), or the
  equivalent where you operate.

All demo data is fictional. The names are common Ghanaian given names and
surnames combined arbitrarily; phone numbers use a non-routing block and email
addresses use `example.com`. No real person's information is present.
