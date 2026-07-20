-- Range framing + CTA for brand hubs.
--
-- A hub's card row is a curation, not the catalogue. On a brand where we
-- compare a large range (Abib: 147 products) three big cards read as "this is
-- all there is". These columns let a hub say otherwise, in the template rather
-- than buried in body-text links:
--
--   range_title      overrides the hardcoded "The range" heading, so the cards
--                    can be framed as a selection ("Three to start with").
--   range_cta_label  visible CTA beside/below the cards.
--   range_cta_url    where that CTA points (normally the brand's own
--                    comparison page, e.g. /brands/abib).
--
-- All nullable: hubs seeded before these columns existed render exactly as
-- before (heading falls back to "The range", no CTA band).

alter table public.brand_hubs add column if not exists range_title text;
alter table public.brand_hubs add column if not exists range_cta_label text;
alter table public.brand_hubs add column if not exists range_cta_url text;
