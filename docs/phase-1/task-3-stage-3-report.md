# Phase 1 Task 3, stage 3 — the bridge: report before building

**23 August 2026. Nothing built.** The rule is the one approved:
**`gap ≤ 1.0 × item price` AND `gap > delivery_cost`.**

---

## 1. Reach, recomputed on today's catalogue

| State | Offers | What the row should render |
|---|---:|---|
| **Prompt fires** | **19,608** | the bridge |
| Excluded — gap ≤ delivery cost | 3,834 | current delivery line only |
| Silent — gap > item price | 38,453 | current delivery line only |
| Already free | 26,875 | *"Free delivery"* |
| **Flat, no threshold** | **15,047** | **see §2 — currently renders NOTHING** |
| **Total in-stock** | 103,817 | |

**19,608 rather than the 23,482 quoted at proposal time.** 23,482 was the count before the
`gap > delivery_cost` exclusion; 3,834 fall out under it, and the remainder is catalogue drift over
a day.

---

## 2. Where a retailer publishes no threshold — and a defect found while checking

**Debenhams is `delivery_model = 'flat'`, £3.99, `delivery_threshold = NULL`. There is no free
tier, so there is no gap, so the prompt must not fire.** That was known.

**What was not known: the row renders nothing about delivery at all.**

```
{offer.delivery_cost !== null && offer.delivery_threshold !== null && … && (
  <p>…delivery…</p>
)}
```

The condition requires a **non-null threshold**. Debenhams' is NULL, so the guard fails and the
line is skipped — **on all 15,047 in-stock Debenhams offers.**

> **AND THE ASYMMETRY IS WORSE THAN THE SILENCE.** On a page where Debenhams sits beside a tiered
> retailer, every other row carries a delivery line and the Debenhams row carries none. **A reader
> comparing rows sees "+£2.95 delivery" against nothing, which reads as Debenhams having no
> delivery charge.** It has one, on every order, at every basket size.

Verified live on `/product/146238` (Debenhams-only, £16.00): the £3.99 appears **only** in the
headline split shipped in stage 1 — *"£16.00 item + £3.99 delivery"* — and nowhere on the row.
Before stage 1 it appeared nowhere on the page at all.

**Proposed for the flat case, and it is not a prompt:**

> *"£3.99 delivery on every order"*

**It states the term and makes no offer.** No threshold is named because none exists, and nothing
implies a basket size would change it.

**This is a real defect independent of the bridge**, and it was reached only because the bridge
forced the question "what renders where there is no threshold?".

---

## 3. The prompt's wording, under item 248's rule

**The rule: the prompt states OUR ARITHMETIC, not the retailer's policy.**

The gap is ours — it is `threshold − price`, a subtraction we perform. The threshold is theirs.
So the sentence should lead with the number we computed and cite the term as theirs.

| | Wording | Verdict |
|---|---|---|
| ✗ | *"Spend £9.05 more and Boots will deliver free"* | predicts a retailer's behaviour at checkout |
| ✗ | *"You qualify for free delivery at £25"* | asserts eligibility we cannot confirm |
| ✗ | *"Add one more item for free delivery"* | prescribes, and assumes a second item exists at that price |
| **✓** | **"£9.05 below Boots' £25 free-delivery threshold"** | states the subtraction and attributes the threshold |

**The proposed line, for decision:**

> **£9.05 below Boots' £25 free-delivery threshold**

Neutral, checkable against the two numbers already on the row, and it makes no claim about what
happens at their checkout.

### A provenance gap the rule exposes

Item 248 says we may state *"terms read from their site on this date"*. **We cannot currently say
that**, because we did not record it:

| `delivery_terms_source` | Retailers |
|---|---|
| `(none recorded)` | **Boots, Beauty Flash, Gorgeous Shop, Escentual, Beauty Bay, The Organic Pharmacy, Stylevana, YesStyle, Perfume Click, Debenhams — 10 of 11** |
| `checkout` | Niche Beauty |

> **The prompt would cite a threshold on 19,608 offers whose provenance is unrecorded for 10 of
> the 11 active retailers.** The column exists and is populated for exactly one of them.
>
> **This does not block the bridge** — the thresholds are almost certainly correct, and the
> £3.95/£25 pattern is consistent with Boots' published terms. **But it is the same gap item 248
> is about**, one step earlier: we would be stating a retailer's term without having recorded
> where we read it. And a term nobody dated is a term nobody can re-check.

**Recorded, not fixed. It is a data task, not a rendering one**, and it should not be folded into
stage 3.

---

## 4. What stage 3 would render, in full

| State | Offers | Row renders |
|---|---:|---|
| tiered, gap ≤ price, gap > cost | 19,608 | delivery line **+ "£X below {retailer}'s £Y free-delivery threshold"** |
| tiered, gap ≤ cost | 3,834 | delivery line only |
| tiered, gap > price | 38,453 | delivery line only |
| tiered, at/over threshold | 26,875 | *"Free delivery"* |
| **flat** | **15,047** | **"£3.99 delivery on every order"** ← new |
| unknown terms | 0 active | nothing, and no inference |

**Plus:** add-to-routine replacing add-to-basket **with a persistent count**, and adding from a
product page routing to `/app?routine=` with the optimiser run.

---

## 5. Two things I would want settled before building

**(a) Does the prompt appear on every qualifying row, or only the best one?** 19,608 offers across
however many pages — on a two-row page both rows could qualify with different gaps, and two
bridges on one page compete. **My inclination is best-priced row only**, but that is a product
call and the acceptance criterion says *"every in-stock row with a published threshold and a gap
renders the prompt"*, which reads as all of them.

**(b) The count on the add-to-routine control is client state.** `RoutineIndicator` already reads
`getRoutine().length` from localStorage and is rendered on every page. **A second count on the
button is a second reader of the same store** — they cannot disagree today because both subscribe
to `onRoutineChange`, but it is worth deciding whether the button shows a count or defers to the
pill that already does.

**Nothing built. Awaiting the wording decision, (a), and (b).**
