/**
 * Brand-alias mapping → SQL generator (one-off, brand canonicalisation work).
 *
 * Single source of truth for THIS SESSION's alias→canonical decisions (the user
 * mapping + all conflict resolutions + L'Oréal cluster + Kérastase + Lancôme +
 * Garnier sub-ranges). Aliases are lowercased on output to match the live table
 * (PK on raw `alias`, lookup is LOWER(alias)=LOWER(input)).
 *
 * Modes:
 *   node scripts/brand-aliases-build.mjs preview  → one read-only preview query
 *   node scripts/brand-aliases-build.mjs insert   → INSERT ... ON CONFLICT DO NOTHING
 *   node scripts/brand-aliases-build.mjs repoint  → UPDATE canonicals that change (Group A)
 *   node scripts/brand-aliases-build.mjs values   → just the (alias,canonical) VALUES rows
 *
 * Final canonical decisions baked in:
 *   - Group A (my canonical replaces existing): COSRX, medicube, mixsoon,
 *     numbuzin, haruharu wonder, St Moriz, St Tropez, Dr Organic, Lancôme
 *   - Group B (existing kept): MISSHA, LANEIGE, Tonymoly, FRUDIA, Dr. Ceuracle,
 *     BarberPro  (+ new alias tony moly → Tonymoly)
 *   - L'Oréal Paris (accent kept) consolidates Loreal/L'Oreal/Men Expert/etc.
 *   - L'Oréal Professionnel: new separate canonical (accent)
 *   - Kérastase: new canonical (accent)
 *   - Garnier: fold Pure Active / Body sub-ranges
 */

// canonical → [aliases]. Canonical's own lowercased form is auto-added as a self-alias.
const MAP = [
  ["Kose", ["KOSE"]],
  ["Shiseido", ["SHISEIDO", "[DEAL]Shiseido"]],
  ["Rohto Mentholatum", ["ROHTO MENTHOLATUM"]],
  ["MISSHA", ["Missha"]],                                   // Group B: existing kept
  ["Etude", ["ETUDE"]],
  ["TirTir", ["Tir Tir", "TIRTIR"]],
  ["Dior", ["DIOR"]],
  ["Skin1004", ["SKIN1004"]],
  ["M.A.C", ["MAC"]],
  ["LANEIGE", ["Laneige"]],                                 // Group B: existing kept
  ["Some By Mi", ["SOME BY MI"]],
  ["Round Lab", ["ROUND LAB", "Roundlab"]],
  ["Clio", ["CLIO"]],
  ["Judydoll", ["JUDYDOLL"]],
  ["Skinfood", ["SKINFOOD"]],
  ["Rituals", ["RITUALS"]],
  ["Dariya", ["DARIYA"]],
  ["A'pieu", ["A'PIEU", "A´Pieu"]],
  ["Bioderma", ["BIODERMA"]],
  ["Kérastase", ["KERASTASE", "Kerastase"]],                // new canonical, accent
  ["Joocyee", ["JOOCYEE"]],
  ["Abib", ["ABIB"]],
  ["Nails Inc", ["Nails.Inc"]],
  ["Isntree", ["ISNTREE"]],
  ["Anua", ["ANUA"]],
  ["Sana", ["SANA"]],
  ["Arencia", ["ARENCIA"]],
  ["Laka", ["LAKA"]],
  ["Erborian", ["ERBORIAN"]],
  ["Fenty Beauty", ["FENTY BEAUTY"]],
  ["Nature Republic", ["NATURE REPUBLIC"]],
  ["MediPeel", ["MEDIPEEL"]],
  ["Origins", ["ORIGINS"]],
  ["Unleashia", ["UNLEASHIA"]],
  ["Sungboon Editor", ["SUNGBOON EDITOR"]],
  ["BPerfect", ["Bperfect"]],
  ["Beauty of Joseon", ["Beauty Of Joseon", "BEAUTY OF JOSEON"]],
  ["Sol de Janeiro", ["Sol De Janeiro"]],
  ["CNP Laboratory", ["CNP LABORATORY"]],
  ["Biodance", ["BIODANCE"]],
  ["Dr. Althea", ["DR.ALTHEA"]],
  ["FRUDIA", ["Frudia"]],                                   // Group B: existing kept
  ["innisfree", ["Innisfree"]],
  ["peripera", ["Peripera"]],
  ["fwee", ["Fwee", "FWEE"]],
  ["dasique", ["Dasique", "DASIQUE"]],
  ["numbuzin", ["Numbuzin", "NUMBUZIN"]],                   // Group A: my lowercase wins
  ["medicube", ["Medicube", "MEDICUBE"]],                   // Group A
  ["mixsoon", ["Mixsoon", "MIXSOON"]],                      // Group A
  ["haruharu wonder", ["Haruharu Wonder", "HaruHaru Wonder", "HARUHARU WONDER"]], // Group A
  ["rom&nd", ["Rom & Nd", "ROM&ND"]],
  ["I'm from", ["I'm From", "I'M FROM"]],
  ["e.l.f.", ["E.L.F", "e.l.f", "Elf"]],
  ["Tonymoly", ["Tony Moly"]],                              // Group B: existing kept
  ["bareMinerals", ["Bare Minerals"]],
  ["COSRX", ["Cosrx", "CosRx", "CosRX"]],                   // Group A
  ["Dr. Jart+", ["Dr Jart"]],
  ["MoYou London", ["MoYou-London"]],
  ["âme pure", ["âme pure UK"]],
  ["Palmer's", ["Palmers"]],
  ["Child's Farm", ["Childs Farm"]],
  ["Dr. Ceuracle", ["Dr Ceuracle"]],                        // Group B: existing kept
  ["Dr. Melaxin", ["Dr.Melaxin"]],
  ["St Moriz", ["St. Moriz"]],                              // Group A
  ["St Tropez", ["St.Tropez"]],                             // Group A
  ["St Ives", ["St. Ives"]],
  ["Dr Organic", ["Dr. Organic"]],                          // Group A
  ["Johnson's", ["Johnsons"]],
  ["Pastel Cosmetics", ["Pastel Cosmetics UK"]],
  ["BarberPro", ["Barber Pro"]],                            // Group B: existing kept
  ["Makeup Academy", ["MUA Makeup Academy"]],
  ["Oh K!", ["Oh K"]],
  ["Wright's", ["Wrights"]],
  ["King C. Gillette", ["King C Gillette"]],
  ["So...?", ["So…?"]],
  // L'Oréal cluster
  ["L'Oréal Paris", ["L'OREAL PARIS", "Loreal", "L'Oreal", "Loreal Paris", "L'Oreal Men Expert", "L'Oréal", "L'Oreal Men"]],
  ["L'Oréal Professionnel", ["L'Oreal Professionnel"]],
  ["Lancôme", ["Lancome"]],                                 // Group A: replace existing Lancome
  ["Garnier", ["Garnier Pure Active", "Garnier Body"]],     // fold sub-ranges
];

// Flatten to (alias_lowercased, canonical) pairs; add canonical self-alias.
const pairs = [];
const seen = new Set();
for (const [canonical, aliases] of MAP) {
  for (const a of [...aliases, canonical]) {
    const key = a.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([key, canonical]);
  }
}

const q = (s) => `'${s.replace(/'/g, "''")}'`;
const valuesRows = pairs.map(([a, c]) => `(${q(a)}, ${q(c)})`).join(",\n  ");
const mode = process.argv[2] || "preview";

if (mode === "values") {
  process.stdout.write(valuesRows + "\n");
} else if (mode === "insert") {
  process.stdout.write(
`insert into brand_aliases (alias, canonical) values
  ${valuesRows}
on conflict (alias) do nothing;
`);
} else if (mode === "repoint") {
  // Group A: existing alias rows whose canonical must change. Driven by sm vs live.
  process.stdout.write(
`with sm(alias, canonical) as (values
  ${valuesRows}
)
update brand_aliases b set canonical = sm.canonical
from sm
where lower(b.alias) = sm.alias and b.canonical <> sm.canonical;
`);
} else { // preview
  process.stdout.write(
`with sm(alias, canonical) as (values
  ${valuesRows}
),
chg as (
  select p.id, p.brand as from_brand, sm.canonical as to_canon
  from products p join sm on lower(p.brand) = sm.alias
  where p.brand <> sm.canonical
)
select 'TOTAL_PRODUCTS' as section, ''::text as a, ''::text as b, count(*) as n from chg
union all
select 'BREAKDOWN', from_brand, to_canon, count(*) from chg group by from_brand, to_canon
union all
select 'ALIASES_ADDED','','', count(*) from sm where not exists (select 1 from brand_aliases x where lower(x.alias)=sm.alias)
union all
select 'ALIASES_REPOINTED','','', count(*) from sm join brand_aliases x on lower(x.alias)=sm.alias where x.canonical <> sm.canonical
union all
select 'SAFETY_alias_maps_multi_canon', sm.alias, '', count(*) from sm group by sm.alias having count(*) > 1
order by section, n desc;
`);
}
