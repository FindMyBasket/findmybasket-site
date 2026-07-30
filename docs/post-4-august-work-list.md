# Post-4-August work list

**Created:** 30 July 2026.
**Gate:** the Boots absence step-down decision, 4 August 2026. Nothing here starts before it.

> **This list is a correction, not a routine artefact.** It was created because the
> queue it records was being recited from memory across several days and **four of
> its six items existed nowhere in this repository** — not in a doc, a ticket, a
> migration comment or a commit message. A grep for the claims returned nothing.
>
> That is the absent-record class in `supabase/migrations/README.md` convention 9:
> a record believed to exist because discussing it at length produces the same
> familiarity as having written it. Nothing surfaces its absence, because there is
> no artefact to go stale.
>
> **Treat this file as the register from now on.** If an item is discussed and not
> written here, it does not exist.

## How to use this file

- **Every item carries a date and a reason it is blocked**, not merely the fact
  that it is. "Blocked until 4 August" without a why decays into "blocked" and
  then into nobody knowing whether it still is.
- **Boundaries are not tasks.** A dated change that moves a metric belongs in
  `platform_changes`. A piece of work belongs here. Two of the things in this
  queue are already boundaries; they are *referenced* below rather than copied,
  because duplicating them is how the register stops meaning one thing.
- **Items 1, 3, 4 and 5 have no detail in this repository.** They are recorded
  under the names they were given, with the detail marked as owed. That is
  deliberate: inventing a specification for them would reproduce the exact defect
  this file exists to correct. **The operator holds the detail; it needs writing
  down here before the work starts.**

---

## Tasks

### 1. Coalesce fix

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: OWED.** No occurrence of this item anywhere in the repository.

**Why blocked:** unknown until the detail is supplied. Recorded now so it is not
lost again; the blocking reason must be filled in before it is picked up.

---

### 2. Tier A drops

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: OWED.** The only repository match for "tier A" is `match_key tier A` in
`.github/workflows/feed-diag.yml:13`, which is about match-key tiers and is
**unrelated**. Do not read that as the record of this item.

**Why blocked:** presumed to touch the catalogue or the import path, which is what
the 4 August gate protects. Confirm before starting.

---

### 3. Memory reconciliation

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: OWED.** No occurrence anywhere in the repository.

**Why blocked:** unknown until the detail is supplied.

---

### 4. Standing rules

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: OWED.** No occurrence anywhere in the repository.

**Why blocked:** unknown until the detail is supplied. Note that brand and copy
standing rules are currently recorded only as a trailing paragraph in
`docs/dashboard-build-brief.md`; whether this item means consolidating those is
not established and should not be assumed.

---

### 5. `supabase_migrations` divergence: decide and record

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: complete.**

The Supabase migration history table stops at **`20260724102843`**. Every migration
since — the entire security remediation (#137–#140), the dashboard schema, all the
July `platform_changes` rows, the r12 brand-page boundary and the brand-norm check
— was applied via SQL rather than `apply_migration`, so **none of them is tracked**.

**Why blocked:** it is not urgent and it touches how the database would be
rebuilt, which is the wrong thing to change in the week before a decision that
rests on the database being stable.

**Why it matters:** in one scenario only. A PITR restore or a fresh branch replayed
through the CLI would replay up to 24 July and stop, silently omitting every
privilege revoke and every boundary row. The live database is correct; the
*reconstruction* path is not.

**Decision owed:** either backfill the history table to match the files, or record
deliberately that the files are the source of truth and the history table is not
used. Either is defensible. Leaving it undecided is the option that has already
been taken twice by default.

---

### 6. Record the bulk-`UPDATE` cost property

**Raised:** 30 July 2026 · **Blocked until:** after 4 August
**Detail: complete.**

**Any bulk `UPDATE` to `products` costs more than the touched columns imply.**
Two independent mechanisms, both verified 30 July 2026 by reading the catalogue:

1. **`search_vector` is a STORED generated column** (`attgenerated = 's'`) over
   `name`, `brand`, `product_type`, `description`. Postgres **recomputes a stored
   generated column on every row update, without dependency tracking** — so it
   re-runs `to_tsvector` even when none of its inputs changed, producing an
   identical value at full cost.
2. **`normalised_brand` is indexed** (`idx_products_match` leads on it), so an
   update touching it **cannot be a HOT update**. Index entries are rewritten
   across the table's indexes, including the GIN on `search_vector`.

**Trivial at 1,082 rows. Material at 100,000.** The outstanding case where this
would bite is the **cross-brand makeup-in-skincare sweep**.

**Why blocked:** it is documentation of a property, not a fix, and it belongs
alongside the sweep it affects rather than landing on its own before the gate.

---

## Referenced, not duplicated: these are boundaries, not tasks

Both are already recorded in `platform_changes` with their sequencing in the row
description. They are listed here so the queue is complete, and deliberately **not**
restated, because a boundary and a task are different things.

| Item | Where it lives | Why it is after 4 August |
|---|---|---|
| **AWIN `product_GTIN` importer fix** | `platform_changes` id 3, `expected` | On the import path. Must not go near a deploy before the step-down decision is settled. Also in the brief §12, out of scope. |
| **Niche Beauty retailer go-live** | `platform_changes` id 4, `expected` | Parked behind the AWIN `product_GTIN` fix, so necessarily after it. |

If either acquires work that is not the boundary itself, that work gets its own
entry above and the boundary row stays where it is.

---

## Not on this list, and deliberately so

**The `normalised_brand` backfill runs tomorrow, 31 July, not after 4 August.** It
is not blocked by the gate: it touches `products.normalised_brand` only, is 1,082
rows, does not go near the import path, and the recurrence check that watches it is
already installed and red. Sequence is in
`supabase/migrations/20260730140000_catalog_health_brand_norm_check.sql`: confirm
the 09:45 capture is red, backfill, confirm the next capture goes green.
