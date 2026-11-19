-- ============================================================================
-- 004 - Tele Pastor role
--
-- Adds the Tele Pastor / Pastoral Care Team role: trained members who help the
-- Pastor care for the flock by phone, visitation and prayer. They need to see
-- members, absences, birthdays and follow-ups church-wide and to record the
-- calls and visits they make, but they do not edit member records, export data
-- or administer the system.
--
-- The permission list mirrors DEFAULT_ROLES in server/src/config/permissions.ts,
-- which is the source of truth; a Super Administrator may adjust it afterwards
-- from Settings. Additive and safe on a populated database: an existing role of
-- the same name is left exactly as it is.
-- ============================================================================

INSERT INTO roles (name, label, description, permissions, is_system)
VALUES (
  'tele_pastor',
  'Tele Pastor',
  'Pastoral care by phone, visitation and prayer. Sees members, absences, birthdays and follow-ups church-wide, and records the calls and visits made. Cannot edit member records, export data or change settings.',
  '["members:read","attendance:read","followups:read","followups:manage","birthdays:read","departments:read","groups:read","reports:read","dashboard:read","notifications:read"]'::jsonb,
  TRUE
)
ON CONFLICT (name) DO NOTHING;
