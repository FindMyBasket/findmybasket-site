-- ===========================================================================
-- Dashboard schema: eleven tables. Step 3 of the dashboard build brief v3,
-- approved 2026-07-28 after the Step 2 and Step 7 reports.
--
-- ELEVEN, not the ten the brief's section 9 announces: that section names ten
-- and then lists eleven, because platform_changes appears both in the list and
-- as a separate requirement in section 4. Built as listed.
--
-- Prerequisite (brief 2.1): the ALTER DEFAULT PRIVILEGES fix landed 2026-07-28
-- as 5dafe2b / PR #137. Verified before writing this: the public default ACL for
-- grantor postgres is now
--   tables    {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--   sequences {postgres=rwU/postgres,service_role=rwU/postgres}
-- so anon and authenticated are absent. New tables are born closed.
--
-- The REVOKEs below are therefore expected to be no-ops today. They are kept
-- because the brief requires revoke-before-grant, because the supabase_admin
-- default ACL could not be changed and still grants broadly, and because a
-- migration must not depend on ambient state it did not set. See
-- supabase/migrations/README.md conventions 1 and 4.
--
-- No GRANT to anon or authenticated appears anywhere in this file. Every table
-- here is internal: commission, tracked sales and per-retailer conversion.
-- Brief 2.2 requires the dashboard route to be authenticated and to return no
-- data unauthenticated, and the route reads server-side via service_role using
-- the existing lib/supabase.ts client. Nothing here should ever be reachable
-- with the public anon key.
-- ===========================================================================

-- --- 1. GA4 weekly -------------------------------------------------------
-- Nullable ints throughout, per brief 4.1: NULL means "not measured", zero
-- means "measured and found none". Writing zero for pre-registration weeks
-- would record a measurement never taken, and the distinction is unrecoverable.
CREATE TABLE IF NOT EXISTS public.metrics_ga4_weekly (
  week_start                date PRIMARY KEY,
  sessions                  integer,
  qualified_sessions        integer,
  comparison_views          integer,
  outbound_clicks_awin      integer,
  outbound_clicks_rakuten   integer,
  outbound_clicks_amazon    integer,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.metrics_ga4_weekly IS
  'Weekly GA4 rollup. NULL = not measured, 0 = measured as none. The by-network columns are NULL before the custom-dimension registration date (established empirically in Step 4), so they will not sum to total outbound clicks for those weeks. Outbound clicks come from retailer_click ONLY; affiliate_clickout fires on the same action and must never be added.';

-- --- 2. AWIN weekly ------------------------------------------------------
-- status is in the PK: AWIN commission validates over weeks, so pending and
-- confirmed for the same advertiser/week must coexist rather than overwrite.
CREATE TABLE IF NOT EXISTS public.metrics_awin_weekly (
  week_start   date        NOT NULL,
  advertiser   text        NOT NULL,
  clicks       integer,
  sales        integer,
  commission   numeric(12,2),
  status       text        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, advertiser, status)
);

-- --- 3. Rakuten weekly ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metrics_rakuten_weekly (
  week_start   date        NOT NULL,
  advertiser   text        NOT NULL,
  clicks       integer,
  sales        integer,
  commission   numeric(12,2),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, advertiser)
);

-- --- 4. Amazon monthly ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metrics_amazon_monthly (
  month_start    date PRIMARY KEY,
  clicks         integer,
  ordered_items  integer,
  shipped_items  integer,
  commission     numeric(12,2),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- --- 5. Social weekly ----------------------------------------------------
-- Channel-pluggable by design (brief 10, Step 15): a new channel is a new
-- writer against this table, never a schema change.
CREATE TABLE IF NOT EXISTS public.metrics_social_weekly (
  week_start       date        NOT NULL,
  channel          text        NOT NULL,
  impressions      integer,
  outbound_clicks  integer,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, channel)
);

-- --- 6. Quality weekly ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metrics_quality_weekly (
  week_start            date PRIMARY KEY,
  suspect_price_count   integer,
  placeholder_ean_count integer,
  null_ean_product_pct  numeric(5,2),
  unmatched_row_rate    numeric(5,2),
  bad_price_count       integer,
  ean_coverage_pct      numeric(5,2),
  comparison_depth_pct  numeric(5,2),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.metrics_quality_weekly IS
  'Weekly data-quality rollup. Catalogue, comparison-depth and savings metrics read retailer_prices_live (active retailers only). comparison_depth_pct is root products (merged_into IS NULL AND parent_product_id IS NULL), in stock, 2+ distinct retailers, over root in-stock products. Store the definition, not a target: today''s figure is a sanity check within 10%, never an acceptance threshold.';

-- --- 7. Per-retailer quality weekly --------------------------------------
-- Keyed on retailer_id with the name DENORMALISED alongside, never keyed on
-- name. Name-keyed logic is what let the Superdrug suppression survive in
-- RoutineBuilder, and a rename would silently split the historical series.
CREATE TABLE IF NOT EXISTS public.metrics_retailer_quality_weekly (
  week_start                 date    NOT NULL,
  retailer_id                integer NOT NULL,
  retailer_name              text,
  last_import_at             timestamptz,
  last_attempt_at            timestamptz,
  -- NOT the boolean cron_window_missed the brief's section 9 specified. A
  -- boolean collapses three genuinely different failures into one bit, and the
  -- whole reason this column exists is that the 23 July Boots outage was
  -- invisible to a detector that could not tell them apart.
  cron_window_state          text,
  imported_rows              integer,
  unmatched_rows             integer,
  skipped_multipack_mismatch integer,
  multipack_name_unresolved  integer,
  clicks                     integer,
  sales                      integer,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, retailer_id),
  CONSTRAINT metrics_retailer_quality_cron_state_chk CHECK (
    cron_window_state IS NULL OR cron_window_state IN (
      'ok',
      'trigger_never_fired',
      'trigger_fired_import_never_began',
      'import_started_failed',
      'unknown'
    ))
);
COMMENT ON COLUMN public.metrics_retailer_quality_weekly.cron_window_state IS
  $c$Three-state, deliberately NOT the boolean cron_window_missed the brief specified.

DO NOT compute this from import_run_state. That table is a transient scratchpad,
not a run history: the importer deletes its own rows on successful completion
(import-awin-feed/index.ts:2459, and 18,167 inserts against 18,167 deletes with 0
rows resident). A successful run leaves no row AND a never-started run leaves no
row, so "does a row exist for this slot" cannot tell them apart. DO NOT compute it
from the watchdog either: the watchdog detects STALLED runs, not runs that never
began, which is exactly the 23 July nginx 502 Boots failure it must catch.

Compute from the pg_cron schedule (cron.job) plus cron.job_run_details plus
retailer_import_config:
  ok                               last_imported_at advanced past the slot
  trigger_never_fired              no cron.job_run_details row for that jobid/slot
  trigger_fired_import_never_began job_run_details row exists, but last_attempt_at
                                   did not advance -> the 23 July failure mode
  import_started_failed            last_attempt_at advanced, last_imported_at did
                                   not; see last_import_status / last_import_error
  unknown                          slot predates cron.job_run_details retention
                                   (~3 months); NOT a miss, absence of evidence

Keep the states distinct. Collapsing them to a boolean throws away the only
signal that separates a dead trigger from a dead function.$c$;

-- --- 8. Review queue -----------------------------------------------------
-- KEY CHOICE, evidence in the Step 7 report: keyed on (product_id, retailer_id)
-- rather than retailer_price_id.
--
-- retailer_prices.id IS stable across import cycles: every importer write path
-- is INSERT ... ON CONFLICT (product_id, retailer_id) DO UPDATE, against a real
-- UNIQUE constraint, with no delete-and-reinsert. But MERGES delete rows
-- (fmb_soft_merge_group, reclaim_stranded_merged_prices both DELETE FROM
-- retailer_prices), so a flagged id can vanish when its product is merged into
-- a keeper. Merges ran at 473-1,466/week through June.
--
-- retailer_price_id is kept as a drill-through reference, deliberately WITHOUT a
-- foreign key. A cascading FK would let a merge silently destroy reviewed
-- history, which is the one thing in this table that cannot be regenerated.
CREATE TABLE IF NOT EXISTS public.review_queue (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flagged_at          timestamptz NOT NULL DEFAULT now(),
  week_start          date        NOT NULL,
  reason              text        NOT NULL,
  retailer_price_id   integer,
  product_id          integer     NOT NULL,
  retailer_id         integer     NOT NULL,
  row_price           numeric(12,2),
  peer_median         numeric(12,2),
  price_ratio         numeric(6,3),
  row_ean             text,
  matched_product_ean text,
  state               text        NOT NULL DEFAULT 'unreviewed',
  reviewed_at         timestamptz,
  note                text,
  CONSTRAINT review_queue_state_chk
    CHECK (state IN ('unreviewed','confirmed_bug','confirmed_discount','dismissed')),
  CONSTRAINT review_queue_uniq UNIQUE (product_id, retailer_id, reason, week_start)
);
COMMENT ON COLUMN public.review_queue.retailer_price_id IS
  $c$Drill-through reference only. DELIBERATELY HAS NO FOREIGN KEY - do not add one,
for tidiness or otherwise.

retailer_prices.id is stable across IMPORT cycles: every importer write path is
INSERT ... ON CONFLICT (product_id, retailer_id) DO UPDATE against a real UNIQUE
constraint, with no delete-and-reinsert anywhere. But MERGES delete rows
(fmb_soft_merge_group and reclaim_stranded_merged_prices both DELETE FROM
retailer_prices), and merges ran at 473-1,466 per week through June 2026.

So this id can vanish under ordinary catalogue maintenance. With ON DELETE CASCADE
a routine merge would silently delete reviewed rows; with ON DELETE RESTRICT it
would block the merge instead. Reviewed state is the one thing in this table that
cannot be regenerated - the weekly puller can re-flag any row, but it cannot
re-derive a human judgement. A dangling id here is the correct trade: the row
still carries product_id, retailer_id, prices and the verdict.$c$;

COMMENT ON TABLE public.review_queue IS
  'Suspect-row review queue and calibration loop. Keyed on (product_id, retailer_id, reason, week_start), NOT retailer_price_id: imports preserve retailer_prices.id but merges DELETE rows, so the id can vanish. retailer_price_id is a drill-through reference with NO foreign key, deliberately: a cascading FK would let a merge destroy reviewed history. Never overwrite the state of an already-reviewed row; a recurrence in a new week is a new row.';

-- --- 9. Brand Spotlight config ------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_spotlight_config (
  brand_slug                  text PRIMARY KEY,
  display_name                text NOT NULL,
  network                     text,
  advertiser_id               text,
  exclusive_code              text,
  suppress_comparison_framing boolean NOT NULL DEFAULT false,
  launched_on                 date
);
COMMENT ON COLUMN public.brand_spotlight_config.suppress_comparison_framing IS
  'When true, all comparison, basket-optimisation and savings language is stripped from client PDFs and hub_to_comparison is omitted. Clarins is NOT a live partner: it is a suppression test against internal data only, and no client-facing Clarins PDF is produced until the partnership is live and permission explicit.';

-- --- 10. Brand Spotlight weekly -----------------------------------------
CREATE TABLE IF NOT EXISTS public.metrics_brand_spotlight_weekly (
  week_start        date NOT NULL,
  brand_slug        text NOT NULL,
  hub_sessions      integer,
  hub_to_comparison numeric(5,2),
  outbound_clicks   integer,
  sales             integer,
  commission        numeric(12,2),
  code_redemptions  integer,
  avg_time_on_hub   numeric(8,2),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, brand_slug)
);

-- --- 11. Platform changes ------------------------------------------------
-- DEVIATION FROM THE BRIEF, flagged in the Step 2 report.
--
-- The brief specifies "one row per dated change" and "seed with the five
-- above". Three of those five have no date: the search cutover is pending, and
-- the AWIN product_GTIN fix and Niche Beauty go-live are both after 4 August. A
-- fourth, the GA4 dimension registration, has a date that is not yet known and
-- must be established empirically in Step 4.
--
-- A NOT NULL changed_at cannot hold those honestly, and inventing a date is
-- exactly the failure this table exists to prevent. So: changed_at is NULLABLE
-- and a status column distinguishes expected from occurred. Only 'occurred'
-- rows render as chart markers. This also delivers the stated goal better -
-- the sixth change costs nothing because it can be recorded the day it is
-- planned, not the day it happens.
CREATE TABLE IF NOT EXISTS public.platform_changes (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at       timestamptz,
  status           text NOT NULL DEFAULT 'expected',
  title            text NOT NULL,
  description      text,
  metrics_affected text[],
  CONSTRAINT platform_changes_status_chk CHECK (status IN ('expected','occurred')),
  CONSTRAINT platform_changes_occurred_has_date
    CHECK (status <> 'occurred' OR changed_at IS NOT NULL),
  -- Title is UNIQUE so the seed below is genuinely idempotent. Without a
  -- constraint to conflict on, ON CONFLICT DO NOTHING silently does nothing at
  -- all and a re-run duplicates every boundary. Caught by running this
  -- migration twice, per README convention 5.
  CONSTRAINT platform_changes_title_uniq UNIQUE (title)
);
COMMENT ON TABLE public.platform_changes IS
  'Dated boundaries that break metric series. Rendered as vertical markers on every trend chart, but ONLY where status = occurred. status = expected holds a known-future change with no date yet; the CHECK forbids marking a row occurred without a date, so a boundary can never acquire an invented timestamp.';

-- Seed. Four of the five known boundaries; the GA4 registration boundary is
-- added by Step 4 once its date is established empirically, because seeding
-- 27 July would record the very date the brief says is wrong.
INSERT INTO public.platform_changes (changed_at, status, title, description, metrics_affected)
VALUES
  ('2026-07-27 11:06:00+00', 'occurred',
   'Savings and catalogue baseline reset',
   'dq_dashboard_log row 3 is the reference point: avg_saving_pct 17.23%, total_savings_pool GBP 71,898.74, biggest_saving GBP 184.50. Rows 1 and 2 are from 3 May and are NOT comparable; the earlier figures (avg 23.20%, pool GBP 180,111) were inflated by dead Superdrug r12 rows and must never be quoted as a prior level or a regression. Anchor the savings trend here as its zero point.',
   ARRAY['avg_saving_pct','total_savings_pool','biggest_saving','comparison_depth_pct']),

  (NULL, 'expected',
   'Browse search total_count cutover',
   'Recall fix changes total_count for 19 of the 127 distinct queries in search_events, all currently returning fewer than 3 results. Rows with result_count < 3 before the cutover are not comparable with the same rows after it. Record the timestamp when it deploys and set status to occurred.',
   ARRAY['result_count','zero_result_search_rate','search_to_comparison_rate']),

  (NULL, 'expected',
   'AWIN product_GTIN importer fix',
   'Held until after the 4 August Boots step-down decision; on the import path, must not go near a deploy before then. Expected to move EAN coverage and therefore matching and comparison depth.',
   ARRAY['ean_coverage_pct','comparison_depth_pct','unmatched_row_rate','placeholder_ean_count']),

  (NULL, 'expected',
   'Niche Beauty retailer go-live',
   'Parked behind the AWIN product_GTIN fix, so after 4 August. Adds catalogue size, comparison depth and brand count in one step.',
   ARRAY['comparison_depth_pct','catalogue_size','total_brands'])
ON CONFLICT (title) DO NOTHING;

-- --- Privileges ----------------------------------------------------------
-- Revoke before grant on every new table, per brief 2.1 and README convention 1.
-- No GRANT to anon or authenticated: these tables carry commission, tracked
-- sales and per-retailer conversion, which are internal only. service_role and
-- postgres retain access via the default ACL and are how the pullers and the
-- authenticated server-rendered route read and write.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'public.metrics_ga4_weekly',
    'public.metrics_awin_weekly',
    'public.metrics_rakuten_weekly',
    'public.metrics_amazon_monthly',
    'public.metrics_social_weekly',
    'public.metrics_quality_weekly',
    'public.metrics_retailer_quality_weekly',
    'public.review_queue',
    'public.brand_spotlight_config',
    'public.metrics_brand_spotlight_weekly',
    'public.platform_changes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END
$$;

-- --- Verification (Step 3 acceptance) ------------------------------------
-- Assert, do not trust. Reads relacl directly: has_table_privilege rolls PUBLIC
-- up into every role's answer and reports success on a table that is open.
DO $$
DECLARE
  t text;
  acl text;
  tables text[] := ARRAY[
    'public.metrics_ga4_weekly','public.metrics_awin_weekly','public.metrics_rakuten_weekly',
    'public.metrics_amazon_monthly','public.metrics_social_weekly','public.metrics_quality_weekly',
    'public.metrics_retailer_quality_weekly','public.review_queue','public.brand_spotlight_config',
    'public.metrics_brand_spotlight_weekly','public.platform_changes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    SELECT relacl::text INTO acl FROM pg_class WHERE oid = t::regclass;
    IF acl IS NOT NULL AND (acl LIKE '%anon=%' OR acl LIKE '%authenticated=%'
                            OR acl LIKE '{=%' OR acl LIKE '%,=%') THEN
      RAISE EXCEPTION 'table % is publicly reachable (ACL: %)', t, acl;
    END IF;
    RAISE NOTICE '% ACL: %', t, COALESCE(acl, '<null = owner only>');
  END LOOP;
END
$$;

-- No explicit BEGIN/COMMIT: this file matches the other migrations in this
-- directory and is applied as a single transactional unit by the runner. An
-- inline COMMIT would also defeat the BEGIN ... ROLLBACK dry-run harness that
-- README convention 5 depends on.
