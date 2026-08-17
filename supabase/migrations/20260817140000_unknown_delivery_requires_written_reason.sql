-- APPLIED to production 2026-08-17 via MCP apply_migration; committed as the record.
-- A-prime: enforce the doctrine clause that had no enforcement. Work-list item 161.
--
-- docs/superdrug-removal-plan.md, "Before onboarding: delivery terms are a REQUIRED step",
-- point 3: "`unknown` IS A DELIBERATE CHOICE WITH A REASON, NEVER A DEFAULT. It is also
-- exactly what the pair looks like when nobody decided, and those two states are
-- INDISTINGUISHABLE IN THE DATABASE. Write the reason down at go-live or the distinction is
-- lost."
--
-- NOTHING CHECKED, so the distinction was lost by default: the deliberate choice and the
-- omission produce byte-identical rows. Niche Beauty went live 9 August at unknown with no
-- reason recorded anywhere, and nobody could tell afterwards whether it was decided or
-- overlooked. It was overlooked.
--
-- WHY NOT SIMPLY FORBID unknown ON AN ACTIVE RETAILER. The doctrine deliberately keeps it: a
-- retailer whose terms genuinely cannot be established is a real case, and forbidding it would
-- push that case into a WRONG value rather than an honest one. This keeps the choice available
-- and makes it cost a sentence.
--
-- AND THE COST OF unknown IS NOT WHAT THE DOCTRINE ORIGINALLY SAID. It claimed such a retailer
-- "cannot win a basket comparison on delivered cost". It can: deliveryFor returns
-- {known:false}, both callers keep the GOODS total, and RoutineBuilder:669 sorts it against
-- rivals' DELIVERED totals. Niche Beauty won 202 of 1,451 contested products that way.
-- THE COST FALLS ON THE CORRECTLY-RANKED RETAILERS. Items 158, 159, 161.

ALTER TABLE public.retailers
  ADD COLUMN IF NOT EXISTS delivery_terms_note text;

COMMENT ON COLUMN public.retailers.delivery_terms_note IS
  'WHY the delivery terms are what they are. REQUIRED by retailers_unknown_delivery_needs_reason '
  'whenever an ACTIVE retailer is not on a priced shape (tiered/flat) -- i.e. whenever we are '
  'shipping a retailer we cannot price. Optional otherwise, and useful for oddities on priced '
  'retailers too (multi-tier carriers, region-dependent charges, a threshold that moved). '
  'THE CONSTRAINT EXISTS BECAUSE A DELIBERATE `unknown` AND A FORGOTTEN ONE ARE BYTE-IDENTICAL '
  'ROWS. Nothing else in the schema can tell them apart, and the doctrine asks for the reason '
  'in prose where nothing reads it. Work-list item 161.';

ALTER TABLE public.retailers
  DROP CONSTRAINT IF EXISTS retailers_unknown_delivery_needs_reason;

-- NULL delivery_model is covered as well as the literal 'unknown'. They are the same state --
-- nobody established terms -- and leaving NULL out would make the constraint trivially
-- avoidable by clearing the column instead of setting it.
--
-- The 20-character floor is not arbitrary and is not security: it is the shortest thing that
-- can be a sentence. "x" satisfies NOT NULL and records nothing, which would reproduce the
-- defect one layer up -- a field that looks like a reason and is not. The shortest real reason
-- anyone would write ("we looked and could not establish them") is 38.
ALTER TABLE public.retailers
  ADD CONSTRAINT retailers_unknown_delivery_needs_reason CHECK (
    NOT (COALESCE(active, false) AND COALESCE(delivery_model, 'unknown') NOT IN ('tiered', 'flat'))
    OR (delivery_terms_note IS NOT NULL AND length(btrim(delivery_terms_note)) >= 20)
  );

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.retailers
   WHERE COALESCE(active,false) AND COALESCE(delivery_model,'unknown') NOT IN ('tiered','flat');
  IF n <> 0 THEN RAISE EXCEPTION 'ants: % active retailer(s) not on a priced shape', n; END IF;

  BEGIN
    INSERT INTO public.retailers (id, name, active, delivery_model)
    VALUES (-997, 'probe', true, 'unknown');
    RAISE EXCEPTION 'constraint did NOT refuse an active unknown retailer with no reason';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN not_null_violation THEN NULL;
    WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.retailers (id, name, active, delivery_model, delivery_terms_note)
    VALUES (-996, 'probe', true, 'unknown', 'x');
    RAISE EXCEPTION 'constraint accepted a one-character reason';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN not_null_violation THEN NULL;
    WHEN foreign_key_violation THEN NULL;
  END;

  SELECT count(*) INTO n FROM public.retailers WHERE id IN (-996, -997);
  IF n <> 0 THEN RAISE EXCEPTION 'probe row leaked'; END IF;
END $$;

-- MEASURED BEFORE APPLYING: 18 retailers, 11 active, ZERO at unknown or NULL on either side of
-- the active flag, so the constraint validated with nothing to fix.
--
-- IT DOES NOTHING TO THE TEN NULL delivery_terms_source ROWS (item 160), and the two must not
-- be conflated: that gap is a different column and a different condition. This constraint bites
-- only when an ACTIVE retailer is not on a priced shape, which is currently nobody.
