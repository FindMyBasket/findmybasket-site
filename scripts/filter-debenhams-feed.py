#!/usr/bin/env python3
"""
Filters an AWIN datafeed gzip down to beauty-only rows.

Usage:
  python3 scripts/filter-debenhams-feed.py <input.csv.gz> <output.csv.gz>
"""
import sys, gzip, csv, re
from pathlib import Path

csv.field_size_limit(sys.maxsize)

# Positive beauty signal for the empty-category-path fallback: a volume/weight
# unit in the product name. Essentially every skincare/haircare/makeup/fragrance
# SKU states its size ("50ml", "9g", "100ml"), while designer brands' eyewear,
# apparel, watches and bags do NOT — eyewear ships model codes ("ORIA/G/SK"),
# watches use case sizes in "mm" (not "ml"), apparel uses "| Size: Large". So
# requiring a volume unit cleanly keeps the beauty and drops the accessories
# that share an empty path and a whitelisted designer brand.
VOLUME_RE = re.compile(r'\b\d+(?:\.\d+)?\s?(?:ml|cl|fl\.?\s?oz|g|gr)\b', re.I)

# Fragrances are occasionally listed without a volume but with a clear scent
# descriptor — admit those too so we don't lose designer fragrance.
FRAGRANCE_HINTS = (
    'eau de parfum', 'eau de toilette', 'eau de cologne', 'eau fraiche',
    'parfum', 'aftershave', 'after shave', 'cologne', ' edt', ' edp',
)

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

# Non-beauty product signals, used ONLY for the empty-category-path fallback
# below. Designer brands on the whitelist (Hugo Boss, Gucci, Calvin Klein,
# Jimmy Choo...) also sell eyewear, watches, bags and clothing at Debenhams,
# and those rows frequently ship with an EMPTY merchant_product_category_path —
# so brand alone can't be trusted. If a whitelisted-brand row has no category
# path AND its name describes one of these, drop it.
NON_BEAUTY_NAME_HINTS = (
    'sunglass', 'aviator', 'eyewear', 'optical', 'glasses frame', 'spectacle',
    'watch', 'wallet', 'handbag', 'backpack', 'rucksack', 'holdall', 'purse',
    't-shirt', 't shirt', 'hoodie', 'sweatshirt', 'jumper', 'cardigan',
    'trousers', 'jeans', 'shorts', 'skirt', 'dress', 'shirt', 'blouse',
    'jacket', 'coat', 'blazer', 'trunks', 'boxers', 'briefs', 'thong',
    'bralette', 'bra ', 'lingerie', 'socks', 'scarf', 'gloves', 'belt',
    'trainers', 'shoes', 'boots', 'sandals', 'heels', 'loafers',
    'trimmer', 'clipper', 'shaver', 'epilator', 'massager', 'masturbator',
    'rug', 'cushion', 'duvet', 'bedding', 'towel', 'candle', 'diffuser',
)

def is_beauty(row):
    # THE PRIMARY SIGNAL IS ABSENT FROM THE NEWEST FEED. Recorded 7 August 2026.
    #
    # This filter was calibrated on the eight Fashion feeds that existed when it was
    # written. Four of those eight carry merchant_product_category_path; the other four
    # never have, which is what the fallback below was built for. Feed 116972
    # "Debenhams Beauty", added to the fetch on 7 August, carries it for NO row and
    # uses a different taxonomy entirely (Google's "Health & Beauty > Personal Care >
    # Cosmetics > ..." in merchant_category, not Debenhams' "Beauty > Face > ...").
    #
    # So every 116972 row lands in the fallback, which is a brand whitelist plus a
    # volume-unit regex — a rescue path for designer beauty hiding in a fashion feed,
    # not a classifier for a whole beauty catalogue. It undercounts, silently, and the
    # only symptom is a row count that looks plausible.
    #
    # THE GENERAL SHAPE, WHICH IS THE POINT: a filter keyed on a column that some feeds
    # populate is calibrated on the feeds that existed when it was written. Rotations
    # keep producing feeds it reads badly, and it degrades without erroring — the same
    # failure mode as a row-count guard calibrated on a superseded baseline (see the
    # guard comment in .github/workflows/refresh-debenhams.yml). Two rotations in five
    # days across two retailers; work list item 42.
    #
    # Reading merchant_category as a second primary signal would fix it and is NOT done
    # here — it changes what the filter admits, and that belongs in its own change with
    # its own before/after count. The column was added to the workflow's COLS on
    # 9 August 2026 so the report that decides WHICH values to admit can be produced
    # from real rows; nothing below reads it yet.
    #
    # ── WHEN merchant_category IS ADDED, IT IS AN EXTENSION, NOT A REPLACEMENT ─────
    # READ THIS BEFORE DELETING THE PATH BRANCH BELOW.
    #
    # The obvious-looking cleanup once merchant_category works is to drop the
    # merchant_product_category_path branch as superseded. That would be wrong, and it
    # would not fail loudly — it would quietly discard most of the catalogue.
    #
    # FOUR of the eight surviving Fashion feeds still populate
    # merchant_product_category_path, and it is the ONLY signal that admits their rows.
    # Measured on the 9 Aug 2026 artefact: 8,294 of 11,075 kept rows (74.9%) came in via
    # that path branch, and 4,635 of those (55.9%) have a brand that is NOT on
    # BEAUTY_BRANDS below — 477 distinct brands, including Dove, OPI, Vaseline, Simple,
    # IT Cosmetics, Nails Inc, Kevyn Aucoin and Mason Pearson. Remove the path branch
    # and every one of those rows is dropped, because no other branch can see them.
    #
    # The two taxonomies are populated by DIFFERENT feeds and neither is a superset:
    #   merchant_product_category_path  →  four of the eight Fashion feeds
    #   merchant_category              →  116972 "Debenhams Beauty"
    # Both branches are load-bearing. A feed rotation can move which is which again,
    # which is the reason to keep both rather than track whichever is current.
    #
    # Primary signal: trust Debenhams' own taxonomy. The well-structured beauty
    # catalogue ships a rich path like "Beauty > Face > Foundations"; everything
    # under Clothing / Home & Garden / Toys / Health & Wellness / Accessories
    # (and the eyewear/bags carrying those paths) is dropped here.
    path = (row.get('merchant_product_category_path') or '').strip().lower()
    if path:
        return path.startswith('beauty')

    # No category path at all: the bulk of these are designer fragrance and
    # accessories. Admit only whitelisted beauty brands, and only when the
    # product name doesn't clearly describe a non-beauty item (substring
    # 'beauty' used to admit toy "Hair & Beauty Role Plays", so don't keyword
    # on the category — gate on brand + a name denylist instead).
    brand = (row.get('brand_name') or '').strip().lower()
    if brand not in BEAUTY_BRANDS:
        return False
    name = (row.get('product_name') or '').strip().lower()
    if any(h in name for h in NON_BEAUTY_NAME_HINTS):
        return False
    # Require a positive beauty signal — a volume/weight unit or a fragrance
    # descriptor. The denylist above can't catch designer eyewear ("Cat Eye
    # Havana ... ORIA/G/SK"), watches ("Roller Buckle 40Mm") or apparel
    # ("Cotton Crew | Size: Large") because their names use model codes and
    # shapes, not category words. A volume unit does separate them cleanly.
    return bool(VOLUME_RE.search(name)) or any(h in name for h in FRAGRANCE_HINTS)

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
