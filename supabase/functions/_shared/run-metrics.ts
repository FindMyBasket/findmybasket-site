// Run metrics + absence handling, shared by all three importers.
//
// WHY THIS EXISTS
//
// 1. The scrape_log insert has been silently failing since early May. Every
//    importer wrote `products_seen` / `products_updated` / `products_inserted` /
//    `duration_ms`, none of which are columns — the table has source_count /
//    matched_count / new_count / price_updates / out_of_stock_count / details.
//    Every insert threw into a `catch { /* ignore */ }`, so we lost the run
//    metrics entirely and had no baseline to judge a run against.
//
// 2. Absence handling needs that baseline. A run that completes but writes far
//    fewer rows than usual is presumed partial, and must NOT be allowed to mark
//    a live catalogue out of stock.
//
// Both concerns live here so the four finalisation sites stay identical.

export interface RunCounts {
  [k: string]: number | unknown;
}

/**
 * Filter-driven exclusions only — the ones that move when someone edits a
 * category/brand/path config. Deliberately EXCLUDES data-driven drops
 * (no price, out of stock, no match id): those vary with the feed's own
 * content every day and would drown the filter-change signal in noise.
 */
export function filterExcludedTotal(counts: RunCounts | undefined | null): number {
  const c = (counts ?? {}) as Record<string, number>;
  const n = (k: string) => (typeof c[k] === "number" ? c[k] : 0);
  return n("excluded_path_not_in_scope") + n("excluded_by_category") +
         n("skipped_new_brand") + n("v6_excluded");
}

export interface FinaliseOpts {
  retailerId: number;
  runStartedAt: string;      // ISO; the run's START, not its end — see below
  startTimeMs: number;
  hadError: boolean;
  feedRows: number;          // -> source_count
  matched: number;           // -> matched_count and price_updates
  inserted: number;          // -> new_count
  counts?: RunCounts;
  errorMessage?: string | null;
  /** Set false only for a canary; production runs should apply. */
  applyAbsence?: boolean;
}

/**
 * Write the run's metrics, then run absence handling for this retailer.
 *
 * Order matters: the RPC reads the row we just inserted as "this run" and the
 * five before it as the baseline, so the insert must land first.
 *
 * Never throws. A metrics or absence failure must not fail an import that has
 * already applied its data — but unlike the old code it logs loudly rather than
 * swallowing, which is how the column bug survived for two months.
 */
export async function finaliseRun(supa: any, o: FinaliseOpts): Promise<any> {
  const durationMs = Date.now() - o.startTimeMs;
  const excludedTotal = filterExcludedTotal(o.counts);

  try {
    const { error } = await supa.from("scrape_log").insert({
      retailer_id: o.retailerId,
      status: o.hadError ? "partial_failure" : "success",
      started_at: o.runStartedAt,
      completed_at: new Date().toISOString(),
      source_count: o.feedRows || 0,
      matched_count: o.matched,
      new_count: o.inserted,
      price_updates: o.matched,
      out_of_stock_count: (o.counts as any)?.excluded_out_of_stock ?? null,
      error_message: o.errorMessage ?? null,
      details: { duration_ms: durationMs, excluded_total: excludedTotal, counts: o.counts ?? null },
    });
    if (error) console.error(`scrape_log insert failed (retailer ${o.retailerId}): ${error.message}`);
  } catch (e) {
    console.error(`scrape_log insert threw (retailer ${o.retailerId}): ${String(e)}`);
  }

  // Absence handling. The RPC re-checks every guard itself (complete run,
  // row-count baseline, filter-change) and returns {skipped, reason} rather
  // than acting when one fails, so calling it unconditionally here is safe.
  // A partial run never reaches this code path anyway: it dies before
  // finalisation and leaves last_import_status='running'.
  try {
    const { data, error } = await supa.rpc("fmb_apply_absence_handling", {
      p_retailer_id: o.retailerId,
      p_run_started_at: o.runStartedAt,
      p_dry_run: o.applyAbsence === false,
    });
    if (error) {
      console.error(`absence handling failed (retailer ${o.retailerId}): ${error.message}`);
      return { error: error.message };
    }
    if (data?.skipped) console.log(`absence handling skipped (retailer ${o.retailerId}): ${data.reason}`);
    else console.log(`absence handling (retailer ${o.retailerId}): flipped ${data?.flipped} of ${data?.candidates} candidates, threshold ${data?.threshold_days}d`);
    return data;
  } catch (e) {
    console.error(`absence handling threw (retailer ${o.retailerId}): ${String(e)}`);
    return { error: String(e) };
  }
}
