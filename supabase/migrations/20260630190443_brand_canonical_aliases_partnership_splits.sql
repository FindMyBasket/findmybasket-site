-- Brand canonicalisation: encode the 13 partnership-visible brand splits found in
-- the 30-Jun-2026 catalogue audit into the importer's canonicalisation source.
--
-- The user merged the split product rows via SQL on 30 Jun, but the importers
-- canonicalise brand at import time by looking up the brand_aliases table
-- (lookupCanonicalBrand in import-awin-feed / import-rakuten-feed /
-- import-shopify-feed: WHERE LOWER(alias) = LOWER(rawBrand), else passthrough).
-- Without alias rows the next overnight cron re-creates the variant spellings.
-- This migration adds/repairs those alias rows so new imports land on the
-- canonical spelling from day one. No code change or redeploy is needed — the
-- importers load this table fresh on every run.
--
-- Canonical direction was confirmed against live active-product counts (the
-- spelling each split was merged INTO): e.g. Estee Lauder 739, MAC Cosmetics 1126,
-- Avene 198 — and zero active products remain under any variant spelling.
--
-- Aliases are stored lowercase to match the existing table convention and the PK
-- (brand_aliases_pkey on alias); the importer lowercases both sides anyway.
--
-- Pre-existing rows: 'estée lauder'->'Estee Lauder' and 'biore'->'Bioré' already
-- existed and are re-asserted idempotently. 'm.a.c' previously pointed at the
-- canonical 'M.A.C'; the audit merged that brand to 'MAC Cosmetics', so this
-- migration UPDATES it (ON CONFLICT) to the new canonical.
--
-- Conservative by design: only these audited variants, no generic accent/
-- punctuation normaliser (that risks false-merging genuinely different brands —
-- tracked as a separate detection-then-allowlist follow-up, not done here).

insert into public.brand_aliases (alias, canonical, notes) values
  -- Accent variants
  ('estée lauder',     'Estee Lauder',     '30Jun26 partnership split audit (accent)'),
  ('avène',            'Avene',            '30Jun26 partnership split audit (accent)'),
  ('chloé',            'Chloe',            '30Jun26 partnership split audit (accent)'),
  ('khloé kardashian', 'Khloe Kardashian', '30Jun26 partnership split audit (accent)'),
  -- Punctuation variants
  ('dr. botanicals',   'Dr Botanicals',    '30Jun26 partnership split audit (punctuation)'),
  ('the flat lay co.', 'The Flat Lay Co',  '30Jun26 partnership split audit (punctuation)'),
  ('bond no 9',        'Bond No. 9',       '30Jun26 partnership split audit (punctuation)'),
  ('alexandre j',      'Alexandre.J',      '30Jun26 partnership split audit (punctuation)'),
  ('m.a.c',            'MAC Cosmetics',    '30Jun26 partnership split audit (was ->M.A.C; merged to MAC Cosmetics)'),
  -- Apostrophe variants
  ('nala''s baby',     'Nalas Baby',       '30Jun26 partnership split audit (apostrophe)'),
  ('ponds',            'Pond''s',          '30Jun26 partnership split audit (apostrophe)'),
  -- Casing / spacing variants
  ('biore',            'Bioré',            '30Jun26 partnership split audit (accent)'),
  ('dr. pawpaw',       'Dr.PAWPAW',        '30Jun26 partnership split audit (spacing/casing; covers Dr. PAWPAW / Dr. PawPaw)'),
  ('dr. paw paw',      'Dr.PAWPAW',        '30Jun26 partnership split audit (spacing)')
on conflict (alias) do update
  set canonical = excluded.canonical,
      notes     = excluded.notes;
