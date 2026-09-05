-- REPAIR 1 OF ITEM 585: make a re-report visible. Item 586.
--
-- ── WHAT WAS BROKEN, AND IT IS NOT THAT NOBODY BUMPED A COUNTER ──────────────
--
-- monitor-retailer-feeds renders ESCALATED at report_count >= 3, and says why in its own copy:
-- "A finding reported 3 times and still open turns the detector red: that is not a judgement that
-- the finding is severe, it means THIS CHANNEL IS NOT WORKING."
--
-- report_count was 1 on ALL 54 ROWS THAT HAVE EVER EXISTED, and first_seen = last_seen on all 54.
-- The checks upsert through PostgREST with resolution=merge-duplicates, which issues
-- ON CONFLICT DO UPDATE SET <the payload's columns>. Neither last_seen nor report_count is in any
-- payload, so DO UPDATE left both at their insert values, for every check, since 19 August.
--
-- SO ESCALATION AT THREE WAS NOT A RULE THAT HAD NOT FIRED. IT WAS A STATE THE TABLE COULD NOT
-- REACH. A guard whose trigger condition is unattainable is not idle, it is absent -- and this one
-- was the guard against an unread channel, so the mechanism built to detect an unread channel was
-- itself unreachable. Item 584's shape one layer up.
--
-- ── WHY A TRIGGER AND NOT COLUMNS IN THE PAYLOAD ─────────────────────────────
--
-- Four writers upsert into this table and three of them are not being changed today. Putting
-- `last_seen: now()` and an incremented count in each payload means four places that must agree,
-- computed client-side, and a new check written next month gets it wrong by omission -- which is
-- exactly how this defect arrived. The database is the one place every writer already passes
-- through.
--
-- ── THE THREE UPDATE PATHS, WHICH ARE NOT THE SAME EVENT ─────────────────────
--
-- RE-REPORT (open -> open): the check found it again. Count it, move last_seen, KEEP first_seen --
--   first_seen is the age of the problem and must survive, or "how long has this been open" is
--   still unanswerable.
-- RESOLVE (open -> not open): roster-parity's PATCH, and the pass the other three still need.
--   A resolution is NOT a sighting: it must not increment, and last_seen must stay at the last
--   time the finding was actually SEEN, or the column stops meaning what it says.
-- RE-OPEN (resolved -> open): the finding came back. Treated as a NEW occurrence -- first_seen and
--   report_count reset, resolved_at cleared. A returning finding inheriting an old count would
--   escalate on history rather than on neglect, and ESCALATED means "nobody is reading this", which
--   is a claim about the present.
--
-- COVERAGE ROWS STAY PINNED AT 1, as fmb_pin_coverage_report_count established: a coverage row is a
-- standing population statement, restated every run, and must never escalate. Its last_seen still
-- moves, because "when was this last confirmed" is a real question about it.
create or replace function public.fmb_stamp_finding_report()
returns trigger
language plpgsql
as $function$
begin
  if TG_OP = 'INSERT' then
    if NEW.kind = 'coverage' then NEW.report_count := 1; end if;
    return NEW;
  end if;

  -- Coverage: restated, never escalating.
  if NEW.kind = 'coverage' then
    NEW.report_count := 1;
    NEW.first_seen   := OLD.first_seen;
    NEW.last_seen    := now();
    return NEW;
  end if;

  -- RESOLVE. Not a sighting.
  if OLD.status = 'open' and NEW.status is distinct from 'open' then
    NEW.first_seen   := OLD.first_seen;
    NEW.last_seen    := OLD.last_seen;
    NEW.report_count := OLD.report_count;
    return NEW;
  end if;

  -- RE-OPEN. A new occurrence, not a continuation.
  if OLD.status is distinct from 'open' and NEW.status = 'open' then
    NEW.first_seen   := now();
    NEW.last_seen    := now();
    NEW.report_count := 1;
    NEW.resolved_at  := null;
    return NEW;
  end if;

  -- RE-REPORT of a still-open finding.
  NEW.first_seen   := OLD.first_seen;
  NEW.last_seen    := now();
  NEW.report_count := OLD.report_count + 1;
  return NEW;
end
$function$;

comment on function public.fmb_stamp_finding_report() is
  'BEFORE INSERT OR UPDATE on standing_check_findings. Distinguishes re-report (count++, last_seen moves, first_seen kept) from resolve (nothing counted) and re-open (reset). Revives ESCALATED at report_count >= 3, which was unreachable because PostgREST DO UPDATE never touched either column. Item 586.';

revoke all on function public.fmb_stamp_finding_report() from public, anon, authenticated;

drop trigger if exists pin_coverage_report_count on public.standing_check_findings;
drop trigger if exists stamp_finding_report on public.standing_check_findings;
create trigger stamp_finding_report
  before insert or update on public.standing_check_findings
  for each row execute function public.fmb_stamp_finding_report();

drop function if exists public.fmb_pin_coverage_report_count();
