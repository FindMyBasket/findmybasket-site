import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandSlug } from '../brand-slug.ts';

// NEGATIVE TESTS FOR THE ALIAS FALLBACK'S THREE CONSTRAINTS.
//
// Item 268: every probe defect this week was caught because the answer looked wrong, and the
// defence is implausibility, which only fires on large errors. A GUARD NEVER SEEN TO REFUSE
// IS A GUARD NOBODY HAS TESTED -- so each constraint gets a case it must refuse, not only a
// case it must accept. Item 271.
//
// These test the RESOLUTION RULE in isolation, against a fixture standing in for
// brand_aliases + the live-brand set, so they assert the logic rather than the database.

type Alias = { alias: string; canonical: string };

const HOP_CAP = 4;

// The rule under test, mirroring resolveBrandAliasSlug's ordering and refusals.
function resolve(slug: string, aliases: Alias[], liveSlugs: Set<string>): string | null {
  if (liveSlugs.has(slug)) return null;              // CONSTRAINT 1: live first, never redirect away
  const seen = new Set([slug]);
  let current = slug;
  for (let hop = 0; hop < HOP_CAP; hop++) {
    const next = aliases.find(a => brandSlug(a.alias) === current
      && brandSlug(a.canonical) !== current);
    if (!next) return null;
    const target = brandSlug(next.canonical);
    if (seen.has(target)) return null;               // cycle
    seen.add(target);
    current = target;
    if (liveSlugs.has(current)) return current;      // CONSTRAINT 3: only a resolving target
  }
  return null;                                        // CONSTRAINT 2: exhausted -> 404, not last hop
}

test('POSITIVE: a renamed brand resolves to its live canonical', () => {
  const r = resolve('rimmel-london', [{ alias: 'rimmel london', canonical: 'Rimmel' }], new Set(['rimmel']));
  assert.equal(r, 'rimmel');
});

test('CONSTRAINT 1 REFUSES: an alias slug that is ALSO a live brand is never redirected', () => {
  // Measured 24 Aug: /brands/nineless and /brands/vt-cosmetics both serve 200 AND are
  // aliases. Aliases-first would have 301'd them away from working pages. Two rows of 196.
  const aliases = [
    { alias: 'Nineless', canonical: 'Nine Less' },
    { alias: 'VT Cosmetics', canonical: 'VT' },
  ];
  const live = new Set(['nineless', 'nine-less', 'vt-cosmetics', 'vt']);
  assert.equal(resolve('nineless', aliases, live), null);
  assert.equal(resolve('vt-cosmetics', aliases, live), null);
});

test('CONSTRAINT 2 REFUSES: a chain that exhausts the cap serves 404, not the last hop', () => {
  // The failure mode this exists for: a 301 to a halfway point is indistinguishable from a
  // correct one in the response, and wrong. Partial resolution must not look like success.
  const aliases = [
    { alias: 'a', canonical: 'b' }, { alias: 'b', canonical: 'c' },
    { alias: 'c', canonical: 'd' }, { alias: 'd', canonical: 'e' },
    { alias: 'e', canonical: 'f' },
  ];
  assert.equal(resolve('a', aliases, new Set(['f'])), null, 'must refuse, not return "e"');
});

test('CONSTRAINT 2 REFUSES: a cycle returns null rather than looping or half-resolving', () => {
  const aliases = [{ alias: 'x', canonical: 'y' }, { alias: 'y', canonical: 'x' }];
  assert.equal(resolve('x', aliases, new Set(['z'])), null);
});

test('CONSTRAINT 3 REFUSES: a target with no live products is not redirected into', () => {
  // Eight aliases point at canonicals that 404 -- superdrug, johnsons, pastel-cosmetics,
  // makeup-academy. A 301 INTO A 404 IS WORSE THAN THE 404 IT REPLACES.
  const aliases = [{ alias: 'mua makeup academy', canonical: 'Makeup Academy' }];
  assert.equal(resolve('mua-makeup-academy', aliases, new Set()), null);
});

test('POSITIVE: a chain WITHIN the cap resolves to the terminal live canonical', () => {
  const aliases = [{ alias: 'mac', canonical: 'M.A.C' }, { alias: 'M.A.C', canonical: 'MAC Cosmetics' }];
  assert.equal(resolve('mac', aliases, new Set(['mac-cosmetics'])), 'mac-cosmetics');
});
