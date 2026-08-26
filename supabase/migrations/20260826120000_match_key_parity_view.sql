-- ============================================================================
-- Parity surface. BEHAVIOUR-NEUTRAL: creates a read-only view over existing data
-- using the EXISTING match-key functions. Changes no key and no row.
--
-- SPLIT OUT OF THE FOLDING MIGRATION DELIBERATELY, because of a circular
-- dependency found while building the check:
--
--   parity must be verified BEFORE the folding change is applied,
--   but the check needs this view,
--   and the view was inside the folding migration.
--
-- So the view lands first, on its own, and the baseline run happens against the
-- UNCHANGED functions. That run answers the question that actually has to be true
-- before both halves are edited: DO THE TWO IMPLEMENTATIONS AGREE TODAY? Only then
-- is a zero after the change evidence of anything. Work-list item 371.
-- ============================================================================

-- ── Parity surface, read by scripts/match-key-parity.mts ─────────────────────
--
-- Exposes the stored key beside the SQL-recomputed one so the TypeScript half can
-- be diffed against the SQL half ROW BY ROW over the whole catalogue. Deliberately
-- a view rather than a function: PostgREST can page a view, and paging is what
-- makes a 99,967-row comparison possible from a script.
--
-- NOT GRANTED TO anon/authenticated. It exposes nothing sensitive, but item 264
-- revoked diagnostic-view grants as a class and this is that class. The parity
-- script runs with the service role.
CREATE OR REPLACE VIEW public.products_active_match_parity AS
  SELECT p.id, p.brand, p.name,
         p.match_key                                   AS stored,
         public.fmb_build_match_key(p.brand, p.name)   AS sql_key
  FROM public.products_active p;

REVOKE ALL ON public.products_active_match_parity FROM anon, authenticated;

COMMENT ON VIEW public.products_active_match_parity IS
  $c$Stored match_key beside the SQL-recomputed one, for scripts/match-key-parity.mts.

Exists so byte-parity between the TS and SQL implementations is asserted over the CORPUS
rather than over the harness fixtures -- a different property from correctness, and the one
that drifts. Item 371.$c$;
