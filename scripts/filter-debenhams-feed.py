#!/usr/bin/env python3
"""
Filters an AWIN datafeed gzip down to beauty-only rows.

Usage:
  python3 scripts/filter-debenhams-feed.py <input.csv.gz> <output.csv.gz>
"""
import sys, gzip, csv
from pathlib import Path

csv.field_size_limit(sys.maxsize)

# Brand whitelist (lower-cased for matching). Add/remove as needed.
BEAUTY_BRANDS = {
    'clarins', 'lancôme', 'lancome', 'estée lauder', 'estee lauder',
    'mac', 'm.a.c', 'mac cosmetics', 'chanel', 'dior', 'ysl',
    'yves saint laurent', 'tom ford', 'la mer', 'la roche-posay',
    'la roche posay', 'kiehl', 'kiehls', "kiehl's", 'shiseido', 'sk-ii',
    'nuxe', 'elemis', 'sisley', 'caudalie', 'origins', 'kerastase',
    'kérastase', 'redken', 'aveda', 'olaplex', 'paco rabanne', 'mugler',
    'chloé', 'chloe', 'gucci', 'fenty', 'charlotte tilbury',
    'urban decay', 'hourglass', 'pat mcgrath', 'nyx',
    'nyx professional makeup', 'nars', 'bobbi brown', 'clinique', 'no7',
    'no.7', 'cerave', 'the ordinary', 'glow recipe', 'sol de janeiro',
    'rituals', 'benefit', 'benefit cosmetics', 'too faced', 'maybelline',
    "l'oreal", "l'oréal", 'loreal', 'loréal', "l'oréal paris",
    'garnier', 'revlon', 'rimmel', 'rimmel london', 'max factor',
    'bourjois', 'eylure', 'soap & glory', 'champneys', 'olay', 'nivea',
    'philip kingsley', 'paul mitchell', 'tigi', 'wella', 'schwarzkopf',
    'biotherm', 'guerlain', 'helena rubinstein', 'givenchy', 'hugo boss',
    'calvin klein', 'davidoff', 'jimmy choo', 'beauty of joseon', 'cosrx',
    'medicube', 'anua', 'numbuzin', 'pixi', 'first aid beauty',
    'drunk elephant', 'tatcha', 'sunday riley', 'molton brown',
    "l'occitane", 'loccitane', 'jo malone', 'philosophy', "paula's choice",
    'paulas choice', 'augustinus bader', 'avene', 'avène', 'vichy',
    'eucerin', 'bioderma', 'pureology', 'kevin murphy', 'living proof',
    'moroccanoil', 'ouai', 'iconic london', 'huda beauty', 'rare beauty',
    'kosas', 'milk makeup', 'glossier', 'beauty pie', 'sanctuary',
    'tropic', 'this works', 'aromatherapy associates', 'liz earle',
    'aurelia', 'pixi beauty', 'percy & reed', 'morphe', 'revolution',
    'makeup revolution', 'illamasqua', 'sleek', 'mua',
    'estee lauder companies', 'aerin', 'la prairie', 'inglot',
    'kiko milano', 'baremimerals', 'stila', 'armani', 'elizabeth arden',
    'bareminerals', 'bare minerals',
}

# Category keyword match (in category_name or merchant_product_category_path).
BEAUTY_CAT_HINTS = (
    'beauty', 'skincare', 'skin care', 'haircare', 'hair care',
    'cosmetic', 'cosmetics', 'fragrance', 'perfume', 'bodycare',
    'body care', 'make-up', 'makeup',
)

def is_beauty(row):
    brand = (row.get('brand_name') or '').strip().lower()
    if brand in BEAUTY_BRANDS:
        return True
    cat = (row.get('category_name') or '').strip().lower()
    path = (row.get('merchant_product_category_path') or '').strip().lower()
    combined = f"{cat} {path}"
    return any(h in combined for h in BEAUTY_CAT_HINTS)

def main():
    if len(sys.argv) != 3:
        print("Usage: python3 filter-debenhams-feed.py <input.csv.gz> <output.csv.gz>",
              file=sys.stderr)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    in_rows = 0
    out_rows = 0
    with gzip.open(input_path, 'rt', encoding='utf-8', errors='replace') as fin, \
         gzip.open(output_path, 'wt', encoding='utf-8', newline='') as fout:
        reader = csv.DictReader(fin)
        writer = csv.DictWriter(fout, fieldnames=reader.fieldnames)
        writer.writeheader()
        for row in reader:
            in_rows += 1
            if is_beauty(row):
                writer.writerow(row)
                out_rows += 1
            if in_rows % 500000 == 0:
                print(f"  ...{in_rows:,} in, {out_rows:,} out", file=sys.stderr)

    print(f"\nDone. {in_rows:,} input rows -> {out_rows:,} beauty rows "
          f"({100*out_rows/in_rows:.2f}%)", file=sys.stderr)
    print(f"Input: {input_path} ({input_path.stat().st_size:,} bytes)", file=sys.stderr)
    print(f"Output: {output_path} ({output_path.stat().st_size:,} bytes)", file=sys.stderr)

if __name__ == '__main__':
    main()
