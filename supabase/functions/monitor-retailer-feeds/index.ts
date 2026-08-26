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
// ── DEPLOYING THIS FILE ─────────────────────────────────────────────────────────────
// Use the `Deploy an edge function` workflow, which deploys FROM THIS REPOSITORY.
// DO NOT deploy by pasting the file's content: on 19 August 2026 that path overwrote this
// function with the literal string "PLACEHOLDER" in production, and the obvious repair --
// re-typing 554 lines -- would have risked a silent transcription error in live code, which
// is worse than the outage. Work-list items 217 and 218: never retype what a tool can move.
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

interface HeldImport {
  retailer_id: number;
  finding_key: string;
  summary: string | null;
  unblocks_when: string | null;
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

  // DRY RUN. Added 26 Aug 2026 because there was no way to see this email except to
  // receive it: the function computed and sent in one pass, so the only verification
  // available was to wait for 09:00 and read the result. Rendering the artefact is the
  // standard applied to send-routine-email; the same standard needs the same affordance.
  // ?dry_run=1 returns the subject, the sections that would render, and the full HTML,
  // and sends nothing.
  const _url = new URL(req.url);
  const dryRun = _url.searchParams.get("dry_run") === "1";
  // DRY-RUN ONLY threshold override, so the email for a state that has not arrived yet can
  // be rendered before it does. Guarded on dryRun so a real 09:00 run can never be given a
  // different threshold by a query string. Without this the held section below could only
  // be verified by waiting for the retailer to cross 36h -- which is the thing the dry run
  // exists to avoid.
  const staleHours = dryRun
    ? Number(_url.searchParams.get("staleness_hours") ?? STALENESS_HOURS)
    : STALENESS_HOURS;

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

    // 1b. HELD IMPORTS. Retailers deliberately not importing, for a recorded reason.
    //     Read from fmb_held_imports, which derives from standing_check_findings; there
    //     is no hold flag on retailer_import_config and there should not be one, because
    //     the reason already lives in the findings and carries more than a flag could.
    //     Item 352.
    const { data: heldRows } = await supabase
      .from("fmb_held_imports")
      .select("retailer_id, finding_key, summary, unblocks_when");
    const heldById = new Map<number, HeldImport>();
    for (const h of (heldRows ?? []) as HeldImport[]) heldById.set(h.retailer_id, h);

    // 1a. ORPHAN GATE PROVENANCE.
    //
    // middleware.ts fails CLOSED to a build-time constant when Edge Config cannot be
    // read, so an outage no longer silently un-410s the catalogue. But the fallback is
    // invisible from the outside unless something looks: `x-fmb-gate-source` reports
    // whether the value came from Edge Config or from the constant, and until now it
    // was a distinguishable state with no consumer -- the same shape as
    // retailers_delivery_unknown, which sat correct and unread for seven days.
    //
    // WHAT THIS ALERTS ON, AND WHAT IT DELIBERATELY DOES NOT.
    //   ALERT   source starts with `default-`. Edge Config did not answer. That is
    //           unambiguously wrong whatever the intended gate state is, because the
    //           switch is not currently switching anything.
    //   REPORT  everything else, WITHOUT judging it. `inert` versus `gone` depends on
    //           whether the removal is *meant* to be on, and THIS FUNCTION HAS NO SOURCE
    //           FOR THAT INTENT. Reading GATE_DEFAULT from Postgres to make the check
    //           symmetrical would put a second copy of the constant somewhere it can
    //           drift from the first, which is the duplication class this codebase
    //           already carries several instances of. A monitor that invents an
    //           expectation reports on its own copy, not on the system.
    //
    // The probe id is a KNOWN-GONE id: the one request whose expected outcome is
    // unambiguous, which is what makes it probeable at all. If it ever stops being gone
    // that is reported as its own state rather than treated as a failure.
    const GATE_PROBE_ID = 650;
    const GATE_PROBE_URL = `https://www.findmybasket.co.uk/product/${GATE_PROBE_ID}`;
    let gateOutcome = "(not probed)";
    let gateSource = "(not probed)";
    let gateProbeError: string | null = null;
    try {
      const gr = await fetch(GATE_PROBE_URL, { method: "HEAD", redirect: "manual" });
      gateOutcome = gr.headers.get("x-fmb-superdrug-gate") ?? `(header absent, HTTP ${gr.status})`;
      gateSource = gr.headers.get("x-fmb-gate-source") ?? "(header absent)";
    } catch (e) {
      gateProbeError = String(e);
    }
    // A failed probe is NOT a gate failure and must not be reported as one -- it is this
    // check being unable to see, which is a different claim.
    const gateFellBack = gateSource.startsWith("default-");

    // 1b. ACTIVE RETAILERS WITH UNRECORDED DELIVERY TERMS.
    //
    // The view `retailers_delivery_unknown` was created on 3 August 2026
    // (migration 20260803160000) for exactly this case, and its own comment says a row
    // in it is "live inventory being quietly excluded from best-value comparison". It
    // was built to be read by THIS function and was never wired to it. Niche Beauty
    // went live on 9 August at delivery_model='unknown' and sat in the view, correct
    // and unread, for seven days.
    //
    // A DETECTOR NOTHING READS IS MORE EXPENSIVE THAN NO DETECTOR, because it also
    // consumes the belief that the case is covered. Work-list item 131.
    const { data: deliveryUnknownRows, error: duErr } = await supabase
      .from("retailers_delivery_unknown")
      .select("retailer_id, name, delivery_model, days_since_terms_observed")
      .order("retailer_id");
    // Read failure must not be silent: an empty result and a broken query look identical
    // downstream, and "no rows" is the healthy state this section reports.
    if (duErr) console.error("retailers_delivery_unknown read failed:", duErr);
    const deliveryUnknown = deliveryUnknownRows ?? [];

    // ── STANDING CHECK FINDINGS. Added 19 August — work-list item 194. ──────────────
    //
    // Findings from detectors that no longer fail CI on a finding (currently
    // secret-divergence). The detector reds only on cannot-run or escalation; the finding
    // itself arrives here, in an email a human already reads.
    //
    // THIS IS PART OF THE SEND CONDITION, NOT JUST THE BODY, for exactly the reason the
    // deliveryUnknown comment above already states:
    //
    //   "leaving it out of this test would reproduce the original defect one layer up:
    //    detected, formatted, and never sent."
    //
    // A REPORTER SECTION IN AN EMAIL THAT DOES NOT SEND IS A REPORTER NOBODY READS, which
    // is item 194's own failure mode one layer along. The whole point of moving findings
    // off the red tick was that nobody was reading the red tick.
    const { data: checkFindingRows, error: cfErr } = await supabase
      .from("standing_check_findings")
      .select("check_name, finding_key, summary, report_count, first_seen, kind")
      .eq("status", "open")
      .order("report_count", { ascending: false });
    // Same rule as above: an empty result and a broken query look identical downstream.
    if (cfErr) console.error("standing_check_findings read failed:", cfErr);
    const allCheckRows = checkFindingRows ?? [];

    // FINDINGS trigger a send and escalate. COVERAGE does neither.
    //
    // A coverage row states a stable population a check cannot speak for -- one line, not per
    // row. It is PRINTED because silence would read identically to "nothing is out of scope",
    // and those are different facts (the same asserted-zero reasoning as delivery_unknown: 0).
    //
    // It must NOT cause a send, or the monitor emails every day to report a number that has not
    // changed -- which is exactly the noise item 194 exists to prevent, arriving through item
    // 194's own mechanism. IF THE COUNT MOVES, THE CHECK WRITES A kind='finding' ROW; the stable
    // value is coverage, the delta is a finding.
    //
    // Same shape as gateSection below: rendered whenever an email is going out anyway.
    const checkFindings = allCheckRows.filter((f) => f.kind !== "coverage");
    const checkCoverage = allCheckRows.filter((f) => f.kind === "coverage");

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
    const staleAll = statuses.filter(
      (s) => (s.hours_stale === null || s.hours_stale > staleHours) && !failedIds.has(s.retailer_id),
    );

    // 4a. HELD RETAILERS GET THEIR OWN SECTION. THEY ARE NOT SUPPRESSED.
    //
    // THE HEADING IS THE DEFECT THIS FIXES. The stale section reads "haven't refreshed in
    // over 36 hours, WITH NO IMPORT ERROR RECORDED". That clause was written to describe a
    // SILENT FAILURE -- an importer that died without recording anything -- and it is the
    // most damning phrase available. Applied to a retailer that is deliberately not
    // importing it says the identical words about the opposite situation. THE ABSENCE OF AN
    // ERROR IS EVIDENCE OF A PROBLEM IN ONE READING AND EVIDENCE OF CORRECTNESS IN THE
    // OTHER, AND THE SENTENCE CANNOT TELL THEM APART. That is why this needs a second
    // section rather than a longer threshold: no threshold distinguishes the two.
    //
    // AND WHY NOT JUST DROP THEM FROM THE EMAIL. Because a held retailer that is ALSO
    // GENUINELY BROKEN would then be invisible, and the hold would have bought SILENCE
    // RATHER THAN ACCURACY. The held section carries the same staleness figure the stale
    // section would have shown, so the number stays readable next to the reason for it.
    // Item 353.
    const stale = staleAll.filter((s) => !heldById.has(s.retailer_id));
    const heldStale = staleAll.filter((s) => heldById.has(s.retailer_id));

    // deliveryUnknown is part of the send condition, NOT just part of the body. A
    // retailer with unrecorded terms is invisible to the feed checks above -- its feed
    // can be perfectly healthy -- so leaving it out of this test would reproduce the
    // original defect one layer up: detected, formatted, and never sent.
    if (failures.length === 0 && stale.length === 0 && deliveryUnknown.length === 0
        && checkFindings.length === 0 && !gateFellBack) {
      // Everything healthy — no email, just return status
      return new Response(
        JSON.stringify({
          status: "all_healthy",
          checked: statuses.length,
          // Asserted, not omitted, for the same reason as the line below it: a held
          // retailer is stale on purpose and does NOT make the run unhealthy, so it must
          // not enter the send condition -- but its absence from the response would read
          // as "nothing is held", which is a different fact from "nothing is wrong".
          held: heldStale.map((s) => ({
            retailer: s.retailer_name,
            finding_key: heldById.get(s.retailer_id)?.finding_key ?? null,
            hours_stale: s.hours_stale === null ? null : Math.round(s.hours_stale),
          })),
          delivery_unknown: 0,
          // Asserted, not omitted: absent would mean nobody asked.
          standing_check_findings: 0,
          // Coverage is asserted even when healthy: its absence would read as "nothing is out
          // of scope", which is a different fact from "nothing is wrong".
          check_coverage: checkCoverage.map((c) => c.summary),
          gate_source: gateSource,
          gate_outcome: gateOutcome,
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
    if (checkFindings.length > 0) {
      const escalated = checkFindings.filter((f) => f.report_count >= 3).length;
      subjectParts.push(
        escalated > 0
          ? `${checkFindings.length} check finding${checkFindings.length === 1 ? "" : "s"} (${escalated} ESCALATED)`
          : `${checkFindings.length} check finding${checkFindings.length === 1 ? "" : "s"}`,
      );
    }
    if (deliveryUnknown.length > 0) {
      subjectParts.push(`${deliveryUnknown.length} without delivery terms`);
    }
    if (gateFellBack) subjectParts.push("orphan gate on fallback");
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
      .filter((s) => !stale.includes(s) && !heldStale.includes(s) && !failedIds.has(s.retailer_id))
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
The following retailer feed${stale.length === 1 ? " hasn't" : "s haven't"} refreshed in over ${staleHours} hours, with no import error recorded.
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

    const heldSection = heldStale.length > 0 ? `
<h1 style="margin: 0 0 8px; font-family: Georgia, serif; font-size: 22px; color: #6e6a64;">
${heldStale.length} feed${heldStale.length === 1 ? "" : "s"} held, not importing
</h1>
<p style="margin: 0 0 20px; font-size: 14px; color: #4a4845;">
Deliberately not importing, for a recorded reason. ${heldStale.length === 1 ? "This is not a failure" : "These are not failures"} and ${heldStale.length === 1 ? "it needs" : "they need"} no action.
The staleness figure is shown anyway: a held retailer can still develop a separate problem, and hiding the number would buy silence rather than accuracy.
</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top: 1px solid #e5e0d8; margin-bottom: 24px;">
<thead><tr>
<th style="padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Held retailer</th>
<th style="padding: 10px; text-align: right; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Last update</th>
<th style="padding: 10px; text-align: right; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Rows</th>
</tr></thead>
<tbody>${heldStale.map((s) => {
  const h = heldById.get(s.retailer_id);
  return `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px;">
          <strong>${escapeHtml(s.retailer_name)}</strong>
          <div style="font-size: 12px; color: #8a8680; margin-top: 3px; font-family: ui-monospace, monospace;">${escapeHtml(h?.finding_key ?? "")}</div>
          ${h?.unblocks_when ? `<div style="font-size: 12px; color: #4a4845; margin-top: 4px;">Unblocks when: ${escapeHtml(h.unblocks_when)}</div>` : ""}
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px; text-align: right; color: #6e6a64; vertical-align: top;">
          ${s.hours_stale === null ? "Never" : Math.round(s.hours_stale) + "h ago"}
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px; text-align: right; vertical-align: top;">
          ${s.row_count} rows
        </td>
      </tr>`;
}).join("")}</tbody>
</table>` : "";

    const deliveryRows = deliveryUnknown.map((d) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px;">
          <strong>${escapeHtml(d.name)}</strong>
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 13px; color: #8a8680;">
          ${escapeHtml(d.delivery_model ?? "(null)")}
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px; text-align: right; white-space: nowrap; color: #c0392b;">
          ${d.days_since_terms_observed === null ? "never observed" : Math.round(d.days_since_terms_observed) + "d ago"}
        </td>
      </tr>`).join("");

    // Item 194's reporter section. Findings arrive here because the detector no longer
    // reds on them — see the send-condition note above for why this must not be body-only.
    // Coverage: one line each, no escalation styling, no action demanded.
    const coverageSection = checkCoverage.length > 0 ? `
<div style="font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em; margin-bottom: 8px;">Check coverage</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #faf8f4; border-radius: 8px;">
${checkCoverage.map((c) => `
<tr>
  <td style="padding: 8px 10px; font-size: 13px; color: #6e6a64;">${escapeHtml(c.check_name)}</td>
  <td style="padding: 8px 10px; font-size: 13px; color: #4a4845; text-align: right;">${escapeHtml(c.summary)}</td>
</tr>`).join("")}
</table>` : "";

    const checkFindingsSection = checkFindings.length > 0 ? `
<h1 style="margin: 0 0 8px; font-family: Georgia, serif; font-size: 22px; color: #c0392b;">
${checkFindings.length} standing check finding${checkFindings.length === 1 ? "" : "s"}
</h1>
<p style="margin: 0 0 20px; font-size: 14px; color: #4a4845;">
These come from detectors that <strong>no longer fail CI on a finding</strong>, because a red tick could not
distinguish "this check found something" from "this check is broken" — and the one that was working got
ignored longer. A finding reported <strong>3 times</strong> and still open turns the detector red: that is not a
judgement that the finding is severe, it means <strong>this channel is not working</strong>.
Act on it, or record a deliberate decision not to, which resolves it.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
${checkFindings.map((f) => `
<tr>
  <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px;">
    <strong>${escapeHtml(f.check_name)}</strong><br>
    <span style="color:#4a4845;">${escapeHtml(f.summary)}</span>
  </td>
  <td style="padding: 10px; border-bottom: 1px solid #e5e0d8; font-size: 14px; text-align: right; white-space: nowrap; color: ${f.report_count >= 3 ? "#c0392b" : "#8a8680"};">
    ${f.report_count >= 3 ? "<strong>ESCALATED</strong><br>" : ""}reported ${f.report_count}&times;
  </td>
</tr>`).join("")}
</table>` : "";

    const deliverySection = deliveryUnknown.length > 0 ? `
<h1 style="margin: 0 0 8px; font-family: Georgia, serif; font-size: 22px; color: #c0392b;">
${deliveryUnknown.length} active retailer${deliveryUnknown.length === 1 ? "" : "s"} without delivery terms
</h1>
<p style="margin: 0 0 20px; font-size: 14px; color: #4a4845;">
These retailers are live and selling, and the optimiser will <strong>not rank them on delivered total</strong>
because their terms are unrecorded. That is live inventory quietly excluded from best-value comparison.
This is legitimate only while a newly onboarded retailer has its terms read from source.
Verify against the retailer's own site, never the feed, then set one of <em>tiered</em> / <em>flat</em> / <em>unknown</em>.
Never enter a threshold without its cost.
</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top: 1px solid #e5e0d8; margin-bottom: 28px;">
<thead><tr>
<th style="padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Retailer</th>
<th style="padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Model</th>
<th style="padding: 10px; text-align: right; font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em;">Terms observed</th>
</tr></thead>
<tbody>${deliveryRows}</tbody>
</table>` : "";

    // Rendered whenever an email is going out anyway, so the state is visible even on a
    // send triggered by something else. Only the `default-` case CAUSES a send.
    const gateSection = `
<h1 style="margin: 0 0 8px; font-family: Georgia, serif; font-size: 22px; color: ${gateFellBack ? "#c0392b" : "#4a4845"};">
Orphan gate${gateFellBack ? ": running on the build-time fallback" : ""}
</h1>
<p style="margin: 0 0 12px; font-size: 14px; color: #4a4845;">
${gateFellBack
  ? `Edge Config did not answer, so middleware fell back to its build-time constant. The gate is still applying its last deliberate state, which is why nothing broke, but <strong>the switch is not currently switching anything</strong>: an Edge Config change would have no effect until this clears.`
  : `Probe of <code>/product/${GATE_PROBE_ID}</code>, a known-gone id. State is reported, not judged: whether <em>inert</em> or <em>gone</em> is correct depends on whether the removal is meant to be on, and this monitor has no source for that intent.`}
</p>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top: 1px solid #e5e0d8; margin-bottom: 28px;">
<tbody>
<tr><td style="padding: 8px 10px; font-size: 13px; color: #6e6a64;">Outcome (<code>x-fmb-superdrug-gate</code>)</td><td style="padding: 8px 10px; font-size: 13px; text-align: right;"><strong>${escapeHtml(gateOutcome)}</strong></td></tr>
<tr><td style="padding: 8px 10px; font-size: 13px; color: #6e6a64;">Source (<code>x-fmb-gate-source</code>)</td><td style="padding: 8px 10px; font-size: 13px; text-align: right; color: ${gateFellBack ? "#c0392b" : "#6a7e6f"};"><strong>${escapeHtml(gateSource)}</strong></td></tr>
${gateProbeError ? `<tr><td style="padding: 8px 10px; font-size: 13px; color: #6e6a64;">Probe error</td><td style="padding: 8px 10px; font-size: 13px; text-align: right; color: #8a8680;">${escapeHtml(gateProbeError)} (this check could not see; NOT a gate failure)</td></tr>` : ""}
</tbody>
</table>`;

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
${checkFindingsSection}
${coverageSection}
${deliverySection}
${gateSection}
${failureSection}
${staleSection}
${heldSection}
${healthyRows ? `
<div style="font-size: 11px; text-transform: uppercase; color: #8a8680; letter-spacing: 0.1em; margin-bottom: 8px;">Healthy</div>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #faf8f4; border-radius: 8px;">
<tbody>${healthyRows}</tbody>
</table>
` : ""}
</td></tr>
<tr><td style="padding: 16px 28px; background: #faf8f4; border-top: 1px solid #f0ece4; font-size: 11px; color: #8a8680;">
Automated monitor. Runs daily at 09:00 UTC. Staleness threshold: ${staleHours}h.${dryRun ? " DRY RUN — not sent." : ""}
</td></tr>
</table>
</td></tr></table>
</body></html>`;

    if (dryRun) {
      return new Response(
        JSON.stringify({
          status: "dry_run",
          sent: false,
          staleness_hours: staleHours,
          subject,
          sections: {
            failures: failures.map((f) => f.retailer_name),
            stale: stale.map((s) => s.retailer_name),
            held: heldStale.map((s) => ({
              retailer: s.retailer_name,
              finding_key: heldById.get(s.retailer_id)?.finding_key ?? null,
              unblocks_when: heldById.get(s.retailer_id)?.unblocks_when ?? null,
              hours_stale: s.hours_stale === null ? null : Math.round(s.hours_stale),
            })),
            delivery_unknown: deliveryUnknown.map((d) => d.name),
            check_findings: checkFindings.length,
          },
          html,
        }, null, 2),
        { headers: { "Content-Type": "application/json" } },
      );
    }

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
        held_retailers: heldStale.map((s) => s.retailer_name),
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
