-- Applied via MCP apply_migration 2026-07-03 (supabase db push blocked by
-- migration-history drift; file kept for the record).
--
-- Generic companion to fmb_revalidate_brand_slugs: fire-and-forget POST to
-- /api/revalidate for an arbitrary set of pathnames (e.g. /product/123). Same
-- vault secret + pg_net pattern. Lets a data backfill refresh product pages, not
-- just brand pages, without waiting for the 1h ISR window.
CREATE OR REPLACE FUNCTION public.fmb_revalidate_paths(paths_in text[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  secret text;
  paths  jsonb;
BEGIN
  IF paths_in IS NULL OR array_length(paths_in, 1) IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'revalidate_secret' LIMIT 1;
  IF secret IS NULL THEN
    RAISE WARNING 'fmb_revalidate_paths: revalidate_secret not in vault; skipping';
    RETURN NULL;
  END IF;
  SELECT jsonb_agg(p) INTO paths FROM unnest(paths_in) p WHERE p IS NOT NULL AND left(p,1) = '/';
  IF paths IS NULL THEN RETURN NULL; END IF;
  RETURN net.http_post(
    url := 'https://www.findmybasket.co.uk/api/revalidate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-revalidate-secret', secret),
    body := jsonb_build_object('paths', paths),
    timeout_milliseconds := 15000
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fmb_revalidate_paths(text[]) TO service_role;
