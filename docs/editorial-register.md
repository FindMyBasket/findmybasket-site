# Editorial register

**Created 2 September 2026, work-list items 562 and 563.** The rules below already existed and were
correct. **None of them had a home.** They were spread across `strategy.md`, a step in a client PDF
spec, and the footers of individual drafts, and one of them shipped a violation because the only
statement of it was unsearchable by the word it banned.

**This file is the single statement.** `strategy.md` points here. `dashboard-build-brief.md` step 13
cites this rather than restating it.

> **A note on this file's own form.** It is written in compliance with rule 4 below, as a
> demonstration rather than as a flourish. It contains no em dashes.

---

## The four rules, each with its scope stated

**Scope is stated per rule because the four do not share one**, and the absence of that statement is
what allowed rule 2 to ship. They arrived together in one line of a PDF spec, which made them look
like one rule with one scope. They are not.

### 1. British English

**Scope: SITE-WIDE, ALL SURFACES.** Site copy, articles, PDFs, emails, metadata, error messages.

No exceptions and no surface-specific carve-outs.

### 2. The banned discount word

**Scope: SITE-WIDE, ALL OUTPUT, PUBLISHED AND INTERNAL.**

> **The words are "cheapest" and "cheaper". Do not use either in any output.**
>
> **Permitted forms: "best value", "best price", "costs less".**

**Both words are written here, spelled out, deliberately**, and the reason is a correction rather than
a principle. Work-list items 562 and 563.

**THE RULE WAS STATED IN TWO PLACES AND THEY DID NOT AGREE.**

| where | names the word? | covers "cheaper"? | scope stated? |
|---|---|---|---|
| `dashboard-build-brief.md` step 13 | **no**, says *"the banned discount word"* | **no** | PDF generator only |
| `docs/article-template.html` header | **yes** | **yes** | articles built from that template |

**Neither was wrong. Together they were unreliable**, because which rule you got depended on which
artefact you happened to open, and only one of them told you the second word existed.

> **AND THE ARTICLE TEMPLATE IS THE ONE A WRITER WOULD ACTUALLY FIND**, which is the part worth
> keeping. The failure was not that the rule was hidden. It was that the statement carrying the most
> information sat in a template nobody reads unless they are building a page from it, while the
> statement in the spec was the one cited elsewhere.

**It applies to identifiers and comments only as a preference, not as a rule.** A local variable named
`cheapest` is not output. The check described below tests strings that reach a reader.

### 3. Ranges only, no point-in-time figures

**Scope: SITE-WIDE, ALL ARTEFACTS.**

**This rule is `docs/standing-rule-frozen-catalogue-state.md` and is not restated here.** That document
carries the reasoning, the two acceptable forms, and the distinction between frozen and fabricated
state.

> **One statement, cited from wherever it is needed.** A second copy would drift from the first, which
> is the defect the rule is about, reproduced by the act of writing it down twice.

### 4. No em dashes

**Scope: WRITTEN OUTPUT. Documents, briefs, drafts, articles, anything written for a person to read.**

**NOT declared over the site's component copy, and the reason is a measurement rather than a
concession.** 60 lines of `.tsx` carry em dashes today, including genuine user-facing strings. If this
had been a site rule it has been broken everywhere for months without objection.

> **THE HONEST READING IS THAT THE SITE'S USAGE PREDATES ANY STATEMENT OF THE RULE, NOT THAT THE SITE
> IS IN VIOLATION.** Declaring 60 lines non-compliant on the strength of a line in a PDF spec would be
> inventing a backlog out of a scoping accident.
>
> **Whether the site should adopt it is a separate question and it has never been asked.** Recorded as
> open, here, so that it is a question somebody can answer rather than an assumption either way.

**Existing documents also predate this file.** The work list, the strategy document and the briefs all
carry em dashes. **They are not retrospectively in violation.** The rule applies to written output from
2 September 2026 forward.

---

## The check

**Rule 2 is the only one of the four a machine can verify**, and that is a property of the rule rather
than of the effort available.

`supabase/migrations/README.md` convention 12 warns that a string-scoped sweep will miss paraphrases,
and it is right about *"helpful first, honest always"*, which no check will ever reach. **A banned word
is the one case where string-scoping is exactly correct, because the rule is about a literal string.**

`scripts/check-banned-word.sh`, run in CI beside `roster-parity` and `match-key-parity`.

### What it cannot do, stated so nobody reads green as clean

1. **It catches the word, not the intent.** "Lowest price" passes. Whether that should also be
   discouraged is a register judgement a grep cannot make.
2. **It reaches only what is in the repository.** Article copy written in a document, a CMS or a PDF
   template is outside it, **which is precisely where this rule was born.** The check covers the
   surface that shipped the violation and not the surface the rule was written for.

> **THE TWO SHIPPED INSTANCES ARE THE ARGUMENT FOR HAVING IT.** They were live from 27 August in the
> most-read component on the site and nothing objected. **The rule was enforced by a person reading a
> draft**, which is what a check is for.
