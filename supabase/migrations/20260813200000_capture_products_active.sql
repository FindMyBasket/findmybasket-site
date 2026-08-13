-- CAPTURE products_active AS IT ACTUALLY IS. A capture, not a correction.
--
-- WHY THIS EXISTS. The live view carries a JOIN to `retailers` and an `r.active = true`
-- filter that NO MIGRATION ADDS. The last committed definition — 20260703150000, whose
-- own comment reads "Definition otherwise verbatim" — has neither. Verified
-- exhaustively: two migrations redefine this view and neither carries the filter; a
-- third mentions both names and only references the view. The active-retailer filter
-- was applied to production outside version control.
--
-- That is not a stale record, it is an ABSENT one, on the object every catalogue figure
-- in docs/post-4-august-work-list.md depends on. A stale record can be diffed. This
-- could not: the repo's version was not an older definition of the live view, it was a
-- DIFFERENT view that no longer existed anywhere. Work-list item 75.
--
-- NOTHING IS FIXED HERE. The SQL below reproduces the live definition exactly:
-- `r.active = true` rather than the shorter `r.active`, `image_url <> ''::text` with its
-- cast, unqualified column names against an aliased table, predicates in their original
-- order. If any of that reads as odd, THE ODDITY IS WHAT SHIPS. Correcting it would make
-- this a change to the catalogue rather than a record of it, and the point is to be able
-- to review the thing that is running.
--
-- Any actual change to this view — including whether `in_stock` should be filtered — is
-- a separate migration with its own baseline. See the comment block at the end.

BEGIN;

-- ---------------------------------------------------------------------------
-- Snapshot BEFORE. Both the rendered definition and the full row set, because a
-- count alone cannot distinguish two definitions that return the same number.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _pa_before ON COMMIT DROP AS SELECT * FROM public.products_active;
CREATE TEMP TABLE _pa_defbefore ON COMMIT DROP AS
  SELECT pg_get_viewdef('public.products_active'::regclass, true) AS def;

-- ---------------------------------------------------------------------------
-- The live definition, reproduced.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.products_active AS
 SELECT id,
    name,
    brand,
    category,
    image_url,
    ean,
    created_at,
    ingredients,
    concerns,
    subcategory,
    normalised_brand,
    canonical_size,
    match_key,
    tags,
    shade,
    product_type,
    top_category,
    merged_into,
    merged_at,
    description,
    search_vector,
    amazon_asin
   FROM products p
  WHERE merged_into IS NULL AND parent_product_id IS NULL AND image_url IS NOT NULL AND image_url <> ''::text AND (EXISTS ( SELECT 1
           FROM retailer_prices rp
             JOIN retailers r ON r.id = rp.retailer_id
          WHERE rp.product_id = p.id AND r.active = true));

-- ---------------------------------------------------------------------------
-- Assert it is a no-op. Three ways, weakest to strongest.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n_before  bigint;
  n_after   bigint;
  n_lost    bigint;
  n_gained  bigint;
  def_before text;
  def_after  text;
BEGIN
  SELECT count(*) INTO n_before FROM _pa_before;
  SELECT count(*) INTO n_after  FROM public.products_active;

  -- 1. Row count.
  IF n_before <> n_after THEN
    RAISE EXCEPTION 'products_active row count changed: % -> %. This migration must be a no-op.', n_before, n_after;
  END IF;

  -- 2. FULL ROW SET, both directions. Two different definitions can return the same
  --    count while disagreeing about which rows, so the count above is necessary and
  --    nowhere near sufficient.
  SELECT count(*) INTO n_lost   FROM (SELECT * FROM _pa_before EXCEPT SELECT * FROM public.products_active) x;
  SELECT count(*) INTO n_gained FROM (SELECT * FROM public.products_active EXCEPT SELECT * FROM _pa_before) x;
  IF n_lost <> 0 OR n_gained <> 0 THEN
    RAISE EXCEPTION 'products_active row SET changed: % rows lost, % gained, with the count unchanged at %. The definition is not equivalent.',
      n_lost, n_gained, n_after;
  END IF;

  -- 3. The rendered definition itself, byte for byte. This is the one that proves the
  --    SQL above was not tidied, reordered or "improved" on the way in: Postgres
  --    re-renders any semantically equivalent form differently, so an identical
  --    pg_get_viewdef is proof of textual fidelity rather than a promise of it.
  SELECT def INTO def_before FROM _pa_defbefore;
  SELECT pg_get_viewdef('public.products_active'::regclass, true) INTO def_after;
  IF def_before IS DISTINCT FROM def_after THEN
    RAISE EXCEPTION E'products_active definition was altered, not captured.\n--- was ---\n%\n--- now ---\n%', def_before, def_after;
  END IF;

  RAISE NOTICE 'products_active captured verbatim: % rows, row set identical, definition byte-identical', n_after;
END $$;

-- ---------------------------------------------------------------------------
-- The comment. This is the only thing this migration CHANGES, and it changes no
-- behaviour.
-- ---------------------------------------------------------------------------
COMMENT ON VIEW public.products_active IS
$c$Active product catalogue visible on the frontend. Excludes: merged products,
shade-variants under a parent, products without images (broken cards), and products with
no price row at an ACTIVE retailer (orphans).

DOES NOT FILTER ON in_stock. A product whose every retailer row is out of stock stays in
this view and keeps its page.

WHETHER THAT WAS DELIBERATE CANNOT BE ESTABLISHED, AND BOTH READINGS ARE ON RECORD.
Read one: it is intentional and correct — an out-of-stock product is a real product, and
dropping it would 404 the page and withdraw it from the sitemap, returning when stock
returns. That churn is worse than either steady state, and on 13 August it would have
removed 13,335 pages, 13.6% of the catalogue.
Read two: stock was never in scope. The filter this view actually documents is
PRICE-PRESENCE, which answers "does anyone list this?" rather than "can anyone buy it?",
and the original comment named four filters without mentioning stock at all.

Nobody can now tell which, because until 13 August 2026 the definition of this view was
not in the repository (see below), so the reasoning could not be found by anyone looking
for it.

THE CONSEQUENCE IS REAL AND HAS SURFACED THREE TIMES. (1) Setting in_stock = false
cannot remove a page — work-list line 1479, 3 August. (2) fmb_resolve_product must carry
its own in_stock predicate, documented in its comment on 27 July: "products_active does
NOT filter on in_stock, so the resolver applies its own predicate. A basket tool must not
offer an unbuyable row." (3) Product JSON-LD emitted no offers on 13,335 pages, because
the page qualifies while having nothing buyable to put in them — work-list item 76.

The 27 July comment is the point. Someone hit this, understood it exactly, and wrote it
down correctly — inside an unrelated function, where the next person to need it would
never pass. The place that would have reached all three surfaces is this comment, and
until now this view was not reviewable.

CHANGING THE in_stock BEHAVIOUR IS A SEPARATE MIGRATION WITH ITS OWN BASELINE. Do not
fold it into a refactor. See work-list items 75 and 76.$c$;

COMMIT;
