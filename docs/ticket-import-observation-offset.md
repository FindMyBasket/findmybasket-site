# Ticket: the import/observation scheduling offset

**Raised:** 30 July 2026, from the YesStyle stall of 29 July.
**Status:** OPEN as of 1 August 2026. Documented, not fixed. No change proposed yet.
**Recurred:** 1 August 2026 on Beauty Bay — same signature, different retailer.
See "Recurrence" below, which **revises consequence 1**: the 23h figure is the
best case across the fleet, not the worst.

> **This file did not exist until 30 July 2026, and was believed to.** The
> offset had been reasoned about and its consequences identified in conversation,
> but nothing in the repository recorded it. It was referred to across several
> turns as "the watchdog ticket", as though it had been seen; nobody checked.
> A grep for its supposed contents returned nothing.
>
> **Recorded as the operator's error, not the agent's.** It matters because it is
> a *different* failure from the stale records this project catalogued through
> July: those existed and went out of date, and were found by tripping over them.
> This one never existed, and was found only because someone went looking. See
> convention 9 in `supabase/migrations/README.md`, "the absent record".
>
> Recorded now so the fourth consequence is cheap to add.

## One cause

**YesStyle is the only retailer whose import runs AFTER the daily observation
window.** Every other pg_cron feed import finishes by 07:47; Debenhams runs from
GitHub Actions and lands around 05:13. The three daily observers then run, and
YesStyle imports after all of them.

| Time (UTC) | Job |
|---|---|
| 03:30 – 07:47 | every other feed import (Stylevana, Escentual, Boots, Branded Beauty, Organic Pharmacy, Gorgeous Shop, Beauty Bay, Beauty Flash, Perfume Click, Atelier De Glow) |
| ~05:13 | Debenhams, via GitHub Actions rather than pg_cron |
| **09:00** | `monitor-retailer-feeds` (cron 23) |
| **09:30** | `run_categoriser_safety_net()` (cron 30) |
| **09:45** | `capture_catalog_health()` (cron 31) |
| **10:00** | **YesStyle import (cron 24)** |
| 11:00 | `fmb-retention-nightly` (cron 37) |

Everything each observer says about YesStyle describes yesterday's YesStyle.

## Three consequences

**1. Monitor delay — up to 23 hours before a failure is reported.** This is the
one that matters most, because **it is the only one that gates a human
noticing.** A YesStyle import that fails at 10:00 is not reported until the
09:00 monitor the following morning. Worst case 23 hours, by design and not by
defect.

Observed 30 July 2026: the 29 July 10:00 run died, and the 09:00 email on 30 July
named YesStyle, quoted the 23h duration, and diagnosed a hard kill or OOM
(HTTP 546) that died before recording its outcome. **The monitor worked. The 23
hours of silence was this offset, not a monitoring gap.**

> ## CORRECTION, 1 August 2026 — this consequence is stated backwards
>
> **"Worst case 23 hours" is wrong. 23h is the FASTEST failure report any
> retailer on this schedule can get, and YesStyle gets it *because* it runs
> after the observers.**
>
> **On time-to-report, the offset is protective, not harmful.** That is the
> reverse of what the paragraph above implies, and the reverse of what was
> predicted when the Beauty Bay recurrence was first read.
>
> The dominant term is `RUNNING_STUCK_HOURS = 6`, not the offset. A death less
> than 6h before the next 09:00 is invisible to that pass and waits a further
> day. Every pg_cron retailer except YesStyle imports between 03:30 and 07:47 —
> always inside that 6h shadow — so the fleet waits 25.2–29.5h, Stylevana worst.
> YesStyle's 10:00 slot is the only one that clears the gate by the next morning.
>
> **Consequences 2 and 3 are unaffected and stand as written.** The offset is
> still real and still costs a day on categorisation and on snapshot coherence.
> It is only this consequence — the one flagged above as mattering most, because
> it gates a human noticing — that had the sign wrong.
>
> Derivation and per-retailer table in "Recurrence" below.

**2. Categoriser safety net runs before the feed it would correct.** The 09:30
pass fixes miscategorised products, then YesStyle's import lands at 10:00. Any
miscategorisation arriving in that feed waits a full day for correction.

**3. Catalogue health snapshot captures YesStyle at D-1.** The 09:45 snapshot
reads every other retailer same-day and YesStyle a day behind. Its own 24-hour
window softens this but does not remove it: the snapshot is internally
inconsistent as to which day it describes.

> **There is no fourth. "Day-late surfacing" was carried for a while as a
> separate consequence and is not one — it is a restatement of consequence 1.**
> Deleted rather than left flagged for confirmation, because a rephrasing left
> in a list is worse than an error: someone will eventually spend an afternoon
> trying to verify a synonym, and find nothing, and not know whether the absence
> is the answer or the search.

## Do not read this as three bugs

It is one scheduling fact with three downstream readings. Fixing it is a single
change — move YesStyle earlier, or move the observers later — and either choice
trades one set of consequences for another. **Nothing here is proposed as a
change.** The reason to record it is that the fourth consequence will otherwise
be investigated from scratch as an unexplained anomaly, which is what happened to
the first three.

## Staleness numbers: four distinct settings, none interchangeable

They are frequently conflated. They measure different things and are tuned for
different reasons.

| Setting | Value | Where | What it measures |
|---|---|---|---|
| `RUNNING_STUCK_HOURS` | **6h** | `monitor-retailer-feeds` | a run stranded at `last_import_status = 'running'`. **This is the check that fired for YesStyle**, matching the 23h figure in the email. |
| `STALENESS_HOURS` | **36h** | `monitor-retailer-feeds` | backstop on newest `retailer_prices.last_updated`. Lowered 48 → 36 in §7 so a single missed daily run alerts the next morning. Would also have fired for YesStyle at ~47h. |
| `absence_threshold_days` | **7 / 21 / 30 / 9999** per retailer, default 30 | `retailer_import_config` | days a row may go unseen in the feed before absence handling flips it out of stock. Boots 30 against a calibrated 7; YesStyle parked at 9999. |
| catalogue health window | **24h** (and a 7-day window) | `capture_catalog_health()` | the snapshot's own look-back. |

**The monitor settings are alerting thresholds. `absence_threshold_days` is a
data-mutating threshold.** Confusing them is the expensive mistake: the monitor
sends an email, absence handling flips rows out of stock and empties pages.

## The watchdog did not fail here, and could never have helped

State this explicitly, because "the watchdog didn't catch it" reads as a defect
and is not one.

| | `fmb_watchdog_stalled_imports` (cron 28, every 5 min) | `monitor-retailer-feeds` (cron 23, 09:00) |
|---|---|---|
| Reads | `import_run_state` | `retailer_import_config`, `retailer_prices` |
| Covers | **sliced imports stalled BETWEEN slices** | **runs that never completed at all** |
| Action | re-fires the next slice, self-healing | reports by email, human-facing |

**They cover different failures and neither covers the other.** YesStyle's run
died before writing any `import_run_state` row — no scrape_log row, no run_state
residue, no error message — so there was nothing for the watchdog to see. It ran
every five minutes for 47 hours and correctly found nothing. **YesStyle needed
the monitor, and got it.**

The related trap is real but separate, and is recorded in
`supabase/migrations/README.md` convention 8: a watchdog that resumes in-flight
work is structurally blind to work that never got in flight. That is a limit on
the watchdog's scope, not a failure of this incident.

## What the 29 July run actually did

Bounded from the residue, since the edge logs retain 24 hours and it is past that:

| Evidence | Establishes |
|---|---|
| `last_attempt_at` 29 Jul 10:00:04, status `running` | the apply-start stamp executed |
| **no `scrape_log` row for 29 July** | never reached scrape_log creation |
| `import_run_state` empty | never reached the staging/meta write |
| `last_import_error` empty | no error handler ran |

It died after the `'running'` stamp and before the first staging write — the
fetch/decompress/parse window. **A run that dies without writing an error was
killed; it did not fail and report.** Consistent with the 546 worker-kill class,
and consistent with YesStyle being much the largest feed at ~57,448 source rows
with durations swinging 2m03s to 16m57s across 25–28 July.

**The §7 silent-staleness stamp is why this was visible at all.** Without it the
row would have kept the previous run's `ok` and the failure would have surfaced
only as stale prices, much later.

### Outcome of the 30 July 10:00 run: SUCCEEDED. Not a recurrence.

Watched and recorded 30 July 2026 10:06 UTC.

| | |
|---|---|
| `scrape_log` | row 121, **success**, 10:00:02 → 10:02:58, **177s** |
| Volumes | source 57,457, matched 7,171, new 68, out-of-stock 31,463 |
| `last_import_status` | **`ok`** — self-cleared from the stranded `running` |
| `last_import_error` | empty |
| `import_run_state` | empty, cleaned up normally |
| YesStyle price rows | 13,389 → **13,415** |

**Two predictions in this ticket were verified, not merely unfalsified.**

1. **The stranded `'running'` did not block the run.** Predicted from reading the
   code — the only gate is `config.enabled`, the status is written and never
   read — and the run started on schedule with the flag still set. Clearing it by
   hand would have been unnecessary, as stated.
2. **The status self-cleared on the next success.** No manual intervention was
   applied at any point.

**The 29 July failure did not recur, so it stays a single unexplained hard kill.**
Duration 177s is in line with 28 July's 185s; the 16-minute runs of 26 and 27 July
remain the outliers rather than the fast ones. The cause is not confirmed and now
probably never will be: the edge logs that would have carried today's evidence
were never needed, and 29 July's aged out long ago.

**Do not read one clean run as the matter being closed.** A failure that occurred
once on the largest feed, left no error, and then did not repeat is exactly the
shape that returns. The §7 stamp and the 09:00 monitor are what will catch it, and
both are now known to work.

**If it does recur, keep the two failure modes in separate entries even when the
symptoms look alike.** A run killed before any handler leaves no `scrape_log` row,
no `import_run_state` residue and an empty `last_import_error` — that is the
29 July signature. A run that fails and reports writes at least one of those.
Merging them would make a new fault read as a repeat of an old one.

## Recurrence: Beauty Bay, 1 August 2026

Recorded 1 August 2026 ~16:15 UTC, **while the run was still stranded** — so this
entry is written from live state rather than from residue.

The 29 July signature returned on a different retailer. Every line matches:

| Evidence | Establishes |
|---|---|
| `last_attempt_at` 1 Aug **06:30:02.988**, status `running` | the apply-start stamp executed; the run started on schedule |
| `last_imported_at` still 31 Jul 06:30:15 | no successful apply since |
| **no `scrape_log` row for 1 August** | never reached scrape_log creation |
| `last_import_error` empty | no error handler ran |
| ~~`import_run_state` empty~~ | **nothing — see below. Do not cite this line.** |

> **`import_run_state` is NOT evidence for Beauty Bay, and the first draft of this
> entry wrongly cited it.** Beauty Bay is `staging_mode = 'inline'`, and inline
> imports never write `import_run_state` at all — not on failure, not on success.
> Confirmed from `feed_size_history`, which is populated by trigger on
> `import_run_state`: retailers 26 (Beauty Bay) and 29 (Atelier De Glow) have
> **zero rows ever**, across every run including successful ones, while all nine
> `storage_passthrough` retailers have 11–38. An empty table is Beauty Bay's
> normal state and says nothing about how far this run got.
>
> It was valid evidence for YesStyle, which is `storage_passthrough` and does
> write the table. Carrying it across to an inline retailer was a false match.

The three surviving lines still place this in the 29 July class: the run started,
reached no `scrape_log` write, and ran no error handler. Per the rule at the end
of the 29 July entry, that is the **same** failure mode and belongs with it.

**This kills the "largest feed" reading.** YesStyle at ~57,448 source rows was the
natural suspect for a worker kill. Beauty Bay's last good run staged **7,518
source rows in 12 seconds** — an eighth the volume, and durations two orders of
magnitude apart. Feed size is not sufficient to explain the class.

**The watchdog is blind to Beauty Bay permanently, not just in this incident.**
Stronger and more general than the YesStyle finding. `fmb_watchdog_stalled_imports`
reads `import_run_state`; inline retailers never write it. So cron 28 cannot
observe **Beauty Bay or Atelier De Glow in any state, ever** — not stalled, not
running, not healthy. For YesStyle the table was empty because that particular run
died early; for these two it is empty by construction.

That is a coverage gap in the watchdog's *domain*, distinct from the scope limit
in `supabase/migrations/README.md` convention 8. Convention 8 says a watchdog that
resumes in-flight work cannot see work that never got in flight. This says two
retailers are outside its field of view altogether.

### The 09:00 monitor did NOT catch it on 1 August, and could not have

This was expected to be a clean test of consequence 1, on the reasoning that
Beauty Bay's 06:30 import sits *before* the 09:00 monitor rather than after it,
unlike YesStyle. **That reasoning does not hold, and the test does not isolate the
offset.**

`monitor-retailer-feeds` fires the stuck-run check only when
`hoursSince(last_attempt_at) > RUNNING_STUCK_HOURS`, with the constant at **6**
(`supabase/functions/monitor-retailer-feeds/index.ts:36`, check at :145–147).

| Monitor pass | Elapsed since 06:30 | `> 6h`? | Result |
|---|---|---|---|
| 1 Aug 09:00 | 2.5h | no | **silent** |
| 2 Aug 09:00 | 26.5h | yes | should report |

So running *before* the observer bought nothing. The 2.5h gap is under the stuck
threshold, so the same-day pass skipped it and the report falls to the next day at
**26.5h — longer than YesStyle's 23h, not shorter.**

**Time-to-report is `the next 09:00 that is more than 6h after the death`.** For
the current schedule that is:

| Retailer | Import | Gap to same-day 09:00 | Time to report |
|---|---|---|---|
| Stylevana | 03:30 | 5.5h | **29.5h** |
| Escentual | 04:00 | 5.0h | 29.0h |
| Boots | 04:30 | 4.5h | 28.5h |
| Branded Beauty | 05:00 | 4.0h | 28.0h |
| Organic Pharmacy | 05:30 | 3.5h | 27.5h |
| Gorgeous Shop | 06:00 | 3.0h | 27.0h |
| **Beauty Bay** | **06:30** | **2.5h** | **26.5h** |
| Beauty Flash | 07:00 | 2.0h | 26.0h |
| Perfume Click | 07:30 | 1.5h | 25.5h |
| Atelier De Glow | 07:47 | 1.2h | 25.2h |
| **YesStyle** | **10:00** | n/a (after) | **23.0h — best in fleet** |

**YesStyle, the retailer this ticket was raised about, has the fastest failure
reporting of any retailer.** It clears the 6h gate before the next morning's pass
precisely *because* it runs after the observers. The offset is real and the three
consequences stand, but consequence 1 was attributed to the wrong term: the
binding constraint is `RUNNING_STUCK_HOURS` against a once-daily monitor, and it
binds hardest on the retailers that run *earliest*.

**Pending check, 2 August 2026 09:00 UTC.** If the monitor names Beauty Bay at
~26.5h, the derivation above is confirmed. If it fires earlier, the 6h reading is
wrong and this section needs revisiting. Not yet verified — do not quote it as
observed.

### Owed work: a 6h threshold against a once-daily pass is decorative

Raised 1 August 2026. **Not proposed as a change here** — recorded so it is not
re-derived from scratch.

`RUNNING_STUCK_HOURS = 6` reads like a tuning knob and is not one. Against a
monitor that runs once a day, only two things can happen to a stuck run:

- **under 6h at the next 09:00** → invisible, waits a full further day
- **over 6h at the next 09:00** → reported at that pass

The threshold never decides *when* a report happens, only *which* 09:00 it lands
on. Moving it to 4h or 8h would change nothing for any current retailer: every
pg_cron slot is either 1.2–5.5h before the pass (always under, on any threshold
in that range) or 23h before it (always over). **The value is doing almost no
work.**

Two coherent fixes, mutually exclusive in effect:

1. **Run the monitor more often.** The threshold starts meaning something the
   moment the pass interval drops below it — at hourly, a 6h threshold reports a
   06:30 death at 12:30 rather than the next morning.
2. **Drop the threshold to near-zero and keep the daily pass.** Reports every
   stranded `running` at the next 09:00 regardless of age. Simpler, and no worse
   than today, since nothing currently benefits from the 6h grace.

Option 1 is the one that actually shortens time-to-report; option 2 only removes
a constant that misleads. Doing neither is defensible while the fleet is small —
but the constant should not be read as protection it is not providing.

### The count is two. Escentual 29 July is NOT an instance.

Recorded because the count was briefly carried as three, and the correction is
the more useful record. A scan of `scrape_log` for missing scheduled runs,
22 July to 1 August:

| Date | Retailer(s) with no run | Class |
|---|---|---|
| 23 Jul | 10 of 12 retailers | fleet-wide outage, different shape |
| 25 Jul | Beauty Bay | unverifiable, not counted |
| 29 Jul | YesStyle | **instance 1** — killed, no handler |
| 29 Jul | **Escentual** | **NOT an instance** — failed and reported |
| 1 Aug | Beauty Bay | **instance 2** — this entry |

**Escentual's 29 July run failed loudly.** It recorded
`last_import_status = 'error'` with `passthrough stage: inflated upload failed`.
An error handler ran and wrote a cause. That is the reported class, and the
discriminator at the end of the 29 July entry separates it in one line: *a run
that fails and reports writes at least one of `scrape_log`, `import_run_state`
residue, or `last_import_error`.* Escentual wrote the third. YesStyle and Beauty
Bay wrote none.

The error text is a contemporaneous reading and is **no longer verifiable from
live state** — `last_import_error` is overwritten per run and Escentual has since
run successfully many times, now sitting at `ok`. What can still be checked, and
was: Escentual has no `scrape_log` row for 29 July and no `feed_size_history` row
for 29 July, while carrying rows for 28, 30 and 31 July. That is consistent with a
failure at the inflated-upload step, which is the step that would have produced
the missing `feed_size_history` row.

**Two retailers sharing a date is not two instances of the same fault.** Escentual
and YesStyle both failed on 29 July, which is what made the day look like a single
event with two victims. They failed differently. Merging them on the strength of a
shared date would have done exactly what the 29 July entry's closing rule warns
against — making a new fault read as a repeat of an old one — with the date
standing in for the evidence.

Beauty Bay 25 July stays uncounted: `last_attempt_at` has been overwritten many
times since, so the only residue is the absent `scrape_log` row, which is equally
consistent with a trigger that never fired. See convention 9, "the absent record":
a count is a claim, and that one cannot be checked after the fact.

## No concurrency guard, confirmed

`import-awin-feed` does **not** refuse to start when `last_import_status` is
already `'running'`. The only gate before the apply is `config.enabled`; the
status is written, never read. `import_run_state` is keyed on a fresh `run_id`
per run, so it is slice bookkeeping and not a lock.

**A stranded `'running'` therefore does not block the next scheduled run**, and
does not need clearing by hand. It self-clears when a run next succeeds. Leaving
it is also the more informative choice: if the next run dies the same way, that
recurrence is the signal.
