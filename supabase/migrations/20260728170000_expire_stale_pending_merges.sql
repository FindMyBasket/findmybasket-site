-- Mark the stale 13 June merge batch as expired. Keeps the table, keeps every row.
--
-- pending_merges is two different things sharing one table, which is why it read
-- as ambiguous during the Tier 3 sweep (no reader anywhere, yet clearly not
-- scratch):
--
--   2,956 status='pending'                  a generated proposal batch, never reviewed
--     187 status='merged'                   \ an audit trail of merges actually
--      40 status='resolved_variant_linked'  / performed on the catalogue
--
-- All 3,183 rows were created on 2026-06-13.
--
-- THE 227 RESOLVED ROWS ARE KEPT REGARDLESS OF SIZE. They record what was done to
-- the live catalogue and which product IDs were folded into which keeper. That is
-- the only place that history exists in this shape. Do not "tidy" them.
--
-- WHY THE 2,956 ARE EXPIRED RATHER THAN LEFT PENDING
-- ===================================================
-- They were proposed against a catalogue that no longer exists. Since 13 June:
-- r12 (Superdrug) has been retired with 29,525 rows taken out of stock, roughly
-- 8,990 products have been rebranded by the brand canonicalisation work, and the
-- shade collapse programme has landed and changed parent/variant structure.
-- Acting on any of these proposals today would judge them against product state
-- that has moved underneath them: proposed_keeper_id and proposed_merge_ids may
-- point at products that are now merged, unparented, rebranded or out of stock.
--
-- Storage is NOT the argument. The whole table is 1.9 MB. The risk is purely that
-- "2,956 pending merges" reads as a backlog somebody ought to work through, and
-- working through it would apply stale judgements to the live catalogue.
--
-- IF DEDUP WORK RESUMES, REGENERATE. DO NOT RESUME THIS BATCH.
--
-- WHY THE UPDATE IS BOUNDED BY DATE, NOT JUST BY STATUS
-- =====================================================
-- `WHERE status = 'pending'` alone would be wrong here, for the reason set out in
-- README convention 3: a migration must reproduce a known state, not recompute
-- its scope at replay time. If dedup work resumes and a fresh batch is generated,
-- a replay of this migration on a PITR restore would silently expire that new
-- batch too, and the cause would be invisible. Bounding on created_at pins this
-- to the 13 June batch it was written for, permanently.
--
-- The column default stays 'pending', so a regenerated batch behaves normally.
--
-- REVERSIBLE: this is a status change, not a delete. Every row, every product_id
-- array and every proposed keeper survives. To undo:
--   UPDATE pending_merges SET status='pending'
--    WHERE status='expired' AND created_at < '2026-06-14';
--
-- reviewed_at is deliberately left NULL. Nobody reviewed these. Stamping it would
-- make an expiry look like a decision that was taken row by row.
--
-- IDEMPOTENT: the second run matches zero rows and the assertion still holds.

DO $$
DECLARE
  n_expired  int;
  n_left     int;
  n_resolved int;
BEGIN
  UPDATE public.pending_merges
     SET status = 'expired'
   WHERE status = 'pending'
     AND created_at < '2026-06-14'::timestamptz;
  GET DIAGNOSTICS n_expired = ROW_COUNT;

  -- Nothing from the 13 June batch may still read as actionable.
  SELECT count(*) INTO n_left
    FROM public.pending_merges
   WHERE status = 'pending' AND created_at < '2026-06-14'::timestamptz;
  IF n_left <> 0 THEN
    RAISE EXCEPTION 'expiry did not take: % rows from the 13 June batch still pending', n_left;
  END IF;

  -- The audit trail must be untouched. If this count moves, something expired
  -- rows that record real catalogue changes.
  SELECT count(*) INTO n_resolved
    FROM public.pending_merges
   WHERE status IN ('merged', 'resolved_variant_linked');
  IF n_resolved <> 227 THEN
    RAISE EXCEPTION
      'audit trail changed: expected 227 merged/variant-linked rows, found %. '
      'These record merges actually performed and must not be altered.', n_resolved;
  END IF;

  RAISE NOTICE 'expired % stale proposals; % audit rows intact', n_expired, n_resolved;
END
$$;

COMMENT ON TABLE public.pending_merges IS
  'Two things in one table. status IN (''merged'',''resolved_variant_linked'') is an AUDIT TRAIL of merges actually performed on the catalogue on 2026-06-13 - keep these permanently, regardless of table size. status=''expired'' is the 2,956-row proposal batch generated the same day and never reviewed; it was expired on 2026-07-28 because the catalogue has since had r12 retired, ~8,990 products rebranded and the shade collapse land, so its proposed_keeper_id and proposed_merge_ids may point at products that have been merged, unparented, rebranded or taken out of stock. DO NOT WORK THE EXPIRED ROWS. If dedup work resumes, regenerate a fresh batch rather than resuming this one.';

COMMENT ON COLUMN public.pending_merges.status IS
  'pending = actionable proposal. merged / resolved_variant_linked = audit trail, do not alter. expired = proposal superseded by catalogue drift, do not act on.';
