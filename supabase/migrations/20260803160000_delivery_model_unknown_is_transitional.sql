-- delivery_model = 'unknown' is a TRANSITIONAL state, and this makes that a policy
-- rather than a hope.
--
-- WHY. As of 3 August 2026 the optimiser branches on delivery_model. A retailer with
-- 'unknown' terms keeps its goods visible but is never presented as best value against
-- a retailer whose delivered total IS known, because those two numbers are not
-- comparable. That is the right behaviour for a retailer mid-onboarding. It is the
-- WRONG behaviour to leave in place indefinitely: a retailer permanently at 'unknown'
-- is inventory the optimiser quietly refuses to recommend, and nothing would say so.
--
-- Silently dropping live inventory from comparison is the exact failure class this
-- project spent a fortnight finding. This makes the state visible instead.
--
-- NOT A CONSTRAINT. A CHECK forbidding 'unknown' would break the legitimate case:
-- a retailer row created before its delivery terms are read from the merchant's site.
-- The Fragrance Shop (approved 3 Aug, parked behind Niche Beauty) will pass through
-- exactly this state, and that transition is the intended live exercise of the branch.
-- What is wrong is not entering the state; it is STAYING in it.
--
-- WHAT THIS DOES. A view the 09:00 monitor can read, plus a function that reports how
-- long each active retailer has been unknown. Zero rows today by construction, because
-- no active retailer is 'unknown'. That is expected, and it is why this is a watch
-- rather than an alert with a body.

CREATE OR REPLACE VIEW public.retailers_delivery_unknown AS
SELECT
  r.id                                   AS retailer_id,
  r.name,
  r.delivery_model,
  r.delivery_threshold,
  r.delivery_cost,
  r.delivery_terms_observed_at,
  -- Age of the TERMS, not of the row. `retailers` has no created_at, and terms age is
  -- the more useful signal anyway: a long-standing retailer whose terms were never
  -- observed is a worse state than a new one whose terms are pending.
  CASE WHEN r.delivery_terms_observed_at IS NULL THEN NULL
       ELSE (EXTRACT(EPOCH FROM (now() - r.delivery_terms_observed_at)) / 86400.0)::numeric(10,1)
  END                                    AS days_since_terms_observed
FROM public.retailers r
WHERE r.active = true
  AND (r.delivery_model IS NULL OR r.delivery_model NOT IN ('tiered', 'flat'));

COMMENT ON VIEW public.retailers_delivery_unknown IS
  'Active retailers whose delivery terms are unrecorded, so the optimiser will not rank '
  'them on delivered total. Expected to be EMPTY. A row here is live inventory being '
  'quietly excluded from best-value comparison. Legitimate only while a newly onboarded '
  'retailer has its terms read from source; see work-list item 11 and the delivery rule '
  'in supabase/functions/_shared/delivery.ts.';

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE
  n_unknown int;
  n_active  int;
  n_flat    int;
  n_tiered  int;
BEGIN
  SELECT count(*) INTO n_unknown FROM public.retailers_delivery_unknown;
  SELECT count(*) INTO n_active  FROM public.retailers WHERE active;
  SELECT count(*) INTO n_flat    FROM public.retailers WHERE active AND delivery_model = 'flat';
  SELECT count(*) INTO n_tiered  FROM public.retailers WHERE active AND delivery_model = 'tiered';

  -- The view must be readable and must classify every active retailer. If these do not
  -- add up, the view's predicate disagrees with the code's, and the code is the half
  -- that decides what a user sees.
  IF n_tiered + n_flat + n_unknown <> n_active THEN
    RAISE EXCEPTION
      'delivery_model classification does not partition active retailers: tiered % + flat % + unknown % <> active %',
      n_tiered, n_flat, n_unknown, n_active;
  END IF;

  -- Today this must be zero. If it is not, the optimiser is already excluding somebody.
  IF n_unknown <> 0 THEN
    RAISE WARNING 'ATTENTION: % active retailer(s) have unrecorded delivery terms and are being excluded from delivered-total ranking', n_unknown;
  END IF;

  RAISE NOTICE 'OK: % active retailers, % tiered, % flat, % unknown', n_active, n_tiered, n_flat, n_unknown;
END
$$;
