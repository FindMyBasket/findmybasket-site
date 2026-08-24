# Phase 1 — search clickthrough harvest. CLOSED 24 August 2026.

**Scope as set:** metadata only, no new pages. Target set 90 queries at positions 4–10.

## What shipped

| | |
|---|---|
| **#422 / #423** | Brand-hub metadata split into two templates, chosen by whether anything is comparable. Work-list item 279. |
| **#424** | Product pages split into three branches by stockist count; brand hubs split into three; all six templates moved into `lib/format/metadata-copy.ts`. Items 281, 282. |
| Also in #424 | The meta-description duplicate guard normalised (2,092 pages, item 283); HTML entities decoded at ingest with a backfill (item 284). |
| **#425** | Corrected item 281's freshness argument — it holds for the RPC-derived count and not for the product name. Item 289. |

## What was proposed and NOT built

**Group 3 — a Boots-naming title across 20,204 product pages.** Held on 24 August for having 24
queries of evidence against 20,204 titles, then **closed as unnecessary**: branch B already emits
`{Product} | Boots price with delivery | FindMyBasket` on 91.3% of them, from a template chosen by
measurement rather than by the proposal. **Two different reasons, and the second is better.**

## The findings that outlast the phase

- **The fourth refusal, measured on demand rather than catalogue.** 97.2% of product-page
  impressions land outside the comparing template; branch A reaches 40 pages and 1,245 impressions.
  The first three refusals were catalogue shares. Item 292.
- **The Boots cluster is not product-name demand.** 66 of 73 queries are type-plus-retailer
  (`lady shaver boots`), 7 name a product, and the 7 convert about eight times better per query.
  Item 292.
- **A demand shape with no page.** Type-at-a-retailer is answered by neither a product page nor a
  brand hub. **A gap, not a task** — 3,014 impressions and 9 clicks is a weak case for a surface,
  and the shape is what matters rather than the count. Item 292.
- **The departed-brand class.** 16 brands ranking on 934 impressions into 404s, and the discovery
  that 406 of 433 "departed brands" are one retailer's offboarding. Items 288, 291.

## Open threads left by the phase

| Thread | Item | Size |
|---|---|---|
| 174 pages earning impressions that are not live | **295** | 8,005 impressions, 145 clicks |
| `and`/`&` match-key collision, for the gated change | **294** | 51 groups, 6 split live/dead |
| Brand-hub 410 for departed retailers | **291** | HELD on Superdrug reversibility |
| Stored pipe in supplier descriptions | **293** | Recorded, not ours to fix |

---

## A bound for anything that writes subcategory URLs

**`/skincare/moisturiser` 404s. The live subcategory is `/skincare/face`.** Subcategory slugs are
not the product-type names they resemble — `skincare` has exactly one live subcategory, `face`,
covering 45,388 products. Anything generating subcategory links, sitemap entries or article
cross-links must read the live set rather than infer it from category vocabulary. Item 296.
