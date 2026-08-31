"""
The Fragrance Shop XML -> NDJSON, for import-rakuten-feed. Item 533.

THE ONE THING THIS FILE EXISTS TO GET RIGHT IS THE PRICE.

refresh-superdrug.yml.disabled -- the only Rakuten precedent, and the file this would
otherwise be copied from -- reads price/retail and NEVER READS <sale>:

    price_elem = p.find("price/retail")

Copying it is not a risk of taking the wrong price. It is a CERTAINTY of taking the wrong
price on the 557 rows that carry both, median 33% overstated and up to 97%. That is the
Boots AWIN defect, which cost roughly 40% accuracy on a sample, reproduced with the right
field sitting in the file unread.

    price = sale when sale is present AND 0 < sale < retail, else retail

THE `< retail` COMPARISON IS NOT REDUNDANT. Measured 31 Aug 2026, all 557 sale rows are
below retail. If a later feed puts a higher number in <sale> -- a was/now inversion, a
currency slip, a merchant error -- the naive `sale or retail` takes it and the defect
arrives through the fix for it. The count of rows where sale >= retail is printed on every
run, so the assumption is re-measured rather than assumed once.

DEPTH-AWARE PARSING, NOT A REGEX: Rakuten cmp XML nests <URL><product>...</product></URL>.
Item 531.
"""
import sys, os, json, gzip
import xml.etree.ElementTree as ET

out_path = os.environ.get("NDJSON_OUT", "fragrance-shop.ndjson")
rows = depth = inspected = 0
no_url = both = sale_used = sale_not_below = 0

with open(out_path, "w", encoding="utf-8") as f_out:
    for xml_file in sys.argv[1:]:
        for event, elem in ET.iterparse(xml_file, events=("start", "end")):
            if event == "start":
                if elem.tag == "product":
                    depth += 1
                continue
            if elem.tag != "product":
                continue
            if depth != 1:
                depth -= 1
                continue
            inspected += 1
            p, attrs = elem, elem.attrib
            cat = p.find("category")
            primary = cat.findtext("primary", "") if cat is not None else ""
            secondary = cat.findtext("secondary", "") if cat is not None else ""
            urlb = p.find("URL")
            url = (urlb.findtext("product", "") if urlb is not None else "") or ""
            image = (urlb.findtext("productImage", "") if urlb is not None else "") or ""

            retail_s = (p.findtext("price/retail", "") or "").strip()
            sale_s = (p.findtext("price/sale", "") or "").strip()
            try:
                retail = float(retail_s) if retail_s else 0.0
            except ValueError:
                retail = 0.0
            price = retail
            if sale_s:
                try:
                    sale = float(sale_s)
                except ValueError:
                    sale = 0.0
                if sale > 0 and retail > 0:
                    both += 1
                    if sale < retail:
                        price = sale
                        sale_used += 1
                    else:
                        sale_not_below += 1     # kept at retail, deliberately

            desc = p.find("description")
            description = ""
            if desc is not None:
                description = (desc.findtext("long", "") or "").strip() or (desc.findtext("short", "") or "").strip()

            if not url:
                no_url += 1
                p.clear(); depth -= 1
                continue

            f_out.write(json.dumps({
                "name": attrs.get("name", ""),
                "sku": attrs.get("sku_number", ""),
                "product_id": attrs.get("product_id", ""),
                "brand": (p.findtext("brand", "") or attrs.get("manufacturer_name", "") or "").strip(),
                "category_primary": primary,
                "category_secondary": secondary,
                "price": price,
                "availability": (p.findtext("shipping/availability", "") or "").strip(),
                "url": url,
                "upc": (p.findtext("upc", "") or "").strip(),
                "mpn": (p.findtext("mpn", "") or "").strip(),
                "image_url": image,
                "description": description,
            }, ensure_ascii=False) + "\n")
            rows += 1
            p.clear(); depth -= 1

print(f"inspected {inspected}, wrote {rows}, skipped {no_url} with no URL")
print(f"rows with BOTH sale and retail: {both}")
print(f"  sale taken (below retail):    {sale_used}")
print(f"  sale IGNORED (>= retail):     {sale_not_below}   <- why the comparison is there")

# Guards. Both are exits, not warnings.
if rows < 50:
    raise SystemExit(f"::error::only {rows} records — refusing to stage")
if both and sale_used == 0:
    raise SystemExit("::error::rows carry <sale> and none was taken — the price rule is not firing")

with open(out_path, "rb") as a, gzip.open(out_path + ".gz", "wb", compresslevel=9) as b:
    b.write(a.read())
print(f"wrote {out_path}.gz")
