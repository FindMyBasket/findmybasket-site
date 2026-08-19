/**
 * BRAND-HUB PROGRAMME CHECK. Work-list item 226.
 *
 * Asks one question of every brand hub: IS THE MERCHANT IT LINKS TO STILL A JOINED PROGRAMME?
 *
 * ── WHY IT DOES NOT FOLLOW THE LINKS ─────────────────────────────────────────────────
 *
 * RESOLVING AN AFFILIATE LINK REGISTERS A CLICK. A weekly probe over every hub manufactures
 * clicks that can never convert, in the same publisher account whose figures this project pulls
 * into metrics_awin_weekly -- it would corrupt the data it sits beside and degrade the publisher
 * metrics the network judges us by.
 *
 *   A MONITORING PROBE THAT TRAVERSES A METERED PATH BECOMES PART OF WHAT IT MEASURES.
 *
 * A resolution probe remains the right MANUAL confirmation for a single link when a finding needs
 * corroborating. The distinction is a diagnostic somebody runs versus a standing check that runs
 * itself, and only the second must be free of side effects.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────────────
 *
 * A brand relationship ends with NO DATABASE EVENT: no retailer leaves, no active flip, no
 * catalogue change. The only observable is an outbound link quietly changing where it lands --
 * and it lands on an HTTP 200. The departure doctrine correctly does not cover this, which is
 * exactly why nothing detected Abib's closure (item 224).
 *
 * Item 194's form: exit 0 for ok or findings, exit 1 only for cannot_run.
 */
import { extractMerchantIds, findClosedProgrammeLinks } from '../lib/brand-hub-programmes.ts';

const CHECK_NAME = 'brand-hub-programmes';
const PUB = process.env.AWIN_PUBLISHER_ID || 2841268; // scripts/awin-weekly-pull.mjs:28
const OAUTH = process.env.AWIN_OAUTH_TOKEN;
const SB = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;
const WRITE = process.argv.includes('--write-findings');

for (const [n, v] of [['AWIN_OAUTH_TOKEN', OAUTH], ['SUPABASE_URL', SB], ['SUPABASE_SERVICE_KEY', SKEY]]) {
  if (!v) { console.error(`CANNOT RUN: ${n} is not set`); process.exit(1); }
}

const sb = async (path, init) => {
  const r = await fetch(`${SB}/rest/v1/${path}`,
    { ...init, headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!r.ok) { console.error(`CANNOT RUN: supabase ${r.status} on ${path.split('?')[0]}`); process.exit(1); }
  return r.status === 204 ? null : r.json();
};

const hubs = await sb('brand_hubs?select=slug,body_html,offer&limit=1000');
const pr = await fetch(`https://api.awin.com/publishers/${PUB}/programmes?relationship=joined`,
  { headers: { Authorization: `Bearer ${OAUTH}`, Accept: 'application/json' } });
if (!pr.ok) { console.error(`CANNOT RUN: programmes ${pr.status}`); process.exit(1); }
const programmes = await pr.json();
// An empty programme list is not "nothing is joined" -- it is far more likely a broken read, and
// treating it as data would report every hub as closed on its first bad response.
if (!Array.isArray(programmes) || programmes.length === 0) {
  console.error('CANNOT RUN: joined-programmes list is empty; refusing to report every hub as closed');
  process.exit(1);
}
const joined = new Set(programmes.map((p) => String((p.programmeInfo ?? p).id)));

const refs = hubs.flatMap((h) => extractMerchantIds(h));
const findings = findClosedProgrammeLinks(refs, joined);

console.log('==================================================================');
console.log(' Brand-hub programme check');
console.log('==================================================================\n');
console.log(`  joined programmes        : ${joined.size}`);
console.log(`  brand hubs               : ${hubs.length}`);
console.log(`  outbound merchant links  : ${refs.length}`);
for (const r of refs) console.log(`    /brands/${r.slug} -> merchant ${r.merchantId} (${r.source})  ${joined.has(r.merchantId) ? 'joined' : 'NOT JOINED'}`);
console.log(`\n  findings                 : ${findings.length}`);
for (const f of findings) console.log(`    ${f.summary}`);

if (WRITE) {
  const esc = (s) => String(s).replace(/'/g, "''");
  for (const f of findings) {
    await sb('standing_check_findings?on_conflict=check_name,finding_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ check_name: CHECK_NAME, finding_key: f.key, kind: 'finding', summary: f.summary, status: 'open' }),
    });
  }
  // Coverage: one line, never per row, never escalates. Asserted rather than omitted, because
  // silence would read identically to "no hubs have outbound links".
  await sb('standing_check_findings?on_conflict=check_name,finding_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      check_name: CHECK_NAME, finding_key: 'coverage:links', kind: 'coverage', status: 'open',
      summary: `${refs.length} outbound merchant link(s) across ${hubs.length} brand hub(s) checked against joined programmes.`,
      detail: { hubs: hubs.length, links: refs.length, joined_programmes: joined.size },
    }),
  });
  console.log('\n  findings and coverage recorded.');
} else {
  console.log('\n  (--write-findings not passed; nothing recorded)');
}
console.log(`\nRESULT: ${findings.length ? `${findings.length} finding(s) reported` : 'ok'}. No links were followed; no clicks generated.`);
process.exit(0);
