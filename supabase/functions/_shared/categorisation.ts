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

// ─── Shared fragrance signal regexes (single source of truth) ───────────────
// Reused by inferCategorisation()'s denylist guards AND by the Stage-2
// classifyFragranceOrPersonalCare() detector at the bottom of this file, so the
// "what counts as a hard fragrance form" and "what counts as fragrance-free"
// definitions can never drift apart.
//
// A HARD fragrance form (eau de parfum/toilette/cologne, EDT, EDP, parfum
// spray/refill/Nml) is unambiguously a fragrance product, even inside a gift set
// that also lists a shower gel / aftershave balm.
const RE_HARD_FRAGRANCE_FORM =
  /\b(eau de (parfum|toilette|cologne)|edt|edp|parfum (spray|refill|refillable)|parfum \d+\s*(ml|oz))\b/;
// A "fragrance free / fragrance-free / without fragrance / non fragrance / zero
// fragrance" claim marks a sensitive-skin skincare (or fragrance-free body)
// product, NOT a fragrance. 'zero fragrance' added in Commit 21.
const RE_FRAGRANCE_FREE =
  /\b(fragrance[\s-]?free|without fragrance|non[\s-]?fragrance|zero fragrance)\b/;

export function inferCategorisation(name: string, brand: string = ""): Categorisation {
  // Insert a space between a letter and an adjacent digit so size/qualifier
  // tokens fused onto a keyword still tokenise, e.g. "Shampoo250ml" →
  // "shampoo 250ml" and "SPF50" → "spf 50". Without this the \b-anchored
  // keyword checks below miss the keyword entirely (no word boundary exists
  // between a letter and a digit).
  const t = String(name || "").toLowerCase().replace(/([a-z])(\d)/g, "$1 $2");
  const b = String(brand || "").toLowerCase();

  // ─── Step 0: Beauty-device whitelist ─────────────────────────────────────
  // At-home LED / light-therapy / photon / EMS face masks, microcurrent and
  // cryotherapy tools are skincare appliances we WANT (Foreo, Silk'n, Theragun
  // Theraface, Shark CryoGlow, Ulike), not exclusions. Without this they'd hit
  // the device denylist (LED masks) or fall into the skincare Mask bucket. Return
  // a clean skincare/Device classification BEFORE the denylist runs.
  // The brand arm is gated by a device signal so non-devices from the same brand
  // (e.g. a Foreo ISSA electric toothbrush) are NOT rescued and still hit their
  // own exclusion (oral_care). NB: IPL *hair removal* handsets (Philips Lumea) are
  // deliberately NOT whitelisted — they stay `appliance`.
  const isBeautyDevice =
    /\b(led|light therapy|photon|ems)\b.*\bmask\b/.test(t) ||
    /\bmask\b.*\b(led|light therapy|photon|ems)\b/.test(t) ||
    /\bmicrocurrent\b/.test(t) ||
    /\bcryo(therapy|glow)\b/.test(t) ||
    ((/\b(foreo|silk'?n|therabody|theragun|ulike)\b/.test(b) || /\bcryoglow\b/.test(t)) &&
      /\b(led|light therapy|photon|ems|microcurrent|cryo\w*)\b.*\bmask\b/.test(t));
  if (isBeautyDevice) {
    return {
      top_category: "skincare",
      product_type: "Device",
      subcategory: "face",
      tags: ["skincare", "face", "device"],
    };
  }

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
    // intimate_health: medical / intimate-care products (thrush treatments,
    // vaginal moisturisers, feminine hygiene, intimate-care kits, sex toys)
    // that leak into skincare by matching the bare cream/moistur keywords in
    // the Moisturiser branch. Descriptor words (cream/gel/moistur/wash) are only
    // matched when anchored to an intimate/feminine/thrush prefix, so generic
    // skincare ("foot cream", "hand moisturiser") is unaffected. Brand-name
    // anchors (canescool|canesten|canesfresh|relactagel|menocare) are a safety
    // net for names where the descriptor is too generic but the brand is
    // unambiguous.
    // Descriptor arms allow up to 2 intervening adjectives so real names match:
    // "Intimate Active Wash", "Intimate Daily Wash", "Intimate Foam Wash",
    // "Intimate Skin Care … Wash" (Femfresh), "Intimate Foam Wash" (YES). The
    // grooming/makeup guard (intimateIsGroomingOrMakeup) keeps pubic-hair shave
    // products and "Intimate" shade/edition names out.
    ["intimate_health", /\b(vaginal|vulva|feminine(?:\s+\w+){0,2}\s+(wash|hygiene|care|cleanser|moistur)|intimate(?:\s+\w+){0,2}\s+(wash|hygiene|care|cleanser|moistur)|thrush (cream|gel|treatment)|bv (treatment|relief|gel)|menocare|relactagel|canesfresh|canescool|canesten|sex toy|vibrator)\b/],
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
    // "boots" (Boots the brand/retailer).
    // NB 'cargo' is deliberately NOT a bare token — "cargo pants/shorts" are
    // already caught by pants?/shorts, and bare 'cargo' false-positives on
    // colour/shade names (e.g. Rimmel "60 Seconds … Crazy About Cargo" nail
    // polish), which would wrongly exclude the product from the catalogue.
    // Commit 20: garment words that ONLY ever appear in beauty names in the
    // SINGULAR are forced to plural — "short" (false-nail/lash length, "Short
    // Beard" moisturiser, "Short Handle" brush, "Short Hair" perm) and "trunk"
    // (Drunk Elephant "Trunk" kit) — so only true garments (shorts/trunks)
    // match. 'jean'/'polo'/'belt' stay singular-matching ON PURPOSE: there they
    // catch designer-perfume names ("Jean Paul", "Polo", "Below the Belt") which
    // are out-of-scope and should remain excluded; in-scope beauty uses of those
    // words are rescued by apparelIsBeautyProduct / the nail-lash brand allowlist.
    ["apparel", /\b(trunks|boxers|briefs|jockstrap|jumper|hoodie|sweatshirt|sweater|cardigan|joggers?|jeans?|trousers?|chinos?|leggings?|shorts|pants?|fleece|shirt|t-shirt|tee|polo|blouse|jacket|blazer|gilet|waistcoat|parka|robe|kimono|pyjamas?|pajamas?|dungarees?|beanie|scarf|belt|sneakers?|trainers?|loafers?|brogues?|espadrilles?|sandals?|flip ?flop|cupsole|lace[-\s]?up|low top|rucksack|backpack|duffle|holdall|satchel|crossbody|commuter|wash ?bag|dopp|wallet|billfold|card holder|cardholder|card case)\b/],
    // hair_tool: extended to catch hair brushes by brand (Mason Pearson) and
    // by descriptor patterns (bristle brush, boar bristle, paddle brush etc.)
    ["hair_tool", /\b(hair dryer|straightener|curling iron|curling wand|hair brush|paddle brush|bristle brush|boar bristle|comb|hair clip|hair tie|scrunchie|mason pearson)\b/],
    ["makeup_tool", /\b(makeup brush|beauty blender|sponge|eyelash curler|brush set|brush cleaner)\b/],
    // NB: LED / light-therapy / photon / EMS / microcurrent / cryotherapy beauty
    // devices are handled by the Step 0 beauty-device whitelist above (routed to
    // skincare/Device), so there is no `device` denylist entry here.
    ["bath_set", /\b(gift set|bath set|body care set|grooming set|skincare set)\b/],
    // 'baby' must NOT match the Maybelline "Baby Lips" line (mainstream lip balm).
    // Match only when 'baby' clearly indicates infant/child product, not when it's
    // a brand line name used in adult cosmetics.
    ["baby", /\b(baby (cream|lotion|wash|shampoo|wipes?|powder|oil|bath|skincare|sunscreen|sun cream)|babies|infant|newborn|toddler|nappy|diaper)\b/],
    // 'pouch' alone wrongly caught skincare REFILL pouches (CeraVe, Kiehl's,
    // Cetaphil) and sachet "stick pouch" sets (VT, Mixsoon, Round Lab) — the
    // pouch is the product's packaging, not a standalone accessory. Match only
    // genuine empty-pouch accessories.
    ["accessory", /\b(headband|hair tie|spatula|applicator only|case only|bag only|pouch only|makeup pouch|cosmetic pouch)\b/],
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
  const hasHardFragranceForm = RE_HARD_FRAGRANCE_FORM.test(t);
  // Commit 20: also covers (a) HAIR scent forms feeds write with "fragrance"/
  // "parfum" in the title (hair mist, hair & body mist — L'Atelier Parfum,
  // Kérastase Le Parfum Hair Mist; body soap — Shiseido Ma Cherie) and (b)
  // MAKEUP named after a scent ("Blush Cheek … Guava Parfum", "Lip Rehab …
  // Watermelon fragrance", "Lash Clash Mascara & Parfum Set"). Bare "body mist"
  // is deliberately NOT here — many body mists are genuinely fragrance.
  const fragranceIsScentDescriptor = (
    /\b(shampoo|conditioner|hair mask|hair oil|hair serum|hair spray|hairspray|hair mist|hair (and|&) body mist|dry shampoo|body wash|body lotion|body cream|body butter|body soap|hand cream|shower gel|bubble bath|lip|blush|cheek|mascara)\b/.test(t)
    && !hasHardFragranceForm
  );
  // Pre-check: "Fragrance Free" / "Fragrance-Free" is, by definition, NOT a
  // fragrance product — it's a sensitive-skin descriptor on sunscreens, day
  // creams, cleansers, toners and body moisturisers (Bondi Sands, Olay, Child's
  // Farm, Vichy, CeraVe, …). The bare 'fragrance' token wrongly excluded all of
  // them. Skip the fragrance entry for these, unless the name ALSO carries a hard
  // fragrance form (a nonsensical "Eau de Parfum … Fragrance Free" gift set would
  // still be excluded).
  // Commit 20: feeds also write "Without Fragrance" / "Non Fragrance" (Olay
  // Regenerist serums & eye creams) — same sensitive-skin descriptor, not a
  // fragrance product.
  const fragranceFree = RE_FRAGRANCE_FREE.test(t) && !hasHardFragranceForm;
  // Pre-check: "body spray" matches the deodorant denylist, but sunscreen, oil
  // and skincare-active body sprays (SPF, "Salicylic Acid Clarifying Body Spray",
  // "Thermal Spring Water Face & Body Spray", "Sebium … Body Spray") are skincare.
  // Skip the deodorant entry for those — unless the name actually says
  // deodorant/antiperspirant (then it really is one, keep excluding). Genuine
  // fragrance/deodorant body sprays (Lynx, FCUK) carry none of these terms and
  // stay excluded.
  const bodySprayIsSkincare = (
    /\b(spf|sunscreen|sun cream|self.?tan|tanning|dry oil|body oil|moistur|clarifying|salicylic|niacinamide|hyaluron\w*|thermal|spring water|exfoliat\w*|microbiome|prebiotic|sebium|glycolic|acid|cica|ceramide)\b/.test(t) &&
    !/\b(deodorant|antiperspirant)\b/.test(t)
  );
  // Pre-check: "capsule" in K-beauty means encapsulated-ingredient TOPICAL
  // skincare (capsule cream/serum/ampoule/toner/essence — Anua, Skin1004,
  // Medicube, …), not an ingestible supplement. Skip the supplement entry when
  // 'capsule' sits alongside a topical form. Genuine ingestibles ("… Capsules
  // 60", collagen capsules) carry no topical form and stay excluded.
  // Commit 20: 'concentrate' must match the plural feeds actually use ("Capsule
  // Concentrates" — 7th Heaven Vitamin C / Retinol topical capsules); the bare
  // \b form missed the trailing 's'.
  const capsuleIsTopical = /\bcapsule\b/.test(t) &&
    /\b(cream|serum|ampoule|toner|essence|cleans\w*|foam|sunscreen|spf|mask|moistur|lotion|drop|gel|concentrate\w*)\b/.test(t);
  // Pre-check: apparel/footwear/bag denylist over-fires on garment WORDS used as
  // cosmetic shade / line names (Essie "Espadrille", Maybelline "Business
  // Blouse", Chanel "Rouge Coco … Jean", Guerlain "Robe Noire" lip/body, Bluesky
  // "Satin Robe" gel polish, Huda "Hoodie" lashes) and on body-care from
  // fragrance lines. A product naming a clear beauty product-form is not a
  // garment — skip apparel for those. Genuine garments/bags (scarves, wash bags,
  // robe sets, duvets) carry no beauty-form token and stay excluded.
  // Commit 20: 'nail' → 'nails?' (feeds write "Oval Nails"; the bare \b missed
  // the plural and let false nails fall to apparel via "Short"); added eye
  // serum/cream ("White Sandal … Eye Serum"), anti-chafing body care ("Below
  // the Belt Anti Chaffing Cream") and body powder.
  const apparelIsBeautyProduct = /\b(nails?|gel polish|lipstick|lip (gloss|colour|color|paint|lacquer|shine|kit|liner|tint|balm|crayon|stick)|eyeliner|eye (definer|pencil|serum|cream)|eye ?shadow|shadow palette|mascara|brow|lash|lashes|blush|bronzer|highlighter|foundation|concealer|anti.?chaf\w*|body (milk|mist|lotion|cream|scrub|wash|butter|oil|powder)|shower (gel|cream)|scrub|soap|after ?shave (balm|lotion)|perfumed (soap|body|shower))\b/.test(t);
  // Pre-check: makeup_tool over-fires when a brush/sponge is a BUNDLED extra on a
  // skincare product ("Soothing Cream + Brush Set", "Night … with Brush Set",
  // "Face Cleanser & Face Sponge"). A tool introduced by with/plus/+/& is a
  // bonus, not the product — skip makeup_tool. Standalone tool sets ("Skincare
  // Brush Set", "Konjac Sponge", "Sea Sponge Set") carry no such connector and
  // stay excluded.
  const toolIsBundledExtra = /\b(with|plus)\b[^|]*\b(brush|sponge)\b/.test(t) ||
    /[+&][^|]*\b(brush|sponge)\b/.test(t);
  // Pre-check: intimate_health must NOT steal intimate-area GROOMING (pubic-hair
  // shave/trim/wax/depilatory — Gillette/Philips/Veet/WooWoo: those are
  // shaving/appliance) nor MAKEUP/FRAGRANCE that merely use "Intimate" as a shade
  // or edition name (Armani "Lipstick Intimate", MAC "Intimate Nude" palette,
  // Britney "EDP Intimate Edition"). Skip intimate_health for those.
  const intimateIsGroomingOrMakeup = (
    /\b(shav\w*|trimmer|razor|epilat\w*|depilat\w*|pubic|hair removal|wax(ing)?)\b/.test(t) ||
    /\b(lipstick|lip power|eye ?shadow|palette|mascara|nail polish|foundation|edp|edt|eau de)\b/.test(t)
  );
  // Pre-check: the appliance denylist's 'groomer'/'clipper' tokens over-fire on
  // manual MAKEUP accessories. "Lash/Brow Groomer", "Brow Groomer & Brush" are
  // brow tools, and "Nail Polish Protection Clipper Protector" is a nail-polish
  // accessory — both belong in makeup, not excluded as electric appliances.
  // Anchor tightly so genuine appliances stay excluded: brow/lash groomers need a
  // brow/lash word (Braun "Body Groomer", Meridian "Below-The-Belt Groomer" lack
  // it); the nail accessory needs "nail polish" + protect (generic "Toenail
  // Clipper"/"Nail Clippers" lack both).
  const applianceIsBrowLashTool =
    /\bgroomer\b/.test(t) && (/\b(eye)?brows?\b/.test(t) || /\blash(es)?\b/.test(t));
  const applianceIsNailPolishAccessory =
    /\bnail polish\b/.test(t) && /\bprotect/.test(t);
  // Pre-check (Commit 20): nail/lash SHADE names collide with garment tokens
  // (Collection "Leather Jacket", Kiss "Nude Blazer", Bluesky "Sweater Weather",
  // House of Amor lash lengths) and carry no beauty-form word the apparel
  // beauty-guard recognises. These brands are cosmetics-only, so skip the
  // apparel denylist for them entirely — the nail/lash detectors route them.
  const isNailLashShadeBrand =
    /\b(collection|kiss|bluesky|elegant touch|house of amor)\b/.test(b);
  // Pre-check (Commit 20): a razor bundled as a freebie on a skincare product
  // ("Skincare Bundle - … Moisturiser & Bambo Razor") is not a wet-shave
  // product. Standalone razors carry no skincare anchor and stay excluded.
  const shaveIsBundledExtra =
    (/\b(with|plus)\b[^|]*\brazor\b/.test(t) || /[+&][^|]*\brazor\b/.test(t)) &&
    /\b(moisturiser|moisturizer|skincare|serum|cleanser|cream)\b/.test(t);
  // Pre-check (Commit 20): a multi-step body-care KIT that lists a deodorant as
  // one component ("Everywhere Body Minis Kit … Wash Spray To Wipe & Deodorant",
  // LUNA DAILY) is body care, not a standalone deodorant. Require 'kit' plus a
  // non-deodorant body form so genuine "Deodorant Kit" travel packs stay out.
  const deodorantIsKitComponent =
    /\bkit\b/.test(t) && /\b(wash|wipe|cleanser|serum|routine|minis|moistur)\b/.test(t);
  // Pre-check (Commit 20): a face-mask gift box that bundles a headband ("6
  // Animal Face Masks and Headband", 7th Heaven) is a mask set, not a headband
  // accessory — skip accessory so it routes as a mask/skincare product.
  const accessoryIsMaskSet = /\bmasks?\b/.test(t);

  for (const [reason, re] of excludeChecks) {
    // Skip fragrance denylist when the name is clearly haircare/body care and
    // 'fragrance' appears as a scent descriptor, or it's a "Fragrance Free" product.
    if (reason === "fragrance" && (fragranceIsScentDescriptor || fragranceFree)) continue;
    // Skip deodorant denylist for sunscreen/oil/skincare-active body sprays and
    // multi-step body-care kits that merely include a deodorant.
    if (reason === "deodorant" && (bodySprayIsSkincare || deodorantIsKitComponent)) continue;
    // Skip supplement denylist for topical "capsule" skincare.
    if (reason === "supplement" && capsuleIsTopical) continue;
    // Skip shaving denylist for a razor bundled as a freebie on a skincare product.
    if (reason === "shaving" && shaveIsBundledExtra) continue;
    // Skip accessory denylist for face-mask boxes that bundle a headband.
    if (reason === "accessory" && accessoryIsMaskSet) continue;
    // Skip apparel denylist for cosmetics named after a garment shade/line and
    // for cosmetics-only nail/lash brands whose shade names collide with garments.
    if (reason === "apparel" && (apparelIsBeautyProduct || isNailLashShadeBrand)) continue;
    // Skip makeup_tool denylist when the brush/sponge is a bundled extra.
    if (reason === "makeup_tool" && toolIsBundledExtra) continue;
    // Skip intimate_health for intimate-area grooming and shade/edition names.
    if (reason === "intimate_health" && intimateIsGroomingOrMakeup) continue;
    // Skip appliance for manual brow/lash grooming tools and nail-polish accessories.
    if (reason === "appliance" && (applianceIsBrowLashTool || applianceIsNailPolishAccessory)) continue;
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
    if (/\b(blush|bronzer|highlighter|highlighting|contour|contouring|illuminator|strobing|strobe|lumini[sz](e|er|ed|es|ing)|cheek (colour|color|tint|stick|palette))\b/.test(t)) return true;
    // 'bronze'/'bronzing' standalone is risky (self-tan body products use them —
    // "bronzing drops/mousse/water") — only makeup when paired with a powder/
    // stick/compact cosmetic descriptor. "Bronzing Powder/Stick" → makeup;
    // "Bronzing Drops" (self-tan) stays skincare.
    if (/\bbronz(e|ing)\b.*\b(powder|palette|stick|shimmer|glow palette|compact|brick)\b/.test(t)) return true;
    // 'illuminating' is heavily used in skincare (serums/creams), so only treat
    // it as makeup when paired with a cosmetic-form noun. (The luminizer family
    // above is makeup-only vocabulary and needs no such guard.)
    if (/\billuminating\b.*\b(stick|baton|wand|palette|powder|compact|highlighter)\b/.test(t)) return true;
    // NARS abbreviated-SKU eye liner: a high-pigment / long-wear modifier on a
    // liner ("High-Pigment Liner", "High-Pgmnt Lngwr Lnr"). Scoped to the
    // modifier+liner pair so "High-Wear Foundation" / "longwear foundation" are
    // unaffected; lip liners excluded (routed in the Lips block).
    if (/\b(high-?pigment|high-?pgmnt|long-?wear|longwear|lngwr)\b.*\b(eye-?liner|liner|lnr)\b/.test(t) && !/\blip\b/.test(t)) return true;
    if (/\b(setting (spray|powder)|finishing powder|fixing spray|fixing mist)\b/.test(t)) return true;
    // Face powder variants (Clinique Superpowder, Sheer Pressed Powder, etc.)
    if (/\b(face powder|pressed powder|loose powder|compact powder|superpowder|powder makeup)\b/.test(t)) return true;
    if (/\b(nail (polish|colour|color|lacquer|varnish|enamel)|gel polish|gel nail|nail (treatment|strengthener)|cuticle (oil|cream)|nail base|base coat|top coat|nail file)\b/.test(t)) return true;
    if (/\bfalse (lashes|eyelashes)|lash (extension|adhesive|glue)\b/.test(t)) return true;
    // Standalone "Lashes" is almost always false/strip lashes (makeup). \blashes\b
    // does NOT match "eyelashes" (no boundary), so lash-CARE products (eyelash
    // serum/growth) are unaffected. Guard lash-adjacent NON-lashes: lash serum/
    // curler, lash TINT (colour), and makeup REMOVERS / cleansers that merely
    // list "lashes" ("Take The Day Off … For Lids, Lashes & Lips" → Cleanser).
    if (/\blashes\b/.test(t) && !/\b(serum|growth|booster?|conditioner|cleans\w*|curler|comb|remov\w*|micellar|wipe|wipes|tint|take the day)\b/.test(t)) return true;
    // Generic 'makeup' as a noun (Clinique 'Superbalanced Makeup' brand line).
    // Excludes 'makeup remover' (denylisted earlier) and 'makeup brush' (in
    // makeup_tool denylist run before this detector). Must come last so that
    // more specific product-type detection above takes precedence for routing.
    // Cleansers that mention makeup ("Removes Makeup", "Makeup Remover",
    // "Micellar … Makeup") are skincare, not makeup. Exclude the verb form
    // ("removes makeup") too — the old lookahead only caught "makeup remover".
    // Cleansers/removers that mention "makeup" are skincare, not makeup. The old
    // guard only caught "makeup remover/removal/wipe"; it missed "makeup removing",
    // "makeup cleansing", "makeup melting", "removing makeup" and bare cleanser/
    // cleansing-balm forms — so makeup-removing cleansing balms (CeraVe, e.l.f.,
    // Shiseido ELIXIR, Haruharu) leaked into makeup. Broadened to fall through to
    // the Step 4 skincare Cleanser branch instead.
    if (
      /\bmakeup\b/.test(t) &&
      !/\b(makeup\s+(remov\w*|cleans\w*|melt\w*|wipe|wipes)|(remov\w*|cleans\w*|melt\w*)\s+makeup|micellar|cleanser|cleansing (balm|oil|cream|gel|lotion|milk|water|foam))\b/.test(t)
    ) return true;
    return false;
  })();

  if (makeupCheck) {
    let product_type = "Makeup";
    let subcategory = "";

    // Eyes
    if (/\b(mascara)\b/.test(t)) {
      product_type = "Mascara";
      subcategory = "eyes";
    } else if (
      /\b(eyeliner|eye liner|quickliner|kohl)\b/.test(t) ||
      (/\b(high-?pigment|high-?pgmnt|long-?wear|longwear|lngwr)\b.*\b(eye-?liner|liner|lnr)\b/.test(t) && !/\blip\b/.test(t))
    ) {
      product_type = "Eyeliner";
      subcategory = "eyes";
    } else if (/\b(eyeshadow|eye shadow)\b/.test(t)) {
      product_type = "Eyeshadow";
      subcategory = "eyes";
    } else if (/\b(eyebrows?|brows?)\b/.test(t)) {
      product_type = "Brow";
      subcategory = "eyes";
    } else if (
      /\bfalse (lashes|eyelashes)|lash (extension|adhesive|glue)\b/.test(t) ||
      (/\blashes\b/.test(t) && !/\b(serum|growth|booster?|conditioner|cleans\w*|curler|comb|remov\w*|micellar|wipe|wipes|tint|take the day)\b/.test(t))
    ) {
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
    } else if (
      /\b(blush|bronzer|highlighter|highlighting|contour|contouring|illuminator|strobing|strobe|lumini[sz](e|er|ed|es|ing)|cheek (colour|color|tint|stick|palette))\b/.test(t) ||
      /\billuminating\b.*\b(stick|baton|wand|palette|powder|compact|highlighter)\b/.test(t)
    ) {
      product_type = "Blush/Bronzer";
      subcategory = "face";
    } else if (/\bbronz(e|ing)\b.*\b(powder|palette|stick|shimmer|compact|brick)\b/.test(t)) {
      product_type = "Blush/Bronzer";
      subcategory = "face";
    }
    // Nails
    else if (/\b(nail (polish|colour|color|lacquer|varnish|enamel)|gel polish|gel nail)\b/.test(t)) {
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

  // ─── Step 3b: Rimmel makeup-line overrides ───────────────────────────────
  // Rimmel is a makeup-only brand (its sole non-makeup line is Sunshimmer
  // self/instant tan, which is genuine tanning skincare). Many of its makeup
  // lines carry no generic makeup keyword in the feed name — "Wonder'swipe",
  // "Scandaleyes … Eye Definer", "Oh My Gloss", "60 Seconds", "Supergel",
  // "Lasting Finish Matte Ls", "Better Than Filters", "Blur Booster",
  // "Turbocharged Glow", "ConcealerCream" (fused, so \bconcealer\b misses) — so
  // they fell through to the skincare catchall. This block runs ONLY for Rimmel
  // products that reached Step 4 (i.e. Steps 2-3 already failed to classify
  // them), so it never re-routes the ~791 Rimmel rows that generic makeup
  // detection already handles — zero churn on existing makeup. Product types are
  // mapped to the module's existing makeup vocabulary (Blush/Bronzer covers
  // highlighter+bronzer; Lip Colour covers gloss/stain) for catalogue
  // consistency. Sunshimmer tanning is excluded up front and falls through.
  if (
    /\brimmel\b/.test(b) &&
    !/\bsunshimmer\b/.test(t) &&
    !/\b(self.?tan|instant tan)\b/.test(t)
  ) {
    // Ordered: first match wins. Liner→lipstick→gloss order matters; generic
    // bundle/keyword fallbacks last so specific lines resolve first.
    const rimmelRules: Array<[RegExp, string, string]> = [
      // Nails
      [/\b60 seconds\b|\bsuper ?gel\b|\bsupergel\b|\bjelly nails\b|\bnail (polish|varnish|colour|color)\b/, "Nail Polish", "nails"],
      [/\bnail nurse\b|\bnail (treatment|care|strengthener)\b/, "Nail Treatment", "nails"],
      // Eyes
      [/\bshadow ?stick\b|\bshadowstick\b|\bnude palette\b/, "Eyeshadow", "eyes"],
      [/\bswipe\b|\bscandaleyes\b|\bexaggerate\b|\beye definer\b|\bkohl\b|\bscandal\b.*\bliner\b/, "Eyeliner", "eyes"],
      [/\bthrill ?seeker extreme\b|\bextreme\b.*\beye\b/, "Mascara", "eyes"],
      // Lips — liner/plumper, then lipstick (Lasting Finish "Ls"/"Lip Stick"),
      // then gloss/colour. "Oh My Plump … Lip Shaper" is a plumping lip liner;
      // "slip stick" (Oh My Gloss) stays gloss — \b stops "lip stick" matching it.
      [/\blip ?liner\b|\blipliner\b|\blin ?pen\b|\blinpen\b|\boh my plump\b|\blip shaper\b/, "Lip Liner", "lips"],
      [/\blasting finish matte ls\b|\blast fin\b.*\bls\b|\bmatte ls\b|\blip stick\b/, "Lipstick", "lips"],
      [/\boh my gloss\b|\bbutter me up\b|\bglassy gloss\b|\blip latex\b|\bslip stick\b|\bjelly crush\b|\bmulti-?stick\b|\blana jenkins\b|\bst glos\b|\bglos l\/care\b|\bgloss (and|&) liner\b|\blip\b/, "Lip Colour", "lips"],
      // Mascara — generic Thrill Seeker is a mascara line; runs AFTER lips so
      // "Thrill Seeker Glassy Gloss"/"Lip Latex" are already claimed as lips.
      [/\bthrill ?seeker\b|\bthrillseeker\b|\bmascara\b/, "Mascara", "eyes"],
      // Face
      [/\bbetter than filters\b|\bbb cream\b|\bcc cream\b|\bskin tint\b|\bperfection\b|\bfoundation\b/, "Foundation", "face"],
      [/concealer/, "Concealer", "face"],
      [/\bblur booster\b|\bface prim\b|\bprimer\b|\bprime\b/, "Primer", "face"],
      [/\bturbocharged glow\b|\bbronzing stick\b|\bradiance brick\b|\bbronz|\bhighlight/, "Blush/Bronzer", "face"],
      [/\bpowder\b/, "Powder", "face"],
      // Any remaining Rimmel multi-item set or residual makeup token is makeup
      // (the only non-makeup Rimmel line, Sunshimmer tanning, is excluded above).
      [/\b(bundle|combo|kit|set)\b/, "Makeup", "face"],
      [/\b(stick|polish|mascara|liner|bronzing|concealer|foundation|blush)\b/, "Makeup", "face"],
    ];
    for (const [re, pt, sub] of rimmelRules) {
      if (re.test(t)) {
        return { top_category: "makeup", product_type: pt, subcategory: sub, tags: ["makeup", sub] };
      }
    }
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
  // Makeup removers / micellar waters are cleansers — claim them here so the
  // "Makeup" branch in Step 3 (and the bare-oil branch below) never wins.
  else if (/\b(foam cleanser|cleansing foam|foaming cleanser|gel cleanser|cleansing gel|oil cleanser|cleansing oil|cleansing balm|cleansing water|micellar|face wash|facial wash|cleansing milk|milk cleanser|make.?up remover|removes? make.?up|eye make.?up remover)\b/.test(t)) skincare_product_type = "Cleanser";
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
  // Match the NOUN "moisturiser"/"moisturizer" (a trailing \b after "moistur"
  // never fires — a letter follows — so the bare word "Moisturiser" used to fall
  // through to the catchall). Deliberately NOT the adjective "moisturising": a
  // "Moisturising Mist"/"Moisturising Oil" is a Mist/Oil and must reach those
  // later branches, not be stolen here.
  else if (/\b(moisturi[sz]ers?|cream|lotion|emulsion|balm)\b/.test(t)) skincare_product_type = "Moisturiser";
  else if (/\bsalve\b/.test(t)) skincare_product_type = "Moisturiser";
  else if (/\beye\b/.test(t)) skincare_product_type = "Eye Care";
  else if (/\blip\b/.test(t)) skincare_product_type = "Lip Care";
  // "Oil Control" products are moisturisers/serums/cleansers, NOT facial oils —
  // the moistur/serum/cleanser branches above usually claim them first, but a
  // bare "Oil Control" with no other type keyword must not fall through to Oil.
  else if (/\boil\b/.test(t) && !/\boil[- ]?control\b/.test(t)) skincare_product_type = "Oil";
  else if (/\bmist\b/.test(t)) skincare_product_type = "Mist";
  else if (/\b(exfoliat|scrub)\b/.test(t)) skincare_product_type = "Exfoliator";
  else skincare_product_type = "Skincare"; // catchall

  // ─── Skincare subcategory: face / body / hand / foot / both ───────────────
  // Rules run in match order; FIRST match wins. The previous version defaulted
  // to 'face' too readily and mis-shelved body products (e.g. CeraVe body
  // moisturisers showed up in the face section). The order below makes explicit
  // FACE signals beat the generic body fallthrough, and adds two body-leaning
  // heuristics (CeraVe-style "SA" salicylic line + large-format moisturisers)
  // so body-heavy brands stop defaulting to face.
  //
  // Large-format heuristic inputs (computed once): a moisturiser ≥200ml/200g
  // with no explicit "facial" qualifier is overwhelmingly a body product.
  const sizeMatch = t.match(/\b(\d+(?:\.\d+)?)\s*(ml|g|gr|kg)\b/);
  let isLargeFormat = false;
  if (sizeMatch) {
    const sizeVal = parseFloat(sizeMatch[1]);
    const sizeUnit = sizeMatch[2];
    if ((sizeUnit === "ml" || sizeUnit === "g" || sizeUnit === "gr") && sizeVal >= 200) isLargeFormat = true;
    else if (sizeUnit === "kg" && sizeVal >= 0.2) isLargeFormat = true;
  }
  const isMoisturiserForm = /\b(moisturi[sz]ers?|cream|lotion|butter|emulsion|body milk)\b/.test(t);

  let skin_subcategory: string;
  // 1. Explicit whole-body coverage → 'both'
  if (/\b(face (and|&|\+|\/) body|body (and|&|\+|\/) face|all[ -]?over)\b/.test(t)) {
    skin_subcategory = "both";
  }
  // 2. Hand
  else if (/\b(hand (cream|lotion|sanit\w*|wash|soap|mask|salve|balm|butter|serum|treatment|scrub|gel)|hand ?(&|and) ?nail|reparative hand|nourishing hand|repairing hand)\b/.test(t)) {
    skin_subcategory = "hand";
  }
  // 3. Foot (before SA/large-format so "SA Renewing Foot Cream" → foot)
  else if (/\b(foot (cream|lotion|mask|soak|scrub|balm|serum|spray|gel|powder)|heel balm|heel cream|cracked heel|foot ?(&|and) ?nail)\b/.test(t)) {
    skin_subcategory = "foot";
  }
  // 4. Explicit FACE signals — win over the generic body fallthrough below.
  else if (/\b(facial|am ?\/? ?pm facial|face (wash|serum|cleanser|cream|oil|mask|mist|gel|lotion|moisturiser|moisturizer|cleansing|scrub|balm|cloth)|eye (cream|serum|gel|mask|balm|patch|patches))\b/.test(t)) {
    skin_subcategory = "face";
  }
  // 5. Body
  else if (/\b(body (lotion|cream|wash|butter|oil|scrub|mask|milk|mist|balm|sunscreen|serum|gel|soap|moisturiser|moisturizer)|after.?sun|tanning (lotion|oil|mist|milk)|self.?tan|stretch mark|shower (gel|cream|oil))\b/.test(t)) {
    skin_subcategory = "body";
  }
  // 6. CeraVe-style "SA" (salicylic-acid) body line — cream/lotion forms with no
  //    "facial" qualifier are the body products (the SA cleanser stays face via
  //    the cleanser branch / default below).
  else if (/\bsa\b/.test(t) && /\b(cream|lotion|moistur)\b/.test(t) && !/\bfacial\b/.test(t)) {
    skin_subcategory = "body";
  }
  // 7. Large-format moisturisers (≥200ml / ≥200g) without a "facial" qualifier.
  else if (isMoisturiserForm && isLargeFormat && !/\bfacial\b/.test(t)) {
    skin_subcategory = "body";
  }
  // 8. Default: skincare with no body signal → face.
  else {
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

// ============================================================================
// STAGE 2 — EXTENDED detection: FRAGRANCE and PERSONAL CARE.
//
// IMPORTANT: this is DETECTION ONLY. It is NOT called by inferCategorisation()
// and changes NO live classification — inferCategorisation() still returns only
// skincare / makeup / hair (plus the denylist), and the importers are untouched.
// This pure function is the building block for the future personal-care /
// fragrance enablement phase, when the new top_category values and the importer
// routing are switched on in a separate, reviewed step.
//
// It answers one question for a product that inferCategorisation would otherwise
// route to SKINCARE (or that currently hits the fragrance / deodorant denylist):
// is it really a FRAGRANCE, a PERSONAL CARE product, or neither (leave as-is)?
//
// PRECEDENCE (first match wins, so a product can never be double-claimed; a
// product that matches nothing returns null and stays where it was):
//   1. Fragrance-free guard. A "fragrance free / without fragrance / non
//      fragrance / zero fragrance" claim DISABLES the fragrance branch (the
//      product is sensitive-skin skincare, or a fragrance-free body product). It
//      does NOT block personal care — a fragrance-free body wash is still
//      personal care.
//   2. FRAGRANCE beats personal care when a perfume signal is present:
//        a. a hard fragrance form (eau de parfum/toilette/cologne, EDT, EDP,
//           parfum spray/refill/Nml) — even in a gift set listing a shower gel;
//        b. a PERFUMED bath/body/hand product (the word "perfumed", or a
//           fragrance-house brand making a body/bath/hand product) — Jo Malone
//           bath salts, Diptyque hand cream resolve to fragrance, NOT personal
//           care;
//        c. a bare fragrance NOUN (perfume / cologne / parfum / extrait) used as
//           the product type, i.e. not merely a scent descriptor on a functional
//           wash or hair product.
//   3. PERSONAL CARE: functional body/bath/hand/deodorant forms with no perfume
//      signal — plain body wash, shower gel, body lotion/cream/butter, hand
//      wash/cream, body scrub/oil, bath salts/oil, shower oil, deodorant /
//      antiperspirant.
//   4. Otherwise null — out of scope, leave the product as skincare/makeup/hair.
// ============================================================================

export type ExtendedTopCategory = "fragrance" | "personal_care";

export type ExtendedClassification = {
  top_category: ExtendedTopCategory;
  product_type: string;
  subcategory: string;
  tags: string[];
  rule: string; // which precedence rule fired (audit aid for the preview)
};

// Fragrance houses whose bath/body/hand lines are fragrance-led, so a body form
// from them resolves to FRAGRANCE (the perfumed-body precedence). Kept tight to
// avoid pulling functional body care from mixed skincare/body brands. Tunable in
// the enablement phase.
const RE_FRAGRANCE_HOUSE =
  /\b(jo malone|diptyque|byredo|le labo|creed|penhaligon'?s|maison francis kurkdjian|frederic malle|acqua di parma|amouage|xerjoff|maison margiela)\b/;

// Personal-care functional forms (module-level so the detector and any future
// caller share one definition).
const RE_PC_DEODORANT = /\b(deodorant|antiperspirant|anti-?perspirant)\b/;
const RE_PC_HAND = /\bhand (wash|cream|lotion|soap|balm|butter|scrub)\b/;
const RE_PC_BATH_SHOWER =
  /\b(body wash|shower gel|shower cream|shower foam|shower oil|bath foam|bubble bath|bath salts?|bath oil|bath soak|bath milk|bath bomb)\b/;
const RE_PC_BODY_MOIST =
  /\b(body (lotion|cream|butter|milk|moisturiser|moisturizer)|hand (and|&) body (lotion|cream))\b/;
const RE_PC_BODY_SCRUB = /\bbody (scrub|polish|exfoliant)\b/;
const RE_PC_BODY_OIL = /\bbody oil\b/;
// NB: "cleansing bar" deliberately omitted — "facial cleansing bar" is a face
// cleanser (skincare), not a body soap. Only true soap-bar / body-soap forms.
const RE_PC_SOAP = /\b(bar soap|soap bar|hand soap|body soap)\b/;

function frag(t: string, rule: string): ExtendedClassification {
  let product_type: string;
  if (/\beau de parfum\b|\bedp\b/.test(t)) product_type = "Eau de Parfum";
  else if (/\beau de toilette\b|\bedt\b/.test(t)) product_type = "Eau de Toilette";
  else if (/\beau de cologne\b|\bcologne\b/.test(t)) product_type = "Cologne";
  else if (/\bextrait\b|\bparfum\b/.test(t)) product_type = "Parfum";
  else if (rule === "perfumed_body") product_type = "Body Fragrance";
  else product_type = "Fragrance";
  const subcategory = rule === "perfumed_body" ? "body" : "scent";
  return { top_category: "fragrance", product_type, subcategory, tags: ["fragrance", subcategory], rule };
}

function pc(product_type: string, subcategory: string, rule: string): ExtendedClassification {
  return { top_category: "personal_care", product_type, subcategory, tags: ["personal_care", subcategory], rule };
}

export function classifyFragranceOrPersonalCare(
  name: string,
  brand: string = "",
): ExtendedClassification | null {
  // Same normalisation as inferCategorisation (letter↔digit split + lowercase).
  const t = String(name || "").toLowerCase().replace(/([a-z])(\d)/g, "$1 $2");
  const b = String(brand || "").toLowerCase();

  // ── Personal-care functional-form flags ──────────────────────────────────
  const hasPersonalCareForm =
    RE_PC_DEODORANT.test(t) || RE_PC_HAND.test(t) || RE_PC_BATH_SHOWER.test(t) ||
    RE_PC_BODY_MOIST.test(t) || RE_PC_BODY_SCRUB.test(t) || RE_PC_BODY_OIL.test(t) ||
    RE_PC_SOAP.test(t);
  // Body/bath/hand form (deodorant excluded — a deodorant is never "perfumed body").
  const hasBodyOrBathForm =
    RE_PC_HAND.test(t) || RE_PC_BATH_SHOWER.test(t) || RE_PC_BODY_MOIST.test(t) ||
    RE_PC_BODY_SCRUB.test(t) || RE_PC_BODY_OIL.test(t) || RE_PC_SOAP.test(t);

  // ── Fragrance signal flags ───────────────────────────────────────────────
  const hardForm = RE_HARD_FRAGRANCE_FORM.test(t);
  // 1. Fragrance-free guard — disables the fragrance branch only.
  const fragFree = RE_FRAGRANCE_FREE.test(t) && !hardForm;
  // Bare fragrance NOUN as the product type. "fragrance" is deliberately excluded
  // (it is overwhelmingly a scent descriptor on functional products, e.g.
  // "... Fragrance Shower Gel"); only perfume / cologne / parfum / extrait read as
  // the product itself.
  const fragranceNoun = /\b(perfume|cologne|eau de cologne|parfum|extrait de parfum|extrait)\b/.test(t);
  // A hair / 2-in-1 scent form means the fragrance word is a descriptor, not the
  // product — defer (hair mist, hair & body mist, dry shampoo, …).
  const isHairOrTwoInOneScent =
    /\b(shampoo|conditioner|hair (mask|oil|serum|spray|mist)|hair (and|&) body|dry shampoo)\b/.test(t);
  const perfumed = /\bperfumed\b/.test(t);
  const fragranceHouseBody = (RE_FRAGRANCE_HOUSE.test(b) || RE_FRAGRANCE_HOUSE.test(t)) && hasBodyOrBathForm;

  // ── 2. FRAGRANCE branch (only when not fragrance-free) ───────────────────
  if (!fragFree) {
    // 2a. Hard fragrance form — wins even over body-care in a gift set.
    if (hardForm) return frag(t, "hard_form");
    // 2b. Perfumed bath/body/hand product, or a fragrance-house body product.
    if ((perfumed && hasBodyOrBathForm) || fragranceHouseBody) return frag(t, "perfumed_body");
    // 2c. Bare fragrance noun as the product type — but if it ALSO carries a
    //     functional personal-care form with no perfumed/house signal, the
    //     fragrance word is a descriptor: fall through to personal care.
    if (fragranceNoun && !isHairOrTwoInOneScent && !hasPersonalCareForm) {
      return frag(t, "fragrance_noun");
    }
  }

  // ── 3. PERSONAL CARE branch ──────────────────────────────────────────────
  // Face / skincare-active guard: a product carrying a clear FACE-cleanser or
  // SPF signal belongs in skincare even if it also names a body form (face & body
  // 2-in-1 cleansers, "Face & Body Lotion SPF50"). Defer those — do not claim
  // them as personal care.
  const faceOrActiveSignal =
    /\bfacial\b/.test(t) ||
    /\bface (wash|cleanser|cream|gel|scrub)\b/.test(t) ||
    /\b(spf|sunscreen|sun cream|sun protector)\b/.test(t);
  if (hasPersonalCareForm && !faceOrActiveSignal) {
    if (RE_PC_DEODORANT.test(t)) return pc("Deodorant", "body", "deodorant");
    if (RE_PC_HAND.test(t)) return pc("Hand Care", "hand", "hand_care");
    if (RE_PC_BODY_SCRUB.test(t)) return pc("Body Scrub", "body", "body_scrub");
    if (RE_PC_BATH_SHOWER.test(t) || RE_PC_SOAP.test(t)) return pc("Bath & Shower", "body", "bath_shower");
    if (RE_PC_BODY_OIL.test(t)) return pc("Body Oil", "body", "body_oil");
    if (RE_PC_BODY_MOIST.test(t)) return pc("Body Moisturiser", "body", "body_moisturiser");
  }

  // ── 4. Out of scope — leave as skincare/makeup/hair. ─────────────────────
  return null;
}

// ============================================================================
// STAGE 3 — gated import classification.
//
// inferCategorisationForImport() is the function the importers call. Until the
// fragrance / personal-care categories are enabled it returns inferCategorisation()
// UNCHANGED, so NEW imports behave exactly as they do today (fragrance / deodorant
// still excluded, personal-care body products still skincare/body). It is the ONE
// switch point for the enablement phase.
//
// EXTENDED_CATEGORIES_ENABLED is a code-level flag, OFF by default — flipping it
// is a separate reviewed step that goes together with widening the live
// top_category set (nav / filters), and, for deodorants, the
// retailer_import_config change. No config or DB change happens here.
//
// When enabled, the extended detector takes precedence over the fragrance &
// deodorant DENYLIST exclusions and over the skincare catchall — but NEVER over
// makeup / hair, and NEVER over a fragrance-free skincare product (the detector
// returns null for those, so they stay skincare).
// ============================================================================

// Enabled 2026-06-28: fragrance + personal-care categories are live (nav,
// routes, filters added; existing rows migrated). New imports now route
// fragrance / personal care; fragrance-free stays skincare.
export const EXTENDED_CATEGORIES_ENABLED = true;

// Import-only category set. Deliberately a SEPARATE type from the canonical
// TopCategory so the live categoriser's enum is left untouched (no new enum
// values added to inferCategorisation's contract).
export type ImportTopCategory = TopCategory | ExtendedTopCategory;

export type ImportCategorisation = {
  top_category: ImportTopCategory | null;
  product_type: string;
  subcategory: string;
  tags: string[];
  excluded?: string;
};

export function inferCategorisationForImport(
  name: string,
  brand: string = "",
  enabled: boolean = EXTENDED_CATEGORIES_ENABLED,
): ImportCategorisation {
  const base = inferCategorisation(name, brand);
  if (!enabled) return base;

  // Eligible to be reclassified: products the denylist drops as fragrance or
  // deodorant, and products that land in the skincare catchall. Makeup, hair and
  // every other exclusion are left exactly as inferCategorisation decided.
  const eligible =
    base.excluded === "fragrance" ||
    base.excluded === "deodorant" ||
    base.top_category === "skincare";
  if (!eligible) return base;

  const ext = classifyFragranceOrPersonalCare(name, brand);
  if (!ext) return base; // not fragrance / personal care (e.g. fragrance-free skincare)

  // Emit the extended classification, dropping any `excluded` flag so the
  // importer creates the row instead of skipping it.
  return {
    top_category: ext.top_category,
    product_type: ext.product_type,
    subcategory: ext.subcategory,
    tags: ext.tags,
  };
}
