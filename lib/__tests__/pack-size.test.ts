import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnitSizeOfMultipack, displaySizeChip } from '../format/pack-size.ts';

// ── Must SUPPRESS: canonical_size holds the unit, not the pack ───────────────
// Real live rows, measured 21 August 2026. The multiplier column is the factor
// by which the rendered chip understated the pack.
const MUST_SUPPRESS: { name: string; chip: string; understatedBy: number }[] = [
  { name: 'Vida Glow Natural Marine Collagen 90 x 3g Sachets - Original Flavour', chip: '3g', understatedBy: 90 },
  { name: 'simpa Phyto-Caffeine Shampoo for Fine, Brittle Hair. 50 x 20ml', chip: '20ml', understatedBy: 50 },
  { name: 'Vida Glow Natural Marine Collagen Peach - 30 X 3G Sachets', chip: '3g', understatedBy: 30 },
  { name: 'Kérastase Densifique Treatment Homme 30 x 6ml', chip: '6ml', understatedBy: 30 },
  { name: 'Vida Glow Anti-G-Ox™ Berry 30 x 2g Sachets', chip: '2g', understatedBy: 30 },
  { name: 'Slim Fast Slimfast Chocolate Flavour Shake 6 X 325ml', chip: '325ml', understatedBy: 6 },
  { name: 'Optimum Nutrition Gold Standard 100% Whey Vanilla Ice Cream 2 X 450g', chip: '450g', understatedBy: 2 },
  { name: 'Humantra Apricot Electrolyte Powder 3 X 4.2G Sachets', chip: '4.2g', understatedBy: 3 },
];

for (const row of MUST_SUPPRESS) {
  test(`suppresses "${row.chip}" understating by ${row.understatedBy}x — ${row.name.slice(0, 44)}`, () => {
    assert.equal(isUnitSizeOfMultipack(row.name, row.chip), true);
    assert.equal(displaySizeChip(row.name, row.chip), null);
  });
}

// ── Must KEEP: the extractor was right because the pack total came last ──────
// THE EVIDENCE FOR THE PRECISE PREDICATE. A broad "name contains N x M" rule
// would delete every one of these. They are the reason the guard requires the
// chip to EQUAL the unit size rather than merely coexist with a pack pattern.
const MUST_KEEP_PACK_TOTAL: { name: string; chip: string }[] = [
  { name: 'Sun Bum Lip Balm SPF30 3 x 4.25g Set 12.75g', chip: '12.75g' },
  { name: 'Matrix Biolage ScalpSync Aminexil Hair Treatment 10 x 6ml', chip: '60ml' },
  { name: 'Organix Banana Puffcorn 40G (4X10G)', chip: '40g' },
  { name: 'Swiish Supergreen Superfood Powder 30g - 10 X3G Sachets', chip: '30g' },
  { name: 'All Saints Travel Set 3x10ml', chip: '30ml' },
  { name: 'BELLAVITA LUXURY Gift Set Bundle 12 x 20ml EDP for Men, Women & Unisex', chip: '240ml' },
];

for (const row of MUST_KEEP_PACK_TOTAL) {
  test(`keeps correct pack total "${row.chip}" — ${row.name.slice(0, 44)}`, () => {
    assert.equal(isUnitSizeOfMultipack(row.name, row.chip), false);
    assert.equal(displaySizeChip(row.name, row.chip), row.chip);
  });
}

// ── Must KEEP: ordinary single-item products, the overwhelming majority ──────
const MUST_KEEP_PLAIN: { name: string; chip: string }[] = [
  { name: 'EHPLABS Oxyshred, Juicy Watermelon, Pre Workout Powder 96g', chip: '96g' },
  { name: 'Osavi Collagen Peptides - Hydrolyzed Type 1 & 3 600g', chip: '600g' },
  { name: 'BetterYou Daily Multi Vitamin Oral Spray 25 ml', chip: '25ml' },
  { name: "Clarins Hydrating Toning Lotion Refill 400ml Refill", chip: '400ml' },
];

for (const row of MUST_KEEP_PLAIN) {
  test(`keeps plain single-item size "${row.chip}" — ${row.name.slice(0, 44)}`, () => {
    assert.equal(isUnitSizeOfMultipack(row.name, row.chip), false);
    assert.equal(displaySizeChip(row.name, row.chip), row.chip);
  });
}

// ── Boundary: a multiplier of 1 is not an understatement ─────────────────────
test('multiplier of 1 is kept — unit and pack are the same quantity', () => {
  const name = 'Reuzel 2026 Road Trip, Extreme Hold Matte Pomade (1 x 95g, 1 x 35g)';
  assert.equal(isUnitSizeOfMultipack(name, '95g'), false);
  assert.equal(displaySizeChip(name, '95g'), '95g');
});

// ── Bound: rows wrong in OTHER ways are deliberately NOT fixed ───────────────
// Recorded as tests so the limit is asserted rather than described. These need
// the column remedy; the display guard must not pretend to cover them.
test('does not fix a chip that matches neither unit nor pack', () => {
  // Pack is 67.5g, unit is 4.5g, chip says 5g — the guard cannot tell 5g is wrong.
  const name = 'Made By Mitchell Lip Palette Rose Garden 15X4.5g';
  assert.equal(isUnitSizeOfMultipack(name, '5g'), false);
  assert.equal(displaySizeChip(name, '5g'), '5g');
});

test('does not fix a chip carrying the wrong unit entirely', () => {
  const name = 'Nicce Body Wash Set 3 x 150ml Original#01, Fresh#02, Intense #03';
  assert.equal(displaySizeChip(name, '440g'), '440g');
});

// ── Input handling ──────────────────────────────────────────────────────────
test('null and empty inputs render nothing and never throw', () => {
  assert.equal(displaySizeChip(null, null), null);
  assert.equal(displaySizeChip('Some Product 30 x 3g', null), null);
  assert.equal(displaySizeChip('Some Product 30 x 3g', '   '), null);
  assert.equal(displaySizeChip(null, '30ml'), '30ml');
  assert.equal(isUnitSizeOfMultipack(undefined, undefined), false);
});

test('whitespace and case variation in the stored chip still match', () => {
  assert.equal(isUnitSizeOfMultipack('Brand Thing 30 x 3g Sachets', '3 G'), true);
  assert.equal(isUnitSizeOfMultipack('Brand Thing 30 X 3G Sachets', '3g'), true);
});
