# Migration conventions

Rules established the hard way. Each one exists because breaking it produced a
change that looked correct, ran without error, and did not do what it said.

---

## 1. Always include `PUBLIC` in a `REVOKE`

```sql
REVOKE EXECUTE ON FUNCTION public.fn(jsonb) FROM PUBLIC, anon, authenticated;
--                                               ^^^^^^ not optional
```

Postgres grants `EXECUTE` to `PUBLIC` on **every** new function. When a function
also carries an explicit `anon=X` grant, anon holds EXECUTE by two independent
routes. `REVOKE ... FROM anon, authenticated` removes one, leaves the other, and
raises no error.

Worse, the obvious check agrees that everything is fine:
`has_function_privilege('anon', ...)` **still returns true**, because it rolls
`PUBLIC` up into every role's answer.

**Verify by reading `proacl` directly.** The leading `=X/` element *is* the PUBLIC
grant:

```
{=X/postgres,postgres=X/postgres,anon=X/postgres,...}
 ^^^^^^^^^^^ PUBLIC
```

Secured looks like `{postgres=X/postgres,service_role=X/postgres}`.

For tables, `PUBLIC` is currently a no-op — Postgres grants nothing on new tables
to PUBLIC. Include it anyway, so that every `REVOKE` in this codebase has the same
shape and the habit does not decay.

**This rule is permanent for functions.** `ALTER DEFAULT PRIVILEGES` cannot retire
it: Postgres re-merges the built-in `acldefault()` on object creation, and for
functions that includes EXECUTE to PUBLIC. Verified empirically — see
`20260728100000_default_privileges_lockdown.sql`. Every new function in `public`
is born anon-executable no matter what the default ACL says.

---

## 2. Use type-only signatures for `regprocedure`

```sql
'public.fmb_watchdog_stalled_imports(integer, integer, boolean)'::regprocedure  -- works
'public.fmb_watchdog_stalled_imports(p_stale_minutes integer, ...)'::regprocedure  -- ERROR
```

The `regprocedure` cast rejects parameter names. Write types only.

---

## 3. Never let a migration compute its own scope

A migration's job is to reproduce a **known** state. A migration that derives its
own target list behaves differently on every replay, which is exactly wrong.

```sql
-- WRONG: matches whatever exists at replay time
FOR t IN SELECT relname FROM pg_class
         WHERE relrowsecurity = false AND relacl::text LIKE '%anon=%'
LOOP EXECUTE format('REVOKE ALL ON %I FROM anon', t); END LOOP;

-- RIGHT: can only ever affect the objects this migration audited
tables text[] := ARRAY['public.fuzzy_scan_hits', 'public.fuzzy_scan_base', ...];
```

The dynamic version looks tidier and is a trap. Replayed on a PITR restore or a
fresh branch, it revokes on whatever matches **then** — silently including tables
added later that legitimately need anon `SELECT`. The failure is invisible: no
error, just a feature that stopped working for reasons nobody can trace back to a
migration written months earlier.

An explicit list is auditable, diffable, and bounded to what was actually
reviewed. Skip absent objects rather than failing, so the migration stays correct
once those objects are eventually dropped:

```sql
BEGIN
  tbl_oid := tbl::regclass::oid;
EXCEPTION WHEN undefined_table THEN
  CONTINUE;  -- expected once these are dropped, not an error
END;
```

The same applies to any privilege, backfill, or cleanup migration, not just
revokes.

---

## 4. Assert, do not assume

Every migration in this directory that changes privileges re-reads the catalogue
afterwards and raises if the result is not what was intended. The failure mode
being defended against is a statement that succeeds and does nothing.

- Read `relacl` / `proacl`, **not** `has_table_privilege` / `has_function_privilege`
  — both roll `PUBLIC` up and report success on an object that is still open.
- Assert the things that must **not** change too. Privilege migrations here assert
  `service_role` retained access, because losing it breaks the feed importers, and
  assert RLS state is unchanged, because enabling RLS is a separate decision with
  its own test plan.

## 5. Migrations must be idempotent, and proven so

Run it twice before shipping. Privilege state exists only in the database, so a
PITR restore or a new branch replays everything; a migration that is not
re-runnable turns a restore into an outage.

Dry-run against production without risk — the management API supports
transactions:

```sql
BEGIN;
  -- the whole migration, pasted twice
ROLLBACK;
```

## 6. A clause is only protective if the thing it names exists

```sql
-- WRONG: silently does nothing. There is no unique constraint to conflict on,
-- so no conflict ever arises and every row inserts again on replay.
INSERT INTO platform_changes (...) VALUES (...) ON CONFLICT DO NOTHING;

-- RIGHT: name the constraint's columns, and make sure the constraint exists.
ALTER TABLE platform_changes ADD CONSTRAINT platform_changes_title_uniq UNIQUE (title);
INSERT INTO platform_changes (...) VALUES (...) ON CONFLICT (title) DO NOTHING;
```

`ON CONFLICT DO NOTHING` with no conflict target is valid SQL, raises nothing, and
guards nothing. It reads as protective, which is worse than reading as absent.
Caught in `20260728180000_dashboard_schema.sql` only because convention 5 is
mandatory: on a PITR replay it would have duplicated every row in
`platform_changes`, the one table whose entire job is to be the trustworthy record
of when metrics changed.

**This shape has now appeared five times in a fortnight.** The pattern is a
statement that is syntactically valid, semantically reasonable, and enforces
nothing, where the obvious check agrees it worked:

| Written | What it actually did |
|---|---|
| `GRANT SELECT ON <table> TO anon` | Restricted nothing. The default ACL already granted ALL, and a GRANT is additive. |
| `REVOKE EXECUTE ... FROM anon, authenticated` | Left the PUBLIC grant. `has_function_privilege` still returned true. |
| `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` | Updated `pg_default_acl` correctly and changed nothing: `acldefault()` is re-merged at creation. |
| `ON CONFLICT DO NOTHING` | Deduplicated nothing, because the named conflict did not exist. |
| `scripts/gtag-stub.test.mjs` | Checked nothing. It was written, it passed, and no runner ever executed it. See convention 8. |

The generalisation: **an additive or defensive clause never fails loudly when it is
a no-op.** Only reading the resulting state proves it did something. Conventions 4
and 5 are how you read it — assert against the catalogue, and run it twice.

## 7. Explain *why* in the migration, not just what

The SQL says what changed. Only the header can say which assumption was wrong,
what was verified before running it, and what must not be "simplified" later.
Several files here carry a "do not "fix" this by ..." note that has already
prevented a regression.

---

## 8. A check that does not run is not a check

`scripts/gtag-stub.test.mjs` was written to cover the consent gate, the queue
bound and the replay. It passed. Nothing ever ran it: `npm test` was scoped to
`lib/**/*.test.ts`, and no workflow invoked it. It sat in the repository for
days as evidence that the riskiest file in the consent path was tested, while
testing it exactly as much as an empty file would have.

**A test that is not executed is worse than one that was never written**, for
the same reason a `REVOKE` that revokes nothing is worse than no `REVOKE`: it
carries the reassurance without the check, and it is the reassurance that stops
anyone looking again.

These conventions live in the migrations directory because that is where the
pattern was first catalogued, but this one is not about migrations. It applies
to any artefact whose whole purpose is to fail when something is wrong:

- **Tests.** Confirm the runner's glob actually matches the file. Add a test
  that fails, watch it fail in CI, then fix it. A passing suite proves the
  assertions hold; only a failing one proves they are read.
- **Assertions inside migrations** (conventions 4 and 5). Run the migration
  twice, and make one assertion fail on purpose the first time you write it.
- **Guards, alerts and watchdogs.** A monitor that has never fired is
  indistinguishable from a monitor that cannot fire. The Boots 04:30 watchdog
  was blind to never-started runs for exactly this reason.

**The generalisation across all five rows of the table above:** every one of
them was verified by asking a question whose answer was already yes.
`has_function_privilege` rolled PUBLIC up and said "granted". A green test run
said "passing" about files it never opened. **Verify by reading the resulting
state, not by re-asking the tool that produced it** — read `proacl`, count the
rows the runner actually executed, check the glob.

