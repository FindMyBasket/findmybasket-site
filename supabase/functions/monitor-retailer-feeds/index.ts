// FindMyBasket — monitor-retailer-feeds edge function
//
// Three complementary alerting mechanisms, one daily email:
//   1. Import failures (FAST): any retailer whose most recent import attempt
//      failed (retailer_import_config.last_import_status = 'error'), OR is stuck
//      mid-run (status = 'running' for longer than RUNNING_STUCK_HOURS — the
//      fingerprint of a hard kill / OOM that died before writing its outcome).
//      Surfaced immediately with the root-cause error message — no waiting for
//      staleness. Populated by import-awin-feed / import-rakuten-feed /
//      import-shopify-feed.
//   2. Stale feeds (BACKSTOP): any active retailer whose newest
//      retailer_prices.last_updated is older than STALENESS_HOURS. Catches
//      failure modes the importers can't self-report (cron not firing, etc.).
//
// Scheduled daily via pg_cron at 09:00 UTC.
//
// Required env vars (already set from send-routine-email):
//   RESEND_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API = "https://api.resend.com/emails";
const FROM_ADDRESS = "FindMyBasket Alerts <hello@findmybasket.co.uk>";
const TO_ADDRESS = "hello@findmybasket.co.uk";
// Lowered 48 → 36 (§7) so a single missed daily run alerts the next morning,
// instead of tolerating two consecutive misses before surfacing.
const STALENESS_HOURS = 36;
// A real apply stamps last_import_status='running' before any work and clears it
// to 'ok'/'error' on completion. A hard worker kill (HTTP 546 OOM) terminates the
// process before that final write, stranding the row at 'running'. Any retailer
// left 'running' longer than this is treated as a crashed/hung import — well past
// the longest legitimate run (minutes) yet inside the daily attempt gap, so it is
// caught before the next day's run overwrites the stamp.
const RUNNING_STUCK_HOURS = 6;

interface RetailerStatus {
  retailer_id: number;
  retailer_name: string;
  last_updated: string | null;
  hours_stale: number | null;
  row_count: number;
}

interface ImportFailure {
  retailer_id: number;
  retailer_name: string;
  last_import_error: string | null;
  last_attempt_at: string | null;
  hours_since_attempt: number | null;
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !serviceKey || !resendKey) {
      return new Response(JSON.stringify({ error: "Missing env vars" }), { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // 0. Maintenance (Phase 4 sliced import): purge orphaned import_run_state. A
    //    healthy sliced run deletes its own state at finalize; a run that died
    //    mid-chain leaves rows + staging files behind. Anything older than 24h is
    //    well past the longest legitimate sliced import, so reap it (state rows +
    //    the matching Storage slice files) to stop the table/bucket accumulating.
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: orphanRuns } = await supabase
        .from("import_run_state").select("run_id").eq("kind", "meta").lt("created_at", cutoff);
      const runIds = [...new Set((orphanRuns ?? []).map((r: { run_id: string }) => r.run_id))];
      for (const rid of runIds) {
        try {
          const { data: files } = await supabase.storage.from("import-staging").list(rid);
          if (files?.length) await supabase.storage.from("import-staging").remove(files.map((f) => `${rid}/${f.name}`));
        } catch { /* best effort */ }
      }
      const { error: delErr } = await supabase.from("import_run_state").delete().lt("created_at", cutoff);
      if (delErr) console.warn("import_run_state cleanup failed:", delErr.message);
      else if (runIds.length) console.log(`import_run_state cleanup: purged ${runIds.length} orphaned sliced run(s)`);
    } catch (e) { console.warn("import_run_state cleanup error:", String(e)); }

    // 1. Get all active retailers
    const { data: retailers, error: rErr } = await supabase
      .from("retailers")
      .select("id, name")
      .eq("active", true)
      .order("id");

    if (rErr || !retailers) {
      return new Response(JSON.stringify({ error: "Failed to load retailers", details: rErr }), { status: 500 });
    }

    const nameById = new Map<number, string>();
    for (const r of retailers) nameById.set(r.id, r.name);

    const now = Date.now();

    // 2. Import failures (fast signal). Read the per-retailer import status
    //    recorded by the importers. Only flag active retailers.
    const { data: configRows } = await supabase
      .from("retailer_import_config")
      .select("retailer_id, last_import_status, last_import_error, last_attempt_at, enabled");

    const hoursSince = (ts: string | null): number | null =>
      ts ? (now - new Date(ts).getTime()) / (1000 * 60 * 60) : null;

    // 2a. Most recent attempt explicitly failed.
    const errorFailures: ImportFailure[] = (configRows ?? [])
      .filter((c) => c.last_import_status === "error" && nameById.has(c.retailer_id))
      .map((c) => ({
        retailer_id: c.retailer_id,
        retailer_name: nameById.get(c.retailer_id) ?? `#${c.retailer_id}`,
        last_import_error: c.last_import_error ?? null,
        last_attempt_at: c.last_attempt_at ?? null,
        hours_since_attempt: hoursSince(c.last_attempt_at ?? null),
      }));

    // 2b. Stuck mid-run: status never cleared past 'running'. This is the silent
    //     hard-kill case — the row keeps no 'error', and last_updated may still be
    //     fresh from the previous good run, so neither 2a nor the staleness check
    //     would catch it. Synthesise a failure with a clear cause.
    const stuckRunning: ImportFailure[] = (configRows ?? [])
      .filter((c) => {
        if (c.last_import_status !== "running" || !nameById.has(c.retailer_id)) return false;
        const h = hoursSince(c.last_attempt_at ?? null);
        return h !== null && h > RUNNING_STUCK_HOURS;
      })
      .map((c) => {
        const h = hoursSince(c.last_attempt_at ?? null);
        return {
          retailer_id: c.retailer_id,
          retailer_name: nameById.get(c.retailer_id) ?? `#${c.retailer_id}`,
          last_import_error:
            `Import started but never completed — stuck in 'running' for ${h === null ? "?" : Math.round(h)}h. ` +
            `Likely a hard kill / OOM (HTTP 546) that died before recording its outcome.`,
          last_attempt_at: c.last_attempt_at ?? null,
          hours_since_attempt: h,
        };
      });

    const failures: ImportFailure[] = [...errorFailures, ...stuckRunning]
      .sort((a, b) => a.retailer_name.localeCompare(b.retailer_name));

    const failedIds = new Set(failures.map((f) => f.retailer_id));

    // 3. For each retailer, find the most recent retailer_prices.last_updated
    const statuses: RetailerStatus[] = [];

    for (const r of retailers) {
      const { data: latest } = await supabase
        .from("retailer_prices")
        .select("last_updated")
        .eq("retailer_id", r.id)
        .order("last_updated", { ascending: false })
        .limit(1);

      const { count } = await supabase
        .from("retailer_prices")
        .select("*", { count: "exact", head: true })
        .eq("retailer_id", r.id);

      const lastUpdated = latest && latest.length > 0 ? latest[0].last_updated : null;
      const hoursStale = lastUpdated
        ? (now - new Date(lastUpdated).getTime()) / (1000 * 60 * 60)
        : null;

      statuses.push({
        retailer_id: r.id,
        retailer_name: r.name,
        last_updated: lastUpdated,
        hours_stale: hoursStale,
        row_count: count ?? 0,
      });
    }

    // 4. Determine which are stale. Exclude retailers already listed as a failure
    //    (the failure section gives the root cause — no need to double-report).
    const stale = statuses.filter(
      (s) => (s.hours_stale === null || s.hours_stale > STALENESS_HOURS) && !failedIds.has(s.retailer_id),
    );

    if (failures.length === 0 && stale.length === 0) {
      // Everything healthy — no email, just return status
      return new Response(
        JSON.stringify({
          status: "all_healthy",
          checked: statuses.length,
          statuses,
        }, null, 2),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // 5. Build alert email
    const problemCount = failures.length + stale.length;
    const subjectParts: string[] = [];
    if (failures.length > 0) subjectParts.push(`${failures.length} import failure${failures.length === 1 ? "" : "s"}`);
    if (stale.length > 0) subjectParts.push(`${stale.length} stale`);
    const subject = `FindMyBasket: ${subjectParts.join(", ")}`;

    const failureRows = failures.map((f) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px; vertical-align: top;">
          <strong>${escapeHtml(f.retailer_name)}</strong>
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 13px; color: #c0392b;">
          ${escapeHtml(f.last_import_error || "(no error message recorded)")}
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px; text-align: right; white-space: nowrap;">
          ${f.hours_since_attempt === null ? "—" : Math.round(f.hours_since_attempt) + "h ago"}
        </td>
      </tr>`).join("");

    const staleRows = stale.map((s) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px;">
          <strong>${escapeHtml(s.retailer_name)}</strong>
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px; text-align: right; color: #c0392b;">
          ${s.hours_stale === null ? "Never" : Math.round(s.hours_stale) + "h ago"}
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px; text-align: right;">
          ${s.row_count} rows
        </td>
      </tr>`).join("");

    const healthyRows = statuses
      .filter((s) => !stale.includes(s) && !failedIds.has(s.retailer_id))
      .map((s) => `
        <tr>
          <td style="padding: 8px 10px; font-size: 13px; color: #6e6a64;">
            ${escapeHtml(s.retailer_name)}
          </td>
          <td style="padding: 8px 10px; font-size: 13px; color: #6a7e6f; text-align: right;">
            ${s.hours_stale === null ? "—" : Math.round(s.hours_stale) + "h ago"}
          </td>
          <td style="padding: 8px 10px; font-size: 13px; color: #6e6a64; text-align: right;">
            ${s.row_count} rows
          </td>
        </tr>`).join("");

    const failureSection = failures.length > 0 ? `
<h1 style="margin: 0 0 8px; font-family: Georgia, serif; font-size: 22px; color: #c0392b;">
${failures.length} import failure${failures.length === 1 ? "" : "s"}
</h1>
<p style="margin: 0 0 20px; font-size: 14px; color: #4a4845;">
The following retailer import${failures.length === 1 ? "" : "s"} failed on the most recent attempt. The error is reported by the importer itself — check it before the feed goes stale.
</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top: 1px solid #e5e0d8; margin-bottom: 28px;">
<thead><tr>
<th style="padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Retailer</th>
<th style="padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Error</th>
<th style="padding: 10px; text-align: right; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Attempt</th>
</tr></thead>
<tbody>${failureRows}</tbody>
</table>` : "";

    const staleSection = stale.length > 0 ? `
<h1 style="margin: 0 0 8px; font-family: Georgia, serif; font-size: 22px; color: #c0392b;">
${stale.length} feed${stale.length === 1 ? "" : "s"} stale
</h1>
<p style="margin: 0 0 20px; font-size: 14px; color: #4a4845;">
The following retailer feed${stale.length === 1 ? " hasn't" : "s haven't"} refreshed in over ${STALENESS_HOURS} hours, with no import error recorded.
Check GitHub Actions and Supabase Edge Function logs.
</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top: 1px solid #e5e0d8; margin-bottom: 24px;">
<thead><tr>
<th style="padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Stale retailer</th>
<th style="padding: 10px; text-align: right; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Last update</th>
<th style="padding: 10px; text-align: right; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Rows</th>
</tr></thead>
<tbody>${staleRows}</tbody>
</table>` : "";

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin: 0; padding: 0; background: #faf8f4; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #1c1a18;">
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="padding: 40px 20px;">
<tr><td align="center">
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background: #ffffff; border-radius: 12px; overflow: hidden;">
<tr><td style="padding: 24px 28px 20px; border-bottom: 1px solid #f0ece4;">
<div style="font-family: Georgia, serif; font-size: 18px; font-weight: 600;">
Find<span style="color: #c9a96e;">My</span>Basket — Feed Monitor</div>
</td></tr>
<tr><td style="padding: 24px 28px;">
${failureSection}
${staleSection}
${healthyRows ? `
<div style="font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em; margin-bottom: 8px;">Healthy</div>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #faf8f4; border-radius: 8px;">
<tbody>${healthyRows}</tbody>
</table>
` : ""}
</td></tr>
<tr><td style="padding: 16px 28px; background: #faf8f4; border-top: 1px solid #f0ece4; font-size: 11px; color: #8a8680;">
Automated monitor. Runs daily at 09:00 UTC. Staleness threshold: ${STALENESS_HOURS}h.
</td></tr>
</table>
</td></tr></table>
</body></html>`;

    const resendRes = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: TO_ADDRESS,
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return new Response(
        JSON.stringify({
          status: "email_failed",
          resend_status: resendRes.status,
          resend_error: errText,
          import_failures: failures.map((f) => f.retailer_name),
          stale_retailers: stale.map((s) => s.retailer_name),
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        status: "alert_sent",
        problem_count: problemCount,
        import_failures: failures.map((f) => ({ retailer: f.retailer_name, error: f.last_import_error })),
        stale_retailers: stale.map((s) => s.retailer_name),
        statuses,
      }, null, 2),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
