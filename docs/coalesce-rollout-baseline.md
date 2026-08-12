# Coalesce rollout: the pre-flip baseline

**Captured 12 August 2026, before Escentual was flipped and before Boots.** This file
exists because the benefit of the last two `sibling_coalesce` flags **does not appear on the
retailer being flipped.** It appears days later, on other retailers' imports, as their tier 1
starts matching against barcodes that were not in the index before.

That kind of movement is only attributable against a baseline taken first. Taken afterwards,
every figure becomes "up from roughly where it was", which is the shape work-list item 47
exists to prevent.

> **A change is only attributable if the baseline was taken first.** This one was.

---

## Why these two flags look like failures on their own numbers

Escentual and Boots resolve **99.2% of admitted rows on tier 0**, before tier 1 is
consulted. Almost nothing reaches the tier ladder:

| | Feed rows | tier-0 updates | pre-filtered | **reaching the tier ladder** |
|---|---|---|---|---|
| Gorgeous Shop | 9,706 | 5,740 | 1,647 | **2,319** |
| Boots | 37,411 | 22,315 | 14,908 | **188** |
| Escentual | 7,981 | 6,220 | 1,709 | **52** |

So their own link movement is bounded at roughly **48** and **159** rows. **A link total in
the tens is the SUCCESS case for these two, not the failure case**, and that is recorded
here before the flip precisely so it cannot be re-read as a non-event afterwards.

**Their contribution is supply-side.** Barcodes are written on tier-0 *update* rows, not
only on new links, so the flags put roughly **7,000 and 23,000 barcodes into the index** —
where every other retailer's tier 1 reads them. Gorgeous Shop's 1,133 tier-1 links on
12 August were matched against barcodes that Beauty Flash's 10 August flip had put there.
That is the mechanism, already observed once, and it is what these two are for.

---

## Baseline A — net link movement, per retailer

`would_link_to_existing_product`, all successful runs 6-12 August inclusive. **This is the
metric, not `would_link_via_ean`** — see item 62 for why the tier counters describe which
tier resolved a row rather than whether a row got linked at all.

| Retailer | runs | mean | min | max | **sd** | via_ean | via_mpn | coalesce |
|---|---|---|---|---|---|---|---|---|
| Debenhams | 2 | 9,109 | 8,175 | 10,043 | **1,320.9** | 735 | 6,143 | off |
| Niche Beauty | 4 | 2,947 | 410 | 4,017 | **1,699.0** | 83 | 213 | on |
| Stylevana | 7 | 1,888 | 1,513 | 2,470 | **408.8** | 515 | 0 | off |
| Beauty Flash | 7 | 1,414 | 958 | 1,627 | **277.3** | 124 | 1,066 | on |
| Gorgeous Shop | 7 | 1,113 | 899 | 1,735 | **358.7** | 162 | 2,075 | on 12 Aug |
| Beauty Bay | 7 | 264 | 243 | 349 | **38.3** | 67 | 196 | off |
| **Boots** | 7 | **152** | 148 | 154 | **2.1** | 0 | 0 | **off — stage 5** |
| Perfume Click | 7 | 75 | 52 | 100 | **18.9** | 25 | 0 | off |
| YesStyle | 6 | 49 | 43 | 53 | **4.4** | 44 | 0 | off |
| **Escentual** | 7 | **39** | 37 | 42 | **1.6** | 0 | 0 | **off — stage 4** |
| The Organic Pharmacy | 7 | 0 | 0 | 2 | 0.8 | 0 | 0 | on |
| Atelier De Glow | 6 | 0 | 0 | 0 | 0.0 | 0 | 0 | off |

### Read the standard deviations, not the means

**Escentual sd 1.6 and Boots sd 2.1 are the two tightest series in the fleet.** Escentual has
not left 37-42 in a week; Boots has not left 148-154. Anything outside those ranges after a
flip is signal, and a movement of even twenty rows would be unmissable.

**The downstream watch is a different list, and only part of it can carry a verdict:**

| Detector quality | Retailers | Why |
|---|---|---|
| **Usable** | YesStyle (sd 4.4), Perfume Click (18.9), Beauty Bay (38.3) | Tight enough that a real tier-1 gain clears the noise |
| Marginal | Beauty Flash (277.3), Gorgeous Shop (358.7), Stylevana (408.8) | Movement must be large to be attributable |
| **Unusable for now** | Debenhams (1,320.9, and only 2 runs post-recovery), Niche Beauty (1,699.0, just live) | Nothing can be attributed to a barcode injection against this variance |

**Do not read Debenhams or Niche Beauty for this.** Their series are dominated by their own
recent history. Attributing a downstream benefit to Boots on either would be inventing a
mechanism to explain a gap that their own variance already explains — item 47, instance 10.

---

## Baseline B — the barcode index these flags feed

| | |
|---|---|
| `ean_product_index` rows | **81,831** |
| distinct barcodes held across `retailer_prices` | **79,833** |
| rows carrying a barcode | **104,078** of 160,022 (65.0%) |

Per-retailer holdings, 12 August, before the flips:

| Retailer | rows with barcode | distinct barcodes | % of its rows |
|---|---|---|---|
| YesStyle | 13,739 | 13,690 | 100.0% |
| Debenhams | 13,562 | 13,561 | 86.5% |
| Perfume Click | 9,999 | 9,999 | 99.7% |
| Niche Beauty | 8,230 | 8,227 | 99.1% |
| Beauty Bay | 7,793 | 7,793 | 99.7% |
| Beauty Flash | 6,961 | 6,951 | 84.6% |
| Stylevana | 6,668 | 6,394 | 54.7% |
| Gorgeous Shop | 5,972 | 5,959 | 76.5% |
| Branded Beauty | 2,161 | 2,154 | 99.8% |
| Atelier De Glow | 544 | 544 | 98.9% |
| The Organic Pharmacy | 73 | 68 | 93.6% |
| **Boots** | **0** | **0** | **0.0%** |
| **Escentual** | **0** | **0** | **0.0%** |

**Both sit at exactly zero.** Boots at ~23,000 admitted rows would become the largest single
barcode holding in the fleet, above YesStyle — which is why it goes last and alone.

---

## Baseline C — feed-side fill, and the haircut

Read-only `feed-diag`, 12 August. Stable against the 2 August runs (99.8% and 96.7%).

| | Feed rows | `ean` | `product_GTIN` | `mpn` |
|---|---|---|---|---|
| Escentual, fid 97233 | 7,980 | 0.0% | **99.8%** (7,966) | 99.9% |
| Boots, fid 115009 | 37,411 | 0.0% | **96.8%** (36,217) | 100.0% |

**Fill is not stored.** Gorgeous Shop's 98.6% fill produced `rows_with_ean` at 85.8% of feed
rows, because **13.0% of populated GTINs failed validation** — `length_11`, `length_7`
internal SKUs (`OW94SKU18155`), comma-joined pairs (`641628401871, 641628`). The rejection
profile is a property of the advertiser's data, so **13% is a warning that fill overstates
usable barcodes, not a multiplier to apply to these two.** The gap is itself one of the
things to report per flip.

---

## What to report after each flip

Against these baselines, in this order:

1. **Barcodes stored, from zero** — `rows_with_ean`, and the count landing in
   `retailer_prices.ean_normalised`. This is the contribution.
2. **Net movement in `would_link_to_existing_product`** — expected near zero. Escentual
   against 39 ± 1.6, Boots against 152 ± 2.1.
3. **Rows reaching the tier ladder** — expected ~52 and ~188.
4. **The fill-versus-stored gap** — `ean_from_sibling` against `rows_with_ean`, with
   `barcode_reject_reasons`. Retailer-specific, and not predictable from Gorgeous Shop.
5. **`tier1_ambiguous_skipped`** — expected to appear from nothing. Read this key by its
   real name; item 47 instance 11 is the cost of not doing so.

Then, and only after Boots has landed, the downstream read: net link movement on YesStyle,
Perfume Click and Beauty Bay over the following days, against Baseline A.
