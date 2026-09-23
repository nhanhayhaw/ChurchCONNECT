# Putting RT AG Connect on Supabase

Creating the schema in a Supabase project, then pointing the application at it.

Supabase is PostgreSQL. This application already speaks PostgreSQL directly,
through the `pg` driver in `server/src/config/db.ts`, so there is **no client
library to install and no application code to change**. You point
`DATABASE_URL` at Supabase, turn SSL on, and create the schema.

> **Read this first.** Supabase publishes everything in the `public` schema
> through its REST API, and the `anon` key that does the publishing is meant to
> live in browser code. A member register left with the default grants is a
> congregation's names, phone numbers, addresses and photographs readable by
> anyone who has that key. Closing that off is **not optional** — it is
> [Part 2](#part-2--close-the-public-rest-api) below, and the migration runner
> now does it for you.

---

## Choose a route

There are two ways to create the schema. They produce the same database.

### Route A — run the migrations (recommended)

Two commands, from `server/`, once `.env` points at Supabase:

```powershell
npm run migrate
npm run seed        # demo data only — see Part 3 before using this for real
```

This applies `001_init.sql`, `002_invitations.sql` and
`003_supabase_hardening.sql` in order, each in its own transaction, and records
them in `schema_migrations`. It is the same schema this project runs everywhere
else, it cannot drift from what the code expects, and `003` performs the whole
of Part 2 automatically. **Prefer this.**

Skip to [Part 4](#part-4--point-the-application-at-supabase) for the `.env`
settings, do that first, then come back and run the two commands above.

`npm run db:create` is not needed. Supabase provisions the `postgres` database
for you and will not let you create another; running it anyway is harmless, it
reports the database already exists and stops.

### Route B — paste SQL into the dashboard

Parts 1 to 3 below. Each step is one block to paste into **SQL Editor → New
query → Run**, in dependency order. Use this if you would rather watch each
object appear, or if you cannot run Node against the database from where you
are sitting.

Step 18 tells the migration runner what you did by hand, so the two routes stay
compatible. After Route B, still run `npm run migrate` once: it will skip 001
and 002 as already applied and add `003_supabase_hardening.sql`.

---

## Before you start

1. Create the project at [supabase.com](https://supabase.com). Choose the region
   nearest your congregation — for Ghana, `eu-west-2` (London) or
   `eu-central-1` (Frankfurt) are the usual picks.
2. Save the database password it shows you. It is displayed once.
3. **Project Settings → Database → Connection string → Session pooler.** Copy
   that URI. It looks like:

   ```
   postgresql://postgres.abcdefghijklm:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
   ```

**Use the session pooler on port 5432, not the transaction pooler on 6543.**
Two reasons, both of which break the application on 6543:

- `config/db.ts` sets `statement_timeout` and
  `idle_in_transaction_session_timeout` as connection parameters. The
  transaction pooler rejects startup parameters it does not recognise.
- The direct host (`db.<ref>.supabase.co`) is IPv6-only on the free plan. The
  pooler hostname answers on IPv4, so it works from anywhere.

---

## Part 1 — Create the schema (Route B)

> Skip Parts 1 to 3 entirely if you took Route A. `npm run migrate` creates
> every object below, and `npm run seed` or the inserts in Part 3 fill them.

### Step 1 — The shared trigger function

Keeps `updated_at` honest without trusting the application.

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Step 2 — `roles`

```sql
CREATE TABLE roles (
  id           BIGSERIAL PRIMARY KEY,
  name         VARCHAR(50)  NOT NULL UNIQUE,
  label        VARCHAR(100) NOT NULL,
  description  TEXT,
  permissions  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  is_system    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Step 3 — `departments`

`leader_member_id` has no foreign key yet: departments and members reference
each other, so one of the two constraints has to come second (step 6).

```sql
CREATE TABLE departments (
  id                BIGSERIAL PRIMARY KEY,
  name              VARCHAR(120) NOT NULL UNIQUE,
  description       TEXT,
  leader_member_id  BIGINT,
  meeting_day       VARCHAR(20),
  meeting_time      VARCHAR(20),
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Step 4 — `groups`

```sql
CREATE TABLE groups (
  id                BIGSERIAL PRIMARY KEY,
  name              VARCHAR(120) NOT NULL UNIQUE,
  group_type        VARCHAR(30)  NOT NULL DEFAULT 'cell'
                    CHECK (group_type IN ('cell','prayer','bible_study','zone','fellowship')),
  description       TEXT,
  leader_member_id  BIGINT,
  meeting_day       VARCHAR(20),
  meeting_time      VARCHAR(20),
  meeting_location  VARCHAR(200),
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_groups_updated BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Step 5 — `members` and its indexes

The heart of the system. Soft-deleted via `deleted_at` so a stray click never
erases pastoral history.

```sql
CREATE TABLE members (
  id                  BIGSERIAL PRIMARY KEY,
  member_code         VARCHAR(30)  NOT NULL UNIQUE,
  first_name          VARCHAR(80)  NOT NULL,
  middle_name         VARCHAR(80),
  last_name           VARCHAR(80)  NOT NULL,
  gender              VARCHAR(10)  NOT NULL CHECK (gender IN ('male','female')),
  date_of_birth       DATE,
  marital_status      VARCHAR(20)  CHECK (marital_status IN ('single','married','divorced','widowed')),
  nationality         VARCHAR(60)  DEFAULT 'Ghanaian',

  phone               VARCHAR(30),
  alt_phone           VARCHAR(30),
  email               VARCHAR(150),
  address             TEXT,

  date_joined         DATE         NOT NULL DEFAULT CURRENT_DATE,
  membership_status   VARCHAR(20)  NOT NULL DEFAULT 'active'
                      CHECK (membership_status IN ('active','inactive','transferred','deceased')),
  baptism_status      VARCHAR(20)  NOT NULL DEFAULT 'not_baptised'
                      CHECK (baptism_status IN ('baptised','not_baptised','pending')),
  communion_status    VARCHAR(20)  NOT NULL DEFAULT 'not_communicant'
                      CHECK (communion_status IN ('communicant','not_communicant')),
  membership_category VARCHAR(30)  NOT NULL DEFAULT 'full_member'
                      CHECK (membership_category IN ('full_member','associate','new_convert','visitor','child')),
  ministry            VARCHAR(120),

  department_id       BIGINT REFERENCES departments(id) ON DELETE SET NULL,
  group_id            BIGINT REFERENCES groups(id)      ON DELETE SET NULL,

  emergency_name          VARCHAR(120),
  emergency_relationship  VARCHAR(60),
  emergency_phone         VARCHAR(30),

  photo_id            BIGINT,
  notes               TEXT,

  created_by          BIGINT,
  updated_by          BIGINT,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_members_dob_sane CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE)
);
CREATE TRIGGER trg_members_updated BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_members_status      ON members (membership_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_members_department  ON members (department_id);
CREATE INDEX idx_members_group       ON members (group_id);
CREATE INDEX idx_members_gender      ON members (gender);
CREATE INDEX idx_members_date_joined ON members (date_joined);
CREATE INDEX idx_members_deleted     ON members (deleted_at);
CREATE INDEX idx_members_birth_md    ON members (
  EXTRACT(MONTH FROM date_of_birth), EXTRACT(DAY FROM date_of_birth)
) WHERE date_of_birth IS NOT NULL;
CREATE INDEX idx_members_fullname    ON members (LOWER(first_name || ' ' || last_name));
CREATE INDEX idx_members_phone       ON members (phone);
```

### Step 6 — `member_photos`, and the three deferred leader/photo keys

```sql
CREATE TABLE member_photos (
  id           BIGSERIAL PRIMARY KEY,
  member_id    BIGINT       NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  file_name    VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type    VARCHAR(60)  NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
  size_bytes   INTEGER      NOT NULL CHECK (size_bytes > 0),
  uploaded_by  BIGINT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_member_photos_member ON member_photos (member_id);

ALTER TABLE members
  ADD CONSTRAINT fk_members_photo
  FOREIGN KEY (photo_id) REFERENCES member_photos(id) ON DELETE SET NULL;

ALTER TABLE departments
  ADD CONSTRAINT fk_departments_leader
  FOREIGN KEY (leader_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE groups
  ADD CONSTRAINT fk_groups_leader
  FOREIGN KEY (leader_member_id) REFERENCES members(id) ON DELETE SET NULL;
```

### Step 7 — `users`, and the remaining deferred keys

A user account is a **login**; a member is a **person in the congregation**.
Most members never log in, and some staff accounts are not members.

This is *not* Supabase Auth — the application signs people in itself with
Argon2id and its own JWTs. `public.users` and `auth.users` are unrelated tables
in different schemas and do not conflict.

```sql
CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  full_name      VARCHAR(150) NOT NULL,
  email          VARCHAR(150) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  phone          VARCHAR(30),
  role_id        BIGINT       NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  member_id      BIGINT       REFERENCES members(id) ON DELETE SET NULL,
  department_id  BIGINT       REFERENCES departments(id) ON DELETE SET NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_attempts SMALLINT NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_users_role ON users (role_id);
CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));

ALTER TABLE members ADD CONSTRAINT fk_members_created_by
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE members ADD CONSTRAINT fk_members_updated_by
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE member_photos ADD CONSTRAINT fk_member_photos_uploader
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
```

### Step 8 — Session and password-reset tokens

Only the SHA-256 hash of each token is stored, so a database leak hands an
attacker nothing usable.

```sql
CREATE TABLE refresh_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64)    NOT NULL UNIQUE,
  user_agent  VARCHAR(300),
  ip_address  VARCHAR(60),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_expiry ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE password_resets (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64)    NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Step 9 — `attendance_services`

A congregation-wide service leaves `department_id` and `group_id` NULL. Only
congregation-wide services feed the absence engine.

```sql
CREATE TABLE attendance_services (
  id             BIGSERIAL PRIMARY KEY,
  service_date   DATE         NOT NULL,
  service_type   VARCHAR(40)  NOT NULL CHECK (service_type IN (
                   'sunday_service','midweek_service','bible_study','prayer_meeting',
                   'youth_service','womens_ministry','mens_ministry','special_programme')),
  title          VARCHAR(160),
  department_id  BIGINT REFERENCES departments(id) ON DELETE SET NULL,
  group_id       BIGINT REFERENCES groups(id) ON DELETE SET NULL,
  notes          TEXT,
  is_finalized   BOOLEAN      NOT NULL DEFAULT FALSE,
  recorded_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_services_updated BEFORE UPDATE ON attendance_services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_services_unique ON attendance_services (
  service_date, service_type, COALESCE(department_id, 0), COALESCE(group_id, 0)
);
CREATE INDEX idx_services_date ON attendance_services (service_date DESC);
CREATE INDEX idx_services_type ON attendance_services (service_type);
```

The `COALESCE` in the unique index is deliberate: `NULL <> NULL` in a plain
UNIQUE constraint, which would allow unlimited duplicate congregation-wide
services for one date.

### Step 10 — `attendance`

Absence of a row means "not recorded", never "absent".

```sql
CREATE TABLE attendance (
  id          BIGSERIAL PRIMARY KEY,
  service_id  BIGINT      NOT NULL REFERENCES attendance_services(id) ON DELETE CASCADE,
  member_id   BIGINT      NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status      VARCHAR(10) NOT NULL CHECK (status IN ('present','absent','excused')),
  note        VARCHAR(300),
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_attendance UNIQUE (service_id, member_id)
);
CREATE TRIGGER trg_attendance_updated BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_attendance_member ON attendance (member_id);
CREATE INDEX idx_attendance_service ON attendance (service_id);
CREATE INDEX idx_attendance_status ON attendance (status);
```

### Step 11 — `follow_ups` and `follow_up_notes`

The partial unique index is the duplicate-alert guard: one open case per member.

```sql
CREATE TABLE follow_ups (
  id                   BIGSERIAL PRIMARY KEY,
  member_id            BIGINT      NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  level                SMALLINT    NOT NULL CHECK (level BETWEEN 1 AND 3),
  weeks_absent         SMALLINT    NOT NULL DEFAULT 0,
  last_attendance_date DATE,
  status               VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN (
                         'pending','contacted','responded','needs_further_follow_up',
                         'resolved','unable_to_reach')),
  source               VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  assigned_to          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at          TIMESTAMPTZ,
  last_contact_at      TIMESTAMPTZ,
  next_follow_up_date  DATE,
  resolved_at          TIMESTAMPTZ,
  created_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_followups_updated BEFORE UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_followups_one_open_per_member
  ON follow_ups (member_id)
  WHERE status NOT IN ('resolved','unable_to_reach');

CREATE INDEX idx_followups_status   ON follow_ups (status);
CREATE INDEX idx_followups_level    ON follow_ups (level);
CREATE INDEX idx_followups_assignee ON follow_ups (assigned_to);
CREATE INDEX idx_followups_next     ON follow_ups (next_follow_up_date);

CREATE TABLE follow_up_notes (
  id             BIGSERIAL PRIMARY KEY,
  follow_up_id   BIGINT      NOT NULL REFERENCES follow_ups(id) ON DELETE CASCADE,
  author_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  note           TEXT        NOT NULL,
  contact_method VARCHAR(20) CHECK (contact_method IN ('phone','sms','whatsapp','visit','email','in_person','other')),
  status_at_time VARCHAR(30),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_followup_notes_parent ON follow_up_notes (follow_up_id, created_at DESC);
```

### Step 12 — `birthday_reminders`

The unique constraint is what makes the daily job idempotent.

```sql
CREATE TABLE birthday_reminders (
  id             BIGSERIAL PRIMARY KEY,
  member_id      BIGINT      NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  birthday_date  DATE        NOT NULL,
  days_before    SMALLINT    NOT NULL CHECK (days_before >= 0),
  remind_on      DATE        NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','shown','dismissed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_birthday_reminder UNIQUE (member_id, birthday_date, days_before)
);
CREATE INDEX idx_birthday_remind_on ON birthday_reminders (remind_on, status);
```

### Step 13 — `notifications` and `notification_reads`

Addressed either to one user or to every holder of a role — exactly one of the
two. Read state is per user, so one pastor marking a role-wide alert read does
not hide it from the administrator.

```sql
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
  role_id     BIGINT REFERENCES roles(id) ON DELETE CASCADE,
  type        VARCHAR(40)  NOT NULL CHECK (type IN (
                'absence_alert','followup_due','followup_overdue','birthday',
                'new_member','system','attendance_missing')),
  severity    VARCHAR(10)  NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  link        VARCHAR(300),
  entity_type VARCHAR(40),
  entity_id   BIGINT,
  dedupe_key  VARCHAR(180),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_notification_target CHECK (
    (user_id IS NOT NULL AND role_id IS NULL) OR (user_id IS NULL AND role_id IS NOT NULL)
  )
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_role ON notifications (role_id, created_at DESC);
CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE notification_reads (
  notification_id BIGINT      NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);
```

### Step 14 — `audit_logs`

Append-only. No endpoint anywhere updates or deletes an entry.

```sql
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_email  VARCHAR(150),
  user_role   VARCHAR(50),
  action      VARCHAR(60)  NOT NULL,
  entity_type VARCHAR(40),
  entity_id   BIGINT,
  description TEXT         NOT NULL,
  ip_address  VARCHAR(60),
  user_agent  VARCHAR(300),
  metadata    JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_user    ON audit_logs (user_id);
CREATE INDEX idx_audit_action  ON audit_logs (action);
CREATE INDEX idx_audit_entity  ON audit_logs (entity_type, entity_id);
```

### Step 15 — `system_settings`

```sql
CREATE TABLE system_settings (
  id          BIGSERIAL PRIMARY KEY,
  key         VARCHAR(80)  NOT NULL UNIQUE,
  value       JSONB        NOT NULL,
  category    VARCHAR(40)  NOT NULL DEFAULT 'general',
  label       VARCHAR(160) NOT NULL,
  description TEXT,
  updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Step 16 — The attendance summary view

`security_invoker` is a Supabase-specific addition: without it the view runs
with its owner's rights and would read straight past the row-level security you
switch on in step 19.

```sql
CREATE VIEW v_member_attendance_summary AS
SELECT
  m.id                                    AS member_id,
  m.member_code,
  m.first_name || ' ' || m.last_name      AS full_name,
  m.membership_status,
  m.department_id,
  COUNT(a.id) FILTER (WHERE a.status = 'present')  AS times_present,
  COUNT(a.id) FILTER (WHERE a.status = 'absent')   AS times_absent,
  COUNT(a.id) FILTER (WHERE a.status = 'excused')  AS times_excused,
  MAX(s.service_date) FILTER (WHERE a.status = 'present') AS last_attendance_date
FROM members m
LEFT JOIN attendance a ON a.member_id = m.id
LEFT JOIN attendance_services s ON s.id = a.service_id AND s.is_finalized
WHERE m.deleted_at IS NULL
GROUP BY m.id;

ALTER VIEW v_member_attendance_summary SET (security_invoker = on);
```

### Step 17 — Migration 002: account invitations

An invitation and a password reset are the same mechanism — a single-use,
expiring, hashed token — so they share one table.

```sql
ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'reset'
    CHECK (purpose IN ('reset', 'invite'));

ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN password_resets.purpose IS
  'reset = the user asked to recover their own account; invite = an administrator created the account and the user has not set a password yet.';

CREATE INDEX IF NOT EXISTS idx_password_resets_open
  ON password_resets (user_id, purpose)
  WHERE used_at IS NULL;
```

### Step 18 — Tell the migration runner the work is done

Without this, the next `npm run migrate` tries to create everything again and
fails on the first `CREATE TABLE`.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (filename)
VALUES ('001_init.sql'), ('002_invitations.sql')
ON CONFLICT (filename) DO NOTHING;
```

---

## Part 2 — Close the public REST API

> **This is now a migration.** `003_supabase_hardening.sql` does everything in
> this Part, so `npm run migrate` covers it on either route. Step 19 is kept
> here because it is worth understanding what was done to your project, and
> because the verification in step 20 is worth running either way.
>
> The migration is gated on the `anon` role existing, so it is a no-op on a
> local PostgreSQL and cannot lock a development machine out of its own tables.

### Step 19 — Row-level security on every table

**Do not skip this.** Supabase serves the whole `public` schema over HTTPS to
anyone holding the `anon` key, and that key is designed to be published in
browser code. Until this runs, your member register is readable by the internet.

Row-level security with no policies denies everyone. The application is
unaffected: it connects as the table owner over the pooled connection, and
PostgreSQL does not apply row-level security to a table's owner.

Note that this is `ENABLE`, not `FORCE`, row level security, and deliberately
so. `FORCE` would apply the policies to the table owner too — which is the role
the application itself connects as — turning a role misconfiguration into a
total outage while buying nothing against `anon`, which owns nothing.

Revoking the grants matters as much as the row level security, and covers one
thing RLS does not: `v_member_attendance_summary` is a **view**, and a view runs
with its owner's privileges, so it would read straight past the RLS on the
tables underneath. Step 16's `security_invoker = on` is the other half of that
fix; migration 003 applies it to every view in `public`.

```sql
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
```

### Step 20 — Prove it worked

This must return **no rows**:

```sql
SELECT tablename
  FROM pg_tables
 WHERE schemaname = 'public' AND rowsecurity = false;
```

And this must also return **no rows**:

```sql
SELECT table_name, grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
```

Then the check that actually settles it — become `anon` and try to read the
member register. This must **fail** with `permission denied for table members`:

```sql
SET ROLE anon;
SELECT count(*) FROM members;
RESET ROLE;
```

Prefer this over inspecting privileges. In particular, do not be alarmed that

```sql
SELECT has_schema_privilege('anon', 'public', 'USAGE');
```

still returns `true`. PostgreSQL grants `USAGE` on the `public` schema to the
pseudo-role `PUBLIC`, so every role has it and a revoke naming `anon` cannot
take it away. `USAGE` only allows resolving names within the schema and confers
no access to any object in it, so with the table grants gone and row-level
security on, it buys an attacker nothing. Revoking it from `PUBLIC` would reach
Supabase's own internal roles and extensions — real risk, no added protection.

Then open **Advisors → Security** in the dashboard. There should be no
"RLS disabled in public" findings.

You *will* still see **"RLS enabled, no policy"** notices. For this application
that is the intended end state, not something to fix — the schema is meant to be
unreachable from the REST API. Adding permissive policies to clear the notices
would undo the protection you just put in.

---

## Part 3 — The minimum data the application needs

### Step 21 — The five roles

Roles are normally created by `npm run seed`, which also loads 62 fictional
demo members. This is that part on its own.

```sql
INSERT INTO roles (name, label, description, permissions, is_system) VALUES
('super_admin', 'Super Administrator',
 'Unrestricted access, including user management, settings and audit logs.',
 '["*"]'::jsonb, TRUE),

('pastor', 'Pastor',
 'Full visibility of members, attendance, follow-ups and reports. Read-only on records.',
 '["members:read","attendance:read","followups:read","followups:manage","birthdays:read","departments:read","groups:read","reports:read","reports:export","dashboard:read","notifications:read"]'::jsonb, TRUE),

('church_admin', 'Church Administrator',
 'Day-to-day administration: registration, attendance, departments, groups and follow-ups.',
 '["members:read","members:create","members:update","members:export","attendance:read","attendance:record","attendance:delete","followups:read","followups:manage","birthdays:read","departments:read","departments:manage","groups:read","groups:manage","reports:read","reports:export","dashboard:read","notifications:read"]'::jsonb, TRUE),

('department_leader', 'Department Leader',
 'Sees and follows up members of their own department only.',
 '["members:read","attendance:read","attendance:record","followups:read","followups:manage","birthdays:read","departments:read","groups:read","reports:read","dashboard:read","notifications:read"]'::jsonb, TRUE),

('viewer', 'Viewer',
 'Read-only access to members, attendance and reports.',
 '["members:read","attendance:read","followups:read","birthdays:read","departments:read","groups:read","reports:read","dashboard:read","notifications:read"]'::jsonb, TRUE)

ON CONFLICT (name) DO UPDATE
  SET label = EXCLUDED.label, permissions = EXCLUDED.permissions;
```

### Step 22 — Settings with their labels

The application falls back to built-in defaults for any missing key, so this is
optional — but without it the Settings page has no labels or descriptions to
show. **Change the church name and contact details to the real ones.**

```sql
INSERT INTO system_settings (key, value, category, label, description) VALUES
('church_name',    '"Your Church Name"'::jsonb,                            'church', 'Church name',    'Shown on the login page, reports and exports.'),
('church_tagline', '"Connecting People. Strengthening the Church."'::jsonb,'church', 'Tagline',        'Short motto shown under the church name.'),
('church_address', '"P.O. Box 0000, Accra, Ghana"'::jsonb,                 'church', 'Postal address', 'Printed on report headers.'),
('church_phone',   '"+233 00 000 0000"'::jsonb,                            'church', 'Telephone',      'Church office contact number.'),
('church_email',   '"info@yourchurch.org"'::jsonb,                         'church', 'Email address',  'Church office email address.'),
('church_logo_url','""'::jsonb,                                            'church', 'Logo URL',       'Optional logo shown in the sidebar and on reports.'),

('birthday_reminder_days',         '[7,3,1,0]'::jsonb, 'birthdays', 'Reminder days before birthday', 'How many days ahead reminders are generated.'),
('birthday_notifications_enabled', 'false'::jsonb,     'birthdays', 'Raise birthday notifications',  'When off, birthdays appear on screen but raise no notifications.'),

('absence_level_1_services',      '2'::jsonb,                    'absence', 'Level 1 threshold (services missed)', 'Consecutive misses that trigger a Follow-Up Reminder.'),
('absence_level_2_services',      '3'::jsonb,                    'absence', 'Level 2 threshold (services missed)', 'Consecutive misses that trigger an Urgent Follow-Up.'),
('absence_level_3_services',      '4'::jsonb,                    'absence', 'Level 3 threshold (services missed)', 'Consecutive misses that trigger a Pastoral Follow-Up.'),
('absence_excused_counts',        'false'::jsonb,                'absence', 'Count excused absences',              'When off, an excused absence resets the streak.'),
('absence_tracked_service_types', '["sunday_service"]'::jsonb,   'absence', 'Services tracked for absence',        'Only these service types feed absence monitoring.'),
('absence_auto_create_followups', 'true'::jsonb,                 'absence', 'Open follow-ups automatically',       'When off, alerts are raised but cases are opened by hand.'),

('followup_overdue_days', '7'::jsonb, 'followups', 'Days before a follow-up is overdue', 'Used to flag neglected cases.')

ON CONFLICT (key) DO NOTHING;
```

### Step 23 — The first Super Administrator

The application hashes passwords with Argon2id, which cannot be produced in SQL.
Generate the hash locally first, from the `server` directory:

```powershell
cd server
node -e "const a=require('argon2');a.hash(process.argv[1],{type:a.argon2id,memoryCost:19456,timeCost:2,parallelism:1}).then(console.log)" "YourRealPassword123"
```

Those four options are exactly what `auth.service.ts` uses; a hash made with
different settings still verifies, but this keeps new and existing accounts
consistent.

Copy the output — it begins `$argon2id$v=19$m=19456,t=2,p=1$` — and paste it in:

```sql
INSERT INTO users (full_name, email, password_hash, role_id, is_active, must_change_password)
VALUES (
  'Your Full Name',
  'you@yourchurch.org',
  '$argon2id$v=19$m=19456,t=2,p=1$PASTE_THE_REST_OF_YOUR_HASH_HERE',
  (SELECT id FROM roles WHERE name = 'super_admin'),
  TRUE,
  FALSE
);
```

Create everyone else from **Users & Roles** inside the application once you are
signed in — never by hand in SQL.

---

## Part 4 — Point the application at Supabase

`server/.env` already carries a commented Supabase block. Comment out the two
local lines and fill in the Supabase pair — exactly one pair may be active:

```ini
#DATABASE_URL=postgresql://postgres:postgres@localhost:5432/churchconnect
#PGSSL=false

DATABASE_URL=postgresql://postgres.abcdefghijklm:YOUR-PASSWORD@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
PGSSL=true
```

Keep the local lines commented rather than deleting them. Switching back to work
offline is then a two-character edit.

`.env` is already in `.gitignore`. Keep it there: that one line grants full read
and write access to every member record.

If the password contains `@`, `:`, `/`, `?`, `#` or `%`, percent-encode it
(`@` → `%40`) or the URL parses wrongly. And remember the dotenv rule from the
README: quote any value containing `#`, or everything after it is dropped.

Then start the API and check what it says:

```powershell
cd server
npm run dev
```

You want `[db] connected` followed by the banner. `[db] schema not found` means
a step above did not run.

### Verify end to end

```powershell
curl http://localhost:4000/api/health
```

`{"status":"ok","database":"ok",...}` confirms the API reached Supabase. Then
sign in at `http://localhost:5173` with the account from step 23.

### When it will not connect

Nearly every first-attempt failure is one of these, and the error message rarely
names the real cause.

| What you see | What it means |
|---|---|
| `ENOTFOUND` naming a host fragment you do not recognise | Unencoded punctuation in the password split the URL. Percent-encode it. |
| `ENETUNREACH`, or a connection that just hangs | You used the direct host `db.<ref>.supabase.co`, which is IPv6-only. Use the session pooler. |
| `no pg_hba.conf entry ... SSL off` | `PGSSL` is not `true`. |
| `password authentication failed for user "postgres"` | On the pooler the username carries the project ref: `postgres.abcdefghijklm`, not `postgres`. Copy the whole string from the dashboard. |
| `unsupported startup parameter: statement_timeout` | You are on the transaction pooler, port 6543. Use port 5432. |
| `Tenant or user not found` | The project ref in the username does not match the pooler host's region. |
| Migration prints `already applied` but the tables are missing | You are pointed at a different project than you think. Check the masked target line the runner prints at startup. |

---

## Things that will bite you

**Never run `npm run seed` against this database.** It loads 62 fictional
members and five demo accounts sharing one published password. Steps 21–23 are
the production-safe equivalent.

**Never run `npm run migrate -- --fresh`,** or `npm run db:reset`, which calls
it. Both issue `DROP SCHEMA public CASCADE`. On a local PostgreSQL that merely
destroys this application's data, which is the point of the flag. On Supabase it
also destroys the grants and default-privilege rules the project's API layer
depends on, leaving something subtly broken that does not show up until later.

The runner now **refuses** when `DATABASE_URL` points at a `supabase.co` or
`supabase.com` host, before it opens a connection. The old `NODE_ENV=production`
guard did not catch this, because `NODE_ENV` on a developer machine pointed at a
live Supabase project is still `development`.

To clear the data without touching the schema, use `npm run seed -- --force`.

**Member photographs still live on the application server's disk**, not in
Supabase Storage. Supabase backs up the database; nothing backs up the photos.
Keep them in the backup routine, or move them to Supabase Storage — the
interface in `services/storage.service.ts` is deliberately thin so that swap is
one file.

**Connection count.** The pool opens up to 20 connections per API instance.
That is comfortable on the free plan through the session pooler, but if you run
several instances, lower `max` in `config/db.ts` or raise the pooler's limit.

**Backups.** The free plan keeps daily backups for 7 days with no
point-in-time recovery. For a real congregation take the paid plan or run
`pg_dump` on a schedule you control — the discipline in OPERATIONS.md applies
here just as much as on your own server.

---

## Optional hardening: a non-superuser application role

The September 2026 reliability review flagged that the application connects with
far more power than it needs (`docs/QA-REPORT-2026-09.md`, finding O1). Supabase's
`postgres` role is not a true superuser, which helps, but it still owns and can
drop every table. A dedicated role limited to reading and writing rows is better.

```sql
CREATE ROLE churchconnect_app LOGIN PASSWORD 'generate-a-strong-one';

GRANT CONNECT ON DATABASE postgres TO churchconnect_app;
GRANT USAGE ON SCHEMA public TO churchconnect_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO churchconnect_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO churchconnect_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO churchconnect_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO churchconnect_app;
```

Then connect as `churchconnect_app.<project-ref>` instead of
`postgres.<project-ref>` — the pooler requires that `role.project_ref` form.

**Test this before relying on it.** Because the new role does not own the
tables, row-level security from step 19 *does* apply to it, and with no policies
it will be denied everything. Either add a permissive policy for that role:

```sql
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'CREATE POLICY app_full_access ON public.%I FOR ALL TO churchconnect_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
```

or grant it `BYPASSRLS` (`ALTER ROLE churchconnect_app BYPASSRLS`), which
Supabase may not permit on all plans. Run steps 20's verification queries again
afterwards, and sign in to the application to confirm nothing broke.
