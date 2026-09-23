-- ============================================================================
-- RT AG Connect - Initial schema
-- PostgreSQL 14+
--
-- Design notes
--  * Every table uses a surrogate BIGSERIAL primary key. Natural keys that
--    users actually type (member_code, role name, setting key) carry UNIQUE
--    constraints instead, so they can be renamed without breaking references.
--  * Enumerated values are implemented as CHECK constraints rather than
--    PostgreSQL ENUM types: adding a value to a CHECK is a cheap ALTER, while
--    adding one to an ENUM historically required careful migration ordering.
--  * ON DELETE behaviour is explicit everywhere. Reference data that a member
--    merely points at (department, group) uses SET NULL; data that only exists
--    because of its parent (attendance rows, follow-up notes) uses CASCADE.
--  * Audit logs deliberately keep a denormalised copy of the actor's email so
--    the trail survives deletion of the user account.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Reusable trigger: keep updated_at honest without trusting the application.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- roles
-- Permissions are stored as a JSONB array of "resource:action" strings. This
-- lets a Super Administrator tune a role without a schema migration, while the
-- API still validates against a fixed catalogue in src/config/permissions.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  id           BIGSERIAL PRIMARY KEY,
  name         VARCHAR(50)  NOT NULL UNIQUE,
  label        VARCHAR(100) NOT NULL,
  description  TEXT,
  permissions  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  is_system    BOOLEAN      NOT NULL DEFAULT FALSE,  -- system roles cannot be deleted
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- departments
-- leader_member_id is added later as an ALTER, because departments and members
-- reference each other and one of the two constraints has to come second.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- groups (cells, zones, fellowships)
-- "groups" is not reserved in PostgreSQL, but queries always quote it for
-- clarity since GROUP is a keyword.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- members
-- The heart of the system. Soft-delete via deleted_at: member records are
-- pastoral history and should not vanish from audit trails on a stray click.
-- ---------------------------------------------------------------------------
CREATE TABLE members (
  id                  BIGSERIAL PRIMARY KEY,
  member_code         VARCHAR(30)  NOT NULL UNIQUE,          -- e.g. CC-2026-0001
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

  photo_id            BIGINT,                                -- FK added after member_photos
  notes               TEXT,

  created_by          BIGINT,                                -- FK added after users
  updated_by          BIGINT,
  deleted_at          TIMESTAMPTZ,                           -- soft delete
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- A member cannot be born after they joined, and cannot be born in the future.
  CONSTRAINT chk_members_dob_sane CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE)
);
CREATE TRIGGER trg_members_updated BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Search & filter indexes -----------------------------------------------------
CREATE INDEX idx_members_status      ON members (membership_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_members_department  ON members (department_id);
CREATE INDEX idx_members_group       ON members (group_id);
CREATE INDEX idx_members_gender      ON members (gender);
CREATE INDEX idx_members_date_joined ON members (date_joined);
CREATE INDEX idx_members_deleted     ON members (deleted_at);
-- Birthday lookups query by month/day irrespective of year, so index the parts.
CREATE INDEX idx_members_birth_md    ON members (
  EXTRACT(MONTH FROM date_of_birth), EXTRACT(DAY FROM date_of_birth)
) WHERE date_of_birth IS NOT NULL;
-- Trigram-free full name search: a plain functional index serves ILIKE 'x%'.
CREATE INDEX idx_members_fullname    ON members (LOWER(first_name || ' ' || last_name));
CREATE INDEX idx_members_phone       ON members (phone);

-- ---------------------------------------------------------------------------
-- member_photos
-- One row per uploaded image; members.photo_id points at the current one so
-- replaced photos remain available for the audit trail until purged.
-- ---------------------------------------------------------------------------
CREATE TABLE member_photos (
  id           BIGSERIAL PRIMARY KEY,
  member_id    BIGINT       NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  file_name    VARCHAR(255) NOT NULL,          -- randomised name on disk
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

-- ---------------------------------------------------------------------------
-- users
-- A user account is a *login*; a member is a *person in the congregation*.
-- They are separate on purpose - most members never log in, and some staff
-- accounts (e.g. a visiting IT contractor) are not members. member_id links
-- the two when they happen to be the same person, and lets a Department Leader
-- be scoped to the department their member record belongs to.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  full_name      VARCHAR(150) NOT NULL,
  email          VARCHAR(150) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  phone          VARCHAR(30),
  role_id        BIGINT       NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  member_id      BIGINT       REFERENCES members(id) ON DELETE SET NULL,
  department_id  BIGINT       REFERENCES departments(id) ON DELETE SET NULL, -- scope for leaders
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
-- Case-insensitive login lookup.
CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));

ALTER TABLE members ADD CONSTRAINT fk_members_created_by
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE members ADD CONSTRAINT fk_members_updated_by
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE member_photos ADD CONSTRAINT fk_member_photos_uploader
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- refresh_tokens - server-side session management.
-- Only the SHA-256 hash of the token is stored, so a database leak does not
-- hand an attacker usable sessions. Revoking = setting revoked_at.
-- ---------------------------------------------------------------------------
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

-- Single-use, short-lived password reset tokens (hash only, same reasoning).
CREATE TABLE password_resets (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64)    NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- attendance_services - one row per gathering that attendance is taken for.
-- A department- or group-specific meeting sets department_id / group_id; a
-- congregation-wide service leaves both NULL. Only congregation-wide services
-- feed the absence-streak calculation (see docs/DATABASE.md).
-- ---------------------------------------------------------------------------
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

-- Prevent the same service being registered twice for a date. COALESCE is used
-- because NULL <> NULL in a plain UNIQUE constraint, which would allow
-- unlimited duplicate congregation-wide services.
CREATE UNIQUE INDEX idx_services_unique ON attendance_services (
  service_date, service_type, COALESCE(department_id, 0), COALESCE(group_id, 0)
);
CREATE INDEX idx_services_date ON attendance_services (service_date DESC);
CREATE INDEX idx_services_type ON attendance_services (service_type);

-- ---------------------------------------------------------------------------
-- attendance - one row per member per service.
-- Absence of a row is treated as "not recorded", NOT as absent, so that a
-- half-finished register never triggers pastoral alerts. The absence engine
-- only counts services where is_finalized = TRUE.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- follow_ups
-- Created either automatically by the absence engine (source = 'auto') or by
-- hand. The partial unique index below is the duplicate-alert guard required
-- by the spec: a member can only have ONE open follow-up at a time.
-- ---------------------------------------------------------------------------
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

-- "Open" = anything not yet resolved / written off. One open case per member.
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

-- ---------------------------------------------------------------------------
-- birthday_reminders
-- One row per (member, occurrence year, days_before). The unique constraint is
-- what makes the daily job idempotent - re-running it never duplicates.
-- ---------------------------------------------------------------------------
CREATE TABLE birthday_reminders (
  id             BIGSERIAL PRIMARY KEY,
  member_id      BIGINT      NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  birthday_date  DATE        NOT NULL,   -- the birthday as it falls THIS year
  days_before    SMALLINT    NOT NULL CHECK (days_before >= 0),
  remind_on      DATE        NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','shown','dismissed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_birthday_reminder UNIQUE (member_id, birthday_date, days_before)
);
CREATE INDEX idx_birthday_remind_on ON birthday_reminders (remind_on, status);

-- ---------------------------------------------------------------------------
-- notifications
-- Addressed either to one user (user_id) or to every holder of a role
-- (role_id). Exactly one of the two must be set.
-- ---------------------------------------------------------------------------
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
-- Stops the nightly job re-announcing the same alert every single night.
CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Read state is per user, so a role-broadcast notification can be read by one
-- pastor without disappearing for another.
CREATE TABLE notification_reads (
  notification_id BIGINT      NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

-- ---------------------------------------------------------------------------
-- audit_logs - append only. No UPDATE/DELETE is ever issued by the app.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_email  VARCHAR(150),          -- denormalised: survives user deletion
  user_role   VARCHAR(50),
  action      VARCHAR(60)  NOT NULL, -- e.g. member.create, attendance.record
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

-- ---------------------------------------------------------------------------
-- system_settings - key/value with a JSONB payload so a setting can be a
-- string, a number, or a whole array (e.g. birthday reminder day offsets).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Convenience view: the current absence streak per active member.
-- Encapsulates the "consecutive congregation-wide services not present" rule
-- so both the nightly job and ad-hoc reports agree on one definition.
-- ---------------------------------------------------------------------------
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

COMMIT;
