import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  retailerSubtotals,
  type AttributableBreakdownItem,
} from '../basket-attribution.ts';

// The load-bearing invariant: a "Shop {retailer}" button must send that retailer's
// subtotal as the click value, NOT the basket total. If this regresses, GA4 revenue
// silently inflates on every split basket and no error is ever thrown.
test('split basket: each retailer value is its own subtotal, never the basket total', () => {
  const breakdown: AttributableBreakdownItem[] = [
    { retailerName: 'Boots', retailerId: 5, url: 'https://awin1.com/a', price: 10 },
    { retailerName: 'Boots', retailerId: 5, url: 'https://awin1.com/b', price: 5 },
    { retailerName: 'LookFantastic', retailerId: 7, url: 'https://awin1.com/c', price: 20 },
  ];
  const basketTotal = breakdown.reduce((s, b) => s + (b.price ?? 0), 0); // 35

  const agg = retailerSubtotals(breakdown);

  assert.equal(agg.Boots.subtotal, 15);
  assert.equal(agg.LookFantastic.subtotal, 20);
  // No retailer's attributable value equals the basket total in a split basket.
  for (const name of Object.keys(agg)) {
    assert.notEqual(
      agg[name].subtotal,
      basketTotal,
      `${name} subtotal must not equal the basket total ${basketTotal}`
    );
  }
});

test('single-retailer basket: the one subtotal legitimately equals the basket total', () => {
  const breakdown: AttributableBreakdownItem[] = [
    { retailerName: 'Boots', retailerId: 5, url: 'https://awin1.com/a', price: 10 },
    { retailerName: 'Boots', retailerId: 5, url: 'https://awin1.com/b', price: 5 },
  ];
  const agg = retailerSubtotals(breakdown);
  assert.equal(Object.keys(agg).length, 1);
  assert.equal(agg.Boots.subtotal, 15); // == basket total, correctly, for one shop
});

test('retailerId and first url are preserved per retailer', () => {
  const breakdown: AttributableBreakdownItem[] = [
    { retailerName: 'Boots', retailerId: 5, url: 'https://awin1.com/first', price: 10 },
    { retailerName: 'Boots', retailerId: 5, url: 'https://awin1.com/second', price: 5 },
  ];
  const agg = retailerSubtotals(breakdown);
  assert.equal(agg.Boots.retailerId, 5);
  assert.equal(agg.Boots.url, 'https://awin1.com/first');
});

test('items without a url are excluded (no clickable destination)', () => {
  const breakdown: AttributableBreakdownItem[] = [
    { retailerName: 'Boots', retailerId: 5, url: 'https://awin1.com/a', price: 10 },
    { retailerName: 'Not tracked yet', url: '', price: null },
  ];
  const agg = retailerSubtotals(breakdown);
  assert.deepEqual(Object.keys(agg), ['Boots']);
});

test('null prices contribute nothing to a subtotal', () => {
  const breakdown: AttributableBreakdownItem[] = [
    { retailerName: 'Boots', retailerId: 5, url: 'https://awin1.com/a', price: null },
    { retailerName: 'Boots', retailerId: 5, url: 'https://awin1.com/b', price: 8 },
  ];
  const agg = retailerSubtotals(breakdown);
  assert.equal(agg.Boots.subtotal, 8);
});
