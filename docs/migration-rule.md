# How schema changes are applied

**Work-list item 235, Option A. In force from 21 August 2026.**

## The rule

> **Apply the migration, then write the local file named with the version the tool returned —
> in the same change.**

```
apply_migration(name: "my_change", query: "...")   ->  registers version 20260821170949
                                                        ↓
supabase/migrations/20260821170949_my_change.sql   <-  write this, same change, same SQL
```

The filename version **must** be the version the ledger recorded. Not the time you started, not
a rounded timestamp — the returned value. That equality is the entire point: it is what lets the
file and the ledger entry be recognised as the same change by something other than a human
reading both.

## Why this and not `supabase db push`

`db push` is the better end state and **is not available**. Local and remote histories diverged
long ago — 117 local files with no ledger entry, 125 ledger entries with no file — so `db push`
would attempt 117 migrations against a database that already has their effects.

Making it available needs `supabase migration repair --status applied` over those 117, which
**declares them applied when the ledger cannot show that.** Sampling says it is probably true.
*Probably* is what item 75 exists to object to. So that decision travels with the reconciliation
job (item 235, step 3), not with this rule.

**Do not run `supabase db push` or `supabase migration up` on this repository.**

## Why the rule is worth following on its own

It asserts nothing false and it needs nobody to schedule anything. What it buys is that the
divergence **stops growing**, which turns the eventual reconciliation from an open-ended cleanup
into a bounded one — **117 and 125, fixed**, rather than a number that rises with every change.

## It is checked, because a habit is not a mechanism

`scripts/migration-ledger-check.mjs`, weekly via `.github/workflows/migration-ledger-check.yml`.
Item 232 is the evidence for why the check exists rather than the rule alone: *the lessons were
more present each time, and failed faster each time.*

The check reports a **finding** only for a divergence absent from
`supabase/migrations/.ledger-divergence-baseline.json`. The 117 and the 125 are frozen there by
version and reported as **coverage**, which never escalates — the check must not fail on the
backlog it was built to stop growing.

## Two practical notes

**Verify the transcription rather than trusting it.** After writing the file, compare it against
what was actually applied:

```sql
select md5(statements[1]) from supabase_migrations.schema_migrations where version = '<version>';
```

against `printf '%s' "$(cat <file>)" | md5 -q` — the file carries a trailing newline the stored
statement does not. Equal hashes mean the file *is* the applied change, which is a stronger
claim than having been careful.

**Patch large objects, do not restate them.** To change a big existing function, have Postgres
read its own `pg_get_functiondef`, replace exact substrings and re-execute, refusing to run if an
anchor is missing. Restating a multi-thousand-character body by hand risks a transcription error
with no diff and no artefact. See migration `20260821164312` for a worked example, and
`.github/workflows/deploy-edge-function.yml` for the same reasoning applied to edge functions.
