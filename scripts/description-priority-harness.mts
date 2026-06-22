/**
 * Local validation harness for the SHARED description helpers in
 *   supabase/functions/_shared/description.ts
 *   supabase/functions/_shared/strip-html.ts
 *
 * Both importers (import-awin-feed, import-rakuten-feed) import these same
 * modules, so passing here means both clean + prioritise descriptions
 * identically. The retailer-priority ordering is also mirrored by the SQL
 * function fmb_description_priority() in the migration — see description.ts.
 *
 * Run:  npx tsx scripts/description-priority-harness.mts
 */

import { stripHtml } from "../supabase/functions/_shared/strip-html.ts";
import {
  normaliseDescription,
  pickDescription,
  resolveDescription,
  descriptionPriority,
  DESCRIPTION_MAX_CHARS,
} from "../supabase/functions/_shared/description.ts";

// Live retailers.id values.
const BOOTS = 23, BEAUTY_FLASH = 27, ESCENTUAL = 8, ORGANIC_PHARMACY = 24,
  SUPERDRUG = 12, STYLEVANA = 11, YESSTYLE = 25, BRANDED_BEAUTY = 6, OTHER = 99;

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`FAIL: ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
}

// ── stripHtml ─────────────────────────────────────────────────────────────
check("strip basic tags", stripHtml("<p>Hello <b>world</b></p>"), "Hello world");
check("strip + decode entities", stripHtml("Tom &amp; Jerry&#39;s &nbsp; balm"), "Tom & Jerry's balm");
check("block tags become spaces", stripHtml("<li>one</li><li>two</li>"), "one two");
check("drop script body", stripHtml("keep<script>evil()</script> me"), "keep me");
check("collapse whitespace", stripHtml("a\n\n   b\t c"), "a b c");
check("numeric entity", stripHtml("caf&#233;"), "café");
check("empty input", stripHtml(""), "");
check("null input", stripHtml(null), "");

// ── normaliseDescription ────────────────────────────────────────────────────
check("normalise strips html", normaliseDescription("<p>A nice cream.</p>", "CeraVe Cream"), "A nice cream.");
check("whitespace-only → null", normaliseDescription("   \n  ", "X"), null);
check("empty → null", normaliseDescription("", "X"), null);
check("equals name → null", normaliseDescription("CeraVe Cream", "CeraVe Cream"), null);
check("equals name case/space-insensitive → null", normaliseDescription("  cerave cream ", "CeraVe Cream"), null);
check("caps at max", normaliseDescription("a".repeat(DESCRIPTION_MAX_CHARS + 500), "x")?.length, DESCRIPTION_MAX_CHARS);

// ── pickDescription (long preferred, short fallback) ────────────────────────
check("prefer long over short", pickDescription("Long form copy", "Short", "P"), "Long form copy");
check("fall back to short when no long", pickDescription("", "Short copy", "P"), "Short copy");
check("oversized long → use short", pickDescription("a".repeat(DESCRIPTION_MAX_CHARS + 10), "Short copy", "P"), "Short copy");
check("oversized long, no short → truncated long", pickDescription("a".repeat(DESCRIPTION_MAX_CHARS + 10), "", "P")?.length, DESCRIPTION_MAX_CHARS);
check("both empty → null", pickDescription("", "", "P"), null);

// ── descriptionPriority ordering ────────────────────────────────────────────
check("Boots beats Beauty Flash", descriptionPriority(BOOTS) < descriptionPriority(BEAUTY_FLASH), true);
check("Beauty Flash beats Escentual", descriptionPriority(BEAUTY_FLASH) < descriptionPriority(ESCENTUAL), true);
check("Escentual beats Organic Pharmacy", descriptionPriority(ESCENTUAL) < descriptionPriority(ORGANIC_PHARMACY), true);
check("Organic Pharmacy beats Superdrug", descriptionPriority(ORGANIC_PHARMACY) < descriptionPriority(SUPERDRUG), true);
check("Superdrug beats Stylevana", descriptionPriority(SUPERDRUG) < descriptionPriority(STYLEVANA), true);
check("Stylevana beats YesStyle", descriptionPriority(STYLEVANA) < descriptionPriority(YESSTYLE), true);
check("YesStyle beats Branded Beauty", descriptionPriority(YESSTYLE) < descriptionPriority(BRANDED_BEAUTY), true);
check("Branded Beauty beats other", descriptionPriority(BRANDED_BEAUTY) < descriptionPriority(OTHER), true);
check("unknown retailer → default", descriptionPriority(null), descriptionPriority(OTHER));

// ── resolveDescription (the acceptance-criteria scenarios) ──────────────────
// AC#2a: Boots desc set, then Stylevana different desc → Boots wins.
check("Boots then Stylevana → Boots wins",
  resolveDescription({ description: "Boots copy", retailerId: BOOTS }, { description: "Stylevana copy", retailerId: STYLEVANA }),
  "Boots copy");
// AC#2b: no desc, then Beauty Flash → Beauty Flash populates.
check("null then Beauty Flash → populates",
  resolveDescription({ description: null, retailerId: null }, { description: "Beauty Flash copy", retailerId: BEAUTY_FLASH }),
  "Beauty Flash copy");
// Higher-priority incoming overwrites lower-priority current.
check("Stylevana then Boots → Boots overwrites",
  resolveDescription({ description: "Stylevana copy", retailerId: STYLEVANA }, { description: "Boots copy", retailerId: BOOTS }),
  "Boots copy");
// Equal priority (same retailer re-import) overwrites → refresh on re-run.
check("same retailer re-import overwrites",
  resolveDescription({ description: "old", retailerId: BOOTS }, { description: "new", retailerId: BOOTS }),
  "new");
// Lower-priority incoming does NOT overwrite.
check("lower-priority incoming kept out",
  resolveDescription({ description: "Superdrug copy", retailerId: SUPERDRUG }, { description: "YesStyle copy", retailerId: YESSTYLE }),
  "Superdrug copy");
// Empty current always filled regardless of priority.
check("empty current filled by any source",
  resolveDescription({ description: "", retailerId: null }, { description: "Other copy", retailerId: OTHER }),
  "Other copy");
// Null incoming never clobbers a real current.
check("null incoming keeps current",
  resolveDescription({ description: "keep me", retailerId: STYLEVANA }, { description: null, retailerId: BOOTS }),
  "keep me");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
