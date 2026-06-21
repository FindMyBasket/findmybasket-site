/**
 * Annotate each excluded product with the EXACT denylist token that caught it,
 * grouped per bucket -> token -> products. Ground truth for the FP scan: the
 * regexes below are copied verbatim from _shared/categorisation.ts Step 1, and we
 * report match[0] of the bucket's regex against the same normalised name `t`.
 *
 * Run:  npx tsx scripts/recategorise-preview.mts && npx tsx scripts/annotate-excluded.mts
 * Output: scripts/.excluded-annotated.gen.md  (+ console grouped counts)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Regexes copied verbatim from _shared/categorisation.ts (Step 1 excludeChecks).
const RE: Record<string, RegExp> = {
  fragrance: /\b(fragrance|perfume|cologne|parfum|eau de (parfum|toilette)|edt|edp|aftershave splash|aftershave spray|aftershave cologne|after.?shave \d+\s*(ml|oz)\b|after.?shave (splash|spray|cologne))\b/,
  supplement: /\b(supplement|vitamin tablet|capsule|gummies|protein shake|meal replacement|powder drink|fish oil|cod liver oil|effervescent tablet)\b/,
  oral_care: /\b(toothpaste|toothbrush|mouthwash|dental floss|whitening strip)\b/,
  intimate_health: /\b(vaginal|vulva|feminine(?:\s+\w+){0,2}\s+(wash|hygiene|care|cleanser|moistur)|intimate(?:\s+\w+){0,2}\s+(wash|hygiene|care|cleanser|moistur)|thrush (cream|gel|treatment)|bv (treatment|relief|gel)|menocare|relactagel|canesfresh|canescool|canesten|sex toy|vibrator)\b/,
  deodorant: /\b(deodorant|antiperspirant|body spray)\b/,
  shaving: /\b(razor|shaving foam|shave gel|shave cream|epilator|wax strip)\b/,
  appliance: /\b(trimmer|clippers?|electric shaver|shaver|groomer|laser ?cap)\b/,
  eyewear: /\b(sunglasses?|eyewear|eyeglasses|spectacles|aviator|wayfarer|clubmaster|polari[sz]ed|anti.?reflective|oleophobic)\b|\b(rectangle|round|square|wrap|cat.?eye|oval|pilot|browline|rimless)\b.*\b\d{3,4}\s?\/\s?[a-z]\b|\b(ck\s?\d{4,5}s?|ft\s?\d{3,4}|sy\s?\d{4,5}|gg\s?\d{3,4}\s?s[a-z]?)\b/,
  apparel: /\b(trunks?|boxers|briefs|jockstrap|jumper|hoodie|sweatshirt|sweater|cardigan|joggers?|jeans?|trousers?|chinos?|leggings?|shorts?|pants?|fleece|shirt|t-shirt|tee|polo|blouse|jacket|blazer|gilet|waistcoat|parka|robe|kimono|pyjamas?|pajamas?|dungarees?|beanie|scarf|belt|sneakers?|trainers?|loafers?|brogues?|espadrilles?|sandals?|flip ?flop|cupsole|lace[-\s]?up|low top|rucksack|backpack|duffle|holdall|satchel|crossbody|commuter|wash ?bag|dopp|wallet|billfold|card holder|cardholder|card case)\b/,
  hair_tool: /\b(hair dryer|straightener|curling iron|curling wand|hair brush|paddle brush|bristle brush|boar bristle|comb|hair clip|hair tie|scrunchie|mason pearson)\b/,
  makeup_tool: /\b(makeup brush|beauty blender|sponge|eyelash curler|brush set|brush cleaner)\b/,
  bath_set: /\b(gift set|bath set|body care set|grooming set|skincare set)\b/,
  baby: /\b(baby (cream|lotion|wash|shampoo|wipes?|powder|oil|bath|skincare|sunscreen|sun cream)|babies|infant|newborn|toddler|nappy|diaper)\b/,
  accessory: /\b(headband|hair tie|spatula|applicator only|case only|bag only|pouch only|makeup pouch|cosmetic pouch)\b/,
};

const norm = (name: string) => String(name || "").toLowerCase().replace(/([a-z])(\d)/g, "$1 $2");

type Excluded = { id: number; name: string | null; brand: string | null; excluded: string };
const gen = JSON.parse(readFileSync(join(__dirname, ".recategorise-preview.gen.json"), "utf8"));
const excluded: Excluded[] = gen.all_excluded;

// reason -> matched-token -> [{id, name, brand}]
const grouped: Record<string, Record<string, { id: number; name: string; brand: string }[]>> = {};
for (const e of excluded) {
  const re = RE[e.excluded];
  const t = norm(e.name ?? "");
  const m = re ? re.exec(t) : null;
  const token = m ? m[0].trim() : "(no-match?)";
  grouped[e.excluded] ??= {};
  grouped[e.excluded][token] ??= [];
  grouped[e.excluded][token].push({ id: e.id, name: (e.name ?? "").trim(), brand: (e.brand ?? "").trim() });
}

const order = Object.entries(grouped).sort((a, b) =>
  Object.values(b[1]).flat().length - Object.values(a[1]).flat().length);

let md = "# Excluded products annotated by matched denylist token\n\n";
for (const [reason, tokens] of order) {
  const total = Object.values(tokens).flat().length;
  md += `\n## ${reason} (${total})\n\n`;
  const tokenOrder = Object.entries(tokens).sort((a, b) => b[1].length - a[1].length);
  for (const [token, items] of tokenOrder) {
    md += `### token \`${token}\` × ${items.length}\n`;
    for (const it of items) md += `- ${it.id} | ${it.brand || "—"} | ${it.name}\n`;
    md += "\n";
  }
}
writeFileSync(join(__dirname, ".excluded-annotated.gen.md"), md);

console.log("=== matched-token histogram per bucket ===");
for (const [reason, tokens] of order) {
  const total = Object.values(tokens).flat().length;
  const hist = Object.entries(tokens).sort((a, b) => b[1].length - a[1].length)
    .map(([tok, items]) => `${tok}:${items.length}`).join("  ");
  console.log(`\n${reason} (${total})\n  ${hist}`);
}
console.log("\nMD -> scripts/.excluded-annotated.gen.md");
