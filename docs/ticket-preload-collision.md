# Preload collision: a `?routine=` link landing on an existing basket

**Shipped 5 August 2026.** Branch `feat/preload-collision-notice`, commit `b946517`.
Verified on preview before merge. This document is the verification record; the reasoning
is in the commit message and the code comments.

---

## What the change does

A `?routine=` link merges into whatever is already in `localStorage`. `addToRoutine` is a
union, not a replace, and that was deliberate — destroying a hand-built basket is worse
than merging into it. What was missing is that the visitor was told nothing, so a pin
promising five products delivered nine, and the optimiser priced a basket nobody
assembled.

Three parts, one commit:

1. **A notice**, one line, in the Phase 3b box and register.
2. **A way out**, one tap, repopulating from the link rather than clearing to empty.
3. **A three-way flag**, on both the arrival event and every subsequent outbound click.

---

## Why three cases and not a boolean

This is the part the brief did not anticipate and the part the whole measurement rests on.

**Refreshing a preload URL leaves the link's own products in `localStorage`.** So does
navigating back from a retailer tab. On the next load the basket is not empty, the
preload resolves the same five ids, `addToRoutine` returns `added: false` for every one of
them, and **nothing is added**. A `basket_was_empty: false` flag files that session as a
collision.

On Pinterest traffic that is probably the commonest non-empty case. The merged bucket
would have filled with precisely the clean sessions the test exists to isolate, and the
flag would have been worse than no flag — noise that looks like signal.

| Case | Condition at preload time | Notice | Meaning |
|---|---|---|---|
| `clean` | basket empty | none | first arrival, nothing to say |
| `self_reload` | basket non-empty, nothing added | **suppressed** | refresh or back-navigation. A clean arrival. |
| `merged` | basket non-empty, something added | rendered | genuine collision |
| `merged_cleared` | *(not an arrival case)* | — | the visitor took the way out |

**`self_reload` is tested on added-count zero rather than on set-superset.** The two are
equivalent here, and this one measures against what was actually *addable*: an id the link
asked for that `products_active` did not return was never going to be added, and must not
make a self-reload look merged.

**`merged_cleared` is a fourth value on the click only.** The arrival was still a
collision, so relabelling it `clean` after the visitor fixes it would pollute the bucket
the test keeps pure. Keeping it as `merged` would be truthful but would make take-up of
the escape hatch invisible, and take-up is the only evidence that building it was worth
it. `preload_case` on the arrival event carries three values; `click_source` carries four.

---

## Where the emptiness is read, and why there

`RoutineBuilder.tsx`, immediately before the `storeAdd` loop.

Both mount effects run in declaration order, and nothing between the preload effect
starting and that line writes to the store — only the awaited Supabase query and a sort.
So at that instant `localStorage` still holds exactly what the visitor arrived with. It is
the only moment that is true.

**The hydration gate cannot stand in for it.** `preload === 'pending'` is set only when the
store was empty, which looks like the same information, but the 3s timeout can flip it to
`'failed'` before the query lands. Reading it here would be correct on a fast connection
and wrong on a slow one — the worst kind of wrong, because it would be right in testing.

---

## Verification, 5 August 2026

Preview deployment
`findmybasket-site-git-feat-preload-f11e14-hello-1150s-projects.vercel.app`, commit
`b946517`.

**Recorded, not judged by eye.** Every figure below is a captured `dataLayer` payload or a
captured `navigator.sendBeacon` body.

**Outbound beacons were intercepted and not sent.** `outbound_clicks` was 335 rows before
and 335 after, 0 written during verification, so the click-source evidence cost no test
rows in the production table. `window.open` was neutralised for the same reason — no
retailer tab was opened.

### The arrival event, all three cases

URL in every case:
`/app?routine=607,16173,3995,1521,6180&utm_source=pinterest`

| Case | Pre-existing basket | `preload_case` | `existing_item_count` | `added_item_count` | `routine_size` | `source` | Notice |
|---|---|---|---|---|---|---|---|
| A | empty | `clean` | 0 | 5 | 5 | `pinterest` | none |
| C | the same 5 ids (reload) | `self_reload` | 5 | 0 | 5 | `pinterest` | **suppressed** |
| B | ids 2, 4 | `merged` | 2 | 5 | 5 | `pinterest` | rendered |

Case A also confirms the URL-order fix (`cf6b2f8`) still holds: the store held
`[607, 16173, 3995, 1521, 6180]`, the URL order, not ascending id.

**Case C is the case the design turns on.** It is a clean arrival with a non-empty basket,
and the two counts prove it: five present, none added.

### Case B, the harm reproduced

```
basket_optimised
  basket_item_count      7
  winning_retailer_count 2
  result_type            split
  winning_basket_total   £80.25
  savings_value          £12.54
  savings_suppressed     false
  optimisation_trigger   auto_shared_link
```

Seven products across two retailers, £12.54 of "savings" on a basket nobody assembled.
That is §1 of the brief, measured rather than argued.

Notice rendered, verbatim:

```
Added 5 products to your existing routine. Clear it and start fresh
```

The count is the **added** count, not the URL count and not the resolved count.

### The way out

| | Store | Count | Notice |
|---|---|---|---|
| Before | `[2, 4, 607, 16173, 3995, 1521, 6180]` | 7 products | rendered |
| After | `[607, 16173, 3995, 1521, 6180]` | 5 products | gone |

Two `basket_optimised` runs recorded in order: `items 7 / £80.25`, then
`items 5 / £62.95`. **The optimiser re-ran on the corrected basket and the stale results
did not survive** — which is `resetResults()` doing the job `clearRoutine()` cannot, since
the store knows nothing about the optimiser.

### Click source, both pipelines, identical string

| When | GA4 `click_source` | Beacon `source` → `outbound_clicks` |
|---|---|---|
| Merged, before clearing | `optimiser_shop_button_preload_merged` | `optimiser_shop_button_preload_merged` |
| After clearing | `optimiser_shop_button_preload_merged_cleared` | `optimiser_shop_button_preload_merged_cleared` |
| No `?routine=` | `optimiser_shop_button` | `optimiser_shop_button` |

One `clickSourceFor` line puts the distinction into both pipelines. No schema change, no
session cookie, no consent question.

### Acceptance criterion 3: no parameter, no change

Navigated to `/app` with a populated basket:

```
load_routine_from_url events   0
notice present                 false
click_source                   optimiser_shop_button
optimisation_trigger           user_action
```

The no-parameter path is untouched.

### Acceptance criterion 5: optimiser untouched

Confirmed by diff, not by reading. No hunk in `b946517` falls between `runOptimiser` and
`presentResults`. The insertion that follows them is after the closing brace, zero
deletions.

---

## Why the flag rides on the click and not only on the arrival

**GA4 event-scoped parameters do not join across events.** A flag on
`load_routine_from_url` alone cannot filter `retailer_click`, so the numerator and the
denominator each need the distinction on their own event.

The brief suggested carrying it onto `outbound_clicks` "if cheap". It is not cheap by the
route the brief imagined, and it is free by another.

**Not cheap:** `session_id` is NULL on **all 335 rows** of `outbound_clicks`.
`ensureSessionId()` is never called anywhere in the repository, so the `fmb_sid` cookie is
never set — `lib/session.ts` defers it pending consent posture. Populating it would not
help, because `outbound_clicks` holds no *arrival* rows, so the denominator does not exist
in that table and never will. **The rate is a GA4 computation and cannot be otherwise.**

**Free:** `clickSourceFor` already fed both GA4's `click_source` and
`outbound_clicks.source` via `sendOutboundBeacon`, at all six call sites. Extending
`_preload` to `_preload_{case}` is one line.

`_preload` stays the common stem, so `source like '%_preload%'` still catches the three
rows written before this commit. Those three carry the bare suffix and are **not**
case-attributable.

---

## What this does not fix, and must be said with any figure

**Item 15 stands, deliberately.** The routine builder's two hand-rolled cross-check
anchors call `trackRetailerClick` and `trackAffiliateClickOut` but never
`sendOutboundBeacon`. `select count(*) from outbound_clicks where source like 'routine_%'`
returns **0**, re-confirmed 5 August 2026.

Everything the server table holds from `/app`, as at 5 August 2026:

| `source` | Rows |
|---|---|
| `optimiser_shop_button` | 8 |
| `optimiser_shop_button_preload` | 3 |
| `optimiser_modal` | 1 |
| `routine_*` | **0** |

**12 rows against 335 in the table.** Any server-side preload figure sees the Shop-button,
open-all and modal paths and nothing else. Quote it with that scope attached or not at all.

---

## The comparator

**Not 4.7 per cent.** `docs/strategy-amendments.md` A6 records that the 4.7 per cent
click-out rate used comparison views as its denominator, that the denominator was broken
by the gtag hydration race until 29 July, and that **the number should not be quoted as
measured**.

The test is **preload-clean against preload-merged**, and against the post-3-August
baseline once that baseline exists. Both comparisons are internal to the corrected
instrument, which is the only way not to inherit the broken denominator.

Work list item 38 carries this for readers who arrive at a figure without arriving here.

---

## The registration, and what it cost

The three new parameters needed GA4 custom definitions before the first pin, because
**registration is not retroactive**. Registered 5 August 2026. `platform_changes` id 30.

Registering them surfaced a separate finding, recorded as work list item 39 and convention
22: **`load_routine_from_url` had been firing `routine_size` since 10 May 2026 and `source`
since 2 August 2026 with neither ever registered.** Both were discarded on arrival. The
pin-versus-email split that `source` exists to provide was never available.

`routine_size` was unreadable for **nearly three months**. That span is the finding. An
earlier draft of this record put it at "since 29 July", which is the date the
hydration-race fix landed and the event began reliably *delivering* — a different fact
about the same event, and conflating the two understates the loss by an order of
magnitude.

Nothing before 5 August 2026 is readable through any of the five definitions.

---

## Files

| File | What |
|---|---|
| `app/app/RoutineBuilder.tsx` | the three cases, the notice, `startFresh`, the event fields |
| `app/app/routine-builder.css` | `.rb-routine-reset`, a button styled as the existing text link |
| `docs/post-4-august-work-list.md` | items 38 and 39 |
| `supabase/migrations/README.md` | convention 22 |
| `supabase/migrations/20260805120000_platform_changes_ga4_custom_definitions.sql` | `platform_changes` id 30 |
