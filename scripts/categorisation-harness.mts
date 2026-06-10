/**
 * Local validation harness for inferCategorisation() in
 *   supabase/functions/import-awin-feed/index.ts
 *
 * It extracts the LIVE function source (plus its TopCategory/Categorisation
 * type defs) directly from index.ts at runtime, transpiles it via tsx, and
 * runs a fixed set of representative product names through it. This means the
 * harness always tests exactly the code we are about to deploy — no drift, no
 * hand-maintained copy of the logic.
 *
 * Run:  npx tsx scripts/categorisation-harness.ts
 *
 * Each case is tagged with `fixedBy`: the commit number that should make it
 * PASS. fixedBy 0 = control (must always pass; regression guard). So before
 * any fix, controls PASS and fix-cases FAIL — documenting the bug. After each
 * commit, more cases flip to PASS and NO control may flip to FAIL.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "supabase", "functions", "import-awin-feed", "index.ts");

// ── Extract type defs + inferCategorisation from the live source ────────────
function extractFunction(src: string): string {
  const typeStart = src.indexOf("type TopCategory");
  if (typeStart === -1) throw new Error("type TopCategory not found in source");
  const fnSig = src.indexOf("function inferCategorisation", typeStart);
  if (fnSig === -1) throw new Error("function inferCategorisation not found");
  const braceOpen = src.indexOf("{", fnSig);
  let depth = 0;
  let end = -1;
  for (let i = braceOpen; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error("could not brace-match inferCategorisation");
  const body = src.slice(typeStart, end);
  // Sanity checks against the simple brace-matcher being fooled.
  if (!body.includes("function inferCategorisation")) throw new Error("extraction missing fn");
  if (!/return\s*\{/.test(body)) throw new Error("extraction missing return — brace match likely wrong");
  return body;
}

const source = readFileSync(SRC, "utf8");
const extracted = extractFunction(source);
const tmpModule = join(__dirname, ".categorisation-extracted.gen.ts");
writeFileSync(tmpModule, extracted + "\n\nexport { inferCategorisation };\n");

type Cat = {
  top_category: string | null;
  product_type: string;
  subcategory: string;
  tags: string[];
  excluded?: string;
};
const mod = (await import(pathToFileURL(tmpModule).href)) as {
  inferCategorisation: (name: string, brand?: string) => Cat;
};
const inferCategorisation = mod.inferCategorisation;

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
  fixedBy: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
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
];

// ── Run ──────────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
let pass = 0;
let fail = 0;
const failedControls: string[] = [];

console.log(
  pad("C", 2) + "  " + pad("RESULT", 6) + "  " + pad("got", 9) + "  " + pad("expect", 9) + "  " +
    pad("product_type", 16) + "  name",
);
console.log("─".repeat(110));

for (const c of CASES) {
  const r = inferCategorisation(c.name, c.brand ?? "");
  const got = r.excluded ? `excl:${r.excluded}` : r.top_category;
  const ok = c.excluded
    ? r.excluded === c.excluded
    : (r.top_category ?? null) === c.expect && !r.excluded;
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
      c.name + (c.brand ? `  [${c.brand}]` : ""),
  );
}

console.log("─".repeat(110));
console.log(`PASS ${pass}  /  FAIL ${fail}  (of ${CASES.length})`);
if (failedControls.length) {
  console.log(`\n⚠️  REGRESSION: ${failedControls.length} control case(s) now failing:`);
  for (const n of failedControls) console.log(`   - ${n}`);
  process.exit(1);
}
