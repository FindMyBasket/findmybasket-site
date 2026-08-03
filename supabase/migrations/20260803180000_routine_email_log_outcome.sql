-- routine_email_log.outcome: WHAT the email contained, as distinct from why it was
-- sent (mode) and whether Resend accepted it (ok).
--
-- WHY A PER-SEND OUTCOME AND NOT A COUNTER ON saved_routines. A counter is derived
-- state that drifts, and it answers exactly one question. A per-send outcome answers
-- several: how often sends are empty, whether that is one routine or many, and whether
-- the pause rule has ever fired. It also makes the rule INSPECTABLE. A counter reading
-- three tells you nothing about why it reached three.
--
-- THREE ORTHOGONAL AXES, none implying another:
--   mode     why it sent          monthly / welcome / test / alerts
--   outcome  what it contained    priced / empty / paused / skipped_paused
--   ok       did Resend accept    boolean
-- "An empty email that sent successfully" is mode='monthly', outcome='empty', ok=true.
--
-- skipped_paused IS THE VALUE THAT EARNS THE DESIGN. It is written when NO email is
-- sent, so the log records a decision not to act rather than going silent. It is how
-- "the pause rule fired" is told apart from "the cron did not run". A counter could
-- not represent that at all.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. The 19 rows predating this honestly read NULL,
-- meaning "before outcomes were recorded", rather than a guessed 'priced'.

ALTER TABLE public.routine_email_log
  ADD COLUMN IF NOT EXISTS outcome text;

ALTER TABLE public.routine_email_log
  DROP CONSTRAINT IF EXISTS routine_email_log_outcome_chk;

ALTER TABLE public.routine_email_log
  ADD CONSTRAINT routine_email_log_outcome_chk
  CHECK (outcome IS NULL OR outcome IN ('priced', 'empty', 'paused', 'skipped_paused'));

COMMENT ON COLUMN public.routine_email_log.outcome IS
  'What the email contained. priced = a real basket. empty = Template A, sent with '
  'nothing buyable. paused = Template B, the final send before pausing. '
  'skipped_paused = NO email sent, row records the decision. NULL = predates 3 Aug 2026.';

-- ---------------------------------------------------------------------------
-- The pause rule, as a function rather than a counter.
--
-- INERT ON PURPOSE. Nothing calls this yet. Template B is not built: monthly has run
-- once (1 Aug 2026), so routine 37's first empty send is 1 September, second 1 October
-- and third 1 November. B cannot fire before then. This exists now so the rule is
-- written down, reviewable, and TESTED before anything depends on it.
--
-- FILTERS ON ok. A pause must be triggered by three months of having nothing to say,
-- NOT by three months of Resend failing. Those are different problems with different
-- remedies, and conflating them would pause a subscriber whose routine is perfectly
-- priceable because their mail provider was rejecting us.
--
-- KNOWN GAP, DELIBERATELY NOT SOLVED HERE: a persistently failing address never
-- accumulates three ok=true empty rows, so it never pauses and is retried monthly
-- forever. That is the deliverability problem in a different form and it needs its own
-- rule and its own decision. Recorded as work-list item 32.
CREATE OR REPLACE FUNCTION public.fmb_routine_empty_streak(p_routine_id bigint)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  -- Length of the current run of 'empty' outcomes, most recent first. Returns 0 if the
  -- latest delivered monthly send was priced. Reads the series rather than a counter,
  -- so the answer can always be explained by looking at the rows behind it.
  SELECT COALESCE(
    (SELECT count(*)
       FROM (
         SELECT outcome,
                row_number() OVER (ORDER BY created_at DESC) AS rn
           FROM public.routine_email_log
          WHERE routine_id = p_routine_id
            AND mode = 'monthly'
            AND ok                       -- see FILTERS ON ok above
            AND outcome IS NOT NULL      -- pre-3-Aug rows carry no outcome
       ) ordered
      WHERE outcome = 'empty'
        AND rn <= (
          SELECT COALESCE(MIN(rn), 999999)
            FROM (
              SELECT row_number() OVER (ORDER BY created_at DESC) AS rn, outcome
                FROM public.routine_email_log
               WHERE routine_id = p_routine_id
                 AND mode = 'monthly'
                 AND ok
                 AND outcome IS NOT NULL
            ) x
           WHERE outcome <> 'empty'
        )
    ), 0);
$$;

COMMENT ON FUNCTION public.fmb_routine_empty_streak(bigint) IS
  'Current run of consecutive empty monthly sends for a routine, most recent first. '
  'Filters on ok: a pause must follow three months of nothing to say, not three months '
  'of Resend failing. Inert until Template B is built; earliest possible fire 1 Nov 2026.';

-- --- Verification (convention 4: assert, do not assume) ----------------------
-- THE ok=false PATH HAS NEVER OCCURRED. All 19 existing rows are ok=true, so the
-- filter this rule depends on is untested by construction, exactly like the unknown
-- delivery branch. Synthetic rows are the only thing that exercise it. They are
-- inserted, asserted against, and rolled back within this block.
DO $$
DECLARE
  v_routine bigint;
  v_streak  integer;
  v_pre     integer;
BEGIN
  SELECT count(*) INTO v_pre FROM public.routine_email_log;

  -- A routine id that cannot collide with a real one.
  v_routine := -999;

  -- Case 1: three delivered empties in a row -> streak 3.
  INSERT INTO public.routine_email_log (routine_id, email, mode, ok, outcome, created_at)
  VALUES (v_routine, 'synthetic@example.invalid', 'monthly', true, 'empty', now() - interval '3 months'),
         (v_routine, 'synthetic@example.invalid', 'monthly', true, 'empty', now() - interval '2 months'),
         (v_routine, 'synthetic@example.invalid', 'monthly', true, 'empty', now() - interval '1 month');
  SELECT public.fmb_routine_empty_streak(v_routine) INTO v_streak;
  IF v_streak <> 3 THEN
    RAISE EXCEPTION 'three delivered empties should give streak 3, got %', v_streak;
  END IF;

  -- Case 2: a priced send in the middle breaks the run.
  INSERT INTO public.routine_email_log (routine_id, email, mode, ok, outcome, created_at)
  VALUES (v_routine, 'synthetic@example.invalid', 'monthly', true, 'priced', now() - interval '10 days');
  SELECT public.fmb_routine_empty_streak(v_routine) INTO v_streak;
  IF v_streak <> 0 THEN
    RAISE EXCEPTION 'a priced send should reset the streak to 0, got %', v_streak;
  END IF;

  -- Case 3: THE UNTESTED-BY-CONSTRUCTION PATH. Three Resend FAILURES must NOT count.
  -- Without the ok filter this would read as a streak of 3 and pause a subscriber
  -- whose routine is perfectly priceable.
  DELETE FROM public.routine_email_log WHERE routine_id = v_routine;
  INSERT INTO public.routine_email_log (routine_id, email, mode, ok, outcome, created_at)
  VALUES (v_routine, 'synthetic@example.invalid', 'monthly', false, 'empty', now() - interval '3 months'),
         (v_routine, 'synthetic@example.invalid', 'monthly', false, 'empty', now() - interval '2 months'),
         (v_routine, 'synthetic@example.invalid', 'monthly', false, 'empty', now() - interval '1 month');
  SELECT public.fmb_routine_empty_streak(v_routine) INTO v_streak;
  IF v_streak <> 0 THEN
    RAISE EXCEPTION 'undelivered empties must NOT count toward a pause, got streak %', v_streak;
  END IF;

  -- Case 4: pre-3-Aug rows carry no outcome and must not be read as empty.
  DELETE FROM public.routine_email_log WHERE routine_id = v_routine;
  INSERT INTO public.routine_email_log (routine_id, email, mode, ok, outcome, created_at)
  VALUES (v_routine, 'synthetic@example.invalid', 'monthly', true, NULL, now() - interval '3 months');
  SELECT public.fmb_routine_empty_streak(v_routine) INTO v_streak;
  IF v_streak <> 0 THEN
    RAISE EXCEPTION 'NULL-outcome rows must not count, got streak %', v_streak;
  END IF;

  -- Clean up. The log must be left exactly as found.
  DELETE FROM public.routine_email_log WHERE routine_id = v_routine;
  IF (SELECT count(*) FROM public.routine_email_log) <> v_pre THEN
    RAISE EXCEPTION 'synthetic rows were not fully removed';
  END IF;

  RAISE NOTICE 'OK: outcome column added, pause rule verified including the ok=false path';
END
$$;
