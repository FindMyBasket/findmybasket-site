/**
 * Slice-count merge tests.
 *
 * THE POINT OF THESE IS THAT THE PREVIOUS VERSION WAS "TESTED". Stage 1 of the AWIN
 * coalesce ran against The Organic Pharmacy: sliced_import=true, but ONE slice at 114
 * rows, so the merge never executed, and zero barcode rejections meant the field was
 * empty either way. The run was clean and the question was closed.
 *
 * Stage 2 was four slices with 1,326 rejections and produced
 * "0[object Object][object Object][object Object][object Object]".
 *
 * These tests exercise the FOUR-SLICE case explicitly, because a one-slice case cannot
 * reach the code. README conventions 17 and 18.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSliceCounts, SAMPLES_PER_REASON } from '../../supabase/functions/_shared/merge-counts.ts';

/** Fold slices left to right, as the importer does. */
const fold = (slices: Record<string, unknown>[]) =>
  slices.reduce<Record<string, unknown>>((acc, s) => mergeSliceCounts(acc, s), {});

test('counters sum across slices', () => {
  const r = fold([{ rows_with_ean: 10 }, { rows_with_ean: 5 }, { rows_with_ean: 0 }, { rows_with_ean: 7 }]);
  assert.equal(r.rows_with_ean, 22);
});

test('a boolean flag is NOT summed — this is the bug that exposed the rest', () => {
  // sibling_coalesce arrived as 4 across four slices, which is what made the object
  // corruption visible in the first place.
  const r = fold([{ sibling_coalesce: true }, { sibling_coalesce: true }, { sibling_coalesce: true }, { sibling_coalesce: true }]);
  assert.equal(r.sibling_coalesce, true);
});

test('reason tallies sum PER KEY, not stringify', () => {
  const r = fold([
    { barcode_reject_reasons: { checksum: 40 } },
    { barcode_reject_reasons: { checksum: 12, length_5: 3 } },
    { barcode_reject_reasons: { all_zero: 8 } },
    { barcode_reject_reasons: {} },
  ]);
  assert.deepEqual(r.barcode_reject_reasons, { checksum: 52, length_5: 3, all_zero: 8 });
});

test('reason tallies are ORDER-INDEPENDENT', () => {
  // Required: slices commit in whatever order they finish.
  const a = { barcode_reject_reasons: { checksum: 40 } };
  const b = { barcode_reject_reasons: { checksum: 12, length_5: 3 } };
  const c = { barcode_reject_reasons: { all_zero: 8 } };
  assert.deepEqual(fold([a, b, c]).barcode_reject_reasons, fold([c, a, b]).barcode_reject_reasons);
  assert.deepEqual(fold([a, b, c]).barcode_reject_reasons, fold([b, c, a]).barcode_reject_reasons);
});

test('samples are capped PER REASON, so a common reason cannot crowd out a rare one', () => {
  const many = (reason: string, n: number) =>
    ({ barcode_reject_samples: Array.from({ length: n }, (_, i) => ({ raw: `${reason}-${i}`, reason })) });
  const r = fold([many('checksum', 20), many('length_5', 2), many('all_zero', 1), many('checksum', 20)]);
  const s = r.barcode_reject_samples as { reason: string }[];
  const byReason = s.reduce<Record<string, number>>((a, x) => (a[x.reason] = (a[x.reason] || 0) + 1, a), {});
  assert.equal(byReason.checksum, SAMPLES_PER_REASON, 'checksum capped');
  assert.equal(byReason.length_5, 2, 'rare reason survives in full');
  assert.equal(byReason.all_zero, 1, 'rarest reason survives');
});

test('a rare reason in the LAST slice still survives a flood in the first', () => {
  // The failure mode of first-N-overall: whichever slice lands first wins.
  const flood = { barcode_reject_samples: Array.from({ length: 40 }, (_, i) => ({ raw: `c${i}`, reason: 'checksum' })) };
  const rare = { barcode_reject_samples: [{ raw: 'z', reason: 'all_zero' }] };
  const s = fold([flood, flood, flood, rare]).barcode_reject_samples as { reason: string }[];
  assert.ok(s.some((x) => x.reason === 'all_zero'), 'the rare reason from the last slice must survive');
});

test('unlabelled arrays are bounded rather than growing without limit', () => {
  const s = fold(Array.from({ length: 4 }, () => ({ notes: Array.from({ length: 50 }, (_, i) => `n${i}`) })));
  assert.ok((s.notes as unknown[]).length <= 40);
});

test('a mixed realistic four-slice payload merges every kind correctly', () => {
  const slice = (n: number) => ({
    sibling_coalesce: true,
    rows_with_ean: n,
    barcode_rejected: n * 2,
    barcode_reject_reasons: { checksum: n },
    barcode_reject_samples: [{ raw: `x${n}`, reason: 'checksum' }],
    would_create_new_product: 0,
  });
  const r = fold([slice(1), slice(2), slice(3), slice(4)]);
  assert.equal(r.sibling_coalesce, true);
  assert.equal(r.rows_with_ean, 10);
  assert.equal(r.barcode_rejected, 20);
  assert.deepEqual(r.barcode_reject_reasons, { checksum: 10 });
  assert.equal((r.barcode_reject_samples as unknown[]).length, SAMPLES_PER_REASON);
  assert.equal(r.would_create_new_product, 0);
});

test('an empty prev merges cleanly (first slice)', () => {
  assert.deepEqual(mergeSliceCounts({}, { a: 1, b: true }), { a: 1, b: true });
});
