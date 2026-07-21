// Diagnostic edge function: awin-inspect-feed
// Downloads + decompresses an AWIN feed, returns header + first 3 rows.
// Used to validate the feed format before building the refresh function.
//
// Call with ?retailer=stylevana (or branded_beauty / escentual)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const FEEDS = {
  stylevana: {
    name: "Stylevana",
    supabase_retailer_id: 11,
    url: "https://productdata.awin.com/datafeed/download/apikey/{API_KEY}/fid/101286/format/csv/language/en/delimiter/%2C/compression/gzip/adultcontent/1/columns/aw_deep_link%2Cproduct_name%2Caw_product_id%2Cmerchant_product_id%2Cmerchant_image_url%2Csearch_price%2Cmerchant_name%2Cmerchant_id%2Cstore_price%2Cmerchant_deep_link%2Clast_updated%2Cbrand_name%2Crrp_price%2Cin_stock%2Cmerchant_product_category_path%2Cean%2Cupc/"
  },
  branded_beauty: {
    name: "Branded Beauty",
    supabase_retailer_id: 6,
    url: "https://productdata.awin.com/datafeed/download/apikey/{API_KEY}/fid/F2036/format/csv/language/en/delimiter/%2C/compression/gzip/adultcontent/1/columns/aw_deep_link%2Cproduct_name%2Caw_product_id%2Cmerchant_product_id%2Cmerchant_image_url%2Csearch_price%2Cmerchant_name%2Cmerchant_id%2Cmerchant_deep_link%2Clast_updated%2Cbrand_name%2Crrp_price%2Cin_stock%2Cmerchant_product_category_path%2Cean%2Cupc/"
  },
  escentual: {
    name: "Escentual",
    supabase_retailer_id: 8,
    url: "https://productdata.awin.com/datafeed/download/apikey/{API_KEY}/fid/97233/format/csv/language/en/delimiter/%2C/compression/gzip/adultcontent/1/columns/aw_deep_link%2Cproduct_name%2Caw_product_id%2Cmerchant_product_id%2Cmerchant_image_url%2Csearch_price%2Cmerchant_name%2Cmerchant_id%2Cmerchant_deep_link%2Clast_updated%2Cbrand_name%2Crrp_price%2Cin_stock%2Cmerchant_product_category_path%2Cean%2Cupc/"
  }
};
// Naive CSV row parser — handles quoted fields with embedded commas
function parseRow(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
serve(async (req)=>{
  const apiKey = Deno.env.get("AWIN_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: "AWIN_API_KEY secret not configured"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const url = new URL(req.url);
  const retailer = url.searchParams.get("retailer") || "stylevana";
  const config = FEEDS[retailer];
  if (!config) {
    return new Response(JSON.stringify({
      error: "Unknown retailer",
      valid: Object.keys(FEEDS)
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const feedUrl = config.url.replace("{API_KEY}", apiKey);
  try {
    const t0 = Date.now();
    const resp = await fetch(feedUrl);
    const t1 = Date.now();
    if (!resp.ok) {
      return new Response(JSON.stringify({
        error: `AWIN returned ${resp.status}`,
        status_text: resp.statusText
      }), {
        status: 502,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // Get response as ArrayBuffer (since it's gzipped binary)
    const buf = await resp.arrayBuffer();
    const t2 = Date.now();
    // Decompress gzip using DecompressionStream (built into Deno)
    const ds = new DecompressionStream("gzip");
    const decompressed = new Response(new Response(buf).body.pipeThrough(ds));
    const text = await decompressed.text();
    const t3 = Date.now();
    const lines = text.split("\n");
    const header = lines[0];
    const columns = parseRow(header).map((c)=>c.replace(/^"|"$/g, ""));
    // Get first 3 product rows (skipping empty lines)
    const sampleRows = [];
    for(let i = 1; i < lines.length && sampleRows.length < 3; i++){
      const line = lines[i];
      if (!line.trim()) continue;
      const fields = parseRow(line).map((f)=>f.replace(/^"|"$/g, ""));
      const row = {};
      columns.forEach((col, idx)=>{
        row[col] = fields[idx] ?? "";
      });
      sampleRows.push(row);
    }
    return new Response(JSON.stringify({
      retailer: config.name,
      supabase_retailer_id: config.supabase_retailer_id,
      timing_ms: {
        fetch: t1 - t0,
        download_buffer: t2 - t1,
        decompress: t3 - t2,
        total: t3 - t0
      },
      compressed_size_bytes: buf.byteLength,
      decompressed_size_bytes: text.length,
      total_lines: lines.length,
      columns,
      sample_first_3_rows: sampleRows
    }, null, 2), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e.message,
      stack: e.stack
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
