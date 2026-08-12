-- One request for the sitemap's brand list, instead of ninety-eight.
--
-- WHAT IT REPLACED. app/sitemap-pages.xml/route.ts paged products_active a
-- thousand rows at a time to collect brand slugs: 97,645 rows, 98 sequential
-- PostgREST requests, each one re-running the whole view — seq scan on products
-- plus a hash aggregate over 160k retailer_prices rows — because OFFSET is applied
-- AFTER the join. Measured 0.136s at offset 0, 0.272s at 40,000, 0.404s at 90,000;
-- roughly 26 seconds of serial work to derive 2,400 distinct brands.
--
-- Next.js kills a static page at 60 seconds. On 12 August 2026 three production
-- builds were triggered within six seconds of each other, contended on this one
-- Postgres, and all three died on /sitemap-pages.xml after three attempts. The same
-- commit built green alone, byte-identical. So contention was the trigger — but a
-- 26-second page against a 60-second cap, on a curve that only grows with the
-- catalogue, would have failed on its own soon enough. The build time had already
-- moved from 1 minute to 2.
--
-- WHY jsonb AND NOT setof text, AND NOT A VIEW. PostgREST caps responses at 1,000
-- rows, which is what forced pagination in the first place. A view or a
-- `returns setof text` function still pages — three requests today at 2,400 brands,
-- four at 3,001, and nobody would notice the day it becomes four. Returning ONE ROW
-- containing an array removes pagination rather than shrinking it. That is the whole
-- point: the defect was never the number of requests, it was that the number was a
-- function of catalogue size.
--
-- STABLE, not IMMUTABLE: it reads tables. SECURITY INVOKER (the default) is
-- deliberate — this must see exactly what the caller's role sees, so the sitemap can
-- never advertise brand pages the site would not serve.
--
-- The caller still slugifies in TypeScript via brandSlug(), using the same function
-- that builds the links, so the sitemap cannot drift from the routes. Passing the
-- DISTINCT values rather than every row is provably equivalent: the caller inserts
-- into a Set, and Set insertion is idempotent.

CREATE OR REPLACE FUNCTION public.fmb_active_brand_names()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(jsonb_agg(b ORDER BY b), '[]'::jsonb)
  FROM (
    SELECT DISTINCT normalised_brand AS b
    FROM public.products_active
    WHERE normalised_brand IS NOT NULL
  ) x;
$$;

COMMENT ON FUNCTION public.fmb_active_brand_names() IS
  'Distinct normalised_brand across products_active, as a single jsonb array. Exists '
  'so /sitemap-pages.xml needs ONE request rather than paging the whole catalogue: '
  'returning one row sidesteps PostgREST''s 1,000-row cap, so the request count stops '
  'being a function of catalogue size. Callers slugify with brandSlug() in TypeScript. '
  'See work-list item 67.';

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE
  arr        jsonb;
  n_rpc      int;
  n_expected int;
BEGIN
  arr := public.fmb_active_brand_names();

  IF jsonb_typeof(arr) <> 'array' THEN
    RAISE EXCEPTION 'fmb_active_brand_names did not return a JSON array, got %', jsonb_typeof(arr);
  END IF;

  n_rpc := jsonb_array_length(arr);

  SELECT count(DISTINCT normalised_brand) INTO n_expected
  FROM public.products_active WHERE normalised_brand IS NOT NULL;

  -- The array must equal the distinct set exactly. A silent truncation here would
  -- emit a sitemap missing brand pages, which is worse than a failed build because
  -- nothing would report it.
  IF n_rpc <> n_expected THEN
    RAISE EXCEPTION 'fmb_active_brand_names returned % brands, expected %', n_rpc, n_expected;
  END IF;

  IF n_rpc = 0 THEN
    RAISE EXCEPTION 'fmb_active_brand_names returned an empty array';
  END IF;

  RAISE NOTICE 'fmb_active_brand_names verified: % brands in one row', n_rpc;
END $$;
