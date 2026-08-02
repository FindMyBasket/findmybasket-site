# Post-4-August work list

**Created:** 30 July 2026.
**Gate:** the Boots absence step-down decision, 4 August 2026. Nothing here starts before it.

> **This list is a correction, not a routine artefact.** It was created because the
> queue it records was being recited from memory across several days and **four of
> its six items existed nowhere in this repository** — not in a doc, a ticket, a
> migration comment or a commit message. A grep for the claims returned nothing.
>
> That is the absent-record class in `supabase/migrations/README.md` convention 9:
> a record believed to exist because discussing it at length produces the same
> familiarity as having written it. Nothing surfaces its absence, because there is
> no artefact to go stale.
>
> **Treat this file as the register from now on.** If an item is discussed and not
> written here, it does not exist.

## How to use this file

- **Every item carries a date and a reason it is blocked**, not merely the fact
  that it is. "Blocked until 4 August" without a why decays into "blocked" and
  then into nobody knowing whether it still is.
- **Boundaries are not tasks.** A dated change that moves a metric belongs in
  `platform_changes`. A piece of work belongs here. Two of the things in this
  queue are already boundaries; they are *referenced* below rather than copied,
  because duplicating them is how the register stops meaning one thing.
- **Items 1, 3, 4 and 5 have no detail in this repository.** They are recorded
  under the names they were given, with the detail marked as owed. That is
  deliberate: inventing a specification for them would reproduce the exact defect
  this file exists to correct. **The operator holds the detail; it needs writing
  down here before the work starts.**

---

## Tasks

### 1. Coalesce fix

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: OWED.** No occurrence of this item anywhere in the repository.

**Why blocked:** unknown until the detail is supplied. Recorded now so it is not
lost again; the blocking reason must be filled in before it is picked up.

---

### 2. Tier A drops

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: OWED.** The only repository match for "tier A" is `match_key tier A` in
`.github/workflows/feed-diag.yml:13`, which is about match-key tiers and is
**unrelated**. Do not read that as the record of this item.

**Why blocked:** presumed to touch the catalogue or the import path, which is what
the 4 August gate protects. Confirm before starting.

---

### 3. Memory reconciliation

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: OWED.** No occurrence anywhere in the repository.

**Why blocked:** unknown until the detail is supplied.

---

### 4. Standing rules

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: OWED.** No occurrence anywhere in the repository.

**Why blocked:** unknown until the detail is supplied. Note that brand and copy
standing rules are currently recorded only as a trailing paragraph in
`docs/dashboard-build-brief.md`; whether this item means consolidating those is
not established and should not be assumed.

---

### 5. `supabase_migrations` divergence: decide and record

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: complete.**

The Supabase migration history table stops at **`20260724102843`**. Every migration
since — the entire security remediation (#137–#140), the dashboard schema, all the
July `platform_changes` rows, the r12 brand-page boundary and the brand-norm check
— was applied via SQL rather than `apply_migration`, so **none of them is tracked**.

**Why blocked:** it is not urgent and it touches how the database would be
rebuilt, which is the wrong thing to change in the week before a decision that
rests on the database being stable.

**Why it matters:** in one scenario only. A PITR restore or a fresh branch replayed
through the CLI would replay up to 24 July and stop, silently omitting every
privilege revoke and every boundary row. The live database is correct; the
*reconstruction* path is not.

**Decision owed:** either backfill the history table to match the files, or record
deliberately that the files are the source of truth and the history table is not
used. Either is defensible. Leaving it undecided is the option that has already
been taken twice by default.

---

### 6. Record the bulk-`UPDATE` cost property

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: complete.**

**Any bulk `UPDATE` to `products` costs more than the touched columns imply.**
Two independent mechanisms, both verified 30 July 2026 by reading the catalogue:

1. **`search_vector` is a STORED generated column** (`attgenerated = 's'`) over
   `name`, `brand`, `product_type`, `description`. Postgres **recomputes a stored
   generated column on every row update, without dependency tracking** — so it
   re-runs `to_tsvector` even when none of its inputs changed, producing an
   identical value at full cost.
2. **`normalised_brand` is indexed** (`idx_products_match` leads on it), so an
   update touching it **cannot be a HOT update**. Index entries are rewritten
   across the table's indexes, including the GIN on `search_vector`.

**Trivial at 1,082 rows. Material at 100,000.** The outstanding case where this
would bite is the **cross-brand makeup-in-skincare sweep**.

**Why blocked:** it is documentation of a property, not a fix, and it belongs
alongside the sweep it affects rather than landing on its own before the gate.

---

## Amazon Creators API: three separate unlocks

**Added 31 July 2026**, from an entitlement assessment run against the live API.
Items 7, 8 and 9 below. Read this preamble first, because the three are easy to
collapse into one and they are not one.

**Three surfaces, three different results, verified by real calls:**

| Surface | Result | Item |
|---|---|---|
| Reporting | **ENTITLED.** `ListReports` returns `{reports: []}` — a 200 with an empty collection | 7 |
| Product data | `AssociateNotEligible` — the **three-qualifying-sales** gate | 8 |
| Feeds | `AuthorizationFailed` — a **separate entitlement**, being pursued | 9 |

**Items 8 and 9 are deliberately not one line.** They fail with *different errors*
against *different entitlements*, so they are two unlocks that may clear
independently and in either order. Feed access could be granted while the sales
gate is still shut, or the third qualifying sale could land while the feed
request is still outstanding. Merging them into "Amazon API access" would mean
one clearing while the line still reads blocked, which is how a cleared unlock
goes unnoticed.

> **The re-check mechanism lives OUTSIDE this repository, and that is the fragile
> part.** Working samples with a populated `.env`:
>
> **`~/Downloads/creatorsapi-nodejs-sdk/examples`**
>
> `sampleListReports.js` · `sampleGetReport.js` · `sampleListFeeds.js` ·
> `sampleGetItems.js` · `sampleSearchItems.js` · `sampleGetVariations.js` ·
> `sampleGetBrowseNodes.js`
>
> **Nothing in this repository references that directory**, so nothing here would
> break, warn, or fail a test if it were deleted — and `~/Downloads` is a
> directory people empty. It is recorded here because this file is the register:
> an unreferenced mechanism outside the repo is precisely the thing that gets
> recited from memory later. **Relocating it somewhere durable, with the `.env`
> handled as a credential rather than a file, is itself owed work.**
>
> The assessment these items come from is written up in
> `docs/dashboard-build-brief.md` §8, which is where the superseded "no usable
> earnings API" reasoning was corrected.

---

### 7. Re-run `ListReports` periodically to see whether reports appear

**Raised:** 31 July 2026 · **Blocked until:** not gate-blocked, see below
**Detail: complete, except cadence, which is OWED.**

`ListReports` **authenticates today and returns `{reports: []}`**. The
entitlement is live; the collection is empty. So this is not a question of
access, it is a watch for a state that **can change without anyone touching this
repository or being told**.

**Why it is on this list even though the 4 August gate does not technically bind
it.** It is read-only, outside the repo, and goes nowhere near the import path or
the catalogue, so the Boots step-down decision does not block it in the way it
blocks items 2, 5 and 6. It is sequenced after the gate because it is not urgent
and its consumer, Step 6 of the brief, is itself downstream. **Recorded honestly
rather than stamped "blocked until 4 August"**, per the rule at the top of this
file: a blocking reason that is not real decays into nobody knowing whether it
ever was.

**What is owed:** the cadence, and who or what runs it. A "periodic" re-check
with no interval and no owner is the same absent-record class this file exists to
correct — it reads as scheduled and is not. Weekly and monthly are both
defensible; **undecided is not**.

**What changes when a report appears:** the Amazon side of the Step 6 manual form
stops being the right answer. That is the whole reason the brief now marks that
form provisional.

---

### 8. Re-run the product samples if the three-sale gate clears

**Raised:** 31 July 2026 · **Blocked until:** the sales gate, not the 4 August gate
**Detail: complete.**

Product-data calls currently return **`AssociateNotEligible`**. The blocker is the
**three-qualifying-sales** requirement.

**Do not conflate this with the 200-tracked-sales-per-month milestone** in
§7 of the brief. They are different thresholds with different purposes, and the
milestone bar on the dashboard tracks the second one. Reading the dashboard's
milestone progress as progress toward *this* unlock would misdate it badly — the
brief records current volume as roughly 20 to 40 times off the 200 figure, while
this gate needs three.

**Why blocked:** the gate is external and commercial, not technical. Nothing in
this repository moves it. It clears when three qualifying sales land.

**Trigger to re-check:** confirmed qualifying sales reaching three. Re-run
`sampleGetItems.js` / `sampleSearchItems.js` from the directory above; a changed
error, or a 200, is the signal.

**Separate from item 9.** A different error against a different entitlement. This
one can clear while the feed request is still outstanding.

---

### 9. Amazon feed integration, if access is granted

**Raised:** 31 July 2026 · **Blocked until:** the feed entitlement is granted
**Detail: partial. The integration design is OWED; the access position is known.**

Feed calls currently return **`AuthorizationFailed`**. This is a **separate
entitlement** from product data, and **access is being actively pursued**.

**Why blocked:** we do not hold the entitlement. Until it is granted there is
nothing to build against, and the shape of what gets built is not knowable from
an error message.

**Separate from item 8**, and this is the line most likely to be wrongly merged.
`AuthorizationFailed` is not `AssociateNotEligible`: one is an entitlement we are
asking for, the other is a threshold we have to earn. **Either can clear first.**

**What is owed once granted:** whether an Amazon feed goes anywhere near the
existing import path. If it does, it inherits every constraint the 4 August gate
protects, and this item stops being a small one. **Do not assume it is a feed
importer like the AWIN ones until that is established** — it is being recorded
here under the name it was given, not under an architecture nobody has chosen.

**Trigger to re-check:** notification that access is granted, or
`sampleListFeeds.js` returning something other than `AuthorizationFailed`.

---

### 10. Rewrite the four Branded Beauty article price tables

**Raised:** 1 August 2026 · **Blocked until:** after 4 August
**Detail: complete.**

Four articles carried Branded Beauty as the "Best price" retailer in hand-written price
tables. On 1 August 2026 each received a dated `.stale-notice` block naming exactly which
rows, verdicts and recommendations it supersedes — **that is the interim fix, and it is
already shipped.** This item is the real one.

| Article | Branded Beauty role |
|---|---|
| `public/articles/clarins-best-price-uk.html` | 4 "Best price" rows, the everyday-price verdict, "Check Branded Beauty first", the £35 delivery advice, the live-pricing closer |
| `public/articles/elemis-best-price-uk.html` | 2 "Best price" rows, 2 table headers, 2 savings bullets |
| `public/articles/cosrx-best-price-uk.html` | 4 "Best price" rows, "Check Branded Beauty first" |
| `public/articles/k-beauty-uk-best-prices.html` | lowest-price claim, CosRx best-value verdict, 3 stockist mentions |

**What is owed:** rewrite the tables against live catalogue prices and re-rank without
Branded Beauty. Also resolve the non-partner names surfaced by the same sweep — John Lewis
(`clarins` ×2, `elemis` ×1 table row), Cult Beauty (`cosrx` ×4, `k-beauty` ×3), Space NK
(`elemis` ×1). These sit in price tables that imply we sourced the figures; we did not.

**Why blocked:** it is content work on indexed pages, it is not urgent because the notes
now carry the correction, and it competes for attention with the 4 August decision.

**Why the notes are not sufficient long-term.** They tell a reader the article is wrong
without making it right. A price guide whose headline recommendation is struck out at the
top is a worse page than one that simply says the current answer.

**The structural problem is worth fixing at the same time.** These tables are hand-written
and point-in-time, and **nothing refreshes them** — no job, no schedule, no import, no
reminder. They go stale the day they ship and only a person notices. If the rewrite
reproduces that shape, this item returns at the next retailer departure. Consider whether
the tables should read from the catalogue instead.

---

### 11. Make the optimiser read `delivery_model`

**Raised:** 1 August 2026 · **Blocked until:** after 4 August
**Detail: complete.**

**The data half shipped on 2026-08-01; this is the half that makes it mean anything.**
`retailers` now carries `delivery_model` (`tiered` / `flat` / `unknown`), real terms for
ids 8, 23, 24, 26, 27, 28, and a `retailers_delivery_shape` CHECK. The optimiser still
ignores all of it.

**Three changes:**

1. **Remove the four `?? '25'` / `?? '3.95'` fallbacks** in `app/app/RoutineBuilder.tsx` —
   lines 256-257, 289-290, 392-395. They fabricate delivery terms for any NULL and present
   the result as an exact basket total.
2. **Branch on `delivery_model`:** `tiered` as now; `flat` adds `delivery_cost` to every
   basket at every value; `unknown` is **excluded from delivery optimisation and never
   defaulted**. The first two are opposite behaviours that both used to arrive as NULL.
3. **Fix `lib/product-queries.ts:167-168`**, where `retailer.delivery_cost ? … : null`
   treats a genuine `0` as absent. Any retailer on free delivery has its terms erased
   before they reach the product page, which then renders no delivery line at all because
   lines 552 and 558 require both fields non-null.

**Why blocked:** it changes the optimiser, which is the core proposition, and the 4 August
Boots decision is four days out. The data landed early because it is data only and cannot
touch a GSC read; this cannot make the same claim.

**What stays wrong until it ships:** **Debenhams.** It is `flat` at £3.99 with no free
tier, but the fallback still reads its NULL threshold as £25, so **every Debenhams basket
over £25 is shown as free delivery and understated by £3.99**. This was a deliberate
choice on 1 August — one retailer wrong in one known direction, rather than five wrong in
several. It is not fixed and should not be described as such.

**Copy is deliberately unchanged too.** Four surfaces claim delivery optimisation across
all retailers (`about.html:241`, `index.html:367`, `index.html:491`,
`work-with-us.html:329`). After the migration four of five are true and only Debenhams is
structurally wrong, so softening the copy now and restoring it next week is churn.
**If this item slips past mid-August, revisit that decision** — the claim is only
defensible while the fix is imminent.

---

### 12. Does the delivery wedge actually bite? Search the catalogue.

**Raised:** 1 August 2026 · **Blocked until:** after 4 August
**Detail: complete. This is ANALYSIS, not a fix — nothing breaks if it never runs.**

**The question.** Does a 3–5 item basket exist in the live catalogue where the
**goods-optimal** split and the **delivery-optimal** split are *different arrangements*?
That is: where assigning every item to its cheapest retailer produces the wrong answer
once delivery is added, and a different assignment wins.

**The condition to search for.** The goods-optimal split must leave one leg **below its
retailer's threshold by a margin smaller than that retailer's delivery charge** — so that
moving an item across, or consolidating, costs less in goods than it saves in delivery.

**Why this is the question and not a smaller one.** `public/work-with-us.html:329` claims
*"Whole-basket optimisation including delivery. **No other UK platform does this.**"*
That claim is only load-bearing if ignoring delivery can give the wrong answer. If it
never can, the feature is real but inert, and the differentiator is narrower than the copy
says.

**Two arrangements that do NOT satisfy it**, both checked on 2026-08-01, recorded so they
are not re-proposed:

| Candidate | Why it fails the test |
|---|---|
| The live homepage demo (Escentual + Boots, £99.25) | Every leg and every single-retailer option clears its threshold. **No delivery is charged anywhere**, so the mechanism is satisfied and invisible. |
| The Mustela/Eucerin/Shiseido alternative (£68.79) | The split pays £3.50 and still wins — **but it wins on goods alone**, £65.29 vs £71.79. Delivery narrows the margin; it does not decide the outcome. |

**Search parameters**, from `retailers` as recorded 2026-08-01 (all eleven live retailers
observed against source):

| Retailer | Threshold | Charge below it |
|---|---|---|
| Boots 23, Beauty Flash 27, Gorgeous Shop 30 | £25.00 | £3.95 / £2.95 / £2.95 |
| Escentual 8, Beauty Bay 26, Organic Pharmacy 24 | £30.00 | £3.50 / £2.95 / £3.99 |
| Stylevana 11 | £39.00 | £3.79 |
| Atelier De Glow 29 | £40.00 | £3.49 |
| YesStyle 25, Perfume Click 31 | £50.00 | £3.95 / £2.95 |
| **Debenhams 28** | **none — `flat`** | **£3.99 on every basket** |

**Debenhams is the strongest candidate and should be searched first.** A retailer that is
never free is the case where ignoring delivery is most likely to pick it wrongly: it can
be cheapest on goods and still lose on every basket size, which is exactly the wedge.

**Three outcomes, each worth knowing, none of them a failure:**

1. **Found easily** → use it for the homepage demo. The mechanism finally gets
   demonstrated rather than asserted, on the one surface where that matters most.
2. **Found rarely** → the wedge is real but narrow. Worth knowing **before more copy is
   written around it**, because "no other UK platform does this" would then be true but
   rarely consequential, and the marketing should lead on something else.
3. **Not found** → the claim is defensible in principle and never bites in practice. That
   is a **strategic finding, not a demo problem**, and it belongs in front of whoever
   decides positioning rather than in a ticket about a hero block.

**Why blocked:** it is analysis and nothing depends on it this week; the 4 August decision
does not touch it in either direction.

**Independent of item 11.** This is a catalogue query against recorded delivery terms. It
does not need the optimiser fixed first, and its answer does not change what item 11 must
do. Run them in either order.

---

## Referenced, not duplicated: these are boundaries, not tasks

Both are already recorded in `platform_changes` with their sequencing in the row
description. They are listed here so the queue is complete, and deliberately **not**
restated, because a boundary and a task are different things.

| Item | Where it lives | Why it is after 4 August |
|---|---|---|
| **AWIN `product_GTIN` importer fix** | `platform_changes` id 3, `expected` | On the import path. Must not go near a deploy before the step-down decision is settled. Also in the brief §12, out of scope. |
| **Niche Beauty retailer go-live** | `platform_changes` id 4, `expected` | Parked behind the AWIN `product_GTIN` fix, so necessarily after it. |

If either acquires work that is not the boundary itself, that work gets its own
entry above and the boundary row stays where it is.

---

## Not on this list, and deliberately so

**The `normalised_brand` backfill runs tomorrow, 31 July, not after 4 August.** It
is not blocked by the gate: it touches `products.normalised_brand` only, is 1,082
rows, does not go near the import path, and the recurrence check that watches it is
already installed and red. Sequence is in
`supabase/migrations/20260730140000_catalog_health_brand_norm_check.sql`: confirm
the 09:45 capture is red, backfill, confirm the next capture goes green.
