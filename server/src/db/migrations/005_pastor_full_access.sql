-- ============================================================================
-- 005 - Pastor role: full operational access
--
-- The Pastor role was originally "full visibility, read-only on records": the
-- pastor saw everything and managed follow-ups, while registration, attendance
-- and administration were left to the Church Administrator. In practice the
-- pastor leads all of that work, so the role now also adds, edits and deletes
-- member records, records attendance, and manages departments, groups, user
-- accounts and settings. Only the audit log and the Super Administrator's
-- wildcard remain outside it.
--
-- Mirrors DEFAULT_ROLES in server/src/config/permissions.ts. Safe on a
-- populated database: it rewrites one row and touches no user.
-- ============================================================================

UPDATE roles
   SET description = 'Leads the congregation: full access to members, attendance, follow-ups, departments, groups, reports, user accounts and settings.',
       permissions  = '["members:read","members:create","members:update","members:delete","members:export","attendance:read","attendance:record","attendance:delete","followups:read","followups:manage","birthdays:read","departments:read","departments:manage","groups:read","groups:manage","reports:read","reports:export","dashboard:read","users:read","users:manage","settings:read","settings:manage","notifications:read"]'::jsonb,
       updated_at   = NOW()
 WHERE name = 'pastor';
