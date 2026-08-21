#!/usr/bin/env python3
"""
Barcode-tier matcher for an Amazon harvest. READ-ONLY: prints a report and the INSERT
rows for amazon_asin_map, writes nothing anywhere.

WHY THIS FILE EXISTS AT ALL. Tranche 1 did this step as ad-hoc SQL, which is why nothing
enforced the one rule that decides whether it works:

    NORMALISE BOTH SIDES BEFORE COMPARING.

`retailer_prices.ean_normalised` is a generated column holding the barcode's SIGNIFICANT
DIGITS -- non-digits removed, LEADING ZEROS STRIPPED. That is the correct canonical form:
GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13) and GTIN-14 are the same number at different
widths, and leading zeros carry no information. It is what lets a UPC-A retailer and an
EAN-13 retailer match each other -- live example, Boots supplies 0010181032653 and YesStyle
supplies 010181032653 for the same product, and both reduce to 10181032653.

AMAZON RETURNS CANONICAL GTINs WITH THE ZEROS INTACT. So a raw comparison against that
column finds almost nothing, and the nothing does not look like a bug.

MEASURED 17 AUGUST 2026, and this is the entire reason for the file:

    Solgar, raw comparison        0 of 100   =   0.0%
    Solgar, both sides normalised 28 of 100  =  28.0%

ZERO PER CENT READS AS A COMMERCIAL FACT -- "Amazon and Boots share no SKUs for this brand"
-- and it was produced by a string comparison. Work-list items 163, 164.

Credentials come from the environment and are never read from the repo:
    SUPABASE_URL   https://<ref>.supabase.co
    SUPABASE_KEY   anon or service key; SELECT is all this needs

Usage:
    SUPABASE_URL=... SUPABASE_KEY=... \\
    python3 scripts/amazon-match-barcodes.py HARVEST.json --brands "Solgar,Vida Glow"
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict


def gtin_key(raw: str) -> str:
    """Canonical GTIN comparison key: digits only, leading zeros stripped.

    THE SAME TRANSFORM THE GENERATED COLUMN APPLIES. Deliberately duplicated here in one
    named function rather than inlined at the comparison, so that a reader can see the two
    sides being put into the same form. Inlining it on one side only is the defect this
    script exists to prevent, and it is invisible when written inline.
    """
    digits = "".join(c for c in (raw or "") if c.isdigit())
    return digits.lstrip("0")


def fetch(path: str) -> list:
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1" + path
    key = os.environ["SUPABASE_KEY"]
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": "Bearer " + key})
    return json.load(urllib.request.urlopen(req))


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    harvest_path = sys.argv[1]
    brands_arg = None
    if "--brands" in sys.argv:
        brands_arg = sys.argv[sys.argv.index("--brands") + 1]

    harvest = json.load(open(harvest_path))
    records = harvest["records"]
    brands = ([b.strip() for b in brands_arg.split(",")] if brands_arg
              else sorted({r["viaBrand"] for r in records}))

    quoted = ",".join('"' + b + '"' for b in brands)
    products = fetch("/products_active?select=id,brand,name,top_category"
                     "&brand=in.(" + urllib.parse.quote(quoted) + ")&limit=2000")
    meta = {p["id"]: p for p in products}
    ids = list(meta)

    offers = []
    for i in range(0, len(ids), 150):
        chunk = ",".join(str(x) for x in ids[i:i + 150])
        offers.append(fetch("/retailer_prices_live?select=product_id,ean_normalised"
                            "&product_id=in.(" + chunk + ")&limit=5000"))
    offers = [row for page in offers for row in page]

    # OUR side, put into the comparison key. ean_normalised is ALREADY stripped, so this is
    # a no-op for it -- and it is applied anyway, because a matcher that normalises only the
    # side it happens to distrust is the bug.
    ours = defaultdict(set)
    for o in offers:
        k = gtin_key(o.get("ean_normalised") or "")
        if k:
            ours[k].add(o["product_id"])

    per = defaultdict(lambda: dict(harvested=0, with_id=0, matched=0))
    covered = defaultdict(set)
    inserts = []
    for r in records:
        b = r["viaBrand"]
        per[b]["harvested"] += 1
        raw_ids = (r.get("eans") or []) + (r.get("upcs") or [])
        if raw_ids:
            per[b]["with_id"] += 1
        hit = set()
        matched_on = None
        for raw in raw_ids:
            k = gtin_key(raw)
            if k and k in ours:
                hit |= ours[k]
                matched_on = matched_on or raw
        if hit:
            per[b]["matched"] += 1
            covered[b] |= hit
            for pid in sorted(hit):
                inserts.append((pid, r["asin"], matched_on, r.get("title"), b))

    print(f"{'BRAND':<18}{'HARVEST':>8}{'WITH ID':>9}{'MATCHED':>9}{'RATE':>8}"
          f"{'OURS':>7}{'COVERED':>9}")
    for b in brands:
        p = per[b]
        if not p["harvested"]:
            print(f"{b:<18}{'0':>8}   (no ASINs harvested for this brand)")
            continue
        mine = [i for i, m in meta.items() if m["brand"] == b]
        cov = covered[b] & set(mine)
        print(f"{b:<18}{p['harvested']:>8}{p['with_id']:>9}{p['matched']:>9}"
              f"{100 * p['matched'] / p['harvested']:>7.1f}%{len(mine):>7}"
              f"{len(cov):>6} ({100 * len(cov) / len(mine):.0f}%)" if mine else "")

    tot = sum(p["harvested"] for p in per.values())
    mat = sum(p["matched"] for p in per.values())
    if tot:
        print(f"{'TOTAL':<18}{tot:>8}{sum(p['with_id'] for p in per.values()):>9}"
              f"{mat:>9}{100 * mat / tot:>7.1f}%")

    # A RAW-COMPARISON CONTROL, printed every run. It is the number this script exists to
    # stop anyone reporting, and showing it beside the real one is cheaper than a comment
    # nobody reads.
    raw_ours = {(o.get("ean_normalised") or "").strip() for o in offers}
    raw_hits = sum(1 for r in records
                   if any(x.strip() in raw_ours for x in (r.get("eans") or []) + (r.get("upcs") or [])))
    print(f"\nCONTROL -- same data compared WITHOUT normalising both sides: {raw_hits} of {tot}"
          f" ({100 * raw_hits / tot:.1f}%)" if tot else "")
    print("If that control is much lower than the figure above, it is the reason this script"
          " exists, not a finding about the retailers.")

    print(f"\n-- amazon_asin_map rows, {len(inserts)} product/ASIN pairs. NOT APPLIED.")
    print("-- WHOEVER WRITES THE INSERT DECIDES THE CONFLICT CLAUSE, AND `notes` IS NOT IN")
    print("-- THESE TUPLES. amazon_asin_map.notes carries hand-written findings that are the")
    print("-- ONLY guard on some rows -- e.g. product 96761, where the barcode is confirmed")
    print("-- wrong and the note is what stops the ASIN being re-promoted. An upsert that")
    print("-- lists only the harvested columns preserves them; one written as a full-row")
    print("-- replacement, or that sets notes, DESTROYS them silently and leaves no diff.")
    print("-- Use: ON CONFLICT (asin) DO UPDATE SET <harvested columns only>, never notes.")
    for pid, asin, ean, title, b in inserts[:400]:
        t = (title or "").replace("'", "''")[:120]
        print(f"({pid}, '{asin}', '{ean}', '{t}', '{b}', 'matched', false),")
    if len(inserts) > 400:
        print(f"-- ... {len(inserts) - 400} more suppressed from this print")
    return 0


if __name__ == "__main__":
    sys.exit(main())
