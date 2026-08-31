/**
 * EVERY NON-NULL retailers.logo_path MUST RESOLVE TO A FILE IN public/.
 *
 * The homepage strip renders `<img src={'/' + logo_path}>` for every listed retailer that
 * has one. A path pointing at a file that is not in the repository does not fail the
 * build, does not throw at runtime, and does not show up in any measurement -- it renders
 * as a broken image or as alt text on the first screen of the homepage. Item 530.
 *
 * THE DIRECTORY IS NOT THE SOURCE OF TRUTH AND THIS CHECK DOES NOT MAKE IT ONE. It only
 * asks whether each path the DATABASE names exists. public/logos holds 29 files, 12
 * matching no live retailer, four of them retailers whose affiliate programmes closed --
 * so extra files are expected and are not an error. The check is one-directional on
 * purpose.
 *
 * IT FAILS WHEN IT CANNOT LOOK. Item 194's contract: exit 2 is cannot_run, distinct from
 * exit 1, which means it looked and found a path with no file. An empty retailer list is
 * cannot_run, not a pass -- a query returning nothing must never read as "all fine".
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('::error::SUPABASE_URL / SUPABASE_SERVICE_KEY not set — cannot_run');
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from('retailers')
  .select('name, logo_path, active, unlisted_reason');

if (error) {
  console.error(`::error::query failed: ${error.message} — cannot_run`);
  process.exit(2);
}
if (!data || data.length === 0) {
  console.error('::error::retailers returned 0 rows — cannot_run');
  process.exit(2);
}

const listed = data.filter(r => r.active === true && r.unlisted_reason === null);
if (listed.length === 0) {
  console.error('::error::0 listed retailers — cannot_run, not a pass');
  process.exit(2);
}

const withLogo = listed.filter(r => r.logo_path);
const missing = withLogo.filter(r => !existsSync(`public/${r.logo_path}`));
const withoutLogo = listed.filter(r => !r.logo_path);

console.log(`${listed.length} listed retailers, ${withLogo.length} with a logo_path.`);

// NOT AN ERROR, BUT SAID OUT LOUD. The strip silently shows fewer marks than the count
// claims, and silence is how that becomes permanent.
for (const r of withoutLogo) {
  console.log(`  note: ${r.name} is counted and not pictured (logo_path is null)`);
}

if (missing.length) {
  for (const r of missing) {
    console.error(`::error::${r.name}: logo_path "${r.logo_path}" has no file at public/${r.logo_path}`);
  }
  console.error(`${missing.length} logo path(s) point at files that are not in the repository.`);
  process.exit(1);
}

console.log('All logo paths resolve.');
