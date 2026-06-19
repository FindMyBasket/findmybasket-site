/**
 * Backfill PREVIEW for the face/body/hand/foot subcategory upgrade
 * (PR: subcategory upgrade in _shared/categorisation.ts).
 *
 * Isolates ONLY the rows this change moves — same technique as
 * categorisation-backfill.mts: compares the OLD inferCategorisation (from git
 * HEAD) against the NEW one (working tree) and acts solely on products where
 * OLD(name,brand) !== NEW(name,brand). That avoids sweeping in years of legacy
 * drift unrelated to this PR.
 *
 * Guards (mirrors the prior backfill):
 *   - Skip rows the NEW function would exclude / fail to classify.
 *   - Skip rows already storing the new categorisation (no-op).
 *   - Stored top_category='makeup' rows that NEW reclassifies (e.g. a misfiled
 *     "Makeup Remover" → skincare/Cleanser) are reported in a separate bucket,
 *     NOT folded into the per-brand skincare distribution.
 *
 * Output: before/after SUBCATEGORY distribution for the top 30 skincare brands
 * by product count, plus global transition matrices. Writes the full change
 * list + grouped UPDATE statements to
 *   scripts/.subcategory-backfill.gen.json
 *   scripts/.subcategory-backfill.gen.sql
 * NO database writes happen here — apply is a separate, approved step.
 *
 * Run:  npx tsx scripts/subcategory-backfill-preview.mts
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_REL = "supabase/functions/_shared/categorisation.ts";
const SRC = join(__dirname, "..", SRC_REL);
const OLD_REF = "HEAD"; // pre-change categorisation (this PR is uncommitted in the working tree)

type Cat = { top_category: string | null; product_type: string; subcategory: string; tags: string[]; excluded?: string };
type Infer = (name: string, brand?: string) => Cat;

function extractFunction(src: string): string {
  const typeStart = src.indexOf("type TopCategory");
  if (typeStart === -1) throw new Error("type TopCategory not found");
  const fnSig = src.indexOf("function inferCategorisation", typeStart);
  if (fnSig === -1) throw new Error("function inferCategorisation not found");
  const braceOpen = src.indexOf("{", fnSig);
  let depth = 0, end = -1;
  for (let i = braceOpen; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { if (--depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("brace match failed");
  const body = src.slice(typeStart, end);
  if (!/return\s*\{/.test(body)) throw new Error("extraction missing return");
  return body;
}
async function loadInfer(src: string, tag: string): Promise<Infer> {
  const tmp = join(__dirname, `.subcat-${tag}.gen.ts`);
  const extracted = extractFunction(src);
  // _shared/categorisation.ts already exports inferCategorisation; only append
  // a named export when the extracted body doesn't already have one.
  const hasExport = /export\s+function\s+inferCategorisation|export\s*\{[^}]*\binferCategorisation\b/.test(extracted);
  writeFileSync(tmp, extracted + (hasExport ? "\n" : "\n\nexport { inferCategorisation };\n"));
  const mod = (await import(pathToFileURL(tmp).href + `?t=${tag}`)) as { inferCategorisation: Infer };
  return mod.inferCategorisation;
}

const newInfer = await loadInfer(readFileSync(SRC, "utf8"), "new");
const oldSrc = execSync(`git show ${OLD_REF}:${SRC_REL}`, { cwd: join(__dirname, ".."), maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
const oldInfer = await loadInfer(oldSrc, "old");

// ── Read all products via anon REST ─────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split(/\n/).filter(Boolean)
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Row = { id: number; name: string; brand: string | null; category: string | null; product_type: string | null; top_category: string | null; subcategory: string | null; tags: string[] | null };
const rows: Row[] = [];
const PAGE = 1000;
for (let offset = 0; ; offset += PAGE) {
  const url = `${URL}/rest/v1/products?select=id,name,brand,category,product_type,top_category,subcategory,tags&order=id.asc&offset=${offset}&limit=${PAGE}`;
  const res = await fetch(url, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`read failed @${offset}: ${res.status}`);
  const batch = (await res.json()) as Row[];
  if (!batch.length) break;
  rows.push(...batch);
  process.stderr.write(`\rread ${rows.length}`);
  if (batch.length < PAGE) break;
}
process.stderr.write(`\rread ${rows.length} products\n`);

const sameCat = (a: Cat, b: Cat) =>
  a.top_category === b.top_category && a.product_type === b.product_type &&
  a.subcategory === b.subcategory && JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
  (a.excluded ?? "") === (b.excluded ?? "");

type Change = { id: number; name: string; brand: string; from: Row; to: Cat };
const changes: Change[] = [];            // skincare rows we will update (incl. subcategory and/or product_type)
const leftSkincare: Change[] = [];       // stored skincare → NEW makeup/hair/excluded (report only)
const enteredFromMakeup: Change[] = [];  // stored makeup → NEW skincare (e.g. makeup remover) — guarded
let alreadyCorrect = 0, commitAffected = 0;

// Per-brand subcategory distributions (skincare universe = stored top_category='skincare')
const SUBS = ["face", "body", "hand", "foot", "both", "other"];
const subKey = (s: string | null) => (SUBS.includes(s ?? "") ? (s as string) : "other");
type Dist = Record<string, number>;
const brandCount = new Map<string, number>();
const before = new Map<string, Dist>();
const after = new Map<string, Dist>();
const ensure = (m: Map<string, Dist>, b: string) => m.get(b) ?? (m.set(b, Object.fromEntries(SUBS.map((s) => [s, 0]))).get(b)!);

// Global subcategory transition matrix among changed skincare rows.
const subTransition: Record<string, number> = {};
const ptTransition: Record<string, number> = {};

for (const r of rows) {
  const name = r.name || "", brand = (r.brand || "Unknown").trim();
  const oldC = oldInfer(name, brand), newC = newInfer(name, brand);
  const isStoredSkincare = r.top_category === "skincare";

  // Build the per-brand BEFORE/AFTER distributions over the stored-skincare universe.
  if (isStoredSkincare) {
    brandCount.set(brand, (brandCount.get(brand) ?? 0) + 1);
    ensure(before, brand)[subKey(r.subcategory)]++;
  }

  if (sameCat(oldC, newC)) {
    // This PR doesn't move the row. After-state = stored (no change).
    if (isStoredSkincare) ensure(after, brand)[subKey(r.subcategory)]++;
    continue;
  }
  commitAffected++;

  const target = { top_category: newC.top_category, product_type: newC.product_type, subcategory: newC.subcategory, tags: newC.tags } as Cat;

  // NEW excludes / can't classify → never blank a live row; treat as no-op for after-dist.
  if (newC.excluded || !newC.top_category) {
    if (isStoredSkincare) { ensure(after, brand)[subKey(r.subcategory)]++; leftSkincare.push({ id: r.id, name, brand, from: r, to: target }); }
    continue;
  }

  // Stored makeup that NEW reclassifies (e.g. misfiled "Makeup Remover").
  if (r.top_category === "makeup" && newC.top_category !== "makeup") {
    enteredFromMakeup.push({ id: r.id, name, brand, from: r, to: target });
    continue; // not part of the skincare-subcategory backfill; reported separately
  }

  const storedMatches =
    r.top_category === target.top_category && r.product_type === target.product_type &&
    r.category === target.product_type && r.subcategory === target.subcategory &&
    JSON.stringify(r.tags ?? []) === JSON.stringify(target.tags);
  if (storedMatches) {
    alreadyCorrect++;
    if (isStoredSkincare) ensure(after, brand)[subKey(r.subcategory)]++;
    continue;
  }

  // A row we WILL update.
  if (isStoredSkincare) {
    ensure(after, brand)[subKey(target.subcategory)]++;
    if (r.subcategory !== target.subcategory) subTransition[`${subKey(r.subcategory)} → ${subKey(target.subcategory)}`] = (subTransition[`${subKey(r.subcategory)} → ${subKey(target.subcategory)}`] ?? 0) + 1;
    if (r.product_type !== target.product_type) ptTransition[`${r.product_type ?? "—"} → ${target.product_type}`] = (ptTransition[`${r.product_type ?? "—"} → ${target.product_type}`] ?? 0) + 1;
  } else if (newC.top_category === "skincare") {
    // stored non-skincare/non-makeup (e.g. hair) → skincare: rare; still update.
  }
  changes.push({ id: r.id, name, brand, from: r, to: target });
}

// ── Report ───────────────────────────────────────────────────────────────────
const subOnly = changes.filter((c) => c.from.subcategory !== c.to.subcategory).length;
console.log(`\nScanned products:                  ${rows.length}`);
console.log(`Stored skincare:                   ${[...brandCount.values()].reduce((a, b) => a + b, 0)}`);
console.log(`Affected by this PR (OLD≠NEW):     ${commitAffected}`);
console.log(`  → already correct in DB (no-op): ${alreadyCorrect}`);
console.log(`  → ROWS TO UPDATE (skincare):     ${changes.length}  (of which subcategory changes: ${subOnly})`);
console.log(`  → stored makeup → reclassified:  ${enteredFromMakeup.length}  (guarded, reported only)`);
console.log(`  → stored skincare now excluded:  ${leftSkincare.length}  (reported only, not blanked)`);

console.log(`\nGlobal subcategory transitions among updated skincare rows:`);
for (const [k, v] of Object.entries(subTransition).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`);

console.log(`\nGlobal product_type transitions among updated skincare rows (top 15):`);
for (const [k, v] of Object.entries(ptTransition).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(v).padStart(6)}  ${k}`);

const fmt = (d: Dist) => SUBS.map((s) => `${s}:${d[s]}`).join("  ");
const top30 = [...brandCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log(`\nTop 30 skincare brands — BEFORE vs AFTER subcategory distribution:`);
console.log(`(rows changed = skincare rows this PR updates for that brand)\n`);
for (const [brand, n] of top30) {
  const b = ensure(before, brand), a = ensure(after, brand);
  const changed = changes.filter((c) => c.brand === brand && c.from.top_category === "skincare").length;
  const moved = changes.filter((c) => c.brand === brand && c.from.top_category === "skincare" && c.from.subcategory !== c.to.subcategory).length;
  console.log(`${brand}  (${n} skincare, ${moved} subcat moves / ${changed} rows updated)`);
  console.log(`   before  ${fmt(b)}`);
  console.log(`   after   ${fmt(a)}`);
}

console.log(`\nSample makeup→reclassified (guarded — review separately), first 15:`);
for (const c of enteredFromMakeup.slice(0, 15)) console.log(`  [${c.id}] ${c.brand} — ${c.name}\n        makeup/${c.from.product_type} → ${c.to.top_category}/${c.to.product_type}`);

// ── Emit artifacts (no DB writes) ────────────────────────────────────────────
const sqlStr = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const sqlArr = (a: string[]) => `ARRAY[${a.map(sqlStr).join(",")}]::text[]`;
writeFileSync(join(__dirname, ".subcategory-backfill.gen.json"), JSON.stringify(changes, null, 2));
const groups = new Map<string, { to: Cat; ids: number[] }>();
for (const c of changes) {
  const key = JSON.stringify([c.to.product_type, c.to.top_category, c.to.subcategory, c.to.tags]);
  if (!groups.has(key)) groups.set(key, { to: c.to, ids: [] });
  groups.get(key)!.ids.push(c.id);
}
const stmts: string[] = [];
for (const { to, ids } of groups.values()) {
  stmts.push(
    `update products set\n  category = ${sqlStr(to.product_type)},\n  product_type = ${sqlStr(to.product_type)},\n` +
    `  top_category = ${sqlStr(to.top_category!)},\n  subcategory = ${sqlStr(to.subcategory)},\n  tags = ${sqlArr(to.tags)}\n` +
    `where id in (${ids.sort((a, b) => a - b).join(",")});`,
  );
}
writeFileSync(join(__dirname, ".subcategory-backfill.gen.sql"), stmts.join("\n\n") + "\n");
console.log(`\nWrote scripts/.subcategory-backfill.gen.json (${changes.length} rows)`);
console.log(`Wrote scripts/.subcategory-backfill.gen.sql (${stmts.length} grouped UPDATE statements)`);
console.log(`\nDRY RUN — no database writes performed.`);
