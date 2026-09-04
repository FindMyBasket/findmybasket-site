-- WHICH OPEN FREEZE FINDINGS ARE STILL TRUE TODAY.
--
-- feed_freeze_findings.resolved_at is set BY HAND by design ("Detection only -- a person decides
-- what to do"). The detector stops updating a row when the streak ends; it does not close it. That
-- is correct and it means OPEN != CURRENT: on 4 September six rows were open and only one was a
-- live freeze. The other five were streaks that ended -- The Organic Pharmacy's oldest dates from
-- 27 June -- left open because, until today, NOTHING READ THIS TABLE and so nobody ever resolved
-- one. Work-list item 579.
--
-- THE DISTINCTION IS THE WHOLE VALUE OF THE VIEW. A daily email listing six findings of which five
-- ended weeks ago is the noise item 194 exists to prevent, arriving through item 194's own
-- mechanism: the section would be ignored within a week and the one live row would be lost inside
-- the five dead ones. Reporting an ended freeze as current is not a smaller error than missing a
-- live one -- it is the error that destroys the channel.
--
-- CURRENT is defined as the detector defines a live streak: the finding's last_seen_on is the most
-- recent day this retailer's feed was observed at all. A retailer whose import failed today keeps
-- its finding current on yesterday's observation, which is exactly the Beauty Flash case -- frozen
-- 31 days, then a 404 -- and the case where dropping it would be worst.
create or replace view public.fmb_frozen_feeds_current as
with latest_obs as (
  select retailer_id,
         max(recorded_at::date) as last_obs_on,
         (array_agg(inflated_bytes order by recorded_at desc))[1] as current_bytes
  from public.feed_size_history
  group by retailer_id
)
select
  f.id,
  f.retailer_id,
  r.name as retailer_name,
  f.kind,
  f.first_seen_on,
  f.last_seen_on,
  f.days_identical,
  f.frozen_bytes,
  f.staged_rows,
  l.current_bytes,
  l.last_obs_on
from public.feed_freeze_findings f
join public.retailers r on r.id = f.retailer_id
join latest_obs l on l.retailer_id = f.retailer_id
where f.resolved_at is null
  and r.active
  and f.last_seen_on = l.last_obs_on;

comment on view public.fmb_frozen_feeds_current is
  'Open feed_freeze_findings whose streak is still live today (last_seen_on = the retailer''s most recent feed observation). Open != current: resolved_at is set by hand, so ended streaks stay open. Read by monitor-retailer-feeds. Item 579.';

revoke all on public.fmb_frozen_feeds_current from public, anon, authenticated;
grant select on public.fmb_frozen_feeds_current to service_role;
