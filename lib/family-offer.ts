// Shade-collapse option C: pure price-collapse logic for shade families.
// Kept free of the supabase import so it stays unit-testable under node --test
// (lib/supabase.ts throws without env vars at import time).

// One retailer_prices row per (product, retailer) exists (UNIQUE constraint), so
// a shade family yields up to one row per shade per retailer. This is the shape
// pickFamilyOffer collapses.
export interface FamilyPriceRow {
  price: number;
  url: string;
  in_stock: boolean;
  last_updated: string | null;
}

// Collapse a retailer's family rows (one per shade) to the single price the
// page shows, computed at read time so it can never drift from what the
// importers write. Rules, per the price-mechanic decision:
//   - modal price — the price the most shades sell at IS the product's price;
//     a lone divergent shade (clearance outlier) must not become the headline
//   - stock first — shoppers can only pay in-stock prices, so when any row is
//     in stock the mode is computed over in-stock rows only
//   - tie -> HIGHER (house never-cheapest rule; also covers "no clear mode",
//     where every price occurs once — a lone clearance outlier must not win).
//     Offline contamination sweeps (Stage 4) catch genuinely mixed groups.
//   - representative row = freshest row at the chosen price, so the click-out
//     URL is the most recently confirmed one
export function pickFamilyOffer(rows: FamilyPriceRow[]): FamilyPriceRow | null {
  if (rows.length === 0) return null;
  const inStock = rows.filter(r => r.in_stock);
  const pool = inStock.length > 0 ? inStock : rows;

  const counts = new Map<number, number>();
  for (const r of pool) counts.set(r.price, (counts.get(r.price) ?? 0) + 1);
  let chosenPrice: number | null = null;
  let bestCount = 0;
  for (const [price, count] of counts) {
    if (count > bestCount || (count === bestCount && (chosenPrice === null || price > chosenPrice))) {
      chosenPrice = price;
      bestCount = count;
    }
  }

  const atPrice = pool.filter(r => r.price === chosenPrice);
  atPrice.sort((a, b) => (b.last_updated ?? '').localeCompare(a.last_updated ?? ''));
  return atPrice[0];
}
