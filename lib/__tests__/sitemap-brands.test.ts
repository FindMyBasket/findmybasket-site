/**
 * The guard that stops /sitemap-pages.xml emitting no brand pages.
 *
 * These assert BEHAVIOUR, not shape. A test that checked "the route contains no
 * pagination loop" would pass forever while the thing that matters — what happens
 * when the brand list comes back empty — went untested. What matters is that every
 * way the list can be unusable ends in a thrown error, because the alternative is a
 * valid-looking sitemap that silently withdraws 2,400 /brands/* URLs from the index.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireBrandNames, EmptyBrandListError } from '../sitemap-brands.ts';

test('a normal brand list passes straight through', () => {
  assert.deepEqual(requireBrandNames(['cerave', 'the ordinary', 'vida glow']), [
    'cerave',
    'the ordinary',
    'vida glow',
  ]);
});

test('THE CASE THIS EXISTS FOR: an empty array throws rather than returning []', () => {
  // The old loop swallowed exactly this. `if (error || !data) break` left the Set
  // empty and the route emitted a valid sitemap with every brand page missing.
  assert.throws(() => requireBrandNames([]), EmptyBrandListError);
  assert.throws(() => requireBrandNames([]), /array was empty/);
});

test('an RPC error throws and carries the reason into the build log', () => {
  assert.throws(() => requireBrandNames(null, { message: 'function does not exist' }), EmptyBrandListError);
  assert.throws(() => requireBrandNames(null, { message: 'function does not exist' }), /function does not exist/);
});

test('null and undefined throw — a missing function returns null, not an error', () => {
  assert.throws(() => requireBrandNames(null), /returned null/);
  assert.throws(() => requireBrandNames(undefined), /returned null/);
});

test('a non-array throws, naming what arrived', () => {
  // Guards a future change of the RPC's return type from jsonb array to object.
  assert.throws(() => requireBrandNames({ brands: ['cerave'] }), /expected an array, got object/);
  assert.throws(() => requireBrandNames('cerave'), /expected an array, got string/);
});

test('unusable entries are dropped, and an all-unusable array throws', () => {
  // Non-strings would slugify to nonsense URLs rather than failing loudly.
  assert.deepEqual(requireBrandNames(['cerave', null, 42, '', '  ', 'nuxe']), ['cerave', 'nuxe']);
  assert.throws(() => requireBrandNames([null, 42, '']), /none a usable string/);
});

test('the error explains what to check, because it surfaces in a build log', () => {
  try {
    requireBrandNames([]);
    assert.fail('should have thrown');
  } catch (e) {
    const msg = (e as Error).message;
    assert.match(msg, /fmb_active_brand_names/);
    assert.match(msg, /products_active/);
    assert.match(msg, /silently/);
  }
});
