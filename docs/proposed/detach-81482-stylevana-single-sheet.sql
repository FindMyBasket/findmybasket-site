-- ============================================================================
-- NOT APPLIED, AND DELIBERATELY SO. DO NOT RUN THIS AS IT STANDS.
--
-- Held 14 August 2026. It is filed HERE and not in supabase/migrations/ precisely so
-- that no migration runner picks it up. Running it today buys one day's reprieve on a
-- page with zero clicks and is reversed by tier 1 at 03:30 tomorrow.
--
-- IT BECOMES THE RIGHT ACTION ONCE SOMETHING STOPS THE REMATCH, and it exists to
-- document what that something has to do: prevent a valid, retailer-supplied barcode
-- from re-attaching a single-unit listing to a multi-pack product. See work-list
-- items 107 and 108.
-- ============================================================================

-- Detach Stylevana's single-sheet row from product 81482.
--
-- WHAT IS WRONG. 81482 is "ETUDE - Moistfull Collagen Deep Sheet Mask Bundle Set
-- 37ml x 5 sheets". It has TWO rows and the cheaper one is a SINGLE SHEET:
--
--   Stylevana  £1.69   id 174546, ext 68454, url .../deal-...-deep-sheet-mask-1pc.html
--   YesStyle   £16.39  last confirmed 1 JULY 2026
--
-- The page promises five sheets and the headline price buys one, 90% below the real
-- price. Same live harm as product 6174 this morning.
--
-- THE CAUSE IS THE RETAILER'S, NOT OURS, AND THE 6174 PRECEDENT STILL DOES NOT TRANSFER.
-- Both rows carry the SAME barcode 8809668018110, so this matched on TIER 1 — Stylevana
-- has assigned the five-pack's EAN to a single-sheet listing, exactly as Atelier De Glow
-- did on 6174. Atelier's row was deliberately left alone. The difference is consequence,
-- not cause: Atelier's was £14 and eighth of nine, invisible in the comparison. THIS ONE
-- IS THE HEADLINE PRICE ON A TWO-ROW PAGE.
--
-- Stylevana also lists the single CORRECTLY, as product 147989 ("Moistfull Collagen Deep
-- Sheet Mask - 1pc", ext 44398, £1.72) — carrying the same barcode a third time. So the
-- row removed here is a duplicate of a listing that already sits in the right place.
--
-- THE FALLBACK IS STALE AND THAT IS AN ACCEPTED TRADE, NOT AN OVERSIGHT.
-- After this, 81482 shows £16.39 from a YesStyle row last confirmed 1 July — 44 days.
-- YesStyle's absence_threshold_days is 9999 (item 53), so its rows never age out and this
-- one still reads in stock. £16.39 for five sheets is plausible against £1.72 for one.
--
--   A STALE-BUT-RIGHT PRICE BEATS A FRESH-BUT-WRONG ONE WHEN THE WRONG ONE IS WHAT A
--   VISITOR CLICKS.
--
-- Recorded so nobody later reads the unconfirmed price as an accident.
--
-- No clicks have gone through this row (outbound_clicks = 0 for 81482), unlike 6174.

BEGIN;

-- 1. SNAPSHOT (rollback). The whole row.
CREATE TABLE IF NOT EXISTS fmb_rp_detach_snapshot_81482_20260814 AS
SELECT *, now() AS snapshot_at FROM retailer_prices WHERE id = 174546;

-- 2. THE DETACH. Every identifying column is in the predicate, so a row that has moved
--    since this was written is not touched.
DELETE FROM retailer_prices
WHERE id = 174546
  AND product_id = 81482
  AND retailer_id = 11
  AND external_product_id = '68454';

-- 3. VERIFY.
DO $$
DECLARE n_snap int; n_left int; n_rows int; best numeric;
BEGIN
  SELECT count(*) INTO n_snap FROM fmb_rp_detach_snapshot_81482_20260814;
  IF n_snap <> 1 THEN RAISE EXCEPTION 'snapshot holds % rows, expected 1', n_snap; END IF;

  SELECT count(*) INTO n_left FROM retailer_prices WHERE id = 174546;
  IF n_left <> 0 THEN RAISE EXCEPTION 'row 174546 still present - the guard did not match'; END IF;

  SELECT count(*), min(rp.price) INTO n_rows, best
    FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id
   WHERE rp.product_id = 81482 AND r.active AND rp.in_stock;
  IF n_rows <> 1 THEN RAISE EXCEPTION '81482 has % in-stock rows, expected 1', n_rows; END IF;
  IF best <> 16.39 THEN RAISE EXCEPTION '81482 best price is %, expected 16.39', best; END IF;

  -- 147989 holds the single correctly and must be untouched.
  IF (SELECT count(*) FROM retailer_prices WHERE product_id = 147989 AND retailer_id = 11) <> 1 THEN
    RAISE EXCEPTION '147989 lost or gained a Stylevana row; it should be untouched';
  END IF;

  -- 81482 must survive in the catalogue on its one remaining row.
  IF (SELECT count(*) FROM products_active WHERE id = 81482) <> 1 THEN
    RAISE EXCEPTION '81482 left products_active; it should still have a live row';
  END IF;

  RAISE NOTICE '81482: row 174546 detached, % in-stock row remains, best price now %', n_rows, best;
END $$;

COMMIT;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────────
-- INSERT INTO retailer_prices
--   SELECT id, product_id, retailer_id, price, url, in_stock, last_updated,
--          external_product_id, external_handle, ean, mpn, ean_normalised, mpn_normalised
--     FROM fmb_rp_detach_snapshot_81482_20260814;
-- DROP TABLE fmb_rp_detach_snapshot_81482_20260814;

-- ── DURABILITY: WORSE THAN 6174'S, AND FOR A DIFFERENT REASON ───────────────────
--
-- 6174's row carried no barcode, so its return depended on a name match. THIS ROW CARRIES
-- A VALID BARCODE THAT THE PRODUCT ALSO CARRIES. On the next Stylevana import (03:30),
-- tier 0 will not find ext 68454, and TIER 1 WILL MATCH IT STRAIGHT BACK ONTO 81482 —
-- correctly, by the rules, on a barcode the retailer supplied.
--
-- SO THIS DETACH IS EXPECTED TO REVERSE ITSELF WITHIN ONE CYCLE, and it is being applied
-- knowing that. The durable fix is not here: it is item 107's discriminator, which already
-- identifies this row correctly and has nothing consuming its output.
