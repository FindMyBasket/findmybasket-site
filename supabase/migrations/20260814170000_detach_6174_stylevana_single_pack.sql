-- APPLIED to production 2026-08-14 via MCP apply_migration. Committed as the record.
-- Verified after apply: row 143613 gone, snapshot holds 1 row, 6174 has 8 active rows /
-- 7 in stock, best price £11.20 (Gorgeous Shop), 982 and 93127 both untouched.
--
-- Detach Stylevana's single-mask row from product 6174.
--
-- WHAT IS WRONG. Product 6174 is "Medicube PDRN Pink Collagen Gel Mask 4pk", carried by
-- nine active retailers at £11.20-£18.00 for four masks. Stylevana's row on it,
-- retailer_prices.id 143613, external_product_id 68593, is a listing for ONE mask at
-- £5.90 — url .../deal-medicube-pdrn-pink-collagen-gel-mask-28g.html.
--
-- It is the headline price. The page promises four and the clickout delivers one.
-- ONE OUTBOUND CLICK HAS ALREADY GONE THROUGH IT.
--
-- HOW IT GOT THERE. The row carries NO ean and NO mpn, so it cannot have matched on a
-- barcode. It matched on name or URL. Stylevana lists this product three times and we
-- have placed the three listings on three different products:
--     46269  single           -> 982    (correct)
--     68593  "deal-…-28g"     -> 6174   (THIS ROW, wrong)
--     84491  "…-28g-4ea"      -> 93127  (correct)
-- 68593 is a promotional duplicate of 46269, and 46269 already sits correctly on 982.
--
-- ATELIER DE GLOW'S ROW IS DELIBERATELY NOT TOUCHED. It is also a single (url says
-- "28g x 1 sheet") but it matched on ean 8800256114399 — the genuine 4-pack barcode,
-- which Atelier has assigned to a single-sheet variant in their own feed. Tier 1 did
-- exactly what it should with the data given. Detaching it would treat a retailer's
-- data defect as ours, and any rule that fixes it is a rule that distrusts a barcode —
-- far too large a change to make on the evidence of one row. Recorded, not actioned.

BEGIN;

-- 1. SNAPSHOT (rollback). The whole row, not just the ids.
CREATE TABLE IF NOT EXISTS fmb_rp_detach_snapshot_20260814 AS
SELECT *, now() AS snapshot_at FROM retailer_prices WHERE id = 143613;

-- 2. THE DETACH. Every identifying column is in the predicate, so if the row has moved
--    or been re-matched since this was written, the statement removes NOTHING rather
--    than removing something else.
DELETE FROM retailer_prices
WHERE id = 143613
  AND product_id = 6174
  AND retailer_id = 11
  AND external_product_id = '68593';

-- 3. VERIFY. Assert the intended effect and nothing beyond it.
DO $$
DECLARE n_snap int; n_left int; best numeric; n_active int;
BEGIN
  SELECT count(*) INTO n_snap FROM fmb_rp_detach_snapshot_20260814;
  IF n_snap <> 1 THEN RAISE EXCEPTION 'snapshot holds % rows, expected 1', n_snap; END IF;

  SELECT count(*) INTO n_left FROM retailer_prices WHERE id = 143613;
  IF n_left <> 0 THEN RAISE EXCEPTION 'row 143613 still present — the guard did not match'; END IF;

  SELECT count(*), min(rp.price) INTO n_active, best
    FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id
   WHERE rp.product_id = 6174 AND r.active AND rp.in_stock;

  IF n_active <> 7 THEN RAISE EXCEPTION '6174 has % in-stock active rows, expected 7', n_active; END IF;
  IF best <> 11.20 THEN RAISE EXCEPTION '6174 best price is %, expected 11.20', best; END IF;

  -- 982 must be untouched: it is where the equivalent single correctly sits.
  IF (SELECT count(*) FROM retailer_prices WHERE product_id = 982 AND retailer_id = 11) <> 1 THEN
    RAISE EXCEPTION '982 lost or gained a Stylevana row; it should be untouched';
  END IF;

  RAISE NOTICE '6174: row 143613 detached, % in-stock rows remain, best price now %', n_active, best;
END $$;

COMMIT;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────────
-- INSERT INTO retailer_prices
--   SELECT id, product_id, retailer_id, price, url, in_stock, last_updated,
--          external_product_id, external_handle, ean, mpn, ean_normalised, mpn_normalised
--     FROM fmb_rp_detach_snapshot_20260814;
-- DROP TABLE fmb_rp_detach_snapshot_20260814;
--
-- The UNIQUE (product_id, retailer_id) constraint means the rollback only succeeds while
-- no other Stylevana row has been created on 6174 in the meantime — which is exactly the
-- regression this change is exposed to. See below.

-- ── THE DURABILITY PROBLEM, WHICH IS NOT SOLVED HERE ────────────────────────────
--
-- THIS DELETE IS NOT DURABLE AND THE NEXT IMPORT MAY UNDO IT. Stylevana runs at 03:30.
-- Tier 0 matches on external_product_id; with the row gone, 68593 has no tier-0 target,
-- carries no barcode and no mpn, and falls through to the same name/URL match that put
-- it on 6174 in the first place. THE DEFECT CAN RETURN WITHIN ONE CYCLE.
--
-- Repointing the row to 982 instead of deleting it would be durable — tier 0 would find
-- it and keep it there — but retailer_prices carries UNIQUE (product_id, retailer_id)
-- and 982 already holds Stylevana's row 46269. The correct target is occupied.
--
-- So the options are:
--   (a) delete, and re-check after 03:30 — restores the price today, may regress;
--   (b) delete 46269 as well and repoint 68593 to 982 — durable, but deletes a
--       legitimate canonical listing to make room for a promotional duplicate;
--   (c) a name_excludes entry for Stylevana that drops the "deal-" duplicate at import.
--       retailer_import_config.name_excludes ALREADY carries pack-variant strings —
--       "(2ea) set", "(4ea) set", "(6ea) set" — so the mechanism and the precedent exist.
--       IT NEEDS THE FEED'S ACTUAL PRODUCT NAME, which is not stored on the row; only
--       the URL slug is. Excluding on "deal" alone would drop every Stylevana promotional
--       listing, including legitimately discounted products.
--
-- (a) is proposed here because it is reversible and stops a live mispricing today.
-- (c) is the durable fix and needs one fact this database does not hold.
