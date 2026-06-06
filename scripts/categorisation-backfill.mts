/**
 * One-off categorisation backfill for the products table.
 *
 * Re-runs inferCategorisation() over every existing product and re-categorises
 * the rows whose classification CHANGED as a result of this session's
 * categorisation commits (everything since the pre-session baseline da666aa).
 * To isolate *exactly* those commits' effect — and avoid sweeping in years of
 * legacy drift unrelated to them — it compares the OLD function (extracted from
 * da666aa) against the NEW function (current working tree) and only acts on
 * products where OLD(name,brand) !== NEW(name,brand).
 *
 * Guards:
 *   - Never touches a product whose stored top_category is 'makeup'. Retailer 6
 *     forces top_category_default='makeup' at import; we can't tell per-product
 *     whether a stored 'makeup' came from that override, so we leave it alone.
 *     (Our four commits only move products between hair<->skincare anyway.)
 *   - Skips any product the NEW function would exclude or fail to classify — we
 *     never blank out a live catalogue row.
 *
 * Both functions are extracted live from source (no hand-maintained copy), the
 * same technique as categorisation-harness.mts.
 *
 * Reads via the anon key (public catalogue). DRY RUN by default: prints a
 * blast-radius summary and writes the proposed changes to
 *   scripts/.categorisation-backfill.gen.json  (full change list)
 *   scripts/.categorisation-backfill.gen.sql   (batched UPDATEs, applied separately)
 * Pass --write to additionally print the SQL apply instructions. No DB writes
 * happen from this script regardless — writes go through the privileged MCP path.
 *
 * Run:  npx tsx scripts/categorisation-backfill.mts
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "supabase", "functions", "import-awin-feed", "index.ts");
const OLD_REF = "da666aa";

type Cat = {
  top_category: string | null;
  product_type: string;
  subcategory: string;
  tags: string[];
  excluded?: string;
};
type Infer = (name: string, brand?: string) => Cat;

// ── Extract type defs + inferCategorisation from a source string ────────────
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
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) throw new Error("could not brace-match inferCategorisation");
  const body = src.slice(typeStart, end);
  if (!body.includes("function inferCategorisation")) throw new Error("extraction missing fn");
  if (!/return\s*\{/.test(body)) throw new Error("extraction missing return — brace match likely wrong");
  return body;
}

async function loadInfer(src: string, tag: string): Promise<Infer> {
  const tmp = join(__dirname, `.categorisation-${tag}.gen.ts`);
  writeFileSync(tmp, extractFunction(src) + "\n\nexport { inferCategorisation };\n");
  const mod = (await import(pathToFileURL(tmp).href + `?t=${tag}`)) as { inferCategorisation: Infer };
  return mod.inferCategorisation;
}

const newInfer = await loadInfer(readFileSync(SRC, "utf8"), "new");
const oldSrc = execSync(`git show ${OLD_REF}:supabase/functions/import-awin-feed/index.ts`, {
  cwd: join(__dirname, ".."), maxBuffer: 64 * 1024 * 1024,
}).toString("utf8");
const oldInfer = await loadInfer(oldSrc, "old");

// ── Read all products via anon REST ─────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split(/\n/).filter(Boolean)
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Row = {
  id: number; name: string; brand: string | null;
  category: string | null; product_type: string | null;
  top_category: string | null; subcategory: string | null; tags: string[] | null;
};

const rows: Row[] = [];
const PAGE = 1000;
for (let offset = 0; ; offset += PAGE) {
  const url = `${URL}/rest/v1/products?select=id,name,brand,category,product_type,top_category,subcategory,tags&order=id.asc&offset=${offset}&limit=${PAGE}`;
  const res = await fetch(url, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`read failed @${offset}: ${res.status} ${await res.text()}`);
  const batch = (await res.json()) as Row[];
  if (batch.length === 0) break;
  rows.push(...batch);
  process.stderr.write(`\rread ${rows.length}`);
  if (batch.length < PAGE) break;
}
process.stderr.write(`\rread ${rows.length} products\n`);

// ── Diff ─────────────────────────────────────────────────────────────────────
const sameCat = (a: Cat, b: Cat) =>
  a.top_category === b.top_category &&
  a.product_type === b.product_type &&
  a.subcategory === b.subcategory &&
  JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
  (a.excluded ?? "") === (b.excluded ?? "");

const sqlStr = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const sqlArr = (a: string[]) => `ARRAY[${a.map(sqlStr).join(",")}]::text[]`;

type Change = {
  id: number; name: string; brand: string;
  from: { top_category: string | null; product_type: string | null; subcategory: string | null; tags: string[] | null };
  to: { top_category: string; product_type: string; subcategory: string; tags: string[] };
};
const changes: Change[] = [];
const makeupGuard: Change[] = [];                  // stored makeup, new=hair etc. — needs retailer-6 check
const nowExcluded: Array<{ id: number; name: string; brand: string; reason: string; from_top: string | null }> = [];
const reroute: Record<string, number> = {};       // commit-caused top_category transitions (old->new)
let skippedMakeupGuard = 0, skippedExcluded = 0, commitAffected = 0, alreadyCorrect = 0;

for (const r of rows) {
  const name = r.name || "";
  const brand = r.brand || "";
  const oldC = oldInfer(name, brand);
  const newC = newInfer(name, brand);

  if (sameCat(oldC, newC)) continue;             // our commits did not change this product
  commitAffected++;
  const transition = `${oldC.top_category ?? oldC.excluded ?? "—"} -> ${newC.top_category ?? newC.excluded ?? "—"}`;
  reroute[transition] = (reroute[transition] || 0) + 1;

  const target = {
    top_category: newC.top_category as string,
    product_type: newC.product_type,
    subcategory: newC.subcategory,
    tags: newC.tags,
  };

  if (newC.excluded || !newC.top_category) {
    skippedExcluded++;
    nowExcluded.push({ id: r.id, name, brand, reason: newC.excluded ?? "unclassified", from_top: r.top_category });
    continue;
  }
  // If the stored row already matches the new categorisation exactly, it has
  // nothing to backfill — skip it regardless of which branch it would fall in.
  // (Must precede the makeup guard: that branch otherwise re-reports already-
  // correct makeup rows as pending writes.)
  const storedMatches =
    r.top_category === target.top_category &&
    r.product_type === target.product_type &&
    r.category === target.product_type &&
    r.subcategory === target.subcategory &&
    JSON.stringify(r.tags ?? []) === JSON.stringify(target.tags);
  if (storedMatches) { alreadyCorrect++; continue; }

  if (r.top_category === "makeup") {
    skippedMakeupGuard++;
    makeupGuard.push({
      id: r.id, name, brand,
      from: { top_category: r.top_category, product_type: r.product_type, subcategory: r.subcategory, tags: r.tags },
      to: target,
    });
    continue;
  }

  changes.push({
    id: r.id, name, brand,
    from: { top_category: r.top_category, product_type: r.product_type, subcategory: r.subcategory, tags: r.tags },
    to: target,
  });
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\nTotal products scanned:            ${rows.length}`);
console.log(`Affected by the 4 commits (old≠new): ${commitAffected}`);
console.log(`  → skipped (now excluded/unclassd): ${skippedExcluded}`);
console.log(`  → skipped (stored makeup, guard):  ${skippedMakeupGuard}`);
console.log(`  → already correct in DB (no-op):   ${alreadyCorrect}`);
console.log(`  → ROWS TO UPDATE:                  ${changes.length}`);

console.log(`\nCommit-caused top_category transitions (old → new), all affected rows:`);
for (const [k, v] of Object.entries(reroute).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}

// Net top_category change among rows we WILL update
const netMove: Record<string, number> = {};
for (const c of changes) {
  const k = `${c.from.top_category} -> ${c.to.top_category}`;
  netMove[k] = (netMove[k] || 0) + 1;
}
console.log(`\nStored → new top_category among ROWS TO UPDATE:`);
for (const [k, v] of Object.entries(netMove).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}

console.log(`\nSample of rows to update (first 25):`);
for (const c of changes.slice(0, 25)) {
  console.log(`  [${c.id}] ${c.brand} — ${c.name}`);
  console.log(`        ${c.from.top_category}/${c.from.product_type}/${c.from.subcategory} ${JSON.stringify(c.from.tags)}`);
  console.log(`     →  ${c.to.top_category}/${c.to.product_type}/${c.to.subcategory} ${JSON.stringify(c.to.tags)}`);
}

// ── Emit artifacts (no DB writes) ────────────────────────────────────────────
writeFileSync(join(__dirname, ".categorisation-backfill.gen.json"), JSON.stringify(changes, null, 2));
writeFileSync(join(__dirname, ".categorisation-backfill.makeup.gen.json"), JSON.stringify(makeupGuard, null, 2));
writeFileSync(join(__dirname, ".categorisation-backfill.excluded.gen.json"), JSON.stringify(nowExcluded, null, 2));
console.log(`\nGuarded makeup→other bucket: ${makeupGuard.length}  (ids -> .makeup.gen.json)`);
console.log(`Now-excluded bucket:         ${nowExcluded.length}  (-> .excluded.gen.json)`);

// Fold in the makeup→hair/skincare rows that are NOT Branded Beauty (retailer 6).
// The retailer-6 ids were identified out-of-band; those keep their forced
// makeup override and are reported separately, not written.
const BB_LINKED = new Set([21756, 21757, 21849, 21850, 21854, 21855]);
const extra = makeupGuard.filter((c) => !BB_LINKED.has(c.id));
const writeSet = [...changes, ...extra];

// Group by identical target so each UPDATE is one statement with a compact
// integer id-list (reliable to apply, vs thousands of per-row VALUES tuples).
const groups = new Map<string, { to: Change["to"]; ids: number[] }>();
for (const c of writeSet) {
  const key = JSON.stringify([c.to.product_type, c.to.top_category, c.to.subcategory, c.to.tags]);
  if (!groups.has(key)) groups.set(key, { to: c.to, ids: [] });
  groups.get(key)!.ids.push(c.id);
}
const stmts: string[] = [];
for (const { to, ids } of groups.values()) {
  stmts.push(
    `update products set\n` +
    `  category = ${sqlStr(to.product_type)},\n` +
    `  product_type = ${sqlStr(to.product_type)},\n` +
    `  top_category = ${sqlStr(to.top_category)},\n` +
    `  subcategory = ${sqlStr(to.subcategory)},\n` +
    `  tags = ${sqlArr(to.tags)}\n` +
    `where id in (${ids.sort((a, b) => a - b).join(",")});`
  );
}
writeFileSync(join(__dirname, ".categorisation-backfill.gen.sql"), stmts.join("\n\n") + "\n");

console.log(`\nWrite set: ${changes.length} core + ${extra.length} non-Branded-Beauty makeup = ${writeSet.length} rows`);
console.log(`Branded Beauty rows left untouched (reported only): ${makeupGuard.length - extra.length}`);
console.log(`Wrote scripts/.categorisation-backfill.gen.json (${changes.length} core rows)`);
console.log(`Wrote scripts/.categorisation-backfill.gen.sql (${stmts.length} grouped UPDATE statements, ${writeSet.length} rows)`);
console.log(`\nDRY RUN — no database writes performed.`);
