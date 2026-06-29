-- Backfill for the skincare rule fixes (lash detector + body-spray/pack subcategory).
--
-- Context (2026-06-29): two categoriser-rule gaps left products in /skincare:
--   1. the lash detector missed naming variants (singular "lash", one-word
--      "QuickLashes"/"Eyelashes", brand line-names cluster/pre-mapped/multipack);
--   2. "body spray" and "foot/hand pack" were not subcategory tokens, so those
--      products defaulted to subcategory='face'.
-- The rule fixes ship in _shared/categorisation.ts (same commit). This migration
-- reclassifies the EXISTING rows, frozen to the explicit ids the OLD-vs-NEW
-- dry-run identified (zero over-catch; the one lash-serum false positive, DHC
-- Eyelash Tonic 57171, was excluded by a tonic|essence guard and is NOT here).
--
-- Backfill A — 55 lash rows: skincare -> makeup/eyes/Lashes (like P1's lash
--   bucket). Includes 3 lash accessories (scissors/cleaning kit/storage case),
--   kept as Lashes per user ruling — consistent with P1 routing lash
--   applicators/curlers to Lashes; no accessory category exists.
-- Backfill B — 24 body-area rows: skincare/face -> bath_body/{body|hand|foot}
--   (like P2a). product_type PRESERVED; subcategory set to the correct area.
--   body 14 / foot 8 / hand 2.
--
-- Safety: every UPDATE guarded (A: top_category='skincare'; B: top_category=
--   'skincare' AND subcategory='face'), explicit ids only, idempotent,
--   transactional. Disjoint from P1/P2a. No genuine face skincare touched.

begin;

-- ── Backfill A: lash reclassify -> makeup/eyes/Lashes (55) ────────────────
update products set
  top_category='makeup', subcategory='eyes', product_type='Lashes', tags=array['makeup','eyes']
where top_category='skincare' and id = any(array[44874,47387,47393,47394,50430,50435,50639,50643,50670,50671,50672,51843,51844,51848,51849,51854,51857,51860,51862,51864,51865,51867,51868,51869,51873,51875,51876,51878,51884,51886,85530,94645,94836,94898,94973,95102,101018,102123,102124,102125,102127,102128,102134,102135,102136,102144,102145,103468,103469,103472,103473,103474,103475,103476,103477]::int[]);

-- ── Backfill B: body-area move -> bath_body/{area} (24; product_type kept) ─

-- body (14)
update products set
  top_category='bath_body', subcategory='body', tags=array['bath_body','body']
where top_category='skincare' and subcategory='face'
  and id = any(array[12028,13887,14378,15168,15228,15230,16001,16002,19308,19586,64092,101633,108559,109812]::int[]);

-- foot (8)
update products set
  top_category='bath_body', subcategory='foot', tags=array['bath_body','foot']
where top_category='skincare' and subcategory='face'
  and id = any(array[15985,15986,15987,15988,15989,56991,70578,110361]::int[]);

-- hand (2)
update products set
  top_category='bath_body', subcategory='hand', tags=array['bath_body','hand']
where top_category='skincare' and subcategory='face'
  and id = any(array[56992,57007]::int[]);

commit;
