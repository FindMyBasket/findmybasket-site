/**
 * Delivery cost for one retailer leg. NEXT-RUNTIME MIRROR.
 *
 * THE CANONICAL COPY IS supabase/functions/_shared/delivery.ts. Read that file for
 * why this rule exists and why it has no fallback constants. This mirror exists only
 * because the Next runtime cannot import a Deno module at runtime; the edge function
 * imports the canonical one directly.
 *
 * DUPLICATION HERE IS DELIBERATE AND GUARDED. Duplicating the rule is the defect this
 * work removed, so re-introducing a copy needs a reason and a guard. The reason is the
 * runtime boundary. The guard is lib/__tests__/delivery.test.ts, which imports BOTH
 * files and asserts they agree on every case in a shared table, so a divergence fails
 * a test rather than being discovered months later in a pricing discrepancy. That is
 * precisely how the previous divergence went unnoticed.
 *
 * IF YOU EDIT THIS FILE, EDIT THE CANONICAL ONE TOO. The test will tell you if you
 * did not.
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
