# Comparison depth: the canonical query

**This is the platform's headline metric.** On 9 August 2026 it produced two different
answers from two people in one afternoon, during the Niche Beauty go-live. This file exists
so that cannot happen again by accident.

The same text lives in the `metrics_quality_weekly` table comment, deliberately duplicated:
the comment travels with the data for anyone querying the database directly, this file is
greppable and version-controlled. If you change one, change both.

---

## The query — cite this, do not rewrite it

```sql
select count(*) from (
  select p.id
  from products p
  join retailer_prices_live rl on rl.product_id = p.id
  where p.merged_into is null
    and p.parent_product_id is null
    and rl.in_stock
  group by p.id
  having count(distinct rl.retailer_id) >= 2
) x;
```

**Why this form is canonical and not merely preferred:** three independent formulations —
this one, a `products_active`-based one, and the definition stored in
`metrics_quality_weekly` — were run in a single statement at a single instant on
9 August 2026 and all three returned **11,135**. It is the agreed form because it was
reconciled, not because someone picked it.

## The trap

**`retailer_prices_live` is `retailer_prices JOIN retailers ON r.active`. The active filter
is inside the view.**

Joining `products_active` and then counting `distinct retailer_id` over raw
`retailer_prices` looks equivalent and is not: **an inactive retailer's row counts toward
the `>= 2` threshold** and the figure comes out high. This is exactly the error that
produced the disagreement.

> Count retailers over `retailer_prices_live`. Never over `retailer_prices`.

Two further terms that move the number:

| Variation | Result, same instant | Note |
|---|---|---|
| Canonical | **11,135** | — |
| Dropping `in_stock` | 13,362 | **20% inflation.** The term is load-bearing |
| `products_active` instead of the roots filter | 11,135 | Harmless but redundant — every product with two in-stock active retailers already carries an image |

## Readings on record

| When (UTC) | Value | Context |
|---|---|---|
| 2026-08-09 14:31 | **10,631** | immediately before Niche Beauty go-live |
| 2026-08-09 14:40 | **11,135** | after; delta **+504**, fully reconciled |

**"11,480" has circulated as a baseline and is unsourced.** No query has produced it and no
table holds it. `catalog_health_history` tracks match-key coverage, images and orphans and
has **no comparison-depth column at all**. Do not use it as a baseline.

## The real gap: the definition is stored, the series is not

`metrics_quality_weekly` holds this definition in its comment and has **zero rows**. Every
reading of the platform's headline metric has therefore been ad-hoc, which is why no two
readings are comparable after the fact and why an unsourced baseline could circulate
unchallenged for as long as it did.

**Populating that table is the fix**, and it is what makes the next retailer go-live
measurable against this one. Until then, any statement of the form "up N from before" is a
comparison against a number with no provenance.

## What a go-live actually moves, and why the count understates it

From the Niche Beauty flip, 8,159 root products with an in-stock Niche Beauty row:

| Bucket | n | Effect on the count |
|---|---|---|
| 0 other in-stock active retailers — Niche Beauty alone | **7,296** | none — catalogue **breadth**, not depth |
| exactly 1 other — moved 1 → 2 | **504** | **+1 each** |
| 2+ others — already comparable | **359** | none — adds a price to compare, not a product |

504 + 359 = **863 products gained a price to compare against.** 504 is the count movement
and equals the measured delta exactly, with no residual.

**Report both numbers.** The count movement alone understates what a retailer delivered,
because a product already at three retailers gaining a fourth is real depth that the metric
is structurally blind to.
