-- SECURITY: stop new objects in `public` being born writable by anon/authenticated.
--
-- ROOT CAUSE (confirmed from pg_default_acl, 28 Jul 2026)
-- =======================================================
-- The default ACL for schema `public`, grantor `postgres`, read:
--
--   tables     {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--               authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--   sequences  {postgres=rwU/postgres,anon=rwU/postgres,...}
--   functions  {postgres=X/postgres,anon=X/postgres,...}
--
-- arwdDxtm is INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER.
-- Every table in this project has therefore been created with full anon write
-- access unless someone remembered to lock it down afterwards. That is why
-- brand_search_index shipped writable, why 56 tables carry anon write, and why
-- the nine Tier 1 RPCs (dd00d77, PR #135) were callable with the public anon key.
--
-- This migration changes the defaults only. It is deliberately NOT retrospective:
-- existing objects are handled separately (Tier 2 revokes, table exposure sweep).
--
-- WHAT THIS DOES NOT FIX, AND WHY: FUNCTIONS
-- ==========================================
-- Postgres merges the built-in acldefault() back in on top of any stored
-- pg_default_acl entry. For functions acldefault() includes an EXECUTE grant to
-- PUBLIC, and that grant CANNOT be removed via ALTER DEFAULT PRIVILEGES.
-- Verified empirically against this database on 28 Jul 2026: after
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--
-- the stored default ACL correctly became {postgres=X/postgres,service_role=X/postgres},
-- yet a function created immediately afterwards still had
--
--   {=X/postgres,postgres=X/postgres,service_role=X/postgres}
--    ^^^^^^^^^^^ the PUBLIC grant, back again
--
-- and has_function_privilege('anon', ..., 'EXECUTE') still returned true.
--
-- CONSEQUENCE: every new function in `public` remains executable by anon through
-- PUBLIC, no matter what is written here. This migration removes the *explicit*
-- anon=X and authenticated=X grants, which reduces two routes to one, but it does
-- not close the function hole. The only reliable control is a per-function
-- REVOKE EXECUTE ... FROM PUBLIC in the migration that creates it, exactly as the
-- Tier 1 migration does. Do not read this file as making that unnecessary.
--
-- No REVOKE ... FROM PUBLIC is issued below, on any object type, because it is a
-- provable no-op here: for tables and sequences acldefault() has no PUBLIC entry
-- to remove, and for functions the removal does not survive object creation.
-- Writing it anyway would imply a protection that does not exist. This is NOT the
-- same situation as a direct REVOKE on an existing function, where including
-- PUBLIC is mandatory.
--
-- SCOPE LIMIT: THE supabase_admin DEFAULT ACL IS UNCHANGED
-- ========================================================
-- An identical permissive default ACL exists for grantor `supabase_admin` in
-- `public`. It cannot be altered from here: `postgres` is not a superuser and is
-- not a member of supabase_admin, so the statement fails with
-- "42501: permission denied to change default privileges".
--
-- Assessed impact: low but non-zero. All 101 tables/views in `public` are owned by
-- postgres, as are 61 of its 103 functions. The other 42 are supabase_admin-owned
-- and every one belongs to an extension (pg_trgm 31, fuzzystrmatch 11). So the
-- supabase_admin default ACL only bites when an extension is installed into
-- `public`. Mitigation is procedural: install future extensions into the
-- `extensions` schema, per Supabase convention, not into `public`.
--
-- service_role is deliberately left untouched throughout. The feed importers and
-- the edge functions run on SUPABASE_SERVICE_ROLE_KEY and need new tables to be
-- writable on creation; stripping it would break the nightly runs.
--
-- BREAKING-CHANGE NOTE FOR FUTURE MIGRATIONS
-- ==========================================
-- After this lands, a new table in `public` is NOT readable by the frontend until
-- the migration that creates it says so explicitly:
--
--   GRANT SELECT ON public.<table> TO anon, authenticated;
--
-- SELECT is revoked here as well as write. A new table holding user data that
-- someone forgets to put RLS on should not be world-readable by default, and the
-- account/retention tables make that a live concern rather than a theoretical one.
-- The failure mode is loud: PostgREST returns permission denied rather than
-- silently exposing or silently hiding rows.
--
-- IDEMPOTENT: ALTER DEFAULT PRIVILEGES ... REVOKE is a no-op when the privilege is
-- already absent, so this is safe to re-run, on a branch, or after a PITR restore.
-- The probe objects at the end are dropped unconditionally before and after use.

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Self-verification. Assert rather than trust: the failure mode this migration
-- exists to prevent is a privilege statement that looks like it worked but did
-- not. Creates a throwaway table, sequence and function, reads their ACLs
-- directly out of the catalogue, and drops them again. Net effect on the schema
-- is zero. Reading relacl/proacl is deliberate: has_table_privilege and
-- has_function_privilege roll PUBLIC up into every role's answer and would
-- report success on an object that is still open.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl_acl text;
  seq_acl text;
  fn_acl  text;
BEGIN
  DROP TABLE IF EXISTS public._defacl_probe;
  DROP FUNCTION IF EXISTS public._defacl_probe_fn();

  CREATE TABLE public._defacl_probe (id serial PRIMARY KEY, v text);
  CREATE FUNCTION public._defacl_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';

  SELECT relacl::text INTO tbl_acl FROM pg_class WHERE oid = 'public._defacl_probe'::regclass;
  SELECT relacl::text INTO seq_acl FROM pg_class WHERE oid = 'public._defacl_probe_id_seq'::regclass;
  SELECT proacl::text INTO fn_acl  FROM pg_proc  WHERE oid = 'public._defacl_probe_fn()'::regprocedure;

  -- Tables: anon and authenticated must be absent entirely.
  IF tbl_acl LIKE '%anon=%' OR tbl_acl LIKE '%authenticated=%' THEN
    RAISE EXCEPTION 'default privileges did NOT take: new table ACL is %', tbl_acl;
  END IF;
  -- A leading "=" element would be a PUBLIC grant. Tables should never have one.
  IF tbl_acl LIKE '{=%' THEN
    RAISE EXCEPTION 'new table carries a PUBLIC grant: %', tbl_acl;
  END IF;
  -- Importers write to new tables on the service-role key.
  IF tbl_acl NOT LIKE '%service_role=arwdDxtm%' THEN
    RAISE EXCEPTION 'service_role LOST table privileges, importers would break: %', tbl_acl;
  END IF;

  IF seq_acl LIKE '%anon=%' OR seq_acl LIKE '%authenticated=%' THEN
    RAISE EXCEPTION 'default privileges did NOT take: new sequence ACL is %', seq_acl;
  END IF;

  -- Functions: assert only the explicit grants are gone. The PUBLIC "=X/" element
  -- is EXPECTED to still be present, for the reason set out in the header. If this
  -- assertion ever starts failing because "=X/" has disappeared, that is good news
  -- and means this Postgres version behaves differently; update the header first.
  IF fn_acl LIKE '%anon=%' OR fn_acl LIKE '%authenticated=%' THEN
    RAISE EXCEPTION 'default privileges did NOT take: new function ACL is %', fn_acl;
  END IF;
  IF fn_acl NOT LIKE '{=X/%' THEN
    RAISE NOTICE 'NOTE: new functions no longer carry the PUBLIC EXECUTE grant (ACL: %). The header of this migration is now out of date.', fn_acl;
  ELSE
    RAISE NOTICE 'Expected: new functions still carry PUBLIC EXECUTE (%). Per-function REVOKE FROM PUBLIC remains mandatory.', fn_acl;
  END IF;

  DROP TABLE public._defacl_probe;
  DROP FUNCTION public._defacl_probe_fn();

  RAISE NOTICE 'default privileges verified: tables %, sequences %', tbl_acl, seq_acl;
END
$$;
