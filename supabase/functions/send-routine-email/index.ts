// FindMyBasket — send-routine-email edge function (single-file version)
//
// Modes:
//   ?mode=welcome&routineId=X — send welcome email for one routine
//   ?mode=monthly — send to all active routines not emailed this calendar month
//   ?mode=test&routineId=X — send a test email (does not update last_emailed_at)
//   ?mode=alerts — send per-user price-drop emails from the routine_alerts queue
//                  (new account system: tracked_products + routine_alerts). One
//                  email per user covering all their live drops. The queue
//                  (fmb_pending_alert_batch) already filters to consenting users,
//                  undelivered alerts, and deals still live, so this pass does not
//                  re-check eligibility — it renders, sends, then marks delivered.
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

import { deliveryFor } from "../_shared/delivery.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/require-service-role.ts";

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
    delivery_model: string | null;
    delivery_threshold: number | string | null;
    delivery_cost: number | string | null;
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
  // "fallback" is not a way to buy the basket. It is the cheapest price found for each
  // product we could price, with NO delivery costed and, usually, PRODUCTS MISSING.
  // It used to be typed "split", which made the render treat it as a real comparison
  // result: "Split across 1 retailers for best price", delivery GBP 0 shown as "Free
  // delivery", over a breakdown four rows long for a twelve-product routine. Given its
  // own type so the copy can branch on what it actually is. Item 346.
  type: "single" | "split" | "fallback";
}

interface OptimisationResult {
  options: BasketOption[];
  best: BasketOption | null;
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

// One drop within a user's alert email. Shape matches the jsonb objects returned
// by fmb_pending_alert_batch (numerics arrive as strings over PostgREST).
interface AlertItem {
  product_id: number;
  name: string;
  brand: string | null;
  image_url: string | null;
  baseline_price: number | string;
  alerted_price: number | string;
  current_price: number | string | null;
  retailer: string | null;
  pct_below_baseline: number | string | null;
  url: string; // '/product/<id>' — made absolute at render time
}

// One row per consenting user from fmb_pending_alert_batch.
interface AlertBatchRow {
  user_id: string;
  email: string;
  unsubscribe_token: string;
  alert_ids: number[];
  alerts: AlertItem[];
}

// Postgres numeric -> JS number, tolerant of the string form PostgREST returns.
function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

// =============================================
// OPTIMISATION LOGIC
// =============================================
function optimiseBasket(routine: Product[], prices: PriceRow[]): OptimisationResult {
  if (routine.length === 0 || !prices || prices.length === 0) {
    return { options: [], best: null, saving: 0, savingPercent: 0 };
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

  const retailerInfoMap: Record<number, { name: string; delivery_model: string | null; delivery_threshold: number | string | null; delivery_cost: number | string | null; }> = {};
  for (const row of prices) {
    if (!retailerInfoMap[row.retailer_id]) {
      retailerInfoMap[row.retailer_id] = {
        name: row.retailers.name,
        delivery_model: row.retailers.delivery_model ?? null,
        delivery_threshold: typeof row.retailers.delivery_threshold === "string"
          ? parseFloat(row.retailers.delivery_threshold) : row.retailers.delivery_threshold,
        delivery_cost: typeof row.retailers.delivery_cost === "string"
          ? parseFloat(row.retailers.delivery_cost) : row.retailers.delivery_cost,
      };
    }
  }

  const allRetailerIds = Array.from(new Set(prices.map((p) => p.retailer_id)));

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
      // Was: `|| 25` / `|| 3.95`. `||` turned a genuine £0 delivery cost into £3.95,
      // so this path priced a zero-cost retailer £3.95 higher than the app did for the
      // SAME basket. Two pricing paths disagreeing in production, masked only because
      // that retailer was out of stock. Now the one rule, shared with the app.
      const dOut = deliveryFor(rInfo ?? {}, total);
      if (!dOut.known) continue;
      const deliveryCost = dOut.cost;
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

      const o1 = deliveryFor(r1Info ?? {}, r1Total);
      const o2 = deliveryFor(r2Info ?? {}, r2Total);
      // Either leg unknown makes the pair's delivered total unknown, so it cannot be
      // ranked against pairs whose delivery is known. Skip rather than guess.
      if (!o1.known || !o2.known) continue;
      const d1 = o1.cost;
      const d2 = o2.cost;

      // DEGENERATE PAIR GUARD. Ported verbatim from app/app/RoutineBuilder.tsx, which
      // has had these three lines all along.
      //
      // A pair (r1, r2) where every product went to r1 leaves r2 with an empty leg.
      // deliveryFor correctly charges nothing for an empty leg, so the "split" total
      // comes out IDENTICAL to r1's single-retailer option. It is not a second way to
      // buy the basket. It is the same basket counted twice.
      //
      // That mattered because saving is options[1].total - options[0].total. With N
      // retailers the winner was re-emitted N-1 times, so options[1] ALWAYS tied
      // options[0] and the reported saving was ALWAYS GBP 0.00. Not a genuine tie:
      // structurally unmeasurable. Measured on the eight active routines, four have a
      // real saving this reported as zero: 2.64, 2.64, 2.00 and 0.50 pounds.
      //
      // WHY THE TWO PATHS DIVERGED. Delivery was unified into _shared/delivery.ts in
      // August 2026 because the builder and this file had each written the rule out by
      // hand and disagreed. That fixed the layer the shared module covers.
      // OPTION-SET CONSTRUCTION SITS ABOVE THAT LAYER AND WAS LEFT HOLDING TWO
      // IMPLEMENTATIONS OF ONE RULE, so the same class of divergence reappeared one
      // level up, in the code that CALLS the unified rule. Extracting a shared module
      // fixes what it covers and creates no obligation on what sits above it. Item 345.
      const retailers: string[] = [];
      if (r1Total > 0 && r1Name) retailers.push(r1Name);
      if (r2Total > 0 && r2Name) retailers.push(r2Name);
      if (retailers.length < 2) continue;

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
      breakdown: fallbackBreakdown, type: "fallback",
    };
    // The fallback is a SINGLE synthesised option, so there is no next best to
    // anchor against and no saving can honestly be claimed. It once anchored against a
    // per-product-maximum basket, the same invented baseline the main path used; item
    // 245 removed both. Zero here is the truthful answer, not a degraded one.
    return {
      options: [fallback], best: fallback,
      saving: 0,
      savingPercent: 0,
    };
  }

  const best = allOptions[0];
  // NEXT-BEST ANCHOR. The baseline it replaced assigned EACH PRODUCT INDEPENDENTLY to
  // its most expensive stocking retailer and then charged delivery per resulting leg.
  // That basket is no longer computed: it was still being calculated here long after
  // the claim it fed was withdrawn, which item 347 recorded as dead code that looks
  // like a live measurement. Deleted 25 August 2026. Nothing below names it, and this
  // comment deliberately does not either -- a comment naming a removed variable
  // recreates the same trap in prose.
  //
  // THIS WAS THE WORST OF THE THREE INSTANCES. The builder's anchor was at least a
  // basket someone could assemble -- one shop, one delivery. This one is not: it is
  // a cherry-picked maximum per line, and no shopper would ever buy it. It has been
  // sent nineteen times.
  //
  // THE COMMENT ABOVE REASONED CORRECTLY AND REACHED HALF THE PROBLEM. It says an
  // invented baseline gives an invented saving, and it applied that to the DELIVERY
  // side properly -- replacing a fabricated GBP 3.95 constant with the real
  // per-retailer rule. The PRODUCTS side was left as a per-product maximum, which is
  // the half doing more of the inflating. Item 179's shape in a comment rather than
  // a guard: the reasoning was right and its reach was partial.
  //
  // options is sorted ascending by delivered total, so options[1] is the next-best
  // basket the recipient could actually have chosen. Work-list item 245.
  const nextBest = allOptions.length >= 2 ? allOptions[1].total : null;
  const saving = nextBest === null ? 0 : Math.max(0, nextBest - best.total);
  const savingPercent = nextBest && nextBest > 0 ? Math.round((saving / nextBest) * 100) : 0;
  return { options: allOptions, best, saving, savingPercent };
}

// =============================================
// EMAIL TEMPLATE
// =============================================
function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * THE SAVINGS RULE, EXPRESSED ONCE.
 *
 * Before this, the subject was gated on `result.best && result.saving > 0` and the
 * savings panel was gated on `result.best` ALONE. Two gates for one decision, and
 * they disagreed on every routine that had a basket and no measurable saving, which
 * as of 20 Aug 2026 was seven of the eight active routines. The subject correctly
 * said nothing about a saving; the panel underneath it rendered
 *
 *     YOU COULD SAVE / GBP 0.00 / vs buying everything at the most expensive retailer
 *
 * Both halves wrong at once, and independently. The number was zero for the
 * structural reason fixed in optimiseBasket above, and the sentence still named the
 * baseline the number stopped using when item 245 moved the anchor to next-best.
 * The anchor moved, the sentence did not.
 *
 * ONE RULE. Both the subject and the panel ask this function. Do not re-derive it,
 * and do not test `saving > 0` at a call site: that is how the asymmetry started.
 */
function hasMeasuredSaving(result: OptimisationResult): boolean {
  return result.best !== null && result.saving > 0;
}

function buildEmailSubject(result: OptimisationResult, emailType: "welcome" | "monthly"): string {
  if (emailType === "welcome") return "Your routine is saved ✨";
  if (hasMeasuredSaving(result)) return `Your routine this month: save £${result.saving.toFixed(2)}`;
  return "Your routine this month";
}

function buildEmailHTML(params: {
  result: OptimisationResult; unsubscribeToken: string;
  routineProductIds: number[]; routineProducts: Product[]; appBaseUrl: string;
  emailType: "welcome" | "monthly";
}): string {
  const { result, unsubscribeToken, routineProductIds, routineProducts, appBaseUrl, emailType } = params;
  const unsubscribeUrl = `${appBaseUrl}/unsubscribe.html?token=${unsubscribeToken}`;
  // utm_source is load-bearing, not decoration. /app reads it for the
  // load_routine_from_url event (routineArrivalSource in app/app/RoutineBuilder.tsx)
  // and defaults to "unknown" when absent, so an untagged link here would report
  // every saved-routine email as an unattributed arrival. That default replaced a
  // hardcoded source: 'email' which was reporting Pinterest routine pins as email;
  // this tag is what keeps the email signal after removing it.
  const basketUrl = `${appBaseUrl}/app.html?routine=${routineProductIds.join(",")}&utm_source=email`;

  const headline = emailType === "welcome" ? "Your routine is saved" : "Your routine this month";
  // The monthly intro promised "the best way to restock your routine" two lines above
  // a panel that then said no whole basket exists to compare. A contradiction the
  // reader meets in one pass, on 3 of the 8 active routines. The claim is only true
  // when a whole basket was actually found.
  const intro = emailType === "welcome"
    ? "Thanks for saving your skincare routine. We'll email you each month with the best prices on your routine across UK retailers."
    : result.best?.type === "fallback"
      ? "We've checked prices across the UK retailers we compare. Here's where your routine stands this month."
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

  const isFallback = result.best?.type === "fallback";
  const retailerList = isFallback
    ? "" // the fallback has no winning retailer; naming one would invent a result
    : result.best?.retailers.join(" + ") || "-";
  const totalPrice = result.best?.total.toFixed(2) || "0.00";
  // A fallback basket has deliveryCost 0 because delivery was never costed, not
  // because it is free. Rendering that as "Free delivery" stated something false to
  // the three routines in that state.
  const deliveryText = !result.best
    ? ""
    : isFallback
      ? "Not included, depends where you buy"
      : result.best.deliveryCost === 0
        ? "Free delivery"
        : `Delivery £${result.best.deliveryCost.toFixed(2)}`;
  const totalLabel = isFallback ? "Products total" : "Total";

  // PRODUCTS IN THE ROUTINE THAT NOBODY WE COMPARE HAS IN STOCK.
  //
  // They appear in no option's breakdown, so before this they vanished from the email
  // completely. Routine 26 saved twelve products; four are priceable; the other eight
  // appeared NOWHERE, under a heading that read "Best price basket" and a Total that
  // was not the total of the routine. Softening the sentence over the four would not
  // have helped: a reader who saved twelve and sees four needs to know WHICH eight are
  // missing, and that is more useful than any claim about the four.
  //
  // The builder already knew. app/app/RoutineBuilder.tsx, at the basket_optimised
  // call, carries a NOTE FOR THE DASHBOARD warning that result_type is UNRELIABLE
  // whenever unpriced_item_count > 0, because a basket with untracked items may report
  // "single" while only one retailer's worth of items was ever priceable. That hazard
  // was recorded next to the analytics and never carried across to the copy, so the
  // figure was documented as untrustworthy while the sentence built on it shipped.
  // A hazard recorded in one place and not carried to the other. Item 346.
  const pricedIds = new Set((result.best?.breakdown ?? []).map((b) => b.product.id));
  const unpriced = routineProducts.filter((p) => !pricedIds.has(p.id));

  const unpricedHtml = unpriced.length === 0 ? "" : `
<tr><td style="padding: 24px 32px 0;">
<div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8a8680; font-weight: 600; margin-bottom: 10px;">Not priced this month</div>
<div style="font-size: 13px; color: #6e6a64; margin-bottom: 12px;">${unpriced.length === 1 ? "One product in your routine is" : `${unpriced.length} of the ${routineProducts.length} products in your routine are`} not in stock at any retailer we compare, so ${unpriced.length === 1 ? "it is" : "they are"} not in the prices above.</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
${unpriced.map((prod) => `
  <tr><td style="padding: 10px 0; border-bottom: 1px solid #f0ece4; font-size: 14px; color: #6e6a64;">
    <div style="margin-bottom: 2px;">${escapeHtml(prod.name)}</div>
    <div style="font-size: 12px; color: #8a8680;">Not in stock at any retailer we compare</div>
  </td></tr>`).join("")}
</table></td></tr>`;

  // THE PANEL, ONE BRANCH PER STATE, WORDED FOR A SINGLE READ.
  //
  // The four branches come from the builder (RoutineBuilder.tsx, the qualitative
  // summary), whose comment records why they must stay separate: collapsing them into
  // one sentence is what made the old copy read as an apology. Item 245.
  //
  // REWORDED RATHER THAN COPIED. In the builder the reader has just watched the
  // comparison run, so "The next-best way to buy it costs the same" lands as a result.
  // In an email nothing precedes it: it arrives cold, is read once, often on a phone,
  // and there is no comparison on screen for it to be the result OF. So each branch
  // states what was compared before it states what came of it.
  const optionCount = result.options.length;
  const comparedLine = `We compared ${optionCount} ${optionCount === 1 ? "way" : "ways"} to buy your routine`;

  let panelHtml = "";
  if (!result.best) {
    panelHtml = "";
  } else if (hasMeasuredSaving(result)) {
    panelHtml = `
<tr><td style="padding: 24px 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: rgba(122,158,135,0.12); border: 1px solid rgba(122,158,135,0.3); border-radius: 12px; padding: 18px 22px;">
<tr><td>
<div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #6a7e6f; margin-bottom: 6px;">${escapeHtml(comparedLine)}</div>
<div style="font-family: Georgia, serif; font-size: 32px; font-weight: 600; color: #5a8970; line-height: 1;">£${result.saving.toFixed(2)}</div>
<div style="font-size: 13px; color: #6a7e6f; margin-top: 6px;">cheaper than the next-best of them, delivery included</div>
</td></tr></table></td></tr>`;
  } else if (isFallback) {
    const n = result.best.breakdown.length;
    panelHtml = `
<tr><td style="padding: 24px 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #faf8f4; border: 1px solid #f0ece4; border-radius: 12px; padding: 18px 22px;">
<tr><td>
<div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8a8680; margin-bottom: 6px;">Part of your routine</div>
<div style="font-size: 14px; color: #4a4845; line-height: 1.6;">No single retailer, and no pair of retailers, stocks everything in your routine right now, so there is no whole basket to compare. Below is the cheapest price we found for ${n === 1 ? "the one product" : `the ${n} products`} we could price. Delivery is not included, because it depends which retailers you buy from.</div>
</td></tr></table></td></tr>`;
  } else if (optionCount === 1) {
    const split = result.best.retailers.length > 1;
    panelHtml = `
<tr><td style="padding: 24px 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #faf8f4; border: 1px solid #f0ece4; border-radius: 12px; padding: 18px 22px;">
<tr><td>
<div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8a8680; margin-bottom: 6px;">One way to buy your routine</div>
<div style="font-size: 14px; color: #4a4845; line-height: 1.6;">${split
  ? `Right now only one combination of retailers stocks every product in your routine, so there is nothing to compare it against. Here it is, split across ${result.best.retailers.length} retailers, delivery included.`
  : "Right now only one retailer stocks every product in your routine, so there is nothing to compare it against. Here it is, delivery included."}</div>
</td></tr></table></td></tr>`;
  } else {
    const split = result.best.retailers.length > 1;
    panelHtml = `
<tr><td style="padding: 24px 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #faf8f4; border: 1px solid #f0ece4; border-radius: 12px; padding: 18px 22px;">
<tr><td>
<div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8a8680; margin-bottom: 6px;">${escapeHtml(comparedLine)}</div>
<div style="font-size: 14px; color: #4a4845; line-height: 1.6;">${split
  ? `The cheapest is split across ${result.best.retailers.length} retailers, delivery included. The next-best costs exactly the same, so there is nothing to gain by shopping elsewhere this month.`
  : "The cheapest is a single retailer, delivery included. The next-best costs exactly the same, so there is nothing to gain by shopping elsewhere this month."}</div>
</td></tr></table></td></tr>`;
  }

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
${panelHtml}
<tr><td style="padding: 24px 32px 0;">
${isFallback ? "" : `<div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #c9a96e; font-weight: 600; margin-bottom: 12px;">${result.options.length > 1 ? "The cheapest way to buy it" : "Your routine, delivered"}</div>
<div style="font-family: Georgia, serif; font-size: 18px; font-weight: 600; color: #1c1a18; margin-bottom: 4px;">${escapeHtml(retailerList)}</div>
<div style="font-size: 13px; color: #6e6a64; margin-bottom: 16px;">${result.best.type === "single" ? "Everything from one retailer" : "Split across " + result.best.retailers.length + " retailers"}</div>`}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
${breakdownHtml}
<tr><td style="padding: 14px 0 4px; font-size: 13px; color: #6e6a64;">Delivery</td>
<td style="padding: 14px 0 4px; font-size: 13px; color: #6e6a64; text-align: right;">${deliveryText}</td></tr>
<tr><td style="padding: 14px 0 0; font-size: 16px; font-weight: 600; color: #1c1a18; border-top: 2px solid #1c1a18;">${totalLabel}</td>
<td style="padding: 14px 0 0; font-size: 18px; font-weight: 700; color: #1c1a18; text-align: right; border-top: 2px solid #1c1a18;">£${totalPrice}</td></tr>
</table></td></tr>
${unpricedHtml}
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
<p style="margin: 16px 0 0; font-size: 11px; color: #b0aca4;">© 2026 FindMyBasket. UK beauty price comparison.</p>
</td></tr></table></body></html>`;
}

// =============================================
// PRICE-DROP ALERT EMAIL (new account system)
// =============================================
function buildAlertsSubject(items: AlertItem[]): string {
  if (items.length === 1) {
    const it = items[0];
    const saving = num(it.baseline_price) - num(it.current_price ?? it.alerted_price);
    if (saving > 0) return `A price drop on your routine: save £${saving.toFixed(2)}`;
    return "A price drop on your routine";
  }
  return `${items.length} price drops on your routine`;
}

/**
 * TEMPLATE A: the routine has nothing buyable this month.
 *
 * WHY A SEPARATE TEMPLATE. Falling through to the normal builder renders a "Best
 * available prices" heading over an empty breakdown and a £0 total. A monthly
 * "best price" email containing nothing is worse than not sending, and silence is
 * worse than both: it loses a subscriber without telling them anything. A true
 * message keeps the subscriber and the trust.
 *
 * FOUR DELIBERATE CHOICES, kept when this was approved 3 August 2026:
 *   1. NAME THE PRODUCTS. A generic "nothing found" is nearly as bad as an empty email.
 *   2. SAY WHO WE CHECKED. "at any retailer we compare", never "anywhere" and never a
 *      whole-market claim. Same house rule as the site (convention 12).
 *   3. DISTINGUISH OUT OF STOCK FROM DELISTED. A user reading "not available" will
 *      otherwise assume the product is gone for good.
 *   4. PROMISE ONLY WHAT THE SYSTEM DOES. It genuinely will report a price next month
 *      if stock returns. No alert is promised, because no alert exists.
 *
 * NO EM DASHES. Guarded by lib/__tests__/email-copy.test.ts.
 */
function buildEmptyRoutineEmailHTML(params: {
  products: Product[]; unsubscribeToken: string; appBaseUrl: string;
}): string {
  const { products, unsubscribeToken, appBaseUrl } = params;
  const unsubscribeUrl = `${appBaseUrl}/unsubscribe.html?token=${unsubscribeToken}`;
  const basketUrl = `${appBaseUrl}/app.html?routine=${products.map((p) => p.id).join(",")}&utm_source=email`;

  const rows = products.map((p) => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #f0ece4;">
      <div style="font-size:15px;color:#1C1A18;font-weight:500;">${escapeHtml(p.brand ? p.brand + " " + p.name : p.name)}</div>
      <div style="font-size:13px;color:#8a8680;margin-top:3px;">Not currently in stock at any retailer we compare.</div>
    </td></tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#faf8f4;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1c1a18;">
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:40px 20px;"><tr><td align="center">
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:24px 28px 20px;border-bottom:1px solid #f0ece4;">
    <div style="font-family:Georgia,serif;font-size:18px;font-weight:600;">Find<span style="color:#c9a96e;">My</span>Basket</div>
  </td></tr>
  <tr><td style="padding:28px;">
    <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:22px;color:#1c1a18;">Still watching for stock</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4a4845;">
      We could not find your routine in stock at any of our retailers this month.
    </p>
    <table cellspacing="0" cellpadding="0" border="0" width="100%">${rows}</table>
    <p style="margin:22px 0 0;font-size:15px;line-height:1.6;color:#4a4845;">
      We are still watching it. As soon as it is back in stock at any of our retailers,
      your next monthly email will show the best price, delivered.
    </p>
    <p style="margin:14px 0 24px;font-size:14px;line-height:1.6;color:#6e6a64;">
      This is not a price rise or a delisting. It means the retailers we compare are not
      currently listing it.
    </p>
    <a href="${basketUrl}" style="display:inline-block;background:#1c1a18;color:#faf8f4;padding:13px 28px;border-radius:100px;font-size:14px;font-weight:500;text-decoration:none;">Update my routine</a>
  </td></tr>
  <tr><td style="padding:16px 28px;background:#faf8f4;border-top:1px solid #f0ece4;font-size:11px;color:#8a8680;">
    <a href="${unsubscribeUrl}" style="color:#8a8680;">Unsubscribe</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildAlertsEmailHTML(params: {
  items: AlertItem[];
  unsubscribeToken: string;
  appBaseUrl: string;
}): string {
  const { items, unsubscribeToken, appBaseUrl } = params;
  const unsubscribeUrl = `${appBaseUrl}/unsubscribe-alerts.html?token=${unsubscribeToken}`;
  const accountUrl = `${appBaseUrl}/account`;

  const totalSaving = items.reduce(
    (sum, it) => sum + Math.max(0, num(it.baseline_price) - num(it.current_price ?? it.alerted_price)),
    0,
  );

  const rowsHtml = items.map((it) => {
    const was = num(it.baseline_price);
    const now = num(it.current_price ?? it.alerted_price);
    const saving = Math.max(0, was - now);
    const pct = was > 0 ? Math.round((saving / was) * 100) : 0;
    const productUrl = `${appBaseUrl}${it.url}`;
    const retailer = it.retailer ? escapeHtml(it.retailer) : "an online retailer";
    const title = `${it.brand ? escapeHtml(it.brand) + " - " : ""}${escapeHtml(it.name)}`;
    const img = it.image_url
      ? `<img src="${escapeHtml(it.image_url)}" alt="" width="56" height="56" style="width:56px;height:56px;border-radius:8px;object-fit:cover;display:block;"/>`
      : `<div style="width:56px;height:56px;border-radius:8px;background:#f0ece4;"></div>`;
    return `
      <tr>
        <td style="padding: 14px 0; border-bottom: 1px solid #e5e0d8; vertical-align: top; width: 56px;">${img}</td>
        <td style="padding: 14px 0 14px 14px; border-bottom: 1px solid #e5e0d8; vertical-align: top;">
          <a href="${productUrl}" style="font-size: 14px; font-weight: 500; color: #1c1a18; text-decoration: none; line-height: 1.35;">${title}</a>
          <div style="margin-top: 4px; font-size: 13px; color: #6e6a64;">
            <span style="color:#8a8680;text-decoration:line-through;">£${was.toFixed(2)}</span>
            &nbsp;<span style="color:#5a8970;font-weight:600;">£${now.toFixed(2)}</span>
            &nbsp;at ${retailer}
          </div>
        </td>
        <td style="padding: 14px 0; border-bottom: 1px solid #e5e0d8; vertical-align: top; text-align: right; white-space: nowrap;">
          <span style="display:inline-block;background:rgba(122,158,135,0.14);color:#5a8970;font-size:12px;font-weight:600;padding:4px 10px;border-radius:100px;">−${pct}%</span>
        </td>
      </tr>`;
  }).join("");

  const headline = items.length === 1 ? "A price on your routine just dropped" : "Prices on your routine just dropped";

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
<p style="margin: 0; font-size: 15px; line-height: 1.6; color: #4a4845;">We track the best price at any retailer we compare for the products in your routine. Here${items.length === 1 ? "'s the one that" : " are the ones that"} just got cheaper.</p>
</td></tr>
${totalSaving > 0 ? `
<tr><td style="padding: 24px 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: rgba(122,158,135,0.12); border: 1px solid rgba(122,158,135,0.3); border-radius: 12px; padding: 18px 22px;">
<tr><td>
<div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #6a7e6f; margin-bottom: 6px;">Total drop since you saved ${items.length === 1 ? "it" : "them"}</div>
<div style="font-family: Georgia, serif; font-size: 32px; font-weight: 600; color: #5a8970; line-height: 1;">£${totalSaving.toFixed(2)}</div>
</td></tr></table></td></tr>` : ""}
<tr><td style="padding: 24px 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
${rowsHtml}
</table></td></tr>
<tr><td style="padding: 28px 32px 24px;" align="center">
<a href="${accountUrl}" style="display: inline-block; background: #1c1a18; color: #faf8f4; padding: 16px 36px; border-radius: 100px; text-decoration: none; font-size: 15px; font-weight: 600;">View my routine →</a>
<p style="margin: 14px 0 0; font-size: 12px; color: #8a8680;">Prices are checked at the time of sending and may vary.</p>
</td></tr>
<tr><td style="padding: 24px 32px; background: #faf8f4; border-top: 1px solid #f0ece4;">
<p style="margin: 0 0 12px; font-size: 12px; color: #8a8680; line-height: 1.6;">You're receiving this because you turned on price-drop alerts for your saved routine on FindMyBasket.</p>
<p style="margin: 0; font-size: 12px; color: #8a8680;">
<a href="${unsubscribeUrl}" style="color: #8a8680; text-decoration: underline;">Turn off price alerts</a> ·
<a href="${accountUrl}" style="color: #8a8680; text-decoration: underline;">Manage in your account</a> ·
<a href="mailto:hello@findmybasket.co.uk" style="color: #8a8680; text-decoration: underline;">Contact</a>
</p></td></tr>
</table>
<p style="margin: 16px 0 0; font-size: 11px; color: #b0aca4;">© 2026 FindMyBasket. UK beauty price comparison.</p>
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
  outcome: string | null = null,
): Promise<string | null> {
  // RETURNS AN ERROR STRING RATHER THAN SWALLOWING. Changed 3 August 2026.
  //
  // This used to `catch (_) {}` with the comment "observability must not affect
  // sending". The intent was right and the implementation was the silent-kill shape:
  // a schema mismatch here does not raise, it just stops writing rows, and an empty
  // log looks exactly like an absence of events. That is strictly worse than throwing,
  // because nothing distinguishes "no emails were sent" from "logging broke".
  //
  // It nearly happened: adding `outcome` before the column existed would have silently
  // ended all send logging. supabase-js reports the failure as an `error` FIELD too
  // (convention 10), so even without the try/catch a destructure that ignores `error`
  // would have been silent.
  //
  // The rule now: still never throw, still never fail a send, but SURFACE. The caller
  // pushes the returned string onto the errors array in the function's response, where
  // the operator sees it. Sending is unaffected; silence is not an option.
  //
  // `outcome` records WHAT THE EMAIL CONTAINED, orthogonal to `mode` (why it sent) and
  // `ok` (whether Resend accepted it). Template B's three-empty-months rule is derived
  // by reading the last three rows via fmb_routine_empty_streak(), not by a counter,
  // so the rule stays inspectable.
  try {
    const { error: logErr } = await supabase.from("routine_email_log").insert({
      routine_id: routine.id,
      email: routine.email,
      mode,
      ok,
      outcome,
      resend_message_id: resendMessageId,
      error: error ? String(error).slice(0, 500) : null,
    });
    if (logErr) return `routine_email_log insert failed for routine ${routine.id}: ${logErr.message}`;
    return null;
  } catch (e) {
    return `routine_email_log insert threw for routine ${routine.id}: ${String(e)}`;
  }
}

// Per-user alert-send log line. routine_id is null here (alerts are keyed on
// user, not on a saved_routines row). Best-effort — logging never fails a send.
async function logAlertSend(
  supabase: ReturnType<typeof createClient>,
  row: AlertBatchRow,
  ok: boolean,
  resendMessageId: string | null,
  error: string | null,
): Promise<string | null> {
  // Same treatment as logSend: never throw, never fail a send, but SURFACE rather than
  // swallow. Fixed alongside logSend on 3 August 2026 because it is the same defect in
  // the same file, and fixing only the one that had just bitten would be exactly the
  // instance-not-class mistake recorded as convention 13.
  try {
    const { error: logErr } = await supabase.from("routine_email_log").insert({
      routine_id: null,
      email: row.email,
      mode: "alerts",
      ok,
      // Alerts are price-drop notifications, not basket emails, so there is no basket
      // to be empty. outcome stays NULL rather than being forced into a vocabulary
      // that does not describe them.
      resend_message_id: resendMessageId,
      error: error ? String(error).slice(0, 500) : null,
    });
    if (logErr) return `routine_email_log insert failed for alert to ${row.email}: ${logErr.message}`;
    return null;
  } catch (e) {
    return `routine_email_log insert threw for alert to ${row.email}: ${String(e)}`;
  }
}

// =============================================
// ALERTS PASS (new account system)
// =============================================
// Structurally distinct from the per-routine welcome/monthly path: the queue is
// per-user and each row carries the alert_ids to stamp delivered. The queue has
// already filtered to consenting users, undelivered alerts, and still-live deals,
// so we do not re-check eligibility here — render, send, mark delivered.
async function sendAlerts(
  supabase: ReturnType<typeof createClient>,
  resendKey: string,
  appBaseUrl: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const { data, error } = await supabase.rpc("fmb_pending_alert_batch", { p_limit: 500 });
  if (error) return jsonResponse({ error: error.message }, 500, corsHeaders);
  const batch = (data || []) as AlertBatchRow[];

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of batch) {
    try {
      const items = Array.isArray(row.alerts) ? row.alerts : [];
      if (items.length === 0) continue;

      const html = buildAlertsEmailHTML({ items, unsubscribeToken: row.unsubscribe_token, appBaseUrl });
      const subject = buildAlertsSubject(items);

      const resendRes = await fetch(RESEND_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM_ADDRESS, to: row.email, subject, html }),
      });

      if (!resendRes.ok) {
        const errText = await resendRes.text();
        failed++; errors.push(`User ${row.user_id} (${row.email}): Resend ${resendRes.status} — ${errText}`);
        { const le = await logAlertSend(supabase, row, false, null, `Resend ${resendRes.status}: ${errText}`); if (le) errors.push(le); }
        continue;
      }

      let resendMessageId: string | null = null;
      try {
        const body = await resendRes.json();
        resendMessageId = (body && typeof body.id === "string") ? body.id : null;
      } catch (_) {
        resendMessageId = null;
      }

      // Stamp delivered ONLY after a confirmed 2xx send, so a failed send leaves
      // the alerts undelivered and they re-enter the next run's batch.
      const { error: markErr } = await supabase.rpc("fmb_mark_alerts_delivered", { p_alert_ids: row.alert_ids });
      if (markErr) {
        // The email went out; failing to stamp would re-send next run. Make it loud.
        console.error(`fmb_mark_alerts_delivered failed for user ${row.user_id}:`, markErr.message);
        errors.push(`User ${row.user_id}: sent but mark-delivered failed — ${markErr.message}`);
      }
      { const le = await logAlertSend(supabase, row, true, resendMessageId, markErr ? `mark-delivered failed: ${markErr.message}` : null); if (le) errors.push(le); }
      sent++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failed++; errors.push(`User ${row.user_id}: ${message}`);
      { const le = await logAlertSend(supabase, row, false, null, message); if (le) errors.push(le); }
    }
  }

  // Housekeeping in the same pass: stamp alerts whose deal has since died so the
  // queue doesn't silt up with rows that will never be deliverable. Best-effort.
  let expired = 0;
  const { data: exp, error: expErr } = await supabase.rpc("fmb_expire_stale_alerts");
  if (expErr) console.error("fmb_expire_stale_alerts failed:", expErr.message);
  else expired = typeof exp === "number" ? exp : 0;

  if (failed > 0) {
    console.error(`send-routine-email[alerts]: ${failed} failed / ${batch.length} users`, errors.slice(0, 10));
  }

  return jsonResponse(
    { mode: "alerts", users: batch.length, sent, failed, expired, errors: errors.slice(0, 10) },
    200,
    corsHeaders,
  );
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

  // Caller gate — after the preflight early-return. This function sends real
  // email to real users, so an ungated version let any visitor with the public
  // anon key mail our list. Both callers authenticate from the vault copy of
  // service_role_key, verified 2026-07-21 to equal the live service-role key:
  //   - cron send-monthly-routines  -> ?mode=monthly
  //   - trigger_welcome_email       -> ?mode=welcome, AFTER INSERT on saved_routines
  // That trigger is invisible to a repo grep, which is why it is named here.
  const denied = requireServiceRole(req, corsHeaders);
  if (denied) return denied;

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

    // Price-drop alerts run their own per-user batch and return here — they do
    // not use the per-routine SavedRoutine path below.
    if (mode === "alerts") {
      return await sendAlerts(supabase, resendKey, appBaseUrl, corsHeaders);
    }

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
          .select("product_id, retailer_id, price, url, in_stock, retailers!inner(name, delivery_model, delivery_threshold, delivery_cost, active)")
          .in("product_id", productIds).eq("in_stock", true).eq("retailers.active", true);
        if (priceError) throw priceError;
        const prices = (pricesData || []) as unknown as PriceRow[];

        const result = optimiseBasket(products, prices);

        // EMPTY ROUTINE. The optimiser found nothing buyable: every product in this
        // routine is out of stock at every active retailer. Without this branch the
        // email renders a "Best available prices" heading over an empty breakdown and
        // a £0 total, which is worse than not sending. See work-list item 30.
        //
        // It is NOT an error and NOT a defect. Routine 37's only offer was a Boots row
        // last confirmed 11 May, flipped out by the absence step-down on 3 Aug 2026.
        // Before that flip the user was emailed a May price presented as current,
        // which was worse. The step-down made a pre-existing emptiness visible.
        const isEmpty = !result.best || result.best.breakdown.length === 0;

        const html = isEmpty
          ? buildEmptyRoutineEmailHTML({
              products, unsubscribeToken: routine.unsubscribe_token, appBaseUrl,
            })
          : buildEmailHTML({
              result, unsubscribeToken: routine.unsubscribe_token,
              routineProductIds: productIds, routineProducts: products, appBaseUrl,
              emailType: mode === "welcome" ? "welcome" : "monthly",
            });
        const subject = isEmpty
          ? "Your routine: still watching for stock"
          : buildEmailSubject(result, mode === "welcome" ? "welcome" : "monthly");

        const resendRes = await fetch(RESEND_API, {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: FROM_ADDRESS, to: routine.email, subject, html }),
        });

        if (!resendRes.ok) {
          const errText = await resendRes.text();
          failed++; errors.push(`Routine ${routine.id} (${routine.email}): Resend ${resendRes.status} — ${errText}`);
          { const le = await logSend(supabase, routine, mode, false, null, `Resend ${resendRes.status}: ${errText}`, isEmpty ? "empty" : "priced"); if (le) errors.push(le); }
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
        { const le = await logSend(supabase, routine, mode, true, resendMessageId, null, isEmpty ? "empty" : "priced"); if (le) errors.push(le); }
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
