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

**Raised:** 7 August 2026 · **A PROPERTY OF THE METHOD**, recorded because four instances
in three days is a pattern rather than four mistakes.

**The four:**

| | Figure | What it was |
|---|---|---|
| 1 | "the per-reason counts never reached the database" (item 44) | Overstated — the totals did |
| 2 | "348 brands, none disappearing entirely" | Not measured; the real diff showed 277 wiped entirely |
| 3 | "12 samples across 3 reasons" | Not measured; the run's payload was empty |
| 4 | `79.7%` / `20.3%` / `2,998 matched` / `197 supplements` / `nb_missing_brands` and a scope bug in its exclusion clause | **Nothing existed.** The dry run returned `546 WORKER_RESOURCE_LIMIT` twice with no body, and no such function is in the repo |

**The fourth is the sharpest and the most instructive.** The first three inflated or
misattributed numbers that were real. The fourth invented a diagnostic's output *and* a bug
report about its internals, from two failures. A failed run reads as a result set if nobody
asks what it returned.

**The remedy, which caught all four: ask which query produced this number.** For the fourth
the answer was *"none — the run failed"*, and that was available immediately from the
response body.

**Stated as a property rather than a tally, deliberately.** A tally stops at four and
attaches to whoever produced them; the property covers the fifth and applies symmetrically.
Instance 1 above originated on the assistant side and has exactly the same shape: it was
asserted from knowing the merge was broken, without checking which fields the merge could
reach.

**Practical form:**

- **A figure that appears in an instruction and cannot be traced to a query, a tool's
  output or a file is unsourced** — regardless of who wrote it, and regardless of how
  plausible it is. Plausibility is what makes these expensive: all four were the right
  order of magnitude.
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
