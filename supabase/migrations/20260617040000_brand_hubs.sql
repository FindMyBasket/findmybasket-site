-- Brand Spotlight hubs: data-driven brand hub pages at /brands/{slug}.
-- Two hub shapes selected per brand by show_comparison:
--   false -> spotlight-only (iLapothecary, Evolve, Clarins)
--   true  -> spotlight + independent price-comparison zone (The Organic Pharmacy)
-- Content lives here (not in code) so new hubs are launched by adding data.

create table if not exists public.brand_hubs (
  slug              text primary key,
  display_name      text not null,
  -- hero styling variant, e.g. 'dark-wellness', 'light-apothecary'
  accent_treatment  text not null default 'dark-wellness',
  -- full public URL (brand-assets bucket) of the hero logo
  logo_path         text,
  eyebrow           text,
  lede              text,
  -- array of { title, body } for the 3 story cells
  pillars           jsonb not null default '[]'::jsonb,
  -- false = spotlight only; true = also render the comparison zone
  show_comparison   boolean not null default false,
  -- shown when show_comparison is false (sold direct / single outbound path)
  single_path_note  text,
  -- nullable { headline, code, body, expires_at|null, cta_url }; render only
  -- when present AND not past expires_at
  offer             jsonb,
  disclosure        text,
  -- the partnership line beside the Brand Spotlight tag
  zone_note         text,
  -- intro line above the range grid
  range_sub         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.brand_hub_products (
  id            bigint generated always as identity primary key,
  brand_slug    text not null references public.brand_hubs(slug) on delete cascade,
  name          text not null,
  -- concern/step used by the range filter tabs
  category      text,
  -- e.g. 'Uplifting · Releasing · Revitalising'
  benefit_tags  text,
  description   text,
  -- nullable; hidden when null
  price         numeric(10,2),
  volume        text,
  -- path within the brand-assets bucket: '{slug}/{product-slug}.webp'
  image_path    text,
  -- full AWIN deep link
  buy_url       text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists brand_hub_products_brand_slug_sort_idx
  on public.brand_hub_products (brand_slug, sort_order);

-- RLS: the site reads via the service-role client (bypasses RLS), but enable RLS
-- and grant public read so these tables are safe to expose and consistent with
-- the rest of the catalogue.
alter table public.brand_hubs enable row level security;
alter table public.brand_hub_products enable row level security;

create policy "brand_hubs public read"
  on public.brand_hubs for select
  using (true);

create policy "brand_hub_products public read"
  on public.brand_hub_products for select
  using (true);
