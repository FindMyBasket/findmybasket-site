import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripBrandPrefix, displayProductTitle } from '../product-name.ts';

// --- stripBrandPrefix --------------------------------------------------------

test('strips a simple brand prefix', () => {
  assert.equal(
    stripBrandPrefix("Kiehl's Calendula Cleanser", "Kiehl's"),
    'Calendula Cleanser'
  );
});

test('strips a brand containing punctuation (regex-escaped)', () => {
  assert.equal(
    stripBrandPrefix('L.A. COLORS Brow Pencil', 'L.A. COLORS'),
    'Brow Pencil'
  );
});

test('strips when spacing/punctuation differs', () => {
  // ── THIS TEST WAS OVERTURNED ON 26 AUGUST 2026, NOT CORRECTED ────────────────
  //
  // It previously asserted the OPPOSITE, under the name
  // `does not strip when spacing/punctuation differs (out of scope)`, with the
  // comment: '"L. A. Colors" (with internal spaces) is not a prefix of "L.A. COLORS".'
  //
  // That was true of the old regex and it was a DELIBERATE SCOPE DECISION, written
  // down and labelled. It is being reversed because the scope was decided before
  // anyone measured what it cost:
  //
  //   2,890 of 136,584 branded products fell outside it, and falling outside it did
  //   not mean "left alone" -- it meant the brand was PREPENDED, so the helper
  //   written to prevent a doubled brand produced one on every single row.
  //
  //   THE CASE THIS TEST NAMES IS NOW ONE OF THE WORST OFFENDERS: "L.A. COLORS"
  //   against "L. A. Colors" is 190 products, third largest after e.l.f. (668) and
  //   Living and Home (348), all rendering "L.A. COLORS L. A. Colors ...".
  //
  // A SCOPE DECISION MADE WITHOUT THE NUMBER IS A DIFFERENT ACT FROM ONE MADE WITH
  // IT. The original was not wrong to draw a boundary; it was drawn on an unmeasured
  // guess about what lay beyond it. Recorded here rather than in the work list alone,
  // because a test flipped without a note reads as a bug to whoever finds it next.
  // Item 355.
  assert.equal(
    stripBrandPrefix('L. A. Colors Brow Pencil', 'L.A. COLORS'),
    'Brow Pencil'
  );
});

test('consumes every consecutive copy of the brand, not just one', () => {
  // Following supabase/functions/_shared/match-key.ts, whose shape (1) consumes every
  // consecutive whole-brand repeat rather than a single one. Real row.
  assert.equal(
    stripBrandPrefix('La Roche Posay La Roche-Posay Cicaplast Baume B5+ 40ml', 'La Roche-Posay'),
    'Cicaplast Baume B5+ 40ml'
  );
});

test('the separator boundary is any non-alphanumeric, not an enumerated list', () => {
  // REGRESSION. The first draft used `[\s\-:.,]`. This real row broke it: `?` was not
  // in the list, so consumption stopped inside the punctuation, the rule then matched
  // the SECOND "So", and the title came out as "So...? …? Unique Truffle Cream...".
  //
  // An enumerated separator list is a guess about which punctuation exists in supplier
  // data. The comparison is already alphanumeric-only, so the boundary has to be too.
  // Found by SAMPLING the 4,312 changed titles, not by reasoning about them -- which is
  // the argument for reading a large diff rather than trusting it.
  assert.equal(
    stripBrandPrefix('So...? So\u2026? Unique Truffle Cream Body Mist 150ml', 'So...?'),
    'Unique Truffle Cream Body Mist 150ml'
  );
});

test('MID-WORD GUARD: does not strip a brand that opens a longer word', () => {
  // "Phytophanere" is a product line, not a repeat of "Phyto". Same for "OPIcons"
  // under brand "o_p_i", and "Bondi Bronze" under "Bondi Sands" -- the last is the
  // case match-key.ts's header reasons about by name.
  //
  // This guard is why 180 rows my brand-twice detector flags stay unchanged, and most
  // of those are not doubles at all. THE RULE CAN AT WORST MISS. Missing is safe;
  // over-stripping is not, and stripping "Phyto" out of "Phytophanere" would be worse
  // than leaving a genuine double alone. match-key.ts's judgement, unchanged.
  assert.equal(stripBrandPrefix('Phyto Phytophanere Ultra Serum 50ml', 'Phyto'), 'Phytophanere Ultra Serum 50ml');
  assert.equal(stripBrandPrefix('Bondi Sands Bondi Bronze Tanning Foam', 'Bondi Sands'), 'Bondi Bronze Tanning Foam');
});

test('matches case-insensitively', () => {
  assert.equal(stripBrandPrefix('TIRTIR Mask Fit', 'TirTir'), 'Mask Fit');
});

test('returns name unchanged when brand does not prefix it', () => {
  assert.equal(stripBrandPrefix('Body Lotion 400ml', 'Nivea'), 'Body Lotion 400ml');
});

test('returns original name when name equals brand exactly (safety)', () => {
  assert.equal(stripBrandPrefix('Chanel', 'Chanel'), 'Chanel');
});

test('tolerates a hyphen separator after the brand', () => {
  assert.equal(stripBrandPrefix('NYX - Soft Matte Lip Cream', 'NYX'), 'Soft Matte Lip Cream');
});

test('tolerates a colon separator after the brand', () => {
  assert.equal(stripBrandPrefix('Rimmel: Stay Matte Powder', 'Rimmel'), 'Stay Matte Powder');
});

test('returns name unchanged when brand is empty/null', () => {
  assert.equal(stripBrandPrefix('Some Product', ''), 'Some Product');
  assert.equal(stripBrandPrefix('Some Product', null), 'Some Product');
});

// Real catalogue names across the top doubled brands.
test('Kose', () => {
  assert.equal(
    stripBrandPrefix('Kose Softymo Speedy Cleansing Oil 230ml', 'Kose'),
    'Softymo Speedy Cleansing Oil 230ml'
  );
});

test('Shiseido', () => {
  assert.equal(
    stripBrandPrefix('Shiseido Ultimune Power Infusing Concentrate 50ml', 'Shiseido'),
    'Ultimune Power Infusing Concentrate 50ml'
  );
});

test('Maybelline', () => {
  assert.equal(
    stripBrandPrefix('Maybelline Sky High Mascara Black', 'Maybelline'),
    'Sky High Mascara Black'
  );
});

test('NYX', () => {
  assert.equal(
    stripBrandPrefix('NYX Professional Makeup Setting Spray', 'NYX'),
    'Professional Makeup Setting Spray'
  );
});

test('Clarins', () => {
  assert.equal(
    stripBrandPrefix('Clarins Double Serum 50ml', 'Clarins'),
    'Double Serum 50ml'
  );
});

test('MAC Cosmetics (multi-word brand)', () => {
  assert.equal(
    stripBrandPrefix('MAC Cosmetics Studio Fix Fluid Foundation NC15', 'MAC Cosmetics'),
    'Studio Fix Fluid Foundation NC15'
  );
});

// --- displayProductTitle -----------------------------------------------------

test('displayProductTitle does not double a brand the name already carries', () => {
  assert.equal(
    displayProductTitle("Kiehl's Calendula Cleanser", "Kiehl's"),
    "Kiehl's Calendula Cleanser"
  );
});

test('displayProductTitle prepends a brand the name lacks', () => {
  assert.equal(
    displayProductTitle('Body Lotion 400ml', 'Nivea'),
    'Nivea Body Lotion 400ml'
  );
});

test('displayProductTitle normalises a doubled prefix to a single brand', () => {
  // The full Kiehl's example from the brief.
  assert.equal(
    displayProductTitle("Kiehl's Calendula Deep Cleansing Foaming Face Wash 230ml", "Kiehl's"),
    "Kiehl's Calendula Deep Cleansing Foaming Face Wash 230ml"
  );
});

test('displayProductTitle does not double when name equals brand exactly', () => {
  assert.equal(displayProductTitle('Chanel', 'Chanel'), 'Chanel');
});

test('displayProductTitle returns name unchanged when brand is empty', () => {
  assert.equal(displayProductTitle('Body Lotion 400ml', ''), 'Body Lotion 400ml');
  assert.equal(displayProductTitle('Body Lotion 400ml', null), 'Body Lotion 400ml');
});

// ─────────────────────────────────────────────────────────────────────────────────
// AGREEMENT BETWEEN THE TWO IMPLEMENTATIONS.
//
// supabase/functions/_shared/product-name.ts mirrors this module because the Deno
// runtime cannot import a Next module. The tests above assert that the rule is
// CORRECT; the ones below assert that BOTH COPIES OF IT AGREE, which is a different
// property and the one that actually rots.
//
// ASSERTED AT THE MOMENT OF EXTRACTION, NOT DISCOVERED LATER. That is item 345: the
// delivery rule was extracted into _shared and the extraction worked, but the layer
// ABOVE it -- option-set construction -- was left holding two implementations of one
// rule, and they disagreed in production until somebody measured a saving that had
// been GBP 0.00 for every recipient. lib/__tests__/delivery.test.ts is the worked
// example this follows: import both, run one table through both, assert equality.
//
// If you edit either file and this fails, the two have diverged. That is the point.
// ─────────────────────────────────────────────────────────────────────────────────

import {
  stripBrandPrefix as edgeStrip,
  displayProductTitle as edgeTitle,
} from '../../../supabase/functions/_shared/product-name.ts';

/** Every shape the rule distinguishes, including the ones live data rarely produces. */
const AGREEMENT_CASES: Array<[name: string, brand: string | null]> = [
  // exact prefix, the 89.5% case
  ["Kiehl's Calendula Cleanser", "Kiehl's"],
  ['MAC Cosmetics Studio Fix Fluid Foundation NC15', 'MAC Cosmetics'],
  // punctuation and spacing variants, the 2,890
  ['e. l.f. Cosmetics 16hr Camo Concealer Deep Chestnut', 'e.l.f.'],
  ['L. A. Colors 28 Color Eyeshadow Beverly Hills 28g', 'L.A. COLORS'],
  ['Nails. Inc 2-in-1 Base Coat 5ml', 'Nails Inc'],
  ['Dr Jart Brightamin Brightening Serum Ampoule', 'Dr. Jart+'],
  ['Livingandhome 1000pcs Thin Makeup Remover Pads -Boxed', 'Living and Home'],
  // repeated copies
  ['La Roche Posay La Roche-Posay Cicaplast Baume B5+ 40ml', 'La Roche-Posay'],
  // mid-word guard
  ['Phyto Phytophanere Ultra Serum 50ml', 'Phyto'],
  ['Bondi Sands Bondi Bronze Tanning Foam', 'Bondi Sands'],
  ['o_p_i OPIcons - Infinite Shine 15ml', 'o_p_i'],
  // separator boundary
  ['So...? So\u2026? Unique Truffle Cream Body Mist 150ml', 'So...?'],
  ['Tiffany & Co. Eau de Parfum Spray 50ml', 'Tiffany & Co'],
  // separators the old regex left stranded
  ['Nivea. Body Lotion 400ml', 'Nivea'],
  ['NYX - Soft Matte Lip Cream', 'NYX'],
  ['Rimmel: Stay Matte Powder', 'Rimmel'],
  // no prefix at all
  ['Body Lotion 400ml', 'Nivea'],
  // degenerate
  ['Chanel', 'Chanel'],
  ['Some Product', ''],
  ['Some Product', null],
];

test('the Next and Deno implementations agree on stripBrandPrefix', () => {
  for (const [name, brand] of AGREEMENT_CASES) {
    assert.equal(
      stripBrandPrefix(name, brand),
      edgeStrip(name, brand),
      `stripBrandPrefix disagreed for name=${JSON.stringify(name)} brand=${JSON.stringify(brand)}`,
    );
  }
});

test('the Next and Deno implementations agree on displayProductTitle', () => {
  for (const [name, brand] of AGREEMENT_CASES) {
    assert.equal(
      displayProductTitle(name, brand),
      edgeTitle(name, brand),
      `displayProductTitle disagreed for name=${JSON.stringify(name)} brand=${JSON.stringify(brand)}`,
    );
  }
});
