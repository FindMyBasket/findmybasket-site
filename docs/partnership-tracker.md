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

> **Caveat on the comparison itself.** Commission rates are **not in the database** —
> `retailers` has no rate column and `metrics_awin_weekly` is empty. "Boots sits at the
> bottom of the commission range" is carried as stated and **not confirmed by
> measurement** (`docs/commercial-finding-catalogue-depth.md`, "Not verified here").
> The Fragrance Shop's 2% is a documented Rakuten term; the *ranking against Boots* is
> not. Do not build a comparison table of rates until they are recorded somewhere real.

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
