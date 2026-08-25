/**
 * ROSTER PARITY — the three hand-maintained surfaces that name our retailers, diffed against
 * `retailers` rather than against each other.
 *
 * WHY NOT A UNIT TEST. lib/__tests__/nav-parity.test.ts compares two static files TO EACH OTHER
 * and needs no credentials. A roster check built that way would catch a count disagreeing with its
 * own list — and WOULD HAVE PASSED ON 16 AUGUST 2026, when about.html read "11 UK retailers" over
 * a list of 11 and was wrong because it omitted Niche Beauty (live since the 9th).
 *
 *   THREE SURFACES THAT AGREE WITH EACH OTHER AND ARE ALL STALE IS THE ACTUAL FAILURE MODE.
 *
 * So the comparison that matters is against the table, which means credentials, which means a
 * workflow rather than `npm test`.
 *
 * WHY THREE SURFACES. work-with-us.html carries a BARE INTEGER in a stat card — no names, no list,
 * nothing a phrase-based sweep matches. It read 12 while eleven retailers were live and became
 * correct when MyProtein was added, without being touched (item 329). A check covering the strip
 * and about.html would have passed all day on 25 August while a third surface was right by
 * accident.
 *
 * THE ROSTER IS `active = true AND unlisted_reason IS NULL`, NOT `active = true`. Branded Beauty
 * was active and deliberately unlisted for a fortnight; diffing against `active` alone would have
 * failed every day of that fortnight on pages that were correct, and a check that fails while the
 * page is right gets suppressed. Item 332.
 *
 * ITEM 194'S EXIT CONTRACT: 0 for ok or findings, 1 ONLY for cannot_run.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const FILES = {
  strip: "public/index.html",
  about: "public/about.html",
  partner: "public/work-with-us.html",
};

// ── PREFLIGHT ────────────────────────────────────────────────────────────────────────
// gone-ids-drift.yml reported "No drift" TWICE while failing to load its own script, because a
// summary renders happily from empty variables (item 255). Every input is asserted present and
// non-empty BEFORE any comparison, and a failure here exits 1 as cannot_run rather than 0 as
// agreement. An empty parse is the shape that must never be reported as parity.
const fail: string[] = [];
for (const [k, f] of Object.entries(FILES)) if (!existsSync(f)) fail.push(`${k}: ${f} does not exist`);
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_KEY;
if (!SB_URL) fail.push("SUPABASE_URL is unset");
if (!SB_KEY) fail.push("SUPABASE_KEY is unset");
if (fail.length) {
  console.error("cannot_run:\n  " + fail.join("\n  "));
  process.exit(1);
}

const html = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, readFileSync(f, "utf8")]));

// ── PARSE ────────────────────────────────────────────────────────────────────────────
const stripNames = [...html.strip.matchAll(/hero-trust-card"><img src="\/logos\/[^"]+" alt="([^"]+)"/g)].map(m => m[1]);

const aboutBlock = html.about.split("Currently live across")[1] ?? "";
const aboutNames = [...(aboutBlock.split("</ul>")[0] ?? "").matchAll(/<li>([^<]+)<\/li>/g)].map(m => m[1].trim());
const aboutCount = Number(/Currently live across (\d+) UK retailers/.exec(html.about)?.[1] ?? NaN);

const partnerCount = Number(
  /<span class="stat-num">(\d+)<\/span>\s*<span class="stat-label">UK retailers currently live<\/span>/.exec(html.partner)?.[1] ?? NaN,
);

// A parse that found nothing is cannot_run, not parity. This is the assertion whose absence let a
// green tick render from empty variables for two weeks.
const empty: string[] = [];
if (stripNames.length === 0) empty.push("strip: parsed 0 logo alts");
if (aboutNames.length === 0) empty.push("about: parsed 0 <li> names");
if (!Number.isFinite(aboutCount)) empty.push("about: could not parse the prose count");
if (!Number.isFinite(partnerCount)) empty.push("work-with-us: could not parse the stat integer");
if (empty.length) {
  console.error("cannot_run — a surface parsed empty, which is NOT agreement:\n  " + empty.join("\n  "));
  process.exit(1);
}

// ── THE TABLE ────────────────────────────────────────────────────────────────────────
const supa = createClient(SB_URL!, SB_KEY!);
const { data, error } = await supa.from("retailers").select("name, active, unlisted_reason");
if (error || !data || data.length === 0) {
  console.error(`cannot_run — retailers unreadable: ${error?.message ?? "empty result"}`);
  process.exit(1);
}
const roster = data.filter(r => r.active && !r.unlisted_reason).map(r => r.name as string).sort();

// ── COMPARE ──────────────────────────────────────────────────────────────────────────
const diff = (a: string[], b: string[]) => a.filter(x => !b.includes(x)).sort();
const findings: string[] = [];
const check = (label: string, names: string[]) => {
  const missing = diff(roster, names), extra = diff(names, roster);
  if (missing.length) findings.push(`${label}: MISSING ${missing.join(", ")}`);
  if (extra.length) findings.push(`${label}: LISTS a retailer not on the roster — ${extra.join(", ")}`);
};
check("homepage strip", stripNames);
check("about.html list", aboutNames);
// The count is checked against the TABLE, not against its own list. A count matching its own list
// says nothing about whether the list is right — 16 August is the case.
if (aboutCount !== roster.length) findings.push(`about.html count: reads ${aboutCount}, roster is ${roster.length}`);
if (partnerCount !== roster.length) findings.push(`work-with-us stat: reads ${partnerCount}, roster is ${roster.length}`);

console.log(`roster (active AND unlisted_reason IS NULL): ${roster.length}`);
console.log(`  homepage strip   ${stripNames.length}`);
console.log(`  about.html list  ${aboutNames.length}  count ${aboutCount}`);
console.log(`  work-with-us     stat ${partnerCount}`);
if (findings.length === 0) {
  console.log("\nAll three surfaces agree with the table.");
} else {
  console.log("\nFINDINGS:");
  findings.forEach(f => console.log("  - " + f));
}
process.exit(0);
