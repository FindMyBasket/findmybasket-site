# Commercial finding: the optimiser has nothing to choose from on most of the catalogue

**Recorded:** 2 August 2026. **Commercial, not engineering. Not to be acted on.**
Filed here because no commercial-findings document existed; the nearest neighbour
is `docs/dashboard-build-brief.md`, which is a reporting brief rather than a home
for this.

## The finding as raised

Boots is sole live offer on a large share of the catalogue and sits at the bottom
of the commission range. On that share the optimiser has no alternative to route
to, which is a structural reason average commission per sale sits at £1.33. A
catalogue depth question, not a marketing one.

## What the measurement says

The direction is right and the scale is larger than the framing. Measured 2 August
2026 against live data.

**Only 13.8% of the buyable catalogue has anything to compare.**

| Live retailers offering the product | Products | Share of buyable |
|---|---|---|
| **1** | **74,583** | **86.2%** |
| 2 | 9,969 | 11.5% |
| 3 | 1,568 | 1.8% |
| 4+ | 448 | 0.5% |

Buyable means at least one in-stock price row at an active retailer: 86,567
products, against 105,873 canonical live products.

**Boots is the largest single block, but not the whole of it.** Sole live offer by
retailer:

| Retailer | Sole-offer products | Share of buyable |
|---|---|---|
| Boots | 29,734 | 34.3% |
| YesStyle | 10,661 | 12.3% |
| Perfume Click | 8,486 | 9.8% |
| Debenhams | 7,383 | 8.5% |
| Stylevana | 6,521 | 7.5% |
| Escentual | 5,524 | 6.4% |
| Beauty Bay | 5,146 | 5.9% |
| Beauty Flash, Gorgeous Shop, The Organic Pharmacy, Atelier De Glow | 1,128 | 1.3% |

Boots is 28.1% of the canonical live catalogue and 34.3% of the buyable catalogue.

## Why this matters more than the Boots framing suggests

The finding as raised is a Boots-and-commission problem. The measurement says it is
a **catalogue overlap** problem, and Boots is where it is most visible rather than
where it is confined.

On 86.2% of buyable products the optimiser cannot route anywhere, because there is
only one place to go. It cannot select a cheaper retailer, cannot build a split,
and cannot demonstrate a saving. Whatever each retailer's commission rate is, the
mix is set by which retailer happens to be the only one carrying the product, not
by anything the product does. That is upstream of both the commission rate and the
clickout rate.

It also bounds the whole-basket proposition independently of the 1 August clickout
diagnosis: a basket assembled from this catalogue will, on average, be composed
mostly of products with a single possible source.

## Two implications

**Both are reasoning from the measured figures above, not independent findings.
Neither has been verified. Neither is to be acted on.**

### 1. Most baskets have no flexibility for the optimiser to use

On a sole-offer product there is no routing choice, so the optimiser has nothing
to decide. Delivery grouping only creates value when some items in a basket can
move between retailers: that is the entire mechanism by which a split beats a
single shop.

At 13.8% comparable, an average five-product basket contains **fewer than one
comparable product** (5 × 0.138 = 0.69). Treating basket composition as drawn
uniformly from the buyable catalogue, roughly **48%** of five-product baskets
would contain **no** comparable product at all (0.862⁵ = 0.476) — nothing to
optimise, and no split available at any price.

That is a **candidate explanation for the 1.7% optimiser usage** measured on
1 August (5 of 288 clickouts originating on `/app`), and it sits **upstream of any
UX cause**. If the optimiser has nothing to decide on most baskets, improving how
it is presented cannot move much.

Stated honestly: the uniform-draw assumption is a simplification and probably
pessimistic. Real baskets skew towards popular products, which are more likely to
be stocked by more than one retailer. The direction is sound; the 48% is
illustrative, not a forecast. Testing it properly means measuring comparable-share
on *actual* basket contents, which needs more baskets than the 12 saved routines
that exist.

### 2. Judge new retailers on overlap, not on size

It follows that a retailer's value to the proposition is not how many products it
adds.

- A retailer adding products **nobody else stocks** increases the sole-offer share
  and **dilutes** the proposition. It grows the catalogue and shrinks the share of
  it that can be compared.
- A retailer **overlapping existing stock** creates comparable products, which is
  the only thing that makes the optimiser able to act.

Suggested measure for any future retailer evaluation: **what share of their
catalogue already exists at another active retailer.** High overlap is the signal,
not high count. This inverts the instinct that a bigger feed is a better feed.

Not proposed as a rule, and no retailer decision should be made on it as written.

## Not verified here

**[Resolved 15 August 2026. The two claims below were carried for a fortnight and
both were checkable by one authenticated call.]**

**"Boots sits at the bottom of the commission range" is CONFIRMED, and it was
understated.** Boots's standard commission groups top out at **2.00 per cent** —
the lowest ceiling of all sixteen joined advertisers, against 3.00 per cent for
the next lowest and 15 per cent at the top. It also carries **26 groups paying
zero**, including named exclusions for Chanel, Dior, Dyson and Jo Malone, which no
other advertiser has. See work-list item 120.

**The £1.33 average commission per sale is CLOSED at £1.14 measured**, or £1.19
over complete weeks only — so the carried figure was 12 to 17 per cent high. From
`metrics_awin_weekly`, which now holds 93 rows over 12 weeks.

**Still true: commission rates are not in the database.** `retailers` has no rate
column. The rate card was read from `api.awin.com/publishers/{id}/commissiongroups`
and **printed to an Actions log rather than stored**, so it is not queryable and
this file's successor will have to read it again. That is the remaining gap and it
is now a cheap one: the endpoint is confirmed and the puller pattern exists.

> **Marking something unverified is not the same as verifying it, and the marker
> has a shelf life.** This section did its job — it was honest, specific, and named
> the claim's owner — and the claim was still quoted downstream for a fortnight,
> because a marker records a debt without ever calling it in.

## Deliberately not answered

Whether the response is deeper retailer coverage on existing products, more
retailers, or narrowing the catalogue to products with real overlap. That is a
commercial decision and this file does not make it.

Any work arising gets its own brief. **Nothing here is actionable as written.**
