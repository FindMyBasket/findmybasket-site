# Supplements: the brand-comparison proposition

**Recorded 21 August 2026. Strategy record, not a scope.** Nothing was built. Every figure is
measured against the live catalogue on the date shown and will drift.

Three items in this document carry their own status and are meant to be read and tracked
separately from the proposition itself:

| | Item | Status |
|---|---|---|
| **A** | Articles commit to per-serving; per-serving is not computable | **DEPENDENCY** — not a defect |
| **B** | `canonical_size` holds unit size, never pack total | **LIVE FINDING** — 446 rows wrong on the site now |
| **B1** | The chip fix, display-only | **SHIPPED** 21 Aug — `lib/format/pack-size.ts`, 23 tests |
| **B2** | The column remedy | **THREE OPTIONS, NOT PICKED** — metric widened, so now provable |
| **D** | The repo does not describe the database | **MOVED** — now work-list item 235 |
| **C** | Blends, trial packs and variant flooding | **DESIGN CONSTRAINT** — rewards dilution |

---

## The sequencing argument, first

**The proposition removes the dependency on two retailers stocking the same product. It does
not remove the dependency on breadth of range — and today that breadth is one merchant's
buying decision.**

Of 1,819 live supplements, **1,733 are Boots**. The working per-100g collagen comparison
below returned Boots rows and nothing else. So a table built now would compare brands *inside
Boots' assortment*, and what it would measure is Boots' buying, not the market.

> **It is not awaiting two onboardings to be buildable. It is awaiting them to be meaningful.**

That distinction is the whole sequencing decision, and it should not be blurred by the fact
that question 3 comes back "yes, testable today". Buildable and meaningful are different
tests, and this passes the first and fails the second.

---

## The proposition

Supplement shoppers are not brand-loyal. Someone wants magnesium, or whey isolate, or
collagen this month, and takes the best value. The comparison is therefore **across brands
within a type**, not across retailers for one product.

Two consequences claimed, both of which hold:

- **Sole stockism stops mattering.** Measured: 1,819 live supplements, 1,783 single-stockist,
  36 comparable — **2.0% comparable**, consistent with the 2.1% on record. Under this framing
  that number is not the category's problem, because the shopper was never comparing one
  product across retailers.
- **The MyProtein finding inverts.** 1 of 99 matching is a failure only under
  product-across-retailers. Under brand-across-brands, carrying the range direct is the point
  and the match rate is irrelevant.

The logic is sound. What follows is what would have to be true for it to be buildable,
measured rather than assumed.

---

## A. The comparable unit — DEPENDENCY, NOT A DEFECT

**Four live articles say the honest comparison is price per serving. They are right, and the
data supports price per capsule and price per 100g only.**

**The articles are not the problem and must not be changed.** Per-serving *is* the correct
comparison and the articles explain why. The problem is only what happens if a table ships
computing something else: the copy and the product would then disagree, and **that is exactly
the Abib failure found today** — two surfaces making different claims about the same thing,
where the copy was right and the surface was not.

> **The dependency, stated plainly:** any per-unit table either computes per-serving, or says
> on the page which unit it uses and why. Silently shipping per-100g under copy that promises
> per-serving is the one option that is ruled out.

### Why per-serving is not computable

No structured field for serving size or servings per container exists in `products`, in
`retailer_prices`, or among the 22 AWIN columns the importer requests
(`supabase/functions/import-awin-feed/index.ts`, `buildFeedUrl`). The requested set carries
name, price, barcode, category path, image and description — nothing dosage-related.

What exists is free text, and it is thin:

| Signal | n / 1,820 | % |
|---|---|---|
| Explicit servings count in the **name** (`45 Servings`) | 24 | 1.3% |
| Servings count anywhere in the **description** | 62 | 3.4% |
| Phrase `per serving` in the description | 95 | 5.2% |
| Any serving-size phrase at all | 115 | **6.3%** |

On the types the proposition names it is worse: `servings_in_name` is **zero** for every
collagen, magnesium and creatine row. `per serving` appears in 11 of 99 collagen powders and
2 of 53 magnesium capsules.

**The gap is the dose, not the container.** Pack counts are well populated, so per-capsule and
per-100g are computable. Per-serving needs units-per-dose — two capsules, one 10g scoop —
which lives in the Directions text on the pack, and no feed carries it.

**One partial exception.** Where a name carries the `N x Mg` pattern — `Vida Glow Natural
Marine Collagen Peach - 30 X 3G Sachets` — it states servings *and* serving size. **86 rows,
4.7%.** Sachet formats encode what tubs and bottles do not. It is the only place both numbers
appear together, and it is also the pattern behind finding B.

---

## B. `canonical_size` holds unit size, never pack total — LIVE FINDING

**This is wrong on the site today. It is not a hazard of a future feature: the per-100g table
does not exist, but the column does, and it is already rendered.**

The defect is systematic and the cause is exact. `extractCanonicalSize`
(`supabase/functions/_shared/match-key.ts`) takes the **last** size token in the name and has
no notion of a multiplier. For `N x M<unit>` names, the last token is the *unit* size.

### Blast radius: catalogue-wide, and supplements is not the largest share

Live, in-stock, active-retailer rows whose name is an `N x M<unit>` multipack and whose
`canonical_size` equals the unit rather than the pack:

| Category | `N x M` rows | With `canonical_size` | **Unit, not pack** |
|---|---|---|---|
| Skincare | 197 | 155 | **145** |
| Bath & body | 137 | 96 | **94** |
| Supplements | 84 | 68 | **64** |
| Fragrance | 68 | 60 | **54** |
| Hair | 66 | 45 | **42** |
| Makeup | 54 | 50 | **47** |
| **Total** | **606** | **474** | **446** |

**Supplements is 14% of this. It was found via supplements and it is a catalogue-wide defect.**

### What is already wrong, user-facing

`app/product/[id]/page.tsx:404` renders `canonical_size` as a **bare, unqualified chip** beside
product type and shade. There is no "per sachet" qualifier and no pack context. So the page
states a size that understates the pack:

| Product | Chip shown | Actual pack | Understated by |
|---|---|---|---|
| `Vida Glow Natural Marine Collagen 90 x 3g Sachets` | **3g** | 270g | **90×** |
| `simpa Phyto-Caffeine Shampoo … 50 x 20ml` | **20ml** | 1000ml | **50×** |
| `Kérastase Densifique Treatment Homme 30 x 6ml` | **6ml** | 180ml | **30×** |
| `Vida Glow Anti-G-Ox™ Berry 30 x 2g Sachets` | **2g** | 60g | **30×** |

**446 live product pages currently display a size chip that understates what is in the box.**

### What reads the column — checked, one at a time

| Consumer | Affected? |
|---|---|
| `app/product/[id]/page.tsx:404` — size chip | **YES. Wrong now, 446 rows.** |
| `lib/product-queries.ts` — selects and passes it through | Yes, it is the path that feeds the chip |
| Matching / merging (`match_key`, `idx_products_match`) | **NO — protected.** See below |
| `dq_snapshot` `canonical_size_health` metric | **NO — and that is the problem.** See below |
| Any per-100g or per-serving computation | Does not exist yet |

**The merge path is protected, and this is worth recording as a near miss.**
`extractNameNumbers` is a hard distinctness rule capturing *every* number in the name, so
`30 x 3g` yields `3,30` and a plain `3g` sachet yields `3`. Different signatures never merge.
The backstop that exists for pack counts happens to cover this too. **The column is wrong; the
catalogue structure built on it is not.**

**The data-quality metric cannot see it, by construction.** The `canonical_size_health` rule
in `20260727120000_retailer_prices_live_and_dq_snapshot.sql` has a `multipack_format` bucket —
but it matches only the comma form (`30ml, 50ml`), never `N x M`. Applying the rule verbatim
to the 447 affected rows:

| DQ verdict | n |
|---|---|
| **`agrees`** | **437** |
| `other_mismatch` | 7 |
| `decimal_in_name` | 3 |
| `multipack_format` | **0** |

**437 of 447 are reported healthy.** They agree *because* `canonical_size` matches the last
size in the name, and it matches because both are the unit size. **The check verifies internal
consistency, not correctness — it cannot distinguish "3g agrees with 3g" from "3g understates
270g".** A metric built to catch `canonical_size` problems scores this population clean, which
is why it has run undetected.

### The merging protection, recorded on its own line

> **The pack-count backstop covers this by accident. The column is wrong; the catalogue
> structure built on it is not. That is what contains this defect to display.**

`extractNameNumbers` is a hard distinctness rule capturing *every* number in a raw name, so
`30 x 3g` yields the signature `3,30` and a plain `3g` sachet yields `3`. Different signatures
never merge. It was written to stop `7 pcs` matching `32 pcs`; it happens to stop unit-size and
pack-size rows collapsing into each other too.

This is luck, not design, and it should be read that way. Nothing asserts this coverage and no
test names it. **If `extractNameNumbers` is ever narrowed — to ignore small numbers, or to skip
counts already captured elsewhere — the containment disappears silently and the defect stops
being display-only.** Any change to that function should cite this line.

---

## B1. The display fix — SHIPPED 21 August 2026

**The chip can be fixed alone. It does not need the column question settled, and it should not
wait for it.**

### What shipped

| File | Change |
|---|---|
| `lib/format/pack-size.ts` | **New.** `isUnitSizeOfMultipack()` + `displaySizeChip()`, the precise predicate |
| `lib/__tests__/pack-size.test.ts` | **New.** 23 tests — all pass; full suite 210 pass, 0 fail |
| `app/product/[id]/page.tsx` | Chip now reads `sizeChip`, not `product.canonical_size` |

`tsc --noEmit` clean. **446 product pages stop rendering a size that understates the pack.**

The reason suppression is honest is recorded at the top of `pack-size.ts` and again at the
render site, with the condition attached: **the justification depends on the `<h1>` rendering
`product.name` raw.** If that ever changes, the guard needs revisiting — so the comment says so
rather than leaving a future reader to rediscover it.

Two limits are asserted as tests rather than merely described: the 17 rows wrong in other ways
stay unfixed (`Made By Mitchell … 15X4.5g` → `5g`; `Nicce … 3 x 150ml` → `440g`), and a
multiplier of 1 is kept because unit and pack are the same quantity.

### The metric widening shipped alongside

Applied as `20260821164312_canonical_size_health_multipack_visible`. The live
`canonical_size_health` totals now read:

| Bucket | Before | After |
|---|---|---|
| `multipack_unit_not_pack` | *did not exist* | **438** |
| `multipack_format` | 1,399 | 1,399 |
| `agrees` | **51,858** | **51,420** |

> **51,858 → 51,420 IS THE PROOF THE METRIC MOVED.** The 438 came out of `agrees` and out of
> nowhere else — `multipack_format` did not shift by a single row. The population that was
> invisible is now counted, which is precisely what a remedy needs: **a before.**

Until this ran there was no before. That is the whole reason it went first.

Two notes on how it was done, both deliberate:

- **Two buckets, not one.** `multipack_format` was widened to the `N x M` form as instructed,
  but the actual defect got its own bucket. Folding the 446 into `multipack_format` would have
  hidden them inside a count that already existed at 1,399 and would have read as unchanged.
  The distinction is real: `multipack_format` now holds `N x M` names whose chip is *not* the
  unit — either correct (pack total stated last) or wrong some third way.
- **Patched, not retyped.** The migration reads `pg_get_functiondef`, replaces two exact
  substrings and re-executes, rather than restating the 8.2k-character function body. It
  refuses to run if either anchor is missing, and is idempotent. Restating it by hand would
  have risked a transcription error with no diff and no artefact.

**Repo note:** the migration is registered remotely with no local file, matching this repo's
existing pattern (~130 remote-only entries; local and remote histories are long divergent, so
`supabase db push` is not usable here). The local draft was removed rather than left to push a
*different* implementation of the same change under a second timestamp.

### Why the display half is genuinely separable

Three facts, each checked:

1. **There is exactly one render site.** `app/product/[id]/page.tsx:404`. `canonical_size` is
   selected in `lib/product-queries.ts` and rendered nowhere else in `app/` or `components/`.
   No card, no search result, no category page shows it.
2. **It is not in structured data.** The `Product` JSON-LD at `page.tsx:205` carries name,
   brand, image, sku, description and offers. **No size field.** The wrong value has never been
   published to Google as a product attribute.
3. **The correct information is already on the page.** The `<h1>` at `page.tsx:360` renders
   `product.name` raw and unmodified — `Vida Glow Natural Marine Collagen 90 x 3g Sachets`
   appears in full, four lines above the chip reading `3g`.

**Point 3 is what makes suppression honest rather than lossy.** For exactly the affected rows,
the pack is already stated in the title directly above. Removing the chip removes a
contradiction, not a fact.

### The smallest honest fix

> **Suppress the chip when the name contains an `N x M<unit>` pattern whose `M<unit>` equals
> `canonical_size`.**

A pure display predicate. It reads only `product.name` and `product.canonical_size`, both
already on the object. It writes nothing, changes no import, and touches nothing the matcher
reads.

**It is a guard, not a second derivation.** This matters. The predicate compares an existing
stored value against the name it came from and suppresses on disagreement-with-reality. It does
**not** re-implement `extractCanonicalSize`, so it cannot drift from it the way a second
extractor would.

### What each candidate predicate actually does

Measured over the 606 live `N x M<unit>` rows:

| Population | n | Broad predicate (any `N x M`) | **Precise predicate (chip == unit)** |
|---|---|---|---|
| Renders no chip already (null/empty) | 136 | unaffected | unaffected |
| **Chip == unit size — WRONG** | **446** | suppressed ✓ | **suppressed ✓** |
| Chip == pack total — **correct** | 16 | **suppressed ✗ (loses a right answer)** | **kept ✓** |
| Chip == neither — wrong another way | 17 | suppressed ✓ | **not fixed** |

*(The three buckets overlap slightly where the multiplier is 1 — `Reuzel … 1 x 95g` has unit
and pack identical. Counts are exact within that boundary.)*

The 16 correct ones are correct for a reason worth knowing: **their names state the pack total
last**, and `extractCanonicalSize` takes the last match. `Sun Bum Lip Balm SPF30 3 x 4.25g Set
12.75g` → `12.75g` ✓. `Matrix Biolage … 10 x 6ml` → `60ml` ✓. Same extractor, right answer,
purely because of token order. **The broad predicate would delete those.**

**Recommended as the smallest honest option: the precise predicate.** It fixes the 446
systematic cases, preserves the 16 that are right, and makes no claim about the rest.

### What this fix does not do — stated so it is not overclaimed

- **It does not fix 17 rows that are wrong in other ways** — `Made By Mitchell Lip Palette
  15X4.5g` showing `5g` (pack 67.5g), `Zooki … 14 x 18.5Ml` showing `5ml` (pack 259ml), `Nicce
  Body Wash Set 3 x 150ml` showing `440g` (wrong unit entirely). These need the column remedy.
- **It does not make the size *available*, only stops it being wrong.** A shopper on a
  multipack page sees no size chip and must read the title.
- **It leaves the underlying data wrong**, so any future per-unit maths still cannot read
  `canonical_size` safely. **B1 buys correctness on the page, not in the column.**

---

## B2. The column remedy — THREE OPTIONS, NOT PICKED

**The metric can now see the population, so all three are measurable against a real
denominator: `multipack_unit_not_pack`, currently 438.** A correct remedy drives it toward
zero without moving `multipack_format` or `other_mismatch` upward; that is the acceptance test,
and it did not exist before today.

Presented as a diff with blast radii. **This record does not choose.**

### The ordering the DQ blind spot forced — DONE

> **Widen `multipack_format` to the `N x M` form FIRST. Then fix. Fixing first leaves the fix
> unprovable.** *(Shipped 21 Aug — see B1 above. The rest of this section records why.)*

The metric currently scores 437 of the 447 affected rows `agrees`, because both sides are the
unit size. So today it cannot distinguish "fixed" from "broken" — **a remedy applied now would
move the metric from 437 `agrees` to 437 `agrees`.** There is no before-and-after to read.

Widening the metric first converts the population from invisible to counted, which:
- gives the fix a denominator to verify against,
- makes any regression detectable afterwards,
- and is itself **safe in isolation** — it is a reporting rule, it changes no product data, and
  it can ship independently of every option below.

**This ordering applies to all three options equally.** It is not an argument for any of them.

### The three options

| | Remedy | What changes | Blast radius | Reversible? |
|---|---|---|---|---|
| **1** | **Correct `canonical_size` to the pack total** | `extractCanonicalSize` learns the multiplier; backfill 446 rows | **Largest.** The column is in `idx_products_match (normalised_brand, canonical_size, match_key)` and in the Tier-4 size re-verification. Changing stored values changes what matches what. Also changes the `dq_snapshot` duplicate-group layer, which groups on `size_norm`. **Touches merging.** | Backfill reversible from a snapshot; index behaviour change is not observable without a canary |
| **2** | **Add a separate pack-total column** | New nullable column, populated alongside; `canonical_size` untouched | **Smallest on existing behaviour** — nothing that reads `canonical_size` changes, matcher untouched. Cost is a second size field, and the question of which one every future consumer should read. Risks becoming the third size representation after `canonical_size` and `extractSize`. | Fully — drop the column |
| **3** | **Qualify the chip in place** | Leave data alone; render `3g per sachet` or `3g × 90` | **Display only** — same radius as B1, and largely subsumes it | Needs the unit noun (`Sachets`, `Capsules`) inferred from the name, which is a new derivation and the thing B1 deliberately avoids | Fully |

**Cross-cutting notes, offered rather than weighed:**

- Options 1 and 3 are not independent of B1: **3 is a richer B1**, and **1 makes B1 unnecessary
  once backfilled** (though B1 would still protect the 17 other-wrong rows until then).
- Option 1 is the only one that makes `canonical_size` safe for per-unit arithmetic, which is
  what the proposition in this document would eventually need.
- Option 2 defers the correctness question rather than answering it — the wrong value stays
  readable and will be read by something eventually.
- **Whichever is chosen, `extractNameNumbers` must not be narrowed** — see the merging
  protection line above.

---

## C. The three hazards — DESIGN CONSTRAINT

These are not implementation details to be handled later. **They are the design problem, and
they decide whether the mechanism is publishable at all.**

> **A comparison that rewards dilution is worse than no comparison, because it is confidently
> wrong in the direction a shopper cannot check.**

This is **the single-pack-on-a-multipack-page failure appearing in a new mechanism.** Same
shape: a unit-price calculation that is arithmetically correct and answers the wrong question,
presented with the authority of a ranked table.

### 1. Blends rank top — dilution pays

In the live per-100g collagen run, `Optimum Nutrition Clear Whey And Collagen`, `Myvitamins
Creatine+ Collagen+ Electrolytes 3-in-1` and `Osavi Collagen Electrolytes` all ranked **near
the top**. Per-100g of a blend is not per-100g of collagen. **The less collagen a product
contains, the better it scores.** 20 of 166 live collagen rows are blends.

The shopper cannot detect this. They asked for collagen, the table is sorted by value, and the
recommendation at the top is the product with least of what they asked for.

> **The decision this forces: no field states active-ingredient share, in any feed, at any
> retailer. So it is EXCLUDE THE BLENDS or DO NOT SHIP THE TYPE. There is no third option, and
> no amount of data work creates one.**

This is not a gap awaiting better data — it is a property of what feeds carry. Percentage
composition is on the pack's nutrition panel and nowhere in any feed field. Any proposal that
begins "once we can tell how much collagen is in it" should be closed on sight.

### 2. Trial packs rank against tubs

`Kudu Collagen Sachet 63g 3S` sits mid-table beside 600g tubs. Arithmetically correct,
different purchase. A three-sachet trial and a two-month supply are not alternatives, and
ranking them together implies they are.

### 3. Variant flooding

Osavi occupies **9 of the top 30 rows** on flavour variants alone. A brand-level view needs
collapsing before it is readable, or one brand's flavour range becomes the page.

---

## The three questions, answered

### 1. The comparable unit
**Not computable.** No field, any retailer, any format. 6.3% free-text only. Per-unit is the
available substitute and carries dependency **A**.

### 2. Whether the types are derivable
**Not from brand taxonomy. ~54% from names, and the ceiling is compositional.**

**A correction to the record.** The premise was that brands make these distinctions themselves
and that this is "the argument that made Boots' `product_type` work". That is not what
happened. `products.product_type` is 100% populated for skincare, makeup, fragrance, hair and
bath_body and **0% for supplements, deliberately.** It is not a feed field — it is derived by
our own classifier in `_shared/categorisation.ts`, which has no supplements branch and
explicitly returns `product_type: null`.

The retailer's own `product_type` column *is* parsed, and **was rejected**: it "describes
BOOTS' SHELF, is 57% bare parents, and is per-retailer — so it would give one retailer's rows
a facet nobody else's could fill." `docs/supplements-definition.md` makes the same point:
path-first classification "generalises across nothing". Under the new proposition the
objection changes owner — brand vocabularies instead of one retailer's shelf — but does not
disappear.

Name tokens classify 956 of 1,820 (52.5%). Widening the vocabulary by ~15 terms moved it to
984 (54.1%) — **28 rows for 15 terms.** Flat returns are the evidence that the remaining 46%
is not lexical:

| Bucket | n | Comparable across brands? |
|---|---|---|
| Named single ingredient | 984 | **Yes** |
| Bundles / gift sets / multipacks | 138 | No — no single unit exists |
| Benefit-branded blends | 157 | No — proprietary by construction |
| Devices / test kits | 8 | Not a supplement |
| Topicals with no ingredient noun | 12 | Not a supplement |
| Unclassified remainder | 589 | Mostly proprietary |

The 589 is dominated by **proprietary formulas where the brand *is* the product** —
`Wellwoman Original`, `Perfectil Max`, `Viviscal`, `Hairburst`, `Alyve Personalised Vitamins`,
`GP Nutrition Everydayme`, `Boots Sharp Mind`. **There is no "best value Wellwoman" from
another brand.** The mechanism does not reach them.

It also contains contamination a type facet would expose: `Filter by Molly-Mae Tan Tonic`
(self-tan), `P.Louise Bad B*tch Energy Lip Duo` (makeup), `Organix Toddler Rice Cakes` (food),
`Boots Bump & Beyond Breast Milk Store Bags`, `MyHealthChecked DNA Test`, `Niquitin Lozenges`,
`Allevia 120mg` (antihistamine), `Tiger Balm Rub`. This is the population `product_exclusions`
curates, and it is a list, not a rule.

**The proposition works for a head of commodity types and does not reach the body of the
category.** That is narrower than "supplement shoppers are not brand-loyal", and it is the
claim the data supports.

### 3. What the catalogue could support today
**Buildable now for the head types. See the sequencing argument for why that is not the same
as worth building.**

| Type | Products | **Distinct brands** | Unit-derivable | % |
|---|---|---|---|---|
| Collagen | 172 | **51** | 112 | 65.1% |
| Omega / fish oil | 80 | 31 | 59 | 73.8% |
| Magnesium | 72 | 37 | 53 | 73.6% |
| Vitamin C | 65 | 24 | 36 | 55.4% |
| Vitamin D | 58 | 28 | 37 | 63.8% |
| Creatine | 55 | 26 | 45 | 81.8% |
| Whey | 27 | 5 | 26 | 96.3% |
| Ashwagandha | 25 | 20 | 20 | 80.0% |
| Iron | 16 | 11 | 14 | 87.5% |

Catalogue-wide, **1,341 of 1,820 (73.7%)** carry a pack count in the name or a size.

**It was tested, not assumed.** Price per 100g over live in-stock collagen powders returns a
working ranked table: **£6.00 to £14.08 per 100g, a 2.3× spread across roughly fifteen
brands** — VitaBright Hydrolysed 500g (£6.00), Optimum Nutrition Peptides 320g (£6.25), Osavi
Peptides 600g (£6.33). A genuine cross-brand value comparison in which **sole stockism played
no part**, exactly as the proposition predicts.

Every row of that table came from Boots, and hazards **C1–C3** were all visible in it.

---

## D. The repo does not describe the database — LIFTED OUT

**Moved to work-list item 235.** Measured here, but it is not a supplements question and does
not belong in this document.

One line kept because it is what changes the item's character: **only 3 of 120 local migration
files are registered remotely**, and the sample of eleven objects showed the contents *are*
live — so applied, applied-then-edited and never-applied are indistinguishable from the ledger.
Not recoverable work; unanswerable questions.

Item 235 carries the measurement, the item 75 parallel, and the costing of the default change
separately from the reconciliation.

## A pattern worth naming: newest scrutiny surfaces oldest defects

**Second instance. Worth recording as a pattern rather than a coincidence.**

Both defects found by looking at supplements belong mostly to skincare:

| | Defect | Found via | Largest affected share |
|---|---|---|---|
| 1 | `product_type` read off a verdict the branch had just discarded | Boots supplements classification | **Skincare — 1,297 rows** (vs 340 empty, 39 hair) |
| 2 | `canonical_size` holds unit size, never pack total | Supplements per-100g feasibility | **Skincare — 145 rows** (supplements only 64, 14%) |

**The mechanism is not luck.** Supplements is the newest category, so it is the one whose
assumptions are being checked from scratch — nobody has yet formed the habit of reading its
outputs as normal. Skincare is the oldest and largest, so it holds the most rows built on
long-unexamined derivations. **A fresh category does not have more defects; it has more
attention, and the attention finds defects that were always there.**

In instance 1 the point was made explicitly at the time: the absurd tail (`Foundation 1`) got
noticed while `Skincare 1,297` sat in plain sight, because a junk-types suppression list hid
the large wrong answer and rendered only the small ridiculous one. **The big share is the
quiet one, in both instances.**

**How to apply:** when a new category's investigation turns up a shared-module defect, measure
the blast radius across *all* categories before scoping the fix, and expect the new category to
be the minority of it. Do not scope the remedy to the category that found it — both of these
would have been under-fixed by half or more.

---

## Open questions this record does not answer

- Whether per-unit is honest enough to publish given **A**, or whether the answer is to state
  the unit on the page. *Not* whether the articles move — they do not.
- **B1 is a display decision and is ready to take** — the predicate, its exact effect and its
  limits are all measured above. It needs a yes, not more investigation.
- **B2 is not picked here.** The three remedies and their blast radii are set out; the choice
  turns on whether `canonical_size` must eventually be safe for arithmetic, which is a call
  about this proposition's future rather than about the column. **The DQ widening is ordered
  before all three and can ship on its own.**
- Whether the head types carry enough demand to matter — a GA4 and search question, not a
  catalogue one.
- Whether the ~46% with no cross-brand type is a tolerable exclusion, or evidence the framing
  does not fit the category we hold.
