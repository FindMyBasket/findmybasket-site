/**
 * PREFLIGHT FOR THE gone-ids DRIFT CHECK. Run before anything else; exits non-zero when
 * the drift check CANNOT LOOK, so that state can never be reported as "no drift".
 *
 * WHY THIS EXISTS. On 16 August 2026, PR #319 renamed
 * `scripts/regen-superdrug-gone-ids.mts` -> `scripts/regen-gone-ids.mts` and
 * `lib/superdrug-removed.ts` -> `lib/orphan-gate.ts`. The workflow was not updated. It
 * then ran on 16 and 23 August, FAILED TO LOAD ITS OWN SCRIPT BOTH TIMES, AND REPORTED
 * SUCCESS WITH "No drift. The committed list matches live state."
 *
 * Three independent silencings composed into that green tick, each reasonable alone:
 *   1. `npx tsx <script> | tee regen.log` -- the step takes TEE's exit code, not tsx's,
 *      because the shell had no `pipefail`.
 *   2. `BEFORE=$(git show HEAD:lib/superdrug-removed.ts | ...)` -- a failure inside
 *      `$(...)` does not fail the step; BEFORE simply became empty, then 0.
 *   3. `git diff --quiet -- lib/superdrug-removed.ts` on a path that does not exist
 *      exits 0, so CHANGED=no, so the summary printed the reassuring branch.
 *
 * The workflow's own header said "No PR is indistinguishable from the workflow not having
 * run, so the summary is the proof of life". THE SUMMARY WAS PROOF OF LIFE FOR A CORPSE:
 * it renders happily from empty variables. Work-list item 255.
 *
 * ITEM 194'S EXIT CONTRACT: 0 for ok or findings, 1 ONLY for cannot_run.
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { DEPARTURES } from "../lib/orphan-gate.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail: string[] = [];

// 1. THE FILES THE CHECK OPERATES ON MUST EXIST. This is the assertion whose absence let
//    a rename go unnoticed for two runs.
const REQUIRED = ["scripts/regen-gone-ids.mts", "lib/orphan-gate.ts"];
for (const rel of REQUIRED) {
  if (existsSync(resolve(ROOT, rel))) console.log(`  ok       ${rel}`);
  else { console.log(`  MISSING  ${rel}`); fail.push(`missing file: ${rel}`); }
}

// 2. THE REGEN SCRIPT ONLY WORKS WHILE THE DEPARTING RETAILER IS STILL ACTIVE. It selects
//    products that have a live ACTIVE-retailer row and no active row other than the
//    departing one; once `retailers.active` is false, that set is empty by construction
//    and regenerating would DELETE the whole gone-set rather than refresh it.
//    A tool that can only run before an event, on a residue that only exists after it.
//    Work-list item 254.
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.log("  MISSING  SUPABASE_URL / SUPABASE_SERVICE_KEY");
  fail.push("credentials not set");
} else {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const keys = Object.keys(DEPARTURES);
  let regenerable = 0;
  for (const k of keys) {
    const id = DEPARTURES[k].retailerId;
    const { data, error } = await sb.from("retailers").select("name, active").eq("id", id).single();
    if (error || !data) { console.log(`  UNKNOWN  ${k} (retailer ${id}) -- ${error?.message ?? "no row"}`); fail.push(`retailer ${id} unreadable`); continue; }
    if (data.active) { console.log(`  ok       ${k}: ${data.name} still active -- regenerable`); regenerable++; }
    else console.log(`  INERT    ${k}: ${data.name} already inactive -- regen CANNOT reconstruct its set`);
  }
  if (regenerable === 0) {
    fail.push(`no departure is regenerable: all ${keys.length} retailers are already inactive`);
  }
}

if (fail.length) {
  console.log("\ncannot_run:");
  for (const f of fail) console.log(`  - ${f}`);
  console.log("\nTHIS IS NOT 'no drift'. The check could not look. Item 194's cannot_run state.");
  process.exit(1);
}
console.log("\npreflight ok");
