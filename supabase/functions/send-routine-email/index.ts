// FindMyBasket — send-routine-email edge function (single-file version)
//
// Modes:
//   ?mode=welcome&routineId=X — send welcome email for one routine
//   ?mode=monthly — send to all active routines not emailed this calendar month
//   ?mode=test&routineId=X — send a test email (does not update last_emailed_at)
//
// Required env vars (set as Edge Function secrets):
//   RESEND_API_KEY
//   APP_BASE_URL  (e.g. https://www.findmybasket.co.uk)
//
// This file was previously deployed to prod ONLY and not versioned. It is now in
// the repo (like saved_routines) so changes are reviewable. Two functional
// changes vs the prod v9 baseline, both marked with `CHANGE:` below:
//   1. Monthly eligibility gates on CALENDAR MONTH, not a rolling 30-day window,
//      so "monthly" is actually once per month (the 30-day window skipped rows
//      emailed a few seconds after the 1st-of-month cron, and skipped everyone
//      after February's 28 days).
//   2. Delivery observability: every send attempt is written to
//      routine_email_log (Resend message id on success, status+body on failure),
//      and a non-zero failure count is logged to the edge-function console.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API = "https://api.resend.com/emails";
const FROM_ADDRESS = "FindMyBasket <hello@findmybasket.co.uk>";

// =============================================
// TYPES
// =============================================
interface PriceRow {
  product_id: number;
  retailer_id: number;
  price: number | string;
  url: string;
  in_stock: boolean;
  retailers: {
    name: string;
    delivery_threshold: number | string;
    delivery_cost: number | string;
  };
}

interface Product {
  id: number;
  name: string;
  brand: string;
}

interface BasketBreakdownItem {
  product: Product;
  price: number;
  retailerName: string;
  url: string;
}

interface BasketOption {
  retailers: string[];
  total: number;
  productsTotal: number;
  deliveryCost: number;
  breakdown: BasketBreakdownItem[];
  type: "single" | "split";
}

interface OptimisationResult {
  options: BasketOption[];
  best: BasketOption | null;
  worstCaseTotal: number;
  saving: number;
  savingPercent: number;
}

interface SavedRoutine {
  id: number;
  email: string;
  routine: number[];
  unsubscribe_token: string;
  active: boolean;
  last_emailed_at: string | null;
}

// =============================================
// OPTIMISATION LOGIC
// =============================================
function optimiseBasket(routine: Product[], prices: PriceRow[]): OptimisationResult {
  if (routine.length === 0 || !prices || prices.length === 0) {
    return { options: [], best: null, worstCaseTotal: 0, saving: 0, savingPercent: 0 };
  }

  const priceMap: Record<number, Record<number, {
    price: number; url: string; retailerName: string;
    deliveryThreshold: number; deliveryCost: number;
  }>> = {};

  for (const row of prices) {
    if (!priceMap[row.product_id]) priceMap[row.product_id] = {};
    priceMap[row.product_id][row.retailer_id] = {
      price: typeof row.price === "string" ? parseFloat(row.price) : row.price,
      url: row.url,
      retailerName: row.retailers.name,
      deliveryThreshold: typeof row.retailers.delivery_threshold === "string"
        ? parseFloat(row.retailers.delivery_threshold) : row.retailers.delivery_threshold,
      deliveryCost: typeof row.retailers.delivery_cost === "string"
        ? parseFloat(row.retailers.delivery_cost) : row.retailers.delivery_cost,
    };
  }

  const retailerInfoMap: Record<number, { name: string; delivery_threshold: number; delivery_cost: number; }> = {};
  for (const row of prices) {
    if (!retailerInfoMap[row.retailer_id]) {
      retailerInfoMap[row.retailer_id] = {
        name: row.retailers.name,
        delivery_threshold: typeof row.retailers.delivery_threshold === "string"
          ? parseFloat(row.retailers.delivery_threshold) : row.retailers.delivery_threshold,
        delivery_cost: typeof row.retailers.delivery_cost === "string"
          ? parseFloat(row.retailers.delivery_cost) : row.retailers.delivery_cost,
      };
    }
  }

  const allRetailerIds = Array.from(new Set(prices.map((p) => p.retailer_id)));
  const uniqueRetailerCount = allRetailerIds.length || 1;
  const worstDelivery = uniqueRetailerCount * 3.95;
  const worstCaseProducts = routine.reduce((sum, product) => {
    const productPrices = priceMap[product.id];
    if (!productPrices) return sum;
    const maxPrice = Math.max(...Object.values(productPrices).map((p) => p.price));
    return sum + maxPrice;
  }, 0);
  const worstCaseTotal = worstCaseProducts + worstDelivery;

  // Single-retailer options
  const singleOptions: BasketOption[] = [];
  for (const rid of allRetailerIds) {
    let total = 0; let covered = 0;
    const breakdown: BasketBreakdownItem[] = [];
    let retailerName = "";
    for (const product of routine) {
      const pp = priceMap[product.id]?.[rid];
      if (pp) {
        total += pp.price; covered++;
        retailerName = pp.retailerName;
        breakdown.push({ product, price: pp.price, retailerName: pp.retailerName, url: pp.url });
      }
    }
    if (covered === routine.length) {
      const rInfo = retailerInfoMap[rid];
      const deliveryCost = total >= (rInfo?.delivery_threshold || 25) ? 0 : (rInfo?.delivery_cost || 3.95);
      singleOptions.push({
        retailers: [retailerName], total: total + deliveryCost,
        productsTotal: total, deliveryCost, breakdown, type: "single",
      });
    }
  }

  // 2-retailer combinations
  const twoOptions: BasketOption[] = [];
  for (let i = 0; i < allRetailerIds.length; i++) {
    for (let j = i + 1; j < allRetailerIds.length; j++) {
      const r1 = allRetailerIds[i]; const r2 = allRetailerIds[j];
      let total = 0;
      const breakdown: BasketBreakdownItem[] = [];
      let r1Total = 0; let r2Total = 0;
      let r1Name = retailerInfoMap[r1]?.name || "";
      let r2Name = retailerInfoMap[r2]?.name || "";
      const r1Info = retailerInfoMap[r1]; const r2Info = retailerInfoMap[r2];
      let allCovered = true;

      for (const product of routine) {
        const p1 = priceMap[product.id]?.[r1];
        const p2 = priceMap[product.id]?.[r2];
        if (!p1 && !p2) { allCovered = false; break; }
        if (p1 && p2) {
          if (p1.price <= p2.price) {
            r1Total += p1.price; total += p1.price; r1Name = p1.retailerName;
            breakdown.push({ product, price: p1.price, retailerName: p1.retailerName, url: p1.url });
          } else {
            r2Total += p2.price; total += p2.price; r2Name = p2.retailerName;
            breakdown.push({ product, price: p2.price, retailerName: p2.retailerName, url: p2.url });
          }
        } else if (p1) {
          r1Total += p1.price; total += p1.price; r1Name = p1.retailerName;
          breakdown.push({ product, price: p1.price, retailerName: p1.retailerName, url: p1.url });
        } else if (p2) {
          r2Total += p2.price; total += p2.price; r2Name = p2.retailerName;
          breakdown.push({ product, price: p2.price, retailerName: p2.retailerName, url: p2.url });
        }
      }
      if (!allCovered) continue;

      const d1 = r1Total > 0 ? (r1Total >= (r1Info?.delivery_threshold || 25) ? 0 : (r1Info?.delivery_cost || 3.95)) : 0;
      const d2 = r2Total > 0 ? (r2Total >= (r2Info?.delivery_threshold || 25) ? 0 : (r2Info?.delivery_cost || 3.95)) : 0;
      const retailers = [r1Name, r2Name].filter(Boolean);
      twoOptions.push({
        retailers, total: total + d1 + d2,
        productsTotal: total, deliveryCost: d1 + d2,
        breakdown, type: "split",
      });
    }
  }

  const allOptions = [...singleOptions, ...twoOptions].sort((a, b) => a.total - b.total);

  if (allOptions.length === 0) {
    const fallbackBreakdown: BasketBreakdownItem[] = [];
    let fallbackTotal = 0;
    for (const product of routine) {
      const productPrices = priceMap[product.id];
      if (!productPrices || Object.keys(productPrices).length === 0) continue;
      const cheapest = Object.values(productPrices).sort((a, b) => a.price - b.price)[0];
      fallbackTotal += cheapest.price;
      fallbackBreakdown.push({
        product, price: cheapest.price,
        retailerName: cheapest.retailerName, url: cheapest.url,
      });
    }
    const fallback: BasketOption = {
      retailers: ["Best available prices"], total: fallbackTotal,
      productsTotal: fallbackTotal, deliveryCost: 0,
      breakdown: fallbackBreakdown, type: "split",
    };
    return {
      options: [fallback], best: fallback, worstCaseTotal,
      saving: Math.max(0, worstCaseTotal - fallbackTotal),
      savingPercent: worstCaseTotal > 0 ? Math.round(((worstCaseTotal - fallbackTotal) / worstCaseTotal) * 100) : 0,
    };
  }

  const best = allOptions[0];
  const saving = Math.max(0, worstCaseTotal - best.total);
  const savingPercent = worstCaseTotal > 0 ? Math.round((saving / worstCaseTotal) * 100) : 0;
  return { options: allOptions, best, worstCaseTotal, saving, savingPercent };
}

// =============================================
// EMAIL TEMPLATE
// =============================================
function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function buildEmailSubject(result: OptimisationResult, emailType: "welcome" | "monthly"): string {
  if (emailType === "welcome") return "Your routine is saved ✨";
  if (result.best && result.saving > 0) return `Your routine this month — save £${result.saving.toFixed(2)}`;
  return "Your routine this month";
}

function buildEmailHTML(params: {
  result: OptimisationResult; unsubscribeToken: string;
  routineProductIds: number[]; appBaseUrl: string;
  emailType: "welcome" | "monthly";
}): string {
  const { result, unsubscribeToken, routineProductIds, appBaseUrl, emailType } = params;
  const unsubscribeUrl = `${appBaseUrl}/unsubscribe.html?token=${unsubscribeToken}`;
  const basketUrl = `${appBaseUrl}/app.html?routine=${routineProductIds.join(",")}`;

  const headline = emailType === "welcome" ? "Your routine is saved" : "Your routine this month";
  const intro = emailType === "welcome"
    ? "Thanks for saving your skincare routine. We'll email you each month with the best prices on your routine across UK retailers."
    : "We've checked prices across UK retailers. Here's the best way to restock your routine this month.";

  let breakdownHtml = "";
  if (result.best) {
    breakdownHtml = result.best.breakdown.map((item) => `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e0d8; font-size: 14px; color: #1c1a18;">
          <div style="font-weight: 500; margin-bottom: 2px;">${escapeHtml(item.product.name)}</div>
          <div style="color: #6e6a64; font-size: 12px;">${escapeHtml(item.retailerName)}</div>
        </td>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e0d8; font-size: 14px; color: #1c1a18; text-align: right; font-weight: 600;">
          £${item.price.toFixed(2)}
        </td>
      </tr>`).join("");
  }

  const retailerList = result.best?.retailers.join(" + ") || "—";
  const totalPrice = result.best?.total.toFixed(2) || "0.00";
  const deliveryText = result.best && result.best.deliveryCost === 0
    ? "Free delivery"
    : result.best ? `Delivery £${result.best.deliveryCost.toFixed(2)}` : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin: 0; padding: 0; background: #faf8f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1c1a18;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #faf8f4; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px; background: #ffffff; border-radius: 16px; overflow: hidden;">
<tr><td style="padding: 28px 32px 24px; border-bottom: 1px solid #f0ece4;">
<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 600; color: #1c1a18;">
Find<span style="color: #c9a96e;">My</span>Basket</div></td></tr>
<tr><td style="padding: 32px 32px 8px;">
<h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 28px; font-weight: 600; color: #1c1a18; line-height: 1.2;">${escapeHtml(headline)}</h1>
<p style="margin: 0; font-size: 15px; line-height: 1.6; color: #4a4845;">${escapeHtml(intro)}</p>
</td></tr>
${result.best ? `
<tr><td style="padding: 24px 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: rgba(122,158,135,0.12); border: 1px solid rgba(122,158,135,0.3); border-radius: 12px; padding: 18px 22px;">
<tr><td>
<div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #6a7e6f; margin-bottom: 6px;">You could save</div>
<div style="font-family: Georgia, serif; font-size: 32px; font-weight: 600; color: #5a8970; line-height: 1;">£${result.saving.toFixed(2)}</div>
<div style="font-size: 13px; color: #6a7e6f; margin-top: 6px;">vs buying everything at the most expensive retailer</div>
</td></tr></table></td></tr>
<tr><td style="padding: 24px 32px 0;">
<div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #c9a96e; font-weight: 600; margin-bottom: 12px;">Best price basket</div>
<div style="font-family: Georgia, serif; font-size: 18px; font-weight: 600; color: #1c1a18; margin-bottom: 4px;">${escapeHtml(retailerList)}</div>
<div style="font-size: 13px; color: #6e6a64; margin-bottom: 16px;">${result.best.type === "single" ? "Shop everything from one retailer" : "Split across " + result.best.retailers.length + " retailers for best price"}</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
${breakdownHtml}
<tr><td style="padding: 14px 0 4px; font-size: 13px; color: #6e6a64;">Delivery</td>
<td style="padding: 14px 0 4px; font-size: 13px; color: #6e6a64; text-align: right;">${deliveryText}</td></tr>
<tr><td style="padding: 14px 0 0; font-size: 16px; font-weight: 600; color: #1c1a18; border-top: 2px solid #1c1a18;">Total</td>
<td style="padding: 14px 0 0; font-size: 18px; font-weight: 700; color: #1c1a18; text-align: right; border-top: 2px solid #1c1a18;">£${totalPrice}</td></tr>
</table></td></tr>
<tr><td style="padding: 32px 32px 24px;" align="center">
<a href="${basketUrl}" style="display: inline-block; background: #1c1a18; color: #faf8f4; padding: 16px 36px; border-radius: 100px; text-decoration: none; font-size: 15px; font-weight: 600;">Open my basket →</a>
<p style="margin: 14px 0 0; font-size: 12px; color: #8a8680;">Click to see live prices and shop your routine</p>
</td></tr>
` : `
<tr><td style="padding: 32px;" align="center">
<p style="margin: 0; font-size: 14px; color: #6e6a64;">We couldn't find live prices for your routine right now. Please check back tomorrow or <a href="${appBaseUrl}/app.html" style="color: #c9a96e;">visit FindMyBasket</a>.</p>
</td></tr>
`}
<tr><td style="padding: 24px 32px; background: #faf8f4; border-top: 1px solid #f0ece4;">
<p style="margin: 0 0 12px; font-size: 12px; color: #8a8680; line-height: 1.6;">You're receiving this because you saved a routine on FindMyBasket. Prices are checked at the time of sending and may vary.</p>
<p style="margin: 0; font-size: 12px; color: #8a8680;">
<a href="${unsubscribeUrl}" style="color: #8a8680; text-decoration: underline;">Unsubscribe</a> ·
<a href="${appBaseUrl}" style="color: #8a8680; text-decoration: underline;">FindMyBasket</a> ·
<a href="mailto:hello@findmybasket.co.uk" style="color: #8a8680; text-decoration: underline;">Contact</a>
</p></td></tr>
</table>
<p style="margin: 16px 0 0; font-size: 11px; color: #b0aca4;">© 2026 FindMyBasket. UK skincare price comparison.</p>
</td></tr></table></body></html>`;
}

// =============================================
// OBSERVABILITY
// =============================================
// Records every send attempt (success or failure) so delivery problems are
// discoverable by query instead of by accident. Best-effort: a logging failure
// must never break or fail a send.
async function logSend(
  supabase: ReturnType<typeof createClient>,
  routine: SavedRoutine,
  mode: string,
  ok: boolean,
  resendMessageId: string | null,
  error: string | null,
): Promise<void> {
  try {
    await supabase.from("routine_email_log").insert({
      routine_id: routine.id,
      email: routine.email,
      mode,
      ok,
      resend_message_id: resendMessageId,
      error: error ? String(error).slice(0, 500) : null,
    });
  } catch (_) {
    // swallow — observability must not affect sending
  }
}

// =============================================
// MAIN HANDLER
// =============================================
Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "monthly";
    const routineIdParam = url.searchParams.get("routineId");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://www.findmybasket.co.uk";

    if (!supabaseUrl || !serviceKey || !resendKey) {
      return jsonResponse({ error: "Missing required environment variables" }, 500, corsHeaders);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    let routines: SavedRoutine[] = [];

    if (mode === "welcome" || mode === "test") {
      if (!routineIdParam) return jsonResponse({ error: "routineId required" }, 400, corsHeaders);
      const { data, error } = await supabase
        .from("saved_routines").select("*")
        .eq("id", parseInt(routineIdParam)).single();
      if (error || !data) return jsonResponse({ error: "Routine not found" }, 404, corsHeaders);
      routines = [data as SavedRoutine];
    } else if (mode === "monthly") {
      // CHANGE (cadence): eligibility is "not emailed THIS calendar month", not a
      // rolling 30-day window. The cron runs 0 9 1 * * (1st of month); a 30-day
      // window is longer than February (28d) and, due to per-run execution jitter,
      // longer than the gap for a row emailed a few seconds after last month's
      // cron — both caused rows to be silently skipped for a month. Gating on the
      // start of the current month makes "monthly" reliably monthly.
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const { data, error } = await supabase
        .from("saved_routines").select("*").eq("active", true)
        .or(`last_emailed_at.is.null,last_emailed_at.lt.${startOfMonth}`);
      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders);
      routines = (data || []) as SavedRoutine[];
    } else {
      return jsonResponse({ error: "Invalid mode" }, 400, corsHeaders);
    }

    let sent = 0; let failed = 0;
    const errors: string[] = [];

    for (const routine of routines) {
      try {
        const productIds: number[] = Array.isArray(routine.routine) ? routine.routine : [];
        if (productIds.length === 0) {
          failed++; errors.push(`Routine ${routine.id}: empty product list`);
          await logSend(supabase, routine, mode, false, null, "empty product list");
          continue;
        }

        const { data: productsData, error: prodError } = await supabase
          .from("products").select("id, name, brand").in("id", productIds);
        if (prodError) throw prodError;
        const products = (productsData || []) as Product[];

        // Only ACTIVE retailers — this email goes OUT to users, so an inactive
        // retailer's offer would mean recommending and linking a retailer we no
        // longer list. `retailers!inner` makes the embed an inner join so the
        // filter drops the price row itself.
        const { data: pricesData, error: priceError } = await supabase
          .from("retailer_prices")
          .select("product_id, retailer_id, price, url, in_stock, retailers!inner(name, delivery_threshold, delivery_cost, active)")
          .in("product_id", productIds).eq("in_stock", true).eq("retailers.active", true);
        if (priceError) throw priceError;
        const prices = (pricesData || []) as unknown as PriceRow[];

        const result = optimiseBasket(products, prices);
        const html = buildEmailHTML({
          result, unsubscribeToken: routine.unsubscribe_token,
          routineProductIds: productIds, appBaseUrl,
          emailType: mode === "welcome" ? "welcome" : "monthly",
        });
        const subject = buildEmailSubject(result, mode === "welcome" ? "welcome" : "monthly");

        const resendRes = await fetch(RESEND_API, {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: FROM_ADDRESS, to: routine.email, subject, html }),
        });

        if (!resendRes.ok) {
          const errText = await resendRes.text();
          failed++; errors.push(`Routine ${routine.id} (${routine.email}): Resend ${resendRes.status} — ${errText}`);
          await logSend(supabase, routine, mode, false, null, `Resend ${resendRes.status}: ${errText}`);
          continue;
        }

        // CHANGE (observability): capture the Resend message id for delivery
        // correlation. Reading the body must not turn a real 2xx send into a
        // failure, so parse defensively.
        let resendMessageId: string | null = null;
        try {
          const body = await resendRes.json();
          resendMessageId = (body && typeof body.id === "string") ? body.id : null;
        } catch (_) {
          resendMessageId = null;
        }

        if (mode === "monthly" || mode === "welcome") {
          await supabase.from("saved_routines")
            .update({ last_emailed_at: new Date().toISOString() })
            .eq("id", routine.id);
        }
        await logSend(supabase, routine, mode, true, resendMessageId, null);
        sent++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        failed++; errors.push(`Routine ${routine.id}: ${message}`);
        await logSend(supabase, routine, mode, false, null, message);
      }
    }

    // CHANGE (observability): make a non-zero failure count loud in the
    // edge-function logs, not just buried in the JSON response body.
    if (failed > 0) {
      console.error(`send-routine-email[${mode}]: ${failed} failed / ${routines.length} processed`, errors.slice(0, 10));
    }

    return jsonResponse({ mode, processed: routines.length, sent, failed, errors: errors.slice(0, 10) }, 200, corsHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500, corsHeaders);
  }
});

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...headers, "Content-Type": "application/json" },
  });
}
