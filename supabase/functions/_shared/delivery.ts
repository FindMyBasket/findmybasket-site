/**
 * Delivery cost for one retailer leg. CANONICAL IMPLEMENTATION.
 *
 * WHY THIS EXISTS
 * ----------------------------------------------------------------------------
 * Until 3 August 2026 this rule was written out by hand in three places and they
 * did not agree:
 *
 *   app/app/RoutineBuilder.tsx        four sites, `?? '25'` / `?? '3.95'`
 *   supabase/functions/send-routine-email/index.ts   three sites, `|| 25` / `|| 3.95`
 *   lib/product-queries.ts            a truthiness guard that skipped delivery entirely
 *
 * The `??` versus `||` difference was not cosmetic. `delivery_cost || 3.95` turns a
 * genuine £0 delivery cost into £3.95, so the monthly email priced a zero-cost
 * retailer £3.95 higher than the app did for the same basket. TWO PRICING PATHS
 * THAT DISAGREED, in production, masked only because the one retailer with a £0 cost
 * happened to be out of stock. That is the argument for a single rule, and it is a
 * stronger argument than "duplication is untidy".
 *
 * NO FALLBACK CONSTANTS. There are deliberately no `?? 25` or `|| 3.95` defaults
 * anywhere in this file. A missing term is reported as UNKNOWN and handled by the
 * caller. Inventing a threshold produced the original defect: every retailer was
 * modelled as tiered at £25, so Debenhams, which is `flat` and never free, was shown
 * as free delivery on any basket over £25 and understated by £3.99.
 *
 * THE UNKNOWN CONTRACT
 * Callers get a discriminated union, not a number, so `unknown` cannot be silently
 * coerced to zero. A retailer with unrecorded terms must still have its GOODS shown:
 * a product that exists should not vanish from comparison because a delivery term is
 * unrecorded. What it must NOT do is be presented as best value against a retailer
 * whose delivered total IS known, because those two numbers are not comparable.
 *
 * MIRRORED IN lib/delivery.ts for the Next runtime, which cannot import a Deno
 * module at runtime. The two are kept honest by lib/__tests__/delivery.test.ts,
 * which imports BOTH and asserts they agree on every case in a shared table.
 * If you change this file, change that one, and the test will tell you if you didn't.
 */

export type DeliveryModel = 'tiered' | 'flat' | 'unknown';

export interface RetailerDeliveryTerms {
  delivery_model?: string | null;
  delivery_threshold?: number | string | null;
  delivery_cost?: number | string | null;
}

export type DeliveryOutcome =
  | { known: true; cost: number }
  | { known: false; reason: string };

/** Postgres numerics arrive as strings over PostgREST. null stays null. */
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param legTotal Goods subtotal for THIS retailer's leg, delivery excluded.
 *                 A leg with nothing in it costs nothing to deliver.
 */
export function deliveryFor(
  retailer: RetailerDeliveryTerms,
  legTotal: number,
): DeliveryOutcome {
  // An empty leg is free regardless of terms. This is not a default, it is the
  // absence of an order.
  if (!(legTotal > 0)) return { known: true, cost: 0 };

  const model = (retailer.delivery_model ?? '').toString().trim().toLowerCase();
  const cost = num(retailer.delivery_cost);
  const threshold = num(retailer.delivery_threshold);

  if (model === 'flat') {
    // Threshold is meaningless for a flat retailer and is NULL in the data.
    // Charged on every basket at every size. Never free.
    if (cost === null) return { known: false, reason: 'flat retailer has no delivery_cost' };
    return { known: true, cost };
  }

  if (model === 'tiered') {
    if (cost === null) return { known: false, reason: 'tiered retailer has no delivery_cost' };
    // A tiered retailer with no threshold is malformed rather than free. The CHECK
    // constraint added 2026-08-01 should make this unreachable; it is handled as
    // unknown rather than defaulted, because defaulting is what caused the bug this
    // module exists to fix.
    if (threshold === null) return { known: false, reason: 'tiered retailer has no delivery_threshold' };
    return { known: true, cost: legTotal >= threshold ? 0 : cost };
  }

  // 'unknown', empty, or any value a future migration adds that this code predates.
  // Deliberately NOT defaulted. See the unknown contract above.
  return { known: false, reason: model ? `unrecognised delivery_model '${model}'` : 'delivery_model not set' };
}

/**
 * Convenience for callers that have already decided how to treat an unknown leg.
 * Use only where the unknown case is handled separately and provably cannot reach
 * here; passing a fallback is exactly the habit this module removes.
 */
export function deliveryCostOrNull(
  retailer: RetailerDeliveryTerms,
  legTotal: number,
): number | null {
  const outcome = deliveryFor(retailer, legTotal);
  return outcome.known ? outcome.cost : null;
}
