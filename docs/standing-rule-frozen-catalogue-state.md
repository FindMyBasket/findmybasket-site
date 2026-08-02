# Standing rule: copy must not freeze catalogue state

**Recorded:** 2 August 2026, from three instances that surfaced in two days.

## The rule

Any artefact that freezes a value owned by an external party will drift, and
nothing will detect it. That covers **prices, retailer names, product IDs, feed
IDs, merchant IDs, delivery thresholds and costs, and counts** of any of those.

The rule has two halves. **Frozen state** is a value that was true and has drifted.
**Fabricated state** is a value that was never true — a runtime default standing in
for a missing one. The second is worse, and is described below.

The rule started as a copy rule and is not one. A feed ID frozen into a migration
fails identically to a price frozen into a paragraph: config owned by somebody
else, baked into an artefact that reasserts it forever.

Two acceptable forms:

1. **Read it.** The copy queries the catalogue at build or request time, so it
   maintains itself.
2. **State the structure, not the values.** "A split across retailers can beat a
   single shop, with delivery counted" stays true whatever the catalogue does.
   "£99.25 at Escentual and Boots" does not.

There is no third form. An "example" or "illustrative" framing does not make a
frozen figure safe; it only makes it harder to argue about when it is wrong.

## Why this is a standing rule and not a bug

Every instance below failed the same way: silently, with no error, no failing
test, no alert, and no job that would ever notice. Each was found by a person
looking at something else. That is the property that makes it a rule — the
failure mode is undetectable by construction, so it has to be prevented at
writing time rather than caught later.

## A worse variant: fabricated state

Frozen state is a value that *was* true and has drifted. **Fabricated state is a
value that was never true at all** — a default standing in for a missing one, at
runtime, leaving no trace.

It is worse in the one way that matters. A frozen value is at least visible: it sits
in a file, it appears in a diff, someone can read it and ask when it was last
checked. A fabricated value appears in no diff, no migration and no record. It is
produced fresh on every render from a `??` fallback, and the only evidence it
happened is the absence of a row.

**The instance.** `retailers.delivery_threshold` is **NULL for Debenhams**, and the
optimiser substitutes `'25'` at runtime.

**It is EIGHT occurrences, not one**, and **both halves of the delivery calculation
are fabricated** — the cost default is as invented as the threshold. Full list,
enumerated 2 August 2026:

| Location | Fallback |
|---|---|
| `app/app/RoutineBuilder.tsx:392` | `delivery_threshold ?? '25'` |
| `app/app/RoutineBuilder.tsx:393` | `delivery_cost ?? '3.95'` |
| `app/app/RoutineBuilder.tsx:425` | `delivery_threshold ?? '25'` (single-retailer option) |
| `app/app/RoutineBuilder.tsx:426` | `delivery_cost ?? '3.95'` |
| `app/app/RoutineBuilder.tsx:528` | `delivery_threshold ?? '25'` (pair, leg 1) |
| `app/app/RoutineBuilder.tsx:529` | `delivery_cost ?? '3.95'` |
| `app/app/RoutineBuilder.tsx:530` | `delivery_threshold ?? '25'` (pair, leg 2) |
| `app/app/RoutineBuilder.tsx:531` | `delivery_cost ?? '3.95'` |
| `supabase/functions/send-routine-email/index.ts:187, 230, 231` | `|| 25` and `|| 3.95`, same defaults, email path |

So **every Debenhams basket total the product has ever shown — in the app and in the
monthly email — was computed against a £25 threshold that nobody set and no record
contains.** Debenhams took 17 of 288 outbound clicks in the 31 days to 1 August, and
appears in the winning split of the PIN-044 demonstration basket. If the real
threshold is not £25, every one of those answers was wrong in a way no query could
reveal, because the wrong value exists only for the microseconds it takes to compute
a total.

**Scope, checked 2 August 2026:** Debenhams is the **only** retailer with a NULL
`delivery_threshold`, and **no** retailer currently has a NULL `delivery_cost` — so
only the threshold fallback is firing today. That is luck, not design: the cost
fallback is live code on every one of those paths and will fabricate £3.95 the moment
any retailer's cost is nulled or a new retailer is onboarded without one. Bounded to
one row today; the mechanism is not bounded at all.

**The rule this adds.** A default may fill a gap, but it must not do so silently in
a value the product presents as fact. Either the column is NOT NULL with a recorded
value, or the absence is surfaced rather than papered over. Prefer a loud failure to
an invented number: a basket that declines to compute is recoverable, a basket that
quietly computes on £25 is not.

## The four instances

| Instance | Frozen state | How it failed |
|---|---|---|
| Branded Beauty affiliate deep links | Retailer programme status | The AWIN wrapper returned **HTTP 200** with a closed-merchant page. Nothing that watches error rates could catch a 200. Found 1 August during the clickout diagnosis. |
| Hardcoded product IDs in evergreen Pinterest pins | Product IDs | 13,828 catalogue IDs are merged or reparented and resolve to nothing. A pin set live today accrues that exposure over its whole life. An unresolvable ID vanished from a preloaded routine with no message at all. |
| Homepage demo basket (`public/index.html`) | Prices and retailer names | Shipped "Boots + Superdrug" for thirteen days after Superdrug was retired on 27 July 2026. Rewritten 1 August with fresh prices and two different retailer names, which documented the hazard in its own comment and then reproduced it. Rewritten again 2 August to structure only. |
| Retailer onboarding migrations | AWIN **feed IDs** and **merchant IDs** | `ON CONFLICT (retailer_id) DO UPDATE` writes `awin_feed_id` as a literal, so the migration reasserts a value AWIN owns and can rotate without notice. Worked example: AWIN rotated Gorgeous Shop (retailer 30) from **110188 to 116876**; the 2 August 06:15 import returned 404 and **6,710 in-stock rows went stale**. Re-running `20260720140000_gorgeous_shop_onboarding.sql` would write the dead ID back. |

## Handling further instances

**Flag them, do not fix them inline.** These sit in other people's work and in
other briefs; folding a copy fix into an unrelated change is how the audit trail
for both gets lost. Record the instance, name the frozen value, and let it be
scheduled.

## Open

**Cross-reference, not a merge.** `docs/post-4-august-work-list.md` item 13
("Onboarding migrations hardcode mutable config, and feed ids rotate", raised
2 August, blocked until after 4 August) describes the fourth instance above as a
class in its own right, from the migration side. It and this file are the same
rule seen from two directions. **They have deliberately not been consolidated** —
that decision belongs to whoever picks up item 13 or item 4, not to this file.

This rule otherwise lives on its own. Item 4 ("Standing rules", detail OWED, also
blocked until after 4 August) may consolidate the brand and copy standing rules
presently held as a trailing paragraph in `docs/dashboard-build-brief.md`.
Whether this file folds into that is not established and should not be assumed.
If it does, keep the four instances: they are the evidence the rule rests on.
