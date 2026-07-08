-- Sliced-import routing: make the self-invoke chain function-aware.
--
-- Background: import-rakuten-feed (Superdrug, retailer 12) grew past the 150s
-- edge wall-clock on its single-invocation apply path (102s on 2026-07-07 -> 504
-- on 2026-07-08). We are porting the proven sliced_import machinery (already
-- live for the awin retailers 11/25/26/27) to import-rakuten-feed.
--
-- The existing chaining RPC fmb_invoke_import_slice() HARD-CODES the target URL
-- to /functions/v1/import-awin-feed, and the watchdog fmb_watchdog_stalled_imports()
-- re-fires stalled slices through it. A rakuten slice chained (or re-fired) through
-- the unmodified RPC would be POSTed to the awin importer — wrong function.
--
-- This migration makes both function-aware via a `fn` routing key:
--   * fmb_invoke_import_slice(p_body): URL now
--       /functions/v1/<p_body->>'fn'>, defaulting to 'import-awin-feed'.
--   * fmb_watchdog_stalled_imports: propagates meta->>'fn' (default
--       'import-awin-feed') into the re-fire body for both split and process.
--
-- Backward compatibility: every existing awin run and every existing run_state
-- meta row carries NO `fn` key, so both paths COALESCE to 'import-awin-feed' and
-- behave exactly as before. Only import-rakuten-feed sets meta.fn / body.fn.

-- 1. Route the self-invoke by an optional `fn` key in the posted body.
CREATE OR REPLACE FUNCTION public.fmb_invoke_import_slice(p_body jsonb)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT net.http_post(
    url := 'https://crtrjoescntlcjiwdtrt.supabase.co/functions/v1/'
           || COALESCE(NULLIF(p_body->>'fn', ''), 'import-awin-feed'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := p_body,
    timeout_milliseconds := 300000
  );
$function$;

-- 2. Watchdog: carry the target function through re-fires. A stalled rakuten run
--    stamps meta.fn='import-rakuten-feed' at stage time; awin runs have no fn and
--    default to 'import-awin-feed'. Logic is otherwise identical to the prior
--    definition (split-phase re-fire vs process-phase re-fire).
CREATE OR REPLACE FUNCTION public.fmb_watchdog_stalled_imports(p_stale_minutes integer DEFAULT 10, p_max_fire integer DEFAULT 10, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
DECLARE
  stalled_run RECORD;
  fired jsonb[] := ARRAY[]::jsonb[];
  pg_net_id bigint;
  next_action text;
  invoke_body jsonb;
  target_fn text;
BEGIN
  FOR stalled_run IN
    SELECT
      run_id, retailer_id, meta, updated_at,
      ROUND(EXTRACT(EPOCH FROM (NOW() - updated_at))/60)::int AS minutes_stalled
    FROM import_run_state
    WHERE kind = 'meta'
      AND key = ''
      AND updated_at < NOW() - (p_stale_minutes * INTERVAL '1 minute')
      AND (
        -- Storage-passthrough split phase not done yet (total_slices NULL during split)
        (meta ? 'inflated_blob_path' AND meta->>'total_slices' IS NULL)
        -- OR process phase not done (next_slice < total_slices)
        OR ((meta->>'next_slice')::int < COALESCE((meta->>'total_slices')::int, -1))
      )
    ORDER BY updated_at  -- oldest stall first
    LIMIT p_max_fire
  LOOP
    -- Route the re-fire to the function that owns this run (rakuten vs awin).
    target_fn := COALESCE(NULLIF(stalled_run.meta->>'fn', ''), 'import-awin-feed');

    IF stalled_run.meta ? 'inflated_blob_path'
       AND stalled_run.meta->>'total_slices' IS NULL THEN
      -- Phase B (split) stalled. Re-fire split with this run_id.
      next_action := 'split';
      invoke_body := jsonb_build_object(
        'fn', target_fn,
        'retailer_id', stalled_run.retailer_id,
        'run_id', stalled_run.run_id,
        'mode', 'split',
        'dry_run', false,
        'slice_rows', (stalled_run.meta->>'slice_rows')::int
      );
    ELSE
      -- Process phase stalled. Re-fire next slice.
      next_action := 'process';
      invoke_body := jsonb_build_object(
        'fn', target_fn,
        'retailer_id', stalled_run.retailer_id,
        'run_id', stalled_run.run_id,
        'mode', 'process',
        'slice_index', (stalled_run.meta->>'next_slice')::int,
        'dry_run', false,
        'slice_rows', (stalled_run.meta->>'slice_rows')::int
      );
    END IF;

    IF p_dry_run THEN
      pg_net_id := -1;
    ELSE
      SELECT fmb_invoke_import_slice(invoke_body) INTO pg_net_id;
    END IF;

    fired := fired || jsonb_build_object(
      'run_id', stalled_run.run_id,
      'retailer_id', stalled_run.retailer_id,
      'action', next_action,
      'fn', target_fn,
      'minutes_stalled', stalled_run.minutes_stalled,
      'next_slice', (stalled_run.meta->>'next_slice')::int,
      'total_slices', stalled_run.meta->>'total_slices',
      'pg_net_request_id', pg_net_id
    );
  END LOOP;

  IF array_length(fired, 1) > 0 AND NOT p_dry_run THEN
    RAISE LOG 'fmb_watchdog_stalled_imports: fired % stalled run(s): %',
      array_length(fired, 1), to_jsonb(fired);
  END IF;

  RETURN jsonb_build_object(
    'fired', COALESCE(array_length(fired, 1), 0),
    'stale_threshold_minutes', p_stale_minutes,
    'dry_run', p_dry_run,
    'runs', COALESCE(to_jsonb(fired), '[]'::jsonb)
  );
END;
$function$;
