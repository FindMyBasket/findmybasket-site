-- P1: Skincare catch-all cleanup — reclassify misclassified non-skincare rows.
--
-- Diagnosis (2026-06-29): the categoriser's skincare catch-all
-- (top_category='skincare', product_type='Skincare') had absorbed non-skincare
-- items that no makeup/hair rule matched. This is pre-existing data debt (rows
-- created May–Jun), NOT caused by the bath_body go-live or backfill.
--
-- Targets were produced by a reviewed dry-run (name-pattern rules over the
-- catch-all, plus a small typed addendum), then FROZEN to explicit ids so only
-- the reviewed set is touched. 338 rows: 217 reclassified + 121 excluded.
--
-- Rulings applied (user, 2026-06-29):
--   * 2 lash-GLUE removers LEFT in skincare (consistent with makeup-remover ruling);
--   * 4 multi-item bath gift sets EXCLUDED (cleanup_remove) as bath_set, not moved;
--   * accessories (shower caps / bags / powder puffs) EXCLUDED (cleanup_remove) —
--     no accessory category exists, so they are removed from the catalogue, not
--     recategorised;
--   * false positives left untouched and NOT in any set below: NUDESTIX "Mineral
--     Veil SPF30" (a real sunscreen) and Max Factor "False Lash Effect Lash Serum".
--
-- Safety:
--   * every reclassify UPDATE is guarded by `top_category='skincare'`, so a row
--     that has since changed category is skipped, not clobbered;
--   * ids are explicit (no name predicate at apply time) — exactly the reviewed
--     set is touched;
--   * disjoint from the P2a area move (0 of these ids are in body/hand/foot);
--   * tags follow the data contract: reclassified -> [top_category, subcategory].
--
-- Idempotent: reclassify UPDATEs no-op once top_category<>'skincare'; the exclude
-- UPDATE is guarded against re-appending cleanup_remove. Wrapped in a transaction.

begin;

-- ── Reclassify -> makeup ─────────────────────────────────────────────────

-- Colour-correcting palettes -> makeup/face/Concealer (5)
update products set
  top_category='makeup', subcategory='face', product_type='Concealer', tags=array['makeup','face']
where top_category='skincare' and id = any(array[26246,52106,80814,98147,105817]::int[]);

-- Finishing / setting / blotting powders, "Skinfinish", "Mineral Veil" -> makeup/face/Setting (36)
update products set
  top_category='makeup', subcategory='face', product_type='Setting', tags=array['makeup','face']
where top_category='skincare' and id = any(array[37851,48448,55558,55559,55560,56883,56884,56885,84580,86584,86585,86586,86587,86621,86622,86628,86629,86630,86631,86632,86633,86634,86635,86636,86637,86638,86639,95568,104075,104076,104202,104839,106147,106251,109702,110733]::int[]);

-- False lashes / lash clusters + lash curlers -> makeup/eyes/Lashes (62)
update products set
  top_category='makeup', subcategory='eyes', product_type='Lashes', tags=array['makeup','eyes']
where top_category='skincare' and id = any(array[19985,32913,34472,34863,34864,39430,39431,40734,40898,42207,42716,43230,44725,44739,44794,44875,45243,46900,46901,47763,47788,47880,49205,49206,50333,50334,50335,50336,50337,50431,50432,50433,50434,50615,50635,50637,50640,50649,50694,64964,81030,85425,88841,88860,88861,88867,89733,97361,99381,102138,102180,102181,102182,102183,102184,102185,102186,102753,103862,110055,46189,51654]::int[]);

-- Press-on / false nails -> makeup/nails/False Nails (99)
update products set
  top_category='makeup', subcategory='nails', product_type='False Nails', tags=array['makeup','nails']
where top_category='skincare' and id = any(array[30939,34281,34408,35213,35215,36909,36910,38293,38294,38295,38296,38297,38298,38299,38300,38301,38302,38676,38677,38678,38679,38680,38681,38682,38683,38684,38685,39115,39116,39117,39118,39119,39120,39121,39122,39123,39124,39126,46005,46006,46007,46008,46009,46010,50678,50679,50680,50681,50682,50683,50684,50685,51193,51194,51195,51196,51426,51866,51870,51872,51877,51879,51880,51881,51887,52389,53272,62187,63716,64685,64686,64687,64688,64689,64690,64691,64692,64693,64936,64937,64938,64940,64941,100151,100152,102137,103576,104054,104055,104056,106806,110550,110915,35350,64939,104051,104052,104053,39125]::int[]);

-- ── Reclassify -> hair ───────────────────────────────────────────────────

-- Hair brushes / hot brushes / styling tools -> hair/style/Hair Styling (15)
update products set
  top_category='hair', subcategory='style', product_type='Hair Styling', tags=array['hair','style']
where top_category='skincare' and id = any(array[18418,19004,35140,86219,88999,89856,96124,97716,97717,98087,101085,101087,101090,103417,104673]::int[]);

-- ── Exclude from catalogue (cleanup_remove) ──────────────────────────────
-- Accessories (shower caps, make-up/cosmetic/wash bags, powder puffs) + 4 bath
-- gift sets. No category fits; remove from all listings via cleanup_remove. (121)
update products set
  tags = array_append(tags, 'cleanup_remove')
where top_category='skincare'
  and not (tags @> array['cleanup_remove'])
  and id = any(array[8085,17238,17854,17855,22758,23875,24731,26950,27053,27311,28158,30677,30678,31881,32241,32636,32912,40280,42933,43519,43918,44042,44043,44044,44045,44046,44047,44048,44049,44050,44051,44052,44292,45760,45762,45796,45797,45798,45799,47882,47917,47928,47929,48425,48784,49228,50930,50968,51390,51486,51647,51662,51755,51759,51762,51765,51767,51775,51778,51780,51783,51885,51997,52559,52560,52562,52879,52882,53769,53835,53836,63166,64559,64884,65574,65575,66130,66760,68595,68601,70591,70817,80522,82236,83204,83860,87015,87185,87385,87896,88600,90195,95903,101671,101672,101676,101838,102157,102158,102159,102161,102425,102861,103606,103924,104694,105964,106040,106198,106456,108985,110148,111532,111533,111534,111535,111536,111537,111538,111539,111545]::int[]);

commit;
