-- Reconcile brand_hubs with the prototype: the hero logo, the partnership line
-- beside the Brand Spotlight tag (zone_note), and the range intro line (range_sub).
-- Idempotent so it is correct whether the table was created by the base migration
-- or already existed.

alter table public.brand_hubs add column if not exists logo_path text;
alter table public.brand_hubs add column if not exists zone_note text;
alter table public.brand_hubs add column if not exists range_sub text;
