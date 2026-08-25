# Partnership tracker

**Created 3 August 2026, because no partnership tracker existed.** A grep across
`docs/`, `scripts/`, `supabase/` and the database returned nothing: no tracker
document, no `partnerships` table, no `commission` column anywhere. Approved-but-not-
integrated retailers were being held in conversation only.

That is the absent-record class described at the top of
`docs/post-4-august-work-list.md` and in `supabase/migrations/README.md` convention 9:
a record believed to exist because discussing it repeatedly produces the same
familiarity as having written it. Same reason `docs/commercial-finding-catalogue-depth.md`
was created.

**This file is the register for retailer relationships that are agreed but not live.**
A retailer that is live belongs in `retailers` / `retailer_config`; a dated event
belongs in `platform_changes`. This holds the gap between signature and go-live.

## Status vocabulary

| Status | Meaning |
|---|---|
| `approved-pending-integration` | Network application accepted. No retailer row, no import config, no feed. |
| `parked` | Approved, and deliberately queued behind other work. **The reason must be stated.** |
| `live` | Has a `retailers` row with `active = true`. Leaves this file. |

---

## The Fragrance Shop — `approved-pending-integration`, `parked`

**Accepted 3 August 2026 via Rakuten.**

| Field | Value |
|---|---|
| Network | Rakuten |
| Commission | **2%** |
| Delivery model | `tiered` |
| Delivery threshold | **£40.00** |
| Delivery cost below threshold | **£3.49** |
| Product catalogue | Confirmed available |
| Status | Approved, pending integration, parked |
| `platform_changes` | `The Fragrance Shop retailer go-live`, status `expected`, `changed_at` NULL |

### Parking reason

**Queued behind Niche Beauty onboarding, which is itself queued behind the AWIN
`product_GTIN` coalesce fix** (`platform_changes` id 3, held until after the 4 August
Boots step-down decision because it sits on the import path).

So the chain is: **AWIN coalesce fix → Niche Beauty go-live → The Fragrance Shop
go-live.** Nothing here starts until the first link clears.

### Reporting dependency — attached here deliberately

**Going live on Rakuten means going live with nothing measuring it.** There is no Rakuten
puller and `metrics_rakuten_weekly` has never held a row, so on the day this retailer
onboards its clicks, sales and commission are invisible to every dashboard the project has.

**That work is PARKED, not forgotten** — work-list item 121, with the research kept in
**`docs/rakuten-reporting-probe-brief.md`**. It was parked *because* of this dependency:
Rakuten has no live programme, so a puller built earlier would return correct zeros until
this onboarding lands.

> **This onboarding is the trigger. Read the probe brief before writing any Rakuten code**,
> and expect the probe to change the table — Rakuten's grain probably does not match
> `metrics_rakuten_weekly`'s existing shape, and the reasons are recorded there.

**Two things to check in the Rakuten portal while onboarding, both one glance each:**
whether the Web Services page shows **one token field or two**, and whether the portal's
**Scope ID matches SID `4684964`**.

### Delivery terms — recorded now, applied later

**These values do NOT go into `retailers` until the retailer row is created.** They are
recorded here so nobody has to re-read the Rakuten terms at onboarding time.

Observed 3 August 2026: `delivery_model = 'tiered'`, `delivery_threshold = 40.00`,
`delivery_cost = 3.49`.

**£40 is the joint third-highest threshold on the live roster.** Read from `retailers`
on 2026-08-03 — only YesStyle and Perfume Click (both £50.00) sit above it, and it ties
Atelier De Glow at £40.00:

| Threshold | Retailers |
|---|---|
| £50.00 | YesStyle, Perfume Click |
| **£40.00** | Atelier De Glow, **The Fragrance Shop (pending)** |
| £39.00 | Stylevana |
| £30.00 | Branded Beauty, Escentual, The Organic Pharmacy, Beauty Bay |
| £25.00 | Boots, Beauty Flash, Gorgeous Shop |
| none (`flat`) | Debenhams — £3.99 on every basket |

**Baskets will therefore often sit below it**, which makes this a useful test case for
the optimiser once the delivery fallbacks are removed (work-list item 11: remove the four
`?? '25'` / `?? '3.95'` fallbacks in `app/app/RoutineBuilder.tsx` and branch on
`delivery_model`). A retailer whose threshold is rarely cleared is where a wrongly
defaulted £25 does the most damage — the fallback would model it as free when it is not.
Related: item 12, whether the delivery wedge actually bites.

### Why 2% is acceptable

**2% sits at the bottom of the commission range, alongside Boots.** This retailer earns
its place through **comparison depth in a thin category** rather than through revenue.
That is a legitimate reason to onboard and a *different* reason from the usual one — it
should not be defended, or later judged, on rate.

The argument it rests on is measured: only **13.8%** of the buyable catalogue has anything
to compare against, and 86.2% of buyable products carry exactly one live offer
(`docs/commercial-finding-catalogue-depth.md`, measured 2 August 2026). A retailer that
adds a second offer where there was one is doing the thing the site exists to do,
whatever it pays.

> **[Resolved 15 August 2026.] "Boots sits at the bottom of the commission range" is
> CONFIRMED, and it was understated.** Boots's standard commission groups top out at
> **2.00%** — the lowest ceiling of all sixteen joined AWIN advertisers, against 3.00% for
> the next lowest and 15% at the top — and it carries **26 groups paying zero**, including
> named exclusions for Chanel, Dior, Dyson and Jo Malone that no other advertiser has. Read
> from `api.awin.com/publishers/{id}/commissiongroups`; see work-list items 118 and 120.
>
> **Which changes what The Fragrance Shop's 2% means. It does not beat Boots; it MATCHES
> Boots**, at the bottom of the range. The ranking that was carried as unverified turns out
> to have been carried in the wrong direction.
>
> **Still true: commission rates are not in the database.** `retailers` has no rate column
> and the AWIN card was printed to an Actions log rather than stored, so a rate comparison
> table still has nothing real to read from. **Rakuten's rates have never been read at all**
> — see the reporting dependency above.

---

## Niche Beauty — `approved-pending-integration`, `parked`

Listed for completeness because The Fragrance Shop is queued behind it.

| Field | Value |
|---|---|
| Status | Approved, pending integration, parked |
| Parking reason | Behind the AWIN `product_GTIN` importer fix (`platform_changes` id 3) |
| `platform_changes` | id 4, `Niche Beauty retailer go-live`, `expected`, `changed_at` NULL |
| Network | **Not recorded** |
| Commission | **Not recorded** |
| Delivery terms | **Not recorded** |

**The blank rows are the point.** They are marked unrecorded rather than left out, so the
gap is visible at onboarding time instead of being discovered then. Fill them from the
source agreement, not from memory.

---

## MyProtein — `approved-pending-integration`

**Approved 25 August 2026 via AWIN.**

| Field | Value |
|---|---|
| Status | **LIVE — `active = true`, 25 Aug 2026.** 608 products, 509 supplements. `import_config.enabled = false` and a hold refuses re-enabling (item 324). Decision to proceed in item 308, go-live figures in item 325 |
| Network | **AWIN**, advertiser **3196** |
| Importer | **`import-awin-feed` exists.** This is a retailer configuration, not a network integration |
| **Feed to use** | **`3196` "Default" — 7,192 rows, 97.1% barcode.** NOT `13007` "Masterfeed" (2,054 rows, 24.2% barcode, parent-level). `10429` "Bestsellers" is a 100-row promo selection |
| Commission | **Not recorded** — fill from the source agreement, not from memory |
| Delivery terms | **UNSET. `£4.49, free over £55` is the figure to CONFIRM at source, not to enter.** Second-most-expensive position in the fleet on both axes: charge 2nd of 11 (behind Niche Beauty £9.95, ahead of Debenhams £3.99), threshold 2nd of 10 (behind £75, median £30). **Not mid-range, and not the highest either** |
| Allowlist | **REQUIRED, and non-beauty.** Supplements sit under `Sports and Nutrition > Sports Nutrition`; the feed is 73.8% Apparel. `Sports and Nutrition\|Health and Beauty` admits 1,795 of 7,192 |
| Barcode overlap | **Measured 25 Aug: 8 of 7,192 deepen a live comparison.** Expected — see item 305 |
| Work-list | items 305, 306, 307 |

### Materially different from the CJ pair

Simply Be and VitaminExpress are the first CJ retailers, so onboarding either one is **a feed
integration**: new format, new auth, new failure surface, monitors that do not know how to watch it
(item 266). **MyProtein is a row in `retailer_import_config` and a cron entry.** The machinery
already exists and already runs eleven daily jobs through it.

### This is the retailer the supplements proposition was waiting on

Measured 25 August 2026: **1,831 live supplements, 34 comparable at two or more in-stock retailers
— 1.86%. Boots supplies 1,744 of them.** The category is one retailer wearing a category's name,
and `docs/supplements-brand-comparison-proposition.md` needs **a second range**, not overlapping
products.

### EXPECT NEAR-ZERO PRODUCT OVERLAP, AND THAT IS NOT A FAILURE

The Amazon harvest already measured MyProtein as the extreme own-brand case: **a barcode per flavour
per size across a matrix they control, 1 of 99 matching Boots.** The proposition document already
states the inversion — *"1 of 99 matching is a failure only under product-across-retailers; under
brand-across-brands, carrying the range direct is the point and the match rate is irrelevant."*

**Written here so that a near-zero overlap measurement at onboarding is read as the expected result
rather than as a reason to reject the retailer** — which is what happened to the number the first
time it was measured.

### Before `active = true`

Three steps, all of which exist because a previous onboarding skipped one:

1. **Delivery terms read from MyProtein's own site**, with `delivery_terms_source` set and a written
   reason if anything is unknown. Item 160: ten of eleven retailers had unverifiable provenance.
2. **Barcode overlap measured** against the live catalogue — recorded whatever it says.
3. **The product names read, not only counted.** Item 223 rejected Cohorted on the names after the
   overlap figure alone would have been ambiguous: *0% overlap says "products we cannot compare
   today"; the names said "products that cannot be compared in principle".* A count cannot tell a
   flavour matrix from a subscription box.

### Stage log

| Stage | State |
|---|---|
| 1. Feeds read, allowlist audited, MP line verified excluded | **done** — items 306, 307, 309 |
| 2. Config row written, inert | **done 25 Aug** — item 311 |
| 3. First import | **done 25 Aug** — 609 created, 608 live. Item 318 |
| 4. Delivery terms | **done 25 Aug** — read on MyProtein's own site, £4.49 free over £55. Site was sufficient because both numbers are published; item 323 |
| 5. `awin_merchant_id` verified | **done** — `awinmid=3196` read from the feed's own `aw_deep_link`, no fabricated click |
| **6. Go live** | **done 25 Aug** — item 325 |
| 7. Food and drink excluded | **done 25 Aug** — 37 rows, `reason = food_or_drink`. Item 326 |
| **8. RE-IMPORT IS HELD** | a second run would create **177 near-duplicates** (item 314's leak). Guarded by a trigger on `enabled`, item 324 |

### Known and accepted at go-live

| | |
|---|---|
| ~25 ingestible supplements filed as `skincare/face` | Item 322. They arrive on `Health and Beauty` paths the supplements override does not reach, and those paths are mixed at source — `Body Care` holds collagen capsules and a toothbrush. **No config fix exists.** A shelving error, not a false claim. |
| Depth at 3.49% | Below the predicted 3.5–5.1% floor. Item 327. |
| Re-import would create 177 duplicates | Item 314's leak. Guarded at the `enabled` flag, item 324. |
