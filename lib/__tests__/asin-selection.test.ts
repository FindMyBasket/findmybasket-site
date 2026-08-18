import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidate, generationToken, sizeToken, isBrandStore } from '../asin-selection.ts';

const P = (over = {}) => ({ id: 1, name: 'Anua Heartleaf Pore Control Cleansing Oil (200ml)', brand: 'Anua', barcodes: ['8809640732829'], ...over });
const C = (over = {}) => ({
  asin: 'B000000001', matchedEan: '8809640732829', amazonIds: ['8809640732829'],
  amazonTitle: 'Anua Heartleaf Pore Control Cleansing Oil, 200ml', amazonBrand: 'Anua',
  offer: { displayPrice: '£14.40', sellerName: 'Anua', inStock: true }, ...over,
});

// ── eligibility ──────────────────────────────────────────────────────────────────────

test('E1: a candidate sharing no barcode is not eligible', () => {
  const v = selectCandidate(P(), [C({ amazonIds: ['9999999999999'], matchedEan: null, offer: null })]);
  assert.equal(v.action, 'hold');
});

test('E1: leading zeros are not significant', () => {
  const v = selectCandidate(P({ barcodes: ['33984009486'] }), [C({ amazonIds: ['0033984009486'], matchedEan: null })]);
  assert.equal(v.action, 'select');
});

test('E2: a brand disagreement makes a barcode-sharing candidate ineligible', () => {
  const v = selectCandidate(P(), [C({ amazonBrand: 'Some Other Brand', offer: null })]);
  assert.equal(v.action, 'hold');
});

test('E2: an absent brand cannot disprove identity and does not fail', () => {
  const v = selectCandidate(P(), [C({ amazonBrand: null })]);
  assert.equal(v.action, 'select');
});

/**
 * THE BUG THE 18 AUGUST RE-MEASUREMENT CAUGHT. The first implementation filtered untokened
 * candidates out before comparing, so `4.0` beside an unversioned listing collapsed to one
 * token and E3 stopped firing — turning product 82251, measured as a hold, into a pick.
 * Absence is a value.
 */
test('E3: an explicit generation beside an unversioned listing is a disagreement', () => {
  const v = selectCandidate(P(), [
    C({ asin: 'B0A', amazonTitle: 'medicube Triple Collagen Serum for Nourishment' }),
    C({ asin: 'B0B', amazonTitle: 'MEDICUBE Triple Collagen Serum 4.0 (55 ml)' }),
  ]);
  assert.equal(v.action, 'hold');
  assert.match(v.on, /generation/);
});

test('E3: candidates agreeing on no generation token do not hold', () => {
  const v = selectCandidate(P(), [
    C({ asin: 'B0A', offer: { displayPrice: '£1', sellerName: 'Anua', inStock: true } }),
    C({ asin: 'B0B', offer: null }),
  ]);
  assert.equal(v.action, 'select');
});

// ── selection order ──────────────────────────────────────────────────────────────────

test('S1 beats S2: a live offer wins over an in-stock claim with no offer', () => {
  const v = selectCandidate(P(), [
    C({ asin: 'B0A', offer: null }),
    C({ asin: 'B0B', offer: { displayPrice: '£9', sellerName: 'Reseller', inStock: false } }),
  ]);
  assert.equal(v.action === 'select' && v.asin, 'B0B');
});

test('S2 beats S4: in stock wins over the brand store being out of stock', () => {
  const v = selectCandidate(P(), [
    C({ asin: 'B0A', offer: { displayPrice: '£9', sellerName: 'Anua', inStock: false } }),
    C({ asin: 'B0B', offer: { displayPrice: '£9', sellerName: 'Reseller', inStock: true } }),
  ]);
  assert.equal(v.action === 'select' && v.asin, 'B0B');
});

test('S3: a [Renewed] listing loses to an untagged one', () => {
  const v = selectCandidate(P(), [
    C({ asin: 'B0A', amazonTitle: 'Anua Heartleaf Pore Control Cleansing Oil [Renewed] 200ml' }),
    C({ asin: 'B0B' }),
  ]);
  assert.equal(v.action === 'select' && v.asin, 'B0B');
});

test('S4: the brand store wins when S1-S3 tie', () => {
  const v = selectCandidate(P(), [
    C({ asin: 'B0A', offer: { displayPrice: '£9', sellerName: 'Medpak EU', inStock: true } }),
    C({ asin: 'B0B', offer: { displayPrice: '£20', sellerName: 'Anua', inStock: true } }),
  ]);
  assert.equal(v.action === 'select' && v.asin, 'B0B');
});

/** S5 (price) was dropped, so identical listings from the same seller must HOLD, not pick. */
test('a tie through S4 holds rather than falling through to price', () => {
  const v = selectCandidate(P(), [
    C({ asin: 'B0A', offer: { displayPrice: '£19.58', sellerName: 'Anua', inStock: true } }),
    C({ asin: 'B0B', offer: { displayPrice: '£14.88', sellerName: 'Anua', inStock: true } }),
  ]);
  assert.equal(v.action, 'hold');
  assert.match(v.on, /S5/);
});

// ── the secondary path ───────────────────────────────────────────────────────────────

test('secondary path confirms when brand store AND title AND size all agree', () => {
  const logged: unknown[] = [];
  const v = selectCandidate(P(), [C({ amazonIds: ['8809640736254'], matchedEan: null })], (i) => logged.push(i));
  assert.equal(v.action, 'confirm');
  assert.equal(logged.length, 1);
});

test('secondary path declines a reseller even when title and size agree — the seller is load-bearing', () => {
  const v = selectCandidate(P(), [C({
    amazonIds: ['8809640736254'], matchedEan: null,
    offer: { displayPrice: '£14.99', sellerName: 'Medpak EU', inStock: true },
  })]);
  assert.equal(v.action, 'hold');
  assert.match(v.on, /not the brand store/);
});

test('secondary path declines when the size differs', () => {
  const v = selectCandidate(P(), [C({
    amazonIds: ['8809640736254'], matchedEan: null,
    amazonTitle: 'Anua Heartleaf Pore Control Cleansing Oil, 400ml',
  })]);
  assert.equal(v.action, 'hold');
});

test('secondary path never runs when more than one candidate has an offer', () => {
  const v = selectCandidate(P(), [
    C({ asin: 'B0A', amazonIds: ['999'], matchedEan: null }),
    C({ asin: 'B0B', amazonIds: ['888'], matchedEan: null }),
  ]);
  assert.equal(v.action, 'hold');
  assert.match(v.on, /no candidate shares a barcode/);
});

// ── helpers ──────────────────────────────────────────────────────────────────────────

test('generationToken reads explicit versions only, not sizes', () => {
  assert.equal(generationToken('Triple Collagen Serum 4.0 (55 ml)'), '4.0');
  assert.equal(generationToken('Cleansing Oil, 200ml'), null);
  assert.equal(generationToken('Pore Pads 2.0 (70 pads)'), '2.0');
});

test('sizeToken normalises units', () => {
  assert.equal(sizeToken('Cleansing Oil (200ml)'), '200ml');
  assert.equal(sizeToken('Oil, 200 ml'), '200ml');
  assert.equal(sizeToken('Pack of 30 Vegetable Capsules'), null);
});

test('isBrandStore is a name match and nothing stronger', () => {
  assert.equal(isBrandStore('COSRX Inc.', 'COSRX'), true);
  assert.equal(isBrandStore('BEAUTY OF JOSEON Official', 'Beauty of Joseon'), true);
  assert.equal(isBrandStore('Medpak EU', 'COSRX'), false);
  // The limitation, asserted so it is not mistaken for a guarantee: a seller who names
  // themselves after the brand passes. Work-list item 200.
  assert.equal(isBrandStore('COSRX Official Store', 'COSRX'), true);
});
