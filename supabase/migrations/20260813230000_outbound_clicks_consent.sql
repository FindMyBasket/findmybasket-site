-- outbound_clicks.consent — the visitor's banner state at the moment of the click.
--
-- WHY. The GA4-over-server-side click ratio has four inputs: consent refusals, ad
-- blockers stopping gtag, client-capture regressions, and bot traffic on the server path.
-- THREE OF THEM SHARE ONE SIGNATURE — gtag never ran — and consent is the only one that
-- has never been measurable at all, because a refusal is a purely client-side event that
-- reaches no server. platform_changes id 34.
--
-- This column is the single distinction that separates the two causes anyone actually
-- wants apart:
--   consent = 'granted' and no GA4 event  -> AD BLOCKER (or a capture regression)
--   consent = 'denied'  and no GA4 event  -> REFUSAL, working as designed
--   consent = 'undecided'                 -> the population item 17's analysis turns on,
--                                            currently invisible on both sides of the ratio
--
-- NOT A PRIVACY EXPANSION, and the reasoning is on the record rather than assumed. The row
-- already carries product, retailer, price, page, source and timestamp. Adding the banner
-- state introduces no new identifier, no third-party transmission and no new category of
-- data: it annotates an existing record with a fact about how it was collected, and is
-- strictly LESS information than the record it describes.
--
-- The disclosure that should always have covered this row lands in the same PR
-- (public/privacy.html section 2.2). See work-list item 83: the collection was never
-- disclosed, and this change made that visible rather than causing it.
--
-- NULLABLE AND NO DEFAULT, deliberately. Every row written before this deploy has an
-- UNKNOWN banner state, not an 'undecided' one, and back-filling a default would erase the
-- boundary between "we did not record this" and "the visitor had not answered". The 406
-- pre-existing rows stay NULL for exactly that reason.

ALTER TABLE public.outbound_clicks
  ADD COLUMN IF NOT EXISTS consent text;

ALTER TABLE public.outbound_clicks
  DROP CONSTRAINT IF EXISTS outbound_clicks_consent_check;

ALTER TABLE public.outbound_clicks
  ADD CONSTRAINT outbound_clicks_consent_check
  CHECK (consent IS NULL OR consent IN ('granted', 'denied', 'undecided'));

COMMENT ON COLUMN public.outbound_clicks.consent IS
  'Cookie-banner state when the click was recorded: granted, denied, undecided, or NULL '
  'for rows written before the field existed (13 Aug 2026). Read from localStorage '
  'fmb-cookie-consent client-side and sent on the beacon. Exists so a granted-but-no-GA4 '
  'click (ad blocker) is separable from a denied one (refusal) — see platform_changes '
  'id 34 and work-list item 81. NULL means unrecorded, NOT undecided.';

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE n_rows int; n_nonnull int; ok boolean;
BEGIN
  SELECT count(*), count(consent) INTO n_rows, n_nonnull FROM public.outbound_clicks;

  -- Nothing may be back-filled: the historical rows have an unknown state.
  IF n_nonnull <> 0 THEN
    RAISE EXCEPTION '% pre-existing rows have a consent value; they should all be NULL', n_nonnull;
  END IF;

  -- The CHECK must actually reject an unlisted value, so a typo in the route cannot
  -- write 'granted ' or 'true' and have it look like data.
  BEGIN
    INSERT INTO public.outbound_clicks (retailer_id, consent) VALUES (NULL, 'yes');
    ok := false;
  EXCEPTION WHEN check_violation THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'the consent CHECK accepted an invalid value';
  END IF;

  RAISE NOTICE 'outbound_clicks.consent added; % existing rows left NULL, CHECK verified', n_rows;
END $$;
