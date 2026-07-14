// Diagnostic (read-only): awin-feed-count  [v5]
// Downloads an AWIN classic datafeed by fid, decompresses, and inspects it
// WITHOUT any matching or DB writes. Used to determine whether a feed has
// genuinely shrunk vs the importer dropping rows, and to audit brand matching.
//
// Query params (all optional):
//   ?fid=101611            AWIN feed id (defaults to YesStyle's feed)
//   ?ids=a,b,c             probe merchant_product_ids -> present-in-stock / OOS / absent
//   ?name=multi balm       case-insensitive substring search over product_name
//                          (returns up to 40 matching rows: id, in_stock, name, brand)
//   ?lostbrands=1          top-50 in-stock feed brands NOT in our catalogue
//
// Always reports `spelling_collisions`: in-stock feed brands that FAIL the
// importer's brand match but DO collide with a catalogue brand once punctuation/
// spacing is stripped — i.e. the true casing/spelling losses that existing_brands_only
// silently drops (the class of bug that hid rom&nd/Lord&Berry from YesStyle).
//
// Read-only: no writes; only SELECTs against products + brand_aliases. verify_jwt=true.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Parse one CSV line honouring double-quoted fields and "" escapes. AWIN product
// names contain commas, so a naive split(",") misaligns every downstream column.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function buildFeedUrl(apiKey: string, feedId: string): string {
  const cols = ["merchant_product_id", "in_stock", "product_name", "brand_name"].join("%2C");
  return `https://productdata.awin.com/datafeed/download/apikey/${apiKey}/fid/${feedId}/format/csv/language/en/delimiter/%2C/compression/gzip/adultcontent/1/columns/${cols}/`;
}

// The importer's existing_brands_only test on the feed side today: lower + trim.
function normBrandImporter(s: string): string {
  return String(s || "").toLowerCase().trim();
}

serve(async (req) => {
  const apiKey = Deno.env.get("AWIN_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "AWIN_API_KEY not set" }), { status: 500 });

  const url = new URL(req.url);
  const fid = url.searchParams.get("fid") || "101611";
  const idsParam = url.searchParams.get("ids") || "";
  const nameQ = (url.searchParams.get("name") || "").toLowerCase().trim();
  const wantLostBrands = url.searchParams.get("lostbrands") === "1";
  const probeIds = idsParam ? idsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];

  try {
    const resp = await fetch(buildFeedUrl(apiKey, fid), {
      headers: { "Accept-Encoding": "identity", "User-Agent": "FindMyBasket/1.0 (diagnostic)" },
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `AWIN ${resp.status} ${resp.statusText}`, fid }), { status: 502 });
    }
    const buf = await resp.arrayBuffer();
    const ds = new DecompressionStream("gzip");
    const text = await new Response(new Response(buf).body!.pipeThrough(ds)).text();

    // Catalogue brand sets — mirror the importer.
    //   existingBrandSet : lenient lower+trim of normalised_brand (importer's ACTUAL test today)
    //   aggMap           : punctuation-stripped -> sample catalogue brand (collision detector)
    // brandAliasMap replays lookupCanonicalBrand so an alias-bridged feed brand is
    // scored as matched, exactly as the importer would.
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const existingBrandSet = new Set<string>();
    const aggMap = new Map<string, string>();
    const stripAgg = (s: string) => normBrandImporter(s).replace(/[^a-z0-9]/g, "");
    const brandAliasMap = new Map<string, string>();
    try {
      for (let from = 0; ; from += 1000) {
        const { data } = await supa.from("products").select("normalised_brand").not("normalised_brand", "is", null).range(from, from + 999);
        if (!data || data.length === 0) break;
        for (const r of data as { normalised_brand: string }[]) {
          const b = normBrandImporter(r.normalised_brand);
          if (b) { existingBrandSet.add(b); const a = stripAgg(b); if (a && !aggMap.has(a)) aggMap.set(a, b); }
        }
        if (data.length < 1000) break;
      }
      const { data: aliasRows } = await supa.from("brand_aliases").select("alias, canonical");
      for (const r of (aliasRows || []) as { alias: string; canonical: string }[]) {
        const a = normBrandImporter(r.alias); const c = String(r.canonical ?? "");
        if (a && c) brandAliasMap.set(a, c);
      }
    } catch (_) { /* leave sets partial -> counts are a lower bound */ }

    const lookupCanonical = (raw: string): string => {
      const key = normBrandImporter(raw);
      if (!key) return raw;
      return brandAliasMap.get(key) ?? raw;
    };

    const lines = text.split("\n");
    const header = (lines[0] || "").replace(/\r$/, "");
    const cols = parseCsvLine(header);
    const idxId = cols.indexOf("merchant_product_id");
    const idxStock = cols.indexOf("in_stock");
    const idxName = cols.indexOf("product_name");
    const idxBrand = cols.indexOf("brand_name");

    const isStockVal = (v: string) => {
      const s = (v || "").trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes";
    };

    let productRows = 0, inStockRows = 0, inStockKnownBrand = 0;
    const feedIds = new Set<string>();
    const nameMatches: Array<{ id: string; in_stock: boolean; name: string; brand: string }> = [];
    const lostBrandCounts = new Map<string, number>();
    let inStockLostRows = 0;
    const feedBrandsInStock = new Map<string, number>();   // raw feed brand -> in-stock row count

    const probeSet = new Set(probeIds);
    const feedStockById = new Map<string, boolean>();

    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim()) continue;
      productRows++;
      const f = parseCsvLine(raw.replace(/\r$/, ""));
      const id = (f[idxId] || "").trim();
      const stock = isStockVal(f[idxStock] || "");
      const name = f[idxName] || "";
      const brand = f[idxBrand] || "";
      if (stock) inStockRows++;
      if (id) feedIds.add(id);
      if (probeSet.has(id)) feedStockById.set(id, stock);

      if (stock) {
        feedBrandsInStock.set(brand, (feedBrandsInStock.get(brand) || 0) + 1);
        const canon = normBrandImporter(lookupCanonical(brand));
        if (canon && existingBrandSet.has(canon)) {
          inStockKnownBrand++;
        } else {
          inStockLostRows++;
          if (wantLostBrands) {
            const key = brand || "(blank)";
            lostBrandCounts.set(key, (lostBrandCounts.get(key) || 0) + 1);
          }
        }
      }

      if (nameQ && name.toLowerCase().includes(nameQ) && nameMatches.length < 40) {
        nameMatches.push({ id, in_stock: stock, name, brand });
      }
    }

    const presentInStock = probeIds.filter((id) => feedStockById.get(id) === true);
    const presentOOS = probeIds.filter((id) => feedStockById.get(id) === false);
    const absent = probeIds.filter((id) => !feedStockById.has(id));

    // True casing/spelling losses: in-stock feed brands that fail the lenient match
    // but collide with a catalogue brand once punctuation/spacing is stripped.
    const spellingCollisions: Array<{ feed_brand: string; catalogue_brand: string; in_stock_rows: number }> = [];
    for (const [fb, cnt] of feedBrandsInStock.entries()) {
      const canon = normBrandImporter(lookupCanonical(fb));
      if (!canon || existingBrandSet.has(canon)) continue;   // matched leniently -> not a loss
      const agg = stripAgg(canon);
      const hit = agg ? aggMap.get(agg) : undefined;
      if (hit) spellingCollisions.push({ feed_brand: fb, catalogue_brand: hit, in_stock_rows: cnt });
    }
    spellingCollisions.sort((a, b) => b.in_stock_rows - a.in_stock_rows);

    const lostBrandsTop = wantLostBrands
      ? [...lostBrandCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50)
          .map(([brand, n]) => ({ brand, in_stock_rows: n }))
      : undefined;

    return new Response(JSON.stringify({
      fid,
      product_rows: productRows,
      in_stock_rows: inStockRows,
      distinct_merchant_product_ids: feedIds.size,
      known_brands_loaded: existingBrandSet.size,
      brand_aliases_loaded: brandAliasMap.size,
      in_stock_known_brand: inStockKnownBrand,      // ~ import target for existing brands (lower bound)
      in_stock_lost_rows: inStockLostRows,          // in-stock rows dropped by existing_brands_only
      distinct_in_stock_brands: feedBrandsInStock.size,
      spelling_collisions_count: spellingCollisions.length,
      spelling_collisions_rows: spellingCollisions.reduce((s, c) => s + c.in_stock_rows, 0),
      spelling_collisions: spellingCollisions,
      name_query: nameQ || undefined,
      name_matches_count: nameQ ? nameMatches.length : undefined,
      name_matches: nameQ ? nameMatches : undefined,
      probe_present_in_stock: presentInStock,
      probe_present_oos: presentOOS,
      probe_absent: absent,
      lost_brands_top: lostBrandsTop,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message, fid }), { status: 500 });
  }
});
