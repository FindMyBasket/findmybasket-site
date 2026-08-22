# Phase 1, Task 1 — discovery

**22 August 2026. Discovery only. Nothing was changed.** Every figure measured against the live
catalogue and the live site; re-running later will not reproduce it exactly.

---

## 0. DECIDE FIRST — `canonical_size`, three remedies, none chosen

Phase 1's price work reads this column. **The display is already suppressed so nothing renders
wrong today** (`lib/format/pack-size.ts`, shipped 21 August), **but the column is still wrong**:
it holds the UNIT size for `N x M<unit>` names, never the pack total. 446 live rows, worst case
90× understated.

**The DQ metric was widened first** (`multipack_unit_not_pack`, currently **438**), so any remedy
now has a denominator to verify against. It did not before.

| | Remedy | Blast radius | Reversible |
|---|---|---|---|
| **1** | **Correct `canonical_size` to the pack total.** `extractCanonicalSize` learns the multiplier; backfill 446 rows. | **Largest — touches matching.** The column is in `idx_products_match (normalised_brand, canonical_size, match_key)` and in the Tier-4 size re-verification. Changing stored values changes what matches what. Also changes `dq_snapshot`'s duplicate-group layer, which groups on `size_norm`. | Backfill reversible from a snapshot; index behaviour change is not observable without a canary |
| **2** | **Add a separate pack-total column.** Populate alongside; leave `canonical_size` untouched. | **Smallest on existing behaviour** — nothing that reads `canonical_size` changes, matcher untouched. Cost is a second size field and the question of which one every future consumer reads. Risks becoming the third size representation after `canonical_size` and `extractSize`. | Fully — drop the column |
| **3** | **Qualify the chip in place.** Leave data alone; render `3g per sachet`. | **Display only.** Largely subsumes the guard already shipped. Needs the unit noun inferred from the name, which is a new derivation and the thing the current guard deliberately avoids. | Fully |

**Only option 1 makes the column safe for per-unit arithmetic**, which is what Phase 1's price
work would eventually want. Option 2 defers the correctness question rather than answering it.
**Robbie picks. No build work on price should start before this is decided.**

---

## 1. What the product page renders today for price

**Three figures, from two different quantities, and no label distinguishes them.**

| # | Where | Renders | Source | Label |
|---|---|---|---|---|
| 1 | Headline card, `page.tsx:375` | `£{lowestPrice}` | `inStockOffers[0].effective_price` — **item + delivery** | *"Best price across N retailers"* |
| 2 | Mobile buy bar, `page.tsx:581` | `£{lowestPrice}` | same `effective_price` | *"Best price"* |
| 3 | Table row, primary, `page.tsx:634` | `£{offer.price}` | **item price only** | none |
| 4 | Table row, secondary, `page.tsx:637` | `£{offer.effective_price}` | item + delivery | *"with delivery"* — rendered **only when it differs** |
| 5 | Product JSON-LD `offers.price`, `page.tsx:230` | `o.price` | item price | — |
| 6 | GA4 `view_item.value`, `page.tsx:288` | best offer's **goods** price | item price, delivery deliberately excluded to match the commission basis | — |

`effective_price` is computed in `getRetailerOffers` (`lib/product-queries.ts`) as
`price + deliveryFor(retailer, price).cost`, and offers are sorted **in-stock first, then by
`effective_price` ascending**.

### Where the headline and the top row disagree

The headline is the **delivered** price. The top row's large figure is the **item** price. They
differ whenever the best offer attracts delivery.

> **66,398 of 86,835 product pages with an in-stock offer — 76.5% — display a headline figure
> that is not the top row's primary figure, with nothing on the page saying why.**

The secondary `"£X with delivery"` line does appear on the row, so the delivered number is
present — but it is the *small* one on the row and the *large* one in the headline, which is the
inversion. On a single-offer page the two figures sit about 400px apart and differ by £2.95–£9.95.

---

## 2. Delivery data per retailer

**Every active retailer publishes terms. There is no missing-data problem.**

| Retailer | Model | Threshold | Cost | In-stock offers |
|---|---|---:|---:|---:|
| Boots | tiered | £25 | £3.95 | 20,142 |
| Debenhams | **flat** | **none** | £3.99 | 15,019 |
| YesStyle | tiered | £50 | £3.95 | 13,912 |
| Perfume Click | tiered | £50 | £2.95 | 9,852 |
| Stylevana | tiered | £39 | £3.79 | 9,034 |
| Niche Beauty | tiered | £75 | £9.95 | 8,525 |
| Beauty Flash | tiered | £25 | £2.95 | 7,892 |
| Beauty Bay | tiered | £30 | £2.95 | 7,043 |
| Gorgeous Shop | tiered | £25 | £2.95 | 6,458 |
| Escentual | tiered | £30 | £3.50 | 5,915 |
| The Organic Pharmacy | tiered | £30 | £3.99 | 110 |

**Two retailers carry `delivery_model = 'unknown'` with a written reason** — Amazon (*"not a
retailer-level term"*) and eBay (*"set PER LISTING by the individual seller"*). **Both are
`active = false`**, so neither appears in the offer table. Amazon still reaches the page through
its own module, which is out of scope.

### Coverage

| | n | of in-stock offers |
|---|---:|---:|
| In-stock offers on live products | **103,902** | 100% |
| With computable delivery | **103,902** | **100.0%** |
| With a published threshold | 88,883 | 85.5% |
| **With a published threshold AND a gap** | **61,972** | **59.6%** |
| Already free (at or over threshold, or £0) | 26,911 | 25.9% |
| Flat, no threshold (Debenhams) | 15,019 | 14.5% |

---

## 3. Delivery penalty distribution — Phase 0 Task 6

**Delivery cost as a percentage of item price**, over the 76,991 in-stock offers that currently
attract a charge:

| | p25 | **median** | p75 | p90 |
|---|---:|---:|---:|---:|
| delivery ÷ item price | 16.6% | **25.3%** | 40.9% | 65.9% |

**The median offer that pays delivery pays a quarter of the item price again to receive it.**

**The gap to free delivery, as a multiple of item price** — the quantity the prompt's rule needs,
over the 61,972 offers below a published threshold:

| | p25 | **median** | p75 | p90 |
|---|---:|---:|---:|---:|
| gap ÷ item price | 0.58× | **1.50×** | 3.18× | 6.14× |

> **The median gap is one and a half times the item price.** Adding a second item of similar
> price does not reach free delivery in most cases. This is the distribution that decides the
> rule, and it argues for a tight one.

### Per retailer

| Retailer | Free now | Has a gap | Median penalty | Median gap × price | Median gap |
|---|---:|---:|---:|---:|---:|
| Beauty Flash | 4,958 | 2,934 | 17.4% | **0.47×** | £8.05 |
| Gorgeous Shop | 3,359 | 3,099 | 17.4% | **0.47×** | £8.00 |
| The Organic Pharmacy | 63 | 47 | 20.0% | **0.50×** | £10.00 |
| Escentual | 3,838 | 2,077 | 18.4% | **0.58×** | £11.01 |
| Beauty Bay | 2,101 | 4,942 | 17.9% | 0.82× | £13.50 |
| Boots | 6,669 | 13,473 | 32.9% | 1.09× | £13.01 |
| Niche Beauty | 2,747 | 5,778 | 28.4% | 1.14× | **£40.00** |
| Perfume Click | 1,914 | 7,938 | 16.3% | 1.76× | £31.88 |
| Stylevana | 508 | 8,526 | 34.5% | 2.55× | £28.01 |
| YesStyle | 754 | 13,158 | 30.3% | **2.83×** | £36.95 |
| Debenhams | 0 | **0** | 21.6% | — | — |

---

## 4. Out-of-stock rows, and how many rows a page shows

**Out-of-stock rows are included and fully rendered**, beneath an `Out of stock` divider bar
(`page.tsx:460-469`). They are not collapsed, not counted, and not behind an expander. Every OOS
row renders the same `RetailerRow` component as an in-stock one.

| | n | % of pages |
|---|---:|---:|
| Product pages with any live offer | 99,097 | — |
| **Pages showing at least one OOS row** | **14,892** | **15.0%** |
| Pages that are OOS-only (no in-stock offer at all) | 12,262 | 12.4% |
| Average rows per page | **1.20** | — |
| Average in-stock rows per page | **1.05** | — |
| Maximum rows on any page | 9 | — |
| Pages with 2+ in-stock rows | 13,115 | 13.2% |
| **Pages with more than 4 in-stock rows** | **139** | **0.14%** |

> **The "top four with an expander" rule would affect 139 pages.** The table is not long; it is
> mostly one row. **The collapse that matters is the out-of-stock one, at 14,892 pages — and of
> those, 12,262 have nothing else to show**, so collapsing OOS on those pages empties the table
> entirely. That case needs its own treatment and is not covered by "collapse behind a single
> line".

---

## 5. Add-to-basket, and the preload mechanism

**`components/SaveToRoutineButton.tsx`.** Label is **`'Add to basket'`**, becoming
**`'✓ Added to basket'`**. It calls `addToRoutine()` from `lib/routine-store` (localStorage),
fires `trackAddToCart`, and **does not navigate**. There is **no persistent count** anywhere in
the component.

**The preload mechanism exists and is substantial** — `app/app/RoutineBuilder.tsx` parses
`?routine=1,2,3`, has an explicit hydration gate with a timeout, distinguishes three arrival
cases, counts ids that resolved to nothing, records provenance for a `load_routine_from_url`
event, and is already used by saved-routine emails. **Nothing on the product page routes into
it.** The two halves exist and are not connected.

---

## 6. eBay module and `http://` references

**The eBay module is still on the product page.** `page.tsx:45` builds a tagged search URL,
`page.tsx:512` renders it. Live HTML confirms it: *"Search for this product on eBay. Prices not
compared."* **It was not removed** — if the programme document lists it as fixed, that is wrong.

**No insecure asset references.** The only `http://` strings on a live product page are
`http://www.w3.org/2000/svg`, the XML namespace — correct as-is and must not be "fixed".

---

## 7. Freshness — three sources, all usable

| Source | Grain | Example (Boots, 22 Aug) |
|---|---|---|
| `retailer_prices.last_updated` | **per offer row** | 04:31:26 |
| `retailer_import_config.last_imported_at` + `last_import_status` | per retailer | 04:31:26, `ok` |
| `scrape_log.completed_at` where `status='success'` | per run | 04:31:27 |

All three agree to under a second. **`last_updated` is already carried on every offer**, so a
per-row stamp needs no new query. All eleven active retailers imported successfully today.

**None of these is a scheduled time** — each is written on completion, which satisfies the
constraint.

---

# Task 2 — the bridgeability rule, proposed

**Fire the delivery prompt when, for an in-stock offer at a tiered retailer below its threshold:**

```
gap ≤ 1.0 × item price        (gap = threshold − item price)
```

### Why 1.0×, from the distribution

| threshold | offers | share of the 61,972 with a gap |
|---|---:|---:|
| gap ≤ 0.5× | 13,770 | 22.2% |
| **gap ≤ 1.0×** | **23,482** | **37.9%** |
| gap ≤ 1.5× | 30,650 | 49.5% |
| gap ≤ 2.0× | 36,861 | 59.5% |

**1.0× is the point where the prompt is still describable in one honest sentence:** *"add about
one more item like this one and delivery is free."* At 1.5× the median case needs an item half as
expensive again; at 2.0× it needs two more. **The median gap across the whole population is
1.50×, so a 1.0× rule deliberately fires on less than half of eligible offers** — which is the
intent. A £30 gap on a £9 item is 3.3× and does not fire.

**A second condition, and it is not optional:**

```
AND gap > delivery_cost
```

**3,839 offers have a gap smaller than the delivery charge itself.** For those the honest advice
is to pay the delivery, not to add another item — the prompt would be advising a customer to
spend more to save less. Under the 1.0× rule this affects a subset of the 23,482, and excluding
them is arithmetic rather than judgement.

### Where the prompt cannot run, and why

| | Retailers | Offers | Reason |
|---|---|---:|---|
| **No threshold exists** | **Debenhams** | **15,019** | `delivery_model = 'flat'`. £3.99 on every order at any basket size. **There is no gap, so there is nothing to bridge** — and the prompt must not imply one. |
| **Terms are not retailer-level** | Amazon, eBay | 0 in the offer table | Both `active = false` and both carry a written reason. Amazon reaches the page via its own module; **the prompt must not attach to it**. |
| Already free | all tiered | 26,911 | At or over the threshold. Nothing to prompt. |
| Gap too large | all tiered | ~38,490 | Above 1.0×. Silent by design. |

> **Where a retailer publishes no threshold, the page should say so rather than infer one.** For
> Debenhams the true statement is *"£3.99 delivery, no free-delivery threshold"* — which is
> useful, and is not a prompt.

**Expected reach: 23,482 in-stock offers before the `gap > delivery_cost` exclusion, 22.6% of all
in-stock offers and 37.9% of those with a gap.** Concentrated in Boots, Beauty Flash, Gorgeous
Shop, Escentual and Beauty Bay — the low-threshold retailers. **YesStyle and Stylevana will almost
never prompt** (median gaps of 2.83× and 2.55×), which is correct rather than a coverage failure.

**Not built. The rule is a proposal and Task 3 waits on it being decided.**
