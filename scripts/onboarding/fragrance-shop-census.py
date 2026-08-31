"""
The Fragrance Shop census. MEASURES ONLY -- every Supabase request is a GET and nothing
is uploaded, imported or configured. Item 531.

WHY iterparse AND NOT A REGEX. Rakuten cmp XML nests <URL><product>...</product></URL>
inside every <product>, so `<product .*?</product>` truncates each record at the inner
tag and UPC, price, brand and image all come back empty. That hazard is written down in
.github/workflows/refresh-superdrug.yml.disabled, lines 10-13, by the previous Rakuten
onboarding -- in the file this one is copied from. It was not reached because the first
census ran outside the pipeline the note lives in.

THE DEPTH COUNTER IS THE WHOLE DEFENCE. On 'start' we go down, on 'end' we come up, and
only depth == 1 is a real product. Without it the inner tag is mistaken for a product and
.clear() wipes the URL before extraction.

AND AN ALL-ZERO CENSUS IS A PARSE FAILURE, NOT A RESULT. If products were seen and none
of them has a UPC, a price, a brand or an image, this exits 1 rather than printing the
zeros. Every field failing identically is a fact about the reader.
"""
import sys, os, json, re, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict

# --parse-only runs the XML half against a fixture with no network, so the depth
# counter can be tested before it is trusted on the real feed. The parse is the part
# that already failed once.
PARSE_ONLY = "--parse-only" in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SB_URL = "" if PARSE_ONLY else os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = "" if PARSE_ONLY else os.environ["SUPABASE_SERVICE_KEY"]


def get(path, params):
    q = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{path}?{q}")
    req.add_header("apikey", SB_KEY)
    req.add_header("Authorization", f"Bearer {SB_KEY}")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def page(path, params, size=1000):
    out, offset = [], 0
    while True:
        p = dict(params); p["limit"] = size; p["offset"] = offset
        chunk = get(path, p)
        out.extend(chunk)
        if len(chunk) < size:
            return out
        offset += size


def norm_ean(raw):
    """Byte-for-byte the rule in _shared/match-key.ts: digits, strip leading zeros,
    reject under 8. A 14-digit zero-padded UPC becomes an 11-13 digit key."""
    if not raw:
        return None
    digits = re.sub(r"[^0-9]", "", str(raw))
    stripped = digits.lstrip("0")
    return stripped if len(stripped) >= 8 else None


# ── PARSE ─────────────────────────────────────────────────────────────────────
rows, depth, inspected = [], 0, 0
for xml_file in ARGS:
    for event, elem in ET.iterparse(xml_file, events=("start", "end")):
        if event == "start":
            if elem.tag == "product":
                depth += 1
            continue
        if elem.tag != "product":
            continue
        if depth != 1:                       # the nested <URL><product> link
            depth -= 1
            continue
        inspected += 1
        p, attrs = elem, elem.attrib
        cat = p.find("category")
        primary = cat.findtext("primary", "") if cat is not None else ""
        secondary = cat.findtext("secondary", "") if cat is not None else ""
        retail = (p.findtext("price/retail", "") or "").strip()
        sale = (p.findtext("price/sale", "") or "").strip()
        urlb = p.find("URL")
        rows.append({
            "name": attrs.get("name", ""),
            "brand": (p.findtext("brand", "") or attrs.get("manufacturer_name", "") or "").strip(),
            "primary": primary,
            "secondary": secondary,
            "retail": retail,
            "sale": sale,
            "upc": (p.findtext("upc", "") or "").strip(),
            "url": (urlb.findtext("product", "") if urlb is not None else "") or "",
            "image": (urlb.findtext("productImage", "") if urlb is not None else "") or "",
            "avail": (p.findtext("shipping/availability", "") or "").strip(),
            "size": (p.findtext("attribute[@name='Size']", "") or "").strip()
                    or next((a.text or "" for a in p.findall("attribute")
                             if (a.get("name") or "").lower() == "size"), "").strip(),
        })
        p.clear()
        depth -= 1

n = len(rows)
with_upc = sum(1 for r in rows if r["upc"])
with_price = sum(1 for r in rows if r["retail"])
with_brand = sum(1 for r in rows if r["brand"])
with_image = sum(1 for r in rows if r["image"])

print(f"## The Fragrance Shop census\n")
print(f"```\nproducts parsed      {n}\ninspected            {inspected}\n"
      f"with UPC             {with_upc}  ({100*with_upc/max(n,1):.1f}%)\n"
      f"with retail price    {with_price}\nwith brand           {with_brand}\n"
      f"with image           {with_image}\n```\n")

# THE GUARD. Not a warning -- an exit.
if n and not (with_upc or with_price or with_brand or with_image):
    print("::error::every field is empty on every product -- this is a parse failure, "
          "not a feed property. Refusing to report it as a census.")
    sys.exit(1)

# ── THE SALE FIELD ────────────────────────────────────────────────────────────
both, below, above_or_equal, gaps = 0, 0, 0, []
for r in rows:
    if not r["sale"] or not r["retail"]:
        continue
    try:
        s, t = float(r["sale"]), float(r["retail"])
    except ValueError:
        continue
    both += 1
    if s < t:
        below += 1
        gaps.append((t - s) / t * 100 if t else 0)
    else:
        above_or_equal += 1
gaps.sort()
med = gaps[len(gaps) // 2] if gaps else 0
print(f"### The sale field\n```\nrows with BOTH sale and retail   {both}\n"
      f"  sale below retail              {below}\n"
      f"  sale >= retail                 {above_or_equal}   <- the case the guard exists for\n"
      f"discount median                  {med:.0f}%\n"
      f"discount max                     {gaps[-1] if gaps else 0:.0f}%\n```\n")

# ── CATEGORY PATHS ────────────────────────────────────────────────────────────
ALLOW = "perfume & cologne"
paths = Counter(f"{r['primary']} > {r['secondary']}".replace("~~", " > ") for r in rows)
matched = sum(c for p, c in paths.items() if ALLOW in p.lower())
leaves = Counter(r["secondary"].split("~~")[-1].strip() for r in rows)
LEAF_CANON = "EDP / EDT / PARFUM / ELIXIR / EDC"
odd_leaves = {k: v for k, v in leaves.items() if k != LEAF_CANON}
print(f"### Category paths\n```\ndistinct primary values          {len(set(r['primary'] for r in rows))}\n"
      f"distinct full paths              {len(paths)}\n"
      f"matched by must_contain          {matched} / {n}   term: \"Perfume & Cologne\"\n"
      f"distinct leaves                  {len(leaves)}\n"
      f"leaves that are NOT the canonical one: {sum(odd_leaves.values())} rows, "
      f"{len(odd_leaves)} distinct\n```\n")
for k, v in list(sorted(odd_leaves.items(), key=lambda kv: -kv[1]))[:8]:
    print(f"  - {v:>4}  {k[:90]}")
print()
# What a LEAF-matching allowlist would have cost.
leaf_matched = sum(c for k, c in leaves.items() if k == LEAF_CANON)
print(f"**A leaf allowlist would import {leaf_matched} and silently drop "
      f"{n - leaf_matched}.**\n")

if PARSE_ONLY:
    print("--parse-only: stopping before any network call.")
    sys.exit(0)

# ── OVERLAP, ON EVERY BARCODE ─────────────────────────────────────────────────
print("### Overlap — measured on every barcode, not a sample\n")
feed_eans = {}
for r in rows:
    k = norm_ean(r["upc"])
    if k:
        feed_eans.setdefault(k, []).append(r)
print(f"```\nfeed barcodes (normalised, distinct)  {len(feed_eans)}")

active = {x["id"] for x in get("retailers", {"select": "id", "active": "eq.true"})}
rp = page("retailer_prices", {"select": "ean_normalised,product_id,retailer_id",
                              "ean_normalised": "not.is.null"})
ean_to_product, product_stockists = {}, defaultdict(set)
for row in rp:
    if row["retailer_id"] not in active:
        continue
    product_stockists[row["product_id"]].add(row["retailer_id"])
    ean_to_product.setdefault(row["ean_normalised"], row["product_id"])

hits = {e: ean_to_product[e] for e in feed_eans if e in ean_to_product}
one_stockist = sum(1 for pid in hits.values() if len(product_stockists[pid]) == 1)
two_plus = sum(1 for pid in hits.values() if len(product_stockists[pid]) >= 2)
print(f"live rows with a barcode (active)     {len(rp)}\n"
      f"MATCHES                               {len(hits)}  "
      f"({100*len(hits)/max(len(feed_eans),1):.1f}% of feed barcodes)\n"
      f"  of which currently 1 stockist       {one_stockist}   <- deepened to a comparison\n"
      f"  of which already 2+                 {two_plus}\n"
      f"NEW to the catalogue                  {len(feed_eans) - len(hits)}\n```\n")

# ── BRANDS ────────────────────────────────────────────────────────────────────
feed_brands = Counter(r["brand"] for r in rows if r["brand"])
prods = page("products_active", {"select": "brand", "top_category": "eq.fragrance"})
live_frag = {(p["brand"] or "").strip().lower() for p in prods if p["brand"]}
known = {b for b in feed_brands if b.strip().lower() in live_frag}
new = {b for b in feed_brands if b.strip().lower() not in live_frag}
print(f"### Brands\n```\nfeed brands                    {len(feed_brands)}\n"
      f"live fragrance brands          {len(live_frag)}\n"
      f"already in the catalogue       {len(known)}\n"
      f"NEW brands                     {len(new)}   <- what existing_brands_only decides\n"
      f"products under a new brand     {sum(feed_brands[b] for b in new)}\n```\n")
print("Top feed brands: " + ", ".join(f"{b} {c}" for b, c in feed_brands.most_common(8)))
print("\nNOTHING WAS WRITTEN. No bucket upload, no importer call, no config row.")
