import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TITLE_CAP,
  comparisonKey,
  truncate,
  titleWithSuffix,
  buildSeoDescription,
  productMetadataCopy,
  brandMetadataCopy,
} from '../format/metadata-copy.ts';

// ── THE THREE PRODUCT BRANCHES ────────────────────────────────────────────────

test('product A: 2+ stockists states the count', () => {
  const { title, fallbackDescription } = productMetadataCopy({
    baseTitle: 'CeraVe Moisturising Cream 454g',
    stockists: 3,
    soleRetailer: null,
  });
  assert.match(title, /prices compared across 3 UK retailers \| FindMyBasket$/);
  assert.match(fallbackDescription, /across 3 UK retailers, delivery included/);
});

test('product B: exactly one stockist names it and makes no comparison claim', () => {
  const { title, fallbackDescription } = productMetadataCopy({
    baseTitle: 'Polytar Scalp Shampoo 150ml',
    stockists: 1,
    soleRetailer: 'Boots',
  });
  assert.equal(title, 'Polytar Scalp Shampoo 150ml | Boots price with delivery | FindMyBasket');
  assert.match(fallbackDescription, /is stocked at Boots from our UK retailers/);
  assert.doesNotMatch(fallbackDescription, /compare/i);
});

test('product C: zero stockists claims nothing about price', () => {
  const { title, fallbackDescription } = productMetadataCopy({
    baseTitle: 'Pebl Hair And Body Mist 100ml',
    stockists: 0,
    soleRetailer: null,
  });
  assert.equal(title, 'Pebl Hair And Body Mist 100ml | Not currently in stock | FindMyBasket');
  assert.match(fallbackDescription, /is not in stock at any of our UK retailers right now/);
  // THE POINT OF THE BRANCH: no price language at all, in either direction.
  assert.doesNotMatch(fallbackDescription, /compare|cheapest|price with delivery/i);
});

test('product: one stockist with no name falls to C rather than making a blank claim', () => {
  // The RPC does not currently produce this (checked across all 99,241 live pages), but an
  // unreadable name must degrade to the smaller claim, never to "stocked at ".
  const { title, fallbackDescription } = productMetadataCopy({
    baseTitle: 'Some Product',
    stockists: 1,
    soleRetailer: null,
  });
  assert.match(title, /Not currently in stock/);
  assert.doesNotMatch(fallbackDescription, /stocked at\s*\./);
});

// ── THE THREE BRAND-HUB BRANCHES ──────────────────────────────────────────────

test('brand Group 1: comparable products state the count and the number comparable', () => {
  const { title, fallbackDescription } = brandMetadataCopy({
    displayName: 'NIOD', stockists: 2, comparable: 7, soleRetailer: null,
  });
  assert.equal(title, 'NIOD prices compared across 2 UK retailers | FindMyBasket');
  assert.match(fallbackDescription, /7 products with more than one stockist\.$/);
});

test('brand Group 1: singular when exactly one product is comparable', () => {
  const { fallbackDescription } = brandMetadataCopy({
    displayName: 'PRMR', stockists: 2, comparable: 1, soleRetailer: null,
  });
  assert.match(fallbackDescription, /1 product with more than one stockist\.$/);
});

test('brand Group 2: one stockist is named', () => {
  const { title, fallbackDescription } = brandMetadataCopy({
    displayName: 'Habi', stockists: 1, comparable: 0, soleRetailer: 'Boots',
  });
  assert.equal(title, 'Where to buy Habi in the UK | FindMyBasket');
  assert.match(fallbackDescription, /^Habi is stocked at Boots from our UK retailers\./);
});

test('brand Group 3: nothing in stock claims no price — item 282', () => {
  // THE DEFECT THIS TEST EXISTS FOR: Polytar has one product, zero in stock, so it took the
  // Group 2 fallback and was told "delivery included in every price" when there is no price.
  const { fallbackDescription } = brandMetadataCopy({
    displayName: 'Polytar', stockists: 0, comparable: 0, soleRetailer: null,
  });
  assert.doesNotMatch(fallbackDescription, /delivery included in every price/);
  assert.match(fallbackDescription, /Nothing from the range is in stock right now\./);
});

test('brand: 2+ stockists but nothing comparable keeps the general line', () => {
  // 190 hubs. Prices DO exist here, so the delivery line is supportable and stays.
  const { fallbackDescription } = brandMetadataCopy({
    displayName: 'Acme', stockists: 3, comparable: 0, soleRetailer: null,
  });
  assert.match(fallbackDescription, /delivery included in every price/);
});

// ── THE NORMALISED DUPLICATE GUARD — item 283 ─────────────────────────────────

test('description: one comma no longer defeats the duplicate guard', () => {
  // THE EXACT LIVE CASE, product 134110. The raw-substring guard this replaced returned
  // false here and appended the title, so the page served its own name twice.
  const title = 'Treaclemoon Sticky Toffee Pudding Shower & Bath Gel 500ml';
  const description = 'Treaclemoon Sticky Toffee Pudding Shower & Bath Gel, 500ml';
  assert.equal(buildSeoDescription(description, title, 'FALLBACK', 155), description);
});

test('description: a genuinely different description still gets the title appended', () => {
  const title = 'CeraVe Moisturising Cream 454g';
  const description = 'A rich cream for dry skin.';
  assert.equal(
    buildSeoDescription(description, title, 'FALLBACK', 155),
    'A rich cream for dry skin. CeraVe Moisturising Cream 454g',
  );
});

test('description: an empty description takes the fallback', () => {
  assert.equal(buildSeoDescription('   ', 'T', 'FALLBACK', 155), 'FALLBACK');
  assert.equal(buildSeoDescription(null, 'T', 'FALLBACK', 155), 'FALLBACK');
});

test('description: never exceeds the cap on either path', () => {
  const long = 'x'.repeat(400);
  assert.ok(buildSeoDescription(long, 'T', 'F', 155).length <= 155);
  assert.ok(buildSeoDescription(null, 'T', 'y'.repeat(400), 155).length <= 155);
});

test('comparisonKey ignores punctuation, case and spacing', () => {
  assert.equal(comparisonKey('Shower & Bath Gel, 500ml'), comparisonKey('shower  bath gel 500ml'));
});

// ── TRUNCATION: THE NAME IS CUT, THE SUFFIX IS KEPT ───────────────────────────

test('title: an over-long name is shortened and the suffix survives intact', () => {
  const suffix = ' prices compared across 4 UK retailers | FindMyBasket';
  const title = titleWithSuffix('N'.repeat(200), suffix);
  assert.ok(title.endsWith(suffix), 'the claim must never be the part that gets cut');
  assert.equal(title.length, TITLE_CAP);
});

test('title: a short name is left exactly as it is', () => {
  assert.equal(titleWithSuffix('Short', ' | X'), 'Short | X');
});

test('title: the real 73-character live case keeps a whole claim', () => {
  const base = 'Treaclemoon Limited Edition Sticky Toffee Pudding Shower & Bath Gel 500ml';
  const { title } = productMetadataCopy({ baseTitle: base, stockists: 2, soleRetailer: null });
  assert.ok(title.endsWith(' prices compared across 2 UK retailers | FindMyBasket'));
  assert.ok(title.length <= TITLE_CAP);
});

test('truncate leaves no trailing space before the ellipsis', () => {
  // The cut lands mid-space: slice gives 'abc ', which must not become 'abc …'.
  assert.equal(truncate('abc defg', 5), 'abc…');
  assert.equal(truncate('abc def ghi', 8), 'abc def…');
  assert.equal(truncate('short', 99), 'short');
});
