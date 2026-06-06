/**
 * Local validation harness for inferCategorisation() in
 *   supabase/functions/import-awin-feed/index.ts
 *
 * It extracts the LIVE function source (plus its TopCategory/Categorisation
 * type defs) directly from index.ts at runtime, transpiles it via tsx, and
 * runs a fixed set of representative product names through it. This means the
 * harness always tests exactly the code we are about to deploy — no drift, no
 * hand-maintained copy of the logic.
 *
 * Run:  npx tsx scripts/categorisation-harness.ts
 *
 * Each case is tagged with `fixedBy`: the commit number that should make it
 * PASS. fixedBy 0 = control (must always pass; regression guard). So before
 * any fix, controls PASS and fix-cases FAIL — documenting the bug. After each
 * commit, more cases flip to PASS and NO control may flip to FAIL.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "supabase", "functions", "import-awin-feed", "index.ts");

// ── Extract type defs + inferCategorisation from the live source ────────────
function extractFunction(src: string): string {
  const typeStart = src.indexOf("type TopCategory");
  if (typeStart === -1) throw new Error("type TopCategory not found in source");
  const fnSig = src.indexOf("function inferCategorisation", typeStart);
  if (fnSig === -1) throw new Error("function inferCategorisation not found");
  const braceOpen = src.indexOf("{", fnSig);
  let depth = 0;
  let end = -1;
  for (let i = braceOpen; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error("could not brace-match inferCategorisation");
  const body = src.slice(typeStart, end);
  // Sanity checks against the simple brace-matcher being fooled.
  if (!body.includes("function inferCategorisation")) throw new Error("extraction missing fn");
  if (!/return\s*\{/.test(body)) throw new Error("extraction missing return — brace match likely wrong");
  return body;
}

const source = readFileSync(SRC, "utf8");
const extracted = extractFunction(source);
const tmpModule = join(__dirname, ".categorisation-extracted.gen.ts");
writeFileSync(tmpModule, extracted + "\n\nexport { inferCategorisation };\n");

type Cat = {
  top_category: string | null;
  product_type: string;
  subcategory: string;
  tags: string[];
  excluded?: string;
};
const mod = (await import(pathToFileURL(tmpModule).href)) as {
  inferCategorisation: (name: string, brand?: string) => Cat;
};
const inferCategorisation = mod.inferCategorisation;

// ── Test cases ──────────────────────────────────────────────────────────────
type Expect = "hair" | "skincare" | "makeup" | null;
type Case = {
  name: string;
  brand?: string;
  expect: Expect;
  fixedBy: 0 | 1 | 2 | 3 | 4;
  note?: string;
};

const CASES: Case[] = [
  // ── Controls (fixedBy 0): must ALWAYS pass — regression guards ────────────
  { name: "CeraVe Moisturising Cream 50ml", expect: "skincare", fixedBy: 0 },
  { name: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", expect: "skincare", fixedBy: 0 },
  { name: "La Roche-Posay Anthelios SPF50 Fluid 50ml", expect: "skincare", fixedBy: 0, note: "spf50→spf 50 should still route SPF after C1" },
  { name: "Clinique Superbalanced Makeup", expect: "makeup", fixedBy: 0 },
  { name: "Maybelline Baby Lips Lip Balm", expect: "skincare", fixedBy: 0, note: "'baby lips' must NOT hit baby exclusion" },
  { name: "Olaplex No.4 Bond Maintenance Shampoo 250ml", brand: "Olaplex", expect: "hair", fixedBy: 0 },
  { name: "Batiste Dry Shampoo Original 200ml", brand: "Batiste", expect: "hair", fixedBy: 0 },

  // ── Commit 1: concatenated hair keyword + number ─────────────────────────
  { name: "American Crew Daily Moisturizing Shampoo250ml", brand: "American Crew", expect: "hair", fixedBy: 1 },
  { name: "Redken All Soft Conditioner300ml", brand: "Redken", expect: "hair", fixedBy: 1 },
  { name: "Schwarzkopf BC Bonacure Shampoo1000ml", brand: "Schwarzkopf", expect: "hair", fixedBy: 1 },

  // ── Commit 2: standalone styling keywords (brand NOT whitelisted) ────────
  { name: "Generic Strong Hold Pomade 100g", brand: "Generic", expect: "hair", fixedBy: 2 },
  { name: "Genericco Molding Clay 85g", brand: "Genericco", expect: "hair", fixedBy: 2 },
  { name: "Genericco Texture Paste 75ml", brand: "Genericco", expect: "hair", fixedBy: 2 },
  { name: "Genericco Grooming Spray 200ml", brand: "Genericco", expect: "hair", fixedBy: 2 },

  // ── Commit 3: brand whitelist (no hair/styling keyword in name) ──────────
  { name: "American Crew Forming Cream 85g", brand: "American Crew", expect: "hair", fixedBy: 3 },
  { name: "Bumble and bumble Surf Infusion 100ml", brand: "Bumble and bumble", expect: "hair", fixedBy: 3 },
  { name: "Living Proof Full Dry Volume Blast 238ml", brand: "Living Proof", expect: "hair", fixedBy: 3 },

  // ── Commit 4: beard exception → skincare (mens grooming), NOT hair ───────
  { name: "American Crew Beard Serum 50ml", brand: "American Crew", expect: "skincare", fixedBy: 4 },
  { name: "American Crew Beard Balm 60ml", brand: "American Crew", expect: "skincare", fixedBy: 4 },
  { name: "American Crew Beard Oil 30ml", brand: "American Crew", expect: "skincare", fixedBy: 4 },
];

// ── Run ──────────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
let pass = 0;
let fail = 0;
const failedControls: string[] = [];

console.log(
  pad("C", 2) + "  " + pad("RESULT", 6) + "  " + pad("got", 9) + "  " + pad("expect", 9) + "  " +
    pad("product_type", 16) + "  name",
);
console.log("─".repeat(110));

for (const c of CASES) {
  const r = inferCategorisation(c.name, c.brand ?? "");
  const got = r.excluded ? `excl:${r.excluded}` : r.top_category;
  const ok = (r.top_category ?? null) === c.expect && !r.excluded;
  if (ok) pass++;
  else {
    fail++;
    if (c.fixedBy === 0) failedControls.push(c.name);
  }
  const mark = ok ? "PASS" : c.fixedBy === 0 ? "FAIL✗" : `fix@${c.fixedBy}`;
  console.log(
    pad(String(c.fixedBy), 2) + "  " +
      pad(mark, 6) + "  " +
      pad(String(got ?? "null"), 9) + "  " +
      pad(String(c.expect ?? "null"), 9) + "  " +
      pad(r.product_type || "—", 16) + "  " +
      c.name + (c.brand ? `  [${c.brand}]` : ""),
  );
}

console.log("─".repeat(110));
console.log(`PASS ${pass}  /  FAIL ${fail}  (of ${CASES.length})`);
if (failedControls.length) {
  console.log(`\n⚠️  REGRESSION: ${failedControls.length} control case(s) now failing:`);
  for (const n of failedControls) console.log(`   - ${n}`);
  process.exit(1);
}
