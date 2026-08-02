# Standing rule: copy must not freeze catalogue state

**Recorded:** 2 August 2026, from three instances that surfaced in two days.

## The rule

Any copy that freezes a catalogue value will drift, and nothing will detect it.
Catalogue state means **prices, retailer names, product IDs, and counts** of any
of those.

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

## The three instances

| Instance | Frozen state | How it failed |
|---|---|---|
| Branded Beauty affiliate deep links | Retailer programme status | The AWIN wrapper returned **HTTP 200** with a closed-merchant page. Nothing that watches error rates could catch a 200. Found 1 August during the clickout diagnosis. |
| Hardcoded product IDs in evergreen Pinterest pins | Product IDs | 13,828 catalogue IDs are merged or reparented and resolve to nothing. A pin set live today accrues that exposure over its whole life. An unresolvable ID vanished from a preloaded routine with no message at all. |
| Homepage demo basket (`public/index.html`) | Prices and retailer names | Shipped "Boots + Superdrug" for thirteen days after Superdrug was retired on 27 July 2026. Rewritten 1 August with fresh prices and two different retailer names, which documented the hazard in its own comment and then reproduced it. Rewritten again 2 August to structure only. |

## Handling further instances

**Flag them, do not fix them inline.** These sit in other people's work and in
other briefs; folding a copy fix into an unrelated change is how the audit trail
for both gets lost. Record the instance, name the frozen value, and let it be
scheduled.

## Open

This rule currently lives on its own. `docs/post-4-august-work-list.md` item 4
("Standing rules", detail OWED, blocked until after 4 August) may consolidate the
brand and copy standing rules that are presently a trailing paragraph in
`docs/dashboard-build-brief.md`. Whether this file folds into that is not
established and should not be assumed. If it does, keep the three instances:
they are the evidence the rule rests on.
