-- Tier-1 barcode ambiguity: the skip list.
--
-- WHY THIS TABLE EXISTS. Tier 1 links a feed row to a catalogue product by barcode.
-- When a barcode maps to more than one product there is no safe link, and the importer
-- now SKIPS rather than taking whichever candidate the lookup returned first.
--
-- A silent skip and a silent wrong link are equally invisible. This table is the
-- difference: every skipped barcode lands here with ALL its candidate product ids, so
-- the ambiguity is a queryable list instead of a decision nobody sees.
--
-- WHAT THE ROWS MEAN, measured on Niche Beauty before the fix (537 barcode matches, 22
-- ambiguous, inspected by name):
--   * ~90% are PRE-EXISTING CATALOGUE DUPLICATE PAIRS — the same product under two
--     names ("Margaret Dabbs" vs "Margaret Dabbs London"). These are merge-queue input.
--     Merge them and the barcode becomes unambiguous, and tier 1 links it on the next
--     run with no further change.
--   * The remainder are WRONG BARCODES — a Beauty of Joseon sheet mask sharing an EAN
--     with a Shu Uemura shampoo; a Coco & Eve conditioner sharing one with their detox
--     shampoo. No ranking rule fixes these. They belong on a denylist.
-- So a row here is a question, not a defect, and the two answers have different fixes.
--
-- NOT IN scrape_log.details. Item 44: structured diagnostics stored in that jsonb were
-- destroyed by a merge that stringified them, and nobody could read the per-reason
-- counts afterwards. A skip list that has to be parsed out of a log blob is not a merge
-- queue. scrape_log keeps the COUNT (tier1_ambiguous_skipped); the rows live here.
--
-- WRITTEN ON DRY RUNS TOO. A dry run is where this set is meant to be read before
-- anything is applied. `dry_run` marks which is which; filter on it rather than
-- assuming every row reflects an applied import.
--
-- NOT DEDUPED ACROSS RUNS, deliberately. Each run records what it saw, so a barcode
-- that stops being ambiguous (because the duplicates were merged) simply stops
-- appearing. Recurrence is signal: query the latest run, not the whole table.

CREATE TABLE IF NOT EXISTS public.tier1_ean_skips (
  id                    bigserial PRIMARY KEY,
  observed_at           timestamptz NOT NULL DEFAULT now(),
  retailer_id           integer NOT NULL REFERENCES public.retailers(id),
  dry_run               boolean NOT NULL DEFAULT false,
  ean                   text NOT NULL,
  -- Every candidate, not just the two that would have collided. A barcode on three
  -- products is a different finding from one on two, and truncating to a pair would
  -- hide that.
  candidate_product_ids integer[] NOT NULL,
  CONSTRAINT tier1_ean_skips_needs_candidates
    CHECK (array_length(candidate_product_ids, 1) >= 2)
);

-- The two access patterns: "what did this retailer's last run skip" and "is this
-- barcode still ambiguous anywhere".
CREATE INDEX IF NOT EXISTS idx_tier1_skips_retailer_time
  ON public.tier1_ean_skips (retailer_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tier1_skips_ean
  ON public.tier1_ean_skips (ean);

-- Service-role writes only; no public read. RLS on with NO policy is deliberate and is
-- the whole access rule — the importer uses the service role, which bypasses RLS, and
-- nothing in the app reads this. Enabled at creation rather than retrofitted.
ALTER TABLE public.tier1_ean_skips ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tier1_ean_skips IS
  'Barcodes tier 1 refused to link because they map to more than one product. Each row '
  'carries every candidate id. Mostly pre-existing catalogue duplicate pairs (merge '
  'them and the ambiguity clears itself); the rest are wrong barcodes needing a '
  'denylist. Written on dry runs too — filter on dry_run. Not deduped across runs: '
  'query the latest run per retailer, and a barcode that stops appearing has been '
  'resolved.';
