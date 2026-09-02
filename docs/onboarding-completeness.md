# What a completed onboarding looks like

**Written 2 September 2026, work-list items 552 and 555. THIS IS A DEFINITION AND A MOVE, NOT A
CHANGE.** No retailer, config row or column was touched. The four records below were **moved** from
`docs/partnership-tracker.md` rather than copied, so nothing exists in two places and that file keeps
its own rule intact.

---

## Why it did not exist before

**Four retailers have arrived — three of them this month — and each reconstructed the sequence.**

`docs/departure-completeness.md` was written on 23 August for the mirror-image reason: three retailers
had departed, *"each invented its own shutdown"*, and there was no statement for reality to diverge
from. **The same was true of arrivals and nobody had said so.**

> **THERE IS NO PLACE WHERE AN ONBOARDING STARTS.** A departure has a document. An arrival had a
> tracker entry describing the *relationship*, a work-list item describing the *decision*, and a
> sequence that existed only in whoever had done the last one.

**The disagreement between the four is the content**, exactly as it was for the three departures. It is
stated below rather than smoothed, because a definition that hides where its instances diverge is a
definition nobody can check.

### Why here, and not the two places first proposed

**Not a retailers section in the work list.** That file is the register of *work*; these are records of
work **completed**. It runs to 555 items with integrity checks that test numbering rather than content,
so four entries would be findable only by grep — **which is how the tracker drifted in the first
place.**

**Not a plain onboarding-record document.** That is the same thing minus the framing. The departure
document's value is not that it stores three shutdowns; it is that it states **what "done" means**, so
a fourth can be checked against it.

> **A RECORD FILE WITHOUT A DEFINITION IS AN ARCHIVE. WITH ONE IT IS A RUNBOOK THAT HAPPENS TO CARRY
> ITS EVIDENCE.**

---

## The six states

A completed onboarding should be in **all six**. Each names the thing it prevents.

| # | State | Prevents |
|---|---|---|
| **1** | **Feed census read, not counted** — column fill, row count, and the product *names* read | A range that cannot be compared in principle passing an overlap threshold. Item 223 rejected Cohorted on the names after the overlap figure alone was ambiguous: *0% overlap says "products we cannot compare today"; the names said "products that cannot be compared in principle".* **A count cannot tell a flavour matrix from a subscription box.** |
| **2** | **Delivery terms with `delivery_terms_source` recorded** | A threshold with unverifiable provenance. Item 160: **ten of eleven retailers** had terms nobody could trace. The source is the record, not the number. |
| **3** | **The allowlist value verified against the feed, and what makes it wrong stated** | Reporting confidently on the wrong retailer. A wrong AWIN `fid` **does not fail loudly** — the account can see many feeds, so it downloads a different advertiser's and every figure is confidently mislabelled. Item 482: *a confirmation is not a verification.* |
| **4** | **A dry run whose classification is read by name** | A silent misfile. Counts agree while `Body Care` holds collagen capsules and a toothbrush (item 322). |
| **5** | **`retailer_import_config` written inert — `enabled = false` — before any import** | Harvesting and publishing becoming one act. The config exists, is reviewable, and does nothing until someone decides it should. |
| **6** | **`retailers.logo_path` present before `active` flips** | A retailer counted in the headline and not pictured in the strip. `getListedRetailers` counts on `active AND unlisted_reason IS NULL`; the logo is a separate column and a separate act. |

---

## Which of the four satisfy it — VERIFIED 2 SEPTEMBER 2026 against the database

| | Niche Beauty | MyProtein | Healf | The Fragrance Shop |
|---|---|---|---|---|
| `active` | ✅ | ✅ | ✅ | ✅ |
| logo present | ✅ | ✅ | ✅ | ✅ |
| delivery terms | ✅ 9.95 / 75 | ✅ 4.49 / 55 | ✅ 3.99 / 50 | ✅ 3.49 / 40 |
| **2** `delivery_terms_source` | `checkout` | `site` | free text | free text |
| `delivery_terms_note` | ❌ | ✅ | ❌ | ✅ |
| **5** config `enabled` | true | **false — deliberate** | true | true |
| `feed_format` | awin | awin | **awin** | rakuten |
| live priced rows | 9,422 | 609 | 4,986 | 3,199 |

**No column is uniform across all four except `active` and the logo.**

---

## Where they disagree — STATED, NOT RESOLVED

**Four disagreements. Each marks a place the definition above is uncertain, and none is corrected
here** — correcting them is a change, and this document is a definition and a move.

### A. `delivery_terms_source` has four shapes and is not a vocabulary

```
Niche Beauty        checkout
MyProtein           site
Healf               "both — read on healf.com and confirmed at checkout, Robbie 28 Aug 2026"
The Fragrance Shop  "both — read on thefragranceshop.co.uk and confirmed at checkout, Robbie 31 Aug 2026"
```

**Two are enum-like tokens and two are sentences carrying a person and a date.** The prose ones are
*better provenance* — they record who checked and when, which is what item 160 was actually asking for
— and they are unqueryable. **The column is doing two jobs and neither well.**

> **THE STRONGER RECORD IS IN THE WEAKER FORM**, which is the opposite of the usual drift and the
> reason this is a disagreement rather than a defect: the fix is not to flatten the sentences back to
> tokens.

### B. Two of the four carry no `delivery_terms_note`

MyProtein and The Fragrance Shop have one; Niche Beauty and Healf do not. **The departure definition
requires a note when the source is NULL.** Nothing states what an *arrival* owes, and the two without
one are the two whose source is a bare token — **so the row with the least provenance also carries the
least explanation.**

### C. MyProtein is live with its importer disabled, and that is correct

`enabled = false` on a live retailer looks like state 5 left unfinished. **It is item 324's guard:** a
second import would create **177 near-duplicates** (item 314's leak), so the flag is held deliberately
and a trigger enforces it.

> **STATE 5 SAYS "INERT BEFORE THE FIRST IMPORT". MYPROTEIN IS INERT AFTER IT.** The same value means
> two different things at two points in the sequence, and the definition above cannot tell them apart.
> **A check reading `enabled` alone would score this retailer as incomplete and be wrong.**

### D. Healf's `feed_format` is `awin`, and its record says Google Shopping

The moved record below argues at length that Healf is a **Darwin / Google Shopping** feed — that this
is why `fid=521` returned 404, and why `feed-diag.yml` could not read it. **The live config says
`awin`.**

**Not resolved here.** Either the plan changed during onboarding and nothing recorded it, or the config
is wrong. **Both are worth knowing and this document cannot tell which** — the point of stating it is
that the record and the database disagree and neither knows.

---

## ★★ THE HEALF RECORD IS A PLAN THAT WAS OVERTAKEN, NOT A WORKED RECORD

**It is carried as what it is.** Its own text says *"NOT ONBOARDED — recorded before any work"* and
closes *"Nothing is configured. Nothing is imported. No retailer row exists."*

**Healf is live with 4,986 priced rows.**

> **THE ENTRY DID NOT GO STALE IN ITS STATUS LINE. ITS ENTIRE BODY DESCRIBES A WORLD THAT NO LONGER
> EXISTS**, in the present tense, with emphasis. It is the most detailed of the four and the most
> wrong, and the detail is what makes it convincing — item 545's finding arriving in a second file:
> *"an absent item invites the question; a present one that describes it in detail forecloses it."*

**It is still the most valuable of the four**, because everything it specifies — the Darwin URL as a
GitHub secret, the `storage://` pointer so the credential never touches the database, counting empty
`aw_deep_link` rows rather than inferring them — is reusable at the next onboarding. **What is not
reusable is its final paragraph.**

---

# The four records, as moved

*Moved verbatim from `docs/partnership-tracker.md` on 2 September 2026. Status lines are corrected to
`live` — all four satisfy the tracker's own definition — and nothing else in them is edited, including
the statements now known to be false. **They are records of what was believed at the time**, and
rewriting them would destroy the disagreement this document exists to state.*

---

## The Fragrance Shop — `live`

> **MOVED from `docs/partnership-tracker.md`, 2 September 2026 (item 555). Status corrected from ``approved-pending-integration`, `parked`` to `live`; nothing else edited.**

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

## Niche Beauty — `live`

> **MOVED from `docs/partnership-tracker.md`, 2 September 2026 (item 555). Status corrected from ``approved-pending-integration`, `parked`` to `live`; nothing else edited.**

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

## MyProtein — `live`

> **MOVED from `docs/partnership-tracker.md`, 2 September 2026 (item 555). Status corrected from ``approved-pending-integration`` to `live`; nothing else edited.**

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

## Healf — `live`

> **MOVED from `docs/partnership-tracker.md`, 2 September 2026 (item 555). Status corrected from ``approved-pending-integration`` to `live`; nothing else edited.**

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
