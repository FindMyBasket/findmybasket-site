# Supplements backfill — the review list

**Prepared 11 August 2026. Per `docs/supplements-definition.md` v1.1.**
**111 rows, every one pre-verdicted. This is a confirmation pass, not a research exercise.**

Nothing here has been applied. No product has been recategorised, no classifier changed.

---

## First: the two lists do different jobs and must not be confused

**This is the finding, and it sits above the instance because getting it wrong deletes
products.**

| List | Where | What it does | Failure if a term is added wrongly |
|---|---|---|---|
| `EXCLUDE_PATTERNS` | `_shared/categorisation.ts` | **Drops the row at import.** The product never enters the catalogue | Add `chocolate` here and every chocolate-flavoured collagen powder **disappears** |
| *(proposed)* supplement detection | classifier, post-import | **Routes a row already inside** to `supplements` | Add `chocolate` here and a few products are filed under the wrong category — visible and reversible |

**Same vocabulary. Opposite jobs. One is destructive and one is not.**

The names must make that obvious, because the next person adding a term will reach for
whichever they saw first. Proposed:

- `EXCLUDE_PATTERNS` → **`DROP_AT_IMPORT_PATTERNS`**
- the detection list → **`ROUTE_TO_SUPPLEMENTS_PATTERNS`**

A reader who sees `DROP_AT_IMPORT` cannot mistake it for a routing rule. The current name
says what is excluded, not *from where*, and "excluded from supplements" and "excluded from
the catalogue" are the two readings that matter.

**The detection list is deferred**, and rightly: 111 rows do not justify it, and the Boots
path-first work will change what the classifier is even for. The naming decision should be
made now regardless, because it is free before either list is edited.

---

## Nothing needs recategorising

All 12 confirmed topicals are **already `skincare`**, which is correct for a sunscreen, a
cleansing whip, a micellar water, three topical capsule products and a collagen ball. The
single sports row in `makeup` is a lip gloss, also correct.

**Excluding them from the backfill is the complete action.** There is no orphaned row and no
follow-on recategorisation, because none of them is in the wrong place today — they were
only ever wrong as *candidates for supplements*.

---

## Group 1 — TOPICAL. Exclude from the backfill. (12)

Leave as `skincare`.

| id | Brand | Name | Now | Why |
|---|---|---|---|---|
| 125599 | Beauty of Joseon | Relief Sun Rice + Probiotic SPF50+ [DEAL] | skincare | `probiotic` is an ingredient, not a dose form |
| 125565 | Beauty of Joseon | Relief Sun Rice + Probiotic SPF50+ [Top Pick] | skincare | same |
| 18560 | Beauty of Joseon | Relief Sun Rice + Probiotic SPF50+ 10ml | skincare | same |
| 7092 | Beauty of Joseon | Relief Sun Rice + Probiotic SPF50+ 50ml | skincare | same |
| 122696 | Beauty of Joseon | Relief Sun Rice + Probiotic SPF50+ 50ml ×2 | skincare | same |
| 17039 | Beauty of Joseon | Relief Sun Rice + Probiotic Set 50ml ×2 | skincare | same |
| 89850 | By BEAUTY BAY | Prebiotic Cleansing Whip 100ml | skincare | `prebiotic` ingredient; `whip` not vetoed |
| 5474 | Vianek | Prebiotic & Glow Vitamin C Micellar Water 400ml | skincare | same; `micellar` not vetoed |
| 98088 | Elizabeth Arden | RETINOL + HPR Ceramide Capsules 30pc | skincare | topical single-dose capsule |
| 98089 | Elizabeth Arden | RETINOL + HPR Ceramide Capsules 60pc | skincare | same |
| 98090 | Elizabeth Arden | RETINOL + HPR Ceramide Capsules 90pc | skincare | same |
| 83544 | KSECRET | SEOUL 1988 Boosting Ball : Collagen | skincare | brand format word |

**Rule changes these imply** (for PR 1): demote `probiotic`/`prebiotic` from standalone form
words; add `sunscreen|spf|micellar|whip` to the topical veto; extend the existing
`capsuleIsTopical` escape (`categorisation.ts:300`) with `retinol|ceramide|ampoule`.
`Boosting Ball` is genuinely one-off and belongs on a short residue list.

---

## Group 2 — REVIEW. Judgement calls, 5 rows.

| id | Brand | Name | Now | Question |
|---|---|---|---|---|
| 141504 | Eve Lom | Youth Radiance Recovery Capsules — **Ampoules** | skincare | Name says Ampoules. Topical? |
| 82770 | mixsoon | Collagen Powder 100mg × 10 sticks | skincare | 100mg reads topical |
| 1360 | mixsoon | Collagen Powder (3g) | skincare | 3g reads topical |
| 134979 | Elemis | Skin Bliss Capsules 14 Capsules | skincare | Ingestible on balance |
| 147113 | Oskia | Super C Smart Nutrient Beauty Capsules 60 | skincare | Ingestible on balance |

If all five go topical, the backfill is 94. If all five go supplements, 99.

---

## Group 3 — SPORTS. Backfill to `supplements` / `sports`. (11)

| id | Brand | Name | Now |
|---|---|---|---|
| 138183 | Ancient + Brave | True Creatine+ Powder | skincare |
| 138184 | Ancient + Brave | True Creatine+ Sachets | skincare |
| 139329 | DALUMA | Energy Drink — Clean Caffeine BCAA | skincare |
| 86132 | Dose & Co | Collagen Protein Powder Chocolate | skincare |
| 86130 | Dose & Co | Collagen Protein Powder Vanilla | skincare |
| 137465 | Equi London | Creatine Edition 30 days | skincare |
| 91184 | KIKI Health | Creatine Monohydrate 120 Vegicaps | skincare |
| **21290** | **NYX Professional Makeup** | **This Is Juice Gloss Electrolyte Infused Color** | **makeup** |
| 142688 | Puori | CP2 Whey Collagen Powder | skincare |
| 142689 | Puori | Creatine+ Performance Support | skincare |
| 142691 | Puori | PW1 Grass-fed Whey Protein | skincare |

**21290 is a lip gloss** — `electrolyte` used as marketing copy. Exclude; it is correctly
`makeup` already. That leaves 10 genuine sports rows.

---

## Group 4 — SUPPLEMENTS. Backfill. (83)

All currently `skincare` except where marked `hair`.

| id | Brand | Name | Now |
|---|---|---|---|
| 139142 | Aime | Balance & Glow | skincare |
| 139151 | Aime | Clear Glow 30 capsules | skincare |
| 139150 | Aime | Collagen Glow Powder | skincare |
| 139137 | Aime | French Glow | skincare |
| 139138 | Aime | Hair & Scalp Boost | **hair** |
| 139149 | Aime | Matcha Glow Collagen Powder | skincare |
| 139136 | Aime | Pure Glow | skincare |
| 139167 | Aime | The tripeptide collagen Powder | skincare |
| 138175 | Ancient + Brave | Cacao + Collagen | skincare |
| 138176 | Ancient + Brave | Coffee + Collagen | skincare |
| 138178 | Ancient + Brave | Matcha + Collagen | skincare |
| 138171 | Ancient + Brave | True Collagen | skincare |
| 138172 | Ancient + Brave | True Collagen Sachets | skincare |
| 138190 | Ancient + Brave | True Skin Alchemy Jar | skincare |
| 138177 | Ancient + Brave | Wild Collagen | skincare |
| 138182 | Ancient + Brave | Wild Collagen Sachets | skincare |
| 142136 | Avea | Collagen Activator Powder | skincare |
| 140772 | casimir | The Beauty | skincare |
| 140775 | casimir | The Hair Project | **hair** |
| 142306 | Combeau | The Collagen | skincare |
| 142305 | Combeau | The Hair Essential | **hair** |
| 142307 | Combeau | The Matcha Collagen | skincare |
| 142304 | Combeau | The Skin Essential | skincare |
| 89873 | Dermatica | Collagen Complex Powder | skincare |
| 56791 | DHC | Collagen 20 Days Supply 120 tablets | skincare |
| 56779 | DHC | Collagen 60 Days Supply 360 tablets | skincare |
| 56790 | DHC | Sustained Release Biotin 60 tablets | skincare |
| 137464 | Equi London | Beauty Sleep Edition 30 days | skincare |
| 137467 | Equi London | Glow Edition 30 days | skincare |
| 137466 | Equi London | Hair Edition 30 days | **hair** |
| 140577 | FOONDIERT | Hair, Skin & Nails Support Complex | skincare |
| 96070 | Hair Gain | Hair Gain Capsules | **hair** |
| 96071 | Hair Gain | Hair Gain Capsules 3 Pack | **hair** |
| 101385 | Hair Gain | Hair Capsules + 50ml Scalp Foam | **hair** |
| 57426 | Hair Gain | Hair Capsules 60 Capsules | **hair** |
| 57427 | Hair Gain | Hair Capsules Duo Set 2 × 60 | **hair** |
| 136115 | MONDAY MUSE | The Skin — Clarity Complex | skincare |
| 141697 | myBlend | NUTRI GLOW PRO COLLAGEN | skincare |
| 137403 | Ogaenics | Beauty Base Skin Hair Nails Komplex | **hair** |
| 137412 | Ogaenics | BEAUTY FUEL Skin Radiance Komplex | skincare |
| 137404 | Ogaenics | HAIRLELUJA Super Hair Komplex | **hair** |
| 137402 | Ogaenics | Oilalala Skin Omega-Komplex | skincare |
| 137400 | Ogaenics | Timeless Skin Anti-Wrinkle Komplex | skincare |
| 24676 | Philip Kingsley | Density Healthy Hair Complex Capsules 60 | **hair** |
| 88222 | Philip Kingsley | Density Healthy Hair Complex Supplements | **hair** |
| 138945 | Proceanis | Arctic Marine Collagen Powder | skincare |
| 138942 | Proceanis | Collagen Drink Mono bottle | skincare |
| 138944 | Proceanis | Collagen Drink Traveller | skincare |
| 138943 | Proceanis | Day & Night Hyaluron + Collagen Drink | skincare |
| 142686 | Puori | CP1 Pure Collagen Peptides | skincare |
| 96500 | Solgar | Biotin 300mcg 100 Tablets | skincare |
| 97106 | Solgar | Biotin 5000µg Vegetable Capsules 100 | skincare |
| 96498 | Solgar | Biotin 5000mcg 50 Tablets | skincare |
| 96492 | Solgar | Collagen Hyaluronic Acid Complex 30 Tablets | skincare |
| 96496 | Solgar | Skin, Nails and Hair Formula 120 Tablets | **hair** |
| 96497 | Solgar | Skin, Nails and Hair Formula 60 Tablets | **hair** |
| 138312 | The Nue Co. | Skin Filter | skincare |
| 138313 | The Nue Co. | Skin Hydrator | skincare |
| 24917 | Vida Glow | Advanced Repair Clear 30 Capsules | skincare |
| 24911 | Vida Glow | Advanced Repair Hairology 30 Capsules | skincare |
| 24915 | Vida Glow | Advanced Repair Radiance+ 30 Capsules | skincare |
| 98134 | Vida Glow | Collagen Liquid Advance 15 × 12.4g | skincare |
| 98458 | Vida Glow | Collagen Liquid Advance 15 × 12.4g Double | skincare |
| 103143 | Vida Glow | Multi 360 — 30 Capsules | skincare |
| 24921 | Vida Glow | Natural Marine Collagen 90 × 3g Original | skincare |
| 24913 | Vida Glow | Natural Marine Collagen Sachets Blueberry | skincare |
| 24914 | Vida Glow | Natural Marine Collagen Sachets Mango | skincare |
| 24920 | Vida Glow | Natural Marine Collagen Sachets Original | skincare |
| 24919 | Vida Glow | Natural Marine Collagen Sachets Peach | skincare |
| 24916 | Vida Glow | Natural Marine Collagen Sachets Pineapple | skincare |
| 88557 | Vida Glow | Natural Marine Collagen Sachets Blueberry | skincare |
| 88556 | Vida Glow | Natural Marine Collagen Sachets Mango | skincare |
| 88536 | Vida Glow | Natural Marine Collagen Sachets Original | skincare |
| 98457 | Vida Glow | Natural Marine Collagen Sachets Original 3M | skincare |
| 88538 | Vida Glow | Natural Marine Collagen Sachets Peach | skincare |
| 103100 | Vida Glow | Natural Marine Collagen Sachets Pineapple | skincare |
| 24922 | Vida Glow | Pro Collagen+ Sachets Original | skincare |
| 24918 | Vida Glow | Women's Health Gut Pro 30 Capsules | skincare |
| 98136 | Vida Glow | Women's Health Destress 60 capsules | skincare |
| 97777 | Vital Proteins | Collagen Peptides Sachets 10×10g | skincare |
| 97778 | Vital Proteins | Marine Collagen Sachets 10×10g | skincare |
| 137834 | WelleCo | The Collagen Elixir Powder | skincare |
| 137835 | WelleCo | The Skin Elixir | skincare |

---

## Totals

| | rows |
|---|---|
| Backfill to `supplements` | **83** |
| Backfill to `supplements` / `sports` | **10** (after excluding the NYX gloss) |
| **Backfill total** | **93** |
| Exclude — topical, already correctly `skincare`/`makeup` | 13 |
| Review — judgement calls | 5 |
| **Population examined** | **111** |

Backfill lands between **93 and 98** depending on the five review rows.

**Version discipline:** 99 was v1.0; 110/111 is v1.1; **93–98 is v1.1 after the veto fix.**
Quote the version with the number.

## Subcategory question, still open

The 83 split roughly **46 collagen / 28 hair-skin-nails complexes / 4 biotin / 5 other**.
There is **no vitamins bucket** — zero rows carry a vitamin signal without a beauty one.
Whether `collagen` and `complex` earn separate subcategories at 46/28 is the live question;
`sports` is settled.
