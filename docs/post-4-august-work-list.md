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

## RUN ORDER: item 12 went first and is now CLOSED (3 August 2026)

**Item 12 ran on 3 August and returned "found easily".** The run order below is kept
because the reasoning for prioritising it was sound and is worth reusing, not because
the item is still pending. Everything it was placed ahead of — items 1 and 11, the
Niche Beauty go-live, The Fragrance Shop go-live — is unchanged and unblocked by the
result.

<details>
<summary>The original run-order note</summary>

**Set 3 August 2026.** Item numbers are identifiers, not a running order, and they
are cited from `dashboard-build-brief.md`, `superdrug-removal-plan.md`,
`partnership-tracker.md` and three migrations — so nothing is renumbered here.
Priority is stated instead.

**Item 12 (does the delivery wedge actually bite?) runs before items 1, 11, the
Niche Beauty go-live and The Fragrance Shop go-live.** It can run **the day after
the Boots decision**.

Why it jumps the queue:

- **It is analysis. It needs no deploy**, touches no import path, and cannot
  disturb the 4 August GSC read.
- **It is independent of everything it overtakes.** It does not depend on the AWIN
  coalesce fix (item 1), on the optimiser reading `delivery_model` (item 11), or on
  either pending retailer. None of them depend on it either. It is pure catalogue
  measurement against data that already exists.
- **Its answer changes what the others are worth.** Item 11 removes the delivery
  fallbacks so the optimiser models thresholds correctly. If the wedge never bites,
  that work is still correct but its value is much smaller than assumed, and the
  sizing should know that first.
- **The exposure is positioning, not copy**, and positioning is slower to correct
  than a paragraph. See item 12 for the full statement.

Nothing else in the run order changes.

</details>

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

**Read item 13 before deciding this one.** They are separate decisions but a single
scenario: the same replay that stops at 24 July also reinstates a dead AWIN feed id.
Choosing "the files are the source of truth" here makes item 13 strictly worse,
because it makes replay the sanctioned path.

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

> **The re-check mechanism lives OUTSIDE this repository.** Working samples with a
> populated `.env`:
>
> **`~/amazon-api-watch/sdk/examples`**
>
> `sampleListReports.js` · `sampleGetReport.js` · `sampleListFeeds.js` ·
> `sampleGetItems.js` · `sampleSearchItems.js` · `sampleGetVariations.js` ·
> `sampleGetBrowseNodes.js`
>
> **Nothing in this repository references that directory**, so nothing here would
> break, warn, or fail a test if it were deleted. It is recorded here because this
> file is the register: an unreferenced mechanism outside the repo is precisely the
> thing that gets recited from memory later.
>
> **Relocated 3 Aug 2026 — this item is CLOSED.** It was
> `~/Downloads/creatorsapi-nodejs-sdk/examples`, a directory people empty. Product-
> data access **cleared** the same morning (`GetItems` returns real data, shipped
> 12), which is what made it urgent: the credentials now *work*, and are worth
> stealing in a way they were not while every call returned `AssociateNotEligible`.
> The `.env` is now mode **0600** in a durable location.
>
> The "nothing references it" line above is true **of this repository only**.
> Outside it, `~/amazon-api-watch/check-amazon-api.sh` runs these samples daily at
> 08:30 via a LaunchAgent — one `SDK_DIR` variable, the single functional reference
> anywhere. That short list is why the move was cheap, and it will not stay short
> once the dashboard build starts calling product data.
>
> Keychain was considered and **declined** — rationale, and the entitlement
> evidence, in `~/amazon-api-watch/README.md`.
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

### 11. Make the optimiser read `delivery_model` — DONE, 3 August 2026

**Raised 1 August 2026. SHIPPED 3 August 2026.**

> **CLOSED.** All fallback constants removed; one shared rule; three-way branch.
>
> | Surface | Before | After |
> |---|---|---|
> | `RoutineBuilder.tsx` | four sites, `?? '25'` / `?? '3.95'` | `deliveryFor()` |
> | `send-routine-email` | three sites, **`|| 25` / `|| 3.95`** | `deliveryFor()` |
> | `product-queries.ts` | truthiness guard that skipped delivery | `deliveryFor()` |
>
> **The `??` versus `||` divergence was the strongest argument, not the duplication.**
> `delivery_cost || 3.95` turned a genuine £0 cost into £3.95, so the monthly email
> priced a zero-cost retailer £3.95 higher than the app did **for the same basket**.
> Two pricing paths disagreeing in production, masked only because that retailer was
> out of stock. Duplication was the mechanism; disagreement was the defect.
>
> **`unknown` behaves as decided:** goods stay visible, no delivered total is claimed,
> never ranked against a retailer whose delivery is known. A pair with either leg
> unknown is skipped rather than guessed. `deliveryFor` returns a discriminated union,
> so `unknown` cannot be silently coerced to zero.
>
> **All three exercise routes taken.** `lib/__tests__/delivery.test.ts` covers the
> branch with synthetic retailers, which is the only thing that tests it (zero active
> retailers are `unknown`). The Fragrance Shop will be the live transition. The
> `retailers_delivery_unknown` view makes the state visible so it is transitional by
> policy rather than by hope; it partitions cleanly today at 11 tiered + 1 flat + 0
> unknown = 12 active.
>
> **The mirror is guarded.** `lib/delivery.ts` duplicates
> `supabase/functions/_shared/delivery.ts` because the Next runtime cannot import a
> Deno module. A test imports both and fails on divergence, plus a test that fails if
> `?? 25` or `|| 3.95` reappears in either.
>
> **Verified as instructed, a Debenhams basket over £25:**
>
> ```
> leg £24.99   before +£3.95   after +£3.99   understated by £0.04
> leg £25.00   before +£0.00   after +£3.99   understated by £3.99
> leg £48.00   before +£0.00   after +£3.99   understated by £3.99
> ```
>
> **`public/index.html`'s claim is now accurate with no copy change**, as predicted.
>
> **Recommendation changes, re-measured after the fix, not carried forward: 160.**
> Of 1,943 Debenhams products with a live alternative, Debenhams was recommended on
> 1,427 and is now recommended on 1,267. Of the 745 legs at or above £25 it won 563
> before and wins 421 after. The other 1,267 keep Debenhams with a corrected total.
> None of the 13 saved routines change recommendation.
>
> **Two findings split out rather than folded in:** item 28 (a live bug on product
> pages, different cause) and item 29 (a fabricated savings baseline, deliberately not
> fixed).

**Original detail follows.**

> **A LIVE HOMEPAGE CLAIM IS INACCURATE UNTIL THIS LANDS.** Added 3 August 2026.
>
> `public/index.html` states: *"We factor in each retailer's free delivery threshold,
> so you always see the true total cost, not just the product price."*
>
> **That is true for ten of the eleven live retailers and false for Debenhams.**
> Debenhams is `delivery_model = 'flat'`, £3.99 on every basket, never free. The
> optimiser still carries the `?? '25'` / `?? '3.95'` fallbacks and does not branch on
> `delivery_model`, so it models Debenhams as tiered with a £25 threshold. **On a
> Debenhams basket over £25 the site understates the true total by £3.99.**
>
> **The copy was deliberately left alone.** Of three false claims found on that page
> on 3 August, this is the only one where **the product should move to meet the copy
> rather than the reverse**: the sentence describes what the optimiser ought to do and
> what the data already supports, so weakening it would entrench the defect in prose.
> The other two were removed, being a savings figure that was never true and a price
> example three months old.
>
> **When this lands, the claim becomes accurate with no copy change.** Verify it does
> by pricing a Debenhams basket over £25 before closing the item.

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

### 12. Does the delivery wedge actually bite? — ANSWERED 3 August 2026: FOUND EASILY

**Raised 1 August 2026. RUN AND CLOSED 3 August 2026.**

> **OUTCOME: "found easily", the first of the three. Not "found rarely" and not
> "not found".** This item was written with all three outcomes as findings and none
> as a failure, so the outcome is recorded by name rather than left to be inferred
> from the fact that work followed.
>
> **The wedge bites, and it is not rare.** Verified instance, every single-retailer
> option and every retailer pair evaluated exhaustively rather than only the expected
> two: goods-optimal is Beauty Bay plus Debenhams at £47.20 goods, genuinely the
> cheapest on goods. Delivered, £51.19. Consolidating at Beauty Bay is £48.00 goods
> and **£48.00 delivered**, free over £30. **Two different arrangements, £3.19
> apart.** An £0.80 unit saving bought for £3.99 of postage.
>
> | Pairing | Qualifying items |
> |---|---|
> | YesStyle to Stylevana | **1,050** |
> | Beauty Flash to Gorgeous Shop | 678 |
> | Stylevana to YesStyle | 501 |
> | Debenhams cheapest by under £3.99 | **673**, of which **435** pair with Beauty Bay |
>
> **Both forms occur**: the flat-retailer case, where Debenhams is never free and so
> wins on goods and loses delivered, and the pure tiered case in the original
> condition, where a leg lands below its threshold by less than that retailer's
> delivery charge. The K-beauty specialists dominate the tiered list, which is the
> section 2 prediction confirmed rather than restated.
>
> **Two qualifications, both recorded in `docs/strategy.md` section 2 alongside the
> result.** This was the first search against true delivery terms; per A1 every
> earlier run would have measured the fabricated fallbacks. And the wedge only bites
> where two retailers stock the same product, so the erosion in A2 is erosion of the
> ground this mechanism stands on: 11,449 comparable in `products_active` that
> evening, having lost 86 to the Boots step-down hours earlier.
>
> **Consequences.** `public/work-with-us.html:329` and strategy section 2 are
> supported by measurement, not merely defensible. The homepage demo can now
> demonstrate the mechanism instead of asserting it, which is separate work and must
> re-price at build time per `docs/standing-rule-frozen-catalogue-state.md`.

**Original detail follows, kept because the search parameters are the record of how
the question was framed.**

> **Correction to the original framing: "nothing breaks if it never runs" was
> wrong, and it is what kept this item low.** Nothing breaks *mechanically*. But
> two live surfaces already assert the wedge as fact, so leaving the question open
> is not a neutral state, it is an unexamined claim sitting in the market-facing
> material.
>
> **The exposure is NOT the articles.** Two savings-hub articles published
> 3 August do assert it, and copy is the cheap thing to fix. The exposure is:
>
> | Surface | The claim |
> |---|---|
> | **`public/work-with-us.html:329`** | *"Whole-basket optimisation including delivery. **No other UK platform does this.** Most compare single products. We optimise the entire routine including each retailer's free delivery threshold."* — partner-facing differentiator. |
> | **Section 2 of the strategy document** | The same positioning, and the more exposed of the two. **Not yet in this repository: a Word file outside version control.** Conversion to `docs/strategy.md` is queued as item 24, PENDING rather than absent. Cite it by path once that lands; until then it can only be named, not grepped. |
>
> **If ignoring delivery never gives the wrong answer, the wedge is defensible in
> principle and never bites in practice.** That is a **positioning finding, not a
> copy problem.** The mechanism would be real, correctly built and genuinely
> unique, and also inert — which is a different thing to be telling partners than
> what is currently being told. Positioning takes far longer to correct than a
> paragraph does, which is the argument for answering this before more of it is
> built on.
>
> None of the three outcomes below is a failure. The failure mode is continuing to
> assert it without having looked.

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

### 13. Onboarding migrations hardcode mutable config, and feed ids rotate

**Raised:** 2 August 2026 · **Blocked until:** after 4 August
**Detail: complete. This is a CLASS, not the Gorgeous Shop incident.**

**The class.** Retailer onboarding migrations write live operational config —
`awin_feed_id`, `awin_merchant_id`, `feed_url` — as literals inside an
`ON CONFLICT (retailer_id) DO UPDATE`. Those values are **owned by the affiliate
network, not by us**, and they change without notice. The migration therefore
encodes a value that was true on the day it was written and reasserts it forever.

**Same shape as the dormant-rule reasoning** in
`supabase/migrations/20260728120000_enable_brand_index_poll.sql:12` — a hardcoded
rule that breaks silently the day the world moves underneath it. There the
rejected design was a hardcoded import window; here it is a hardcoded feed id.
Identical failure mode, opposite artefact.

**The instance that surfaced it, recorded so the class is not mistaken for it.**
Gorgeous Shop (retailer 30), 2 August 2026: AWIN rotated the datafeed from
`110188` to `116876`, the 06:15 import 404'd, 6,710 in-stock rows went stale. The
live value was corrected the same evening by
`20260802120000_gorgeous_shop_fid_rotation.sql`, and
`20260720140000_gorgeous_shop_onboarding.sql` now carries a non-executable
warning at the hazard site. **That instance is closed. The class is not.**

**Why it recurs.** Nothing about the fix generalises. The next rotation lands on
whichever retailer AWIN chooses, and its onboarding migration will carry the same
construct with a different number in it. The only current defences are ordering
and a comment — both of which depend on a person reading the right file at the
right moment.

**Known affected files** (every AWIN onboarding migration with this construct):
`20260720140000_gorgeous_shop_onboarding.sql`,
`20260715120000_atelier_de_glow_onboarding.sql`. Confirm the full set when the
item is picked up rather than trusting this list.

**What is owed: a decision, not a patch.** Options, none yet chosen —
make the `DO UPDATE` not touch network-owned columns once set; move feed ids out
of migrations entirely into a config table treated as data rather than schema; or
record deliberately that migrations are seed-only and never replayed against a
live database. Any is defensible. **Undecided is the option currently taken by
default.**

**Why blocked:** it touches the import path and how the database would be
rebuilt, which is what the 4 August gate protects.

> **It compounds with item 5 — two items, ONE scenario.** A rebuild replayed
> through the CLI hits both defects in the same pass: it **restores the dead
> `110188`** (this item) *and* **stops at `20260724102843`**, silently omitting
> every privilege revoke and every `platform_changes` boundary row since 24 July
> (item 5). Neither is visible on the live database, so neither will be noticed
> until a reconstruction is actually needed — the moment least suited to
> discovering both. **They are separate decisions and should stay separate
> entries, but whoever picks up either should read the other first**, because
> deciding item 5 in favour of "the files are the source of truth" makes this
> item strictly worse: it makes replay the sanctioned path.
---

### 14. Every failure in this class reports success: the detection gap

**Raised:** 2 August 2026 · **Blocked until:** after the preload work lands
**Detail: complete. NOT STARTED, deliberately. This needs its own brief.**

**NUMBERING.** Numbered 14 behind item 13 (onboarding migrations and rotating feed
ids, PR #161). The two were written in parallel and both appended here; the
resulting conflict was resolved in favour of keeping both, in this order. This
branch is based on #161, so item 13 must land first or this file arrives with a
gap where 13 should be.

**The gap.** Every failure in this class so far has *reported success*. Not one
turned a status field red, and not one was caught by the thing that exists to catch
it. They were all found by a person looking at something else.

| Failure | What it reported |
|---|---|
| Branded Beauty AWIN programme closed | The deep links returned **HTTP 200** with a closed-merchant page. Nothing watching error rates can see a 200. |
| Gorgeous Shop feed id rotated | A 404 the 09:00 monitor did catch, in ~3h, but only because it is the *loud* class. 6,710 rows were already stale. |
| A `storage_passthrough` retailer whose uploader stops feeding it | **Nothing at all.** `last_import_status` is structurally incapable of going red: the import succeeds, because reading an unchanged file is a success. The data simply stops moving. |

Gorgeous Shop is the useful contrast: it currently reads `last_import_status =
'error'`, because a rotated feed id is the *loud* class. The silent class never
reaches that field at all.

**Why this is urgent rather than tidy.** The third row is not hypothetical, and the
exposure is much wider than one retailer. Measured 2 August 2026:

- **10 of the 12 active retailers are `staging_mode = 'storage_passthrough'`** —
  Boots, YesStyle, Stylevana, Debenhams, Perfume Click, Escentual, Beauty Flash,
  Gorgeous Shop, Branded Beauty, The Organic Pharmacy. Together they hold 105,506
  `retailer_prices` rows. Nine of the ten currently report `last_import_status =
  'ok'`.
- **Boots**: `storage_passthrough`, status `ok`, last import 2 August 04:46.
  35,902 price rows, 31,247 in-stock products, and **sole live offer on 29,734
  products — 28.1% of the 105,758 canonical live products**.
- Boots is also the largest clickout destination: 67 of 288 outbound clicks in the
  31 days to 1 August, 23.3%, more than any other retailer.

A silent stall at Boots would degrade the highest-value surface on the site, and
strand more than a quarter of the catalogue on a price nothing is refreshing, while
every dashboard stayed green.

**A figure to correct from the raising conversation:** Boots was described as
carrying 6,181 products. It carries 35,902 price rows across 35,860 distinct
products. 6,181 matches nothing measurable for Boots; the nearest figure in the
same window is Gorgeous Shop's 6,747 rows. Use the measured numbers above.

**Scope of the brief, when it is written.** How a passthrough retailer's staleness
is detected at all, given a successful import is the wrong signal; what the
detection threshold should be per retailer; and whether the answer is freshness
monitoring on `retailer_prices.last_updated` rather than anything on the import
path. Note the existing discriminator: loud failures surface in ~3h, silent ones
run 26h+.

**Related, not the same.** Item 13 is about config that goes stale in an artefact.
This is about staleness that no artefact reports. They share the property that the
failure is invisible by construction, which is why
`docs/standing-rule-frozen-catalogue-state.md` records the rule and this records
the gap. Consolidation, if any, belongs to item 4.

---

### 15. The routine cross-check links write nothing server-side

**Raised:** 2 August 2026 · **Blocked until:** after the preload work lands
**Detail: complete. Predates the preload work and is not preload-specific.**

**The defect.** The routine builder's per-product cross-check links —
`app/app/RoutineBuilder.tsx:941` (Amazon) and `:962` (eBay) — call
`trackRetailerClick` and `trackAffiliateClickOut` but **never call
`sendOutboundBeacon`**. Every other outbound surface does. So these clicks exist in
GA4 and have **never written a row to `outbound_clicks`**.

Confirmed: `select count(*) from outbound_clicks where source like 'routine_%'`
returns **0**. The `routine_amazon_crosscheck` and `routine_ebay_crosscheck`
click_source values are registered GA4 dimensions and appear nowhere server-side.

**A figure from the raising conversation needs correcting.** It was put at roughly
15% of measured clicks, from the July Amazon 38 and eBay 6. Those are **product
page** cross-checks, and they are recorded correctly:

| Source | Path | Clicks |
|---|---|---|
| `amazon_crosscheck` | `/product/[id]` | 41 |
| `ebay_search` | `/product/[id]` | 7 |
| `routine_*` | — | **0** |

`AmazonLink` and the product page's eBay link both route through `ClickOutLink`,
which beacons. The gap is confined to the two hand-rolled `<a>` elements in the
routine builder. **15% overstates it substantially.**

**The honest size is unknown, and that is the point.** The missing rows are
missing, so the undercount cannot be measured from `outbound_clicks`. What bounds
it: only 8 rows have ever been written from `/app` at all, so in absolute terms
this is currently small. It will not stay small if the preload work succeeds and
routine traffic grows, which is the reason to fix it before that rather than after.

**Sizing it needs GA4**, not the database: query `retailer_click` filtered to
`click_source in ('routine_amazon_crosscheck','routine_ebay_crosscheck')` and
compare with the (zero) server rows.

**Consequence to carry forward.** `outbound_clicks` systematically undercounts, and
any rate computed from it inherits that. It already undercounts for a second,
larger reason — GA4/consent aside, the server table is the *complete* one and GA4
is the partial one, but this surface inverts that for these two link types. Any
figure quoted from `outbound_clicks` should say which surfaces it can and cannot
see.

**The fix is small**: add `sendOutboundBeacon` to both handlers, or convert both to
`ClickOutLink`, which beacons by construction and would stop the class recurring.
The second is preferable, and is why the class exists: a hand-rolled anchor has no
way to inherit the behaviour.

---

### 16. The welcome-email path can only be exercised signed out

**Raised:** 2 August 2026 · **NOT A TASK.** A property worth knowing, and one open
verification that will close itself.

**The property.** `app/app/RoutineBuilder.tsx` branches on auth when a routine is
saved. Signed-in users write to `tracked_products` via `fmb_track_product`;
signed-out users insert into `saved_routines`. The welcome email is fired by
`trigger_welcome_email`, an `AFTER INSERT on saved_routines`.

**So a signed-in save sends no welcome email at all, by design** — and does so
silently: no error, no log row, nothing to notice. Anyone trying to exercise the
welcome path while signed in will see a successful save and no email, and have
nothing to look at. That is what happened on 2 August while verifying the
`utm_source=email` tag.

**The open verification.** The tag added to `send-routine-email` (deployed v16,
2 August) is recorded as:

> **Verified in the deployed v16 source, and verified end to end on the resulting
> link. NOT observed in a delivered email.**

The link `/app.html?routine=<ids>&utm_source=email` was driven on production: the
308 preserves both params, the routine loads, and `load_routine_from_url` reports
`source: email`. What was not observed is the function actually emitting it into a
sent message.

**No action. It closes itself** the next time a signed-out visitor saves a routine:
the welcome email will carry the tag, and the arrival will report `email` rather
than `unknown`. Deliberately not chased — the residual risk is that the deployed
source does not do what reading it says it does, and the email path is a separate
source from the Pinterest work that prompted it.

**If you do want to force it:** sign out first. Signed in, it cannot fire.

---

### 17. The optimiser returns at most two retailers, and nothing says so

**Raised:** 2 August 2026 · **Detail: complete. NOT STARTED.**
**The question to answer is whether this is a decision or an accident.**

**The fact.** `app/app/RoutineBuilder.tsx:400-550` builds exactly two families of
option: `singleOptions` (one retailer that stocks the whole basket) and
`twoOptions` (every pair). `allOptions` is their concatenation (`:552`). There is
no three-retailer branch and no stub for one. **The optimiser can never return
three retailers**, for any basket, at any size.

**It is undocumented.** The only comments at the site are the bare labels
`// Two-retailer combinations` (`:448`) and `// 2-retailer combinations` in the
email function's replica (`supabase/functions/send-routine-email/index.ts:195`).
Nothing in the code, the briefs or this file states the ceiling, gives a reason
for it, or acknowledges it exists.

**Evidence on provenance, which is suggestive but not conclusive.** The ceiling
predates the Next.js port. `git show 6c9b402^:public/app.html` — the legacy static
builder — has the identical `singleOptions` + `twoOptions` + `allOptions` shape and
no `threeOptions`. The optimiser arrived in this repo via `8fcfc25` (10 May 2026,
"Phase 6: port routine builder to /app"), which carried the structure across
unchanged. So it was inherited rather than chosen here.

**PROVENANCE ANSWERED, 2 August 2026.** The legacy `public/app.html` was written by
Robbie, solo. There is no other author to ask, and the question is therefore settled
rather than lost: **two retailers was what was tractable at the time, not a decision
about what the product should do.**

**That changes its status.** An undocumented ceiling of unknown origin is a
constraint you work around. A known limit of a first implementation is **a candidate
to revisit**. Nothing here argues it must change — pairs are O(n²) and cheap, triples
are O(n³), and the third delivery leg will often lose anyway, so the current answer
may well be right on the merits. But it should be re-decided on those merits rather
than inherited, and whatever is decided should end up in a comment at
`RoutineBuilder.tsx:448`, which is where the next person will look.

**Why it matters enough to record.** It bounds the proposition. "We find the best
way to buy your whole routine" is, in the implementation, "the best single shop or
the best pair". For a large basket spread across specialists, the true optimum may
need three, and the product will never find it or say it did not look. There is a
plausible good reason — pairs are O(n²) and cheap, triples are O(n³) and the extra
delivery leg usually loses anyway — but that reason is nowhere on record, and a
performance ceiling that reads as a product claim is the thing worth fixing even if
the ceiling itself stays.

**Immediate consequence, already actioned:** demonstration copy must not promise
three. PIN-044's brief said "split across two or three retailers"; two is the only
achievable answer.

---

### 18. Nine category misassignments, concentrated in recent additions

**Raised:** 2 August 2026, found while selecting demonstration baskets.
**PRIORITY RAISED 3 August 2026. Detail: complete. NOT STARTED.**

> **RESCOPED 3 August 2026. THIS ITEM IS ABOUT TWO RETAILERS READING THE WRONG
> COLUMN, NOT NINE SCATTERED MISASSIGNMENTS.** Read-only feed-diag runs found the
> cause, and it is mechanical rather than a categorisation-logic problem:
>
> | Retailer | Live rows | `merchant_product_category_path` (read) | `merchant_category` | `category_name` (read) | `product_type` |
> |---|---|---|---|---|---|
> | **Stylevana** | 12,122 | **0.0%** | 98.6% | **0.0%** | **100%** |
> | **Beauty Flash** | 7,315 | **0.0%** | 100% | 100% | 0.0% |
>
> **Stylevana loses BOTH category columns.** The importer reads the two it populates at
> 0.0% and ignores the two it fills. **12,122 live rows on the largest feed are
> currently categorised from the product name alone**, with no feed category data at
> all. Beauty Flash loses one of the two, at 7,315 rows.
>
> That is 19,437 rows across two retailers, which is a different item from "nine
> misassignments concentrated in recent additions". **The nine are not disproved and
> are not explained by this** — the overlap is unestablished and should not be assumed.
> But the large, mechanical part of this item is now identified.
>
> ### CORRECTION, 4 August 2026: THE COALESCE DOES NOT FIX THIS
>
> **This entry previously said the AWIN sibling coalesce was the fix for item 18. That
> was WRONG, not imprecise, and it was asserted repeatedly by both author and operator
> before anyone checked the write path.**
>
> `import-awin-feed` sets `top_category`, `product_type` and `subcategory` **only on
> `createActions`** (line 2227). `updateActions` (line 2007) carries `price`, `url`,
> `in_stock`, `ean`, `mpn` and `image_url` **and nothing else**. So **an import never
> rewrites the category of a product that already exists**, with the flag on or off.
>
> **Every misassigned product already exists.** Enabling the flag would read the
> recovered `merchant_category`, pass it to the categoriser, and discard the result for
> all 7,315 Beauty Flash rows and all 12,122 Stylevana rows. **The coalesce's category
> half is PROSPECTIVE ONLY: it changes what NEW products get, and nothing else.**
>
> **The self-tan, hand cream and hand salve rows will stay in `Moisturiser`.**
>
> **The near-miss is worth as much as the finding.** The planned verification was
> category distribution before and after. Run as designed it would have shown NO
> MOVEMENT, and that null result had two available explanations — "the recovered column
> agrees with name inference" and "the column was never applied" — with **nothing in the
> observation able to distinguish them**. A well-designed check, made meaningless by a
> mechanism underneath it that could not fail. Recorded as
> `supabase/migrations/README.md` convention 17.
>
> **What this item actually needs is a category backfill**, which is a catalogue-wide
> write to `products` and therefore carries item 6's cost: the stored `search_vector`
> regenerates and index entries rewrite on every touched row. That is a different risk
> class from a per-retailer import flag, and it was never priced. Recorded as item 35.
>
> **The coalesce rollout continues as BARCODE-ONLY** for every stage. Stage 2 onward
> recovers identifiers, which is real and useful, and does not touch this item.

> **This is now blocking demonstration of the core mechanism, which is why it is no
> longer a tidiness item.**
>
> Found while selecting homepage demo baskets on 3 August: **Beauty Flash's
> `Moisturiser` category returns milk_shake hair cream, Goldwell styling balm, hand
> cream and self-tan.** It cannot source a coherent skincare routine.
>
> **That matters because Beauty Flash to Gorgeous Shop is the second-largest tiered
> wedge pairing in the catalogue, at 678 qualifying items** (item 12, answered
> 3 August). The delivery wedge demonstrably bites there, and the demo cannot use it,
> because the categories will not yield a basket a reader recognises as a routine.
>
> **Category misassignment has stopped being a data-quality chore and become a
> constraint on proving the differentiator.** The homepage demo shortlist is
> consequently concentrated on Stylevana, recorded as a known risk in the block
> comment of `public/index.html`.
>
> **Report only in this pass. Not investigated, not fixed. A separate brief follows.**
> Do not assume the nine known misassignments and the Beauty Flash pollution are the
> same set; the overlap is unestablished.

Excluded from the pin baskets, since those are the shop window. Recorded because
the clustering suggests the categoriser regressed rather than that these are nine
independent slips.

| ID | Product | Assigned | Should be |
|---|---|---|---|
| 105176 | Babyliss Keratin Lustre Hairdryer | skincare / face | hair, appliance |
| 105178 | Babyliss Keratin Lustre Styling Iron (Rose Gold) | skincare / face | hair, appliance |
| 105300 | BaByliss Pro Keratin Lustre Styling Iron (Pink) | makeup / face | hair, appliance |
| 85505 | Hairburst Elixir Volume & Growth Spray | skincare / face | hair |
| 88663 | Urban Decay Naked Palette Original | skincare / face | makeup / eyes |
| 90274 | MAC Lipglass Air | skincare / face | makeup / lips |
| 85720 | RapidLash RapidShield Eyelash Conditioner | hair / condition | makeup / eyes |
| 66565 | Elizabeth Arden Green Tea Scent Spray | skincare / face | fragrance |
| 109997 | Made By Mitchell 16 Piece Brush Set | skincare / face | tools |

**The pattern worth checking.** Three styling appliances landed in `skincare/face`
and `makeup/face`; a brush set and an eyelash conditioner landed in skincare and
hair. `skincare/face` is doing duty as a catch-all, which is what a default looks
like when a rule fails to match rather than what a wrong rule looks like. All nine
are recent additions, mostly Beauty Bay and Debenhams stock.

**PART OF THIS MAY BE ITEM 21's SIBLING, AND THAT PART IS MEASURED.** The category
columns are a sibling pair like `ean`/`product_GTIN`: the importer requests
`merchant_product_category_path`, and `feed-diag` reports Escentual, Beauty Flash
and Gorgeous Shop populating **only `merchant_category`**. A retailer arriving with
no category path is exactly the input that would land on a `skincare/face` default.

Checked against the nine, 2 August 2026 — **it holds for three of them, and they are
the worst three**:

| Product | Assigned | Stocked by | Sibling-pair cause? |
|---|---|---|---|
| Babyliss Keratin Lustre Hairdryer | skincare/face | **Beauty Flash, Gorgeous Shop** | **plausible** |
| Babyliss Keratin Lustre Styling Iron | skincare/face | **Beauty Flash, Gorgeous Shop** | **plausible** |
| BaByliss Pro Keratin Lustre Styling Iron | makeup/face | **Beauty Flash, Gorgeous Shop** | **plausible** |
| Hairburst Elixir | skincare/face | Beauty Bay, Debenhams | no |
| RapidLash Eyelash Conditioner | hair/condition | Beauty Bay, Debenhams | no |
| Urban Decay Naked Palette | skincare/face | Beauty Bay, Debenhams | no |
| MAC Lipglass Air | skincare/face | Beauty Bay, Debenhams | no |
| Made By Mitchell Brush Set | skincare/face | Beauty Bay, Debenhams | no |
| Elizabeth Arden Green Tea Scent Spray | skincare/face | Debenhams, Perfume Click, YesStyle | no |

**All three appliances come solely from the two retailers that populate only
`merchant_category`.** The other six come from Beauty Bay and Debenhams, neither of
which is in that group — Beauty Bay populates EAN at 99.8% and stages inline — so
they need a different explanation.

**So item 18 has at least two causes**, and one of them is item 21's sibling. If the
category-path hypothesis holds, the nine rows are the visible edge of something
larger: every product arriving from those three retailers with no category path at
all, of which only the absurd ones (a hairdryer in skincare) are noticeable.

**Measure that before fixing any misassignment by hand** — count how many rows from
Escentual, Beauty Flash and Gorgeous Shop carry no usable category path. That number
decides whether this is nine rows or thousands.

**Do not fix these nine by hand.** Nine rows is not the finding; a categoriser that
defaults to `skincare/face` on no-match, on a feed that has recently grown
appliances and tools, is. Establish whether the default is the mechanism first,
then decide whether the fix is the rules, the default, or an unmatched queue.
`categoriser_safety_net_log` and `review_queue` exist and may already be recording
these.

---

### 19. PR #162 is held, and being held is not free — CLOSED

**Raised:** 2 August 2026 · **CLOSED the same day. Merged as `a339ee0`.**

**Outcome.** Reclassified from tidy-up to correction, and merged. The reasoning that
settled it: production was naming Superdrug and Branded Beauty as live retailers when
neither is, and for Branded Beauty the links sat behind a closed AWIN programme
returning a 200. That is a factual error on the site, not a cosmetic backlog item,
and the not-for-production marking had already been discharged by the audit rulings
in `4ea920e`.

**Pre-merge drift check, since the branch had been open since 1 August:** the
`about.html` list of 11 was re-read against the live `retailers` table and matches
exactly — the 12 active rows minus Branded Beauty, the deliberate divergence. No
retailer had been added or removed in the interval, every listed name was still
`active = true`, all 16 visible mentions of Branded Beauty were in "What this
supersedes" withdrawal notices rather than presenting it as live, and Superdrug
appeared only inside HTML comments. Nothing had drifted.

**Verified live after deploy:** about page reads 11 retailers with the correct list;
zero visible mentions of Superdrug or Branded Beauty on the homepage; zero £ figures
in the demo card.

**The generalisable part, which is why this item is kept rather than deleted.**
A branch held indefinitely is frozen state in its own right, and the framing that
unblocked it was noticing that holding is not neutral: every day it sat, production
kept the state the branch existed to correct. The question to ask of any held branch
is not "is it ready" but "what is shipping while it waits".

---

<details>
<summary>Original entry, retained for the reasoning</summary>

**Raised:** 2 August 2026 · **This is a decision that needs making, not a task.**

**The state.** PR #162 (`copy/august-audit-rulings`) has been open since 1 August,
marked not-for-production. It carries the `public/` half of the retailer copy sweep,
the 2 August audit rulings applied to it, and
`docs/commercial-finding-catalogue-depth.md`.

**Why it cannot just sit there.** It is the only thing in the queue containing
user-facing copy. That copy exists because the live site was wrong — it named
Superdrug and Branded Beauty after both had gone, and the homepage demo basket
carried hand-written prices. **Every day the branch is held, the production site
keeps the state the branch was written to correct.** Holding it is not neutral; it
is a choice to keep shipping the older copy.

**It is also frozen state in its own right,** which is the connection worth making
explicit: a branch pinned against a moving catalogue drifts exactly like the copy
inside it. The retailer list it corrects to 11 is already conditional on the Branded
Beauty `active = false` flip; the demo basket it rewrites to structure-only was
already rewritten once, on 1 August, and reproduced the hazard it documented. The
longer it waits, the more likely it needs re-auditing before it can land at all.

**The decision is binary: review and merge, or close.** There is no good third
option. If it merges, the live copy stops naming retailers that are gone. If it
closes, that is a deliberate decision to leave the copy as it is, which is
defensible but should be made rather than defaulted into.

**Surface it at the start of the next session** rather than letting it age quietly.
It is listed here so that instruction survives this conversation.

</details>

---

### 20. Feed cadence is assumed daily, and for at least one retailer it is not

**Raised:** 2 August 2026 · **Detail: complete. NOT STARTED.**

Every import runs daily and every freshness judgement assumes a daily feed. At
least one retailer does not have one.

**Beauty Flash keeps the weekend off.** Measured over 26 June - 2 August, its feed
is byte-identical on **6 of 6 Sundays and 5 of 5 Mondays**, and changes on 100% of
Tuesdays, Wednesdays, Thursdays and Saturdays. Its five 3-day identical streaks are
exactly 7 days apart. The merchant regenerates on weekdays and pauses at the
weekend, so Sunday and Monday both re-read Saturday's file.

**That is the merchant's cadence, not our drift.** Its integration was paused at
one point (`enabled = false`) pending a category fix, but the weekday pattern is
consistent across the whole window and is not an artefact of that pause.

**Why it needs fixing rather than tolerating.** The interim answer shipped with the
freeze check is `retailer_import_config.freeze_min_days`, set to 5 for Beauty Flash
so a bank-holiday Monday does not fire it. That treats the symptom: it grants a
retailer a wider tolerance for being normal, and it says nothing anywhere about
*why* the tolerance exists beyond a code comment.

**The fix is an expected-cadence field** — `daily`, `weekdays`, `twice_weekly` —
checked against observed behaviour. That describes Beauty Flash correctly instead
of excusing it, and it turns a second class of failure into something detectable:
a retailer whose *cadence* changes (daily to weekly) is a real signal that the
threshold approach cannot see at all, because the streaks stay under it.

**WATCH THE FIRST LIVE LONG WEEKEND. The next UK bank holiday Monday is
31 August 2026.** That extends Beauty Flash's normal weekend pause from three days
to four, which is exactly the case `freeze_min_days = 5` was set for. It should not
fire — but that is a prediction, not an observation, and 31 August is the first
chance to watch it rather than assume it. If it fires anyway, the weekday model is
wrong somewhere and the finding is bigger than the threshold.

**When this lands, delete `freeze_min_days`.** It exists only until this does.

---

### 21. Five retailers supply no EAN, and their identifiers are being discarded

> **THE SCANNER GATE MOVES WHEN THIS LANDS, AND NOTHING WATCHES FOR IT.** Added
> 3 August 2026. A barcode scanner is planned and not built; it is gated on EAN coverage
> of roughly 60.7%. AWIN-weighted coverage today is about 47%. Recovering Boots,
> Escentual, Beauty Flash, Gorgeous Shop and The Organic Pharmacy at 94.7-100% takes it
> comfortably past that gate.
>
> **A gate can be crossed by work done for another reason, and nothing in this project
> watches for that.** This fix is about matching quality; the scanner is a product
> decision that was waiting on a number this fix moves. **Check EAN coverage against the
> gate after stage 6 (Boots) lands**, rather than noticing months later that the
> condition was met and nobody looked.

**Raised:** 2 August 2026, found while diagnosing The Organic Pharmacy.
**Detail: complete. NOT STARTED. Do not fix by hand.**

The importer requests the AWIN column `ean` and never `product_GTIN`. AWIN exposes
both, and advertisers do not agree on which to populate, so an advertiser filling
only `product_GTIN` has every identifier silently dropped.

**Confirmed for The Organic Pharmacy** by a read-only `feed-diag` run on fid 62815:
`ean` 0.0%, `product_GTIN` **94.7%**. The diagnosis prints its own verdict —
`only "product_GTIN" populated - IMPORTER READS "ean", SO THIS IS LOST`.

**The five retailers at 0% EAN**, measured against `retailer_prices` on 2 August:

| Retailer | Feed rows | `ean` | `product_GTIN` | GTINs discarded |
|---|---|---|---|---|
| Boots | 36,823 | **0.0%** | **96.7%** | 35,626 |
| Beauty Flash | 10,862 | **0.0%** | **96.4%** | 10,474 |
| Gorgeous Shop | 10,114 | **0.0%** | **98.7%** | 9,979 |
| Escentual | 7,971 | **0.0%** | **99.8%** | 7,955 |
| The Organic Pharmacy | 114 | **0.0%** | **94.7%** | 108 |
| | | | | **64,142** |

**ALL FIVE CONFIRMED, 2 August 2026**, by one read-only `feed-diag` run each.
Every one populates `product_GTIN` between 94.7% and 99.8% and `ean` at exactly
0.0%, and `feed-diag` prints its own verdict on each:
`only "product_GTIN" populated - IMPORTER READS "ean", SO THIS IS LOST`.

**So this is ONE importer change, not four advertiser conversations.** No advertiser
needs contacting. The importer requests `ean` and never `product_GTIN`; five
advertisers fill the other half of the pair; **64,142 identifiers are being thrown
away on every import.** That was the question the four runs existed to settle, and
it settles in the cheaper direction.

**A second instance of the same bug, found in the same runs.** The category columns
are a sibling pair too — the importer requests `merchant_product_category_path`, and
`feed-diag` reports that Escentual, Beauty Flash and Gorgeous Shop populate **only
`merchant_category`**. Boots populates both. So three of the five are likely losing
their category path the same way they lose their GTIN. Not measured against our
stored data here; worth checking when the GTIN fix is scoped, because it is the same
one-line class.

**Consequence.** Four of the five carry MPN heavily, so they are not
identifier-less — but EAN is the stronger key and its absence pushes matching onto
names and sizes, which is the weaker basis and the one that produces the shade and
multipack collisions this catalogue keeps hitting.

**PROVENANCE OF THE -0.40 PENALTY: NOT FROM THE CODE.** It was raised that EAN
disagreement attracts a -0.40 confidence penalty in merge scoring. That figure came
from Robbie's notes, not from the repository. I searched
`supabase/functions/_shared/match-key.ts`, `scripts/dedup-apply-plan.mts`, `lib/`,
and the migrations, for both the constant and any EAN-weighted scoring, and found
nothing. **Treat it as unverified and possibly never implemented.**

**THIS IS NOT A ONE-LINE CHANGE, EVEN THOUGH THE CODE CHANGE IS ONE LINE.**
Reading 64,142 identifiers into a catalogue that has been matched on names and
sizes will change matching behaviour at scale, not merely fill a column. Two
movements, in both directions:

- Products that currently look identical may **separate** on EAN disagreement.
- Products currently held apart may become **merge candidates**.

That is the right outcome — it is the catalogue becoming more correct — but it is a
catalogue-wide shift landing in one import, on 64,142 rows, across the five largest
non-K-beauty retailers including Boots at 35,626.

**Required before any import runs with it:**

1. **A dry run measuring how many existing matches would change** — separations and
   new merge candidates counted separately, before anything is written. The number
   is the decision, not the code.
2. **A staged rollout by retailer, not all five at once.** The Organic Pharmacy is
   the obvious first at 108 rows; Boots is the obvious last at 35,626. One retailer
   per import, with the match delta read between each.

Treating this as a one-liner is how a correctness fix becomes an incident.

**If it does not exist, the argument for this item is weaker than first stated, and
should be made honestly.** It is not a scoring problem. It is that five retailers —
including Boots, the largest — are matched on names and sizes rather than on
identifiers they are actually supplying. That is worth fixing on its own merits, and
it does not need a penalty constant to justify it.

---

### 22. Amazon live-price selection: is it coherent before it is possible?

**Raised:** 3 August 2026 · **Blocked until:** after 4 August
**Detail: complete. This is ANALYSIS, not a build. No implementation is to be proposed.**

**Demand data cannot drive selection.** 42 Amazon clicks across 39 distinct products —
no concentration exists, so there is nothing to rank. The selection criterion is
therefore **structural**: products with exactly one live retailer, where an Amazon price
is what converts a listing into a comparison.

#### A. The rolling gate is the first question, and it may end the enquiry

**This leads because it is the objection that copy cannot address.**

Product-data access is a **rolling** entitlement, not a one-time unlock (see
`~/amazon-api-watch/README.md`; measured `AssociateNotEligible` on 2 Aug at 11 shipped,
`OK` on 3 Aug at 12). It can be withdrawn with nothing changing at our end.

Now apply that to the population §B.1 selects for:

| Product type | Losing Amazon access means |
|---|---|
| Multi-retailer | A comparison degrades to a **smaller comparison**. Tolerable. |
| **Solo-retailer** | Amazon **is** the comparison. The page **silently reverts to a single listing** — the exact state the feature existed to fix. |

**The feature is least robust precisely where it is most valuable**, and it fails by
reverting rather than by erroring. Nothing surfaces the reversion; the page simply looks
like it did before, which is the silent-kill class in item 14.

**This closes off caching as an escape.** The obvious answer — cache the last known
Amazon price and serve it through an outage — produces a stored price whose refresh path
no longer exists. That is the **same frozen-state failure** as:

| Prior instance | The shape |
|---|---|
| **r12 / Superdrug** | Retired feed, 29,547 rows retained, figures quoted from them long after they stopped being refreshed. |
| **Branded Beauty article price tables** | Hand-written prices in copy, refreshed by nothing (item 10). |
| **The `price_history` gap** | As raised 3 Aug. **Least documented of the three** — a grep finds only `docs/superdrug-removal-plan.md:208`. Locate and record it properly as part of this analysis; do not carry it as established. |

**On the count:** this was raised as the *third* instance of the shape. Three priors are
named above, so a cached Amazon price would be the **fourth**. Settle the count when the
`price_history` gap is pinned down rather than propagating either number — miscounting a
recurring defect is how it stops being recognised as recurring.

#### B. What to report, in order

1. **Products with exactly ONE live retailer, grouped by brand, across the WHOLE
   catalogue** — not the K-beauty subset sampled so far.
2. **The intersection of that set with products that have received any traffic**
   (`outbound_clicks` or a product page view). Expected to be small; that overlap is the
   natural starting set.
3. **The actual Creators API rate limit at our tier.** Neither party knows the number and
   any design depends on it. The vendored SDK docs may predate the Nov 2025 changes, so
   **if the shipped docs and a live response header disagree, report both rather than
   reconciling them.**
4. **The optimiser conflict**, below.

#### C. The optimiser conflict — and a corrected premise

**Amazon cannot join the basket optimiser.** On a solo-retailer product, if Amazon is
cheaper, the page shows a best price the optimiser will not route to. Report how the
product page and `RoutineBuilder` would **each** handle that today, and what would have to
change.

**The premise as originally stated was wrong, and is corrected here rather than carried.**
It is *not* that Amazon has no delivery threshold. Non-Prime is typically free over a
threshold; Prime is free regardless; and **the buy-box seller can change both**. The
threshold is therefore **user-dependent** — which no other retailer's is — and the
optimiser cannot know which user it is serving.

That is a **different problem** from an absent threshold, and plausibly a **harder** one:
an absent threshold is a constant the optimiser could model, whereas a user-dependent one
is unknowable at optimisation time. **Establish which of the two it actually is before it
is treated as settled.** This interacts with item 11 (`delivery_model`), which currently
assumes a retailer's delivery rule is a property of the retailer.

#### D. Verifications approved, not to be adopted as given

- **Derive** the "186 distinct products with clicks" figure rather than adopting it.
- **Derive** the `outbound_clicks`-versus-page-view distinction rather than assuming the
  two populations are interchangeable.

**Why this is the question and not a smaller one.** If §A holds, the feature is incoherent
regardless of whether §B and §C are solvable, and the correct outcome is not to build it.
That verdict is worth as much as a green light and costs a fraction of the work — which is
why this is analysis, and why nothing here authorises an implementation.

---

### 23. Close the `enabled` trap in `monitor-retailer-feeds`

**Raised:** 3 August 2026 · **Blocked until:** after 4 August
**Detail: complete. Small change, and the comment is the larger half of it.**

`supabase/functions/monitor-retailer-feeds/index.ts:123` selects
`retailer_import_config.enabled`:

```ts
.select("retailer_id, last_import_status, last_import_error, last_attempt_at, enabled");
```

**It is never referenced again.** That `SELECT` is the only occurrence of the string
`enabled` in the entire function. The monitor's scope is `retailers.active` and nothing
else (line 104-108); a parked retailer with `enabled = false` alerts as stale every
morning regardless. Established 2026-08-03 — see
`docs/superdrug-removal-plan.md`, "Step 0", for the three-retailer proof.

**Do NOT simply delete the column from the select.** A silent removal leaves the next
reader with no way to know the omission is deliberate, and the natural next step for
anyone who notices a parked retailer alerting is to *add* `enabled` to the filter,
believing they are fixing an oversight. The change is:

1. **Remove** `enabled` from the `.select(...)` on line 123.
2. **Add a comment** at that line recording that `enabled` is deliberately **not**
   honoured, and why: `enabled` gates whether the *importer runs*, whereas the monitor
   answers whether the *data is fresh*. A retailer that is parked but still `active` is
   still being shown to users on stale data, and that is precisely the case worth
   alerting on. Silencing it would mean the monitor stops watching a retailer the site is
   still serving. **`active = false` is the flag that means "stop watching", and it
   already works.**

**Why this is the comment and not a one-liner.** The defect is not the wasted column, it
is that line 123 reads as though the monitor honours `enabled`. Deleting the word fixes
the code and leaves the misconception un-addressed for the next person who wonders why a
parked retailer alerts.

**Same class as two hazards already recorded**, both a line that looks incidental and
misleads:

| Hazard | The misleading surface |
|---|---|
| `ClickOutLink` `target = '_blank'` | A **default parameter** at `components/ClickOutLink.tsx:34`, so no call site passes it and **none of them look like new-tab links** — yet the new-tab behaviour is what keeps the consent-replay queue alive (`docs/dashboard-build-brief.md:1024-1030`). |
| The `dataLayer` stub | `public/fmb-gtag-stub.js` — a queue that looks like a no-op shim but is load-bearing for pre-consent clicks (`docs/ticket-gtag-hydration-race.md`). |

Add this one to that set when it lands: the shared property is that the *correct* reading
requires knowing something the line itself does not say.

**Scope note.** This does not change any alerting behaviour. It is a readability and
misdirection fix, and it must not be bundled with a change to what the monitor watches —
if the park-window noise is ever judged worth suppressing, that is a separate decision
with its own entry, because the only alternatives are tolerating the mail or bringing the
`active` flip forward.

---

### 24. Convert the strategy document to `docs/strategy.md` — DONE, 3 August 2026

**Raised and closed 3 August 2026. CLOSED, not blocked.**

**`docs/strategy.md` is the canonical strategy document.** Converted from
`FindMyBasket_Strategy_2026-08-03_v2.docx` and committed, with all nine amendments
plus the A3 and A5 corrections applied in the same pass and marked inline as
`[Amended 3 Aug 2026]`. `docs/strategy-amendments.md` is now the historical record
of what changed and why, not a queue.

Verified before the amendments were recorded as applied: all 17 sections present as
markdown headings, 28 tables survived as tables, all nine amendments locatable by
the section each references, and zero em dashes, en dashes, curly quotes, curly
apostrophes, non-breaking spaces or control characters. Full check table at the head
of `docs/strategy-amendments.md`.

**One thing that survived the closure and is worth a look:** a `v4` of the Word
document exists alongside the `v2` these amendments were drafted against. The
converted markdown is correct regardless, but **if `v4` carries edits that never
reached `docs/strategy.md`, nothing would surface that.** A one-off diff before the
`.docx` files are treated as disposable. Not urgent, not a blocker, and deliberately
not left as an open item on a closed task.

**Item 12's exposure table can now cite `docs/strategy.md` by path.** Section 2
carries the wedge claim and section 7 rests the commercial model on it; both now
record that the delivery half was unevidenced until 1 August, which is context item
12 should have before it runs.

<details>
<summary>Original entry, kept for the record</summary>

The primary strategic artefact was a Word file outside version control, cited by
name across this work and impossible to grep, diff, link to by path or check for
staleness. Recorded as **pending, not absent**. The conversion and the amendment
pass were required to happen together, because converting the file as it stood
would have committed a version known stale on the day it landed, and a stale
document with a path is worse than a stale document without one: the path makes it
look authoritative and citable.

The nine amendments were themselves unrecorded at first, which was the same defect
one level down and the instance that would have survived the fix. Committing them to
`docs/strategy-amendments.md` on 3 August, ahead of the document itself, reduced the
blocker from two inputs to one.

An intermediate state is worth recording because it is the exact failure this item
existed to prevent: for a period on 3 August, `docs/strategy.md` was the raw `.docx`
binary with the extension renamed. It was 66,541 bytes of ZIP, unreadable and
ungreppable, and it sat at the authoritative path looking canonical. It was caught
before being committed, and `main` never carried it.

</details>

**The primary strategic artefact is a Word file outside version control.** It is
cited by name across this work — item 12 names section 2 as a more exposed surface
than any published article — and it cannot be grepped, diffed, linked to by path,
or checked for staleness. Nothing surfaces its absence, because there is no
artefact to go stale.

**This is the same shape as the dashboard brief before it was committed**, and the
same absent-record class this file's own header describes. It is recorded here as
**pending, not absent**: the document exists and is authoritative, it just has no
address in this repository.

**Target:** `docs/strategy.md`, markdown, so it is greppable, versionable and
citable by path the way every other brief here is.

#### Do the conversion and the amendment pass TOGETHER

**Nine amendments are drafted and not applied.** Converting the Word file as it
stands would commit a version known to be stale on the day it lands, and a stale
document with a path is worse than a stale document without one, because the path
makes it look authoritative and citable.

**The amendments now have a path: `docs/strategy-amendments.md`, committed
3 August 2026, ahead of the strategy document itself.** They previously existed
only in conversation, which was the same defect as the strategy document being
outside version control and the instance that would have survived the fix. That is
closed.

**One blocker remains: the Word file. Not two.** The amendment source is safe
regardless of when the document arrives.

Sequence:

1. Robbie supplies the Word file. **This is the only outstanding input.**
2. Convert to markdown at `docs/strategy.md`.
3. Apply all nine from `docs/strategy-amendments.md` **in the same pass**, before or
   at the first commit.
4. Resolve the two editorial notes at the foot of the amendments file first. They
   flag a missing qualifier on A3's comparison-depth figure and an overstatement in
   A5 ("the gate is documented" against a threshold recorded as supported, not
   confirmed). A5 is the amendment most likely to be quoted outward.

**Read A1 and A2 before item 12 runs.** A1 records that the delivery half of the
wedge had no data until 1 August, so the mechanic was asserted for months before it
was evidenced. A2 records that comparison depth is being actively eroded by
retailer departures rather than being static. **Both change what item 12's answer
means**: a wedge that never bites is a different finding if the delivery inputs were
fabricated until two days before the test, and a shrinking comparable set moves the
odds of finding a qualifying basket at all.

**Once it lands:** update item 12's exposure table to cite `docs/strategy.md` by
path and section rather than by name, and check whether any of the nine amendments
touch the whole-basket positioning that item 12 tests.

---

### 25. 7,798 pages returning 404 as at 24 July, cause unknown

**Raised:** 3 August 2026 · **REPORT ONLY. Do not act.**
**Source:** Search Console coverage export, as at 24 July 2026.

**7,798 pages returning 404**, measured not inferred.

**This is not the r12 brand-page 404s.** Those landed on **27 July** and are recorded
as `platform_changes` id 24 (450 brand pages losing their last active offer). The
coverage export predates that by three days, so **the r12 404s are additional to
this figure, not an explanation of it.**

It is also not the Boots step-down. That creates no 404s by construction:
`products_active` requires a price row at an active retailer and **ignores
`in_stock` entirely**, so setting `in_stock = false` cannot remove a page. Verified
against the view definition and against live pages on 3 August.

**Cause unknown.** Candidates worth separating before any of them is assumed:
retired-retailer orphans predating r12, the pagination defect fixed 30 July
(PR #157, which was 404ing roughly 60 brand pages over an overlapping window),
merged-product ids, and genuinely stale URLs Google has not recrawled. Do not
attribute the whole figure to any one of these.

**Why report-only:** 7,798 is large enough that acting on a guess would be worse
than not acting. The first piece of work is a breakdown by URL pattern, which needs
a fresher coverage export than 24 July.

---

### 26. 30,487 pages "Crawled, currently not indexed" against 60,025 indexed

**Raised:** 3 August 2026 · **REPORT ONLY. Do not act.**
**Source:** Search Console coverage export, as at 24 July 2026.

**Google is crawling roughly a third of the site and declining to index it.**
30,487 crawled-not-indexed against 60,025 indexed, so **33.7 per cent of crawled
pages are being refused.**

**This bears directly on the offerless-pages question, and it is the more important
of the two findings.** The thin-content risk has been discussed throughout the
retailer-departure work as something to watch for. This is **that signal in its raw
form, measured rather than inferred.** "Crawled, currently not indexed" is Google's
standard response to pages it judges to add insufficient value, which is precisely
what an offerless or single-offer product page is at risk of being.

Read it against `docs/commercial-finding-catalogue-depth.md`: **86.2 per cent of the
buyable catalogue has a single stockist**, so most product pages cannot show a
comparison at all. A third of crawled pages going unindexed is consistent with that,
though the export cannot prove the causal link on its own.

**What it does NOT establish**, and must not be reported as establishing:

- **It predates every August change.** 24 July is before the r12 retirement
  (27 July), before Branded Beauty (1 August) and before tonight's Boots step-down.
  It is a baseline, not a consequence.
- **The URL breakdown is unknown.** Whether the 30,487 are concentrated in product
  pages, brand pages or something else is the first thing to establish, and it
  changes the reading entirely.

**Why report-only:** it is a measurement, and the useful next step is a fresher
export with a URL-pattern breakdown, not a remedy. Read it before item 12 and before
any further offerless-page work.

> **Both items share a constraint worth stating once.** There is **no programmatic
> Search Console access in this project**: no credential, no workflow, no stored
> series, and `gsc_coverage` exists only as a metric name on `platform_changes` rows
> with nothing populating it. Every GSC figure here was read by hand and **cannot be
> reproduced from the repository or refreshed without someone opening the UI.** That
> is the same absent-mechanism shape as the strategy document was, and it is worth
> deciding deliberately whether it stays manual.

---

### 27. The homepage hero now depends on Supabase at build time

**Raised:** 3 August 2026 · **REPORT ONLY. Nothing to fix. Recorded because it is a
new coupling and nothing else on the static homepage has one.**

`scripts/generate-homepage-demo.mjs` runs before `next build` and queries Supabase to
re-solve the demo basket. **The marketing surface now has a database dependency it did
not have yesterday.**

`public/index.html` is a static file served by a rewrite, with no Supabase client and
no runtime data access. Every other figure on it is hand-written. This is the first
part of the homepage whose content is produced from live data, and therefore the first
that can be affected by the database being unavailable.

**It degrades safely, and that was designed rather than hoped for:**

| If | Then |
|---|---|
| Supabase unreachable, credentials absent, query fails, generator throws | `FMB DEMO FALLBACK FIRED (INFRASTRUCTURE)`, hero renders **without figures**, **exit 0** |
| Every candidate basket fails to demonstrate the mechanism | `FMB DEMO FALLBACK FIRED (CATALOGUE)`, hero renders without figures, exit 0 |
| Markers missing from `index.html` | Nothing written, said explicitly, exit 0. The committed state is the no-figures hero, so the served page is still safe |

**A build can never fail because of this.** Verified by forcing all nine paths,
including infrastructure failure with `FMB_DEMO_FALLBACK_FATAL=1`, which still exits 0.
A cosmetic hero must not be able to block a deploy.

**Why record it at all, given it is safe.** Two reasons, neither urgent:

1. **Nobody expects the homepage to have a database dependency.** Someone debugging a
   build failure, or wondering why the hero has no figures, will not think to look at
   Supabase unless this is written down. The fallback is loud in the build log, and a
   build log is loud at the moment it happens and invisible a day later.
2. **The coupling is one-directional today and could stop being.** If anything else on
   the static pages is later generated the same way, this stops being an exception and
   becomes a pattern, and the pattern deserves a deliberate decision rather than
   accretion.

**Related:** the daily refresh is `.github/workflows/refresh-homepage-demo.yml`,
which triggers a production deploy via the Vercel API using `VERCEL_TOKEN`. If that
workflow fails, the site serves the last good build: **stale, not wrong.**

---

### 28. Debenhams delivery was never added on product pages — SEPARATE DEFECT, FIXED 3 Aug 2026

**Raised and fixed 3 August 2026, found while scoping item 11. Recorded as its own
defect rather than folded into that work, because it is a different bug in a different
place with a different cause.**

`lib/product-queries.ts:167-168` read:

```ts
const deliveryCost = retailer.delivery_cost ? Number(retailer.delivery_cost) : null;
const deliveryThreshold = retailer.delivery_threshold ? Number(retailer.delivery_threshold) : null;
```

and then added delivery only when **both** were non-null.

**Two defects in three lines. The second was live.**

1. **`0` is falsy**, so a genuine £0 delivery cost became `null`. **Latent**: the only
   retailer with a £0 cost is treated identically either way. This is the one the item
   was originally raised for.
2. **A FLAT RETAILER HAS NO THRESHOLD.** Debenhams' `delivery_threshold` is `NULL`, so
   the null guard skipped delivery entirely and **its £3.99 was never added on a
   product page, at any basket size.** Not latent. Live since the flat model was
   introduced on 1 August.

**Why this matters more than the fallback work it was found beside.** Item 11 concerned
the optimiser understating Debenhams by £3.99 **above £25**. This understated it by
£3.99 **everywhere**, on a different surface, through a different mechanism. Same
retailer, same amount, unrelated code.

**Fixed** by routing through the shared rule, which treats a flat retailer's absent
threshold as correct and meaningful rather than as missing data.

---

### 29. The monthly email invented a £3.95-per-retailer savings baseline — DONE, 3 Aug 2026

**Raised and fixed 3 August 2026. Priority raised above the Niche Beauty go-live and
done the same day: it is small, it uses `deliveryFor()` which now exists, and it
removed the LAST fabricated delivery constant in the codebase.**

> **It was wrong twice, not once.** `£3.95` is invented — only two of twelve retailers
> charge exactly that, the spread is £0.00 to £3.99, and Debenhams charges on every
> basket while the rest go free above a threshold. And `uniqueRetailerCount` counted
> every retailer stocking **any** item in the routine, not the number of orders you
> would actually place. A single-product routine was charged delivery for **eight**
> retailers.
>
> **The baseline now:** assign each product to its most expensive stocking retailer,
> group those into real legs, charge each leg that retailer's real delivery through the
> shared rule. If any leg's terms are unknown, no saving is claimed rather than a
> guessed one. Same contract as the recommendation path, so the two are comparable.
>
> **Measured effect on the six live routines with buyable items:**
>
> | Routine | Old baseline delivery | New | Baseline drop |
> |---|---|---|---|
> | 36 (one product) | £31.60 | £0.00 | **£31.60** |
> | 25 | £31.60 | £3.95 | £27.65 |
> | 3 | £11.85 | £7.45 | £4.40 |
> | 21 | £11.85 | £7.45 | £4.40 |
> | 42 | £7.90 | £3.95 | £3.95 |
> | 26 (twelve products) | £3.95 | £0.00 | £3.95 |
>
> **Worked example, routine 36.** One product, best delivered £20.45. The claimed
> saving falls from **£37.15 (64%)** to **£5.55 (21%)**.
>
> **The reduction is the point.** The old figure was inflated by a number nobody
> measured. That is the r12 savings problem in a different place, and the corrected
> figure is the first one this email has reported that is derived entirely from
> observed terms.
>
> **Guarded.** The constant test now covers every pricing path, not just the rule, and
> catches the arithmetic shape (`* 3.95`) as well as the fallback shape (`?? 3.95`) —
> the last constant survived the first sweep precisely because it was a multiplication.
> Proven to bite by reintroducing the constant and watching the test fail.

<details>
<summary>Original entry, when this was deferred</summary>

`supabase/functions/send-routine-email/index.ts`:

```ts
const worstDelivery = uniqueRetailerCount * 3.95;
```

This builds the "what you would have paid" baseline that the email's **saving** is
measured against, by assuming every retailer charges £3.95.

**No retailer charges exactly £3.95 except Boots and YesStyle.** The real spread is
£0.00 to £3.99, and Debenhams charges on every basket while the others go free above a
threshold. So the baseline is invented, and **the saving derived from it is invented
too.**

**Left in place on purpose.** Every other fabricated delivery constant was removed in
item 11, but this one moves a **savings figure shown to a user**, not a price. That is
a claims decision rather than a code one, and this project has spent a fortnight
learning that savings figures need deciding rather than adjusting. The line is flagged
in place with a comment pointing here.

**What a fix would need to decide:** whether the baseline is "each item from its own
retailer, each charging its real delivery" (defensible, computable, and smaller than
today's figure for most baskets) or something else entirely. It will most likely
**reduce** the headline saving.

</details>

---

### 30. A real user's saved routine became unbuyable in the Boots step-down

**Raised 3 August 2026. REPORT ONLY, not acted on.**

Three active `saved_routines` have zero buyable items and are receiving monthly emails.
**Two are test data. One is not.**

| id | Routine | Created | Address | Verdict |
|---|---|---|---|---|
| 15 | `[1]` | 30 Apr | internal-looking | **Test data.** Product 1 does not exist. |
| 18 | `[10, 20, 30]` | 30 Apr | internal-looking | **Test data.** None of those products exist. |
| **37** | `[9445]` | **20 Jul** | **external** | **A REAL USER.** |

**Routine 37 is one real product**: La Roche-Posay Cicaplast Baume B5+ 100ml. Its only
offer is Boots, and **that row's `last_updated` is 2026-05-11** — inside the 8,237-row
cohort flipped to `in_stock = false` by the absence step-down at 15:05 today.

**So this routine became unbuyable this afternoon, as a direct and correct consequence
of the step-down.** Before today the user would have been emailed a price frozen since
11 May and presented as current. That was worse. But the improvement is invisible to
them: what they get now is an email with nothing in it.

**What the email renders.** With no options, `send-routine-email` falls back to a
"Best available prices" basket built from `priceMap`. For a routine whose only offer is
out of stock, that breakdown is **empty**, so the email renders a saved-routine email
with **no products, a £0 total and a "Best available prices" heading**.

**Sending a monthly "best price" email containing nothing is worse than not sending
it.** Options, none taken:

1. **Skip the send** when the breakdown is empty, and say nothing.
2. **Send a different email**: "we cannot currently find this in stock anywhere",
   which is true, useful, and keeps the relationship.
3. **Deactivate** routines with no buyable items after N consecutive empty months.

**(2) is probably right** — it is the only one that tells the user something true. But
it is a new email template and a product decision.

**Separately: the two test routines should be deactivated**, so the population of live
routines is not two-thirds fiction. They have been emailed monthly since 30 April.

---

### 31. The 25% savings claim: traced. Reframing a number is not correcting it

**Raised and answered 3 August 2026. REPORT ONLY, closed by the answer.**

The question left open this morning was whether the removed hero claim, *"Save up to
around 25% on a comparable beauty routine"*, had a traceable and wrong origin, or was
simply written by hand. **It was written by hand.** But the history is worse than that,
and it is the useful part.

| When | What | Traced by |
|---|---|---|
| **2 May 2026** | Enters the copy as *"around 25% **average** saving"*. A hardcoded string. No computation, then or ever. | `git log -S`, earliest appearance in an uploaded static file |
| **29 June 2026** | Commit `938251d` (PR #61) finds it. Its own message: *"a hardcoded string with no computation behind it, and a verification pass put the real catalogue-wide average far lower (~8% on a comparable routine, ~1% on a realistic one); 25% is the best-case top decile, not an average."* | commit message |
| | **The number was kept. The words were changed** from "average saving" to "Save up to around 25%", reframing a false average as a true-sounding ceiling. | the diff |
| **3 August 2026** | Removed entirely, replaced with the mechanism and no figure. | PR #178 |

**Two corrections, three months, and the first one left the figure in place.**

> **REFRAMING A NUMBER IS NOT CORRECTING IT.** The June pass did the hard part: it
> measured, found the real average was ~8% and ~1%, and wrote that down. Then it kept
> 25% on screen by weakening the sentence around it. A reader saw the same number
> before and after. Whatever the intent, the effect was to preserve an unsupported
> figure through a correction pass that had already disproved it.

**What it was NOT.** It did not come from `uniqueRetailerCount * 3.95`, and it did not
come from the routine emails. Checked directly: no computation has ever produced a 25%
figure for this copy.

**But the connection is real, one step across.** The same June commit also found the
stacked-delivery baseline defect and fixed it in the site path across ten files.
**`send-routine-email` was not one of them**, so the identical computation survived
there until item 29 today. That is why a live routine was still claiming a 64% saving
in August for a defect corrected in June. Recorded as
`supabase/migrations/README.md` convention 13: fix the class, not the instance.

**No action.** The figure is gone, the computation is gone, and the guard tests would
catch either returning. This is recorded because the *pattern* is worth recognising:
a correction that measures honestly and then leaves the number standing is harder to
spot afterwards than one that never measured at all.

---

### 32. A persistently failing address is never paused, and is retried forever

**Raised 3 August 2026 while building the pause rule. REPORT ONLY. Needs its own
decision; deliberately not solved in that pass.**

The Template B pause rule filters on `ok`: a routine pauses after **three consecutive
delivered empty sends**. That filter is correct and deliberate — a pause must follow
three months of having nothing to say, **not** three months of Resend failing. Those are
different problems with different remedies, and conflating them would pause a subscriber
whose routine is perfectly priceable because their mail provider was rejecting us.

**But it leaves the mirror-image gap.** An address that fails every month never
accumulates three `ok = true` rows, **so it never pauses, and is retried monthly
forever.**

**That is the deliverability problem in a different form**, and it is the more damaging
form. Repeated sends to a failing address degrade sender reputation for **every other
email the platform sends**, including the ones that do have something to say. The empty
email problem costs one subscriber's attention; this one costs everybody's inbox
placement.

**Why it is not urgent yet.** `ok = false` has never occurred. All 19 rows in
`routine_email_log` are `ok = true`. The gap is real and currently unexercised.

**What a rule would have to decide**, none of which should be guessed:

1. **How many consecutive failures before acting.** Hard bounces and soft bounces are
   not the same signal and Resend distinguishes them; the log currently does not.
2. **What "acting" means.** Pause, deactivate, or mark the address undeliverable and
   keep the routine, since the routine may be fine and only the address dead.
3. **Whether the user can ever be recovered.** An address that starts working again is a
   different case from one that never will, and nothing currently records which.

**Note the shape.** Both rules read the same series and both are about not sending. They
should probably be one function with two reasons rather than two functions, so that
"why was this routine paused" has a single answer. Decide that before either is built.

---

### 33. AWIN sibling coalesce rollout, stage by stage

**Started 3 August 2026.** Implementation and rationale in
`supabase/migrations/20260803200000_sibling_coalesce_opt_in.sql`. One retailer at a
time, `retailer_import_config.sibling_coalesce`, smallest feed first.

| # | Retailer | Rows | Flag | Dry run | Live run |
|---|---|---|---|---|---|
| 1 | The Organic Pharmacy | 114 | **ON 3 Aug** | done, clean | **awaited: cron 22, 05:30 UTC daily** |
| 2 | Beauty Flash | 10,862 | off | | |
| 3 | Stylevana | 24,598 | off | | |
| 4 | Gorgeous Shop | | off | | |
| 5 | Escentual | | off | | |
| 6 | Boots | 35,912 | off | | |

#### Stage 1 result, 3 August 2026

Dry run compared with coalesce OFF and ON against the same feed at the same moment:

| Metric | OFF | ON |
|---|---|---|
| `rows_with_ean` | 0 | **78** |
| `barcode_rejected` | n/a | **0** |
| `category_path_from_sibling` | n/a | 100 |
| `would_update_existing` | 75 | 75 |
| `would_link_via_ean` | 0 | 0 |
| `excluded_by_category` | 30 | 30 |

**Zero link changes and zero category movement.** 78 validated barcodes recovered, none
rejected.

**THE TIER 0 PROPERTY HELD, AND IT IS THE MORE VALUABLE RESULT.** `existingByExtId` is
checked before any match tier, so already-imported rows keep their `product_id` and
merely gain a barcode. **The whole rollout is therefore ADDITIVE ON FIRST RUN for every
retailer.** The re-linking risk does not sit in a stage; it sits in the imports *after*
a stage, once the recovered barcodes are in `ean_product_index` and other retailers'
new rows can match against them.

**So watch for it across consecutive runs, not within one.** Compare
`would_link_via_ean` between successive imports at stages 4 to 6, where enough barcodes
will exist for cross-retailer matching to actually fire. A single run's diagnostics
cannot show this.

**A CLEAN STAGE 1 TELLS YOU VERY LITTLE ABOUT STAGES 2 TO 6.** Recorded here so the
result is not over-read: the feed is small, its categories already agreed with
name-based inference so nothing could move, and its barcodes have nothing to match
against yet. Stage 1 tests that the mechanism runs safely. It does not test that it
does anything.

**The 78 versus 108 gap is unreconciled, deliberately.** feed-diag counted 108
`product_GTIN` values across 114 raw feed rows; the importer sees only rows surviving
filtering (30 excluded by category, 9 by the v6 rule). 78 across a post-filter
denominator is consistent with that, and the exact reconciliation was **not** verified.
Two different denominators, stated rather than explained away.

**Next: let cron 22 run naturally at 05:30 UTC and compare the live result against the
dry run.** A dry run that matches its live run is confirmation; a dry run alone is a
prediction.

**Then stage 2, Beauty Flash — BARCODE-ONLY.** Reframed 4 August 2026. It was planned
as the first real test of the category half; the category half does not exist for
existing products, so there is nothing there to test. See the correction on item 18.
**STYLEVANA IS DROPPED FROM THE ROLLOUT ENTIRELY**, not reordered. Decided 4 August 2026.
Its `product_GTIN` is 0.0%, so it gains no barcodes, and the category half does not exist
for existing products, so it gains no categories either. **Its flag would be a no-op that
reads as progress**, and a stage that cannot change anything is worse than no stage,
because it accumulates false confidence in the method.

**Why it was third, and why it is now nowhere, is the clearest illustration of the
correction:** it was placed third deliberately, to isolate the category half on the
largest feed, because it was the one retailer whose barcodes could not move. That made it
the perfect test of a half that turned out not to exist.

**Remaining order: Gorgeous Shop, Escentual, Boots.** All barcode-only.

---

### 34. The import path is deployable by one person from one machine, and nothing records it

**Raised 3 August 2026. REPORT ONLY.**

**No CI workflow deploys edge functions.** `.github/workflows/` contains no
`supabase functions deploy`. Every edge function in production — the three importers,
the feed monitor, the routine email sender — was deployed by hand.

**The Supabase CLI reached the operator's Mac on 3 August 2026**, hours before it was
first needed, installed mid-task to unblock this rollout. Before that, deployment
required a machine that did not have the tool installed.

**The part that matters in an incident: NO ARTEFACT RECORDS WHICH COMMIT ANY PRODUCTION
EDGE FUNCTION WAS DEPLOYED FROM.** Not a tag, not a log line, not a row. The deployed
code cannot be tied to a revision by anything except memory. During an incident the
first question is "what is actually running", and today that question has no answer
better than opening the Supabase dashboard and reading the source.

**Four separate exposures, worth not conflating:**

1. **Bus factor.** One person, one machine, one browser session. `supabase login` is a
   TTY flow and cannot run in CI or in an agent session, so this cannot currently be
   delegated even in an emergency.
2. **Provenance.** A deployed function and a repository commit are related only by
   assumption. A hotfix applied through the dashboard would leave the repository silently
   wrong, which is the absent-record class this file exists to correct.
3. **Drift.** Nothing compares deployed source with `main`. A function could have been
   edited in the dashboard months ago and nothing would say so.
4. **Attribution.** A hand deploy dropped into a window where something else is already
   deploying or importing makes any surprise that follows unattributable. **This buys
   attribution, not safety** — and the distinction is the whole paragraph, because
   otherwise a reader takes it for a collision risk, verifies that a
   `supabase functions deploy` and a Vercel build are wholly independent mechanisms,
   concludes correctly that they cannot collide, and drops the constraint. **They cannot
   collide is a different claim from a surprise stays attributable, and only the second
   one survives contact with an actual surprise.** If something odd appears at 05:40 and
   two things deployed between 05:30 and 05:35, there is no clean signal to read and the
   investigation starts with no way to halve the search space. The cost of waiting is
   minutes; the cost of an unattributable surprise is the whole investigation. Same
   reasoning that holds stage 3 of the AWIN rollout: one change at a time so its effect
   is readable.

   **The windows to stay out of, in UTC, so nobody has to go and find them** (a reader
   who has to look them up will not):

   | | What | When |
   |---|---|---|
   | GitHub Actions | `refresh-debenhams` | 02:00 |
   | | `sync-adg-feed` | 02:37 |
   | | `sync-bb-feed` | 03:00 |
   | | `refresh-homepage-demo` — **deploys production via Vercel** | 05:30 |
   | pg_cron | retailer imports, half-hourly and contiguous | **03:30 – 07:47** |
   | | `refresh-yesstyle` — **outside that window** | 10:00 |
   | | `fmb-import-watchdog` / `brand-index-refresh` — always on | every 5 / 11 min |

   **Two things the "03:30 to 07:47" shorthand hides.** `refresh-yesstyle` is a retailer
   import at **10:00**, well clear of the block, so "after 07:47 is clear" is wrong for
   one retailer. And **05:30 is two jobs, not one**: `refresh-homepage-demo` (Vercel
   production deploy) and `refresh-organic-pharmacy` (pg_cron import) start in the same
   minute. Clearing the Vercel build does not clear the import.

   The practical rule: **the quiet stretch is roughly 08:05–09:00 UTC**, after
   `refresh-atelier-de-glow` at 07:47 and before `monitor-feeds` at 09:00. Deploying
   outside it is fine, but say in the deploy note what else was in flight, so the next
   person reading an anomaly knows what to rule out.

   **08:05 and not 08:00, which is the whole point of the paragraph below.** An earlier
   draft of this said 08:00, reasoned from `refresh-atelier-de-glow` finishing in its
   normal ~1–2 minutes. On the slow band that run does not finish until roughly 08:04.
   **A margin reasoned from the normal band was wrong by exactly the amount the normal
   band hides**, in the very paragraph warning against reasoning from averages.

   **How long the imports actually run, measured from `scrape_log` rather than assumed.**
   14 days to 5 August 2026, `completed_at - started_at`, all `status = success`:

   | Retailer | Rows | Normal run | Runs |
   |---|---|---|---|
   | The Organic Pharmacy | 114 | 4.6 – 16.4s | 13 |
   | Escentual | ~7,970 | 24.3 – 78.6s | 11 of 12 |
   | Gorgeous Shop | ~9,700–11,300 | 61.4 – 115.9s | 8 of 12 |
   | Boots | ~37,000 | 68.7 – 108.6s | 12 of 14 |

   **Row count does not predict duration, and an expectation carried into this
   measurement needs correcting.** The sequencing work assumed stage 5 would need a
   larger margin *because Boots is a bigger retailer* — 35,912 rows was cited as
   materially longer. **It is not.** Boots at ~37,000 rows runs 69–109s. Gorgeous Shop at
   ~11,000 rows runs 61–116s — the same, on a third of the rows. A stage is not longer
   because the retailer is bigger, and the intuition that it is should be discarded here
   rather than carried to the next stage.

   **Stage 5 does still need its own number — for the slow-band reason below, not the
   size reason.** Those are different numbers arrived at different ways, and conflating
   them would produce a margin that looks reasoned and is not.

   **THE MARGIN MUST BE PLANNED AGAINST THE SLOW BAND, NOT THE NORMAL ONE.** Across all
   147 completed runs in the window: **124 took 1.0–185.3s, 23 took 902.4–1028.3s, and
   NOTHING took anything in between.** An empty twelve-minute gap in the distribution is
   not work varying with load; it is two different behaviours. The slow band hits **7 of
   12 retailers, about one run in six, on 12 of the 14 days**, never all retailers on the
   same day, and every one of those runs reports `success` with normal `price_updates` —
   so the work completes and it is the timing that is anomalous. **The cause is not
   established.** Do not plan a deploy margin from the normal figures above: any import
   can take **~17 minutes**, and one in six does.

   Recorded as work list item 40, because a 16% rate of runs taking an order of magnitude
   longer than the rest is larger than a deploy-timing footnote.

   **What this settles and what it does not.** `refresh-organic-pharmacy` is not a
   constraint on tomorrow: at 4.6–16.4s it is clear by 05:30:17 at worst, and the 05:45
   wait covers it by 34 minutes. **But the wait was reasoned from one of the two jobs at
   05:30 and happened to cover both, which is luck rather than method, and it will not
   hold for a later stage.** A stage landing near a retailer in the slow band needs its
   own number from the table above plus the ~17-minute allowance, not this one.

   **A note on sample size, which is why this table gives ranges over 11–14 runs rather
   than a figure.** Organic Pharmacy was first put at 5–8s from six consecutive runs. Over
   thirteen the range is 4.6–16.4s — the six-run sample understated the maximum by
   roughly 2×, on the *least* variable importer in the table.

   **It changes no decision here, and that is precisely why it is worth recording.** A
   convention that only surfaces when it rescues you is easy to believe and easy to treat
   as folklore about near-misses. One that surfaces when nothing was at stake is the
   version that shows the rule holds generally — the six-run sample was wrong about the
   maximum whether or not anything depended on it. Convention 18, a method proven on a
   case too small to stress it.

#### LIVE INSTANCE, 3 August 2026 evening

**This stopped being hypothetical the same day it was written.**

**Production is running `import-awin-feed` deployed from the branch
`feat/awin-sibling-coalesce`. `main` still carries the old column list.** The deployed
code requests both halves of all three sibling pairs; the code on the default branch
requests one half of each. **Nothing anywhere records this.** Anyone reading `main`
tomorrow to see what the importer does will read something that is not running.

It is not wrong, and it is deliberate: the branch is unmerged because stage 1 is
unconfirmed until the 05:30 UTC run, and staging discipline says a stage is confirmed
before the next begins.

**Two options were considered tonight and rejected, recorded so they are not
re-proposed:**

| Option | Why rejected |
|---|---|
| A header comment in the function saying which branch is deployed | **It would live on the branch.** Someone reading `main` would not see it, which is exactly the reader this is meant to help. The note has to exist somewhere both branches share, or somewhere outside the repository entirely. |
| Merge now with all flags false | Defensible, since every retailer's flag is off and the flag-off path is byte-identical to the old code. But it **merges unconfirmed work to satisfy a documentation problem**, and staging discipline exists precisely to stop that trade. |

#### RESOLVED 5 August 2026 — correct on its merits, arrived at by accident

**Both halves matter and the second is why this is recorded rather than quietly closed.**

**It is correct.** `main` now contains the deployed importer, via PR #185. The reason the
merge was set aside on 3 August was that it **spent the staging discipline to solve a
documentation problem** — merging unconfirmed work to make a document accurate. That
reason has expired: **stage 1 is confirmed against its live run, stage 2 is flipped, and
`sibling_coalesce` gates behaviour per retailer independently of what `main` contains.**
Merging changes no behaviour and removes the divergence. On 5 August it is simply the
right state.

**It was an accident.** The branch for the Debenhams artefact change was cut from
`feat/awin-sibling-coalesce` rather than from `main`, so PR #185 carried four unrelated
commits with it. Nobody decided this; the base was not checked.

**Recording only the first half would be worse than not recording it**, because it would
read as evidence that branching errors are harmless. They are harmless *here* only
because the merge had independently become correct in the two days between. Had this
happened on 3 August it would have merged genuinely unconfirmed work into the default
branch. **The outcome was luck operating on a shrinking window, not a safe class of
error.** See `README.md` convention 19.

**Leaving it was the choice for one night**, and the divergence was recorded here instead.
That is the smallest honest option: it does not pretend the gap is closed, and it does
not spend the staging discipline to close it.

**The general lesson is the one the item already states, now with an example attached:**
the gap is not that a deploy happened outside CI. It is that **nothing anywhere ties the
running code to a revision**, so the divergence had to be noticed by the person who
created it and written down by hand. That is not a mechanism.

**Not proposing a fix here.** CI deployment needs a service-account token with deploy
rights and a decision about whether an automated system should be able to write to the
import path at all — which, given this project's caution about that path, is a real
question rather than an obvious yes. Recording the exposure so the decision is
deliberate.

---

### 35. Category backfill: the actual fix for item 18, and it is not an importer flag

**Raised 4 August 2026. NOT STARTED. Needs its own dry run, staging and decision.**

**Why this exists.** The AWIN sibling coalesce recovers category columns the importer
was discarding, but `import-awin-feed` assigns `top_category`, `product_type` and
`subcategory` **only when creating a product**. Existing products take the update path,
which does not carry category. Every misassigned product already exists, so **the
coalesce is prospective only** and item 18 needs a separate backfill. See the correction
on item 18 and `README.md` convention 17.

**Known affected set**, measured 3 August 2026:

| Retailer | Rows | What the importer reads | What the feed populates |
|---|---|---|---|
| Stylevana | 12,122 | `merchant_product_category_path` 0.0%, `category_name` 0.0% | `merchant_category` 98.6%, `product_type` 100% |
| Beauty Flash | 7,315 | `merchant_product_category_path` 0.0% | `merchant_category` 100% |

**19,437 rows currently categorised from the product name alone.**

**ITEM 6 APPLIES AND WAS NEVER PRICED.** This is a catalogue-wide `UPDATE` to
`products`, so both mechanisms in item 6 bite on every touched row:

1. **`search_vector` is a STORED generated column** over `name`, `brand`,
   `product_type`, `description`. Postgres recomputes a stored generated column on
   every row update **without dependency tracking**, so `to_tsvector` re-runs even
   though none of its inputs changed, producing an identical value at full cost.
2. **`normalised_brand` is indexed**, so the update cannot be HOT. Index entries are
   rewritten across the table's indexes, **including the GIN on `search_vector`**.

Item 6 states this is trivial at 1,082 rows and material at 100,000. **19,437 sits
between**, and that cost was not part of anyone's mental model when this looked like an
importer flag. Neither author nor operator priced it.

**What a design has to decide**, none of it obvious:

- **Which column wins** where the recovered path and current name inference disagree.
  The recovered column is not automatically right: `merchant_category` is a merchant's
  own taxonomy, not ours.
- **Whether to re-derive or to overwrite.** Re-running `inferCategorisationForImport`
  with the recovered path is not the same as taking the merchant's category verbatim.
- **What happens to products a human has corrected.** See the precondition below; this
  is no longer one open question among four.
- **Whether it is one pass or per-retailer**, given the coalesce rollout is per-retailer
  and only two retailers are known affected.

**Dry run must count how many products CHANGE category, by direction**, before any
write. A count of rows touched is not the same measurement, and item 6's cost is paid on
touched rows whether or not they change.

---

#### REQUIRED FIRST STEP: capture category provenance. THE BACKFILL IS NOT APPROVED TO PROCEED WITHOUT IT.

**Investigated 4 August 2026. Manual category corrections CANNOT be identified
retrospectively. Not with difficulty: at all.**

**`categoriser_safety_net_log` is the table built for exactly this**, with
`product_id`, `old_top_category`, `old_subcategory`, `new_top_category`,
`new_subcategory`, `reason` and `run_at`. It holds **zero rows, and its sequence has
NEVER ADVANCED** (`categoriser_safety_net_log_id_seq`, `last_value` never called).
That distinction is the decisive one: a row count of zero is consistent with a table
that was emptied, and a never-called sequence is not. **It was never written to, rather
than cleared.** Same decisive test, and same result, as `price_history`.

**Nine migrations changed categories in bulk and none recorded what they touched:**
`bath_body_backfill`, `skincare_catchall_cleanup`, `detector_widen_homefrag_aromatherapy`,
`skincare_colour_decontam_backfill`, `p2a_bodyhandfoot_to_bath_body`,
`bathbody_phase1_miscategorised`, `lash_and_bodyspray_rule_backfill`,
`recategorise_helpers`, `hoa_lash_backfill_c`. Each applies a predicate and moves what
matched. **The predicate survives in the file; the set of products it hit does not**, and
re-running it today would match a different set, because the shade collapse and merge
passes have since rewritten many of the names those predicates keyed on.

**No P2b migration exists by filename.** Whatever those rulings were, they are not in the
migration history under that name.

**What does exist does not help.** `product_merge_log` (4,382), `product_detach_log`
(841), `shade_regroup_log` (103) and five dated backup tables are substantial and
carefully kept, and **all record identity rather than category**.
`fwee_recat_backup_20260716` is the sole exception at **4 rows**, which proves the
practice was known and applied once.

**CONSEQUENCE FOR THE TWO ROUTES.**

- **Route 1, reconstruct provenance first: NOT AVAILABLE.** The information was never
  captured. It is not lost, it was never written.
- **Route 2, accept the loss on evidence that corrections are few: THE PRECONDITION
  CANNOT BE MET.** That evidence does not exist and cannot be produced. The count of
  hand-corrected categories is not merely unknown, it is **unknowable from what
  survives.** Route 2 is therefore **accepting an UNMEASURED loss on NO evidence**, and
  it must be stated in those words. It may still be the right decision. The softer
  version is not available.

**THE PRECONDITION, and the reason it is required rather than suggested.**

Capture provenance **going forward**, before the backfill runs: a column or log
recording how each category was set, written by both the importer and any future bulk
pass.

It **recovers nothing**. Every category set before it is unrecoverable regardless.
**What it does is make the backfill the LAST operation that can destroy category history
silently.** Without it, this backfill destroys history invisibly and so does every future
one. With it, this is the final time that is possible.

That is why it is a precondition and not a good idea to do alongside: its entire value is
that it exists *before* the destructive operation, and there is no second chance to
place it there.

**The nine misassignments from item 18's original scope are still unexplained** and
should not be assumed to be inside this set.

---

### 36. Enumerate the never-written tables, rather than finding the fourth by accident

**Raised 4 August 2026. REPORT ONLY.** `categoriser_safety_net_log` is the **third**
purpose-built record found empty this fortnight, after `price_history` and the
`routine_email_log.outcome` column that did not exist. Three by accident is a pattern
worth enumerating rather than continuing to trip over.

#### The decisive test, and why a row count is not enough

**A row count of zero is consistent with a table that was emptied. A sequence that has
never advanced is not.** Only two sequences in `public` have never been called:

| Table | Sequence | Verdict |
|---|---|---|
| `categoriser_safety_net_log` | never called | **never written** |
| `price_history` | never called | **never written** |

Every other sequence has advanced. Use this test, not `count(*)`, when the question is
"was this ever written to".

#### But the sequence test does not enumerate the class

**Twelve further tables are empty and have no sequence**, so they are invisible to that
test:

`brand_spotlight_config`, `review_queue`, `routine_alerts`, `user_routines`,
`metrics_amazon_monthly`, `metrics_awin_weekly`, `metrics_brand_spotlight_weekly`,
`metrics_ga4_weekly`, `metrics_quality_weekly`, `metrics_rakuten_weekly`,
`metrics_retailer_quality_weekly`, `metrics_social_weekly`.

**Also note `pg_class.reltuples` is useless here**: it reads `-1` for most tables,
meaning never analysed rather than empty. A sweep built on it would have reported almost
the whole schema as empty and been discarded as noise.

#### The distinction that actually matters, and it is not emptiness

**"Empty because the feature is not built" is not the same defect as "empty because
something was supposed to write and does not".** The eight `metrics_*` tables are empty
because the dashboard's Step 5 has not been built; that is a schema waiting for a
feature, and it is fine. `price_history` is empty **while carrying three maintenance
functions written to keep its rows consistent**. `categoriser_safety_net_log` is empty
while nine migrations changed the exact columns it exists to record.

**The discriminator is whether a writer exists**, and it is cheap to check:

| Table | Code refs | Has an INSERT | Reading |
|---|---|---|---|
| `price_history` | 0 | no | **Defect.** Maintenance functions exist for rows that never arrive |
| `categoriser_safety_net_log` | 0 | no | **Defect.** Purpose-built for changes that happened nine times |
| `metrics_ga4_weekly` | 2 | no | Awaiting Step 5. Expected |
| `routine_alerts` | 1 | **yes** | Has a writer, simply not fired yet |

**No fourth defect found.** The enumeration is the point: the class is now bounded, and
the next empty table can be classified rather than investigated from scratch.

#### What would prevent a fifth

Nothing currently. A table can be created, given maintenance functions, referenced in a
brief, and never written to, and **no check anywhere notices**. A periodic assertion that
every table with a stated purpose has received at least one row within N days of creation
would catch this class at creation time rather than months later during unrelated work.
Not proposed as work, recorded as the shape a fix would take.

---

### 37. Debenhams feed shrank 29% at source, and the guard has refused twice

**Raised 4 August 2026, second failure 5 August. WATCHING, not fixing. AWIN message HELD.**

`refresh-debenhams.yml` has failed on 4 and 5 August at its filtered-row guard. **The
import was never invoked either day**, so nothing partial was written and
`retailer_import_config` for retailer 28 is untouched. Last successful import
**3 August 05:44**.

| Date | Input rows | Raw bytes | Beauty rows | Hit rate |
|---|---|---|---|---|
| 31 Jul | 2,502,027 | 140.2 MB | 12,757 | 0.51% |
| 1 Aug | 2,535,936 | 143.4 MB | 12,721 | 0.50% |
| 2 Aug | 2,665,696 | 155.7 MB | 12,719 | 0.48% |
| 3 Aug | 2,664,884 | 155.4 MB | 12,623 | 0.47% |
| **4 Aug** | **1,895,051** | **112.8 MB** | **6,359** | **0.34%** |
| **5 Aug** | **1,891,597** | **112.7 MB** | **6,323** | **0.33%** |

**Stable, not progressive.** Day-over-day 4→5 August is −0.18% input, −0.08% bytes,
which is *smaller* than ordinary variation before the drop (31 Jul → 1 Aug was +1.4%).
**The feed shrank once between 3 and 4 August and has stayed at the new level.** That is
a supply change, and it also means **it will not recover on its own.**

**Beauty fell disproportionately**: the feed lost 29% and beauty rows lost 50%, so the
hit rate moved 0.47% → 0.33%. Truncation removes rows roughly uniformly; a category or
merchant segment leaving looks like this. That points at supply rather than transfer, and
it is the difference between waiting and asking.

**No feed was withdrawn.** `refresh-debenhams` combines **eight** feed ids
(`90938, 90940, 90945, 90947, 91126, 91133, 91134, 91135`). Each was diagnosed
individually on 5 August: **none errors and none is empty.** So "one of Debenhams' feeds
was withdrawn" is the wrong thing to say to AWIN.

**Two of the eight could not be profiled.** `90945` and `91134` crashed `feed-diag` with
a Node heap OOM — a limit of the diagnostic, not an AWIN failure. Between them they hold
roughly 1.02M of today's 1.89M rows, so **more than half the feed is unprofiled** and the
beauty rows may be in there. **This is why day two produced a partial answer.**

#### Fixed 5 August: a refused run now retains evidence

The filtered feed was computed, inspected by the guard, and **thrown away** on a failing
run, because the Storage upload runs *after* the guard. Two mornings were spent able to
say the feed had shrunk by half and unable to say **which products left**.

`refresh-debenhams.yml` now uploads the filtered feed as a run artefact **before** the
guard, 30-day retention, on pass and on refusal alike. The guard is unchanged and still
stops the import; the Storage upload still runs after it, so **the last good copy
(3 August) is preserved as the "before"** and a refused run supplies the "after".

**The 3 August baseline, already retrieved from Storage:** 12,623 rows, 684 brands. Top
categories `Beauty > Face > Foundations` 914, `Beauty > Lips > Lip Sticks` 508,
`Beauty > Women Fragrance > Eau De Perfumes` 379. Top brands INGLOT 760, MAC 463,
Revolution 453, Lancome 445, KIKO 384.

#### Trigger and deadlines

**Revisit Friday 7 August.** If still failing, the AWIN message goes with four days of
stable shrinkage **plus the artefact diff naming exactly which products left**. That is a
materially stronger message than one sent on day two, and nothing deteriorates while
waiting because the shrinkage is stable.

> **A SOFT DEADLINE NOBODY HAS SET, recorded so it is not discovered late.**
> **7,358 sole-offer Debenhams products** are being served at prices last confirmed
> 3 August. On those products there is no second retailer to fall back to, so the price
> shown is the only price shown.
>
> The **36-hour staleness alert now fires every morning** and will keep firing, which is
> the alert-fatigue risk convention 3 describes: a daily red line that everyone knows the
> reason for trains the habit of dismissal, and the next genuine one arrives into that
> habit.
>
> **Fine at two days. Worth naming at two weeks.** The absence threshold is 30 days, so
> nothing degrades automatically before then — but "not yet degraded" and "still correct"
> are different claims, and only the first is true after a fortnight.

---

### 38. Reading the preload click-out test: the comparator, and what the server table cannot see

**Raised:** 5 August 2026 · **NOT A TASK.** Two things a reader needs *before* quoting a
preload figure, recorded here because that is where the other caveats of this class have
landed.

**The 4.7 per cent comparator is not available, and the preload brief carried it
forward.** `docs/strategy-amendments.md` A6 already records why: the 4.7 per cent
click-out rate used comparison views as its denominator, and that denominator was broken
by the gtag hydration race until 29 July. Its own amendment says the conclusion may still
hold but **the number should not be quoted as measured**. A preload test framed as
"better than 4.7 per cent" is therefore testing against a figure the project has already
withdrawn.

**What the test is instead.** Preload-clean against preload-merged, and against the
post-3-August baseline once that baseline exists. Both comparisons are internal to the
corrected instrument, which is the only way to avoid inheriting the broken denominator.
The three-way `preload_case` split shipped today (§4.3 of the preload-collision brief) is
what makes the first comparison possible; the second waits on the date-gated metrics that
first render from the week beginning 3 August.

**What `outbound_clicks` can and cannot see.** Item 15 bounds this and is unfixed by
design. The routine builder's two hand-rolled cross-check anchors call
`trackRetailerClick` and `trackAffiliateClickOut` but never `sendOutboundBeacon`, so
`select count(*) from outbound_clicks where source like 'routine_%'` still returns **0**.
Re-confirmed 5 August 2026.

Everything the server table holds from `/app`, as at 5 August 2026:

| `source` | Rows |
|---|---|
| `optimiser_shop_button` | 8 |
| `optimiser_shop_button_preload` | 3 |
| `optimiser_modal` | 1 |
| `routine_*` (both cross-check links) | **0** |

**12 rows in total, against 335 in the table.** Any server-side preload figure sees the
Shop-button, open-all and modal paths and nothing else. Quote it with that scope attached
or not at all.

**And the rate itself cannot be computed server-side at any price.** `session_id` is NULL
on **all 335 rows** — `ensureSessionId()` is never called anywhere in the repo, so the
`fmb_sid` cookie is never set (`lib/session.ts` defers it pending consent posture).
Populating it would not help: `outbound_clicks` holds no *arrival* rows, so the
denominator does not exist in that table and never will. The rate is a GA4 computation.
The server table is a cross-check on the numerator, scoped as above.

**Why the click-source suffix was the right carrier.** GA4 event-scoped parameters do not
join across events, so a flag on `load_routine_from_url` alone cannot filter
`retailer_click` — numerator and denominator each need the distinction on their own event.
`clickSourceFor` already fed both GA4's `click_source` and `outbound_clicks.source`, so
extending it from `_preload` to `_preload_{case}` put the split into both pipelines from
one line, with no schema change, no cookie and no consent question. The three rows written
before 5 August carry the bare `_preload` and are not case-attributable; `like '%_preload%'`
still catches them.

#### KNOWN LIMITATION: `self_reload` cannot be read as a reload rate

**Recorded 5 August 2026, before the pins produced any data. Not a task — a property of
the instrument that has to be known when the figures are read.**

`self_reload` is assigned when the basket was non-empty and **every product the link
resolved to was already in it**, so nothing was added. The intended meaning is *the
visitor is returning to a link they already opened*.

**It also captures a genuine first arrival by someone who already holds all of the link's
products**, by whatever route — added by hand from product pages, arrived from a different
pin carrying an overlapping routine, restored from a saved-routine email. **Nothing
distinguishes the two.** `fmb_routine` stores `id`, `name`, `brand` and `category` and no
provenance, and nothing anywhere records which routine links a browser has opened. The two
cases are identical in every value available at classification time.

**The bias is one-way, which is the useful part.** The confusion can only move a session
from `clean` to `self_reload`, never the reverse: a first arrival with *partial* overlap
still adds something, so it is correctly `merged`. So when the numbers are read:

| | |
|---|---|
| `clean` | a **lower bound** on genuine first arrivals |
| `self_reload` | an **upper bound** on returns |
| `merged` | exact — a non-empty basket plus at least one product added |

**Likely rare, stated as a judgement and not a figure**, because no figure exists yet and
one invented now would be worse than the judgement. It requires the visitor to already
hold **every** product the link resolves to — five of five for the current pins, not three
of five. Against a catalogue of ~84,780 products and hand-built baskets that are typically
a handful of items, a Pinterest arrival holding all five by coincidence is improbable. The
realistic route to it is not coincidence but the same routine reached twice by different
paths, which is arguably a return anyway. **The expectation is therefore that
`self_reload` is close to a reload rate, without being one.** If it comes back large, that
expectation is what to re-examine first, rather than assuming a surge in reloads.

**What would settle it, not proposed and not scheduled:** persist a marker of which
routine-link signatures a browser has opened, and classify on that instead of on basket
contents. That is new client state and a new thing to keep correct, which is why it was
not built for a case expected to be small. Recorded so the option is on paper rather than
rediscovered.

**Why this is written before the pins rather than after.** An unrecorded classification
ambiguity in a measurement that is about to start collecting is the shape that gets
rediscovered from the data three weeks in — at which point the affected sessions can no
longer be separated, because the thing that would separate them was never stored.

---

### 39. `load_routine_from_url` fired two parameters unreadable for three months

**Raised:** 5 August 2026 · **CLOSED the same day by registration.** Recorded because the
detection story matters more than the fix.

**The finding.** `load_routine_from_url` carries `routine_size` and `source`. Neither had
ever been registered as a GA4 custom definition, so neither was readable in any report.
The event fired correctly, the payload was correct, and the values were discarded on
arrival.

| Parameter | Firing since | Readable before 5 Aug |
|---|---|---|
| `routine_size` | 10 May 2026, `8fcfc25` (Phase 6 port) | No |
| `source` | 2 August 2026, `28d565e` | No |

**A date correction worth keeping.** This was first put at "unreadable since 29 July".
That is the date the *hydration race fix* landed, after which the event began reliably
delivering — a different fact. `routine_size` has been unreadable since **10 May**, very
nearly three months, and `source` since it shipped three days ago. The span is the
finding, not the week.

**The consequence.** `source` exists precisely to separate Pinterest arrivals from email
ones (`routineArrivalSource()` reads `utm_source`, and its comment explains the design at
length). That split has never been available. The preload test would have shipped on
4 August believing it could attribute arrivals by campaign, and could not have.

**The class.** Same as the gtag hydration race: correct code, correct-looking deploy,
silent total loss at a boundary nothing watches. Different mechanism, identical signature.
It was found by a human opening the GA4 admin page to register three *new* parameters and
noticing the two old ones were absent — not by any test, log, alarm or check, because
none exists that could. See convention 22.

**Registered 5 August 2026**, five definitions: `preload_case` (dimension),
`existing_item_count` and `added_item_count` (metrics), `source` and `routine_size`.
**Registration is not retroactive.** Nothing before 5 August is readable through any of
the five, including the three months of `routine_size`. Recorded as `platform_changes`
id 30 and as
`supabase/migrations/20260805120000_platform_changes_ga4_custom_definitions.sql`. Full
verification record and reasoning in `docs/ticket-preload-collision.md`.

---

### 40. One import run in six takes ~17 minutes, and the distribution has an empty middle

**Raised:** 5 August 2026 · **REPORT ONLY.** Found while measuring import durations for
item 34's fourth exposure, not by looking for it.

**The observation.** 147 completed `scrape_log` runs in the 14 days to 5 August 2026:

| Band | Runs | Range |
|---|---|---|
| Normal | 124 | 1.0 – 185.3s |
| Slow | 23 | 902.4 – 1028.3s |
| **Between 185.3s and 902.4s** | **0** | — |

**The empty middle is the finding.** A duration that varied with feed size, network
conditions or row count would fill that gap. Nothing does. Two behaviours, not one
behaviour under load.

**What it is not.**

- **Not a failure.** Every slow run reports `status = success` with `price_updates` in
  its normal range. The work completes; the timing is what is anomalous.
- **Not one retailer.** 7 of 12 affected: Boots, Escentual, Gorgeous Shop, Beauty Flash,
  Perfume Click, YesStyle, Branded Beauty.
- **Not a daily platform stall.** It occurs on 12 of 14 days, 1–3 runs per day, never all
  retailers on the same day. A shared outage would take the whole day's runs together.
- **Not size-driven.** Boots at ~37,000 rows sits at 69–109s normally; Gorgeous Shop at
  ~11,000 rows sits at 61–116s. Both appear in the slow band anyway.

**The tight band across unrelated retailers is what makes a fixed bound the likely
shape** — a lock wait, a cold start, a retry with fixed backoff, or `completed_at` being
written late — rather than anything proportional to work. **That is a hypothesis and is
recorded as one.** It has not been tested, and the honest position is that the cause is
unknown.

**Why it matters beyond curiosity.**

1. **It sets the deploy margin.** Item 34's fourth exposure has to allow ~17 minutes for
   any import, not the 1–2 minutes the normal band suggests. A margin planned from the
   average is wrong one run in six.
2. **It is invisible to everything that watches.** The runs succeed, so no alert fires and
   no guard trips. This is the detection-gap class of item 14: the system reports success
   and the anomaly is only visible to someone who subtracts two timestamps.
3. **It bounds the import window.** The 03:30–07:47 block assumes runs finish long before
   the next starts. Jobs are half-hourly and the slow band is ~17 minutes, so a slow run
   still fits — but the headroom is 13 minutes, not 28, and nothing is watching that.

**What would settle it**, in rough order of cost: check whether `started_at` and
`completed_at` are both written by the function or one by a wrapper; check Supabase
function logs for a slow run against a normal one on the same retailer; look for a retry
or backoff constant near 900s in `_shared`. **None of this is on the critical path and
none of it should displace the 4 August queue.**

---

### 41. `import_run_state` is deleted on success, so it has no history and the watchdog sees only what is in flight

**Raised:** 5 August 2026 · **REPORT ONLY.** Not a defect. The design, stated,
because it was being read as a coverage gap.

**The mechanism.** `import-awin-feed/index.ts`, on the last slice, immediately after
`finaliseRun`:

```ts
await supa.from("import_run_state").delete().eq("run_id", runId);
```

**So the table holds zero rows in the steady state.** Verified 5 August 2026:
`select count(*) from import_run_state` returns **0**, with no oldest row and no
newest row — nothing has ever been retained.

**What that means for `fmb_watchdog_stalled_imports`** (cron 28, every 5 minutes). It
reads `import_run_state` where `kind='meta' and key=''`, and fires when
`next_slice < total_slices` or when an inflated blob exists with `total_slices` still
NULL. Every row it can ever see belongs to a run that is **currently in flight or
stalled mid-chain**. A run that completed leaves nothing. A run that died before its
first staging write leaves nothing either.

**The watchdog is therefore not under-scoped; it is exactly scoped, and the scope
excludes history by construction.** It cannot be audited against past runs, it cannot
be shown to have handled a stall correctly after the fact, and "it found nothing" is
indistinguishable from "there was nothing" — which is convention 11's problem arriving
through the data model rather than through the guard.

**This retrospectively re-reads the 29 July YesStyle stall.** That incident recorded
`import_run_state` empty as evidence the run never reached the staging write, and the
watchdog's silence as a scope limit. **The scope reading was right and needs no
change.** The evidence reading needed qualifying: emptiness is the default for every
finished run, so it is only evidence in conjunction with the run not having completed.
Corrected in `docs/ticket-import-observation-offset.md`, which also carried a
mis-citation: the in-flight blindness point was attributed to convention 8 and was not
recorded as a convention anywhere. **It is now `supabase/migrations/README.md`
convention 23**, generalised past the watchdog — *a mechanism that resumes work in
progress cannot see work that never started* — and written because a document cited it
as already existing, which is the provenance worth keeping.

**The gap, stated precisely, because the loose version is wrong.** It is not that the
watchdog fails to look. **It is that a crashed run leaves nothing behind to look at.**
Those imply different fixes: the first would mean changing the watchdog, the second
means retaining state. Nothing here argues for either — `monitor-retailer-feeds` at
09:00 already covers runs that never completed, and it is what caught YesStyle.

**What retention would buy, if it is ever wanted:** the ability to say how often the
watchdog actually fires, whether a resumed slice completed, and how long stalls last.
None of that is available today, and item 40's slow band is a live example of a
question the current design cannot answer — a ~17-minute run and a stalled-then-resumed
run are indistinguishable after the fact, because both end with an empty table and a
`success` row.

---

### 43. We emit GA4 parameters nothing checks are registered — three found in two days

**Raised:** 6 August 2026 · **REPORT ONLY**, and the report is below. **A class, not three
incidents.** See convention 23 in `supabase/migrations/README.md` for why the detection gap
is structural.

**The mechanism.** A GA4 event parameter is only readable if a custom dimension or metric is
registered **by hand in the GA4 admin**. That registration exists in no file, no environment
variable, no migration, and in nothing the running code can observe. `gtag` accepts an
unregistered parameter silently, it appears in realtime, it passes every assertion, and it is
discarded on arrival. **Nothing in this repository reconciles what we emit against what is
registered, and nothing can.**

**Three instances in two days**, none found by a check:

| Parameter | Event | Emitted since | Found |
|---|---|---|---|
| `routine_size` | `load_routine_from_url` | 10 May 2026 (`8fcfc25`) | 5 Aug, registering something else |
| `source` | `load_routine_from_url` | 2 Aug 2026 (`28d565e`) | 5 Aug, same visit |
| `method` | `save_routine` | — | 6 Aug, looking for a number |

The first two were registered on 5 August (`platform_changes` id 30). `routine_size` had been
unreadable for **nearly three months**.

#### What we emit

Enumerated from source, 6 August 2026. **Custom parameters only** — GA4 standard fields
(`items`, `item_id`, `item_brand`, `item_category`, `value`, `currency`, `search_term`) are
excluded because they need no registration.

| Event | Site | Custom parameters emitted |
|---|---|---|
| `affiliate_clickout` | `lib/analytics.ts:13` | `retailer`, `product_id` |
| `retailer_click` | `lib/analytics.ts:138` | `retailer_id`, `retailer_name`, `affiliate_network`, `basket_item_count`, `is_best_value`, `list_position`, `click_source`, `brand_slug` |
| `basket_optimised` | `lib/analytics.ts:181` | `basket_item_count`, `winning_retailer_count`, `result_type`, `unpriced_item_count`, `winning_basket_total`, `savings_value`, `savings_suppressed`, `optimisation_trigger` |
| `view_item` | `lib/analytics.ts:230` | `num_retailers` |
| `search` | `lib/analytics.ts:255` | `result_count`, `search_source` |
| `load_routine_from_url` | `RoutineBuilder.tsx:401` | `routine_size`, `source`, `preload_case`, `existing_item_count`, `added_item_count` |
| `save_routine` | `RoutineBuilder.tsx:870`, `:920` | `method`, `routine_size` |
| `open_all_products` | `RoutineBuilder.tsx:983` | `product_count`, `blocked_count` |
| `track_product` | `AccountRoutine.tsx:155` | `source` |
| `add_to_cart` | `lib/analytics.ts:205` | *(standard only)* |

**33 distinct custom parameter names across 10 events.**

#### What is recorded as registered

Only these, and only from repository records — **I cannot read the GA4 admin**, so this is
what the repo claims, not what the console shows:

| Parameter | Evidence |
|---|---|
| `affiliate_network`, `retailer_name`, `brand_slug` | `dashboard-build-brief.md:310`, registered before 27 July |
| `click_source` | work list item 15, "registered GA4 dimensions" |
| `num_retailers` | `lib/analytics.ts:217`, comment claims "a registered custom metric" |
| `preload_case`, `existing_item_count`, `added_item_count`, `source`, `routine_size` | `platform_changes` id 30, registered 5 Aug 2026 |

**That leaves roughly 20 emitted parameters with no record of registration either way** —
including every parameter on `basket_optimised`, which is the event the savings proposition
is measured through, and `method` on `save_routine`, which is what prompted this.

**They are not established as unregistered.** They are **unchecked**, which is the finding.

#### The gap runs in both directions

`dashboard-build-brief.md:402` records the mirror image: *"Three further dimensions were
registered on 27 July under the v1 shorthand: network, retailer and brand. No event sends
parameters by those names, so they will never collect anything."*

So there are **registered dimensions collecting nothing** and **emitted parameters readable
by nothing**, and no artefact anywhere lists either set. A reconciliation needs both halves.

#### What would close it, not proposed and not scheduled

The emitted half is derivable from source — the table above was produced by a regex over
`gtag('event', …)` call sites in about a minute, and could be a script. The registered half
needs the **GA4 Admin API** (`properties/415465396/customDimensions` and
`customMetrics`), which `scripts/ga4-diag.mjs` already authenticates for
(`ga4-diag.mjs:94` — "analytics.readonly covers BOTH the Data API and the Admin"). **The
credentials and the access already exist; nothing joins the two lists.**

**Stopping here as instructed.** The reconciliation is a build and this is a report.

---

### 44. Four days of barcode reject reasons were destroyed before anyone could read them

**Raised:** 7 August 2026 · **CLOSED by deploying the fix.** Recorded because the data is
unrecoverable and because the window is the cost of a deploy that did not happen, not of the
defect itself.

**The defect.** The sliced-import merge added every counter value numerically. A
`Record<string, number>` of barcode-rejection reasons became the string
`"0[object Object][object Object]…"`, and a boolean flag summed to an integer. Fixed in
`9e1d826` (#187, merged 5 August) via `_shared/merge-counts.ts`, which merges by kind.

**The window.** The fix sat on `main` undeployed. `import-awin-feed` in production stayed at
version 147, `updated_at` 3 August 19:23 UTC, with `merge-counts.ts` absent from the deployed
file list and the additive loop still present.

**Measured 7 August 2026:**

| | |
|---|---|
| Sliced runs writing a corrupted `barcode_reject_reasons` | **35** |
| Retailers affected | **9** |
| Window | 4 – 7 August 2026 |
| Of those runs, reported `status = 'success'` | **35 — all of them** |

**Every one of the 35 reported success.** The import worked; only the diagnostic was
destroyed. That is the detection-gap shape of item 14 arriving inside a field rather than a
job: nothing failed, nothing alerted, and the loss is visible only to someone who checks the
JSON *type* of a nested key.

**Exactly three things were destroyed, and the totals were not among them.** The coercion
happened in memory before `scrape_log` was written, so for sliced retailers between 4 and
7 August these are unrecoverable:

- `barcode_reject_reasons` — the per-reason object
- `barcode_reject_samples` — the samples array
- `sibling_coalesce` — the boolean flag, summed to an integer

**Everything that is a number survived intact, at both layers.** The old merge added values
numerically, which is *correct* for counters and wrong only for everything else — which is
why the fix is titled "merge by KIND, not by addition". Verified 7 August on all eight sliced
retailers: `details.counts.would_update_existing` equals the top-level `price_updates` and
`matched_count` **exactly**, including Boots at 22,195 across roughly five slices. A
last-slice value would have been about 4,400.

#### THIS ENTRY HAS BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS

Recorded because the pattern is worth more than any of the three claims.

| | Claim | Verdict |
|---|---|---|
| 1 | The counts never reached the database | **Wrong** — the totals did |
| 2 | `barcode_rejected` was recorded correctly throughout | **Right** |
| 3 | That figure is a last-slice fragment, so totals are understated | **Wrong** — it is a cumulative counter |

**The common error in 1 and 3 is asserting which layer a number came from without reading
the write path.** `scrape_log` has two: top-level columns (`source_count`, `matched_count`,
`price_updates`) and the nested `details.counts` object. Both are written once, on the last
slice, from the accumulated total — `_shared/run-metrics.ts:64-76` does no merging at all, it
only serialises what it is handed. That was readable throughout and would have settled all
three claims in one query.

**The check that settles it, for next time:** compare a `details.counts` counter against the
top-level column that must equal it. If they match on a multi-slice retailer, the nested
counters are cumulative. It costs one query and needs no knowledge of the merge code.

**Do not "fix" the numeric counters.** They are correct at both layers, and a pass that
normalised them would change right values and introduce the mixed state it was meant to
prevent.

**What it cost concretely.** Work list item 21 — five retailers supplying no EAN — is
answered from exactly these counts, and stage 3 of the AWIN sibling-coalesce rollout was
waiting on Beauty Flash's reject reasons being readable against a known importer version.
Both waited on a deploy, not on a fix.

**The lesson is item 34's, not a new one.** A merged fix is not a deployed fix, and nothing
in this repository can tell the difference — no CI deploys edge functions, and no artefact
records which commit production is running. What made this one legible in the end was that
the corrupted value has a *shape*: `jsonb_typeof(...) = 'string'` where an object belongs.
**Most silent losses do not leave a type mismatch behind, and would not have been findable
this way.**

---

### 45. `filter-debenhams-feed.py` should read `merchant_category` as a second primary signal

**Raised:** 7 August 2026 · **NOT DONE DELIBERATELY.** Identified while adding feed 116972
and explicitly left out of that change.

**The gap.** The filter's primary signal is `merchant_product_category_path`, with a
brand-whitelist plus volume-unit fallback for rows that lack it. **Feed 116972 carries that
column for no row at all**, and classifies in `merchant_category` using Google's taxonomy
(`Health & Beauty > Personal Care > Cosmetics > …`) rather than Debenhams' own
(`Beauty > Face > Foundations`).

So every 116972 row takes the fallback — a path built to rescue designer beauty hiding among
eyewear and handbags inside the *fashion* feeds, not to classify a 23,751-row beauty
catalogue. It admits only rows whose brand is on a hand-maintained whitelist **and** whose
name states a volume. **It undercounts, silently, and the only symptom is a row count that
looks plausible.**

**The fix is small and its effect is not.** Reading `merchant_category` as a second primary
signal — accept `Health & Beauty > Personal Care > Cosmetics` and `> Hair Care`, reject
`Health Care`, `Vision Care`, `Massage & Relaxation` and `Luggage & Bags` — would classify
116972 properly. It also **changes what the filter admits for every feed that populates
`merchant_category`**, which is all nine.

**Which is why it is not folded into the feed-id change.** That change has one observable —
the nine-feed row count — and this would add a second, making tomorrow's number
unattributable between "the rotation recovered N" and "the filter now admits differently".
Same reasoning that kept the guard at 12,000 in that commit.

**What it needs to land safely:** a before/after count on the same raw feed, per category
bucket, so the delta is attributable to the filter rather than to supply. The raw download is
the expensive part and one run produces both — filter the same `raw.csv.gz` twice, old rule
and new, and diff. **That is a script, not a pipeline change**, and it can be done off a
retained artefact without touching the schedule.

**Sequencing:** after the threshold is derived from the nine-feed artefact, not before.
Deriving a floor under one filter and then changing the filter would invalidate the floor in
the same week it was set — and the guard comment now says the basis must be re-derived after
any rotation, which a filter change is, in effect.

---

### 46. Some products cannot be categorised from their name, and no keyword list will fix it

**Raised:** 7 August 2026 · **NOT A BUG. NOT AN OPEN TASK.** Recorded specifically so
nobody re-attempts it with more keywords.

**The importer categorises from name and brand only** — `import-awin-feed/index.ts:2149`,
`inferCategorisationForImport(name, brand)`. The feed's category columns never reach the
categoriser; they are used for *exclusion* (`isPathIncluded`, `isExcludedCategory`). So on
a create-heavy first import, **every** created product's `top_category` and `subcategory`
are inferred from the product name.

#### The demonstration

```
inferCategorisationForImport("Cinq Mondes Bergamot Eau de Parfum 100ml", "Cinq Mondes")
  -> { top_category: "fragrance", product_type: "Eau de Parfum", subcategory: "scent" }

inferCategorisationForImport("Cinq Mondes Bergamot", "Cinq Mondes")
  -> { top_category: "skincare",  product_type: "Skincare",      subcategory: "face" }
```

**Same brand, same botanical, opposite categories.** The only difference is a fragrance
noun in the string.

**This is not a routing bug and not an eligibility gap.** `inferCategorisation` has nothing
in `"Cinq Mondes Bergamot"` to work with, and `classifyFragranceOrPersonalCare` is then
handed a skincare product and correctly declines it. A brand plus a botanical is not
separable from botanical skincare **by any keyword**, because the string contains nothing
that distinguishes them.

**Why more nouns cannot help.** The class is defined by the absence of the signal a
keyword would match. Anything broad enough to catch `"Bergamot"` catches bergamot-scented
body lotion, bergamot facial oil and bergamot candles. The nouns already present —
`RE_HARD_FRAGRANCE_FORM` at `categorisation.ts:35-36` and `fragranceNoun` at `:1094` —
cover `parfum`, `eau de parfum`, `eau de toilette`, `cologne`, `extrait`, `edt`, `edp`.
**`fragrance` and `scent` are excluded deliberately**, with the reason at `:1090-1093`:
they are overwhelmingly descriptors on functional products ("… Fragrance Shower Gel").
A pass adding them would reintroduce a guarded hazard.

#### What the eligibility rule does and does not explain

`:1216-1221` requires `base.excluded ∈ {fragrance, deodorant, shaving}` **or**
`base.top_category === "skincare"` for the extended detector to run. So a fragrance landing
in `makeup` never reaches it. Measured across `products_active`, 7 August 2026:

| `top_category` | hard fragrance form | noun only |
|---|---|---|
| fragrance | 8,760 | 804 |
| **makeup** | **75** | 4 |
| bath_body | 0 | 13 |
| hair | 0 | 7 |
| **skincare** | **0** | **0** |

**Zero in skincare** — skincare *is* eligible, so anything landing there is reached and
rescued. The eligibility gap is real and is **75 rows, 0.8%**, all in makeup.

**The no-noun class does not appear in that table at all**, and cannot: the query finds rows
by keyword, and the class is defined by having none. **It is invisible to the same mechanism
that would have to fix it.** That is the argument for closing this rather than leaving it
open.

#### Measured on Niche Beauty, 7 August 2026 — and this feed largely avoids the trap

The probe (`scripts/feed-categorisation-probe.mts`, run against fid 102930) categorised all
14,636 rows through the importer's own function:

| | rows | |
|---|---|---|
| skincare | 4,642 | 31.7% |
| makeup | 4,528 | 30.9% |
| **fragrance** | **2,197** | **15.0%** |
| hair | 1,427 | 9.7% |
| bath_body | 1,351 | 9.2% |
| excluded, 13 reasons | 491 | 3.4% |

**The fragrance worry does not materialise here, and that is a property of this advertiser's
naming, not a reprieve.** Niche Beauty writes the form into the name —
`"Creed - Aventus for Her - Eau de Parfum Women"` — so `RE_HARD_FRAGRANCE_FORM` catches it.
The 2,197 sits within 6% of `feed-diag`'s independently-detected 2,077, which is reassuring
precisely because the two used different methods on different fields.

**The Cinq Mondes class is still real.** It will be tested properly on a fragrance-only
retailer, where names may omit the noun *because* the whole catalogue is fragrance and the
word carries no information. See item 48.

#### A named row showed what the aggregate hid, for the second time

`FARA HOMIDI — ESSENTIAL LIP COMPACT - Lip Palettes` was assigned **skincare**. A lip
palette is makeup.

Not a blocker at 3.4% excluded and one visible error — but **it is the method point, not the
row**. A distribution table cannot surface a misclassification: every bucket looks like a
plausible number. Six named examples per bucket can, and did. That is now twice, after the
Cinq Mondes pair, that a named example showed something a percentage could not.

**The probe prints six examples per bucket by design, and that choice is what caught it.**
Keep it when the output is next made terser.

#### The supplements exclusion is near-nil here — concern closed

`category_excludes` of `["Vitamins & Supplements","Supplements"]` would drop **4 rows** of
14,636. The categoriser separately excludes **18** as `EXCLUDED:supplement` on its own
denylist, with no config help.

**Keep the exclusion** for consistency with Atelier De Glow and because `top_category` still
has no supplements value — but it is belt-and-braces, not load-bearing. The long-standing
"Niche Beauty's supplements are excluded and unquantified" concern is **quantified and
closed**.

#### WHICH OF THE PROBE'S NUMBERS HAD EVIDENCE BEHIND THEM, AND WHICH DID NOT

**Read this before quoting any figure from a probe report.** The probe carries a contract
(`scripts/feed-categorisation-probe.mts`, CONTRACT block) that asserts input→output pairs
against `_shared/categorisation.ts` and aborts if they stop holding. It passed 2/2 on the
Niche Beauty run. **It covers ONE function.**

| Probe figure | Contract-covered? | Verdict against the 7 Aug import |
|---|---|---|
| Category distribution (6 buckets) | **YES** — `inferCategorisationForImport` | Sound. Describes rows, not products. |
| Excluded count, 491 | **NO** | Importer: 386. **1.27× out.** |
| Barcode rejections, 134 | **NO** | Importer: 94. **1.43× out.** |
| Creates, ≤13,546 | **NO** | Importer: 7,625. Missed duplicate suppression and out-of-stock entirely. |
| Live depth, 930 | **NO** | Achieved 410. Cleanly measurable potential ~754. |

**Only the category distribution was underwritten by the contract. Every figure that turned
out wrong was outside it.**

#### The two mechanisms, neither of which is a bug in either component

**Barcode: same function, different populations.** Both call `validateBarcode`. The probe
validates **raw feed values** — all 14,636 rows. The importer validates **what survives the
identifier chain** — 12,336 rows, because `excluded_out_of_stock: 2,294` is applied first.
Rate-normalised the two are 0.92% and 0.76%, and the residual is plausibly that
out-of-stock rows are not a random sample: discontinued lines carry worse barcodes. **Not a
bug in either. A bug in the comparison.** The same substitution explains the exclusion gap
(3.36% vs 3.10%) and the creates gap, where the probe also missed
`suppressed_duplicate_create: 3,921`.

**Exclusion: a number reported from a function the contract does not cover.** The probe
prints an excluded count derived from `inferCategorisationForImport`'s `excluded` field
*plus* its own `category_excludes` simulation. The contract asserts neither the counting nor
the exclusion simulation — only that two named products categorise as expected.

#### THE DURABLE FINDING: A PARTIAL CONTRACT IS WORSE THAN NONE

**A contract that covers one function and is read as covering the output converts an
unverified number into a verified-looking one.** The probe's report opens with
`categoriser contract: 2 assertions passed`, and every figure below it inherits that
authority by adjacency. Four of the five did not deserve it.

**This is convention 17's shape — a check that cannot fail — one level up, at the harness.**
Convention 17 is about a check whose assertion can never be false. This is about a check
whose assertion is true, narrow, and positioned so that its truth appears to extend to
everything printed after it. The failure is not in the assertion; it is in the scope being
unstated.

**The rule: a contract must state what it does NOT cover, in the same place it reports
passing.** A pass line that reads `2 assertions passed` and nothing else is an invitation to
over-read. It should name the function it covers and the figures it does not.

**Do not fix the probe while its remaining number is under investigation.** Two of three
predictions are already known wrong; the third (930) is what the tier-1 investigation tests.
Fixing an instrument while its last unverified reading is being checked destroys the
comparison that would tell you whether the instrument or the system was wrong.

#### One comparator that must not be used

`feed-diag` reports its own "FRAGRANCE share" — 2,077 of 14,636 for Niche Beauty. **That is
the diagnostic's own detection over a different field on a different corpus.** It is not a
comparator for the categoriser's output, and dividing one by the other manufactures a large
error rate from two unrelated measurements. If a fragrance misclassification rate is ever
wanted, both halves must come from the same corpus and the same code path.

---

### 47. A figure in an instruction is unsourced until a query produced it

**Raised:** 7 August 2026 · **Fifth to eighth 8-9 August · Ninth 10 August · Tenth
11 August · Eleventh and twelfth 12 August · Thirteenth and fourteenth 13 August** ·
**A PROPERTY OF THE METHOD**, recorded because fourteen instances in seven days is a
pattern rather than fourteen mistakes. **Read instance 9 first: it is the one the remedy nearly
missed. Read instance 11 for the failure mode that costs the most. Read INSTANCE 12 for
the one the remedy had already caught once.**

**The twelve:**

| | Figure | What it was |
|---|---|---|
| 1 | "the per-reason counts never reached the database" (item 44) | Overstated — the totals did |
| 2 | "348 brands, none disappearing entirely" | Not measured; the real diff showed 277 wiped entirely |
| 3 | "12 samples across 3 reasons" | Not measured; the run's payload was empty |
| 4 | `79.7%` / `20.3%` / `2,998 matched` / `197 supplements` / `nb_missing_brands` and a scope bug in its exclusion clause | **Nothing existed.** The dry run returned `546 WORKER_RESOURCE_LIMIT` twice with no body, and no such function is in the repo |
| 5 | "EXCLUDED at 45.7%, **4,116** rows dropped for want of a brand whitelist entry" | Unsourced. The run it was attributed to (`scrape_log` 206) has `skipped_new_brand: 0` — Niche Beauty imported with `existing_brands_only: false`, so the gate never fired. Reconstructing the gate from the catalogue gives **5,029** over 297 brands. Also 4,180 / 3,046 / "89 of 200", none reproducible |
| 6 | "`merchant_category` populated on all 5,128 rows, whitelist covering **4 of 62** values, `Beauty > Fragrance > Womens Fragrance` present in the feed" | **Nothing on disk could have produced it.** `merchant_category` was never in the Debenhams workflow's `COLS`, so no run has ever downloaded it and no artefact contains it. The values may well be real — they are consistent with everything else observed — but they came from outside the pipeline and nothing retained them |

| 7 | "754/665/46 reconciliation is exact"; "the 22 fan-out cases"; "3,894 was 234 an hour ago" | No run produced 665 — no dry run existed. Arrived **inside the message calling the reconciliation exact**, which is the sharpest form: the confidence marker and the unsourced figure in one sentence |
| 8 | "1,468 blocked at 25.9%"; "creatine, pre-workout and protein bars are what EXCLUDE_PATTERNS blocks"; "excluded_by_category DELETES" | Measured: **274 of 941, 29.1%**, and the sample is Imedeen, Equazen, Bio Kult, Sambucol, Paediasure. Creatine and pre-workout are excluded by the PATH allowlist, not the regex. **And there is no DELETE anywhere in the importer** |

| 9 | "224 tier-1 links predicted for Beauty Flash, 4 for The Organic Pharmacy" — later restated as "1,208 against 224" and "1,140 against 4" | **No run ever produced any of them.** Every `would_link_via_ean` above 100 in the entire history is Stylevana (500s), Branded Beauty (125-162), Niche Beauty (237) and Beauty Flash today (681). No dry run was executed. The real numbers are **681 and 1** |

| 10 | "Boots has been running 31,000-36,000 in-stock rows and is now 23,001 — a two-day oscillation present since 27 July" · and "KEPT_BY path branch at 4,177" | **Neither measured.** Boots `matched_count` since 27 July: min 22,161, max 22,346, **swing 185, standard deviation 58**. There is no cycle and never was. The 23,001/13,045 split falls exactly on the 7-day absence threshold. `KEPT_BY` read **8,189**, not 4,177 |

| 11 | `barcode_ambiguous_skipped` read **null** on the Gorgeous Shop coalesce run, and a recorded stopping condition was invoked on it | **The field does not exist.** The counter is `tier1_ambiguous_skipped` and it read **1,342**, corroborated by 1,342 rows in `tier1_ean_skips` over 1,328 distinct barcodes. `barcode_ambiguous_skipped` appears nowhere — not in the importer, not in a migration, not in this file |

| 12 | **5,663** supplement rows behind the Boots allowlist, plus "4,554 rows", "the remaining 1,109", "6,673 Personal Care > Health Care rows" and "78 MyProtein products including 43 protein" | **5,663 was retracted on this very list before being reinstated as a founding premise.** Measured: the whole `Health & Beauty > Health Care` subtree is **3,115 rows** holding **936** supplement-shaped; `Vitamins & Supplements` is **1,717**, not 4,554; the "second path" holds **91**, not 1,109; **`Personal Care > Health Care` does not exist in the feed**; MyProtein is **37 rows** on the admissible path, 19 sports-shaped. The category lifts to about **900**, not 5,700 |

| 13 | "the 92-product dark set from item 71" | **No such set exists.** Item 71 is retailer-conditional classification and contains no dark set; "92" appears twice in the work list, both unrelated. The figure came from the **withdrawn detachment plan for the 121 Stylevana rows** — an option that was rejected |

#### THE SAME SHAPE WITH NO NUMBER IN IT: A REPEATED CHARACTERISATION

**"The GA4 puller has been built and unarmed since 5 August" was repeated for a fortnight.
All three of its claims are wrong**, and none of them is a figure:

| Claimed | Measured |
|---|---|
| Built **5 August** | Built **29 July**, commit `9ac8f0d`, untouched since. 5 August is a *different* GA4 event — five custom definitions registered by hand, `platform_changes` id 30 |
| **Unarmed** | **Never run at all.** Step 1 of its own arming sequence — a dry run — has not happened |
| Blocked | **Blocker expired 1 August.** Two of its three stated conditions no longer hold |

> **Two GA4 events on two dates were merged into one sentence, and the sentence was
> repeated until it read as established.** That is instances 9, 12 and 13's mechanism
> operating on a *characterisation* rather than a *quantity* — and it is harder to catch,
> because "which query produced this number?" has no purchase on a claim with no number in
> it.

**The remedy has to widen.** The existing clause is *ask which query produced the figure*.
It does not reach "built and unarmed since 5 August", which is checkable in a different way:

> **A claim about the STATE of an artefact is checkable against the artefact.** `git log`
> for when, the file's own header for what it is waiting on, and the run history for whether
> it has ever executed. **Three commands, none of them a query, all of them available every
> time the claim was repeated.**

| 14 | "Boots is the only `storage_passthrough` retailer in the rollout. Beauty Flash, Gorgeous Shop, Escentual and Organic Pharmacy are all inline." Robbie's, in the brief; repeated assistant-side into a report and adopted as the leading hypothesis | **All four are `storage_passthrough`.** `retailer_import_config.staging_mode` reads `storage_passthrough` for retailers 8, 23, 27 AND 30. The premise was false, and it was the entire reason the hypothesis was plausible |
| 15 | "Zero plumbing" — that `inferCategorisationForImport`'s new 4th argument needed no wiring at the AWIN call site, because `categoryPath` is already in scope there. Robbie's, in item 72's plumbing note, citing the call site as line **2193** | **The call is at 2286, and it passed TWO arguments.** `categoryPath` being in scope is necessary and not sufficient: nothing read `supplements_path_prefixes` and nothing passed it. The line reasoned about was not the line that runs, so the check confirmed a fact about the wrong statement. Wired 14 Aug 2026 — item 91 |
| 16 | "Boots contributes ~23,000 barcodes to an index of 62,323, **essentially none of which it currently holds**, so sole-supplier share should *rise* on the flip." Robbie's, in item 78, and the direction of the whole check was derived from it | **Boots shares 7,447 of its 21,827 barcodes — 34% — with an existing supplier.** The share FELL, 79.2% -> 77.3%, exactly as a false premise predicts. The check itself was sound and did its job: it detected the premise. Item 93 |

#### INSTANCE 14: A HYPOTHESIS DISPROVED BY THE FACT THAT MADE IT PLAUSIBLE

**Boots' first post-flip barcode read came back all zeroes. The leading hypothesis was that
the coalesce path is not reached under `storage_passthrough` staging, and the argument for
it was structural: Boots was said to be the ONLY passthrough retailer in the rollout, so the
rollout had tested one staging mode four times and the other once — and the one had failed.**

That is a good argument. It is also built entirely on a premise nobody checked.

> **`staging_mode` is `storage_passthrough` for Escentual, Boots, Beauty Flash AND Gorgeous
> Shop. All four.** The rollout tested `storage_passthrough` four times and inline never.

##### THE SHAPE IS DIFFERENT FROM THE OTHER THIRTEEN, AND THE REMEDY IS DIFFERENT

In instances 1-13 the figure was wrong and the work built on it was wasted. **Here the check
and the refutation are the same act.** One `select staging_mode from retailer_import_config`
would have tested the hypothesis — and that same query dissolves it, because it shows the
comparison group does not exist.

> **The remedy is not "test the hypothesis". It is TEST THE PREMISE BEFORE THE HYPOTHESIS,
> because the premise is usually cheaper to check and sometimes settles both at once.**

**A hypothesis whose plausibility rests on one factual claim is only as tested as that
claim**, and the claim is almost always the smaller query. Here the hypothesis would have
required reading the staging code paths, the column-index resolution and the slice format;
the premise was one column of one table.

**Both sides produced it.** It was asserted human-side in the brief, then repeated
assistant-side into a written report as *"Boots is the only storage_passthrough retailer"*
and adopted as the leading suspect — **from a config table both parties had queried
repeatedly that same day for other reasons.** Familiarity with a table is not knowledge of a
column.

##### AND THE CHEAPEST CHECK WAS IN THE ROW ALREADY BEING READ

The 04:30 run's own output recorded **`details.counts.sibling_coalesce = "false"`**, in the
same JSON object as the zeroes that prompted the investigation.

**The run said it had not read the flag.** Both parties read the zeroes beside it and
reasoned outward toward a mechanism — staging modes, column resolution, deploy ordering —
rather than reading the one field that states the cause. **The flag was flipped at ~10:45
UTC; the run was at 04:30. It predated the change by six hours.**

> **When a diagnostic reports both a result and the configuration it ran under, read the
> configuration first.** A null result under a flag that was off is not a null result, it is
> a run of the old code — and the counter that says so costs nothing to read because it is
> already on screen.

##### RESOLUTION: THE RISK IS STRUCK, NOT LEFT OPEN

`storage_passthrough` is **proven, not untested**. Under that exact staging mode:

| Retailer | barcodes stored, first post-flip run |
|---|---|
| Beauty Flash | **0 → 6,951** |
| Gorgeous Shop | **0 → 5,972** |
| Escentual | **0 → 6,253** |

**Three for three.** The untested-combination risk does not exist and is struck rather than
carried as an open question. Nothing about Boots' staging is implicated, nothing needs
fixing, and the first genuine post-flip read is 04:30 on 14 August.

#### INSTANCE 13: A FIGURE FROM AN ABANDONED PLAN, WHICH IS INSTANCE 12'S SHAPE

**Second time in one week that a figure has been cited from a plan that was dropped.**
Instance 12 was a *retracted* figure returning; this is a figure from a *rejected option*
returning. **The mechanism is identical and it is the one that makes both durable:**

> **A number produced by real analysis carries that analysis's provenance, and keeps it
> after the plan the analysis served is abandoned.** The 92 was computed properly. The
> detachment plan was reasoned properly. **Dropping the plan does not retract the number**,
> because the number never depended on the plan being adopted — it was an input, not a
> conclusion.

**That is why it reads as established.** It has a derivation, a context and a date. Nothing
about it looks provisional, and the one fact that would disqualify it — *the work it
belonged to was not done* — lives nowhere near the figure.

**The remedy is item 66's, in a new place:** when an option is rejected, the figures it
produced need retiring **where they will be quoted next**, not only in the decision that
rejected them. A dropped plan leaves live numbers behind, and they are the most credible
kind of wrong figure there is.

#### INSTANCE 12: A RETRACTED FIGURE RETURNING AS A FOUNDING ASSUMPTION

**This is the worst shape yet, and it is worse for a specific reason: the control had
already fired.** 5,663 was measured against, found unsourced, and recorded as retracted on
this list. It then came back — not as a passing reference, but as **the premise a whole
piece of work was scoped on**. "This lifts the category from 93 to roughly 5,700 and it is
the reason the ceiling exists."

> **A fresh unsourced figure has never been tested. A retracted one has been tested and
> failed, and the retraction is the artefact that was supposed to stop exactly this.** When
> a figure returns after retraction, the process did not merely fail to catch it — the
> thing built to catch it was bypassed.

**And a retracted figure is more dangerous than a fresh one, because it has provenance.**
It has been discussed, written down, and argued about. It reads as established rather than
asserted. Instance 9 recorded that a figure surviving one round trip acquires provenance it
never had; **this is the same mechanism using the retraction itself as the source.**

**What it would have cost.** The whole plan was scoped, sequenced and justified on ~5,700
rows. The real number is about 900 — **a sixth**. Every downstream judgement rested on it:
whether it was worth doing at all, whether it justified a shared-module deploy touching
every retailer, and where it sat against Boots' coalesce flip. **None of the design changed
when the figure did**, which is worth saying, because the decision to proceed at ~900 was
made on the commercial argument rather than the count — but that only became visible once
the count was correct.

**The 78-MyProtein figure is folded in here rather than corrected separately**, at Robbie's
direction, because it is the same instance rather than a second one: same brief, same
absence of a query behind it. Measured, **37 on the admissible path**.

#### THE SAME SHAPE WITHOUT A NUMBER: A FIGURE READ AS MEASURING SOMETHING IT DID NOT

**The design brief for item 71 was built on `feed-diag`'s regexes in the belief they were
the classifier's.** The 45.4% disagreement rate — the entire stated basis for path-first
classification — was **evidence about `docs/supplements-definition.md`, not about shipped
behaviour.**

The two differ in exactly the way that mattered. `feed-diag`'s `APPLY` list contains `oil`;
the shipped `capsuleIsTopical` list does not. So the premise *"`capsuleIsTopical` would
misfire on Omega 3 Oil 1000mg Capsules"* was **false against the code** — that row is not
topical to the categoriser, and never was.

> **This is instance 12's shape without a number in it. A figure was carried between two
> contexts and read as measuring something it did not measure.** The 45.4% is real, it was
> correctly computed, and it answers a different question than the one it was quoted for.
> **Unsourced is not the only failure — MIS-SOURCED is the same cost with better
> provenance**, because a figure with a real derivation resists challenge harder than one
> with none.

**Both sides produced it**, and the assistant half is the one with the remedy: the numbers
were quoted human-side from the diagnostic's output, and reported back assistant-side as
though they described the importer, across two turns, **while the shipped function was
three greps away and was eventually just run.** Running it took one command and inverted
the design.

> **When a figure describes the behaviour of code, run the code.** A diagnostic that
> re-implements a rule is a second implementation, and item 65's seven label maps are what
> second implementations do. `feed-diag` and `categorisation.ts` are two copies of the
> supplements rule that have already diverged.

**The remedy needs a clause the others do not imply:**

> **When a figure is retracted, record it as retracted where it will be seen NEXT — not
> only where it was caught.** Item 47 held the retraction. The brief that reused the figure
> was written elsewhere. **The control sat somewhere the failure did not pass through**, so
> it was never consulted — not overridden, not forgotten, simply out of the path. A
> retraction filed only where it was caught protects the record and not the next decision.

**This is the clause that generalises**, and it applies beyond figures: any control filed
where the failure will not travel is decoration. The GONE_IDS list said in its own header
to regenerate before the flip (item 51) and the flip happened elsewhere; the frozen-state
rule is in a doc rather than in the files it governs. **Same shape, three times.**

#### INSTANCE 11: THE FIRST ONE THAT STOPPED WORK RATHER THAN MISDIRECTING IT

**Every previous instance produced a false conclusion. This one produced a false alarm**,
and that is a different and more expensive failure mode, because a false alarm is *designed*
to be obeyed. A recorded stopping condition — "links far outside the band, or skips not
appearing at all" — fired on a field name that had never existed, and a rollout stage
halted on it. The halt was correct behaviour given the reading. **The reading was of
nothing.**

**A fabricated FIELD NAME is worse than a fabricated figure, because the database answers
it politely.** A wrong number can be contradicted by a query. A wrong column name in
`details->>'...'` returns `null` in Postgres — indistinguishable, at the call site, from a
counter that ran and wrote nothing. **The instrument reports absence identically to the
question being unaskable**, so the usual remedy ("which query produced this?") returns "this
one, and it ran fine".

**The reasoning built on top of it was sound, which is what made it durable.** Null-versus-
zero *is* a real and important distinction; the series does show it working — `null`
pre-deploy, `0` when the counter ran and found no ambiguity, `1,342` today. Beauty Flash
reads `null` on 8 and 9 August for exactly the stated reason. **A correct piece of
reasoning was attached to a reading that did not exist**, and the quality of the reasoning
is what made the alarm credible.

**The remedy is a new clause, because the existing ones do not reach this.**

> **Before acting on a null, confirm the field exists.** `grep` the name in the repo. A
> `jsonb` key that returns null has two causes — the counter did not write, or the key was
> never real — and the database cannot tell you which. **Not-written and not-a-field are
> the same value and opposite problems.**

**Both halves again, and the assistant half is the one to fix.** The field name was invented
human-side. But the reading was accepted and reported back assistant-side across two turns
without once checking that the key existed, while a `grep` that would have settled it in
seconds was available throughout — and item 60's own text, in this file, names the counter
correctly.

**Cheap, general, and not yet done: a diagnostic that rejects unknown keys.** Any read of
`details->>'x'` where `x` is not a key the importer writes should raise rather than return
null. Until then the guard is manual and belongs in the reading, not the write-up.

#### INSTANCE 10: THE FIGURE PRODUCED A PROPOSED WORK ITEM

**This is the first instance that got as far as commissioning work.** A remembered row count
was compared against a real one, the gap was explained by inventing a mechanism — a two-day
pagination cycle — and an item was proposed to investigate it, on a retailer described as
"stable and not urgent" but worth recording "before it gets blamed for something else".

**A standard deviation of 58 across a fortnight leaves no room for an 8,000-row swing.**
There was nothing to explain, so the mechanism was invented to close a gap that did not
exist.

**The item was not opened.** Refusing to write it up was the correct action and is recorded
here as the precedent: *an unsourced figure must not become a recorded finding, even when
the person asking for it is the person who owns the record.* A work-list item confers more
provenance than a message does — it is the artefact everything else cites — so the bar for
entering it is higher, not lower.

**Both halves came from the same reflex as instance 9**: a number recalled rather than
queried, then reasoned forward from. The remedy is unchanged and now has a second clause —
**ask which query produced it, and refuse the write-up if the answer is "none", regardless
of who is asking.**

#### INSTANCE 9 IS THE DANGEROUS SHAPE: A FIGURE THAT ACQUIRED PROVENANCE BY BEING REPEATED

**The other eight were caught because nobody could source them.** Asked "which query
produced this?", the answer came back "none", and the figure died.

**Instance 9 had a source, and the source was this file's own process.** The numbers were
asserted in conversation on 9 August. They were then repeated back in an assistant summary
as *"predictions on record: 224 and 4"* — not as a claim, as a restatement. By the following
morning they were being reasoned about as the output of a prediction *method*, and the
question on the table was "why is the method wrong by two orders of magnitude?" — a question
that presupposes the method exists.

**A fabricated figure that survives one round trip acquires provenance it never had.** The
repetition is what does it. "Predictions on record" is a claim about record-keeping, and
nothing had been recorded.

**The remedy has to extend**, because "which query produced this number?" now returns
"an earlier message", which reads like an answer:

> **Ask which query produced it ORIGINALLY, not where you last saw it.** A figure's
> appearance in a previous summary is not a source. If the chain terminates in prose rather
> than a query, a tool's output or a file, it is unsourced no matter how many times it has
> been restated.

**Both sides produced this one.** The figures were asserted human-side; the provenance was
manufactured assistant-side by restating them as recorded. Neither half alone would have
survived to the next morning.

**The sixth is the one that closes the loop with instance 5, and it is worth stating why.**
Instance 5's figure could not be reproduced because a *counter* read zero. Instance 6's
figure could not be reproduced because *the column was never fetched*. Both were quoted as
properties of a feed; neither was recoverable from anything the pipeline keeps. The
difference is that instance 6's evidence never existed in our systems at all — and the fix
for that is not "check the number", it is `merchant_category` being added to `COLS`
(9 August), so the next such claim has something behind it.

**The fifth arrived within a day of the property being written, which is the point of having
written it as a property.** It is the mildest of the five in isolation — the number was the
right order of magnitude and pointed at a real population — and the most instructive about
cost. It was quoted as a run figure. The run said `skipped_new_brand: 0`. Had the
reconstruction not been attempted, the gap between 4,116 and 5,029 would have been carried
forward as fact into a decision about a retailer's onboarding, and the 913-row difference is
larger than most of the populations this list argues about.

**The same instruction carried three more:** 4,180 Beauty Flash duplicates, 3,046 of them
internal, and "89 of 200 ambiguous barcodes". The catalogue supports **10** same-retailer
same-barcode multi-product cases at Beauty Flash, and cannot support thousands:
`retailer_prices` carries `UNIQUE (product_id, retailer_id)`, so a feed-level barcode repeat
collapses onto one row rather than surviving as a duplicate. Those figures may well be sound
feed-level measurements — there is no Beauty Flash feed on disk to re-run them against.

**UNSOURCED IS NOT THE SAME AS WRONG, and the two need different responses.** A false figure
is corrected. A figure whose derivation cannot be reproduced *because the evidence is not
retained* is a gap in what we keep, and correcting the number is not available as a move.
The Beauty Flash case is the clean example: the reason the catalogue cannot confirm 3,046 is
`UNIQUE (product_id, retailer_id)` — the schema forbids holding the evidence, so a
feed-level measurement is unfalsifiable from the catalogue **by design**, not by oversight.
Instance 4 was a number that did not exist. These may be numbers that existed and left no
trace. Only the first is a mistake; the second is a retention decision nobody made
deliberately.

**Practical consequence:** when a figure can only be produced from a feed, the feed — or the
counts derived from it — has to be kept at the moment of measurement. Otherwise the figure
becomes unauditable the instant the run ends, and every later argument about it is
irresolvable rather than merely unresolved.

**The fourth is the sharpest and the most instructive.** The first three inflated or
misattributed numbers that were real. The fourth invented a diagnostic's output *and* a bug
report about its internals, from two failures. A failed run reads as a result set if nobody
asks what it returned.

**The remedy, which caught all five: ask which query produced this number.** For the fourth
the answer was *"none — the run failed"*, and that was available immediately from the
response body. For the fifth it was *"a run whose counter for that gate reads zero"*, and
that was one `scrape_log` read away.

**Stated as a property rather than a tally, deliberately.** A tally stops at four and
attaches to whoever produced them; the property covers the fifth and applies symmetrically.
Instance 1 above originated on the assistant side and has exactly the same shape: it was
asserted from knowing the merge was broken, without checking which fields the merge could
reach. The fifth came from the human side and was corrected by the human side on being
shown the reconstruction — which is what symmetric is supposed to look like in practice.

**Practical form:**

- **A figure that appears in an instruction and cannot be traced to a query, a tool's
  output or a file is unsourced** — regardless of who wrote it, and regardless of how
  plausible it is. Plausibility is what makes these expensive: all six were the right
  order of magnitude.
- **Ask what would have had to be retained for this to be checkable.** Sometimes the answer
  is "nothing was" — instance 6 — and that is a finding about the pipeline rather than
  about the figure.
- **Check before acting, not before recording.** Three of the four were caught because
  acting on them required knowing where they came from. The cost of not checking is a
  change built on a number that does not exist — instance 4 would have produced a fix to a
  function that is not in the repository.
- **When a run fails, say the run failed.** Do not describe what it would have shown.

---

### 48. `feed-diag`'s overlap buckets are match-key-only, and read zero on any differently-named feed

**Raised:** 7 August 2026 · **THE LARGER RESULT of the Niche Beauty work**, and a finding
about the matcher rather than about any candidate retailer.

#### Zero of 930 is not inefficiency. It is a tier that does not function on this feed

Measured on Niche Beauty (fid 102930), 7 August 2026, both tiers computed over the same
rows by `scripts/feed-categorisation-probe.mts`:

```
present in retailer_prices (ANY row):                         1,090
BUCKET A — in stock, active retailer, in products_active:       930
present but NOT live (oos / inactive / merged / variant):       160

live barcode matches:                   930
of those, match_key ALSO matches:         0
BARCODE-ONLY (match_key misses them):   930
```

**Zero overlap between the tiers.** Not partial disagreement — the `match_key` tier finds
**none** of the 930 products the barcode tier finds live.

**The definitional gap is small and does not explain it.** Only 160 of 1,090 fall away once
"present in `retailer_prices`" is tightened to in-stock, active-retailer and in
`products_active` (which already excludes merged, variant-child and unimaged). That is a
~15% inflation, not an order of magnitude. Definitions were worth ruling out first; they are
not the answer.

**The cause.** Niche Beauty names products `"Creed - Aventus for Her - Eau de Parfum Women"`
— brand prefix, hyphenated segments, category suffix. `buildMatchKey(brand, name)` produces
a key our catalogue's keys do not match, on 930 of 930. The barcode tier finds them because
`product_GTIN` is populated at 100% and the importer reads it through `ean_alt`. **This is
the sibling-coalesce premise confirmed by measurement.**

#### The consequence beyond Niche Beauty

**`feed-diag`'s bucket A reads zero on any advertiser whose naming convention differs from
ours, regardless of how much genuine overlap exists.** A has been the onboarding signal.
Every prestige feed assessed with it was assessed on a measure blind to its depth.

**THE GATE WAS WRONG, NOT THE ANSWER.** An A = 0 gate was set on the reasoning that a new
retailer earns its place by adding comparison depth, not catalogue size
(`docs/strategy.md:488`). That reasoning is sound and is unchanged. What was wrong was
treating A as a measurement of depth: it measures *match-key* depth, and on a
differently-named feed that is zero by construction. Niche Beauty's real live depth is 930,
and A reported 0 for it.

#### Which assessments used it

Recovered from workflow run logs, 7 August 2026:

| Run | Feed | A reported | Status |
|---|---|---|---|
| 30844150577 | The Organic Pharmacy, fid 62815 | **23** | onboarding assessment; non-zero, so less exposed |
| 30984692444 | Debenhams 90938 | 0 | rotation investigation |
| 30984698505 | Debenhams 90940 | 0 | rotation investigation |
| 30984704512 | Debenhams 90945 | *(no value in log)* | 514k rows |
| 30984710412 | Debenhams 90947 | 0 | rotation investigation |
| 30985368741 | Debenhams 91126 | 0 | rotation investigation |
| 30985374005 | Debenhams 91133 | 0 | rotation investigation |
| 30985379697 | Debenhams 91134 | *(no value in log)* | 501k rows |
| 30985385787 | Debenhams 91135 | **10** | rotation investigation |
| 31172005496 | **Niche Beauty 102930** | **0** | **onboarding — now known to be 930** |

**Only two were onboarding decisions**: The Organic Pharmacy and Niche Beauty. The Debenhams
runs were feed-rotation investigation, where A was not the decision variable — so the
retrospective exposure is narrower than it first appears. **The Organic Pharmacy returned
A = 23, so it was not gated on a zero.** Niche Beauty is the one case where an A = 0
characterised a retailer, and it is now corrected.

**Any future A = 0 should be treated as "the match-key tier found nothing", not as "there is
no depth".**

#### Same shape as the guard and the filter

A measure calibrated on the corpus it was written against, **degrading to a plausible zero
rather than erroring**. The row-floor guard was calibrated on a superseded feed level; the
Debenhams filter on the feeds that existed when it was written; bucket A on advertisers who
name products the way our catalogue does. None of the three fails loudly. All three return a
number that looks like an answer.

#### The test that would confirm it is a pattern — PARKED

**The Fragrance Shop is the natural test and cannot be run now.** It is a **Rakuten**
retailer, so both the probe and the import path need Rakuten-specific work rather than a
feed id — a build, not a dispatch. Parked on that basis, not on priority.

**Two predictions to test when it resumes:**

1. **Whether the fragrance-noun naming holds on a fragrance-only retailer.** Niche Beauty
   writes "Eau de Parfum" into every fragrance name. A fragrance-only catalogue may omit it
   precisely because it carries no information there — which is item 46's unfixable class,
   arriving at scale.
2. **Whether `match_key` scores zero again.** If it does, the tier failure is a property of
   prestige naming generally rather than of Niche Beauty.

**If both hold, the pattern is confirmed rather than a single-retailer property**, and bucket
A should be reported alongside a barcode tier permanently rather than alone.

#### Niche Beauty's numbers, with their bounds

- **930 live comparison-depth products** — a barcode-tier **lower bound**, since name-tier
  matches are not simulated.
- **≤13,546 creates** — an **upper bound** at 99.1% barcode coverage, for the same reason.

With `match_key` scoring zero, the name tier is unlikely to move either much — but that is an
inference, and the probe does not test it.

---

### 49. `existing_brands_only` dissolves the condition it measures, by measuring it

**Raised:** 8 August 2026 · **THE FINDING from the Niche Beauty import.** Same family as the
row-floor guard, the Debenhams filter and bucket A — a measure that returns a plausible
answer instead of failing. **This one is worse, because the measurement caused the
condition.**

#### The mechanism

`existingBrandSet` is built at `supabase/functions/import-awin-feed/index.ts:706-732`:

```
supa.from("products").select("match_brand").neq("match_brand", "")
```

**Every `products.match_brand` in the catalogue. No retailer filter. No `active` filter.
Merged and variant-child rows included.** The gate at `index.ts:2187-2196` then skips any
create whose brand is not in that set.

The Niche Beauty import ran 7 August 2026 at 12:38 UTC (`scrape_log` 206) with
`existing_brands_only: false`, and **created 7,625 products across 417 brands**. 297 of
those brands had never been in `products` before.

They are in `products` now. So `existingBrandSet` contains them.

#### What that does to the next measurement

Switch retailer 32 to `existing_brands_only: true` tomorrow and the run reports
`skipped_new_brand: 0`. Nothing about the feed has changed. Nothing about our brand coverage
has changed in any sense that matters commercially. **The whitelist was populated by the act
of running the import that the whitelist exists to constrain.**

A zero there reads as *the gate is working, this retailer's brands are all ones we carry*.
The truth is *the gate was dissolved before it was ever switched on*.

#### Why it is the worse case of the family

| | Failure |
|---|---|
| Row-floor guard | Calibrated on a superseded feed level |
| Debenhams filter | Calibrated on the feeds that existed when written |
| Bucket A | Blind to differently-named feeds by construction |
| **This** | **Correct on every run. The prior state it compares against is destroyed by the run itself** |

The first three return a stale or structurally-blind answer. This one returns an answer that
is arithmetically correct and describes a world the measurement created. There is no
calibration to refresh and no corpus to widen — re-running it more carefully makes it worse,
not better.

#### The number, and how it was recovered

The pre-import brand set is only reachable through `products.created_at`:

```sql
-- brand set as it stood immediately before the Niche Beauty import
select distinct match_brand from products
where match_brand is not null and match_brand <> ''
  and created_at < timestamp '2026-08-07 12:38:17';
```

Against that: **5,029 of the 7,625 created products carry a brand absent from the
pre-import catalogue, across 297 brands of 417.** Verified 8 August 2026.

**That reconstruction has a shelf life.** It works only while `created_at` still separates
the two populations. Any later import that creates products under those brands, any merge
that rewrites `created_at`, and the boundary stops being recoverable at all.

#### The general form

**A gate whose reference set is derived from the table the gated operation writes to cannot
be measured after that operation has run.** Whatever else is decided about
`existing_brands_only` (item 50), the measurement order is now fixed: the counterfactual has
to be captured *before* the import, or it cannot be captured.

---

### 50. Is `existing_brands_only` the right instrument for a prestige retailer at all?

**Raised:** 8 August 2026 · **A QUESTION ABOUT FIT, NOT A TUNING PARAMETER.** Recorded as a
question deliberately: it is not answered here and should not be answered by adjusting a
threshold.

#### What the setting is for

`existing_brands_only` stops a feed dragging in unrelated inventory — a general retailer's
electronics, homeware, or a long tail of brands we have no reason to carry. Against that
purpose it works, and it is on for Beauty Flash (1,826 rows skipped on the 7 August run).

#### Why it does not fit here

Niche Beauty carries 417 brands. **297 of them are new to the catalogue by design** — that
is what a prestige retailer *is*. The setting would discard:

> Byredo · Augustinus Bader · Aesop · Chantecaille · Clé de Peau Beauté · Maison Francis
> Kurkdjian · Oribe · Biologique Recherche · Hourglass · Westman Atelier · Dr. Barbara
> Sturm · Susanne Kaufmann · Malin + Goetz · L'Artisan Parfumeur · Pai Skincare · 111Skin ·
> Lisa Eldridge · goop · Trudon · Montale

**That is the Prestige Edit inventory.** The 5,029 products behind those brands are all in
stock, all imaged, and distribute skincare 43.2% / fragrance 18.0% / makeup 14.4% /
bath_body 12.5% / hair 11.8%. Supplement-signal names: 0. Homeware-signal names (candle,
diffuser, room spray): 222, 4.4%, concentrated in Trudon and FRAMA. Price p25 34.00, median
58.40, p75 122.00 — **currency unverified**, Niche Beauty is a German advertiser and these
may be EUR.

**The setting would reject nearly two thirds of a prestige feed for being prestige.** It is
not filtering noise here; the brands it removes are the reason to onboard the retailer.

#### The shape of the question

- **The gate conflates two different things.** "A brand we do not carry" and "a brand we do
  not want" are the same signal to it. On a general retailer those mostly coincide. On a
  prestige retailer they are close to opposites.
- **It is a whitelist with no way to add to it except by turning it off.** There is no
  per-retailer allow-list, no brand-count threshold, no review queue — the only way a new
  brand enters is an import that ignores the gate, which is item 49.
- **The alternative instruments have not been scoped.** Category-based scoping, a
  brand-count cap, a first-run-permissive-then-restrict mode, or an explicit per-retailer
  brand allow-list are all plausible and none has been costed.

#### What must not happen

**Do not set `existing_brands_only: true` on retailer 32 as a way of resolving this.** Per
item 49 it will report zero skipped and look like agreement.

#### Blocked behind

The import path is not to be touched while the tier-1 defect (`index.ts:781` collects
`p_eans` from `idx.ean` only, while the row loop reads the barcode through
`coalesceField(fields, idx.ean, idx.ean_alt)` at `index.ts:1957`, so coalesce-recovered
barcodes are never in `eanToProductId`) is open. Two importer changes with the matcher unresolved makes any
surprise unattributable.

---

### 51. The same feed is two different feeds depending on which path fetched it

**Raised:** 9 August 2026 · **A CLASS, NOT AN INSTANCE.** Found while fixing the Debenhams
filter; the filter was the symptom.

#### What happened

`import-awin-feed`'s `buildFeedUrl` (`index.ts:271-330`) requests **20 columns**.
`.github/workflows/refresh-debenhams.yml` hand-wrote its own `COLS` and requested **15**
(16 after `merchant_category` was added on 9 August). Nothing compares the two, and nothing
ever has.

#### FIRST, A PREMISE THAT WAS CHECKED AND DOES NOT HOLD

**It was proposed that `product_GTIN` is not in AWIN's schema and that the API silently
returns fewer columns than requested rather than erroring — which would mean the entire
sibling-coalesce rollout is deployed against a column AWIN never sends. It is not so, and
the evidence is a real response header.**

feed-diag run 31172005496, Niche Beauty fid 102930, 7 August 2026. Requested 18 columns.
The parsed header, printed by the diagnostic:

```
columns: aw_deep_link, product_name, aw_product_id, merchant_product_id, search_price,
         store_price, merchant_deep_link, brand_name, rrp_price, in_stock,
         merchant_product_category_path, merchant_category, category_name, product_type,
         ean, product_GTIN, mpn, merchant_image_url
  product_GTIN                         14632  100.0%
```

**Eighteen requested, eighteen returned, `product_GTIN` among them and populated on 100% of
rows.** No truncation.

**Two independent corroborations, either of which alone settles it.** `columns` is parsed
from the CSV header AWIN actually sent (`index.ts:1332`), not from our requested list, so
`columns.indexOf("product_GTIN")` searches the response. If the column were absent,
`idx.ean_alt` would be `-1`, `coalesceField` would return `usedAlt: false` on every row
(`_shared/barcode.ts`), and `ean_from_sibling` would be **exactly 0** for every retailer.
It reads **10,473** for Beauty Flash and **12,336** for Niche Beauty. And Beauty Flash's
`ean` column is 0.0% populated while it holds **6,055 stored barcodes** — there is no other
path they could have arrived by.

**So: Beauty Flash's 6,055 EANs came from `product_GTIN`, through the coalesce, exactly as
designed.** The coalesce rollout is not built on a phantom column. The tier-1 defect
(`index.ts:781`) remains what it was: the barcodes arrive and are then not used for
linking, which is a different fault from their not arriving.

**Where the wrong count probably came from, because it is an easy trap.** Reading the column
list out of `buildFeedUrl` with a naive regex returns **21 entries including `ean` twice** —
the second `"ean"` is inside a comment within the array literal, describing a historical
mistake. The real array has 20 entries and no duplicate. This was reproduced accidentally
while checking, so it is recorded rather than assumed.

Debenhams' `feed_url` is `storage://retailer-feeds/debenhams-beauty.csv.gz`, so
`buildFeedUrl` is **bypassed entirely** for it. The workflow's list is not a second opinion —
it is the only column list that applies, and it silently differed from the one every other
AWIN retailer receives.

#### What it cost, measured

**`merchant_category`** — absent. This is the whole Debenhams outage. 116972 carries no
`merchant_product_category_path` and puts its taxonomy here instead, so the filter could not
see it, and neither could anyone diagnosing the filter. Six days stale, and the diagnostic
question "what is actually in 116972" was unanswerable from anything retained. Added 9 Aug.

**`description` and `product_short_description`** — still absent. Consequence, measured
9 Aug: of the products carrying a Debenhams offer that have a description, the sources are
Superdrug 2,093, Beauty Bay 978, Beauty Flash 299, Boots 216, Escentual 70, Stylevana 38,
Branded Beauty 34, YesStyle 21. **Debenhams appears nowhere.** 10,232 rows and it has never
contributed a single description, because the columns are not requested. Its description
coverage is 36.7%, the lowest of any live retailer (Beauty Flash 99.3%, Atelier 100%), and
every one of those descriptions was borrowed.

**`product_GTIN`** — still absent, and this one is a **latent trap**. It is the column the
AWIN sibling coalesce reads. `sibling_coalesce` is currently `false` for Debenhams, so
nothing is broken today. Switch it on as part of the rollout and **it will do nothing at
all**, silently, with `ean_from_sibling: 0` reading as "this feed has no siblings to
recover" rather than "we never asked for the column". Item 33's rollout must not reach
retailer 28 before this is fixed.

**`product_type`** — still absent. The sibling of `category_name`, per item 33's measured
pairs.

#### The class

**Any retailer whose `feed_url` bypasses `buildFeedUrl` gets whatever columns its fetcher
chose, and nothing reconciles that with what the importer expects.** Three retailers are in
this position:

| Retailer | Fetcher | Column list |
|---|---|---|
| 28 Debenhams | `refresh-debenhams.yml` | **Ours, hand-written, diverged** |
| 6 Branded Beauty | `sync-bb-feed.yml` | Merchant's Darwin URL in a secret |
| 29 Atelier De Glow | `sync-adg-feed.yml` | Merchant's Darwin URL in a secret |

Debenhams is the only one where *we* choose the columns in two places, so it is the only
one that can diverge in this exact way. The other two have the adjacent exposure: their
column set is decided by a URL held in a GitHub secret that **nothing in the repository can
inspect**, so it cannot be diffed against `buildFeedUrl` at all — not because it matches,
but because it is unreadable from here.

**Strictly, no retailer's IMPORT is fetched by both paths.** `feed_url` is an either/or:
set it and `buildFeedUrl` is bypassed, leave it null and the workflow route does not exist.
So the two column lists never race on the same import.

**But the DIAGNOSTICS are a third fetcher, and they read every retailer.** `feed-diag.yml`
and `feed-categorisation-probe.yml` both hard-code an 18-column `COLS`, omitting
`description` and `product_short_description`. Those run against retailers whose imports use
`buildFeedUrl`'s 20 — so a probe and the import it predicts are reading **different feeds**,
and the probe cannot see description coverage at all. Item 46 already records four of five
probe figures disagreeing with the importer; the causes found there were population
differences, and this is a fourth mechanism sitting underneath them that was not known at
the time. **Three fetchers, three column lists, no comparison between any pair.**

#### Why it did not fail loudly

A missing column is not an error anywhere in the chain. AWIN returns the columns asked for —
**verified above; it does not truncate, and this failure needs no API misbehaviour to
happen.** The CSV parser maps what it finds. `idx.merchant_category` is simply `-1`, and
every read through it returns empty. **A feed with a column missing is indistinguishable
from a feed where every row leaves that column blank** — and the second is a normal,
expected state that the sibling-pair work exists to handle. The system is built to tolerate
blank columns, which is exactly what makes an unrequested one invisible.

**That tolerance is correct and should stay.** The defect is not that blanks are tolerated;
it is that "we did not ask" and "they did not send" produce the same downstream state and
nothing distinguishes them at the point of asking. The same shape as the guard conflating a
truncated download with a narrowed filter, and as deleteMissing conflating an exclusion with
an absence: two causes, one signal, at the only place a decision is made.

Same family as items 48, 49 and the guard: a plausible zero instead of a failure.

#### What would catch it

Not proposed as a build, recorded as the shape of the answer: **one column list, one place.**
Either the workflows import the importer's list, or a check diffs each fetcher's `COLS`
against `buildFeedUrl` and fails when they part. A comment asserting they match would be
convention 17's shape — a check that cannot fail.

---

### 52. Both merge functions accept a variant child as the keeper

**Raised:** 9 August 2026 · **A DEFECT IN THE REUSABLE FUNCTIONS**, found while scoping the
Niche Beauty barcode merge. Nothing has hit it yet. Everything that would is a script
nobody has written.

#### The gap

`fmb_soft_merge_group` guards its members like this, and this is the whole guard:

```sql
IF EXISTS (SELECT 1 FROM products WHERE id = ANY(p_removed||p_keeper)
           AND merged_into IS NOT NULL) THEN
  RAISE EXCEPTION 'a member is already merged';
```

**`merged_into IS NULL` admits variant children.** A product with `parent_product_id` set is
a shade or size child hanging off a parent, and it is the wrong merge target no matter what
its `merged_into` says — merging a root into a child inverts the hierarchy, and
`products_active` (which requires `merged_into IS NULL AND parent_product_id IS NULL`) then
resolves the group somewhere neither side chose.

`merge_product_group` is worse: its sanity checks cover null keeper, empty duplicates and
keeper-in-duplicates, and check **neither** column.

#### Why this is a rule gap and not a property of any batch

Every other definition of "a real product" in this codebase pairs the two conditions —
`products_active`, the frontend query indexes (`20260623150000`), the description helpers
(`20260622120000`), `metrics_quality_weekly`'s comparison-depth definition. **The merge
functions are the only place that checks one and not the other**, and they are the place
where getting it wrong writes to the catalogue.

The 406-pair Niche Beauty merge did not hit it, because its selection filter happened to
carry both conditions:

```sql
where k.parent_product_id is null and k.merged_into is null
```

Verified after the fact: **0 variant-child keepers in the applied batch.** That is the
selection query being right, not the function being safe. The next script that calls
`fmb_soft_merge_group` without replicating that filter by hand gets no protection from the
function, and the failure is silent — the merge succeeds and the hierarchy is wrong.

**There is a live population waiting for it.** Of the candidates in `tier1_ean_skips`,
**20 are variant children**. Any batch-2 script selecting on `merged_into IS NULL` alone
picks them up.

#### The fix, not built

Add `parent_product_id IS NOT NULL` to both functions' member guards, with distinct
exception text so a caller can tell the two rejections apart. It belongs with the batch-2
work rather than on its own, and it must not go in while a merge is mid-flight.

#### The general shape

**A guard that names one of a pair of conditions is more dangerous than no guard**, because
a caller reads `RAISE EXCEPTION 'a member is already merged'` and concludes membership is
checked. Convention 17 is a check that cannot fail; this is a check that fails on half of
what its name implies. Same family as item 51's partial contract, one level down.

---

### 53. Guard 3 was written before the failure, not after it

**Raised:** 9 August 2026 · **RECORDED BECAUSE IT IS RARE.** Almost every guard in this
project exists because something already broke. This one does not.

#### What happened

Scoping a supplements launch raised a reasonable fear: if widening
`EXCLUDE_PATTERNS.supplements` makes existing catalogue products start matching an
exclusion, does the importer destroy them? A destructive change would have forced the
whole V3 sequence into a defensive order.

**It cannot happen, and the reason is a guard someone wrote in advance.**

First, the exclusion branches `continue` — the feed row is skipped, nothing is written and
nothing is removed. The importer contains exactly **one** `.delete()` in the entire file
and it targets `import_run_state` on its own `run_id`. No product or price row is ever
deleted by an import.

Second, skipped rows fall to `fmb_apply_absence_handling`, which flips `in_stock = false`
and never deletes. And its third guard is written for precisely this scenario:

```sql
-- GUARD 3: filter-change confound.
-- If a category/brand exclusion changed, still-in-feed rows are dropped by
-- the filter and look absent. A jump in the excluded count is the tell.
IF v_this_excluded > 1.25 * v_base_excluded THEN
  v_skip := 'exclusion count … — in-scope filter likely changed';
```

**Widen an exclusion and absence handling refuses to run.** Two further guards sit
alongside: the run must have completed (`last_import_status = 'ok'`), and it must have
matched at least 80% of its trailing baseline.

#### GUARD 3 IS A DELAY, NOT A BLOCK — and it is not the binding constraint

The baseline is `percentile_cont(0.5)` over the **five most recent successful runs
excluding the current one** (`id <> v_log_id`). A run's own excluded count cannot lift the
median it is compared against — but it DOES enter the baseline for every later run, and
`scrape_log` is written whether or not the guard skips. So:

| Run at the new level | Baseline | Median | Guard |
|---|---|---|---|
| 1 | 5 old | old | fires |
| 2 | 1 new, 4 old | old | fires |
| 3 | 2 new, 3 old | old | fires |
| **4** | **3 new, 2 old** | **new** | **passes** |

Median of five is the third value, so it tips once three of the five are at the new level.
**Three runs of protection, then it expires.**

**But a row flips only when it is BOTH unseen this run AND stale past the retailer
threshold** — `LEAST(run_start - 90min, now() - threshold_days)`. The guard passing on day 4
does nothing while the row is still fresh. Every threshold exceeds three days, so **the
threshold binds in every case and the guard expires first**:

| Retailer | net exposed (current regex) | threshold | guard passes | rows flip |
|---|---|---|---|---|
| Stylevana | 5 | 21d | day 4 | day 22 |
| YesStyle | 5 | **9999d** | day 4 | **never** |
| Boots | 2 | 7d | day 4 | **day 8** |
| Niche Beauty | 2 | 7d | day 4 | **day 8** |

**The deadline on the backfill is 8 days and it covers 4 products.**

#### ADDENDUM, 13 August 2026: THE SAME SETTING, A SECOND CONSEQUENCE

`9999d` was set so YesStyle rows never flip. The row above records what that does to the
guard. **It does something else, and it is the more damaging of the two.**

> **A YesStyle row is the weakest possible evidence that a product is still stocked, and
> nothing on the row says so.**

Measured 13 August 2026, against each retailer's own most recent import:

| Retailer | thr | stale rows | of those, still `in_stock = true` | oldest row |
|---|---:|---:|---:|---|
| **YesStyle** | **9999d** | 6,497 / 13,800 (47.1%) | **6,497 — 100%** | **14 May** |
| Stylevana | 21d | 6,964 (57.1%) | 3,994 — 57% | 29 Apr |
| Boots | 7d | 13,887 (38.3%) | 783 — **5.6%** | 2 May |

**Every stale YesStyle row still reads as in stock**, including rows untouched for three
months. The absence step-down is what would demote them and it never runs, because
`now() - 9999 days` is a date that cannot arrive. **The check does not fail — it passes
vacuously**, which is why nothing reports it.

**This is what made item 86's re-source approach look viable and was the reason it was
not.** Product 7547's survivor was a YesStyle row last confirmed 30 May, still marked in
stock, still counted as "another active retailer holds this product". It held nothing. See
item 86 for the reframing: presence of a row is not evidence of presence in a feed, and on
this retailer the two have been decoupled since the threshold was set.

**Not changed here.** Lowering the threshold demotes thousands of rows in one run and is a
catalogue-visible change needing its own baseline. Recorded, not actioned.

**The exposed rows are FRESH, not stale.** Measured 9 Aug 2026: `last_updated` on every one
is under 0.6 days old, and **zero are past their threshold**. That is the expected state —
these products are in the feeds and imported daily. Staleness is the CONSEQUENCE of
widening the regex, not a pre-existing condition, so there is no population already sitting
past 30 days waiting to flip on the next import.

#### WHY GUARD 3 NOT HELPING IS NOT A DEFECT IN GUARD 3

**Read this before filing a gap.** Guard 3 protects against a different scenario and
protects against it correctly: a filter change that makes rows **still present in the feed**
look absent. Those rows should not flip, and it stops them.

Here the rows are genuinely out of scope after the change. The widened filter does not make
them falsely look absent — it removes their last chance to be refreshed, and they then go
stale for real. **Guard 3 declining to protect them is correct scoping, not a hole.** The
backfill is what protects them, which is why it comes first.

#### Why it is worth its own item

Items 48 through 52 are all the same shape in reverse: a measure calibrated on a world that
moved, discovered after it had already given a wrong answer. The row-floor guard, the
Debenhams filter, bucket A, `existing_brands_only`, the merge functions' half-guard — every
one was found by being wrong first.

**Guard 3 anticipated a specific confound, blocked it, and left a comment naming it.** The
person who wrote it reasoned forward from "what would make an absent row not really absent"
rather than backward from an incident. That is the standard the other guards should be held
to, and it is worth pointing at when the next one is written.

#### The practical consequence

The V3 ordering is **enum → backfill → both config changes together**, and the reason is
positive rather than defensive: supplements need somewhere to go before anything routes
them there. The two config changes must be simultaneous because opening the path while
leaving the regex loses **274 supplements including the entire Imedeen line** — but that is
a completeness problem, not a data-loss one.

#### THREE POPULATIONS, THREE NUMBERS. LABEL WHICH ONE YOU MEAN.

All three will be quoted and they are not interchangeable.

| Population | What it measures | Figure (9 Aug 2026) |
|---|---|---|
| **Current-regex catalogue exposure** | `EXCLUDE_PATTERNS.supplements` as it stands today, against `products_active` | 125 match, **113 already exempt** via the `capsuleIsTopical` escape (`categorisation.ts:300`), **12 net** — 10 skincare, **none in makeup** |
| **Feed-side clash** | the same regex against Boots 115009's admitted rows | **274 of 941 (29.1%)** — Imedeen, Equazen, Bio Kult, Sambucol, Paediasure |
| **Widened-regex exposure** | whatever a supplements launch widens the regex to | **NOT MEASURED.** The widening is not drafted |

The first is skincare-dominant and has nothing in makeup. The second is Boots-dominant.
Quoting one as the other is how a 12-row exposure becomes a 274-row one in conversation.

**The third is the one that matters and nobody has run it.** It is a single query once the
widening exists, and it is the only figure that could turn the 8-day window into a hard
precondition. Draft the regex, then measure, then decide — in that order.

---

### 54. Derive a threshold from the artefact, never from a log line

**Raised:** 9 August 2026 · **A SMALL PRINCIPLE WITH A LARGE FAILURE MODE**, from building
the `GONE_IDS` drift check.

The drift check refuses to open a PR when the net change exceeds a threshold. The count it
compares could have come from the regeneration script's own output — the script already
prints `added: N  removed: M`, and parsing that line is the obvious implementation.

**It reads the file instead**, counting ids in `GONE_IDS_RAW` before and after.

#### Why

**A threshold derived from a log line disables itself silently when the logging changes.**
Reword the message, add a colour code, change a label, and the grep matches nothing, the
count falls back to zero, zero never exceeds the threshold, and the guard passes every run
for ever. Nothing errors. The workflow stays green. The check is gone and its absence looks
exactly like its success.

Deriving the number from the artefact makes the check **independent of how the script
reports**. The file is the thing being changed, so the count cannot drift from the change
without the change itself being different.

#### The general form

> **A guard must measure the thing it guards, not a description of it.**

This is the same family as item 51's partial contract and convention 17's check that cannot
fail, arriving from a third direction. Item 51: a contract covering one function, read as
covering the output. Convention 17: an assertion that can never be false. **This one: an
assertion that is real today and becomes vacuous the moment an unrelated cosmetic edit
lands, with no signal at either point.**

Worth applying wherever a CI step parses another step's stdout to decide something. The
pattern is cheap to spot: if the guard would still pass when the upstream tool prints
nothing at all, it is measuring the description.

---

### 55. The homepage demo could render a basket that did not match its own total

**Raised:** 9 August 2026 · **Fixed in the same change** · Recorded for the shape rather
than the fix, which is three lines.

`scripts/generate-homepage-demo.mjs` selects a candidate basket, solves it across retailers,
then renders it:

```js
const ordered = cand.products
  .map(pid => products.find(p => p.id === pid))
  .filter(Boolean)          // <- silently drops anything the query did not return
```

`solved` is computed over **all** of `cand.products`. `ordered` is what gets rendered. If
the catalogue query did not return one of them — merged away, unimaged, retailer retired —
`.filter(Boolean)` removes it and **the page renders three items under a delivered total
calculated for four.**

#### Why this is the worst available shape

The block exists to demonstrate that our arithmetic is right. **A wrong number presented as
a demonstration of getting numbers right** is worse than the same error anywhere else on
the site, because the surrounding copy is an argument for trusting it.

And nothing fails. No exception, no empty render, no missing image. The output is a
well-formed basket with a total that does not add up, and the only way to notice is to sum
the prices by hand.

The nullish guard on the line above (`?.price ?? null`) protects a value that cannot be
null. **The array — the thing that could actually lose elements — was unguarded.** A guard
in the wrong place reads as a guarded function.

**Fix:** a missing product means the candidate is stale, which is a reason to reject the
candidate and try the next one, not to render a short basket. It now does that and names
the missing ids in the rejection log.
### 56. A report that cannot see its population returns a clean table of noes

**Raised:** 10 August 2026 · **Third member of the family with items 51 and 54.**

`scripts/debenhams-taxonomy-report.py` exists to answer one question: **what would admitting
this `merchant_category` value ADD that the filter does not already keep?** It reports, per
value, `rows / already / NEW / flagged / no-size`.

It was written to take a feed file. The only feed file the pipeline retains is the
**filtered output** — every row of which the filter already kept. So `already` is always the
whole row count and **`NEW` is always zero, by construction**.

Run against the real artefact on 10 August 2026:

```
raw rows: 11,066   distinct values: 142
    rows  already      NEW  flagged  no-size  value
    1490     1490        0        0        0  … Makeup > Face Makeup > Foundations & Concealers
    1237     1237        0        0        0  … Skin Care > Lotion & Moisturizer
     568      568        0        0        0  … Bath & Body
  [139 more, NEW = 0 on every one]
```

**142 values, zero exceptions, no error, exit code 0, a complete and well-formatted table.**
The output is indistinguishable from a real finding that no value would add anything — which
is a plausible answer, and the wrong one.

#### The family

| Item | Shape |
|---|---|
| 51 | a contract covering one function, read as covering the output |
| 54 | a threshold parsed from a log line, silently vacuous when the logging changes |
| **56** | **a report reading a population that excludes what it is asking about** |

All three produce **a confident, well-formed, wrong answer with nothing failing.** And all
three are invisible to testing that checks the tool *runs*, because the tool runs perfectly.

#### The tell, and it is cheap

**If a diagnostic's key column can only take one value given its input, it is reading the
wrong input.** A column of identical answers is not a result; it is a question that was
never asked. `NEW = 0` on 142 of 142 values should read as "this cannot come out any other
way", not as "nothing would be added".

#### Fixed

The report now runs against `raw.csv.gz` inside `refresh-debenhams.yml`, in the window
between the filter step and the cleanup step — the only window in which the question is
answerable at all. Read-only, before the guard so a refused run still produces it, and it
cannot fail the import.

**It had existed for a day without ever having been given data it could read.** Nobody
noticed because it never errored.

---

### 57. A rule fitted to its catalogue, not to its concept

**Raised:** 10 August 2026 · **THE VALIDATION THAT CAUGHT IT IS THE RECORD-WORTHY PART.**

The supplements classification rule was written against the catalogue, then validated
against a random 34-row catalogue sample it had not been written from. **32 of 34.** A real
result on an honest test.

It was then run against 2,415 raw Boots feed rows — the population that arrives when the
path allowlist opens — **before** the config change. It failed in three directions at once.

#### The failure that matters

```
SUPPLEMENT (default fired) | Viagra Connect Sildenafil 50Mg Film-Coated Tablets - 4
```

**A pharmaceutical entering a consumer supplements category through a rule with no concept
of medicine.** Not a misfiled moisturiser — a different order of problem, and unreachable by
tuning, because every signal the rule reads correctly says "supplement".

#### The mechanism: words that invert between catalogues

| Word | Beauty catalogue | Health catalogue |
|---|---|---|
| `oil` | facial oil — topical | fish oil — ingested |
| `gel` | gel cleanser — topical | soft gel capsule — dosage form |
| `pack` | sheet-mask pack — topical | pack of 10 capsules — quantity |

Same string, opposite meaning, and **only the surrounding catalogue disambiguates**. The
rule had no way to know which catalogue it was reading.

The truncation heuristic inverted the same way: a short trailing token means a cut-off word
in beauty and a pack size in health, so it flagged **95.6%** of the health feed.

#### The general form

> **A rule validated on one corpus is validated for that corpus. Moving it to another
> corpus is an untested change, however good the validation was.**

This is items 48 and 51 arriving from the far side. Bucket A was calibrated on advertisers
who name products the way our catalogue does; the Debenhams filter on the feeds that existed
when it was written. **Both were found by being wrong in production. This one was found by
being tested on the new corpus first**, which is the only difference that matters and the
reason it cost nothing.

**The practice worth keeping: when a classifier moves to a new population, re-validate on a
sample of THAT population before the change that exposes it.** It is one workflow dispatch
and it turned a config change into a design decision.

#### What it changed

Imports now classify on the retailer's own taxonomy path; the name rule is a secondary
check, never the classifier. `Medicine & Drugs` is not admitted, and the ~115 supplements
inside it are a **stated accepted cost** rather than an oversight. Recorded in
`docs/supplements-definition.md` v1.2.

---

### 58. The control caught a bad expectation, not a bad result

**Raised:** 11 August 2026 · **Recorded because both halves are true and only one is
interesting.**

`KEPT_BY` was added to `filter-debenhams-feed.py` specifically so the tier-1 extension could
be read by composition and not only by total — the stated reason being that *"a total that
lands with the composition shifted is something else wearing the right number"*.

First post-extension run, 11 August:

```
KEPT BY BRANCH:
  path                            8,189
  tier1_merchant_category        13,010
  brand_fallback                  1,391
  TOTAL                          22,590
```

**The path branch was predicted at 3,700-4,500 and read 8,189.** The prediction was wrong,
not the result: the 9 August artefact already showed **8,294 rows carrying a category
path**, so the path branch has been at ~8,200 throughout. The band never described it.

**The reconciliation is exact:**

| | |
|---|---|
| pre-extension filtered total | 11,067 |
| tier-1 rows admitted | 13,010 |
| …of which previously rescued by the brand fallback | **~1,390** (fallback fell 2,781 → 1,391) |
| net new | **11,523** |
| **11,067 + 11,523** | **22,590** ✓ |

Tier 1 runs before the brand fallback, so it absorbed rows the fallback used to catch. That
is why 13,010 admitted is not 13,010 gained.

#### Why this is worth an item

**"The control worked" and "the prediction was wrong" are both true, and the second is the
finding.** A control that only ever confirms expectations is decorative; this one produced a
number nobody expected and forced the reconciliation that explained it. Had only the total
been read — 22,590 against ~22,000 expected — the run would have looked unremarkable and the
1,390-row transfer between branches would have gone unnoticed.

**The general form: build the control to be read BEFORE the headline, and expect it to
disagree.** If it never disagrees, it is not measuring anything the headline does not.

---

### 59. A retracted premise and a re-opened decision are different acts, and only the first happened

**Raised:** 11 August 2026 · **THE MOST CONSEQUENTIAL ERROR IN THE AUGUST THREAD**, and it
is not an unsourced figure. Every part of the evidence chain worked. The decision that
rested on it was simply never revisited.

#### The sequence

| | |
|---|---|
| **9 Aug** | It was concluded that `product_GTIN` **is not an AWIN column**, that the sibling coalesce therefore gates a fallback to nothing, and that the flag is decoration. **Stages 3-6 of the rollout were cancelled** on that basis |
| **10 Aug** | The premise was tested. `feed-diag` run 31172005496 printed the **parsed AWIN response header**: `product_GTIN` present, populated on **14,632 of 14,636 rows**. Corroborated by `ean_from_sibling` reading 10,473 on Beauty Flash — structurally impossible if the column were absent. **The retraction was recorded the same day** |
| **11 Aug** | The cancellation was still in force. Gorgeous Shop, Escentual and Boots were still at `sibling_coalesce = false`, still storing **zero barcodes across 51,110 rows** |

**The evidence was retracted correctly and promptly. Nobody walked the consequence back.**

#### Why this is a distinct failure mode

Item 47 is about figures that were never sourced. **This is the opposite: the figure was
sourced, found wrong, and corrected — and the correction did not propagate.**

> **Retracting a premise and re-opening what rested on it are two acts. Doing the first
> feels like doing both.**

It feels complete because the record is now accurate: the false claim is struck, the true
one is written down, the file reads correctly. What is missing is invisible — a decision
somewhere else, still standing, whose only support has been removed. Nothing points from the
retraction to it.

**The cancellation outlived its justification by two days and 51,110 rows**, and would have
outlived it indefinitely, because nothing in the process asks "what did we decide on the
strength of this?"

#### The practical form

- **When a premise is retracted, list what was decided on it in the same edit.** Not later,
  not as a follow-up — in the same edit, because that is the only moment the connection is
  in anyone's head.
- **A cancellation is a decision and needs a reason attached.** "Stages 3-6 cancelled" with
  no recorded basis cannot be audited when the basis fails. Had the cancellation cited the
  phantom-column premise explicitly, falsifying it would have surfaced the cancellation.
- **Cheap check: after any correction, grep the record for what cited the old claim.**

#### Resolution

Rollout resumed 11 August, item 33's order, smallest first, one flag per run so a surprise
stays attributable. **Gorgeous Shop flipped first** — 7,254 rows, 5,872 in stock, 0
barcodes, `product_GTIN` at 98.7%. Escentual and Boots remain off pending its read.

Recorded expectation for the first run, set before it: **150-600 tier-1 links as a one-off
backlog spike**, falling sharply the next day; `tier1_ambiguous_skipped` appearing where
there were none and holding roughly flat. Same shape as Beauty Flash's 681 → 94 and Niche
Beauty's 237 → 62 → 33.

---

### 60. Amazon: the three measurements item 22 was gated on

**Raised:** 11 August 2026 · **Measured, not assumed.** Item 22's first discovery step had
never been run, and the design depended on all three answers. Cost: **two GetItems calls**,
both HTTP 200.

**A rate limit is per-second throughput, not a monthly allowance.** The wasting asset is
qualifying SALES — currently twelve against a floor near ten on a rolling window — and a
GetItems request is not one. That distinction is why the measurement was affordable, and it
was the thing blocking it.

#### 1. NO QUOTA HEADERS ON EITHER PATH — throttling must be self-imposed

Success path, `HTTP 200`, complete and verbatim:

```
content-type, content-length, connection, date,
x-amzn-requestid, x-cache, via, x-amz-cf-pop, x-amz-cf-id, vary
```

**Ten headers, seven of them CloudFront plumbing. Nothing names a quota, a remaining count,
a reset window or a TPS.** No `x-ratelimit-*`, no `retry-after`.

The 3 August diagnostic established the same for the error path but could not check the
success path, because `DefaultApi.getItems` discards the response. **Both paths are now
checked and both are empty.** That was the last place the information could have been.

> **Rate limiting is not discoverable from responses. Any throttle must be self-imposed and
> empirical — a chosen rate that is backed off on failure, never a rate read from a header.**

Recorded as a negative result because it closes the question. Nobody needs to look again.

#### 2. TEN PER CALL — and unmatched ASINs vanish silently

| ASINs sent | Result |
|---|---|
| 3 | 200 |
| 10 | 200 |
| **12** | **400 ValidationException** |

> `Value '[…]' at 'itemIds' failed to satisfy constraint: **Member must have length less
> than or equal to 10**`

Server-enforced; the SDK carries no client-side check. **300 ASINs is 30 calls, not 300** —
which is the answer that decides the shape, and it is the good one.

**THE TRAP, and it is the half that will bite:** the 10-ASIN call returned **2 items**. The
eight unmatched ASINs did **not** error and were **silently absent** from
`itemsResult.items`.

> **A map that assumes ten back would drop eight and look like it worked.** Partial returns
> are the normal case, not an error case. Reconcile returned ASINs against requested ones
> every call, and treat the difference as data rather than as a failure.

Same family as the plausible-zero items (48, 51, 54, 56): a well-formed successful response
that is quietly incomplete.

#### 3. THE FIRST ASIN MAP IS BRAND-LED, NOT CLICK-LED

`outbound_clicks` holds **367 clicks** across the whole catalogue's history. The ranking:

| | clicks |
|---|---|
| Beauty of Joseon Relief Sun Rice + Probiotic SPF | **11** |
| Eucerin Urea Repair 10% Urea Lotion | 9 |
| medicube Age-R Booster Pro X2 | 7 |
| …rank 15 | **4** |

**Eleven at rank one and four by rank fifteen is noise with an order imposed on it.** The
gap between rank 3 and rank 30 is two or three clicks. A curated set built on it would be
arbitrary dressed as data-driven.

**But the SHAPE underneath is real, and it matches what strategy.md already says.** The top
fifteen is K-beauty-dominated: Beauty of Joseon ×3, medicube ×3, Haruharu Wonder, SKIN1004,
Arencia. `docs/strategy.md:44` already records that the proposition holds hardest for
K-beauty specialists, because delivery thresholds bite where unit prices are low.

> **Selection principle: the first ASIN map is brand-led — the K-beauty brands we already
> know convert — not a top-N by clicks.**
>
> **The reason, and it is the point: the click data cannot support a ranking and the brand
> pattern can.** A defensible principle beats a precise-looking list built on four clicks.

#### One structural finding that makes this cheap

`DefaultApi.getItems` throws the response away:

```js
.then(function(response_and_data) { return response_and_data.data; });
```

But **`getItemsWithHttpInfo` already returns `{data, response}`**. No patch, no fork, no
vendored-SDK change — call the inner method. **Instrumenting this is a script, not a
project**, and the earlier note that the SDK discards the response object was true of one
wrapper and not of the layer beneath it.

#### 4. THE BARCODE TEST — the last unknown, and it passes

**Measured 11 August 2026, one GetItems call, six ASINs from confirmed official brand
stores.** `itemInfo.externalIds` exists as a resource and **returned EANs for all six**.

| ASIN | Brand | Matched catalogue product | Size agreement | Live retailers |
|---|---|---|---|---|
| B01LEJ5MSK | COSRX | `7741` Advanced Snail 92 All In One Cream Tube 100g | Amazon says **1 g** — wrong | **7** |
| B09JVNZVH3 | Beauty of Joseon | `7092` Relief Sun Rice + Probiotic SPF50 | 50 ml / 50ml | **7** |
| B0D1G7XF9X | medicube | `4310` Zero Pore Blackhead Mud Mask 100g | 100 g / 100g | **4** |
| B0CNCL35CH | Dr. Melaxin | `5880` Cemenrete Calcium Volume Multi Balm 9g | 9 g / 9g | **3** |
| B0DM1VTB62 | COSRX | `83025` Advanced Snail Mucin Glass Glow Hydrogel Mask | 3 count / 34g | **2** |
| **B00PBX3L7K** | COSRX | **NO MATCH** — Snail 96 Mucin Essence 100ml | — | — |

**Five of six. The map is semi-automatic and a few hundred products is feasible** — not the
20-30 manual map that was the fallback if barcodes were absent.

#### THE JOIN IS ONE-TO-MANY BY NATURE. This is the finding, not a caution.

**B01LEJ5MSK returned THIRTEEN EANs for one ASIN**, of which **exactly one matched**
(`8809416470016`). An Amazon listing aggregates variants and many sellers' stock, so
multiple manufacturer identifiers collapse onto a single ASIN.

> **A pipeline written for one identifier per ASIN matches NOTHING on that product, and the
> failure reads as a coverage gap rather than a design error.** Try every returned EAN;
> accept the first catalogue hit.

That is the difference between a map that covers COSRX's flagship cream and one that
silently does not, and nothing in the output would say which you had built.

#### SIZE IS CONFIRMATION ONLY, NEVER A GATE

> **RULE: never reject a barcode match on a size mismatch.**

B01LEJ5MSK reports `size: 1 g (Pack of 1)` for a **100g** cream — a correct match on a
product carried by seven retailers, which any sensible size check would have rejected.
B0DM1VTB62 reports `3 count` against our `34g`, also correct and also unrecognisable to a
size comparison.

Amazon's `size` is a merchandising field, not a spec. Use it to sanity-check a match a human
is already reviewing; never to filter automatically.

#### PARTIAL COVERAGE IS REAL, AND THE MANUAL PASS IS PART OF THE PIPELINE

**The miss is COSRX Advanced Snail 96 Mucin Power Essence** — one of the best-known K-beauty
products there is. Its two Amazon EANs (`8809419647347`, `0716053700353`) match nothing in
our catalogue.

> **CORRECTED 14 AUGUST 2026, AND THE CORRECTION INVERTS WHAT WAS CONCLUDED FROM IT.**
>
> **We carry that product.** It is `123`, *"CosRx Advanced Snail 96 Mucin Power Essence
> 100ml"*, with **nine live retailers**. Its two Amazon barcodes match nothing; **the product
> was never missing.**
>
> **A BARCODE ABSENCE WAS READ AS A PRODUCT ABSENCE.** The sentence above is true of the
> identifiers and false of the thing they identify. `B00PBX3L7K` scores **1.00** against
> `123` on name, size agreeing (100ml against Amazon's "3.38 fl.oz / 100ml") — it was one
> query away throughout.
>
> **The inference this example was carrying — that the non-matches are where the products
> people actually search for sit — rested on this row, and this row does not support it.**
> What survives, and what does not, is measured in **item 97**.

**Official-store membership does not guarantee a match.** Five of six is a sample of six, so
the true rate is unknown — but the miss landing on a flagship rather than an obscure product
is the useful signal: **the non-matches are not a tail to be tidied up. Reviewing them is a
standing part of the pipeline**, and it is where the products people actually search for may
sit.

#### WHY THIS IS ADDITIVE RATHER THAN DILUTIVE

**Every one of the five matches sits on a product with 2 to 7 live retailers.**

Amazon is an **extra column on rows that already work** — not a new orphan, not breadth. It
deepens existing comparisons rather than adding single-stockist products, which is the
opposite of the Boots supplements trade-off and the reason this needs no "breadth, not
depth" caveat.

#### The confirmed official-store set

| Brand | Store | ASINs confirmed |
|---|---|---|
| COSRX | `42AB92B6…` | B00PBX3L7K, B01LEJ5MSK, B0DM1VTB62 |
| medicube | `4EFC153A…` | B0D1G7XF9X, B0FKTKF8RB, B0DNMCJMBB |
| Beauty of Joseon | `C6E0917D…` | B09JVNZVH3 |
| Dr Melaxin | `9825D09E…` | B0CNCL35CH |
| unnamed | `67C2B44D…` | B0CYS776TR |

**Official stores are first-party distribution**, which removes the grey-market objection to
linking. The 13-EAN listing illustrates why that matters: it is visibly an aggregation of
many sellers' stock rather than one manufacturer SKU.

Four of the five brands appear in the click-engagement top fifteen — the brand-led selection
principle confirming itself from an independent direction.

#### SCOPE AMENDED, 14 AUGUST 2026: SUPPLEMENTS JOIN THE MAP, ALONGSIDE K-BEAUTY

**Robbie's decision.** The ASIN map covers **two** populations, not one: the K-beauty brands
above, and **supplements**.

**The supplements reason is a different argument from the K-beauty one, and it should not be
collapsed into it.** K-beauty is in scope because we know it converts and because delivery
thresholds bite hardest where unit prices are low (`docs/strategy.md:44`). Supplements are
in scope because of **what the goods are**:

> **Supplements are commodity goods with repeat purchase and price transparency. That is
> precisely where Amazon competes hardest — and where people price-check by habit rather
> than by research.**

A tub of whey or a multivitamin is the same object wherever it is bought; the only variable
is the delivered price, the purchase recurs, and the shopper has bought it before and
remembers what it cost. Every one of those properties is an Amazon strength, and each one is
also a reason a shopper will notice Amazon's absence from a comparison without being told to
look.

#### THE BUILD SPLITS IN TWO, AND THE SPLIT IS ABOUT WHICH CATALOGUE EXISTS TODAY

| Tranche | Population | When | Why then |
|---|---|---|---|
| **1** | **K-beauty** — COSRX, medicube, Beauty of Joseon, Dr Melaxin and the unnamed fifth store `67C2B44D…` | **Now** | The products exist, the five official stores are confirmed, and five of six test ASINs matched live catalogue rows carrying 2-7 retailers each. **Nothing is owed; it is buildable today.** |
| **2** | **Supplements** | **After the Boots supplements path prefix lands** — step 6 | The catalogue it would map does not meaningfully exist yet. |

**The counts are the whole argument for that ordering, and they are measured, not estimated:**

| Supplements catalogue | products |
|---|---:|
| today, 12 August baseline (item 72) | **93** |
| of those, comparable | **23** — from three brands: Vida Glow 15, Solgar 6, Hair Gain 2 (item 65) |
| after the Boots prefix is activated | **~1,715** (item 92, measured 14 August on the shipped rule) |

> **Building the supplements ASIN map before step 6 means mapping 23 comparable rows and
> then doing it again against ~1,715.** Not a slightly incomplete map — a map of a catalogue
> that is about to be replaced by one seventy-five times its size.

The two tranches share the pipeline shape below entirely; nothing about tranche 2 is
speculative work, it is the same script pointed at a different brand list once the rows
exist. **This is a sequencing decision, not a scope reduction.**

#### TRANCHE 2 HAS TWO POTENTIAL CATALOGUE SOURCES, NOT ONE — AND ONLY ONE IS SIZED

The ~1,715 above is **Boots**. It is not the whole of what supplements could be, and the
second source is in a materially different state:

| Source | State | What it would contribute |
|---|---|---|
| **Boots** | **Scoped and wired**, gated on **two config values moving together** — `category_path_must_contain` and `supplements_path_prefixes` (item 91) | **~1,715** products once the path prefix lands (item 92, measured 14 August on the shipped rule) |
| **Debenhams** | **PARKED** (item 90). Nothing added to any allowlist | **Unknown, and not derivable from what has been measured** |

**What is known about Debenhams**, from item 90's 14 August read: **~1,581 rows** across the
three `Fitness & Nutrition` merchant_category values (1,560 Vitamins & Supplements, 14
Nutrition Bars, 7 Nutrition Drinks & Shakes), including **Applied Nutrition at 549 rows**, of
which the catalogue currently holds **zero**.

**Why 1,581 is not a size.** Branch 1 of `is_beauty()` rejects a row with a populated
non-beauty path **before** the tier-1 `merchant_category` branch is reached, so **adding the
value to the whitelist rescues only the empty-path subset** (item 87). `T1-ABLE` exists to
count exactly that subset and now drives the report's sort — **but the figure for this value
has not been recorded here.** Until it is, the contribution is bounded above by 1,549 and
bounded below by nothing.

> **The supplements ASIN map sizes differently depending on which source lands, and the
> second source's size is unknown for a mechanism reason rather than an effort one.**
> **Debenhams needs its own investigation before anyone knows what it would admit.**

**Recorded here, in the map scope, rather than as a queued task — because it is not queued.**
It is parked, and *parked* is the accurate word: the blocker is a question about how the
whitelist interacts with branch 1, not a position in a priority order. Nothing starts moving
on it by working through a backlog.

#### IF DEBENHAMS EVER SHIPS, ITEM 89 GOES LIVE — AND APPLIED NUTRITION IS THE CASE

Item 89 records that `SPORTS_BRANDS`' *"fails safe: an unlisted sports brand lands in
`supplements`, which is wrong but not absurd"* is a judgement about a scale that was never
stated. **Debenhams is that scale.**

> **Applied Nutrition is absent from `SPORTS_BRANDS` and carries 549 Debenhams rows. All 549
> would classify `supplements` rather than `sports` — the single largest misclassification in
> the category.**

Inert today, and it stays inert for Boots: Applied Nutrition has ~15 rows there, which is
where "wrong but not absurd" is true. **The list needs no change now.** But the two facts
must not be met separately — **whoever investigates Debenhams meets item 89 as a live
defect on arrival, not as a general caution**, and the fix is one brand added to a list
before the first import rather than 549 rows recategorised after it.

#### Status

**Tranche 1 (K-beauty): specified enough to build, needs no further measurement, and is no
longer sequenced behind supplements** — amended 14 August 2026. It was, on the reading that
the whole map was one piece of work; split in two, its half has no dependency to wait on.

**Tranche 2 (supplements): gated on step 6**, the Boots supplements path prefix activation —
which itself still needs the migration applied and **both** config values written together
(item 91).

Pipeline shape, settled: enumerate ASINs from official brand stores -> `GetItems` in batches
of **10** with `itemInfo.externalIds` -> match **any** returned EAN against
`ean_normalised` -> confirm by title and brand -> store the ASIN -> **manual pass over
non-matches**. Self-imposed throttle, backed off on failure; no header will tell you the
rate.

---

### 61. Amazon joins the basket optimiser, and delivery stops being a property of the retailer

**Raised:** 11 August 2026 · **Robbie's decision:** Amazon joins the basket optimiser, it
does not sit beside it. **Item 60's cross-check is phase 1. This is phase 2.** Separate
items because they are separate pieces of work with a hard ordering between them, not two
halves of one.

#### The design problem

**Amazon's delivery is a property of the SHOPPER, not the retailer.** Prime members pay
nothing. Non-members pay unless they clear a threshold. And the buy-box seller can change
both, so the terms are not even fixed per product.

Every other retailer has one threshold and one charge. That is not an informal
observation — it is what the schema encodes and what two CHECK constraints enforce:

```sql
retailers_delivery_model_check   CHECK (delivery_model IN ('tiered','flat','unknown'))
retailers_delivery_shape         CHECK (
     (delivery_model = 'tiered'  AND delivery_threshold IS NOT NULL AND delivery_cost IS NOT NULL)
  OR (delivery_model = 'flat'    AND delivery_threshold IS NULL     AND delivery_cost IS NOT NULL)
  OR (delivery_model = 'unknown' AND delivery_threshold IS NULL     AND delivery_cost IS NULL))
```

Thirteen active retailers today: **11 tiered, 1 flat, 1 unknown.** The assumption has never
been tested because it has never been false.

**The sharpest statement of the problem is the function signature.**
`deliveryFor(retailer, legTotal)` takes the retailer's terms and the leg subtotal, and
nothing else. **There is no parameter that could carry the answer.** That is not an
oversight to correct; it was correct for all thirteen.

#### The answer: the Prime toggle

**Ask once, store it with the routine, and Amazon's delivery becomes knowable.** One
question, asked a single time, converts a case that cannot be priced into one that is
priced exactly — not estimated, not averaged, not hedged with "delivery may apply".

**That is the thing no UK comparison site does.** Everyone else either excludes Amazon,
shows a goods price with delivery unresolved, or picks one assumption and applies it to
every shopper. The toggle is cheap and the output is a delivered total that is true for
the person reading it.

#### What it touches, so the size is on record

| Surface | The work |
|---|---|
| `delivery_model` | A fourth value, and **both** constraints change — the enum and, more substantially, `retailers_delivery_shape`, which has one arm per model. Amazon's arm is genuinely new: threshold and cost present like `tiered`, plus the member-pays-nothing fact, which no existing arm can express. |
| The optimiser | **Branches on shopper state for the first time.** `deliveryFor` gains an argument and every call site passes it. |
| The delivery rule | Two runtime copies — `lib/delivery.ts` and `supabase/functions/_shared/delivery.ts` — with `lib/__tests__/delivery.test.ts` asserting they agree case by case. The fourth model lands in all three or the test fails. The guard works as designed; it makes the change **wider but not riskier**. |
| `RoutineBuilder` | Gains a persistent preference. `lib/routine-store.ts` is a `RoutineItem[]` in localStorage today with no preference field at all. |
| The three readers | `scripts/generate-homepage-demo.mjs`, `send-routine-email`, and the savings calculation all read delivery, and **all three need handling.** |
| The savings figure | The baseline is a *delivered* total, so a Prime shopper and a non-Prime shopper have **different savings on the same routine**. The headline number becomes shopper-relative. |

#### The degradation path already exists, and it is `unknown`

A shopper who has not answered is exactly the `unknown` case: goods stay visible, the
retailer is never ranked on delivered total against one whose delivered total is known.
That branch shipped 3 August for retailers mid-onboarding. **Phase 2 therefore has a safe
default that is already written and already tested**, rather than one that has to be
invented.

One difference that must not be carried across: for a retailer, `unknown` is
**transitional**, and `retailers_delivery_unknown` exists to catch anything that stays
there. For a shopper, unanswered is a **permanent, legitimate state** — most people will
never answer. The behaviour transfers; **the watch does not.**

#### OPEN, with no clean answer yet

**Amazon prices cannot be stored beyond 24 hours, but a saved routine is priced at a
moment.**

Re-pricing on view is fine — that fetch is live by construction. **Price-drop alerts are
the problem**, and they are the problem precisely because they are the feature: the alert
compares `baseline_price` against `current_price`, and both are stored. A price-drop alert
without a held price is not a degraded alert, it is not an alert.

- **Exclude Amazon from alerts** — then the retailer most likely to be a routine's cheapest
  is the one silently absent from the feature that tells you a price moved.
- **Re-fetch at alert time** — call volume scales with subscribers × routine size against a
  rate limit that is **not discoverable from any response header** (item 60), and an
  unreachable API becomes a *missing* alert rather than a stale one.

**Neither is obviously right. Recorded open, and deliberately not decided now** — phase 1
produces the fact that decides it.

#### THE CONSTRAINT BITES HARDEST IN SUPPLEMENTS, AND IT ARRIVES WITH THEM

**Added 14 August 2026, when supplements joined the ASIN map scope (item 60).** Noted here
rather than left to be rediscovered when the first protein comparison renders.

**Protein is heavy.** Delivery is not a rounding error on top of the goods price, it is a
large share of what it costs to receive the product at all — and heavier goods are where a
threshold-based delivery charge stops being a nuisance and starts being the difference
between two sellers.

**And Amazon cannot join the basket optimiser** — that is what this item exists to change,
and until it does, the comparison surface has no way to say what it needs to say:

> **A 2kg tub with Prime, against a UK retailer's £3.99 delivery, is a real difference — and
> the basket total is the one number that cannot express it.** One side's delivery depends
> on who the shopper is; the other's is a property of the retailer. The totals are not
> comparable, and nothing about their presentation says so.

That is the Prime toggle question arriving in the category where it matters most. It was
raised as a design problem in the abstract on 11 August, on thirteen retailers whose terms
happen to be uniform. **Supplements are where it stops being abstract**: the goods are heavy,
the delivery share is high, the purchase repeats, and the shopper already knows what they
paid last time.

**It does not change the sequence below** — phase 1 still runs first, and it now has a
sharper question to answer, because *how often Amazon wins* will read differently in a
category where the win is often a delivery win rather than a goods-price one.

#### SEQUENCE: cross-check first

Not caution — sequencing on an input. Phase 1 establishes the fetch, the ASIN map and the
degradation, and it measures **how often Amazon actually wins.**

**Building phase 2 first means designing for a case whose frequency is unknown.** A schema
arm, a stored preference, two synchronised runtime copies and a shopper-relative savings
figure are all justified if Amazon wins often, and are a question asked of every shopper to
change a handful of baskets if it does not. **The frequency is an input to the design, and
only phase 1 produces it.**

~~**Both sequenced behind supplements.**~~ **Amended 14 August 2026 when item 60's build
split in two:** item 60 **tranche 1 (K-beauty) runs now**; item 60 tranche 2 (supplements
ASINs) is gated on step 6; **this item is unchanged — still behind phase 1**, which is now
tranche 1 rather than the whole map.

---

### 62. Tier 1 pre-empts tier 2, it does not acquire links — so `would_link_via_ean` is the wrong metric

**Raised:** 12 August 2026, from the Gorgeous Shop coalesce read · **Supersedes the metric
used for stages 1-3.**

Gorgeous Shop's first coalesce run returned `would_link_via_ean` **1,133** against a
recorded band of **150-600**. Nearly double the top, and a stopping condition fired. **The
band was measuring the right quantity against the wrong counter.**

| | via_ean | via_mpn | via_name | **link_total** |
|---|---|---|---|---|
| Beauty Flash, tier 1 off | 1 | 1,282 | 265 | 1,548 |
| Beauty Flash, tier 1 on | **681** | 767 *(−515)* | 179 | 1,627 · **+79** |
| Gorgeous Shop, coalesce off | 0 | 2,294 | 85 | 1,526 |
| Gorgeous Shop, coalesce on | **1,133** | 1,126 *(−1,168)* | 40 *(−45)* | 1,735 · **+209** |

**MPN fell by 1,168 while EAN rose by 1,133.** Tier 1 took essentially every one of its
links off tiers 2-4. Net movement was **+209 — inside the band all along.**

The prediction had been scaled as `681 ÷ 9,147 rows_with_ean = 7.4%`, applied to Gorgeous
Shop's 8,323. **`rows_with_ean` is not the denominator.** Tier 1 does not acquire links from
rows that carry a barcode; it re-decides rows the lower tiers were already matching. The
population it draws from is the tier-2 population, and Gorgeous Shop's was nearly twice
Beauty Flash's (2,294 vs 1,282 on comparable row counts) — which is the whole of the
"surprise".

> **METRIC FOR ALL REMAINING STAGES: net movement in `would_link_to_existing_product`.
> Not `would_link_via_ean`.** The tier counters describe *which* tier resolved a row. Only
> the total describes whether a row got linked that would not otherwise have been.

#### Ground truth, which needs no counters at all

The run's inserts form one contiguous id block, 488,652-489,676, sitting immediately above
Boots' 04:30 maximum:

- **552 rows inserted.** Prior days: 5, 31, 4, 3, 55, 4, then 178. All 552 carry a barcode.
- **534** landed on a product that already had another live in-stock retailer.
- **57** moved a product 1 → 2 · **476** added a price to an already-comparable product ·
  **18** breadth-only, matching `would_create_new_product` exactly.
- Comparison depth **12,355** against the 12,115 baseline, but Debenhams, Boots, Beauty Bay
  and Beauty Flash all ran the same morning. **Gorgeous Shop's own contribution to depth is
  the 57**, and quoting the +240 as its result would be the go-live attribution error again.

Correctness spot-check on twelve of the new rows: every one sits on a product where one to
three other retailers carry the **same barcode**. Creates also fell 79 → 18, so tier 1 is
suppressing duplicate product creation as well as redirecting links.

**`new_count` is not rows written.** It is `linksApplied + createsApplied` — 1,027 that day,
of which 475 were upserts onto rows that already existed. Do not read it as acquisition.

#### Escentual and Boots are the opposite case, and fill rate does not predict them either

`feed-diag`, re-run read-only on 12 August, both stable against the 2 August figures:

| | Feed rows | `ean` | `product_GTIN` | `mpn` |
|---|---|---|---|---|
| Escentual, fid 97233 | 7,980 | **0.0%** | **99.8%** (7,966) | 99.9% |
| Boots, fid 115009 | 37,411 | **0.0%** | **96.8%** (36,217) | 100.0% |

Boots' allowlist excludes 13,766 rows (36.8%), leaving 23,645 admitted.

**Both have `would_link_via_mpn` = 0, so there is no tier-2 population to reallocate from —
but that does not make tier 1's links net new at scale, because almost nothing reaches the
tier ladder at all.** Both resolve on tier 0:

| | Feed rows | tier-0 updates | pre-filtered | **rows reaching the tier ladder** |
|---|---|---|---|---|
| Gorgeous Shop | 9,706 | 5,740 | 1,647 | **2,319** |
| Boots | 37,411 | 22,315 | 14,908 | **188** |
| Escentual | 7,981 | 6,220 | 1,709 | **52** |

Boots and Escentual match **99.2% of admitted rows on `external_product_id`** before tier 1
is consulted. Gorgeous Shop matches 71%. **The addressable population is 12× and 44× smaller
— not larger.**

> **Predicted net link movement: tens, not hundreds. Escentual is bounded above by ~48 rows,
> Boots by ~159.** `rows_with_mpn` reads 6,375 and 22,887 for the two, and `via_mpn` still
> reads 0, because those rows exit at tier 0 and never see a tier. The same will be true of
> tier 1.

**So the fill rate answers a different question than the one it was asked for — and the
answer is more valuable.** Barcodes are written on tier-0 *update* rows too, not only on
new links. Flipping these two flags puts roughly **7,000 and 23,000 barcodes into the
catalogue's index**, where they are read by *other* retailers' tier 1 on subsequent runs.
Gorgeous Shop's 1,133 were matched against barcodes that Beauty Flash's 10 August flip had
put there.

> **The two remaining flags are supply-side, not demand-side.** Their own link movement is
> tens. Their contribution is ~30,000 barcodes into the index that every other retailer's
> tier 1 reads. **Judging them on their own `link_total` would retire them as failures.**

Expected reads on a flip, therefore: `rows_with_ean` 0 → thousands, `ean_from_sibling` at
roughly the fill rate, `barcode_rejected` non-trivial, `tier1_ambiguous_skipped` appearing —
and `would_link_to_existing_product` **barely moving**. That last one is the success case,
not the failure case, and it must be written down before the flip or it will read as a
non-event.

**Calibration for the barcode haircut, from Gorgeous Shop:** fill 98.6% → `rows_with_ean`
85.8% of feed rows, because **13.0% of populated GTINs fail validation** — length_11,
length_7 internal SKUs (`OW94SKU18155`), comma-joined pairs. Retailer-specific, so it is a
warning that fill overstates usable barcodes, not a multiplier to apply blind.

---

### 63. The one counter that closes the import arithmetic is computed and never persisted

**Raised:** 12 August 2026 · **A gap in the record, not in behaviour.** Nothing is
mis-importing; the run simply cannot be reconciled afterwards.

The tier counters do not sum to the link total. Gorgeous Shop, two consecutive days:

| | Σ tiers | `would_link_to_existing_product` | unexplained |
|---|---|---|---|
| 11 Aug | 2,379 | 1,526 | **853** |
| 12 Aug | 2,299 | 1,735 | **564** |

Only two paths can consume a row between matching and linking: the shade-variant skip, which
read **0** on both days, and the multipack guard. So the guard accounts for all of it, and
the swing of **289** across a flag flip is a real behavioural change — plausibly tier 1
landing on the correct product, whose name no longer trips the mismatch test — that cannot
be confirmed.

**Why it cannot:** `skipped_multipack_mismatch` is set on the **top level** of the importer's
`result` object, while `scrape_log.details` persists only `result.counts`. The counter is
computed, returned in the HTTP response, and discarded. Same for
`multipack_name_unresolved` and `sample_skipped_multipack`.

**This is item 47's retention point in a new place.** A figure derived from a feed becomes
unauditable the instant the run ends unless it is written down at the moment of measurement
— and here it *is* measured, deliberately, with a comment saying it is "reported so a guard
that starts over- or under-firing is visible in the run output rather than silently changing
the landed row count". **It is visible in the run output and invisible everywhere the run
output is kept.**

**Fix:** move the three fields into `counts`. One line. **On the import path, so not today**
— and it needs a baseline captured first, because the day it lands is the day the
unexplained gap stops being unexplained, and that transition should be attributable.

---

### 64. The last two coalesce flags pay off on other retailers, so the baseline had to come first

**Raised:** 12 August 2026 · **Robbie's decision, made knowing the immediate reading will be
flat.** Escentual flipped 12 August; Boots after Escentual's 04:00 read.
**Baseline: `docs/coalesce-rollout-baseline.md`, captured before either flip.**

**A link total in the tens is the SUCCESS case for these two.** Recorded before the flip and
not after, because afterwards it is indistinguishable from a stage that did nothing. Both
retailers resolve **99.2% of admitted rows on tier 0**, so only ~52 and ~188 rows reach the
tier ladder at all — 12× and 44× fewer than Gorgeous Shop's 2,319.

**Their contribution is supply-side.** Barcodes are written on tier-0 *update* rows, not only
on new links, so the two flags put roughly **7,000 and 23,000 barcodes into an index that
currently holds 79,833** — where every other retailer's tier 1 reads them. Boots would
become the largest single holding in the fleet, above YesStyle's 13,690. Both sit at exactly
**zero** today.

**The mechanism is not a hypothesis; it has already been observed once.** Gorgeous Shop's
1,133 tier-1 links on 12 August were matched against barcodes Beauty Flash's 10 August flip
had put in the index. The flipped retailer supplies; someone else collects.

#### The baseline is the deliverable, and its standard deviations are the useful half

Escentual has not left **37-42** in a week (sd **1.6**); Boots has not left **148-154**
(sd **2.1**). They are the two tightest series in the fleet, so a movement of even twenty
rows would be unmissable — which is what makes "flat" a readable result rather than an
absence of one.

**Downstream, only three retailers can carry a verdict:** YesStyle (sd 4.4), Perfume Click
(18.9) and Beauty Bay (38.3). Beauty Flash, Gorgeous Shop and Stylevana are marginal.
**Debenhams (sd 1,320.9, two runs since recovery) and Niche Beauty (1,699.0, just live) are
unusable** — attributing a barcode benefit to either would be inventing a mechanism to
explain a gap their own variance already explains, which is instance 10 exactly.

**Sequencing, and the reason for it:** Escentual first because it is smaller; Boots last and
alone because it is the largest single barcode contribution available and the one whose
downstream effect is worth isolating. One flag per run, each read before the next.

---

### 65. Supplements shipped, and the record of how it got there was wrong in three places

**Raised:** 12 August 2026, on merging PR #232 · **The category is live: 93 products,
83 `supplements` / 10 `sports`, 23 of them comparable.**

#### PR 1 NEVER MERGED, AND THE SEQUENCE ON RECORD SAYS OTHERWISE

**Stated plainly because a later reader would be misled about what shipped when.** The
supplements work was scoped as "PR 1: the enum change", then "PR 2: frontend plus
backfill". **PR 1 does not exist.** Every supplements commit before #232 — #211, #218,
#220, #221, #225, #226 — is documentation or a classifier regex. No migration was ever
written.

**Its contents were not merely unmerged, they were unbuildable.** `products.subcategory`
carries a CHECK of fourteen values and neither `supplements` nor `sports` was among them,
so the backfill would have failed on the constraint. That is the good failure mode — it
would have refused rather than landed half — but it was found by reading the constraint
before the write, not by the write.

> **A PR that is planned, discussed and cited is indistinguishable in the record from one
> that shipped.** Six commits referenced the supplements programme while the only
> executable part of it had never been written. Nothing in the record marked the gap,
> because documentation and migration commits read the same from the outside.

The migration landed inside #232 in consequence, which is not where it was meant to be.

#### THE 93 CEILING IS STRUCTURAL, AND IS RECORDED SO NOBODY INVESTIGATES IT

**The v6 denylist excludes `supplements` at import time.** New supplement products are
therefore never created, and the category **cannot grow from imports**. 93 is a ceiling,
not a starting position, until the Boots path allowlist work lands.

> **A static count for a fortnight is the expected behaviour here.** Anyone who notices
> it should find this paragraph, not open an investigation. The category was launched
> thin deliberately; the ceiling is the other half of that decision and was not written
> down with it.

#### TWO CORRECTIONS THAT BEAT WHAT THEY CORRECTED

**1. The placement argument is the brands, not the products.** It was framed as "the 28
beauty-adjacent products that are the overlap". 28 is the doc's *product-type* split
(hair-skin-nails complexes), not a brand cut. Measured properly:

> **All 24 brands in the backfill keep products in a beauty category afterwards. 24 of 24.
> 701 products remain across the same names — Philip Kingsley 201, DHC 166, Solgar 63,
> Vida Glow 27, Hair Gain 25. Not one is a pure-supplement brand.**

**Supplements belongs alongside skincare because the brands do**, and that is a far harder
argument than any count of products, because it cannot be moved by reclassifying a few
rows. Six of the 24 clear the cross-category thresholds and render on the category page on
day one.

Also corrected: **Vital Proteins, named as one of the four brands justifying the category,
has zero comparable products** — 2 rows at one retailer each. The 23 featured products come
from exactly three brands: Vida Glow 15, Solgar 6, Hair Gain 2.

**2. The finder has no category facet, so item 6 of the brief described something that does
not exist.** `category_filter` is hardcoded `null` at both call sites (`lib/search.ts:137`,
`lib/finder/taxonomy.ts:78`). **The real facet is the brand page's category chips**, and
they are driven from `stats.category_breakdown` rather than a hardcoded list — **which is
why they picked supplements up with no work at all.**

> **The data-driven surface needed nothing; the seven hardcoded maps each needed an edit.**
> That contrast is the argument for the consolidation PR, and it arrived by accident.

#### AND ONE OF MINE: FOUR DOCS PRs SHIPPED INSIDE A FEATURE MERGE

`feat/supplements-frontend-and-backfill` was branched from the previous working branch
rather than from `main`, so **#232's squash merge carried #228, #229, #230 and #231 with
it.** Items 60-64 and `docs/coalesce-rollout-baseline.md` are all on `main` and nothing was
lost — verified by diffing each branch against `main` and finding only deletions — but they
landed under a commit titled "the category goes live".

**This is the same defect as the PR 1 finding, from the opposite direction.** There, work
that never shipped reads as though it did. Here, work that shipped reads as though it was
something else. Both make the log an unreliable answer to "what changed, and when".

> **Branch from `main`, not from the branch you were just on.** Cheap check before opening
> a PR: `git log --oneline main..HEAD` should list only the commits you intend to ship.

The four PRs were **closed, not merged** — merging them would have been a no-op that
reverted #232's edits to the files they share.

---

### 66. `&amp;` is not decoded inside a script block, and a sweep scoped to what you are adding finds only that

**Raised:** 12 August 2026, adding supplements to the homepage · Three findings, in
descending order of how quietly they fail.

#### THE ESCAPING TRAP: ONE PHRASE, THREE SOURCES, AND NOTHING COMPLAINS

Six categories had to be named in five prose strings on `public/index.html`. The phrase
renders identically in all five. **It cannot be written the same way in all five.**

| Context | Source | Renders |
|---|---|---|
| `<meta content="…">` — og, twitter | `bath &amp; body` | bath & body |
| **Inside `<script type="application/ld+json">`** | `bath & body` | bath & body |
| Visible body copy | `bath &amp; body` | bath & body |

**Script content is raw text. Character references are not decoded there.** Writing
`&amp;` inside the JSON-LD does not produce an ampersand — it produces the five literal
characters `&`, `a`, `m`, `p`, `;` inside the structured data Google reads.

**Every downstream check passes anyway.** The JSON still parses. The page renders. The
HTML validates. `view-source` shows exactly what a correct `&amp;` looks like everywhere
else on the page, so it reads right. **The only signal is in the parsed value, and only
if something parses it.**

> **Verified by parsing, not by eye.** The check loads every `application/ld+json` block,
> `json.loads` it, and asserts `'&amp;' not in description`. Reading the file cannot catch
> this, because the wrong version and the right version look identical in source — the
> difference is which context the source sits in, not what it says.

**The general form, and it is not about ampersands.** `<script>` and `<style>` are raw
text elements; everywhere else in HTML is not. **Any content templated into both — a
brand name with an `&`, a product name with a `<`, an apostrophe — needs different
escaping in each, and the wrong choice is invisible in the source and silent at runtime.**
The catalogue is full of names containing `&`. This will recur the moment JSON-LD carries
a product or brand name, which it already does on `/product/[id]`.

#### BATH & BODY IS THE BETTER HALF OF THE SWEEP

**7,808 live products, present in the two nav blocks and nowhere else.** No homepage card.
No mention in the `og:description`, the `twitter:description`, the JSON-LD or the roadmap
intro. The section headed *"Now live across beauty"* claimed four categories while six
were live.

**Two earlier sweeps missed it.** The 3 August sweep found the same savings claim in nine
places under four wordings and rewrote all nine; it was looking for a figure. This one
found Bath & Body **only because supplements needed adding to the same lists.**

> **A sweep scoped to the thing you are adding finds only that.** Both prior passes were
> scoped correctly for their own question and both were blind to a category that had been
> missing the whole time. Nothing was looking for *absence*, because absence has no
> keyword to grep for.

**This is why the full sweep was the right scope.** Adding supplements alone would have
put a 93-product category on the homepage while a 7,808-product one stayed off it — and
the page would have gone from understating by two categories to understating by one,
which reads as correct.

**Practical form:** when adding an item to an enumerated list, **check the list against
its source of truth, not against the item being added.** Here the source of truth is
`ALL_CATEGORIES`; a diff of the rendered list against it would have surfaced Bath & Body
on either earlier pass, in seconds.

#### THE FOURTH ORDERING WAS THE ONE A VISITOR SEES

Three orderings of the same four category names were known and being fixed — the
og/twitter/JSON-LD form, the roadmap intro's, and the "how it works" step's. **The card
grid was a fourth**, running `skincare, hair, makeup, fragrance`, and it is the only one
of the four a visitor actually reads.

It was not counted because the sweep enumerated *prose strings*, and the grid is markup.

> **Four separately-maintained lists produce four orderings.** Not through carelessness —
> each was correct when written, and nothing exists that could have disagreed with any of
> them. All are now the order `ALL_CATEGORIES` already defined, which is also the nav
> order; PR #234's guard covers the copies in code, and this file covers the ones in
> `public/index.html`, which is static and outside its reach.

**`public/index.html` is not guarded and cannot be by that test.** It is a static file
with no import of `lib/queries`, so its six category names are a seventh copy in a
different sense: not duplicated logic, but duplicated *content*. A future category will
need it edited by hand again. That is a known, accepted cost and is recorded so the next
person looks there.

---

### 67. 102 brand pages were missing from the sitemap, and nothing could have told us

**Raised:** 12 August 2026 · Production was red for roughly an hour — stale rather than
broken, the previous deploy kept serving — and fixed by redeploying the identical commit
alone. **The outage is the least valuable thing in this item.**

#### 1. THE FINDING: A SUCCESSFUL SITEMAP THAT WAS QUIETLY INCOMPLETE

`/sitemap-pages.xml` collected brand slugs by paging `products_active` with `.range()`
**and no `ORDER BY`**. Postgres guarantees no stable row order across separate queries, so
OFFSET paging over an unordered result **skips rows** — not an edge case, the documented
consequence.

Rendered old and new side by side against the live catalogue:

| | brand URLs |
|---|---|
| old | **2,252** |
| new | **2,354** |

**A strict superset. Nothing dropped, 102 added.** `akt-london`, `bdk-parfums`,
`authentic-beauty-concept`, `aevi`, `affinessence` and 97 others all return **HTTP 200**
and had never appeared in the sitemap. **4.3% of brand pages, absent, for as long as the
loop has existed.**

##### Why nothing reported it, and nothing could have

> **A sitemap missing entries is indistinguishable from a complete one.** It is valid XML.
> It returns 200. It has the right shape, a plausible size, and thousands of correct URLs
> in it. **There is no error, no warning, and no count to compare against** — the only
> symptom is pages Google never learns about, which shows up as traffic that was never
> there rather than traffic that fell.

**It was found because a performance problem forced someone to read the code.** Nothing
surfaced it, nothing could have surfaced it, and had the build not started timing out it
would still be missing 102 pages — more each time the catalogue grew, since the skip rate
scales with the number of pages.

##### It belongs to a family, and that is the point

**Items 48, 51, 54, 56 and 60 are the same shape: a well-formed, successful output that is
quietly incomplete.**

| Item | The output that looked fine |
|---|---|
| 48 | `feed-diag`'s overlap buckets read **zero** on any differently-named feed — a clean table of noes |
| 51 | The same feed is two different feeds depending on which path fetched it |
| 54 | A threshold derived from a log line rather than the artefact |
| 56 | A report that cannot see its population returns a clean table of noes |
| 60 | A pipeline written for one identifier per ASIN matches nothing, and **reads as a coverage gap rather than a design error** |
| **67** | **A valid sitemap, 200, thousands of correct URLs, 102 missing** |

**None of these fails. Every one succeeds and under-reports**, and in every case the wrong
output is indistinguishable from the right one without an independent count. That is now
six instances, which makes it the most common defect class on this list.

> **The shared remedy is the only one that works: compare the output against a count
> derived independently.** Not against itself, not against last time. #237's guard does
> exactly that — the migration asserts the array length equals the distinct count, and the
> route throws rather than emitting a brandless sitemap.

**Resubmit the sitemap in Search Console** so the 102 are crawled rather than waiting for
a natural recrawl.

#### 2. THE SPACING RULE WAS RIGHT FOR A REASON NOBODY HAD

`docs/` and the standing note both say **space unrelated deploys apart even when they
cannot collide**, and the stated justification was attribution: if two changes ship
together and something moves, you cannot tell which did it. **That justification was too
weak, and the rule is load-bearing for a reason nobody had written down.**

#232, #233, #234 and #235 were merged within about six seconds. Three production builds
started at once, contended on one Postgres, and all three died on
`/sitemap-pages.xml` after three 60-second attempts.

**The control is exact:**

| Commit | Build | Result |
|---|---|---|
| `47f3fba` — #235 branch head | preview, 09:21 | **READY in 1 min** |
| `968c0a0` — the same tree squashed onto main | **production, 09:24** | **ERROR** |

```
git diff 47f3fbaa 968c0a00  →  empty
```

**Byte-identical trees, three minutes apart, green then red.** Then the same commit was
redeployed alone and went green in 2 minutes and aliased to production. Nothing was
changed to fix it.

> **A rule kept for a weak reason still has to be kept.** "It buys attribution, not
> safety" was the recorded justification and it was wrong on the second half. Concurrency
> was not a reporting inconvenience; it was the failure. **Where a rule's stated reason is
> weaker than the rule, the reason is what is wrong, not the rule.**

#### 3. MERGING IS WHAT FIRES BUILDS, AND THEY DO NOT QUEUE

The rule said *deploys*. Nothing here was deployed by hand. **Merging N pull requests
triggers N production builds, and Vercel runs them concurrently rather than queueing
them** — each one a full static generation issuing its own hundreds of queries against
the same database.

> **RESTATED: space MERGES, not just deploys.** Merge one, wait for the build to go
> green, then merge the next. The gap is not politeness — concurrent builds are
> concurrent load, and the last one to start is not the one that fails.

**Nothing warns you.** GitHub merges instantly, four times in a row, and every merge looks
successful; the failures surface minutes later in a different system. **The action and the
consequence are in different tools, which is why the rule has to be a habit rather than a
check.**

#### 4. THE SEVEN-PAGE LIST WAS COLLATERAL, NOT A SYMPTOM

The build named seven failing pages: `sitemap-pages.xml`, `makeup`, `skincare`,
`supplements`, `edit/k-beauty`, `account`, `search`. **Only three of six category pages,
which invites the question "what do those three share?" — and there is no answer, because
the premise is wrong.**

```
⚠ Sending SIGTERM signal to static worker due to timeout of 60 seconds.
  Subsequent errors may be a result of the worker exiting.
```

Next generated **9 of 19** pages, one worker breached 60 seconds, and the pool was killed.
**The seven are simply the pages in flight at that moment.** `hair`, `fragrance` and
`bath-and-body` were among the nine already finished. Only `/sitemap-pages.xml` was slow —
it is the one Next names in the fatal error after three attempts.

> **Reading that list as a symptom would have sent someone looking for what `/account`,
> `/search` and three of six category pages have in common. Nothing. The list is a
> snapshot of a worker pool, not a set of suspects.** Next says so itself, in the line
> immediately above the list, and that line is easy to skip.

#### The measurement that says it needed fixing regardless

**The build had already gone from 1 minute to 2.** Green, inside the cap, and no longer
comfortably — on a curve that only grows with the catalogue. If 12 August was contention,
it fails on its own within weeks; if it was the query, it failed today. Either way the
answer is the same, which is why the fix went ahead without waiting to find out.

**The performance problem was the symptom, not the defect.** It is recorded last
deliberately: 98 requests and 26 seconds is what made someone open the file, and section 1
is what was in it. Had the build stayed inside the cap, nothing would have been fixed and
nothing would have been wrong — visibly.

---


---

### 68. Two navs, three differences, none of them detectable from either side

**Raised:** 12 August 2026, on finding Supplements missing from the homepage nav ·
**The third time this shape has appeared on this page**, and the first time it was
counted as a pattern rather than a one-off.

The site has two independently maintained navigations: the static blocks in
`public/index.html` (desktop and mobile, themselves two copies) and `NAV_LINKS` in
`components/SiteNav.tsx`, which renders on every React route. They had **drifted in three
separate ways**:

| | index.html | SiteNav.tsx |
|---|---|---|
| **Supplements** | **absent** | present since #232 |
| **Find** (`/finder`) | **absent from both blocks** | present, "a core feature" |
| Build a routine | `/app` — **200** | `/app.html` — **308 hop** |

#### WHY NONE OF THEM WAS DETECTABLE

> **Each nav is internally consistent.** Open either one and it reads as a complete,
> deliberate list. There is no position from which the two can be compared except
> deliberately putting them side by side, which nobody does, because neither looks wrong.

**Nothing fails.** Every link in both navs resolves. No build breaks, no test fails, no
page 404s. Supplements was live on its route, in the sitemap, on the homepage cards, and
in the React nav — **and a homepage visitor still had no way to click it.** The one
surface with no link was the one surface that matters most, and every other signal said
the category had shipped.

#### THE FAMILY, AND WHY THIS IS THE THIRD INSTANCE

| Where | Copies | Found by |
|---|---|---|
| Category **orderings** (item 66) | **four** — og/twitter/JSON-LD, roadmap intro, how-it-works step, and the card grid | adding a sixth category |
| Category **label maps** (item 65, #234) | **seven** — two in `lib/queries`, three duplicates, the sitemap array, the importer's `catRoutes` | adding a sixth category |
| **Navs** (this item) | **three** — two static blocks, one React | adding a sixth category |

**All three were found by the same act, and none by a check.** Adding a category is
currently the only instrument this codebase has for detecting its own duplicated content,
which means the drift is discovered at the worst possible time — during a launch, when
attribution is hardest.

**#234's guard covers the label maps in code and cannot reach these**, for the reason
already recorded in item 66: `public/index.html` is a static file with no import of
`lib/queries`, so its category names are duplicated *content* rather than duplicated
*logic*. **A nav is the same.** A test comparing `NAV_LINKS` against the HTML would have to
parse the HTML — which is exactly what caught this, by hand, once.

> **The cheap version is worth doing: parse both nav blocks out of `public/index.html`,
> compare the href set against `NAV_LINKS`, and fail on a difference.** It is the same
> instrument as the `catRoutes` assertion in `lib/__tests__/category-labels.test.ts` —
> read the un-importable copy as text and assert it agrees. Not written here, because this
> item is the record and that is a change.

#### THE FINDER GAP IS ITS OWN PR, AND IT IS NOT "EVENTUALLY"

**`/finder` returns 200 and has no link on the homepage in either block.** `SiteNav.tsx`'s
own comment calls it *"A core feature, so it sits at normal weight just before the search
icon"* — a claim that is true on every React route and false on the page most visitors
arrive at. **Homepage visitors have no route to it at all.**

That is a live gap in a shipped feature, not a tidy-up, and it should be a nav-only PR
soon rather than being carried.

#### THE `/app.html` HOP IS RECORDED, NOT SCHEDULED

"Build a routine" points at `/app` from the static nav and `/app.html` from the React one.
Both work; `/app` is a **200** and `/app.html` a **308** redirect, so every click from a
React route takes an extra hop. **Smaller than the other two, no user-visible failure, and
recorded here so it is not rediscovered as though it were new.** It does not need
scheduling.

---

### 69. Migrate the homepage off static HTML — a class fix, not a tidy-up

**Raised:** 12 August 2026 · **Sequenced behind Boots supplements**, which has a
commercial dependency this does not. **Not started. Scope the demo generator and the
build cost before anything begins.**

`public/index.html` is a hand-maintained static file. Every duplicated-content defect
found in the last ten days lives on it, and the fix already exists in code that the file
cannot reach.

#### RESOLVE THIS FIRST: the file is both source and build output

**`scripts/generate-homepage-demo.mjs` rewrites `public/index.html` in place at build
time, and the rewritten file is what is committed.** The block between
`<!-- FMB:DEMO:START -->` and `<!-- FMB:DEMO:END -->` has carried a **generated fallback**
on `main` since #177 on 3 August. The checked-in state of the homepage therefore depends
on what a build last wrote into it.

> **This is the finding most likely to bite a migration, and it bites silently.** Anyone
> migrating opens `public/index.html`, reads it as source — because it looks exactly like
> source — and ports what they see. What they see includes a **stale generated demo**, and
> it would be baked into a component as static markup. The result renders, passes review,
> and quietly reintroduces the hand-written point-in-time block that #177 existed to
> remove. `generate-homepage-demo.mjs`'s own header calls that block *"hand-written,
> point-in-time and refreshed by nothing"*.

**It is worse than a stale demo.** The generator's header records why: these baskets turn
on a leg sitting a few pounds either side of a delivery threshold, so a frozen one
displays a "best" basket that **is no longer best**. *"Stale is survivable; wrong is not."*

**So the first task is not the migration. It is separating source from output** — the
generator writing somewhere other than its own input, so there is a file that is
unambiguously source. Until that is true, every later step is being read off an artefact.
This is cheap to do now and expensive to discover halfway through.

---

#### The evidence is accumulated, not speculative

| | The stale list | Found by |
|---|---|---|
| **Two navs, three divergences** (item 68) | Supplements absent, `/finder` absent, `/app` vs `/app.html` — **none detectable from either side, because both were internally consistent** | adding a category |
| **Four category orderings** (item 66) | og/twitter/JSON-LD, roadmap intro, how-it-works step, and the card grid — **the fourth being the one visitors actually see** | adding a category |
| **Seven duplicated label maps** (item 65, #234) | two in `lib/queries`, three component copies, the sitemap array, the importer's `catRoutes` | adding a category |
| **Bath & Body absent** (item 66) | missing from a section headed *"Now live across beauty"* while carrying **7,808 products** — **missed by two prior sweeps** | adding a category |
| **The same claim in nine places under four wordings** | the 3 August savings-figure sweep | a figure that was never true |
| **Supplements needed edits in eleven places** | on that one page | adding a category |

**Every one was a hand-maintained list going stale. Every one was found by accident rather
than reported.** Not one was caught by a test, a build failure, a 404 or a warning —
because none of them fails. A stale list renders perfectly.

> **The frequency rises with each new category, because each one multiplies the surfaces.**
> Six categories across eleven places is what made supplements expensive. A seventh is
> worse, and the cost is paid during a launch, when attribution is hardest.

#### The fix already exists, and the file cannot reach it

`ALL_CATEGORIES`, `categoryDisplay()` and `SiteNav.tsx` are canonical, correct, and
guarded by `lib/__tests__/category-labels.test.ts`. **A Next homepage consumes them and
the divergence class disappears rather than being swept for.** No new abstraction is
needed; the abstraction is written and shipped. `public/index.html` is simply outside it —
a static file with no import, so its copies are duplicated *content* rather than
duplicated *logic*, which is why #234's guard cannot reach it and why item 68 proposed
parsing the HTML as a stopgap.

**That stopgap becomes unnecessary if this lands**, which is the argument for doing this
instead of building more parsers.

#### CONSTRAINT 1: the demo generator moves, it does not disappear

`scripts/generate-homepage-demo.mjs` (410 lines) is **the only part of that page with real
logic in it.** It runs as a prebuild step, re-solves candidate baskets against live prices,
and rewrites `public/index.html` in place between `<!-- FMB:DEMO:START -->` and `END`.

Three properties that must survive, and are easy to lose:

- **It re-solves rather than hardcoding**, deliberately. Its header records two candidates
  that looked ideal by hand and demonstrated nothing when re-solved — *"you cannot tell by
  looking. Re-solve, always."* A migration that snapshots its output reintroduces exactly
  the defect it was built to remove.
- **Its fallback writes copy without figures and shouts on stderr.** It never renders a
  basket it cannot stand behind. That behaviour is load-bearing, not defensive.
- **Its output must stop being its input**, per the section above — the generator should
  emit *data* the page imports, not *HTML* it rewrites. That is what makes the rest of this
  safe, which is why it is listed first rather than here.

**Scope this before anything starts.** The likely shape is that it keeps running as a
prebuild step and emits JSON the page imports, rather than becoming a query inside the
page — which also keeps it outside the per-page timeout. That is a proposal, not a
decision.

#### CONSTRAINT 2: it joins the static pool that failed this morning

**Today `public/index.html` costs the static generation pool nothing.** It is copied as an
asset. The generator runs once, before `next build`, outside the 60-second per-page cap.

A Next homepage is **the 20th page in a pool that failed at 19 this morning** (item 67),
and it is the most-visited page on the site. The generator takes ~1 second today; that is
cheap, but it is cheap *outside* the cap, and moving the solve inside a page render puts it
under a limit it has never been subject to.

> **Establish the build-time cost before adding to that pool.** The measurement that
> matters is not the homepage's own render time but the pool's total, which is what
> actually breached. Item 67's build had already drifted from 1 minute to 2 before
> anything was added.

**This is a cost to price, not a caveat to note.** The migration does not move a page from
one renderer to another at zero cost: it takes a page that is currently free and makes it
the twentieth member of a pool with a demonstrated failure at nineteen. That may well be
worth paying — but it has a number, and the number should exist before the work starts.

**Neither constraint blocks the work.** Both are unknowns that must be priced first, and
recording them now is cheaper than discovering them during the migration.

---


---

### 70. The inversion of the quietly-incomplete family, and the harder half to catch

**Raised:** 12 August 2026, during Boots supplements discovery · **`feed-diag` section 6.**

> **Items 48, 51, 54, 56, 60 and 67 produce a clean result that is wrong. This produces an
> alarming result that is meaningless. Both end at a signal nobody can act on.**

**The second is harder to catch, and the reason is uncomfortable: the correct response to a
95% distrust flag IS to discard the analysis.** Doing the right thing with the signal is
what loses the finding. In the quietly-incomplete family the reader is deceived by a clean
output; here the reader is behaving correctly and the instrument is wrong. **It nearly
worked** — see the near-miss below.

#### What the flag actually measures

`feed-diag` flags names it believes the feed truncated, because truncation is the
classifier's one known failure mode: the application word exists and the feed cut it off.
On the Boots `Fitness & Nutrition` branch it flagged **1,719 of 1,808 rows — 95.1%**.

**Almost none of them are truncated.** Its regex is
`/(\s\S{1,3}|[a-z])$|\.\.\.$|…$|\s&$|\swith$/`, and the **`[a-z]$` alternative fires on any
name ending in a lowercase letter.**

| | rows | share |
|---|---|---|
| Flagged by the tool | 1,719 | **95.1%** |
| Flagged **only** for ending in a lowercase letter | 1,161 | 64.2% |
| Trailing short token that is a **size suffix** — `60g`, `60S`, `x3` | 436 | 24.1% |
| **Genuinely cut off** | **127** | **7.0%** |

*"Seven Seas Evening Primrose Oil + Starflower 1000Mg 30 Capsules"* is flagged and is
complete. Genuine truncation looks like *"…Multivitamin Gummies For Adults, O"*.

#### IT DOES NOT FAIL. IT TRAINS DISMISSAL.

> **A guard that fires on 95% of rows is not a guard, it is background noise.** It never
> reports an error, never breaks a build and is never wrong in a way anyone can point at —
> it simply stops being read. **The failure mode is in the reader, not the tool**, which is
> why nothing catches it and why it can sit for months looking like diligence.

**It nearly cost a real finding.** The 45.4% disagreement between the name rule and Boots'
own taxonomy — the entire evidential basis for path-first classification — arrived stamped
*"names that LOOK TRUNCATED: 1,624 … review, do not trust"*. **The correct response to a
95% distrust flag is to discard the analysis**, and that was very nearly the outcome.

**It survived only because the flag was tested rather than believed:**

| | n | name rule disagrees with Boots' path |
|---|---|---|
| Genuinely truncated | 127 | **48.0%** |
| Clean names | 1,681 | **45.2%** |

**The rate is the same in both populations**, so truncation is not what produces it. The
finding stands on 1,681 clean names.

#### THE GENERAL FORM, ADDED 13 AUGUST: A LOUD FAILURE INTO A DEAF PIPELINE

> **A script that fails loudly into a pipeline that does not read its exit status is a
> script that fails silently.**

**Two instances landed on 13 August, in different tools, and the second after the first was
already understood.** That is the argument for a class rather than two mistakes.

| | Tool | What it did | What the caller concluded |
|---|---|---|---|
| 1 | YesStyle run-poll | received `{"code":"42501","message":"permission denied for table scrape_log"}` and tested `!= "[]"` | **"YesStyle ran"** |
| 2 | Work-list conflict resolver | raised `IndexError` mid-resolution, refused to continue | **rebase, push, PR CLEAN, merge — all "fine"** |

**THE SECOND IS WORSE, AND IT IS WORSE FOR AN UNCOMFORTABLE REASON: THE SCRIPT DID
EVERYTHING RIGHT.** It detected an input it could not handle. It raised. It stopped. It
refused to write a resolution it could not compute. **There is no improvement available to
that script.** The failure was entirely in the four layers above, each of which inferred
success from the absence of an exception **it never checked for** — the file had been staged
before the throw, so `git rebase --continue` had nothing to object to, and everything after
it agreed in turn.

> **This is not "handle errors better". The error WAS handled, by the only component in a
> position to detect it.** The defect is that raising is only a signal if something reads
> it, and four consecutive tools read only the side-effects.

**It belongs in this item rather than its own** because it is the same inversion: item 70's
subject is an instrument that fires wrongly and trains dismissal; this is an instrument that
fires correctly into something that cannot hear it. **Both end where the family ends — a
signal nobody acts on** — and neither produces a failure anyone can point at afterwards.

##### THE MISSING HALF OF ITEM 67'S SEQUENTIAL-MERGE RULE

Item 67 established: **merge one at a time.** That rule was followed exactly on 13 August
and the marker still reached `main`, because the rule stops at the merge.

> **MERGE ONE AT A TIME *AND* VERIFY THE RESULT BEFORE THE NEXT.** Sequencing buys
> attribution; it does not buy correctness. Four signals agreed the merge was good —
> `rebase --continue`, the push, the PR going CLEAN, the merge itself — **and all four were
> downstream of the one thing that had failed.** Agreement among downstream signals is not
> corroboration.

The verification is cheap and specific: **grep the merged file for conflict markers.** One
line, at the point of resolution rather than three merges later. It was caught only because
a crashed script prompted someone to look at what it had produced.

#### The fix

**Fix:** drop the `[a-z]$` alternative, and exempt a trailing size/count token
(`\d+\s*(g|ml|mg|kg|s|caps?)`, `\d+S`, `x\d+`). That takes the flag from 95.1% to about
7%, which is a number a reader can act on. **Read-only diagnostic, not the import path**, so
it is not blocked by anything — but it is not urgent either, and it must not be bundled
with the Boots change, whose evidence it was used to assess.

---

### 71. Retailer-conditional classification does not exist, and it is the real work

**Raised:** 12 August 2026 · **Blocks item 72. Design item — scope before writing.**

Boots supplements needs the topical veto to behave differently on a health path than on a
beauty one. **That capability does not exist anywhere in the codebase today**, and it is
larger than the path allowlist and the regex edit combined.

#### Why the veto cannot simply be relaxed

Path-first alone is not sufficient, and this inverts the original brief. **Boots' own
`Vitamins & Supplements` path contains topicals:** *Anua Niacinamide TXA Brightening Toner
250ml*, *Numbuzin No.5+ Glutathione Concentrated Toner 200ml*, *Olay Vitamin C Moisture
Fluid*, *BetterYou Magnesium Muscle **Body Spray** 100ml*, *CBD Brothers Oil 5000mg*. **The
veto must still fire, or the category imports toners as supplements.**

#### CORRECTION: the premise this item was raised on was false

**It was raised believing `capsuleIsTopical` misfires on *Boots Vegan Omega 3 Oil 1000 Mg,
60 Capsules*. It does not.** `oil` is absent from its co-occurrence list. That verdict came
from `feed-diag`'s `APPLY` regex, which does contain `oil`, and was read as the
classifier's — see item 47, instance 12.

Run against the shipped code, both Omega 3 and *Seven Seas Evening Primrose Oil … 30
Capsules* return **`skincare`**: not topical, not excluded, just unclaimed by anything and
caught by the catchall.

**The item survives the correction, with a different justification.** `oil`, `gel` and
`pack` are still dosage forms in a health catalogue and application words in a beauty one —
item 57, 10 August, *the rule is fitted to the catalogue, not to the concept* — and the
narrow topical list the supplements branch needs must still leave them out. What changed is
that this is a list to **write**, not a list to **condition**: nothing in `capsuleIsTopical`
needs touching, which is why the branch sits above `inferCategorisation` rather than inside
it.

#### The shape, and its interaction with #226

- **`oil`, `gel` and `pack` leave the application list on a health path only.**
- **`capsuleIsTopical` must not fire on a health path at all.** Its purpose is Elizabeth
  Arden ceramide capsules in *skincare*; on `Vitamins & Supplements` a capsule is the dose
  form, always.
- **`serum`, `toner`, `cream`, `spray`, `mask`, `shampoo` keep full strength everywhere** —
  they are what catch the toners above.

> **This is a GUARD CONDITION, not an edit to #226.** #226 stays exactly as written for
> every other retailer. That preserves its "fix one, not both" scoping, which was the whole
> point of how it was written — and a guard is reversible in a way a regex edit is not.

**The unknown to scope:** what "a health path" means as a signal — the retailer id, the
admitted path prefix, or a flag on `retailer_import_config` — and whether the classifier
can see it at the point the veto runs. **That is the design question, and it is the reason
this is an item rather than a paragraph inside item 72.**

---

### 72. Boots supplements, re-scoped: the 1,425 is the problem, not the 315

**Raised:** 12 August 2026 · **Re-scoped the same day** once the shipped classifier was run
instead of `feed-diag`'s copy of it. **Discovered and proposed. NOT applied.**

#### THE REAL PROBLEM IS THE 1,425

`inferCategorisationForImport` run over all **1,808** rows of Boots'
`Health & Beauty > Health Care > Fitness & Nutrition` branch, as the importer would see
them, with no change to anything:

| Verdict today | rows | |
|---|---|---|
| **`skincare`** | **1,425** | **78.8%** |
| `EXCLUDED: supplement` | 315 | 17.4% |
| hair · bath_body · makeup | 47 | 2.6% |
| other exclusions | 21 | 1.2% |
| **`supplements`** | **0** | — |

> **Open the path today and 1,425 rows of protein powder, glucosamine and multivitamins
> land on the skincare page.** That is **fifteen times** the 315 the denylist drops, and
> **nobody was looking at it, because the brief was about the drop.**

**Nothing assigns `supplements` at all.** The gap was never a veto firing wrongly; it is
that everything not claimed by a denylist falls through the `skincare` catchall. The
original framing — *path admits, topical veto rejects* — does not map onto the code, which
has a **denylist that drops** and a **protective exemption that prevents dropping**.

The 315 is still real and still has to be fixed. It is simply the smaller half, and it now
costs nothing extra to fix (below).

#### `EXCLUDE_PATTERNS` NEEDS NO EDIT — AND THAT CHANGES THE SEQUENCING

The supplements branch resolves the row **before the denylist verdict is consulted**, so
for rows on a Boots supplements path the `supplement` entry in `excludeChecks` never
applies. **The 315 drops stop without a regex every other retailer reads being touched.**

*(Naming: `EXCLUDE_PATTERNS` is what the docs and `feed-diag` call it; the shipped
identifier is `excludeChecks` in `categorisation.ts`. Two names for one list — item 65's
finding, in a place nobody had looked.)*

**So this is ONE shared-module deploy, not two, and the deploy is INERT.** With
`supplements_path_prefixes` defaulting to `{}`, no retailer has a supplements path and the
new branch is unreachable. Behaviour is unchanged everywhere, by construction.

> **That separates the deploy from the activation, and it changes the sequencing.** The
> deploy provably alters nothing, so it does **not** need to follow Boots' coalesce flip.
> The **config flip** — writing the path prefix into `retailer_import_config` — is the
> change that carries risk, and that is what must follow the coalesce read with its own
> baseline.
>
> **Deploy inert → confirm a clean import cycle with no movement → then flip config.** Two
> steps with a checkpoint between, rather than one atomic change whose blast radius is
> everything.

**This only holds if the inertness is measured rather than claimed.** See the regression
test below; without it, "inert" is an assertion and the old sequencing stands.

#### The design (item 71, approved)

| | |
|---|---|
| **Signal** | `retailer_import_config.supplements_path_prefixes text[] DEFAULT '{}'`, beside `category_path_must_contain`. Config, not a code constant — the allowlist already lives there and changes without a deploy |
| **Access** | `categoryPath` is declared at `import-awin-feed/index.ts:1894`; the call is at **2193**; **net brace delta 0** — same block, same iteration. `retailerId` is function-scope. **Zero plumbing** |
| **Branch** | Early return in `inferCategorisationForImport`, above the shared logic |
| **Topical list** | `serum\|toner\|cream\|lotion\|mask\|shampoo\|conditioner\|moistur\|body spray` — **deliberately without `oil`, `gel`, `pack`** (item 57) |
| **Subcategory** | Brand allowlist → `sports`, else `supplements` |

**`inferCategorisation` IS NOT TOUCHED, so #226 is literally unmodified rather than
guarded.** That is stronger than the guard that was asked for, and it is the reason to
branch **above** the shared function rather than inside it: there is no condition wrapped
around `capsuleIsTopical` to reason about, no regex to restore, and no way for the change
to reach any other retailer's classification. Reverting is deleting a branch.

`capsuleIsTopical` needs no change at all — it does not fire on these rows.

#### THE REGRESSION TEST IS PART OF THE CHANGE, NOT A LATER STEP

**It is what makes "byte-identical for four callers" a measurement rather than a claim**,
and the inert-deploy sequencing above depends entirely on it.

- **Fixture:** `supabase/functions/_shared/__fixtures__/categorisation-corpus.json`,
  following the `multipack-guard-fixture.json` pattern — a `_note` recording provenance and
  build date, then a stratified sample of live `products_active` names and brands, **at
  least 2,000 rows spanning all six categories**, plus **every one of the 1,808 Boots
  Fitness & Nutrition names**, which are the rows the change is aimed at and therefore the
  ones most likely to move.
- **Assertion:** for every fixture row, `inferCategorisationForImport(name, brand)` — the
  **two-argument form** — returns exactly what it returns today: `top_category`,
  `subcategory`, `product_type`, `excluded` and `tags` compared field by field. The golden
  values are generated once against `main` before the branch is written and committed with
  the fixture.
- **What it proves:** the four callers — the AWIN, Shopify and Rakuten importers and the
  two harness scripts — are unaffected, because they all use the two-argument form and the
  new parameter defaults to absent. **A single moved row fails the suite.**
- **Second assertion, the other direction:** with the supplements path supplied, the Boots
  rows move to `supplements`/`sports` and the named topicals — *Anua Niacinamide Toner*,
  *Olay Vitamin C Moisture Fluid* — **do not**. Otherwise the test only proves the change
  does nothing.
- **Hermetic:** the fixture is committed, so it runs in `npm test` without credentials,
  like every other test in `lib/__tests__/`.

#### What still stands from the original scope

**Path allowlist:** admit `…Fitness & Nutrition > Vitamins & Supplements`. **NOT
`Medicine & Drugs`** — the 113 supplement-shaped rows inside it remain an accepted loss.

**Sports split by brand allowlist**, justified by the data rather than the reasoning:
**`\bprotein\b` does not match "Myprotein"** — no word boundary inside the brand name — so
any name-based sports rule silently misses the largest sports brand in the feed **because
of its own name.** Structural, not a coverage gap.

List at the ≥70%-sports-shaped break: Optimum Nutrition · Grenade · Revival · Liquid IV ·
C4 · Misfits · Humantra · YOURLVLS · Sci-Mx · Fulfil · Nicks · Barebells · ORS · Eleat ·
Warrior · Nuzest · Vidrate · **MyProtein** (the stated exception: 19 of 37 by name signal,
but all 37 are MyProtein).

**`bath_body` should not move at all** — no `Personal Care` rows arrive. A prediction to
check, not a risk to price.

#### Baselines, 12 August, taken before

| | |
|---|---|
| supplements | **93** (83 + 10) · bath_body **7,812** · products_active **97,677** |
| brands | **2,400** · comparable at 2+ **12,379** · Boots rows 36,051 |

**Baseline A must be retaken** after the current cycle; these are category-side only.

---

### 73. Copying held. Reimplementation is what failed.

**Raised:** 12 August 2026, after the 45.4% figure turned out to describe a document rather
than the shipped code (item 47, instance 12) · **Survey of 20 scripts. Report only, nothing
fixed.**

#### THE COUNTERINTUITIVE FINDING, AND IT INVERTS EVERYONE'S INSTINCT

**Duplication was assumed to be the defect. It is not.** This list has spent a fortnight on
duplicated content — four category orderings, seven label maps, three navs — so the natural
conclusion was that the copied regexes in the diagnostics were the same disease.

**Measured against the shipped code today, copying held at 13 of 15.**

| Copy | Against shipped | Result |
|---|---|---|
| `feed-diag`'s `EXCLUDE_SUPP` | supplement denylist | **byte-identical**, apart from an `/i` flag that is a no-op because the caller lowercases first |
| `annotate-excluded`'s `RE` record | 14 of 15 denylist buckets | **12 identical**, 2 diverged (`intimate_health`, `apparel`), 1 bucket never copied |

**Both copies declare themselves.** `annotate-excluded.mts`: *"the regexes below are copied
verbatim from `_shared/categorisation.ts` Step 1"*. `feed-diag` line 333: *"The live shared
constant, copied verbatim"*.

> **A "copied verbatim" comment is a weak control, and it mostly worked.** It survives
> months, it is honest about what it is, and a reader knows to check. It is not a good
> control — 2 of 15 drifted with nothing reporting it — but it is **not what produced the
> failure this week.**

**What produced the failure was reimplementation from a document.** `feed-diag`'s
`FORM`/`BOUND`/`TOPICAL`/`APPLY` regexes implement
`docs/supplements-definition.md`, not `categorisation.ts`. They produced the **45.4%
disagreement rate** that was quoted as evidence about the classifier, inverted a design
brief, and survived two turns of reporting before the shipped function was simply run.

#### THE CONTROLLED EXPERIMENT IS INSIDE ONE FILE

Both postures sit in `atelier-feed-diag.mts`, and produced opposite outcomes in the same
week on the same feed:

| | Source | Figure | Verdict |
|---|---|---|---|
| `EXCLUDE_SUPP` | **copied from shipped** | 274 dropped, 29.3% | **correct — survived every check** |
| `FORM`/`TOPICAL`/`APPLY` | **reimplemented from the doc** | 45.4% disagreement | **misleading as quoted** |

**Same file. Same author. Same afternoon. One number right, one number wrong, and the
difference is whether the rule was copied or rewritten.**

#### THE SHARPEST FINDING: THREE COPIES IN ONE FILE, AND THEY DISAGREE

The reimplementation is not one rule used three times. **It is three rules**, at lines 275,
335 and 383:

| | line 275 | line 335 | line 383 |
|---|---|---|---|
| `FORM` | 11 tokens | 11 tokens | **20** — adds `bcaa`, `creatine`, `electrolyte`, `mass gainer`, `pre-workout`; pluralises `capsules?` |
| `TOPICAL`/`APPLY` | 38 tokens | **6** | **43** — adds `cleansing`, `foam`, `spf`, `sunscreen`, **`pack`** |
| `BOUND` | bidirectional | one direction only | — |

The middle copy is missing `balm`, `butter`, `candle`, `cleanser`, `conditioner`,
`concealer`, `ampoule`, `booster`.

> **Sections 4, 5 and 6 of one diagnostic answer one question three different ways, and
> nothing in the output says so.** A reader comparing "supplements in this path" across
> sections is comparing three rules and cannot tell.

**No cross-file sweep would ever have found this.** Every previous instance of the shape —
four orderings (item 66), seven label maps (item 65), three navs (item 68) — was found by
**adding a category**, which forces every copy to be visited. **These three copies are in
one file, so adding a category touches them together or not at all.** This one was found
only because a figure it produced turned out to describe the wrong thing.

**Fourth instance of the shape, and the first with a different discovery mechanism.**

#### CORRECTION, PLAINLY: `feed-diag` DOES NOT IMPORT `_shared/categorisation`

**It was reported that `feed-diag` "already imports it and reimplemented anyway".** That
was wrong — the grep matched a comment. Its only shared import is `match-key`.

**The real situation is simpler and worse.** Simpler, because there is no puzzle about why
a file with the import available still wrote its own rule; it never had the import.
Worse, because the fix is not "use what you already pull in" but "start importing at all",
and because nothing in the file suggests the shipped rule was ever consulted.

#### THE SEQUENCING IS A REASON, NOT A DEFERRAL

**Technically the import is free and already proven.** `_shared/categorisation.ts` was
imported into Node under `tsx` twice on 12 August to run the censuses in items 71 and 72.
No Deno bindings, no shim, no build step. **One import line.**

**Semantically it cannot happen yet, and this is the point.** The shipped function cannot
emit `supplements` — it returns `skincare` or `EXCLUDED: supplement`. `feed-diag`'s sections
were built to answer *"how many supplement-shaped rows are in this feed"* **before
supplements existed as an output.** The reimplementation was not laziness; it answered a
question the shipped code could not.

> **Doing it before item 72 means writing a FOURTH implementation to bridge a gap that item
> 72 closes.** Land 72, then delete the three copies and import. Once `supplements` is
> emittable, `inferCategorisationForImport` answers the question directly and better — it
> reports what will actually happen rather than what a parallel rule thinks should.

#### THE GENERALISED REMEDY

> **A diagnostic that reimplements shipped logic is measuring its own opinion.**

And the rider that makes it workable, because sometimes reimplementation is genuinely
necessary:

> **Where a diagnostic MUST reimplement — because the shipped code cannot yet answer the
> question — that belongs in the OUTPUT, not only in the source.** A reader should be able
> to see which rule produced the number without opening the file.

**This is why it matters more than the Boots work that occasioned it: every measurement
this fortnight came from tools of exactly this kind.** The two postures had measurably
different reliability, and nothing in any report distinguished them.

---

### 74. Two changes in one window, and the attribution survived — structurally, not luckily

**Raised:** 13 August 2026, on Escentual's first coalesce read · **The first time two
changes landed in the same window and the attribution held.** Item 67 is the case where
concurrency cost a build; this is the case where it cost nothing, and the reason is worth
more than the outcome.

#### What landed together

| | When |
|---|---|
| `ean_product_index_live_retailers_only` — the index restricted to active, enabled retailers | **12 Aug 13:44 UTC** |
| Escentual's `sibling_coalesce` flip, first read | **13 Aug 04:00 UTC** |

Both inside one cycle. **Under item 67's rule this is exactly the situation the spacing
exists to prevent**, and the expectation was that the +8 in Escentual's link total could
not be assigned to either.

#### The read

| | 12 Aug | 13 Aug |
|---|---|---|
| via_ean | 0 | **18** |
| via_mpn | 0 | 2 |
| name_exact | 18 | **10** |
| name_stripped | 21 | **17** |
| **link_total** | **39** | **47** |

**+20 to tiers 1-2, −12 from the name tiers, net +8** — item 62's reallocation shape at
small scale. Against a baseline of 39 with sd 1.6, five sigma: real, not noise.

#### WHY THE ATTRIBUTION SURVIVED

> **Escentual had `rows_with_ean` = 0 before the flip. Tier 1 cannot fire for a retailer
> with no stored barcodes, whatever the index contains.** The index filter was
> **structurally incapable** of producing a single tier-1 link for Escentual. All 18 are the
> flip's, and no measurement was needed to establish it — only the observation that one
> input was zero.

**And the filter's effect was negative, not positive.** Escentual's 6,253 barcodes, scored
against the rest of the catalogue only — excluding its own rows, which would otherwise
contaminate the ambiguity count:

| | barcodes |
|---|---|
| Unambiguous before **and** after — tier 1 fires either way | **3,291** |
| No target anywhere in the catalogue | 2,699 |
| **Target removed by the filter** | **331** |
| Ambiguous both ways — skipped regardless | 223 |
| **Made linkable by the filter** | **40** |

**Net −291.** The filter cost Escentual 331 potential targets and gained it 40. The 18 links
came out of the 3,291 pool, which the filter did not touch.

> **So the spacing failure UNDERSTATED the flip rather than confounding it.** The
> conservative direction, by accident — but the reason it is knowable is not accidental.

#### THE GENERALISABLE PART

**Attribution survives concurrency when one of the changes cannot produce the observed
effect at all.** Not "probably did not" — *cannot*, because an input it depends on was zero,
or the code path was unreachable, or the population was empty.

> **Before assuming two changes are confounded, check whether either is structurally
> incapable of the effect.** It is a cheaper test than any statistical one, it gives a
> definite answer rather than a probable one, and it costs a single query. Here it was
> `rows_with_ean = 0` on the prior run.

**This is the same property item 72 relies on** — the inert deploy, unreachable because
`supplements_path_prefixes` is empty. **Structural inertness is what makes a change safe to
land beside another**, and it is worth designing for deliberately rather than noticing
afterwards.

**It does not repeal the spacing rule.** Item 67's failure was resource contention, which no
structural argument prevents, and most changes are not structurally inert. This is the
exception that can be recognised, not a general licence.

#### THE MEASUREMENT WAS ENTANGLED EVEN THOUGH THE OUTCOME WAS NOT

A count of **477** newly-unambiguous barcodes was recorded for the filter. Re-measured on
13 August it reads **759**, and **the difference is not drift — it is contamination.**
Escentual's 6,253 barcodes landed *after* the filter, and they change which barcodes are
ambiguous, so any count taken now includes the second change inside the measurement of the
first.

> **477 is no longer reproducible, and cannot be made so.** The outcome separated cleanly;
> the measurement did not. **Two changes in one window can leave the causation legible while
> destroying the ability to measure the first one's size** — those are different losses and
> only one of them was avoided here.

**The lesson for Boots:** take the "before" reading when the cycle is complete and *before*
the flip, because a reading taken afterwards cannot be reconstructed.

#### A CHECK DROPPED FOR BEING UNSOURCEABLE

A sole-source check against **61,913** was carried into this session. **No definition
reproduces it:**

| Definition | count |
|---|---|
| Root products, live + in stock, exactly 1 retailer | **72,601** |
| `products_active`, live + in stock | 72,163 |
| Root products, stock ignored | 84,009 |
| `products_active`, stock ignored | 83,383 |

The nearest is **10,250 above**. The figure appeared in the 12 August exchange and neither
side can source it now, so it is **dropped rather than reconciled** — item 47's discipline
applied before use rather than after.

> **Replaced with the version that can be derived: barcodes in `ean_product_index` supplied
> by exactly one retailer, measured before the Boots flip and again after.** The **movement**
> is what the check was always for; the absolute figure never was. A check whose baseline
> cannot be sourced is not a check.

---

### 75. The definition of the public catalogue is not in the repository

**Raised:** 13 August 2026, from a Search Console Product-snippets warning · **The warning
is the smaller half.** The view it led to is the object every catalogue figure on this list
depends on, and its current definition exists only in the live database.

#### THE FINDING

`products_active` **live**:

```sql
WHERE merged_into IS NULL AND parent_product_id IS NULL
  AND image_url IS NOT NULL AND image_url <> ''
  AND EXISTS (SELECT 1 FROM retailer_prices rp
              JOIN retailers r ON r.id = rp.retailer_id
              WHERE rp.product_id = p.id AND r.active = true)
```

`products_active` **as last committed** (`20260703150000`, whose own comment reads
*"Definition otherwise verbatim"*):

```sql
  AND EXISTS (SELECT 1 FROM retailer_prices rp WHERE rp.product_id = p.id)
```

**`r.active` is in the live view and in no migration.** Verified exhaustively: two
migrations redefine the view, neither carries the filter; one further migration mentions
both `products_active` and `r.active` and only *references* the view. **The active-retailer
filter was applied to production outside version control.**

> **This is not a stale record. It is an absent one, on the object every catalogue figure
> depends on.** A stale record can be diffed. This cannot: the repo's version is not an old
> definition of the live view, it is a **different view** that no longer exists anywhere.

#### THE CONSEQUENCE THAT PROMPTED THE SEARCH, AND WHY IT WAS UNANSWERABLE

The question was *"what was `products_active`'s `in_stock` omission FOR?"* — a fair
question with a defensible likely answer (an out-of-stock product should still have a page
rather than 404).

**The reason could never have been found, because the artefact could not be found.** The
view comment documents four filters and their purpose and does not mention stock at all;
the filter it *does* describe is **price-presence — "orphans"** — which answers a different
question: *does anyone list this?* rather than *can anyone buy it?*

**On that reading the omission may never have been a decision at all.** Stock may simply
never have been in scope, because the question being answered was about orphans. **Nobody
can tell**, and nobody could have told, because the thing to inspect is not in the
repository.

#### IT WAS KNOWN. THE KNOWLEDGE WAS IN THE WRONG PLACE.

`20260727180000_fmb_resolve_product.sql`, line 104 — **two weeks before this surfaced**:

```sql
-- products_active does NOT filter on in_stock, so the resolver applies its
-- own predicate. A basket tool must not offer an unbuyable row.
```

**Someone hit this, understood it exactly, worked around it correctly, and recorded it in a
comment inside an unrelated function.** The fact was documented. It was documented where
the next person to need it would not pass.

> **Item 66's clause again, on a new surface: a control recorded where the failure will not
> travel is decoration.** The resolver's author protected the basket tool and had no way to
> protect the JSON-LD, the sitemap, or any of this fortnight's measurements — because the
> place that would have reached all of them is the view, and the view is not reviewable.

#### THE RETROSPECTIVE CONSEQUENCE

**Every measurement this fortnight that read `products_active` read a definition nobody
could review.** Comparison depth, sole-source counts, the 97,677 and 98,114 catalogue
figures, the supplements baselines, `bath_body` movement, the sitemap's brand set.

> **The figures are right. They came from the live view, which is the thing that actually
> serves the site.** What nobody could check is **what they meant** — which products the
> denominator contained, and on what basis. A number whose population is undocumented is
> precise and uninterpretable at the same time.

**Four consequences from one undocumented decision** — pages that cannot be removed by
going out of stock (line 1479, 3 August), a resolver forced to carry its own predicate
(27 July), Product JSON-LD with no `offers` (today), and every catalogue denominator on
this list resting on an unreviewable definition.

#### THE FIX, AND IT IS ITS OWN CHANGE

**Bring the live definition into a migration, verbatim, changing nothing.** Not a
correction — a *capture*. The migration should assert that the resulting view matches what
production already returns (row count identical before and after), so it is provably a
no-op.

**Then, separately, document the `in_stock` decision on the view comment** — either as
deliberate with its reason, or as "never considered, retained because removing it would
deindex 13,335 pages", which is an honest and sufficient answer.

**The schema fix is downstream of this and must not lead.** Fixing the JSON-LD first
resolves a warning and leaves the cause in place.

---

### 76. The Product schema was reasoned against the standard rather than the consumer

**Raised:** 13 August 2026 · **Downstream of item 75.** Search Console, Product snippets:
*"Either offers, review, or aggregateRating should be specified."*

#### THE FLAGGED COUNT IS ONE ITEM. NOT 13,335.

**Search Console export, read 13 August: ONE affected item, first seen 12 August.** Valid
items run **2 to 4** across the whole period, so Google has parsed a handful of product
pages, not the catalogue.

> **13,335 is the POPULATION AT RISK. The flagged count is 1.** They are different numbers
> answering different questions — what currently qualifies, versus what Google has crawled
> and parsed — and the gap between them is the crawl schedule, not a discrepancy.

**This changes the urgency and not the fix.** Everything below stands and is still correct:
the markup is wrong, it contradicts what the page shows a human, and it should be fixed.
**But it is a correctness fix, not an incident**, and nothing about it competes with the
import-path queue.

**Recorded explicitly so nobody reads 13,335 as the flagged number** — including whoever
next opens this item looking for the size of the problem.

#### TWO FURTHER ISSUES, ACCEPTED RATHER THAN OPEN

The same export carries two non-critical items, **2 each**:

| Issue | Status |
|---|---|
| Missing field `aggregateRating` | **ACCEPTED — will not fix** |
| Missing field `review` | **ACCEPTED — will not fix** |

**Both are legitimately absent: we have no reviews and no ratings.** They are optional
fields and Google reports them as non-critical for exactly that reason.

> **Neither may be fabricated, and this is worth stating rather than assuming.** Synthesised
> ratings or reviews on a comparison site would be invention presented as user testimony —
> and the warning is Google noting an absence, not reporting a defect. **The correct state
> of these two fields is empty**, and they should not be re-opened as work each time the
> report is read.

#### Confirmed, and it is deliberate

`app/product/[id]/page.tsx:179` — `offers: inStockOffers.length > 0 ? [ … ] : undefined`.
`JSON.stringify` drops `undefined`, so **the key is absent entirely** — not an empty array,
not a null price. Verified live on product 131:

```
keys emitted: ['@context','@type','brand','description','image','name','sku']
offers: false · review: false · aggregateRating: false
```

**All three names in Google's message, all absent.** The code comment states the reasoning:

> *"an Offer requires price/priceSpecification; a priceless OutOfStock offer is invalid and
> Google flags it. Product schema permits a Product with no offers."*

> **Right about schema.org, wrong about Google.** schema.org does permit a Product with no
> offers; Google's Product guidance requires one of the three for rich-result eligibility.
> **The code was reasoned against the standard rather than against the consumer of the
> standard** — and those are different specifications with different requirements.

**And the risk it was avoiding is empty in fact.** The "priceless OutOfStock offer" does not
occur here: of the **13,335** products with no in-stock offer, **13,335 have an
out-of-stock row at an active retailer and 13,335 have a price on it. None lacks one.** The
concern was sound in principle and inapplicable in practice, and one query would have shown
it.

#### The fix: option three, two shapes

| State | Emit |
|---|---|
| Something in stock | `AggregateOffer` (low/high/count, `InStock`) **plus** one `Offer` per in-stock retailer |
| **Nothing in stock** | **one `Offer` per out-of-stock retailer, `OutOfStock`, real price — and NO aggregate** |

**Two shapes, not one parameterised block.** An `AggregateOffer` over out-of-stock rows
publishes a `lowPrice` for something nobody can buy, which feeds a shopping snippet
advertising an unbuyable price. **That is worse than emitting no offer at all** — the
current behaviour is silent, and a wrong price is not.

**No `noindex`. No sitemap marking.** Both treat out-of-stock as a defect. It is not: a
product out of stock today at a retailer that stocks it is a real product with a real page.
Correct markup already gives Google the signal it needs and lets it decide. **Suppressing
the page to resolve a warning that correct markup fixes is the wrong trade**, and it would
withdraw 13.6% of the catalogue from the index for a reason that no longer applies once the
markup is right.

#### Why it is worth doing beyond the warning

**The page already shows those retailers and prices to a human.** The JSON-LD currently
tells Google there are none. **Option three makes the two agree** — the warning is the
occasion, not the reason.

---

### 77. A hold whose condition expired, and eight metrics tables with no rows

**Raised:** 13 August 2026, looking for a traffic series to check a Search Console
impression decline against · **Attaches to `docs/dashboard-build-brief.md` Steps 4-6 and to
item 43.**

#### THE HOLD THAT OUTLIVED ITS CONDITION

`ga4-weekly-pull.yml`, written 29 July, carries this in its header:

> *"HELD 29 July: GitHub Actions minutes are close to exhausted, so step 1 is deferred
> until they reset."*

**Actions minutes reset monthly. They reset on 1 August.** `feed-diag` was dispatched three
times across 12-13 August without difficulty. **The condition lapsed twelve days ago and
the hold has held ever since.**

> **A hold whose condition has expired is indistinguishable from one that still applies,
> because nothing re-checks the condition.** The note is honest, dated and specific — and
> **that is exactly what makes it stay true-looking forever.** A vague hold invites someone
> to ask whether it still stands. A precise one reads as settled.

**THE GENERAL FORM, and it is broader than this file:**

> **Any deferral written with a condition needs the condition CHECKABLE and DATED, or it
> becomes permanent by default.** "Deferred until minutes reset" is a condition nothing
> evaluates. "Deferred until minutes reset — recheck after 1 August" is the same sentence
> with an expiry, and it costs one clause.

**This is item 66 on a decision rather than a document.** There the control was filed where
the failure would not travel; here the control is filed correctly and has no mechanism to
notice it is satisfied. **Both fail open and neither reports.**

The header's second stated blocker — *"the token cannot dispatch it (`gh workflow run`
returns 403)"* — is **also stale**; `feed-diag` was dispatched with this token on both days.
**Two of three blockers expired.** The third stands: *do not arm a writer that has never
executed on a timer* — which is why step 1 is a dry run, and why that dry run is the
unblocking action rather than uncommenting the schedule.

#### RESOLVED 13 AUGUST: STEPS 1 AND 2 RUN, SCHEDULE STILL UNARMED

**`metrics_ga4_weekly` has rows. Seven of the eight tables are still empty; this one is
not.** Step 1 (dry run) and step 2 (`dry_run=false`) both executed on 13 August. **Step 3 —
uncommenting `schedule:` — deliberately NOT done in the same action**, per the workflow's
own design: arming is a reviewable act in its own PR, and one manual write before scheduling
is the point of the sequence.

| week (ISO Mon) | sessions | qualified | comparison views | awin | amazon | other | searches (view) | searches (custom) |
|---|---|---|---|---|---|---|---|---|
| 2026-07-20 | 135 | **null** | **null** | 78 | 6 | 1 | 16 | **null** |
| 2026-07-27 | 159 | 73 | 114 | 26 | 8 | 1 | 19 | **null** |
| 2026-08-03 | 145 | 85 | 129 | 17 | 12 | 3 | 20 | 20 |
| 2026-08-10 *(partial)* | 29 | 17 | 19 | 1 | 1 | 0 | 0 | 0 |

**The 10 August row is four days, not a collapse** — 10-13 August, with GA4's 24-48h
processing lag on top. It is exactly why the puller re-pulls four trailing weeks.

##### THE `[ok]` DOES NOT MEAN WHAT IT LOOKS LIKE

The self-check prints **`[ok] by-network columns sum exactly for every written week`**.

> **That confirms INTERNAL CONSISTENCY ACROSS THE FOUR WEEKS PULLED. It does NOT confirm
> resolution against the 2026-06-24 boundary, which is out of range.** The puller takes four
> *trailing* weeks, so the earliest available is 20 July.

**The four-week ceiling is a GA4 constraint — at most four date ranges per request — not a
setting anyone chose.** Testing the June boundary needs a backfill, not a parameter change.
**Recorded because `[ok]` beside a boundary discussion will otherwise be read as boundary
confirmation**, and it is not.

##### THE FIRST BOUNDARY VISIBLE IN THE DATA IT DESCRIBES

`searches_custom_event` is **null for 20 and 27 July, then 20 from 3 August**.

**That is the 5 August custom-definition registration appearing in a data series.** GA4 does
not backfill a definition, so the column begins when the definition was created — and
`platform_changes` id 30 says so in prose.

> **Boundaries have been documented all fortnight — in migrations, in comments, in
> `platform_changes` rows. This is the first one anyone has seen in the data it describes.**
> A boundary you can see in the series is a different object from a boundary you have to be
> told about: the first survives the person who wrote it down.

`qualified_sessions` and `comparison_views` null in the 20 July week only is the same thing
for the earlier definitions — the boundary is *in the data*, not merely beside it.

#### THE TRAFFIC QUESTION IS SETTLED, AND IT WAS ONE EMAIL FROM BECOMING A PREMISE

**Sessions across the three complete weeks: 135, 159, 145. Flat.**

Three independent signals now agree:

| Signal | Reading |
|---|---|
| GA4 sessions, 3 complete weeks | **135 · 159 · 145 — flat** |
| `search_events` / `outbound_clicks` day-rates, Jul → Aug | ~18.3 → ~15.2 and ~9.1 → ~9.4 — **flat within noise** |
| Search Console structured-data impressions | 604 → 36, **on 2-4 URLs** — one page losing one query |

> **"Traffic is collapsing" was one email away from becoming a premise**, and it would have
> been a good premise: dated, sourced, from Google, pointing one way for three months. **It
> was wrong because the series measured two to four URLs**, and nothing in the export said
> so.

**Recorded plainly because the near-miss is the point.** The figure was real, the reading was
careful, and the conclusion was still false — and the only thing that caught it was asking
what population the number described. That is instance 12's question applied before the
number was used rather than after.

#### THE FINDING THAT MADE ANYONE LOOK

| Table | rows |
|---|---|
| `metrics_ga4_weekly` | **0** |
| `metrics_quality_weekly` | **0** |
| `metrics_awin_weekly` | **0** |
| `metrics_amazon_monthly` | **0** |
| `metrics_social_weekly` | **0** |
| `metrics_rakuten_weekly` | **0** |
| `metrics_retailer_quality_weekly` | **0** |
| `metrics_brand_spotlight_weekly` | **0** |

**Eight metrics tables. Zero rows in all eight. The schema exists and the series does not.**

> **Every "nobody has looked at the traffic" observation in this project has been describing
> a missing INSTRUMENT rather than a missing HABIT.** Nobody looked because there was
> nothing to look at. That is a different problem with a different fix, and the two get
> confused because they produce the same sentence.

`canonical-comparison-depth.md` already records this exact shape for one of the eight —
*"the definition is stored, the series is not"*, `metrics_quality_weekly` holding the
canonical comparison-depth definition in its table comment and no rows. **It is not one
table's oversight. It is the state of the whole measurement layer.**

**The retrospective cost:** every reading of comparison depth this fortnight was ad-hoc,
which is why no two are comparable after the fact and why an unsourced baseline
(`11,480`) circulated unchallenged. That was diagnosed as a documentation problem. **It is
the same absent instrument.**

#### WHAT THIS MAKES LOAD-BEARING

**Dashboard Steps 4-6 are what turn eight tables from a schema into a series**, and they
have looked like reporting polish. They are not: **they are the only thing that would let
anyone answer "is traffic falling?" from inside this project.** Today that question had to
go to a human with a Search Console login, and the answer could not be cross-checked
against anything.

#### CORRECTIONS TO THE PREMISE, BOTH LOAD-BEARING

**The GA4 puller was built 29 July, not 5 August**, and the two dates are different things:

| | |
|---|---|
| **29 July** | `ga4-weekly-pull.yml` written, deliberately unscheduled — commit 9ac8f0d, untouched since |
| **5 August** | Five GA4 **custom definitions** registered by hand in the GA4 admin, `platform_changes` id 30 |

**And it is not merely unarmed — it has never run at all.** The workflow's own header
records the sequence: dispatch with `dry_run=true`, read the table, then dispatch for real,
then arm the schedule in a PR of its own. **Step 1 has not happened.** The file states the
resting state plainly: *"Unarmed with an empty table is the correct resting state, not a
stalled one."*

**The recorded blocker is the subject of the section above.** Two of its three conditions
have expired; the third — do not arm a never-executed writer on a timer — stands, and makes
the dry run the correct next act.

#### THE FIGURE THAT PROMPTED THIS, AND WHY IT WAS MISREAD

The Search Console structured-data report showed impressions falling **604 (15 May) → 120
(1 Aug) → 36 (11 Aug)**, read as a three-month site-wide decline.

**Valid items in that report run 2 to 4 across the whole period.** The series therefore
measures the fortunes of **two to four URLs** — a fall from 604 to 36 is one page losing one
query, not a site trend.

> **Same shape as reading `feed-diag`'s regexes as the classifier's** (item 47, instance
> 12): a real figure, correctly computed, describing a much smaller population than the one
> it was quoted about. **The structured-data tab's impressions are not the Performance
> report's impressions**, and nothing in the export says so.

**The unfiltered Performance report, 15 May to date, is the thing that would answer it** —
a different data set, being pulled by hand, because there is no instrument.

---

### 78. Boots coalesce flip: the before-readings

**Taken 13 August 2026, 10:45 UTC, cycle complete** — YesStyle ran 10:00:02, the last of the
day. **Recorded BEFORE the flip**, because item 74's finding is that an after-the-fact
reading of the first change cannot be reconstructed once a second lands.

#### The replacement check (item 74)

The 61,913 sole-source check was dropped as unsourceable. **This is the derivable version:
barcodes in `ean_product_index` supplied by exactly one active, enabled retailer.**

| | |
|---|---|
| **Sole-supplier barcodes** | **49,356** |
| Multi-supplier barcodes | 12,967 |
| Total indexed barcodes | **62,323** |
| Sole-supplier share | **79.2%** |

**The movement is the check, not the level.** Boots contributes ~23,000 barcodes to an index
of 62,323, essentially none of which it currently holds, so sole-supplier share should
*rise* on the flip — Boots-only barcodes arriving faster than Boots barcodes that match an
existing supplier. **A fall would mean Boots is duplicating the catalogue rather than
extending it**, which is the opposite of the supply-side case in item 64.

#### Baseline A, retaken with the complete cycle

| Retailer | runs | mean | range | **sd** |
|---|---|---|---|---|
| Debenhams | 3 | 8,882 | 8,175-10,043 | 1,013.2 |
| Niche Beauty | 6 | 3,155 | 410-4,017 | 1,355.1 |
| Stylevana | 7 | 1,756 | 1,513-2,470 | 335.3 |
| Beauty Flash | 7 | 1,326 | 932-1,627 | 322.1 |
| Gorgeous Shop | 7 | 1,113 | 897-1,735 | 359.0 |
| Beauty Bay | 7 | 262 | 243-349 | 38.6 |
| **Boots** | **7** | **153** | **148-159** | **3.4** |
| Perfume Click | 7 | 74 | 52-100 | 19.2 |
| YesStyle | 7 | 49 | 43-55 | 4.8 |
| Escentual | 7 | 40 | 37-**47** | 3.4 |
| The Organic Pharmacy | 7 | 0 | 0-2 | 0.8 |
| Atelier De Glow | 7 | 0 | 0-0 | 0.0 |

**Boots: 153 ± 10 for three sigma.** The sd widened 2.1 → 3.4 as the window rolled to
include Escentual's flip week; Escentual's own series now carries its 47 and its sd doubled
to 3.4 for the same reason. **Both are the window absorbing a real event, not drift.**

**Downstream detectors, unchanged in ranking:** YesStyle (4.8), Perfume Click (19.2),
Beauty Bay (38.6) can carry a verdict. Debenhams and Niche Beauty still cannot.

#### What to expect

Per items 62 and 64, and confirmed twice now on Gorgeous Shop and Escentual:

- **`rows_with_ean` 0 → ~23,000**; barcodes stored, from zero. **This is the contribution.**
- **Net link movement near zero** — Boots resolves 99.2% of admitted rows on tier 0, so only
  ~188 reach the tier ladder. **A flat 153 is the success case, not a non-event.**
- `tier1_ambiguous_skipped` appearing from nothing.
- The fill-versus-stored gap, which is retailer-specific: Gorgeous Shop lost 13.0% of
  populated GTINs to validation, Escentual 0.08%. **Boots is not predictable from either.**

---

### 79. Three word-boundary defects in one design pass, and the third was in the fix

**Raised:** 13 August 2026, designing item 71's narrow topical list · **Report only, nothing
built.** The list is not the finding.

#### THE THREE

| | Defect | Cause | Found by |
|---|---|---|---|
| 1 | **`\bprotein\b` does not match "Myprotein"** | no word boundary inside the brand name | measuring the sports distribution |
| 2 | **`\btoner\b` does not match "Toner250 ml"** | the feed glues the form word to the size | measuring the topical list against the rows |
| 3 | **`\b(&\|and)\s+cream` never matches " & Cream"** | `\b` before `&` requires a word char immediately prior; a space is not one | measuring the FIX for defects 1 and 2 |

**Different causes. Same class. Each invisible to reading and caught only by measuring.**

#### THE THIRD IS THE ONE THAT MATTERS: IT WAS INTRODUCED BY THE FIX

Defect 3 did not exist until a regex was written **specifically to correct defects 1 and 2**.
It was authored by someone who had just spent an hour on word boundaries, in the sentence
whose entire purpose was to handle a word-boundary failure, and it silently let nine rows
through.

> **So the remedy is NOT "be careful with boundaries".** Care was at its maximum and the
> defect still landed. **The remedy is: measure every regex against the corpus — including
> the ones you just wrote to fix a boundary.**

**A fix for a measurement failure is itself a measurement candidate.** Nothing about having
just diagnosed the class confers immunity to it; if anything the confidence is the risk.

#### `cream` IS A FLAVOUR WORD, AND IT WOULD HAVE SHIPPED

The proposed list caught **38 rows, 16 of them false — 42%**:

- **Nine sports-nutrition rows classified as topical because of a flavour name** —
  *Optimum Nutrition Gold Standard Whey **Vanilla Ice Cream*** (×3), *Cookies & Cream*
  protein bars from Fulfil, Barebells, Forest Feast, Paediasure and Slim Fast.
- **Five pelvic-floor devices**, because *Soma Lives Soma Flex **Pelvic Floor Vaginal
  Toner*** contains "toner".

**And it missed two of its own four named targets** — *Anua … Toner250 ml* and *Numbuzin …
Toner200 ml* — for defect 2.

> **A list adapted from another retailer's vocabulary fails on this one's data, which is
> item 57 exactly: the rule is fitted to the catalogue, not to the concept.** `cream` is a
> product form at Beauty Flash and a flavour at Boots, because Boots sells protein powder
> and Beauty Flash does not.

> **THIS LIST IS BOOTS-SHAPED. Applying it to Escentual or Beauty Flash requires
> RE-MEASURING, NOT RE-REASONING.** The tokens may well be identical; that has to be
> demonstrated against their rows, not inferred from these.

#### THE CORRECTED LIST, AND THE PLAN CHANGE

Corrections approved and measured: **digit-or-boundary termination** `(?:serum|toner|…)(?=\d|\b)`
· **flavour veto conditional on `cream` being the sole form word present**, so
*Boots Dermacare Acne Cleanser & Day Cream* survives it · **pelvic-floor veto**.

Result: **26 hits of 1,808, no false positives, all four named targets caught.**

> **PLAN CHANGE, ADOPTED: build and test the topical list against the data BEFORE the
> branch is written, not into it.** Today's pass found three boundary defects in a
> nine-token regex. Writing it into the branch first would have made each one a
> code-review question rather than a measurement, and code review is what missed all three.

#### THE RULE WORKING ON ITSELF: A VETO THAT FIRES ON REAL SUPPLEMENTS

Measuring each regex separately — item 79's own instruction, applied to the regexes written
under item 79 — found this:

> **`DEVICE` matches SEVEN rows, not five.** Five are the Soma Lives *Pelvic Floor Vaginal
> Toner* range, which is what it was written for. **The other two are
> *Jude Collagen & Creatine Pelvic Floor Supplements* — genuine, correctly-classified
> supplements.**

**They are not excluded, and the reason is worth stating precisely: it is correct by
accident, not by design.** `NARROW` never matches those rows — no `serum`, `toner`, `cream`
or any other form word — so the veto is never consulted for them. **The veto fires and its
verdict is discarded because nothing asked.**

##### THE PROPERTY IT DEPENDS ON, STATED SO IT CAN BE PROTECTED

> **The vetoes only ever suppress rows `NARROW` has already matched.** `DEVICE` and
> `FLAVOUR` are filters on the topical set, not classifiers in their own right.

**If that ordering is ever inverted — a veto consulted before or independently of `NARROW`
— two real supplements are excluded and nothing would report it.** They would not 404, they
would not error, they would simply not become supplements: the quietly-incomplete family
again (items 48, 51, 54, 56, 60, 67), on a rule written this afternoon.

**Recorded at the veto in code as well as here**, because item 66's clause applies: a
control filed only where the decision was made is filed where the failure will not pass.
The person who inverts the ordering will be reading `categorisation.ts`, not this list.

#### NO7 ARRIVED FREE, AND THAT IS THE EVIDENCE THE CORRECTION IS RIGHT

The glued-size defect was diagnosed from two named rows — *Anua … Toner250 ml* and
*Numbuzin … Toner200 ml*. The digit-boundary correction caught a third that nobody had
named: **No7 Radiance+ Vitamin C Glow Toner200 ml**, plus *Umberto Giannini … Shampoo2* and
*Fushi Organic Black Seed Oil250*.

> **That is the difference between fixing two cases and fixing a class.** A correction
> shaped around its two examples catches exactly those two; a correction shaped around the
> *cause* catches rows nobody had looked at. **The free catch is the evidence that the
> digit-boundary rule is right rather than merely sufficient.**

**And it is a cheap test to reuse:** after fixing a defect from named examples, check
whether the fix catches anything unnamed. **If it catches nothing new, the fix is probably
fitted to the examples rather than to the cause** — which is item 57's shape arriving from a
different direction.

#### ZERO COLLISIONS, MEASURED RATHER THAN ASSUMED

**No row is both a sports-allowlist brand and topical: 0 of 1,808.**

Recorded as a **measured property, not a lucky one**, because it removes a design decision
that would otherwise need justifying — *which rule wins when both fire?* **There is no such
row, so the two rules compose in either order**, and any future change that creates one is
a real change rather than an edge case. **The split: 1,523 `supplements` · 259 `sports` ·
26 topical falling through to normal classification.**

All 18 allowlist brands are present in the feed.

#### THE THREE SABOTAGES, RUN 13 AUGUST — AND THE MIDDLE ONE IS THE ARGUMENT

Each applied to the real code, run, and reverted:

| Sabotage | Result |
|---|---|
| Default `onSupplementsPath` to `true` | **A fails** — 2,829 of 3,601 rows moved without a path |
| **Make the branch a no-op** | **A PASSES. B fails.** |
| Invert the veto ordering | **B fails by name**: *"Jude Collagen & Creatine Pelvic Floor Supplements was vetoed as topical"* |

> **The middle one is the whole argument for direction B, demonstrated rather than
> asserted.** A branch made a no-op passes direction A perfectly — **which is exactly what
> "inert by construction" looks like when it is broken.** The two are indistinguishable to
> A, and A is the test that was going to license the deploy.

**The third turns item 79's correct-by-accident property into something executable.** That
`SUPP_DEVICE` matches two genuine supplements and is harmless only because the form test
runs first was, until this test existed, **a property nobody had designed and nothing
enforced** — true by luck and documented in a comment. **It is now a property something
checks**, and inverting the ordering fails the suite by naming the row it would have
silently excluded.

#### THE GOLDEN FILE, BOTH DIRECTIONS

**A** — inert: the two-argument form byte-identical across ≥2,000 stratified
`products_active` names plus all 1,808 Boots rows, compared field by field against values
generated on `main` before the branch exists.

**B** — effective: with the path supplied, **1,523 → `supplements`**, **259 → `sports`**, and
the 26 topicals — *Anua Toner250*, *Numbuzin Toner200*, *Olay Moisture Fluid*,
*BetterYou Body Spray* named explicitly — **unmoved**.

> **B is what stops a completely broken change passing A.** A change that does nothing at
> all satisfies A perfectly, and "inert by construction" is exactly the claim A is meant to
> substantiate — so without B the test proves the opposite of what it is for.

---

### 80. A cast that silences a type error is evidence the type is wrong

**Raised:** 13 August 2026, writing the supplements-path branch · **Sits beside items 70 and
73**, and is the sharpest instance of the family so far.

#### WHAT HAPPENED

The branch needed to return a new top category. The first draft wrote:

```ts
top_category: "supplements" as ImportTopCategory,
```

**`tsc --noEmit` passed.** `ImportTopCategory` was
`"skincare" | "makeup" | "hair" | "fragrance" | "bath_body"` — **`"supplements"` was not in
it.** The cast silenced exactly the error the typechecker existed to raise.

#### WHY IT IS SHARPER THAN ITEMS 70 AND 73

| | The gap between disabling and claiming |
|---|---|
| Item 70 — a flag firing at 95% | the flag and the reader are different things, one file apart |
| Item 73 — a diagnostic reimplementing shipped logic | the copy and the original are different files |
| Item 70's addendum — a script raising into a deaf pipeline | four tools, four layers |
| **Item 80 — this** | **none. The disabling and the assertion are the same expression.** |

> **`x as T` is simultaneously the claim "this value is a T" and the instruction "do not
> check whether it is".** Every other instance in this family has some distance between the
> broken instrument and the confident conclusion — a file, a layer, a tool. Here they are
> the same eleven characters, and the check ran, was satisfied, and had been disabled by the
> thing it was checking.

**Nothing downstream would have caught it either.** The value is a legal string; the
importer writes it to a column with no CHECK constraint (item 75's `products_active` is not
the only place `top_category` is unconstrained); and the row would have appeared in the
database as a category the TypeScript union says cannot exist.

#### THE REMEDY

> **A cast that makes a type error go away is evidence the TYPE is wrong, not that the
> VALUE is fine.** The question to ask is never "is this cast safe?" but "why does the type
> not already permit this?" — and the answer is usually that the type is stale and the
> program has moved on.

Here it was exactly that. `supplements` has been a real `top_category` since #232, live with
93 products, in the nav, the sitemap and `ALL_CATEGORIES` — **and the importer's union had
never been told.** The fix was one word in the type, not a cast at the call site:

```ts
export type ImportTopCategory = TopCategory | ExtendedTopCategory | "supplements";
```

**Deliberately NOT added to `ExtendedTopCategory`**, which is specifically the
fragrance/bath_body detector's output and is gated by `ENABLED_EXTENDED_CATEGORIES`.
Supplements is assigned by path, not detected. **A cast would have hidden that distinction
too** — the second thing it was concealing, and the one nobody would ever have found.

#### THE COST OF THE HABIT, NOT THE INSTANCE

This one was caught within a minute, by checking what the type actually contained rather
than trusting that a green `tsc` meant agreement. **The general risk is that a codebase
accumulates casts at exactly the points where its types have drifted from its behaviour** —
so the typechecker stays green *precisely where the model is most wrong*, and every one of
those casts was written by someone who had just satisfied themselves the value was fine.

---

### 81. Record consent state on the outbound beacon — the only thing that separates four causes

**Raised:** 13 August 2026, from the GA4 client-capture ratio · **Approved to build.**
`platform_changes` id 34 is the boundary row this item exists to make unnecessary.

#### WHY IT IS THE ONLY MOVE THAT SEPARATES ANYTHING

The GA4-over-server-side ratio has four inputs — refusals, ad blockers, client-capture
regressions and bot traffic — and **three of them share one signature: gtag never ran.**
Nothing stored can tell them apart, and consent is the one that has never been measurable
at all: **a refusal is a purely client-side event that reaches no server, ever.**

> **A `granted` beacon arriving while GA4 stays silent is a BLOCKER. A `denied` beacon is a
> REFUSAL.** That single distinction splits the two causes people actually want to
> separate, and it is unavailable today because the click row does not say which.

#### THE CHANGE, AND IT IS SMALL

`sendOutboundBeacon` already posts `{ productId, retailerId, awinMid, price, source, path }`.
**One field** — `consent`, read from `localStorage['fmb-cookie-consent']` in the same page —
**one column**, **one line** in `app/api/track/outbound/route.ts`. Three values: `granted`,
`denied`, `undecided`.

`undecided` matters as much as the other two: item 17's whole analysis turns on the visitor
who has not yet answered the banner, and that population is currently invisible on both
sides of the ratio.

#### THE PRIVACY REASONING, STATED RATHER THAN ASSUMED

> **Recording "this visitor declined" is strictly LESS information than the click row
> already carries.** The row already records that a specific person clicked a specific
> product to a specific retailer at a specific time. Adding their banner state introduces
> **no new identifier, no third-party transmission, and no new category of data** — it
> annotates a record that already exists with a fact about how it was collected.

**That reasoning belongs in the PR, not only here**, because it is the kind of change that
looks like a privacy expansion at a glance and is not. It must be argued in the open rather
than slipped in under a metrics heading.

**And the banner copy must be checked against it before writing.** If the banner claims
anything that this contradicts, the copy is the constraint and the field is the thing that
changes.

**Contrast with item 82, which is the reason these are separate items.** This adds a field
to a beacon that already fires without consent. **Item 82 would set a 180-day cookie**, and
the banner's own design note says consent is stored in `localStorage` *"since cookies need
consent"*. That reasoning applies to that cookie and not to this field.

---

### 82. A decision that lapsed, not a defect — and the lapse was the right outcome by accident

**Raised 13 August 2026 as a defect. REWRITTEN THE SAME DAY as a lapsed decision, and
closed WILL-NOT-FIX.** `ensureSessionId` removed; `session_id` stays as a column.

#### THE LAPSED DECISION

`lib/session.ts` carried its own instruction, and it was deliberate, reasoned and correct:

> *"When in doubt, ship the event logging WITHOUT the cookie first (session_id = null); you
> still get totals (searches, clickouts, zero-result rate), just not per-session stitching.
> **Add the cookie once consent handling is confirmed.**"*

**Consent handling WAS confirmed.** The banner shipped, the analytics toggle works, the
consent record is versioned in `localStorage`, and `platform_changes` id 30 documents five
GA4 definitions registered by hand. **Nothing carried the note forward.** `ensureSessionId`
was never called, `session_id` stayed NULL on 406 `outbound_clicks` and 769 `search_events`,
and the capability the module's header states as its purpose has never once worked.

> **This is item 77's expired-hold shape on a different surface.** *"Add the cookie once
> consent handling is confirmed"* has no more mechanism behind it than *"deferred until
> minutes reset"* did. Both are honest, dated, conditional deferrals; both had their
> condition met; neither had anything watching for it. **A conditional deferral with no
> mechanism is a permanent decision written in the language of a temporary one.**

**AND THIS TIME THE LAPSE WAS THE RIGHT OUTCOME BY ACCIDENT.** Item 77's expired hold cost
two weeks of a series that had to be recovered. This one prevented a change that should not
have been made — see below. **The mechanism failed identically in both cases and the
outcomes were opposite, which is the argument for fixing the mechanism rather than judging
it by results.**

#### WHY NOT FIXED: THREE ARGUMENTS, THE THIRD DECISIVE

Three options were considered — a consented 180-day cookie, a `sessionStorage` id, and a
server-derived hash.

**`sessionStorage` cannot answer the question.** `app/search/page.tsx` is an `async` SERVER
component that calls `logSearch` during render. A server component cannot read
`sessionStorage`, so a client-only id reaches the click and never the search — and *"of the
sessions that searched, how many clicked out"* stays unanswerable. **The deciding constraint
is the server/client split, not the privacy posture.**

**Moving search logging client-side is the wrong trade.** It would buy the funnel by making
the search log lose bots, prefetches and JS-disabled visitors, and by re-establishing the
committed-search guarantee in a client effect. **Redesigning the most reliable event in the
system to enable a metric is not worth it.**

**THE CONSENTED COOKIE IS REDUNDANT, AND THIS IS THE DECISIVE ONE.** The banner has exactly
one non-essential toggle, `analytics`, so a consented cookie gates on it — meaning it covers
**precisely the population GA4 already covers.** And GA4 already has both ends:
`trackSearch` fires a standard `search` event, `retailer_click` and `affiliate_clickout`
fire on the click, both behind that same toggle, and **GA4 stitches events into sessions
natively.**

> **A consented cookie would rebuild, server-side, a capability GA4 already provides, for
> exactly the same people, gated on exactly the same toggle. Its one distinguishing property
> — covering refusers — is precisely what the consent gate removes.**

**And the confound settles it.** The consenting share moved **65% → 52% → 34%** in three
weeks. A funnel visible only to that subset has a denominator whose composition is moving,
so **a falling conversion rate and falling consent would be indistinguishable in the
series** — the exact confound that took three days to unpick on the AWIN clicks
(`platform_changes` id 34), rebuilt deliberately into a new metric.

#### WHAT ANSWERS THE QUESTION INSTEAD — A LIMIT, NOT A GAP

**For consenting visitors: GA4, which stitches sessions natively.** The question is already
answerable there and needs nothing built.

**For refusing visitors: it is not available by any means we would accept.** Not a gap
waiting on effort — a limit. Answering it for refusers requires either an identifier they
did not consent to or a fingerprint, and both are rejected on their own terms rather than on
cost.

> **Record it as a limit so nobody re-opens it as a gap.** A missing returning-visitor or
> refuser funnel is not a defect, and the absence of a metric is not evidence that one is
> owed.

#### `ensureSessionId` REMOVED; `session_id` KEPT

**The function is gone.** An unused function that sets a 180-day cookie, one call site away
from falsifying `privacy.html` §2.2's *"sets no cookies of its own"*, is exactly the trap the
wording narrowing exists to avoid — and the narrowing itself was forced by `getSessionId`
reading a cookie *by design* while being inert *by defect*. **Inert code that reads a cookie
is what made a published sentence false in intent.**

**The column stays, with 406 and 769 NULLs, and the reason is now in the schema comment** —
because without it the next person proposes populating it, which is how this item started.
`getSessionId` also stays: it reads a cookie that nothing sets, returns `null`, and is the
one honest way to keep the call sites' shape without reintroducing the writer.

**NULL means never recorded, not "no session".** Any funnel rate computed across a future
boundary would silently divide by a period that could not participate — the
quietly-incomplete family, and the same boundary the `consent` column records for itself.

#### THE DISAGREEMENT IS PART OF THE RECORD

**The instruction was to build the consented cookie. It was not built.** The report came back
recommending against all three options, and the recommendation was accepted.

> **The third argument — that GA4 already provides this for the same population — was not
> available to the person giving the instruction, and would not have been without opening
> `lib/analytics.ts`.** Stopping to argue was the right move, and the argument was right.
> **An instruction to build is not an instruction to stop thinking**, and the cost of being
> wrong about that is one report nobody needed.


### 83. Server-side click logging has never been disclosed

**Raised:** 13 August 2026, while writing item 81 · **Live since the beacon shipped.**
**Made visible by that change rather than caused by it**, which is the only reason it is
being recorded now rather than earlier.

#### THE GAP

`public.outbound_clicks` has **406 rows**, written on every outbound click **regardless of
consent**, carrying product, retailer, `awin_mid`, price, **`path`**, `source` and
timestamp.

**`privacy.html` §2.2, "Information we collect automatically", listed two things:** analytics
data via GA4 *"but only if you accept analytics cookies"*, and cookie preferences stored
locally. **Server-side click logging appeared nowhere in the policy.**

> **`path` is the material omission.** §2.2 promises *"pages viewed"* only under GA4 and only
> with consent. **`outbound_clicks.path` records a page view by another name, without
> consent** — `/product/8288`, `/app`. A disclosure that omitted `path` would have left
> standing the exact claim it existed to correct.

#### WHY THIS CHANGE FORCED IT

Item 81 adds a `consent` column. **A row saying `denied` documents collection from someone
who declined** — lawful on legitimate interest, but far harder to defend against an
*undisclosed* collection than a disclosed one. The field did not create the exposure; it
made it legible.

**The policy sentence therefore ships in item 81's PR**, not after it.

#### THE WORDING HISTORY, RECORDED BECAUSE IT IS THE FORTNIGHT'S SHAPE ON A LEGAL PAGE

Two drafts were approved and both were wrong. Neither was careless; both were corrected by
**measuring against the row rather than reasoning about it.**

| Draft | What it claimed | How it failed |
|---|---|---|
| First | *"the product, the retailer and the price shown… does not use cookies or third-party analytics"* | **Omitted `path`, `source` and `session_id`.** The omission was the material one — see above |
| Second | *"…does not use cookies"* | **True in effect, false in intent.** `getSessionId()` reads `fmb_sid` BY DESIGN; it returns null only because item 82's defect means nothing sets it |
| Shipped | *"sets no cookies of its own and is not shared with third-party analytics, and it is not linked to you"* | Verifiable, and survives item 82 being fixed |

> **A claim that rests on a bug changes when the bug is fixed.** *"Does not use cookies"* was
> load-bearing on `ensureSessionId` never being called. **"Sets no cookies of its own" is a
> statement about the code's behaviour rather than about the defect's**, and stays true
> either way.

**And the reader's-eye failure is the one that nearly shipped.** `sendBeacon` is same-origin,
so the browser attaches whatever cookies exist — Supabase auth cookies on `/product/*`. The
route ignores them entirely. *"Does not use cookies"* invites a reader to conclude none are
involved, and in the HTTP sense they are.

**This is the same shape as everything else this fortnight, arriving on a legal page.** A
claim that reads as obviously true, is approved by the person who owns it, and turns out to
describe something narrower than the artefact it is about — caught only by opening the
artefact. **The difference here is where a wrong one ends up published.**

---



---

### 84. A guard that excludes is a guard that lies; a guard that categorises cannot

**Raised:** 14 August 2026, sizing the reassignment detector · **Two findings from one
broken query, and the second is the more dangerous.**

#### FINDING ONE: `n_slug > 0` IS THE YESSTYLE POLL AGAIN, AN HOUR LATER

A read-only analysis compared URL slugs against stored product names, per retailer, to size
the detector's confirmatory signal. It guarded with `WHERE n_slug > 0 AND n_name > 0`.

**Beauty Bay URLs end in a trailing slash**, so "last path segment" extracted an empty
string. Every row was excluded by that guard and the retailer reported **zero
zero-overlap rows** — which reads as *perfectly clean* and means *never examined*. Perfume
Click and The Organic Pharmacy the same. **YesStyle reported 13,800 of 13,800, 100%**, which
is not a catastrophe but a parser that does not fit their format at all.

> **The filter dropped unparseable rows instead of counting them, so UNMEASURED and CLEAN
> produced identical output.** That is item 70's family — a diagnostic whose failure is
> indistinguishable from its success — and the YesStyle run-poll's exact shape, written **an
> hour after that lesson was recorded in this file.**

##### THE GENERAL FORM, WHICH OUTLIVES THIS QUERY

> **A guard that EXCLUDES is a guard that lies. A guard that CATEGORISES cannot.**
>
> Every row must land in a named bucket — matched, no-overlap, **could-not-parse** — and the
> could-not-parse bucket must be reported alongside the others. An excluded row leaves no
> trace; a categorised row cannot hide.

**This is structural, not attentional.** "Be careful with filters" does not survive the next
tired hour; a query that cannot silently drop a row does. Applies to every diagnostic in
`scripts/`, and to the SQL in this file.

#### FINDING TWO: 117 AGAINST 121, THE MOST PERSUASIVE WRONG NUMBER OF THE FORTNIGHT

The same broken query reported **117 zero-overlap rows for Stylevana**, against **121**
recorded in commit `a43e2ed` as the size of the reassignment cohort. **Four apart.**

The parser was demonstrably broken on three other retailers and **had never been checked
against Stylevana's URL format at all.**

> **It was persuasive precisely because it nearly matched something true.** An obviously
> wrong number gets discarded on sight. A number four away from a known quantity gets
> BELIEVED, and would have been quoted as corroboration that the design was sound.

**AND THE TWO HALVES OF THE ERROR CONCEALED EACH OTHER.** The same result set showed the
parser failing on Beauty Bay, Perfume Click and The Organic Pharmacy — and reported those
failures as **zeroes**, which read as those retailers being clean. So the evidence that the
instrument was broken appeared, in the same table, as evidence that the catalogue was
healthy.

> **Two broken things agreeing on a number is not agreement.**

**Nothing about the near-match was evidence.** The 121 came from a zero-token-overlap
comparison of *feed names to stored names*; the 117 came from *URL slugs to stored names*
through a parser that fit one retailer by accident. They are different measurements of
different things, and their proximity is coincidence.

#### THE MEASUREMENT: THE TROUGH IS WHY THE THRESHOLD IS ZERO

Run against Stylevana's live feed, 14 August, on the rule that will ship (feed name vs
stored name, brand tokens normalised across spacing). **Every row accounted for; no
could-not-parse bucket fired, and it would have been reported if it had.**

```
 15607  not in catalogue (new or unmatched row)
  8796  compared
 24403  TOTAL (feed rows: 24403)
```

| shared tokens | rows | |
|---|---|---|
| **0** | **137** | ← the cohort |
| 1 | 19 | |
| 2 | 6 | |
| 3 | 13 | |
| 4 | 20 | |
| 5 | 90 | |
| 6-8 | 1,026 | |
| **9+** | **7,485** | ← normal matching |

> **ZERO-OVERLAP IS A SEPARABLE POPULATION, AND THAT IS THE REASON THE THRESHOLD IS ZERO.**
> Not "zero seemed right". A monotonic fall from zero would have meant naming drift with
> reassignments buried in its tail and **no principled cut anywhere**. What the data shows
> is 137, then a valley of 19 / 6 / 13 / 20, then a mountain at 9+. **The cut is where the
> data is empty**, and loosening to ≤1 would add 19 rows while crossing no boundary.

**The zero rows are true positives**, checked against the false-positive table below, which
was written before any results: *Romand Lip Mate Pencil* / **Dasique Melting Candy Balm**,
*La Mer Eye Balm* / **Pyunkang Yul Balancing Gel**, *Clarins Double Serum* / **Rohto
Mentholatum hair treatment**. Coherent names on both sides naming different products —
`a43e2ed`'s exact shape, and matching no row of that table.

##### THE BRAND-TOKEN FIX MOVED EXACTLY ONE ROW, AND THAT IS THE ANSWER

`ByWishtrend` versus `By Wishtrend` tokenise to `{bywishtrend}` and `{by, wishtrend}` —
nothing shared. Joining adjacent words before comparison makes the spellings meet without
touching the threshold. **The count went 138 → 137.**

> **One row. So the false-positive rate the brand quirk was hiding is 1 in 138 — 0.7%** —
> and it was itself a true positive tripping for partly the wrong reason. **Measuring the
> fix's effect was worth more than the fix**: it converted "a false positive is waiting
> somewhere in here" into a number.

**And the fix sharpened the separation rather than blurring it.** Before normalisation the
mid-range read 44 / 273 / 904; after, 6 / 13 / 20, with the mass moved to 9+ where it
belongs. **A change that improves a signal's contrast while barely moving its count is
evidence the signal is real.**

#### REFUSING A COMFORTABLE NUMBER, ON THE DAY THIS ITEM WAS WRITTEN

The first run returned **138** against the **121** recorded in `a43e2ed`. Seventeen apart,
same direction, same measurement type — and it would have been comfortable to report as
corroboration that the cohort was stable.

**It was not reported as corroboration**, because 121 was measured on 12 August and 138 on
14 August, and reassignments accumulate: the numbers are two observations of a moving
quantity, not one quantity observed twice. **Proximity is not agreement**, which is this
item's own finding applied within hours of writing it, to a number that would have flattered
the work.

#### A PREDICTION, LABELLED AS ONE

**Not a measurement.** The false-positive rate of the primary signal cannot be measured from
stored data, because feed names are not retained — item 47's retention point again.

What code inspection establishes, and it narrows what the measurement should find:

- **Both name transforms preserve core tokens.** Debenhams' `cleanDebenhamsName` STRIPS
  (gender tags, `" in {variant}"`, `" | Size:"`); Beauty Flash's
  `reconstructBeautyFlashName` EXPANDS a truncated name from the URL slug. Removing tokens
  cannot reach zero overlap while any product word survives; adding them can only raise it.
- **The June rebrand moved `brand`, not `name`.** 94,037 of 98,127 active products have
  `brand` differing from `normalised_brand`, so canonicalisation is near-universal — while
  **90,820 names still start with their brand** and 91,502 contain it.

> **So the three candidate false-positive sources — brand aliasing, shade extraction, size
> canonicalisation — are weaker than they looked. PREDICTION: the measured rate comes back
> low.** Recorded as a prediction so that if the measurement disagrees, the disagreement is
> visible rather than absorbed.

#### WHAT A FALSE POSITIVE WOULD LOOK LIKE, NAMED BEFORE THE RESULTS

Stated in advance so the results cannot be rationalised afterwards. A trip is a FALSE
POSITIVE, not a reassignment, if:

| Shape | Why it is not a reassignment |
|---|---|
| Stored name is a **different language or script** for the same product | K-beauty feeds carry Korean and romanised names for one item |
| Stored name is a **retailer's house naming** of the same product created by another retailer | Product created by YesStyle, matched by Stylevana; both correct, no shared words |
| Feed name is **all-brand, stored name is all-product**, or the reverse | "Isntree" vs "Hyaluronic Acid Daily Sun Gel" — zero overlap, same item |
| A **shade or size** is the only content on one side | "Taupe" vs "Brow Definer" |
| The stored name was **rebuilt** by name-reconstruction and the feed still ships the truncated original | Beauty Flash specifically |

**A true positive looks like `a43e2ed`:** a coherent product name on both sides, naming two
DIFFERENT products — Isntree sunscreen against Euthymol toothbrush set — with the url, image
and description all having moved together.

**If the measurement returns a rate dominated by the table above, the primary signal needs a
brand-token exemption before it ships. If it returns cases like `a43e2ed`, it ships as
designed.**

---

### 85. The Boots coalesce read was a pre-flip run, and the gate is still closed

**Raised:** 13 August 2026 · **Not a defect. Not a null result. The wrong run.**

#### WHAT HAPPENED

Boots' `sibling_coalesce` was flipped at **~10:45 UTC on 13 August**, after YesStyle's 10:00
run and the Baseline A retake. Boots' scheduled import runs at **04:30**. The 13 August run
therefore **predated the flip by about six hours**, and was read as the first post-flip
result.

Its counters, correctly, were all zero: `rows_with_ean` 0, `ean_from_sibling` 0,
`barcode_rejected` 0, `tier1_ambiguous_skipped` 0, `would_link_via_ean` 0. Net links 159,
inside the 153 ± 10 band.

> **Flat links with zero barcodes read as "nothing happened", because nothing had.** The
> band was the success case GIVEN barcodes landing; without them it describes an ordinary
> pre-flip day, which is what it was.

**The run's own output said so: `details.counts.sibling_coalesce = "false"`.** See item 47,
instance 14 — that field sat in the same JSON object as the zeroes and neither party read it
before reasoning toward a mechanism.

#### WHY IT MATTERS BEYOND THE MISREAD

**Item 78's expectations are untested, not falsified.** `rows_with_ean` 0 → ~23,000, net
links flat at 153 ± 10, `tier1_ambiguous_skipped` appearing from nothing, and the
fill-versus-stored gap all still stand exactly as recorded before the flip. Nothing about
them has been checked.

**The sole-supplier before-reading also stands**: 49,356 of 62,323 (79.2%), taken 13 August
with the cycle complete. It remains the correct "before" because no post-flip Boots run has
happened.

> **A pre-flip run read as post-flip does not merely waste a day — it consumes the baseline
> if anyone records it as the "after".** Nothing was recorded, so nothing was lost, and the
> before-readings are intact.

#### THE STAGING HYPOTHESIS IS STRUCK

`storage_passthrough` was suspected and is **disproved**: all four flipped retailers use it,
and three have already gone from zero barcodes to thousands under it. `feed_url` is null for
all four, so every one builds its URL through `buildFeedUrl` with the same 20-column list
including `product_GTIN`; `staging_mode` governs how downloaded bytes are staged into
slices, not which columns are requested. Full account in item 47, instance 14.

#### THE GATE

**Closes at 04:30 UTC on 14 August**, not on the 13th. Held behind it, unchanged:

- the supplements path migration and deploy (items 71, 72)
- the reassignment detector migration and deploy, Stylevana only (item 84)

**Read the Boots run against item 78 before either.** And per the standing instruction on
the detector's first cycle: **read the sample rows before the count** — 137 is the
prediction, and matching it proves less than the rows looking like `a43e2ed` does.

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

---

### 86. "Has another retailer's row" was never the recoverable condition — "is still in that feed" is

**Raised:** 13 August 2026 · **Read-only. Nothing applied, nothing deployed, nothing proposed.**

#### THE REFRAMING, WHICH IS THE FINDING

The Stylevana re-source plan rested on a predicate that was never the right one:

> **"Has another active retailer's row" is not the recoverable condition. "Is still present
> in that retailer's CURRENT FEED" is.**

A `retailer_prices` row persists long after the product leaves a retailer's feed — that is
exactly what `absence_threshold_days` exists to handle — and **such a row re-sources
nothing.** Only rows the importer matched *this run* produce an image write:
`updateActions.filter(u => u.image_url)`. A row nobody touched writes nothing, forever.

**This explains product 7547 correctly for the first time.** Commit `a43e2ed` recorded that
its only survivor was a YesStyle row *last confirmed 30 May*. Nothing was overwriting
Stylevana's wrong image because **the product had left YesStyle's feed months earlier**. The
earlier reading — that this was an import-ordering race — was wrong.

**YesStyle makes this its own class rather than an accident:** `absence_threshold_days =
9999`. Its rows are never aged out, and **100% of its 6,497 stale rows still read
`in_stock = true`** — against 5.6% for Boots. A YesStyle row is the weakest possible
evidence that a product is still stocked, and it is the survivor in the majority of this
cohort. **Recorded in full under item 53**, as the second consequence of the setting whose
first consequence that item already documents.

#### THE ORDERING FACT, WHICH IS WHAT MAKES THE REFRAMING POSSIBLE

`bulk_update_product_images` **overwrites unconditionally**. The only predicate is
`AND (p.image_url IS DISTINCT FROM s.image_url)` — a no-op-write optimisation, **not a null
guard**. Whichever retailer imports last wins the image, every night.

And the order is fixed by cron, with **Stylevana first**:

    03:30 Stylevana · 04:00 Escentual · 04:30 Boots · 05:00 Branded Beauty · 05:30 TOP
    06:00 Gorgeous Shop · 06:30 Beauty Bay · 07:00 Beauty Flash · 07:30 Perfume Click
    07:47 Atelier · 08:00 Niche Beauty · 10:00 YesStyle

**Every other retailer runs after Stylevana.** So any product with a live survivor has
already had Stylevana's image overwritten before the day is out. Measured, not assumed:

| current image | products | with a LIVE survivor row |
|---|---:|---:|
| another retailer's | 2,752 | **2,547 (92.6%)** |
| Stylevana's | 8,745 | **9 (0.1%)** |

#### WHAT THAT MEANS FOR THE FIX — AND IT IS NOT THE HOPED-FOR ANSWER

The self-healing is **real and already complete**. Bucket A (2,752 products) is its
footprint. But the corollary runs the other way:

> **The divergent set is, by construction, exactly the set that cannot self-heal.** Anything
> with a live later survivor has already left it. So the remainder is not a residue the fix
> could clear — it is the population the fix has nothing to work with.

Divergent products, split by survivor state:

| bucket | products |
|---|---:|
| 1. no other retailer row at all — **deploy scope** (GONE_IDS + redirects), not a data edit | **77** |
| 2. survivor row exists but is **STALE** — re-sources nothing | **15** |
| 3. survivor **LIVE** in its current feed — would already be self-healing | **0** |

**Bucket 3 is empty, and the 92.6/0.1 split is what proves that is structural rather than
luck.** Anything with a live later survivor **has already been overwritten**, so the
self-healing is **complete rather than pending**, and the divergent set is exactly the
population that cannot heal.

> **THE ANSWER IS: THERE IS NO FIX TO BUILD.** Not deferred, not blocked, not unmeasured —
> absent. The re-source approach was never a coin toss; the ordering is deterministic and
> favourable. There is simply nothing left for it to act on.

**RECORDED BECAUSE OF HOW IT WAS ARRIVED AT.** The instruction was to **test for the outcome
that would mean no work, rather than assume against it** — to run the query that could
return "the recoverable set is empty, stand down". That is the outcome it returned.

> **The best available answer to a piece of planned work is that it is unnecessary, and it
> only gets found if someone deliberately looks for it.** The default posture on a
> half-built fix is to keep measuring until the fix looks justified; the instruction here
> inverted that. Had the bucketing been run to size the work rather than to test whether it
> existed, buckets 1 and 2 would have been read as "92 products to repair" and the empty
> bucket 3 would have been passed over as an uninteresting zero.

The 92.6/0.1 split was the check on the conclusion, not the conclusion itself — without it,
"bucket 3 is empty" is a number, and it could as easily have meant the query was broken
again. **It is the second time on this thread that an empty result needed proving rather
than reporting.**

#### THE COUNT WAS 95% TOKENISER, AND THAT IS ITEM 84 FOR THE THIRD TIME

First pass: **1,640 divergent**. Corrected: **92**. The difference was never in the data.

Zero-overlap was being scored against slugs like `skitbdn00001-1`, `skitvtc00067-1`,
`bkitmix00296-1` — **opaque SKU codes carrying no words at all.** Zero overlap is
*guaranteed* for those and says nothing whatever about correctness. 1,555 of 1,647 were this.

The token filter that let them through excluded empty tokens and pure digits. `skitbdn00001`
is neither. So:

> **"COULD NOT PARSE" IS NOT ONLY THE EMPTY CASE — REQUIRING TOKENS IS NOT THE SAME AS
> REQUIRING WORDS, AND ONLY THE SECOND IS A PARSE.**

**This is item 84's `n_slug > 0` filter one layer in.** There, rows that produced no tokens
were silently dropped and the survivors reported as clean. Here the rows produce tokens —
non-empty, well-formed, correctly split — and the tokens carry nothing the test can use.
**The filter was fixed at the level it was found and the same defect reappeared one level
deeper**, because "did the parse yield output?" was still standing in for "did the parse
yield *meaning*?".

**1,555 opaque SKU slugs counted as findings**, against 92 real ones. A guard that had been
explicitly repaired for this exact failure mode produced a 17× overcount on its next use.

Those 1,555 are **unmeasured, not clean** — their images may be right or wrong and the slug
cannot say. Recording them as a named bucket rather than folding them into either answer.

#### THE DIAGNOSTIC POST-MORTEM: IT SELECTED A COLUMN THAT DOES NOT EXIST

**Stated first because it is the whole of the failure, and because the fact it exposes is
the one the entire approach rested on.**

The recoverable split in `scripts/atelier-feed-diag.mts` selected
`retailer_prices.image_url`. **There is no such column.** `retailer_prices` carries
`price`, `url`, `in_stock`, `last_updated`, the external ids and the barcode fields — and no
image at all.

> **There is exactly ONE image column in the schema: `products.image_url`. It is
> last-writer-wins, and it is per product, not per retailer.**

That is the fact the re-source plan depended on without ever checking. "Re-source the image
from the surviving retailer" presumes a per-retailer image to source *from*. **There isn't
one.** The only way to learn what image a retailer would supply is to fetch that retailer's
feed; the database cannot answer it, for any retailer, at any time.

So the query **could never have answered the question it was named for** — and it printed
`0 recoverable` instead of failing.

I previously attributed this to the PostgREST embed (`retailers!inner(active)` with
`.eq("retailers.active", true)`). **The embed was the lesser cause and naming it first
framed a design error as a query bug.**

Fixed on `diag/stylevana-recoverable-split`: the block no longer computes a split. **It
prints the divergent ids and stops**, and the derivation moves to SQL where the join is
inspectable and the intermediate counts can be read.

#### STATUS

**CLOSED — no fix to build.** The re-source approach is withdrawn, not deferred: bucket 3 is
structurally empty and there is nothing for it to act on.

The **92 divergent** products and the **77** with no other retailer row **stay as the
deploy-scope population** (GONE_IDS + redirects), unchanged by any of this and **out of
scope tonight**. The 1,555 unparseable remain unmeasured.

The Boots gate closes at 04:30.

---

### 87. A report column that overstated admission, and the ordering that hid it

**Raised:** 14 August 2026 · **Fixed in the same PR.** `scripts/debenhams-taxonomy-report.py`

The report's header described `NEW` as *"rows admitting this value would add — the number
that matters"*. It is computed `not is_beauty(row)`, which is **"rows this value does not
currently keep"**. Different quantity.

They diverge by the order of branches in `is_beauty()`. Branch 1 tests
`merchant_product_category_path`: a row with a **populated** non-beauty path returns `False`
there, and the tier-1 `merchant_category` branch **is never reached for it**. So:

> **Adding a value to `TIER1_MERCHANT_CATEGORIES` can only rescue rows whose path is EMPTY.
> For every other row the addition is a no-op, and `NEW` counts them anyway.**

`Fitness & Nutrition > Vitamins & Supplements` reported `rows 1,560 / already 11 / NEW
1,549` on 14 August. **1,549 is an upper bound on what admitting it would do, not an
estimate of it**, and nothing in the output said so.

#### THE FIX, AND THE PART OF IT THAT IS NOT THE COLUMN

A `T1-ABLE` column now counts, of the `NEW` rows, those with an empty path — the subset a
tier-1 addition could actually rescue. Always `<= NEW`; the gap is what branch 1 kills.

**The default sort changed too, and that is half the repair.** The table sorted by `NEW`,
which put values at the top that a tier-1 addition cannot touch. **A number that was an
upper bound was also the thing ranking the list**, so the most prominent rows were the ones
most likely to be unreachable. It now sorts by `T1-ABLE`.

> **A misleading column is a reading error waiting to happen; a misleading sort order is one
> that has already been made for you.**

Where `T1-ABLE` is 0, admitting the value changes nothing at all, however large `NEW` is.
Verified against the real 14 August feed plus two controlled rows: `NEW 2 / T1-ABLE 1`,
separating a path-populated row from a path-empty one.

#### BOUNDS NOW PRINTED WITH THE TABLE

Three caveats were being carried by whoever remembered them, so they are in the footer:
brand lists are **capped at top-five per value** (absent ≠ absent from the feed);
`--min-rows` omits small values as **unmeasured, not empty**; and counts drift — this value
read **1,496 on 10 Aug and 1,560 on 14 Aug**.

---

### 88. The ~900 did not come from that report — and step 2 of the plan is a no-op

**Raised:** 14 August 2026 · **Read-only. Nothing applied, nothing deployed.**

The instruction was to check whether Boots' ~900 sizing carried item 87's defect **before the
path prefix ships**. It does not. **It came from a different tool, with a different and
larger defect — and underneath both sits something worse.**

#### THE PREMISE WAS WRONG, WHICH IS WHY IT WAS WORTH CHECKING

The ~900 was **not** produced by `debenhams-taxonomy-report.py`. That script reads
`merchant_category` from a Debenhams feed and hard-errors without it. Boots was sized by
**`scripts/atelier-feed-diag.mts` section 5, "ADMISSION PREVIEW"**, lines 341-348. The
fingerprint is decisive: the migration comment's **2,179** is line 348's
`admitted.length - supp.length`, and 3,115 − 936 = 2,179 exactly.

#### THE DEFECT IT DOES HAVE IS BIGGER

Section 5's `isSupp` is a **reimplementation of definition v1.0**, and the same file carries
a v1.1 copy 45 lines later:

| | line 335 (produced the 936) | line 383, same file |
|---|---|---|
| sports tokens | **none** | `whey`, `creatine`, `pre-?workout`, `bcaa`, `protein powder`… |
| dosage forms in the topical veto | `oil`, `gel`, `mask`, `spray`, `butter`, `wash` | same list, but never applied to this count |

Two consequences, **both pushing 936 down and 2,179 up**:

1. **Sports nutrition moved IN scope on 10 August** — two days *before* the 12 August
   measurement. The v1.0 copy has no sports tokens, so **the entire MyProtein / Optimum
   Nutrition population that item 72's brand allowlist exists to route to `sports` was
   counted as non-supplement.**
2. **The topical veto vetoes dosage forms.** `docs/supplements-definition.md:265` already
   lists the measured misfires — *Seven Seas Evening Primrose **Oil** 30 Capsules*, *Boots
   IBS Relief 30 Soft **Gel** Capsules*. Every one is subtracted from the 936.

Additionally `startsWith` (line 341) is not the importer's matcher: `isPathIncluded`
(`index.ts:391-399`) uses **case-insensitive `includes`**. Prefix vs substring.

> **The work list already recorded that `feed-diag` and `categorisation.ts` are two copies
> of the supplements rule that have diverged. The ~900 was never re-derived after that
> finding — it was produced by the divergent copy, in the same session, and carried into a
> shipped column comment.**

#### THE THING THAT OUTRANKS THE SIZING: NOTHING READS THE COLUMN

`retailer_import_config.supplements_path_prefixes` shipped in `#256`.

    $ grep -n "supplements_path_prefixes\|onSupplementsPath" import-awin-feed/index.ts
    (no matches)

    $ grep -n "inferCategorisationForImport" import-awin-feed/index.ts
    2286:    const cat = inferCategorisationForImport(name, brand);   <- TWO arguments

**No branch in the repository wires it.** And the column does not yet exist in production —
the migration is merged but unapplied.

> **The migration's activation plan says step 2 is "write the path prefix into Boots' row —
> that is the change that carries risk". As built, step 2 does nothing.** The importer never
> reads the column and never passes the fourth argument, so `onSupplementsPath` is always
> `false`. Boots rows are also dropped at `index.ts:1979` by `category_path_must_contain`
> before the classifier is reached at 2286, so **two config values must move together and
> nothing says so.**

**AND THE SAFETY PROOF IS WHAT CONCEALS IT.** `supplements-path.test.ts` direction A asserts
that two-argument callers are byte-identical — deliberately, as the inertness guarantee.
That assertion holds just as perfectly when **no caller ever passes the fourth argument at
all**.

> **An inertness proof and a wiring gap are indistinguishable from outside: both output
> "nothing changed".** The test cannot tell "safe because dormant" from "dead because
> unplumbed", and it was written to prove the first.

Item 72's plumbing note concluded *"Zero plumbing"* and cited the call site as line **2193**;
it is **2286**. The line it reasoned about is not the line that runs.

#### ALSO, IN A SHIPPED COLUMN COMMENT

The migration says *"Medicine & Drugs, whose **113** supplement-shaped rows are an accepted
loss"*. `docs/supplements-definition.md:307-325` measured **115** and argues at length that
**they are not supplements** — they are oral medicines, and excluding them "forgoes almost
nothing we want". The comment disagrees with its own source on both the number and the
characterisation, and it is the version that shipped.

#### WHAT THIS DOES NOT CHANGE

**None of it moves the decision.** Item 47 instance 12 already records that proceeding at
~900 was decided on the commercial argument rather than the count. The sizing being soft in
the *generous* direction does not threaten a decision that did not rest on it. **The wiring
gap does**, and that is the one to act on before the prefix is written.

---

### 89. "Fails safe" was a claim about scale, stated without one

**Raised:** 14 August 2026 · **Not actionable for Boots. Live if Debenhams ever ships.**

`SPORTS_BRANDS` (`_shared/categorisation.ts:1337`) holds 18 brands and routes a listed brand
to `sports`, else `supplements`. Its comment:

> *"Fails safe: an unlisted sports brand lands in `supplements`, which is wrong but not
> absurd."*

**True at the scale it was written for and untrue at another, with nothing in it saying
which.** Debenhams carries **Applied Nutrition at 549 rows** in one merchant_category value,
and Applied Nutrition is **not on the list**. Every row would classify `supplements`.

> **"Wrong but not absurd" is a judgement about a small number wearing the clothes of a
> judgement about a rule.** At 15 rows it is a rounding error; at 549 it would be the single
> largest misclassification in the category. **The reasoning is scale-dependent and the
> scale was never stated**, so nothing in the comment tells a future reader when it stops
> being true.

**No change to the list.** Applied Nutrition has ~15 rows at Boots, so this is inert for the
agreed first source. Recorded so that the fail-safe argument is not re-quoted at a scale it
was never tested at.

---

### 90. Debenhams supplements: present, parked, and not fixed the way Boots is

**Raised:** 14 August 2026 · **Parked. Nothing added to any allowlist.**

Debenhams **does** carry sports nutrition — the observation that started this was correct,
and the catalogue holds **zero** Applied Nutrition products.

| merchant_category | rows | kept | top brands |
|---|---:|---:|---|
| `… Fitness & Nutrition > Vitamins & Supplements` | 1,560 | 11 | **Applied Nutrition ×549**, New leaf health ×184, Nature's Truth ×91 |
| `… Fitness & Nutrition > Nutrition Bars` | 14 | 0 | Applied Nutrition ×12 |
| `… Fitness & Nutrition > Nutrition Drinks & Shakes` | 7 | 0 | Swan ×7 — **kettle bundles**, marketplace mis-filing |
| `Food… > Snack Foods > Chips` | 6 | 0 | Applied Nutrition ×6 (protein chips) |

The 11 kept rows decompose exactly and confirm the mechanism: **9 by path** — Debenhams has a
real `Beauty > Skin > Supplements` path — and **2 by brand fallback** (medicube, the only one
of these brands in `BEAUTY_BRANDS`).

**Three reasons it is not a second Boots.** It is **not a second MyProtein source** —
MyProtein does not appear. **Zero of the 18 `SPORTS_BRANDS` are present**; the single
`Warrior` hit is a workwear brand under `Business & Industrial > Protective Aprons`. And the
mechanism differs: **branch 1 kills path-populated rows before the whitelist is consulted**,
so admitting the value would rescue only the empty-path subset — see item 87's `T1-ABLE`.

Bounds: top-five brand capping means an absent brand is **not proven absent**; `--min-rows 5`
omits **746 of 2,228** values as unmeasured; one day's feed, with measured drift (1,496 on
10 Aug → 1,560 on 14 Aug).

**Boots remains the first source and its sequence is unchanged.** One retailer's supplements
launch at a time.

---

### 91. A guard whose passing is consistent with two opposite states

**Raised:** 14 August 2026 · **Fixed the same day.** `import-awin-feed/index.ts`,
`lib/__tests__/supplements-path.test.ts`

> **AN INERTNESS PROOF AND A WIRING GAP ARE INDISTINGUISHABLE FROM OUTSIDE. BOTH OUTPUT
> "NOTHING CHANGED".**

`supplements_path_prefixes` shipped in `#256`. Between then and 14 August:

    grep "supplements_path_prefixes|onSupplementsPath" import-awin-feed/index.ts  -> nothing
    grep "inferCategorisationForImport"                import-awin-feed/index.ts  -> (name, brand)

**No caller anywhere passed the fourth argument.** `onSupplementsPath` took its `false`
default on every row of every retailer, the branch was unreachable, and **writing a prefix
into Boots' config would have produced a clean, silent, entirely convincing no-op** — the
change that the migration itself calls "the change that carries risk".

#### THE SHAPE, WHICH IS THE FINDING

This is not the familiar failure. **It is not a guard that cannot fail** — items 48, 51, 54,
56, 60, 67 — and it is not item 70's guard that fires so often it trains dismissal.

> **It is a guard whose PASSING is consistent with two opposite states: the feature is safely
> dormant, or the feature was never connected.** The assertion is true in both. Nothing about
> a green result distinguishes them, and the deploy/activation split rested entirely on
> reading it as the first.

`supplements-path.test.ts` direction A asserts the two-argument form is byte-identical across
3,601 rows. **That is exactly what "no caller passes four arguments" looks like.** The test
built to prove the deploy was safe doubles as proof the feature was never plugged in, and it
cannot tell you which it is proving.

**The file had already anticipated half of this.** Its own header says: *"WITHOUT B, A IS
SATISFIED PERFECTLY BY A CHANGE THAT DOES NOTHING AT ALL."* Direction B was added for that
reason and it is correct — but **B supplies the argument itself.** B closes the gap at the
FUNCTION boundary and leaves it open at the CALL-SITE boundary, and a unit test cannot see a
call site.

> **KNOWING THE SHAPE WAS NOT ENOUGH TO BE SAFE FROM IT.** The author reasoned the failure
> through, wrote it into the header in plain terms, built the guard it implied — and the
> guard landed **one boundary short** of where the failure actually lived.

**That is the part worth carrying, because it is not a lapse.** The header is correct. B is
correct. The gap is that **B closes it at the FUNCTION boundary and the failure lived at the
CALL-SITE boundary**, and no unit test can reach that: a unit test calls the function, so it
always supplies the arguments itself, so it can never observe that nobody else does.

> **A test suite cannot see its own call sites. Anything that must be true of the CALLERS has
> to be asserted somewhere other than a unit test** — which is why direction C reads source
> rather than behaviour.

#### DIRECTION C

A **source** assertion, because that is where the defect was:

    assert.ok(argCounts.some(n => n >= 4),
      "...DIRECTION A WILL STILL PASS IN THIS STATE — that is why this test exists.")

**Verified by reverting the call to two arguments: C fails, A still passes.** A guard never
seen to fail is a guard nobody has tested.

#### THE OPERATIVE HALF: TWO CONFIG VALUES THAT MUST MOVE TOGETHER

**This half, not the missing argument, is what still blocks activation.** Wiring the fourth
argument was necessary and it is not sufficient: **step 2 remains a no-op even fully wired**,
because Boots' `category_path_must_contain` excludes Boots' own supplements leaf.

`category_path_must_contain` is applied at `index.ts:1979` and `continue`s the row **before
the classifier is reached at 2350**. Boots has one, chosen for beauty, and its intended
supplements leaf is not in it. **So even fully wired, setting `supplements_path_prefixes`
alone still changes nothing** — and nothing in the migration, item 71 or item 72 said so.

Now self-reporting: the importer computes which configured prefixes `category_path_must_contain`
excludes, `console.warn`s them, and returns `supplements_path_unreachable` in the response
alongside a new `on_supplements_path` counter.

> **A zero on that counter is the signature of an unwired feature as much as an inactive one
> — which is the whole finding, so the counter ships with the list that tells them apart.**

#### MATCHER SEMANTICS, STATED RATHER THAN ASSUMED

`isOnSupplementsPath` uses case-insensitive **`startsWith`**; `isPathIncluded` uses
case-insensitive **`includes`**. Deliberate: the column is named *prefixes*, and this one
drives a classification override that bypasses the supplement denylist, so a substring match
would give it a wider blast radius than the column's own comment promises. **Documented at
both sites, because a silent mismatch between two path matchers in one importer is the class
of defect this whole change came out of.**

#### THE MIGRATION COMMENT WAS AMENDED IN PLACE, AND THAT IS BOUNDED

`20260813180000` was corrected in place rather than by a follow-up migration — the `113`
that should read `115`, the "accepted loss" that should read "oral medicines", and the
now-false claim that step 2 is where the risk sits.

**In place is right here for one reason only: the object has never been created.** The column
does not exist in production, so a correction migration would assert against nothing and
report success — the same defect as `WHERE id = 34` matching no rows.

> **The convention reverts the moment it is applied anywhere. Saying so is what stops a
> justified exception becoming a habit** — "we amended that one in place" is exactly the
> precedent that gets cited later, by someone who has not checked whether the object exists.

#### STATUS

**Wired, tested, NOT ACTIVATED.** The migration is still unapplied and every retailer's
prefix list is still empty. Nothing is on the import path.

**Activation still needs BOTH config values**, in this order, after the gated sequence:
apply the migration, deploy, confirm a clean cycle with `on_supplements_path: 0` and an empty
`supplements_path_unreachable`, then write **`category_path_must_contain` and
`supplements_path_prefixes` together**, and read the same two fields again.

---

### 92. The subtree was excluded for the wrong reason, and Boots is ~1,715 not ~900

**Raised:** 14 August 2026 · **Read-only.** feed-diag runs `31790827267`, `31791017515`.

#### THE LEAF-OVER-SUBTREE DECISION WAS JUSTIFIED ON A CONTAMINATION RATIO

The shipped column comment gave the reason for taking the single leaf rather than the whole
`Health & Beauty > Health Care` subtree as: *"the Health Care subtree would admit 2,179
non-supplement rows"*. A contamination argument — most of what arrives is not a supplement.

Measured on the **shipped** rule, over the same feed:

| `Health & Beauty > Health Care` subtree | rows |
|---|---:|
| admitted by the prefix | 3,145 |
| classify as **SUPPLEMENTS** | **3,072** |
| rejected as topical | 73 |

Among the 3,072: **blood-pressure monitors, incontinence aids, supports and braces, first
aid.** The reason is not a tuning failure —

> **The shipped path-first rule has NO NAME-BASED SUPPLEMENT TEST AT ALL. It trusts the
> path.** That is the whole design: a row on a configured supplements path is a supplement
> unless it is visibly topical. Feed it a subtree that is not a supplements path and it will
> faithfully call a wheelchair a supplement.

So the danger was never that non-supplements arrive *alongside*. It is that the rule
**calls almost all of them supplements**.

> **RIGHT CONCLUSION, WRONG MECHANISM — AND THE WRONG MECHANISM IS WHAT WAS WRITTEN DOWN.**

#### WHY THAT IS WORSE THAN AN ORDINARY STALE COMMENT

**Anyone re-deriving "is the subtree safe?" from the stated reason would go looking for a
contamination ratio — and would find a reassuring one.** 73 topical rows in 3,145 is **2.3%**.
On the recorded criterion the subtree looks *cleaner* than the leaf, which shows 28 in 1,743
(1.6%) but at a fifteenth of the volume. A reader checking the stated reason, correctly,
against real data, gets a green light for the exact change the decision exists to prevent.

> **A justification that names the wrong mechanism does not merely fail to help — it aims the
> next reader's measurement at a number that will reassure them.** The stale-comment failure
> mode is silence; this one answers, confidently, and in the wrong direction.

The right question is not a ratio at all. It is: **is this path one where "on it" means
"ingested"?** For the leaf, yes. For the subtree, no. No proportion of anything can answer it.

Section 5 no longer reimplements the rule — it **imports `isSupplementPathTopical`**. Same
feed, same prefix, the shipped classifier:

| Boots leaf `… Fitness & Nutrition > Vitamins & Supplements` | rows |
|---|---:|
| admitted by the prefix | **1,743** |
| supplements per the shipped rule | **1,715** |
| topical rows arriving alongside | **28** |
| of the supplements, `EXCLUDE_PATTERNS.supplements` would drop | 312 (18.2%) |

> **CONFIRMED ON THE FIRST SCHEDULED IMPORT, AND IT IS THE CLEANEST RESULT IN THE WHOLE
> READ.** Boots run 302, 16 August 04:30: `excluded_path_not_in_scope` fell **14,010 →
> 12,296**, a drop of **exactly 1,714** against the 1,715 measured here. **One row.**
>
> This is what a measurement taken on the *shipped* rule buys. The superseded ~900 came
> from a reimplementation; this figure came from importing `isSupplementPathTopical` and
> running it over the real feed, and it predicted production to within 0.06%. **Cite this
> when the method is questioned, not the headline count** — the count is what the rule
> admits, and item 122 is about how little that guarantees.

> **AND THE SENTENCE ABOVE ABOUT THE SUBTREE IS ALSO TRUE OF THIS LEAF.** *"Feed it a
> subtree that is not a supplements path and it will faithfully call a wheelchair a
> supplement"* was used to reject the wide path and never turned back on the narrow one.
> Boots files Viagra Connect, Regaine and thrush pessaries under this leaf. **The medicines
> were inside the 1,715**, not among the 28. See item 122.

**~900 → ~1,715.** The old figure came from a v1.0 copy with no sports tokens — sports moved
into scope two days *before* that measurement — and a topical veto containing `oil`, `gel`,
`butter`, `wash`, which are application words on a beauty path and **dosage forms on a health
one**.

**Copying v1.1 would NOT have fixed it.** v1.1's `APPLY` list still contains `oil` and `gel`.
The shipped path-first branch uses the far narrower `SUPP_TOPICAL_FORM`
(`serum|toner|cream|lotion|mask|shampoo|conditioner|moistur*|body spray`) precisely because a
row already known to be on a supplements path needs a different question asked of it.

> **That is the substance of the feature, and no reimplementation was going to capture it by
> matching regexes. The fix was not a better copy — it was to stop keeping one.**

#### WHAT DOES NOT MOVE

**The decision.** Item 47 instance 12 records that proceeding at ~900 was decided on the
commercial argument rather than the count, and doubling a number that nothing rested on
changes nothing. **The figure should simply stop being quoted as measured** — including in
the migration comment, now amended to say so.

---

### 93. The effect was in a column nobody was watching

**Raised:** 14 August 2026 · **Boots coalesce, after-readings. Rollout complete: five
retailers, all confirmed.** scrape_log 278 against 266.

> **THE AGREED METRIC WAS `would_link_to_existing_product`. THE CHANGE IT WAS MEASURING
> SHOWED UP IN `would_create_new_product`.**

| | 13 Aug (flag false) | 14 Aug (flag true) | Δ |
|---|---:|---:|---:|
| `would_link_to_existing_product` | 159 | 171 | **+12** |
| **`would_create_new_product`** | **249** | **32** | **−217** |
| `tier1_ambiguous_skipped` | 0 | 1,069 | +1,069 |

**The flip's largest effect on Boots is suppressing 217 duplicate product creations**, and it
appears nowhere in the number the rollout was judged on. Item 78 set the success criterion as
movement in net links, with a ±10 band; three retailers were read against that column, and on
the fourth the column moved 12 while the real effect moved 217 in a different one.

> **PREDICTING THE METRIC IS NOT THE SAME AS PREDICTING THE EFFECT.** The prediction that
> links would move was correct. The belief that links were WHERE THE CHANGE WOULD BE was not,
> and nothing in a link count can tell you it is the wrong column — a plausible reading of
> +12 is "small effect, as expected", and it would have been wrong by an order of magnitude.

**This is not the guard-that-cannot-fail family and not item 91's two-states-one-signal.** The
instrument worked, the number was real, the band was reasonable. **The metric was simply
narrower than the phenomenon**, and a metric agreed in advance is the hardest kind to notice
that about, because agreeing it in advance is exactly what makes it credible.

#### THE TIER DECOMPOSITION (item 62 treatment), WHICH IS ORDINARY

Tiers sum exactly on both days, so the +18 against the 153 mean decomposes cleanly:

| tier | 13 Aug | 14 Aug | Δ |
|---|---:|---:|---:|
| EAN | 0 | **66** | **+66** |
| MPN | 0 | 0 | 0 |
| name exact | 42 | 24 | −18 |
| name stripped | 117 | 81 | −36 |
| **total** | **159** | **171** | **+12** |

**54 of the 66 EAN links are REALLOCATION** — rows that already linked, now linking on a
barcode instead of a name, which is better provenance for the same link. **Net new is +12
against yesterday**, +18 against the multi-day mean (yesterday was itself 159, +1.8σ).

**The 217 are deferred, not resolved.** They neither create nor link: they are now recognised
as matching an existing barcode ambiguously and skipped. That is strictly better than
creating duplicates and it is not the same as being matched.

#### FINDING 2: A COUNTER READING ZERO, ACCURATELY, WHILE ROWS WERE LOST

`barcode_rejected: 0` against `rows_with_ean` 22,457 and 21,851 stored. **The 606 is two
gaps with different causes, and only one of them is interesting.**

**586 — by design, and already documented** at `index.ts:2118`: `rowsWithEan` counts rows
*reaching the decision tree*, and several paths `continue` after it. `v6_excluded` 434 +
`skipped_shade_variant` 77 = 511 of them. The residual ~75 is not attributable, because **no
counter records "this row carried an EAN" at the point it was dropped.**

**20 — a different stage entirely.** Every one is a 13-digit string with six leading zeros
(`0000006808785`, `0000007441677`): Boots SKUs left-padded into the EAN field, stripping to
7 significant digits and falling under the EAN-8 floor in `normaliseEan`.

> **`barcode_rejected: 0` IS ACCURATE AND DOES NOT MEAN NOTHING WAS LOST.** Gorgeous Shop
> lost 13% at *validation*. Boots lost 0% at validation and 20 rows at *normalisation* — one
> stage on, where there is no rejection counter at all. A zero on a rejection counter reports
> the health of the stage it watches, and says nothing whatever about the stages it does not.

**The floor's own comment predicted this exactly** — *"It recurs on any feed carrying EAN-8"*
— and it recurred, on the next retailer to be flipped. The rejection is correct: these are
not barcodes. Recording it because a prediction that comes true is worth as much as one that
fails, and this one names its own recurrence condition.

#### A COUNTER THAT INCREMENTS BEFORE THE FILTER IT PRECEDES

`ean_from_sibling` is **22,478** — *higher* than `rows_with_ean` at **22,457**. The coalesce
counter increments when a sibling column supplies a value, before that value is validated and
normalised, so **21 coalesced values were counted and then discarded.**

Harmless at this size and worth writing down: it means `ean_from_sibling` is an upper bound
on coalesce's contribution, not a measurement of it. **Two counters describing one pipeline
from opposite sides of a filter will disagree, and neither is wrong** — the same shape as
item 87's `NEW` versus `T1-ABLE`, and the same remedy: say which side of the filter you mean.

#### FINDING 3: A RATIO CANNOT SEPARATE EXTENDING FROM DUPLICATING

Same definition, complete cycle both times (all twelve retailers, YesStyle last at 10:01):

| | 13 Aug | 14 Aug |
|---|---:|---:|
| Sole-supplier | 49,356 | **59,832** |
| Multi-supplier | 12,967 | 17,568 |
| Total indexed | 62,323 | 77,400 |
| **Share** | **79.2%** | **77.3%** |

**The share fell. The prediction was that it would rise. The premise is what failed** — see
instance 16: Boots shares **7,447 of its 21,827 barcodes, 34%**, with an existing supplier,
against a stated "essentially none".

**THE CORRECTED RULE:**

> **A SINGLE RATIO CANNOT SEPARATE EXTENDING FROM DUPLICATING. THE DECOMPOSITION IS THE
> MEASUREMENT: 66% genuinely new, 34% shared.**

Sole-supplier barcodes rose **10,476 — up 21% in absolute terms**, the largest single
extension the barcode index has had. The share fell anyway because multi-supplier grew 35%
off a smaller base. **That is arithmetic, not a finding**, and a decision rule that reads
"fall = duplicating" converts arithmetic into a false verdict.

Boots both extended and duplicated the catalogue. Those are not alternatives, and the check
should have been specified as two numbers from the start.

**Caveat that travels with it:** this is a whole-cycle delta, not a Boots-attributable one.
Eleven other retailers ran between the readings and ~697 of the sole-supplier movement does
not reconcile to Boots alone.

---

### 94. `updated_at` on an edge function is not a version

**Raised:** 14 August 2026, during the gated deploy · **Caught before acting on it.**

`list_edge_functions` reported `import-awin-feed` last updated **9 Aug 14:09 UTC**. Commit
`bacc711` (#206, "tier 1 never fired — skip ambiguity") landed **9 Aug 15:02**, 53 minutes
later. On the timestamp, #206 was undeployed.

**It was deployed.** `tier1_ambiguous_skipped` — a counter that commit introduced — reads
**1,069** in today's Boots run and is present in the deployed body. The timestamp is behind
the code it describes.

> **A deploy timestamp answers "when did this record change", not "what source is running".
> They are different questions and only one of them decides whether to deploy.**

Had the timestamp been trusted, the plan would have been "deploy six undeployed commits" when
the real answer was three. Both numbers produce the same command; they produce **very
different attribution** if the next cycle looks wrong.

**What settled it was grepping the deployed body for a marker unique to each change:**

| marker | before deploy | after (v154) |
|---|---:|---:|
| `tier1_ambiguous_skipped` (#206) | present | present |
| `reassignment_detect` (#264) | **0** | 1 |
| `isSupplementPathTopical` (#256) | **0** | 2 |
| `isOnSupplementsPath` (#268) | **0** | 2 |

**Note `capsuleIsTopical` was present in BOTH and proves nothing** about #226, which modified
an existing function rather than adding one. **A marker only works if it did not exist
before** — presence of a name the commit merely edited is not evidence it shipped, and that
is the easy mistake in this method.

Same family as item 84's rule, one level out: **"the record says X" and "X is true" are
different claims, and infrastructure metadata is exactly where they diverge quietly.**

---

### 95. The ASIN map's identifier-less population is a scope boundary, not a coverage gap

**Raised:** 14 August 2026 · **Item 60 tranche 1, harvested.** `amazon_asin_map`, 250 rows,
nothing reading it.

| match_state | n |
|---|---:|
| `matched` | **155** |
| `ambiguous` — our duplicate EANs, see item 96 | **8** |
| `unmatched` — identifiers present, none hit. **THE MANUAL PASS** | **45** |
| **`no_identifier_bundle`** | **38** |
| `no_identifier` | 4 |

#### THE BUNDLE FINDING, AND IT IS A DECISION RATHER THAN A DEFECT

**38 of the 42 identifier-less ASINs are medicube multi-packs** — *Collagen Glass Skin Duo*,
*Zero Pore Mud Mask and Brush Set*, *Triple Collagen 3-Step Skincare Set*.

> **AN AMAZON BUNDLE HAS NO MANUFACTURER BARCODE BECAUSE IT IS NOT A MANUFACTURED ITEM. It
> is a merchandising unit Amazon assembled, and no manufacturer ever registered it.**

**These can never match on EAN, however good the pipeline gets.** They are out of scope by
construction, and **the manual pass skips them rather than working them.**

**The distinction lives in the data, not in a report.** `match_state` carries
`no_identifier_bundle` as a value of its own, so a future reader querying "what did we fail
to match?" gets 45 + 4, not 45 + 42. Folding them into one bucket would present 42 rows of
permanent, correct behaviour as 42 rows of unfinished work — **a backlog that can never be
cleared, generated by the schema.**

The residual **4** are genuine single products Amazon holds no barcode for: COSRX AHA 7
Whitehead Power Liquid, medicube Salmon DNA PDRN mask, and two Dr.Melaxin TX items. Those
*are* manual-pass work.

#### THE TABLE SHIPS IN A MIGRATION; THE 250 ROWS DO NOT

`20260814160000_amazon_asin_map.sql` creates the table and loads nothing. The rows went in
separately and are reloadable from `scripts/amazon-asin-map.mjs`.

> **Harvest output is re-derivable MEASUREMENT. Shipping it as DDL freezes a dated snapshot
> into schema history**, where it can never be corrected without a second migration and where
> it will still be asserted as fact years after the listings have rotated.

The table is the artefact worth version-controlling; its contents are a reading taken on
14 August. Same rule that keeps counts, prices and product ids out of committed copy — this
is the schema-history instance of it.

#### THE TRUNCATION BOUND — 155 IS A FLOOR

| brand | ASINs enumerated | complete? |
|---|---:|---|
| **COSRX** | **100** | **NO — hit the ceiling exactly** |
| **medicube** | **100** | **NO — hit the ceiling exactly** |
| Beauty of Joseon | 38 | yes, ended on a short page |
| Dr.Melaxin | 39 | yes, ended on a short page |

**`SearchItems` caps at 10 pages of 10.** Two brands landing on exactly 100 is the signature
of a ceiling, not of a catalogue that happens to be that size — and **a short final page is
the only end-of-results signal the API offers**, so a brand that fills page 10 is
indistinguishable from one with a thousand more products.

> **Two of four brands are cut by an unknown amount. 155 matched is a FLOOR, not a total, and
> nothing in the output says by how much.**

**Raising it needs partitioning, not more pages** — keyword or browse-node subdivision so
each query returns under 100. That is a change to the harvester, not a rerun of it.

#### THE STORE LIST WAS WRONG: FOUR BRANDS, NOT FIVE

Item 60 recorded five official stores, the fifth unnamed as `67C2B44D…`. **It is COSRX.**
Its seed `B0CYS776TR` returns *COSRX Ultra-Light Invisible Sunscreen SPF 50*, brand `COSRX`.
Two storefronts, one brand. The confirmed set is **COSRX, medicube, Beauty of Joseon,
Dr.Melaxin** — and four of four are in the click-engagement top fifteen, which strengthens
the brand-led selection principle rather than weakening it.

#### A NEW SDK TRAP, RECORDED BECAUSE IT PRODUCES A PLAUSIBLE ZERO

`getItems(marketplace, body)` takes the request **positionally**.
`searchItems(marketplace, opts)` takes it wrapped as `opts.searchItemsRequestContent`.

Passing the request directly — the shape its sibling method uses — sends an **empty body**
and returns `400 PartnerTag should be provided` **for a request that plainly set
partnerTag**. The error names a field the caller supplied, so it reads as a credential fault.

> **Every brand then reports "0 items" and the harvest looks like four brands with no
> products.** The only thing separating "this brand has nothing" from "this call was never
> validly made" was printing the 400 body.

**AND THAT IS THE SAME SHAPE AS EVERYTHING ELSE ON THIS LIST.**

> **A failure that renders as a plausible empty result.** Items 48, 51, 54 and 56 are clean
> outputs that are quietly incomplete. Item 84 is a lookup returning nothing scored as "the
> answer is none". Item 87 is a whitelist addition that admits nothing counted as though it
> would. Item 91 is an unwired feature indistinguishable from a dormant one. **This is a
> 400 on an unsent field rendering as four empty brands.**
>
> The mechanisms are unrelated. **The signature is identical every time: zero, arriving
> without complaint, in a shape the reader was already prepared to accept.** A harvest of a
> brand with no products, a category with no rows, a config with no effect — each is a
> perfectly ordinary thing to find, which is precisely why none of them prompts a second
> look.

The harvester therefore **logs the error body rather than counting the result**, and prints
`enumerated / returned / absent / no identifier` separately so a zero in any one of them has
a neighbour to be checked against.

---

### 96. One barcode, several products: 8,606 EANs, and it is ours

**Raised:** 14 August 2026 · **Surfaced by Amazon, caused by us.** Read-only.

#### THE SPLIT LEADS, BECAUSE IT DECIDES WHAT THIS IS

**8,606 barcodes resolve to more than one product. They are not one population:**

| | EANs | what they are |
|---|---:|---|
| all products share one brand | **7,907 — 91.9%** | **duplicate products — MERGE CANDIDATES** |
| products span brands | **699 — 8.1%** | **mostly NORMALISATION ARTEFACTS** |

> **A GENUINE BARCODE COLLISION AND AN UNNORMALISED BRAND STRING PRODUCE IDENTICAL ROWS.**
> Counting them together overstates the alarming class by roughly **twelvefold**.

Sampled, the cross-brand cases are the same duplicate wearing two brand spellings:
`Aramis Intuition EDP` filed under both **Aramis** and **Estee Lauder**; `Colour Me Black`
under **Colour Me** and **Milton Lloyd**; Metal Detox under **L'Oréal Paris** and **L'Oréal
Professionnel**; `NUXE Reve de Miel` under **NUXE** and **`Gorgeous Shop`** — *a retailer
name sitting in a brand field*.

**One case in the sample is a real collision:** `192608243214` on a Doll Smash lip oil and a
Morphe lip mousse.

> **So ~92%, and most of the remaining 8%, are one defect: THE SAME PRODUCT ENTERED TWICE.**
> The barcode is not wrong. The catalogue has two rows for one thing.

#### HOW IT SURFACED

The ASIN harvest hit 8 ASINs whose barcode resolved to more than one catalogue product. The
worst is **`8809525246014` on FOUR Beauty of Joseon products** — Ground Rice and Honey Glow
Mask, plus **three** separate Centella Asiatica Calming Mask rows (3075, 142666, 143920).

**Amazon did not cause this and it is not an Amazon problem.** Measured catalogue-wide over
`ean_product_index`'s population — active, enabled retailers:

| | |
|---|---:|
| Distinct barcodes | 77,400 |
| Resolving to exactly one product | 68,794 |
| **Resolving to MORE than one** | **8,606 — 11.1%** |
| Product rows involved | **18,103** |
| Worst case | 5 products on one barcode |

**This is the same population tier 1 refuses to link.** Boots' 14 August run skipped
**1,069** rows as `tier1_ambiguous_skipped`, and item 93 records that the coalesce flip's
largest effect was suppressing 217 duplicate creates.

> **THE TIER-1 GUARD IS CORRECT AND IT IS NOT THE FIX. It refuses to link them, which is
> right. It leaves them unresolved, which is the item.**

A guard that declines to guess is doing its job; it is not doing anyone's else's. Every night
it re-encounters the same 8,606 barcodes, makes the same correct refusal, and the underlying
duplication is unchanged in the morning. **Nothing in the counter distinguishes "skipped
because ambiguous" from "skipped because ambiguous for the four hundredth time"** — it
declines to guess, every night, on a defect that is not getting
smaller.

#### NOT ACTIONED

**No merges, no detachments, nothing proposed on these numbers.** Merging is a decision, and
18,103 rows is far past the scale at which a bulk pass should be run off a single
measurement. Recorded so the next person to meet `tier1_ambiguous_skipped` finds the size of
what it is skipping, and so the Amazon map's 8 `ambiguous` rows are read as a symptom rather
than a mapping failure. Their `product_id` is the **lowest matching id and explicitly not a
decision** — the row's `notes` says so.
### 97. What survives of item 60's partial-coverage finding, and a matcher measured against ground truth

**Raised:** 14 August 2026 · **Read-only. Nothing promoted, `human_verified` false on all 250.**

#### THE INSTRUMENT, WHICH IS THE REASON ANY OF THIS IS QUOTABLE

The 155 EAN-confirmed rows are **ground truth, not a sample the matcher was tuned on**: their
`product_id` was established by barcode and never by name. Running a name matcher over them
says exactly how often it would have been right on its own.

| | top-1 | band: score ≥0.80 **and** margin ≥0.20 |
|---|---|---|
| first pass | 70.3% | — |
| + set-ness and pack-count discriminators | **74.8%** | **94.1% precision** |
| + size tiebreak | 76.1% | **92.0% — REJECTED** |

**The predicted boundary family broke it, and broke it at the top.** The first pass's
*highest-confidence* errors were a single mapped onto a **ten-pack** (3073 against 3074,
score **1.00**) and a product mapped onto a **gift set** (7741 against "…(3ea) Set", 0.93) —
because pack count lived in exactly the tokens the size stripper had already removed.

> **THE SIZE TIEBREAK WAS REJECTED ON THE MEASUREMENT: +2 rows overall while band precision
> fell 94.1% to 92.0%. A CHANGE THAT IMPROVES THE AVERAGE BY DEGRADING THE PART YOU ACT ON
> IS NOT AN IMPROVEMENT.**

Nothing is proposed from the average. Everything is proposed from the band, so the band is
the number the change has to justify itself against — and it did not.

> **MARGIN, NOT SCORE, IS THE DISCRIMINATOR. Near-ties (margin < 0.05) are 64% correct AT
> ANY SCORE, including 1.00.** A perfect score against two catalogue rows says the product is
> certain and the row is not — which is item 96 arriving from a different direction.

#### WHAT SURVIVES OF THE PARTIAL-COVERAGE FINDING

Item 60 measured 5 of 6 and read the miss as a coverage gap. Over 250 ASINs, with the 38
bundles excluded as out of scope by construction (item 95), **212 in scope**:

| | ASINs | share |
|---|---:|---:|
| matched by barcode | **163** | 76.9% |
| product present, barcode absent — relisting + row-choice | **20** | 9.4% |
| product likely present, row uncertain — variant | 4 | 1.9% |
| **unknown, needs a human** | **23** | 10.8% |
| **confirmed absent** | **2** | **0.9%** |

> **SURVIVES: barcode coverage is genuinely partial — 163 of 212, and 49 rows carry no usable
> barcode link. That is a bigger gap than 5-of-6 implied, not a smaller one.**
>
> **DOES NOT SURVIVE: the inference that the gap is a PRODUCT gap.** Product presence is
> established at **≥86.3%** and confirmed absence is **0.9%**. The flagship example the
> inference rested on is in the catalogue with nine retailers.

**The two genuine absences are a Beauty of Joseon colour-correcting sunscreen and a
Dr.Melaxin TX Ampoule RX.** Neither is a flagship. The claim that non-matches are where
sought-after products sit now has **no supporting instance**.

**STRENGTHENED, not weakened: the manual pass is part of the pipeline.** 23 unknown, 8
row-choices and 4 variants is more human work than item 60 anticipated — it is just a
different kind. **The work is disambiguating rows we already have, not sourcing products we
lack.**

#### THE FOUR NO-IDENTIFIER SINGLES, VERIFIED BY EYE

**All four checked individually, including the two the band called clean.** A 94% band is a
different proposition where there is no barcode to catch the 6%: for these rows the name is
not corroboration, it is the entire evidence.

| ASIN | verdict |
|---|---|
| `B00OZ9WOD8` AHA 7 Whitehead Power Liquid | **CONFIRMED → 172.** Name verbatim, size agrees (3.38 fl.oz = 100ml), 6 live retailers, two catalogue barcodes of its own |
| `B0DSFT57NC` TX Peeling Toner | **CONFIRMED → 81323.** Distinctive name matches, size agrees at 150ml. **Sole retailer is YesStyle — checked for staleness given `absence_threshold_days = 9999` (item 53) and the row was touched by today's run.** |
| `B0H7F9WXJD` Salmon DNA PDRN jelly mask | **UNCLEAR, left for a human.** Candidates 93127 (Stylevana only, **no barcode at all**) and 6174 (nine retailers) look like duplicates of each other, and 6174 is already mapped from a different ASIN. Promoting would add a second ASIN to a product that has one — harmless, but a decision |
| `B0DSFKRMG9` TX Ampoule RX | **CONFIRMED ABSENT.** The catalogue holds **11 Dr.Melaxin ampoules and no TX ampoule**; the TX line runs Cream, Peeling Toner, Serum Cleanser and two Astaxanthin items. Nearest scored 0.40 |

**The eye check changed one of the two "clean" verdicts into a caveat** — 81323's only
retailer is the one whose rows never age out — which is the argument for doing it.

#### STATUS

Nothing promoted. `human_verified` stays false on all 250 until Robbie works the list.
Promotion into `products.amazon_asin` is a separate step after that.
#### AMENDED 15 AUGUST: BOTH GAPS FIXED BEFORE THE SCRIPT WAS MERGED

This item was written on a branch that stayed open. **In the meantime the human pass found
the two matcher gaps it names, and the branch still carried the matcher without them** — so
merging as-was would have committed a matcher already known to miss cases a person had
found. Both are now fixed in the same PR, and re-measured per item 79:

|  | top-1 | band (>=0.80, margin >=0.20) |
|---|---|---|
| as committed on the branch | 116/155 (74.8%) | n=51, **94.1%** |
| **with both gaps fixed** | **117/155 (75.5%)** | n=51, **94.1%** |

**A strict improvement** — one row gained, nothing lost on the band anything is proposed
from. Contrast the size tiebreak, which gained two and cost 2.1 points and was rejected.

> **BUT NOTE HOW LITTLE THE CORPUS SAYS ABOUT IT.** Both gaps were found in the 49 UNMATCHED
> rows, not in the 155 EAN-confirmed pairs the matcher is measured against. The corpus moves
> by **one row**. **The same reason these defects were not found by measuring is the reason
> measuring barely confirms the fix: the corpus cannot see what it does not contain.**
>
> The justification is the two named cases. The measurement's only job here was to prove
> nothing was broken in exchange.

#### AND THE ITEM NUMBER WAS A HOLE FOR A DAY

Item 97 existed only on this branch while items 98 to 116 were written and merged around it,
so `main` read 95, 96, **98**.

> **A hollow item number is worse than a missing one: the list reads as complete while the
> item exists only in a branch.** Same shape as a document that is named but not linked —
> the reference resolves to nothing and nothing says so — arriving in the numbering itself.



---


---

### 98. A guard correct by design and blind to the case that motivated it

**Raised:** 14 August 2026 · **Robbie found the defect on the site.** Nothing detached.

The ASIN name matcher gained a pack-count discriminator on 14 August, written for exactly
one failure family: **a single mapped onto a multi-pack.** Hours later that family turned up
live on product 6174 — and the discriminator does not catch it.

| row on 6174 | product pack | row states | flagged? | clickout |
|---|---:|---:|---|---|
| Stylevana **£5.90** | 4 | **nothing** | **NO** | one mask |
| Atelier De Glow £14.00 | 4 | 1 | yes | one sheet |

> **IT CATCHES THE £14 ROW NOBODY WOULD CLICK AND MISSES THE £5.90 ROW THAT IS THE HEADLINE
> PRICE.** The one it flags is the eighth-cheapest of nine and invisible in the comparison.
> The one it misses is the number on the page.

#### AND THE DESIGN CHOICE THAT CAUSES IT IS STILL CORRECT

The rule penalises a pack mismatch **only when both sides state a count** — *"an unstated
count is unknown, not one."* Stylevana's row states none, so it never fires.

**Treating "unstated" as 1 would catch this row and misfire on every single-unit product
that simply does not say so** — which is most of them. The alternative is worse, measurably
and by a wide margin. **The rule should not change.**

> **THIS IS ITS OWN SHAPE, NOT A TUNING PROBLEM. A guard can be correct by design, sound in
> its reasoning, right to keep — and blind to the exact case that motivated it.**
>
> It is not item 91's *passing is consistent with two opposite states*: this guard's silence
> is truthful, because the data genuinely does not say what pack the row is. It is not
> item 70's *fires so often it trains dismissal*: it fires rarely and accurately. **It is a
> guard whose precondition — that both sides state a count — is absent precisely where the
> damage is greatest**, because a retailer selling a single under a multi-pack's name has no
> reason to state the count at all.

**Where the correction has to come from instead:** the row carries no `ean` and no `mpn`, so
it reached 6174 through name or URL matching with no identifier to check it against. The
signal that would have caught it is not in the name at all — it is that **Stylevana lists
this product three times and we placed the three listings on three different products**
(46269 → 982 correctly, 68593 → **6174 wrongly**, 84491 → 93127 correctly). A same-retailer
duplicate-listing check sees that; a pack-count comparison never could.

---

### 99. Pack-size mismatch across the catalogue: seven confirmed inside a 2.8% window

**Raised:** 14 August 2026 · **Read-only. A floor on a class of unknown size.**

> **THE BOUND LEADS, NOT THE COUNT. Only 3,658 of 129,506 live retailer rows — 2.8% — state
> a pack count on BOTH the product name and the row's URL, which is what the test requires.
> Everything below is measured inside that window.**
>
> **The case that started this is not in the window.** 6174's Stylevana row states no count
> in its URL and therefore cannot be tested by the very detector written to find it.

| | |
|---|---:|
| live rows scanned | 129,506 |
| **testable at all (both sides state a count)** | **3,658 — 2.8%** |
| mismatched | 81 rows / 77 products |
| mismatched **and smaller** **and the cheapest in-stock row** | 19 |
| **of those 19, confirmed genuine by eye** | **7** |

**The seven** — all the same shape as 6174, all with the cheap wrong row as the headline
price: four **COW soap** multi-packs against Stylevana `…-1-pc` rows (£4.79–£7.79);
**81482** ETUDE 5-mask bundle against a Stylevana **`deal-…-1pc`** row at **£1.69**;
**94098** NINELESS 5ea against `…-1ea` at £1.44; **92401** numbuzin 5-pack against `…-4pc`.

**37% precision on the sharpest bucket. The eleven false positives, every cause:**

| cause | example |
|---|---|
| decimal split by hyphen normalisation | `4x2.5g` → "4x2 5g" → read as 2 |
| decimal split, again | `6 x 1.8ml` → read as 1 |
| "one pack **of** N" read as pack 1 | `1pack 48 patches` |
| same | `1pack 60pcs` |
| pack token in the PRODUCT name | Milk Touch `6s` against url `60pcs` |
| transposed dimensions | `10 x 6ml` vs `6 x 10ml` (×3 rows) |
| **a year read as a pack count** | `Beauty Box **2025**` → 2,025 |
| multiplicative count | `16pcs 5ea` = 80, read as 16 |
| **matched inside a UUID** | `…-07ea-4095-8ae4-…` → read as "7ea" |

> **THE UUID CASE IS ITEM 95'S OPAQUE-IDENTIFIER TRAP IN A NEW PLACE.** There it was
> `skitbdn00001` scored as a zero-token name; here it is a GUID fragment scored as a pack
> count. **Same mistake, different regex, different file, three weeks apart: a run of
> characters that merely LOOKS like the thing being extracted.** Any extractor run over an
> opaque identifier will find something, and finding something is not evidence.

**Not built, not scheduled.** The detector exists only as the query in this item. At 37%
precision it is a research aid, not a guard, and shipping it as one would put a 63%
false-positive stream in front of whoever reads it — item 70's failure mode exactly.

#### STYLEVANA IS 15 OF THE 19, AND `deal-` APPEARS IN TWO SEPARATE CASES

Both 6174 and 81482 are Stylevana `deal-` prefixed listings that duplicate a single-unit
product onto a multi-pack. **Noted, not investigated.** It looks like a specific feed
behaviour rather than a general matching problem, and it deserves its own scope.

#### 92406 — FOUND BY A DETECTOR LOOKING FOR SOMETHING ELSE

Product 92406 is *numbuzin No.1 Pantothenic B5 Hyaluronic Active Cleansing*; its Stylevana
URL is `…numbuzin-no-1-dewy-glow-spa-sheet-mask-27g-4ea`. **A different product entirely.**

> **That is a MIS-ATTACHMENT, not a pack mismatch**, and it is in this list only because the
> two numbers happened to disagree. A detector aimed at pack counts surfaced a wrong-product
> match as a side effect — **which says the wrong-product population is not being measured by
> anything, and turned up here by luck.**

---

### 100. One product, two manufacturer barcodes — the inverse of item 96

**Raised:** 14 August 2026 · **Benign. Recorded so it is not mistaken for item 96.**

Product 6174 carries **two distinct EANs across its retailers** — `8800256114399` (Gorgeous
Shop, Beauty Flash, YesStyle, Atelier) and `8800289474873` (Debenhams, Perfume Click,
Beauty Bay, Superdrug) — **both on genuine 4-packs.**

| | |
|---|---|
| **item 96** | many products sharing ONE barcode — 8,606 barcodes, 11.1%. Ambiguous, blocks tier 1 |
| **this** | ONE product with TWO barcodes, split cleanly across retailers |

**This costs almost nothing.** Both codes resolve to the same product, tier 1 links either
correctly, and no ambiguity arises. **The only cost is that neither code alone finds all
nine retailers** — a barcode-keyed query for this product returns a partial retailer set
depending on which code it starts from, with nothing indicating the set is incomplete.

Worth knowing before anyone builds a barcode-keyed coverage measure and reads a partial
answer as a complete one.

---

### 101. The feed-name retention gap now blocks two durable fixes, not one

**Raised:** 14 August 2026 · **Not built. Re-scoped, not re-specified.**

`retailer_prices` stores what we DERIVED from a feed row — `product_id`, `ean_normalised`,
`external_product_id`, `url` — and **not the feed's own product name.** The name is read
during import, used for matching and categorisation, and discarded.

**It was already recorded as the durable target for the reassignment detector** (item 84):
the detector's primary signal is shared name tokens between the feed row and the stored
product, and **that signal cannot be replayed after the fact**, because one side of the
comparison no longer exists. Every re-derivation has to re-fetch the feed.

**It has now acquired a second dependent, and that changes what it is.**

> **Option (c) for product 6174 — a `name_excludes` entry that drops Stylevana's `deal-`
> duplicate at import — is the durable fix, and it is blocked on the same missing field.**
> `name_excludes` matches on the feed's product name. We hold the URL slug
> (`deal-medicube-pdrn-pink-collagen-gel-mask-28g`) and not the name the rule would test.
> Excluding on `"deal"` alone would drop every Stylevana promotional listing, including
> legitimately discounted products.

> **TWO INDEPENDENT DURABLE FIXES, DIFFERENT ITEMS, DIFFERENT MECHANISMS, BLOCKED ON THE
> SAME ABSENT COLUMN. That stops it being the exact version of one item and makes it a
> blocker.**

#### WHAT IT WOULD COST — measured 14 August 2026

| | |
|---|---|
| schema | **one nullable `text` column** on `retailer_prices` |
| write path | **one assignment at import**, on the insert and the bulk-update paths |
| rows | 161,960 (129,506 on live retailers with URLs) |
| current heap | **54 MB**; 101 MB with indexes |
| current row width | ~350 bytes |
| catalogue name length | avg **52.4** chars, max 223 — feed names run longer, call it ~65 |
| **estimated growth** | **~11 MB heap, +19% row width, +11% total with indexes** |

**No TOAST pressure**: names of this length stay inline. **No index** is implied — neither
dependent needs one; both scan a feed's own rows.

#### THE COST THAT IS NOT STORAGE

> **THE COLUMN UNBLOCKS NOTHING RETROACTIVELY.** Every existing row would have it NULL, so
> both dependent fixes stay blocked until at least one import cycle per retailer has run —
> and the reassignment detector's baseline could not be recomputed for any period before it
> shipped. **It buys future replay, never past replay**, which is the same property that
> made item 78's before-readings have to be taken before the flip rather than after.

**Not built, and not proposed here.** Recorded so the next person to hit it finds two
dependents rather than one, and does not scope it as a detector improvement.

---

### 102. Pattern D answered: NO, on the distribution rather than on caution

**Raised and closed:** 14 August 2026 · **Nothing merged.**

**Pattern D** — same brand, both products without a usable EAN, names differing by exactly
one token. Population: **22,603 products** have a live retailer row and no usable barcode
(20.9% of 108,324). Within it, **1,724 pairs** where one name is the other plus one token.

**The question was whether the differing token is marketing (a normalisation rule) or a real
distinction (not one). It is a real distinction, and not marginally:**

| the differing token is | pairs | share |
|---|---:|---:|
| **OTHER** — 569 distinct tokens | **830** | **48.1%** |
| NUMBER — size, shade code, pack count | 651 | 37.8% |
| FORM/QUANTITY — refill, double, mini, travel | 123 | 7.1% |
| SHADE-LIKE — light, medium, dark, taupe | 114 | 6.6% |
| **MARKETING/VERSION** | **5** | **0.3%** |

**Sampled, `OTHER` is overwhelmingly SHADE NAMES:** `n26`, `porcelain`, `fudge`, `cockney`,
`taupe`, `caramel`, `bubblicious`, `c10.5` — plus real formulation words (`waterproof`,
`rich`, `plumping`, `cleansing`).

> **`M.A.C Lustreglass Sheer-Shine Lipstick Cockney` collapsing into `M.A.C Lustreglass
> Sheer-Shine Lipstick` IS THE BULK OF THIS POPULATION, NOT AN EDGE CASE.** A merge rule on
> one-token difference would destroy shade-level SKUs at scale.

**Closed as answered NO — on the measured distribution, not on caution.** The 0.3% that is
marketing does not support a rule; it supports four hand-checked merges, and those are
covered below.

#### THE REFILL CORRECTION, WHICH IS THE PROCESS FINDING

`refill` was classified as **MARKETING/VERSION** in the first pass. **A refill is not a
marketing variant of the thing it refills — it is a different product**, sold without the
container. It was **63 pairs, the second-largest single token**, and moved to FORM/QUANTITY
before any number was quoted.

> **Had it stayed, "actionable" would have read 68 pairs instead of 5 — a TWELVEFOLD
> inflation, and every one of the extra 63 a merge that destroys a real product.**

**A classifier's own category labels are a place this mistake gets made, and the only thing
that catches it is reading them.** No test fails; the bucket has a plausible name, a
plausible count, and a wrong member. Same family as item 99's eleven false-positive causes,
but one level up: not a bad extraction, a bad *category*.

#### WHAT WAS NOT MEASURED

**Only the SUPERSET case** — one name's tokens plus one extra. **Substitution pairs**
(`rose` ↔ `beige`, same length) were not measured.

> **They would strengthen the NO rather than change it**, since substitution is where shade
> variants live most densely — but **1,724 is not the whole one-token population**, and the
> conclusion is drawn from a measured part of it.

#### THE FOUR `[DEAL]` PAIRS BELONG TO ITEMS 98 AND 99

All four marketing-token pairs are Stylevana `[DEAL]`-prefixed duplicates —
`[DEAL]Arencia Holy Hyssop`, `[DEAL]Round Lab 1025 Collection`,
`[DEAL]BEAUTY OF JOSEON Relief Sun`. **Each is 1 retailer against 1 retailer, so none costs
a split comparison.** Noted against items 98 and 99 rather than opened.

> **AND THE `deal-` PATTERN HAS NOW PRODUCED A THIRD KIND OF DAMAGE.** In item 99 it
> mis-attached a row to the wrong product (6174, 81482). Here it created **an entire
> duplicate product**: product `126` is Stylevana's
> `deal-cosrx-full-fit-propolis-light-ampoule-30ml`. Same feed behaviour, three distinct
> failure modes, and only the first was ever scoped.

---

### 103. Two storefronts, one catalogue: Gorgeous Shop and Beauty Flash

**Raised:** 14 August 2026 · **Measured, not actioned. Bears on every depth claim.**

Investigating 81755's price spread surfaced that its Gorgeous Shop and Beauty Flash rows
carry the **same `external_product_id` (39795)** and the **same URL slug on different
domains**. Product 6174 showed the same thing (both `45918`). Measured across everything the
two retailers share:

| | |
|---|---:|
| products carried by both | 7,243 |
| **carrying the SAME `external_product_id`** | **6,383 — 88.1%** |
| of those, priced differently | 3,926 |
| mean price gap where ids match | **£6.05** |

Their AWIN merchant ids are adjacent (53379, 53381).

> **88.1% is not a coincidence of numbering. These are two storefronts over one product
> catalogue, priced independently.**

**Why it matters, and it is not that anything is wrong.** Both are real shops a shopper can
buy from, and their prices genuinely differ. But **a product showing four retailers where two
are these may offer three distinct sellers**, and two expensive rows from one operator are
not two independent signals about the market price.

**Not actioned.** Nothing here says to drop or merge a retailer. Recorded so that comparison
DEPTH figures — "carried by N retailers" — are known to overstate seller diversity on the
6,383 products where these two overlap, and so nobody derives a market-price confidence from
what is effectively one source counted twice.

---

### 104. One manufacturer code and one reseller code — a property of a feed, not of barcodes

**Raised:** 14 August 2026 · **Recorded above the merge it enables, because it outlives it.**

Products `126` and `81755` are the same COSRX ampoule under two barcodes. That looked like
**item 100** — one product, two manufacturer codes, benign. **It is not.**

| code | on | shape |
|---|---|---|
| **8809598450820** | YesStyle, Gorgeous Shop, Beauty Flash | 13-digit EAN-13, **Korean GS1 prefix 880** |
| 648722973372 | Stylevana only | **12-digit, US-style, not the manufacturer** |

**Measured across every active retailer — how many of each supplier's barcodes are 12-digit
reseller-style codes rather than manufacturer EANs:**

| retailer | barcodes | reseller-style 12-digit | Korean 880 |
|---|---:|---:|---:|
| **Stylevana** | 6,668 | **967** | 3,209 |
| Perfume Click | 10,073 | 271 | 306 |
| Boots | 21,851 | 327 | 553 |
| **YesStyle** | 13,812 | **5** | 7,893 |
| **Atelier De Glow** | 547 | **0** | 544 (99.5%) |

> **TWO CELLS IN THIS TABLE DO NOT REPRODUCE ON 15 AUGUST — see item 121.** Stylevana's
> 967 measures 2,559, and 967 is exactly the Escentual figure in that re-measurement.
> Atelier's 0 measures 1. **The argument below is unaffected** and no one has chased it;
> cite the table for its point, not for these numbers.

> **THIS IS NOT "TWO BARCODES MEANS TWO PRODUCTS". IT IS ONE MANUFACTURER CODE AND ONE
> RESELLER CODE SITTING IN THE SAME FIELD.**
>
> **It is a property of one retailer's feed, not a property of barcodes**, and it materially
> weakens "different barcode → different product" as a rule. A code that no manufacturer
> issued is not the manufacturer saying anything.

**Why this matters beyond one merge.** A different barcode is normally the strongest possible
evidence that two rows are different products, and it is the reason tier 1 is trusted above
every name rule. **On a feed that supplies reseller codes, that evidence is not present even
though the field is populated** — and nothing on the row says which kind of code it is.
Length and prefix are the only signal, and neither is checked anywhere.

**Independent corroboration, from a different direction:** `amazon_asin_map` already resolves
ASIN `B07ZGJQZ8G` to **81755** via `8809598450820` — a barcode-led agreement, reached without
reference to either name, that 81755 is the canonical product.

#### THE MERGE FUNCTION'S SCOPE IS NARROWER THAN A MERGE IS — RECORDED ABOVE THE MERGE

`fmb_soft_merge_group` moves **`retailer_prices` and `price_history`**, writes
`product_merge_log`, sets `merged_into`/`merged_at`, and asserts no orphan prices. That is
all it does, and **two of the things it does not do read as though it does them.**

**1. A LOG REPORTING A COUNT IT NEVER COMPUTED.** The insert into `product_merge_log`
hardcodes the literal:

    saved_routines_updated  ->  0

> **A zero in a column named "saved_routines_updated" reads as "checked, none found". The
> check does not exist.** Every merge ever run has logged that zero, and it is the same
> family as a guard that measures a log line rather than the thing the log line describes —
> the artefact is real, the number is real, and it is evidence of nothing.

**And the field it names is the one a column scan cannot find.** `saved_routines` stores
products inside a **JSONB `routine` column and has no `product_id` column at all**, so a
sweep of `information_schema` for `product_id` — the obvious safety check, and the one run
here — **returns clean while product ids sit in a blob.** Checked by text search instead:
13 saved routines, none referencing 126, 81755 or 91868.

**2. THE GUARD THAT SITS ADJACENT TO THE GUARD YOU WOULD INFER FROM IT.** The function
raises `'a member is already merged'` if the keeper or any removed product has
`merged_into` set. That reads as chain protection. **It is not.**

> **It guards MEMBERS. Chains are made by CHILDREN.** 91868 was already merged into 126;
> it is not a member of `(81755, [126])`, so the check never looked at it. **The merge would
> have succeeded and left `91868 -> 126 -> 81755` silently** — item 52's known-bad shape,
> created by the function whose one validation appears to be about exactly this.

#### WHAT REFERENCES product_id AND IS OUTSIDE THAT SCOPE

**Nine live tables**, none of which any merge has ever repointed:

`amazon_asin_map` · `categoriser_safety_net_log` · `outbound_clicks` ·
`product_change_events` · `review_queue` · `routine_alerts` ·
`shade_variant_fix_proposals` · `stylevana_url_health_queue` · `tracked_products`

Plus **15 dated backup and snapshot tables**, which are historical records and correctly
left alone. And **`saved_routines`, which has no `product_id` column** and so appears on no
list of this kind.

**On this merge:** `stylevana_url_health_queue` held a row for 126 and is repointed
explicitly in the migration. `amazon_asin_map` already pointed at the keeper.
`tracked_products` (4 rows) and `routine_alerts` (0 rows) hold nothing for these ids.

> **THAT IS LUCK, NOT SAFETY.** Four products are tracked and thirteen routines are saved;
> none happened to be this one. **The next merge may land on a saved product, and nothing in
> the function will say so** — it will report `saved_routines_updated = 0` and succeed.

**NOT FIXED.** Changing the function is a change to every future merge and needs its own
baseline. Recorded so the next merge is PROPOSED knowing what it does not cover, and so the
proposal carries the repoints the function will not make.

#### THE MERGE THIS ENABLES

**126 → 81755, keeper 81755, canonical barcode 8809598450820.** External check settled that
`NEW` is repackaging and not reformulation: identical INCI across every listing found, a
retailer describing it as the "new look" and an "upgraded version… kept the price same".
**Our data could not have settled that** — it needed a source outside the catalogue.

**91868 is repointed in the same transaction.** It is already merged into 126, and
`fmb_soft_merge_group` does not repoint children, so the merge alone would leave
`91868 → 126 → 81755` — the two-hop chain item 52 records the merge functions mishandling.

**And a table the merge function does not cover:** `stylevana_url_health_queue` holds a row
for 126. The function's scope is `retailer_prices` and `price_history` only; **it also
hardcodes `saved_routines_updated = 0` in its own log**, which is worth knowing before the
next merge lands on a product someone has saved. Nothing here is affected — `tracked_products`
and `routine_alerts` both hold zero rows for these ids — but the gap is real and was found by
checking rather than by the function complaining.

**After the merge:** 4 retailer rows, **best price £10.52** (from £10.72), and **3 distinct
sellers, not 4** — Gorgeous Shop and Beauty Flash are one operator (item 103).

**A side effect worth having:** the merged product carries **both** codes across its rows, so
`ean_product_index` resolves either to it. The reseller code is not deleted; it stops
defining a product of its own.

---

### 105. The human pass on the ASIN map, and what disagreeing with the machine found

**Raised:** 14 August 2026 · **Applied.** 49 rows reviewed by Robbie; nothing promoted into
`products.amazon_asin`.

| verdict | rows |
|---|---:|
| accepted the proposed candidate | **28** |
| corrected to a different product | **9** — 5 of them my own runner-up, 4 named by neither candidate |
| **not carried on FindMyBasket** | **12** |
| left undecided | **0** |

**Final state:** 36 `matched_by_name` (verified, with a product), 12 `confirmed_absent`
(verified, no product), 1 held. `match_state` gained **`matched_by_name`** and
**`confirmed_absent`**, because the manual pass produces two outcomes the original CHECK
could not express and 36 rows would otherwise have sat at `unmatched` while carrying a
`product_id`. **The identifier-side outcome is preserved in `notes`** rather than being
overwritten — a row that reads `matched_by_name` still records that Amazon returned no
barcode for it.

#### THE LIST WENT STALE UNDER THE VERDICT, AND WE ARE THE ONES WHO STALED IT

`B0B1QTYTGJ` was reviewed and accepted against product **126**. **We merged 126 into 81755
four hours after the file was produced.** The verdict was correct when made and wrong when
read, and nothing in the file could have said so.

> **THIS IS THE FROZEN-SNAPSHOT PROPERTY ARRIVING ON A WORKING FILE.** The same rule that
> keeps counts and prices out of committed copy applies to any artefact that names product
> ids and then sits still while the catalogue moves.
>
> **It is the argument for the map being a table rather than a file**, made concrete: had
> the review been done against `amazon_asin_map` directly, the merge would have carried the
> row with it — `fmb_soft_merge_group` moves `retailer_prices`, and a foreign key would have
> been visible to it. A CSV cannot be moved by a merge.

**Caught by checking every cited id against `products.merged_into` before applying.** It was
the only stale id of 44. **One in 44 over four hours** is the rate to remember before
treating an exported working file as current.

#### TWO MATCHER GAPS, BOTH FOUND BY A HUMAN DISAGREEING WITH THE MACHINE

**1. NO `-ise`/`-ize` NORMALISATION** — see also item 109 group D, where the same pair
reappears as a merge candidate and the spelling is the whole of the name difference.

**1. NO `-ise`/`-ize` NORMALISATION.** `B0G6KTMKSR` was corrected to **14684**, *"Beauty of
Joseon Revive Firming Moisturi**s**er 60ml"* — **three live retailers**, and it **never
scored at all** against Amazon's *"Moisturi**z**er"*. My two candidates were 94046 (10ml) and
94047 (60ml, one retailer). **The best row in the catalogue was invisible to the matcher on a
single letter.**

**2. NO UNIT CONVERSION.** `B01M4GQO8W` was flagged `size_agrees = NO` — Amazon *"1.7 fl
oz"* against our *"50ml"*. **1.7 fl oz IS 50ml.** The flag was mine and it was wrong; the
acceptance was right.

> **Both are corpus-measurable against the 155 EAN-confirmed pairs, and neither was found by
> measuring. They were found by a person looking at rows the measurement had already scored
> and disagreeing.** The instrument was tuned on the corpus it was measured against, so the
> failures it shares with that corpus are invisible from inside it.

#### THE SIZE FLAG DID ITS JOB AND THE BUCKET DID NOT

**Both `No` verdicts on rows bucketed `RELISTING` are the exact two flagged in the handover:**
`B0H1V579M4` (Amazon's 50ml travel size against our 100ml) and `B0GTXQ8H18` (a *facial*
cream against our *eye* cream). Both were inside the measured 94% band on score and margin.

> **The band put them in the confirmations. The size flag said look again. The flag was
> right both times.** A secondary signal disagreeing with the primary one is worth surfacing
> even when the primary one is well measured — the 94% was measured on rows where size
> agreed and disagreed alike, so it never had a reason to separate them.

#### THE VITAMIN C CASE, AND HOW THE BARCODE BLOCK SETTLED IT

`B0BS8M8Q5L` is *"Pure Vitamin C **13%** Serum"*. All three proposed ids were Vitamin C
**23** — a different product COSRX also sells, where **the number is the product name.**

Two candidates carry 13: `1775` *"The Vitamin C 13 Serum (20ml)"* and `84154` *"…13 Serum
**2026 Version**"*. Neither holds the ASIN's identifier `8809598455238`, so it could not be
matched directly. **Resolved on the prefix block:** across the harvest, `8800311…` codes sit
consistently on **2026-version** COSRX rows (84155 is *"Advanced The Vitamin C 23 Serum 2026
Version"* on `8800311121256`), while `88095984…` sits on the older packaging. The ASIN's code
is in the **older block**, so **1775**, not 84154.

**Recorded as an inference, not a confirmation.** 1775 carries no barcode at all, so nothing
verifies it directly; the reasoning is a pattern across sibling codes.

#### STILL HELD

`B08PTX9BYJ` — Amazon *"Deep Vita C Serum 2.0"* against `82252` *"Deep Vita C Ampoule **Set**
10g x 3 pcs"* and `91501` *"Ampoule 2.0 - 10g*3ea"*. **A single mapped onto a three-pack is
this morning's 6174 shape.** Left unverified with the reason in `notes`.

#### SEPARATE WORK, NOT TOUCHED

**Eight duplicate pairs** flagged during the pass: `110261/108246`, `988/6177`,
`14906/93640` (twice), `14684/94047`, `7740/82606`, `578/129360/14993`, `3325/80536`.

**Two data notes:** product `143273` is mislabelled as a cream; `B091SZYV6T`'s row *"goes to
YesStyle 150ml but is labelled 50ml"*.

**Nothing promoted.** `products.amazon_asin` is untouched; promotion is a separate step now
that 36 rows are verified.

---

### 106. The `[DEAL]` marker is present where the damage is least and absent where it is worst

**Raised:** 14 August 2026 · **Diagnosis only. Nothing on the import path, nothing fixed.**

#### THE MARKER GAP, WHICH IS THE FINDING

Stylevana's promotional listings carry **two** markers, and they select for opposite things:

| marker | where it lives | rows |
|---|---|---:|
| **`/deal-` path segment** | the ROW's URL | **1,680** of 11,512 (14.6%) |
| **`[DEAL]` prefix** | the PRODUCT's name | 222 products, **191** with a deal row |

> **A `[DEAL]` NAME SURVIVES ONLY WHEN THE LISTING CREATED ITS OWN PRODUCT. When it attaches
> to a product that already exists, the name is that product's name and the marker is
> invisible.**
>
> **So the name marker is present where the damage is LEAST — a duplicate product nobody has
> linked to — and absent where it is WORST: a promotional single sitting on a real
> multi-retailer page as the headline price.**

That is not a hypothesis. It is exactly why **6174, 81482 and 126 all have URL markers and
no name marker**, and those are the three cases with live user harm. Validated on all seven
known instances: **the URL marker catches 7/7, the name marker 4/7**, and the three it misses
are the three that mattered.

**A better finding than any of the counts below**, because it says the obvious marker — the
one visible in a product name, the one a person would notice — is systematically the wrong
one to search on.

#### WHY THE FIRST QUERY RETURNED ZERO

`retailer_prices.url` is an AWIN deeplink wrapper with the merchant URL **percent-encoded**
inside `ued=`:

    ...&ued=https%3A%2F%2Fwww.stylevana.com%2Fen_GB%2Fdeal-medicube-...

**`/` is stored as `%2F`, so `/deal-` never appears literally.** A search for `%2Fdeal-`, or
a decode first, is required. Zero false positives once decoded: "deal" appears nowhere else
in a Stylevana URL.

#### THE FOUNDING INSTANCE FAILS BOTH DETECTORS

**6174's row — the one that caused a live mispricing this morning — is caught by neither
test built here.** Its slug shares nearly every token with the product name, so it is not
mode (a). Its URL states no pack count, so it is not testable for mode (c).

> **It was found by a person reading a page.** The 3 and the 9 below are **floors inside a
> window that excludes the case that started this**, and no amount of tuning either detector
> would have surfaced it.

#### THE THREE MODES

**(a) ATTACHED TO THE WRONG PRODUCT — 9 rows, 7 of them the cheapest on their page.** Not
subtle:

| product | the deal row actually points at |
|---|---|
| Shiseido ULTIMUNE Concentrate | `romand cheek … c02 blueberry` |
| Shiseido ULTIMUNE Concentrate | `romand cheek … c03 fig chip` |
| FRUDIA Hand Cream | `… panthensoside sheet mask 5ea set` |
| Round Lab Birch Pad | `derma b fresh moisture body lotion 400ml` |
| EMBRYOLISSE Lait Crème | `madeca time reverse boosting toner 250ml` |
| Rohto Lip Balm | `some by mi clear spot patch 20ea set` |

> **A PREDICTION, RECORDED BEFORE THE RUN. Mode (a) is not a new population — it is the
> REASSIGNMENT population.** Products 2015 and 2167 are the exact ULTIMUNE/romand pairs the
> zero-shared-token image analysis surfaced, and the detector armed this afternoon
> (`reassignment_detect`, Stylevana only) is pointed at precisely this shape.
>
> **These nine should appear in tomorrow's 03:30 sample. If they do not, that is a finding
> about the detector rather than about the rows** — and it is worth more than a confirmation
> would be, because the detector has no other independent test.

**(b) CREATED A DUPLICATE PRODUCT — 191 rows, and the true figure is unknown and larger.**
191 is what the *name* marker catches. **Product 126 was mode (b) and carried no `[DEAL]`
name at all** — it became a whole duplicate product and was merged today. So the marker
misses an unmeasured share of its own class, and 191 is a floor with no known ceiling.

**(c) A SINGLE PACK AS THE HEADLINE PRICE — 3 found, testable on 18.4% of rows.** The window
belongs with the number, not after it: mode (c) needs a pack count stated on **both** the
product name and the URL slug, and that is true of **309 of 1,680** rows.

| product | states | deal row says | price |
|---|---:|---:|---:|
| **ETUDE Moistfull Collagen Bundle Set** | **5** | **1pc** | **£1.69** |
| numbuzin No.5+ Glutathione Mask | 5 | 4pc | £8.08 |
| numbuzin No.1 Pantothenic B5 | 5 | 4ea | £7.55 |

All three are the cheapest in-stock row on their page.

#### THE DEFECT PROPAGATES INTO OTHER RETAILERS' ROWS

**YesStyle carries 4 products with a `[DEAL]` name and no deal URL; Atelier De Glow carries
2.** Those are products a Stylevana promotional listing created, which other retailers then
matched onto.

> **A feed defect in one retailer becomes a product other retailers attach to.** The
> duplicate stops being Stylevana's once a second retailer joins it, and removing it is no
> longer a question about one feed.

#### STATUS

**Nothing fixed, nothing proposed.** Every one of the 1,680 rows lands in a named bucket
including the untestable remainder; no row is silently dropped. The counts are floors and
are labelled as such.

---

### 107. The discriminator already catches this one, and nothing consumes it

**Raised:** 14 August 2026 · **Second live defect motivating the same durable fix.**

Product **81482**, *"ETUDE Moistfull Collagen Deep Sheet Mask Bundle Set 37ml x 5 sheets"*,
two rows:

| retailer | price | barcode | URL says | last confirmed |
|---|---:|---|---|---|
| **Stylevana** | **£1.69** | `8809668018110` | `deal-…-**1pc**` | today |
| YesStyle | £16.39 | `8809668018110` | — | **1 July — 44 days** |

#### THE FINDING: THE MECHANISM EXISTS, FIRES CORRECTLY, AND ITS OUTPUT GOES NOWHERE

**Unlike 6174, this row is INSIDE the testable window.** The URL states a pack count of 1
and the product name states 5 — **both sides stated**, which is exactly the precondition
item 98 records the discriminator as needing.

> **Item 98's pack-count discriminator identifies this row correctly. It was measured,
> written down, and never built. Nothing consumes its output.**
>
> Item 98 recorded the discriminator as *"correct by design and blind to the case that
> motivated it"* — true of 6174, which states no count. **This case is the other half: the
> guard is not blind here, it simply is not connected to anything.** A rule that fires
> correctly into a void is a different failure from a rule that cannot fire.

**At 37% precision (item 99) it should FLAG rather than ACT — but flagging is not what it
does either.** There is no surface on which its verdict appears: no counter in the import
response, no row in a queue, no line in `scrape_log`. It exists as a measurement in a
markdown file and as a scoring term in a script that runs by hand.

**Two live user-facing defects in one day now motivate the same durable fix**, where this
morning there was one. 6174 argued for it by escaping it; 81482 argues for it by being
caught and ignored.

#### THE 6174 PRECEDENT DOES NOT TRANSFER, AND THE REASON IS CONSEQUENCE NOT CAUSE

Both rows carry the SAME barcode as the product, so **this matched on tier 1** — Stylevana
assigned the five-pack's EAN to a single-sheet listing, exactly as Atelier De Glow did on
6174. **Atelier's row was deliberately left alone**, on the argument that detaching it
treats a retailer's data defect as ours.

> **Same cause, opposite consequence. Atelier's row was £14 and eighth of nine — invisible.
> This one is the headline price on a two-row page at 90% below the real one.**

Stylevana also lists the single correctly as product **147989** (£1.72, same barcode a third
time), so the row in question duplicates a listing that already sits in the right place.

#### THE STALE FALLBACK IS AN ACCEPTED TRADE, NOT AN OVERSIGHT

After a detach, 81482 shows **£16.39 from a YesStyle row last confirmed 1 July**.
YesStyle's `absence_threshold_days = 9999` (item 53), so its rows never age out and this one
still reads in stock.

> **A STALE-BUT-RIGHT PRICE BEATS A FRESH-BUT-WRONG ONE WHEN THE WRONG ONE IS WHAT A
> VISITOR CLICKS.** £16.39 for five sheets is plausible against £1.72 for one.

**Recorded so the unconfirmed price is not later read as an accident.** The page will show a
44-day-old figure and that is the deliberate choice.

#### AND THE DETACH IS EXPECTED TO REVERSE ITSELF

6174's row carried no barcode, so its return depended on a name match. **This row carries a
valid barcode that the product also carries.** On the next Stylevana import, tier 0 will not
find `68454`, and **tier 1 will match it straight back onto 81482 — correctly, by the rules,
on a barcode the retailer supplied.**

#### THE DECISION WAS NOT TO DETACH, AND THE REASON IS THE POINT

**Robbie's call, 14 August. The diff is written, verified against the schema, and filed
UNAPPLIED at `docs/proposed/detach-81482-stylevana-single-sheet.sql`** — deliberately not
in `supabase/migrations/`, so no runner can pick it up.

> **6174 was detached because its return depended on a NAME match and detaching it was how
> we find out. This row carries the product's own barcode, so tier 1 rematches it at 03:30
> tomorrow — correctly, by the rules.** One day's reprieve on a page with ZERO CLICKS, paid
> for with a snapshot table, a migration record and a reversal to explain in the morning.

**The defect is worth more as evidence than as a repair.**

> **A rule with no surface — no counter, no queue row, no `scrape_log` line — is a
> measurement in a markdown file.** Detaching a row the discriminator has ALREADY IDENTIFIED
> would be doing by hand what it should be doing by output, and it would remove the clearest
> demonstration of why the output is missing.

**81482 stays wrong, visibly, with zero clicks, until the discriminator has somewhere to
report.** That is a choice and it is recorded as one.

**No clicks have gone through this row**, unlike 6174's, which is what makes the choice
affordable. It would not be if someone were clicking it.

---

### 108. Give the discriminator a surface — scoped, not built

**Raised:** 14 August 2026 · **Next piece of work, after tomorrow's reads.** Design only.

**Two live user-facing defects in one day motivate one fix.** 6174 argues for it by escaping
the discriminator; 81482 argues for it by being caught and ignored (items 98, 107).

#### WHAT IS ACTUALLY MISSING

The pack-count comparison is measured (item 99), correct on the cases it can see (item 107),
and **has no output anywhere.** Not a counter, not a queue, not a log line. It exists as a
scoring term in a hand-run script and a table in a markdown file.

> **THE FIX IS NOT A BETTER RULE. IT IS A PLACE FOR THE RULE'S ANSWER TO GO.**

#### IT MUST FLAG, NEVER ACT — AND THE PRECISION IS WHY

**Measured precision is 37% on the sharpest bucket** (item 99: 7 genuine of 19). A detector
that acted on that would be wrong twice for every time it was right, on live pricing.

And a 63% false-positive stream shown as alerts is **item 70's failure mode exactly** — a
guard that fires so often it trains dismissal. **So: a review queue a human works, not a
notification, and never a mutation.**

**Same posture as the reassignment detector: count, log, and still write.** Never skip, never
detach, never suppress — so the population stays measurable against an untouched baseline.

#### SHAPE

**1. A counter in the import response and `scrape_log.details.counts`** — e.g.
`pack_mismatch_suspect`, alongside `tier1_ambiguous_skipped` and `on_supplements_path`.
Per-run, per-retailer, visible in the same place every other counter already is.

**2. A queue table**, holding one row per suspect: the `retailer_prices` id, product id,
retailer, the pack count each side stated, the price, whether it is the cheapest in-stock
row, when it was detected, and a `reviewed` flag. **The cheapest-row test is what separates
a curiosity from live harm** and belongs in the row, not in a later query.

**3. Opt-in per retailer, default off**, exactly like `reassignment_detect` — so the deploy
is inert and the first read is one retailer's worth of rows rather than the fleet's.

#### WHAT IT WILL NOT CATCH, STATED UP FRONT

**Only 18.4% of Stylevana's deal rows are testable at all** (item 106), and **6174 — the case
that started this — is not among them**, because its URL states no pack count. Catalogue-wide
the testable share is **2.8%** (item 99).

> **This surface makes a rule that sees 2.8% of rows visible. It does not make the rule see
> more.** Anyone reading the queue must know that an empty queue means "nothing found in the
> tested slice", not "nothing wrong".

#### NOT BUILT

No table, no counter, no config column. Recorded so the next session starts from a scoped
design rather than from two defects and an argument.

---

### 109. Eight duplicate pairs triaged: one merged, six held, one reclassified

**Raised:** 14 August 2026 · **One merge applied. Nothing else touched.** Each pair was a
separate decision and they did not come out the same way.

#### MERGED: 108246 -> 110261, medicube Collagen Glow Sunscreen 50ml

**Keeper 110261 holds the ONLY barcode** (`8800289461552`); 108246 had none. Same principle
the propolis merge established: **the side carrying the manufacturer code survives.**

Verified: 2 in-stock rows, best **£17.93** (from £22.95 on the keeper alone), no orphans, no
chain, logged. **The single `outbound_clicks` row was repointed in the same transaction** —
`fmb_soft_merge_group` does not carry it (item 104), and a click record left on a merged
product is history pointing at nothing.

#### THE ADJACENT-BARCODE QUESTION, WHICH ANSWERS TWO PAIRS AND MORE

Groups C (`14906`/`93640`, codes `…325**23**`/`…325**16**`) and D (`14684`/`94047`, codes
`…331**93**`/`…331**79**`) both carry **sequential manufacturer codes**. Measured across the
catalogue, grouping every 13-digit barcode by its first 11 digits:

| | groups |
|---|---:|
| prefix groups | 28,900 |
| **with sibling codes on DIFFERENT products** | **12,298** — 45,749 products |
| with sibling codes on the SAME product | **3** |

> **A shared 11-digit prefix is the signature of a PRODUCT LINE, not of a duplicate. The
> ratio is roughly 4,100 to 1.**

Sampled, the sibling blocks are exactly that — shade and variant ranges:

- **Isle of Paradise**: Self-Tanning Water *Light* / *Medium*, Mousse *Medium* / *Dark*
- **Mylee Gel Polish**: *Head Girl* / *Drama Club* / *Lecture Notes*
- **Beauty of Joseon** `88099681331`: Revive Firming Moisturiser **and** Calming Barrier
  Serum 2026 — two unrelated products in the same block as group D's two codes

**So adjacency is weak evidence AGAINST merging, not for it**, and it removes the one thing
that made C and D look mechanical. **Both held.**

**What it does not settle:** in C and D the *names* are near-identical while the *barcodes*
are adjacent-but-distinct. **The two signals now point opposite ways**, which is the
definition of a case needing a human, not a rule.

#### E — THE KEEPER IS THE BARCODE HOLDER, NOT THE CHEAPER ROW

`7740` (£5.92, **no barcode**, 1 child) against `82606` (£6.18, `8809598455405`).

> **Keeper is 82606. A price that may be stale should not override a manufacturer code.**
> The propolis merge settled this: the barcode is evidence, a name match is an inference.
> The ASIN pass had pointed at 7740, and that verdict is superseded here on the stronger
> signal.

**Held behind C and D**, because the same adjacency question applies to any COSRX pair.

#### F — HOLD, AND THE EXPECTATION ABOUT IT WAS WRONG IN AN INFORMATIVE WAY

`578` / `129360` / `14993` were expected to be a 13-versus-23 confusion. **They are not:
all three are Vitamin C 23.** That confusion belonged to ASIN `B0BS8M8Q5L`, which was
redirected to `1775` during the human pass — **the annotation travelled with the row, not
with the products.**

**But the group should still not be merged**, for a different reason:

| | 578 | 14993 |
|---|---|---|
| name | `The Vitamin C 23 Serum` | **`Advanced`** `The Vitamin C 23` |
| best | **£26.00** | **£9.88** |
| barcode | two | none |

> **2.6x on a stated 20ml is not what repackaging looks like.** `Advanced` is the same token
> class as `NEW` on the propolis ampoule, and that only resolved on an **external check** of
> the ingredient list. **Do that check before proposing anything.**

`129360` is plausibly the same as `578` — Beauty Flash's URL for 578 ends `-20g`, matching
129360's name.

#### G IS NOT A MERGE. IT IS THE THIRD PACK-MISMATCH DEFECT.

`3325` *"Acne Pimple Master Patch **x 24**"* (£5.25) against `80536` *"Acne Pimple Master
Patch"*, no count stated, **£1.85**, and **6 outbound clicks — the most of any product in
this set.**

> **Merging would put a single-patch price on a 24-patch page.** It is the 6174 shape with
> more traffic behind it. **Moved to item 108's population.**

**AND IT IS AGAIN OUTSIDE THE DISCRIMINATOR'S TESTABLE WINDOW**, because 80536 states no
count at all.

> **Three live instances now — 6174, 81482, 80536 — and TWO OF THE THREE ARE INVISIBLE TO
> THE RULE.** The one it can see (81482) is the one deliberately left unfixed as evidence.
> The rule's blind spot is not a tail; it is the majority of the known population.

#### WHAT `fmb_soft_merge_group` WOULD NOT HAVE CARRIED

Across the fifteen products: **9 `amazon_asin_map` rows** (five human-verified hours
earlier), **11 `outbound_clicks`**, **3 `stylevana_url_health_queue`**, and **6 children** —
four of them `[Deal]` products, item 106's mode (b), already merged once.
`tracked_products`, `routine_alerts`, `review_queue`, `product_change_events`,
`shade_variant_fix_proposals` and `categoriser_safety_net_log` are all zero here.

**`saved_routines` checked by TEXT SEARCH, not by column** — it has no `product_id`, so no
column-based sweep can see it. 13 routines, none mentions any of the fifteen.

---

### 110. `/app` is missing supplements too, and the eleven was a floor

**Raised:** 14 August 2026 · **Not started. Not investigated — deliberately.** Recorded
against item 69, whose evidence table this belongs in.

**`/app`'s category browse does not offer supplements.** That is a **third surface**,
separate from the two navs (item 68) and the homepage cards (item 66), and **it was not
among the eleven places the supplements sweep enumerated.**

#### THE FINDING IS THE COUNT, NOT THE SURFACE

Supplements missing from one more list is an edit. What it costs an hour to fix and what
it is worth recording are different things:

> **Eleven was a floor, not a total.** The sweep that produced it was scoped to the places
> it already knew about, and `/app` was outside that scope — so the number described the
> sweep's reach, not the surface area of the problem. **Nothing about the eleven ever
> claimed to be exhaustive; it was read as though it did**, including in item 69, which
> prices the migration off it.

**The same will be true of the seventh category.** Whatever number the next sweep produces
is the number of places it looked, and there is still nothing that can report a list which
is silently short — item 66's *"absence has no keyword to grep for"*, one surface later
and now with an instance behind it.

#### WHAT TO ANSWER WHEN THIS IS PICKED UP

**Is `/app`'s category list hardcoded, derived from `ALL_CATEGORIES`, or something else?**
Left unopened on purpose so the answer arrives with the work rather than as a guess here.

- **Hardcoded** → it is another copy, it goes in item 69's evidence table, and the count of
  duplicated category lists rises again.
- **Derived from `ALL_CATEGORIES`** → the omission has a different cause entirely, and the
  consolidation argument does not gain from it. **Check this before assuming the first
  case**, which is the more attractive answer and therefore the one to distrust.

#### TWO DETAILS RECORDED BECAUSE THEY WERE OFF

Neither changes the finding; both would mislead someone reconciling this entry later.

- **Item 69's evidence table has six rows, not three.** The "three" is inside one of them —
  *"three component copies"* in the seven-duplicated-label-maps row (item 65, #234). A
  fourth hardcoded copy would extend **that row**, not the table.
- **The eleven-places sweep is dated 12 August in this file**, not 13 — items 65 and 66,
  both raised while adding supplements. The 13 August work was elsewhere.

---

### 111. The threshold is a column, and seven columns waited nine days for a report

**Raised and closed:** 14 August 2026 · **Applied.** `metrics_quality_weekly` reshaped,

**Numbered 111, not 110.** It was written as 110 by counting from the previous item
rather than from the file, where a 110 already existed. Caught because two production
COMMENTs cite the number — `suspect_price_threshold` and `fmb_quality_snapshot_write` —
and a stale citation there points a future reader at the wrong item with nothing to
indicate it.
`fmb_quality_snapshot_write()` created, first row written. **Cron NOT armed.**

#### THE THRESHOLD IS A COLUMN, NOT A CONSTANT

`suspect_price_threshold` is stored **in every row the writer produces**, set to **0.50**.

> **A future change of threshold RECORDS A NEW DEFINITION instead of silently continuing an
> old series.**

**That is the failure mode this fortnight produced over and over, and it is now closed
structurally rather than by discipline.** The sole-supplier figure was derived twice and
abandoned once because no definition reproduced it. `ambiguous_ean_groups` reads **8,694**
here against item 96's **8,606** — *definitional, not drift*: item 96 required active **and**
enabled, this reads `retailer_prices_live`, which is active only. **Two metrics with the same
name and different retailer predicates is exactly what this fortnight kept finding**, and a
column that carries its own predicate cannot do it again.

**Why 0.50 rather than the brief's 0.35**, recorded as a decision with its basis:

| threshold | rows flagged | of today's three known defects |
|---:|---:|---|
| 0.35 | 167 | **1** (81482 only) |
| **0.50** | **726** | **2** (81482 and 6174) |

> **Derived from three real instances, not chosen for roundness. And the case for 0.35 is
> manageable volume, which matters for a NOTIFICATION and not for a QUEUE.** This is a
> review queue a human works. **All three known defects were found by a person reading a
> page, so a wider net is the point.**

#### NINE DAYS OF A SCHEMA WAITING ON A REPORT

`metrics_quality_weekly` was created 28 July and has held **zero rows since 5 August**. Seven
of its eight metric columns had **no definition anywhere** — no SQL, no view, no script, no
workflow. They appeared in exactly three places: the migration declaring them, the brief
restating them, and `platform_changes.metrics_affected`, where they are used as **string
labels**.

**The definitions were Step 7 of the dashboard brief. Step 7 is REPORT ONLY and never ran.
Step 8 (the puller) and Step 9 (the panel) both depend on it.**

> **THE SCHEMA LANDED AND THE MEANINGS DID NOT.** `review_queue` was created by the same
> migration, so the *storage* half of Step 8 shipped while the *compute* half did not. A
> table with columns and no queries looks finished from every angle except the one that
> matters.

Even the single defined column was only half defined: the canonical query returns a **count**
and the column is a **percentage**. The denominator existed as prose in a table comment and
had never been written as SQL. **Running both halves for the first time gave 12,946 / 85,439
= 15.15%** — a number that had never existed, on the platform's headline metric.

#### WHAT WAS WRONG WITH THE ORIGINAL EIGHT

> **THERE WAS NOT ONE RELATIONAL COLUMN IN THE SET. It answered "is the data clean?". Every
> failure this fortnight was relational: is this row on the right product, and is this price
> comparable to the ones beside it.**

- **Three views of barcode PRESENCE** — `ean_coverage_pct`, `null_ean_product_pct`,
  `placeholder_ean_count` — and **none of barcode COLLISION**, the defect that blocks tier 1
  on 8,694 codes and thousands of products every night.
- **Every figure the fortnight kept re-deriving was absent from all eight**: sole-supplier
  share (2 derivations, 1 abandoned, ~7 citations), cross-retailer duplicate EAN groups,
  products with no in-stock offer (1 derivation, quoted 6 times), stale rows against each
  retailer's own import.
- **`bad_price_count` DROPPED.** No definition at all; the only recorded property was "reads
  0". The brief argued to keep it as a regression detector — *"a metric that is zero today
  and non-zero later"*. **A zero from an undefined query cannot go non-zero. It is a blank
  tile, not an alarm.**

**Kept 3, added 6.** Every ratio now stores its own numerator and denominator, so a reader
can check a percentage rather than trust it, and can tell a moved denominator from a moved
numerator.

#### THE METRIC-9 CORRECTIONS, BOTH FOUND BEFORE ANYTHING WAS QUOTED

**1. A JOIN WRITTEN TO CATCH A SPECIFIC PAIR, MADE BLIND TO THAT PAIR BY ITS OWN TOKEN
FILTER.** `cross_product_price_outliers` exists because 80536 is structurally invisible to
`suspect_price_count`. Its first form used `length(token) > 2` — which **drops the token
`24`**, making `3325` *"Acne Pimple Master Patch x 24"* and `80536` *"Acne Pimple Master
Patch"* **token-identical**. The join requires exactly one extra token, so it never saw them.

> **The filter that made the names comparable is the filter that removed the difference.**
> Found by running it against the known pair first, per item 79 — not by reading it.

**2. RESTRICTING THE DIFFERING TOKEN TO NUMERIC OR PACK UNITS.** Unrestricted, the rule
returned **902 pairs** — the population item 102 measured as dominated by shade names, where
a 2x price gap between two shades is ordinary. Restricted: **319 pairs, and the founding case
survives.** 583 shade and formulation pairs drop out.

**A separate higher-signal bucket, stored in its own column:** **126 identical-name pairs**
— same brand, same token set, >2x price gap. **It does not contain the founding case**, so it
is stored beside the 319 rather than summed with it.

#### WHAT THE MEASUREMENTS SAY ABOUT THEIR OWN LIMITS

**`pack_mismatch_suspects` stores `pack_mismatch_testable`**: only **2,802 of 110,193** live
rows — **2.5%** — state a pack count on both sides. **An empty result must read as "nothing
found in the tested slice", never as "nothing wrong"**, and the column that says so ships
with the column that counts.

#### LIVE VERSUS BARE: FOLLOWED FROM `dq_snapshot`, NOT COPIED

> **A departed retailer's rows must show in coverage and freshness, and must never show in
> comparison depth.**

`dq_snapshot` is the only executable data-quality SQL in the repo, and the brief warns
against copying it wholesale because its split is deliberate and half of it is the wrong half
for headline metrics. **The split was read and the reasoning adopted; the SQL was not.**
Metrics 1-6 and 8-9 read `retailer_prices_live`; `stale_in_stock_rows` reads the bare table
by design, and against **each retailer's own last import** rather than a fixed day bucket —
because YesStyle's `absence_threshold_days = 9999` makes fixed buckets meaningless for it
(item 53).

#### FIRST ROW, WRITTEN TODAY

`week_start 2026-08-10`, threshold 0.50 — depth **15.15%** (12,946/85,439) · suspect **726**
/32,138 · EAN coverage **90.07%** (99,350/110,309) · ambiguous **8,694**/79,156 ·
sole-supplier **77.25%** (59,793/77,400) · no-offer **13,280**/98,283 · stale **15,593** ·
pack **13** of 2,802 testable · cross-product **319** · identical-name **126**.

#### NOT SCHEDULED, DELIBERATELY

**No `pg_cron` entry.** Tomorrow already carries four reads on the import path — 6174's
possible return, the first Stylevana detector cycle, the clean-cycle confirmation, and 81482
standing unchanged. **A scheduled writer would be a fifth thing moving in that window.**

> **It costs a day and it keeps tomorrow attributable.**

Step 9's panel is the remaining piece, and it now has **a series to render rather than a
schema**.

---

### 112. The comment claims a persistence the pipeline does not perform

**Raised:** 15 August 2026, first Stylevana detector cycle · **Not fixed here. Its own change,
after the Boots flip.**

The reassignment detector fired for the first time. The instruction was to **read the sample
rows before the count**. The sample rows do not exist.

`scrape_log.details` holds `counts`, `duration_ms`, `excluded_total` and nothing else, because
`_shared/run-metrics.ts:75` writes exactly that:

    details: { duration_ms: durationMs, excluded_total: excludedTotal, counts: o.counts ?? null }

`sample_reassignment_suspect` is a **sibling of `counts` in the HTTP response**, and the cron
discards the response body. Meanwhile the importer's own comment, three lines above the field:

> *"Persisted into scrape_log.details so the trips are INSPECTABLE INDIVIDUALLY rather than
> only totalled — **137 rows nobody can read is a number, not a finding**."*

> **THE DEPLOYED CODE CLAIMS AN OUTPUT THAT DOES NOT SURVIVE, and the sentence written to
> prevent an unreadable number now DESCRIBES THE SHIPPED STATE.** It even names the figure —
> 137 — that the samples were supposed to make readable.

**This is item 91's family from a new angle.** There the log reported a count it never
computed; here the comment reports a destination the value never reaches. **Both are
assertions about plumbing, made in the place a reader checks instead of the plumbing.**

**Fix, as its own change and deliberately not folded into the Boots flip:** persist the
samples into `scrape_log.details` alongside `counts`, so the comment becomes true. One
retailer's activation and one observability fix must not land in the same window.

#### THE 60 IS A HYPOTHESIS AND IS LABELLED ONE

The detector counted **60**; the sizing predicted **137**. **Ruled out:** a partial run —
5,246 Stylevana rows were touched against 12,206 stored, and yesterday's measurement put the
fresh population at ~5,235, so that is normal coverage.

**Likely, and undemonstrated:** the 137 came from the diagnostic's tokeniser and the shipped
detector uses the fixed one. A narrower rule finding fewer rows is what success looks like.
**It cannot be shown without the samples**, which is the same gap.

**The mode (a) prediction is untestable for the same reason.** Products 2015 and 2167 still
carry `romand-…-cheek` URLs and Stylevana images, so they remain divergent; whether the
detector flagged them is exactly what the discarded samples would have said.

---

### 113. An unrun experiment listed among results

**Raised:** 15 August 2026 · **Robbie's, and recorded at his instruction.**

Yesterday's four checks included: *"Was 81482's Stylevana row rematched by tier 1 as
predicted?"* — but **we had deliberately decided not to detach it.** The row was never
removed, so nothing could be rematched. Its id is unchanged and it was updated in place by
tier 0.

> **AN UNRUN EXPERIMENT LISTED AMONG RESULTS IMPLIES A FINDING WHERE THERE IS NO
> OBSERVATION.** A checklist of four reads reads as four measurements. Three of them were.

The tier-1 rematch prediction **remains untested**, and it is the load-bearing assumption
behind holding the detach — the reason 81482 stays wrong is that detaching it is believed to
be futile. **That belief is still a prediction.**

#### CHECK 1, BY CONTRAST, IS A CLEAN CONFIRMATION

6174's row returned within one cycle: **new row id 522597**, `external_product_id` 68593,
**no barcode**, £5.90, and it is the best price on the product again. No prior row existed for
tier 0 and no identifier existed for tier 1, so it matched on **name or URL**.

> **The mechanism is now demonstrated rather than reasoned, which is what the detach bought.**
> 6174 is live-wrong at £5.90 and stays that way until something stops the rematch — and that
> "something" is now specified by evidence rather than by argument.

---

### 114. Boots supplements activated: both config values, one statement

**Raised and applied:** 15 August 2026 · **Baseline A taken first.**

**Clean-cycle confirmation passed on all twelve retailers** — `on_supplements_path: 0` and
`supplements_path_unreachable: []` everywhere, Boots included at 04:31 with an empty prefix
list. **The inert deploy ran a full cycle and the two states were distinguishable**, which is
what #268 existed to make true.

**Baseline A**, in `fmb_boots_supplements_baseline_20260815`, taken immediately before the
write: supplements **93** (23 comparable) · products_active **98,404** · Boots rows **36,409**
· Boots today links **107**, creates **10**, excluded_path **14,010**, on_supplements_path
**0** · comparison_depth **15.15%**.

**Both values written in ONE statement**, because either alone is a silent no-op (item 91).

#### AND THE TWO LISTS ARE STORED TWO DIFFERENT WAYS

`category_path_must_contain` is **jsonb**; `supplements_path_prefixes` is **text[]**. The
first attempt failed on `operator does not exist: jsonb || text[]`.

> **Two lists that must move together, stored in two different representations, so the
> statement that moves them needs two different operators.** Writing one by analogy with the
> other fails — loudly this time, which is the good case.

**Assertions in the migration**, so a broken combination cannot land and wait a day to say so:
four must-contain entries, one prefix, the leaf present, **the prefix reachable through
must-contain**, and no other retailer holding a prefix.

**The read is tomorrow's 04:30.** Expected: supplements **93 → about 1,715** (item 92,
measured on the shipped rule); `on_supplements_path` 0 → a real number;
`supplements_path_unreachable` **must stay `[]`** — if the prefix text does not match the
feed's path, that field is now what says so.

---

### 115. One clause of a three-clause rule, treated as the rule

**Raised:** 15 August 2026 · **Robbie's, recorded at his instruction.** Four supplements
articles held in `docs/drafts/`.

The brief was two fixes to make the articles publish-ready: the scare-quoted "cheaper", and
the internal link convention. **Both were already correct in the supplied files** — corrected
artefacts were produced rather than instructions, so the fix arrived inside the thing to be
fixed. **Checking rather than applying was the right response**, and it is the only reason
the third clause surfaced.

#### THE DISCLOSURE CLAUSE IS THE FINDING

`docs/article-template.html:15` carries the house rule in full:

> *Copy conventions (house rules): **no em dashes**, never "cheapest" / "cheaper"; use "best
> value" / "best price". **Keep the .disclosure line**.*

**Three clauses. One was quoted, and the quote was treated as the rule.**

> **The unquoted clause is the one that is not about style. `.disclosure` is the AFFILIATE
> DISCLOSURE** — *"FindMyBasket may earn a small commission when you shop through our links,
> at no extra cost to you."* **Four articles carrying affiliate links with no disclosure line
> is a different order of problem from a wrong link**, and "publish-ready" as scoped would
> have shipped exactly that.

**Measured on the held drafts, all three clauses:** zero em dashes, zero "cheaper"/"cheapest",
zero `/app.html`, every article link `/articles/{slug}.html`. The copy is clean. **The
compliance line cannot be present at all**, because these are markdown and the disclosure
lives in the HTML template.

**"Publish-ready" was never two text fixes. It is a conversion**, and the template's five
steps are all downstream of the copy being finished.

#### THE SITEMAP STEP IS THE SECOND

Step 5 of the template adds a line to `app/sitemap-pages.xml/route.ts`. **Four cross-linked
articles absent from the sitemap is item 47's 102 missing brand pages in a new place** — and
the cluster makes it worse, because the four reference each other, so a crawler would find
internal links to pages the sitemap never declares.

#### PUBLISH TOGETHER OR NOT AT ALL

All four cross-link to each other. **A partial publish leaves dead internal links in whichever
went first**, so the five template steps apply to all four **as a single act**, not four times
over.

#### THE GATE IS THE READ, NOT THE FLIP

The articles route to `/supplements` and promise a comparison "across multiple stockists".

> **Boots' two config values were written today and the catalogue has not moved.** The
> category stands at **93 products, 23 comparable, 19 of those one brand's flavour variants**.
> **Publication is gated on tomorrow's 04:30 READ confirming the move to roughly 1,715 — not
> on the flip having happened.**

Recorded at the top of each held draft, so the dependency travels with the artefact rather
than living only here.

#### WHAT REMAINS, AND NONE OF IT IS THE COPY

Markdown to HTML on the template · the `.disclosure` paragraph · delete the `noindex` meta ·
slug matching across `<title>`, `canonical`, `og:url` and JSON-LD · a `savings-hub.html` card
· a `sitemap-pages.xml` entry. **Five steps, four articles, one act.**

---

### 116. A label that never resolved is not a label that stopped resolving

**Raised and applied:** 15 August 2026 · **Three database changes, made before the panel and
recorded before it.** All five migrations committed the same day.

#### THE NAME-DRIFT DISTINCTION, WHICH IS THE FINDING

`platform_changes.metrics_affected` is a text array of metric names, and a panel marks a
boundary by joining a metric name against it. Row id 3 cited `unmatched_row_rate` and
`placeholder_ean_count` — **both dropped from `metrics_quality_weekly` on 14 August** (item
111). As of that day, the row silently marked two metrics that do not exist.

But the array also holds `catalogue_size`, `total_brands`, `sole_source_barcodes` and a
dozen GA4 event names. **None of those was ever a column of this table either.**

> **A LABEL THAT NEVER RESOLVED IS NOT THE SAME DEFECT AS A LABEL THAT STOPPED RESOLVING.**
> **Deleting the first destroys what someone meant at the time. Leaving the second silently
> marks nothing.** They need opposite treatment — and **in a join they look identical**,
> because both simply fail to match.

So the line drawn was narrow and deliberate: **remove only names that referenced columns OF
THIS TABLE and were dropped**; leave every label that was always aspirational or belongs to
another series. Six rows then gained current metric names where the change mechanically
moves them.

**Asserted after apply: zero rows cite a dropped column, and all nine current metrics are
named by at least one boundary row.** Eight were covered by existing history.
`suspect_price_count` had none — correctly, since no recorded change had moved it — so it
got the boundary it genuinely belongs to: **a series-start row dated 14 August**, which is
also the row recording that the threshold was SET rather than inherited.

#### THE BOOTS ROW: A DIRECTION, NOT A LIST

Written the day of the change and **before the step exists**. Its load-bearing sentence:

> **`comparison_depth_pct` EXPECTED TO FALL. About 1,715 products enter the denominator and
> most will have a single stockist, because Boots is the first supplements source. A FALLING
> HEADLINE METRIC HERE IS THE CHANGE WORKING, NOT A REGRESSION. This is the one that will be
> misread.**

Also carried: two honest unknowns (`ean_coverage_pct`'s direction depends on Boots' barcode
coverage in that branch, never separately measured) and the failure condition —
`supplements_path_unreachable` must stay empty, or the flip is inert.

**Without the row, the first step this series ever shows would be caused by a change the
boundary table does not know about, in week two.**

#### TODAY'S MOVEMENT IS NOT THE FLIP

Re-running the writer the same day moved several metrics:

| metric | earlier today | now |
|---|---:|---:|
| `comparison_depth_pct` | 15.15% | **15.33%** |
| `suspect_price_count` | 726 | **762** |
| `no_in_stock_offer_count` | 13,280 | **13,498** |
| `sole_supplier_share_pct` | 77.25% | 76.93% |

> **NONE OF THIS IS THE BOOTS SUPPLEMENTS ACTIVATION. It is one day of ordinary imports, and
> the flip has not reached the catalogue** — supplements still stands at 93. The first Boots
> effect appears at tomorrow's 04:30 run.
>
> Recorded explicitly because a reader meeting a moved figure the morning after a flip will
> attribute it to the flip. **The row was rewritten in place, same `week_start`, which is the
> writer working as designed and not a second observation.**

#### THE METHOD, WHICH SHOULD BE THE DEFAULT

`fmb_quality_snapshot_write()` needed four lines changed in about two hundred. The live
definition was fetched with `pg_get_functiondef`, patched programmatically, and re-applied.
**It was never retyped.**

> **Retyping a long function to change a few lines invites transcription drift in the lines
> that were not meant to change, and nothing would report it.** Same property the
> `products_active` capture relied on: **an identical rendering is PROOF of fidelity rather
> than a promise of it.**

Worth being the default for any change to a live function, not a one-off.

#### AND THE DENOMINATORS THEMSELVES

`stale_in_stock_rows` shipped as a bare count — **15,433 of what?** Now 15,433 of **110,504**.
`cross_product_price_outliers` and `cross_product_identical_pairs` are **pair** counts and now
carry a candidate population of **84,213** products, stored separately and never summed.

Added to the writer rather than to a companion, because a second writer would put two of the
eleven numbers somewhere else, and the whole design rests on there being **one place a
meaning can change**.

---

### 117. A constraint asserted about deploy ordering, without checking the mechanism

**Raised and closed:** 15 August 2026 · **Both deploys shipped, auth first, verified in
production.**

The panel and its Basic Auth were correctly split into two deploys, because
`middleware.ts`'s `config.matcher` is shared with the Superdrug 410 gate and **adding one
path puts every product page in the blast radius**. That reasoning was right and is
unchanged.

**The ORDER was given as page first, on the stated grounds that "an unprotected page is live
between them either way."**

> **It is not. Next.js middleware runs BEFORE routing, so a matcher takes effect whether or
> not a route exists at that path.** Deploying auth first means the exposure window never
> exists: the page is protected from its first request rather than from its second deploy.

**Robbie's, and recorded at his instruction: a constraint about deploy ordering was asserted
without checking how middleware matching relates to route existence.** The premise was the
only thing making page-first defensible, and it was checkable in one request.

**Verified in production after the auth-only deploy, before the page existed:**

    /ops/quality                401     <- protected before the route existed
    /ops/does-not-exist         401     <- matcher fires on a path with no route at all
    /product/6174               200     x-fmb-superdrug-gate: on-passthrough
    /supplements                200

**The second line is the proof.** A 401 on a path that has no route demonstrates the
mechanism directly rather than by argument, and it is what the ordering turned on. The third
line is the isolated deploy doing its other job: the shared matcher was extended and the
Superdrug gate still reports `on-passthrough`, with nothing else in the deploy to confuse
the attribution.

#### FAILING CLOSED IS THE DECIDING PROPERTY

With `OPS_BASIC_AUTH` unset, every `/ops` request is refused.

> **A MISSING ENV VAR IS EXACTLY WHAT A FIRST DEPLOY HAS.** The opposite default publishes
> an internal panel at the worst possible moment — the one moment the variable is
> guaranteed absent.

The 401s above were served with the variable not yet set, which is the failure mode working
rather than a problem to fix.

Also decided and recorded: **the gate is not Supabase Auth**, which is a customer surface
here — four users, three of them not the operator, and no role model. Gating on "logged in"
would have shown catalogue diagnostics to customers. And the data is protected twice over:
`metrics_quality_weekly` and `platform_changes` carry **no `anon` or `authenticated` grants
at all**, so there is no PostgREST path to either regardless of whether the middleware is
right.

#### TWO ADDITIONS BEYOND THE BRIEF, BOTH KEPT

**1. Each card states whether ANY boundary row names that metric**, in warning colour when
none does.

> **It makes "no marker" distinguishable from "no change".** The same distinction as
> `on_supplements_path: 0` with an empty `supplements_path_unreachable` versus zero with a
> populated one — in both cases the number is identical and the meaning is opposite, and
> only the second field separates them.

**2. An empty table renders "This is not 'everything is fine'."**

> **The panel refuses to be read as a clean bill of health.** A quality dashboard with no
> rows looks like a quality dashboard with nothing wrong, and the writer having never run is
> indistinguishable from the catalogue being clean unless the page says so.

#### THE LOCAL BUILD FAILURE IS NOT THIS CHANGE

`npm run build` on a machine without Supabase env vars fails collecting page data for
`/sitemap-products/[part]`. **Pre-existing:** every route importing `lib/supabase` throws at
import when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are absent. Compilation succeeds;
Vercel has the vars and its check is the real test. Noted on both PRs so a red local build is
not later attributed to the panel.

---

### 118. The probe changed the design, and the part it changed was the primary key

**Raised and applied:** 15 August 2026 · **Table redesigned, puller built, all three acts
run. Schedule armed 15 August in a diff of its own.**

`metrics_awin_weekly` was created 28 July from a **recalled** API shape and had held zero
rows since. On 15 August the first authenticated call to `api.awin.com` in this project's
history was made — a read-only probe, four candidate endpoints, deliberately before any
table change.

#### THE PROBE'S OWN JUSTIFICATION

The plan had been to fix the table first: add `advertiser_id`, `sale_value`, `currency`, a
`status` CHECK and column comments. **Every one of those was right.** The observed response
confirmed all four.

> **And it would still have shipped a broken table, because the primary key was the thing
> recollection got wrong.** `(week_start, advertiser, status)` assumes the API returns a row
> per status. **It returns the four statuses as COLUMNS of one record.** Honouring that key
> means exploding one record into four rows and then either duplicating the period's clicks
> across all four or attaching them arbitrarily to one.
>
> **Three right answers and one structurally wrong one — and the wrong one was the primary
> key.**

That is the probe's whole justification, and it generalises past this table:

> ### A table can survive a missing column; it cannot survive a grain that contradicts its source.

A missing column is found the first time somebody wants it and added in an afternoon. A
wrong grain is found only by whoever eventually disbelieves a number, and by then everything
built on top of it is wrong too. **The cheap check goes before the design, not after it.**

**Clicks confirmed as recalled, twice over:** one `clicks` number per advertiser per region
per period with no status, *and* no click count anywhere in the transactions endpoint, which
carries `clickDate` and `clickDevice` but nothing to sum.

#### THE REGION GRAIN, WHICH NOBODY PREDICTED

The response carries `region`, and an advertiser can report under more than one.

> **`(week_start, advertiser)` is not unique on its own — a defect INDEPENDENT of the status
> question**, and one the recalled design would still have had after every other correction
> was applied. It was not in anyone's list because nobody knew the field existed.

New key: **`(week_start, advertiser_id, region)`**, four status triples as columns, clicks
and impressions at their natural grain.

#### APPROVED VERSUS CONFIRMED: THE TRAP A CHECK WOULD HAVE ENSHRINED

The aggregate report calls a validated sale **`confirmed`**. The transactions endpoint calls
the same state **`approved`**.

> **Two names for one concept, across two endpoints of the same API, and visible only from
> the probe.** A `status` CHECK written from either endpoint alone would have rejected the
> other's vocabulary as invalid data — and the table would have been *more* wrong for having
> a constraint than for having none.

Recorded in the table comment rather than enforced, because there is no single correct
vocabulary to enforce.

#### `region=GB`, AND AN ERROR MESSAGE THAT NAMES THE WRONG PARAMETER

    {"error":"invalid.userinput",
     "description":"invalid region code list, expecting sth. like [FR,CA,DE]: []"}

Returned identically for `regionCodes=GB`, `regionCode=GB`, `regionCodes[]=GB`,
`regionCodes=[GB]`, `regionCodes=GB,IE` **and for omitting it entirely**. The parameter that
works is **`region=GB`** — bare, singular, and not a list.

> **The error names a parameter that does not exist and demands a format that is not
> accepted.** Seven variants were needed to find the one that works.

**This lives as a comment at the call site, not as a note in an item**, with an explicit
instruction not to "correct" it on the strength of the error text — which is exactly what
the error text invites the next reader to do.

#### WHAT THE FIRST PULL FOUND

**93 rows, 12 weeks, 15 advertisers, back to 25 May** — history that was recoverable only
because nobody had thrown it away, and would have started aging out eventually.

| | |
|---|---:|
| clicks | **993** |
| sales, pending / confirmed | **5 / 11** |
| commission, pending / confirmed | **£3.41 / £14.82** |
| sale value | **£527.72** |
| **realised commission rate** | **3.45%** |

**The validation lag is visible in the data rather than argued about:** Boots' most recent
weeks show 1 pending sale and 0 confirmed, while June's weeks have confirmed and no pending.
**That is the same rows moving from one column to the other over about six weeks**, and it
is why the trailing window is 12 weeks against GA4's 4, and why `updated_at` is load-bearing.

#### THE RATE CARD IS NOW MEASURABLE

`GET /publishers/{id}/commissiongroups?advertiserId=…` returns real rates — YesStyle's
**"NEW" group at 10.0%**, with `groupCode`, `groupName`, `percentage`, `conditions` and
`ratesStart`.

> **Commission position has been a CARRIED assumption throughout this project.** "Boots sits
> at the bottom of the commission range" is marked *"Not verified here"* in
> `commercial-finding-catalogue-depth.md`; The Fragrance Shop's 2% ranking in the partnership
> tracker rests on it; the £1.33 average commission per sale comes from a brief rather than
> from this database. **All of that is now checkable**, and the realised 3.45% above is the
> first commission figure this project has measured rather than carried.

Not pulled yet — the puller reads the aggregate report only. Recorded as the next cheap
addition while the auth and client already exist.

#### STATUS

**Acts 1 and 2 done**, 93 rows written and verified. **The schedule is commented out**, so
arming it is a visible diff in its own PR. `DRY_RUN` is event-aware, copied verbatim from
the GA4 workflow — a manual dispatch defaults to dry, a scheduled run writes, which is the
defect found when GA4's schedule was armed.

**The probe workflow is kept.** It is read-only, it changed a design today, and the next API
surprise wants the same instrument.

#### A NOTE ON THIS ITEM'S NUMBER, BECAUSE IT IS THE FOURTH TIME

This was written as 117 and is 118. Item 117 existed only in an open PR while this was
being written, so `main` did not yet show it.

> **The work list's numbering lives in two places at once: the file on `main`, and every
> open PR that appends to it.** Checking `main` alone is checking half of it, and the half
> that moves.

Four collisions in two days, all the same cause and all caught before merge. **The check
that actually works is `grep` on `main` AND `gh pr list --state open`** — and the second is
the one that keeps being skipped, because a number that does not exist yet is invisible to
every tool except the PR list.

### 119. Three counts of one event, and the question is which one is the denominator

**Raised:** 15 August 2026 · **Diagnosis complete, nothing changed.**

Commission per click is the steering metric for the whole funnel — **3.7p, and break even
sits at four thousand three hundred to seven thousand two hundred clicks a month against a
run rate near a hundred and eighty.** Putting the three available counts of that
denominator side by side for the first time shows they have never agreed.

Corrected to compare like with like: our own figure is filtered to rows carrying an
`awin_mid`, because `outbound_clicks` also logs Amazon and eBay click-outs and the other
two columns are AWIN only.

| Week beginning | Ours (AWIN only) | GA4 | AWIN |
| --- | --- | --- | --- |
| 13 July | 43 | — | 40 |
| 20 July | 120 | 78 | 62 |
| 27 July | 50 | 26 | 57 |
| 3 August | 50 | 17 | 170 |
| 10 August, **partial** | 71 | 1 | 544 |

#### WHAT EACH ONE ACTUALLY COUNTS

**OURS — `outbound_clicks`. Written server-side, TRIGGERED CLIENT-SIDE, and that
distinction is the whole finding.** `/api/track/outbound` is a service-role write behind a
route that always returns 204 and never throws, so the write itself is solid. But the
trigger is `ClickOutLink`'s `onClick` handler firing `sendOutboundBeacon`, and the anchor's
`href` is **the direct affiliate URL with no redirect hop** — a deliberate choice, recorded
in the route, so the link stays clean for AWIN and for SEO.

> **The navigation does not depend on the beacon, so the beacon can fail and the click
> still happens.** Ad blockers, disabled JavaScript, and right-click-open-in-new-tab or
> copy-link — neither of which fires `onClick` at all — are all invisible to us and fully
> visible to AWIN.
>
> **Our count is a FLOOR, not a measurement.** Calling it server-side is right about where
> the row is written and wrong about what decides whether there is a row.

**It is genuinely free of the consent gate, and that part holds.** The route records
`granted`, `denied` or `undecided` and **gates on none of them**. Worth noting the column
only began carrying values in the week of 10 August; every earlier row is null, so consent
is not available as an explanatory variable before then.

**GA4 — client-side and consent-gated, and its shortfall is ALREADY A RECORDED BOUNDARY.**
`platform_changes` id 34, 13 August: *"GA4 outbound-click columns are a client-capture
ratio, not a consent rate."* GA4 is **below ours in every single week** — 65%, 52%, 34%,
1.4% of our figure — which is exactly what a consent-gated client-side subset of a
non-gated client-triggered count should look like.

> **GA4 is not a third opinion. It is a known subset of ours, and it is documented as one.**
> The reconciliation is really a two-source problem wearing three columns.

The monotonic collapse of that ratio is still a defect worth its own investigation, but it
is a defect in a series already labelled as not measuring what its name suggests.

**AWIN — their servers, their filtering, and it sees what we cannot.** Every href fetch
reaches AWIN whether or not our JavaScript ran. That explains AWIN above ours. It does not
explain **twenty July, where ours is 120 and AWIN is 62** — ours nearly double theirs, the
opposite direction — and no single mechanism explains both weeks.

#### THE ANSWER ON THE DENOMINATOR

**Ours, and the steer is right, with one correction to the reason.** It is the only count
of our own event not passed through a third party's filter, and it is the only one whose
collection rules we can read. Standardise on it.

> **But adopt it as a FLOOR that is knowingly incomplete, not as the true count.** The
> reason to prefer it is that its errors are ours and legible; not that it is complete,
> because a beacon that the navigation does not depend on cannot be.

**What would make it authoritative is a server-side redirect hop** — `/go/...` logging on
the navigation path itself rather than beside it. That was deliberately avoided to keep the
affiliate href clean, so this is a real trade and not an oversight. **Not proposed here.**

#### THE CORRECTION CHANGES THE MEANING, NOT THE VALUE

Nothing about the click counts moved. `outbound_clicks` holds what it always held and the
weekly figures are unchanged.

> **What changed is what the column is entitled to be used for.** It was being read as a
> count of outbound clicks. It is a count of outbound clicks **whose beacon fired**, and
> the navigation does not depend on the beacon firing.

**Every commission-per-click figure is therefore an upper bound**, because the denominator
is a floor. 3.7p is the most favourable reading of the unit economics available, and the
break-even click figures are correspondingly optimistic.

**AND THE TRAFFIC MULTIPLE IS THE THING THAT MOVES.** Break even sits at four thousand
three hundred to seven thousand two hundred clicks a month against a run rate near a
hundred and eighty — twenty four to forty times.

> **The true multiple is LARGER than that, and the multiple is the binding constraint.**
> The commission rate question is settled and worth a factor of about four at most. The
> traffic gap is at least twenty four times and is now known to be understated.

#### A CAUTION ABOUT DIRECTION, WHICH IS NOT A CONCLUSION

**Every correction this fortnight has moved the constraint against us and none in our
favour.** The rate landed below the optimistic case, order value below both cases, the
click denominator turned out to be a floor, and the segment conversion claim survived only
in a weaker form.

It is tempting to read a pattern into that. **The honest reading is that this is what an
instrument looks like the first time it is pointed at something.** Carried figures are
assembled from best cases, briefs and recollection, and best cases are systematically
optimistic; the first measurement is not biased pessimistic, it is simply the first thing
in the chain that had no reason to flatter.

> **Worth remembering when figures eventually move the other way.** A favourable
> correction will arrive and it will feel like evidence that the pessimism was overdone. It
> will not be. The direction of a correction says nothing about its truth, and the
> temptation to trust the pleasant ones more than these will be strongest exactly when
> there is finally something to lose.

#### THE /go/ REDIRECT IS A TRADE THAT WAS MADE, NOT ONE THAT WAS MISSED

Recorded so nobody reopens this as a defect.

A server-side redirect — `/go/...` logging on the navigation path itself — would make the
count authoritative. It was **deliberately not built**. The route's own comment states the
reason: *"the click itself proceeds via the anchor's direct href (no redirect hop, so the
affiliate link stays clean for AWIN and SEO)"*.

> **A clean affiliate href was chosen, knowingly, over a complete click count.** That is a
> defensible trade and it may still be the right one. It is not an oversight, and the
> correct response to finding the count incomplete is to say so on every figure derived
> from it — which the panel now does — not to treat the original decision as a bug.

#### WHAT IS NOT WRONG

**GA4 has not been written since 13 August and that is EXPECTED, not broken.** Checked
rather than assumed. `ga4-weekly-pull.yml` carries a live `schedule:` at line 85,
`cron: '0 6 * * 1'`, and the run history holds exactly two runs, both `workflow_dispatch`
on 13 August. **The first scheduled run is Monday 17 August at 06:00 UTC**, half an hour
before AWIN's. Nothing has failed; nothing has been skipped.

**The file's own header comment says the opposite** — *"NOT SCHEDULED YET, DELIBERATELY.
The `schedule:` block below is commented out"* — while the block is live thirty lines
further down. Fixed separately. **A comment that contradicts the code it sits above is
worse than no comment**, because it is what a reader checks instead of the code.

### 120. The most expensive products at our largest retailer pay us nothing

**Raised:** 15 August 2026 · **Commercial finding. No engineering change proposed.**

The AWIN commission-group endpoint was read for every joined advertiser on 15 August.
**Twenty six of Boots's eighty seven groups pay zero per cent, and they are not obscure.**

- **Six are named brand and product exclusions:** `CHANEL_EXCLUSIONS`, `CHANEL_EXCLUSIONS_2`,
  `DIOR_EXCLUSIONS`, `DYSON_FITBIT_EXCLUSIONS`, `Baby_Milk_Exclusions`, `Exclusions`.
- **Eight more name brands directly** across new and existing customers: Apple, Dyson,
  Jo Malone, FansToShop.
- **Twelve are Cardlytics customer segments** — acquisition, lapsed, and existing at high,
  medium and low share of wallet — all at zero.

**This is live in the catalogue, not theoretical.**

| Brand | In-stock Boots rows | Average price |
| --- | --- | --- |
| Chanel | 87 | £53.21 |
| Dior | 35 | £60.11 |

> **A hundred and twenty two live rows, at the highest prices anywhere in the catalogue,
> earning zero commission.** A shopper routed to a hundred pound Chanel purchase at Boots
> generates exactly the same revenue as one who never clicked.

#### THE CONFLICT WITH THE PRESTIGE EDIT, STATED PRECISELY

The Prestige Edit and the prestige brand hubs are designed to attract exactly the shopper
who buys a sixty pound Dior product. **That shopper is worth nothing to us at Boots.**

**Spotlight fees do not depend on CPA, so the Edit is not invalidated.** A flat placement
fee from a prestige brand is revenue whether or not a single affiliate sale follows, and
the prestige audience is still the right audience for the reasons it always was.

> **But the affiliate half of the prestige case is worth zero at Boots specifically, and
> the response is a partner question rather than a product one.** Prestige sales need a
> retailer that pays on them, or a direct brand relationship. Neither of those is Boots.

**AND THE COMPARISON MUST NOT CHANGE.** This is the point at which the finding becomes
dangerous, because it suggests an obvious and forbidden action.

> **Demoting or hiding a zero-commission Boots row is exactly the manipulation the
> proposition forbids.** If Boots is the best price on a Chanel product, Boots is shown
> first, and it earns us nothing. The comparison is the only asset the platform has, and
> the moment its ordering answers to commission it is worth nothing to anyone.

The economics are shaped upstream of the comparison — by who arrives and which retailers
are partnered with — never inside it.

#### WHY THIS WAS INVISIBLE UNTIL NOW

Every commission-rate figure in the strategy work was carried and marked unverified,
because **no call to `api.awin.com` had ever been made from this project** before 15 August.
The exclusions have presumably been in Boots's card the entire time.

**It was not a wrong assumption. It was an assumption in a place nobody had looked**, and
one read of a documented endpoint settled it.

#### MARKING SOMETHING UNVERIFIED IS NOT THE SAME AS VERIFYING IT, AND THE MARKER HAS A SHELF LIFE

> **That is the line that generalises furthest, and it is why this item is a different
> failure from the rest of this list.**

One authenticated call closed a question four documents had been hedging around for a
fortnight. The marker was doing its job perfectly — it was honest, it was specific, it
named the file that held the claim — and it still let the claim be quoted, because **a
marker records a debt without ever calling it in.**

Nearly every other item here is a **belief that was checkable and was checked wrongly** —
a docstring that did not match its query, a matcher quoted before it was measured, a
primary key recalled instead of read, a comment that contradicted the code thirty lines
below it. Those share a shape: the evidence was available, somebody looked at it, and the
reading was wrong.

> **This one has no wrong reading in it.** Nobody misread Boots's commission card. Nobody
> had ever opened it. The endpoint was documented, the credential existed, and the question
> had never been asked.

**The two failures need different defences.** Wrong readings are caught by checking against
the corpus, by tests, by re-reading the source — all the habits this list has been
accumulating. **An unexamined assumption is caught by none of them**, because there is no
artefact to check and nothing looks wrong. It survives every review that only inspects what
was written down.

> **The defence is a different act: go and look at something nobody has looked at.**
> Not check the reading, not re-run the test, not measure against the corpus. Open the
> thing. The markers already say which thing.

#### WHAT THE MARKERS WERE WORTH, MEASURED

Swept `docs/` — **25 markdown files plus 2 at the repository root. Code comments and
`~/amazon-api-watch` were outside the sweep**, so this is a floor on the marker count and
not a census.

Four commission markers were named across `commercial-finding-catalogue-depth.md`,
`dashboard-build-brief.md` and `partnership-tracker.md`. **Three closed on 15 August, each
by a single dispatch:**

| Marker | Status |
| --- | --- |
| *"Boots sits at the bottom of the commission range"* — carried, not confirmed | **CONFIRMED, and understated.** Boots's standard groups top out at 2.00%: the lowest CEILING of all sixteen advertisers, against 3.00% for the next lowest. It also carries 26 zero-rated groups that no other advertiser has. |
| *"£1.33 average commission per sale"* — from the 1 August brief, not the database | **CLOSED at £1.14 measured**, £1.19 on complete weeks. The carried figure was 12 to 17 per cent high. |
| *"These endpoint names and shapes are recalled, not observed"* | **CLOSED.** All four probed. `commissiongroups` confirmed as the rate card exactly as predicted; `reports/advertiser` contradicted the recalled primary key. |
| *"Commission rates are not in the database"* | **STILL TRUE.** The card was printed to an Actions log, not stored. |

**The fourth is now the cheapest finding on the list**, because everything it needs already
exists: the endpoint is confirmed, the credential works, the puller and its table pattern
are built. It is a table and a loop.

> **A marker is a question someone already identified and nobody has asked.** Three of
> these took one dispatch each. That is the going rate, and it is why the remaining ones
> should be read as a work queue rather than as caveats.


---

### 121. A count-scoped sweep passes a page whose count is right and whose claim is false

**Raised:** 15 August 2026, running the departure sweep for Atelier De Glow (r29) ·
**Recorded here rather than in `docs/superdrug-removal-plan.md` deliberately. Neither
finding is caused by a departure, neither is fixed by completing one, and filing them
inside the r29 retirement would date them to an event they have nothing to do with.**

Two live, indexed, hand-written claims. One is wrong in a way no sweep this project has
ever run could detect. The other is a figure that was identified as unverifiable, removed
from the page it was found on, documented in that page's own comment, and left standing on
a page nobody looked at.

#### FINDING 1 — `about.html` SAYS 11, LISTS 11, AND NAMES THE WRONG ELEVEN

`public/about.html:281` — *"Currently live across 11 UK retailers"* — over a `<ul>` of
exactly eleven names. **The count matches the list. The list is internally consistent. The
page is false.**

| | |
|---|---|
| Names listed | 11 |
| Of those, live partners | 10 — **Atelier De Glow is listed and is departing** |
| Live partners **omitted** | 1 — **Niche Beauty, live since 9 August 2026, 8,838 in-stock rows** |

**The two errors cancel in the count and only in the count.** Remove Atelier and the
sentence still reads 11, because Niche Beauty was never added. So the r29 departure sweep
needs **both edits, not one** — and a sweep that checks the number would report this page
as clean while it names a retailer we do not sell and omits one we do.

> **THIS IS THE FOURTH INSTANCE OF THE SWEEP-SCOPE CLASS, AND IT IS NOT THE SAME AS THE
> FIRST THREE.**
>
> | # | Instance | Why the sweep missed it |
> |---|---|---|
> | 1 | **Item 66**, 12 Aug — bath & body absent from five surfaces | *"absence has no keyword to grep for"* |
> | 2 | **3 Aug copy sweep** (`superdrug-removal-plan.md`) — three false claims on the swept page | searched for a retailer name; the claims name nobody |
> | 3 | **Item 110**, 14 Aug — `/app` outside the eleven-places supplements sweep | the count described the sweep's reach, not the surface area |
> | 4 | **this one** | **nothing was missed. The sweep looked, checked the count, and the count was correct.** |
>
> **The first three are under-reach: the sweep did not look there.** This one looked, ran
> its check, and passed — because **the token it can verify is true and the assertion it
> stands for is false.** A count is a summary of a list; verifying the summary says
> nothing about the membership, and membership is the whole claim the page is making.
>
> **The rule that follows: verify the list, never the count.** A retailer roster claim is
> checked by diffing the `<li>` set against `retailers`, not by comparing a number against
> `count(*)`. The number agreeing is not weak evidence that the list is right — **it is no
> evidence at all**, and it is worse than no check because it produces a pass.

**Two further things in that block are stale, both of which would mislead the next
sweeper**, and both sitting inside the comment that exists to prevent exactly this:

- The maintenance comment (lines 265–279) states the table has **12** rows with
  `active = true` and that the twelfth is Branded Beauty. **It has 13.** Niche Beauty
  landed after the comment was written and nothing updated it.
- The comment instructs the reader to keep the list *"in step with `retailers` where
  active = true"*. **Following that instruction literally adds Branded Beauty**, whose
  programme closed on 30 July and whose `active` flip is still held. `active` alone has
  never been the liveness test — see the two-flag rule in `superdrug-removal-plan.md`
  Step 0.

#### FINDING 2 — THE 25% FIGURE SURVIVED ON THE PAGE NOBODY SWEPT

`public/work-with-us.html`, the stat grid at lines 264–280. Four hand-written numbers,
none generated, none refreshed by anything:

| Claim | Measured, 15 August 2026 |
|---|---|
| **`~25%` average saving on a typical routine** | **The exact figure removed from the homepage on 3 August as unverifiable.** |
| `10` UK retailers currently live | **11** partner-live (13 rows `active = true`, less Branded Beauty and, imminently, Atelier) |
| `80k+` products tracked in real time | 98,404 in `products_active` — conservative, and stale in the other direction |
| `5k+` multi-retailer price comparisons | **14,056** products with ≥2 live retailers |

> **THIS IS ITEM 66'S SHAPE ON A LIVE MARKETING SURFACE, AND THE HOMEPAGE FIX IS WHAT
> MAKES IT WORSE RATHER THAN BETTER.**
>
> The savings claim was found on `public/index.html` on 3 August, judged unverifiable,
> removed, and **the reasoning was written into that file as a standing comment** —
> *"a hand-written percentage above the fold would contradict them… If a savings figure is
> ever wanted here it must be GENERATED"*. That comment is still there and still correct.
>
> **It protects one file.** The same claim, the same number, was sitting on
> `work-with-us.html` the whole time. The fix was scoped to where the problem was found,
> the note documenting the fix was scoped to the same file, and **a comment in
> `index.html` cannot be read by anyone editing a different page.**

**It is reachable from the sitemap.** `/partners.html` is in `STATIC_PAGES`
(`app/sitemap-pages.xml/route.ts:31`) and 301s to `/work-with-us` (`vercel.json:14`),
which serves this file. So it is a submitted, indexable URL — **and the page's audience is
prospective retail partners**, which makes a wrong live-retailer count and an unverifiable
savings claim the two worst possible figures to be wrong on.

**`work-with-us.html` is not in the Step 5 sweep table.** That table lists the homepage
strip, the demo basket, `about.html`, article price tables, meta descriptions and logo
assets. **Six surfaces, and the partnerships page is not one of them** — item 110's
finding restated: the sweep table is a floor, and it has now been short twice.

#### WHAT TO DO, AND WHAT NOT TO INFER

- **Fix both pages.** Neither edit is blocked on the r29 flip and neither should wait for
  it — `work-with-us.html` in particular is wrong today, independent of any departure.
- **Add `public/work-with-us.html` to the Step 5 sweep table**, with its stat grid called
  out by line the way the demo basket is.
- **Do not read this as an argument that the 3 August fix was inadequate.** It was correct
  and it was documented. **The gap is that a per-file comment is a per-file mechanism**,
  and there is still nothing that compares any hand-written claim against the database —
  the same absence Step 5 has recorded since 1 August. **This is a third instance of that
  absence, not a new one.**

#### AN UNCHASED DISCREPANCY IN ITEM 104's TABLE

Flagged here because re-measuring the fleet's barcode shapes for the r29 departure ran
across it. **Not investigated — deliberately, it is outside that brief.**

| retailer | item 104 recorded (14 Aug) | measured 15 Aug |
|---|---:|---:|
| **Stylevana**, 12-digit reseller | **967** | **2,559** |
| Atelier De Glow, 12-digit reseller | 0 | **1** |
| Atelier De Glow, barcodes / Korean 880 | 547 / 544 | 547 / 544 — **unchanged** |

**967 is exactly the Escentual figure in the 15 August measurement**, and Escentual is not
in item 104's table. That coincidence is the reason to look, and it is also the reason not
to assume: it could be a column transcribed from the wrong row, or two different
definitions of "reseller-style", or a real one-day feed change. **Item 104's argument does
not depend on which** — Stylevana supplies reseller codes at either 967 or 2,559, and the
merge it justified stands. Resolve it if the table is ever cited for a number rather than
for its point.


---

### 122. The 18 measured the regex, not the problem, and path-first relocated the sildenafil case

**Raised:** 16 August 2026, from the Boots supplements 04:30 read · **Applied in part:** six
medicines excluded, migration `20260816090000`. The rest is a human pass, unfinished.

#### THE COUNT I REPORTED WAS WRONG IN BOTH DIRECTIONS, AND THAT LEADS THIS ITEM

The read said **18 bad rows in the 1,683**. That figure came from a regex over product names
and it should not be carried anywhere.

| | |
|---|---|
| **Two of the 18 were false positives** | `Jude Collagen & Creatine Pelvic Floor Supplements Sachets 14S` (149983) and `... X30 Servings, 255g` (149898) are ingestible supplements. They matched on `pelvic floor`, **a token they share with the Soma Flex devices** they were sitting next to. |
| **Five more were missed entirely** | an insect repellent pump spray (148989), a collagen neck patch (150442), a razor and shave gel bundle (150449), a sleep kit (149127), a topical arnica ritual (150216). Found only by widening the net. |
| **A structural pass then found more still** | makeup and skincare under `top_category = 'supplements'`: bronzing drops, highlighting drops, a brow tint, loose setting powder, jelly eye patches, a lip balm bundle, Tiger Balm, a kids' hair oil, Vicks Vapopads. |

> **THE 18 WAS A MEASURE OF THE REGEX. It is the same defect as the 1,715 below, one level
> down, and it was committed in the act of writing up the 1,715.** Item 110's rule again:
> the number describes the sweep's reach, not the surface area.

**The other half of the finding is that the right move was to stop.** The obvious next step
was a better pattern. **A better pattern produces another sample-fitted number**, and that is
precisely what the name-based supplement rule already demonstrated: `oil`, `gel`, `butter`
and `wash` were reasonable tokens chosen from real examples, and they are application words
in beauty and dosage forms in health. **A third pattern fitted to a third sample is not a
third attempt at the same problem; it is the problem.** So the population goes to a human
pass and the mechanism takes ids, not patterns.

#### THE DESIGN DID NOT FAIL. IT MOVED THE FAILURE

Three Viagra Connect listings went live with prices this morning, alongside a hayfever
antihistamine, thrush pessaries and Regaine 5%. All created by `scrape_log` run 302 between
04:30:56 and 04:31:17, so they arrived on the supplements path rather than drifting in.

The founding case for path-first was `Viagra Connect Sildenafil Film-Coated Tablets` being
classified as **skincare** by a name rule (`scripts/categorisation-harness.mts`, argued in
item 92). The path-first branch takes the category from the path the retailer filed the row
under.

> **It worked exactly as designed and produced the same product in a different wrong place.
> Viagra Connect is no longer skincare. It is a supplement.**

The name rule failed on tokens; the path rule fails on a path that contains medicines.
**Neither is a tuning error and neither is fixed by adjusting the other.** The second is
worse in one respect: a misfiled skincare product is a bad category, whereas a P-medicine
carrying a price on a beauty comparison site is a compliance question.

#### ITEM 92 PREDICTED THIS IN ITS OWN SENTENCE

Item 92, arguing against the wide `Health Care` subtree, wrote:

> *"The shipped path-first rule has NO NAME-BASED SUPPLEMENT TEST AT ALL. It trusts the
> path. ... Feed it a subtree that is not a supplements path and it will faithfully call a
> wheelchair a supplement."*

**That sentence is true of the leaf as well, and item 92 applied it only to the subtree.**
The argument was used to reject the wide path and never turned back on the narrow one. The
question item 92 posed — *is this a path where "on it" means "ingested"?* — was answered
"yes, for the leaf" without checking. **The answer is no.**

#### THE MEDICINES SAT INSIDE THE 1,715 WHILE THE 28 WERE READ AS THE CONTAMINATION

| Boots leaf, item 92 | rows |
|---|---:|
| admitted by the prefix | 1,743 |
| **supplements per the shipped rule** | **1,715** |
| topical rows arriving alongside | 28 |

**The 28 were read as the contamination and the 1,715 as the clean population.** Medicines
are not topical, so `SUPP_TOPICAL_FORM` could not see them, nothing counted them, and they
sat inside the 1,715 as supplements. **The number quoted as the size of the win was also the
number carrying the defect.**

> **A count of what a rule admits is not a measure of what it got right.** The 28 measured
> one veto firing. It was read as though it measured correctness. Only looking at the
> admitted rows separates the two, and a confident admitted-count is exactly what makes that
> step feel unnecessary.

#### THE PROPERTY THE FIX RESTS ON, MEASURED RATHER THAN ASSUMED

The design needed one thing to be true: **that a row-level edit survives the next import.**
It does, and it was checked in the importer rather than assumed:

| line | action | fields written |
|---|---|---|
| `index.ts:2429` | `createActions.push` | **`tags`, `top_category`, `subcategory`**, plus price/url/stock/identifiers |
| `index.ts:2197` | `updateActions.push` | `rp_id, product_id, price, url, in_stock, ean, mpn, image_url` |
| `index.ts:2315` | `linkActions.push` | `product_id, ext_id, price, url, in_stock, ean, mpn, image_url` |

> **`tags`, `top_category` and `subcategory` are written at CREATE ONLY. The update and link
> paths carry no categorisation fields at all.** So an edit to an existing product row is
> stable across imports, and **only deletion is reversed** — the feed still carries the row,
> the next import finds no match, and it is recreated under a **new id**.

That asymmetry is the whole design. It is why this is a table of ids rather than a delete,
and why `in_stock = false` would not have worked either: it is rewritten at 04:30 **and**
`products_active` ignores `in_stock` entirely, so the page would survive with nothing
buyable on it.

**The existing `cleanup_remove` tag was checked and rejected on the same basis.** It is
filtered in ~20 query-layer call sites but **not in `products_active`**, and both
`lib/sitemap.ts` and `getProductById` read `products_active` with no tag filter. A
`cleanup_remove` product loses its listings and **keeps its live, indexed `/product/{id}`
page with the price on it** — the exact surface that made this urgent.

#### APPLIED: `product_exclusions`, AND THE CLAUSE GOES ON THE VIEW

Migration `20260816090000`. A table with `product_id` primary key, a constrained `reason`, a
required `note` saying why THIS id, `added_at` and `added_by`. One clause on
`products_active`:

```sql
AND NOT EXISTS (SELECT 1 FROM product_exclusions x WHERE x.product_id = p.id)
```

**The view and not the call sites, because Step C of the Superdrug removal had to patch
EIGHT separate query sites for want of a chokepoint.** One clause here is honoured by the
product page, the sitemap, the listings, the brand pages and search, without eight edits and
without a ninth being missed later.

**The view was patched from its own live definition** — `pg_get_viewdef` read, clause
inserted at a guarded anchor, result re-applied — so the 22-column SELECT list is carried
verbatim. The guard refuses to patch if the predicate is not the exact expected shape,
because the insert prepends to a flat top-level `AND` chain and an `OR` appearing there would
silently change the meaning.

**Verified on applying:** `products_active` 100,207 → **100,201**, exactly −6; column list
identical; 0 of the six visible; `products` and `retailer_prices` rows **intact**, so prices
keep updating and reversal is one `DELETE` from a table of ids. Supplements 1,770 → 1,764.

The six medicines went first because **none of them needs judgement**: 149604 / 149605 /
149607 Viagra Connect, 149409 Pirilieve Hayfever Relief, 149880 Regaine 5%, 150432 Balance
Activ thrush pessaries.

#### IT DOES NOT STOP TOMORROW'S MEDICINE

**This stays in the record as the honest cost of a list, and it must not be papered over
with a rule.**

A new P-medicine arriving on the same path tomorrow gets a **new product id**, is not on the
list, and goes live. The list covers exactly what is on it and nothing else, **by design**.
The answer is to re-run the detection query after an import and curate what it surfaces —
never to promote the list into a pattern, because a pattern is fitted to the rows that
produced it and the two failures above are both instances of that.

The table comment says so, so that a future reader meeting the table cannot mistake it for a
rule that fell short.

#### THE HUMAN PASS: `boots-supplements-working-list-2026-08-16.csv`

**102 candidates, sorted so the unambiguous ones come first.** One row per candidate with
`brand`, `name`, `price`, `live_retailers`, a `proposed_verdict`, and blank `done`, `verdict`
and `note` columns to work in — the shape of the ASIN working list (item 105).

| bucket | rows | proposed |
|---|---:|---|
| `A_medicine` | 1 | `medicine` — Boots Repel DEET pump spray |
| `B_device` | 11 | `device` — blood test kits, Soma Flex trainers, Vicks Vapopads, a vet syringe |
| `C_veterinary` | 4 | `veterinary` |
| `D_topical_or_cosmetic` | 18 | `not_a_supplement` — bronzing drops, brow tint, setting powder, massage oils, Tiger Balm, a razor bundle |
| `E_token_clash_probably_keep` | 6 | **`KEEP`** — hair/skin/nail tablets and gummies caught by the `nail` token. **Listed precisely because the proposal is to keep them.** |
| `F_bundle_review` | 62 | *(blank)* — multi-item bundles, genuinely undecided |

**Built from several independent signals rather than one pattern**, and each row carries the
bucket that caught it, so a wrong proposal is visible as a wrong bucket rather than hidden in
a verdict. **Bucket E exists to make the regex's own errors reviewable**: those six are the
class that produced the two false positives above.

> **THE FROZEN-SNAPSHOT PROPERTY APPLIES TO THIS FILE, per item 105.** The ASIN list had one
> stale id of 44 within four hours because a merge moved a product underneath it. **Re-check
> every id against `products.merged_into` and against `product_exclusions` before applying
> anything from this file.** The catalogue moves; a CSV does not.

**Still open, and bigger than a suppression list:** whether the Boots leaf is the right path
at all, now that it is known to contain medicines, devices, veterinary products, makeup and
topicals. That is item 92's question asked properly.

---

### 123. A weekly upsert cannot record a mid-week change

**Raised:** 16 August 2026, caught before running rather than after · **A property of
`fmb_quality_snapshot_write`, not an incident.**

`fmb_quality_snapshot_write(p_week_start date DEFAULT (date_trunc('week', now()))::date)`
upserts on `week_start`. On 16 August `date_trunc('week', now())` is **2026-08-10** — the
week_start of the single existing row, which is the **pre-change baseline** for the Boots
supplements activation.

> **Calling the writer with its own default, on any day that is not the first of a week,
> overwrites that week's row with values measured later in the same week. For a change that
> lands mid-week, that destroys the only "before" the series has.**

Nothing about this is specific to Boots. It is structural:

| | |
|---|---|
| The series' resolution | one row per week |
| A change's resolution | an instant |
| What the boundary table exists to explain | a step between two rows |
| **What the before must be** | **measured before the change, in the week the change lands** |

**So the two collide by construction.** A change that lands mid-week needs a before-reading
inside a week whose row the writer will happily overwrite, and the writer's default argument
is precisely the value that does it. **A re-run is not idempotent across a change boundary**,
even though an upsert reads as though re-running is free.

**Rules that follow:**

- **Do not run the writer between a change landing and the following Monday.** For the Boots
  activation the first legitimate post-change row is `week_start = 2026-08-17`.
- **A deliberate re-run inside a week must pass an explicit `p_week_start`**, never the
  default, and never the current week's value if a change has landed inside it.
- **The baseline for a mid-week change belongs in a side table**, which is what
  `fmb_boots_supplements_baseline_20260815` is and why it was right to take it. See the
  correction to boundary row id 36 for what happens when a side-table figure is then
  mistaken for a series member.

**This was caught by reading the default before calling the function**, not by a guard.
There is no guard: the function will overwrite a pre-change row without complaint, and the
overwritten values are unrecoverable. **If a guard is ever wanted**, the cheapest is to
refuse the write when `p_week_start` matches a week that a `platform_changes` row falls
inside and the existing row predates that change — but that is a real build, and the rule
above costs nothing.


---

### 124. The copy assumes the narrow scope, the category carries the wide one

**Raised:** 16 August 2026, by Robbie · **BLOCKING the exclusion batch.** 45 curated
exclusions are held pending this, deliberately.

**The intended supplements category is TWO groups:** sports nutrition (whey, creatine,
hydration) and beauty-adjacent (collagen, hair-skin-nails, biotin). **Jude bladder health is
neither, and neither is most of what arrived on 16 August.**

#### THE COPY ALREADY SHIPPED THE NARROW READING

Four articles published this morning are the site's only prose about supplements. **Every
one of them assumes beauty-adjacent**, and the anchor text is the clearest statement of
scope anywhere on the site:

| anchor on `/supplements` | count |
|---|---:|
| *"browse **beauty supplements** across UK retailers"* | 3 |
| *"browse **beauty supplements**"* | 1 |
| *"supplements category page"* | 1 |

Vocabulary across all four: **collagen ×9, biotin ×3, hair-skin-and-nails ×1, "beauty
supplements" ×4. Whey, creatine, protein, electrolyte and sports appear ZERO times**, and so
does every general-health term.

> **So the published copy is narrower than even the two intended groups. It promises beauty
> supplements and links to a page serving 1,764 products, 275 of which are beauty-adjacent.**
> A reader arriving from *"browse beauty supplements"* lands on Osavi chromium, SlimFast
> shakes, MyHealthChecked blood tests and Jude bladder capsules.

**This is the reason to settle scope now rather than let it accumulate.** The copy is not a
description of the category; it is a *commitment about* the category, and it was made in
public this morning. Every row excluded one at a time moves the category toward that
commitment without anyone deciding to, which is how a scope gets decided by accident.

#### WHY THE 45 ARE HELD

**Several of the 45 are correct under the wide reading and wrong under the narrow one, and
the reverse.** They were curated against "is this a supplement", not against "is this in
scope". Two examples that flip:

- **Jude bladder health** — a genuine ingestible supplement, so it survives the wide
  reading; neither sports nor beauty, so it fails the narrow one. Three Jude bundles are in
  the batch and six other Jude products are not, which is only incoherent under the wide
  reading.
- **Calpol, Calprofen, York Test, MyHealthChecked** — out under BOTH readings, and they are
  the only part of the batch that is unambiguous either way.

**Applying the batch first would answer the scope question with 45 individual judgements
instead of one decision.**

#### THE MEASURED SPLIT, 1,764 PRODUCTS

Name-token classification, precedence `none-of-these > paediatric > sports > beauty >
residual`:

| group | products | share |
|---|---:|---:|
| **sports nutrition** | **302** | 17.1% |
| *(sports AND beauty tokens both)* | *24* | *1.4%* |
| **beauty-adjacent** | **275** | 15.6% |
| general health (residual) | **1,038** | **58.8%** |
| paediatric | 73 | 4.1% |
| none-of-these | 52 | 2.9% |

> **IN SCOPE UNDER THE NARROW READING: 601 of 1,764, or 34%. TWO-THIRDS OF THE CATEGORY IS
> OUTSIDE THE INTENDED DEFINITION.** This is not a tidy-up. It is most of the category.

#### NO SIGNAL SEPARATES THEM RELIABLY, AND THE PATH CANNOT BE READ

| signal | reliability, measured on this corpus |
|---|---|
| **name** | **60.1% unambiguous.** 1,060 of 1,764 match exactly one group; **551 (31%) match NO group vocabulary at all** and 153 match two or more. The residual is not a gap in the token list, it is the shape of the problem: general health is open-ended (Osavi chromium, lion's mane, MSM, shilajit, sea moss, CBD, saw palmetto), whereas sports and beauty have closed, recognisable vocabularies. |
| **brand** | **weak. Only 44.9% of the corpus sits in a brand that is wholly in or wholly out.** 972 products sit in 67 mixed brands, 32 of which carry 10+ products. **Boots itself is 19 in-scope of 133.** Osavi 21/85, Solgar 8/30, and even Myprotein is 25/35 because it also sells Myvitamins. |
| **existing `subcategory`** | **poor agreement.** 202 products carry `subcategory = 'sports'`; name-classification puts 302 in sports and the two sets overlap on only **163**. Both are name-derived, so this is one name rule disagreeing with another. |
| **Boots sub-path** | **UNKNOWN, AND UNKNOWABLE FROM STORED DATA — see below.** |

#### THE PREFIX MATCHER IS WHY THE SUB-TAXONOMY IS INVISIBLE

`merchant_product_category_path` is **read at import time and never persisted** — not on
`retailer_prices`, not on `products`, and `scrape_log` run 302 carries no raw-path samples
(`sample_raw_category_data` is returned in the HTTP response, not written to the log).

**And the matcher would hide any deeper level even if one exists:**

```ts
function isOnSupplementsPath(categoryPath: string, prefixes: string[]): boolean {
  return prefixes.some((p) => haystack.startsWith(p.toLowerCase()));
}
```

> **`startsWith`, not equality.** A row filed at
> `… > Vitamins & Supplements > Sports Nutrition` matches the configured prefix exactly as
> well as one filed at the bare leaf, is admitted identically, and the extra level is
> discarded unread. **The design decision that made path-first work is the same one that
> makes Boots' sub-taxonomy unobservable from here.**

**This is the question worth answering before choosing a signal**, because path-first beat
name-based everywhere else and a sub-path would beat both of the weak signals above. It
takes one read-only dispatch:

```
gh workflow run feed-diag.yml -f classify_paths='Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements' -f sample_rows=200
```

`.github/workflows/feed-diag.yml` writes nothing — downloads the feed to the runner, reads,
prints. **Not run here: the brief was to report, and dispatching CI is an action.**

#### WHAT A DECISION NEEDS TO COVER

1. **Narrow or wide.** If narrow, ~1,163 products leave, which is a catalogue change of a
   different order from a suppression list and needs the departure doctrine's treatment
   (sitemap, 410s, brand pages going to zero), not `product_exclusions`.
2. **If narrow, what carries it** — a second `category_path_must_contain` entry scoped to a
   sub-path, if one exists; otherwise a curated brand allowlist, since name is 60% reliable
   and brand is 45%.
3. **Paediatric** (73) — out under both readings as stated, but worth naming explicitly
   rather than letting it fall out of a token list.
4. **The articles.** If the answer is wide, the four articles' *"browse beauty supplements"*
   anchors are wrong and need rewording. **The copy and the category have to agree, and
   right now the copy is the only one of the two that has committed.**


#### REVISED SHAPE, 16 AUGUST: TWO TOP-LEVEL GROUPS, AND THE COPY GETS MORE WRONG NOT LESS

**Robbie's revised shape supersedes the narrow-scope question above.** Two top-level groups,
each with subcategories: **health and beauty supplements**, and **sports**. Jude bladder
health is IN SCOPE under women's health rather than excluded.

**Almost nothing leaves. No departure event, no 410s, no brand pages to zero.** The 1,163
out-of-scope figure above is superseded and must not be carried forward — it was measured
against a two-group reading in which general health was out, and general health is now in.

> **THE COPY PROBLEM GETS WORSE UNDER THIS READING, WHICH IS THE OPPOSITE OF WHAT A WIDER
> SCOPE USUALLY DOES.**
>
> A wider category normally makes narrow copy merely incomplete. Here it makes it wrong,
> because the copy does not describe a subset — it names the category. The four articles
> say *"beauty supplements"* five times, collagen ×9, biotin ×3, and **zero** sports terms,
> and they link to a page that will now carry chromium, colostrum, saw palmetto and bladder
> health under a taxonomy whose own top level is *health and beauty supplements + sports*.
>
> **Under the narrow reading the copy was premature. Under this one it is inaccurate.**

**DECISION NEEDED AFTER THE SUBCATEGORY SET LANDS, not before:** the anchor text and the
articles' framing have to name what the category actually is. The set determines the words,
so the copy fix waits on it, but it must not wait longer than that — the articles are live,
indexed and were published this morning.


---

### 125. A working session of human judgement, reproduced by one column we never read

**Raised:** 16 August 2026 · **Measured, feed-diag run 31949314330 on fid 115009.** Section
5b added to `scripts/atelier-feed-diag.mts` to produce it.

#### THE EXCLUSION LIST REPRODUCES FOR FREE, AND THAT IS THE FINDING

A human pass over a 102-row working file identified the non-supplements sitting in the Boots
supplements leaf: bronzing drops, highlighting drops, a brow tint, loose setting powder, lip
duos, a lip balm bundle, massage oils, a razor bundle. **51 ids, curated by eye, over a
working session, and the list is still not exhaustive.**

Boots had already filed every one of them:

| rows | `product_type` |
|---:|---|
| 18 | Beauty & Skincare > **Makeup** |
| 15 | Beauty & Skincare > Makeup > **Nails** |
| 7 | Beauty & Skincare > Makeup > **Lips** |
| 11 | Toiletries > **Bathroom Essentials** |

> **THE RETAILER WAS TELLING US THEY WERE MAKEUP THE WHOLE TIME, ON A FIELD THE IMPORTER
> REQUESTS AND NEVER READS.** The judgement that took a person a working session was
> available as a column value on every row, from the first import.

#### THIRD INSTANCE OF THE SAME SHAPE, AND THE SHARPEST

**The retailer's own taxonomy beating our inference.** This is not new; it is the third time,
and each instance has been cheaper to have and more expensive to have missed:

| # | Instance | Our inference | Their taxonomy |
|---|---|---|---|
| 1 | **Path allowlist** (item 47, `category_path_must_contain`) | name-based scope rules per retailer | one path string, and *"never copy a path allowlist between retailers"* |
| 2 | **Supplements leaf** (item 92, `supplements_path_prefixes`) | a name rule that filed `Viagra Connect Sildenafil` as **skincare** | one leaf, and the shipped path-first rule that replaced the name test entirely |
| 3 | **This** (`product_type`) | **a human pass over 102 rows, a working session, still not exhaustive** | **one column, 100% filled, already correct** |

> **The gap between the two columns widens each time.** In instance 2 the inference was a
> regex and the taxonomy was a config string. Here the inference was a person's afternoon
> and the taxonomy was a field we were already downloading. **The cost of not reading a
> retailer's own filing is not constant — it scales with how hard the question is**, and
> the questions are getting harder as the catalogue grows.

#### THE COLUMN, MEASURED

`merchant_product_category_path` — the field we filter on — is **flat** inside the leaf:
1,771 admitted rows, **zero occurrences of `Vitamins & Supplements >`**. Path-first had
nothing left to give there, which is why this was worth measuring rather than assuming.

`product_type` is populated on **100.0% of all 38,077 Boots rows**, and carries **88 distinct
values** across the 1,771 leaf rows:

| rows | `product_type` |
|---:|---|
| 607 | Health & Pharmacy > Medicines & Treatments |
| 405 | Health & Pharmacy > Lifestyle & Wellbeing |
| 155 | Health & Pharmacy > Vitamins & Supplements |
| 86 | … > Lifestyle & Wellbeing > **Active Nutrition** |
| 61 | Health & Pharmacy > **Women's Health** |
| 43 | … > Vitamins & Supplements > **Beauty Supplements** |
| 38 | … > Women's Health > Women's Vitamins & Supplements |
| 30 | Health & Pharmacy > **Baby & Child Health** |
| 18 / 15 / 7 | Beauty & Skincare > Makeup, > Nails, > Lips |
| 14 | … > Medicines & Treatments > Heart Health |
| 13 | … > Vitamins & Supplements > Multivitamins |
| 13 | Health & Pharmacy > **Men's Health** |
| 11 | Toiletries > Bathroom Essentials |
| 10 / 10 | … > **Joint Health Supplements**, > **Immune System Support** |
| 7 | … > Lifestyle & Wellbeing > Diet & Weight Management |
| 6 | … > Active Nutrition > **Protein Powder** |
| 5 | … > Vitamins For The Brain |

**Boots has already named the subcategories.** Top 30 values cover **1,651 of 1,771 rows
(93.2%)**; the remaining 58 values hold 120 rows between them.

**And the residual stops being the constraint.** A name-token set left **248 of 1,764
(14.1%)** in no subcategory, irreducibly: long-tail single actives (D-mannose, lactoferrin,
pycnogenol, sodium butyrate) and opaque brand codes (Nourished `Bmca Nutrient Stacks`, whose
name carries no product information at all). **`product_type` is 100% filled, so a
product_type-derived set has a residual of zero by construction.** What remains is a mapping
over a finite list, not an inference with an open tail.

#### THREE CAUTIONS, ALL OF WHICH WOULD MISLEAD A LATER READER

**1. TWO POPULATIONS, TWO SETS OF NUMBERS.** The figures that first drew attention are
feed-wide; the ones that matter are inside the leaf. They are not the same measurement:

| | Medicines & Treatments | Lifestyle & Wellbeing |
|---|---:|---:|
| whole feed (38,077 rows) | **1,761** | **924** |
| **inside the supplements leaf (1,771 rows)** | **607** | **405** |

Most of Medicines & Treatments sits outside the supplements path entirely. **Quoting 1,761
as the in-scope medicines population overstates it by nearly threefold.**

**2. THE `supp %` COLUMN IS THE SHIPPED RULE READING ITSELF.** Section 5b prints, per
`product_type` value, how many rows the shipped rule calls supplement-shaped. It reads ~100%
almost everywhere.

> **That is not two independent signals agreeing. It is one signal printed twice.** The
> shipped rule's whole design is that a row on a configured supplements path is a supplement
> unless it is visibly topical — so it says "supplement" for nearly everything on that path
> *by construction*, whatever `product_type` says. **The discriminating power is in the
> VALUES, never in that percentage.** Reading the 100% as corroboration is reading one
> signal twice and calling it agreement.

**3. `Medicines & Treatments` IS NOT A MEDICINES ALLOWLIST.** 607 of 1,771 rows is far too
large to be regulated medicines, and Boots evidently uses that node broadly. It is where
Viagra Connect, Calpol and Calprofen sat, so **it is the right place to look and not the
answer**. Treating the node as a medicines list would suppress roughly a third of the leaf.
Not chased.


---

### 126. Mapping 88 values to a shippable set, and the importer change that makes it durable

**Raised:** 16 August 2026 · **PROPOSAL. Nothing applied.** Depends on item 125.

#### THE MAPPING RULE: LONGEST PREFIX WINS, NOT EXACT MATCH

`product_type` is hierarchical, so the mapping is a **prefix match with longest-prefix
precedence** — deliberately the same shape as `supplements_path_prefixes`
(`isOnSupplementsPath`, `startsWith`). **This is what handles the tail without enumerating
it**: the 58 values holding the last 120 rows are deeper nodes under parents that are already
mapped, so they inherit rather than fall through. **An exact-match table would need all 88
entries and would break on the 89th.**

#### PROPOSED SET

**Group B — Sports**

| `product_type` prefix | subcategory | rows |
|---|---|---:|
| `… > Active Nutrition > Protein Powder` | protein | 6 |
| `… > Lifestyle & Wellbeing > Active Nutrition` | sports (general) | 86 |
| | **group total** | **92** |

**Group A — Health & beauty supplements**

| `product_type` prefix | subcategory | rows |
|---|---|---:|
| `… > Vitamins & Supplements > Beauty Supplements` | **beauty** | 43 |
| `Health & Pharmacy > Women's Health` *(+ `Women's > …` variants)* | **women's health** | ~125 |
| `Health & Pharmacy > Men's Health` *(+ `Men's > …` variants)* | men's health | ~21 |
| `Health & Pharmacy > Baby & Child Health` | **paediatric** | 30 |
| `… > Vitamins & Supplements > Multivitamins` + bare `> Vitamins & Supplements` | vitamins & minerals | 168 |
| `… > Medicines & Treatments > Heart Health` | heart | 14 |
| `… > Vitamins & Supplements > Joint Health Supplements` | joints & bones | 10 |
| `… > Vitamins & Supplements > Immune System Support` | immunity | 10 |
| `… > Lifestyle & Wellbeing > Diet & Weight Management` | weight management | 7 |
| `… > Vitamins & Supplements > Vitamins For The Brain` | brain & focus | 5 |
| `… > Medicines & Treatments > Eyecare` | vision | 5 |

**Outside both groups — suppress, do not file**

| `product_type` prefix | rows |
|---|---:|
| `Beauty & Skincare > *` (Makeup, Nails, Lips, Facial Skincare) | ~49 |
| `Baby & Child > Feeding` (equipment) | 15 |
| `Toiletries > *` | 11 |
| `Wellness > Food & Drink` | 9 |
| `Gift` | 6 |
| `Health & Pharmacy > Sexual Pleasure & Wellbeing` | 6 |
| | **~96** |

#### THE HONEST PROBLEM WITH THIS SET: 57% LANDS ON TWO GENERIC PARENTS

**`Health & Pharmacy > Medicines & Treatments` (607) and `Health & Pharmacy > Lifestyle &
Wellbeing` (405) are bare parent nodes with no leaf — 1,012 of 1,771 rows, 57%.**

> **`product_type` gives a clean TOP-LEVEL grouping and a clean OUT-OF-SCOPE test. It does
> NOT give subcategory granularity for the majority.** The named subcategories above cover
> roughly 450 rows. **The set is residual-free and thin at the same time**, and saying only
> the first half would oversell it.

**The second pass for those 1,012 is name tokens WITHIN a product_type node**, which is a far
safer use of them than name tokens over the whole corpus: the population is already known to
be health-and-wellbeing, so the vocabulary is bounded and the failure mode is a wrong
subcategory rather than a medicine on a beauty site.

#### A TENSION TO RESOLVE BEFORE ADOPTING THE SPORTS MAPPING

**Name tokens put 365 products in sports. `Active Nutrition` holds 92.** The other ~273 are
most likely inside `Lifestyle & Wellbeing` (405) — hydration and electrolyte products, which
Boots may not file as active nutrition at all.

**Do not adopt the sports mapping until that is checked**, because it decides whether
hydration is sports or wellbeing, and that is a visible product decision rather than a
filing detail. **One diag run answers it**: cross-tab `product_type` against the sports name
tokens on the admitted rows.

#### PAEDIATRIC AND JUDE RESOLVE INSIDE THE SET

Both were being handled as separate open questions. Under this mapping neither is:

- **Paediatric** becomes `Health & Pharmacy > Baby & Child Health` → a **subcategory of
  group A**, not a third top-level group and not out of scope. Boots' own filing settles it,
  and it separates the supplements (30 rows) from `Baby & Child > Feeding` equipment (15),
  which a name rule could not. **The name-derived 73 is the wrong number** — it counted
  paediatric-flavoured products across the corpus rather than Boots' paediatric node.
- **Jude's three held bundles** file wherever Boots files bladder health, which is
  `Health & Pharmacy > Women's Health`. **They become women's health rows, along with the six
  other Jude products, which removes the incoherence** of excluding three bundles while
  leaving a fourth live. No separate decision needed.

#### THE IMPORTER CHANGE, AND WHY READING THE FIELD IS NOT ENOUGH

**Two config values, moving together, empty for every retailer until deliberately set** —
the same shape as `category_path_must_contain` / `supplements_path_prefixes`, and subject to
item 91's rule that **either alone is a silent no-op**, so the migration must assert the pair:

```
retailer_import_config
  subcategory_source_field  text    -- which feed column carries the retailer's taxonomy
                                    -- ('product_type' for Boots). NULL = feature off.
  subcategory_prefix_map    jsonb   -- [{prefix, group, subcategory}], longest prefix wins.
                                    -- NULL/[] = feature off.
```

**It must not be a name rule.** The whole point is that this is the retailer's filing; a name
fallback inside it would reintroduce exactly the inference the column replaces, and would do
it invisibly.

> **READING THE FIELD AT IMPORT TIME IS NECESSARY AND NOT SUFFICIENT, AND THIS IS THE PART
> THAT DECIDES ONE-OFF VERSUS DURABLE.**
>
> Item 122 measured it: `tags`, `top_category` and `subcategory` are written at **CREATE
> only** (`index.ts:2429`). `updateActions` (2197) and `linkActions` (2315) carry
> price/url/stock/identifiers and no categorisation.
>
> So an importer that reads `product_type` **files new products correctly and never corrects
> an existing one.** The 1,719 already in the catalogue would need a backfill, and — worse —
> **if Boots recategorises a product tomorrow, we would never see it.** The mapping would be
> correct on the day it shipped and drift silently from then on.

**Scope is therefore three parts, and the third is the one that gets dropped:**

1. **Config pair + migration** asserting both are set together.
2. **Importer reads the field on CREATE** and writes group/subcategory from the map.
3. **`updateActions` carries `subcategory` (and `top_category`) so re-filing propagates.**
   Without this the feature is a backfill with extra steps.

#### PART 3 IS A DECISION, NOT A DEFAULT — AND HERE IS WHAT IT COSTS

**Recorded as a framing rather than a recommendation, because the framing is the part that
survives.**

> **Stopping at part 2 is CHOOSING a one-off.** It is not a smaller version of the feature
> and it is not "part 3 later" unless someone writes down that it is. An importer that reads
> the retailer's taxonomy on CREATE only files new products correctly and **never corrects an
> existing one**, so the mapping is right on the day it ships and drifts silently from then
> on. If Boots re-files a product tomorrow, nothing sees it. **That is a legitimate choice.
> It is not a default, and it must not become one by nobody deciding.**

**What part 3 costs, stated so the decision is made against it rather than against nothing:**

- **Every import becomes a potential recategoriser.** Today categorisation is written once,
  at creation, so a bad rule mis-files new rows and leaves the catalogue alone. With
  `updateActions` carrying `subcategory`, **a bad map moves products every night rather than
  once**, across the whole retailer, silently, on the schedule.
- **The map has never run against live data.** It is derived from one read-only feed
  measurement. Extending the hot path to trust it before it has produced a single import is
  the same order of risk as the coalesce work took, without the coalesce work's evidence.
- **The failure is quiet.** A mis-filed subcategory produces a page that renders, sells and
  ranks. There is no error, no alert and no count that goes wrong — the same property that
  let the medicines sit inside the 1,715.

**So the sequence is the one everything else took: land it inert, backfill, read one cycle,
then decide.** Part 1 is applied (migration `20260816140000`, both columns NULL for all 15
retailers, CHECK enforcing the pair). Part 2 is the importer read. **Part 3 is deferred with
its cost written down, which is the difference between deferring and forgetting.**

#### THE SPORTS HALF OF THE MAP CANNOT BE ADOPTED — MEASURED 16 AUGUST

**The tension above resolved, and against the mapping.** feed-diag run 31950328936, section
5b `sport` column and section 5c:

| `product_type` node | rows | sports-token rows |
|---|---:|---:|
| Health & Pharmacy > Medicines & Treatments | 607 | **142** |
| Health & Pharmacy > Lifestyle & Wellbeing | 405 | **98** |
| **… > Active Nutrition** (+ Protein Powder) | 92 | **75** |

> **THE NODE NAMED FOR SPORTS HOLDS 22% OF THE SPORTS POPULATION.** A map that routes
> `Active Nutrition` to sports would capture 75 rows and miss roughly 240.

**And the rows elsewhere are not token false positives.** Section 5c prints them:
`Applied Nutrition Creatine Monohydrate`, `C4 Original Pre-Workout`, `Xtend Original BCAA`
and `Phizz … Hydration, Electrolytes` under **Medicines & Treatments**;
`Optimum Nutrition Gold Standard 100% Whey`, `Myprotein Clear Whey` and
`Liquid IV Hydration Multiplier` under **Lifestyle & Wellbeing**. These are unambiguous
sports nutrition, filed by Boots under two nodes that are not about sport.

**Boots files Phizz hydration under Medicines and Liquid IV hydration under Lifestyle — the
same product class, two different parents.** So the retailer is not merely coarse here, it is
*inconsistent*, and where hydration belongs is a decision to make rather than one to read
off.

> **THIS IS THE HONEST LIMIT OF ITEM 125's FINDING, AND IT BELONGS NEXT TO IT.** The
> retailer's taxonomy beat our inference on out-of-scope detection and on the named
> subcategories, comprehensively. **It loses on sports.** "Their taxonomy beats our
> inference" is true of a question, not of a retailer, and the second half of that sentence
> is the part that stops it becoming a slogan.

**Consequence for the set:** group A (health and beauty supplements) can be mapped from
`product_type` now. **Group B (sports) cannot**, and needs either a name rule scoped INSIDE
the mapped nodes — safe, because the population is bounded — or a decision from Robbie about
where hydration sits. **Do not adopt half a map and describe it as derived from the
retailer's taxonomy.**

---

### 128. Hydration is sports, and the name rule that files it is bounded by the taxonomy

**Decided by Robbie, 16 August 2026.** Resolves the open question in item 126.

**Whey, creatine and electrolytes are one shopper and one purchase pattern.** The four
articles published this morning name hydration alongside protein and creatine as sports
nutrition, so **splitting it would make copy wrong that was corrected the same day** — the
anchors were fixed at 13:5x and a split would have re-broken the bodies.

Boots cannot answer this: it files Phizz hydration under Medicines & Treatments and Liquid IV
hydration under Lifestyle & Wellbeing. **A retailer inconsistent about one product class
cannot arbitrate that class**, so this was always a decision rather than a lookup.

#### THE RISK PROFILE OF A NAME RULE CHANGES WITH ITS INPUT SET

Group B is therefore a **name rule scoped INSIDE the mapped `product_type` nodes**, and that
scoping is the whole of the argument for it:

| | name rule over the CORPUS | name rule over a TAXONOMY-BOUNDED set |
|---|---|---|
| input | anything in the feed | rows Boots already filed as health/wellbeing/nutrition |
| worst failure | **sildenafil filed as a supplement**, live with a price | **a whey protein filed as general health** |
| who notices | nobody, until someone looks | a shopper browsing the wrong subcategory |
| cost | compliance | a filing error |

> **A name rule operating on a taxonomy-bounded set is a different risk from one operating on
> the corpus, and the difference is not degree.** The bound removes the failure mode that
> made name rules unacceptable in the first place. What remains is mis-filing, which is
> visible, reversible and does not put a P-medicine on a beauty site.

**This is not a licence to reintroduce name rules generally.** It is specifically that
`isSupplementPathTopical`-style inference is acceptable *downstream of* a retailer's own
filing and unacceptable *instead of* it. Record the bound with the rule whenever one is
written, because a rule copied out of its bound is a rule without the property that made it
safe — item 92's `oil`/`gel` veto was exactly that.

**Order from here:** part 2 (importer reads the field), backfill, read one cycle, then decide
part 3 deliberately. **Nothing resumes until the claim sweep in item 129 has a decision.**

---

### 129. The claim sweep the doctrine asked for on a calendar, run for the first time

**Raised:** 16 August 2026 · **REPORT ONLY, nothing changed.** The doctrine's Step 5 records
a second half that is *not* departure-driven — *"grep for the SHAPES rather than the names: a
percentage next to the word save, a currency figure in hand-written markup, a month name, and
any sentence asserting what the optimiser accounts for. Run it on a calendar, not on a
departure."* **It had never been run.** Shapes 5 and 6 are added from `docs/strategy.md`'s
positioning register.

**Findings are ranked by brand consequence, not by count.** The full list is below; these are
the ones that are wrong rather than merely dated.

#### 1. "FIND THE BEST DEAL" IS GENERATED ONTO EVERY SUBCATEGORY PAGE

`app/edit/[slug]`, `app/fragrance/[subcategory]`, `app/hair/[subcategory]`,
`app/makeup/[subcategory]`, `app/skincare/[subcategory]` — five route files, each writing
`Find the best deal` into a `<meta name="description">` **generated across every
subcategory**, so this is on hundreds of indexed pages.

> `docs/strategy.md`: *"FindMyBasket is **not a discount destination and should never be
> framed as one**."*
>
> **This is the largest register violation on the site by surface area, and it is the
> cheapest to fix, because it is generated.** Five strings correct every page at once. Every
> other item in this sweep is hand-written and has to be fixed one at a time.

#### 2. THE DELIVERY-THRESHOLD MECHANISM CLAIM IS FALSE FOR TWO LIVE RETAILERS

`public/index.html:588` — *"We factor in each retailer's free delivery threshold, so you
always see the true total cost."*

| retailer | threshold | cost | |
|---|---|---|---|
| **Debenhams** | **NULL** | £3.99 | flat rate. **There is no free-delivery threshold to factor in.** |
| **Niche Beauty** | **NULL** | **NULL** | `unknown`. Live since 9 August with 8,838 in-stock rows and **we do not know its delivery terms at all.** |

The 3 August note flagged this claim as *"a mechanism claim, wrong for one retailer"*. **It is
now wrong for two, and the second is worse**: `unknown` is a state the
`retailers_delivery_shape` CHECK deliberately makes someone *choose*, and it was chosen by
default when Niche Beauty was onboarded.

**The invented-figures bug is NOT back.** `RoutineBuilder.tsx:495-499` carries terms verbatim
with the `?? '25'` / `?? '3.95'` coercion removed, so nulls stay null. **The claim is wrong;
the arithmetic is not.**

#### 3. EIGHT ARTICLES CLAIM "UPDATED APRIL 2026" AND WERE NOT

`cerave`, `clarins`, `cosrx`, `elemis`, `k-beauty`, `lookfantastic-vs-boots`,
`overpaying-for-skincare`, `skincare-routine-under-40`, `the-ordinary` all carry
**`Updated April 2026`** in the byline. Four of them were materially edited on 1 August to add
supersession notices, and **the byline still says April**. A freshness claim that the edit
itself falsified.

`public/terms.html:96` — **`Last updated: April 2025`**, sixteen months old.

#### 4. TWO COUNTS THAT UNDERSTATE, AND ONE THAT IS STILL WRONG

| claim | where | actual |
|---|---|---|
| `80,000+` products tracked | `public/index.html:387` | **100,214** |
| `80,000+` product catalogue | `public/work-with-us.html:297` | **100,214** |
| `Currently live across 11 UK retailers` | `public/about.html:281` | **still unfixed from item 121** — count right, list wrong |

#### 5. ONE POINT-IN-TIME PRICE PAIR OUTSIDE AN ARTICLE

`public/savings-hub.html:285` — *"A 5-product CosRx routine costs £114 at one UK retailer and
£74 at another"* — in a hub card excerpt. **The article it links to carries a supersession
notice; the card does not.**

#### WHAT THE SWEEP CLEARED

Recorded because a sweep that only lists problems reads as though everything else was checked
and failed:

- **All four articles with hand-written `<td>£` price tables** (clarins 5, cosrx 15, elemis
  12, k-beauty 5) **carry supersession notices.** No unnotified price table exists.
- **The `?? '25'` / `?? '3.95'` delivery fallback is gone**, as recorded on 1 August.
- **Savings percentages are range-based**, per the register: *"can save another 10-30%"*,
  *"even a 10% variation"*. No point-in-time savings claim survives on any page.
- **The supplements anchors** were corrected earlier today and are clean.

#### THE LIST IS LONGER THAN THE SHAPES PREDICTED, AND THAT IS THE FINDING

The doctrine named four shapes. **Two of the five findings above came from the two shapes
added from `strategy.md` rather than from the doctrine's four** — the register violation
(#1), which is the biggest, and the stale-count pair (#4).

> **A sweep specification is itself a sweep scope, and item 110's rule applies to it: the
> shapes describe the reach of whoever wrote them.** The doctrine's four shapes were derived
> from one page on one day in August. They do not reach a `<meta>` description written by a
> `.tsx` template, because the person writing them was looking at hand-written HTML.


#### FINDING 1 FIXED SAME DAY; AND ONE THING THE FIX EXPOSED

Seven strings, `best deal` → `best value`, merged and live. **The replacement was not
invented**: `app/bath-and-body/[subcategory]` already shipped the identical sentence with the
compliant word, so the newer route files were right and the older five had simply never been
swept.

**Exposed by the fix, not fixed by it:** the same templates interpolate `${sub}` twice, and
the second one is wrong. Live right now:

| page | rendered `<meta name="description">` |
|---|---|
| `/makeup/lips` | *"Find the best value on **lips foundation**, lipstick, mascara"* |
| `/hair/cleanse` | *"Find the best value on **cleanse shampoo**, conditioner"* |
| `/skincare/face` | *"face cleansers, serums, moisturisers"* — reads correctly by luck |

**A subcategory name is not an adjective for the product nouns that follow it.** Dropping the
second `${sub}` fixes every one, and `bath-and-body` — the file that was already right on the
register — is also the one that does not duplicate. **The same file was right twice.**
Queued, not fixed.

#### NICHE BEAUTY'S TERMS ARE HALF-KNOWABLE, MEASURED FROM THEIR SITE

Finding 2 asked whether fixing the data beats softening the claim. **Partly.**

| | |
|---|---|
| free-delivery threshold | **£75.00**, stated plainly and confirmed on two separate pages of `niche-beauty.com/en-gb` |
| standard UK delivery cost below it | **NOT PUBLISHED ANYWHERE** — reachable only by building a basket and going to checkout |

**£75 would be the highest threshold in the fleet by half** — the next highest are Perfume
Click and YesStyle at £50, and the median is £30. That is materially different for basket
optimisation, so leaving it `unknown` is not a neutral placeholder.

> **But the shape CHECK will not accept a threshold without a cost**, and it is right not to.
> `tiered` requires both. **Writing £75 with a NULL cost recreates the exact shape the
> 1 August work called self-contradictory** — free above a threshold and free below it, which
> no retailer means.

**So the options are: run a checkout to obtain the cost, or leave it `unknown` and stop
claiming the mechanism.** What must not happen is a threshold entered without its cost,
because that is the 1 August defect with a fresher date on it.

#### `about.html` IS NOW TWICE-FLAGGED AND STILL WRONG

**Item 121 recorded it on 16 August. This sweep found it again the same day.** The page still
reads *"Currently live across 11 UK retailers"* over a list that names Atelier De Glow, which
is departing, and omits Niche Beauty, which has been live since 9 August.

> **Item 121 is open while the page makes a false claim, and the claim is now in the record
> twice.** Being recorded is not being fixed, and a second sighting of the same defect is
> evidence about the queue rather than about the page.

#### AND THE MAINTENANCE INSTRUCTION PRODUCED THE ERROR IT EXISTED TO PREVENT

`about.html`'s comment block told the next reader to *"keep in step with `retailers` where
active = true"*. **Following that instruction on 16 August adds Branded Beauty**, whose
programme closed on 30 July — naming a retailer we cannot send anyone to, on the page whose
entire job is saying who we compare.

> **A maintenance instruction that produces the error it exists to prevent.** It was correct
> when written, and `retailers` grew a thirteenth active row underneath it. The instruction
> encoded a rule (`active = true`) that was never the real rule — the real one is
> **`active = true` AND the programme still pays** — and the shortcut held only while the two
> agreed.

Now written down with both exceptions named, which is why the block also had to explain that
the count is expected to move down when Atelier flips.

#### THE SWEEP SPECIFICATION IS ITSELF A SWEEP SCOPE

**This is the finding that outlives the list.**

**Two of the five findings came from the two shapes added from `strategy.md`, not from the
doctrine's four** — the register violation, which was the largest by surface, and the stale
counts. The doctrine's four shapes are: a percentage next to *save*, a currency figure in
hand-written markup, a month name, and a sentence asserting what the optimiser accounts for.

**They were derived on 3 August from ONE PAGE — `public/index.html` — on ONE DAY.** Every one
of them describes something that page happened to contain. **None of them can reach a
`<meta>` description written by a `.tsx` template**, because the person deriving them was
reading hand-written HTML and the failure they were cataloguing was hand-written HTML.

> **Item 110's rule applies to sweep specifications, not just to sweeps: the shapes describe
> the reach of whoever wrote them.** A shape list is a floor. The doctrine presents its four
> as though they were the categories of stale claim, and they are the categories of stale
> claim *on one page*.

**And the second half, which is worse:**

> **A SWEEP THAT HAS NEVER RUN HAS NEVER BEEN TESTED.** The doctrine has carried these four
> shapes since 3 August as a standing instruction, and today was the first time anything ran
> against them. **Thirteen days of a specification nobody had exercised**, presented in the
> runbook with the same confidence as the steps that had been executed repeatedly. Its two
> gaps were not discoverable by reading it — they were discoverable only by running it and
> noticing that the interesting results came from elsewhere.

**Consequence for Step 5:** the shape list must be **re-derived from the current surface
area, not reused**. Specifically it needs shapes for generated copy (`<meta>` in `.tsx`
templates, JSON-LD, `generateMetadata`) which did not exist in the form it does now when the
list was written. **Re-derive on each run and record what the run added**, because the
addition is the measurement of how stale the list had become.

---

### 130. A thorough pass with nothing behind it, and the retailer who arrived eight days later

**Raised:** 16 August 2026, from the delivery claim in item 129 · **The 1 August audit was
not skipped. It was complete, and then it stopped being true.**

**Robbie verified eleven retailers' delivery terms against their own sites on 1 August**, and
the record confirms it: five were missing, one wrong, one out by ten pence, and the
`retailers_delivery_shape` CHECK was added the same day to stop a sixth. **That work was
correct when it ran.**

**Niche Beauty went live on 9 August, eight days later, and was never in it.**

> **THE DEFECT IS NOT A SKIPPED CHECK. IT IS THAT THE CHECK WAS AN EVENT.** A one-off pass
> over the retailers that existed on the day, with **nothing in the onboarding sequence
> requiring delivery terms before a retailer goes live.** The pass could not have covered
> Niche Beauty, and nothing else was ever going to.

#### THIS IS THE AFTERNOON'S OTHER FINDING, ON A DIFFERENT SUBJECT

**Same shape as the sweep specification, hours apart.**

| | the sweep spec (item 129) | the delivery audit (here) |
|---|---|---|
| the work | four shapes derived 3 Aug | eleven retailers verified 1 Aug |
| quality when done | correct for that page | correct for those retailers |
| what it was read as | the categories of stale claim | the delivery terms are checked |
| what it actually was | **the categories on one page** | **the terms of the retailers that existed** |
| what covers arrivals after | nothing | nothing |

> **A thorough pass and a mechanism are not the same thing, and the more thorough the pass,
> the more it reads like one.** Both of today's instances were good work. Neither left
> anything behind that could see what arrived next. **The CHECK constraint is the only part
> of the 1 August work that was a mechanism, and it constrains the SHAPE of a value rather
> than requiring one to exist.**

**It recurs with The Fragrance Shop** — pending in `docs/partnership-tracker.md` at the £40
price point — **and with every retailer after it.**

#### MEASURED: NICHE BEAUTY IS THE ONLY ONE

Asked whether it is alone. It is, among live retailers:

| retailer | shape | |
|---|---|---|
| 11 active retailers | `tiered` | both values present |
| **Debenhams** | **`flat`** | £3.99, no threshold. **Legitimate**, not a gap. |
| **Niche Beauty** | **`UNKNOWN`** | both NULL. The only one. |

**Method note, because the obvious query is wrong:** `min(retailer_prices.last_updated)` is
NOT a go-live proxy — it moves on every re-import, and it reports The Organic Pharmacy as
15 August when the 1 August audit already covered it. Go-live has to come from
`platform_changes` and the partnership tracker, not from the price rows.

**Two inactive retailers carry the shape the 1 August work called self-contradictory** —
Branded Beauty (6) and Skin Cupid (7), both `threshold 30.00 / cost 0.00`, free above a
threshold and free below it. Already recorded on 1 August as unverified rather than free.
**Branded Beauty is still `active = true`**, so it is inside `products_active`'s retailer
test; it has zero in-stock rows so no basket can reach it, but the flag and the shape are
both still wrong and it is a departure that has been held since 2 August.

#### THE FIX IS A REQUIRED STEP, NOT ANOTHER AUDIT

Added to the "Before onboarding" section of `docs/superdrug-removal-plan.md`, which already
exists on the stated reasoning that *"the departure runbook is what gets read when a
retailer's scope changes, and the same trap applies on the way in."*

**Delivery terms are required before go-live, and `unknown` must be CHOSEN:**

1. Verify against the retailer's own site, not the feed. Terms are not in AWIN.
2. Record one of the CHECK's three shapes: **`tiered`** (threshold and cost), **`flat`**
   (cost, no threshold), **`unknown`** (neither).
3. **`unknown` is a deliberate choice with a reason, never a default.** It is what the column
   pair looks like when nobody decided, which is exactly how Niche Beauty acquired it.
4. **Never enter half a shape.** A threshold with no cost is the self-contradictory shape;
   the CHECK refuses it, and the refusal is the constraint working.

**What `unknown` costs, so choosing it is informed:** the product is honest about it —
`RoutineBuilder` renders *"Delivery not known"* and refuses a delivered total — but that
retailer cannot win a basket comparison on delivered cost, and any site copy describing the
delivery mechanism is false for it until the terms are entered.


---

### 131. The watch for this exact state was built on 3 August and wired to nothing

**Raised:** 16 August 2026, answering item 130's question about the two older rows ·
**Report only.**

Item 130 asked whether Branded Beauty and Skin Cupid at `threshold 30.00 / cost 0.00`
**predate the constraint or slipped past it**. The answer is **neither**, and the reason
matters more than either option.

#### THE CHECK DOES NOT REACH THAT SHAPE, AND NEVER DID

```
CHECK ( (delivery_model = 'tiered'  AND threshold IS NOT NULL AND cost IS NOT NULL)
     OR (delivery_model = 'flat'    AND threshold IS NULL     AND cost IS NOT NULL)
     OR (delivery_model = 'unknown' AND threshold IS NULL     AND cost IS NULL) )
```

**It tests NULL-ness and agreement with `delivery_model`. It does not test meaning.**
`0.00` is a value, so `tiered / 30.00 / 0.00` satisfies the first branch completely.

> **These rows are not survivors of a constraint added after them. They would be accepted
> today, on a fresh insert, by the constraint as written.** "Free above £30 and free below
> £30" is a legal tiered retailer. So is Amazon and eBay's `0.00 / 0.00`, which says free
> above nothing.

**So the doctrine's instruction — *"treat threshold-with-zero-cost as unverified, never as
free delivery"* — is a READING RULE for humans, and it was never a constraint.** Recording it
next to a CHECK constraint in the same section made it look like one. **Neither of the two
rows is a defect in the CHECK. The gap is that the CHECK was read as covering a class it does
not mention.**

#### AND THERE IS A COLUMN, A VIEW AND A WATCH I DID NOT KNOW ABOUT

Migration `20260803160000_delivery_model_unknown_is_transitional.sql`, 3 August. It adds
`delivery_terms_observed_at`, and a view **built for precisely the Niche Beauty case**:

> `retailers_delivery_unknown` — *"Active retailers whose delivery terms are unrecorded, so
> the optimiser will not rank them on delivered total. **Expected to be EMPTY. A row here is
> live inventory being quietly excluded from best-value comparison.**"*

Its own migration says: *"Zero rows today by construction, because no active retailer is
'unknown'. That is expected, and it is why this is a watch rather than an alert with a body."*
And it names the successor: *"The Fragrance Shop … will pass through exactly this state, and
that transition is the intended live exercise of the branch."*

**SELECT * FROM retailers_delivery_unknown, today:**

| retailer_id | name | delivery_model | terms_observed_at |
|---|---|---|---|
| 32 | **Niche Beauty** | unknown | **NULL** |

> **THE VIEW WORKS. IT HAS BEEN CORRECT SINCE 9 AUGUST. NOTHING READS IT.**
>
> `retailers_delivery_unknown` appears **nowhere** in `supabase/functions/`,
> `.github/workflows/`, `app/` or `lib/`. The migration says *"a view the 09:00 monitor CAN
> read"* — and that is exactly what shipped: something the monitor **could** read, and does
> not. **Seven days of a correct answer sitting in a view nobody queries.**

**This revises item 130's framing rather than replacing it.** Item 130 said nothing covered
what arrived after the 1 August pass. That is true of the *onboarding sequence*. But it is
not true that nobody thought of it: **somebody thought of it on 3 August, built the detector,
predicted the exact retailer class that would trip it, and stopped one wire short.**

> **A DETECTOR THAT NOTHING READS IS INDISTINGUISHABLE FROM NO DETECTOR, AND MORE EXPENSIVE
> THAN ONE — because it also consumes the belief that the case is covered.** The 3 August
> migration reads, correctly and in good faith, as though this state were now watched.

#### THE SEND CONDITION WAS THE PART THAT WOULD HAVE BITTEN

Wiring the view into the monitor's **email body** would have looked complete and done
nothing.

> **A retailer with unrecorded delivery terms has a PERFECTLY HEALTHY FEED.** It imports on
> schedule, reports `ok`, and is never stale. **It is invisible to every check the monitor
> performs**, so `failures.length === 0 && stale.length === 0` is true and the function
> returns before an email is composed.

**Body-only would have reproduced the original defect one layer up: detected, formatted, and
never sent.** So `deliveryUnknown.length === 0` is part of the early-return test, not
decoration on the template. **The section that renders is the easy half; the condition that
sends is the feature.**

#### AND THE `all_healthy` ZERO IS ASSERTED, NOT OMITTED — THIRD INSTANCE

The healthy JSON payload now carries `delivery_unknown: 0` rather than leaving it out.

**Same shape, third instance:**

| | |
|---|---|
| **item 104** — `saved_routines_updated -> 0` hardcoded into `product_merge_log` | **the negative case.** A zero in a column named for a check that does not exist. *"Checked, none found"* is what it reads as; evidence of nothing is what it is. |
| **item 114** — `on_supplements_path: 0` **with** `supplements_path_unreachable: []` | the positive case. #268 existed to make the inert and active states **distinguishable**, and the empty list is what proves the check ran. |
| **here** — `delivery_unknown: 0` in `all_healthy` | **an absent field and a zero field are different claims.** Absent means nobody asked. Zero means somebody asked and the answer was none. |

**A zero is only worth printing if its absence would have meant something else.** That is the
test, and it separates all three instances cleanly.

#### THE 1 AUGUST AUDIT IS RECORDED EXACTLY, AND CORROBORATES THE ACCOUNT

`delivery_terms_observed_at` holds **eleven active retailers, every one dated 2026-08-01** —
Atelier De Glow, Beauty Bay, Beauty Flash, Boots, Debenhams, Escentual, Gorgeous Shop,
Perfume Click, Stylevana, The Organic Pharmacy, YesStyle.

**The only two active retailers never observed are Branded Beauty and Niche Beauty**, and
they are unobserved for opposite reasons: **Branded Beauty was excluded from the 1 August pass
because it was already retiring** (and still carries the zero-cost shape), and **Niche Beauty
did not exist yet.**

#### THE GENERAL FORM, FROM TODAY'S DELIVERY COPY FIX

The homepage claimed *"we factor in each retailer's free delivery threshold"*. The obvious fix
was to soften the claim. **The better fix came from looking at the product first:**
`RoutineBuilder` already renders *"Delivery not known"* and **refuses to compute a delivered
total** for a retailer with unknown terms.

> **WHEN COPY AND PRODUCT DISAGREE, ESTABLISH WHICH ONE IS HONEST BEFORE DECIDING WHICH TO
> CHANGE.**
>
> The copy was claiming a mechanism the product **deliberately declines to fake**. So the fix
> was not to soften a claim — it was to **make the copy describe what the product actually
> does**, which turned out to be a stronger sentence than the one being replaced, because the
> product's refusal to guess is a commitment rather than a caveat.
>
> Softening would have produced a hedge. Matching produced a promise. **Same disagreement,
> opposite result, decided entirely by which artefact was checked first.**

#### WHAT THIS LEAVES

- **Wire `retailers_delivery_unknown` into the 09:00 monitor.** The view is built, correct
  and one query short of doing its job.
- **Branded Beauty is still `active = true`** on a departure held since 2 August, with an
  unverified delivery shape and zero in-stock rows. Its own loose end, unrelated to the above.
- **The zero-cost shape is not CHECK-detectable**, so if it should be forbidden that is a new
  constraint (`cost > 0 WHEN threshold IS NOT NULL`), not an existing one being enforced.


---

### 132. Proximity to a constraint confers the appearance of one

**Raised:** 16 August 2026, from item 131 · **A documentation defect, not a data one.**

`retailers_delivery_shape`:

```sql
CHECK ( (delivery_model = 'tiered'  AND threshold IS NOT NULL AND cost IS NOT NULL)
     OR (delivery_model = 'flat'    AND threshold IS NULL     AND cost IS NOT NULL)
     OR (delivery_model = 'unknown' AND threshold IS NULL     AND cost IS NULL) )
```

**It tests NULL-ness and agreement with `delivery_model`. It does not test meaning.**

- `tiered / 30.00 / 0.00` — free above £30 and free below £30 — **satisfies the first branch
  completely and would be accepted today on a fresh insert.** Branded Beauty and Skin Cupid
  both carry it.
- Amazon and eBay carry `tiered / 0.00 / 0.00`, which says **"free above nothing"** and is
  equally legal.

#### THE READING RULE THAT LOOKED LIKE A CONSTRAINT

The 1 August work recorded two things in the same section:

> **"The `retailers_delivery_shape` CHECK added on 2026-08-01 is what stops the sixth."**
>
> **"Treat threshold-with-zero-cost as unverified, never as free delivery."**

**The first is a constraint. The second is an instruction to a human. Nothing in the section
distinguishes them, and they are one paragraph apart.**

> **A rule written next to a constraint is read as enforced by it.** Both sentences are about
> delivery shapes, both are imperative, both are in a section headed by a CHECK that was
> genuinely added — and only one of them is in the database. **The reader supplies the
> connection because the layout implies it, and the layout was not designed to imply
> anything.**

**This is why item 130 asked whether the two rows predate the constraint or slipped past it.
Both options assume the constraint covers the case. It never did**, and no amount of care
reading that section would have revealed it — only reading `pg_get_constraintdef` did.

**The rule for the next one:** when a document states a data rule next to a constraint, say
which enforces it. *"Enforced by `retailers_delivery_shape`"* and *"not enforced anywhere;
check by eye"* are different sentences, and the difference is invisible unless written.

**If the zero-cost shape should be forbidden, that is a NEW constraint** —
`CHECK (delivery_cost > 0 OR delivery_threshold IS NULL)` or similar — **not an existing one
being enforced.** Recorded as an option, not a recommendation: both rows are inactive or
parked, and Amazon and eBay's `0.00 / 0.00` may be deliberate.

---

### 133. Branded Beauty's held flip is now a 1,821-product departure

**Raised:** 16 August 2026 · **Report only.** The flip has been held since 2 August.

**The reason it was held has expired.** `platform_changes` and the doctrine both record it:
the `active = false` flip was *"deliberately held past the 4 August 2026 Boots read"*. **That
read was twelve days ago.**

#### WHAT FLIPPING IT DOES NOW

| | |
|---|---:|
| `products_active` today | 100,214 |
| products touching Branded Beauty | 2,136 |
| **would LEAVE `products_active`** | **1,821** |
| Branded Beauty price rows retained | 2,166 |
| **of which in stock** | **0** |
| barcodes leaving `ean_product_index` | **0** — `enabled = false` already excludes it |

**All 1,821 are already offerless.** Branded Beauty last imported 1 August and has zero
in-stock rows, so every one of those pages is live, indexable, and has nothing buyable on it.
**The held flip is not preserving inventory. It is preserving 1,821 thin pages.**

**And 36 brand pages go to zero**, including names with real search demand: **MAC Cosmetics,
Elemis, Burberry, Olay, Nuxe, Bourjois, Valentino, Hermès, Sally Hansen, Simple, Essie,
Piz Buin, Christophe Robin, Grow Gorgeous**.

#### THIS IS A DEPARTURE, NOT A FLAG FLIP

**At 1,821 products and 36 brand pages it is thirty times Atelier's 59** and needs the full
doctrine: `GONE_IDS` regenerated on the day, curated 301s from GSC for the traffic tail,
Step 7's barcode assessment (**already zero here, because `enabled = false` did that work on
12 August**), Step 8's brand-page check (**36, the largest yet**), and the copy sweep
(**already clean — `about.html` deliberately does not list Branded Beauty**).

> **The longer it is held the larger it gets, and it is already the biggest departure since
> Superdrug.** Every day of the hold is another day of 1,821 pages that render, index and
> sell nothing.

**Not flipped.** It is a departure operation and it needs the doctrine run against it, not a
flag toggled at the end of an afternoon.

---

### 134. The doctrine run against Branded Beauty, and a zero that is a finding

**Raised:** 16 August 2026 · **REPORT ONLY. Nothing flipped.** Doctrine:
`docs/superdrug-removal-plan.md`.

#### PRE-FLIP RECORD (Step 0 requires this before `active = false`, after which nothing surfaces it)

| | |
|---|---|
| `last_import_status` / `last_import_error` | **`ok` / NULL** |
| `last_imported_at` = `last_attempt_at` | 2026-08-01 05:00:17 UTC |
| `enabled` | **`false`** since 2 August |
| AWIN merchant / feed | 48313 / 48313 · `storage_passthrough` |
| delivery | `tiered / 30.00 / 0.00`, **terms never observed** — the self-contradictory shape of item 132 |

**A clean retirement**, like Atelier: the programme closed while the feed was healthy. Unlike
Skin Cupid, there is no buried error to lose.

#### THE HOLD IS NOW COSTING, NOT PRESERVING

**Held since 2 August, past the 4 August Boots read. That was twelve days ago.**

> **ITEM 77'S SHAPE, ON AN OPERATION RATHER THAN A DEFERRAL.** Item 77 found
> `ga4-weekly-pull.yml` held for Actions minutes that reset on 1 August, and the hold held
> for twelve days after its condition lapsed. **This is the same defect against a catalogue
> operation, and — coincidentally and exactly — also twelve days.**
>
> A hold records a condition and then stops being about it. Nothing re-reads the condition,
> so the hold survives the reason. **The difference here is direction: item 77's hold cost a
> missing dataset, this one costs 1,821 live pages.**

#### STEP 1 — CATALOGUE LOSS AND COMPARISON-DEPTH LOSS, ASSESSED SEPARATELY

| | |
|---|---:|
| products in `products_active` touching r6 | 2,136 |
| **catalogue loss** (r6 is their only active retailer) | **1,821** |
| survivors | 315 |
| **comparison-depth loss** | **0** |

> **THE COMPARISON-DEPTH LOSS IS ZERO, AND THAT IS THE WHOLE CHARACTER OF THIS DEPARTURE.**
> Branded Beauty has **no in-stock rows** — its offers were withdrawn on 1 August. **No
> product loses a live offer, because none has had one for fifteen days. The depth loss
> already happened; the flip only collects it.**

**All 1,821 leaving are ALREADY offerless.** Every one is a live, indexable page rendering
nothing buyable. **The hold preserves pages, not inventory.**

#### STEP 7 — SUPPLY-SIDE BARCODE LOSS IS ZERO, AND THE ZERO IS THE FINDING

| | |
|---|---:|
| distinct barcodes Branded Beauty holds | **2,154** |
| **codes it contributes to `ean_product_index`** | **0** |

**`ean_product_index` requires `active AND enabled`. `enabled` went false on 2 August**, and
the index gained that predicate on 12 August (`platform_changes` id 33). **Branded Beauty's
2,154 codes left the index then. Flipping `active` removes nothing.**

> **STATED RATHER THAN SKIPPED, BECAUSE A ZERO ON A STEP THAT USUALLY MATTERS IS A FINDING.**
> Atelier's identical step cost 547 codes and 67 sole-supplier. Here it costs none, and the
> reason is *not* that Branded Beauty is small — it holds four times Atelier's barcodes.
> **It is that the two-flag predicate already did the work, seventeen days ahead of the
> flip.** Skipping the step would have left that unexplained, and the next reader would
> reasonably assume 2,154 codes were about to go.

**This is the two-flag rule paying off rather than catching someone out**, which is the first
time it has been recorded doing so.

#### STEP 8 — 36 BRAND PAGES, THE LARGEST YET, AND ONLY ONE IS AN ARTEFACT

**494 products sit on brands that go to zero.** Seven carry ten or more:

| brand | products |
|---|---:|
| **Essie** | **179** |
| **Bourjois** | **119** |
| **Sally Hansen** | **63** |
| Miss Sporty | 39 |
| Burberry | 21 |
| Revolution | 13 |
| Branded Beauty (own label) | 10 |

**35 are real page losses. One is a slug collision** with a brand that survives, so its URL
lives on — the normalisation-split caveat firing once in thirty-six.

**Against Atelier's three brand pages, of which only one was real, this is thirty-five.**
Essie alone is 179 products. These are the curated-301 population, and Step 6 requires the
GSC read before the flip, not after.

#### THE OTHER STEPS

- **Step 5 copy sweep: already clean.** `about.html` deliberately does not list Branded
  Beauty and now says so in its own comment. Nothing else names it.
- **Step 6 `GONE_IDS`: 1,821 ids to regenerate ON THE DAY**, and the script is still
  hardcoded to `SUPERDRUG = 12` (the unkept promise recorded in the doctrine). **That is the
  blocking task**, not the flip.
- **Step 2 kill-switch:** a second departure behind `superdrug_removed` — the decision the
  doctrine says must be taken deliberately rather than by default.

**Recommendation: run Step 6 first.** At 1,821 ids and 36 brand pages this is the biggest
departure since Superdrug's 24,484, and the one thing that made Superdrug expensive was
`GONE_IDS` being generated eight days before it was used.

---

### 135. Two traps that outlive the transition that created them

**Raised:** 16 August 2026, completing the orphan-gate key rename ·
`superdrug_removed` → `orphan_gate_enabled`, phases 1-4 shipped, phase 5 outstanding.

#### THE VERIFICATION STANDARD: THREE PATHS, WHEN ONE WAS UNDER TEST

Phase 3's job was to prove the new key was readable, and the header alone would have said
so. **All three gate outcomes were checked instead**, because the change touched the code
path all three share:

| id | result | `x-fmb-superdrug-gate` | `x-fmb-gate-source` |
|---|---|---|---|
| 650 | **410** | `gone` | `config` |
| 3308 | **301** → `/brands/clearasil` | `redirect` | `config` |
| 81755 | **200** | `on-passthrough` | `config` |

> **The 410 was under test. The 301 and the pass-through were not, and they are the ones
> that would have failed silently** — a broken redirect is a lost curated 301 nobody would
> notice for weeks, and a broken pass-through is a 200 that stops being a 200. **Verify the
> paths the change touches, not the path the change is about.**

It also settled the package question empirically: `@vercel/edge-config@1.4.3` reads an item
added through the renamed Global Config UI without difficulty, so **no client migration is
needed** and one was nearly done on the strength of a docs example.

#### TRAP 1: `typeof === 'boolean'` IS LOAD-BEARING, AND IT DOES NOT EXPIRE

```ts
const primary = await readKey(ORPHAN_GATE_KEY);
if (typeof primary === 'boolean') { ... }   // NOT `if (primary)`
```

**A key set to `false` is the deliberate kill switch.** A truthiness test would treat it as
"no answer" and fall through to `GATE_DEFAULT`, which is `true` — **turning the gate back on
in the middle of the rollback that set it to false.**

> **This is the same inversion as the `??`-over-`||` decision during phase 1, EXCEPT THAT
> ONE EXPIRED WITH THE TRANSITION AND THIS ONE DOES NOT.** `||` only mattered while two keys
> were being read. `if (primary)` matters forever, because a boolean flag with a meaningful
> `false` will always have this trap somewhere in the line that reads it.
>
> **The transition ending removed one guard and left the other. Nothing marks the
> difference**, which is why the reason is now written next to the surviving one rather
> than in a commit message about a transition that is over.

#### TRAP 2: THE ORPHANED KEY READS AS BELT AND BRACES AND IS NOTHING OF THE SORT

Phase 4 removed the legacy read. **After that deploy the only fallback is `GATE_DEFAULT`.**

`superdrug_removed` is still in the store. **Nothing reads it.** Left there, it presents as a
second line of defence — a key with the right name, in the right store, next to the live one
— and it is inert.

> **THIS IS WHY PHASE 5 IS NOT OPTIONAL AND NOT TIDYING.** A key that looks like a fallback
> and is not is worse than no key, because the next person weighing whether the gate is
> risky counts two mechanisms and finds one.

**Third instance today of a label implying a mechanism that does not exist:**

| | label | implied | actual |
|---|---|---|---|
| 1 | `about.html`'s *"keep in step with `retailers` where active = true"* | a maintenance rule that keeps the page correct | **produces the error it exists to prevent** — following it adds a closed programme |
| 2 | *"treat threshold-with-zero-cost as unverified"*, one paragraph from a CHECK | enforced by the constraint beside it | **a reading rule.** The CHECK tests NULL-ness, never meaning |
| 3 | **`superdrug_removed` left in the store after phase 4** | a fallback | **an orphan.** The only fallback is a build-time constant |

> **All three are correct sentences in the wrong position.** None is wrong on its own terms;
> each acquires a false meaning from what sits next to it — a table, a constraint, a live
> key. **Proximity is doing the lying, and proximity is not reviewed.**

#### STATUS

Phases 1-4 shipped and verified. **Phase 5 — delete `superdrug_removed` from the store — is
outstanding and is the one that stops trap 2 being true.**


---

### 136. The doctrine's query was correct and unused

**Raised:** 16 August 2026, correcting item 134 · **The correction is mine, and the failure
is not the one it looks like.**

#### THE CORRECTION

Item 134 reported **36 brand pages going to zero** on the Branded Beauty flip, *"including
MAC Cosmetics, Elemis, Burberry, Olay"*. **It is 14, and none of those names is among them.**

| brand | now | after flip |
|---|---:|---:|
| MAC Cosmetics | 1,239 | **1,237** — loses two products |
| Elemis | 152 | **150** — loses two |
| Olay | 144 | **142** — loses two |
| Essie | 393 | **214** |
| Sally Hansen | 238 | **175** |
| Burberry | 152 | **131** |
| Bourjois | 125 | **6** |
| **Miss Sporty** | 39 | **0** |

The real list is **Miss Sporty 39**, Branded Beauty own-label 10, BeTrue 4, Johnson's 3,
Bubble T 3, OGX 2, and eight singletons. **The departure is materially smaller than
reported.**

#### THIRD INSTANCE TODAY OF MEASURING THE JOINED POPULATION

| # | what was joined | what was asked | result |
|---|---|---|---|
| 1 | a regex's matches over 1,683 rows | *"which rows are not supplements?"* | **the 18** — two false positives, five missed, more found structurally |
| 2 | `${sub}` interpolated where the enumeration already stood | *"what does this page describe?"* | *"lips foundation, lipstick, mascara"* on every generated page |
| 3 | `products_active JOIN branded_beauty_products` | *"which BRANDS go to zero?"* | **36 instead of 14** |

> **The join narrows the population before the question is asked, and the answer is then
> true of the narrowed set and false of the real one.** Every brand whose
> Branded-Beauty-touched slice zeroed appeared in the count, however large the rest of the
> brand was. MAC has 1,239 products and two of them are Branded Beauty's; the join saw the
> two, found both zeroing, and reported the brand.

#### AND THE PART THAT IS NOT A MEASUREMENT ERROR

**The doctrine already contained the correct query.** Step 8 of
`docs/superdrug-removal-plan.md` selects `FROM products_active p WHERE p.normalised_brand IN
(brands the departing retailer touches)` — every product of those brands, not the departing
retailer's slice. **Run verbatim against retailer 6 it returns 14.**

I did not run it. I wrote a new one.

> **THE REMEDY FOR A WRONG QUERY IS TO FIX IT. THE REMEDY FOR A CORRECT ONE THAT WENT
> UNUSED IS DIFFERENT AND HARDER: CHECK WHETHER THE QUESTION HAS ALREADY BEEN ANSWERED
> BEFORE WRITING SQL.**
>
> These are not the same failure and they do not have the same fix. A wrong query is a bug
> in an artefact and fixing the artefact fixes it for everyone. **An unused correct query is
> a bug in a habit**, and the artefact is already right, so nothing about it will improve.
> The doctrine gained nothing from this: it was correct before and it is correct now.

**This also explains why the error survived review.** The number was plausible, the query was
readable, and the doctrine it contradicted was two thousand lines away in a file I had edited
the same afternoon. **Nothing flags a query for being novel**, and novelty is exactly the
property that should have.

**The practical rule, and it is cheap:** before writing SQL for a departure step, open the
step. Steps 7 and 8 both ship parameterised queries. Step 8's exists precisely because the
brand-page question has a known trap — and I fell into a *different* trap in a query written
to avoid the documented one.

