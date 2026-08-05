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

### The default-privileges fix, observed working on a real creation

Recorded 30 July 2026. `20260728100000_default_privileges_lockdown.sql` was
verified at the time against `pg_default_acl` and inside rolled-back
transactions. **On 30 July a table was created in `public` in the ordinary way,
outside any transaction, and its `relacl` read:**

```
{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
```

No `anon`, no `authenticated`, no `PUBLIC`. That is the intended shape, arrived at
without a `REVOKE` doing the work — the explicit `REVOKE ALL` in the same script
was a no-op, which is what success looks like here.

**Why this is worth a paragraph rather than a shrug.** Convention 8 says a guard
that has never been seen to fire is indistinguishable from one that cannot fire,
and the same doubt applies in the other direction: a fix verified only against
`pg_default_acl` and inside transactions that were rolled back had never been
watched doing its job on a real object that stayed. It has now. This is the
convention applied to itself.

**It does not extend to functions.** `acldefault()` is still re-merged on function
creation, so convention 1 stands unchanged and permanently. This paragraph is
about tables only.

*(This note is written before the migration that would have cited it. That
migration is deferred, and "record it when the natural moment comes" is how
several true observations in this project were lost — see convention 9. The
observation holds on its own; let the migration cite the convention rather than
the reverse.)*

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

### A guard observed firing, on the real case, 30 July 2026

Recorded because this convention is otherwise a catalogue of things that did not
work, and that is a misleading sample.

The absence handler in `20260721180000_absence_handling.sql` carries GUARD 1:
`last_import_status` is stamped `running` at apply-start and only `ok` at
finalisation, so a crashed run leaves `running` and is excluded. Its own comment
calls it "the single most important guard."

**On 30 July the case it was written for occurred for the first time.** YesStyle's
29 July import stalled at `running` and never finalised; the 30 July run did not
start; the last real data was 28 July 10:03, 45.8 hours earlier. Without the
guard, absence handling would have read 13,389 rows as unseen and flipped them out
of stock on a crashed run's evidence — emptying most of a retailer's catalogue
from the comparison, on the authority of an import that never happened.

**It held. The rows were not flipped, and the stall stayed contained to the one
retailer.**

Two things worth taking from it:

- **A guard whose failure mode is invisible needs its success recorded too.**
  Nothing would have announced that GUARD 1 worked. There is no log line, no
  metric, no alert. It was noticed only because a stalled retailer was being
  investigated for an unrelated reason, and it will not be noticed next time
  either. This paragraph is the only record that it has ever fired.
- **It is evidence for the guard, not for the design around it.** The stall itself
  went 45.8 hours without anything raising it, and was found by hand. A guard
  that correctly declines to act on bad data is not a substitute for noticing
  that the data is bad.

### The mirror: a guard that fires WRONGLY

This convention is about a check that cannot fail. Its mirror is a check that
fails when nothing is wrong, and it is not the lesser problem.

Recorded 30 July 2026, from `20260730140000`. An assertion meant to prove a
function was not executable by `PUBLIC` was written as:

```sql
IF v_acl LIKE '%=X/%' THEN RAISE EXCEPTION ...   -- WRONG
```

It raised against a **correctly secured** function, because `%=X/%` also matches
`postgres=X/postgres` and `service_role=X/postgres` — the grants that are supposed
to be there. The PUBLIC grant is the element with an **empty grantee**, so the
test is a leading `'{=X/'` or a `',=X/'` after a comma. Convention 1 has the
grammar; it was not read carefully enough before the guard was written.

**A guard firing on a false positive is as dangerous as one that never fires, and
worse in one specific way.** Both end in a check nobody trusts, which is the same
outcome. But silence merely fails to inform. **A false positive actively trains
people to ignore the check** — it produces a red that everyone learns is
meaningless, and the habit of dismissing it survives long after the guard is
fixed. The next red, the real one, is dismissed by reflex.

So the discipline is symmetrical, and both halves are required:

- **Prove it BITES** — against a state you have deliberately broken (convention 6).
- **Prove it PASSES** — against the state you believe is correct.

A guard that has only been seen to fire is not known to be a guard either. Both
proofs are cheap, both belong in a rolled-back transaction, and running only the
first is how an over-broad predicate ships looking rigorous.

---

## 9. Anything phrased as pending carries the date it was written

**Every block phrased as pending, awaiting, open, recommended, not yet done, or
gated must carry the date it was written**, in the same way every ticket carries
`**Raised:** <date>`. Without one, a reader cannot tell a claim made this morning
from one overtaken hours later, and the tense reads as current no matter how old
it is.

```markdown
**Awaiting a decision: an eighth boundary.**            <!-- how old? unknowable -->
**Awaiting a decision, 29 Jul: an eighth boundary.**    <!-- ageable on sight -->
```

This is the documentation form of convention 8. A stale pending block is an
artefact that carries reassurance without the check: it looks like an open
question under active management, and nothing anywhere verifies it still is.

**A pending heading is the most dangerous stale text there is, because it does
not merely mislead, it solicits.** A stale *finding* is believed. A stale
*"awaiting a decision"* invites a reader to go and make a decision that was made
days ago — re-running an applied migration, re-approving an approved change,
re-litigating a settled one. It converts a reader's diligence into rework.

**Eight instances in a fortnight**, all the same shape: true when written, stale
within hours, believed because nothing writes back.

| Written | Still true when read |
|---|---|
| "Awaiting a decision: an eighth boundary, real traffic start" | No. Applied as `platform_changes` id 21, status `occurred`. |
| "Recommended, not yet done: a sixth `platform_changes` row" | No. Applied as id 12, migration `20260729160000`. |
| "`outbound_clicks_other` ... NOT YET APPLIED" | No. Applied `20260729120000`, and the same file's progress log said so. |
| "Open bug, reported not fixed" | No. Fixed the same day by PR #146. |

Three of those four sat in one file, which also recorded their resolution
elsewhere in itself. **A document that contradicts itself was updated by someone
who searched for the section they were changing, not for the claim they were
falsifying.**

Two habits follow, and the second is the one that would have caught all four:

1. **Date it when you write it.** A dated claim decays visibly. An undated one
   does not decay at all, it just stops being true.
2. **When a pending thing resolves, grep the repository for the claim, not for
   the file you were working in.** Applying the migration is not the end of the
   change; the sentence that says it has not been applied is part of the change.

### Which action: delete or retitle

Never annotate in place. A struck-through or "RESOLVED" pending heading still
reads as pending to anyone skimming headings, and headings are what get skimmed.
So the block either goes or is retitled — and the rule above does not tell you
which. This does:

**Delete a stale REQUEST. It carries no reasoning, only a solicitation.** Once
the thing has been decided, applied or built, nothing in the block is worth
reading. Every remaining word is an invitation to do it again.

**Retitle a stale FINDING that still justifies something live.** Deleting it
removes the argument for a rule still in force and leaves the rule looking
arbitrary — which is how a correct rule gets "simplified" away by the next
reader, who cannot see what it is defending against. Retitle so the heading
states the resolution, and say plainly that the body is a record rather than
current state.

The two boundary blocks in the dashboard brief are the worked example:

| Block | Class | Action |
|---|---|---|
| "Awaiting a decision: an eighth boundary" | Request. The decision was made; the block only asked for it. | **Deleted.** |
| "Open bug, reported not fixed" | Finding. Its diagnosis is still the whole argument for the section 4.1 suppression predicate, which is still in force. | **Retitled**, body kept, marked as a record. |

The test is not "is this text still true" — neither was. It is **does anything
still standing depend on this reasoning.** If yes, the reasoning outlives the
status and the heading has to stop advertising the status.

**Resolve from the system of record, never from another document.** Both stale
boundary claims above were settled by reading `platform_changes` directly. Two
documents disagreeing tells you only that one is wrong, and offers no way to
learn which.

### The absent record, which is a different failure

Everything above is about a record that **existed and went stale**. There is a
second kind, and it is worse, so do not file it as another instance of the first.

**A record that never existed, and is believed to.** On 30 July 2026 a ticket was
referred to across several turns as "the watchdog ticket", as though it had been
read. It had never been written. The offset it supposedly documented had been
reasoned about in conversation, thoroughly enough that its conclusions were being
cited — and citation felt like recall. A grep for its contents returned nothing.

**The two fail differently and are found differently:**

| | Stale record | Absent record |
|---|---|---|
| What went wrong | was true, stopped being true | never existed |
| How it is found | by **tripping over it** — you read it, act on it, and something contradicts | only by **going to look for it** |
| What surfaces it | the document itself | nothing |

**That last row is the whole point. A stale record advertises itself** — it sits
in a file, gets read, and eventually collides with reality. Convention 9's dating
rule works because there is something there to carry a date. **An absent record
advertises nothing.** There is no file to date, no heading to grep for, no
sentence to notice has aged. Its only symptom is a confident reference to
something nobody has opened.

**So the countermeasure is different too.** Dating does not help. What helps:

- **When you cite a document, open it.** Not to re-read it — to confirm it is
  there. A citation is a claim about the repository, and it is checkable in
  seconds.
- **Be suspicious of the definite article.** "The watchdog ticket", "the
  migration that handles this", "the existing test" — a definite reference to a
  thing you have not opened in this session is the tell. Discussing something at
  length produces the same familiarity as having documented it.
- **Grep for the claim, not the filename.** The filename may be wrong or
  imagined; the distinctive phrase you expect to find in it is a better probe.

**Related but not the same:** convention 8's "a check that does not run is not a
check" is about an artefact that exists and does nothing. This is about an
artefact that does not exist and is credited anyway. Both end with a reassurance
that nothing is behind, which is why they are neighbours here.

#### This one has worked, once, and that is worth recording

**30 July 2026, one working day after the paragraph above was written.** A queue of
six post-4-August items was being recited from memory. Applying the rule here —
grep for the *claim*, not the filename — found that **four of the six existed
nowhere in the repository**: "coalesce fix", "Tier A drops", "memory
reconciliation" and "standing rules" all returned zero occurrences. The list now
exists at `docs/post-4-august-work-list.md`.

**Recorded because a convention that has demonstrably worked once is a different
artefact from one that reads well.** Every other instance catalogued in this file
was found by someone tripping over it. This is the first found by a mechanism,
and it is the only evidence that the mechanism is one.

Two honest qualifications, so this is not read as more than it is. The operator
raised the doubt before the grep was run, so the convention supplied the *method*
rather than the suspicion. And one demonstration is one demonstration — by this
file's own standard, a rule seen working once is better than a rule never tested
and a long way short of proven.


---

## 10. A client that reports failure as a field will not fail loudly

**Added 3 August 2026, found while hardening the homepage demo generator.**

`supabase-js` does not throw when a query fails. It resolves with
`{ data: null, error: {...} }`. Code that destructures only `data`:

```js
const { data: retailers } = await supabase.from('retailers').select('*')
if (!retailers?.length) { /* "no rows" */ }
```

**cannot distinguish an unreachable database from an empty table.** Both produce a
null `data`. The first is an outage; the second is a catalogue fact. Reporting one
as the other sends whoever reads the log to entirely the wrong place, and the wrong
place is usually the more expensive one to search.

Proven rather than reasoned: pointing the generator at an unreachable host produced
the message *"query returned no rows"*. Reading `error` turned the same failure into
*"supabase query failed — retailers: TypeError: fetch failed"*.

**The rule.** Any `supabase-js` call whose result is acted on must read `error`, and
must classify an error differently from an empty result. Two different messages, not
one, because they send someone to two different places.

**This is the same shape as convention 1.** `has_function_privilege` rolls `PUBLIC`
up into every role, so a per-role check reports a grant that is really a `PUBLIC`
grant, and the `REVOKE` that follows appears to succeed while changing nothing. In
both cases **the API answers a narrower question than the one being asked, and the
answer is well-formed**, so nothing looks wrong. A thrown exception is a gift; a
plausible value is not.

**Where it will recur:** anywhere `supabase-js` is called without checking `error`.
That is not a hypothetical set. It is every call site that currently destructures
only `data`, and no sweep has been run.

---

## 11. A guard that has fired in anger is a different artefact from one that has not

**Added 3 August 2026, after the repository ruleset rejected a direct push to `main`.**

Every convention in this file is reasoning until something it predicted actually
happens. **A guard nobody has watched fail is not known to be a guard** (convention 8),
and the corollary is that the moment one *does* fire is the only evidence that it was
ever more than a good intention. That moment is worth recording, because it is easy to
mistake "we have a rule about that" for "that is prevented".

**Instances where a guard has caught something real, rather than being reasoned about:**

| Guard | What it caught |
|---|---|
| **Convention 9**, the grep for stale phrasing | Found a stale record by mechanism rather than by someone tripping over it. Recorded at the foot of convention 9 as *"the first found by a mechanism"*. |
| **Convention 5**, the idempotency dry run | Caught `20260729200000` asserting "2 other occurred rows", inferred from a truncated listing that hid id 1. The migration's own comment records this. |
| **The `main` repository ruleset** | Rejected a direct push to `main` on 3 August 2026 that should have been a branch. The commit was moved to a branch and opened as a PR. No harm reached the remote. |
| **Exhaustive re-solve of demo baskets** | Caught two hand-picked homepage candidates on 3 August: one with a £0.00 gap that demonstrated nothing, and one whose assumed host was not the host. Neither looked wrong. See `scripts/generate-homepage-demo.mjs`. |
| **The Debenhams filtered-row-count guard** | Fired 4 August 2026 on its first real opportunity, after 11 consecutive clean runs. `refresh-debenhams.yml` refused a filtered feed of 6,360 lines against a `<12000` floor set when the stable range was 12,600-12,700. The raw feed had shrunk 29% at source and beauty rows 50%. **The import was never invoked, so nothing partial was written and `retailer_import_config` was left untouched.** |

**The Debenhams instance is worth reading against Branded Beauty on 1 August, because
they are the same class and opposite outcomes.** Both are retailers behind a stored feed
URL. Branded Beauty's uploader returned HTTP 500, the CSV stayed frozen at its previous
content, the import re-read those bytes and **recorded `last_import_status = ok`** —
success reported over stale data, which took a separate investigation to notice.
Debenhams **refused to proceed and said which of two causes to look at**. A guard that
stops the pipeline and names its own hypotheses is worth more than one that never fires,
and far more than a path that succeeds on frozen bytes.

**Do not lower the threshold to let a failing run through.** 12,000 was set against a
stable 12,600-12,700 and it caught a real supply change on its first opportunity.
Lowering it would silence the only thing that noticed.

**What this changes in practice.** When a guard fires, record it against the convention
it belongs to rather than only fixing the thing it caught. The fix is the smaller half.
The evidence that the mechanism works is the part that is hard to get and easy to lose,
because a guard that fires and is silently obeyed leaves no trace that it did anything.

**A near-instance, deliberately not counted:** the 09:00 feed monitor caught the
Gorgeous Shop feed-id rotation in about three hours on 2 August. That is a monitor doing
its job on the loud failure class rather than a convention being vindicated, and
`docs/post-4-august-work-list.md` item 14 already records why the loud class is the easy
one. Counting it here would flatter the list.

---

## 12. A string-scoped sweep will miss paraphrases. A claim sweep has to search for meaning

**Added 3 August 2026, after the same defect recurred twice in one day.**

**A string-scoped sweep will miss paraphrases of the same claim. A claim sweep has to
search for meaning.**

The 3 August house-rule fix swapped `"all major UK beauty retailers"` and left **eight
paraphrases standing**, two of them in `og:description` and `twitter:description`,
which never render on the page and are what search results and link previews show. The
rule was about the **assertion** — that the site compares an entire market — and the
grep was about the **words**. Variants found only on a second pass: *"the UK's leading
beauty retailers"*, *"the UK's major beauty retailers"*, *"the UK's major hair
retailers"*, *"the UK's leading retailers"*, across two files.

**The practical form, which is the part that will actually get used:**

1. **List the ways the claim could be phrased BEFORE grepping.** Write the synonyms
   down first: leading, major, top, biggest, all, every, nationwide. The grep is only
   as good as that list, and the list is the work.
2. **Treat metadata and structured data as separate surfaces, because neither renders.**
   `<meta name="description">`, `og:*`, `twitter:*` and JSON-LD each carry claims that
   no amount of reading the page will reveal. They are also the highest-stakes copy on
   the site: **an unsupportable claim in a search snippet is worse than one on the
   page, because it is the version people see before deciding to arrive.**
3. **Finish on the claim, not on the grep.**

**This was the SECOND recurrence of the same defect in one day, and the second occurred
inside the fix for the first.** The morning's lesson was that a sweep scoped to a
retailer's *name* misses claims that name nobody
(`docs/superdrug-removal-plan.md`, Step 5). The afternoon's was that a sweep scoped to
a *string* misses claims that say the same thing differently — discovered while
implementing the morning's fix.

**A sweep is not finished when the grep returns clean. It is finished when the claim
has been enumerated.**

**Relationship to convention 11.** Convention 11 records guards that have fired in
anger. This one is the opposite artefact and worth keeping next to it: a *check* that
ran, returned clean, and was wrong, because the question it asked was narrower than the
rule it was enforcing. A green result from an under-specified check is more dangerous
than no check, since it closes the question.

---

## 13. Fix the class, not the instance. Enumerate every path before closing

**Added 3 August 2026, from a defect that was diagnosed in writing and then left
standing in a second code path for five weeks.**

**When a defect is found in one path, enumerate every path that could carry it before
closing the item.**

The worked example is exact. Commit `938251d` (29 June 2026, PR #61) found that the
savings baseline *"stacked a delivery charge for every retailer, which inflated every
on-screen number and produced a baseline basket no real shopper could assemble."* It
was diagnosed correctly, described in the commit message, and fixed across **ten
files** in the site path.

`supabase/functions/send-routine-email/index.ts` was not one of them.

The identical computation, `uniqueRetailerCount * 3.95`, survived there until
**3 August 2026** (work-list item 29). For five weeks the monthly email reported
savings built on a baseline the project had already written down as wrong. One live
routine was claiming a **64%** saving where the corrected figure is **21%**.

**This is not a missed sweep. It is a fix applied to the instance rather than the
class.** The author knew what the defect was; what was never asked is *"where else does
this shape exist?"*

**Same shape as convention 12, one level down.** Convention 12 says a string-scoped
sweep misses paraphrases of a claim. This says a file-scoped fix misses reimplementations
of a computation. In both cases the search was narrower than the thing being enforced.

**The practical form:**

1. **Before closing, list every path that computes the same thing.** Grep for the
   computation's shape, not its variable names. `uniqueRetailerCount * 3.95` and
   `allRetailerIds.length * 3.95` are the same defect with different spellings.
2. **Edge functions are a separate runtime and a separate search.** They are the most
   commonly missed path in this repository because they do not appear in a Next
   typecheck, are not covered by the app's tests, and are deployed separately.
3. **If two paths must implement the same rule, make divergence fail a test.**
   `lib/__tests__/delivery.test.ts` imports both implementations and asserts they agree;
   `lib/__tests__/email-copy.test.ts` does the same job for copy rules that had only
   ever been enforced on the site.

**Cost of getting this wrong is asymmetric.** The instance fix looks complete, closes
the ticket, and reads as diligent in the commit message. Nothing surfaces the surviving
copy, because the surviving copy is working exactly as written.

---

## 14. A fire-and-forget write turns a schema mismatch into silence

**Added 3 August 2026, after nearly disabling all send logging with a one-line change.**

`routine_email_log` inserts were wrapped in `try { ... } catch (_) {}` with the comment
*"observability must not affect sending"*. The intent was right. The implementation was
the silent-kill shape:

**A logging table that stops logging is worse than one that throws, because the absence
looks like an absence of events.** Nothing distinguishes "no emails were sent" from
"logging broke three weeks ago".

**How it nearly bit.** Adding an `outcome` field to that insert before the column
existed would have ended all send logging silently, on every send, indefinitely. The
send would have succeeded, the operator would have seen nothing wrong, and the table
would simply have stopped growing.

**Compounded by convention 10.** `supabase-js` reports the failure as an `error` FIELD
rather than throwing, so even without the `try/catch` a destructure that ignored `error`
would have been equally silent. Two independent mechanisms, both defaulting to quiet.

**The rule.** A fire-and-forget write must never throw and never fail the operation it
observes, **but it must not be silent either.** Return the failure and have the caller
surface it on the channel the operator already reads.

```ts
const { error: logErr } = await supabase.from("...").insert({ ... });
if (logErr) return `... insert failed: ${logErr.message}`;   // caller pushes to errors[]
```

**Not every `catch (_)` is this defect.** In the same file, a defensive `JSON.parse` of
a Resend response body falls back to `null` for the message id, and `null` is a correct
answer there rather than a suppressed failure. The distinguishing question is: **would a
persistent failure of this operation be invisible, and would that invisibility be
mistaken for normality?** If yes, surface it.

**Where else this shape lives.** Anywhere a write exists only to record that something
happened: send logs, audit rows, metrics snapshots, run state. These are exactly the
writes people wrap in a bare catch, because they are "not important enough to fail on" —
and exactly the writes whose absence is indistinguishable from nothing having happened.

---

## 15. A safeguard can fail confidently rather than silently

**Added 3 August 2026, from a validator that was designed and measured before it shipped.**

Convention 3 says a guard that fires wrongly is as damaging as one that never fires,
because it trains the habit of dismissal. **This is the sharper case: a guard that fires
wrongly, reports success, and destroys the thing it was added to protect.**

**The worked example.** The AWIN sibling coalesce required barcode validation, because
a wrong barcode is a valid-looking string and nothing downstream checks that an EAN
belongs to the product it is attached to. The obvious reading of "EAN checksum
validation" is an EAN-13 validator.

Measured against live data **before** writing it:

| Retailer | Barcodes | 13-digit | **12-digit** |
|---|---|---|---|
| Debenhams | 10,232 | 7,481 | **2,629** |
| Beauty Bay | 7,624 | 4,477 | **3,068** |

**Those 6,228 are UPC-A, and they work today.** An EAN-13-only validator would have
rejected every one of them, on two retailers whose data was never in question, while
reporting a clean run and a plausible rejection count. The failure would have looked
like diligence.

**Why it would not have been caught.** A rejected barcode is treated as absent, so no
row fails, no import errors, and the only symptom is matching quietly getting worse on
two retailers over subsequent imports. Nothing in the pipeline compares barcode coverage
before and after a deploy.

**The rule. Measure what a safeguard will reject BEFORE shipping it, against real data,
and read the rejections rather than the pass rate.** A validator's pass rate is not
evidence it is correct; it is evidence it is consistent. The rejections are where the
information is.

**Practical form:**

1. **Run the proposed rule over existing production data and count what it would kill.**
   If the answer is not zero on data believed good, the rule is wrong until explained.
2. **Distinguish "absent" from "invalid".** Conflating them buries the signal: empties
   swamp genuine rejections and the count stops meaning anything.
3. **Log rejections per source per run from the first deploy**, not added later once a
   number looks odd. A rejection rate is only readable as a series.
4. **Prefer widening to rejecting** where a wider rule is provably lossless. UPC-A
   left-padded to 13 digits *is* the equivalent EAN-13 and its check digit is unchanged,
   so accepting both costs nothing and makes cross-retailer matching work between a
   UPC-A retailer and an EAN-13 one.

**Sits beside convention 3.** Convention 3 is about the cost of false alarms to human
attention. This is about the cost of false alarms to data, which is worse, because
attention notices being wasted and data does not.

---

## 16. Before any destructive git operation, confirm the non-destructive one did something

**Added 3 August 2026, after a `reset --hard` that nearly discarded a commit whose
rescue had silently failed.**

**Convention 2 applied to git.** A `git cherry-pick` that produces an **empty** commit
prints a notice and leaves `HEAD` unchanged. Nothing fails. The branch simply does not
contain the change, and the next command in the sequence was `git reset --hard`, which
would have removed the only other copy.

**The sequence that nearly lost work:**

```
git checkout <branch>
git cherry-pick <sha>        # produced an EMPTY commit; the change did not transfer
git checkout main
git reset --hard origin/main # would have destroyed <sha>, the only remaining copy
```

**Why it looked fine.** The cherry-pick emitted a hint rather than an error, the shell
exited 0, and the branch log showed a plausible HEAD. The failure was visible only by
asking a different question: *is the changed content actually present in the file?*

**Why it happened here specifically.** The two branches held **different versions of the
same file**. `main` carried items 33 and 34; the branch carried an item 18 rescope and a
scanner-gate note that `main` did not. A cherry-pick across that divergence can resolve
to a no-op without conflicting.

**The rule.** Before `reset --hard`, `branch -D`, `push --force`, or any other operation
that removes a commit from reach, **verify the operation intended to preserve it actually
preserved it** — by checking the content, not the exit code and not the log.

```
grep -c '<a string only the rescued change contains>' <file>
```

**A commit that is still reachable is recoverable; that is the escape hatch and it is
narrow.** `git reflog` and the dangling object both survive a `reset --hard` for now, but
they expire, and the recovery only works if you notice in time. In this case the content
was recovered from the orphaned commit and re-applied. Nothing was lost, but only because
the check happened before the second destructive step rather than after it.

**Same shape as convention 8.** A check that does not run is not a check; here, a rescue
that did not rescue is not a rescue, and both report success identically.

---

## 17. A check that cannot fail is not a check, however well designed

**Added 4 August 2026, from a verification that would have reported a pass on a
mechanism that never ran.**

Convention 8 says a check that does not run is not a check. **This is the harder case:
a check that runs, produces a clean result, and could not have produced any other.**

**The worked example.** Stage 2 of the AWIN sibling coalesce was to be verified by
comparing category distribution before and after enabling the flag. That is a good
check. It measures the outcome that matters — where products land — rather than the
mechanism, and it was chosen over "is the column populated" for exactly that reason.

Underneath it, `import-awin-feed` writes `top_category` only on `createActions`.
Existing products take `updateActions`, which does not carry category at all. **Every
product in the affected set already existed.** So the distribution could not move, no
matter what the recovered column contained.

**Run as designed, the check would have shown no movement, and that null result had two
explanations:**

1. the recovered column agrees with what name inference was already doing, or
2. the column was never applied.

**Nothing in the observation could distinguish them**, and (1) is the comfortable
reading. The check would have been reported as a pass, the stage marked verified, and
the item closed on a measurement that was structurally incapable of failing.

**The rule. Before trusting a check, establish that the mechanism it observes can
actually change the thing being measured.** Ask what a failure would look like. If you
cannot describe an input that makes the check fail, it is not measuring what you think.

**Practical form:**

- **Trace the write path, not the read path.** The check read `products.top_category`
  correctly. The defect was that nothing wrote it. Reading the right column proves
  nothing if no code path assigns it.
- **A null result is a finding only when a non-null result was possible.** Otherwise it
  is an absence of measurement wearing the costume of one.
- **Prefer a check you have seen fail.** Convention 11 collects guards that have fired
  in anger for this reason. A check that has only ever passed is indistinguishable from
  one that cannot fail.

**This was caught by asking a question about reversibility, not about correctness.** The
operator asked whether a subsequent import with the flag off would rewrite categories,
in order to establish whether the stage could be rolled back. Answering that required
reading the write path, which is what exposed it. **The question that found the defect
was not aimed at it.**

---

## 18. A method proven on a case too small to stress it is not proven

**Added 4 August 2026, after a staging plan's verification method failed on the first
stage large enough to exercise it.**

**Convention 2 at the level of a method rather than a code path.** A rollout was staged
smallest-first, deliberately, so that anything unexpected would be legible. Stage 1 was
The Organic Pharmacy at 114 rows and it passed cleanly: dry run matched live run on
every metric.

**Stage 2 could not be dry-run at all.** `dry_run: true` forces single-invocation mode
by design, because slicing depends on each slice committing and a dry run commits
nothing. Beauty Flash is sliced *because it does not fit in one worker*. The dry run
asked it to do the exact thing slicing exists to avoid, and returned HTTP 546 twice.

**Every remaining stage is affected**: 6,974 to 35,912 rows, all sliced, none
dry-runnable. **The verification method the entire staging plan rested on works only
below a few hundred rows, and nothing revealed that until a stage exercised it.**

**Stage 1 passed because it was too small to test the method.**

**The rule. When a plan depends on a method, verify the METHOD at the scale it will be
used, not only at the scale that is convenient to start with.** Smallest-first staging
is still right — it limits blast radius — but it systematically delays discovering that
the tooling does not scale, because the early stages are the ones least likely to break
it.

**A caveat written down is worth more than a caveat held.** The stage 1 report recorded,
in advance, that *a clean stage 1 tells you very little about stages 2 to 6: small feed,
categories already agreeing, barcodes with nothing to match against*. That turned out to
be truer than intended — it did not merely fail to test the category half, it failed to
test whether the verification method worked. **Because it was written down rather than
thought, it was available to be read back when the stage failed**, and it framed the
failure as expected-in-kind rather than as a surprise.

---

## 19. State the rule as the movement, or it will keep failing

**Added 5 August 2026, after the same class of error three times in three days.**

**Three instances is a rule that does not work, not three lapses.**

| Date | What happened | Caught by |
|---|---|---|
| 3 Aug | Committed to `main` directly | the `main` ruleset rejected the push |
| 3 Aug | Committed to `main` directly, again | the ruleset again |
| 5 Aug | Branched from `feat/awin-sibling-coalesce` instead of `main`, so a PR carried four unrelated commits | nothing — noticed while reading the merge output |

**The rule was written as "branch first". That is why it kept failing.** "Branch first"
is satisfied by `git checkout -b` from wherever `HEAD` happens to be, which is exactly
what produced the third instance. The rule was never the problem people thought it was:
the omitted step is **verifying the base**, and no wording that starts with "branch"
draws attention to it.

**State it as one movement, not as a first step:**

```
git checkout main && git pull && git checkout -b <branch>
```

**Never `git checkout -b` on its own.** Not because branching is wrong, but because on
its own it silently inherits whatever is checked out, and the inheritance is invisible
until a PR diff is read — by which time the commits are already in it.

**The general form, and it is the reusable part.** A rule phrased as an *action* fails
where a rule phrased as a *movement from a known state* does not, because the action can
be performed correctly from the wrong starting point. **"Branch first" describes what to
do; "branch from `main`" describes what must be true.** Prefer the second wherever the
starting state can vary.

**Why the third instance looked harmless, and why that is the trap.** The mis-based PR
merged work that had — in the two days between — independently become correct to merge.
The outcome was fine. **It was fine because of the interval, not because the error is
safe:** the same mistake on 3 August would have merged genuinely unconfirmed work into
the default branch. Recording only the outcome would teach that this class of error does
not matter.

---

## 20. "Not yet degraded" and "still correct" are different claims

**Added 5 August 2026, generalised from a stale-feed judgement.**

**Every stale-data judgement this project has made has rested on the first while sounding
like the second.**

The two claims:

- **"Not yet degraded"** — a threshold has not been crossed, an alert has not fired, a
  guard has not tripped. It is a statement about **a mechanism**.
- **"Still correct"** — the data reflects reality. It is a statement about **the world**.

The first does not imply the second, and the gap between them widens with time while
nothing observable changes.

**The worked example.** Debenhams stopped importing on 4 August 2026. The absence
threshold is 30 days, so nothing degrades automatically before early September. But
**7,358 sole-offer products** are served at prices last confirmed on 3 August, and on a
sole-offer product the price shown is the only price shown. At two days that is fine. At
two weeks the honest sentence is "these prices are a fortnight old and we have not
checked them", **not** "nothing has degraded".

**Where this has already applied, unnoticed:**

- **Branded Beauty**, 1 August: the frozen CSV re-imported cleanly and reported
  `last_import_status = ok`. Not degraded by any mechanism; not correct.
- **Skin Cupid**, 11 May to 3 August: an error nobody read for 52.7 days. No threshold
  existed to cross.
- **The 30-day absence threshold itself** is a "not yet degraded" instrument. It says
  when to stop *showing* a price, not when to stop *trusting* one.

**The rule. When reporting on stale data, say which claim you are making.** If the
support is a threshold that has not been crossed, say that, and say what the threshold is
for. A reader hearing "nothing has degraded" will take it as "the data is fine", and the
person who said it usually meant "no alarm has gone off".

**Two questions that separate them:**

1. *What would have to be true for this to be wrong, and would we see it?* If the answer
   is "nothing we watch", the claim is about mechanisms only.
2. *How old is the data, in units a user would care about?* Thresholds are in units the
   system cares about. Those are rarely the same.
