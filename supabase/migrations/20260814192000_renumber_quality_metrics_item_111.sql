-- Applied to production 2026-08-14 via MCP apply_migration; committed as the record.
-- Verified after apply: zero comments cite item 110, exactly two cite item 111.
--
-- Two COMMENTs cited "work-list item 110". A 110 already existed (the /app supplements
-- gap); the quality-metrics item is 111. A stale item citation in a COMMENT points a
-- future reader at the wrong item and carries nothing to indicate it.

COMMENT ON COLUMN public.metrics_quality_weekly.suspect_price_threshold IS
  'Fraction of the product peer median below which a live in-stock row is flagged. Set to '
  '0.50 on 14 Aug 2026, derived from three real defects rather than chosen for roundness: '
  'at 0.35 the rule catches one of the three, at 0.50 it catches two. This is a REVIEW '
  'QUEUE a human works, not an alert stream, so manageable volume is not the constraint. '
  'Work-list item 111.';

COMMENT ON FUNCTION public.fmb_quality_snapshot_write(date, numeric) IS
  'Writes one row of metrics_quality_weekly. THE NINE DEFINITIONS LIVE HERE AND NOWHERE '
  'ELSE, so there is exactly one place a meaning can change. Idempotent per week_start. '
  'Threshold is a parameter and is stored in the row it writes. Work-list item 111.';
