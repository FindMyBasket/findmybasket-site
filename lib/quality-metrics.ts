import { supabase } from './supabase';

// Reads for the data-quality panel. SERVER ONLY — `supabase` here is the service-role
// client, and metrics_quality_weekly / platform_changes carry NO anon or authenticated
// grants at all, so there is no PostgREST path to either from a browser. The page is
// protected by middleware; the DATA is protected by the absence of a grant, which is the
// stronger of the two and does not depend on the middleware being right.

export interface QualityRow {
  week_start: string;
  comparison_depth_pct: number | null;
  comparison_depth_num: number | null;
  comparison_depth_den: number | null;
  suspect_price_count: number | null;
  suspect_price_den: number | null;
  suspect_price_threshold: number | null;
  ean_coverage_pct: number | null;
  ean_coverage_num: number | null;
  ean_coverage_den: number | null;
  ambiguous_ean_groups: number | null;
  ambiguous_ean_den: number | null;
  sole_supplier_share_pct: number | null;
  sole_supplier_num: number | null;
  sole_supplier_den: number | null;
  no_in_stock_offer_count: number | null;
  no_in_stock_offer_den: number | null;
  stale_in_stock_rows: number | null;
  stale_in_stock_den: number | null;
  pack_mismatch_suspects: number | null;
  pack_mismatch_testable: number | null;
  pack_mismatch_den: number | null;
  cross_product_price_outliers: number | null;
  cross_product_identical_pairs: number | null;
  cross_product_candidate_den: number | null;
  updated_at: string;
}

export interface BoundaryRow {
  id: number;
  changed_at: string | null;
  status: string;
  title: string;
  metrics_affected: string[] | null;
}

export async function getQualityRows(limit = 26): Promise<QualityRow[]> {
  const { data, error } = await supabase
    .from('metrics_quality_weekly')
    .select('*')
    .order('week_start', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`metrics_quality_weekly read failed: ${error.message}`);
  return (data ?? []) as QualityRow[];
}

export async function getBoundaries(): Promise<BoundaryRow[]> {
  const { data, error } = await supabase
    .from('platform_changes')
    .select('id, changed_at, status, title, metrics_affected')
    .order('changed_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`platform_changes read failed: ${error.message}`);
  return (data ?? []) as BoundaryRow[];
}

/**
 * Boundaries naming a given metric. A boundary is matched BY NAME against
 * platform_changes.metrics_affected, which means a renamed or dropped metric silently
 * matches nothing — see work-list item 116. The panel therefore also renders, per metric,
 * whether any boundary names it at all, so "no marker" is distinguishable from "no change".
 */
export function boundariesFor(all: BoundaryRow[], metric: string): BoundaryRow[] {
  return all.filter((b) => (b.metrics_affected ?? []).includes(metric));
}
