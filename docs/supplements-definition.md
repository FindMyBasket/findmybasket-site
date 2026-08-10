# Supplements: the category definition

**VERSION 1.2** — 10 August 2026. **The name rule classifies the CATALOGUE ONLY. Imports
classify on the retailer's path.** See "Implementation" below — this is the most important
section in the file and it exists because the rule was tested on feed rows and failed.

**VERSION 1.1** — 10 August 2026. Rule 2 resolved: **sports nutrition is IN scope.**
Supersedes v1.0 (9 August). Figures measured under v1.0 are not wrong, they answered a
narrower question — quote the version with the number.

**Written 9 August 2026, BEFORE any count was recorded against it.** That ordering is
deliberate and is the point of the file. Two counts produced earlier the same day —
4,481/1,383 and 1,104/168 — differed four-fold because both definitions were implicit, and
a definition written after seeing numbers gets shaped by them.

**Any figure quoted for this category must cite this file.** A category count without its
definition is the same defect as a comparable count without its denominator
(`docs/canonical-comparison-depth.md`), and that cost us twice in one day.

---

## Two rules, deliberately separate

They answer different questions and a future reader must be able to change one without
touching the other.

| | Question | Changes when |
|---|---|---|
| **Rule 1 — DEFINITION** | What *is* a supplement? | Never, ideally. It is a fact about products |
| **Rule 2 — SCOPE** | What belongs on *this platform*? | Commercial strategy changes |

**Protein powder is a supplement under Rule 1 and out of scope under Rule 2.** Both
statements are true at once. Collapsing them is how "is it a supplement" and "should we
sell it" become the same argument, and then neither can be settled.

---

## Rule 1 — the definition

> **A supplement is a product taken orally, whose claimed benefit is nutritional or
> physiological rather than delivered by contact with the surface it is applied to.**

**Route is the discriminator, not ingredient and not claim.** Collagen is collagen; a
collagen drink is a supplement and a collagen face cream is skincare. This is the only test
that stays stable as marketing language moves.

Three conditions, all required:

1. **Ingestible form.** Explicit supplement vocabulary — `supplement(s)`, `multivitamin`,
   `probiotic`, `prebiotic`, `capsules`, `tablets`, `softgels`, `gummies`, `effervescent`,
   `lozenges` — **or** an actives noun (`collagen`, `biotin`, `keratin`) bound within ~30
   characters to an ingestible carrier (`powder`, `drink`, `sachets`, `shots`).
2. **No topical veto.** Any applied-product noun disqualifies, whatever else the name says.
3. **Swallowed, not held.** The product leaves the mouth going down. See oral care below.

### Tokens that must NOT be used alone

Learned by measurement today, each having produced a visible false positive:

| Token | Why it fails alone | Example admitted in error |
|---|---|---|
| `shot` | appears in shade names | TirTir Waterism Glow Mini Tint — **05 Scotch Shot** |
| `liquid` | appears in foundations | Maybelline Dream Radiant **Liquid** With HA & Collagen |
| `sachet` | appears in sample sizes | innisfree Retinol Skin Booster Ampoule **Sachet** 1ml |
| `capsule` | is a topical dose form too | Elizabeth Arden RETINOL + HPR Ceramide **Capsules** |
| `vitamin [a-k]` | matches topical actives | **Vitamin C** Serum |

The last two are the hard ones: `capsules` is genuinely ambiguous, and a name-based rule
cannot fully resolve it. **Single-dose topical capsules are a known residual false-positive
class.** Excluding them needs an actives-plus-form veto (`retinol|ceramide|serum` +
`capsules` → topical) and that rule is proposed, not yet applied.

---

## The four edge cases

Resolved here so the first import does not decide them by accident.

### Oral care → NEITHER. Its own category.

Toothpaste, mouthwash, floss, whitening strips. **Not supplements** — they are held in the
mouth and expelled, so they fail "swallowed, not held". **Not skincare** — the surface is
not skin. They are a third thing and should be categorised as such rather than forced into
either. Several retailers already exclude them by name (`mouthwash`, `toothpaste`,
`dental` appear in Stylevana's and YesStyle's `category_excludes`), which is consistent
with treating them as out of scope, not with treating them as supplements.

### Lip products → TOPICAL.

Lipstick, balm, gloss, oil, tint. Partly ingested in practice and unambiguously cosmetic in
purpose. **The claimed benefit is delivered by contact with the lip surface**, which is the
Rule 1 test, and incidental swallowing does not change what the product is for. Skincare or
makeup by product type; never supplements.

### Beauty drinks and shots → SUPPLEMENTS. The clearest members.

Collagen drinks, beauty shots, ingestible sachets. Swallowed, systemic claim, nothing
topical about them. **These are the category's core**, and any definition that excludes them
is wrong. Note the form tokens are unreliable alone (above), so they qualify via the
actives-bound-to-carrier clause: `collagen … drink`, `marine collagen … sachets`.

### Devices and tools → NEITHER.

LED masks, cleansing brushes, derma rollers, massagers. Not ingested and not a formulation.
**They currently sit in skincare** (LYMA Laser Pro, Déesse Pro LED Mask, MZ Skin LightMAX
all categorise as `skincare` today) and this file does not change that — it records that the
placement is a **known compromise**, not a considered decision, and that devices are a
fourth thing whenever someone scopes them properly.

---

## Rule 2 — scope

Rule 1 says what a supplement is. This says which supplements belong here.

**In scope: supplements whose claimed benefit is an appearance outcome** — skin, hair,
nails, collagen, complexion, radiance, glow.

**Out of scope, though supplements under Rule 1:**

- ~~**Sports nutrition.**~~ **RESOLVED 10 AUGUST 2026 — NOW IN SCOPE.** See below.
- **General wellness with no appearance claim.** Sleep, immunity, digestion, general
  multivitamins. **This is the largest single judgement call in the whole definition —
  498 products at the loose measurement — and the one most worth challenging.**

### Sports nutrition — resolved IN, 10 August 2026

**The decision, and the reasoning, because this is the half that changes with strategy.**

MyProtein is confirmed present and in stock in the Boots feed (fid 115009). The commercial
case is **brand-direct versus reseller price variance on the same SKU**: identical products,
two sources, and heavy items where delivery thresholds bite hardest — which is the
mechanism the whole platform exists to demonstrate. It is arguably the strongest comparison
case available, because the products are identical by construction rather than by matching.

**In scope from v1.1:** protein powder, whey, creatine, pre-workout, BCAA, protein bars,
mass gainer, electrolytes.

**Still out of scope:** general wellness with no appearance *or* performance claim — sleep,
immunity, digestion, general multivitamins. That remains the largest judgement call in the
definition and is still open.

**Note what this did NOT change.** Rule 1 is untouched. Protein was always a supplement
under Rule 1 — ingested, systemic claim, not topical. Only the commercial gate moved, which
is precisely why the two rules are kept apart.

**Scope is commercial and reversible. The definition is not.** Rule 2 has now changed once
and Rule 1 has not; that is the intended asymmetry.

---

## What the definition costs, measured

Run against the catalogue on 9 August 2026, roots only:

| Stage | Remaining | Removed by this stage |
|---|---|---|
| Loose ingestible-form token | 1,331 | — |
| − topical veto | 682 | **649** |
| − general wellness (Rule 2) | 184 | 498 |
| − sports nutrition (Rule 2) | 183 | 1 |
| − tightened form tokens | **99** | 84 |

**1,331 → 99. The definition removes 93% of what a loose regex admits**, which is the whole
reason two people counting without one differed four-fold.

**Headline figures, valid only when cited with this file AND its version:**

| | v1.0 (9 Aug) | **v1.1 (10 Aug)** |
|---|---|---|
| Products in scope | 99 | **110** |
| — of which sports nutrition | n/a (excluded) | **11** |
| Live in `products_active` | — | **108** |
| Comparable at 2+ active retailers | 27 | **27** |

**Widening Rule 2 to sports nutrition added 11 catalogue products and zero comparable
ones.** That is not an argument against the decision — the case rests on Boots feed
inventory that is currently excluded at import, not on what is already in the catalogue —
but it does mean **the sports-nutrition case is entirely dependent on the Boots path change
landing.** Nothing in the catalogue today demonstrates it.

Known residual: topical single-dose capsules (above), which would take 99 lower.

---

## Consequence: `EXCLUDE_PATTERNS.supplements` now contradicts Rule 2

The shared denylist in `_shared/categorisation.ts` reads:

```
["supplement", /\b(supplement|vitamin tablet|capsule|gummies|protein shake|
                  meal replacement|powder drink|fish oil|cod liver oil|
                  effervescent tablet)\b/]
```

**`protein shake` and `meal replacement` are named explicitly, and under v1.1 both are in
scope.** The regex was written when sports nutrition was out; it now removes products the
definition admits.

**This must change in the same commit as the path allowlist, not after.** Opening the Boots
path while the regex still catches `protein shake` launches the category with a hole in
exactly the products the sports-nutrition case rests on — the same failure already measured
for beauty supplements, where the regex drops 274 of 941 admitted rows including the entire
Imedeen line. Two switches, one decision, as recorded in work-list item 53.

The regex also still needs its topical-capsule carve-out (`categorisation.ts:300`), which is
unaffected by v1.1 and should not be disturbed.

## Implementation: PATH-FIRST FOR IMPORTS, name rule for the catalogue

**THE NAME RULE IS FITTED TO THE BEAUTY CATALOGUE, NOT TO THE CONCEPT.** It scored 32 of 34
on a random catalogue sample it was not written from — a real result — and then failed in
three directions on 2,415 raw Boots rows from
`Health & Beauty > Health Care > Fitness & Nutrition` and `… > Medicine & Drugs`.

### The headline failure: a pharmaceutical entering a consumer category

```
SUPPLEMENT (default fired) | Viagra Connect Sildenafil 50Mg Film-Coated Tablets - 4
SUPPLEMENT (default fired) | Pregnacare Vitabiotics Original - 90 Tablets
```

**This is not a misfiled product. It is a prescription-adjacent medicine entering a consumer
supplements category through a rule that has no concept of medicine.** A name rule cannot
acquire one: "film-coated tablets" is a dosage form, and every signal the rule reads says
supplement. **This is the reason imports cannot use a name rule** — not an edge case to
patch, and not a threshold to tune.

### Why it fails: the same word means different things in the two catalogues

| Word | In the beauty catalogue | In the health catalogue |
|---|---|---|
| `oil` | facial oil — **topical** | fish oil, evening primrose oil — **ingested** |
| `gel` | gel cleanser — **topical** | soft gel capsule — **dosage form** |
| `pack` | sheet-mask pack — **topical** | pack of 10 capsules — **quantity** |

Measured misfires: `Seven Seas Evening Primrose Oil 30 Capsules`, `New Leaf Omega 3 Fish Oil
Supplements`, `Boots IBS Relief 30 Soft Gel Capsules`, `Mendurance Max Capsules 10 Pack` —
all classified **topical**, all ingested.

And in the other direction, real supplements read as not-a-supplement because bare `sachets`
was deliberately dropped as a form word (it matched sample sizes in beauty):
`Vida Glow Marine Collagen 30 x 3g Sachets`, `Zooki Marine Collagen 30x15ml Liquid Sachets`.

**A rule cannot be tuned out of this.** The words are genuinely ambiguous and only the
surrounding catalogue disambiguates them.

### PATH-FIRST IS RETAILER-SPECIFIC BY CONSTRUCTION

**This is a property of the approach, not a limitation of this instance, and it is the thing
to carry to the next retailer.**

Boots' taxonomy is Boots' own. `Health & Beauty > Health Care > Fitness & Nutrition >
Vitamins & Supplements` is a Boots string. It tells you nothing about Debenhams, Escentual or
anyone onboarded next. **Every supplements retailer needs its own path audit before its own
allowlist** — there is no shared path list and there never will be.

The trade is deliberate: a name rule generalises across retailers and is wrong (see the
sildenafil case); a path rule is right and generalises across nothing. **Per-retailer work
that is correct beats shared work that is not**, but the per-retailer work must actually be
done each time rather than assumed from the last one.

**Debenhams is the immediate case.** Its taxonomy is precisely what has kept it stale since
3 August — `merchant_product_category_path` is empty on feed 116972 and its categories live
in `merchant_category` instead. Whenever supplements reaches Debenhams it will need the same
audit from scratch, against a different column.

`.github/workflows/feed-diag.yml` sections 4-6 exist to make that audit one dispatch. Use
them; do not infer another retailer's paths from this one.

### The decision

> **Imports classify on the retailer's own taxonomy path. The name rule is a SECONDARY check
> on the result, never the classifier.**

`Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements` already
separates supplements from medicines, because the retailer separated them. That is a better
signal than any regex over names, and it is free.

### ONE PATH, NOT TWO. `Medicine & Drugs` is NOT admitted.

**MEASURED, 10 August 2026** — an earlier draft said "480 medicines", which was residual
arithmetic (595 − 115) and not a measurement. The real composition, over 600 rows:

| Rule verdict | n | What they actually are |
|---|---|---|
| not-a-supplement | **470** | first aid, topical medicines, devices, contraceptives — plasters, skin closures, TENS pads, Daktarin cream, Vicks nasal spray, Nicorette mouthspray, eye drops, heat wraps, Durex |
| SUPPLEMENT (default fired) | **115** | **oral medicines** — Combogesic Pain Relief Film-Coated Tablets, Nurofen Pain Relief Soft Capsules, Fybocalm Capsules, Viagra Connect |
| topical (both signals) | 15 | bundles pairing a tablet with a spray |

> **ACCEPTED COST, NOT AN OVERSIGHT — AND SMALLER THAN FIRST STATED.** The earlier note said
> ~115 real supplements would be forgone. **They are not supplements.** Measured, the 115
> the rule flags are ORAL MEDICINES — painkillers and prescription-adjacent products whose
> dosage form is a tablet or capsule. Excluding `Medicine & Drugs` forgoes almost nothing we
> want and avoids exactly what we must not take.
>
> **Do not reopen this as a gap.** The decision is better supported than the arithmetic that
> first justified it. If it is ever revisited the question is not "can we filter the
> supplements out" — it is "do we want medicines in the catalogue at all", which is a
> different and much larger decision.

One incidental finding worth carrying: **`MyProtein Hyrox The Electro Watermelon 291g` sits
in `Medicine & Drugs`**, not in Fitness & Nutrition. Sports nutrition is scattered across
Boots' paths, so the sports-nutrition case is not fully served by one path either.

### Retired: the truncation flag, for this population

A name ending in a short token flagged possible truncation, and on the beauty catalogue it
worked — it is how two Elizabeth Arden topical capsule products were caught.

On the Boots health feed it flagged **2,309 of 2,415 rows, 95.6%**, because Boots names end
in `40g`, `10ml`, `- 4`, `850g`. A pack size looks exactly like a cut-off word.

**Retired for this use rather than tuned**, and for the same reason as the veto: the pattern
is not wrong, it is reading a catalogue whose conventions invert its meaning. It stays valid
on beauty names.

## Recording rule

Any future count states: the number, the date, and **"per `docs/supplements-definition.md`"**.
If the definition changes, previous figures are superseded rather than corrected — they were
right about a different question.
