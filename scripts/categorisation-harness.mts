/**
 * Local validation harness for the SHARED inferCategorisation() in
 *   supabase/functions/_shared/categorisation.ts
 *
 * As of PR #18 inferCategorisation lives in ONE shared module that all three
 * importers import. The harness imports that same module directly — so it tests
 * exactly the code that ships, and because all three importers consume the same
 * module, passing here means all three behave identically by construction.
 *
 * Run:  npx tsx scripts/categorisation-harness.mts
 *
 * Each case is tagged with `fixedBy`: the commit number that should make it
 * PASS. fixedBy 0 = control (must always pass; regression guard). So before
 * any fix, controls PASS and fix-cases FAIL — documenting the bug. After each
 * commit, more cases flip to PASS and NO control may flip to FAIL.
 */

import { inferCategorisation } from "../supabase/functions/_shared/categorisation.ts";

// ── Test cases ──────────────────────────────────────────────────────────────
type Expect = "hair" | "skincare" | "makeup" | null;
type Case = {
  name: string;
  brand?: string;
  expect: Expect;
  // When set, the case asserts the product is denylisted with this `excluded`
  // reason (top_category null). Otherwise it asserts top_category === expect
  // and that the product is NOT excluded.
  excluded?: string;
  // When set, ALSO asserts the resolved product_type (not just top_category).
  expectType?: string;
  // When set, ALSO asserts the resolved subcategory (face/body/hand/foot/both).
  expectSub?: string;
  fixedBy: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
  note?: string;
};

const CASES: Case[] = [
  // ── Controls (fixedBy 0): must ALWAYS pass — regression guards ────────────
  { name: "CeraVe Moisturising Cream 50ml", expect: "skincare", fixedBy: 0 },
  { name: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", expect: "skincare", fixedBy: 0 },
  { name: "La Roche-Posay Anthelios SPF50 Fluid 50ml", expect: "skincare", fixedBy: 0, note: "spf50→spf 50 should still route SPF after C1" },
  { name: "Clinique Superbalanced Makeup", expect: "makeup", fixedBy: 0 },
  { name: "Maybelline Baby Lips Lip Balm", expect: "skincare", fixedBy: 0, note: "'baby lips' must NOT hit baby exclusion" },
  { name: "Olaplex No.4 Bond Maintenance Shampoo 250ml", brand: "Olaplex", expect: "hair", fixedBy: 0 },
  { name: "Batiste Dry Shampoo Original 200ml", brand: "Batiste", expect: "hair", fixedBy: 0 },

  // ── Commit 1: concatenated hair keyword + number ─────────────────────────
  { name: "American Crew Daily Moisturizing Shampoo250ml", brand: "American Crew", expect: "hair", fixedBy: 1 },
  { name: "Redken All Soft Conditioner300ml", brand: "Redken", expect: "hair", fixedBy: 1 },
  { name: "Schwarzkopf BC Bonacure Shampoo1000ml", brand: "Schwarzkopf", expect: "hair", fixedBy: 1 },

  // ── Commit 2: standalone styling keywords (brand NOT whitelisted) ────────
  { name: "Generic Strong Hold Pomade 100g", brand: "Generic", expect: "hair", fixedBy: 2 },
  { name: "Genericco Molding Clay 85g", brand: "Genericco", expect: "hair", fixedBy: 2 },
  { name: "Genericco Texture Paste 75ml", brand: "Genericco", expect: "hair", fixedBy: 2 },
  { name: "Genericco Grooming Spray 200ml", brand: "Genericco", expect: "hair", fixedBy: 2 },

  // ── Commit 3: brand whitelist (no hair/styling keyword in name) ──────────
  { name: "American Crew Forming Cream 85g", brand: "American Crew", expect: "hair", fixedBy: 3 },
  { name: "Bumble and bumble Surf Infusion 100ml", brand: "Bumble and bumble", expect: "hair", fixedBy: 3 },
  { name: "Living Proof Full Dry Volume Blast 238ml", brand: "Living Proof", expect: "hair", fixedBy: 3 },

  // ── Commit 4: beard exception → skincare (mens grooming), NOT hair ───────
  { name: "American Crew Beard Serum 50ml", brand: "American Crew", expect: "skincare", fixedBy: 4 },
  { name: "American Crew Beard Balm 60ml", brand: "American Crew", expect: "skincare", fixedBy: 4 },
  { name: "American Crew Beard Oil 30ml", brand: "American Crew", expect: "skincare", fixedBy: 4 },

  // ── Commit 5: false positives surfaced by the backfill audit ─────────────
  // 5a. brow/concealer 'pomade' is makeup, not hair styling (commit 2 over-match)
  { name: "Maybelline Brow Extensions Eyebrow Pomade Crayon - 02 Soft Brown", brand: "Maybelline", expect: "makeup", fixedBy: 5 },
  { name: "L'Oreal Infaillible 24H Concealer Pomade - 03 Dark", brand: "L'Oreal Paris", expect: "makeup", fixedBy: 5 },
  { name: "Revolution Brow Pomade Dark Brown", brand: "Revolution", expect: "makeup", fixedBy: 5 },
  // 5b. 'matrix' is a hair brand only in the brand field, not as a name word (commit 3 over-match)
  { name: "Elemis Pro-Collagen Overnight Matrix 50ml", brand: "Elemis", expect: "skincare", fixedBy: 5 },
  { name: "Matrix Food For Soft Oil 50ml", brand: "Matrix", expect: "hair", fixedBy: 5, note: "matrix in BRAND field still routes hair" },
  // 5c. 'sculpting'/'matte' must not steal skincare firming creams into hair (commit 2 over-match)
  { name: "OLAY Regenerist Micro-Sculpting Cream - 50g", brand: "Olay", expect: "skincare", fixedBy: 5 },
  // True positive that must still route to hair after the pomade guard
  { name: "Slick Gorilla Clay Pomade 70g", brand: "Slick Gorilla", expect: "hair", fixedBy: 5 },

  // ── Commit 6: sunscreen/oil body sprays are skincare, not deodorant ───────
  { name: "St Moriz Suncare SPF30 Sunscreen Body Spray 200ml", brand: "St Moriz", expect: "skincare", fixedBy: 6 },
  { name: "No7 Beautiful Skin Pampering Dry Oil Body Spray 200ml", brand: "No7", expect: "skincare", fixedBy: 6 },

  // ── Commit 7: davines + schwarzkopf added to the hair-brand whitelist ─────
  // 7a. brand-only hair products with no hair keyword in the name
  { name: "Davines OI All in One Milk", brand: "Davines", expect: "hair", fixedBy: 7 },
  { name: "Davines OI Hair Butter", brand: "Davines", expect: "hair", fixedBy: 7 },
  { name: "Davines VOLU Volume Boosting Hair Mist", brand: "Davines", expect: "hair", fixedBy: 7 },
  { name: "Schwarzkopf Got2B Curlz Defining Jelly 150ml", brand: "Schwarzkopf", expect: "hair", fixedBy: 7 },
  { name: "Schwarzkopf Got2B Frizz Taming Serum Smooth Operator200 ml", brand: "Schwarzkopf", expect: "hair", fixedBy: 7 },
  { name: "Schwarzkopf Got2B Heat Protection Spray Guardian Angel200 ml", brand: "Schwarzkopf", expect: "hair", fixedBy: 7 },
  // 7b. brow/eyebrow products from a hair brand are makeup, NOT hair (guard runs
  //     before the brand-whitelist branch)
  { name: "Schwarzkopf Got2B Glued 4 Brows & Edges Tinted Black 16ml", brand: "Schwarzkopf", expect: "makeup", fixedBy: 7 },
  { name: "Schwarzkopf Got2B Glued Brow Lift Styling Wax", brand: "Schwarzkopf", expect: "makeup", fixedBy: 7 },
  // 7c. "brown" must NOT trip the brow guard — hair-dye shades stay hair
  { name: "Schwarzkopf Creme Supreme 4-0 Natural Dark Brown Permanent Hair Dye", brand: "Schwarzkopf", expect: "hair", fixedBy: 7 },
  // 7d. Davines' Comfort Zone skincare sister line stays skincare despite the brand whitelist
  { name: "Davines Comfort Zone Sacred Nature Nourishing Cream 60ml", brand: "Davines", expect: "skincare", fixedBy: 7 },

  // ── Commit 8: fragrance gift sets bundling body care stay EXCLUDED ─────────
  // A hard fragrance form (EDT/EDP/parfum spray) is unambiguously fragrance even
  // when the name also lists shower gel / aftershave balm. The body-care scent-
  // descriptor rescue must NOT pull these gift sets back in as skincare.
  { name: "Hugo Boss Bottled Eau de Toilette Spray 125ml After Shave Balm 100ml Shower Gel 100ml", brand: "Hugo Boss", expect: null, excluded: "fragrance", fixedBy: 8 },
  { name: "Paco Rabanne 1 Million Eau de Toilette 100ml Shower Gel 100ml Gift Set", brand: "Paco Rabanne", expect: null, excluded: "fragrance", fixedBy: 8 },
  // Plain fragrance with no body-care descriptor was always excluded — regression guard.
  { name: "Dior Sauvage Eau de Parfum 100ml", brand: "Dior", expect: null, excluded: "fragrance", fixedBy: 0 },
  // The scent-descriptor rescue must STILL fire when there's no hard fragrance form:
  // a real body wash that merely says "fragrance" stays a body product, not excluded.
  { name: "Original Source Mint & Tea Tree Fragrance Shower Gel 250ml", brand: "Original Source", expect: "skincare", fixedBy: 0 },

  // ── Commit 9: eyewear + electric grooming appliances dropped ───────────────
  // Debenhams' AWIN feed gives these an empty category and a model-code name, so
  // path/category/name excludes all miss them and they default to skincare/face.
  // 9a. eyewear via vocabulary (aviator), via frame-shape + "/S" model suffix,
  //     and via designer SKU patterns (CK#####, FT####).
  { name: "Hugo Boss Men's Aviator Gold Black Grey Anti Reflective BOSS 1743/S", brand: "Hugo Boss", expect: null, excluded: "eyewear", fixedBy: 9 },
  { name: "Hugo Boss Men's Rectangle Havana Green BOSS 1745/S in Brown", brand: "Hugo Boss", expect: null, excluded: "eyewear", fixedBy: 9 },
  { name: "Hugo Boss Men's Square Matte Black Grey Dark Grey BOSS 1453/F/S", brand: "Hugo Boss", expect: null, excluded: "eyewear", fixedBy: 9 },
  { name: "CALVIN KLEIN Men's Rectangle Brown Brown CK19137S", brand: "Calvin Klein", expect: null, excluded: "eyewear", fixedBy: 9 },
  { name: "Tom Ford Men's Rectangle Dark Havana Smoke Grey Philippe FT0999 in Brown", brand: "Tom Ford", expect: null, excluded: "eyewear", fixedBy: 9 },
  // 9b. electric grooming appliances (trimmers, shavers, clippers, laser caps).
  { name: "Breed Men's Beak Barber Nose & Ear Trimmer in Black", brand: "Breed", expect: null, excluded: "appliance", fixedBy: 9 },
  { name: "Panasonic Men's ES-RT37 Wet & Dry Electric 3-Blade Shaver for Men in Black", brand: "Panasonic", expect: null, excluded: "appliance", fixedBy: 9 },
  { name: "Hairmax Men's Powerflex 272 Lasercap in Blue", brand: "Hairmax", expect: null, excluded: "appliance", fixedBy: 9 },
  // 9d. Gucci eyewear SKU (GG####S / GG####SK) — no "/S" slash, not CK/FT/SY.
  { name: "Gucci Men's Square Black & Grey Grey GG0382S", brand: "Gucci", expect: null, excluded: "eyewear", fixedBy: 9 },
  { name: "Gucci Men's Square Black with Havana Grey GG1670SK", brand: "Gucci", expect: null, excluded: "eyewear", fixedBy: 9 },
  // 9e. apparel / footwear / bags with empty feed category default to skincare.
  { name: "Calvin Klein Men's Icon Cotton Low Rise Trunks 5 Pack - Black | Size: Small", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Long Sleeved Merino Wool Crew Neck Jumper Blue | Size: 2XL", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Slim Cotton Stretch Chino Trouser Grey | Size: 32R", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Classic Cupsole Laceup Lth Triple Black | Size: 10", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Bold Weekender Duffle Bag Black", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Plaque Card Holder - Black", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Boxed Embossed Woven Wallet Black", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's CK Smooth Buckle Belt 35MM Black", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's 9 In Straight Refined Cotton Shorts Navy | Size: 32R", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Ergon Eva Double Bar Sandal Triple Black | Size: 8", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Low Top Lace Up Repreve Black | Size: 44", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Logo Jersey Pant Grey Heather | Size: Small", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  { name: "Calvin Klein Men's Premium Fleece Calvin Graphic Med Grey Htr | Size: Large", brand: "Calvin Klein", expect: null, excluded: "apparel", fixedBy: 9 },
  // 9f. designer Parfums with size in a separate "| Size:" field (bare 'parfum').
  { name: "Dolce & Gabbana Men's The One For Men Intense Parfum in Misc | Size: 50ml", brand: "Dolce & Gabbana", expect: null, excluded: "fragrance", fixedBy: 9 },
  { name: "Yves Saint Laurent Men's YSL MYSLF Le Parfum in Misc | Size: 60ml", brand: "Yves Saint Laurent", expect: null, excluded: "fragrance", fixedBy: 9 },
  { name: "Hugo Boss Men's Boss Bottled Parfum in Misc | Size: 50ml", brand: "Hugo Boss", expect: null, excluded: "fragrance", fixedBy: 9 },
  // 9g. electric groomer.
  { name: "Remington Men's Omniblade Face & Body Groomer", brand: "Remington", expect: null, excluded: "appliance", fixedBy: 9 },
  // 9h. guards: American Crew hair products contain "crew" but must NOT be caught
  //     by the apparel denylist (we intentionally omit bare "crew").
  { name: "American Crew Forming Cream 85g", brand: "American Crew", expect: "hair", fixedBy: 0, note: "'crew' in name must not hit apparel" },
  { name: "American Crew Daily Moisturizing Conditioner 250ml", brand: "American Crew", expect: "hair", fixedBy: 0 },
  // 9c. guards: legit beauty must NOT be caught by the new denylists.
  //     Men's skincare kits (not appliances), and beauty names containing the
  //     frame-shape words "round"/"square" without a sunglasses model code.
  { name: "skinChemists professional Men's Vitamin C Trio Anti-Ageing Skincare Kit", brand: "skinChemists professional", expect: "skincare", fixedBy: 0 },
  { name: "Laura Mercier Translucent Loose Setting Powder 29g", brand: "Laura Mercier", expect: "makeup", fixedBy: 0, note: "'loose'/round-ish words must not trip eyewear" },
  { name: "Clinique Square Compact Pressed Powder 10g", brand: "Clinique", expect: "makeup", fixedBy: 0, note: "frame-shape word 'square' without a /S model code stays makeup" },

  // ── Commit 10: K-beauty cushion foundations → makeup/Foundation ────────────
  // Cushion names commonly carry skincare-trigger keywords (Mask Fit, SPF, Sun)
  // that previously tripped skincare detection (Mask / SPF) before makeup. The
  // cushion gate must win at Step 3 and resolve product_type to Foundation.
  { name: "TIRTIR Mask Fit Red Cushion SPF40 PA++ 18g", brand: "TirTir", expect: "makeup", expectType: "Foundation", fixedBy: 10, note: "'Mask' must not steal it to skincare Mask" },
  { name: "CLIO Kill Cover Founwear Cushion All New SPF50+", brand: "Clio", expect: "makeup", expectType: "Foundation", fixedBy: 10 },
  { name: "Unleashia Don't Touch Glass Pink Cushion 02 Dont Care", brand: "Unleashia", expect: "makeup", expectType: "Foundation", fixedBy: 10 },
  { name: "MISSHA M Magic Cushion Moist Up SPF50+ PA+++", brand: "Missha", expect: "makeup", expectType: "Foundation", fixedBy: 10, note: "SPF must not steal it to skincare SPF" },
  { name: "LANEIGE Neo Cushion Matte SPF42 PA++ 15g", brand: "Laneige", expect: "makeup", expectType: "Foundation", fixedBy: 10 },
  // A cushion REFILL is the foundation product itself, not an accessory.
  { name: "TIRTIR Mask Fit Red Cushion Refill 18g", brand: "TirTir", expect: "makeup", expectType: "Foundation", fixedBy: 10 },
  // 10-guard: cushion ACCESSORIES (puff/case/pad/sponge) must NOT become a
  // Foundation — the gate's negative lookahead keeps them out of makeup here.
  { name: "Innisfree Air Magic Cushion Puff", brand: "Innisfree", expect: "skincare", fixedBy: 10, note: "accessory guard: cushion puff is not a foundation" },
  // 10-control: a REAL sleeping mask (no 'cushion') must still route skincare/Mask.
  { name: "LANEIGE Water Sleeping Mask 70ml", brand: "Laneige", expect: "skincare", expectType: "Mask", fixedBy: 0, note: "cushion change must not affect real masks" },

  // ── Commit 11: Mask over-tagging — precedence gates before the Mask classifier
  // The Mask classifier conflated hair masks, acne patches, eye patches, peels,
  // foam/pack cleansers, toner pads and LED devices into skincare/Mask. Each
  // class below now routes by its primary product type instead.
  // 11a. Hair masks from hair-only brands (no "hair" keyword in the name) →
  //      hair/Hair Treatment, via the Step 2 brand whitelist.
  { name: "Amika The Kure Intense Bond Repair Mask 250ml", brand: "Amika", expect: "hair", expectType: "Hair Treatment", fixedBy: 11, note: "hair-context beats face Mask" },
  { name: "Lee Stafford Bleach Blondes Ice White Toning Treatment Mask 200ml", brand: "Lee Stafford", expect: "hair", expectType: "Hair Treatment", fixedBy: 11 },
  { name: "TRESemmé Repair & Protect Hair Mask 300ml", brand: "TRESemmé", expect: "hair", expectType: "Hair Treatment", fixedBy: 11 },
  // 11b. Acne / blemish hydrocolloid patches → skincare/Treatment, NOT Mask.
  { name: "Hero Mighty Patch Original Spot Patches, 24 Hydrocolloid Pimple Patches", brand: "Hero", expect: "skincare", expectType: "Treatment", fixedBy: 11 },
  { name: "CeraVe Blemish Barrier Patches for Blemishes & Redness 22 Pieces", brand: "CeraVe", expect: "skincare", expectType: "Treatment", fixedBy: 11 },
  // 11c. Under-eye gel/hydrogel patches & pads → skincare/Eye Care, NOT Mask.
  { name: "ErthSkin Hyaluronic Acid + Collagen Hydrogel Eye Pads 5 x 2", brand: "Erth Skin London", expect: "skincare", expectType: "Eye Care", fixedBy: 11 },
  { name: "Thank You Farmer Rice Pure Jelly Hydrogel Brightening Eye Patches 60pc", brand: "Thank You Farmer", expect: "skincare", expectType: "Eye Care", fixedBy: 11 },
  // 11d. Foam / "pack" cleansers → skincare/Cleanser, NOT Mask ('pack' collision).
  { name: "MISSHA Amazon Red Clay Pore Pack Foam Cleanser 120ml", brand: "MISSHA", expect: "skincare", expectType: "Cleanser", fixedBy: 11, note: "'pore pack' must not steal it to Mask" },
  { name: "MISSHA Artemisia Pack Foam Cleanser 150ml", brand: "MISSHA", expect: "skincare", expectType: "Cleanser", fixedBy: 11 },
  // 11e. Peels are exfoliants → skincare/Exfoliator, even when "mask" co-occurs.
  { name: "Clinique Clarifying Do-Over Peel 30ml", brand: "Clinique", expect: "skincare", expectType: "Exfoliator", fixedBy: 11 },
  { name: "Whip&Woo Iced Pineapple Enzyme Peel Face Mask Gel 100ml", brand: "Whip&Woo", expect: "skincare", expectType: "Exfoliator", fixedBy: 11, note: "peel beats co-occurring 'mask'" },
  // 11f. Toner-soaked pads → skincare/Toner, NOT Mask.
  { name: "MEDICUBE Zero Pore Madecassoside Pads Mild (70 Pads)", brand: "medicube", expect: "skincare", expectType: "Toner", fixedBy: 11 },
  { name: "SKINFOOD Carrot Carotene Calming Water Pad (60 pads)", brand: "Skinfood", expect: "skincare", expectType: "Toner", fixedBy: 11 },
  // 11g. LED / light-therapy face-mask DEVICES → excluded, NOT skincare/Mask.
  { name: "Theragun Therabody Theraface Mask LED Light Therapy Skincare", brand: "Theragun", expect: null, excluded: "device", fixedBy: 11 },
  { name: "RIO Facelite Beauty Boosting LED Mask", brand: "RIO", expect: null, excluded: "device", fixedBy: 11 },
  // 11h. Coincidental quantity "pack" no longer routes to Mask. A real serum in a
  //      multipack resolves by its true type; out-of-scope packs are excluded.
  { name: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml 2 Pack", brand: "The Ordinary", expect: "skincare", expectType: "Serum", fixedBy: 11, note: "'2 Pack' must not route to Mask" },
  { name: "Solgar Triple Strength Omega-3 Softgels - Pack of 100", brand: "Solgar", expect: "skincare", fixedBy: 11, note: "out-of-scope, but 'Pack of 100' must not route to Mask (≠ excluded — see multivitamin/softgel guards below)" },
  // 11i. The denylist must NOT over-reach: "multivitamin" and "soft gel" are
  //      skincare marketing terms, not just supplements. These stay in-catalogue.
  { name: "Dermalogica MultiVitamin Power Recovery Masque 75ml", brand: "Dermalogica", expect: "skincare", fixedBy: 11, note: "'multivitamin' must not be excluded as a supplement" },
  { name: "Drunk Elephant C-Tango Multivitamin Eye Cream 15ml", brand: "Drunk Elephant", expect: "skincare", expectType: "Eye Care", fixedBy: 11 },
  { name: "2bTanned Watermelon Intensifying Soft Gel 200gr", brand: "2bTanned", expect: "skincare", fixedBy: 11, note: "'soft gel' tanning product must not be excluded as a supplement" },

  // 11-controls: genuine masks must STILL route to skincare/Mask after the gates.
  { name: "Round Lab Birch Juice Moisturizing Wash Off Pack 80ml", brand: "Round Lab", expect: "skincare", expectType: "Mask", fixedBy: 0, note: "real Korean wash-off pack stays Mask" },
  { name: "Mediheal Tea Tree Care Solution Essence Mask Sheet", brand: "Mediheal", expect: "skincare", expectType: "Mask", fixedBy: 0, note: "essence sheet mask stays Mask (serum-in-name must not steal)" },
  { name: "Some By Mi Bye Bye Blackhead Peel Off Mask 100ml", brand: "Some By Mi", expect: "skincare", expectType: "Mask", fixedBy: 0, note: "peel-OFF mask stays Mask, not Exfoliator" },
  { name: "Clinique Clarifying Charcoal Clay Mask 100ml", brand: "Clinique", expect: "skincare", expectType: "Mask", fixedBy: 0 },
  // 11-control: an ampoule/essence pad stays Serum (not stolen by the toner-pad gate).
  { name: "beplain Madecassoside Calming Ampoule Pad 70 pads", brand: "beplain", expect: "skincare", expectType: "Serum", fixedBy: 0, note: "ampoule pad → Serum, not Toner" },

  // ── Commit 12: Beauty Flash hair products misfiled as skincare ─────────────
  // inferCategorisation (not category_path) was the gap: hair products with no
  // structured "hair X" keyword, brand not whitelisted, or "scalp"/styling forms
  // it didn't recognise fell through to the skincare catch-all.
  // 12a. bare-"hair" signal (no structured keyword, brand not whitelisted)
  { name: "Australian Bodycare Tea Tree Hair Loss Serum 250ml", brand: "Australian Bodycare", expect: "hair", fixedBy: 12, note: "bare 'hair' → hair; 'serum' alone must not make it face skincare" },
  { name: "Coco & Eve Like A Virgin Miracle Hair Elixir 100ml", brand: "Coco & Eve", expect: "hair", fixedBy: 12 },
  { name: "Fudge Grooming Putty Hair Paste 75g", brand: "Fudge", expect: "hair", fixedBy: 12 },
  // 12b. scalp care → hair (broadened scalp rule)
  { name: "Alterna Scalp Peppermint Treatment 74ml", brand: "Alterna", expect: "hair", fixedBy: 12 },
  { name: "Biolage Scalp Sync Oil-Balancing Serum 50ml", brand: "Biolage", expect: "hair", fixedBy: 12 },
  // 12c. styling forms without a "hair" prefix (balm/foam/blowout)
  { name: "Alterna Caviar Professional Styling Satin Rapid Blowout Balm 147ml", brand: "Alterna", expect: "hair", fixedBy: 12 },
  // 12d. hair-only brand whitelist additions (alterna/biolage/fudge), no keyword
  { name: "Alterna My Hair My Canvas Begin Again Curl Cleanser 201ml", brand: "Alterna", expect: "hair", fixedBy: 12 },
  { name: "Biolage HydraSource Daily Leave-In Tonic 87.5ml", brand: "Biolage", expect: "hair", fixedBy: 12 },

  // 12-guards (fixedBy 0): the new bare-"hair"/scalp/styling rules must NOT steal
  // non-haircare uses of the word "hair" into the hair category.
  { name: "Veet Hair Removal Cream Sensitive Skin 100ml", brand: "Veet", expect: "skincare", fixedBy: 0, note: "depilatory: 'hair removal' must stay skincare, not hair" },
  { name: "Calvin Klein Eternity For Men Hair And Body Wash 150ml", brand: "Calvin Klein", expect: "skincare", fixedBy: 0, note: "2-in-1 'hair & body' wash stays skincare/body" },
  { name: "Nair Ingrown Hair Serum 50ml", brand: "Nair", expect: "skincare", fixedBy: 0, note: "'ingrown hair' is skincare, not haircare" },
  { name: "Skin Doctors Hair No More Inhibitor Spray 120ml", brand: "Skin Doctors", expect: "skincare", fixedBy: 0, note: "depilatory hair-reducer ('inhibitor'/'no more') stays skincare, not haircare" },
  // 'fudge' as a flavour/shade word must NOT route to hair — only brand=Fudge does.
  { name: "Sunkissed Heavenly Fudge Face Palette 19.2g", brand: "Sunkissed", expect: "skincare", fixedBy: 0, note: "'Fudge' shade word: must not route to HAIR (brand-only now). Falls to skincare — a separate makeup-detection gap for 'palette', out of scope here." },
  { name: "Organic Shop Ultra Smooth Pistachio Fudge Body Scrub 250ml", brand: "Organic Shop", expect: "skincare", fixedBy: 0, note: "'Fudge' flavour word: body scrub stays skincare" },
  { name: "Fudge Professional Clean Blonde Violet Shampoo 250ml", brand: "Fudge", expect: "hair", fixedBy: 0, note: "brand=Fudge still routes hair (brand-field match)" },
  { name: "Clarins Gentle Renewing Cleansing Mousse 150ml", brand: "Clarins", expect: "skincare", fixedBy: 0, note: "face cleansing mousse: no 'styling' qualifier → not hair" },

  // ── Commit 13: skincare subcategory upgrade (face/body/hand/foot/both) ──────
  // The classifier defaulted to 'face' too readily, mis-shelving body products.
  // New match order: both → hand → foot → FACE signals → body → SA line →
  // large-format moisturiser → default face. Spot-checked across body-heavy
  // brands (CeraVe, Aveeno, Eucerin, La Roche-Posay, E45, Nivea, Sanex, Cetaphil).
  // 13a. FACE — explicit face signals + default.
  { name: "CeraVe Foaming Facial Cleanser 236ml", brand: "CeraVe", expect: "skincare", expectSub: "face", fixedBy: 13, note: "'facial' → face even though 236ml" },
  { name: "La Roche-Posay Toleriane Hydrating Gentle Face Wash 200ml", brand: "La Roche-Posay", expect: "skincare", expectSub: "face", fixedBy: 13, note: "'face wash' beats the 200ml large-format body heuristic" },
  { name: "CeraVe Eye Repair Cream 14ml", brand: "CeraVe", expect: "skincare", expectSub: "face", fixedBy: 13, note: "eye area is on the face" },
  { name: "Cetaphil Gentle Skin Cleanser 236ml", brand: "Cetaphil", expect: "skincare", expectSub: "face", fixedBy: 13, note: "bare cleanser, no body signal → default face (not large-format body)" },
  // 13b. BODY — explicit body words.
  { name: "Aveeno Skin Relief Body Lotion 300ml", brand: "Aveeno", expect: "skincare", expectSub: "body", fixedBy: 13 },
  { name: "Nivea Nourishing Body Wash 450ml", brand: "Nivea", expect: "skincare", expectSub: "body", fixedBy: 13 },
  { name: "Sanex Zero% Body Wash 450ml", brand: "Sanex", expect: "skincare", expectSub: "body", fixedBy: 13 },
  // 13c. BODY — large-format moisturiser heuristic (no explicit body word).
  { name: "CeraVe Moisturising Lotion 473ml", brand: "CeraVe", expect: "skincare", expectSub: "body", fixedBy: 13, note: "473ml moisturiser, no face word → body, not face" },
  { name: "E45 Cream 500g", brand: "E45", expect: "skincare", expectSub: "body", fixedBy: 13, note: "large-format cream → body" },
  { name: "Eucerin UreaRepair Plus Lotion 250ml", brand: "Eucerin", expect: "skincare", expectSub: "body", fixedBy: 13 },
  { name: "Cetaphil Moisturising Lotion 200ml", brand: "Cetaphil", expect: "skincare", expectSub: "body", fixedBy: 13 },
  // 13d. BODY — CeraVe-style "SA" (salicylic-acid) body line.
  { name: "CeraVe SA Smoothing Cream 340g", brand: "CeraVe", expect: "skincare", expectSub: "body", fixedBy: 13, note: "SA line cream → body" },
  { name: "CeraVe SA Lotion for Rough & Bumpy Skin 237ml", brand: "CeraVe", expect: "skincare", expectSub: "body", fixedBy: 13 },
  // 13e. HAND.
  { name: "CeraVe Reparative Hand Cream 50ml", brand: "CeraVe", expect: "skincare", expectSub: "hand", fixedBy: 13 },
  { name: "Neutrogena Norwegian Formula Hand Cream 75ml", brand: "Neutrogena", expect: "skincare", expectSub: "hand", fixedBy: 13 },
  { name: "L'Occitane Shea Butter Hand Cream 30ml", brand: "L'Occitane", expect: "skincare", expectSub: "hand", fixedBy: 13 },
  // 13f. FOOT (must beat the SA + large-format heuristics).
  { name: "CeraVe SA Renewing Foot Cream 88ml", brand: "CeraVe", expect: "skincare", expectSub: "foot", fixedBy: 13, note: "'foot cream' beats the SA-line body rule" },
  { name: "Flexitol Heel Balm 112g", brand: "Flexitol", expect: "skincare", expectSub: "foot", fixedBy: 13 },
  { name: "Scholl Cracked Heel Repair Cream 60ml", brand: "Scholl", expect: "skincare", expectSub: "foot", fixedBy: 13 },
  // 13g. BOTH — explicit face & body (must beat the large-format body heuristic).
  { name: "Aveeno Daily Moisturising Face & Body Lotion 300ml", brand: "Aveeno", expect: "skincare", expectSub: "both", fixedBy: 13 },
  { name: "CeraVe Moisturising Cream for Face and Body 340g", brand: "CeraVe", expect: "skincare", expectSub: "both", fixedBy: 13, note: "'face and body' beats large-format body default" },
  // 13h. product_type guard: "Oil Control" must NOT become product_type Oil.
  { name: "La Roche-Posay Effaclar Mat Oil Control Moisturiser 40ml", brand: "La Roche-Posay", expect: "skincare", expectType: "Moisturiser", fixedBy: 13, note: "'oil control' moisturiser, not an Oil" },
  { name: "Garnier SkinActive Oil Control 50ml", brand: "Garnier", expect: "skincare", expectType: "Skincare", fixedBy: 13, note: "bare 'Oil Control' must not fall through to Oil" },
  // 13h-guard: a genuine facial oil must STILL be product_type Oil.
  { name: "Votary Rose Maroc Facial Oil 30ml", brand: "Votary", expect: "skincare", expectType: "Oil", expectSub: "face", fixedBy: 0, note: "oil-control guard must not break real facial oils" },
  // 13i. product_type guard: makeup removers / micellar waters are Cleansers, not Makeup.
  { name: "Clinique Take The Day Off Makeup Remover 125ml", brand: "Clinique", expect: "skincare", expectType: "Cleanser", fixedBy: 13, note: "'makeup remover' → Cleanser, not Makeup" },
  { name: "Garnier Micellar Cleansing Water Removes Makeup 400ml", brand: "Garnier", expect: "skincare", expectType: "Cleanser", fixedBy: 13, note: "'removes makeup' must not route to makeup" },
  { name: "Bioderma Sensibio H2O Micellar Water 250ml", brand: "Bioderma", expect: "skincare", expectType: "Cleanser", fixedBy: 13 },
  // 13-control: a real lip balm subcategory stays face (regression guard for reorder).
  { name: "CeraVe Moisturising Cream 50ml", brand: "CeraVe", expect: "skincare", expectSub: "face", fixedBy: 0, note: "small tub, no body/face/large signal → default face" },

  // ── Commit 14: Rimmel makeup-line overrides (Step 3b) ─────────────────────
  // Rimmel makeup lines whose names carry no generic makeup keyword fell to the
  // skincare catchall; brand-gated override (only fires when Steps 2-3 miss).
  { name: "Rimmel Wonder'Last Shadow Stick 001 Starshine Dream", brand: "Rimmel", expect: "makeup", expectType: "Eyeshadow", fixedBy: 14 },
  { name: "Rimmel Wonder'swipe 2-In-1 Liner To Shadow Slay", brand: "Rimmel", expect: "makeup", expectType: "Eyeliner", fixedBy: 14 },
  { name: "Rimmel Scandaleyes Exaggerate Eye Definer Intense Black", brand: "Rimmel", expect: "makeup", expectType: "Eyeliner", fixedBy: 14 },
  { name: "Rimmel 60 Seconds 856 Blue Breeze 8ml", brand: "Rimmel", expect: "makeup", expectType: "Nail Polish", fixedBy: 14 },
  { name: "Rimmel Super Gel Jelly Nails 015 Gummy Jelly", brand: "Rimmel", expect: "makeup", expectType: "Nail Polish", fixedBy: 14 },
  { name: "Rimmel Better Than Filters 001 Fair 30ml", brand: "Rimmel", expect: "makeup", expectType: "Foundation", fixedBy: 14 },
  { name: "Rimmel - The Multi Tasker ConcealerCream 10ml 120 Tiramisu", brand: "Rimmel", expect: "makeup", expectType: "Concealer", fixedBy: 14, note: "fused 'ConcealerCream' — \\bconcealer\\b missed it" },
  { name: "Rimmel Multi Tasker Blur Booster 040 Ivory 7G", brand: "Rimmel", expect: "makeup", expectType: "Primer", fixedBy: 14 },
  { name: "Rimmel Multi-Tasker 3 In 1 Bronzing Stick Light", brand: "Rimmel", expect: "makeup", expectType: "Blush/Bronzer", fixedBy: 14 },
  { name: "Rimmel Multi Tasker Turbocharged Glow 001 Not A Basic B", brand: "Rimmel", expect: "makeup", expectType: "Blush/Bronzer", fixedBy: 14 },
  // Lips: liner before lipstick before gloss; "Lip Stick" (spaced) → Lipstick,
  // "Slip Stick" must NOT (the \b guard), "Oh My Plump … Lip Shaper" → Lip Liner.
  { name: "Rimmel Lasting Finish Matte Ls Hollywood Red", brand: "Rimmel", expect: "makeup", expectType: "Lipstick", fixedBy: 14 },
  { name: "Rimmel Lasting Finish Lip Stick Candy", brand: "Rimmel", expect: "makeup", expectType: "Lipstick", fixedBy: 14, note: "spaced 'Lip Stick' → Lipstick" },
  { name: "Rimmel Oh My Gloss! Slip Stick 200 Pouting", brand: "Rimmel", expect: "makeup", expectType: "Lip Colour", fixedBy: 14, note: "'slip stick' must stay gloss, not Lipstick" },
  { name: "Rimmel Oh My Plump! Lip Shaper 010 Iconic Beige", brand: "Rimmel", expect: "makeup", expectType: "Lip Liner", fixedBy: 14 },
  // cargo apparel false-positive fix: nail-polish shade "Crazy About Cargo" must
  // NOT be excluded as apparel; it routes to makeup/Nail Polish.
  { name: "Rimmel 60 Seconds 882 Crazy About Cargo 8ml", brand: "Rimmel", expect: "makeup", expectType: "Nail Polish", fixedBy: 14 },
  // Guard: Sunshimmer self/instant tan is genuine tanning — STAYS skincare.
  { name: "Rimmel Sunshimmer Instant Self Tan Light Matte", brand: "Rimmel", expect: "skincare", fixedBy: 14, note: "tanning, not makeup" },
  { name: "Rimmel Sunshimmer Water Resist Instant Tan Med Matte 125ml", brand: "Rimmel", expect: "skincare", fixedBy: 14 },
  // Guard: removing bare 'cargo' must NOT break real apparel exclusion.
  { name: "Hugo Boss Cargo Trousers 32R", brand: "Hugo Boss", expect: null, excluded: "apparel", fixedBy: 14, note: "'cargo trousers' still excluded via 'trousers'" },
  // Control: the Rimmel gate must not affect other brands' skincare.
  { name: "CeraVe SA Smoothing Cream 340g", brand: "CeraVe", expect: "skincare", fixedBy: 0, note: "non-Rimmel brand unaffected by the Rimmel override" },

  // ── Commit 15: makeup detection for bronzers / luminizers / cheek palettes /
  //    high-pigment liners (NARS et al. were landing as skincare/Skincare) ────
  { name: "NARS Laguna Bronzing Powder 01, 8g", brand: "NARS", expect: "makeup", expectType: "Blush/Bronzer", expectSub: "face", fixedBy: 15 },
  { name: "NARS Light Reflecting Luminizing Stick Heavenly 7g", brand: "NARS", expect: "makeup", expectType: "Blush/Bronzer", expectSub: "face", fixedBy: 15 },
  { name: "NARS Softmatte Concealer", brand: "NARS", expect: "makeup", expectType: "Concealer", expectSub: "face", fixedBy: 0, note: "already correct — guard" },
  { name: "NARS Hot Escape Cheek Palette", brand: "NARS", expect: "makeup", expectType: "Blush/Bronzer", expectSub: "face", fixedBy: 15 },
  { name: "NARS High-Pigment Liner Mambo", brand: "NARS", expect: "makeup", expectType: "Eyeliner", expectSub: "eyes", fixedBy: 15 },
  { name: "NARS Lip Balm Orgasm", brand: "NARS", expect: "skincare", expectType: "Lip Care", fixedBy: 0, note: "regression guard for the lip-balm hot fix" },
  { name: "NARS Bronzing Stick", brand: "NARS", expect: "makeup", expectType: "Blush/Bronzer", expectSub: "face", fixedBy: 15 },
  { name: "NARS Luminizing Cream Stick", brand: "NARS", expect: "makeup", expectType: "Blush/Bronzer", expectSub: "face", fixedBy: 15 },
  // Non-NARS regression guard for the cheek-palette rule.
  { name: "Charlotte Tilbury Cheek Palette", brand: "Charlotte Tilbury", expect: "makeup", expectType: "Blush/Bronzer", expectSub: "face", fixedBy: 15 },
  // NARS abbreviated SKU: high-pigment long-wear liner.
  { name: "NARS High-Pgmnt Lngwr Lnr Grafton Street", brand: "NARS", expect: "makeup", expectType: "Eyeliner", expectSub: "eyes", fixedBy: 15 },
  // False-positive guards (must hold both before and after — fixedBy 0):
  { name: "Eyebright Eye Cream", brand: "Generic", expect: "skincare", fixedBy: 0, note: "'eyebright' must NOT trip eyes/makeup → stays Eye Care" },
  { name: "Estee Lauder High-Wear Foundation", brand: "Estee Lauder", expect: "makeup", expectType: "Foundation", fixedBy: 0, note: "'high-wear' is not the liner modifier → Foundation, not Eyeliner" },
  { name: "St Tropez Self Tan Bronzing Drops", brand: "St Tropez", expect: "skincare", fixedBy: 0, note: "'bronzing' without a cosmetic-form noun stays skincare (self-tan)" },
  { name: "The Ordinary Illuminating Vitamin C Serum", brand: "The Ordinary", expect: "skincare", fixedBy: 0, note: "'illuminating' without a cosmetic-form noun stays skincare" },
  { name: "Charlotte Tilbury Long-Wear Lip Liner Pillow Talk", brand: "Charlotte Tilbury", expect: "makeup", expectType: "Lip Liner", expectSub: "lips", fixedBy: 0, note: "long-wear LIP liner must route Lip Liner, not Eyeliner" },
];

// ── Run ──────────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
let pass = 0;
let fail = 0;
const failedControls: string[] = [];

console.log(
  pad("C", 2) + "  " + pad("RESULT", 6) + "  " + pad("got", 9) + "  " + pad("expect", 9) + "  " +
    pad("product_type", 16) + "  " + pad("sub", 6) + "  name",
);
console.log("─".repeat(120));

for (const c of CASES) {
  const r = inferCategorisation(c.name, c.brand ?? "");
  const got = r.excluded ? `excl:${r.excluded}` : r.top_category;
  const ok = c.excluded
    ? r.excluded === c.excluded
    : (r.top_category ?? null) === c.expect && !r.excluded &&
      (c.expectType ? r.product_type === c.expectType : true) &&
      (c.expectSub ? r.subcategory === c.expectSub : true);
  if (ok) pass++;
  else {
    fail++;
    if (c.fixedBy === 0) failedControls.push(c.name);
  }
  const mark = ok ? "PASS" : c.fixedBy === 0 ? "FAIL✗" : `fix@${c.fixedBy}`;
  console.log(
    pad(String(c.fixedBy), 2) + "  " +
      pad(mark, 6) + "  " +
      pad(String(got ?? "null"), 9) + "  " +
      pad(String(c.expect ?? "null"), 9) + "  " +
      pad(r.product_type || "—", 16) + "  " +
      pad(r.subcategory || "—", 6) + "  " +
      c.name + (c.brand ? `  [${c.brand}]` : ""),
  );
}

console.log("─".repeat(120));
console.log(`PASS ${pass}  /  FAIL ${fail}  (of ${CASES.length})`);
if (failedControls.length) {
  console.log(`\n⚠️  REGRESSION: ${failedControls.length} control case(s) now failing:`);
  for (const n of failedControls) console.log(`   - ${n}`);
  process.exit(1);
}
