# Standing rule: a count of a defect population is an upper bound until some of it has been read

**Recorded:** 5 September 2026, from one thread that corrected itself downward five times.

## The rule

**Any count of "how many things are wrong" is an UPPER BOUND until individual members
of that population have been read.** Quote it as a ceiling, price work off the read
sample, and never treat the aggregate as the finding.

## Why it is always downward

An aggregate over a population nobody has read **over-counts by construction**. Every
member that is ambiguous — that a person looking at it would classify as fine, or as a
different defect, or as undecidable — **is silently included**, because a filter cannot
abstain. There is no corresponding force adding false negatives at the same rate: a
filter narrow enough to miss real cases is usually narrow enough to notice.

So the error is not random. **It has a direction, and the direction is up.**

## The instance that produced the rule

One question — *"do retailers disagree about barcodes, and does it mean the grouping is
wrong?"* — measured six times, correcting downward at every step:

| | count | what the previous count had included |
|---|---|---|
| 1 | **12,698** | offers from **inactive** retailers |
| 2 | **4,272** | zero-padding (UPC-12 against EAN-13) counted as disagreement |
| 3 | **1,086** | — the real disagreement population |
| 4 | **150–190** | a price-spread proxy measuring *"something is wrong here"*, not grouping |
| 5 | **19** | products whose expensive side was a *cluster* |
| 6 | **0 confirmed, 2 candidates** | — |

**Every step came from reading rows rather than refining the aggregate.** Work-list
items 589–592.

## The step that matters, and what it nearly cost

Step 5 → 6. Fifteen of the nineteen were **one product, correctly grouped**:

```
COSRX Aloe Soothing Sun Cream 50ml
  Stylevana     £5.93 [761373892776]   <- Stylevana's own relabeller code
  YesStyle      £6.17 [8809416470191]
  Beauty Flash  £22   [8809416470191]  <- SAME BARCODE
  Gorgeous Shop £22   [8809416470191]  <- SAME BARCODE
```

Three offers on one barcode across a 3.6x spread: **Asian importers at £6, UK stockists
at £22.** That is not a defect. **It is precisely what the platform exists to show.**

> **AN AUDIT FOR OVER-GROUPING CANNOT DISTINGUISH A WRONGLY-MERGED PAIR FROM A GENUINELY
> WIDE PRICE RANGE**, because both look like two clusters in one id — **and the wide range
> is the product rather than the defect.** The signal the audit is built on is the same
> signal the product legitimately produces.

**Nothing in the data would have objected to splitting them.** No test, no constraint, no
later check. **Reporting each case for approval rather than acting on the count is what
caught it** — and the fifteen sat on the catalogue's best-covered brand, so the damage
would have been to the comparisons that work best.

## How to apply

1. **Never price work off an unread count.** "N are wrong" sizes an investigation, not a fix.
2. **Read before proposing, and propose per-case rather than per-population.** If the
   proposal is a script over N rows, the count must have been read; if it is a list for
   approval, it need not be.
3. **State the ceiling as a ceiling.** "At most N, of which we have read k" is honest and
   the same length as the sentence that misleads.
4. **Expect the number to fall.** If a defect count survives contact with its own rows
   unchanged, that is unusual enough to check the reading rather than celebrate the count.
5. **Ask what the audit's signal looks like when the system is working.** Where that is
   indistinguishable from the defect, the audit cannot conclude alone — it can only
   nominate.

Related: `docs/standing-rule-frozen-catalogue-state.md` (the other rule that exists
because a plausible value is not a true one).
