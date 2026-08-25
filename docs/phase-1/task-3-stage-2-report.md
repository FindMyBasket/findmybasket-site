# Phase 1 Task 3, stage 2 — table hygiene: report before building

**23 August 2026. Nothing built.** Stage 1 (#385) is live: the delivered price is authoritative
and headline and row agree.

---

## 1. The out-of-stock-only page is not a hygiene problem

**It is 12,398 pages — 12.50% of `products_active` — and 12,294 of them (99.2%) have exactly one
row.** So "collapse out-of-stock rows behind a single line" would, on almost all of them, collapse
the only thing on the page behind a line saying there is one thing.

**But the collapse is the smaller half of what the measurement found.**

### Not one of these pages has been refreshed in seven days

| | |
|---|---:|
| Out-of-stock-only pages | **12,398** |
| Touched in the last 2 days | **0** |
| Touched in the last 7 days | **0** |
| **Not touched for 30+ days** | **11,030 (89%)** |
| Median days since last touch | **48.5** |
| Oldest | **4 May 2026** |

| Retailer | Pages | `absence_threshold_days` | Avg days stale |
|---|---:|---:|---:|
| Boots | 7,936 | 7 | **67** |
| Stylevana | 1,911 | 21 | **80** |
| Debenhams | 828 | 30 | 51 |
| Escentual | 646 | 21 | 58 |
| Beauty Bay | 531 | 7 | 59 |
| Niche Beauty | 362 | 7 | 13 |
| others | 290 | — | 8–51 |

> **THESE ARE NOT OUT-OF-STOCK PRODUCTS. THEY ARE ROWS THE IMPORTER STOPPED SEEING.**
>
> Each retailer's `absence_threshold_days` flips `in_stock` to false when a product stops
> appearing in the feed. Boots' threshold is **7 days** and its out-of-stock-only rows average
> **67 days** stale — roughly **two months past the point the threshold fired**. Nothing has
> re-confirmed any of them since.
>
> "Out of stock" is what the column says. **"No longer carried, as far as we can tell" is what the
> data says**, and the page currently renders the first.

### What the page says today

> *"Currently out of stock at all retailers. Check back soon."*

**On a row last seen a median of 48.5 days ago.** "Currently" is doing work the data cannot
support, and "check back soon" is an invitation to return to a page that has not changed in seven
weeks and has no mechanism that would change it.

**And all 12,398 are in the sitemap.** `lib/sitemap.ts` selects from `products_active` with no
stock filter, so every one is actively submitted for crawling.

### The proposed treatment — for decision, not built

**Three parts, and only the first is hygiene.**

**(a) Say what is true instead of what is convenient.** Replace *"Currently out of stock… check
back soon"* with a statement anchored to the actual last-seen date, e.g. *"Last seen at Boots on
17 June. We have not seen it since."* The date already exists on every offer
(`retailer_prices.last_updated`, carried through `getRetailerOffers`) so this needs no new query.
**It also makes the freshness stamp and the out-of-stock copy the same mechanism** rather than two.

**(b) Do not collapse a single row behind a summary of itself.** Collapse only where
`outOfStockOffers.length > 1` **and** at least one in-stock row exists. On the 12,294 single-row
pages the row stays visible, with its date. On the 104 multi-row ones a collapse is genuine.

**(c) The real question, which is not stage 2's to answer:** whether a page whose only offer was
last seen 67 days ago should be in `products_active` and the sitemap at all. **That is a
catalogue-membership decision**, it interacts with the merged-product redirect logic and with
item 75's `products_active` definition, and it should not be smuggled in as table hygiene.
Recorded, not proposed.

---

## 2. Top four with an expander — recommend DROPPING it

| | |
|---|---:|
| Pages with more than 4 in-stock rows | **139** |
| Share of pages with a priced row | **0.14%** |
| Average in-stock rows per page | **1.05** |
| Pages with exactly one in-stock row | 73,635 |
| Pages with 2+ in-stock rows | 13,113 |

> **RECOMMEND NOT BUILDING IT.** An expander is a control, a state, a default and an interaction
> to test, shipped for 139 pages — and it would sit on 99.86% of pages doing nothing while still
> being code that can break the 86,748 that do not need it.
>
> **The measured average is 1.05 rows. The table it was specified for does not exist.**

If the catalogue grows into it the number to re-check is the same one: pages with more than four
in-stock rows. At 139 it is not close.

---

## 3. The freshness stamp

**The plumbing already exists.** `retailer_prices.last_updated` is selected in
`getRetailerOffers` and carried on every `RetailerOffer`. Nothing new is needed to read it.

**Three sources, all written on completion rather than on a schedule:**

| Source | Grain | Boots, 22 Aug |
|---|---|---|
| `retailer_prices.last_updated` | **per offer row** | 04:31:26 |
| `retailer_import_config.last_imported_at` + `last_import_status` | per retailer | 04:31:26, `ok` |
| `scrape_log.completed_at` where `status='success'` | per run | 04:31:27 |

All three agree to under a second.

> **A stamp reading a cron schedule says when it SHOULD have run.** None of these do. The
> per-offer value is the strongest of the three because it is the only one that distinguishes
> *this row was re-confirmed* from *the import ran*: a successful import that no longer contains a
> product leaves `last_import_status = ok` while that row's `last_updated` stops moving. **That
> difference is exactly the 12,398 pages above**, and only the per-row value can see it.

**Proposal:** stamp per row from `offer.last_updated`, not one page-level figure. A page whose
rows were last confirmed on different days has no single honest "as of" date.

---

## 4. Should the out-of-stock-only and one-retailer treatments be designed together?

**Yes for the page, no for the trigger — and the reason is that they are not the same shortage.**

| | Pages | What is missing |
|---|---:|---|
| One in-stock retailer, no OOS row | **71,704** | a **comparison** — there is a live price, and nothing to compare it to |
| Out-of-stock only | 12,398 | a **price** — there is no live offer at all |
| One in-stock + an OOS row | 1,931 | a comparison, with evidence a second retailer once existed |
| Comparable, 2+ in stock | 13,113 | nothing |

**The single-row out-of-stock page is the intersection**: one retailer *and* no live price. 12,294
pages are both at once, which is why neither existing treatment reaches them.

**Design together:** the page skeleton, the tone, and the answer to *"what does this page offer a
visitor when it cannot offer a comparison?"* That question is identical across 84,102 pages —
84.8% of the catalogue — and answering it twice would produce two different voices for one
situation.

**Do not design together:** the trigger or the copy. *"Only one retailer stocks this"* and *"no
retailer currently lists this"* are different facts, and a shared component that blurs them
reintroduces exactly the defect phase 0 just removed from the savings headline — **one figure
standing for two quantities.**

> **RECOMMENDATION: treat the shared skeleton as Phase 3's, and let stage 2 ship only (a) and (b)
> — honest copy and a collapse that does not fire on a single row.** Those are hygiene and are
> safe now. The membership question (c) and the shared no-comparison page belong with Phase 3,
> where 84.8% of pages are the subject rather than a side effect.

**One sequencing consequence worth stating:** if Phase 3 later removes these pages from
`products_active`, work done now on their copy is discarded. **(a) is still worth doing** — it is
a few lines, it stops a false claim being made for however long they remain, and the date it
renders is the same value the freshness stamp needs anyway.

---

## What I would build in stage 2, if approved

1. Out-of-stock copy anchored to `last_updated`, replacing *"check back soon"*.
2. Collapse only when there is more than one out-of-stock row **and** an in-stock row exists.
3. Per-row freshness stamp from `offer.last_updated`.
4. **Not** the top-four expander.

**Not built. Awaiting the decision on (c) and on the Phase 3 pairing.**
