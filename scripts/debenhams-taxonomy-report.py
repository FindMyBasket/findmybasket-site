#!/usr/bin/env python3
"""
READ-ONLY report: what would each merchant_category value ADMIT?

Usage:
  python3 scripts/debenhams-taxonomy-report.py <raw.csv.gz> [--min-rows N] [--samples N]

WHY THIS EXISTS. filter-debenhams-feed.py is about to gain merchant_category as a
second primary signal, because feed 116972 "Debenhams Beauty" populates no
merchant_product_category_path and every one of its rows therefore falls to a
brand-whitelist fallback that was written to rescue designer beauty from a fashion
feed, not to classify a beauty catalogue.

THE RISK INVERTS WHEN YOU EXTEND A WHITELIST. The old path branch was narrow and
dropped valid products. A new taxonomy branch is broad and can ADMIT things the old
taxonomy deliberately excluded: eyewear, watches, handbags, apparel, homeware,
candles. Adding ~58 values by hand, unmeasured, trades one silent error for another
in the opposite direction — and the new one is worse, because it puts non-beauty
into a beauty catalogue where a human notices it only by browsing.

So: no value gets added to the allow-list until this report says what it admits.

WHAT IT REPORTS, per merchant_category value:
  rows            total raw rows carrying that value
  already         rows the CURRENT filter keeps anyway (via path or the fallback)
  NEW             rows this value does not currently keep. READ THE WARNING BELOW:
                  this is NOT the number a tier-1 addition would admit.
  T1-ABLE         of those NEW rows, how many a tier-1 addition COULD actually
                  rescue — i.e. how many have an EMPTY merchant_product_category_path.
                  THIS is the number that matters when deciding whether to admit
                  a value. It is always <= NEW, and the gap is rows branch 1 kills.
  flagged         of those NEW rows, how many hit NON_BEAUTY_NAME_HINTS
  no-size         of those NEW rows, how many state no volume/weight and no
                  fragrance descriptor (weak beauty signal; worth eyeballing)

WHY T1-ABLE EXISTS, AND WHY NEW ALONE MISLEADS (added 14 Aug 2026).

Until now this header called NEW "rows admitting this value would add — the number
that matters". IT IS NOT THAT NUMBER. NEW is computed as `not is_beauty(row)`, which
is "rows this value does not currently keep" — a different quantity, and the two
diverge by exactly the rows that carry a populated non-beauty path.

The reason is the ORDER OF BRANCHES in is_beauty(). Branch 1 tests
merchant_product_category_path: a row with a non-empty path that does not start with
'beauty' returns False THERE, and the tier-1 merchant_category branch is never
reached for it. So adding a value to TIER1_MERCHANT_CATEGORIES can only ever rescue
rows whose path is EMPTY. For every other row the addition is a no-op.

Measured on the 14 Aug 2026 feed, Fitness & Nutrition > Vitamins & Supplements
reported rows 1,560 / already 11 / NEW 1,549 — and NEW was read as the size of the
population an addition would admit. It is an upper bound on it. This column is the
difference between sizing a change and sizing a hypothesis.

A REPORT THAT OVERSTATES ADMISSION IS THE SAME FAMILY AS ONE THAT UNDERSTATES IT.
The header above already warns that extending a whitelist inverts the risk. The
warning was about which rows get admitted; this is about how many, and the tool was
quietly answering a question adjacent to the one it was asked.

It imports the live filter module rather than reimplementing it, so its verdict
cannot drift from what an import would actually do. Same contract idea as
scripts/feed-categorisation-probe.mts — and the same warning applies: this reports
ADMISSION, it does not judge correctness. A value with zero flagged rows can still
be the wrong thing to admit. Read the samples.

WRITES NOTHING. No network, no database, no feed mutation.
"""
import sys, gzip, csv, collections, argparse, importlib.util
from pathlib import Path

csv.field_size_limit(sys.maxsize)

_HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "debenhams_filter", _HERE / "filter-debenhams-feed.py")
_filt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_filt)

is_beauty = _filt.is_beauty
VOLUME_RE = _filt.VOLUME_RE
FRAGRANCE_HINTS = _filt.FRAGRANCE_HINTS
NON_BEAUTY_NAME_HINTS = _filt.NON_BEAUTY_NAME_HINTS


def weak_signal(name: str) -> bool:
    """No volume/weight unit and no fragrance descriptor."""
    n = (name or "").lower()
    return not (VOLUME_RE.search(n) or any(h in n for h in FRAGRANCE_HINTS))


def flagged(name: str) -> bool:
    n = (name or "").lower()
    return any(h in n for h in NON_BEAUTY_NAME_HINTS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("--min-rows", type=int, default=1,
                    help="only report values with at least this many raw rows")
    ap.add_argument("--samples", type=int, default=5,
                    help="product names to show per value")
    args = ap.parse_args()

    # value -> counters + samples. Samples are taken from NEW rows only, because
    # the already-kept ones are not what the decision is about.
    stats = collections.defaultdict(
        lambda: {"rows": 0, "already": 0, "new": 0, "t1able": 0, "flagged": 0,
                 "weak": 0, "brands": collections.Counter(), "samples": []})
    total = 0
    blank = 0

    with gzip.open(args.raw, "rt", encoding="utf-8", errors="replace") as fin:
        reader = csv.DictReader(fin)
        if "merchant_category" not in (reader.fieldnames or []):
            print("ERROR: this feed has no merchant_category column.\n"
                  "The Debenhams workflow only began requesting it on 9 Aug 2026 —\n"
                  "an older raw.csv.gz cannot answer this question. Re-download.",
                  file=sys.stderr)
            return 2
        for row in reader:
            total += 1
            val = (row.get("merchant_category") or "").strip()
            if not val:
                blank += 1
                continue
            s = stats[val]
            s["rows"] += 1
            if is_beauty(row):
                s["already"] += 1
            else:
                s["new"] += 1
                # Only an EMPTY path can be rescued by a tier-1 addition: a populated
                # non-beauty path returns False at branch 1, before tier 1 is reached.
                # Read from the same key is_beauty() reads, not a re-derived one.
                if not (row.get("merchant_product_category_path") or "").strip():
                    s["t1able"] += 1
                name = (row.get("product_name") or "").strip()
                s["brands"][(row.get("brand_name") or "").strip()] += 1
                if flagged(name):
                    s["flagged"] += 1
                if weak_signal(name):
                    s["weak"] += 1
                if len(s["samples"]) < args.samples:
                    s["samples"].append(f"{(row.get('brand_name') or '').strip()} — {name}")
            if total % 500000 == 0:
                print(f"  ...{total:,} rows", file=sys.stderr)

    print(f"\nraw rows: {total:,}   with a merchant_category: {total-blank:,}   "
          f"blank: {blank:,}   distinct values: {len(stats):,}\n")
    print(f"{'rows':>8} {'already':>8} {'NEW':>8} {'T1-ABLE':>8} {'flagged':>8} {'no-size':>8}  value")
    print("-" * 108)

    # Sorted by T1-ABLE, not NEW. The ordering is part of the fix: sorting by NEW puts
    # values at the top that a tier-1 addition cannot touch, which is how a number that
    # was an upper bound got read as a target.
    for val, s in sorted(stats.items(), key=lambda kv: (-kv[1]["t1able"], -kv[1]["new"])):
        if s["rows"] < args.min_rows:
            continue
        print(f"{s['rows']:>8} {s['already']:>8} {s['new']:>8} {s['t1able']:>8} "
              f"{s['flagged']:>8} {s['weak']:>8}  {val}")
        if s["new"]:
            top = ", ".join(f"{b or '(blank)'} x{c}" for b, c in s["brands"].most_common(5))
            print(f"{'':>44}brands: {top}")
            for smp in s["samples"]:
                print(f"{'':>44}  · {smp[:110]}")
        print()

    print("READ THE SAMPLES. 'flagged' and 'no-size' are hints, not verdicts, and a\n"
          "value with clean counters can still be the wrong thing to admit.\n"
          "\n"
          "SIZE A TIER-1 ADDITION ON T1-ABLE, NEVER ON NEW. NEW counts rows this value\n"
          "does not currently keep; T1-ABLE counts the subset a tier-1 addition could\n"
          "actually rescue. Where T1-ABLE is 0 the value is unreachable from tier 1 no\n"
          "matter how large NEW is, and admitting it would change nothing at all.\n"
          "\n"
          "TWO BOUNDS THAT TRAVEL WITH EVERY FIGURE HERE. Brand lists are capped at the\n"
          "top five per value, so a brand absent from this report is NOT proven absent\n"
          "from the feed. And --min-rows omits small values entirely — they are\n"
          "unmeasured, not empty. Counts drift day to day: Vitamins & Supplements read\n"
          "1,496 on 10 Aug and 1,560 on 14 Aug.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
