/**
 * Regression test for the homepage demo solver's delivery handling.
 *
 * WHY THIS EXISTS. Until 18 August 2026 this generator carried its OWN copy of
 * `deliveryFor` with no unknown branch. For a retailer with `delivery_model = 'unknown'`
 * and NULL terms it computed `Number(null)` → 0, `goods >= 0` → true, and returned
 * FREE DELIVERY — the exact defaulting `lib/delivery.ts` exists to forbid.
 *
 * It was unreachable only because `loadData()` filters `.eq('active', true)` and the two
 * unknown retailers happen to be inactive. THE PROTECTION WAS AN UNRELATED FILTER, NOT A
 * DECISION, and the Prime toggle would have required activating one of them.
 *
 * The fix imports the shared rule instead of copying it, so what this test guards is not
 * "the copy still agrees" — there is no copy. It guards the BEHAVIOUR the shared rule
 * gives us: an unknown leg must remove a candidate from the ranking rather than price it
 * at zero. That behaviour lives in this file's solve(), not in lib/delivery.ts, so it
 * needs its own test.
 *
 * Work-list item 197.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { solve } from './generate-homepage-demo.mjs'

const KNOWN = { id: 1, name: 'Known', delivery_model: 'tiered', delivery_cost: '3.95', delivery_threshold: '25' }
const UNKNOWN = { id: 9, name: 'Unknown Terms', delivery_model: 'unknown', delivery_cost: null, delivery_threshold: null }

const offers = [
  { product_id: 100, retailer_id: 1, price: '10.00' },
  { product_id: 101, retailer_id: 1, price: '10.00' },
  // The unknown retailer is CHEAPER on both, so any bug that prices it will pick it.
  { product_id: 100, retailer_id: 9, price: '4.00' },
  { product_id: 101, retailer_id: 9, price: '4.00' },
]

test('an unknown-terms retailer never appears in a solved demo basket', () => {
  const result = solve([100, 101], offers, [KNOWN, UNKNOWN])
  assert.ok(result, 'the known retailer alone should still produce a solution')
  const names = JSON.stringify(result)
  assert.ok(
    !names.includes('Unknown Terms'),
    'a retailer whose delivery terms are unknown must not be ranked, however cheap its goods',
  )
})

test('an unknown-terms retailer does not get priced at zero delivery', () => {
  const result = solve([100, 101], offers, [KNOWN, UNKNOWN])
  // Goods at the known retailer are £20, under its £25 threshold, so delivery is £3.95.
  // The old copy would have offered £8.00 goods + £0 delivery from the unknown retailer
  // and won on both figures.
  const flat = JSON.stringify(result)
  assert.ok(!flat.includes('8'), `unknown retailer's £8 basket must not appear: ${flat}`)
})

test('when every retailer has unknown terms there is no solution rather than a free one', () => {
  const onlyUnknown = solve([100, 101], offers.filter(o => o.retailer_id === 9), [UNKNOWN])
  assert.equal(onlyUnknown, null, 'no priceable candidate must yield null, which triggers the fallback copy')
})

test('a fully known pair still solves, so the guard has not disabled the generator', () => {
  const second = { id: 2, name: 'Second', delivery_model: 'flat', delivery_cost: '2.00', delivery_threshold: null }
  const result = solve([100, 101], [
    ...offers.filter(o => o.retailer_id === 1),
    { product_id: 100, retailer_id: 2, price: '6.00' },
    { product_id: 101, retailer_id: 2, price: '6.00' },
  ], [KNOWN, second])
  assert.ok(result, 'known retailers must still produce a solution')
})
