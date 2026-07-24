// Diagnostic (read-only): awin-feed-count  [v6]
// v6 additions (Perfume Click scoping, 2026-07-22):
//   ?list=1&q=perfume      fetch the AWIN datafeed LIST and return rows whose
//                          advertiser name/id matches q (find a fid from a mid)
//   ?stats=1               fetch EXTENDED columns (ean, prices, categories) and
//                          return aggregate stats: EAN coverage, price-field
//                          semantics (search vs rrp/store), category split,
//                          top-30 brands by in-stock rows, and EAN overlap vs
//                          our catalogue (same-product-new-retailer count).
//   Service-role gate: verify_jwt does NOT block the anon key (see the
//   edge-function security incident), so sensitive diag output now requires the
//   service-role key in Authorization.
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

function buildStatsFeedUrl(apiKey: string, feedId: string): string {
  const cols = [
    "merchant_product_id", "in_stock", "product_name", "brand_name",
    "ean", "search_price", "store_price", "rrp_price",
    "merchant_category", "category_name",
  ].join("%2C");
  return `https://productdata.awin.com/datafeed/download/apikey/${apiKey}/fid/${feedId}/format/csv/language/en/delimiter/%2C/compression/gzip/adultcontent/1/columns/${cols}/`;
}

serve(async (req) => {
  const apiKey = Deno.env.get("AWIN_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "AWIN_API_KEY not set" }), { status: 500 });

  // Service-role gate (verify_jwt alone does not block the anon key). The
  // platform has already verified the JWT signature (verify_jwt=true), so the
  // role claim is trustworthy; env equality covers non-JWT secret formats.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let isServiceRole = auth === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!isServiceRole && auth.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      isServiceRole = payload.role === "service_role";
    } catch { /* fall through */ }
  }
  if (!isServiceRole) {
    return new Response(JSON.stringify({ error: "service role required" }), { status: 403 });
  }

  const url = new URL(req.url);

  // ── v6: datafeed LIST mode ──────────────────────────────────────────────
  if (url.searchParams.get("list") === "1") {
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    try {
      const resp = await fetch(`https://productdata.awin.com/datafeed/list/apikey/${apiKey}/`, {
        headers: { "User-Agent": "FindMyBasket/1.0 (diagnostic)" },
      });
      if (!resp.ok) return new Response(JSON.stringify({ error: `AWIN list ${resp.status}` }), { status: 502 });
      const text = await resp.text();
      const lines = text.split("\n").filter((l) => l.trim());
      const cols = parseCsvLine((lines[0] || "").replace(/\r$/, ""));
      const rows = lines.slice(1).map((l) => parseCsvLine(l.replace(/\r$/, "")));
      const hits = rows
        .filter((r) => !q || r.some((c) => c.toLowerCase().includes(q)))
        .slice(0, 40)
        // Redact the apikey embedded in feed URLs — this output must never
        // carry the key (the old key-leaking diag functions were deleted for
        // exactly this; do not reintroduce the class).
        .map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").replace(/apikey\/[^/]+/, "apikey/REDACTED")])));
      return new Response(JSON.stringify({ list_query: q, total_feeds: rows.length, matches: hits }, null, 2),
        { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
    }
  }

  // ── v6: extended STATS mode ─────────────────────────────────────────────
  if (url.searchParams.get("stats") === "1") {
    const fid = url.searchParams.get("fid") || "";
    if (!fid) return new Response(JSON.stringify({ error: "fid required for stats" }), { status: 400 });
    try {
      const resp = await fetch(buildStatsFeedUrl(apiKey, fid), {
        headers: { "Accept-Encoding": "identity", "User-Agent": "FindMyBasket/1.0 (diagnostic)" },
      });
      if (!resp.ok) return new Response(JSON.stringify({ error: `AWIN ${resp.status}`, fid }), { status: 502 });
      const buf = await resp.arrayBuffer();
      const ds = new DecompressionStream("gzip");
      const text = await new Response(new Response(buf).body!.pipeThrough(ds)).text();
      const lines = text.split("\n");
      const cols = parseCsvLine((lines[0] || "").replace(/\r$/, ""));
      const ix = (c: string) => cols.indexOf(c);
      const iStock = ix("in_stock"), iBrand = ix("brand_name"), iEan = ix("ean"),
        iSearch = ix("search_price"), iStore = ix("store_price"), iRrp = ix("rrp_price"),
        iMcat = ix("merchant_category"), iCat = ix("category_name");
      const isStock = (v: string) => ["1", "true", "yes"].includes((v || "").trim().toLowerCase());
      const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };

      let rowsN = 0, inStock = 0, eanValid = 0;
      let pSearch = 0, pStore = 0, pRrp = 0, searchEqRrp = 0, searchLtRrp = 0, searchEqStore = 0;
      const brandRows = new Map<string, number>();
      const catRows = new Map<string, number>();
      const eans: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        rowsN++;
        const f = parseCsvLine(lines[i].replace(/\r$/, ""));
        const stock = isStock(f[iStock] || "");
        if (stock) inStock++;
        const ean = (f[iEan] || "").trim();
        if (/^\d{8,14}$/.test(ean)) { eanValid++; if (eans.length < 20000) eans.push(ean); }
        const sp = num(f[iSearch] || ""), st = num(f[iStore] || ""), rr = num(f[iRrp] || "");
        if (sp) pSearch++; if (st) pStore++; if (rr) pRrp++;
        if (sp && rr) { if (Math.abs(sp - rr) < 0.005) searchEqRrp++; else if (sp < rr) searchLtRrp++; }
        if (sp && st && Math.abs(sp - st) < 0.005) searchEqStore++;
        if (stock) {
          const b = (f[iBrand] || "(blank)").trim() || "(blank)";
          brandRows.set(b, (brandRows.get(b) || 0) + 1);
          const c = ((f[iMcat] || f[iCat] || "(blank)").trim() || "(blank)").slice(0, 60);
          catRows.set(c, (catRows.get(c) || 0) + 1);
        }
      }

      // EAN overlap vs catalogue (chunked; read-only SELECTs). EANs live on
      // retailer_prices (products.ean is ~empty — 8 rows), so match there and
      // pull the brand through the product join.
      const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const uniq = [...new Set(eans)];
      const hitEans = new Set<string>();
      const hitBrands = new Map<string, number>();
      for (let i = 0; i < uniq.length; i += 500) {
        const chunk = uniq.slice(i, i + 500);
        const { data } = await supa.from("retailer_prices")
          .select("ean, products(normalised_brand)").in("ean", chunk);
        for (const r of (data || []) as { ean: string; products: { normalised_brand: string | null } | null }[]) {
          if (hitEans.has(r.ean)) continue;
          hitEans.add(r.ean);
          const b = r.products?.normalised_brand || "(none)";
          hitBrands.set(b, (hitBrands.get(b) || 0) + 1);
        }
      }
      const eanHits = hitEans.size;

      const top = (m: Map<string, number>, n: number) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, rows: v }));

      return new Response(JSON.stringify({
        fid, rows: rowsN, in_stock_rows: inStock,
        ean_valid: eanValid, ean_valid_pct: rowsN ? Math.round(1000 * eanValid / rowsN) / 10 : 0,
        price_fields: {
          search_price_present: pSearch, store_price_present: pStore, rrp_present: pRrp,
          search_eq_rrp: searchEqRrp, search_lt_rrp: searchLtRrp, search_eq_store: searchEqStore,
        },
        distinct_brands_in_stock: brandRows.size,
        top_brands: top(brandRows, 30),
        top_categories: top(catRows, 20),
        ean_overlap: {
          unique_feed_eans: uniq.length, catalogue_ean_hits: eanHits,
          hit_pct_of_feed: uniq.length ? Math.round(1000 * eanHits / uniq.length) / 10 : 0,
          top_overlap_brands: top(hitBrands, 20),
        },
      }, null, 2), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message, fid }), { status: 500 });
    }
  }
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
