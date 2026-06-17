// ============================================================================
// SHARED product categorisation — the single source of truth for
// inferCategorisation(), imported by all three importers (import-awin-feed,
// import-rakuten-feed, import-shopify-feed).
//
// History: this logic was previously COPY-PASTED into each importer, which
// caused drift — fixes that landed in import-awin-feed (hair detection,
// appliance/eyewear/apparel denylists, cushion/mask gates, …) never reached the
// Rakuten and Shopify copies, so Superdrug/Shopify retailers kept misclassifying.
// PR #18 extracts the (newest, import-awin-feed) version here and deletes the
// copies so every future categorisation change lands everywhere at once.
//
// Validated by scripts/categorisation-harness.mts, which imports THIS module.
// ============================================================================

export type TopCategory = "skincare" | "makeup" | "hair";

export type Categorisation = {
  top_category: TopCategory | null;
  product_type: string;
  subcategory: string;
  tags: string[];
  excluded?: string;
};

export function inferCategorisation(name: string, brand: string = ""): Categorisation {
  // Insert a space between a letter and an adjacent digit so size/qualifier
  // tokens fused onto a keyword still tokenise, e.g. "Shampoo250ml" →
  // "shampoo 250ml" and "SPF50" → "spf 50". Without this the \b-anchored
  // keyword checks below miss the keyword entirely (no word boundary exists
  // between a letter and a digit).
  const t = String(name || "").toLowerCase().replace(/([a-z])(\d)/g, "$1 $2");
  const b = String(brand || "").toLowerCase();

  // ─── Step 1: Excluded categories (denylist) ──────────────────────────────
  const excludeChecks: Array<[string, RegExp]> = [
    // Aftershave: tricky — "Aftershave Balm/Lotion/Cream" is skincare we want.
    // "After Shave 100ml" (no balm/lotion qualifier) is the alcohol splash form,
    // a fragrance product we exclude. Match the latter precisely.
    // Parfum: distinct from "perfumed" (scented). "Parfum Spray", "Parfum Refill",
    // and "Parfum 50ml" are fragrance. Match those, skip the -ed/-ing forms.
    // 'parfum' on its own is matched: it only ever appears in fragrance product
    // NAMES (never skincare/makeup names — the cosmetic ingredient "parfum"
    // lives in ingredient lists, not titles). Debenhams' newer feed format moves
    // size into a separate "| Size: 50ml" field, so designer perfumes now read
    // "...Le Parfum"/"...Parfum Intense" with no adjacent "50ml" — the old
    // size-anchored parfum arm missed them. "parfumed" is unaffected (\b after).
    ["fragrance", /\b(fragrance|perfume|cologne|parfum|eau de (parfum|toilette)|edt|edp|aftershave splash|aftershave spray|aftershave cologne|after.?shave \d+\s*(ml|oz)\b|after.?shave (splash|spray|cologne))\b/],
    ["supplement", /\b(supplement|vitamin tablet|capsule|gummies|protein shake|meal replacement|powder drink|fish oil|cod liver oil|effervescent tablet)\b/],
    ["oral_care", /\b(toothpaste|toothbrush|mouthwash|dental floss|whitening strip)\b/],
    ["period_care", /\b(tampons?|sanitary pads?|menstrual|period care|panty liner|pantyliner)\b/],
    ["deodorant", /\b(deodorant|antiperspirant|body spray)\b/],
    ["shaving", /\b(razor|shaving foam|shave gel|shave cream|epilator|wax strip)\b/],
    // appliance: electric grooming devices (men's trimmers, clippers, electric
    // shavers, laser caps). Debenhams' AWIN feed leaves category_path empty for
    // these (or labels them "Haircare Appliances"), so the path/category
    // excludes can't catch them — they fall through to the skincare catchall.
    // Match on the device noun in the name instead. 'shaver' is distinct from
    // the 'shaving' wet-shave consumables above (foam/gel/razor).
    ["appliance", /\b(trimmer|clippers?|electric shaver|shaver|groomer|laser ?cap)\b/],
    // eyewear: sunglasses/optical frames. Same feed gap — these arrive with an
    // empty category and a model-code name ("BOSS 1743/S", "CK19137S", "FT0995")
    // rather than the word "Sunglasses", so name_excludes ("Sunglasses") and the
    // category excludes both miss them and they default to skincare/face. Catch
    // via (a) eyewear vocabulary, (b) a frame-shape word paired with a sunglasses
    // model suffix (digits + "/" + letter, the "/S" sun convention), or (c) the
    // designer eyewear SKU patterns present in the feed (CK#####, FT####, SY####).
    // \b before "ck"/"ft" prevents matching inside soft/black/gift etc.
    ["eyewear", /\b(sunglasses?|eyewear|eyeglasses|spectacles|aviator|wayfarer|clubmaster|polari[sz]ed|anti.?reflective|oleophobic)\b|\b(rectangle|round|square|wrap|cat.?eye|oval|pilot|browline|rimless)\b.*\b\d{3,4}\s?\/\s?[a-z]\b|\b(ck\s?\d{4,5}s?|ft\s?\d{3,4}|sy\s?\d{4,5}|gg\s?\d{3,4}\s?s[a-z]?)\b/],
    // apparel / footwear / bags: clothing and accessories that arrive with an
    // empty category_path (the well-categorised ones are already dropped by the
    // config category excludes "Clothing"/"Footwear"/"Bags & Wallets"). These
    // leak the same way eyewear does. Match on garment/footwear/bag nouns that
    // don't occur in beauty product names. Deliberately omits collision-prone
    // words: "top"/"coat" (top coat, base coat), "cap" (laser cap, bottle cap),
    // "boots" (Boots the brand/retailer), "shorts" ("short sleeve").
    ["apparel", /\b(trunks?|boxers|briefs|jockstrap|jumper|hoodie|sweatshirt|sweater|cardigan|joggers?|jeans?|trousers?|chinos?|leggings?|shorts?|pants?|cargo|fleece|shirt|t-shirt|tee|polo|blouse|jacket|blazer|gilet|waistcoat|parka|robe|kimono|pyjamas?|pajamas?|dungarees?|beanie|scarf|belt|sneakers?|trainers?|loafers?|brogues?|espadrilles?|sandals?|flip ?flop|cupsole|lace[-\s]?up|low top|rucksack|backpack|duffle|holdall|satchel|crossbody|commuter|wash ?bag|dopp|wallet|billfold|card holder|cardholder|card case)\b/],
    // hair_tool: extended to catch hair brushes by brand (Mason Pearson) and
    // by descriptor patterns (bristle brush, boar bristle, paddle brush etc.)
    ["hair_tool", /\b(hair dryer|straightener|curling iron|curling wand|hair brush|paddle brush|bristle brush|boar bristle|comb|hair clip|hair tie|scrunchie|mason pearson)\b/],
    ["makeup_tool", /\b(makeup brush|beauty blender|sponge|eyelash curler|brush set|brush cleaner)\b/],
    // device: electronic skincare appliances that carry the word "mask" (LED /
    // light-therapy / photon / EMS face masks). They'd otherwise land in the
    // skincare Mask bucket. Require an LED/therapy signal alongside "mask" so
    // sheet/clay/sleeping masks are unaffected.
    ["device", /\b(led|light therapy|photon)\b.*\bmask\b|\bmask\b.*\b(led|light therapy|photon)\b/],
    ["bath_set", /\b(gift set|bath set|body care set|grooming set|skincare set)\b/],
    // 'baby' must NOT match the Maybelline "Baby Lips" line (mainstream lip balm).
    // Match only when 'baby' clearly indicates infant/child product, not when it's
    // a brand line name used in adult cosmetics.
    ["baby", /\b(baby (cream|lotion|wash|shampoo|wipes?|powder|oil|bath|skincare|sunscreen|sun cream)|babies|infant|newborn|toddler|nappy|diaper)\b/],
    ["accessory", /\b(headband|hair tie|spatula|applicator only|case only|bag only|pouch)\b/],
  ];
  // Pre-check: identify clear-cut hair/body-care contexts where 'fragrance'
  // appears as a scent descriptor rather than as the product type.
  // Examples: "Batiste Dry Shampoo... Floral Fragrance Hair Shampoo".
  // When this fires, we skip the fragrance denylist entry but still apply
  // the rest of the denylist normally.
  // ...but a hard fragrance product form (Eau de Toilette/Parfum/Cologne, EDT,
  // EDP, "Parfum Spray/Refill/Nml") is unambiguously a fragrance product even
  // when the name also bundles a shower gel / aftershave balm (gift sets like
  // "...Eau de Toilette Spray 125ml After Shave Balm 100ml Shower Gel 100ml").
  // Don't let the body-care descriptor bypass rescue those — keep excluding.
  const hasHardFragranceForm = (
    /\b(eau de (parfum|toilette|cologne)|edt|edp|parfum (spray|refill|refillable)|parfum \d+\s*(ml|oz))\b/.test(t)
  );
  const fragranceIsScentDescriptor = (
    /\b(shampoo|conditioner|hair mask|hair oil|hair serum|hair spray|hairspray|dry shampoo|body wash|body lotion|body cream|body butter|hand cream|shower gel|bubble bath)\b/.test(t)
    && !hasHardFragranceForm
  );
  // Pre-check: "body spray" matches the deodorant denylist, but sunscreen and
  // oil body sprays (e.g. "SPF30 Sunscreen Body Spray", "Dry Oil Body Spray")
  // are skincare. Skip the deodorant entry for those — unless the name actually
  // says deodorant/antiperspirant (then it really is one, keep excluding).
  const bodySprayIsSkincare = (
    /\b(spf|sunscreen|sun cream|self.?tan|tanning|dry oil|body oil|moistur)\b/.test(t) &&
    !/\b(deodorant|antiperspirant)\b/.test(t)
  );

  for (const [reason, re] of excludeChecks) {
    // Skip fragrance denylist when the name is clearly haircare/body care
    // and 'fragrance' appears as a scent descriptor.
    if (reason === "fragrance" && fragranceIsScentDescriptor) continue;
    // Skip deodorant denylist for sunscreen/oil body sprays (see above).
    if (reason === "deodorant" && bodySprayIsSkincare) continue;
    if (re.test(t)) {
      return {
        top_category: null,
        product_type: "",
        subcategory: "",
        tags: [],
        excluded: reason,
      };
    }
  }

  // ─── Step 2: Hair detection ──────────────────────────────────────────────
  // Run BEFORE skincare so "hair oil" or "hair mask" goes to hair, not skincare.
  // Beard products are facial men's-grooming (skincare), not hair — even from
  // hair-only brands like American Crew. Detect them first and let them fall
  // through to skincare below. (Beard tools — comb/brush — are denylisted in
  // Step 1 already, so this only sees beard care products.)
  const beardGrooming = /\bbeard\b/.test(t);
  const hairCheck = (() => {
    if (beardGrooming) return false;
    // Brow/eyebrow products are makeup, not hair — even when they come from a
    // whitelisted hair brand (e.g. Schwarzkopf Got2B "Glued 4 Brows & Edges",
    // "Brow Lift Styling Wax"). Bail here so they fall through to the makeup
    // detector below. \bbrow\b does NOT match "brown" (no word boundary between
    // "brow" and "n"), so hair-dye shades like "Dark Brown" are unaffected.
    if (/\b(eyebrows?|brows?)\b/.test(t)) return false;
    // Davines' sister skincare line (Comfort Zone / Sacred Nature) can ship
    // under the Davines brand — keep it skincare, don't let the brand whitelist
    // sweep it into hair.
    if (/\bcomfort zone\b/.test(t) || /\bcomfort zone\b/.test(b)) return false;
    // Non-haircare uses of the word "hair" — bail BEFORE any hair keyword/bare-
    // "hair" rule so e.g. "ingrown hair serum" isn't swept up by "hair serum".
    // Covers depilatories ("hair removal/remover", "depilatory/epilator"),
    // facial/ingrown hair, 2-in-1 "hair & body" washes (body), and ingestible
    // "hair, skin & nails" supplements.
    if (/\b(hair\s*(removal|remover|removing|inhibitor|minimi\w*|reduc\w*)|hair no more|facial\s+hair|ingrown\s+hair|depilat\w*|epilat\w*)\b/.test(t)) return false;
    if (/\bhair\s*(?:&|and|\+)\s*body\b/.test(t)) return false;
    if (/\b(?:skin\s*(?:&|and|\+)\s*hair|hair\s*,?\s*(?:&|and|\+)?\s*skin)\b/.test(t)) return false;
    if (/\b(shampoo|conditioner|co-?wash|leave-?in)\b/.test(t)) return true;
    if (/\b(hair (mask|oil|serum|spray|cream|gel|mousse|wax|balm|treatment|tonic|perfector|repair|food|primer))\b/.test(t)) return true;
    // Scalp care is unambiguously hair domain (scalp treatments/scrubs/serums/
    // concentrates). 'scalp' barely ever appears in face skincare, and the
    // brow/beard/comfort-zone guards above have already run. Broadened from the
    // old `scalp (treatment|serum|…)` because feeds write "Scalp Peppermint
    // Treatment", "Scalp Sync Purifying Concentrate" etc. (v6.18 / Beauty Flash).
    if (/\bscalp\b/.test(t)) return true;
    if (/\b(hair (colour|color|dye|toner|bleach))\b/.test(t)) return true;
    // Bare "hair" as a haircare signal — catches hair products that carry no
    // structured "hair X" keyword ("My Hair My Canvas Curl Cleanser", "Hair Loss
    // Serum", "Miracle Hair Elixir", "Grooming Putty Hair Paste"). The non-haircare
    // uses of the word ("hair removal", "ingrown hair", "hair & body", supplements)
    // already returned false in the guard block above.
    if (/\bhair\b/.test(t)) return true;
    if (/\b(dry shampoo|hair perfume|root touch.?up|heat protect|frizz control)\b/.test(t)) return true;
    if (/\b(hairspray|hair spray|hair lacquer|setting spray hair)\b/.test(t)) return true;
    // Standalone styling keywords: unambiguous hair-styling product types that
    // don't carry a "hair" prefix. 'clay'/'paste'/'wax'/'cream' are too generic
    // alone (clay mask, body wax, hand cream) so they're only matched when paired
    // with a styling qualifier (molding/styling/texture/grooming).
    //   - Gate on !brow/eyebrow/concealer: "brow pomade", "concealer pomade" and
    //     "brow styling wax/cream" are makeup, not hair.
    //   - 'sculpting' and 'matte' are intentionally NOT qualifiers — they collide
    //     with skincare "(micro-)sculpting cream" and makeup "matte/sculpting powder".
    if (!/\b(brow|eyebrow|concealer)\b/.test(t) &&
        /\b(pomade|(mo(u)?lding|styling|texturi[sz]ing|texture|grooming) (clay|paste|cream|wax|mud|powder|spray|balm|foam|lotion|milk|oil|gel|mist)|blow.?dry|blow.?out|sea salt spray|surf spray|edge control)\b/.test(t)) return true;
    // Brand-name signals: brands whose entire range is hair (low risk of false
    // positives), so products with no hair keyword in the name still route to
    // hair (e.g. "Forming Cream", "Surf Infusion", "Full Dry Volume Blast").
    const hairBrand = /\b(olaplex|kerastase|kérastase|moroccanoil|oribe|virtue labs|american crew|bumble and bumble|bumble & bumble|living proof|redken|paul mitchell|pureology|color wow|colour wow|sachajuan|label\.?m|tigi|davines|schwarzkopf|amika|lee stafford|tresemm[eé]|ogx|briogeo|umberto giannini|alterna|biolage)\b/;
    if (hairBrand.test(t)) return true;
    if (hairBrand.test(b)) return true;
    // 'Matrix' and 'Fudge' are hair brands but also common English words (matrix;
    // fudge as a flavour/shade — "Heavenly Fudge Palette", "Pistachio Fudge Body
    // Scrub"), so trust them ONLY in the brand field, never as a name word.
    if (/\b(matrix|fudge)\b/.test(b)) return true;
    return false;
  })();

  if (hairCheck) {
    let product_type = "Hair Care";
    let subcategory = "";

    if (/\b(shampoo|co-?wash|cleansing (shampoo|conditioner)|clarifying)\b/.test(t)) {
      product_type = "Shampoo";
      subcategory = "cleanse";
    } else if (/\b(conditioner|leave-?in|detangler)\b/.test(t) && !/\bshampoo\b/.test(t)) {
      product_type = "Conditioner";
      subcategory = "condition";
    } else if (/\b(hair colour|hair color|hair dye|hair toner|hair bleach|root touch.?up)\b/.test(t)) {
      product_type = "Hair Colour";
      subcategory = "colour";
    } else if (/\b(hair (mask|treatment|repair|reconstruct|perfector)|mask|masque|treatment mask|repair mask|bond (builder|repair|maintenance)|protein treatment|deep condition(ing)? treatment)\b/.test(t) || /\bolaplex\b/.test(t)) {
      // In-context bare "mask"/"masque"/"treatment" → Hair Treatment. We only
      // reach here for products already routed to hair (Step 2), so a hair brand's
      // "Repair Mask"/"Toning Treatment Mask" resolves to a treatment, not Hair Care.
      product_type = "Hair Treatment";
      subcategory = "treatment";
    } else if (/\b(hair (oil|serum|tonic))|scalp (oil|tonic|serum|treatment)\b/.test(t)) {
      product_type = "Hair Treatment";
      subcategory = "treatment";
    } else if (/\b(hair (spray|gel|mousse|wax|balm|cream|pomade|paste|fiber|fibre)|hairspray|edge control|pomade|(mo(u)?lding|styling|texturi[sz]ing|texture|grooming) (clay|paste|cream|wax|mud|powder|spray)|sea salt spray|surf spray)\b/.test(t)) {
      product_type = "Hair Styling";
      subcategory = "style";
    } else {
      product_type = "Hair Care";
      subcategory = "treatment";
    }

    return {
      top_category: "hair",
      product_type,
      subcategory,
      tags: ["hair", subcategory].filter(Boolean),
    };
  }

  // ─── Step 3: Makeup detection ────────────────────────────────────────────
  const makeupCheck = (() => {
    // Cushion foundations are unambiguous makeup, but their names commonly also
    // contain skincare-trigger keywords (Mask Fit, SPF, Sun Protection) that
    // would otherwise trip skincare detection (mask/peel/pack, SPF) first. Gate
    // this before any other makeup check so cushions route to makeup regardless.
    // Guard against cushion-related ACCESSORIES (pad/case/puff/sponge) — those
    // are makeup_tools, denylisted in Step 1, not cushion foundations.
    if (/\bcushion\b/.test(t) && !/\b(cushion (pad|case|puff|sponge)|refill only)\b/.test(t)) {
      return true;
    }
    if (/\b(lipstick|lip gloss|lip stain|lip lacquer|lip pencil|lip liner|lip tint|lip plumper|lip cream|lip paint|lip color|lip colour|lip shine|lip crayon|color balm|colour balm|liquid lip|matte lip|cream lip)\b/.test(t)) return true;
    if (/\b(mascara|eyeliner|eye liner|eye shadow|eyeshadow|eyebrows?|brows?)\b/.test(t)) return true;
    // Clinique 'Quickliner For Eye' brand-line pattern
    if (/\b(quickliner|kohl)\b/.test(t)) return true;
    if (/\b(foundation|concealer|colour corrector|color corrector|primer)\b/.test(t)) return true;
    if (/\b(blush|bronzer|highlighter|highlighting|contour|contouring|illuminator|strobing|strobe)\b/.test(t)) return true;
    // 'bronze' standalone is risky (skincare body products use it) — only treat
    // as makeup when paired with a powder/shimmer cosmetic descriptor.
    if (/\bbronze\b.*\b(powder|palette|stick|shimmer|glow palette)\b/.test(t)) return true;
    if (/\b(setting (spray|powder)|finishing powder|fixing spray|fixing mist)\b/.test(t)) return true;
    // Face powder variants (Clinique Superpowder, Sheer Pressed Powder, etc.)
    if (/\b(face powder|pressed powder|loose powder|compact powder|superpowder|powder makeup)\b/.test(t)) return true;
    if (/\b(nail (polish|colour|color|lacquer|varnish|enamel)|nail (treatment|strengthener)|cuticle (oil|cream)|nail base|base coat|top coat|nail file)\b/.test(t)) return true;
    if (/\bfalse (lashes|eyelashes)|lash (extension|adhesive|glue)\b/.test(t)) return true;
    // Generic 'makeup' as a noun (Clinique 'Superbalanced Makeup' brand line).
    // Excludes 'makeup remover' (denylisted earlier) and 'makeup brush' (in
    // makeup_tool denylist run before this detector). Must come last so that
    // more specific product-type detection above takes precedence for routing.
    if (/\bmakeup\b/.test(t) && !/\bmakeup (remover|removal|wipe)\b/.test(t)) return true;
    return false;
  })();

  if (makeupCheck) {
    let product_type = "Makeup";
    let subcategory = "";

    // Eyes
    if (/\b(mascara)\b/.test(t)) {
      product_type = "Mascara";
      subcategory = "eyes";
    } else if (/\b(eyeliner|eye liner|quickliner|kohl)\b/.test(t)) {
      product_type = "Eyeliner";
      subcategory = "eyes";
    } else if (/\b(eyeshadow|eye shadow)\b/.test(t)) {
      product_type = "Eyeshadow";
      subcategory = "eyes";
    } else if (/\b(eyebrows?|brows?)\b/.test(t)) {
      product_type = "Brow";
      subcategory = "eyes";
    } else if (/\bfalse (lashes|eyelashes)|lash (extension|adhesive|glue)\b/.test(t)) {
      product_type = "Lashes";
      subcategory = "eyes";
    }
    // Lips — order matters: most specific first so 'matte lip liner' doesn't
    // get matched as a Lipstick before the Lip Liner check.
    else if (/\b(lip pencil|lip liner)\b/.test(t)) {
      product_type = "Lip Liner";
      subcategory = "lips";
    } else if (/\b(lip gloss|lip stain|lip lacquer|lip tint|lip plumper|lip paint|lip color|lip colour|lip shine)\b/.test(t)) {
      product_type = "Lip Colour";
      subcategory = "lips";
    } else if (/\b(lipstick|liquid lip|matte lip|cream lip|lip cream|color balm|colour balm|lip crayon)\b/.test(t)) {
      product_type = "Lipstick";
      subcategory = "lips";
    }
    // Face
    else if (/\bcushion\b/.test(t)) {
      // Cushion foundations: most don't carry the word "foundation" in the name
      // (TirTir Mask Fit, Clio Kill Cover, Unleashia, Missha, etc.), so resolve
      // them to Foundation before the keyword-based Foundation branch below.
      product_type = "Foundation";
      subcategory = "face";
    } else if (/\b(foundation|bb cream|cc cream|skin tint|tinted moisturiser|tinted moisturizer)\b/.test(t)) {
      product_type = "Foundation";
      subcategory = "face";
    } else if (/\b(concealer|colour corrector|color corrector)\b/.test(t)) {
      product_type = "Concealer";
      subcategory = "face";
    } else if (/\bprimer\b/.test(t)) {
      product_type = "Primer";
      subcategory = "face";
    } else if (/\b(setting (powder|spray)|finishing powder|fixing (spray|mist))\b/.test(t)) {
      product_type = "Setting";
      subcategory = "face";
    } else if (/\b(face powder|pressed powder|loose powder|compact powder|superpowder|powder makeup|sheer.{0,10}powder)\b/.test(t)) {
      product_type = "Powder";
      subcategory = "face";
    } else if (/\b(blush|bronzer|highlighter|highlighting|contour|contouring|illuminator|strobing|strobe|cheek (colour|color|tint|stick))\b/.test(t)) {
      product_type = "Blush/Bronzer";
      subcategory = "face";
    } else if (/\bbronze\b.*\b(powder|palette|stick|shimmer)\b/.test(t)) {
      product_type = "Blush/Bronzer";
      subcategory = "face";
    }
    // Nails
    else if (/\b(nail (polish|colour|color|lacquer|varnish|enamel))\b/.test(t)) {
      product_type = "Nail Polish";
      subcategory = "nails";
    } else if (/\b(nail (treatment|strengthener|oil)|cuticle (oil|cream))\b/.test(t)) {
      product_type = "Nail Treatment";
      subcategory = "nails";
    } else if (/\b(superbalanced|sheer|matte|liquid|cream|stick) makeup\b/.test(t)) {
      // Brand-line generic makeup products without a specific descriptor
      // (e.g. Clinique Superbalanced Makeup) are most often foundation.
      product_type = "Foundation";
      subcategory = "face";
    } else {
      product_type = "Makeup";
      subcategory = "face";
    }

    return {
      top_category: "makeup",
      product_type,
      subcategory,
      tags: ["makeup", subcategory].filter(Boolean),
    };
  }

  // ─── Step 4: Skincare detection (existing logic, extended) ────────────────
  // Lip detection MUST run before generic balm/cream/lotion match,
  // otherwise "Lip Balm" gets classified as Moisturiser.
  // Mask over-tagging guard: a coincidental "mask"/"peel"/"pack" token must not
  // steal a product whose primary type is eye / acne-patch / peel-exfoliant /
  // cleanser / toner-pad. These gates run BEFORE the Mask classifier, which then
  // only fires on a genuine face-mask form. (Hair masks are handled upstream in
  // Step 2 via the hair-brand whitelist.) Same precedence approach as the Step 3
  // cushion gate.
  let skincare_product_type = "";
  // Lip first, so "lip mask" → Lip Care not Mask.
  if (/\blip (balm|oil|treatment|mask|scrub|butter|conditioner)\b/.test(t)) skincare_product_type = "Lip Care";
  // Eye context — creams/serums AND under-eye gel/hydrogel patches & pads → Eye Care.
  else if (/\b(eye cream|eye serum|eye gel|eye mask|eye balm|under.?eye|eye (patch|patches|pad|pads)|(gel|hydrogel) (patch|patches))\b/.test(t)) skincare_product_type = "Eye Care";
  // Acne/blemish hydrocolloid patches (spot stickers) → Treatment, NOT Mask.
  else if (/\b(spot|acne|pimple|blemish|hydrocolloid|mighty)\b.{0,20}\b(patch|patches|sticker|stickers|dot|dots|star|stars)\b/.test(t) || /\bpimple patch(es)?\b/.test(t)) skincare_product_type = "Treatment";
  // Peels are exfoliants — but a "peel-off" mask is a mask (caught below).
  else if (/\b(peel|peeling)\b/.test(t) && !/\bpeel[- ]?off\b/.test(t)) skincare_product_type = "Exfoliator";
  // Cleanser forms that collide with the Korean "pack" mask token (e.g.
  // "Pore Pack Foam Cleanser") — claim them as Cleanser before the Mask branch.
  else if (/\b(foam cleanser|cleansing foam|foaming cleanser|gel cleanser|cleansing gel|oil cleanser|cleansing oil|cleansing balm|cleansing water|micellar|face wash|facial wash|cleansing milk|milk cleanser)\b/.test(t)) skincare_product_type = "Cleanser";
  // Toner-soaked pads → Toner. Ampoule/essence/serum pads fall through to Serum;
  // exfoliating/peel pads were already claimed above. (Eye pads handled above.)
  else if (/\b(toner pad|toning pad)\b/.test(t) || (/\b(pad|pads)\b/.test(t) && !/\b(ampoule|essence|serum|cotton|cushion|exfoliat|scrub|peel)\b/.test(t))) skincare_product_type = "Toner";
  // Genuine face-mask forms only: the word "mask", or a real Korean "pack" mask.
  // Bare "peel" and bare quantity "pack" ("3 Pack", "Pack of 100") no longer match.
  else if (/\bmask\b/.test(t) || /\b(sleeping (gel |water |mask )?pack|wash[- ]?off pack|modell?ing pack|clay pack|nose pack|pore pack|peel[- ]?off pack|rubber (mask|pack)|hydrogel pack|jelly pack|zombie pack)\b/.test(t)) skincare_product_type = "Mask";
  else if (/\b(cleanser|cleansing|wash|foam)\b/.test(t)) skincare_product_type = "Cleanser";
  else if (/\btoner\b/.test(t)) skincare_product_type = "Toner";
  else if (/\b(serum|ampoule|essence)\b/.test(t)) skincare_product_type = "Serum";
  else if (/\b(sun|spf|uv|sunscreen)\b/.test(t)) skincare_product_type = "SPF";
  else if (/\b(moistur|cream|lotion|emulsion|balm)\b/.test(t)) skincare_product_type = "Moisturiser";
  else if (/\bsalve\b/.test(t)) skincare_product_type = "Moisturiser";
  else if (/\beye\b/.test(t)) skincare_product_type = "Eye Care";
  else if (/\blip\b/.test(t)) skincare_product_type = "Lip Care";
  else if (/\boil\b/.test(t)) skincare_product_type = "Oil";
  else if (/\bmist\b/.test(t)) skincare_product_type = "Mist";
  else if (/\b(exfoliat|scrub)\b/.test(t)) skincare_product_type = "Exfoliator";
  else skincare_product_type = "Skincare"; // catchall

  // Skincare subcategory: detect from body location keywords. Default 'face'.
  let skin_subcategory = "face";
  if (/\b(hand (cream|lotion|sanit|wash|soap|mask|salve|balm|butter|serum)|hand & nail)\b/.test(t)) {
    skin_subcategory = "hand";
  } else if (/\b(foot (cream|lotion|mask|soak|scrub|balm|serum)|heel balm|heel cream|cracked heel)\b/.test(t)) {
    skin_subcategory = "foot";
  } else if (/\b(body (lotion|cream|butter|oil|wash|scrub|mask|milk|mist|balm|sunscreen|serum)|after.?sun|tanning lotion|self.?tan|stretch mark)\b/.test(t)) {
    skin_subcategory = "body";
  } else if (/\b(face & body|body & face|all over)\b/.test(t)) {
    skin_subcategory = "both";
  } else if (/\b(face cream|face wash|face oil|face mask|facial)\b/.test(t)) {
    skin_subcategory = "face";
  }

  // Skincare tags: include the top_category, the subcategory, and any
  // cross-cutting markers (lip products dual-tagged with 'lips' and 'lip_care').
  const skin_tags: string[] = ["skincare", skin_subcategory];
  if (skincare_product_type === "Lip Care" || /\blip (balm|oil|treatment|mask)\b/.test(t)) {
    if (!skin_tags.includes("lips")) skin_tags.push("lips");
    skin_tags.push("lip_care");
  }
  if (/\b(men|men's|for men|mens|beard)\b/.test(t) || /\b(men|men's|for men|mens)\b/.test(b)) {
    skin_tags.push("mens");
  }

  return {
    top_category: "skincare",
    product_type: skincare_product_type,
    subcategory: skin_subcategory,
    tags: skin_tags,
  };
}
