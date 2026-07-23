// FindMyBasket — recategorise-products edge function
//
// One-off + ongoing structural backfill: re-applies the CURRENT categoriser
// (inferCategorisation from ../_shared/categorisation.ts — the single source of
// truth, never re-implemented in SQL) to the whole products table and brings
// each row's top_category / product_type / subcategory / tags back in sync.
//
// A meaningful chunk of the catalogue carries stale categorisation from before
// _shared/categorisation.ts was extracted and tightened (e.g. NARS bronzers /
// luminizing sticks tagged top_category=skincare). This re-applies the fix in
// one pass and can be re-run any time the categoriser changes.
//
// POST body (all optional):
//   dry_run            boolean  default true   report changes without writing
//   batch_size         number   default 1000   products processed per chunk
//   brand_filter       string                  only this brand (normalised)
//   retailer_id_filter number                  only products sold by this retailer
//   delete_excluded    boolean  default false  hard-delete products the categoriser
//                                               now classifies as excluded
//   revalidate         boolean  default true   ISR-revalidate changed brand slugs
//
// Deploy with verify_jwt=true (admin function); invoke with the service-role key
// as the bearer token. Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { inferCategorisation } from "../_shared/categorisation.ts";
import { requireServiceRole } from "../_shared/require-service-role.ts";

// Brand -> URL slug. MUST mirror brandSlug() in lib/queries.ts, brandSlugify()
// in import-awin-feed and fmb_brand_slug() in SQL.
function brandSlugify(brand: string): string {
  return String(brand || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Set-equality on tags (order-insensitive), null-safe.
function sameTags(a: string[] | null | undefined, b: string[]): boolean {
  const x = [...(a ?? [])].sort();
  const y = [...(b ?? [])].sort();
  if (x.length !== y.length) return false;
  return x.every((v, i) => v === y[i]);
}

const DELETE_CAP = 500; // refuse to mass-delete more than this in one invocation
const SELECT_COLS = "id,name,brand,top_category,product_type,subcategory,tags";

interface ProductRow {
  id: number;
  name: string | null;
  brand: string | null;
  top_category: string | null;
  product_type: string | null;
  subcategory: string | null;
  tags: string[] | null;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Caller gate — after the preflight early-return so browser OPTIONS is never
  // gated. verify_jwt alone does not exclude the public anon key; see
  // _shared/require-service-role.ts. This function mutates categorisation
  // across the catalogue, so it is service-role only.
  const denied = requireServiceRole(req, corsHeaders);
  if (denied) return denied;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default true
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 1000, 1), 5000);
    const brandFilter = body.brand_filter ? String(body.brand_filter).trim().toLowerCase() : null;
    const retailerFilter = body.retailer_id_filter != null && body.retailer_id_filter !== ""
      ? Number(body.retailer_id_filter)
      : null;
    const deleteExcluded = body.delete_excluded === true; // default false
    const revalidate = body.revalidate !== false; // default true
    // The categoriser's skincare path is a CATCHALL (it returns skincare/Skincare
    // when it can't recognise the product from the name). Many rows carry a more
    // specific categorisation that did NOT come from the name — e.g. nail products
    // ("Gel Nail Strip") tagged makeup via a retailer's top_category_default, whose
    // names inferCategorisation can't classify. Blindly re-applying would demote
    // ~1.3k such rows to the catchall. So by default we refuse to let the bare
    // catchall overwrite a more specific stored tag. Set clobber_with_catchall:true
    // for the brief's raw "re-apply to everything" behaviour.
    const clobberWithCatchall = body.clobber_with_catchall === true; // default false

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Counters / accumulators ───────────────────────────────────────────
    let scanned = 0;
    let staleFound = 0;
    let applied = 0;
    let excludedFound = 0;
    let excludedDeleted = 0;
    let protectedFromCatchall = 0;
    let refinementCount = 0; // stale rows where ONLY subcategory/tags changed
    const topChanges: Record<string, number> = {};
    const typeChanges: Record<string, number> = {};
    const excludedByReason: Record<string, number> = {};
    const staleByBrand: Record<string, number> = {};
    const refinementSubChanges: Record<string, number> = {};
    const sampleRefinements: unknown[] = [];
    // Bucket MEANINGFUL recategorisations (top_category or product_type changed)
    // by full transition (old top/type → new top/type), so the cross-type moves
    // worth eyeballing aren't swamped by same-type subcategory/tags refinements.
    const transitionCounts: Record<string, number> = {};
    const transitionSamples: Record<string, unknown[]> = {};
    const TRANSITION_SAMPLE_CAP = 15;
    const sampleExcluded: unknown[] = [];
    const errors: string[] = [];
    const affectedBrands = new Set<string>();
    const toDelete: number[] = [];

    const oldOf = (p: ProductRow) => ({
      top_category: p.top_category,
      product_type: p.product_type,
      subcategory: p.subcategory,
      tags: p.tags ?? [],
    });

    // Process one page of products: detect staleness, accumulate samples /
    // counters, and (real mode) apply the batch transactionally via RPC.
    const processRows = async (rows: ProductRow[]) => {
      const updates: Array<Record<string, unknown>> = [];
      for (const p of rows) {
        scanned++;
        if (!p.name || !String(p.name).trim()) continue; // data hygiene; should not happen

        const cat = inferCategorisation(p.name, p.brand ?? "");
        // Abort the whole run on a missing verdict — that signals a categoriser
        // logic regression, not a stale row.
        if (!cat || typeof cat !== "object") {
          throw new Error(`inferCategorisation returned ${String(cat)} for product ${p.id} ("${p.name}")`);
        }

        if (cat.excluded) {
          excludedFound++;
          excludedByReason[cat.excluded] = (excludedByReason[cat.excluded] ?? 0) + 1;
          if (sampleExcluded.length < 50) {
            sampleExcluded.push({ id: p.id, name: p.name, brand: p.brand, excluded: cat.excluded, old: oldOf(p) });
          }
          if (deleteExcluded) {
            toDelete.push(p.id);
            const s = brandSlugify(p.brand ?? "");
            if (s) affectedBrands.add(s);
          }
          continue; // excluded products are never re-tagged
        }

        const freshTop = cat.top_category ?? null;
        const freshType = cat.product_type ?? "";
        const freshSub = cat.subcategory ?? "";
        const freshTags = cat.tags ?? [];

        const stale =
          (p.top_category ?? null) !== freshTop ||
          (p.product_type ?? "") !== freshType ||
          (p.subcategory ?? "") !== freshSub ||
          !sameTags(p.tags, freshTags);
        if (!stale) continue;

        // Guardrail: don't let the skincare catchall clobber a more specific tag.
        const freshIsCatchall = freshTop === "skincare" && (freshType === "" || freshType === "Skincare");
        const storedIsCatchall = (p.top_category ?? null) === "skincare" &&
          ((p.product_type ?? "") === "" || (p.product_type ?? "") === "Skincare");
        if (freshIsCatchall && !storedIsCatchall && !clobberWithCatchall) {
          protectedFromCatchall++;
          continue;
        }

        staleFound++;
        const topChanged = (p.top_category ?? null) !== freshTop;
        const typeChanged = (p.product_type ?? "") !== freshType;
        if (topChanged) {
          const k = `${p.top_category ?? "null"}→${freshTop ?? "null"}`;
          topChanges[k] = (topChanges[k] ?? 0) + 1;
        }
        if (typeChanged) {
          const k = `${p.product_type || "—"}→${freshType || "—"}`;
          typeChanges[k] = (typeChanges[k] ?? 0) + 1;
        }
        const rec = {
          id: p.id, name: p.name, brand: p.brand,
          old: oldOf(p),
          new: { top_category: freshTop, product_type: freshType, subcategory: freshSub, tags: freshTags },
        };
        if (topChanged || typeChanged) {
          // Meaningful recategorisation — bucket by transition + track brand.
          const brandKey = (p.brand ?? "").trim() || "(none)";
          staleByBrand[brandKey] = (staleByBrand[brandKey] ?? 0) + 1;
          const transition = `${p.top_category ?? "null"}/${p.product_type || "—"} → ${freshTop ?? "null"}/${freshType || "—"}`;
          transitionCounts[transition] = (transitionCounts[transition] ?? 0) + 1;
          if (!transitionSamples[transition]) transitionSamples[transition] = [];
          if (transitionSamples[transition].length < TRANSITION_SAMPLE_CAP) transitionSamples[transition].push(rec);
        } else {
          // Same top_category + product_type — only subcategory/tags changed.
          refinementCount++;
          const subK = `${p.subcategory || "—"}→${freshSub || "—"}`;
          refinementSubChanges[subK] = (refinementSubChanges[subK] ?? 0) + 1;
          if (sampleRefinements.length < 15) sampleRefinements.push(rec);
        }
        const s = brandSlugify(p.brand ?? "");
        if (s) affectedBrands.add(s);

        updates.push({ id: p.id, top_category: freshTop, product_type: freshType, subcategory: freshSub, tags: freshTags });
      }

      if (!dryRun && updates.length) {
        const { data, error } = await supabase.rpc("fmb_recategorise_apply", { updates });
        if (error) errors.push(`apply batch: ${error.message}`);
        else applied += Number(data) || 0;
      }
    };

    // ── Iterate the catalogue ─────────────────────────────────────────────
    if (retailerFilter != null && !Number.isNaN(retailerFilter)) {
      // Restrict to products this retailer sells: gather distinct product_ids
      // from retailer_prices, then fetch products in id chunks.
      const ids: number[] = [];
      let from = 0;
      const PAGE = 1000;
      // deno-lint-ignore no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("retailer_prices").select("product_id")
          .eq("retailer_id", retailerFilter).order("product_id").range(from, from + PAGE - 1);
        if (error) { errors.push(`retailer_prices page at ${from}: ${error.message}`); break; }
        if (!data || data.length === 0) break;
        for (const r of data as { product_id: number | null }[]) if (r.product_id != null) ids.push(r.product_id);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      const uniq = [...new Set(ids)];
      for (let i = 0; i < uniq.length; i += batchSize) {
        const chunk = uniq.slice(i, i + batchSize);
        let q = supabase.from("products").select(SELECT_COLS).in("id", chunk);
        if (brandFilter) q = q.eq("normalised_brand", brandFilter);
        const { data, error } = await q;
        if (error) { errors.push(`products chunk at ${i}: ${error.message}`); continue; }
        await processRows((data ?? []) as ProductRow[]);
      }
    } else {
      let from = 0;
      // deno-lint-ignore no-constant-condition
      while (true) {
        let q = supabase.from("products").select(SELECT_COLS).order("id").range(from, from + batchSize - 1);
        if (brandFilter) q = q.eq("normalised_brand", brandFilter);
        const { data, error } = await q;
        if (error) { errors.push(`products page at ${from}: ${error.message}`); break; }
        if (!data || data.length === 0) break;
        await processRows(data as ProductRow[]);
        if (data.length < batchSize) break;
        from += batchSize;
      }
    }

    // ── Delete excluded products (real mode + delete_excluded only) ────────
    if (deleteExcluded && !dryRun && toDelete.length) {
      if (toDelete.length > DELETE_CAP) {
        errors.push(
          `Refusing to delete ${toDelete.length} products in one invocation (cap ${DELETE_CAP}). ` +
          `Narrow with brand_filter / retailer_id_filter and re-run. No products were deleted.`,
        );
      } else {
        for (let i = 0; i < toDelete.length; i += 100) {
          const chunk = toDelete.slice(i, i + 100);
          const { data, error } = await supabase.rpc("fmb_delete_products_cascade", { ids: chunk });
          if (error) errors.push(`delete chunk at ${i}: ${error.message}`);
          else excludedDeleted += Number(data) || 0;
        }
      }
    }

    // ── Revalidate affected brand pages (real mode only) ───────────────────
    if (revalidate && !dryRun) {
      const slugs = [...affectedBrands].filter(Boolean);
      for (let i = 0; i < slugs.length; i += 1000) {
        const chunk = slugs.slice(i, i + 1000);
        const { error } = await supabase.rpc("fmb_revalidate_brand_slugs", { slugs: chunk });
        if (error) errors.push(`revalidate: ${error.message}`);
      }
    }

    const sortDesc = (o: Record<string, number>) =>
      Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
    const sampleStaleByTransition = Object.entries(transitionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([transition, count]) => ({ transition, count, examples: transitionSamples[transition] ?? [] }));
    const staleByBrandTop = Object.entries(staleByBrand)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([brand, count]) => ({ brand, count }));

    return new Response(JSON.stringify({
      dry_run: dryRun,
      products_scanned: scanned,
      stale_found: staleFound,
      applied,
      protected_from_catchall: protectedFromCatchall,
      excluded_found: excludedFound,
      excluded_deleted: excludedDeleted,
      type_changes_count: staleFound - refinementCount,
      refinements_count: refinementCount,
      top_category_changes: sortDesc(topChanges),
      product_type_changes: sortDesc(typeChanges),
      excluded_by_reason: sortDesc(excludedByReason),
      stale_by_brand: staleByBrandTop,
      sample_stale_by_transition: sampleStaleByTransition,
      refinements: {
        count: refinementCount,
        subcategory_changes: sortDesc(refinementSubChanges),
        sample: sampleRefinements,
      },
      sample_excluded: sampleExcluded,
      errors,
      duration_ms: Date.now() - started,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e), duration_ms: Date.now() - started }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
