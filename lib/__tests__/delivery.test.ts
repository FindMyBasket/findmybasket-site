/**
 * Delivery rule tests.
 *
 * TWO JOBS, and the second is the one that matters most.
 *
 * 1. Test the rule itself, including the `unknown` branch, which is UNREACHABLE IN
 *    PRODUCTION BY CONSTRUCTION: zero active retailers are `unknown`, so nothing in
 *    the live data exercises it. A synthetic retailer here is the only thing that
 *    tests the branch rather than the plumbing around it.
 *
 * 2. ASSERT THE TWO IMPLEMENTATIONS AGREE. lib/delivery.ts mirrors
 *    supabase/functions/_shared/delivery.ts because the Next runtime cannot import a
 *    Deno module. Before 3 August 2026 the same rule was written out by hand in three
 *    places with `??` in one and `||` in another, and they disagreed by £3.95 on a
 *    zero-cost retailer in production. Nothing caught it. This does.
 *
 * Import path precedent: lib/__tests__/multipack-guard.test.ts already imports across
 * the runtime boundary in a test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { deliveryFor as appDeliveryFor } from '../delivery.ts';
import { deliveryFor as edgeDeliveryFor } from '../../supabase/functions/_shared/delivery.ts';

type Case = {
  name: string;
  retailer: { delivery_model?: string | null; delivery_threshold?: number | string | null; delivery_cost?: number | string | null };
  legTotal: number;
  expect: { known: true; cost: number } | { known: false };
};

/** Real terms as recorded 2026-08-01, plus the cases live data cannot produce. */
const CASES: Case[] = [
  // --- tiered, the common path -------------------------------------------------
  { name: 'tiered below threshold charges', retailer: { delivery_model: 'tiered', delivery_threshold: 39, delivery_cost: 3.79 }, legTotal: 26.85, expect: { known: true, cost: 3.79 } },
  { name: 'tiered at threshold is free', retailer: { delivery_model: 'tiered', delivery_threshold: 39, delivery_cost: 3.79 }, legTotal: 39, expect: { known: true, cost: 0 } },
  { name: 'tiered above threshold is free', retailer: { delivery_model: 'tiered', delivery_threshold: 30, delivery_cost: 2.95 }, legTotal: 48, expect: { known: true, cost: 0 } },

  // --- flat: THE BUG THIS WORK FIXED -------------------------------------------
  // Debenhams. Modelled as tiered at £25 before 3 Aug 2026, so a £48 basket showed
  // free delivery and understated the true total by £3.99.
  { name: 'flat charges below any threshold', retailer: { delivery_model: 'flat', delivery_threshold: null, delivery_cost: 3.99 }, legTotal: 10, expect: { known: true, cost: 3.99 } },
  { name: 'flat charges ABOVE £25', retailer: { delivery_model: 'flat', delivery_threshold: null, delivery_cost: 3.99 }, legTotal: 48, expect: { known: true, cost: 3.99 } },
  { name: 'flat charges on a very large basket', retailer: { delivery_model: 'flat', delivery_threshold: null, delivery_cost: 3.99 }, legTotal: 500, expect: { known: true, cost: 3.99 } },

  // --- zero cost: THE ?? vs || DIVERGENCE ---------------------------------------
  // Branded Beauty is tiered/£30/£0. `delivery_cost || 3.95` turned this into £3.95
  // in the email path while the app charged £0. Same basket, two prices.
  { name: 'zero cost stays zero below threshold', retailer: { delivery_model: 'tiered', delivery_threshold: 30, delivery_cost: 0 }, legTotal: 12, expect: { known: true, cost: 0 } },
  { name: 'zero cost as a string stays zero', retailer: { delivery_model: 'tiered', delivery_threshold: '30', delivery_cost: '0' }, legTotal: 12, expect: { known: true, cost: 0 } },

  // --- empty leg ----------------------------------------------------------------
  { name: 'empty leg is free, not unknown', retailer: { delivery_model: 'unknown', delivery_threshold: null, delivery_cost: null }, legTotal: 0, expect: { known: true, cost: 0 } },
  { name: 'negative leg treated as empty', retailer: { delivery_model: 'flat', delivery_threshold: null, delivery_cost: 3.99 }, legTotal: -5, expect: { known: true, cost: 0 } },

  // --- unknown: UNREACHABLE IN PRODUCTION, tested only here ---------------------
  { name: 'unknown model is not defaulted', retailer: { delivery_model: 'unknown', delivery_threshold: null, delivery_cost: null }, legTotal: 40, expect: { known: false } },
  { name: 'unknown with a cost recorded is still unknown', retailer: { delivery_model: 'unknown', delivery_threshold: null, delivery_cost: 3.5 }, legTotal: 40, expect: { known: false } },
  { name: 'null model is not defaulted', retailer: { delivery_model: null, delivery_threshold: 25, delivery_cost: 3.95 }, legTotal: 40, expect: { known: false } },
  { name: 'a model this code predates is not defaulted', retailer: { delivery_model: 'banded', delivery_threshold: 25, delivery_cost: 3.95 }, legTotal: 40, expect: { known: false } },

  // --- malformed: handled as unknown, never defaulted ---------------------------
  { name: 'tiered with no threshold is unknown, not free', retailer: { delivery_model: 'tiered', delivery_threshold: null, delivery_cost: 3.95 }, legTotal: 40, expect: { known: false } },
  { name: 'tiered with no cost is unknown', retailer: { delivery_model: 'tiered', delivery_threshold: 25, delivery_cost: null }, legTotal: 10, expect: { known: false } },
  { name: 'flat with no cost is unknown', retailer: { delivery_model: 'flat', delivery_threshold: null, delivery_cost: null }, legTotal: 40, expect: { known: false } },

  // --- PostgREST sends numerics as strings --------------------------------------
  { name: 'string numerics parse', retailer: { delivery_model: 'tiered', delivery_threshold: '50.00', delivery_cost: '3.95' }, legTotal: 49.99, expect: { known: true, cost: 3.95 } },
  { name: 'model casing and whitespace tolerated', retailer: { delivery_model: ' Flat ', delivery_threshold: null, delivery_cost: 3.99 }, legTotal: 40, expect: { known: true, cost: 3.99 } },
];

for (const c of CASES) {
  test(`rule: ${c.name}`, () => {
    const got = appDeliveryFor(c.retailer, c.legTotal);
    assert.equal(got.known, c.expect.known, `known mismatch: ${JSON.stringify(got)}`);
    if (c.expect.known && got.known) assert.equal(got.cost, c.expect.cost);
  });
}

test('the two implementations agree on every case', () => {
  for (const c of CASES) {
    const a = appDeliveryFor(c.retailer, c.legTotal);
    const e = edgeDeliveryFor(c.retailer, c.legTotal);
    assert.deepEqual(
      a, e,
      `lib/delivery.ts and supabase/functions/_shared/delivery.ts DISAGREE on "${c.name}".\n` +
      `  app:  ${JSON.stringify(a)}\n  edge: ${JSON.stringify(e)}\n` +
      `These two files must be changed together. See the header of either.`,
    );
  }
});

test('no fallback constants survive in any pricing path', () => {
  // The original defect was a literal 25 and a literal 3.95 standing in for missing
  // data. A grep is a blunt instrument, but this specific pair reappearing is exactly
  // the regression worth failing a build over.
  // Every file that prices a basket, not just the rule itself. The last fabricated
  // constant did not live in the rule: it was `uniqueRetailerCount * 3.95` building
  // the savings baseline in the email, which survived the first sweep because it was
  // a multiplication rather than a fallback. Widening the net to the whole pricing
  // path is convention 12 applied here: search for the shape, not the phrase.
  const PRICING_PATHS = [
    'lib/delivery.ts',
    'supabase/functions/_shared/delivery.ts',
    'app/app/RoutineBuilder.tsx',
    'supabase/functions/send-routine-email/index.ts',
    'lib/product-queries.ts',
  ];
  for (const p of PRICING_PATHS) {
    const src = readFileSync(p, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // strip comments
    assert.ok(!/\?\?\s*['"]?(25|3\.95|3\.99)\b/.test(code), `${p} reintroduced a ?? fallback delivery constant`);
    assert.ok(!/\|\|\s*['"]?(25|3\.95|3\.99)\b/.test(code), `${p} reintroduced a || fallback delivery constant`);
    // The savings-baseline shape: a bare delivery-looking literal in arithmetic.
    assert.ok(!/[*+]\s*3\.95\b|\b3\.95\s*[*+]/.test(code), `${p} reintroduced a hardcoded 3.95 in arithmetic`);
  }
});
