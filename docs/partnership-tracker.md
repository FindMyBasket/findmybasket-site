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
| `links-only` | Approved on a network and **cannot ever be a feed retailer**, because no product feed exists. Never gets a `retailers` row. Stays in this file permanently — it is a placement record, not a queue entry. |
| `declined-volume-gated` | **Application declined on traffic volume, not on structure.** No retailer row, no placement, no catalogue presence. **Clears by the reapplication doctrine in `docs/strategy.md`** — traffic and tracked transactions accumulate, then reapply with proof. Distinct from `parked`, which reads as ours to un-park when the gate is theirs. Added 1 September 2026 for Bulk. |

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

---

## Optimum Nutrition — `links-only`

**Approved 27 August 2026 via AWIN. No product feed.**

**THIS IS THE FIRST ENTRY THAT IS NOT WAITING FOR ANYTHING.** Every other row in this file holds the
gap between signature and go-live. **This one has no go-live to wait for**: without a feed there is no
refresh path, and `docs/strategy.md` — *"no retailer enters the catalogue without a refresh path"* —
settles that permanently rather than temporarily. Filing it as `approved-pending-integration` would
create a queue entry that can never clear, which is how a register starts lying.

| Field | Value |
|---|---|
| Network | **AWIN** |
| Status | **`links-only`** — strategy's *Two tier retailer model*, second tier |
| Product feed | **None supplied.** Not "not yet"; not offered |
| `retailers` row | **None, and none is expected.** Do not create one |
| Import config | N/A |
| Commission | **Not recorded** — fill from the source agreement, not from memory |
| Delivery terms | **Not recorded.** Only needed if they ever become a comparison source, which requires a feed |
| Work-list | item 458 |

### They are a brand, not a retailer, and this file is the wrong register — deliberately

The heading of this document says *"retailer relationships that are agreed but not live."* **Optimum
Nutrition is a brand.** There is no brand register, and inventing one for a single entry is the defect
this file was created to correct in the other direction. **Recorded here with the mismatch named**, so
that the first brand-side relationship does not read as a retailer that failed onboarding — which is
exactly the misreading this entry exists to prevent.

### They are already in the catalogue, through Boots alone

**30 live products in `products_active`, measured 27 August 2026.** All 30 carry exactly one retailer
row and it is **Boots** (30 of 30 in stock). Superdrug holds 16 of the same products, is
`active = false`, and has zero in-stock rows. **MyProtein supplies none** — it is an own-brand range.

**20 of the 30 appear on a type page:** 13 ranked and 2 listed on `/compare/whey-protein`, 4 ranked and
1 listed on `/compare/creatine`. Full positions and the derivation are in item 458.

### The placement that exists, and the decision it needs

A ranked row for one of these products **could** link direct to the brand rather than to Boots. It is a
real placement on a page that already ships, not a hypothetical.

> **AND IT IS NOT DECIDED.** The row's price per 100g is computed from **Boots'** price; the brand's own
> price is unknown and unknowable **for the same reason this entry exists — no feed.** A direct link
> would put a measured number and an unmeasured destination on the same row.

**`docs/strategy.md` places this tier's links "inside articles and hubs" and requires "visible
separation from the neutral comparison surfaces."** The type pages are that surface.

### DECIDED 27 August 2026: no. Item 459

**No brand-direct links on `/compare/*`.** Robbie's call, and **the reason recorded is not the
firewall clause**:

> **The row's price per 100g is computed from BOOTS' price. The brand's own price is not held and
> cannot be held — that requires the feed this entry exists because they do not supply.** A direct
> link would put a measured number and an unmeasured destination on the same row, describing two
> different sellers with no mechanism that could reconcile them.

**The firewall clause is about ranking and nothing here moves a ranking**, so citing it would have
attached a wrong reason to a right decision. **What would change this is a refresh path for their own
price — which is a feed.** There is no version of this that a link unblocks and a feed does not.

**Nothing is built.** The mechanism was never the constraint: `ClickOutLink` already carries
`brandSlug` with no `retailerId`, which is how the brand hub cards work today (item 461).

---

## Healf — `approved-pending-integration`

**Approved 28 August 2026 via AWIN. Advertiser 22320. NOT ONBOARDED — recorded before any work.**

**Robbie called this "pipeline"; the file's vocabulary calls it `approved-pending-integration`**, which
is the same state. **Mapping written down rather than a fifth status invented** — the vocabulary exists
so that "in the pipeline" cannot mean two things.

| Field | Value |
|---|---|
| Network | **AWIN**, advertiser **22320** |
| Feed | **"F521", as supplied.** **NOT a numeric `fid`**, which is what every tool here takes — see below |
| Status | `approved-pending-integration`. No retailer row, no import config, no feed read yet |
| Commission | **Not recorded** — fill from the source agreement, not from memory |
| **Delivery terms** | **£3.99, free over £50 — CONFIRMED BY ROBBIE HIMSELF, 28 Aug.** To be written **with `delivery_terms_source`** when the config row is created |
| **`delivery_terms_source`** | **BOTH — read on the site AND confirmed at checkout.** Asked rather than assumed (item 160: ten of eleven retailers had unverifiable provenance). **This is stronger provenance than MyProtein's**, where the site alone was sufficient because both numbers were published; here the two agree, which also rules out the failure a checkout-only figure carries — that it can vary by basket in a way a published page does not |
| Shape | **Wellness retailer, not a sports specialist.** Expect third-party brands rather than own-brand, so **barcode overlap may be REAL rather than near-zero** — the opposite of MyProtein's prediction |

### The before-onboarding sequence is BLOCKED on one input, and it is not the feed's fault

`feed-diag.yml` — the read-only harness that answers stages 1, 2 and 4 — takes a **numeric AWIN feed
id**, used directly in
`productdata.awin.com/datafeed/download/apikey/…/fid/${FID}/…`. MyProtein's was `3196`; Gorgeous Shop's
`110188`; Atelier De Glow's `119037`.

> **"F521" IS NOT THAT SHAPE, AND GUESSING `521` WOULD HAVE BEEN THE WRONG MOVE.** A wrong `fid` does
> not fail loudly — the account can see many feeds, so it would download **a different advertiser's
> feed** and every number in the report would be confidently about the wrong retailer.

**The one path that resolves an advertiser id to a feed id is `awin-feed-count?list=1&q=`, which is
service-role gated**, and `cohorted-probe.mjs` — which does exactly this resolution — takes no inputs
and has its advertiser hardcoded. **So the resolution was a question rather than a lookup. Asked; Robbie
confirmed `fid = 521`; dispatched.**

> **`fid=521` RETURNS 404. The feed does not exist at that id** (run 33151299143). The harness refused
> rather than reporting on a wrong feed, and four runs succeeded on 25 August, so the instrument is
> sound. **A confirmation is not a verification** — neither of us had read the feed list, and the
> value came back with a second person's confidence rather than with evidence. Item 482.

**THE `fid` WAS NEVER THE BLOCKER.** Healf's is a **Google Shopping (Darwin) feed**, and that path
takes a **URL**, not a feed id — which is why 521 returned 404 and why `feed-diag.yml`, which builds
`…/fid/${FID}/…`, cannot read this feed at all.

### PROCEEDS AS A CATALOGUE RETAILER — decided 28 August on the evidence (item 483)

`google_shopping` is a **first-class `feed_format`**, not an AWIN fallback: two retailers run it,
Branded Beauty was **third of fifteen on barcode fill at 99.8%** — above Boots by 35 points — and
Atelier's Google feed **synced successfully at 05:21 on 28 August**. The deep link arrives **fully
wrapped with the publisher id baked in**, so it needs *less* configuration than the legacy format, not
more.

**Branded Beauty's failure was a closed programme still answering HTTP 200 — a relationship risk no
format prevents and no column list predicts.** An argument about the monitor, not the shape.

### What is needed before onboarding — THREE things, not one

| | |
|---|---|
| 1 | **The Darwin download URL** from the AWIN dashboard — *right-click the download button → Copy Link Address*. It carries credentials, so it goes in as a **GitHub secret**: `DARWIN_FEED_URL_HEALF`, the way `DARWIN_FEED_URL_BB` and `DARWIN_FEED_URL_ADG` do |
| 2 | **`sync-healf-feed.yml`**, copied from `sync-adg-feed.yml`: curl → verify gzip → gunzip → `POST storage/v1/object/awin-feeds/healf.csv` |
| 3 | **`retailer_import_config.feed_url = 'storage://awin-feeds/healf.csv'`** — a pointer, not the URL. Both existing Google retailers store exactly this shape, and **the credential never touches the database** |

**AND ONE THING TO COUNT IN THE FEED RATHER THAN INFER:** rows with an **empty `aw_deep_link`**. The
importer skips a row for no match id, no price or out of stock — **not for a missing deep link** — so
such a row stores with `url = ''`, which is a product page with no click-out. Both existing Google
retailers are at 100% URL fill; that says nothing about Healf's.

**Nothing configured. No secret, no workflow, no config row, no retailer row.**

### The baseline stage 5 will be measured against, taken now

The proposition is **brand-across-brands, not product-across-retailers** — so the question is whether
Healf adds a **third range**, not whether it overlaps the first two.

| Retailer | supplements products | brands |
|---|---:|---:|
| **Boots** | 1,755 | **301** |
| **MyProtein** | 494 | 38 |
| Niche Beauty | 211 | 35 |
| the other six | 78 | ≤7 each |

**361 distinct supplement brands live today**, and the two incumbents barely intersect:

```
Boots only      289 brands
MyProtein only   26
BOTH             12          <- the entire overlap
neither          34 brands, 188 products
```

> **TWELVE BRANDS OF 361 ARE STOCKED BY BOTH.** The catalogue's supplements are not two competing
> ranges — they are **two disjoint ranges filed under one heading**, which is what
> `docs/supplements-brand-comparison-proposition.md` was written about. **A third range is additive by
> default here; the interesting question is whether Healf's brands are a THIRD disjoint set or the
> first real overlap.**

**Nothing is configured. Nothing is imported. No retailer row exists.**

---

## Bulk — `declined-volume-gated`

**Declined 2026 via the affiliate application. Recorded 1 September 2026, after the Amazon-store
scoping (work-list item 546) returned no mechanism.**

| Field | Value |
|---|---|
| Network | **Not recorded** — fill from the application, not from memory |
| Status | **`declined-volume-gated`** — a fifth status, see below |
| Decline reason | **Volume, not structure.** Not a category, policy or group-level refusal |
| Product feed | Unknown — never reached the question |
| `retailers` row | **None, and none is expected while declined** |
| Catalogue presence | **Zero products.** 0 rows on `brand`, `normalised_brand` or a name prefix, measured 1 Sep 2026 |
| Amazon route | **Closed — work-list item 546.** Not deferred; no mechanism exists |
| Re-engagement trigger | **Traffic and tracked transactions**, per `docs/strategy.md` |

### The Amazon store is not a way round it

**Scoped 1 September and closed.** Bulk have an Amazon store; the site cannot use it. Six conditions
would have to hold and **one of them is not a permission** — Amazon prices cannot be held beyond 24
hours, and `/compare/*` ranks on a stored `retailer_prices.price` behind a one-hour revalidate. **No
approval from Amazon and no decision here resolves that.** Full reasoning in item 546.

**Worth stating in this file because the Amazon route is the one that looks like it works.** The
comparison pages need no delivery data, which is the constraint that keeps Amazon out of the basket —
so the idea passes the test everybody reaches for first and fails a different one further in.

### The decline is a volume gate, so the doctrine applies unchanged

`docs/strategy.md`, *Volume gating and the reapplication doctrine*: LOOKFANTASTIC, Very and iHerb
declined on traffic volume, and **the correct response in every volume-gated case is the same — do not
re-approach on spec; let traffic and tracked transactions accumulate, then reapply with proof.**

> **THE DISTINCTION THAT MATTERS IS STRUCTURAL VERSUS VOLUME, AND IT IS THE ONE THAT DECIDES WHETHER
> WAITING IS A PLAN.** A group-level policy refusal does not improve with traffic and re-approaching is
> wasted. **A volume gate improves with exactly the thing the project is already doing**, so there is
> nothing to do here and that is the answer rather than the absence of one.

**THE ANSWER IS A DIRECT RELATIONSHIP AND THE ROUTE TO IT IS ALREADY OPEN.** Nothing about the Amazon
finding changes the approach; it removes the shortcut.

### Status vocabulary — a fifth value, named rather than absorbed

**`declined-volume-gated` was added to the status table above on 1 September 2026, taking this file
from four values to five.** The four it joins — `approved-pending-integration`, `parked`, `live`,
`links-only` — **all describe a relationship that was *granted*. This one was not**, and that is the
gap it fills rather than a shade of an existing value.

**Filing it as any of the four would have been wrong in a way that matters:**

- `approved-pending-integration` — **false.** Nothing was approved.
- `parked` — **the dangerous one.** It reads as *ours to un-park*, and it is not; the gate is theirs.
- `links-only` — **false.** That is a granted placement without a feed. This is no placement at all.

> **AND IT IS A CLEARABLE STATE WITH A REAL TRIGGER, WHICH IS WHY IT IS A STATUS AND NOT A NOTE.**
> Item 458 refused `approved-pending-integration` for Optimum Nutrition because it *"would create a
> queue entry that can never clear, which is how a register starts lying."* **This entry has the
> opposite property**: the reapplication doctrine gives it a named condition and a named event.
>
> **THE CONTRAST WITH 458 IS WHAT MAKES THIS A DECISION RATHER THAN AN EXCEPTION.** The same test was
> applied to both and returned opposite answers — *can this state ever clear?* — so the vocabulary
> grew here for the reason it did not grow there, rather than in spite of it.

**They are a brand, not a retailer, and this file says so about itself** — the same mismatch item 458
named for Optimum Nutrition, recorded here for the same reason: **so the first brand-side decline does
not read as a retailer that failed onboarding.**
