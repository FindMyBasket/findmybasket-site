/**
 * THE CANDIDATE-SELECTION RULE. Work-list item 186.
 *
 * Answers one question: given a catalogue product and one or more candidate ASINs that
 * matched it, WHICH ASIN — if any — should this product publish?
 *
 * ── WHY A RULE AND NOT A JUDGEMENT ───────────────────────────────────────────────────
 *
 * Twelve measured instances, two shapes:
 *   - seven products where two Amazon listings both match on barcode
 *   - five where Amazon's barcode differs in the last digits (…517533 vs …517557)
 *
 * NEITHER OBVIOUS REMEDY WORKS, and that is what shaped this:
 *
 *   A HUMAN PASS FAILS. On product 1028 the title, brand, image and size all agree and only
 *   the barcode differs by two digits. There is nothing for a reviewer to see.
 *
 *   A CLOSEST-BARCODE RULE FAILS WORSE. It does not merely miss near-misses, it ACTIVELY
 *   SELECTS FOR THEM — …517557 is the closest barcode to …517533 in the entire catalogue.
 *
 * ── THE RELATION BETWEEN ELIGIBILITY AND SELECTION IS THE DESIGN ─────────────────────
 *
 * ELIGIBILITY uses STABLE signals — barcode, brand, generation token. These are facts about
 * identity and they do not change between reads.
 *
 * SELECTION uses VOLATILE signals — offer, stock, seller. These change hourly.
 *
 * The split matters because THE OUTPUT IS STORED (work-list item 187): a rule that decided
 * identity on volatile signals would produce a stored answer that decays into a wrong
 * product, rather than merely a worse listing. Eligibility must never depend on whether
 * something happened to be in stock.
 *
 * S5 (lower price) WAS DESIGNED AND THEN DROPPED. Price is the most volatile signal in the
 * set and "cheaper" is not a reason to prefer one of two identical listings from the same
 * seller. Measured cost of dropping it: one of seven (product 583 becomes a hold).
 *
 * ── HOLDING IS A FIRST-CLASS VERDICT ─────────────────────────────────────────────────
 *
 * NOT a fallthrough, not an error. An unresolved candidate set is a product with no ASIN,
 * which is the current state of most of the catalogue and is not a failure. Every path that
 * cannot justify a pick returns `hold` with a reason, and no path returns a guess.
 */

export type Candidate = {
  asin: string;
  /** From amazon_asin_map. The barcode that matched, or null for a name/secondary match. */
  matchedEan: string | null;
  /** Amazon's own identifiers for this ASIN (itemInfo.externalIds). */
  amazonIds: string[];
  amazonTitle: string | null;
  amazonBrand: string | null;
  /** Volatile. Absent means no live offer at read time. */
  offer: {
    displayPrice: string;
    sellerName: string | null;
    inStock: boolean;
  } | null;
};

export type CatalogueProduct = {
  id: number;
  name: string;
  brand: string | null;
  /** Every barcode any retailer supplies for this product, already normalised. */
  barcodes: string[];
};

export type Verdict =
  | { action: 'select'; asin: string; on: string; eligible: string[] }
  | { action: 'confirm'; asin: string; on: 'secondary_path'; secondary: SecondaryInputs }
  | { action: 'hold'; on: string; eligible: string[] };

/** Logged on every use of the secondary path so n=1 becomes a measurable rate. */
export type SecondaryInputs = {
  productId: number;
  asin: string;
  brandStore: boolean;
  sellerName: string | null;
  catalogueBrand: string | null;
  exactTitle: boolean;
  sizeAgrees: boolean;
  catalogueSize: string | null;
  amazonSize: string | null;
  ourBarcodes: string[];
  amazonIds: string[];
};

// ── normalisation ────────────────────────────────────────────────────────────────────

/** GTIN equality: leading zeros are not significant. Matches scripts/amazon-match-barcodes.py. */
const gtin = (s: string) => String(s || '').replace(/[^0-9]/g, '').replace(/^0+/, '');

const norm = (s: string | null) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Seller-name matching, and IT CANNOT VERIFY WHAT IT IS USED FOR.
 *
 * A seller name is A STRING, NOT AN ATTESTATION, and naming yourself after the brand is
 * precisely the counterfeiter's move (work-list item 200). This returns an UPPER BOUND on
 * "sold by the brand" and nothing stronger. It is load-bearing in the secondary path, and
 * that is a known weakness recorded rather than hidden.
 */
const STORE_SUFFIX = /(inc|ltd|limited|official|store|uk|eu|gmbh|co|company|europe|shop)$/;
export function isBrandStore(sellerName: string | null, brand: string | null): boolean {
  const s = norm(sellerName).replace(STORE_SUFFIX, '');
  const b = norm(brand).replace(STORE_SUFFIX, '');
  if (!s || !b) return false;
  return s.includes(b) || b.includes(s);
}

/**
 * Explicit GENERATION tokens only — `4.0`, `2.0`, `v3`, `Ver.2`.
 *
 * NOT sizes and NOT condition tags. A generation number is a claim that this is a DIFFERENT
 * FORMULATION, which is an identity question; a size is a variant of the same product and is
 * handled by the barcode. Product 82251 is the measured case: "Triple Collagen Serum 4.0"
 * against an unversioned listing, both carrying the same EAN.
 */
export function generationToken(title: string | null): string | null {
  const t = String(title || '');
  const m = t.match(/\b(?:v(?:er)?\.?\s*)?(\d+\.\d)\b/i) || t.match(/\bv(?:er)?\.?\s*(\d+)\b/i);
  return m ? m[1] : null;
}

/** `[Renewed]`, `Refurbished` — Amazon condition programmes, not the product. */
export function isConditionTagged(title: string | null): boolean {
  return /\[(renewed|refurbished)\]|\brefurbished\b/i.test(String(title || ''));
}

/**
 * Size as a comparable string, from TITLE TEXT rather than from Amazon's size field.
 *
 * Item 60 established that `itemInfo.productInfo.size` is CONFIRMATION ONLY AND NEVER A GATE,
 * and 18 August measured why: it reads "1" on one listing and "0" on another. This reads the
 * title instead, which is the text a shopper sees.
 */
export function sizeToken(text: string | null): string | null {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s?(ml|g|kg|l|oz|capsules?|tablets?|caps|pads?|sachets?|count)\b/i);
  if (!m) return null;
  const unit = m[2].toLowerCase().replace(/s$/, '').replace(/^cap$/, 'capsule').replace(/^tablet$/, 'tablet');
  return `${Math.round(parseFloat(m[1]))}${unit}`;
}

// ── the rule ─────────────────────────────────────────────────────────────────────────

/**
 * ── THE CROSS-PRODUCT PASS ───────────────────────────────────────────────────────────
 *
 * `selectCandidate` takes ONE product and ITS candidates, so it cannot see that the ASIN it
 * chose was also chosen for a different product. AMBIGUITY IS A PROPERTY OF THE SET, and no
 * amount of care inside the per-product rule can reach it: each verdict is individually
 * correct and jointly wrong.
 *
 * Measured on the tranche-3 harvest: 22 ASINs claimed by 46 different catalogue products.
 *
 * ── HELD FOR ALL OF THEM, NOT AWARDED TO ONE ─────────────────────────────────────────
 *
 * NOT "give it to the best match" — deciding which product owns a contested ASIN needs a
 * similarity judgement between two catalogue rows, which is the class item 186 exists to
 * refuse. NOT "give it to the lowest id" — the lowest-id placeholder is not a choice.
 *
 * ── AND THE CONFLICTS ARE EMITTED, NOT MERELY SUPPRESSED ─────────────────────────────
 *
 * A single ASIN matching several catalogue rows almost always means OUR CATALOGUE HAS
 * SEVERAL ROWS FOR ONE PRODUCT, or one row is wrong about its barcode. Both are catalogue
 * defects and neither is fixed by choosing an ASIN.
 *
 * SO THE CONFLICT IS A SIGNAL ABOUT OUR CATALOGUE THAT ARRIVED THROUGH AMAZON. Holding
 * preserves it; picking a winner destroys it, because the losing rows stop looking wrong.
 * Item 96 has never had a duplicate-detection input that arrived from outside the catalogue,
 * and this is one.
 */
export type ProductVerdict = { productId: number; verdict: Verdict };
export type Conflict = { asin: string; productIds: number[] };

export function resolveAcrossProducts(
  input: ProductVerdict[],
  /**
   * ASINs ALREADY PUBLISHED, as asin -> productId. REQUIRED IN PRACTICE, OPTIONAL ONLY SO
   * THE PURE CASE STAYS TESTABLE.
   *
   * THE FIRST VERSION OF THIS FUNCTION OMITTED THIS AND WAS WRONG IN THE SAME WAY THE
   * PER-PRODUCT RULE WAS. It compared verdicts against verdicts, so an ASIN a *different*
   * product already publishes was invisible — the set it reasoned over was the batch, not
   * the catalogue.
   *
   * Caught on the tranche-3 promotion by reading the generated SQL: B07Y32L357 was about to
   * be written to product 6750 while product 1028 already published it. Two collisions in
   * 217 rows, and neither product's verdict was individually wrong.
   *
   * "Ambiguity is a property of the set" was the finding, AND I THEN DREW THE SET TOO SMALL.
   */
  published?: Map<string, number>,
): { resolved: ProductVerdict[]; conflicts: Conflict[] } {
  const claims = new Map<string, number[]>();
  for (const { productId, verdict } of input) {
    if (verdict.action === 'hold') continue;
    const list = claims.get(verdict.asin) ?? [];
    // A product appearing twice in the input is the caller's bug, not a conflict.
    if (!list.includes(productId)) list.push(productId);
    claims.set(verdict.asin, list);
  }

  // Fold in the incumbents. A product re-selecting the ASIN it already has is NOT a conflict.
  if (published) {
    for (const [asin, holderId] of published) {
      const list = claims.get(asin);
      if (list && !list.includes(holderId)) list.push(holderId);
    }
  }

  const conflicts: Conflict[] = [...claims.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([asin, productIds]) => ({ asin, productIds: [...productIds].sort((a, b) => a - b) }))
    .sort((a, b) => b.productIds.length - a.productIds.length || a.asin.localeCompare(b.asin));

  const contested = new Set(conflicts.map((c) => c.asin));
  const resolved = input.map(({ productId, verdict }) =>
    verdict.action !== 'hold' && contested.has(verdict.asin)
      ? {
          productId,
          verdict: {
            action: 'hold' as const,
            on: `cross-product: ${verdict.asin} is also selected for ${
              (claims.get(verdict.asin) ?? []).filter((id) => id !== productId).join(', ')
            }`,
            eligible: verdict.action === 'select' ? verdict.eligible : [verdict.asin],
          },
        }
      : { productId, verdict },
  );

  return { resolved, conflicts };
}

export function selectCandidate(
  product: CatalogueProduct,
  candidates: Candidate[],
  onSecondaryPath?: (inputs: SecondaryInputs) => void,
): Verdict {
  const ours = new Set(product.barcodes.map(gtin).filter(Boolean));

  // ── ELIGIBILITY. Stable signals only. ──────────────────────────────────────────────
  const eligible = candidates.filter((c) => {
    const theirs = c.amazonIds.map(gtin).filter(Boolean);
    const e1 = theirs.some((t) => ours.has(t)) || (c.matchedEan ? ours.has(gtin(c.matchedEan)) : false);
    if (!e1) return false;
    // E2 is a guard against a barcode collision across brands, not a naming check: an absent
    // brand on either side cannot disprove identity, so it does not fail.
    const e2 = !c.amazonBrand || !product.brand || isBrandStore(c.amazonBrand, product.brand);
    return e2;
  });

  // E3 — a disagreeing generation token holds ALL of them. Not "prefer the newer": we do not
  // know which generation the catalogue row is, and picking one is the coin flip this rule
  // exists to refuse.
  //
  // ABSENCE IS A VALUE HERE, AND THE FIRST IMPLEMENTATION GOT THIS WRONG. Filtering out the
  // untokened candidates made `4.0 vs unversioned` collapse to a single token and E3 stopped
  // firing — so product 82251, which the design measured as a HOLD, became a pick. An explicit
  // "4.0" beside a listing making no generation claim, BOTH CARRYING THE SAME EAN, is exactly
  // the disagreement: one of them is mislabelled, or they are different generations sharing a
  // barcode, and neither reading licenses a pick.
  const gens = new Set(eligible.map((c) => generationToken(c.amazonTitle) ?? '(none)'));
  if (gens.size > 1) {
    return { action: 'hold', on: `E3 generation tokens disagree (${[...gens].join(' vs ')})`, eligible: eligible.map((c) => c.asin) };
  }

  // ── THE SECONDARY PATH. The only route past a failed E1. ───────────────────────────
  //
  // A brand selling its own product under a NEWER SKU is ordinary; a third party listing a
  // near-miss barcode is a VARIANT CLAIM that nothing corroborates. THE SELLER CONDITION IS
  // WHAT SEPARATES THEM and it is load-bearing — without it, title and size would confirm
  // product 1028 (Medpak EU, a reseller) as readily as 794 (Anua's own store).
  //
  // All three conditions required. Every use is logged with its inputs, so that this stops
  // being an n=1 argument and becomes a measurable rate.
  if (eligible.length === 0) {
    const withOffer = candidates.filter((c) => c.offer);
    if (withOffer.length === 1) {
      const c = withOffer[0];
      const brandStore = isBrandStore(c.offer!.sellerName, product.brand);
      const exactTitle = norm(product.name).length > 0 && norm(c.amazonTitle).includes(norm(product.name));
      const ourSize = sizeToken(product.name);
      const theirSize = sizeToken(c.amazonTitle);
      const sizeAgrees = !!ourSize && !!theirSize && ourSize === theirSize;
      const inputs: SecondaryInputs = {
        productId: product.id, asin: c.asin, brandStore, sellerName: c.offer!.sellerName,
        catalogueBrand: product.brand, exactTitle, sizeAgrees,
        catalogueSize: ourSize, amazonSize: theirSize,
        ourBarcodes: [...ours], amazonIds: c.amazonIds.map(gtin),
      };
      // LOGGED ON EVERY EVALUATION, FIRED AND DECLINED BOTH.
      //
      // The first version called this only when the path FIRED, which quietly made the log a
      // record of confirmations rather than of evaluations — and `asin_secondary_path_log`'s
      // own comment says "fired and declined both, so the path becomes a measured rate".
      // A rate needs a denominator. Recording only the successes makes the path look 100%
      // effective forever, which is the opposite of the reason it was adopted with logging.
      //
      // Caught 19 August putting product 1499 through it: title and size agreed, the seller was
      // a third party, the path correctly declined — and nothing was written down.
      onSecondaryPath?.(inputs);
      if (brandStore && exactTitle && sizeAgrees) {
        return { action: 'confirm', asin: c.asin, on: 'secondary_path', secondary: inputs };
      }
      const failed = [!brandStore && 'not the brand store', !exactTitle && 'title differs', !sizeAgrees && 'size differs']
        .filter(Boolean).join(', ');
      return { action: 'hold', on: `E1 barcode mismatch; secondary path declined (${failed})`, eligible: [] };
    }
    return { action: 'hold', on: 'E1 no candidate shares a barcode', eligible: [] };
  }

  if (eligible.length === 1) {
    return { action: 'select', asin: eligible[0].asin, on: 'sole eligible candidate', eligible: eligible.map((c) => c.asin) };
  }

  // ── SELECTION. Volatile signals, in order, among eligible only. ────────────────────
  const rank = (c: Candidate): [number, number, number, number] => [
    c.offer ? 0 : 1,                                            // S1 has a live offer
    c.offer?.inStock ? 0 : 1,                                   // S2 in stock
    isConditionTagged(c.amazonTitle) ? 1 : 0,                   // S3 not condition-tagged
    isBrandStore(c.offer?.sellerName ?? null, product.brand) ? 0 : 1, // S4 brand's own store
  ];
  const labels = ['S1 live offer', 'S2 in stock', 'S3 not condition-tagged', 'S4 brand store'];

  const scored = eligible.map((c) => ({ c, r: rank(c) }));
  scored.sort((a, b) => {
    for (let i = 0; i < 4; i++) if (a.r[i] !== b.r[i]) return a.r[i] - b.r[i];
    return 0;
  });

  const best = scored[0];
  const tied = scored.filter((s) => s.r.every((v, i) => v === best.r[i]));
  if (tied.length > 1) {
    // S5 (price) would break this and was deliberately dropped. A tie here is a HOLD.
    return {
      action: 'hold',
      on: `tie through S4 between ${tied.map((t) => t.c.asin).join(', ')} — S5 (price) was dropped as too volatile`,
      eligible: eligible.map((c) => c.asin),
    };
  }
  const runnerUp = scored[1];
  const decidingIndex = best.r.findIndex((v, i) => v !== runnerUp.r[i]);
  return {
    action: 'select',
    asin: best.c.asin,
    on: labels[decidingIndex] ?? 'S1 live offer',
    eligible: eligible.map((c) => c.asin),
  };
}
