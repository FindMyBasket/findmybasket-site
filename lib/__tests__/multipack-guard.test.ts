import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isMultipackMismatch,
  deeplinkSignalsMultipack,
  nameDescribesSingleItem,
  deeplinkSlug,
} from '../../supabase/functions/_shared/multipack-guard.ts';

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../supabase/functions/_shared/__fixtures__/multipack-guard-fixture.json', import.meta.url),
    'utf8',
  ),
) as {
  must_skip: { pid: number; name: string; slug: string }[];
  must_keep: { pid: number; name: string; slug: string }[];
};

const GS = 'https://www.gorgeousshop.com';
const awin = (path: string) =>
  `https://www.awin1.com/cread.php?awinmid=53379&awinaffid=2841268&ued=${encodeURIComponent(GS + path)}`;

// ── The real-data fixture ────────────────────────────────────────────────────
// 310 live rows whose deeplink advertises a multipack. 84 were confirmed against
// the merchant's own page titles as multipacks of a SINGLE sku (bad); 226 are
// genuine multi-item bundles that matched bundle products (good).

test('catches every confirmed multipack-on-single row', () => {
  const missed = FIXTURE.must_skip.filter((r) => !isMultipackMismatch(awin(r.slug), r.name));
  assert.deepEqual(
    missed.map((r) => `${r.pid} ${r.name}`),
    [],
    `${missed.length}/${FIXTURE.must_skip.length} known-bad rows were not caught`,
  );
});

test('never suppresses a genuine multi-item bundle', () => {
  const wrong = FIXTURE.must_keep.filter((r) => isMultipackMismatch(awin(r.slug), r.name));
  assert.deepEqual(
    wrong.map((r) => `${r.pid} ${r.name}`),
    [],
    `${wrong.length}/${FIXTURE.must_keep.length} legitimate bundle rows would be dropped`,
  );
});

// ── Generality: the rule must be relational, not a memorised id list ─────────
// Each case below is synthetic, so passing them cannot come from the fixture.

test('same product name flips on the deeplink alone', () => {
  const name = 'Medik8 C Tetra Serum 30ml';
  assert.equal(isMultipackMismatch(awin('/medik8-double-c-tetra-serum-30ml'), name), true);
  assert.equal(isMultipackMismatch(awin('/medik8-c-tetra-serum-30ml'), name), false);
});

test('same deeplink flips on the product name alone', () => {
  const slug = '/brand-duo-shampoo-300ml-conditioner-250ml';
  assert.equal(isMultipackMismatch(awin(slug), 'Brand Shampoo 300ml'), true);
  assert.equal(isMultipackMismatch(awin(slug), 'Brand Shampoo 300ml & Conditioner 250ml'), false);
});

test('a name that already says Duo is not a silent mismatch', () => {
  // The match key saw the multiplier, so whatever it matched is a bundle too.
  assert.equal(isMultipackMismatch(awin('/x-duo-cream-50ml'), 'X Cream 50ml Duo'), false);
});

test('two distinct sizes reads as two items', () => {
  assert.equal(nameDescribesSingleItem('Kit Bain 250ml Fondant 200ml'), false);
  assert.equal(nameDescribesSingleItem('Bain 250ml'), true);
  assert.equal(nameDescribesSingleItem('Serum 30ml 30ml'), true); // same size twice, still one item
});

test('numeric pack forms are recognised', () => {
  for (const s of ['/x-2-pack-serum-30ml', '/x-3pack-serum-30ml', '/x-x2-serum-30ml', '/x-2pk-serum-30ml']) {
    assert.equal(deeplinkSignalsMultipack(awin(s)), true, s);
  }
});

test('multiplier words inside other words do not trigger', () => {
  // "trio" in Trilogy, "two" in Twofold — must be slug-separator anchored.
  assert.equal(deeplinkSignalsMultipack(awin('/trilogy-rosehip-oil-45ml')), false);
  assert.equal(deeplinkSignalsMultipack(awin('/twofold-hand-cream-50ml')), false);
  assert.equal(deeplinkSignalsMultipack(awin('/doubleday-serum-30ml')), false);
});

test('unwraps the AWIN ued parameter', () => {
  assert.equal(deeplinkSlug(awin('/some-duo-thing')), '/some-duo-thing');
  assert.equal(deeplinkSlug('https://www.gorgeousshop.com/some-duo-thing'), '/some-duo-thing');
});

test('only the merchant path is inspected, not the wrapper', () => {
  // awinmid/affid digits must not be read as pack counts.
  assert.equal(isMultipackMismatch(awin('/plain-serum-30ml'), 'Plain Serum 30ml'), false);
});

test('empty and malformed input is safe', () => {
  assert.equal(isMultipackMismatch('', 'X Serum 30ml'), false);
  assert.equal(isMultipackMismatch(awin('/x-duo-serum'), ''), false);
  assert.equal(isMultipackMismatch('not a url at all', 'X Serum 30ml'), false);
});
