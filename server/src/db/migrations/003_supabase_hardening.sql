-- ============================================================================
-- 003 - Supabase hardening
--
-- WHY THIS EXISTS
--
-- On a self-hosted PostgreSQL the only way into this database is the API
-- server, holding credentials from server/.env. On Supabase that is no longer
-- true: every Supabase project also runs PostgREST, which publishes the
-- `public` schema over HTTPS to anyone holding the project's anon key. That key
-- is not a secret - it ships in browser bundles by design.
--
-- Left alone, that would mean the entire congregation roll - names, phone
-- numbers, home addresses, dates of birth, emergency contacts and the argon2
-- password hashes in `users` - is readable, and writable, by anyone who can
-- read a Supabase anon key. This application never uses that API. So the
-- correct posture is to close it completely rather than to write policies for
-- it.
--
-- Two independent locks, because either one alone has a failure mode:
--
--   1. REVOKE the table privileges granted to `anon` and `authenticated`, and
--      change the default privileges so tables added by a FUTURE migration are
--      not granted either. This also covers VIEWS, which RLS does not: a view
--      created by `postgres` runs with the owner's rights, so
--      v_member_attendance_summary would leak the whole roll even with RLS
--      switched on underneath it.
--
--   2. ENABLE ROW LEVEL SECURITY on every table, with no policies. "No policy"
--      means "no row matches", so a role that somehow regains a table grant
--      still selects nothing.
--
--      Deliberately ENABLE and not FORCE. A table's owner bypasses RLS unless
--      FORCE is set, and these tables are owned by the role the migrations run
--      as - which is the same role the API server connects as. Plain ENABLE
--      therefore cannot lock the application out of its own data no matter how
--      the project's roles are configured, while still shutting out anon and
--      authenticated, which do not own anything. FORCE would buy nothing here
--      and would turn a role misconfiguration into a total outage.
--
-- The whole migration is a NO-OP on any database that is not Supabase. It is
-- gated on the existence of the `anon` role, which only Supabase creates, so
-- running it against a local PostgreSQL changes nothing and cannot lock the
-- application out of its own tables.
--
-- If you ever DO want to use Supabase's client libraries against this schema,
-- do not delete this file - it is already applied and recorded. Add a new
-- migration that grants exactly the tables and columns you intend to publish,
-- and write RLS policies for them.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  is_supabase BOOLEAN;
  obj         RECORD;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
    INTO is_supabase;

  IF NOT is_supabase THEN
    RAISE NOTICE '003: not a Supabase database (no anon/authenticated role) - nothing to do.';
    RETURN;
  END IF;

  RAISE NOTICE '003: Supabase detected - closing the public REST API over this schema.';

  -- --- Lock 1: take away the grants, now and in future --------------------
  --
  -- Supabase installs ALTER DEFAULT PRIVILEGES rules that grant every new
  -- table in `public` to anon and authenticated. Revoking today's grants
  -- without also changing those rules would leave the next migration exposed.

  EXECUTE 'REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';

  -- Removes any USAGE granted to these two roles by name. Note that it will
  -- NOT make has_schema_privilege('anon','public','USAGE') return false:
  -- PostgreSQL grants USAGE on `public` to the pseudo-role PUBLIC, and a
  -- revoke naming anon cannot take away a grant held by everyone.
  --
  -- That is fine, and revoking it from PUBLIC is deliberately not attempted.
  -- USAGE on a schema only permits resolving names inside it; it confers no
  -- access to any object. With every table grant gone and RLS on, anon still
  -- reads nothing - verified by a permission-denied error, not by inspecting
  -- privileges. Revoking USAGE from PUBLIC across the schema, by contrast,
  -- reaches Supabase's own internal roles and extensions, which is a real risk
  -- in exchange for no additional protection.
  EXECUTE 'REVOKE USAGE ON SCHEMA public FROM anon, authenticated';

  -- Default privileges are recorded per granting role. The migrations run as
  -- the connection user, but Supabase's own rules are recorded for `postgres`
  -- and `supabase_admin`; clear each one that we are allowed to touch.
  FOR obj IN
    SELECT rolname FROM pg_catalog.pg_roles
     WHERE rolname IN ('postgres', 'supabase_admin', CURRENT_USER)
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE ALL ON TABLES FROM anon, authenticated', obj.rolname);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE ALL ON SEQUENCES FROM anon, authenticated', obj.rolname);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE ALL ON FUNCTIONS FROM anon, authenticated', obj.rolname);
    EXCEPTION WHEN insufficient_privilege THEN
      -- Not a member of that role on this plan. Lock 2 still covers us.
      RAISE NOTICE '003: cannot alter default privileges for %, skipped.', obj.rolname;
    END;
  END LOOP;

  -- --- Lock 2: RLS on, no policies ----------------------------------------
  --
  -- Every base table in `public`, including schema_migrations. Tables owned by
  -- an extension would raise insufficient_privilege; none exist here, but the
  -- handler keeps one surprise from failing the whole migration.

  FOR obj IN
    SELECT c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND NOT c.relrowsecurity
     ORDER BY c.relname
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', obj.relname);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE '003: cannot enable RLS on % (not the owner), skipped.', obj.relname;
    END;
  END LOOP;

  -- --- Lock 3: make the view respect the caller, not its owner -------------
  --
  -- A view runs with its owner's privileges by default, so
  -- v_member_attendance_summary would read straight past the row level
  -- security enabled above. security_invoker makes it run as whoever queried
  -- it. Requires PostgreSQL 15+, which every Supabase project is; guarded
  -- anyway because this block is the only place we assume a version.
  IF current_setting('server_version_num')::int >= 150000 THEN
    FOR obj IN
      SELECT c.relname
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'v'
    LOOP
      BEGIN
        EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', obj.relname);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '003: cannot set security_invoker on % (not the owner), skipped.', obj.relname;
      END;
    END LOOP;
  END IF;

  RAISE NOTICE '003: done. The anon and authenticated roles can no longer reach this schema.';
END
$$;

COMMIT;
