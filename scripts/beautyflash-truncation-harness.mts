/**
 * Local validation harness for reconstructBeautyFlashName() in
 *   supabase/functions/import-awin-feed/name-reconstruction.ts
 *
 * Run:  npx tsx scripts/beautyflash-truncation-harness.mts
 *
 * Two kinds of case:
 *   - rebuild: the name is truncated; the result must (a) differ from the input
 *     and (b) normalise to the full deslugified slug `expectFull`.
 *   - unchanged: the slug does NOT confirm a truncation (shorter, reordered,
 *     word dropped, or name too short) → result must equal the input verbatim.
 *
 * URLs use the RAW Beauty Flash merchant form (pre-AWIN-wrap), exactly what the
 * importer reads from `merchant_deep_link` for retailer 27.
 */

import { reconstructBeautyFlashName } from "../supabase/functions/import-awin-feed/name-reconstruction.ts";

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

type Case = {
  kind: "rebuild" | "unchanged";
  name: string;
  url: string;
  expectFull?: string; // for kind=rebuild: the expected full (display) name
  note?: string;
};

const BF = "https://www.beautyflash.co.uk/";

const CASES: Case[] = [
  // ── rebuild: the canonical Pattern-E example (dangling "&") ────────────────
  {
    kind: "rebuild",
    name: "CeraVe Renewing 10% Pure Vitamin C Serum with Ceramides for Brighter &",
    url: BF + "cerave-renewing-10-pure-vitamin-c-serum-with-ceramides-for-brighter-smoother-skin-30ml.html",
    expectFull: "CeraVe Renewing 10% Pure Vitamin C Serum with Ceramides for Brighter Smoother Skin 30ml",
    note: "dangling '&' truncation",
  },
  // ── rebuild: mid-word truncation ("…Sk") ───────────────────────────────────
  {
    kind: "rebuild",
    name: "CeraVe Renewing 10% Pure Vitamin C Serum with Ceramides for Brighter & Smoother Sk",
    url: BF + "cerave-renewing-10-pure-vitamin-c-serum-with-ceramides-for-brighter-smoother-skin-30ml.html",
    expectFull: "CeraVe Renewing 10% Pure Vitamin C Serum with Ceramides for Brighter Smoother Skin 30ml",
    note: "mid-word cut still confirmed via raw-prefix",
  },
  // ── rebuild: dangling "with" connector ─────────────────────────────────────
  {
    kind: "rebuild",
    name: "Medik8 Crystal Retinal 6 Stable Retinaldehyde Night Serum 30ml with",
    url: BF + "medik8-crystal-retinal-6-stable-retinaldehyde-night-serum-30ml-with-vitamin-e-and-hyaluronic-acid.html",
    expectFull: "Medik8 Crystal Retinal 6 Stable Retinaldehyde Night Serum 30ml With Vitamin E And Hyaluronic Acid",
    note: "dangling 'with' connector recovered",
  },

  // ── unchanged: slug is SHORTER (complete name, drops a middle word) ─────────
  {
    kind: "unchanged",
    name: "Alterna Caviar Anti-Aging Infinite Color Hold Dual-Use Serum 50ml",
    url: BF + "alterna-caviar-infinite-color-hold-dual-use-serum-50ml.html",
    note: "real row 105135 — slug shorter, must not rewrite",
  },
  // ── unchanged: slug INSERTS a word near the front (prefix fails) ────────────
  {
    kind: "unchanged",
    name: "Alterna Caviar Professional Styling Perfect Texture Spray 184g",
    url: BF + "alterna-anti-aging-caviar-professional-styling-perfect-texture-spray-184g.html",
    note: "real row 105131 — slug adds 'anti aging', prefix mismatch",
  },
  // ── unchanged: slug REORDERS ("Double" moved to front) ─────────────────────
  {
    kind: "unchanged",
    name: "Alterna My Hair. My Canvas. Begin Again Curl Cleanser 201ml Double",
    url: BF + "alterna-double-my-hair-my-canvas-begin-again-curl-cleanser-201-ml.html",
    note: "real row 105426 — reordered slug, prefix mismatch",
  },
  // ── unchanged: name complete and equal to slug (no growth) ─────────────────
  {
    kind: "unchanged",
    name: "Alterna Caviar Professional Styling Satin Rapid Blowout Balm 147ml",
    url: BF + "alterna-caviar-professional-styling-satin-rapid-blowout-balm-147ml.html",
    note: "real row 105132 — slug == name, nothing to add",
  },
  // ── unchanged: name too short to be a truncation candidate ─────────────────
  {
    kind: "unchanged",
    name: "CeraVe Hydrating Cleanser 88ml",
    url: BF + "cerave-hydrating-cleanser-with-ceramides-and-hyaluronic-acid-88ml.html",
    note: "<60 chars — not a candidate even though slug is longer",
  },
  // ── unchanged: no URL ──────────────────────────────────────────────────────
  {
    kind: "unchanged",
    name: "CeraVe Renewing 10% Pure Vitamin C Serum with Ceramides for Brighter &",
    url: "",
    note: "no merchant URL → cannot reconstruct",
  },
];

let pass = 0;
let fail = 0;
const fails: string[] = [];

for (const c of CASES) {
  const got = reconstructBeautyFlashName(c.name, c.url);
  let ok: boolean;
  if (c.kind === "unchanged") {
    ok = got === c.name;
  } else {
    ok = got !== c.name && norm(got) === norm(c.expectFull ?? "");
  }
  if (ok) pass++;
  else { fail++; fails.push(c.name); }
  console.log(`${ok ? "PASS " : "FAIL✗"} [${c.kind}] ${c.note ?? ""}`);
  if (!ok) {
    console.log(`        in:  ${c.name}`);
    console.log(`        got: ${got}`);
    if (c.kind === "rebuild") console.log(`        exp: ${c.expectFull}`);
  }
}

console.log("─".repeat(80));
console.log(`PASS ${pass}  /  FAIL ${fail}  (of ${CASES.length})`);
if (fail) process.exit(1);
