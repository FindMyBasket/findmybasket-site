/**
 * Classify the create-candidates with THE OPERATIVE FUNCTION.
 *
 * import-rakuten-feed/index.ts:531 calls inferCategorisationForImport(name, brand) and
 * nothing else. This imports that exact function rather than re-expressing what it
 * appears to do -- item 499's lesson, and the only way the answer here is the answer the
 * importer will give.
 *
 * WHY THIS EXISTS: the dry run reports category COUNTS for new products and does not join
 * them to the row, so "157 land outside fragrance" cannot be turned into "these 157".
 * A gift set of body products classified as fragrance is the error to look for; the
 * reverse is fine. Only the names separate them, and a sample of 20 cannot. Item 535.
 *
 * READ ONLY. Reads a JSON array of {name, brand} and prints. Writes nothing anywhere.
 */
import { readFileSync } from 'node:fs';
import { inferCategorisationForImport } from '../../supabase/functions/_shared/categorisation.ts';

const rows: { name: string; brand: string }[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const NOT_PERFUME =
  /\b(body spray|body mist|body cream|body lotion|body wash|shower gel|gift set|after ?shave|deodorant|antiperspirant|advent calendar|candle|hand cream|soap|talc|bath)\b/i;

const landed = rows.map(r => {
  const c = inferCategorisationForImport(r.name, r.brand);
  return { ...r, top: c.excluded ? `EXCLUDED:${c.excluded}` : (c.top_category ?? 'null'),
           type: (c as any).product_type ?? '' };
});

const tally = new Map<string, number>();
for (const l of landed) tally.set(l.top, (tally.get(l.top) ?? 0) + 1);
console.log('## Where every create-candidate lands — the operative function, not a name read\n');
console.log('```');
console.log(`candidates classified   ${landed.length}`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${v}`);
console.log('```\n');

const odd = landed.filter(l => NOT_PERFUME.test(l.name));
console.log(`## The ${odd.length} whose NAME is not perfume, and where each actually lands\n`);

// THE ERROR TO LOOK FOR, stated as a rule rather than left to the reader: a name that is
// a body/bath product landing in fragrance. The reverse -- a fragrance gift set landing
// in bath_body -- is arguable and is listed separately rather than flagged.
const BODY_ONLY =
  /\b(body spray|body mist|body cream|body lotion|body wash|shower gel|deodorant|antiperspirant|hand cream|soap|talc)\b/i;
const wrong = odd.filter(l => BODY_ONLY.test(l.name) && l.top === 'fragrance');

console.log('```');
console.log(`name is not perfume            ${odd.length}`);
console.log(`  CLEARLY WRONG                ${wrong.length}   body/bath product classified fragrance`);
console.log(`  arguable (gift sets etc.)    ${odd.length - wrong.length}`);
console.log('```\n');

if (wrong.length) {
  console.log('### Clearly wrong — a body or bath product in fragrance\n');
  for (const l of wrong) console.log(`  ! ${l.brand.slice(0, 16).padEnd(18)} ${l.name.slice(0, 72).padEnd(74)} ${l.top}`);
  console.log();
}

console.log('### All of them, by where they landed\n');
const byTop = new Map<string, typeof odd>();
for (const l of odd) { if (!byTop.has(l.top)) byTop.set(l.top, [] as any); byTop.get(l.top)!.push(l); }
for (const [top, list] of [...byTop].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n**${top} — ${list.length}**\n`);
  for (const l of list.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${l.brand.slice(0, 16).padEnd(18)} ${l.name.slice(0, 76)}`);
  }
}
