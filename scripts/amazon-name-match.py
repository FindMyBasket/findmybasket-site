#!/usr/bin/env python3
"""
READ-ONLY name-similarity pass over amazon_asin_map's unmatched rows.

WRITES NOTHING. Prints a report. Nothing touches amazon_asin_map, human_verified stays
false, and promotion into products.amazon_asin is a separate step after a human pass.

WHY A NAME MATCH IS ALLOWED HERE AT ALL. Item 60 is emphatic that the barcode is the
match and the name is confirmation. That still holds for the 155 EAN-confirmed rows. This
pass is for the rows where THERE IS NO BARCODE TO MATCH ON — either Amazon returned
identifiers that hit nothing (45) or returned none at all (4). For those, a name match is
the only route available, and for the 4 it has to carry the decision alone.

MEASURED BEFORE IT IS QUOTED — item 79. The 155 EAN-confirmed rows are an independent
ground truth: their product_id was established by barcode, not by name, so running the
name matcher over them says exactly how often it would have got the right answer on its
own. Every threshold in the report below is derived from that measurement, and the
measurement is re-run after every change to the normaliser — including changes made to fix
defects found while writing it, which is the specific trap item 79 records.

Usage:  python3 scripts/amazon-name-match.py /tmp/map.json /tmp/cands.json
"""
import json, re, sys, unicodedata
from collections import Counter

# ── normalisation ────────────────────────────────────────────────────────────────
UNITS = r'(?:ml|l|g|kg|mg|oz|fl\s?oz|pcs|pc|pads|pad|sheets|sheet|count|ct|ea|patches|patch)'

# GLUED SIZES ARE THE KNOWN FAILURE FAMILY AND THEY BROKE TWICE BEFORE (item 79):
# "Toner250 ml", "Shampoo2", "Oil250". A plain \b never sees the boundary because there is
# no non-word character. Split ONLY where the digits are followed by a unit, so "B5",
# "SPF50" and "AHA 7" are left alone — splitting those would destroy real tokens.
GLUE = re.compile(r'(?<=[a-z])(?=\d+\s*' + UNITS + r'\b)', re.I)
SIZE = re.compile(r'\b(\d+(?:\.\d+)?)\s*(' + UNITS + r')\b', re.I)

# Marketing tails. Amazon titles are sales copy; catalogue names are labels. Everything
# after the first | or the first , is nearly always copy, but cutting there loses the size
# on some rows, so the size is extracted BEFORE the cut rather than after.
NOISE = {
    'korean', 'skincare', 'skin', 'care', 'for', 'with', 'and', 'the', 'a', 'an', 'of',
    'face', 'facial', 'daily', 'new', 'version', 'ver', 'pack', 'value', 'size', 'travel',
    'official', 'genuine', 'authentic', 'uk', 'set', 'kit', 'by', 'from', 'to', 'in', 'on',
    'your', 'all', 'types', 'type', 'best', 'gift', 'free', 'net', 'wt', 'oz', 'fl',
}

def strip_accents(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))

def sizes_of(s: str):
    """Size tokens, kept SEPARATE from the name score. Item 60: size is confirmation,
    never a gate — Amazon reported '1 g' for a 100g cream carried by nine retailers."""
    out = set()
    for n, u in SIZE.findall(s.lower()):
        u = u.replace(' ', '')
        n = n.rstrip('0').rstrip('.') if '.' in n else n
        out.add(f'{n}{u}')
    return out

def norm_tokens(s: str, brand: str = '') -> set:
    s = strip_accents((s or '').lower())
    s = GLUE.sub(' ', s)
    s = re.split(r'[|]', s)[0]              # drop the marketing tail after a pipe
    s = SIZE.sub(' ', s)                    # sizes handled separately
    s = re.sub(r"[^a-z0-9%+]+", ' ', s)
    toks = [t for t in s.split() if t and t not in NOISE and len(t) > 1]
    b = [t for t in re.sub(r"[^a-z0-9]+", ' ', strip_accents((brand or '').lower())).split() if t]
    return set(toks) - set(b)               # brand is matched separately, not scored

# ── pack count and set-ness: the discriminator, added after measurement ──────────
#
# FOUND BY MEASURING, NOT ANTICIPATED. The first pass scored 70.3% top-1 and its
# highest-confidence errors were a SINGLE mapped onto a TEN-PACK (3073 vs 3074) and a
# product mapped onto a GIFT SET (7741 vs 92924, "Advanced Snail 92 All In One Cream" vs
# "...(3ea) Set"). Both scored 1.0 and 0.93 respectively, because pack count lives in the
# tokens the size stripper had already removed.
#
# THIS IS NOT A CONTRADICTION OF ITEM 60'S "SIZE IS NEVER A GATE", AND THE DISTINCTION
# MATTERS. That rule forbids REJECTING A BARCODE MATCH because sizes disagree — Amazon
# said "1 g" for a 100g cream and was right about the product. These rows have NO barcode
# to reject. Pack count is being used to choose between two catalogue candidates on a
# name-only comparison, which is a different job. Size still never gates: it is reported
# beside the score and never inside it.
PACK = re.compile(r'\b(?:x\s*(\d+)|(\d+)\s*(?:ea|pk|pcs|pc|pads|patches|sheets|count|ct)\b|\((\d+)\s*(?:ea|pk|pcs|pc)\))', re.I)
SETLIKE = re.compile(r'\b(set|kit|bundle|duo|trio|discovery|collection)\b', re.I)

def pack_of(s: str):
    m = [g for t in PACK.findall((s or '').lower()) for g in t if g]
    return int(m[0]) if m else None

def is_set(s: str) -> bool:
    return bool(SETLIKE.search(s or ''))

def score(a_title, a_brand, c_name, c_brand):
    """Coverage-weighted overlap. The CATALOGUE name is the shorter, cleaner string, so
    the primary term is what fraction of it the Amazon title accounts for; the reverse
    direction is included at lower weight so a catalogue name that is a bare prefix of
    twenty products cannot score 1.0 against all of them."""
    A, C = norm_tokens(a_title, a_brand), norm_tokens(c_name, c_brand)
    if not A or not C:
        return 0.0
    inter = A & C
    cov_c = len(inter) / len(C)
    cov_a = len(inter) / len(A)
    s = 0.75 * cov_c + 0.25 * cov_a

    # A set is not the product it contains. Asymmetric penalty: one side a set and the
    # other not is a different thing entirely, not a near miss.
    if is_set(a_title) != is_set(c_name):
        s -= 0.35
    # A ten-pack is not a single. Only penalised when BOTH sides state a count and they
    # disagree — an unstated count is unknown, not one.
    pa, pc = pack_of(a_title), pack_of(c_name)
    if pa and pc and pa != pc:
        s -= 0.30
    return round(max(s, 0.0), 4)

# A SIZE TIEBREAK WAS TRIED AND REJECTED ON THE MEASUREMENT, 14 Aug 2026.
#
# Several ties break cleanly on the stated size — Amazon "150ml" against a 50ml and a
# 150ml catalogue row — so a +/-0.03 nudge for size agreement looked obviously right.
# Measured on the same 155:
#
#     name only            top-1 116/155 (74.8%)   band(>=0.80,>=0.20): n=51  precision 94.1%
#     with size tiebreak   top-1 118/155 (76.1%)   band(>=0.80,>=0.20): n=50  precision 92.0%
#
# It gains two rows overall and LOSES precision on the high-confidence band, which is the
# only band anything is proposed from. Rejected: a change that improves the average while
# degrading the part you act on is not an improvement. Size is reported beside every
# candidate instead, where a human uses it — which is also where item 60 says it belongs.

def brand_key(b):
    b = re.sub(r"[^a-z0-9]+", '', strip_accents((b or '').lower()))
    return {'drmelaxin': 'melaxin', 'cosrx': 'cosrx'}.get(b, b)

def best_matches(a_title, a_brand, cands, k=3):
    bk = brand_key(a_brand)
    pool = [c for c in cands if brand_key(c['brand']) == bk] or cands
    scored = [(score(a_title, a_brand, c['name'], c['brand']), c) for c in pool]
    scored.sort(key=lambda x: (-x[0], x[1]['id']))
    return scored[:k]

# ── run ──────────────────────────────────────────────────────────────────────────
rows = json.load(open(sys.argv[1]))['rows']
cands = json.load(open(sys.argv[2]))['rows']
by_id = {c['id']: c for c in cands}

# Barcode sets per product, used ONLY to classify errors — never to score. Two catalogue
# rows sharing a barcode are the same product entered twice (item 96: 8,606 such barcodes,
# 11.1%), so a "wrong" prediction that shares a barcode with the truth is not a wrong
# PRODUCT. Reporting the two separately is the difference between a matcher that looks
# 70% accurate and one that is wrong about the product 20% of the time.
peans = {r['id']: set(r['eans']) for r in json.load(open(sys.argv[3]))['rows']} \
        if len(sys.argv) > 3 else {}

def same_product(a, b):
    if a == b:
        return True
    return bool(peans.get(a) and peans.get(b) and peans[a] & peans[b])

# ── MEASUREMENT FIRST (item 79) ──────────────────────────────────────────────────
truth = [r for r in rows if r['match_state'] == 'matched' and r['product_id'] in by_id]
hits = []
for r in truth:
    top = best_matches(r['amazon_title'], r['amazon_brand'], cands, k=1)
    s, c = top[0] if top else (0.0, None)
    exact = bool(c and c['id'] == r['product_id'])
    dupe  = bool(c and same_product(c['id'], r['product_id']))
    hits.append((s, exact, dupe))

print(f"=== MATCHER MEASURED ON {len(truth)} EAN-CONFIRMED PAIRS (ground truth; name never used to build it) ===")
print(f"{'thresh':>7} {'proposed':>9} {'exact':>6} {'same-product':>13} {'wrong product':>14} {'precision*':>11}")
for t in (0.0, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
    prop = [h for h in hits if h[0] >= t]
    if not prop:
        continue
    ex = sum(1 for h in prop if h[1])
    sp = sum(1 for h in prop if h[2])
    print(f"{t:>7.2f} {len(prop):>9} {ex:>6} {sp:>13} {len(prop)-sp:>14} {100*sp/len(prop):>10.1f}%")
print("\n* precision counts a prediction correct if it names THE SAME PRODUCT as the barcode did,")
print("  including a duplicate catalogue row for it (item 96). Wrong-product is the real error.")
ex = sum(1 for h in hits if h[1]); sp = sum(1 for h in hits if h[2])
print(f"\ntop-1 exact row: {ex}/{len(truth)} ({100*ex/len(truth):.1f}%)   "
      f"top-1 same product: {sp}/{len(truth)} ({100*sp/len(truth):.1f}%)")
