/**
 * Unit-level validation harness for the STAGE 2 extended detector
 *   classifyFragranceOrPersonalCare()  in
 *   supabase/functions/_shared/categorisation.ts
 *
 * This detector is DETECTION ONLY — it is not wired into inferCategorisation()
 * and changes no live classification. The harness asserts the precedence rules:
 *   - fragrance (hard form > perfumed/house body > bare noun)
 *   - personal care (functional body/bath/hand/deodorant)
 *   - the fragrance-free guard (never fragrance)
 *   - perfumed-vs-functional boundary (no double-claim, no fall-through)
 *   - genuine skincare / makeup / hair returns null (left untouched)
 *
 * Run:  npx tsx scripts/extended-categorisation-harness.mts
 */

import {
  classifyFragranceOrPersonalCare,
  inferCategorisation,
  inferCategorisationForImport,
  EXTENDED_CATEGORIES_ENABLED,
} from "../supabase/functions/_shared/categorisation.ts";

type Expect = "fragrance" | "personal_care" | null;
type Case = {
  name: string;
  brand?: string;
  expect: Expect;        // top_category the detector should return (null = leave as-is)
  expectType?: string;   // optional product_type assertion
  expectSub?: string;    // optional subcategory assertion
  note?: string;
};

const CASES: Case[] = [
  // ── FRAGRANCE: hard forms (the 165 core rows) ─────────────────────────────
  { name: "Boss The Scent Parfum For Him 100ml", brand: "Boss", expect: "fragrance", expectType: "Parfum" },
  { name: "Jean Paul Gaultier Gaultier Divine Le Parfum Intense Spray 100ml", brand: "Jean Paul Gaultier", expect: "fragrance", expectType: "Parfum" },
  { name: "Dior Sauvage Eau de Toilette 100ml", brand: "Dior", expect: "fragrance", expectType: "Eau de Toilette" },
  { name: "Chanel No.5 Eau de Parfum 100ml", brand: "Chanel", expect: "fragrance", expectType: "Eau de Parfum" },
  { name: "Marc Jacobs Daisy Love EDT 50ml", brand: "Marc Jacobs", expect: "fragrance", expectType: "Eau de Toilette" },
  { name: "V Canto Mea Culpa 100ml Extrait De Parfum", brand: "V Canto", expect: "fragrance", expectType: "Parfum" },
  { name: "4711 Original Eau de Cologne 100ml", brand: "4711", expect: "fragrance", expectType: "Cologne" },
  // hard form wins even inside a gift set that lists body care (matches the
  // existing inferCategorisation Commit-8 behaviour).
  { name: "Gisada Ambassador Women Eau de Parfum 50ml + Shower Gel 100ml", brand: "Gisada", expect: "fragrance", expectType: "Eau de Parfum", note: "EDP gift set with shower gel → fragrance, not personal care" },

  // ── FRAGRANCE: bare noun as product type ──────────────────────────────────
  { name: "Anfar 1950 Zenit Lilac 100ml Extrait parfum Zenit Series", brand: "Anfar", expect: "fragrance", expectType: "Parfum" },
  { name: "Hermes Eau des Merveilles Perfume 50ml", brand: "Hermes", expect: "fragrance" },

  // ── FRAGRANCE: perfumed bath/body + fragrance-house body (the §4 boundary) ─
  { name: "Jo Malone London Lime Basil & Mandarin Bath Oil 200ml", brand: "Jo Malone", expect: "fragrance", expectType: "Body Fragrance", expectSub: "body", note: "fragrance-house bath oil → fragrance" },
  { name: "Diptyque Philosykos Hand Cream 50ml", brand: "Diptyque", expect: "fragrance", expectType: "Body Fragrance", expectSub: "body", note: "fragrance-house hand cream → fragrance" },
  { name: "Byredo Gypsy Water Body Lotion 200ml", brand: "Byredo", expect: "fragrance", expectSub: "body" },
  { name: "Acme Perfumed Body Lotion 200ml", brand: "Acme", expect: "fragrance", expectType: "Body Fragrance", expectSub: "body", note: "'perfumed' + body form → fragrance" },

  // ── PERSONAL CARE: functional forms (no perfume signal) ───────────────────
  { name: "Imperial Leather Blackcurrant & Passionfruit Shower Gel Body Wash 200ml", brand: "Imperial Leather", expect: "personal_care", expectType: "Bath & Shower", expectSub: "body" },
  { name: "Palmolive Thermal Spa Silky Oil Shower Gel Body Wash 400ml", brand: "Palmolive", expect: "personal_care", expectType: "Bath & Shower", expectSub: "body" },
  { name: "Aveeno Skin Relief Body Lotion 300ml", brand: "Aveeno", expect: "personal_care", expectType: "Body Moisturiser", expectSub: "body" },
  { name: "Clarins Eau des Jardins Uplifting Body Lotion 200ml", brand: "Clarins", expect: "personal_care", expectType: "Body Moisturiser", expectSub: "body", note: "non-house body lotion → personal care" },
  { name: "Soap & Glory Call Of Fruity Hand Cream 125ml", brand: "Soap & Glory", expect: "personal_care", expectType: "Hand Care", expectSub: "hand" },
  { name: "Scottish Fine Soaps Coriander & Lime Leaf Hand Wash 300ml", brand: "Scottish Fine Soaps", expect: "personal_care", expectType: "Hand Care", expectSub: "hand" },
  { name: "Organic Shop Gingerbread Body Scrub Ginger & Orange 250ml", brand: "Organic Shop", expect: "personal_care", expectType: "Body Scrub", expectSub: "body" },
  { name: "Tisserand Total De-Stress Massage & Body Oil 100ml", brand: "Tisserand", expect: "personal_care", expectType: "Body Oil", expectSub: "body" },
  { name: "Givenchy L'Interdit The Shower Oil 200ml", brand: "Givenchy", expect: "personal_care", expectType: "Bath & Shower", expectSub: "body", note: "shower oil, no house/perfumed signal → personal care" },
  { name: "Westlab Mindful Magnesium Bath Salts 1kg", brand: "Westlab", expect: "personal_care", expectType: "Bath & Shower", expectSub: "body" },
  // deodorant routes to personal care (it is currently EXCLUDED at import; this
  // proves it WOULD route correctly once the category + config exist).
  { name: "Sol de Janeiro Rio Deo Cheirosa '40 Aluminum-Free Deodorant 57g", brand: "Sol de Janeiro", expect: "personal_care", expectType: "Deodorant", expectSub: "body" },
  { name: "Rituals Homme 24h Anti-Perspirant Spray", brand: "Rituals", expect: "personal_care", expectType: "Deodorant", expectSub: "body" },
  { name: "Dove Original Antiperspirant Roll-On 50ml", brand: "Dove", expect: "personal_care", expectType: "Deodorant", expectSub: "body" },

  // ── BOUNDARY: perfumed-vs-functional, no double-claim ─────────────────────
  // A fragrance-house brand's FUNCTIONAL body wash still → fragrance (house rule);
  // a high-street body wash → personal care. Both resolve to exactly one bucket.
  { name: "Floris White Rose Moisturising Bath & Shower Gel 250ml", brand: "Floris", expect: "personal_care", expectSub: "body", note: "Floris not on the tight house list → personal care (tunable)" },
  // "Fragrance" as a scent descriptor on a functional wash → NOT fragrance.
  { name: "Original Source Mint & Tea Tree Fragrance Shower Gel 250ml", brand: "Original Source", expect: "personal_care", expectType: "Bath & Shower", note: "'fragrance' is a descriptor here, not the product" },
  { name: "Shiseido Ma Cherie Fragrance Body Soap 450ml", brand: "Shiseido", expect: "personal_care", expectType: "Bath & Shower", note: "body soap with 'fragrance' descriptor → personal care" },

  // ── FRAGRANCE-FREE GUARD: must NEVER be fragrance ─────────────────────────
  // Plain sensitive-skin skincare → null (stays skincare).
  { name: "Bondi Sands Fragrance Free Sunscreen Lotion SPF50+ Face 75ml", brand: "Bondi Sands", expect: null, note: "fragrance-free SPF stays skincare" },
  { name: "VEGREEN Fragrance-free Nature Mucin Serum 50ml", brand: "VEGREEN", expect: null },
  { name: "Coola Classic Face Sunscreen Fragrance-Free SPF50 50ml", brand: "Coola", expect: null },
  { name: "Olay Regenerist Retinol 24 Max Night Serum Without Fragrance 40ml", brand: "Olay", expect: null },
  { name: "Generic Zero Fragrance Day Cream 50ml", brand: "Generic", expect: null, note: "'zero fragrance' guarded" },
  // Fragrance-free BODY product → personal care (guard blocks fragrance, NOT
  // personal care).
  { name: "LUNA DAILY The Fragrance-Free Everywhere Body Wash 400ml", brand: "LUNA DAILY", expect: "personal_care", expectType: "Bath & Shower", note: "fragrance-free body wash → personal care, never fragrance" },
  { name: "skybottle Blue Agave Fragrance-Free Hand Cream 50ml", brand: "skybottle", expect: "personal_care", expectType: "Hand Care", expectSub: "hand" },

  // ── DEFER / NULL: hair & 2-in-1 scent forms, and genuine face skincare ────
  { name: "L'Atelier Parfum - Green Crush Hair And Body Mist 50ml", brand: "L'Atelier Parfum", expect: null, note: "hair & body mist: 'parfum' is a descriptor → leave to inferCategorisation" },
  { name: "anillO Rosy Night Parfum Hair Mist 100ml", brand: "anillO", expect: null, note: "hair mist → defer" },
  { name: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", brand: "The Ordinary", expect: null, note: "genuine face skincare untouched" },
  { name: "CeraVe Foaming Facial Cleanser 236ml", brand: "CeraVe", expect: null, note: "face cleanser is not personal care" },
  { name: "La Roche-Posay Anthelios SPF50 Fluid 50ml", brand: "La Roche-Posay", expect: null },
  // Face / SPF guard: a body form alongside a clear face/SPF signal stays skincare.
  { name: "Dr H Anti-Ageing Facial Cleansing Bar 100g", brand: "Dr H", expect: null, note: "facial cleansing bar → skincare, not personal care" },
  { name: "Cetaphil Gentle Skin Cleanser Face Wash & Body Wash 236ml", brand: "Cetaphil", expect: null, note: "face+body 2-in-1 cleanser → skincare (face guard)" },
  { name: "Shiseido Expert Sun Protector Face & Body Lotion SPF50+ 150ml", brand: "Shiseido", expect: null, note: "SPF face & body lotion → skincare, not personal care" },
  // Guard must NOT over-reach: a plain body soap bar is still personal care.
  { name: "Dove Original Body Soap Bar 100g", brand: "Dove", expect: "personal_care", expectType: "Bath & Shower", note: "body soap bar still personal care" },
];

// ── Run ──────────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
let pass = 0;
let fail = 0;
const failed: string[] = [];

console.log(
  pad("RESULT", 6) + "  " + pad("got", 14) + "  " + pad("expect", 14) + "  " +
    pad("product_type", 16) + "  " + pad("sub", 6) + "  " + pad("rule", 16) + "  name",
);
console.log("─".repeat(130));

for (const c of CASES) {
  const r = classifyFragranceOrPersonalCare(c.name, c.brand ?? "");
  const got = r ? r.top_category : null;
  const ok =
    got === c.expect &&
    (c.expectType ? r?.product_type === c.expectType : true) &&
    (c.expectSub ? r?.subcategory === c.expectSub : true);
  if (ok) pass++;
  else { fail++; failed.push(c.name); }
  console.log(
    pad(ok ? "PASS" : "FAIL✗", 6) + "  " +
      pad(String(got ?? "null"), 14) + "  " +
      pad(String(c.expect ?? "null"), 14) + "  " +
      pad(r?.product_type || "—", 16) + "  " +
      pad(r?.subcategory || "—", 6) + "  " +
      pad(r?.rule || "—", 16) + "  " +
      c.name + (c.brand ? `  [${c.brand}]` : ""),
  );
}

console.log("─".repeat(130));
console.log(`PASS ${pass}  /  FAIL ${fail}  (of ${CASES.length})`);

// ── Stage 3: inferCategorisationForImport() gating ────────────────────────────
// Proves (a) the live flag is OFF, (b) with the flag OFF the importer path is
// byte-identical to inferCategorisation (no live behaviour change), and (c) with
// the flag ON, new imports route fragrance / personal care correctly while
// fragrance-free and makeup/hair are untouched.
console.log("\n=== Stage 3: inferCategorisationForImport() gating ===");
let opass = 0, ofail = 0;
const ofailed: string[] = [];
const check = (label: string, cond: boolean) => {
  if (cond) opass++; else { ofail++; ofailed.push(label); }
  console.log(`   ${cond ? "PASS " : "FAIL✗"}  ${label}`);
};

// (a) flag is OFF in the committed code.
check("EXTENDED_CATEGORIES_ENABLED is false (committed default)", EXTENDED_CATEGORIES_ENABLED === false);

// (b) flag OFF → identical to inferCategorisation for representative inputs.
const offSamples: Array<[string, string]> = [
  ["Chanel No.5 Eau de Parfum 100ml", "Chanel"],
  ["Sol de Janeiro Rio Deo Deodorant 57g", "Sol de Janeiro"],
  ["Imperial Leather Shower Gel Body Wash 200ml", "Imperial Leather"],
  ["Bondi Sands Fragrance Free Sunscreen SPF50+ Face 75ml", "Bondi Sands"],
  ["Maybelline Lash Sensational Mascara", "Maybelline"],
];
for (const [n, b] of offSamples) {
  const base = inferCategorisation(n, b);
  const off = inferCategorisationForImport(n, b, false);
  check(`OFF identical: ${n.slice(0, 40)}`,
    base.top_category === off.top_category && base.excluded === off.excluded &&
    base.product_type === off.product_type && base.subcategory === off.subcategory);
}

// (c) flag ON → correct routing.
const onCases: Array<{ name: string; brand?: string; top: string | null; note: string }> = [
  { name: "Chanel No.5 Eau de Parfum 100ml", brand: "Chanel", top: "fragrance", note: "fragrance (was excluded)" },
  { name: "Hugo Boss Bottled EDT 125ml After Shave Balm Shower Gel Gift Set", brand: "Hugo Boss", top: "fragrance", note: "fragrance gift set (was excluded)" },
  { name: "Imperial Leather Shower Gel Body Wash 200ml", brand: "Imperial Leather", top: "personal_care", note: "personal care (was skincare)" },
  { name: "Soap & Glory Hand Cream 125ml", brand: "Soap & Glory", top: "personal_care", note: "personal care hand" },
  { name: "Sol de Janeiro Rio Deo Deodorant 57g", brand: "Sol de Janeiro", top: "personal_care", note: "deodorant routes personal care (was excluded)" },
  { name: "Bondi Sands Fragrance Free Sunscreen SPF50+ Face 75ml", brand: "Bondi Sands", top: "skincare", note: "fragrance-free stays skincare" },
  { name: "CeraVe Foaming Facial Cleanser 236ml", brand: "CeraVe", top: "skincare", note: "face cleanser stays skincare" },
  { name: "Maybelline Lash Sensational Mascara", brand: "Maybelline", top: "makeup", note: "makeup untouched" },
  { name: "Olaplex No.4 Bond Maintenance Shampoo 250ml", brand: "Olaplex", top: "hair", note: "hair untouched" },
  { name: "Lynx Africa Body Spray 150ml", brand: "Lynx", top: null, note: "body-spray deodorant stays excluded (no PC form)" },
];
for (const c of onCases) {
  const on = inferCategorisationForImport(c.name, c.brand ?? "", true);
  const got = on.excluded ? null : on.top_category;
  check(`ON ${c.note}: got ${on.excluded ? `excl:${on.excluded}` : on.top_category}`, got === c.top);
}

console.log(`\nGATING PASS ${opass}  /  FAIL ${ofail}`);

const totalFailed = failed.length + ofailed.length;
if (totalFailed) {
  console.log(`\n⚠️  ${totalFailed} case(s) failing:`);
  for (const n of [...failed, ...ofailed]) console.log(`   - ${n}`);
  process.exit(1);
}
