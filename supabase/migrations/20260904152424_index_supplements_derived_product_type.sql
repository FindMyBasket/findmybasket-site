-- THE BROWSE-TYPE FILTER ON SUPPLEMENTS WAS A SEQUENTIAL DERIVATION, NOT A LOOKUP.
--
-- products_active.product_type is COALESCE(product_type, fmb_supplement_type(name, brand))
-- for supplements: the value is computed at READ time because the categoriser deliberately
-- leaves product_type NULL on those rows (20260827111048).
--
-- Every other category filters `?type=` on a stored, indexed column. Supplements could not:
-- `product_type = 'Vitamins'` on the view is a filter on an EXPRESSION, so Postgres ran
-- fmb_supplement_type -- twelve regexes over a brand-stripped name -- on every supplements
-- row in scope, then discarded the ones that did not match. MEASURED 4 Sep on warm cache:
-- 1,794 ms for /supplements/supplements?type=Vitamins, 6,660 rows evaluated to return 600.
-- The equivalent skincare query, same shape and 27,243 candidate rows, took 130 ms.
--
-- anon's statement_timeout is 3s. That is the whole defect: the page was not wrong, it was
-- SLOW, and it crossed the timeout as the catalogue grew. 4,017 supplements rows landed on
-- 28 August, the day after the derivation shipped, tripling the scan. The first 500 appears
-- in the edge logs on 30 August; there are none on 27-29 August, when the same code was live
-- against a third of the rows. A PostgREST 500 reaches the page as an empty result and the
-- empty-type guard turns it into notFound() -- a hard 404 on a link the site renders itself.
--
-- IT IS AN INDEX AND NOT A BACKFILL BECAUSE THE READ-TIME DERIVATION IS THE DESIGN. Writing
-- the values into products.product_type would freeze them and fight the categoriser, which
-- nulls that column for supplements on every re-import. Indexing the expression keeps the
-- semantics -- new and edited rows are derived and indexed automatically -- and makes the
-- filter a lookup.
--
-- THE EXPRESSION MUST MATCH products_active's CHARACTER FOR CHARACTER, including the
-- `ELSE NULL::text`. A cosmetic edit to either side silently stops the planner matching them
-- and the scan comes back with no error and no signal. Compare against
-- pg_get_viewdef('products_active') before touching this.
--
-- AND THE INDEX GOES STALE IF fmb_supplement_type CHANGES. It is declared IMMUTABLE, which
-- is what makes it indexable, but its BODY is a vocabulary that is expected to grow. Adding a
-- type to it does not rebuild this index; the old classification stays until it is rebuilt.
-- ANY CHANGE TO fmb_supplement_type MUST BE FOLLOWED BY:
--     REINDEX INDEX CONCURRENTLY idx_products_supplements_derived_type;
create index if not exists idx_products_supplements_derived_type
  on products (
    (COALESCE(product_type,
       CASE WHEN top_category = 'supplements'::text
            THEN fmb_supplement_type(name, brand)
            ELSE NULL::text END)),
    subcategory,
    id
  )
  where top_category = 'supplements'::text;

comment on index idx_products_supplements_derived_type is
  'Makes ?type= on supplements a lookup instead of a per-row fmb_supplement_type() derivation. Expression must stay identical to products_active.product_type. REINDEX after any change to fmb_supplement_type.';
