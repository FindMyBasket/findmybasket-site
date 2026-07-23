// Diagnostic edge function: awin-find-our-feeds
// Filters AWIN's full feed list to just the retailers we care about,
// returning their download URLs ready to use in the refresh function.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// Our retailers in the database, keyed by AWIN advertiser ID
const OUR_RETAILERS = {
  "106621": {
    name: "Stylevana",
    supabase_retailer_id: 11
  },
  "48313": {
    name: "Branded Beauty",
    supabase_retailer_id: 6
  },
  "2991": {
    name: "Escentual",
    supabase_retailer_id: 8
  },
  "15789": {
    name: "Evolve Beauty",
    supabase_retailer_id: 5
  }
};
serve(async (_req)=>{
  const apiKey = Deno.env.get("AWIN_API_KEY");
  const publisherId = Deno.env.get("AWIN_PUBLISHER_ID") || "2841268";
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
  const url = `https://ui.awin.com/productdata-darwin-download/publisher/${publisherId}/${apiKey}/1/feedList`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return new Response(JSON.stringify({
        error: `AWIN returned ${response.status}`
      }), {
        status: 502
      });
    }
    const text = await response.text();
    const lines = text.split("\n");
    const header = lines[0];
    // Parse header to find column indices
    const columns = header.split(",").map((c)=>c.replace(/^"|"$/g, "").trim());
    const colIdx = (name)=>columns.indexOf(name);
    const advertiserIdCol = colIdx("Advertiser ID");
    const advertiserNameCol = colIdx("Advertiser Name");
    const membershipStatusCol = colIdx("Membership Status");
    const feedIdCol = colIdx("Feed ID");
    const lastImportedCol = colIdx("Last Imported");
    const numProductsCol = colIdx("No of products");
    const urlCol = colIdx("URL");
    // Naive CSV row parser — handles quoted fields with commas
    const parseRow = (line)=>{
      const out = [];
      let cur = "";
      let inQuotes = false;
      for(let i = 0; i < line.length; i++){
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      return out;
    };
    const found = [];
    for(let i = 1; i < lines.length; i++){
      const line = lines[i];
      if (!line.trim()) continue;
      const fields = parseRow(line);
      const advId = fields[advertiserIdCol]?.replace(/^"|"$/g, "");
      if (advId && OUR_RETAILERS[advId]) {
        found.push({
          advertiser_id: advId,
          advertiser_name: fields[advertiserNameCol]?.replace(/^"|"$/g, ""),
          our_retailer_name: OUR_RETAILERS[advId].name,
          our_supabase_retailer_id: OUR_RETAILERS[advId].supabase_retailer_id,
          membership_status: fields[membershipStatusCol]?.replace(/^"|"$/g, ""),
          feed_id: fields[feedIdCol]?.replace(/^"|"$/g, ""),
          last_imported: fields[lastImportedCol]?.replace(/^"|"$/g, ""),
          num_products: fields[numProductsCol]?.replace(/^"|"$/g, ""),
          download_url: fields[urlCol]?.replace(/^"|"$/g, "")
        });
      }
    }
    return new Response(JSON.stringify({
      total_feeds_in_response: lines.length - 1,
      found_count: found.length,
      feeds: found,
      retailers_we_searched_for: Object.entries(OUR_RETAILERS).map(([id, r])=>({
          advertiser_id: id,
          ...r
        }))
    }, null, 2), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e.message
    }), {
      status: 500
    });
  }
});
