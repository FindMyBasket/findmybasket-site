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

**Not a state, but a consequence to expect:** the retailer's price rows **go stale and should**.
Staleness after a departure is the correct outcome, not a defect — but it makes reactivation a
re-import plus a re-match rather than one flag, so a departure that might be reversed should be
decided quickly rather than left ambiguous.

---

## Which of the three satisfy it today

| | Superdrug | Branded Beauty | Atelier De Glow |
|---|---|---|---|
| **1** `active = false` | ✅ | ✅ | ✅ |
| **2** import config disabled | ❌ **`enabled = true`** | ✅ | ❌ **`enabled = true`** |
| **3** scheduler stopped | ⚠️ **no job exists** | ✅ inactive | ❌ **ACTIVE, 07:47 nightly** |
| **4** gone-set non-empty | ✅ 20,849 | ✅ 1,821 | ✅ 59 |
| **5** redirects curated | ✅ 54 | ✅ 22 | ❓ **0, and never assessed** |
| **6** terms NULL + reason | ❌ no reason | ❌ no reason | ✅ |
| **Last import** | 19 Jul | 1 Aug | **23 Aug** |

> **NONE OF THE THREE SATISFIES ALL SIX.** Branded Beauty comes closest at four.
>
> **And they fail in different places**, which is the evidence that each was done from memory
> rather than from a list.

---

## ⚠️ THE LIVE HAZARD: SUPERDRUG IS HELD OFF BY AN ABSENCE, NOT BY A SETTING

`retailer_import_config.enabled = true` for Superdrug (r12). **Nothing is scheduling it — the
GitHub workflow is `refresh-superdrug.yml.disabled` and there is no `cron.job` row.**

> **THE IMPORT IS STOPPED ONLY BECAUSE NOTHING IS CALLING IT. THE MOMENT ANYONE ADDS A JOB — OR
> RENAMES THAT WORKFLOW BACK — IT RESUMES, AND NOTHING WOULD OBJECT**, because the config says it
> is enabled and the config is what the importer reads.
>
> **State 3 is satisfied by absence and state 2 is not satisfied at all.** An absence is not a
> setting: it holds until someone adds something, and adding things is normal work.

**One flag closes it** — `UPDATE retailer_import_config SET enabled = false WHERE retailer_id = 12`.
**Deliberately not done tonight.** It belongs with this definition rather than ahead of it: applied
alone it fixes one instance and leaves the class, and the point of writing the six states is that
the next person applies all of them without having to rediscover which matter.

---

## Open, and not decided here

- **Is Atelier's departure meant to be reversible?** It is the only one still importing, so it is
  the only one where the answer is currently cheap. That is a business decision, not a data one.
- **Was Atelier's `REDIRECTS` skipped or found unnecessary?** 59 orphans exist and no GSC read is
  recorded. State 5 permits "none needed" as an answer — but only as a *recorded* answer.
- **Should `dq_snapshot` scope to active retailers?** See item 259. It is not obviously yes.
