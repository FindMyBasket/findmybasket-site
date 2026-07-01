/**
 * Local validation harness for cleanDebenhamsName() in
 *   supabase/functions/import-awin-feed/name-hygiene.ts
 *
 * Run:  npx tsx scripts/debenhams-name-hygiene-harness.mts
 *
 * Each case asserts the cleaned name and (where relevant) the routed shade and the
 * captured size clause. Inputs are the RAW Debenhams product_name strings the feed
 * appends attribute metadata onto; several are taken verbatim from the pre-cleanup
 * backup table debenhams_name_backup_20260701.
 */

import { cleanDebenhamsName } from "../supabase/functions/import-awin-feed/name-hygiene.ts";

type Case = {
  name: string;
  expectName: string;
  expectShade?: string | null;
  expectSize?: string | null; // the raw "| Size:" clause value
  note?: string;
};

const CASES: Case[] = [
  // ── size clause + placeholder/packaging variant + gender ───────────────────
  {
    name: "Afnan Men's Supremacy Not Only Intense in Misc | Size: 100ml",
    expectName: "Afnan Supremacy Not Only Intense",
    expectShade: null,
    expectSize: "100ml",
    note: "gender + 'in Misc' placeholder + size clause",
  },
  {
    name: "Give Me Men's Mens Body Wash - Sandalwood & Tonka Bean - 200ml in Blue | Size: 1",
    expectName: "Give Me Body Wash - Sandalwood & Tonka Bean - 200ml",
    expectShade: null,
    expectSize: "1",
    note: "doubled gender + packaging colour 'Blue' dropped (not makeup) + junk size '1'",
  },
  // ── conservative miss: makeup line name with no generic keyword ────────────
  // "Powder Kiss ... Slim Stick" is a MAC lipstick but carries no shade-bearing
  // keyword, so the importer-side gate leaves the variant in the name rather than
  // risk corrupting a legitimate " in ". Gender + size clause are still stripped.
  {
    name: "MAC Cosmetics Powder Kiss Velvet Blur Slim Stick in Pumpkin Spiced | Size: 3G",
    expectName: "MAC Cosmetics Powder Kiss Velvet Blur Slim Stick in Pumpkin Spiced",
    expectShade: null,
    expectSize: "3G",
    note: "no makeup keyword — variant conservatively retained (manual-review bucket)",
  },
  // ── real makeup shade routed to products.shade ─────────────────────────────
  {
    name: "Clarins Women's Lip Perfector in 01 Rose Shimmer | Size: 12ml",
    expectName: "Clarins Lip Perfector",
    expectShade: "01 Rose Shimmer",
    expectSize: "12ml",
    note: "coded shade routed, gender stripped",
  },
  {
    name: "KIKO Milano Matte Fusion Pressed Powder in 01 Beige Rose | Size: 12g",
    expectName: "KIKO Milano Matte Fusion Pressed Powder",
    expectShade: "01 Beige Rose",
    expectSize: "12g",
    note: "pressed powder shade routed",
  },
  {
    name: "KIKO Milano Daily Protection BB Cream SPF 30 in 04 Warm Almond | Size: 30ml",
    expectName: "KIKO Milano Daily Protection BB Cream SPF 30",
    expectShade: "04 Warm Almond",
    expectSize: "30ml",
    note: "BB cream shade routed",
  },
  // ── marketing copy in the attribute value: NOT stripped (comma guard) ───────
  {
    name: "Lancôme Women's Lip Idôle CuddleBlur Velvet Matte Lip Cream, Blurs Lips in 1 Swipe, 3D Cushion Effect, with Squalane | Size: 8.5ml",
    expectName: "Lancôme Lip Idôle CuddleBlur Velvet Matte Lip Cream, Blurs Lips in 1 Swipe, 3D Cushion Effect, with Squalane",
    expectShade: null,
    expectSize: "8.5ml",
    note: "marketing copy (commas) left in name; only gender + size clause removed",
  },
  // ── base name legitimately contains ' in ': NOT stripped ───────────────────
  {
    name: "EONLION Makeup Train Case 4 in 1 Trolley in Black | Size: 100ml",
    expectName: "EONLION Makeup Train Case 4 in 1 Trolley in Black",
    expectShade: null,
    expectSize: "100ml",
    note: "'4 in 1 Trolley in Black' is base (non-makeup) — left intact",
  },
  // ── plain colour on non-makeup base: dropped via packaging denylist ────────
  {
    name: "Some Brand Travel Bottle in Clear | Size: 50ml",
    expectName: "Some Brand Travel Bottle",
    expectShade: null,
    expectSize: "50ml",
    note: "packaging 'Clear' dropped even though base is not makeup",
  },
  // ── size clause only (no ' in ' attribute) ─────────────────────────────────
  {
    name: "Elemis Pro-Collagen Cleansing Balm | Size: 100g",
    expectName: "Elemis Pro-Collagen Cleansing Balm",
    expectShade: null,
    expectSize: "100g",
    note: "size clause only",
  },
  // ── no attribute metadata at all: unchanged ────────────────────────────────
  {
    name: "The Ordinary Niacinamide 10% + Zinc 1% 30ml",
    expectName: "The Ordinary Niacinamide 10% + Zinc 1% 30ml",
    expectShade: null,
    expectSize: null,
    note: "clean name, no-op",
  },
  // ── gender token that must be preserved ('for Men', 'Womenswear') ──────────
  {
    name: "Some House Eau Fraiche for Men 100ml",
    expectName: "Some House Eau Fraiche for Men 100ml",
    expectShade: null,
    expectSize: null,
    note: "'for Men' (no possessive) preserved",
  },
  {
    name: "Brand Womenswear Tote Bag",
    expectName: "Brand Womenswear Tote Bag",
    expectShade: null,
    expectSize: null,
    note: "'Womenswear' is not a gender tag",
  },
];

let pass = 0;
let fail = 0;

for (const c of CASES) {
  const got = cleanDebenhamsName(c.name);
  const nameOk = got.name === c.expectName;
  const shadeOk = (c.expectShade === undefined) || (got.shade === c.expectShade);
  const sizeOk = (c.expectSize === undefined) || (got.sizeClause === c.expectSize);
  const ok = nameOk && shadeOk && sizeOk;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS " : "FAIL✗"} ${c.note ?? ""}`);
  if (!ok) {
    console.log(`        in:    ${c.name}`);
    if (!nameOk)  console.log(`        name:  got '${got.name}'  exp '${c.expectName}'`);
    if (!shadeOk) console.log(`        shade: got '${got.shade}'  exp '${c.expectShade}'`);
    if (!sizeOk)  console.log(`        size:  got '${got.sizeClause}'  exp '${c.expectSize}'`);
  }
}

console.log("─".repeat(80));
console.log(`PASS ${pass}  /  FAIL ${fail}  (of ${CASES.length})`);
if (fail) process.exit(1);
