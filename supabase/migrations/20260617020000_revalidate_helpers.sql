-- ISR revalidation helpers (brand page fixes PR — Change 2c).
-- The frontend /api/revalidate endpoint refreshes ISR-cached brand/category pages
-- on data changes. The importer (import-awin-feed) calls it directly over HTTP.
-- Merges happen in plpgsql (merge_product_group / merge_products), so they need a
-- DB-side trigger to the same endpoint via pg_net — these helpers provide it.

-- Brand -> URL slug. MUST mirror brandSlug() in lib/queries.ts and brandSlugify()
-- in import-awin-feed exactly: lowercase, drop apostrophes (straight + curly),
-- non-alphanumeric runs -> '-', trim leading/trailing '-'.
CREATE OR REPLACE FUNCTION public.fmb_brand_slug(b text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' FROM
    regexp_replace(
      regexp_replace(lower(coalesce(b, '')), '[' || chr(39) || chr(8217) || ']', '', 'g'),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;

-- Fire-and-forget POST to the site's /api/revalidate for a set of brand slugs.
-- Secret comes from vault (name='revalidate_secret' — add it alongside the
-- Vercel REVALIDATE_SECRET). Mirrors fmb_invoke_import_slice's pg_net pattern.
CREATE OR REPLACE FUNCTION public.fmb_revalidate_brand_slugs(slugs text[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  secret text;
  paths  jsonb;
BEGIN
  IF slugs IS NULL OR array_length(slugs, 1) IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'revalidate_secret' LIMIT 1;
  IF secret IS NULL THEN
    RAISE WARNING 'fmb_revalidate_brand_slugs: revalidate_secret not in vault; skipping';
    RETURN NULL;
  END IF;
  SELECT jsonb_agg('/brands/' || s) INTO paths FROM unnest(slugs) s WHERE s IS NOT NULL AND s <> '';
  IF paths IS NULL THEN RETURN NULL; END IF;
  RETURN net.http_post(
    url := 'https://www.findmybasket.co.uk/api/revalidate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-revalidate-secret', secret),
    body := jsonb_build_object('paths', paths),
    timeout_milliseconds := 15000
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fmb_brand_slug(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fmb_revalidate_brand_slugs(text[]) TO service_role;
