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

## Four entries moved out — 2 September 2026

**The Fragrance Shop, Niche Beauty, MyProtein and Healf are `live` and have left this file**, which is
what the vocabulary above says a live retailer does. Their onboarding records — the feed analysis, the
stage log, the three-part pre-onboarding sequence — are in **`docs/onboarding-completeness.md`**, which
also extracts the definition they were the evidence for.

**Moved rather than deleted.** The rule that a live entry leaves the file was written when an entry was
a status line; these four carry the reasoning that made the last three onboardings faster than the
first. **They are not in two places** — this is a pointer, not a copy. Work-list items 552 and 555.

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
