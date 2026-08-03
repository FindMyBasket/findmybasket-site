-- platform_changes: record The Fragrance Shop go-live as an EXPECTED boundary.
--
-- Accepted 3 August 2026 via Rakuten; parked until after Niche Beauty onboarding,
-- which is itself parked behind the AWIN product_GTIN importer fix (id 3). Terms
-- and parking reason live in docs/partnership-tracker.md.
--
-- Same treatment as id 4 (Niche Beauty retailer go-live): status 'expected',
-- changed_at NULL, same three metrics. A go-live adds catalogue size, brand count
-- and comparison depth in one step, so any series crossing it must not be read as
-- organic growth.
--
-- THIS ROW CHANGES NO METRIC. An 'expected' row with a NULL changed_at is a marker
-- for a boundary that has not happened yet. It touches no view, no import path and
-- no live figure, which is why it is safe to write inside the 4 August hold.
--
-- WHAT THIS DOES NOT DO. It does not create a retailers row, a retailer_config row
-- or an import config. The delivery terms (tiered, GBP 40.00 threshold, GBP 3.49
-- cost, observed 2026-08-03) are DELIBERATELY not written here — they belong to the
-- retailer row at onboarding. They are recorded in docs/partnership-tracker.md so
-- they need not be re-read from the Rakuten terms later.
--
-- IDEMPOTENT: keyed on title, which carries platform_changes_title_uniq
-- (convention 6). The id is not asserted anywhere, because ids are not stable
-- across a rebuild.
--
-- NOTE ON APPLICATION PATH: applied via SQL, not `apply_migration`, matching every
-- platform_changes row since 20260724102843 (ids 17, 24, 26). That divergence is
-- work-list item 5 and is UNDECIDED; tracking this one file while its neighbours
-- are untracked would make the history table a partial record, which is worse than
-- a consistently absent one. Revisit with item 5, not here.

INSERT INTO public.platform_changes (changed_at, status, title, description, metrics_affected)
VALUES (
  NULL,
  'expected',
  'The Fragrance Shop retailer go-live',
  'Accepted 3 August 2026 via Rakuten. Commission 2%. Product catalogue confirmed available. '
  'PARKED: queued behind Niche Beauty onboarding, which is itself queued behind the AWIN product_GTIN '
  'importer fix (id 3), so the chain is AWIN coalesce fix -> Niche Beauty -> The Fragrance Shop. '
  'Adds catalogue size, comparison depth and brand count in one step; do not read the step as growth. '
  'Delivery terms observed 2026-08-03 and recorded in docs/partnership-tracker.md, NOT applied here: '
  'tiered, threshold GBP 40.00, cost GBP 3.49. GBP 40 is the joint third-highest threshold on the live '
  'roster (behind YesStyle and Perfume Click at GBP 50, level with Atelier De Glow), so baskets will '
  'often sit below it — a useful test case for the optimiser once the RoutineBuilder delivery fallbacks '
  'are removed (work-list item 11), because a wrongly defaulted GBP 25 would model this retailer as free '
  'when it is not. 2% sits at the bottom of the commission range alongside Boots; this retailer earns its '
  'place through comparison depth in a thin category rather than revenue, which is a legitimate and '
  'different reason. Caveat: commission rates are not in the database and the Boots ranking is carried, '
  'not measured (docs/commercial-finding-catalogue-depth.md, "Not verified here"). '
  'Record the timestamp when it goes live and set status to occurred.',
  ARRAY['comparison_depth_pct','catalogue_size','total_brands']
)
ON CONFLICT (title) DO NOTHING;

-- --- Verification (convention 4: assert, do not assume) --------------------
DO $$
DECLARE
  r record;
  n_expected int;
BEGIN
  SELECT id, status, changed_at, metrics_affected INTO r
  FROM public.platform_changes
  WHERE title = 'The Fragrance Shop retailer go-live';

  -- ON CONFLICT DO NOTHING succeeds silently when it inserts nothing. This is the
  -- only thing between that and a row that was never written.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The Fragrance Shop boundary row is absent; the INSERT wrote nothing';
  END IF;

  IF r.status <> 'expected' THEN
    RAISE EXCEPTION 'The Fragrance Shop row reads status %, expected ''expected''', r.status;
  END IF;
  IF r.changed_at IS NOT NULL THEN
    RAISE EXCEPTION 'The Fragrance Shop row carries changed_at %, expected NULL (it has not gone live)', r.changed_at;
  END IF;
  IF NOT (r.metrics_affected @> ARRAY['comparison_depth_pct','catalogue_size','total_brands']
          AND array_length(r.metrics_affected, 1) = 3) THEN
    RAISE EXCEPTION 'The Fragrance Shop row carries metrics_affected %, expected the same three as id 4', r.metrics_affected;
  END IF;

  -- The neighbouring undated boundaries must not have moved. Named explicitly
  -- rather than counted by predicate (convention 3).
  SELECT count(*) INTO n_expected
  FROM public.platform_changes
  WHERE status = 'expected' AND changed_at IS NULL
    AND title IN ('Browse search total_count cutover',
                  'AWIN product_GTIN importer fix',
                  'Niche Beauty retailer go-live');
  IF n_expected <> 3 THEN
    RAISE EXCEPTION 'expected the 3 pre-existing undated boundaries (ids 2, 3, 4) intact, found %', n_expected;
  END IF;

  RAISE NOTICE 'OK: The Fragrance Shop go-live recorded as expected, id %', r.id;
END
$$;
