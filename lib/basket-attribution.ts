// Per-retailer attribution for an optimised basket.
//
// A "Shop {retailer}" button in the optimiser sends the user to one retailer to buy
// only the items assigned to that retailer. The value attributable to that click is
// therefore that retailer's SUBTOTAL within the basket — never the whole-basket
// total. GA4 sums the reserved `value` param, so sending the basket total on each
// retailer button would multiply revenue across a split basket. This split is easy
// to regress silently, so the aggregation lives here as a pure, tested function.

export interface AttributableBreakdownItem {
  price: number | null;
  retailerName: string;
  retailerId?: number;
  url: string;
}

export interface RetailerSubtotal {
  retailerId?: number;
  url: string;
  subtotal: number;
}

// Group a basket breakdown by retailer, summing each retailer's item prices and
// keeping that retailer's first deep-link. Items without a url are skipped (they
// have nowhere to click through to). Null prices contribute nothing to a subtotal.
export function retailerSubtotals(
  breakdown: AttributableBreakdownItem[]
): Record<string, RetailerSubtotal> {
  const agg: Record<string, RetailerSubtotal> = {};
  for (const b of breakdown) {
    if (!b.url) continue;
    const cur =
      agg[b.retailerName] ?? { retailerId: b.retailerId, url: b.url, subtotal: 0 };
    if (b.price != null) cur.subtotal += b.price;
    agg[b.retailerName] = cur;
  }
  return agg;
}
