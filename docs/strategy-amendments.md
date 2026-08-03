# Strategy Document: proposed amendments

**Date:** 3 August 2026
**Against:** FindMyBasket_Strategy_2026-08-03_v2 (Word document, held outside version control)
**Status:** NOT APPLIED. Apply during the conversion to `docs/strategy.md`, per work-list item 24.

> These amendments existed only in conversation until this file was written. That is the same
> defect as the strategy document itself being outside version control, and it is the instance
> that would have survived the fix: converting the Word file without them would produce a
> stale-but-authoritative artefact, which is worse than a stale one without a path.

## Summary
The document is sound and most of it needs no change. What has moved is that several claims which were true as intentions are now true as facts, and two are less secure than the document implies.

| **\#** | **Amendment**                                             | **Kind**  |
|--------|-----------------------------------------------------------|-----------|
| A1     | The delivery half of the wedge had no data until 1 August | position  |
| A2     | Comparison depth is worse than section 6 states           | position  |
| A3     | Catalogue figures need a stated denominator               | figure    |
| A4     | Retailer roster and churn rate                            | figure    |
| A5     | Amazon is now a live option, and marginal                 | new       |
| A6     | The measurement instrument was broken until 29 July       | position  |
| A7     | No price history exists                                   | risk      |
| A8     | Retailer churn is normal, not exceptional                 | principle |
| A9     | Section 16 needs the conventions that emerged             | principle |

A1. The delivery half of the wedge had no data until 1 August

Section 2 states the wedge precisely: whole basket optimisation including delivery, and that no competitor solves the basket question. Section 7 rests the commercial model on it and work-with-us.html says no other UK platform does this.

Until 1 August the delivery figures were invented. RoutineBuilder coerced a missing threshold to 25 and a missing cost to 3.95 at four call sites, and five of eleven live retailers had neither recorded, including Boots. 54.3 per cent of in-stock rows were behind fabricated numbers, and a sixth retailer, Escentual, held values that were wrong on both fields.

This is now fixed in data: eleven retailers carry real terms read from their sites on 1 August, an explicit delivery_model column distinguishes tiered from flat from unknown, and a CHECK constraint makes a malformed shape impossible. The code still carries the fallbacks, so Debenhams remains understated by £3.99 on baskets over £25 until that lands.

**Amendment: section 2 should record that the wedge became evidenced on 1 August rather than at launch, and section 11 should carry it as the largest data-quality finding to date. The point is not self-criticism. It is that the differentiator was asserted for months before it was true, and the document is the place that records which claims are supported.**

A2. Comparison depth is worse than section 6 states

Section 6 gives 86.2 per cent of buyable catalogue with a single stockist, from the 1 August clickout diagnosis. Measured today: 11,535 products comparable at two or more active retailers against 84,780 in products_active, so 86.4 per cent single-stockist. Consistent, and worth restating on a named denominator.

Two things have made it worse since, both correct decisions: the Superdrug retirement removed 29,525 in-stock rows and the Branded Beauty parking removed 1,868 more, of which 1,623 were the only live offer on their product. Roughly 8,100 products lost their only offer across the two.

**Amendment: section 6 should note that comparison depth degrades with every retailer departure, and that four departures or rotations have occurred in ten weeks. The constraint is not static, it is being actively eroded, which sharpens the prioritisation test rather than changing it.**

A3. Catalogue figures need a stated denominator

Section 4 says roughly 95,000 products across roughly 2,300 brands. Measured 3 August:

| **Measure**                                                          | **Value** |
|-----------------------------------------------------------------------|-----------|
| All product rows                                                     | 119,946   |
| Canonical (not merged, not variant child)                            | 106,117   |
| In products_active (canonical, imaged, live offer)                   | 84,780    |
| Distinct brands in products_active                                   | 2,066     |
| Comparable at 2+ active retailers, **any product row**               | 12,010    |
| Comparable at 2+ active retailers **and in products_active**         | 11,535    |

**The last two rows are the amendment demonstrating itself.** An earlier draft of this table carried 11,535 under the label "comparable at 2+ active retailers", which is the 12,010 definition. Only the qualified reading shares a denominator with the 84,780 it is divided by, and the 86.4 per cent single-stockist figure in A2 depends on that pairing. The 86.4 per cent is unaffected: numerator and denominator are both products_active and the arithmetic holds.

*(The 11,888 root-only against 12,433 including shade children cited below are a different pair from an earlier measurement date. Do not conflate them with the two rows above.)*

**Amendment: replace the single figure with the definition used. This project has twice had a number disputed because its basis was unstated, and the comparison-depth figure already carries two defensible readings (11,888 root-only against 12,433 including shade children). Any figure in an external document should name its denominator, including the figures in this amendment.**

A4. Retailer roster and churn

Section 4 lists eleven live retailers and names the roster as not static. Both need updating.

Twelve carry active = true today, but Branded Beauty is parked pending a flip held past the 4 August Boots read, so the operating number is eleven and becomes ten. Gorgeous Shop and Perfume Click are live and were missing from the about.html list until 3 August, which suggests they may be missing here too.

**Amendment: state the roster with its date, and add the churn table below to the roster movements section.**

| **Date**         | **Retailer**   | **Event**                    | **Caught by**     |
|------------------|----------------|------------------------------|-------------------|
| 21 May to 11 Jun | Skin Cupid     | programme closed, fid nulled | nobody, 52 days   |
| 19 Jul           | Superdrug      | Rakuten feed died            | retired 27 Jul    |
| 2 Aug            | Gorgeous Shop  | AWIN rotated the feed id     | monitor, ~3 hours |
| 2 Aug            | Branded Beauty | programme closed             | parked, flip held |

A5. Amazon is a live option, and it is marginal

The document treats Amazon as a supporting channel with manual reporting. Two things changed on 3 August.

Product data access cleared. The Creators API returns real item data where it previously returned AssociateNotEligible, so per-product lookups are possible for the first time. Feed access remains a separate entitlement returning 403, escalated to Amazon's technical team and unresolved.

**But the gate is rolling and UNDOCUMENTED, with a community-reconstructed threshold of roughly ten qualifying sales in a trailing thirty-day window. The account stands at twelve shipped, above the reconstructed figure but with no confirmed margin. The window moves daily.**

An earlier draft of this amendment called the gate *documented* and stated the margin as "two sales above suspension". That was wrong on both counts and is corrected here rather than footnoted, because A5 is the amendment most likely to be quoted outward and a threshold presented as documented invites a partner to rely on it. **That is precisely the claims-discipline failure section 11 already prohibits, appearing inside an amendment to the document that prohibits it.**

What is actually recorded, in `~/amazon-api-watch/README.md`, which grades the threshold **SUPPORTED, NOT CONFIRMED** deliberately:

- The rule is community-reconstructed from an undocumented November 2025 change. **Amazon's own onboarding page 404s.** The third-party article and FAQ this was originally taken from are not Amazon documentation.
- The 3 August evidence is one overnight increment on one account, eleven shipped to twelve, with product data flipping to OK. That **rules out a threshold of thirteen or higher** and is consistent with roughly ten plus evaluation lag. It does not establish ten, and a periodic re-evaluation job that merely happened to run explains it equally well.
- The sharper test is a future **loss** event, read against the shipped count at that moment. It has not happened.

**The strategic conclusion is unchanged and slightly strengthened.** Access is conditional and its trigger is not fully understood, which is a better reason to treat any dependent feature as losable than a known threshold would be.

Amendment: section 7 should record Amazon as a conditionally available option rather than a manual one, with the rolling gate stated. The strategic point is that any feature built on it is least robust exactly where it would be most valuable, on the 86 per cent of catalogue with a single stockist, because losing access reverts those pages from comparison to listing.

There is a genuine wedge available here and it is worth recording as an open question rather than a plan: a Prime toggle would make Amazon's user-dependent delivery threshold knowable, which is the objection that otherwise excludes Amazon from basket optimisation. Cosmetify includes Amazon in the US and not the UK, which is a deliberate choice worth understanding before treating the UK gap as an opportunity.

A6. The measurement instrument was broken until 29 July

Section 9 sets out the measurement framework and section 6 rests the strategic diagnosis on the 4.7 per cent clickout rate.

A hydration race meant several GA4 events never fired on cold loads. The custom search event returned zero for the entire period despite the server-side table recording searches. view_item, which qualified-sessions depends on, was systematically undercounting by the share of product views arriving as cold loads, which for search-engine landings is most of them.

Fixed 29 July. Five derived metrics are date-gated and first render from the week beginning 3 August.

**Amendment: section 6 should note that figures taken before 29 July are subject to that undercount, and section 9 should record the boundary. The 4.7 per cent clickout rate in particular used comparison views as its denominator, and that denominator was broken. The conclusion may still hold, but the number should not be quoted as measured.**

A7. No price history exists

Section 12 describes the retention loop, change detection covering price, stock and best value retailer, and materiality tagging.

There is no record of what any price was on any past day. retailer_prices is overwritten in place on every import. A price_history table exists, has never received a row, and has three maintenance functions written to keep consistent a set of rows that has never existed. Every day without a writer is permanently unrecoverable.

Consequences: no savings figure before 27 July can be reconstructed, alerts have only a single baseline number per saved product rather than a series, and the seven consecutive green nightly runs have produced no alert because nothing crossed the threshold, which is untested rather than working.

**Amendment: section 11 should carry this as a standing risk alongside silent freezes and cache staleness. It is the largest structural gap found and it accrues loss daily.**

A8. Retailer churn is a normal operating condition

Section 8 gives the qualifying rules for adding a retailer. Nothing covers losing one, and four departures or rotations have occurred in ten weeks from three distinct causes across two networks.

**Amendment: add a departure doctrine to section 8, pointing at the runbook. The principle worth stating: anything that only works when a departure is treated as exceptional will fail on the next one. Losing a retailer is now an expected event with a defined sequence, not an incident.**

A9. Section 16 needs the conventions that emerged

The operating principles are correct and incomplete. Nine conventions were established over the last fortnight, each from a real failure, and they belong in the strategy document because they govern how work is done rather than what work is done.

- A defensive clause never fails loudly when it is a no-op. Only reading the resulting state proves it did something. Five instances: GRANT that restricted nothing, REVOKE that left PUBLIC, ALTER DEFAULT PRIVILEGES that cannot strip PUBLIC EXECUTE, ON CONFLICT with no constraint, a test suite that ran no tests.

- A check that does not run is not a check, and a guard nobody has watched fail is not known to be a guard. Prove it bites before trusting it.

- A guard that fires wrongly is as damaging as one that never fires, and worse in one way: it trains the habit of dismissal.

- Anything phrased pending, awaiting, open or not yet done carries the date it was written. A stale finding is believed; a stale request solicits, and converts a reader's diligence into rework.

- Delete a stale request. Retitle a stale finding that still justifies something live.

- Absent records are found only by looking; stale ones by tripping over them. Discussing a thing at length produces the same familiarity as having documented it.

- A migration must never compute its own scope. Explicit lists, not predicates.

- Code written to tolerate a data condition is a record that the condition exists, and it is the record nobody reads as one.

- Reported state diverges from actual state. Verify against the live system, not against a summary.

What needs no change

The strategic spine in section 5, the prioritisation test in section 6, the two-tier retailer and brand hub models, the volume-gating doctrine, the editorial register, the channel ranking, the claims discipline, and the whole of sections 13 to 15 on FindMyLook. Section 17's open questions all remain open and none has been answered by this fortnight's work.

*One observation rather than an amendment. Applying section 6's own prioritisation test, almost none of the last fortnight moved comparison depth, the share of visitors reaching the mechanic, or the share clicking out. That was defensible, because the work was trust-critical and much of it was fixing things that were wrong rather than absent. But the test exists to be applied, and it is worth noticing before the next fortnight is planned the same way.*

*Brand rules: never use the word beginning "cheap" for lowest cost. No em dashes. British English. Multiple UK retailers, not every UK retailer. Savings as ranges only. Commission rates internal only.*

---

## Provenance of the A3 and A5 corrections

**Both were raised as editorial notes at commit time on 3 August 2026 and have since been
promoted into the amendment text above.** A note at the foot of a file is read by whoever
reads to the foot; these were corrections to the text, so they belong in it. Recorded here
because how they were found is worth seeing.

| Correction | Found by |
|---|---|
| **A3** gained the `products_active` qualifier, and the 12,010 row | Re-measuring all four figures against the live database instead of accepting them. Three reproduced exactly. The fourth turned out to have two readings, so **A3's own argument applied to A3**: the amendment demanding stated denominators carried an unstated one. |
| **A5** now reads *rolling and undocumented* rather than *documented* | Checking the claim against `~/amazon-api-watch/README.md`, which grades the threshold SUPPORTED, NOT CONFIRMED. The original wording came from a third-party article and an FAQ, not from Amazon: its own onboarding page 404s. |

**Neither changes a strategic conclusion.** A2's 86.4 per cent single-stockist figure is
unaffected, and A5's argument about conditional access is slightly strengthened by the
correction. What changes is what may be quoted outward and relied upon.
