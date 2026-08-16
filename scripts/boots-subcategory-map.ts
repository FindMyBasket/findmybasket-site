// GROUP A subcategory map for Boots (retailer 23), read off `product_type`.
//
// THE CANONICAL COPY LIVES HERE, IN THE REPO, and the value in
// retailer_import_config.subcategory_prefix_map is GENERATED FROM IT. A map is a
// decision, and a decision typed into a workflow text box or an UPDATE statement is
// reviewable exactly once, by whoever typed it. This file is reviewable in a diff.
//
// LONGEST PREFIX WINS. An unmapped child inherits its nearest mapped parent, which is
// what lets 88 distinct values be covered by 34 entries — and it is also why `general`
// absorbs 75% of the rows (item 142): the two bare parents sit above a lot of children
// that have no supplement subcategory to land on.
//
// A NULL SUBCATEGORY MEANS DELIBERATELY OUT OF SCOPE. The importer counts and reports
// those rows and does nothing else to them. Excluding them is part 3, a separate
// decision. Item 142.
//
// GROUP B (SPORTS) IS NOT IN HERE, AND THAT IS THE POINT. Active Nutrition and its two
// children hold 80 of 353 sports-token rows (23%); 142 sit under Medicines & Treatments
// and 98 under Lifestyle & Wellbeing. The argument that a sports NAME rule was safe
// because it ran inside a bounded node is WITHDRAWN — the bound is the whole 1,771-row
// leaf. So Active Nutrition maps to `general` here like every other child of Lifestyle &
// Wellbeing, and sports is decided on its own terms. Item 140.
//
// `Baby & Child > Pregnancy & Maternity` (2 rows) IS DELIBERATELY ABSENT — not mapped and
// not marked out of scope. Prenatal vitamins are supplements, baby kit is not, and the
// node name does not say which. Leaving it out means it surfaces as a standing 2 in the
// importer's `subcategory_map_unmatched` counter instead of being silently filed. Item 143.

export type SubcategoryMapEntry = { prefix: string; subcategory: string | null };

const H = "Health & Pharmacy > ";

export const BOOTS_SUBCATEGORY_MAP: SubcategoryMapEntry[] = [
  // ---- specific subcategories (306 rows) ----
  { prefix: H + "Vitamins & Supplements > Multivitamins", subcategory: "multivitamins" },
  { prefix: H + "Vitamins & Supplements > Shop Vitamins & Suppl", subcategory: "multivitamins" },
  { prefix: H + "Vitamins & Supplements > Beauty Supplements", subcategory: "beauty" },
  { prefix: H + "Vitamins & Supplements > Joint Health", subcategory: "joint-and-bone" },
  { prefix: H + "Vitamins & Supplements > Vitamins For Bones", subcategory: "joint-and-bone" },
  { prefix: H + "Vitamins & Supplements > Immune System Support", subcategory: "immunity" },
  { prefix: H + "Vitamins & Supplements > Vitamins For The Brai", subcategory: "brain-and-eyes" },
  { prefix: H + "Vitamins & Supplements > Vitamins For Eyes", subcategory: "brain-and-eyes" },
  { prefix: H + "Vitamins & Supplements > Energy Supplements", subcategory: "energy" },
  { prefix: H + "Women's Health", subcategory: "womens-health" },
  { prefix: "Women's > Health & Pharmacy", subcategory: "womens-health" },
  { prefix: H + "Men's Health", subcategory: "mens-health" },
  { prefix: "Men's > Health & Pharmacy", subcategory: "mens-health" },
  { prefix: H + "Baby & Child Health", subcategory: "childrens" },
  { prefix: H + "Lifestyle & Wellbeing > Diet & Weight Manageme", subcategory: "weight-management" },
  { prefix: H + "Medicines & Treatments > Sleep", subcategory: "sleep-and-calm" },
  { prefix: "Wellness > Everyday Stress", subcategory: "sleep-and-calm" },

  // ---- the bare parents and their inherited tails (1,330 rows) ----
  // THESE FOUR ARE THE 57% CEILING MADE EXPLICIT. Boots did not file below two levels,
  // so neither can we. Mapping them to `general` is honest; leaving them unmapped would
  // report as "unmatched" and read as a defect in the map rather than a thinness in the
  // catalogue.
  { prefix: H + "Vitamins & Supplements", subcategory: "general" },
  { prefix: H + "Medicines & Treatments", subcategory: "general" },
  { prefix: H + "Lifestyle & Wellbeing", subcategory: "general" },
  { prefix: H, subcategory: "general" },
  { prefix: "Wellness", subcategory: "general" },

  // ---- deliberately out of scope, NULL (133 rows) ----
  // Counted and reported. NOT excluded. Part 3 decides whether these should be.
  { prefix: "Beauty & Skincare", subcategory: null },
  { prefix: "Toiletries", subcategory: null },
  { prefix: "Men's > Toiletries", subcategory: null },
  { prefix: "Women's > Toiletries", subcategory: null },
  { prefix: "Baby & Child > Feeding", subcategory: null },
  { prefix: "Baby & Child > Nappies", subcategory: null },
  { prefix: "Electrical", subcategory: null },
  { prefix: "Sun & Holiday", subcategory: null },
  { prefix: "Gift", subcategory: null },
];

// Same algorithm as import-awin-feed's matchSubcategoryPrefix(), deliberately duplicated
// here rather than imported: that one is Deno/edge code and this runs under tsx. THE
// DUPLICATION IS THE RISK — if they diverge, the backfill and the importer file the same
// row differently and nothing says so. The preview section prints a self-check that runs
// both intents over every distinct feed value; keep it.
export function matchSubcategory(
  value: string,
  map: SubcategoryMapEntry[] = BOOTS_SUBCATEGORY_MAP,
): { matched: boolean; subcategory: string | null; prefix?: string } {
  if (map.length === 0 || !value) return { matched: false, subcategory: null };
  const haystack = value.toLowerCase();
  let best: SubcategoryMapEntry | undefined;
  for (const e of map) {
    if (!haystack.startsWith(e.prefix.toLowerCase())) continue;
    if (!best || e.prefix.length > best.prefix.length) best = e;
  }
  if (!best) return { matched: false, subcategory: null };
  return { matched: true, subcategory: best.subcategory ?? null, prefix: best.prefix };
}
