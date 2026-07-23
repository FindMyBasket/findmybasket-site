// Supabase edge function: awin-list-feeds
// Purpose: Diagnostic — fetches the AWIN feed list for our publisher
// and returns it as JSON so we can see which feeds we have access to.
//
// Deploy:
//   supabase functions deploy awin-list-feeds
// Set secret first:
//   supabase secrets set AWIN_API_KEY=<your_api_key>
//   supabase secrets set AWIN_PUBLISHER_ID=2841268
//
// Call:
//   curl https://crtrjoescntlcjiwdtrt.supabase.co/functions/v1/awin-list-feeds \
//     -H "Authorization: Bearer <anon_key>"
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
  // The feedList URL is undocumented but follows the same darwin pattern
  const url = `https://ui.awin.com/productdata-darwin-download/publisher/${publisherId}/${apiKey}/1/feedList`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return new Response(JSON.stringify({
        error: `AWIN returned ${response.status}`,
        status_text: response.statusText,
        url_called: url.replace(apiKey, "***")
      }), {
        status: 502,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    // Try to parse as JSON; if not JSON, return as text for inspection
    let parsed = null;
    let parseError = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parseError = e.message;
    }
    return new Response(JSON.stringify({
      success: true,
      content_type: contentType,
      text_length: text.length,
      parsed_json: parsed,
      raw_first_3000: parsed ? null : text.substring(0, 3000),
      parse_error: parseError
    }, null, 2), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
