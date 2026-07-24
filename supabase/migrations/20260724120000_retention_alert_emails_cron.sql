-- Close the drop-email gap: hook the price-drop alert send into the nightly
-- retention job (cron 37, "fmb-retention-nightly", 0 11 * * *).
--
-- Until now the nightly pass only *detected* drops and queued in-app alert rows
-- (fmb_generate_alerts -> routine_alerts); nothing emailed them. This adds a
-- final step that invokes the send-routine-email edge function in `alerts` mode,
-- which drains fmb_pending_alert_batch(), sends one email per consenting user,
-- marks their alerts delivered, and expires stale ones.
--
-- Ordering: fill baselines -> detect changes -> generate alerts (commit the
-- queue) -> POST to the edge function. net.http_post is async (pg_net dispatches
-- after commit), so the queue rows are durable before the function reads them.
--
-- cron.schedule() upserts by jobname, so re-running this migration just
-- re-declares the job; it does not create a duplicate.
--
-- PRE-REQ / GO-LIVE ORDER: deploy the `alerts` mode of send-routine-email BEFORE
-- applying this. If the cron POSTs mode=alerts to a function that predates it,
-- the old code returns 400 "Invalid mode" (no emails, no harm) until deployed.
-- Applying this migration is the switch that starts real price-drop emails.

select cron.schedule(
  'fmb-retention-nightly',
  '0 11 * * *',
  $job$
  -- Order matters: fill must run before detect, or a just-filled baseline
  -- misses its first comparison cycle. Runs at 11:00 UTC, after the last
  -- feed import of the day (YesStyle, 10:00 + ~20 min).
  SELECT fmb_fill_missing_baselines();
  SELECT fmb_detect_changes();
  SELECT fmb_generate_alerts();
  -- Send the queued drops: one email per consenting user, then mark delivered
  -- and expire stale alerts (all inside the edge function's alerts pass).
  SELECT net.http_post(
    url := 'https://crtrjoescntlcjiwdtrt.supabase.co/functions/v1/send-routine-email?mode=alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    timeout_milliseconds := 30000
  );
  $job$
);
