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

test('does not strip when spacing/punctuation differs (out of scope)', () => {
  // "L. A. Colors" (with internal spaces) is not a prefix of "L.A. COLORS".
  assert.equal(
    stripBrandPrefix('L. A. Colors Brow Pencil', 'L.A. COLORS'),
    'L. A. Colors Brow Pencil'
  );
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
