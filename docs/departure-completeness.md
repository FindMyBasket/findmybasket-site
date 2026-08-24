# What a completed departure looks like

**Written 23 August 2026, work-list items 257–259. THIS IS A DEFINITION, NOT A CHANGE.**
Nothing here was applied. It exists so that the fourth departure is cheap, and so that the
disagreement between the first three can be *stated* rather than only noticed.

---

## Why it did not exist before

Three retailers have departed. **Each invented its own shutdown**, and they disagree:

> **There is no shared "stop the feed" step that either succeeded or failed. There is no
> definition of "off" for a check to compare against — which is why nothing can report the
> disagreement, and why Atelier could keep importing nightly for weeks with nothing objecting.**

A missing step gets caught by a runbook. **A missing definition cannot be caught by anything**,
because there is no statement for reality to diverge from.

---

## The six states

A departed retailer must be in **all six**. Each names the thing it prevents.

| # | State | Prevents |
|---|---|---|
| **1** | `retailers.active = false` | Offers rendering. Removes its products from `products_active`, the sitemap and `getRetailerOffers`. |
| **2** | `retailer_import_config.enabled = false` | The feed continuing to arrive. **This is the config-level stop and it is the one most often missed**, because nothing visible changes when it is left on. |
| **3** | Scheduler stopped — `cron.job.active = false`, or the GitHub workflow disabled | The importer being *invoked*. **Absence of a scheduler is NOT this state** — see the hazard below. |
| **4** | Gone-set generated **before** the flip and non-empty | Orphaned URLs 404ing instead of 410ing. Must be generated on the day: `regen-gone-ids.mts` selects products with a live active-retailer row, so **after the flip it cannot be reconstructed** (item 254). |
| **5** | `REDIRECTS` curated from a GSC read, **or an explicit finding that none is needed** | Click-bearing orphans losing their equity. Every target must have products in `products_active` **after** the flip — a live 200 today is a false green. |
| **6** | `delivery_terms_source = NULL` **with a reason in `delivery_terms_note`** | A stale threshold looking maintained. We no longer send anyone to the site, so re-reading terms records provenance for a figure nobody can act on (item 257). |

---

## THE DEFINITION COVERS PRODUCT URLs. IT DOES NOT COVER BRAND URLs.

**Added 24 August 2026, work-list item 291. A GAP, NOT A STATE — stated here rather than numbered,
because numbering it would imply the three departures below can be scored against it, and they
cannot: it was not in the definition when they ran.**

State 4 generates a gone-set of PRODUCT ids. `middleware.ts` matches
`['/product/:path*', '/account/:path*', '/ops/:path*']`, so **the orphan gate never sees
`/brands/`**. A departed retailer's brand hubs simply 404:

```
/product/5289   Technic Gloss Balm Berry Nice   →  410 Gone
/brands/technic                                 →  404 Not Found
```

**406 brand hubs are orphaned by Superdrug's departure alone** — 93.8% of the 433 brands with rows
in `products` and none in `products_active`. They left the sitemap automatically on 19 July
(`fmb_active_brand_names()` reads `products_active`), so nothing announced them.

**All three departures pass all six states and all three left this behind.** The scorecard is
accurate; the definition was short. **A definition is a list of the routes someone thought of, and
its completeness is asserted against itself.**

### If a brand gone-set is added, slugs are not ids

- **A slug is DERIVED and shared across retailers.** Superdrug carried 1,323 brands and **913 are
  still live elsewhere.** A gone-set built from "brands the departed retailer carried" would 410
  913 live hubs. A gone slug also goes wrong later, whenever any other retailer starts carrying
  that brand. Product ids have neither property.
- **`brand_aliases` already claims this namespace** — REDIRECTS must take precedence over a brand
  gone-set, as it does over `GONE_IDS`.
- **Unlike state 4, the brand set CAN be rebuilt after the flip**, because price rows survive
  deactivation. Verified for Superdrug on 24 August. **That is luck, not design.**
- The gate's existing rule decides membership: *a 410 claims a URL had content and lost it.* A
  departed hub had a grid and lost it; a brand that never had live products keeps its 404.

### The 410 is HELD, and the condition is checkable

**Not applied, and not deferred.** State 1's rule — a departure is permanent because someone
external decided — is not satisfied for Superdrug. **Checked 19 August 2026: their affiliate page is
a holding page with no active programme on any network.** That reads as *between networks* rather
than *exited*.

> **The external decision was to close a programme, not to stop existing.** Nobody has decided
> whether Superdrug returns. A 410 claims permanence; what exists is the absence of a programme.

| | |
|---|---|
| **Trigger** | **Superdrug's affiliate page names a network** |
| **Then** | 8,664 rows and 406 hubs return with them |
| **Until then** | **404** — the weaker signal, and the correct one |

**A watch item, not a check.** Nothing in our data changes when a retailer rejoins a network; the
evidence is a page on someone else's site. Calling it a check would be an overclaim.

**This is the reversibility answer this document states for Atelier and could not state for
Superdrug.** It is now stated: *unknown, with a named trigger* — which is a different answer from
Atelier's *final*, and the difference is what holds the 410.

---

**Not a state, but a consequence to expect:** the retailer's price rows **go stale and should**.
Staleness after a departure is the correct outcome, not a defect — but it makes reactivation a
re-import plus a re-match rather than one flag, so a departure that might be reversed should be
decided quickly rather than left ambiguous.

---

## Which of the three satisfy it — VERIFIED 24 AUGUST 2026, AFTER THE SIX-STATE PASS

| | Superdrug | Branded Beauty | Atelier De Glow |
|---|---|---|---|
| **1** `active = false` | ✅ | ✅ | ✅ |
| **2** import config disabled | ✅ | ✅ | ✅ |
| **3** scheduler stopped | ✅ | ✅ | ✅ |
| **4** gone-set non-empty | ✅ 20,849 | ✅ 1,821 | ✅ 57 |
| **5** redirects curated **or explicitly unnecessary** | ✅ 54 curated | ✅ 22 curated | ✅ **explicit finding: none needed** |
| **6** terms NULL + reason | ✅ | ✅ | ✅ |
| Last import | 19 Jul | 1 Aug | **23 Aug — final** |

> **ALL THREE SATISFY ALL SIX. Measured against the database and the repository after the pass,
> not asserted.**

**This table is the point of the document.** Before it existed the three departures disagreed in
three different places and **nothing could report the disagreement, because there was no statement
for reality to diverge from.** The scorecard is now a thing a check could run.

### What the pass changed, 24 August 2026

| Retailer | Change |
|---|---|
| Superdrug | `import_config.enabled` **true → false**; terms reason written |
| Branded Beauty | terms reason written |
| Atelier De Glow | `import_config.enabled` **true → false**; cron job 32 **disabled** |

**Superdrug's flag was the substantive one.** It had been held off by an *absence* — no cron row,
GitHub workflow renamed `.disabled` — rather than by a setting, and `enabled = true` is what the
importer reads. **An absence holds until someone adds something, and adding things is normal work.**

### State 5 for Atelier, closed by finding rather than by curation

**Zero of Atelier's 57 orphans appear in the GSC export** — no clicks, no impressions. There was no
equity to preserve, so **the zero redirects were a correct decision rather than an omission.**

**Corroborated independently**: the Amazon harvest found only **2 of Atelier's 553 products** in
search at all, and the retailer onboarded **16 July** with a Korean-specialist catalogue. **Two
methods, one conclusion** — a departure too recent and too niche to have accumulated search equity.

**The bound, as always:** the export caps at 1,000 rows and bottoms out at 1 impression, so absence
means **effectively no search performance rather than provably none.**

## Open, and not decided here

- ~~Is Atelier's departure meant to be reversible?~~ **ANSWERED 24 Aug: not expected to return.
  The departure is final**, which is what made the pass safe to run — staleness is only a cost if
  reactivation is on the table.
- ~~Was Atelier's `REDIRECTS` skipped or found unnecessary?~~ **ANSWERED: found unnecessary, and
  now recorded as such.** See above.
- **Should `dq_snapshot` scope to active retailers?** See item 259. It is not obviously yes.
