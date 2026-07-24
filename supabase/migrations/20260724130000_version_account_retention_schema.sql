-- Version the ACCOUNT RETENTION schema (tracked_products + price-drop alerts)
-- that until now existed ONLY in production and was never in a migration — the
-- same invisibility that hid the original saved_routines save bug, now captured
-- for the whole account system (PR #125/#126 + the 2026-07-22 retention_* server
-- work + the 2026-07-24 alert-delivery layer).
--
-- This mirrors the SAFE, current prod state verified via the management API on
-- 2026-07-24. It is idempotent (IF NOT EXISTS / OR REPLACE / drop-then-create),
-- so it is a no-op against prod and reproduces the feature in a fresh env.
--
-- Objects captured:
--   tables    : tracked_products, routine_alerts, product_change_events,
--               user_alert_prefs (RLS + owner policies + grants + indexes)
--   read model: fmb_family_best_price, fmb_get_routine
--   mutations : fmb_track_product, fmb_untrack_product, fmb_mark_alerts_seen,
--               fmb_get_alert_prefs, fmb_set_alert_prefs, fmb_claim_legacy_routine
--   engine    : fmb_fill_missing_baselines, fmb_detect_changes,
--               fmb_generate_alerts (nightly cron 37, order-sensitive)
--   delivery  : fmb_pending_alert_batch, fmb_mark_alerts_delivered,
--               fmb_expire_stale_alerts, fmb_unsubscribe_alerts
--   legacy    : unsubscribe_routine (saved_routines opt-out; was also prod-only)
--
-- The cron 37 send hook lives in 20260724120000_retention_alert_emails_cron.sql.

-- ============================================================================
-- TABLES
-- ============================================================================

-- Per-user tracked products (the account "routine"). RLS scopes every row to
-- its owner; the id-generation is IDENTITY ALWAYS.
create table if not exists public.tracked_products (
  id                    bigint generated always as identity primary key,
  user_id               uuid        not null references auth.users(id) on delete cascade,
  product_id            integer     not null references public.products(id) on delete cascade,
  baseline_price        numeric,
  baseline_retailer_id  integer     references public.retailers(id),
  baseline_captured_at  timestamptz default now(),
  added_at              timestamptz not null default now(),
  slot                  text,
  note                  text,
  unique (user_id, product_id)
);
create index if not exists idx_tracked_products_user    on public.tracked_products (user_id);
create index if not exists idx_tracked_products_product on public.tracked_products (product_id);

-- In-app price-drop alerts (also the email queue via delivered_at).
create table if not exists public.routine_alerts (
  id                   bigint generated always as identity primary key,
  user_id              uuid        not null references auth.users(id) on delete cascade,
  product_id           integer     not null references public.products(id) on delete cascade,
  created_at           timestamptz not null default now(),
  baseline_price       numeric     not null,
  alerted_price        numeric     not null,
  alerted_retailer_id  integer     references public.retailers(id),
  pct_below_baseline   numeric,
  delivered_at         timestamptz,   -- stamped by the email pass (fmb_mark_alerts_delivered / fmb_expire_stale_alerts)
  seen_at              timestamptz    -- stamped by fmb_mark_alerts_seen (in-app read)
);
create index if not exists idx_routine_alerts_user        on public.routine_alerts (user_id, created_at desc);
create index if not exists idx_routine_alerts_undelivered on public.routine_alerts (created_at) where delivered_at is null;

-- Catalogue-wide price movement log for tracked products (feeds detection dedup).
create table if not exists public.product_change_events (
  id                  bigint generated always as identity primary key,
  product_id          integer     not null references public.products(id) on delete cascade,
  detected_at         timestamptz not null default now(),
  event_type          text        not null,
  old_price           numeric,
  new_price           numeric,
  old_retailer_id     integer     references public.retailers(id),
  new_retailer_id     integer     references public.retailers(id),
  pct_change          numeric,
  abs_change          numeric,
  is_material         boolean     not null default false,
  materiality_reason  text
);
create index if not exists idx_change_events_product  on public.product_change_events (product_id, detected_at desc);
create index if not exists idx_change_events_material on public.product_change_events (detected_at desc) where is_material;

-- Per-user email alert consent + unsubscribe token.
create table if not exists public.user_alert_prefs (
  user_id              uuid        not null primary key references auth.users(id) on delete cascade,
  email_alerts_enabled boolean     not null default true,
  unsubscribe_token    text        not null default gen_random_uuid()::text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unsubscribed_at      timestamptz
);
create unique index if not exists idx_user_alert_prefs_token on public.user_alert_prefs (unsubscribe_token);

-- Standard Supabase table grants; RLS below is the real access control.
grant all on public.tracked_products      to anon, authenticated, service_role;
grant all on public.routine_alerts         to anon, authenticated, service_role;
grant all on public.product_change_events  to anon, authenticated, service_role;
grant all on public.user_alert_prefs       to anon, authenticated, service_role;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.tracked_products     enable row level security;
alter table public.routine_alerts        enable row level security;
alter table public.product_change_events enable row level security;
alter table public.user_alert_prefs      enable row level security;

drop policy if exists tracked_products_owner on public.tracked_products;
create policy tracked_products_owner on public.tracked_products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists routine_alerts_select_own on public.routine_alerts;
create policy routine_alerts_select_own on public.routine_alerts
  for select using (auth.uid() = user_id);

-- Read own change events, but only for products you actually track.
drop policy if exists change_events_read_own on public.product_change_events;
create policy change_events_read_own on public.product_change_events
  for select using (exists (
    select 1 from public.tracked_products tp
    where tp.product_id = product_change_events.product_id and tp.user_id = auth.uid()
  ));

drop policy if exists user_alert_prefs_select_own on public.user_alert_prefs;
create policy user_alert_prefs_select_own on public.user_alert_prefs
  for select using (auth.uid() = user_id);
drop policy if exists user_alert_prefs_insert_own on public.user_alert_prefs;
create policy user_alert_prefs_insert_own on public.user_alert_prefs
  for insert with check (auth.uid() = user_id);
drop policy if exists user_alert_prefs_update_own on public.user_alert_prefs;
create policy user_alert_prefs_update_own on public.user_alert_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- FUNCTIONS  (verbatim from prod via pg_get_functiondef, 2026-07-24)
-- ============================================================================

-- Family-best live price (root + children), active retailers, in-stock only.
CREATE OR REPLACE FUNCTION public.fmb_family_best_price(p_product_id integer)
 RETURNS TABLE(best_price numeric, best_retailer_id integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH root AS (
    SELECT COALESCE(p.parent_product_id, p.id) AS root_id
    FROM products p WHERE p.id = p_product_id
  ),
  family AS (
    SELECT id FROM products WHERE id = (SELECT root_id FROM root)
    UNION
    SELECT id FROM products WHERE parent_product_id = (SELECT root_id FROM root)
  )
  SELECT rp.price, rp.retailer_id
  FROM retailer_prices rp
  JOIN family f ON f.id = rp.product_id
  JOIN retailers r ON r.id = rp.retailer_id AND r.active
  WHERE rp.in_stock AND rp.price IS NOT NULL AND rp.price > 0
  ORDER BY rp.price ASC, rp.retailer_id ASC
  LIMIT 1;
$function$;

-- Signed-in routine read model (prices, deltas, unseen-alert rollup).
CREATE OR REPLACE FUNCTION public.fmb_get_routine()
 RETURNS TABLE(tracked_id bigint, product_id integer, name text, brand text, image_url text, slot text, note text, added_at timestamp with time zone, baseline_price numeric, baseline_captured_at timestamp with time zone, current_price numeric, current_retailer_id integer, current_retailer_name text, delta_abs numeric, delta_pct numeric, in_stock_now boolean, unseen_alerts bigint, best_alert_price numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    tp.id, tp.product_id, p.name, p.brand, p.image_url, tp.slot, tp.note, tp.added_at,
    tp.baseline_price, tp.baseline_captured_at,
    bp.best_price, bp.best_retailer_id, r.name,
    CASE WHEN tp.baseline_price IS NOT NULL AND bp.best_price IS NOT NULL
         THEN round(bp.best_price - tp.baseline_price, 2) END,
    CASE WHEN tp.baseline_price IS NOT NULL AND tp.baseline_price > 0 AND bp.best_price IS NOT NULL
         THEN round(100.0*(bp.best_price - tp.baseline_price)/tp.baseline_price, 2) END,
    (bp.best_price IS NOT NULL),
    (SELECT count(*) FROM routine_alerts ra
      WHERE ra.user_id = tp.user_id AND ra.product_id = tp.product_id AND ra.seen_at IS NULL),
    (SELECT min(ra.alerted_price) FROM routine_alerts ra
      WHERE ra.user_id = tp.user_id AND ra.product_id = tp.product_id AND ra.seen_at IS NULL)
  FROM tracked_products tp
  JOIN products p ON p.id = tp.product_id
  CROSS JOIN LATERAL public.fmb_family_best_price(tp.product_id) bp
  LEFT JOIN retailers r ON r.id = bp.best_retailer_id
  WHERE tp.user_id = auth.uid()
  ORDER BY tp.slot NULLS LAST, tp.added_at;
$function$;

-- Add a product (add-only; captures baseline at add time). Runs as caller (RLS).
CREATE OR REPLACE FUNCTION public.fmb_track_product(p_product_id integer, p_slot text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS tracked_products
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_bp  numeric;
  v_br  integer;
  v_row public.tracked_products;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT best_price, best_retailer_id INTO v_bp, v_br FROM public.fmb_family_best_price(p_product_id);

  INSERT INTO public.tracked_products (user_id, product_id, added_at, baseline_price, baseline_retailer_id, baseline_captured_at, slot, note)
  VALUES (v_uid, p_product_id, now(), v_bp, v_br, CASE WHEN v_bp IS NOT NULL THEN now() END, p_slot, p_note)
  ON CONFLICT (user_id, product_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.tracked_products WHERE user_id = v_uid AND product_id = p_product_id;
  END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fmb_untrack_product(p_product_id integer)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  WITH d AS (DELETE FROM tracked_products WHERE user_id = auth.uid() AND product_id = p_product_id RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM d);
$function$;

CREATE OR REPLACE FUNCTION public.fmb_mark_alerts_seen(p_product_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_n integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE routine_alerts SET seen_at = now()
  WHERE user_id = v_uid AND seen_at IS NULL
    AND (p_product_id IS NULL OR product_id = p_product_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fmb_get_alert_prefs()
 RETURNS user_alert_prefs
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.user_alert_prefs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO user_alert_prefs (user_id) VALUES (auth.uid())
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM user_alert_prefs WHERE user_id = auth.uid();
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fmb_set_alert_prefs(p_enabled boolean)
 RETURNS user_alert_prefs
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.user_alert_prefs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO user_alert_prefs (user_id, email_alerts_enabled)
  VALUES (auth.uid(), p_enabled)
  ON CONFLICT (user_id) DO UPDATE
    SET email_alerts_enabled = excluded.email_alerts_enabled,
        updated_at = now(),
        unsubscribed_at = CASE WHEN excluded.email_alerts_enabled THEN NULL ELSE now() END
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fmb_claim_legacy_routine()
 RETURNS TABLE(claimed_products integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
  v_routine jsonb;
  v_pid   integer;
  v_root  integer;
  v_bp    numeric;
  v_br    integer;
  v_claimed integer := 0;
  v_skipped integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN QUERY SELECT 0,0; RETURN; END IF;

  SELECT routine INTO v_routine
  FROM saved_routines
  WHERE lower(email) = lower(v_email) AND active IS NOT FALSE
  ORDER BY created_at DESC LIMIT 1;

  IF v_routine IS NULL OR jsonb_typeof(v_routine) <> 'array' THEN
    RETURN QUERY SELECT 0,0; RETURN;
  END IF;

  FOR v_pid IN SELECT (jsonb_array_elements_text(v_routine))::integer LOOP
    SELECT COALESCE(parent_product_id, id) INTO v_root FROM products WHERE id = v_pid;
    IF v_root IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    SELECT best_price, best_retailer_id INTO v_bp, v_br FROM public.fmb_family_best_price(v_root);
    INSERT INTO tracked_products (user_id, product_id, added_at, baseline_price, baseline_retailer_id, baseline_captured_at)
    VALUES (v_uid, v_root, now(), v_bp, v_br, CASE WHEN v_bp IS NOT NULL THEN now() END)
    ON CONFLICT (user_id, product_id) DO NOTHING;
    IF FOUND THEN v_claimed := v_claimed + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  RETURN QUERY SELECT v_claimed, v_skipped;
END;
$function$;

-- ── Nightly engine (cron 37; order: fill -> detect -> generate) ─────────────
CREATE OR REPLACE FUNCTION public.fmb_fill_missing_baselines()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  WITH need AS (
    SELECT tp.id, bp.best_price, bp.best_retailer_id
    FROM tracked_products tp
    CROSS JOIN LATERAL public.fmb_family_best_price(tp.product_id) bp
    WHERE tp.baseline_price IS NULL AND bp.best_price IS NOT NULL
  )
  UPDATE tracked_products t
  SET baseline_price = n.best_price,
      baseline_retailer_id = n.best_retailer_id,
      baseline_captured_at = now()
  FROM need n WHERE t.id = n.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fmb_detect_changes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH tracked AS (
    SELECT DISTINCT product_id FROM tracked_products
  ),
  current AS (
    SELECT t.product_id, bp.best_price, bp.best_retailer_id
    FROM tracked t
    CROSS JOIN LATERAL public.fmb_family_best_price(t.product_id) bp
  ),
  prior AS (
    SELECT DISTINCT ON (product_id) product_id, new_price AS prev_price, new_retailer_id AS prev_retailer
    FROM product_change_events
    ORDER BY product_id, detected_at DESC
  ),
  diffs AS (
    SELECT c.product_id, p.prev_price, c.best_price AS new_price,
           p.prev_retailer, c.best_retailer_id AS new_retailer,
           CASE WHEN p.prev_price IS NOT NULL AND p.prev_price > 0
                THEN round(100.0*(c.best_price - p.prev_price)/p.prev_price, 2) END AS pct,
           CASE WHEN p.prev_price IS NOT NULL THEN round(c.best_price - p.prev_price, 2) END AS abs_delta
    FROM current c LEFT JOIN prior p ON p.product_id = c.product_id
    WHERE c.best_price IS NOT NULL
      AND (p.prev_price IS NULL OR c.best_price <> p.prev_price)
  ),
  classified AS (
    SELECT *,
      CASE WHEN prev_price IS NULL THEN 'baseline_observed'
           WHEN new_price < prev_price THEN 'price_drop'
           ELSE 'price_rise' END AS ev_type,
      CASE
        WHEN prev_price IS NULL THEN false
        WHEN new_price >= prev_price THEN false
        WHEN abs(pct) < 10 THEN false
        WHEN new_price < 15 THEN true
        WHEN new_price < 50 THEN abs(abs_delta) >= 3
        ELSE abs(abs_delta) >= 5
      END AS material,
      CASE
        WHEN prev_price IS NULL THEN 'first observation'
        WHEN new_price >= prev_price THEN 'rise not alerted'
        WHEN abs(pct) < 10 THEN 'under 10pct'
        WHEN new_price < 15 THEN 'tier<15 pct-only met'
        WHEN new_price < 50 THEN CASE WHEN abs(abs_delta)>=3 THEN 'tier15-50 met' ELSE 'tier15-50 abs floor not met' END
        ELSE CASE WHEN abs(abs_delta)>=5 THEN 'tier>50 met' ELSE 'tier>50 abs floor not met' END
      END AS reason
    FROM diffs
  )
  INSERT INTO product_change_events
    (product_id, detected_at, event_type, old_price, new_price, old_retailer_id, new_retailer_id, pct_change, abs_change, is_material, materiality_reason)
  SELECT product_id, now(), ev_type, prev_price, new_price, prev_retailer, new_retailer, pct, abs_delta, material, reason
  FROM classified;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fmb_generate_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inserted integer := 0;
BEGIN
  WITH candidates AS (
    SELECT tp.user_id, tp.product_id, tp.baseline_price,
           bp.best_price AS cur_price, bp.best_retailer_id AS cur_retailer
    FROM tracked_products tp
    CROSS JOIN LATERAL public.fmb_family_best_price(tp.product_id) bp
    WHERE tp.baseline_price IS NOT NULL
      AND bp.best_price IS NOT NULL
      AND bp.best_price < tp.baseline_price
  ),
  material AS (
    SELECT *,
      round(100.0*(cur_price - baseline_price)/baseline_price, 2) AS pct,
      round(cur_price - baseline_price, 2) AS abs_delta
    FROM candidates
    WHERE abs(100.0*(cur_price - baseline_price)/baseline_price) >= 10
      AND (
        cur_price < 15
        OR (cur_price < 50 AND abs(cur_price - baseline_price) >= 3)
        OR (cur_price >= 50 AND abs(cur_price - baseline_price) >= 5)
      )
  ),
  last_alert AS (
    SELECT DISTINCT ON (user_id, product_id) user_id, product_id, alerted_price AS last_price
    FROM routine_alerts ORDER BY user_id, product_id, created_at DESC
  ),
  to_fire AS (
    SELECT m.* FROM material m
    LEFT JOIN last_alert la ON la.user_id=m.user_id AND la.product_id=m.product_id
    WHERE la.last_price IS NULL
       OR m.cur_price < la.last_price
  )
  INSERT INTO routine_alerts (user_id, product_id, baseline_price, alerted_price, alerted_retailer_id, pct_below_baseline)
  SELECT user_id, product_id, baseline_price, cur_price, cur_retailer, pct FROM to_fire;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

-- ── Email delivery layer ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fmb_pending_alert_batch(p_limit integer DEFAULT 500)
 RETURNS TABLE(user_id uuid, email text, unsubscribe_token text, alert_ids bigint[], alerts jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT ra.id, ra.user_id, ra.product_id, ra.baseline_price, ra.alerted_price,
           ra.alerted_retailer_id, ra.pct_below_baseline,
           p.name AS product_name, p.brand, p.image_url,
           r.name AS retailer_name,
           bp.best_price AS current_price
    FROM routine_alerts ra
    JOIN user_alert_prefs up ON up.user_id = ra.user_id AND up.email_alerts_enabled
    JOIN products p ON p.id = ra.product_id
    LEFT JOIN retailers r ON r.id = ra.alerted_retailer_id
    CROSS JOIN LATERAL public.fmb_family_best_price(ra.product_id) bp
    WHERE ra.delivered_at IS NULL
      AND bp.best_price IS NOT NULL
      AND bp.best_price <= ra.alerted_price
  )
  SELECT l.user_id,
         u.email,
         up.unsubscribe_token,
         array_agg(l.id ORDER BY l.pct_below_baseline),
         jsonb_agg(jsonb_build_object(
           'product_id', l.product_id, 'name', l.product_name, 'brand', l.brand,
           'image_url', l.image_url, 'baseline_price', l.baseline_price,
           'alerted_price', l.alerted_price, 'current_price', l.current_price,
           'retailer', l.retailer_name, 'pct_below_baseline', l.pct_below_baseline,
           'url', '/product/' || l.product_id
         ) ORDER BY l.pct_below_baseline)
  FROM live l
  JOIN auth.users u ON u.id = l.user_id
  JOIN user_alert_prefs up ON up.user_id = l.user_id
  GROUP BY l.user_id, u.email, up.unsubscribe_token
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.fmb_mark_alerts_delivered(p_alert_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  UPDATE routine_alerts SET delivered_at = now()
  WHERE id = ANY(p_alert_ids) AND delivered_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fmb_expire_stale_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  WITH stale AS (
    SELECT ra.id
    FROM routine_alerts ra
    CROSS JOIN LATERAL public.fmb_family_best_price(ra.product_id) bp
    WHERE ra.delivered_at IS NULL
      AND (bp.best_price IS NULL OR bp.best_price > ra.alerted_price)
  )
  UPDATE routine_alerts ra SET delivered_at = now()
  FROM stale s WHERE ra.id = s.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fmb_unsubscribe_alerts(p_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RETURN false; END IF;
  UPDATE user_alert_prefs
     SET email_alerts_enabled = false, unsubscribed_at = now(), updated_at = now()
   WHERE unsubscribe_token = p_token AND email_alerts_enabled = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$function$;

-- ── Legacy saved_routines opt-out (also previously prod-only) ────────────────
CREATE OR REPLACE FUNCTION public.unsubscribe_routine(p_token text)
 RETURNS TABLE(success boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows_affected int;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  UPDATE public.saved_routines
  SET active = false
  WHERE unsubscribe_token = p_token
    AND active = true;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN QUERY SELECT (v_rows_affected > 0);
END;
$function$;

-- ============================================================================
-- FUNCTION GRANTS (mirror prod: engine + delivery are service-role-only)
-- ============================================================================
grant execute on function public.fmb_family_best_price(integer)                 to anon, authenticated, service_role;
grant execute on function public.fmb_get_routine()                              to anon, authenticated, service_role;
grant execute on function public.fmb_track_product(integer, text, text)         to anon, authenticated, service_role;
grant execute on function public.fmb_untrack_product(integer)                   to anon, authenticated, service_role;
grant execute on function public.fmb_get_alert_prefs()                          to anon, authenticated, service_role;
grant execute on function public.fmb_set_alert_prefs(boolean)                   to anon, authenticated, service_role;
grant execute on function public.fmb_unsubscribe_alerts(text)                   to anon, authenticated, service_role;
grant execute on function public.unsubscribe_routine(text)                      to anon, authenticated, service_role;

grant execute on function public.fmb_mark_alerts_seen(integer)                  to authenticated, service_role;
grant execute on function public.fmb_claim_legacy_routine()                     to authenticated, service_role;

-- Nightly engine + email delivery: service-role only (cron + edge function).
revoke all on function public.fmb_fill_missing_baselines()   from public;
revoke all on function public.fmb_detect_changes()           from public;
revoke all on function public.fmb_generate_alerts()          from public;
revoke all on function public.fmb_pending_alert_batch(integer) from public;
revoke all on function public.fmb_mark_alerts_delivered(bigint[]) from public;
revoke all on function public.fmb_expire_stale_alerts()      from public;
grant execute on function public.fmb_fill_missing_baselines()      to service_role;
grant execute on function public.fmb_detect_changes()              to service_role;
grant execute on function public.fmb_generate_alerts()             to service_role;
grant execute on function public.fmb_pending_alert_batch(integer)  to service_role;
grant execute on function public.fmb_mark_alerts_delivered(bigint[]) to service_role;
grant execute on function public.fmb_expire_stale_alerts()         to service_role;
