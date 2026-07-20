-- Long-form editorial body for Brand Spotlight hubs.
--
-- The original brand_hubs shape (lede + pillars + product cards) suits a hub
-- that is purely a range showcase, e.g. iLapothecary. Abib is the first hub
-- with a written brand story, which needs real prose with inline links to our
-- own comparison pages, and the existing structured columns have nowhere to
-- put that.
--
-- Rendered through lib/brand-hub-body.ts, which sanitises on the way out with
-- a tag/attribute allowlist. Sanitising at render (not only at write) means
-- the guarantee holds regardless of how a row got into the table.
--
-- Nullable and defaulted to null, so existing hubs are untouched and the body
-- block simply does not render for them.

alter table public.brand_hubs
  add column if not exists body_html text;

comment on column public.brand_hubs.body_html is
  'Optional long-form editorial HTML. Sanitised at render by sanitizeBrandHubBody(); allowlist is p/h2/strong/em/a with href, rel, target on anchors. Affiliate anchors must carry rel="sponsored nofollow noopener" and target="_blank".';

-- Per-hub SEO and headline overrides.
--
-- The route previously derived all three from display_name and lede, which is
-- fine for a hub whose name is the whole story. A hub with an editorial angle
-- wants its own title, description and H1. All nullable: when null the route
-- falls back to the existing derived values, so seeded hubs are unchanged.

alter table public.brand_hubs
  add column if not exists seo_title text,
  add column if not exists meta_description text,
  add column if not exists headline text;

comment on column public.brand_hubs.seo_title is
  'Overrides the derived "<display_name> Brand Spotlight | FindMyBasket" title tag. Null falls back to the derived form.';
comment on column public.brand_hubs.meta_description is
  'Overrides lede as the meta description. Null falls back to lede.';
comment on column public.brand_hubs.headline is
  'Overrides display_name as the on-page H1. display_name still drives the breadcrumb, index card and brand-creative flag.';
