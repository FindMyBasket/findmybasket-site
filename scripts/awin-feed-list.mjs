/**
 * AWIN FEED LIST — which feed ids does this account actually see, and whose are they.
 *
 * WHY THIS EXISTS, AND IT IS ITEM 482's LESSON WITH A ROTATION BEHIND IT.
 *
 * A feed id is a number somebody reads off a screen and types into a config. Two things then
 * look identical and are not:
 *
 *   the id is wrong and 404s          -> loud, and the import stops (Healf's fid=521, item 483:
 *                                        it was a Darwin URL, not a fid, and a CONFIRMATION IS
 *                                        NOT A VERIFICATION)
 *   the id is wrong and DOWNLOADS     -> silent, and every figure is confidently mislabelled,
 *                                        because the account can see many advertisers' feeds
 *
 * feed-diag.yml proves a feed EXISTS and is downloadable. It cannot prove WHOSE it is: the columns
 * it requests carry no merchant_name or merchant_id, so a feed belonging to another advertiser
 * passes every check it makes. This script answers the other half from AWIN's own list endpoint —
 * the mapping is READ rather than typed.
 *
 * WRITES NOTHING. One GET, prints, exits.
 *
 *   AWIN_API_KEY=… node scripts/awin-feed-list.mjs --advertiser 53381
 *   AWIN_API_KEY=… node scripts/awin-feed-list.mjs --fid 116878
 */
const KEY = process.env.AWIN_API_KEY;
if (!KEY) { console.error('cannot_run: AWIN_API_KEY is unset'); process.exit(1); }

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const advertiser = arg('advertiser');
const fid = arg('fid');
if (!advertiser && !fid) { console.error('cannot_run: pass --advertiser <id> and/or --fid <id>'); process.exit(1); }

const r = await fetch(`https://productdata.awin.com/datafeed/list/apikey/${KEY}`);
if (!r.ok) { console.error(`cannot_run: datafeed list ${r.status}`); process.exit(1); }
const csv = await r.text();

// An error page returns 200 with HTML. A list that is not a list is not an empty account.
if (!/advertiser\s*id/i.test(csv.split('\n')[0] ?? '')) {
  console.error('cannot_run: response is not the datafeed list (no "Advertiser ID" header)');
  process.exit(1);
}

const [head, ...rows] = csv.trim().split('\n');
const cols = head.split(',').map((c) => c.replace(/"/g, '').trim());
const idx = (n) => cols.findIndex((c) => c.toLowerCase() === n.toLowerCase());
const parse = (line) => (line.match(/("([^"]*)"|[^,]*)(,|$)/g) ?? []).map((f) => f.replace(/,$/, '').replace(/^"|"$/g, ''));
const all = rows.map(parse);

const iAdv = idx('Advertiser ID'), iName = idx('Advertiser Name'), iFid = idx('Feed ID');
const iFeedName = idx('Feed Name'), iProducts = idx('No of products'), iUpdated = idx('Last Imported');
console.log(`feeds visible on this account: ${all.length}`);

const show = (r) => console.log(
  `  fid ${r[iFid]}  advertiser ${r[iAdv]} ${JSON.stringify(r[iName])}` +
  `  products ${iProducts > -1 ? r[iProducts] : '?'}` +
  `  last imported ${iUpdated > -1 ? r[iUpdated] : '?'}` +
  `  ${iFeedName > -1 ? JSON.stringify(r[iFeedName]) : ''}`,
);

if (advertiser) {
  const mine = all.filter((r) => r[iAdv] === String(advertiser));
  console.log(`\n── advertiser ${advertiser}: ${mine.length} feed(s) ──`);
  mine.forEach(show);
  if (!mine.length) console.log('  NONE. The advertiser publishes no feed this account can see.');
}
if (fid) {
  const hit = all.filter((r) => r[iFid] === String(fid));
  console.log(`\n── fid ${fid} ──`);
  if (!hit.length) console.log('  NOT PRESENT in this account\'s list. It cannot be downloaded and is not ours to use.');
  else hit.forEach(show);
}
