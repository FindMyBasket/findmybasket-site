/**
 * Merge one slice's `counts` object into the accumulated total.
 *
 * EXTRACTED 5 Aug 2026 so it can be tested. It previously lived inline in
 * import-awin-feed and added every value numerically, which is right for counters and
 * wrong for everything else:
 *
 *   barcode_reject_reasons  an OBJECT   -> "0[object Object][object Object]..."
 *   barcode_reject_samples  an ARRAY    -> destroyed the same way
 *   sibling_coalesce        a BOOLEAN   -> summed to 4 across four slices
 *
 * Beauty Flash rejected 1,326 barcodes on 5 Aug 2026, 12.7% of those recovered, and
 * the reasons were unreadable. The diagnostic that exists to make a feed's barcode
 * quality legible did not survive the path every large feed takes.
 *
 * IT WAS TESTED, AND THE TEST PASSED FOR THE WRONG REASON. Stage 1 was The Organic
 * Pharmacy: sliced_import=true like everything else, but ONE slice at 114 rows, so
 * this code never ran, and zero rejections meant the field was empty either way. A
 * green result on a case that cannot reach the code is worse than no test, because it
 * closes the question. README conventions 17 and 18.
 *
 * ORDER-INDEPENDENT BY CONSTRUCTION. Slices commit in whatever order they finish, so
 * any rule that depends on which arrived first is wrong. Counters sum, reason tallies
 * sum per key, and samples are capped PER REASON rather than overall — first-N-overall
 * would bias to whichever slice landed first.
 */

/** Samples kept per distinct `reason`. Small on purpose: ten examples of `checksum`
 *  are worth less than two each of checksum, length_5 and all_zero. */
export const SAMPLES_PER_REASON = 3;

/** Hard cap so an unlabelled array cannot grow without bound across slices. */
export const SAMPLES_HARD_CAP = 40;

export function mergeSliceCounts(
  prev: Record<string, unknown>,
  slice: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...prev };

  for (const k of Object.keys(slice)) {
    const incoming = slice[k];
    const existing = merged[k];

    if (typeof incoming === "number") {
      merged[k] = (typeof existing === "number" ? existing : 0) + incoming;

    } else if (typeof incoming === "boolean") {
      // A flag describes the RUN, not a quantity. Last slice wins; they agree.
      merged[k] = incoming;

    } else if (Array.isArray(incoming)) {
      const all = [...(Array.isArray(existing) ? existing : []), ...incoming];
      const perReason: Record<string, number> = {};
      const kept: unknown[] = [];
      for (const item of all) {
        const reason = (item && typeof item === "object" && "reason" in (item as Record<string, unknown>))
          ? String((item as Record<string, unknown>).reason) : "__unlabelled__";
        perReason[reason] = (perReason[reason] || 0) + 1;
        if (perReason[reason] <= SAMPLES_PER_REASON) kept.push(item);
      }
      merged[k] = kept.slice(0, SAMPLES_HARD_CAP);

    } else if (incoming && typeof incoming === "object") {
      const base: Record<string, number> = (existing && typeof existing === "object" && !Array.isArray(existing))
        ? { ...(existing as Record<string, number>) } : {};
      for (const [rk, rv] of Object.entries(incoming as Record<string, unknown>)) {
        if (typeof rv === "number") base[rk] = (base[rk] || 0) + rv;
      }
      merged[k] = base;

    } else {
      merged[k] = incoming;
    }
  }
  return merged;
}
