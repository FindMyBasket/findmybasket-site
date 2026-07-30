# Ticket: the import/observation scheduling offset

**Raised:** 30 July 2026, from the YesStyle stall of 29 July.
**Status:** OPEN as of 30 July 2026. Documented, not fixed. No change proposed yet.

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

> **PENDING, 30 July 2026 09:15 UTC: today's 10:00 run is being watched.** It will
> start regardless of the stranded `'running'` (see below), so it is the
> diagnostic case: either it succeeds and the status self-clears, or it dies the
> same way and the recurrence is the signal. **Today's failure, if it comes, IS
> diagnosable** — edge logs retain 24 hours, which is why the 29 July one is not.
> Append the outcome here.

## No concurrency guard, confirmed

`import-awin-feed` does **not** refuse to start when `last_import_status` is
already `'running'`. The only gate before the apply is `config.enabled`; the
status is written, never read. `import_run_state` is keyed on a fresh `run_id`
per run, so it is slice bookkeeping and not a lock.

**A stranded `'running'` therefore does not block the next scheduled run**, and
does not need clearing by hand. It self-clears when a run next succeeds. Leaving
it is also the more informative choice: if the next run dies the same way, that
recurrence is the signal.
