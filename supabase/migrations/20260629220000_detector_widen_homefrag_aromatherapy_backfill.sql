-- Detector-widen backfill: Home Fragrance + Aromatherapy + plural-form coverage.
--
-- Context (2026-06-29): the bath_body detector (classifyFragranceOrPersonalCare)
-- was widened in the paired categoriser PR with three new arms, all live for new
-- imports once the edge functions redeploy:
--   * Home Fragrance (brand-agnostic): candles, reed/aroma diffusers, room/linen/
--     pillow/sleep mists -> bath_body.
--   * Aromatherapy brands (Amphora Aromatics, Tisserand, Celtic Wellbeing, The
--     Aromatherapy Co): essential oils, blends, pulse-point rollers, roll-ons,
--     mood mists -> bath_body, GUARDED so the brands' real face skincare (face
--     creams, cleansers, moisturisers, serums, face oils, toners) stays skincare.
--   * Plural-form coverage: a 29-Jun blind spot where singular-only patterns
--     missed "bath bombs", "soap bars", "bath & shower wash", etc.
--
-- This migration backfills the EXISTING rows those arms now claim but that the
-- old detector left in skincare. Frozen to explicit ids from a reviewed read-only
-- dry-run (live state 2026-06-29): 413 skincare -> bath_body, 4 skincare ->
-- fragrance (Banana Republic / Anfar extraits that slipped in after the
-- fragrance go-live backfill).
--
-- EXCLUDED by review: id 2792 "Amphora ...MandarinCleansing Balm" — a face
-- cleansing balm whose feed name concatenates "MandarinCleansing", so the
-- skincare guard (\bcleans) cannot fire mid-word. A genuine FP; left in skincare.
--
-- Transform: top_category set, subcategory + product_type set to the detector
-- values (these are catch-all "Skincare" rows being recategorised, not a P2a-style
-- pure move), tags rebuilt. Subcategory is body for all bath_body rows except the
-- single Hand Care row.
--
-- Safety: explicit ids only; every UPDATE guarded by top_category='skincare' so a
-- row since recategorised is skipped, not clobbered. Idempotent (re-running no-ops
-- once top_category<>'skincare'). Transactional.

begin;

-- Aromatherapy -> bath_body/body (349 rows)
update products set
  top_category='bath_body', subcategory='body', product_type='Aromatherapy',
  tags=array['bath_body','body']
where top_category='skincare' and id = any(array[16347,16348,16349,16350,16351,16352,16353,16354,16355,16356,16357,16358,16359,16360,16361,16362,16363,16364,16365,16366,16367,16368,16369,16370,16371,16372,16373,16374,16375,16376,16377,16378,16379,16380,16381,16382,16383,16384,16385,16386,16387,16388,16389,16390,16391,16392,16393,16394,16395,16396,16397,16398,16399,16400,16401,16402,16403,16404,16405,16406,16407,16408,16409,16410,16411,16412,16413,16414,16415,16416,16417,16418,16419,16420,16421,16422,16423,16424,16425,16426,16427,16428,16429,16430,16431,16432,16433,16434,16435,16436,16437,16438,16439,16440,16441,16442,16443,16444,16445,16446,16447,16448,16449,16450,16451,16452,16453,16454,16455,16457,16458,16459,16460,16461,16462,16463,16464,16466,16467,16468,16471,16472,16473,16474,16475,16476,16477,16478,16479,16480,16481,16482,16484,16486,16487,16488,16489,16490,16491,16492,16493,16494,16495,16496,16497,16498,16499,16500,16501,16502,16503,16504,16505,16506,16507,16508,16509,16511,16512,16513,16520,16521,16556,16557,16558,16559,16560,16561,16562,16567,18089,18090,18091,18092,18093,18094,18095,18097,18098,18099,18100,18101,18102,18103,18104,18105,18106,18107,18108,18109,18110,18111,18112,18113,18114,18115,18119,18120,18121,18123,18125,18126,18127,18128,18129,18131,18132,18133,18134,18135,18136,18137,18138,18139,18146,18147,18149,18150,18151,18152,18153,18154,18155,18156,18157,18159,18160,18161,18162,18164,18165,18167,18168,18169,18170,18171,18172,18173,18175,18176,18177,18178,18179,18180,18181,18182,18184,18186,18905,18906,18907,18908,18909,18910,18911,18912,18913,18914,18915,18916,18917,18918,18919,18920,18921,18922,18923,18924,18925,18926,18927,20081,20082,20083,20084,20085,20086,20089,20092,20093,20095,20497,20499,24858,35143,53227,53270,63668,64918,65601,65602,65603,65604,65605,65606,70530,70531,80737,84550,94708,95518,95519,95702,95721,95870,95951,95952,95953,96060,96096,96244,96259,96260,96261,96262,96263,96264,96427,96429,96430,96432,97218,97220,97685,97686,97687,97688,97985,97986,97987,98551,98552,98553,98554,98555,98556,98557,98558,98559,106672,106673,106674,106675,109552,109553,113567,113568,113569,113570]::int[]);

-- Bath & Shower -> bath_body/body (43 rows; plural-form coverage)
update products set
  top_category='bath_body', subcategory='body', product_type='Bath & Shower',
  tags=array['bath_body','body']
where top_category='skincare' and id = any(array[10977,13540,20090,20098,20099,37109,37916,44861,48426,48428,48431,49240,49241,51130,51131,52597,53126,53148,55780,59280,59935,65683,100651,100652,100653,100654,100685,100697,100698,100699,100700,108671,108672,108673,108674,108675,108676,108677,108678,108679,109623,110145,110634]::int[]);

-- Home Fragrance -> bath_body/body (13 rows)
update products set
  top_category='bath_body', subcategory='body', product_type='Home Fragrance',
  tags=array['bath_body','body']
where top_category='skincare' and id = any(array[16554,16555,16563,16564,16565,16566,20097,48636,86055,88185,113058,113059,113060]::int[]);

-- Shaving -> bath_body/body (5 rows)
update products set
  top_category='bath_body', subcategory='body', product_type='Shaving',
  tags=array['bath_body','body']
where top_category='skincare' and id = any(array[10232,11621,14598,17072,109902]::int[]);

-- Body Moisturiser -> bath_body/body (2 rows)
update products set
  top_category='bath_body', subcategory='body', product_type='Body Moisturiser',
  tags=array['bath_body','body']
where top_category='skincare' and id = any(array[12782,12783]::int[]);

-- Hand Care -> bath_body/hand (1 row)
update products set
  top_category='bath_body', subcategory='hand', product_type='Hand Care',
  tags=array['bath_body','hand']
where top_category='skincare' and id = any(array[17232]::int[]);

-- Fragrance extraits -> fragrance/scent (4 rows)
update products set
  top_category='fragrance', subcategory='scent', product_type='Parfum',
  tags=array['fragrance','scent']
where top_category='skincare' and id = any(array[101091,101393,101394,109631]::int[]);

commit;
