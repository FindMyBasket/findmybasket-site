-- Backfill C: House of Amor lash reclassify (refined rule) — skincare -> makeup/eyes/Lashes.
--
-- Backfill A (20260629200000) moved the HoA lashes whose names carry a lash word
-- (QuickLashes/Clusters/Multipack). It missed HoA's MAIN range, named
-- "<style> Length <C/D> Curl <mm> Short/Med/Long" (+ "Budget Box … Mini Bond",
-- "Bond & Seal", "Glue Strips", "… Collection", "Map It Out") — no generic lash
-- word. The refined rule (HoA-scoped length/curl/bond/collection tokens; lash
-- adhesives treated as lash) catches these. Frozen to the 45 ids from an
-- OLD(post-A)-vs-NEW dry-run (zero over-catch; 289/289 harness tests pass).
--
-- The 6 legitimately-separate HoA skincare rows are NOT here and stay put:
--   4023 cleanser, 4024 + 51858 removers, 51883 growth serum (lash-care -> skincare);
--   50718 "Make Up Brushes" (accessory) and 102139 "Press On Toe Nails" (nails) —
--   tracked as separate small gaps, not this fix.
--
-- Safety: guarded by top_category='skincare', explicit ids, idempotent,
-- transactional. Like A: tags=['makeup','eyes'], product_type='Lashes'.

begin;

update products set
  top_category='makeup', subcategory='eyes', product_type='Lashes', tags=array['makeup','eyes']
where top_category='skincare' and id = any(array[51856,51859,51861,51871,51874,51882,51893,51896,51897,51898,51899,51900,51901,51902,51903,51904,51905,51906,51907,51908,51909,51913,51914,51915,51916,51917,51918,51919,51920,51925,51926,51927,51931,51932,51935,51936,102126,102130,102131,102132,102133,102140,102141,102142,102143]::int[]);

commit;
