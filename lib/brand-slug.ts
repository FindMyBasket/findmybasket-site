// Brand slug derivation, in its own module SO IT CAN BE TESTED.
//
// It previously lived in lib/queries.ts, which imports the Supabase client -- so any test
// touching brandSlug pulled a database dependency into the test runner and failed to resolve.
// MOVED, NOT COPIED: a second implementation is the drift hazard item 267 records, where two
// expressions of one rule become two rules and the disagreement surfaces on a page. queries.ts
// re-exports from here, so every existing import is unchanged. Item 271.
//
// THIS FUNCTION IS THE REASON A RENAME ORPHANS A URL: the slug is DERIVED from the brand
// string and nothing stores it, so changing the brand changes the address. brand_aliases is
// what recovers the old one -- see resolveBrandAliasSlug in lib/brand-queries.ts.
// ── ACCENTED LETTERS ARE FOLDED, NOT DELETED ────────────────────────────────────
//
// Until 26 August 2026 `[^a-z0-9]+ -> '-'` DELETED every accented character, so:
//
//     Lancôme               ->  /brands/lanc-me
//     Kérastase             ->  /brands/k-rastase
//     L'Oréal Paris         ->  /brands/lor-al-paris
//     Âme Pure              ->  /brands/me-pure      (the Â took the word's first letter)
//
// 44 brands and 3,355 products sat on unsearchable canonical URLs, three of them
// among the largest in the catalogue. Work-list items 361 and 369.
//
// SAME ROOT AS ITEMS 355 AND 371 -- an ASCII-only character class meeting non-ASCII
// supplier data. This was the last of the three: stripBrandPrefix (titles),
// normaliseForMatch (matching), and now this one (URLs). Until today brandSlug and
// normaliseForMatch mangled accents IDENTICALLY; the 26 Aug fold changed the matcher
// and left this one behind, so the catalogue was normalised two ways depending on
// which surface asked. That divergence is the argument for this change.
const FOLD_FROM = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸšŠžŽøØåÅßñÑ';
const FOLD_TO   = 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYYsSzZoOaAsnN';

function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const i = FOLD_FROM.indexOf(ch);
    out += i === -1 ? ch : FOLD_TO[i];
  }
  return out;
}

export function brandSlug(brand: string): string {
  return fold(brand)
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The slug this brand produced BEFORE 26 August 2026 — accents deleted rather than
 * folded. Kept so old URLs can be recognised and 301'd.
 *
 * ── WHY THIS LIVES IN CODE AND NOT IN brand_aliases ─────────────────────────────
 *
 * The obvious alternative was 25 alias rows. It does not work: resolveBrandAliasSlug
 * matches `brandSlug(alias) === incoming`, computed with the CURRENT function, so
 * after this change `brandSlug('lancôme')` returns `lancome` and nothing catches
 * `/brands/lanc-me`. Making it work would mean storing an alias string like
 * `'lanc me'` — DATA SHAPED TO WORK AROUND CODE, meaningless to anyone reading the
 * table, and one row per brand forever.
 *
 * This version also covers brands ONBOARDED LATER. A row-per-brand approach cannot:
 * every future accented brand would need someone to remember to add its row.
 *
 * ── AND IT IS PERMANENT, WHICH IS ACCEPTED RATHER THAN TOLERATED ────────────────
 *
 * Old URLs exist indefinitely in Google's index and in inbound links, so ANYTHING
 * that resolves them is permanent wherever it lives. Putting it in code makes that
 * visible; putting it in rows would have made it look like a migration that finishes.
 */
export function legacyBrandSlug(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
