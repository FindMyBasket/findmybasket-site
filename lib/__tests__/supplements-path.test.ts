/**
 * THE GOLDEN FILE FOR PATH-FIRST SUPPLEMENTS CLASSIFICATION. Two directions, and
 * both are load-bearing.
 *
 * DIRECTION A — INERT. The two-argument form must return exactly what it returned
 * on main before this branch existed, across 3,601 rows. This is what makes "the
 * deploy is inert by construction" a MEASUREMENT rather than a claim, and the
 * deploy/activation split in item 72 depends entirely on it: ship the code, confirm
 * a clean import cycle, and only then write a path prefix into a retailer's config.
 * Four callers pass two arguments — the AWIN, Shopify and Rakuten importers and the
 * two harness scripts — so a single moved row here is a row moved for every
 * retailer.
 *
 * DIRECTION B — EFFECTIVE. With the path supplied, the Boots rows must actually
 * move and the topicals must not. WITHOUT B, A IS SATISFIED PERFECTLY BY A CHANGE
 * THAT DOES NOTHING AT ALL — and "does nothing" is precisely the claim A exists to
 * substantiate, so on its own A proves the opposite of what it is for.
 *
 * The corpus is committed, so this runs in `npm test` with no credentials: 1,793
 * stratified products_active rows plus all 1,808 Boots Fitness & Nutrition rows.
 * Work-list items 71, 72 and 79.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inferCategorisationForImport,
  isSupplementPathTopical,
  supplementSubcategory,
} from '../../supabase/functions/_shared/categorisation.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = JSON.parse(
  readFileSync(join(ROOT, 'supabase/functions/_shared/__fixtures__/supplements-path-corpus.json'), 'utf8'),
) as {
  rows: {
    brand: string; name: string; src: string;
    expect: {
      top_category: string | null; product_type: string | null;
      subcategory: string | null; excluded: string | null; tags: string[];
    };
  }[];
};

const BOOTS = FIXTURE.rows.filter(r => r.src === 'boots_fitness_nutrition');

test('DIRECTION A: the two-argument form is byte-identical across the whole corpus', () => {
  const moved: string[] = [];
  for (const r of FIXTURE.rows) {
    const got = inferCategorisationForImport(r.name, r.brand);
    const actual = {
      top_category: got.top_category ?? null,
      product_type: got.product_type ?? null,
      subcategory: got.subcategory ?? null,
      excluded: (got as { excluded?: string }).excluded ?? null,
      tags: got.tags ?? [],
    };
    try {
      assert.deepEqual(actual, r.expect);
    } catch {
      moved.push(`${r.name}\n    expected ${JSON.stringify(r.expect)}\n    got      ${JSON.stringify(actual)}`);
    }
  }
  assert.deepEqual(
    moved,
    [],
    `${moved.length} of ${FIXTURE.rows.length} rows changed WITHOUT a supplements path. ` +
      `The deploy is not inert and the deploy/activation split in item 72 does not hold:\n  ` +
      moved.slice(0, 5).join('\n  '),
  );
});

test('DIRECTION B: with the path supplied, the Boots rows move', () => {
  let supplements = 0, sports = 0;
  const fellThrough: string[] = [];
  for (const r of BOOTS) {
    const got = inferCategorisationForImport(r.name, r.brand, undefined, true);
    if (got.top_category === 'supplements') {
      if (got.subcategory === 'sports') sports++;
      else supplements++;
    } else {
      fellThrough.push(r.name);
    }
  }
  // Measured against the feed on 13 August. These are the numbers the item-72
  // proposal was approved on; a change to any of them is a change to the proposal.
  assert.equal(supplements, 1523, 'supplements count moved');
  assert.equal(sports, 259, 'sports count moved');
  assert.equal(fellThrough.length, 26, 'topical count moved');
});

test('DIRECTION B: the named topicals do NOT become supplements', () => {
  // The four the design was argued over, by name. Anua and Numbuzin are the
  // glued-size cases that a plain \b misses; No7 was found by the fix rather than
  // named in advance, which is the evidence it fixes the class (item 79).
  const named = [
    'Anua Niacinamide 5 Txa Brightening Booster Toner250 ml, 250ml',
    'Numbuzin No.5+ Glutathione Vitamin Concentrated Toner200 ml',
    'Olay Vitamin C Brighten & Glow Moisture Fluid Duo',
    'BetterYou Magnesium Muscle Body Spray 100ml',
    'No7 Radiance+ Vitamin C Glow Toner200 ml, 200ml',
  ];
  for (const name of named) {
    const row = BOOTS.find(r => r.name === name);
    assert.ok(row, `fixture no longer contains: ${name}`);
    const got = inferCategorisationForImport(row.name, row.brand, undefined, true);
    assert.notEqual(got.top_category, 'supplements', `${name} became a supplement`);
  }
});

test('THE VETOES ONLY FILTER ROWS THE FORM TEST MATCHED', () => {
  // Item 79. SUPP_DEVICE matches seven Boots rows and two of them — Jude Collagen
  // & Creatine Pelvic Floor Supplements — are GENUINE SUPPLEMENTS. They survive
  // only because the form test never matches them, so the veto is never consulted.
  // If that ordering is ever inverted they are silently excluded, with no error and
  // no 404. This asserts the property rather than trusting the comment.
  const jude = BOOTS.filter(r => /pelvic floor/i.test(r.name) && /supplement/i.test(r.name));
  assert.ok(jude.length >= 2, 'the Jude rows are no longer in the fixture');
  for (const r of jude) {
    assert.equal(isSupplementPathTopical(r.name), false, `${r.name} was vetoed as topical`);
    const got = inferCategorisationForImport(r.name, r.brand, undefined, true);
    assert.equal(got.top_category, 'supplements', `${r.name} did not become a supplement`);
  }
});

test('flavour cream is not topical, but a real cream still is', () => {
  assert.equal(isSupplementPathTopical('Optimum Nutrition 100% Gold Standard Whey Vanilla Ice Cream 780g'), false);
  assert.equal(isSupplementPathTopical('Barebells Protein Bar Cookies & Cream - 55g'), false);
  assert.equal(isSupplementPathTopical('P.Louise Bad B*tch Energy Lip Duo Strawberries And Cream'), false);
  // The conditional half: cream is vetoed only when it is the SOLE form word.
  assert.equal(isSupplementPathTopical('Boots Dermacare Acne Cleanser & Day Cream Bundle'), true);
});

test('oil, gel and pack are dosage forms here, not application words', () => {
  // Item 57. These are the rows the original brief believed capsuleIsTopical was
  // misfiring on; it never was, and they must stay supplements.
  assert.equal(isSupplementPathTopical('Boots Vegan Omega 3 Oil 1000 Mg, 60 Capsules'), false);
  assert.equal(isSupplementPathTopical('Seven Seas Evening Primrose Oil + Starflower 1000Mg 30 Capsules'), false);
});

test('the sports brand list is matched on brand, not on the name', () => {
  // \bprotein\b does not match "Myprotein" — no word boundary inside the brand
  // name — so a name rule silently misses the largest sports brand in the feed.
  assert.equal(supplementSubcategory('MyProtein'), 'sports');
  assert.equal(supplementSubcategory('myprotein'), 'sports');
  assert.equal(supplementSubcategory('  Optimum Nutrition  '), 'sports');
  // Unlisted brands fail SAFE, into supplements.
  assert.equal(supplementSubcategory('Bulk'), 'supplements');
  assert.equal(supplementSubcategory('Seven Seas'), 'supplements');
});

/**
 * DIRECTION C — WIRED. At least one production importer must actually PASS the
 * path argument.
 *
 * WHY A AND B ARE NOT ENOUGH, WHICH IS THE WHOLE POINT OF THIS FILE.
 *
 * A asserts the two-argument form is unchanged. B asserts the function behaves
 * correctly WHEN GIVEN a path. Both passed continuously between #256 and 14 Aug
 * 2026 — a period in which NO CALLER ANYWHERE PASSED THE ARGUMENT, the branch was
 * unreachable, and writing a prefix into a retailer's config would have changed
 * nothing at all.
 *
 * A AND B ARE BOTH SATISFIED BY A CORRECTLY-BUILT FEATURE THAT IS NOT PLUGGED IN.
 * A is satisfied because every caller passes two arguments — which is exactly what
 * "no caller passes four" looks like. B is satisfied because B supplies the
 * argument ITSELF; it tests the function, and a unit test cannot see a call site.
 *
 * So the suite could not distinguish "safe because dormant" from "dead because
 * unplumbed". Both output "nothing changed", and the deploy/activation split was
 * resting on that indistinguishability without knowing it.
 *
 * This test closes it at the only boundary that matters — the call site — and it is
 * a SOURCE assertion rather than a behavioural one, because that is where the
 * failure lived. It fails on the exact state main was in for two days.
 *
 * Work-list item 91, instance 15.
 */
test('DIRECTION C: a production importer passes the path argument', () => {
  const src = readFileSync(
    join(ROOT, 'supabase/functions/import-awin-feed/index.ts'), 'utf8');

  // 1. The config column is read at all.
  assert.ok(
    src.includes('supplements_path_prefixes'),
    'import-awin-feed does not read supplements_path_prefixes: the column can be ' +
    'set on any retailer and the importer will never know. This is the defect ' +
    'this test exists to catch.',
  );

  // 2. inferCategorisationForImport is called with FOUR arguments somewhere.
  //    Counted by top-level commas so a nested call cannot fake it.
  const calls: string[] = [];
  const NEEDLE = 'inferCategorisationForImport(';
  for (let i = src.indexOf(NEEDLE); i !== -1; i = src.indexOf(NEEDLE, i + 1)) {
    let depth = 0;
    for (let j = i + NEEDLE.length - 1; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') {
        depth--;
        if (depth === 0) { calls.push(src.slice(i + NEEDLE.length, j)); break; }
      }
    }
  }
  assert.ok(calls.length > 0, 'no call to inferCategorisationForImport found at all');

  const argCounts = calls.map((a) => {
    let depth = 0, n = 1;
    for (const ch of a) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) n++;
    }
    return a.trim() === '' ? 0 : n;
  });

  assert.ok(
    argCounts.some((n) => n >= 4),
    `every call to inferCategorisationForImport in import-awin-feed passes fewer ` +
    `than four arguments (found arities: ${argCounts.join(', ')}). onSupplementsPath ` +
    `takes its false default on every row, the path-first branch is unreachable, and ` +
    `setting supplements_path_prefixes on a retailer will silently do nothing. ` +
    `DIRECTION A WILL STILL PASS IN THIS STATE — that is why this test exists.`,
  );
});
