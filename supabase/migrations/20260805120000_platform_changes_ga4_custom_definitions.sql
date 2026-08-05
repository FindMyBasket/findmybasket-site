-- platform_changes: GA4 custom definitions registered for load_routine_from_url.
--
-- ALREADY APPLIED TO THE LIVE DATABASE as id 30, by direct insert on 5 August 2026,
-- ahead of this file. That was a divergence from the pattern the other boundary rows
-- follow (see 20260729140000, 20260729120000, 20260729160000), and this file closes it
-- so the row is reproducible on a fresh database rather than existing only in production.
-- Against the live database it is a no-op via ON CONFLICT. Do not "fix" the ordering by
-- deleting and re-inserting the row: the id is referenced by
-- docs/ticket-preload-collision.md and docs/post-4-august-work-list.md item 39.
--
-- WHY THIS ROW EXISTS. Five GA4 custom definitions were registered by hand in the GA4
-- admin interface on 5 August 2026, before the first Pinterest preload pin went out.
-- GA4 does not apply a definition retroactively, so every event fired before that date
-- carries values that were discarded on arrival and cannot be recovered. Without this
-- marker, the point at which five parameters begin returning values looks like a change
-- in visitor behaviour rather than a change in what the instrument could see.
--
-- THREE OF THE FIVE ARE NEW, and ship with the preload-collision commit:
--
--   preload_case         dimension  clean | self_reload | merged. Separates an arrival
--                                   onto an empty basket, from a refresh or
--                                   back-navigation of a preload URL (the basket already
--                                   holds every product the link resolves to, so nothing
--                                   is added), from a genuine collision. A two-way
--                                   "basket was empty" boolean would have filed the
--                                   middle case as a collision — and on pin traffic that
--                                   is probably the commonest non-empty case, so the
--                                   merged bucket would have filled with the clean
--                                   sessions the test exists to isolate.
--   existing_item_count  metric     Basket size immediately before the preload wrote.
--   added_item_count     metric     Products the preload actually added. addToRoutine is
--                                   a union and returns added:false for an id already
--                                   present, so this is lower than routine_size whenever
--                                   the basket overlapped, and zero on a self_reload.
--
-- TWO OF THE FIVE ARE NOT NEW, AND THAT IS THE FINDING. source and routine_size have
-- been firing on this event and were NEVER REGISTERED:
--
--   routine_size   firing since 10 May 2026   (8fcfc25, the Phase 6 port to /app)
--   source         firing since 2 August 2026 (28d565e)
--
-- Both were discarded on arrival for their entire lives. routine_size was unreadable for
-- NEARLY THREE MONTHS. source exists specifically to separate Pinterest routine arrivals
-- from emailed ones, and that split was never available — the preload test would have
-- shipped on 4 August believing it could attribute arrivals by campaign, and could not
-- have. An earlier account of this put the span at "since 29 July"; that is the date the
-- gtag hydration race was fixed and the event began reliably DELIVERING, which is a
-- different fact about the same event. Three months and one week are different claims.
--
-- HOW IT WAS FOUND, which matters more than the fix. Not by any test, log, alarm, or
-- check — none exists that could. GA4 custom definitions are invisible to this
-- repository: an unregistered parameter fires correctly, appears in realtime, passes
-- every assertion, and is silently dropped. It was noticed only because a human opened
-- the admin page to register the three new parameters and read the existing list while
-- they were there. Recorded as convention 22 in supabase/migrations/README.md and as
-- work list item 39.
--
-- WHAT NEEDED NO REGISTRATION. click_source was already a registered dimension, so the
-- new _preload_{case} suffix values appear without admin work, and the same strings reach
-- outbound_clicks.source via sendOutboundBeacon. That is why the three-way distinction
-- rides on the click rather than only on this event: GA4 event-scoped parameters do not
-- join across events, so a flag here alone could never filter retailer_click.
--
-- CONSEQUENCE FOR THE PRELOAD TEST. It begins 5 August 2026, not the 4 August pin date.
-- Any figure spanning that boundary measures a definition that did not exist on one side
-- of it.
--
-- TIME OF DAY IS DELIBERATELY NOT CLAIMED. The registration was made by hand and the
-- exact time was not recorded. Midnight UTC is stored because the column is timestamptz
-- and platform_changes_occurred_has_date forbids an occurred row without a date. It is
-- NOT a measured time. Do not "improve" it to a guessed hour.
--
-- ON CONFLICT (title): platform_changes_title_uniq exists (see
-- 20260728180000_dashboard_schema.sql). Naming the target rather than writing a bare DO
-- NOTHING is convention 6, and it is what makes this migration genuinely re-runnable
-- rather than merely re-runnable-looking.

insert into platform_changes (changed_at, status, title, description, metrics_affected)
values (
  '2026-08-05 00:00:00+00',
  'occurred',
  'GA4 custom definitions registered for load_routine_from_url',
  'Five GA4 custom definitions registered by hand in the admin interface on 5 August 2026, before the first Pinterest preload pin goes out.

REGISTERED:
  preload_case          dimension  NEW, ships with the preload-collision commit. Values: clean | self_reload | merged. Distinguishes an arrival onto an empty basket from a refresh/back-navigation of a preload URL (superset, nothing added) from a genuine collision. A two-way "basket was empty" boolean would have filed self_reload as a collision, which on pin traffic is probably the commonest non-empty case, and would have filled the merged bucket with clean sessions.
  existing_item_count   metric     NEW. Basket size immediately before the preload wrote.
  added_item_count      metric     NEW. Products the preload actually added; addToRoutine is a union and returns added:false for an id already present, so this is lower than routine_size whenever the basket overlapped.
  source                dimension  PRE-EXISTING and NEVER REGISTERED. Firing since 2 August 2026 (28d565e), unreadable until today.
  routine_size          metric     PRE-EXISTING and NEVER REGISTERED. Firing since 10 May 2026 (8fcfc25, Phase 6 port), unreadable until today.

EXPECTED THEN OCCURRED. The registration was planned as the deadline item of the preload-collision work, ahead of the 4 August pin schedule, and was completed 5 August.

REGISTRATION IS NOT RETROACTIVE. Nothing before 5 August 2026 is readable through any of the five definitions. That includes nearly three months of routine_size (from 10 May) and the whole life of source. There is no backfill and the loss is permanent, the same accrual property as the missing price_history writer.

CONSEQUENCE FOR THE PRELOAD TEST. The pin-versus-email split that source exists to provide was never available before today, so no preload or emailed-routine arrival before 5 August can be attributed by campaign. The preload click-out test therefore begins on 5 August, not on the 4 August pin date, and any figure spanning the boundary is measuring a definition that did not exist on one side of it.

RELATED. The click side needed no registration: click_source was already a registered dimension, so the new _preload_{case} suffix values (optimiser_shop_button / optimiser_open_all / optimiser_modal x clean | self_reload | merged | merged_cleared) appear without admin work, and the same strings reach outbound_clicks.source via sendOutboundBeacon. Three rows written before this commit carry the bare _preload suffix and are not case-attributable.

HOW IT WAS FOUND. Not by any test, log, alarm or check. GA4 custom definitions are invisible to the repository: an unregistered parameter fires correctly, appears in realtime, passes every assertion, and is discarded on arrival. The two unregistered pre-existing parameters were noticed only because a human opened the admin page to register the three new ones and read the existing list. Recorded as convention 22 in supabase/migrations/README.md and as work list item 39.',
  array['load_routine_from_url','preload_case','existing_item_count','added_item_count','source','routine_size']
)
on conflict on constraint platform_changes_title_uniq do nothing;
