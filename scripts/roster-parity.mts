/**
 * ROSTER PARITY — the hand-maintained surfaces that name our retailers, diffed against
 * `retailers` rather than against each other.
 *
 * WHY NOT A UNIT TEST. lib/__tests__/nav-parity.test.ts compares two static files TO EACH OTHER
 * and needs no credentials. A roster check built that way would catch a count disagreeing with its
 * own list — and WOULD HAVE PASSED ON 16 AUGUST 2026, when about.html read "11 UK retailers" over
 * a list of 11 and was wrong because it omitted Niche Beauty (live since the 9th).
 *
 *   SURFACES THAT AGREE WITH EACH OTHER AND ARE ALL STALE IS THE ACTUAL FAILURE MODE.
 *
 * So the comparison that matters is against the table, which means credentials, which means a
 * workflow rather than `npm test`.
 *
 * THE ROSTER IS `active = true AND unlisted_reason IS NULL`, NOT `active = true`. Branded Beauty
 * was active and deliberately unlisted for a fortnight; diffing against `active` alone would have
 * failed every day of that fortnight on pages that were correct, and a check that fails while the
 * page is right gets suppressed. Item 332.
 *
 * ITEM 194'S EXIT CONTRACT: 0 for ok or findings, 1 ONLY for cannot_run.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * REPAIRED 5 SEPTEMBER 2026 — item 584. It had been RED SINCE 31 AUGUST, its only
 * scheduled run ever, and the four faults below are why that mattered and why nobody knew.
 *
 * 1. ITS PARSER WAS BROKEN BY A CORRECT FIX. work-with-us.html carried a bare `12` in a
 *    stat card; item 494 replaced it with "Every retailer we carry…" on 28 August, three
 *    days after this script was written to parse it, applying item 340's own rule that a
 *    bare integer drifts by construction. A GUARD AGAINST STALE HARDCODED NUMBERS WAS
 *    DISABLED BY THE REMOVAL OF A STALE HARDCODED NUMBER. Neither step was wrong and
 *    nothing connected them. That surface is now OPTIONAL: absent means "makes no
 *    countable claim", which is the correct end state, and if an integer ever returns it
 *    is compared again automatically.
 *
 * 2. AN ALL-OR-NOTHING PREFLIGHT LET A DEAD SURFACE SILENCE A LIVE ONE. about.html — the
 *    only surface that actually drifted — WAS NEVER COMPARED, because the run aborted on
 *    work-with-us first. Parsing is now PER SURFACE: one surface failing to parse is
 *    reported as that surface's cannot_parse and every other comparison still runs.
 *    Item 255's rule is preserved exactly where it matters: an empty parse is never
 *    reported as agreement, it is reported as an unparsed surface.
 *
 * 3. THE STRIP IS NOT SERVED. /index.html 308-redirects to /, whose strip renders from
 *    getListedRetailers and cannot drift. Its comparison is kept but demoted to a NOTE:
 *    a finding nobody needs to act on competes for attention with one they do, which is
 *    how a channel dies. Same shape as item 567's parity test guarding the one static nav
 *    nobody can reach.
 *
 * 4. ★ IT REPORTED TO NOBODY, WHICH IS THE ONE THAT COST FIVE DAYS. Findings and
 *    cannot_run went to stdout and a red tick. ITEM 191 HAD ALREADY MEASURED WHAT A RED
 *    TICK IS WORTH — two red workflows ignored 14 and 25 days — and this script was
 *    written seven days later onto that same channel. It now writes into
 *    standing_check_findings, which monitor-retailer-feeds emails at 09:00, the same
 *    consumer migration-ledger and brand-hub-programmes already use. A guard whose output
 *    nobody reads is worth what an absent guard is worth and costs more to build.
 *
 *    AND IT RESOLVES ITS OWN FINDINGS. Every row in standing_check_findings was `open` on
 *    5 September — 47 of them — because no check has ever closed one. feed_freeze_findings
 *    had the same defect (item 579). A check that only ever opens rows builds the pile
 *    that makes its own channel unreadable.
 */
import { readFileSync, existsSync } from "node:fs";

const CHECK_NAME = "roster-parity";
const WRITE = process.argv.includes("--write-findings");

const FILES = {
  strip: "public/index.html",
  about: "public/about.html",
  partner: "public/work-with-us.html",
};

const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_KEY;

function cannotRun(why: string): never {
  console.error(`cannot_run — ${why}`);
  process.exit(1);
}

// ── PREFLIGHT: only what the run genuinely cannot proceed without ────────────────────
// Credentials and the PRIMARY surface. A missing optional surface is not cannot_run.
if (!SB_URL) cannotRun("SUPABASE_URL is unset");
if (!SB_KEY) cannotRun("SUPABASE_KEY is unset");
if (!existsSync(FILES.about)) cannotRun(`about: ${FILES.about} does not exist`);

const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : null);
const html = {
  strip: read(FILES.strip),
  about: read(FILES.about)!,
  partner: read(FILES.partner),
};

// ── PARSE, PER SURFACE ───────────────────────────────────────────────────────────────
const unparsed: string[] = [];

const stripNames = html.strip
  ? [...html.strip.matchAll(/hero-trust-card"><img src="\/logos\/[^"]+" alt="([^"]+)"/g)].map(m => m[1])
  : [];
if (html.strip && stripNames.length === 0) unparsed.push("strip: parsed 0 logo alts");

const aboutBlock = html.about.split("Currently live across")[1] ?? "";
const aboutNames = [...(aboutBlock.split("</ul>")[0] ?? "").matchAll(/<li>([^<]+)<\/li>/g)].map(m => m[1].trim());
const aboutCount = Number(/Currently live across (\d+) UK retailers/.exec(html.about)?.[1] ?? NaN);

// about.html is the PRIMARY surface: served, hand-typed, and the only one that can mislead a
// visitor. If it cannot be parsed the run has not done its job, so this stays cannot_run.
if (aboutNames.length === 0) cannotRun("about: parsed 0 <li> names — the primary surface is unreadable");
if (!Number.isFinite(aboutCount)) cannotRun("about: could not parse the prose count");

// OPTIONAL BY DESIGN. Item 494 removed this integer deliberately; absence is the correct state
// and must not be reported as a fault. Presence is compared, so a returning integer is guarded
// again with no edit here.
const partnerMatch = html.partner
  ? /<span class="stat-num">(\d+)<\/span>\s*<span class="stat-label">[^<]*retailers?[^<]*<\/span>/i.exec(html.partner)
  : null;
const partnerCount = partnerMatch ? Number(partnerMatch[1]) : null;

// ── THE TABLE ────────────────────────────────────────────────────────────────────────
const sb = async (path: string, init?: RequestInit) => {
  let r: Response;
  try {
    r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json", ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    cannotRun(`network error on ${path.split("?")[0]}: ${(e as Error).message}`);
  }
  if (!r.ok) cannotRun(`supabase ${r.status} on ${path.split("?")[0]}`);
  const body = await r.text();
  return body ? JSON.parse(body) : null;
};

const data = await sb("retailers?select=name,active,unlisted_reason");
if (!Array.isArray(data) || data.length === 0) cannotRun("retailers unreadable: empty result");
const roster: string[] = data
  .filter((r: { active: boolean; unlisted_reason: string | null }) => r.active && !r.unlisted_reason)
  .map((r: { name: string }) => r.name)
  .sort();

// ── COMPARE ──────────────────────────────────────────────────────────────────────────
type Finding = { key: string; summary: string };
const findings: Finding[] = [];
const notes: string[] = [];
const diff = (a: string[], b: string[]) => a.filter(x => !b.includes(x)).sort();

const compare = (label: string, keyPrefix: string, names: string[], into: "finding" | "note") => {
  const missing = diff(roster, names), extra = diff(names, roster);
  const push = (k: string, s: string) =>
    into === "finding" ? findings.push({ key: k, summary: s }) : notes.push(s);
  if (missing.length) push(`${keyPrefix}:missing`, `${label}: MISSING ${missing.join(", ")}`);
  if (extra.length) push(`${keyPrefix}:extra`, `${label}: LISTS a retailer not on the roster — ${extra.join(", ")}`);
};

compare("about.html list", "about:names", aboutNames, "finding");
// NOTE, not finding: /index.html 308s to / and this strip is not served. See header point 3.
if (html.strip) compare("homepage strip (UNSERVED /index.html)", "strip:names", stripNames, "note");

// The count is checked against the TABLE, not against its own list. A count matching its own list
// says nothing about whether the list is right — 16 August is the case, and 4 September is the
// case where the count became right by coincidence while the list stayed wrong (item 582).
if (aboutCount !== roster.length) {
  findings.push({
    key: "about:count",
    summary: `about.html count reads ${aboutCount}, roster is ${roster.length}`,
  });
}
if (partnerCount !== null && partnerCount !== roster.length) {
  findings.push({
    key: "partner:count",
    summary: `work-with-us stat reads ${partnerCount}, roster is ${roster.length}`,
  });
}

// ── REPORT ───────────────────────────────────────────────────────────────────────────
console.log(`roster (active AND unlisted_reason IS NULL): ${roster.length}`);
console.log(`  about.html list   ${aboutNames.length} names, count ${aboutCount}   [PRIMARY, served]`);
console.log(`  homepage strip    ${html.strip ? `${stripNames.length} marks` : "file absent"}   [note only — /index.html 308s]`);
console.log(`  work-with-us      ${partnerCount === null ? "no countable claim (correct since item 494)" : `stat ${partnerCount}`}   [optional]`);
if (unparsed.length) console.log("\nUNPARSED SURFACES (reported, never counted as agreement):\n  " + unparsed.join("\n  "));
if (notes.length) console.log("\nNOTES (unserved surface, no visitor impact):\n  " + notes.map(n => "- " + n).join("\n  "));
if (findings.length === 0) console.log("\nEvery served surface agrees with the table.");
else console.log("\nFINDINGS:\n  " + findings.map(f => "- " + f.summary).join("\n  "));

// ── RECORD, so the 09:00 email carries it (header point 4) ───────────────────────────
if (WRITE) {
  for (const f of findings) {
    await sb("standing_check_findings?on_conflict=check_name,finding_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        check_name: CHECK_NAME, finding_key: f.key, kind: "finding",
        summary: f.summary, status: "open",
      }),
    });
  }
  // RESOLVE WHAT IS NO LONGER TRUE. Without this the table accumulates rows that were fixed
  // weeks ago and the daily email drowns in them -- item 579's defect, and the reason five of
  // six feed_freeze_findings rows were dead on arrival.
  const live = findings.map(f => `"${f.key}"`).join(",");
  const notIn = live ? `&finding_key=not.in.(${live})` : "";
  await sb(`standing_check_findings?check_name=eq.${CHECK_NAME}&status=eq.open${notIn}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "resolved", resolved_at: new Date().toISOString() }),
  });
}

process.exit(0);
