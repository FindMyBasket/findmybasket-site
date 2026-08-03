/**
 * Barcode validator tests.
 *
 * WHY THESE MATTER MORE THAN THEIR SIZE SUGGESTS. The obvious reading of "EAN checksum
 * validation" is an EAN-13-only validator. Measured against live data on 3 Aug 2026,
 * that would have REJECTED 6,228 barcodes that work correctly today: 2,629 on
 * Debenhams and 3,068 on Beauty Bay, both of which supply UPC-A (12 digits).
 *
 * It would have reported a clean pass while destroying more than it protected. A
 * safeguard can fail CONFIDENTLY rather than silently. See migrations/README.md
 * convention 15.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBarcode, coalesceField } from '../../supabase/functions/_shared/barcode.ts';

test('EAN-13 with a valid checksum is accepted unchanged', () => {
  assert.equal(validateBarcode('5000112637922').value, '5000112637922');
  assert.equal(validateBarcode('5000112637922').reason, null);
});

test('UPC-A is accepted and normalised to 13 digits', () => {
  // THE CASE THAT WOULD HAVE BEEN DESTROYED. 12 digits, valid UPC-A. Left-padding with
  // a zero is lossless and makes it match the same product at an EAN-13 retailer.
  const r = validateBarcode('036000291452');
  assert.equal(r.value, '0036000291452');
  assert.equal(r.reason, null);
});

test('a wrong check digit is rejected', () => {
  const r = validateBarcode('5000112637923');
  assert.equal(r.value, null);
  assert.equal(r.reason, 'checksum');
});

test('an absent barcode is absent, not invalid', () => {
  // Distinguishing these matters: rejections are counted and reported per run as a
  // finding about the feed. Counting empties as rejections would bury the signal.
  assert.deepEqual(validateBarcode(''), { value: null, reason: null });
  assert.deepEqual(validateBarcode('   '), { value: null, reason: null });
});

test('wrong lengths are rejected with the length named', () => {
  assert.equal(validateBarcode('12345').reason, 'length_5');
  assert.equal(validateBarcode('12345678901234').reason, 'length_14');
});

test('all-zero placeholders are rejected', () => {
  assert.equal(validateBarcode('0000000000000').reason, 'all_zero');
});

test('separators and spaces are tolerated', () => {
  assert.equal(validateBarcode(' 5000112637922 ').value, '5000112637922');
  assert.equal(validateBarcode('5-000112-637922').value, '5000112637922');
});

test('a rejected barcode never throws, so a row still imports', () => {
  // Rejecting a barcode must cost the row its barcode, never its listing.
  for (const bad of ['abc', '!!!', '1', '999999999999999999']) {
    assert.doesNotThrow(() => validateBarcode(bad));
    assert.equal(validateBarcode(bad).value, null);
  }
});

test('coalesce prefers the primary and never re-sources a working column', () => {
  // Ordering is the whole reason the four working retailers cannot move.
  const fields = ['PRIMARY', 'SIBLING'];
  assert.deepEqual(coalesceField(fields, 0, 1), { value: 'PRIMARY', usedAlt: false });
});

test('coalesce falls back only when the primary is empty', () => {
  assert.deepEqual(coalesceField(['', 'SIBLING'], 0, 1), { value: 'SIBLING', usedAlt: true });
  assert.deepEqual(coalesceField(['   ', 'SIBLING'], 0, 1), { value: 'SIBLING', usedAlt: true });
});

test('coalesce handles a missing sibling column', () => {
  // google_shopping passes -1 for every sibling: the branch must be inert there.
  assert.deepEqual(coalesceField(['', 'X'], 0, -1), { value: '', usedAlt: false });
  assert.deepEqual(coalesceField(['P', 'X'], 0, -1), { value: 'P', usedAlt: false });
});

test('both empty yields empty, not a false positive', () => {
  assert.deepEqual(coalesceField(['', ''], 0, 1), { value: '', usedAlt: false });
});
