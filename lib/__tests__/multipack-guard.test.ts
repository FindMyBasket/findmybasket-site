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
// Rebuilt from CURRENT feed data after the first live run. must_skip holds the
// rows that escaped the first guard (each re-verified against the merchant's own
// page title); must_keep holds every live row whose deeplink signals a multipack
// and which matched a genuine bundle product.

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

test('a large count is a count, not a multiplier', () => {
  // Regression: "Elemis Dynamic Resurfacing Facial Pads 60pk" is 60 pads, part
  // of the product identity. An unbounded \\d+pk read it as a multipack and
  // would have suppressed a legitimate live row.
  assert.equal(deeplinkSignalsMultipack(awin('/elemis-dynamic-resurfacing-facial-pads-60pk')), false);
  assert.equal(deeplinkSignalsMultipack(awin('/brand-pads-30pk')), false);
  assert.equal(deeplinkSignalsMultipack(awin('/brand-sheets-x24')), false);
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

// ── Regressions from the first live run ──────────────────────────────────────

test('19233: feed name says bundle, matched product is single -> SKIP', () => {
  // The Tier-4 stripped matcher strips past the multiplier, so this feed row
  // landed on the single. Passing the FEED name let it through; passing the
  // MATCHED product name catches it. This is the root-cause regression.
  const slug = '/dermalogica-duo-biolumin-c-serum-30ml-biolumin-c-gel-moisturiser';
  const feedName = 'Dermalogica DUO Biolumin C Serum 30ml, Biolumin C Gel Moisturiser';
  const matchedName = 'Dermalogica Biolumin-C Serum 30ml';
  assert.equal(isMultipackMismatch(awin(slug), feedName), false, 'feed name is not the determinant');
  assert.equal(isMultipackMismatch(awin(slug), matchedName), true, 'matched product name is');
});

test('bare "pack" counts as a multiplier', () => {
  assert.equal(deeplinkSignalsMultipack(awin('/l-oreal-professionnel-pack-metal-detox-filler')), true);
  assert.equal(deeplinkSignalsMultipack(awin('/kerastase-pack-nutritive-bain-satin-riche')), true);
});

test('but not when "pack" is the product type', () => {
  for (const s of ['/cosrx-sleeping-pack-60ml', '/brand-wash-off-pack-100ml', '/brand-modeling-pack-50g', '/brand-clay-pack-80ml']) {
    assert.equal(deeplinkSignalsMultipack(awin(s)), false, s);
  }
});

test('Group C shape: no multiplier in the slug means no opinion', () => {
  // 96038 / 105080 from the first run: flagged by the old capture, but their
  // deeplinks carry no multiplier at all, so the guard must leave them alone.
  assert.equal(isMultipackMismatch(awin('/matrix-total-results-keep-me-vivid-conditioner-1000ml'), 'Matrix Keep Me Vivid Conditioner 1000ml'), false);
  assert.equal(isMultipackMismatch(awin('/joico-defy-damage-protective-conditioner-1000ml'), 'JOICO Defy Damage Protective Conditioner 1000ml'), false);
});

// ── ext_id / EAN / MPN match path (regression: 51523) ────────────────────────
// A row matched on external_product_id never touches the `products` lookup set,
// so before migration 20260720200000 its matched name was unknown and the guard
// fell back to the feed name — reopening the proxy bug. These cases pin the
// behaviour the importer must produce for that path.

test('51523: ext_id-matched duo on a single product is caught', () => {
  const slug = '/scottish-fine-soaps-duo-au-lait-hand-wash-refill-750ml-refillable-aluminium-bottle';
  const matchedName = 'Scottish Fine Soaps Au Lait Hand Wash Refill 750ml';
  assert.equal(isMultipackMismatch(awin(slug), matchedName), true);
});

test('51523: the feed name would NOT have caught it', () => {
  // The feed row names both items, so the feed name reads as a bundle. This is
  // why the fallback had to be removed rather than kept as a best effort.
  const slug = '/scottish-fine-soaps-duo-au-lait-hand-wash-refill-750ml-refillable-aluminium-bottle';
  const feedName = 'Scottish Fine Soaps Au Lait Hand Wash Refill 750ml & Refillable Aluminium Bottle 500ml Duo';
  assert.equal(isMultipackMismatch(awin(slug), feedName), false);
});

test('ext_id path keeps a genuine bundle-to-bundle match', () => {
  const slug = '/brand-duo-shampoo-300ml-conditioner-250ml';
  assert.equal(isMultipackMismatch(awin(slug), 'Brand Shampoo 300ml & Conditioner 250ml Duo'), false);
});
