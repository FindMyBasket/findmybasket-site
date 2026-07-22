import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFamilyOffer, type FamilyPriceRow } from '../family-offer.ts';

const row = (
  price: number,
  opts: Partial<Omit<FamilyPriceRow, 'price'>> = {},
): FamilyPriceRow => ({
  price,
  url: opts.url ?? `https://example.com/p${price}`,
  in_stock: opts.in_stock ?? true,
  // 'in' check, not ??, so an explicit last_updated: null survives
  last_updated: 'last_updated' in opts ? opts.last_updated! : '2026-07-01',
});

test('empty family returns null', () => {
  assert.equal(pickFamilyOffer([]), null);
});

test('single row passes through (ungrouped product unchanged)', () => {
  const only = row(12.5);
  assert.equal(pickFamilyOffer([only]), only);
});

test('modal price wins over a clearance outlier', () => {
  // The Estée Lauder shape: dozens of shades at full price, one on clearance.
  const rows = [row(34), row(34), row(34), row(34), row(19.6)];
  assert.equal(pickFamilyOffer(rows)!.price, 34);
});

test('tie breaks HIGHER (never-cheapest house rule)', () => {
  const rows = [row(30), row(30), row(36), row(36)];
  assert.equal(pickFamilyOffer(rows)!.price, 36);
});

test('no clear mode (all prices distinct) picks the highest', () => {
  // Every price occurs once -> all tied at count 1 -> higher-price rider wins,
  // so a lone discounted shade can never become the headline price.
  const rows = [row(22), row(28.99), row(25.5)];
  assert.equal(pickFamilyOffer(rows)!.price, 28.99);
});

test('mode computed over in-stock rows only when any exist', () => {
  // Three OOS shades at the old promo price must not outvote two live shades.
  const rows = [
    row(24, { in_stock: false }),
    row(24, { in_stock: false }),
    row(24, { in_stock: false }),
    row(29, { in_stock: true }),
    row(29, { in_stock: true }),
  ];
  const picked = pickFamilyOffer(rows)!;
  assert.equal(picked.price, 29);
  assert.equal(picked.in_stock, true);
});

test('all rows out of stock still yields an offer, marked out of stock', () => {
  const rows = [row(18, { in_stock: false }), row(18, { in_stock: false })];
  const picked = pickFamilyOffer(rows)!;
  assert.equal(picked.price, 18);
  assert.equal(picked.in_stock, false);
});

test('representative row is the freshest at the chosen price', () => {
  const stale = row(34, { last_updated: '2026-05-20', url: 'https://example.com/stale' });
  const fresh = row(34, { last_updated: '2026-07-22', url: 'https://example.com/fresh' });
  const picked = pickFamilyOffer([stale, fresh, row(19.6)])!;
  assert.equal(picked.url, 'https://example.com/fresh');
});

test('null last_updated sorts behind any dated row', () => {
  const undated = row(34, { last_updated: null, url: 'https://example.com/undated' });
  const dated = row(34, { last_updated: '2026-01-01', url: 'https://example.com/dated' });
  assert.equal(pickFamilyOffer([undated, dated])!.url, 'https://example.com/dated');
});
