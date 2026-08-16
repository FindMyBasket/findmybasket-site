# Superdrug (retailer 12) removal — orphan-handling plan

**Status (2026-07-19): FLIP COMPLETE — verified green.** All steps executed:
A (view flip, applied), C (#105), D (#106), gate observability (#107), curated 301s
(#108), Edge Config `superdrug_removed:true`, and `UPDATE retailers SET active=false
WHERE id=12`. products_active 100,231 -> 75,760 (24,471 orphans dropped). Post-flip
verification all green: orphans 410, curated 301 to brand pages, survivors 200 (Superdrug
dropped from comparison), merged/shade 308, bad id 404, listing pages 200. Compliance fix
(Rakuten strip, #103) shipped separately. Remaining: Step E ISR revalidation (SQL below,
service_role) and GSC monitoring of the 410 de-index over the coming weeks. Rollback if
ever needed: Edge Config `superdrug_removed:false` + `active=true` (active=true alone
restores the catalogue even without the flag).

> **DATA-QUALITY EXPECTATION TO CARRY IF r12 EVER RETURNS.** Measured 5 Aug 2026.
> Superdrug's retained rows carry **871 barcodes that cannot normalise, out of 29,247 —
> 3.0%**. The live-retailer rate is 0.085% (48 of 56,584). **Forty times higher.**
>
> It does not matter while retired: those rows are `in_stock = false` and excluded from
> `products_active`. It matters if Superdrug is ever re-onboarded through AWIN, because
> it is a property of what that merchant publishes rather than of our importer, and it
> would arrive again with the feed.
>
> Recorded so it is an expectation rather than a discovery. The coalesce work now
> filters these at write time via `validateBarcode`, so a re-onboarding today would
> reject them rather than store them — but the underlying feed quality is what it is.

## Before onboarding: a category allowlist is retailer-specific, always

**Added 10 August 2026, from the Boots supplements work.** This sits here because the
departure runbook is what gets read when a retailer's scope changes, and the same trap
applies on the way in.

**`retailer_import_config.category_path_must_contain` is matched against a string the
RETAILER wrote.** Boots' `Health & Beauty > Health Care > Fitness & Nutrition > Vitamins &
Supplements` is a Boots string and tells you nothing about anyone else's feed.

> **Never copy a path allowlist between retailers. Audit each feed before writing one.**

Two measured reasons it cannot be shortcut:

- **The column differs.** Debenhams feed 116972 populates `merchant_product_category_path`
  on **0.0%** of rows and carries its taxonomy in `merchant_category` instead. An allowlist
  written against the wrong column drops the entire feed — which is what kept Debenhams
  stale from 3 August.
- **A name rule is not a substitute.** Classifying on product names instead of paths was
  tested on 2,415 raw Boots rows and put `Viagra Connect Sildenafil Film-Coated Tablets` in
  a consumer supplements category. Words invert between catalogues: `oil`, `gel` and `pack`
  are application words in beauty and dosage forms in health. See
  `docs/supplements-definition.md` v1.2 and work-list item 57.

**The audit is one dispatch.** `.github/workflows/feed-diag.yml` sections 4-6 report what an
allowlist excludes, what a proposed change would admit, and how a classification rule
behaves on that retailer's raw rows.

## Before onboarding: delivery terms are a REQUIRED step, not a later audit

**Added 16 August 2026. Work-list item 130.** Same placement and same reason as the section
above: this runbook is what gets read when a retailer's scope changes.

**Eleven retailers' delivery terms were verified against their own sites on 1 August 2026 —
thorough, correct, and an EVENT.** Niche Beauty went live on 9 August and was never in it,
because it did not exist yet. **Nothing in the onboarding sequence required delivery terms
before go-live**, so it went live with both columns NULL and the homepage went on claiming
*"we factor in each retailer's free delivery threshold"* for a retailer whose terms nobody
knew.

> **A THOROUGH PASS IS NOT A MECHANISM, AND THE MORE THOROUGH IT IS THE MORE IT READS LIKE
> ONE.** The `retailers_delivery_shape` CHECK was the only durable part of the 1 August work,
> and it constrains the SHAPE of a value rather than requiring one to exist. **A retailer can
> still go live knowing nothing, because `unknown` is a legal shape.**

**Required before `active = true`:**

1. **Verify against the retailer's own site, not the feed.** Delivery terms are not in AWIN
   and never have been.
2. **Record one of the CHECK's three shapes:**

   | shape | columns | means |
   |---|---|---|
   | **`tiered`** | threshold AND cost | free above the threshold, cost below it |
   | **`flat`** | cost, NO threshold | one charge regardless of basket size (Debenhams) |
   | **`unknown`** | neither | **we looked and could not establish them** |

3. **`unknown` IS A DELIBERATE CHOICE WITH A REASON, NEVER A DEFAULT.** It is also exactly
   what the pair looks like when nobody decided, and those two states are indistinguishable
   in the database. **Write the reason down at go-live or the distinction is lost.**
4. **Never enter half a shape.** A threshold with no cost is self-contradictory — free above
   a threshold and free below it, which no retailer means. The CHECK refuses it; that refusal
   is the constraint working, not an obstacle to route around.

**What `unknown` costs, so the choice is informed.** The product is honest about it:
`RoutineBuilder` renders *"Delivery not known"* and refuses to compute a delivered total.
But **that retailer cannot win a basket comparison on delivered cost**, and every site claim
describing the delivery mechanism is false for it until the terms are entered. Niche Beauty
has carried that since 9 August.

**Live instance:** Niche Beauty (32) is the only active retailer at `unknown`. Its threshold
is published — **£75, confirmed on two pages of niche-beauty.com/en-gb**, which would be the
highest in the fleet by half — and the cost below it is published nowhere, reachable only
through checkout. **Do not enter the threshold alone.**

## Reusable pattern for the NEXT retailer departure

Step A permanently changed `products_active` to require an offer from an ACTIVE retailer,
which **fixed the thin-page bug for ANY future inactive retailer** — not just Superdrug.
So the next departure is far simpler:
1. Flip `retailers.active = false` for the departing id -> its sole-retailer products
   drop out of `products_active` automatically (out of sitemap, out of listing counts).
2. Regenerate the orphan id set for that retailer and point the middleware's GONE_IDS /
   REDIRECTS at it (the middleware + Edge Config kill-switch are already in place; reuse
   `scripts/regen-superdrug-gone-ids.mts` with the retailer id parameterised).
3. Curate 301s from GSC for the traffic tail; everything else 410s.
4. Step E revalidation + monitor.
5. **Copy sweep — MANDATORY, and it was missed on 27 July 2026.** See below.
6. Regenerate `GONE_IDS` **on the day**, not on the following Sunday. See below.
7. **Assess the supply-side barcode loss** — codes leaving `ean_product_index`, and how
   many of them nobody else supplies. This is not about the departing retailer's pages.
   See below. **First measured on Atelier De Glow (r29), 15 August 2026.**
8. **Check for brand pages going to zero live products**, and separate the real losses
   from normalisation splits before touching anything. See below.

> **A DEPARTURE'S SIZE AND ITS COST ARE DIFFERENT MEASUREMENTS, AND THIS LIST RANKS BY SIZE.**
> Added 16 August 2026, from two departures hours apart. Step 1 is catalogue loss and it is
> the first number anyone quotes, which makes the big-row departure look like the serious one.
>
> | | Branded Beauty | Atelier De Glow |
> |---|---:|---:|
> | catalogue loss | **1,821** | **59** |
> | barcodes gone from the index | 0 | **67** |
> | products losing a live offer | 0 | **520** |
>
> **Thirty times smaller by rows and unboundedly larger on both the other measures.** The
> reason is the flags, not the size: Branded Beauty was `enabled = false` from 12 August and
> out of stock from 1 August, so its barcode and comparator losses were already taken before
> anyone flipped anything. **Read steps 7 and 8 before deciding a departure is small.**
No view change, no query-filtering work, no new infra needed — those were one-time and
are now permanent. The listing-query active filtering (Step C) also already covers every
future inactive retailer.

#### TWO PROMISES IN THIS LIST DO NOT HOLD. MEASURED 15 AUGUST 2026, r29.

Both were written as though the work were done. Neither is, and both were discovered by
reading the code the list points at rather than by running it.

| Promise | Reality |
|---|---|
| Step 2: *"reuse `scripts/regen-superdrug-gone-ids.mts` with the retailer id parameterised"* | **It is not parameterised.** `const SUPERDRUG = 12` is hardcoded at line 25 and the id is threaded through the whole script — `r12Products`, the `POST_FLIP` branch, the log lines. Parameterising it is real work to schedule before step 6, not a flag to pass. |
| Step 2: *"the middleware + Edge Config kill-switch are already in place"* | **In place, but singular.** `middleware.ts:101` reads **one** key, `superdrug_removed`, gating **one** `GONE_IDS` set. |

**The kill-switch consequence is the one to decide deliberately, because it is not a
defect.** Adding a second departure's ids to `GONE_IDS` puts them behind the first
departure's switch. The key is currently `true`, so it works. What it costs is that
**rollback becomes all-or-nothing across both departures**: flipping `superdrug_removed`
to `false` to un-410 one retailer's orphans un-410s the other's at the same time.

Two ways out, and the choice belongs to whoever runs the next departure rather than here:
a second key and a second id set (more infra, independent rollback), or one set and one
key with the tradeoff accepted and written down. **What must not happen is the ids being
merged in without the decision being made**, which is the default if nobody reads this.

### Step 0 — expect a daily alert for the whole parked-but-not-retired window

**Established 2026-08-03. Know this before the next departure rather than discovering it
from the inbox.**

`monitor-retailer-feeds` keys on **`retailers.active` and nothing else.** Its retailer set
is a single query — `supabase.from("retailers").select("id, name").eq("active", true)` at
`supabase/functions/monitor-retailer-feeds/index.ts:104-108` — and every downstream check
(import failures, stuck-running, staleness) is gated on membership of that set via
`nameById.has()`. A retailer with `active = false` cannot appear in any section of the
email.

**`retailer_import_config.enabled` does NOT suppress alerts.** It is selected at line 123
and then never referenced in any filter — the only occurrence of the string `enabled` in
the whole function is that `SELECT`. Reading line 123 gives the strong and wrong impression
that the monitor honours it. It does not.

The two flags are set at different times, and only the second one silences the monitor:

| Stage | `active` | `enabled` | Feed refreshes? | Monitor behaviour |
|---|---|---|---|---|
| Parked | `true` | `false` | No | **Alerts as STALE, every morning, forever.** Staleness grows without bound because nothing can refresh it. |
| Retired | `false` | either | No | Silent. Dropped from the retailer set entirely. |

**The natural experiment that proves it**, both observed 2026-08-03 with the flags
inverted between them:

| Retailer | `active` | `enabled` | Stale | In today's email? |
|---|---|---|---|---|
| **Branded Beauty (6)** | `true` | **`false`** | 52h | **YES** — 2,166 rows, `last_import_status = 'ok'`, so no failure is recorded and it lands in the *stale* section on the 36h threshold. |
| **Superdrug (12)** | **`false`** | `true` | 363h | **NO** — despite `enabled = true` and being 15× staler. |

Superdrug is silent *only* because `active = false`. Skin Cupid (7) is the third case:
`active = false`, `enabled = false`, `last_import_status = 'error'` — an import failure
that is likewise never reported, for the same reason.

**Consequences for the runbook:**

- A retailer parked ahead of a held retirement decision **will alert daily until the
  `active` flip**, and that is correct behaviour, not a fault. Do not treat the recurring
  email as a defect, and do not silence it per-incident.
- **No cleanup is needed after step 1.** Flipping `active = false` stops the alert on its
  own, immediately, with no monitor change and no config edit.
- If a park is expected to run long, the choice is to tolerate the daily mail or bring the
  `active` flip forward. There is no third option that keeps the retailer active and quiet
  without changing the monitor.
- Retained `retailer_prices` rows are irrelevant to this — Superdrug keeps 29,547 and is
  silent; Branded Beauty has 2,166 and alerts.

#### A DEPARTURE HELD OPEN DOES NOT PRESERVE WHAT IT IS HOLDING

**Added 16 August 2026, measured on Branded Beauty: held from 2 August past a 4 August
condition, flipped on the 16th.** A hold reads as conservative — nothing deleted, the rows
all still there, the decision still open. **It is not conservative. It is a slower version of
the same loss, with the loss already taken.**

| | at the flip |
|---|---|
| **Comparison depth** | **Zero.** Branded Beauty had no in-stock rows: its offers were withdrawn 1 August. No product lost a live offer, because none had had one for a fortnight. |
| **Search equity** | **Gone with it.** The GSC curation found **22** product pages worth redirecting, against Superdrug's **54** from a drop set thirteen times larger. Fifteen days of thin pages had cost the ranking before the flip was considered. |
| **What the hold preserved** | **1,821 live, indexable pages rendering nothing buyable.** |

> **THE FLIP COLLECTS A LOSS ALREADY TAKEN. IT DOES NOT CAUSE ONE.** Superdrug was flipped
> eight days after its feed died and kept 54 redirects' worth of equity. Branded Beauty was
> held fifteen days and kept 22. **The hold is the cost, and it is measurable on both the
> catalogue and the search side.**

**So the question at a hold is never "is it safe to flip yet?"** That answer drifts toward
yes on its own as the inventory dies, which makes it feel like patience is working. The
question is **"what is still being preserved?"** — and once the answer is *nothing*, holding
is the more destructive option, because it is the one that keeps thin pages indexed and
ranking away.

**Record the condition AND its expiry date when a hold is taken.** Branded Beauty's condition
was the 4 August Boots read; it passed twelve days before anyone re-read the hold. That is
work-list item 77's shape — a hold outliving its condition — on an operation rather than a
deferral.

**Live instance:** Branded Beauty was parked 2026-08-02 (jobid 18 inactive,
`sync-bb-feed.yml` disabled, `enabled = false`) with the `active = false` flip deliberately
held past the 4 August Boots read. It has alerted since and will continue to until the flip.

#### The general form: deactivating a retailer stops watching it

**Monitoring coverage is a function of `retailers.active`.** The flip that retires a
retailer is the same flip that removes it from observation — there is no separate
"retired" and "unmonitored" state. For a genuinely retired retailer that is correct and
intended: nothing is refreshing it, so nothing should complain.

**The cost is that a retailer deactivated while broken takes its unreported failure with
it, permanently.** `retailer_import_config.last_import_status` keeps recording, but nobody
reads it once `active = false`. Skin Cupid (7) is the live proof:

| | |
|---|---|
| Status | `error`, `active = false`, `enabled = false` |
| Error | `Feed download failed: 400 Bad Request (fid null)` |
| Last **successful** import | `last_imported_at` = 2026-05-21 07:43 UTC |
| Last **attempt** | `last_attempt_at` = 2026-06-11 17:29 UTC — failed |
| Age at 2026-08-03 | **52.7 days, never reported once** |
| Config | `awin_merchant_id = 125042`, `awin_feed_id = NULL` |

**It broke in service.** It ran successfully for weeks and then failed — this is not an
abandoned pre-launch configuration. The `awin_feed_id` is `NULL` against a live merchant
id, which is exactly the `fid null` the error names: the programme closed, the feed id was
cleared or invalidated, an import ran against a null fid and 400'd, and the retailer was
deactivated with the error still on it.

**Dating precision:** `last_attempt_at` is overwritten on every attempt, so 11 June is the
**last** attempt, not necessarily the first failure. There are **21.4 days between the last
success and that attempt**, and any number of failures could have overwritten each other
inside that window. The break can be bounded to 2026-05-21 → 2026-06-11; it cannot be dated
to 11 June. Do not restate it as "broke on 11 June".

*(Open detail, not chased: `feed_format` reads `shopify` while the error and the config are
AWIN-shaped. Worth resolving if Skin Cupid is ever revived; irrelevant to the point here.)*

**This is the same sequence as Superdrug and Branded Beauty** — a programme or feed ends,
the next import fails, the retailer is retired. The only difference is that nobody was
watching this one, which is what makes it the strongest of the three as a worked example
rather than the weakest.

Checked the same day: **Skin Cupid is the only retailer in that state**, and there are no
`retailer_import_config` rows orphaned from a missing `retailers` row. So this is a single
buried error, not a backlog — but it was buried for nearly two months and surfaced only
because it happened to be a control in an unrelated question.

#### Retailer churn is a normal operating condition, not an exception

**Four departures or feed rotations in ten weeks**, 21 May – 3 August 2026:

| Date | Retailer | Event | Caught by |
|---|---|---|---|
| 21 May – 11 Jun | **Skin Cupid (7)** | AWIN programme 125042 closed, `awin_feed_id` nulled | **Nobody.** Deactivated with the error still on it; unreported for 52.7 days. |
| 19 Jul | **Superdrug (12)** | Rakuten feed died | Retired 27 Jul; 29,547 rows retained, `active = false` |
| 2 Aug | **Gorgeous Shop (30)** | AWIN rotated the datafeed 110188 → 116876 | The 09:00 monitor, in ~3h — the *loud* class. 6,710 rows already stale. |
| 2 Aug | **Branded Beauty (6)** | AWIN programme closed | Parked; `active` flip held past the 4 Aug Boots read |

That is roughly one event every two and a half weeks, across three different causes
(programme closure, feed death, id rotation) and two networks. **This is the argument for
the runbook existing at all**: retailer churn is the steady state, so the departure path
is a routine operating procedure and not an incident response. Anything that only works
when a departure is treated as exceptional will fail on the next one.

**This is the same shape as the watchdog's coverage being a function of `staging_mode`.**
`fmb_watchdog_stalled_imports` (cron 28) reads `import_run_state`; `inline` retailers never
write that table, so Beauty Bay and Atelier De Glow are outside its field of view
permanently and by construction, not by fault
(`docs/ticket-import-observation-offset.md:237-247`).

| Mechanism | Scope actually set by | What that flag is *about* |
|---|---|---|
| `monitor-retailer-feeds` (cron 23) | `retailers.active` | whether we sell the retailer |
| `fmb_watchdog_stalled_imports` (cron 28) | `staging_mode`, via `import_run_state` | how the import stages its data |

**Two mechanisms whose scope is set by a flag that means something else.** Neither flag
was chosen to define monitoring coverage; both do. When adding a third mechanism, state
what determines its field of view explicitly, rather than letting it fall out of whichever
table the query happens to join.

**Practical consequence for a departure:** before flipping `active = false`, read the
departing retailer's `last_import_status` and `last_import_error` and record them here.
After the flip nothing will ever surface them again.

### Step 5 — Copy sweep (added 2026-08-01, after it was missed once)

**Steps 1–4 are all database and routing. None of them touches hand-written copy, and
hand-written copy is where the site makes its factual claims about who we compare.**

> **A SWEEP SCOPED TO A RETAILER'S NAME WILL MISS EVERY CLAIM THAT NAMES NOBODY.**
> Added 3 August 2026, from the sweep's own results.
>
> The 3 August sweep searched for the departing retailer and for the retailer count.
> It found both: the Branded Beauty references and the roster figure. On **the same
> page** it missed three further false claims, all of which had nothing to do with any
> retailer's name and so matched no search term:
>
> | Missed claim | Why the search could not see it |
> |---|---|
> | *"Save up to around 25% on a comparable beauty routine"* (hero, above the fold) | A savings figure. Names no retailer. |
> | *"Your routine, May"* with three hand-written prices and a £49.44 total | A dated price example. Names no retailer. |
> | *"We factor in each retailer's free delivery threshold"* | A mechanism claim, wrong for one retailer. Names no retailer. |
>
> **The lesson is about the search terms, not the sweeper.** A departure sweep asks
> "where do we name this retailer?" and that question cannot reach a claim about
> savings, a price frozen three months ago, or a description of how the optimiser
> works. Those claims go stale on their own schedule, unrelated to any departure.
>
> **So the copy sweep needs a second half that is not departure-driven.** Grep for the
> *shapes* rather than the names: a percentage next to the word save, a currency
> figure in hand-written markup, a month name, and any sentence asserting what the
> optimiser accounts for. Run it on a calendar, not on a departure, because nothing
> about a departure causes those claims to rot and nothing about them will surface on
> its own.

**This was missed on 27 July 2026 and went unnoticed for eight days.** After Superdrug
was retired, `public/about.html` continued to claim *"Currently live across 10 UK
retailers"* over a list that **still included Superdrug** and **omitted three live
retailers** (Gorgeous Shop, Atelier De Glow, Perfume Click). The page is in the sitemap
at priority 0.4, so the claim was indexed. It was found on 1 August only because the
Branded Beauty closure prompted someone to look — the same way the 450 brand-page 404s
were found. **Same class: an undecided side effect of a retirement, not a decision.**

Nothing detects this. There is no test, no lint, no query that compares copy against
`retailers`. It is a manual step and must stay on the list.

**Sweep these, every retirement:**

| Surface | File | What to check |
|---|---|---|
| Homepage logo strip | `public/index.html` (~line 288) | hardcoded `<span class="hero-trust-card">` per retailer; **not data-driven**, does not read `retailers.active` |
| **Homepage demo basket** | **`public/index.html`, the `demo-card` block** | `basket-retailer` names AND every figure. Named "Boots + Superdrug" for 13 days after r12. Rebuilt 2026-08-01 as Escentual + Boots with real catalogue prices; the block carries its own comment explaining that it is hand-written, point-in-time, refreshed by nothing, and that naming retailers is what makes it break at every departure. **Changing the retailer means recomputing all nine figures**, not just swapping the name — the leg subtotals, both single-retailer totals and both savings lines all move together, and they are shown on the card so a reader can check them. |
| **Partner list and count** | **`public/about.html`** | **the `<ul>` FIRST, then the count sentence. VERIFY THE LIST, NEVER THE COUNT** — on 15 Aug the count was correct and the eleven names were wrong (item 121). Also check the maintenance comment at ~265-279; it is itself stale. |
| **Partnerships stat grid** | **`public/work-with-us.html` (~lines 264-280)** | **ADDED 15 Aug 2026, after being absent from this table while carrying four wrong figures — item 121.** Four hand-written stats: retailer count, products tracked, comparison count, and a `~25%` savings claim that is the figure removed from the homepage on 3 Aug. Indexed via `/partners.html` → `/work-with-us`. |
| Article price tables | `public/articles/*.html` | hand-written, point-in-time, nothing refreshes them |
| Meta / OG descriptions | `public/**/*.html` | retailer names appear inside `<meta name="description">` |
| Logo assets | `public/logos/`, `public/*.webp` | leave in place; harmless, and removal breaks nothing but risks a 404 if still referenced |

**Do NOT remove the retailer's hostname from `next.config.js` `images.remotePatterns`.**
Retired retailers keep their `retailer_prices` rows, and product images still resolve
through that CDN. Removing the pattern breaks images on every product the retailer
carried.

### Step 6 — Regenerate `GONE_IDS` ON THE DAY (added 2026-08-09, after it was missed once)

**Do this the same day you flip `retailers.active`, not on the following Sunday.**

`lib/superdrug-removed.ts` holds `GONE_IDS`, a list of product ids compiled into the edge
middleware, which serves **HTTP 410 Gone** for each. 410 is the strongest "permanently
deleted" signal there is, and it is correct for a product with no live offer and wrong for
anything else.

> **IT WAS ALREADY WRONG ON THE DAY IT SHIPPED.** The list was generated **19 July**. The
> flip was **27 July**. Its own header said to regenerate right before the flip; that was
> not done. Perfume Click was onboarded **24 July** — inside the gap — and matched 9,129
> products on day one, thousands of which had been Superdrug-only when the list was
> frozen.
>
> Result: **3,894 live, in-stock products served 410 for thirteen days**, 3,761 of them
> Perfume Click. Not decay — no product was deleted or renumbered. A retailer arrived
> between the list being generated and the list being used, and nothing recomputed it.

**THE TRIGGER IS RETAILER LIFECYCLE, NOT TIME.** `.github/workflows/gone-ids-drift.yml`
runs weekly and opens a PR on drift, but **weekly is a floor, not the right signal**. Every
onboarding and every retirement changes which ids belong in the list, and a departure is
precisely when it changes most. Waiting for the scheduled run means up to seven days of
410s on live products.

```
gh workflow run gone-ids-drift.yml          # same day as the flip, then merge the PR
```

**Both directions matter and they are not symmetrical.**

- **Ids REMOVED** are live products currently being 410'd. Urgent. They return 200 on
  deploy — nothing caches the 410 (`max-age=0, must-revalidate`) — but index position lost
  to a multi-day 410 comes back slowly, so resubmit the affected URLs.
- **Ids ADDED** are newly orphaned and should 410. Sanity-check against a failed import
  first: an import failure orphans products that are not actually gone, and baking that
  into middleware turns a transient outage into a de-indexing.

**If the drift check fails on a large delta, that is the guard working.** A retirement will
legitimately move thousands of ids, so expect to raise `fail_threshold` for this run
deliberately — and only once the number has been reconciled against the flip you just
performed.

### Step 7 — Supply-side barcode loss (added 2026-08-15, first departure where it exists)

**Every departure before this one predated the barcode work. Atelier De Glow (r29) is the
first retirement where this consequence is real, which is why no earlier entry mentions it
and why its absence from steps 1–6 is not an oversight to apologise for.**

> **THE DEPARTING RETAILER'S BARCODES ARE NOT ABOUT THE DEPARTING RETAILER'S PAGES.**
> Steps 1–4 all ask what happens to products the retailer sold. This asks what happens to
> **other retailers' matching**, and the answer has nothing to do with the departing
> retailer's catalogue, traffic or URLs.

`ean_product_index` is what tier 1 resolves against. Its predicate:

```sql
WHERE ean_normalised IS NOT NULL AND product_id IS NOT NULL
  AND r.active AND COALESCE(c.enabled, false)
```

`r.active` is in there, so **flipping the departure flag empties the departing retailer
out of the index in the same statement that retires it.** Nothing else has to run.

#### COUNT THE INDEX ROWS, NOT THE IN-STOCK ROWS

**There is no `in_stock` filter in that view.** Out-of-stock rows carrying barcodes are in
the index today and leave with the rest, so the in-stock row count — the number every
other step in this runbook is measured in — is the wrong denominator here and is smaller
than the truth.

| r29, 15 August 2026 | |
|---|---:|
| in-stock rows carrying barcodes (**the wrong number**) | 516 |
| **distinct codes actually leaving `ean_product_index`** | **547** |
| **of those, sole-supplier — no other active+enabled retailer provides them** | **67** |
| the same measured in-stock-only (**also the wrong number**) | 61 |

**Use 67 AS THE LOSS.** The in-stock-only figure of 61 understates by exactly the 31
out-of-stock barcoded rows that were never counted, so 67 is the right sole-supplier number.

> **CORRECTED 16 AUGUST 2026 AT THE ATELIER FLIP, AFTER THE WRONG SENTENCE WAS USED THREE
> TIMES.** "547 codes leave `ean_product_index`" is FALSE. 547 is the departing retailer's
> CONTRIBUTION. Measured at the flip: **480 of them stayed**, supplied by other retailers,
> **67 disappeared**, and the index shrank by **72 pairs**.
>
> **A DEPARTING RETAILER'S CONTRIBUTION AND THE INDEX'S LOSS ARE DIFFERENT NUMBERS, AND THE
> DIFFERENCE IS THE CORROBORATION.** They coincide only for a retailer whose every barcode
> is sole-supplied, which is not a real retailer.
>
> The query below already computes the right figure — `sole_supplier` is a separate count for
> exactly this reason. **It was the prose around it that was wrong.** Report the
> sole-supplier number as the loss and the contribution as context, never the other way
> round.

#### THE 67 SPLIT INTO TWO POPULATIONS AND ONLY ONE OF THEM MATTERS

| | codes | what happens |
|---|---:|---|
| point at a product that **also leaves** the catalogue | 48 | code and page go together. **Nothing can arrive to mismatch.** Not a problem. |
| **point at a product that SURVIVES the flip** | **19** | **the page stays live and its barcode bridge is gone.** |

> **The 19 are the finding.** A future feed row carrying one of those codes can no longer
> tier-1 resolve to the product that is still sitting there. It falls to tier-2 name
> matching or **creates a duplicate of a product we already have a live page for** —
> which is item 96's population, arrived at from the supply side instead of the data side.

The failure is silent and deferred: nothing breaks at the flip, and the cost is paid the
next time any retailer's feed happens to carry one of those 19 codes. **No job reports it
and no query will surface it after the fact**, because a duplicate created this way looks
identical to a duplicate created any other way.

#### THE QUERY, PARAMETERISED ON THE DEPARTING ID

Definition matches the house sole-supplier metric — `fmb_quality_snapshot_write` §5,
migration `20260815100400`, *distinct active+enabled retailers per code = 1*. **Do not
invent a second one**; same-sounding numbers with different retailer predicates are what
`metrics_quality_weekly` exists to stop.

```sql
WITH qual AS (   -- exactly ean_product_index's retailer predicate
  SELECT r.id FROM retailers r
  LEFT JOIN retailer_import_config c ON c.retailer_id = r.id
  WHERE r.active AND COALESCE(c.enabled, false)),
leaving AS (     -- every code the departing retailer supplies. NO in_stock filter.
  SELECT DISTINCT rp.ean_normalised AS ean, rp.product_id
    FROM retailer_prices rp
   WHERE rp.retailer_id = <DEPARTING_ID> AND rp.ean_normalised IS NOT NULL
     AND rp.product_id IS NOT NULL),
sole AS (
  SELECT * FROM leaving x WHERE NOT EXISTS (
    SELECT 1 FROM retailer_prices rp JOIN qual q ON q.id = rp.retailer_id
     WHERE rp.ean_normalised = x.ean AND rp.retailer_id <> <DEPARTING_ID>))
SELECT count(*) AS codes_leaving_index FROM leaving
UNION ALL SELECT count(*) FROM sole                                    -- sole-supplier
UNION ALL SELECT count(*) FROM sole WHERE EXISTS (                     -- ...product survives
  SELECT 1 FROM retailer_prices rp JOIN retailers rr ON rr.id = rp.retailer_id
   WHERE rp.product_id = sole.product_id AND rr.active AND rr.id <> <DEPARTING_ID>);
```

#### THE FLEET LOSES IDENTIFIER QUALITY, AND IT DOES NOT SHOW UP IN THE SHARES

**Do not assess this by looking at the fleet composition, because the fleet composition
will tell you nothing happened.** Removing 547 codes from 77,552 moves the index's Korean
GS1 share 13.54% → 13.47% and its 12-digit share 22.32% → 22.34%. **Both are noise.**

The loss is that **r29 was the only feed in the fleet whose barcode field was effectively
all manufacturer-issued** — 544 of 547 Korean GS1 880, **one** 12-digit reseller code,
99.5% / 0.2%. Re-measured 15 August against every active+enabled retailer:

| retailer | barcodes | 12-digit reseller | Korean 880 | reseller % |
|---|---:|---:|---:|---:|
| **Atelier De Glow** | 547 | **1** | 544 | **0.2** |
| YesStyle | 13,789 | 360 | 7,886 | 2.6 |
| Stylevana | 6,396 | 2,559 | 3,087 | **40.0** |
| Boots | 21,861 | 6,304 | 553 | 28.8 |
| Beauty Bay | 7,922 | 3,112 | 524 | 39.3 |
| Niche Beauty | 8,889 | 3,296 | 187 | 37.1 |
| **fleet** | 103,301 | 24,230 | 13,618 | 23.5 |

**What that bought us, concretely: 77 products carry an Atelier 880 code alongside a
Stylevana 12-digit reseller code.** On each of those, Atelier was the manufacturer-code
witness — the row that settles which of the two codes is the real identifier, which is
exactly the judgement item 104 had to make by hand. **After the flip nothing arbitrates
them.**

Redundancy is mostly but not wholly covered, and the mitigation is worth recording next to
the loss: **YesStyle shares 443 of the 547 codes and is itself only 2.6% reseller.**
Stylevana shares 156, Perfume Click 78, Beauty Bay 70, Boots 53. So the fleet keeps a
clean-ish Korean reference; it stops having a spotless one.

> **The general rule for the next departure: a small retailer can be the fleet's best
> source of something.** r29 was 553 rows — 0.5% of the catalogue and the second-smallest
> live retailer — and the highest-quality identifier feed we had. **Row count does not
> rank a retailer's value as a source**, and every count in steps 1–4 ranks by rows.

### Step 8 — Brand pages that go to zero (added 2026-08-15)

**A product leaving the catalogue is step 1. A brand leaving the catalogue is not, and
nothing in steps 1–7 reports it.** This is the same class as the 450 brand-page 404s: an
undecided side effect of a retirement rather than a decision.

For r29, **three `normalised_brand` values drop to zero live products — and they fail in
three different ways. Only one is a real loss, and only two are pages at all.**

| `normalised_brand` | live now | live after | its slug | what actually happens |
|---|---:|---:|---|---|
| **`arocell`** | 6 | **0** | `/brands/arocell` | **REAL WHOLE-BRAND LOSS.** Sole page, all six products Atelier-only. This one needs a 301 or a 410. |
| `clear dea` | 1 | **0** | `/brands/clear-dea` | **A page zeroes; the brand does not leave the site.** `cleardea` is the same brand under a different normalisation and keeps **19** products at `/brands/cleardea`. |
| `tia'm` | 1 | **0** | `/brands/tiam` | **NOT A PAGE OF ITS OWN.** `brandSlug()` strips apostrophes, so `tia'm` and `tiam` produce the **same slug**. The URL survives either way. |

> **THE NORMALISATION-SPLIT CAVEAT: A ZERO IN THAT LAST COLUMN IS NOT A PAGE LOSS UNTIL
> YOU HAVE CHECKED THE SLUG.** Two of these three needed no action and one of them is not
> even addressable.

**Resolve every zero to a slug before deciding anything**, because `normalised_brand` and
the page URL are not one-to-one in either direction:

- **`brandSlug()` is applied to `normalised_brand`, not to `brand`** — `findBrandBySlug`
  matches `brandSlug(row.normalised_brand) === slug` and every downstream query is
  `.eq('normalised_brand', …)` (`lib/brand-queries.ts:24-64`).
- **It strips apostrophes and punctuation**, so distinct `normalised_brand` values can
  collide on one slug. `tiam` and `tia'm` both slug to `tiam`. **`findBrandBySlug` returns
  the first match it encounters, so which of the two a visitor sees is unspecified** — a
  pre-existing latent bug this departure brushes against rather than causes. Do not fix it
  inside a retirement; file it.
- **It does not strip spaces to nothing** — `clear dea` → `clear-dea` and `cleardea` →
  `cleardea` really are two URLs for one brand.

**So a 301 for `/brands/clear-dea` points at `/brands/cleardea`** — the same brand under a
different normalisation. A correct redirect that also quietly documents a normalisation
bug nobody has filed.

```sql
-- GROUP BY normalised_brand ALONE. See the warning below before changing this line.
SELECT p.normalised_brand,
       min(p.brand)            AS a_spelling,
       count(DISTINCT p.brand) AS brand_spellings,
       count(*)                AS live_now,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM retailer_prices rp JOIN retailers rr ON rr.id = rp.retailer_id
          WHERE rp.product_id = p.id AND rr.active AND rr.id <> <DEPARTING_ID>)) AS live_after
  FROM products_active p
 WHERE p.normalised_brand IN (
   SELECT DISTINCT pr.normalised_brand FROM products pr
    JOIN retailer_prices rp ON rp.product_id = pr.id
   WHERE rp.retailer_id = <DEPARTING_ID> AND pr.normalised_brand IS NOT NULL)
 GROUP BY 1 ORDER BY live_after, live_now;
```

> **DO NOT ADD `p.brand` TO THE `GROUP BY`. IT MANUFACTURES BRANDS THAT ARE NOT LOSING
> ANYTHING.** Caught 15 August 2026 by running both versions — the grouped-by-brand
> variant reported **four** zeroing brands for r29 and the correct one reports **three**.
>
> The phantom was **Colorgram**. Product 127480 is spelled `Colorgram` and was Atelier-only;
> its ~90 siblings are spelled `colorgram` and are YesStyle and Stylevana. **Same
> `normalised_brand`, therefore the same brand page**, which keeps ~90 products and is
> completely unaffected. Grouping by `brand` splits one page into two rows and one of the
> halves reads as a total loss.
>
> **`brandSlug()` derives the page URL from a lowercased, punctuation-stripped brand, so
> the page is keyed on the normalised value. Group on the thing the page is keyed on.**

#### THE CHECK HAS TWO HALVES AND THE SECOND IS THE ONE THAT GETS SKIPPED

1. **Run the query** to find the `normalised_brand` values that zero. One dispatch.
2. **Resolve each to its slug by hand** and establish which of three things happened —
   a brand left, a page left, or nothing left.

**All three of r29's surprises lived in the second half**, and the query cannot do any of
it: it has no notion that `clear dea` and `cleardea` are one brand, or that `tia'm` has no
URL of its own. Reporting three whole-brand losses would have been wrong by a factor of
three, and the 301 target, the GSC resubmission and whether it is worth telling anyone all
differ across the three cases.

**Every retirement will produce a different mix**, because the mix is a property of how
that retailer's brand strings happen to normalise, not of the retirement.

### Two worked examples, and the test that separates them

**Added 10 August 2026.** A departure has two shapes and they get different treatment. The
test is one question:

> **Can this retailer return without a new approval?**

| | **Superdrug (r12)** — retained | **Skin Cupid (r7)** — closed |
|---|---|---|
| What happened | programme paused; could reappear on AWIN with the same catalogue | **programme closed** in June; a return needs fresh AWIN approval |
| Price rows | **29,547 retained**, all flipped `in_stock = false` | **removed**; 0 live rows today |
| `retailers` row | **kept** | **kept** |
| `retailer_import_config` | kept, `enabled = true` | kept, `enabled = false` |
| Backups | n/a — rows retained in place | `retailer_prices_skincupid_backup` (594 rows) |
| Reason recorded? | **yes**, in this document | **it was not** — see below |

**Both keep their `retailers` row, and that is deliberate.** Deleting it cascades
`retailer_import_config` and erases the evidence the retailer was ever integrated.
`scrape_log` also holds the import history — 11 runs for Skin Cupid — and the backup tables
carry a `retailer_id` column pointing at it. A retirement is not an un-integration.

#### THE SKIN CUPID LESSON IS ABOUT THE RECORD, NOT THE ROWS

Skin Cupid's price rows were removed at some point before August 2026 and parked in **two
identical 594-row backup tables**, `retailer_prices_skincupid_backup` and
`..._backup_2`, verified byte-identical on the compared columns. **Neither carries a table
comment and no document says why the rows went.**

The consequence surfaced on 10 August 2026, when a deletion was proposed for rows that had
already been deleted:

```
live rows, retailer_id = 7                     0
live rows matching any backup row id           0
backup vs backup_2 identical                   YES
products referenced by the backup, still alive 118
  ...of those, with no live offer at all         3
```

**The decision had already been taken and executed, and was about to be taken again**
because nothing recorded it. That is the cost of an undocumented retirement: not the rows,
which were fine, but a second decision cycle spent rediscovering the first.

**So the rule for a closed programme:**

1. Back up the price rows to ONE table named for the retailer and the date.
2. **Comment that table at creation** with the programme status, the date, and whether a
   return needs fresh approval.
3. Delete the live rows.
4. Keep `retailers` and `retailer_import_config`, with `enabled = false`.
5. Record the closure in this document, next to the examples above.

Step 2 is the one that was skipped, and it is the cheapest of the five.

#### Orphan check before deleting price rows

Removing a retailer's rows can leave products with no offer at all. Those are different from
products that merely lose one retailer, and they need counting before the delete, not after:

```sql
select count(*) from products p
where p.id in (select product_id from <backup_table>)
  and not exists (select 1 from retailer_prices rp where rp.product_id = p.id);
```

For Skin Cupid the answer is **3 of 118**, and all three are already invisible —
`products_active` requires an offer at an ACTIVE retailer, so a product with no offer at all
cannot appear. **Deleting the rows changed nothing anyone could see**, which is why it was
safe, and is the thing to establish before any equivalent delete rather than assume.

### The same class, found the same way: delivery terms (2026-08-01)

**Retailers 23 to 28 all had NULL `delivery_threshold` and `delivery_cost`. Everything
before and everything after was populated.** Boots, The Organic Pharmacy, Beauty Bay,
Beauty Flash and Debenhams — five in a row, 54% of in-stock rows, with the largest
retailer first in the batch.

**A manual, out-of-band step was skipped five consecutive times and nothing caught it.**
No migration ever set the columns, there was no default, and there was no constraint. The
only thing standing between the gap and the user was `RoutineBuilder`'s `?? '25'` /
`?? '3.95'` fallback, which silently invented delivery figures and presented them as exact
basket totals. It went unnoticed partly because the invented Boots figure happened to be
exactly right.

**The defect was absence, not decay. State it that way.** All eleven live retailers were
verified against their own sites on 2026-08-01. Of the six that already held values, four
were exactly right — Stylevana, Gorgeous Shop, Atelier De Glow, Perfume Click — YesStyle
was out by ten pence, and Escentual was wrong on both fields. **Five missing, one wrong,
one trivially off.** Entered values were largely sound; what failed was entering them at
all. An earlier draft of this section implied general unreliability and that reading is
wrong — it would point remediation at re-auditing good data instead of at the missing
constraint, which is the actual cause.

**Escentual is the exception worth learning from, because it was detectable without
leaving the database.** It stored a non-zero threshold with a zero cost — free above £25
and free below it — which no retailer means. That shape is self-contradictory on its face.
Branded Beauty (6) and Skin Cupid (7) still carry it; both are retiring or inactive.
**Treat threshold-with-zero-cost as unverified, never as free delivery.**

**The `retailers_delivery_shape` CHECK added on 2026-08-01 is what stops the sixth.** A
retailer can now only be `tiered` (both values), `flat` (cost, no threshold) or `unknown`
(neither) — and `unknown` is now a state someone must choose, visible in a query, rather
than the silent default of forgetting. Onboarding a retailer without delivery terms no
longer produces a plausible-looking wrong number; it produces a row that says it does not
know. **That is the difference between this and the copy sweep above: the delivery gap now
has a mechanism, the copy sweep still does not.**

**Also sweep for retailers that were never partners.** A false claim about who we compare
is worse than a stale one. Cross-check every retailer name in copy against the `retailers`
table; anything not in it is either editorial market commentary (legitimate) or a claim we
cannot support (not). See the 2026-08-01 sweep results for the distinction.

## Verified state (live DB, r29 active)

| Bucket | Count |
|---|---|
| `products_active` total | 100,231 |
| Products touching Superdrug (r12) | 29,541 |
| **True live orphans** (r12-only AND in `products_active`) | **24,484** |
| r12-only but already not indexable | 63 |
| Survive with another retailer (in `products_active`) | 4,949 |
| ...of which rescued by Atelier De Glow r29 (have both r12+r29) | 315 |
| Survive but no in-stock offer elsewhere (render OOS, not orphaned) | 67 |

The 24,484 is already net of r29's rescue. r29 has 502 price rows; 315 attach to
existing Superdrug products (those are survivors, not orphans).

## Why the naive flag-flip is wrong

`products_active` today requires only `EXISTS (any retailer_prices row)` — no
`in_stock`, no `retailers.active`. So `UPDATE retailers SET active=false WHERE id=12`
alone leaves all 24,484 orphans IN `products_active` → thin "No retailer prices"
200 pages, still in the sitemap, still inflating retailer counts/savings on
category/brand pages. We fix the view so the flag flip actually removes them.

---

## Step A — Redefine `products_active` to require an ACTIVE retailer (reversible)

Migration (apply via MCP `apply_migration`; `supabase db push` is blocked by history drift).
Column list is verbatim from the current definition; only the `EXISTS` changes.

```sql
-- 20260719_products_active_require_active_retailer.sql
CREATE OR REPLACE VIEW products_active AS
 SELECT id, name, brand, category, image_url, ean, created_at, ingredients, concerns,
        subcategory, normalised_brand, canonical_size, match_key, tags, shade, product_type,
        top_category, merged_into, merged_at, description, search_vector, amazon_asin
   FROM products p
  WHERE merged_into IS NULL AND parent_product_id IS NULL AND image_url IS NOT NULL
        AND image_url <> ''::text
        AND EXISTS (
          SELECT 1 FROM retailer_prices rp
          JOIN retailers r ON r.id = rp.retailer_id
          WHERE rp.product_id = p.id AND r.active
        );
```

Bonus: permanently fixes the thin-page bug for any future inactive retailer.

**Pre-flight before applying (must run, must be ~0 surprises):**
```sql
-- How many products would leave products_active from the VIEW CHANGE ALONE,
-- i.e. products whose every retailer_prices row is from an already-inactive
-- retailer (Superdrug is still active here, so this should be small).
SELECT count(*) FROM products p
WHERE merged_into IS NULL AND parent_product_id IS NULL
  AND image_url IS NOT NULL AND image_url <> ''
  AND EXISTS (SELECT 1 FROM retailer_prices rp WHERE rp.product_id=p.id)
  AND NOT EXISTS (
    SELECT 1 FROM retailer_prices rp JOIN retailers r ON r.id=rp.retailer_id
    WHERE rp.product_id=p.id AND r.active);
```
```sql
-- Perf sanity: the view is hot. Confirm the join uses the retailer_prices(product_id)
-- index and stays cheap. Compare buffers/time vs the pre-change view on a mega-category.
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM products_active WHERE top_category = 'Skincare';
```

The view change is a **no-op until r12 is flipped** (all current sole-retailers are
active), so it can be applied and verified first with zero user-visible change.

## Step B — Snapshot orphans, then flip the flag

```sql
-- Auditable backup of the AUTHORITATIVE drop set: products that leave products_active
-- when r12 goes inactive = live now via an active retailer, but Superdrug is their ONLY
-- active retailer. Active-qualified on purpose: a product with r12 + an inactive
-- secondary (Amazon 9 / eBay 10) still drops and must be captured. Run while r12 active.
CREATE TABLE superdrug_orphan_snapshot_<date> AS
SELECT p.id, p.brand, p.normalised_brand, p.top_category, p.subcategory,
       (SELECT rp.url FROM retailer_prices rp
        WHERE rp.product_id = p.id AND rp.retailer_id = 12 LIMIT 1) AS superdrug_url
FROM products p
WHERE p.merged_into IS NULL AND p.parent_product_id IS NULL
  AND p.image_url IS NOT NULL AND p.image_url <> ''
  AND EXISTS (SELECT 1 FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id
              WHERE rp.product_id = p.id AND r.active)                       -- live now
  AND NOT EXISTS (SELECT 1 FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id
                  WHERE rp.product_id = p.id AND r.active AND r.id <> 12);   -- no OTHER active retailer
-- expect ~24,484 rows; this count MUST equal (pre-flip products_active) - (post-flip products_active)
```
`scripts/regen-superdrug-gone-ids.mts` computes this same set and rewrites `GONE_IDS`
in `lib/superdrug-removed.ts` (preserving the curated REDIRECTS + GONE_HTML). Run it,
commit the diff, and deploy BEFORE flipping.

Then the go-dark trigger (do this when ready to start monitoring):
```sql
UPDATE retailers SET active = false WHERE id = 12;
```
After this, orphans leave `products_active` → drop from sitemap → 404 via the
existing `resolveCanonicalKeeper`→`notFound()` path. Reversible: `active=true` repopulates.

Optional later data hygiene (NOT the go-dark mechanism, irreversible, clear
`price_history` FK rows first): delete r12 `retailer_prices`.

## Step C — Active-retailer filtering on listing/related queries

These 8 sites count/surface `retailer_prices` with **no active filter**, so they'd
keep counting Superdrug after the flip. Uniform fix: one shared helper + a guard.

New `lib/retailers.ts`:
```ts
import { cache } from 'react';
import { supabase } from './supabase-server'; // match the client these modules already use
export const getActiveRetailerIds = cache(async (): Promise<Set<number>> => {
  const { data } = await supabase.from('retailers').select('id').eq('active', true);
  return new Set((data ?? []).map(r => r.id));
});
```

Sites (diff shape):
- **Embed retailer-count** (`lib/queries.ts` ~184, `lib/brand-queries.ts` ~90,
  `lib/subcategory-queries.ts` ~71): in the accumulation loop add
  `if (!active.has(rp.retailer_id)) continue;` before `retailerIdSet.add(...)`.
- **Direct price fetches** (`lib/queries.ts` featured ~326, `lib/brand-queries.ts`
  ~211, `lib/subcategory-queries.ts` ~206, `lib/product-queries.ts`
  getMoreFromBrand ~237 + fetchRelated ~306): add `.in('retailer_id', [...active])`
  to the `.from('retailer_prices')` query (or the same JS guard).

`getRetailerOffers` (`lib/product-queries.ts` ~125) already filters `active=true` —
no change. This can ship BEFORE the flag flip (harmless while r12 still active).

## Step D — Routing: 410 tail + curated 301 (no blanket redirect)

No `middleware.ts` exists today. Create one matching `/product/:id`:

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { GONE_IDS, REDIRECTS } from './lib/superdrug-removed'; // generated from snapshot + GSC
export const config = { matcher: '/product/:id*' };
export function middleware(req: NextRequest) {
  const m = req.nextUrl.pathname.match(/^\/product\/(\d+)/);
  if (!m) return NextResponse.next();
  const id = Number(m[1]);
  const to = REDIRECTS[id];
  if (to) return NextResponse.redirect(new URL(to, req.url), 301);
  if (GONE_IDS.has(id)) {
    return new NextResponse(GONE_HTML, { status: 410, headers: { 'content-type': 'text/html' } });
  }
  return NextResponse.next();
}
```

- `GONE_IDS`: the snapshot orphan ids MINUS the curated-301 set. Generated into
  `lib/superdrug-removed.ts` as a compact Set (~150KB for 24k numeric ids; within
  the edge bundle limit). Regenerated per removal batch.
- `REDIRECTS`: the few hundred orphans with real GSC clicks/impressions → their
  brand page (`/brands/{slug}`). Pulled from GSC top pages; NOT a blanket map.
- Middleware runs before the ISR cache, so it also **immediately stops stale
  Superdrug-price 200s** on orphan pages (faster than waiting on revalidation).

Bad/never-existed ids are untouched → keep their normal 404. Curated 301 targets
must be pages that survive the removal (verify brand still has live inventory).

## Step E — Revalidation

> **VERIFYING IMMEDIATELY AFTER REVALIDATING MEASURES THE REQUEST THAT DOES THE WORK, NOT THE
> RESULT.** Added 16 August 2026, after it produced a false pass twice in one evening.
>
> `/api/revalidate` invalidates; it does not regenerate. **The next request regenerates, and
> is typically served the stale render while doing so.** So the check anyone following this
> runbook performs — hit the page right after firing the call — is the one request guaranteed
> to show the old page. `/brands/arocell` reported 200 twice that way and settled to 404 on
> the third.
>
> **RE-CHECK UNTIL IT SETTLES; DO NOT WAIT A FIXED TIME.** Five consecutive GETs returning
> the same status is what established it, and a fixed pause is guesswork either too short or
> needlessly long. **`x-vercel-cache: MISS` with `age: 0` does NOT mean fresh data** — it
> means the CDN did not serve it, which is true of the regenerating request too.

Orphans are handled by middleware (410), so they don't need revalidation. Revalidate
the pages whose CONTENT changes:
- ~4,949 survivor `/product/{id}` (drop Superdrug from their comparison) via `fmb_revalidate_paths`.
- Brands touched by Superdrug via `fmb_revalidate_brand_slugs`.
- Affected category/subcategory landing pages (retailer counts/savings change).
- Sitemap parts refresh on their own 1h `revalidate` (or force).

Batch the `fmb_revalidate_paths` calls (POSTs to `/api/revalidate`).

---

## Execution order (over several days, monitored)

1. **[DONE]** Apply Step A view change + pre-flight/EXPLAIN. `products_active` = 100,231 unchanged.
2. **[DONE]** Ship Step C (#105) + Step D (#106) — both inert on main.
3. **[TODO — user]** Create a Vercel Edge Config store, connect to project (sets `EDGE_CONFIG`),
   add key `superdrug_removed: false`. Confirm C+D are live and inert (see runbook).
4. **[TODO]** Regenerate GONE_IDS from the authoritative drop set
   (`scripts/regen-superdrug-gone-ids.mts`), populate curated REDIRECTS from GSC, commit + deploy.
5. **[TODO — the flip]** See runbook below.
6. Monitor GSC Coverage / soft-404 / Crawl stats for weeks. Roll back instantly (Edge Config
   false + `active=true`).
7. (Later, optional) hard-delete r12 `retailer_prices` for data hygiene.

## Flip runbook (Step B — zero-gap)

Pre-flip verify (C+D live, inert):
- A Superdrug-orphan `/product/{id}` still returns **200** with its offer (flag false).
- A merged id still **308**s to keeper; a shade child still **308**s to parent; a bad id **404**s.

Flip (do the two together — the zero-gap moment):
1. `UPDATE retailers SET active = false WHERE id = 12;`
2. Set Edge Config `superdrug_removed = true`.

Post-flip verify:
- Orphan `/product/{id}` → **410** (or **301** to brand page if curated).
- Survivor (e.g. an r29-rescued id) → **200**, Superdrug absent from its comparison.
- Merged → **308** keeper, shade child → **308** parent, bad id → **404** (all unchanged).
- Category/brand/subcategory retailer counts + featured savings no longer count Superdrug.
- Sitemap parts drop the orphan ids (1h `revalidate` or forced).

Then Step E revalidation, then monitor. Rollback = Edge Config false + `active=true` (both instant).

## Open checks before executing step 4+
- Pre-flight count (Step A) is small and expected.
- EXPLAIN confirms the view join stays cheap on mega-categories.
- Curated-301 targets all resolve to surviving pages.
- Edge middleware bundle with GONE_IDS is within Vercel's size limit.
