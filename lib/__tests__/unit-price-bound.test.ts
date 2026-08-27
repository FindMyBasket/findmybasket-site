/**
 * CAN THE BOUND FIRE, AND CAN IT BE MADE TO FIRE WHEN IT SHOULD NOT?
 *
 * The median-ratio bound on the per-100g type pages (items 441, 443) fires ZERO times
 * on both live pages. Whey's dearest row is 1.7x its median; creatine's one qualifying
 * row is excluded a step earlier as a blend (item 443's absorption finding).
 *
 * FROM THE OUTSIDE, "NEVER FIRED" AND "CANNOT FIRE" LOOK IDENTICAL. Nothing on either
 * page distinguishes a guard that is correct and idle from one that is broken and
 * silent -- and the two ways of resolving that in production are both bad: wait for a
 * real bad row (the guard's first observation is its first failure), or loosen the
 * fungibility filter until the excluded row comes back (arranging a demonstration on a
 * product that does not belong on the page).
 *
 * So it is exercised here instead, against synthetic rows, in BOTH DIRECTIONS -- trying
 * to make it refuse something it should keep as hard as trying to make it keep
 * something it should refuse. Same shape as the held-product guard's test.
 *
 * The numbers are chosen to sit on the boundary rather than far from it: a bound tested
 * only with a 100x outlier proves nothing about where it actually cuts. Item 444.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankByUnitPrice, type PerUnitProduct } from '../unit-price.ts';

let nextId = 1;
function row(name: string, per100g: number | null): PerUnitProduct {
  return {
    id: nextId++, name, brand: 'B', brand_slug: 'b', image_url: 'i',
    price: 10, grams: per100g === null ? null : 100, per100g, retailer_count: 1,
  };
}
/** Five rows at £5 so the median is exactly £5 and the bound exactly £50. */
const base = () => [row('a', 5), row('b', 5), row('c', 5), row('d', 5), row('e', 5)];

test('the bound FIRES on a row above it', () => {
  const { ranked, unranked, median, bound } = rankByUnitPrice([...base(), row('outlier', 500)]);
  assert.equal(median, 5);
  assert.equal(bound, 50);
  assert.equal(ranked.length, 5);
  assert.equal(unranked.length, 1);
  assert.match(unranked[0].excluded ?? '', /over 10x the £5\.00 median/);
});

test('the bound DOES NOT fire just below it — it is not over-refusing', () => {
  const { ranked, unranked } = rankByUnitPrice([...base(), row('dear but real', 49.99)]);
  assert.equal(ranked.length, 6, 'a row inside the bound must rank');
  assert.equal(unranked.length, 0);
});

test('the boundary is strict: exactly at the bound ranks, a penny over does not', () => {
  assert.equal(rankByUnitPrice([...base(), row('exact', 50)]).ranked.length, 6);
  assert.equal(rankByUnitPrice([...base(), row('over', 50.01)]).ranked.length, 5);
});

test('a non-comparable row CANNOT widen the tolerance it is measured against', () => {
  // The blend is priced high enough to drag the median up if it were counted. If it
  // were, the bound would rise and the genuine error would slip through -- which is the
  // whole reason the median is computed over the fungible set only.
  const notFungible = [{ test: /blend/i, reason: 'blend' }];
  const rows = [...base(), row('creatine blend', 400), row('genuine error', 300)];
  const { ranked, unranked, median, bound } = rankByUnitPrice(rows, { notFungible });
  assert.equal(median, 5, 'the blend must not move the median');
  assert.equal(bound, 50);
  assert.equal(ranked.length, 5);
  const reasons = unranked.map(u => u.excluded ?? '');
  assert.ok(reasons.some(r => r === 'blend'), 'the blend is excluded as a blend');
  assert.ok(reasons.some(r => /over 10x/.test(r)), 'the error is excluded by the bound');
});

test("ABSORPTION, item 443: a row matching both is excluded by fungibility, and the bound never sees it", () => {
  // This is exactly what happened to Zooki. The row is BOTH a blend and priced like a
  // pack-size error. It must be reported as a blend -- the true reason -- and the test
  // exists so that the bound's silence on that row is a recorded consequence rather
  // than an unnoticed one.
  const notFungible = [{ test: /blend/i, reason: 'blend' }];
  const { unranked } = rankByUnitPrice([...base(), row('blend at a broken price', 590)], { notFungible });
  assert.equal(unranked.length, 1);
  assert.equal(unranked[0].excluded, 'blend');
  assert.doesNotMatch(unranked[0].excluded ?? '', /over 10x/);
});

test('nothing is dropped: every input row comes back ranked or unranked', () => {
  const notFungible = [{ test: /blend/i, reason: 'blend' }];
  const rows = [...base(), row('blend', 9), row('no size', null), row('outlier', 900)];
  const { ranked, unranked } = rankByUnitPrice(rows, { notFungible });
  assert.equal(ranked.length + unranked.length, rows.length);
  assert.ok(unranked.every(u => (u.excluded ?? '').length > 0), 'every exclusion carries a reason');
});

test('an all-unpriced type yields no median and refuses to rank rather than dividing by nothing', () => {
  const { ranked, unranked, median, bound } = rankByUnitPrice([row('x', null), row('y', null)]);
  assert.equal(median, null);
  assert.equal(bound, null);
  assert.equal(ranked.length, 0);
  assert.equal(unranked.length, 2);
});
