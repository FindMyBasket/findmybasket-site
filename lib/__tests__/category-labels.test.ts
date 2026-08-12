/**
 * ONE CATEGORY LIST, AND A GUARD THAT KEEPS IT ONE.
 *
 * Before this test there were seven copies of the category set: CATEGORY_DISPLAY
 * and CATEGORY_SLUGS in lib/queries, duplicate label maps in app/brands/[slug],
 * app/product/[id] and components/BrandPage, a CATEGORIES array in the sitemap
 * route, and catRoutes in the AWIN importer. Adding `supplements` meant seven
 * edits, and missing any one of them fails SILENTLY — a category renders
 * correctly everywhere except the one surface that was missed.
 *
 * That is not hypothetical. The importer's own comment records fragrance and
 * bath_body having been absent from catRoutes, so imports touching those
 * categories "never refreshed their category pages". The same bug, already paid
 * for once, in the copy this test cannot remove.
 *
 * Six copies are now one. The seventh — the importer's — CANNOT be removed: it is
 * a Deno edge function and cannot import a Next module at runtime, the same
 * boundary that forces lib/delivery.ts to mirror the canonical Deno copy. So it is
 * guarded here instead, the same way lib/__tests__/delivery.test.ts guards that
 * mirror: a divergence fails a test rather than being discovered months later in a
 * stale category page.
 *
 * WHY THIS READS SOURCE RATHER THAN IMPORTING lib/queries. That module imports
 * lib/supabase, which THROWS at module load when SUPABASE_URL is unset — so a test
 * that imports it can only run with live credentials. This test is about
 * source-level duplication, so reading the source is both hermetic and the more
 * honest instrument: it checks the thing it is actually asserting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Node runs these as ES modules (no "type" in package.json but module syntax is
// detected), so __dirname does not exist. Derive it.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUERIES = readFileSync(join(ROOT, 'lib', 'queries.ts'), 'utf8');

/** Keys of an exported `const NAME: Record<...> = { a: '...', b: '...' }`. */
function mapKeys(src: string, name: string): string[] {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  assert.ok(m, `${name} not found in lib/queries.ts — has it been renamed?`);
  return [...m[1].matchAll(/^\s*(\w+):/gm)].map(x => x[1]);
}

/** Values of an exported `const NAME: T[] = ['a', 'b']`. */
function arrayValues(src: string, name: string): string[] {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
  assert.ok(m, `${name} not found in lib/queries.ts — has it been renamed?`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

const ALL_CATEGORIES = arrayValues(QUERIES, 'export const ALL_CATEGORIES');

test('the category list is not empty and includes the newest category', () => {
  assert.ok(ALL_CATEGORIES.length >= 6, 'ALL_CATEGORIES looks truncated');
  assert.ok(ALL_CATEGORIES.includes('supplements'));
});

test('every category has a display label and a route slug, with no orphans either way', () => {
  const display = mapKeys(QUERIES, 'export const CATEGORY_DISPLAY');
  const slugs = mapKeys(QUERIES, 'export const CATEGORY_SLUGS');
  assert.deepEqual(display.slice().sort(), ALL_CATEGORIES.slice().sort());
  assert.deepEqual(slugs.slice().sort(), ALL_CATEGORIES.slice().sort());
});

test('the TopCategory union matches the category list exactly', () => {
  // The type and the value drifting apart is how a category becomes reachable at
  // runtime but unassignable in a component prop.
  const m = QUERIES.match(/export type TopCategory =([^;]+);/);
  assert.ok(m, 'TopCategory not found');
  const union = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.deepEqual(union.slice().sort(), ALL_CATEGORIES.slice().sort());
});

test('no file outside lib/queries.ts declares its own category label map', () => {
  // Detects the literal that every one of the six duplicates shared: an object
  // whose keys include a known category value. Greps rather than parses,
  // deliberately — a new duplicate written in any style still has to spell the
  // category names.
  let hits: string[];
  try {
    hits = execFileSync(
      'grep',
      ['-rlE', "(skincare|bath_body):[[:space:]]*'", 'app', 'components', 'lib'],
      { cwd: ROOT, encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
  } catch {
    hits = []; // grep exits 1 when nothing matches
  }
  const offenders = hits.filter(f => f !== 'lib/queries.ts');
  assert.deepEqual(
    offenders,
    [],
    `these files declare their own category map — import from lib/queries instead:\n  ${offenders.join('\n  ')}`,
  );
});

test('the importer revalidate map covers every category', () => {
  // THE ONE COPY THAT CANNOT BE CONSOLIDATED. A Deno edge function cannot import
  // this module, so it is checked instead. A category missing here imports fine
  // and never refreshes its landing page — invisible until someone notices the
  // page is stale, which is exactly how fragrance and bath_body went unnoticed.
  const src = readFileSync(
    join(ROOT, 'supabase', 'functions', 'import-awin-feed', 'index.ts'),
    'utf8',
  );
  const block = src.match(/const catRoutes: Record<string, string> = \{([\s\S]*?)\};/);
  assert.ok(block, 'catRoutes not found in import-awin-feed — has it been renamed?');

  for (const cat of ALL_CATEGORIES) {
    assert.match(
      block[1],
      new RegExp(`\\b${cat}:\\s*"`),
      `catRoutes has no entry for '${cat}' — its category page will never be revalidated after an import`,
    );
  }
});
