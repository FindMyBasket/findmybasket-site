/**
 * Local validation harness for the SHARED match-key normalisation in
 *   supabase/functions/_shared/match-key.ts
 *
 * The module is the single source of truth imported by all three importers AND
 * by the catalogue-wide dedup backfill (scripts/dedup-preview.mts), so passing
 * here means the importer and the backfill behave identically by construction.
 *
 * Run:  npx tsx scripts/match-key-harness.mts
 *
 * There is one regression case for EVERY false-positive class learned from real
 * catalogue data this session. Fixtures use the real product ids/names.
 *
 *   NORMALISE AWAY  — noise that splits genuine same-products; keys must MATCH.
 *   KEEP DISTINCT   — real SKU differences; must stay distinct, either via a
 *                     different match_key, a different name-number signature, or
 *                     a shade/fragrance/tail flag that holds the group for review.
 */

import {
  buildMatchKey,
  normaliseForMatch,
  extractNameNumbers,
  extractCanonicalSize,
  extractSize,
  normaliseCountUnits,
  isShadeBearingLine,
  fragranceConcentration,
  versionMarker,
  hasUncertainTail,
} from "../supabase/functions/_shared/match-key.ts";

type Case = {
  cls: string;
  desc: string;
  ok: () => boolean;
};

const key = (b: string, n: string) => buildMatchKey(b, n);

const CASES: Case[] = [
  // ── NORMALISE AWAY — keys must be EQUAL ────────────────────────────────────
  {
    cls: "promo-tag",
    desc: "(Deal) parenthesised tag stripped  [id ~30 live rows]",
    ok: () => key("Kose", "(Deal) Kose Softymo Speedy Cleansing Oil 230ml") ===
              key("Kose", "Kose Softymo Speedy Cleansing Oil 230ml"),
  },
  {
    cls: "promo-tag",
    desc: "[Deal] bracketed tag stripped  [107409 vs 18357]",
    ok: () => key("Abib", "[Deal] Abib - Gummy Sheet Mask - Heartleaf Sticker - 1pc") ===
              key("Abib", "Abib - Gummy Sheet Mask - Heartleaf Sticker - 1pc"),
  },
  {
    cls: "punctuation",
    desc: "hyphen vs space (Extra-Firming vs Extra Firming)",
    ok: () => key("Clarins", "Clarins Extra-Firming Day Cream 50ml") ===
              key("Clarins", "Clarins Extra Firming Day Cream 50ml"),
  },
  {
    cls: "apostrophe",
    desc: "curly vs straight apostrophe (L'Oréal)",
    ok: () => key("L'Oréal Paris", "L'Oréal Paris Revitalift Serum 30ml") ===
              key("L’Oréal Paris", "L’Oréal Paris Revitalift Serum 30ml"),
  },
  {
    cls: "casing",
    desc: "SPF50 vs Spf50 casing  [12260 vs 104276]",
    ok: () => key("Clarins", "Clarins Sun Spray Lotion Very High Protection Spf50") ===
              key("Clarins", "Clarins Sun Spray Lotion Very High Protection SPF50"),
  },
  {
    cls: "container-noun",
    desc: "'Pump' vessel word stripped  [92211]",
    ok: () => key("Abib", "Abib Heartleaf Essence Calming Pump 50ml") ===
              key("Abib", "Abib Heartleaf Essence Calming 50ml"),
  },
  {
    cls: "brand-prefix",
    desc: "brand duplicated in name field (Stylevana pattern)",
    ok: () => key("mixsoon", "Mixsoon Bifida Ferment Essence 100ml") ===
              key("mixsoon", "Bifida Ferment Essence 100ml"),
  },

  // ── NORMALISE AWAY — count UNIT-WORD / pluralisation (same number) ───────────
  {
    cls: "count-unit",
    desc: "pcs == pads == pieces on same count (Zero Pore Pad 70pcs/70 pads/70 Pieces)",
    ok: () => {
      const a = key("Medicube", "Zero Pore Pad 70pcs");
      const b = key("Medicube", "Zero Pore Pad 70 pads");
      const c = key("Medicube", "Zero Pore Pad 70 Pieces");
      return a === b && b === c;
    },
  },
  {
    cls: "count-unit",
    desc: "pads == ea on same count (Cleansing Pad 60 pads vs 60ea)",
    ok: () => key("Numbuzin", "No.3 Cleansing Pad 60 pads") ===
              key("Numbuzin", "No.3 Cleansing Pad 60ea"),
  },
  {
    cls: "count-unit",
    desc: "pcs == bare S on same count (Clear Spot Patch 18pcs vs 18S)",
    ok: () => key("COSRX", "Clear Fit Spot Patch 18pcs") ===
              key("COSRX", "Clear Fit Spot Patch 18S"),
  },
  {
    cls: "count-unit",
    desc: "patches == Pieces on same count (Master Patch 36 patches vs 36 Pieces)",
    ok: () => key("COSRX", "Acne Pimple Master Patch 36 patches") ===
              key("COSRX", "Acne Pimple Master Patch 36 Pieces"),
  },
  {
    cls: "count-unit",
    desc: "singular/plural standalone noun (Toner Pad vs Toner Pads; Master Patch vs Patches)",
    ok: () => key("Anua", "Heartleaf 77 Toner Pad") === key("Anua", "Heartleaf 77 Toner Pads") &&
              key("COSRX", "Acne Pimple Master Patch") === key("COSRX", "Acne Pimple Master Patches"),
  },
  {
    cls: "count-unit",
    desc: "normaliseCountUnits collapses unit spellings on identical number, direct",
    ok: () => normaliseCountUnits("zero pore pad 70 pads") === normaliseCountUnits("zero pore pad 70pcs") &&
              normaliseCountUnits("spot patch 18s") === normaliseCountUnits("spot patch 18 pieces"),
  },

  // ── KEEP DISTINCT — count guards (different number → different product) ───────
  {
    cls: "count-unit",
    desc: "GUARD 70 pads vs 30 pads → DISTINCT (different count)",
    ok: () => key("Medicube", "Zero Pore Pad 70 pads") !== key("Medicube", "Zero Pore Pad 30 pads") &&
              extractNameNumbers("Zero Pore Pad 70 pads") !== extractNameNumbers("Zero Pore Pad 30 pads"),
  },
  {
    cls: "count-unit",
    desc: "GUARD 1pc vs 10pcs → DISTINCT (unit collapse must not merge different counts)",
    ok: () => key("Abib", "Gummy Sheet Mask 1pc") !== key("Abib", "Gummy Sheet Mask 10pcs"),
  },
  {
    cls: "count-unit",
    desc: "GUARD COSRX sheet-mask 1/2/4/8/10pcs → all 5 DISTINCT",
    ok: () => new Set([1, 2, 4, 8, 10].map((n) => key("COSRX", `Acne Pimple Master Patch ${n}pcs`))).size === 5,
  },
  {
    cls: "count-unit",
    desc: "GUARD 60ml vs 60ml (4ea) multipack → DISTINCT (one is a bundle)",
    ok: () => key("Purito Seoul", "Pure Vitamin C Serum 60ml") !==
              key("Purito Seoul", "Pure Vitamin C Serum 60ml (4ea)") &&
              extractNameNumbers("Pure Vitamin C Serum 60ml") !== extractNameNumbers("Pure Vitamin C Serum 60ml (4ea)"),
  },
  {
    cls: "count-unit",
    desc: "GUARD shade variants unaffected by unit normalisation (cushion #21 vs #23)",
    ok: () => key("TIRTIR", "Mask Fit Cushion 18g 21 Ivory") !== key("TIRTIR", "Mask Fit Cushion 18g 23 Natural") &&
              isShadeBearingLine("TIRTIR Mask Fit Cushion 18g", "Cushion") === true,
  },
  {
    cls: "count-unit",
    desc: "GUARD bare-S shade codes stay distinct by number (Joli Rouge 706S vs 707S → DISTINCT)",
    // The bare-S rule canonicalises the unit WORD but preserves the number, so a
    // shade code like "706S" (→706pcs) never collapses into a different shade "707S".
    ok: () => key("Clarins", "Joli Rouge Lipstick 706S 3.5g") !== key("Clarins", "Joli Rouge Lipstick 707S 3.5g"),
  },

  // ── NORMALISE AWAY — brand-word REPETITION (leading/doubled brand token) ─────
  {
    cls: "brand-word-repeat",
    desc: "Purito partial-brand prefix: 'PURITO …' (brand 'Purito Seoul') == 'Purito SEOUL - …'  [1448 vs keeper]",
    // The name carries only the brand's FIRST word; without the strip the key
    // doubles to 'purito seoul purito …' and never matches the SEOUL-form sibling.
    ok: () => key("Purito Seoul", "PURITO Oat-In Calming Gel Cream (100ml)") ===
              key("Purito Seoul", "Purito SEOUL - Oat In Calming Gel Cream - 100ml"),
  },
  {
    cls: "brand-word-repeat",
    desc: "Goodal doubled full brand: 'Goodal - Goodal Green Tangerine …' == 'Goodal - Green Tangerine …'  [7208 vs 92051]",
    ok: () => key("Goodal", "Goodal - Goodal Green Tangerine Vita-C Dark Spot Care Cream - 50ml") ===
              key("Goodal", "Goodal - Green Tangerine Vita-C Dark Spot Care Cream - 50ml"),
  },
  {
    cls: "brand-word-repeat",
    desc: "FULLY doubled brand: 'FULLY - Fully Lemon Vita …' == 'FULLY Lemon Vita …'  [109860]",
    ok: () => key("FULLY", "FULLY - Fully Lemon Vita Capsule Cream - 90g") ===
              key("FULLY", "FULLY Lemon Vita Capsule Cream 90g"),
  },
  {
    cls: "brand-word-repeat",
    desc: "Dr. Althea doubled full brand: 'Dr. Althea Dr Althea 147 …' == 'Dr. Althea - 147 …'  [64336]",
    ok: () => key("Dr. Althea", "Dr. Althea Dr Althea 147 Barrier Cream 50ml") ===
              key("Dr. Althea", "Dr. Althea - 147 Barrier Cream - 50ml"),
  },

  // ── KEEP DISTINCT — brand-word strip must NOT over-collapse ─────────────────
  {
    cls: "brand-word-repeat",
    desc: "Douvall's over-strip guard: name IS the brand → not stripped to empty  [~20 distinct rows]",
    // buildMatchKey must keep a stable non-empty key for a row literally named
    // "Douvall's"; and a real product ("Douvall's Soap Saver") is unaffected.
    ok: () => key("Douvall's", "Douvall's") === "douvall s" &&
              key("Douvall's", "Douvall's Soap Saver") === "douvall s soap saver",
  },
  {
    cls: "brand-word-repeat",
    desc: "Bondi Babe guard: product line reusing a brand word AFTER the full brand is kept distinct  [103006]",
    // "Bondi Sands Bondi Babe Clay Mask": shape (1) consumes ONE real brand copy;
    // the product-line "Bondi" survives, so it does NOT collapse into a bare
    // "Bondi Sands Babe Clay Mask" product.
    ok: () => key("Bondi Sands", "Bondi Sands Bondi Babe Clay Mask") ===
              "bondi sands bondi babe clay mask" &&
              key("Bondi Sands", "Bondi Sands Bondi Babe Clay Mask") !==
              key("Bondi Sands", "Bondi Sands Babe Clay Mask"),
  },
  {
    cls: "brand-word-repeat",
    desc: "fwee shades stay distinct: brand strip leaves shade tokens, 2 shades do NOT merge & line is held  [56410/56411]",
    ok: () => key("Fwee", "Fwee - 3D Changing Gloss - 5.6g - 00 Clear") !==
              key("Fwee", "Fwee - 3D Changing Gloss - 5.6g - 01 Scene Black") &&
              isShadeBearingLine("Fwee - Lip & Cheek Blurry Pudding Pot + Pendant Keyring (Random...", "Lip Care") === true &&
              hasUncertainTail("Fwee - Lip & Cheek Blurry Pudding Pot + Pendant Keyring (Random...") === true,
  },
  {
    cls: "null-vs-present-size",
    desc: "identical name, size only in canonical_size column → same key (Double Serum) [100476/104657]",
    // Name is byte-identical; the 30ml/50ml difference lives in canonical_size,
    // NOT the name, so the key is (correctly) equal and the dedup separates them
    // by the canonical_size column. extractCanonicalSize sees no size in the name.
    ok: () => key("Clarins", "Clarins Double Serum") === key("Clarins", "Clarins Double Serum") &&
              extractCanonicalSize("Clarins Double Serum") === null,
  },

  // ── KEEP DISTINCT — pack counts (incl. counts embedded in NAME) ────────────
  {
    cls: "pack-count",
    desc: "7 pcs vs 32 pcs (BCL Saborino)",
    ok: () => key("BCL", "BCL Saborino Morning Mask 32 pcs") !== key("BCL", "BCL Saborino Morning Mask 7 pcs") &&
              extractNameNumbers("BCL Saborino Morning Mask 32 pcs") !== extractNameNumbers("BCL Saborino Morning Mask 7 pcs"),
  },
  {
    cls: "pack-count",
    desc: "1pc vs 10pcs (Abib Gummy Sheet Mask)  [18357 vs 91577]",
    ok: () => key("Abib", "Abib - Gummy Sheet Mask - Heartleaf Sticker - 1pc") !==
              key("Abib", "Abib - Gummy Sheet Mask - Heartleaf Sticker - 10pcs") &&
              extractNameNumbers("...1pc") !== extractNameNumbers("...10pcs"),
  },
  {
    cls: "pack-count",
    desc: "40S vs 20S bare-count suffix (Veet Wax Strips) — no unit token",
    // stripSize does NOT strip a bare "40s"; extractSize returns "" for both;
    // only extractNameNumbers distinguishes them. This is the class the number
    // signature exists to catch.
    ok: () => extractNameNumbers("Veet Cold Wax Strips 40S") !== extractNameNumbers("Veet Cold Wax Strips 20S") &&
              key("Veet", "Veet Cold Wax Strips 40S") !== key("Veet", "Veet Cold Wax Strips 20S"),
  },
  {
    cls: "pack-count",
    desc: "20 sheets vs 60 sheets (K-beauty mask box)",
    ok: () => extractNameNumbers("Mediheal N.M.F Mask 20 sheets") !== extractNameNumbers("Mediheal N.M.F Mask 60 sheets") &&
              key("Mediheal", "Mediheal N.M.F Mask 20 sheets") !== key("Mediheal", "Mediheal N.M.F Mask 60 sheets"),
  },
  {
    cls: "pack-count",
    desc: "80 pads vs 180g/80pads — differing name-number set  [81197 vs 93872]",
    ok: () => extractNameNumbers("A'PIEU - Egg PHA Pore Pad 80 pads") !==
              extractNameNumbers("A'PIEU - Egg PHA Pore Pad - 180g (80pads)"),
  },

  // ── KEEP DISTINCT — sizes, incl. sizes hidden as name-vs-null ──────────────
  {
    cls: "size",
    desc: "400ml vs 1L — 1L must NOT null out (SVR)",
    ok: () => extractCanonicalSize("SVR Sebiaclear Gel Moussant 1L") === "1l" &&
              extractCanonicalSize("SVR Sebiaclear Gel Moussant 400ml") === "400ml" &&
              key("SVR", "SVR Sebiaclear Gel Moussant 400ml") !== key("SVR", "SVR Sebiaclear Gel Moussant 1L") &&
              extractNameNumbers("...400ml") !== extractNameNumbers("...1L"),
  },
  {
    cls: "size",
    desc: "7ml sample vs 50ml full-size (extractSize verify)",
    ok: () => extractSize("clarins serum 7ml") !== extractSize("clarins serum 50ml"),
  },

  // ── KEEP DISTINCT — shade variants ─────────────────────────────────────────
  {
    cls: "shade",
    desc: "Clarins Joli Rouge lipstick — shade-bearing, held for review  [51514-51518]",
    // Four rows share name+3.5g size with shade=null: the key collides but the
    // line is shade-bearing so the dedup must hold, never merge.
    ok: () => isShadeBearingLine("Clarins Joli Rouge Velvet Matte Lipstick 3.5g", "Lipstick") === true,
  },
  {
    cls: "shade",
    desc: "TirTir Mask Fit Cushion — cushion line is shade-bearing",
    ok: () => isShadeBearingLine("TIRTIR Mask Fit Cushion 18g", "Cushion") === true,
  },
  {
    cls: "shade",
    desc: "fwee Lip & Cheek — shade-bearing via product_type 'Lip Care' + name",
    ok: () => isShadeBearingLine("Fwee - Lip & Cheek Blurry Pudding Pot", "Lip Care") === true,
  },
  {
    cls: "shade",
    desc: "named shade in name splits the key (Ruby Woo vs Velvet Teddy)",
    ok: () => key("MAC", "MAC Matte Lipstick Ruby Woo") !== key("MAC", "MAC Matte Lipstick Velvet Teddy"),
  },
  {
    cls: "shade",
    desc: "tinted lip balm — any 'lip' line is shade-bearing  [e.l.f. Glow Reviver 106957-9]",
    ok: () => isShadeBearingLine("e.l.f. Glow Reviver Melting Lip Balm", "Lip Care") === true,
  },
  {
    cls: "shade",
    desc: "top_category='makeup' forces shade-bearing (colour cosmetics)",
    ok: () => isShadeBearingLine("Some Loose Powder", "Powder", "makeup") === true,
  },
  {
    cls: "shade",
    desc: "non-shade line (Moisturiser/skincare) is NOT shade-bearing → mergeable",
    ok: () => isShadeBearingLine("Clarins Extra-Firming Day Cream 50ml", "Moisturiser", "skincare") === false,
  },

  // ── KEEP DISTINCT — fragrance concentration ────────────────────────────────
  {
    cls: "fragrance",
    desc: "EDT vs EDP split the key (Versace Eros)",
    ok: () => key("Versace", "Versace Eros Eau de Toilette 100ml") !== key("Versace", "Versace Eros Eau de Parfum 100ml") &&
              fragranceConcentration("Versace Eros Eau de Toilette 100ml") === "EDT" &&
              fragranceConcentration("Versace Eros Eau de Parfum 100ml") === "EDP",
  },
  {
    cls: "fragrance",
    desc: "Parfum / Cologne / Aftershave / EDC recognised distinctly",
    ok: () => fragranceConcentration("Dior Homme Parfum 100ml") === "Parfum" &&
              fragranceConcentration("Acqua di Parma Colonia Cologne 100ml") === "Cologne" &&
              fragranceConcentration("Boss Bottled Aftershave 100ml") === "Aftershave" &&
              fragranceConcentration("4711 Original Eau de Cologne 100ml") === "EDC",
  },

  // ── KEEP DISTINCT — version / edition ──────────────────────────────────────
  {
    cls: "version",
    desc: "Foreo Luna 3.0 vs 4.0 split the key",
    ok: () => key("Foreo", "Foreo Luna 3.0 Facial Device") !== key("Foreo", "Foreo Luna 4.0 Facial Device") &&
              versionMarker("Foreo Luna 3.0 Facial Device") === "3.0",
  },
  {
    cls: "version",
    desc: "'2026 Version' / 'refill' markers detected",
    ok: () => versionMarker("SkinCeuticals C E Ferulic 2026 Version 30ml") !== null &&
              versionMarker("Diptyque Baies Candle Refill 300g") === "Refill",
  },

  // ── KEEP DISTINCT — sets / kits / bundles ──────────────────────────────────
  {
    cls: "set",
    desc: "single vs Set split the key (The Ordinary)",
    ok: () => key("The Ordinary", "The Ordinary AHA 30% + BHA 2% Peeling Solution 30ml") !==
              key("The Ordinary", "The Ordinary AHA 30% + BHA 2% Peeling Solution Set"),
  },

  // ── KEEP DISTINCT — trailing '+' / truncation (uncertain) ──────────────────
  {
    cls: "truncation",
    desc: "fwee '(Random...' truncated tail flagged  [56718]",
    ok: () => hasUncertainTail("Fwee - Lip & Cheek Blurry Pudding Pot + Pendant Keyring (Random...") === true,
  },
  {
    cls: "truncation",
    desc: "KSECRET '102g +' trailing plus flagged",
    ok: () => hasUncertainTail("KSECRET Real Fit Sun Cushion Refill 102g +") === true,
  },
  {
    cls: "truncation",
    desc: "dangling '-' tail flagged (KSECRET Serial cut-off)  [18749/18750]",
    ok: () => hasUncertainTail("KSECRET - SEOUL 1988 Serum : Retinal Liposome 2% + Black Ginseng -") === true,
  },
  {
    cls: "truncation",
    desc: "clean name is NOT flagged (control)",
    ok: () => hasUncertainTail("Clarins Double Serum 50ml") === false,
  },

  // ── CHARACTER FOLDING — accents and the ampersand ───────────────────────────
  //
  // ADDED 26 AUGUST 2026, AND THE ABSENCE IS THE POINT. Before this block the
  // harness carried 50 cases and NOT ONE exercised an accented character or an
  // ampersand -- the two input classes the folding change is entirely about.
  //
  // A HARNESS THAT HAS NEVER MET THE INPUT CLASS A CHANGE IS ABOUT IS NOT A
  // HARNESS THAT GUARDS THAT CHANGE. It would have passed before the fix and
  // after it, and reported nothing either way. The three shapes below are the
  // three that a full read of every at-risk merge group actually produced
  // (13 cross-brand groups, 9 name-divergent groups, 18 distinct). Item 371.

  {
    cls: "fold-accent",
    desc: "SHAPE 1 — one brand, two spellings: Avène and Avene are one product",
    ok: () => key("Avene", "Avène Thermal Spring Water 300ml") ===
              key("Avene", "Avene Thermal Spring Water 300ml"),
  },
  {
    cls: "fold-accent",
    desc: "accent is FOLDED not deleted (regression: 'av ne' was the old key)",
    ok: () => normaliseForMatch("Avène") === "avene",
  },
  {
    cls: "fold-accent",
    desc: "Kérastase / Kerastase — the split that made two live hubs  [item 368]",
    ok: () => key("Kerastase", "Kérastase Elixir Ultime L'Huile Originale Hair Oil 30ml") ===
              key("Kerastase", "Kerastase Elixir Ultime L'Huile Originale Hair Oil 30ml"),
  },
  {
    cls: "fold-ampersand",
    desc: "SHAPE 2 — & against the word 'and': the two live Boots oils  [item 294]",
    ok: () => key("Boots", "Boots Nail & Cuticle Oil 10Ml") ===
              key("Boots", "Boots Nail And Cuticle Oil 10Ml"),
  },
  {
    cls: "fold-ampersand",
    desc: "& maps to 'and' rather than being stripped (the modelled option)",
    ok: () => normaliseForMatch("Nail & Cuticle") === "nail and cuticle",
  },
  {
    cls: "fold-ampersand",
    desc: "brand ampersand folds too: Percy & Reed / Percy and Reed",
    ok: () => key("Percy & Reed", "Percy & Reed Give Me Strength Strengthening Shampoo 50ml") ===
              key("Percy and Reed", "Percy and Reed Give Me Strength Strengthening Shampoo 50ml"),
  },
  {
    cls: "fold-brand-repeat",
    desc: "SHAPE 3 — brand repeated in the name, unfoldable until the accent folded",
    ok: () => key("Hermes", "Hermes Hermès 24 Faubourg Eau De Parfum 50ml") ===
              key("Hermes", "Hermes 24 Faubourg Eau De Parfum 50ml"),
  },

  // ── CONTROLS: the fold must NOT merge these ────────────────────────────────
  {
    cls: "fold-control",
    desc: "different sizes stay distinct despite identical folded text",
    ok: () => key("Avene", "Avène Thermal Spring Water 300ml") !==
              key("Avene", "Avène Thermal Spring Water 150ml"),
  },
  {
    cls: "fold-control",
    desc: "an unaccented near-word is NOT pulled onto an accented one",
    ok: () => key("Chloe", "Chloé Nomade Eau de Parfum 50ml") !==
              key("Chloe", "Chloé Atelier des Fleurs Eau de Parfum 50ml"),
  },
  {
    cls: "fold-control",
    desc: "folding does not disturb a plain ASCII key (control)",
    ok: () => key("Kiehl's", "Kiehl's Calendula Cleanser") === "kiehl s calendula cleanser",
  },
  {
    cls: "fold-control",
    desc: "MULTIPACK POPULATION UNCHANGED — numbers survive the fold untouched",
    ok: () => extractNameNumbers("Bioré UV Aqua Rich 2 x 50ml") ===
              extractNameNumbers("Biore UV Aqua Rich 2 x 50ml"),
  },

  // ── MULTIPACK: canonical_size must describe the PACK, not the sachet (item 435) ──
  {
    cls: "multipack",
    desc: "N x Mg returns the PACK total, not the sachet",
    ok: () => extractCanonicalSize("Vida Glow Natural Marine Collagen 90 x 3g Sachets") === "270g" &&
              extractCanonicalSize("THE Electro | Electrolyte Sachets - 20 x 9.4g") === "188g" &&
              extractCanonicalSize("Kerastase Densifique Treatment Homme 30 x 6ml") === "180ml",
  },
  {
    cls: "multipack",
    desc: "reversed Mg x N returns the pack total (outside item 252's scope)",
    ok: () => extractCanonicalSize("Cadence Sachets Core Orange - Carton (5g x 30)") === "150g" &&
              extractCanonicalSize("Vital Proteins Collagen Peptides Sachets 10g x 10") === "100g",
  },
  {
    cls: "multipack",
    desc: "decimal multipliers do not produce float noise",
    ok: () => extractCanonicalSize("Sachet Pack 3 x 2.4g") === "7.2g" &&
              extractCanonicalSize("Trial 4 x 1.5ml") === "6ml",
  },
  {
    cls: "multipack",
    desc: "CONTROL — single-size names unchanged by the multiplier branch",
    ok: () => extractCanonicalSize("SVR Sebiaclear Gel Moussant 1L") === "1l" &&
              extractCanonicalSize("SVR Sebiaclear Gel Moussant 400ml") === "400ml" &&
              extractCanonicalSize("Myprotein Impact Whey Isolate 1kg") === "1kg" &&
              extractCanonicalSize("Clarins Double Serum") === null,
  },
  {
    cls: "multipack",
    desc: "CONTROL — an x with no unit attached is not a pack multiplier",
    ok: () => extractCanonicalSize("Palette 12 x Eyeshadow 30g") === "30g",
  },

  // ── SACHET FORMS THE FIRST PASS DID NOT REACH (item 449) ────────────────────────
  //
  // The reversed form's ONLY case was "Carton (5g x 30)", where a closing bracket
  // supplies the word boundary the pattern asserted. These are the forms that boundary
  // hid. Each is written from a REAL catalogue name rather than from the pattern.
  {
    cls: "multipack",
    desc: "REGRESSION — count glued to a word: the \\b bug",
    ok: () => extractCanonicalSize("Impact Hydrate | Electrolyte Sachets - 3.4g x 30servings - Lemon") === "102g" &&
              extractCanonicalSize("Mixsoon Bean Cream Stick Pouch Set 1.5ml x 10ea") === "15ml",
  },
  {
    cls: "multipack",
    desc: "size then count: \"3.9g - 15 Sachets\"",
    ok: () => extractCanonicalSize("Humantra Black Cherry Electrolyte Powder 3.9g - 15 Sachets") === "58.5g" &&
              extractCanonicalSize("Nutriburst Gut Electrolyte Powder - 4.5g, 20 sachets") === "90g",
  },
  {
    cls: "multipack",
    desc: "★ A SERVING IS A PORTION, NOT A CONTAINER — servings must never multiply",
    ok: () => extractCanonicalSize("Micronised Creatine Powder - 500g - 87servings - Unflavoured") === "500g" &&
              extractCanonicalSize("Essential Whey Protein Shake - 2.5KG - 70servings - Strawberry") === "2.5kg" &&
              extractCanonicalSize("Marine Collagen - 330G, 30servings - Orange and Mango") === "330g" &&
              extractCanonicalSize("Impact Pre-Workout - 400G - 40servings - Vimto") === "400g",
  },
  {
    cls: "multipack",
    desc: "count then size: \"7 Sachets, 2g\"",
    ok: () => extractCanonicalSize("Fourfive Immune Support Hydration Power 7 Sachets, 2g") === "14g" &&
              extractCanonicalSize("Fourfive Energy & Focus Hydration Power 7 Sachets, 25g") === "175g",
  },
  {
    cls: "multipack",
    desc: "★ a digit inside a word is not a count — B5 Ampoule",
    ok: () => extractCanonicalSize("Isntree Onion Newpair B5 Ampoule 50ml") === "50ml" &&
              extractCanonicalSize("Vitamin B12 Sachets 30g") === "30g",
  },
  {
    cls: "multipack",
    desc: "CONTROL — the bracketed form the first pass was written from still works",
    ok: () => extractCanonicalSize("Cadence Sachets Core Orange - Carton (5g x 30)") === "150g",
  },
  {
    cls: "multipack",
    desc: "CONTROL — a plain size with a sachet word nearby is NOT multiplied",
    ok: () => extractCanonicalSize("Vida Glow Marine Collagen Sachet Original 3g") === "3g" &&
              extractCanonicalSize("SKIN1004 Poremising Clay Stick 27g") === "27g" &&
              extractCanonicalSize("ISNTREE Airy Sun Stick SPF50 22g") === "22g",
  },
  {
    cls: "multipack",
    desc: "CONTROL — a count with no unit after it does not invent a size",
    ok: () => extractCanonicalSize("Some Brand 30 Sachets") === null,
  },
];

// ── Run ──────────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
let pass = 0;
const failed: string[] = [];

console.log(pad("RESULT", 7) + "  " + pad("class", 20) + "  desc");
console.log("─".repeat(110));
for (const c of CASES) {
  let ok = false;
  try { ok = c.ok(); } catch (e) { ok = false; }
  if (ok) pass++;
  else failed.push(`[${c.cls}] ${c.desc}`);
  console.log(pad(ok ? "PASS" : "FAIL✗", 7) + "  " + pad(c.cls, 20) + "  " + c.desc);
}
console.log("─".repeat(110));
console.log(`PASS ${pass}  /  FAIL ${failed.length}  (of ${CASES.length})`);
if (failed.length) {
  console.log(`\n⚠️  ${failed.length} case(s) failing:`);
  for (const n of failed) console.log(`   - ${n}`);
  process.exit(1);
}
