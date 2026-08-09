# Supplements: the category definition

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

- **Sports nutrition.** Protein, whey, creatine, pre-workout, BCAA, electrolytes. A
  different vertical with different competitors, different basket economics and different
  buyers. *Reachable* — Boots' feed carries the categories and Debenhams 116972 carries
  Applied Nutrition at 281 products — but reachable is not in scope.
- **General wellness with no appearance claim.** Sleep, immunity, digestion, general
  multivitamins. **This is the largest single judgement call in the whole definition —
  498 products at the loose measurement — and the one most worth challenging.**

**Scope is commercial and reversible. The definition is not.** If sports nutrition is
brought in later, Rule 2 changes and Rule 1 does not.

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

**Headline figures, valid only when cited with this file:**

- **99 products in scope**
- **27 comparable at two or more active retailers**

Known residual: topical single-dose capsules (above), which would take 99 lower.

---

## Recording rule

Any future count states: the number, the date, and **"per `docs/supplements-definition.md`"**.
If the definition changes, previous figures are superseded rather than corrected — they were
right about a different question.
