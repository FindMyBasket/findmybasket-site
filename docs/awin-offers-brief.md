# Awin Offers API brief

**Your health and beauty routine. Optimised.**

**Moved into version control 2 September 2026, work-list item 570.** Scoped to delivery-modifying
offers only. Discover first. Sequenced after the identifier fix, not before it.

> **WHY THIS FILE IS IN `docs/` AND ITS OWN HISTORY IS THE ARGUMENT.** The brief made two checkable
> claims about this codebase. **Both were wrong when measured**, and both corrections are now written
> into the sections they correct rather than living only in the register. **They would have been a
> diff rather than a report.**
>
> `dashboard-build-brief.md` and `rakuten-reporting-probe-brief.md` are already here, versioned and
> greppable. **A brief is a claim about a codebase, and a claim about a codebase that lives outside it
> drifts with nothing noticing.** Second instance in one day, after item 564.

## The framing this brief exists to protect

Offers are an input to the optimiser, not content on a page. A free delivery offer changes a delivery
threshold, which is the exact variable the whole basket mechanic exists to handle. Nothing in this
brief builds a voucher codes page, and section 8 explains why that boundary is load bearing rather
than aesthetic.

---

## 1. Objective and boundary

Retrieve current offers from the Awin Offers API, identify the narrow subset that modifies delivery
terms, and use only that subset to make the optimiser more accurate. Everything else retrieved is
stored and ignored.

### Why delivery offers specifically

- **They are structurally unambiguous.** A free delivery threshold is a number, and the schema for it
  already exists after the 1 August delivery work, including the model column separating tiered from
  flat from unknown.
- **They land directly on the differentiator.** The wedge is whole basket optimisation including
  delivery, so an offer that moves a threshold changes which retailer wins a basket rather than
  decorating a page.
- **They carry the least exclusion risk.** Percentage offers commonly exclude sale items, categories
  or named brands in unstructured free text, and applying one incorrectly produces a wrong basket
  total that the platform generated itself.

### The rule that governs the whole build

**An offer may never be applied on top of a fabricated delivery default.** Where a retailer's real
delivery terms are unknown, no offer applies and the optimiser declines to compute rather than quietly
computing.

#### ⚠ CORRECTION, 2 September 2026  -  the status of this rule, not its content (item 568)

**This section previously read "the runtime fallbacks substituting 25 for a missing threshold and 3.95
for a missing cost still exist in the code". They do not.** Measured across all five pricing paths,
comments stripped: **zero occurrences.** `lib/__tests__/delivery.test.ts` asserts their absence on
those same five paths and passes 21 of 21.

**The expected count of "eight occurrences in the app and three in the email path" came from the header
of `supabase/functions/_shared/delivery.ts`, which lists four sites and three sites IN THE PAST TENSE,
as the fix's own note of what it removed.**

> **The brief read the comment describing the fix as a description of the problem. A document
> inherited a hazard from the record of its repair**, and that is why the rule read as urgent rather
> than as a standing guarantee.

**The rule is kept. Its status is now: a forward guarantee enforced by a test, not a live hazard.**
Phase 3 does not have to work around existing fabricated defaults. It has to avoid introducing one,
and the test will refuse it on all five paths if it tries.

#### ⚠ CORRECTION, 2 September 2026  -  this rule currently protects nothing (item 569)

**Measured: 14 active retailers, 13 tiered, 1 flat, ZERO unknown.** The clause above excludes **no
row**. Phase 3 could ship with it implemented, broken, or absent and every basket would compute
identically.

> **THE BRIEF ALREADY KNEW.** Section 7's acceptance criteria demand *"no offer is ever applied to a
> retailer whose delivery terms are unknown, **demonstrated by constructing that case**"*, and section
> 4 applies exactly that discipline to the classifier: construct the cases it must reject, watch it
> refuse, report the refusals. **Section 1's rule is the more load-bearing of the two and gets none of
> it.**
>
> **So the fix is section 1 carrying section 4's own requirement**, and it is stated here rather than
> left to an acceptance criterion at the end of the document.

**REQUIRED, and not deferred to section 7:** construct a retailer holding `unknown` terms, construct an
offer that would otherwise apply to it, and demonstrate the refusal to compute. **Report the refusal
before any integration ships.**

> **AND THE MECHANISM IS WORTH KEEPING, BECAUSE IT GENERALISES.** A rule protecting an empty population
> **reads as protective precisely because it was written by someone who expected it to matter.** A
> guard is usually written where its author expects it to fire, so the ones that never fire are the
> ones that look most considered. **Its silence is not coverage.**
>
> It becomes live at the next onboarding without terms, which is exactly when nobody will be watching
> it: weeks after shipping, never having fired, with no test that has seen it refuse. Amazon and eBay
> both hold `unknown` today and are inactive; the rule already binds them.

---

## 2. Phase 0: discovery, report only

**COMPLETE for everything reachable, 2 September 2026.** Findings in work-list items 568, 569, 570.
The API half required a probe, approved separately as Phase 0.5 because Phase 0 forbids code changes
and no existing route to `api.awin.com` reaches `/promotions`.

Investigate and report. No edits in this phase: no migrations, no code changes, no scheduled jobs, no
dependency additions. Report what was found rather than what was expected.

### The API

The endpoint is a POST on the publisher promotions path. **Confirm rather than assume** the held
credential carries the scope this endpoint needs.

```
POST /publisher/{publisherId}/promotions
```

1. Make one authenticated call and report the full response schema **as returned, field by field**. Do
   not work from documentation or from this brief.
2. Report whether the credential in use is accepted, and if not, what scope or token type is required.
3. Report the total offer count, and the count restricted to advertisers we are joined to. Report how
   that is distinguished in the payload.
4. **Report every field relating to exclusivity, publisher attribution or assignment. State plainly
   whether the payload allows us to tell an exclusive code from a general one.**
5. Report every date field, and which combination reliably identifies an offer valid right now.
6. Report rate limits, pagination behaviour and typical response size.

### Offer composition

7. For joined advertisers only, classify into three buckets and report counts with examples: modifies
   delivery, discounts a price, everything else.
8. **For the delivery bucket, report the exact wording of every offer. Print the rows, not only the
   count.** This wording is what any classifier would work from and its variability is the main
   technical risk in the build.
9. Report whether any delivery offer requires a code at checkout or applies automatically.

**Questions 4 and 8 decide the build.**

### The existing delivery model

10. Report the delivery columns on `retailers`, the constraints, and which retailers hold real values
    against unknown.
11. Report every location where the runtime fallbacks are applied. **See the correction in section 1:
    the answer is zero, and a test enforces it.**
12. Report where the optimiser reads delivery terms, and whether a per-retailer override could be
    injected without restructuring the option builders.
13. Report whether any offers, promotions or vouchers table already exists, used or unused.

**Stop after the report. Do not proceed to phase 1 without explicit approval.**

---

## 3. Phase 1: storage and refresh

**Gated. Requires approval of the discovery report.**

- A table storing offers as retrieved, with explicit columns rather than a single blob, retaining the
  raw payload alongside for audit.
- A scheduled daily refresh, timed outside the existing import window so two large operations never
  run together.
- **Offers are replaced on refresh, never appended.** An offer absent from the current response is no
  longer valid and must stop being served the same day.
- A classification column defaulting to unclassified. Nothing is treated as delivery-modifying unless
  positively classified.

### Expiry is the trust surface

An expired offer applied to a basket is a fabricated number, and it is worse than a stale price because
the platform generated the error rather than inherited it. **Never serve an offer whose end date has
passed, and never serve an offer that failed to refresh. If the refresh fails, serve no offers at all
rather than yesterday's.**

---

## 4. Phase 2: classification, conservatively

**Gated separately.** The phase most likely to be got wrong, because it turns free text into a number
the product presents as fact.

- **A whitelist, never a blacklist.** Classified as delivery-modifying only on an explicit, narrow,
  enumerated pattern. Anything unmatched stays unclassified and is never used.
- Classification must extract a structured result: the new threshold, free delivery unconditionally, or
  nothing. **If the threshold cannot be extracted with certainty, the offer is not classified**, however
  obviously delivery-related the wording appears.
- Report the classifier's output over the full offer set before it is used anywhere, including every
  offer it declined to classify and why.

### Prove the guard refuses

**A guard nobody has watched fail is not known to be a guard**, and a defensive clause never fails
loudly when it is a no-op. Construct offers the classifier must reject: an ambiguous threshold, a
delivery offer restricted to a category, an offer that merely mentions delivery in passing.
**Demonstrate refusal on each and report the result before any integration.**

*Section 1 now carries this same requirement for the unknown-terms rule.*

### Explicitly not to be attempted in this phase

- No inference of intent from partial matches.
- **No language model call to interpret offer wording.** If a rules-based classifier cannot handle the
  real wording found in discovery, stop and report rather than reaching for a model.
- No classification of percentage or fixed-amount discounts, even where wording appears simple.

---

## 5. Phase 3: optimiser integration

**Gated separately, and only after the classifier output has been reviewed.**

- Apply a classified delivery offer as an **override on the retailer's delivery terms for that basket
  calculation only**. Do not mutate the stored retailer record.
- **Apply nothing where the retailer's underlying delivery terms are unknown.** Section 1's rule, no
  exceptions.
- Where an offer changes the outcome, the user must be told which offer applied and whether a code is
  needed at checkout. **A basket total the user cannot reproduce is a trust failure even when the
  arithmetic is right.**
- Report the before and after effect across a sample of real baskets: how many change their winning
  retailer, and how many change from a split to a single or the reverse.

### An honest consequence to expect

Free delivery offers will sometimes make a single retailer win where a split previously won, which
reduces how often the split mechanic visibly does anything. **That is the optimiser being more correct
rather than less useful, and it should be reported as a finding rather than treated as a regression.**

---

## 6. Mutating steps, each requiring explicit approval

14. Any migration creating or altering the offers table. Explicit column lists only. **A migration must
    never compute its own scope.**
15. Creating the scheduled refresh job, including its time slot.
16. Any write of classification results.
17. Any change to the optimiser's delivery handling.
18. Any deployment to production.

### Dry runs required

- Select before insert, select before update, select before delete. **Report affected row counts and a
  printed sample, not only a count.**
- Before the optimiser change ships, run it in reporting mode computing both the current and the
  offer-adjusted result without serving the adjusted one, and report the divergence.
- **State the rollback path for each mutating step before executing it.**

---

## 7. Acceptance criteria

19. Offers refresh daily and a withdrawn offer stops being served within one refresh cycle,
    **demonstrated rather than asserted**.
20. A failed refresh results in no offers being served, not yesterday's.
21. No offer is ever applied to a retailer whose delivery terms are unknown, **demonstrated by
    constructing that case**. *Section 1 now requires this before integration rather than at
    acceptance.*
22. The classifier refuses every ambiguous case put to it, with the refusals printed.
23. Where an offer changes a basket outcome, the interface names the offer and states whether a code is
    required at checkout.
24. No route, page, navigation entry or structured data markup presents this as a voucher or discount
    code destination.
25. Exclusive offers not assigned to this publisher are excluded, **or if the payload cannot distinguish
    them, no offer requiring a code is used at all until it can**.

---

## 8. Explicitly out of scope

| Excluded | Why |
|---|---|
| A voucher codes page, route or navigation entry | Collides with the standing position that this is never a discount destination, and competes in a category owned by established sites with far deeper authority. |
| Voucher-related structured data markup | It is a classification signal. Advertisers commonly apply different terms, lower rates or exclusions to voucher publishers, which would land on the volume gated reapplications now waiting on traffic. |
| Percentage and fixed-amount discount offers | Exclusion conditions are unstructured free text. Wrong basket totals generated by us are worse than stale prices inherited from a feed. |
| Offers from advertisers we are not joined to | Retrievable through the API and not ours to promote. |
| Offers in emails, social captions or on-screen overlays | House style excludes retailer names and price figures from social, and the saved routine email path is a separate system with its own semantics. |
| Removing the runtime delivery fallbacks | **No longer applicable: they do not exist. See the section 1 correction and item 568.** |

---

## Sequencing

This work sits after the identifier fix. **⚠ CORRECTION, 2 September 2026 (item 570): that referent
does not exist in this repository.** "Fenty" appears nowhere; no work-list item is named for an
identifier fix; no September date is attached to any work. The nearest candidate is
`docs/barcode-merge-programme.md`, **paused with no date and no Fenty reference.**

> **The gate is real and it is unreadable.** *"Do not start while that fix is in staged rollout"* cannot
> be checked by anyone from this repository. **Recorded as an absent referent rather than a pending
> dependency**: a dependency can be chased, this cannot. Robbie to name what the identifier fix is.

Two large operations must never run at once, and both change what the optimiser sees.

## Reporting conventions

- **Report what was found, not what was expected.** Verify against the live system rather than against
  a summary. *This brief is now itself an instance of why.*
- **Print the rows, not only the count.**
- Anything left pending or open in the final report carries the date it was written.
- If a phase turns out to be larger than this brief assumes, **stop and report** rather than proceeding
  on a revised interpretation. *Phase 0.5 exists because this rule was followed.*
