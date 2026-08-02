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
**Detail: complete. NOT STARTED.**

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
