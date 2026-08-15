#!/usr/bin/env node
/**
 * AWIN weekly performance puller. Dashboard brief Step 4.
 *
 * Reads GET /publishers/{pub}/reports/advertiser one ISO week at a time and upserts
 * metrics_awin_weekly at its natural grain: one row per (week_start, advertiser_id, region).
 *
 * ENV
 *   AWIN_OAUTH_TOKEN   the REPORTING credential. Never AWIN_API_KEY, which is the FEED
 *                      credential read by eight live paths against productdata.awin.com;
 *                      sending it here would not work, and overwriting it breaks imports.
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   upsert target
 *   DRY_RUN            anything but the literal "false" = no write
 *   WEEKS              trailing ISO weeks to re-pull, 1..16, default 12
 *   REGION             AWIN region code, default GB
 *
 * WHY A 12-WEEK TRAILING WINDOW, AGAINST GA4'S 4. GA4 lags 24 to 48 hours. AWIN lags
 * WEEKS: a sale is pending, then approved or declined, and the week's figures keep moving
 * the whole time. Boots on 15 August showed 3 pending and 0 confirmed against 117 clicks --
 * a whole month of activity still unsettled. Re-pulling only the closed week would freeze
 * every figure at its most provisional value.
 *
 * Upserting on (week_start, advertiser_id, region) means a later run CORRECTS an earlier
 * one rather than appending a second version of the same week.
 */

const API = 'https://api.awin.com';
const PUBLISHER = 2841268; // supabase/functions/import-awin-feed/index.ts:265

const TOKEN = process.env.AWIN_OAUTH_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Anything but the literal string "false" is a dry run, so a typo fails SAFE.
const DRY_RUN = process.env.DRY_RUN !== 'false';
const WEEKS = Math.min(16, Math.max(1, Number(process.env.WEEKS || 12)));
const REGION = process.env.REGION || 'GB';

const die = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };

if (!TOKEN) die('AWIN_OAUTH_TOKEN is required');
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  die('SUPABASE_URL and SUPABASE_SERVICE_KEY are required unless DRY_RUN');
}

// ── weeks ───────────────────────────────────────────────────────────────────
// ISO weeks, Monday-start, to match metrics_ga4_weekly and metrics_quality_weekly.
function mondayOf(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Mon=0
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}
const iso = (d) => d.toISOString().slice(0, 10);

function trailingWeeks(from, n) {
  const out = [];
  let m = mondayOf(from);
  for (let i = 0; i < n; i++) {
    const start = new Date(m);
    const end = new Date(m);
    end.setUTCDate(end.getUTCDate() + 6);
    out.push({ start: iso(start), end: iso(end) });
    m.setUTCDate(m.getUTCDate() - 7);
  }
  return out.reverse();
}

// ── the call ────────────────────────────────────────────────────────────────
/**
 * THE PARAMETER IS `region`, SINGULAR — AND THE API'S OWN ERROR MESSAGE NAMES A
 * PARAMETER THAT DOES NOT WORK.
 *
 * Omitting it, or sending regionCodes / regionCode / regionCodes[] / regionCodes=[GB] /
 * regionCodes=GB,IE, all return the IDENTICAL 400:
 *
 *     {"error":"invalid.userinput",
 *      "description":"invalid region code list, expecting sth. like [FR,CA,DE]: []"}
 *
 * Seven variants were tried before `region=GB` returned 200. The message names
 * "region code list" and demands a bracketed list; the working parameter is a bare
 * singular code. DO NOT "correct" this to regionCodes on the strength of the error text —
 * that is precisely what the error text invites, and it is wrong.
 *
 * The 31-day cap that bites the transactions endpoint does NOT apply here; this is called
 * one week at a time regardless, so each row is attributable to exactly one week.
 */
async function fetchWeek(week) {
  const url =
    `${API}/publishers/${PUBLISHER}/reports/advertiser` +
    `?startDate=${week.start}&endDate=${week.end}&timezone=UTC&region=${REGION}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  const body = await res.text();
  if (!res.ok) {
    die(`AWIN ${res.status} for week ${week.start}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
}

// AWIN allows 20 calls per minute. Twelve weeks is twelve calls, so this is well inside
// the limit; the pause exists so a widened WEEKS cannot silently start throttling.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── run ─────────────────────────────────────────────────────────────────────
const weeks = trailingWeeks(new Date(), WEEKS);

console.log(`AWIN weekly pull — publisher ${PUBLISHER}, region ${REGION}`);
console.log(`weeks: ${weeks.length} (${weeks[0].start} .. ${weeks[weeks.length - 1].start})`);
console.log(`mode: ${DRY_RUN ? 'DRY RUN, nothing will be written' : 'WRITE'}\n`);

const rows = [];
for (const w of weeks) {
  const recs = await fetchWeek(w);
  for (const r of recs) {
    rows.push({
      week_start: w.start,
      advertiser_id: r.advertiserId,
      region: r.region,
      advertiser_name: r.advertiserName ?? null,
      currency: r.currency ?? null,
      impressions: r.impressions ?? null,
      clicks: r.clicks ?? null,
      pending_no: r.pendingNo ?? null,
      pending_value: r.pendingValue ?? null,
      pending_comm: r.pendingComm ?? null,
      confirmed_no: r.confirmedNo ?? null,
      confirmed_value: r.confirmedValue ?? null,
      confirmed_comm: r.confirmedComm ?? null,
      bonus_no: r.bonusNo ?? null,
      bonus_value: r.bonusValue ?? null,
      bonus_comm: r.bonusComm ?? null,
      declined_no: r.declinedNo ?? null,
      declined_value: r.declinedValue ?? null,
      declined_comm: r.declinedComm ?? null,
      total_no: r.totalNo ?? null,
      total_value: r.totalValue ?? null,
      total_comm: r.totalComm ?? null,
    });
  }
  console.log(`  ${w.start} .. ${w.end}   ${recs.length} advertiser row(s)`);
  await sleep(400);
}

console.log('');
const fmt = (n) => (n === null || n === undefined ? '-' : String(n));
console.log('week        advertiser                 clicks  pend#  pend£   conf#  conf£   comm£');
console.log('-'.repeat(84));
for (const r of rows.filter((x) => (x.clicks ?? 0) > 0 || (x.total_no ?? 0) > 0)) {
  console.log(
    `${r.week_start}  ${(r.advertiser_name ?? '').slice(0, 24).padEnd(24)} ` +
    `${fmt(r.clicks).padStart(6)} ${fmt(r.pending_no).padStart(6)} ${fmt(r.pending_value).padStart(7)} ` +
    `${fmt(r.confirmed_no).padStart(6)} ${fmt(r.confirmed_value).padStart(7)} ${fmt(r.total_comm).padStart(7)}`
  );
}

console.log(`\n${rows.length} rows across ${weeks.length} weeks.`);
console.log(
  'Rows with zero clicks AND zero transactions are still written: an advertiser that ' +
  'produced nothing in a week is a fact about that week, not an absence of data.'
);

if (DRY_RUN) {
  console.log('\nDRY RUN: nothing written. Set DRY_RUN=false to upsert.');
  process.exit(0);
}

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/metrics_awin_weekly?on_conflict=week_start,advertiser_id,region`,
  {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      // merge-duplicates makes this an UPSERT on the composite key, which is what lets a
      // later run correct a provisional week instead of appending a second version of it.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }))),
  }
);

if (!res.ok) die(`upsert failed ${res.status}: ${(await res.text()).slice(0, 400)}`);
console.log(`\nUpserted ${rows.length} rows into metrics_awin_weekly.`);
