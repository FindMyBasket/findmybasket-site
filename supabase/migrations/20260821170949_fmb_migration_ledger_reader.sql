-- Read-only accessor for the migration ledger, for the standing check in
-- scripts/migration-ledger-check.mjs (work-list item 235).
--
-- WHY IT EXISTS. supabase_migrations.schema_migrations is not a REST-exposed
-- schema, and the standing checks authenticate with SUPABASE_SERVICE_KEY over
-- PostgREST rather than a database password (see
-- scripts/brand-hub-programme-check.mjs). Without this the check would need a
-- second credential that no other check needs.
--
-- SECURITY DEFINER, and EXECUTE granted to service_role ONLY. anon and
-- authenticated are revoked explicitly rather than left to default, because the
-- ledger names every schema change ever applied and is not public information.
--
-- RETURNS VERSIONS AND NAMES, NEVER `statements`. The statements array holds the
-- full SQL of every migration; this function exists to answer "which versions
-- are recorded", and returning the SQL as well would make a reporting accessor
-- into a schema-exfiltration path for anything that ever gets the service key.

CREATE OR REPLACE FUNCTION public.fmb_migration_ledger()
RETURNS TABLE(version text, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m.version, m.name
  FROM supabase_migrations.schema_migrations m
  ORDER BY m.version;
$$;

REVOKE ALL ON FUNCTION public.fmb_migration_ledger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fmb_migration_ledger() FROM anon;
REVOKE ALL ON FUNCTION public.fmb_migration_ledger() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fmb_migration_ledger() TO service_role;

COMMENT ON FUNCTION public.fmb_migration_ledger() IS
  'Read-only ledger accessor for the migration-ledger standing check (work-list item 235). service_role only. Returns version and name, never statements.';
