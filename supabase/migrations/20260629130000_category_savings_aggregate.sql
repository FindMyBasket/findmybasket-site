-- Per-category "average saving" aggregate, computed catalogue-wide and stored.
--
-- Background: CategoryStats.avg_saving_pct was hardwired to null and the hero
-- "around 25% average" claim had no computation behind it. Computing the real
-- figure live per request is too heavy (it scans in-stock prices across the
-- whole catalogue), so we store it and refresh weekly.
--
-- Definition (matches the on-screen next-best anchor):
--   * in-stock, real prices only (price not null and > 0)
--   * one price per (product, retailer) = the lowest at that retailer
--   * importer de-rank: drop Stylevana (11) / YesStyle (25) for a product
--     whenever a non-importer retailer also stocks it (lib/queries applyImporterRule)
--   * merged_into / parent_product_id rows excluded (via products_active)
--   * cleanup_remove-tagged products excluded (parity with getCategoryStats)
--   * size-mismatch guard: drop products where max/min price > 2.5
--   * per product saving = (second-lowest - lowest) / second-lowest, over
--     products with >= 2 eligible retailers (products priced equally count as 0)
--   * avg_saving_pct = mean of that per top_category; median also stored

create table if not exists public.category_savings (
  top_category      text primary key,
  avg_saving_pct    numeric,
  median_saving_pct numeric,
  sample_size       integer not null default 0,
  computed_at       timestamptz not null default now()
);

comment on table public.category_savings is
  'Per-category next-best average saving, computed catalogue-wide over in-stock real prices (importer de-rank applied, merged/parent + cleanup_remove excluded, size-mismatch guard). Refreshed weekly by fmb_refresh_category_savings via pg_cron. Read by getCategoryStats -> CategoryStats.avg_saving_pct.';

create or replace function public.fmb_refresh_category_savings()
returns void
language sql
security definer
set search_path = public
as $$
  with eligible as (
    select rp.product_id, rp.retailer_id, min(rp.price) as price
    from retailer_prices rp
    join products_active pa on pa.id = rp.product_id
    where rp.in_stock = true
      and rp.price is not null
      and rp.price > 0
      and not (coalesce(pa.tags, '{}') @> array['cleanup_remove'])
    group by rp.product_id, rp.retailer_id
  ),
  flagged as (
    select product_id, bool_or(retailer_id not in (11, 25)) as has_real
    from eligible
    group by product_id
  ),
  deranked as (
    select e.product_id, e.retailer_id, e.price
    from eligible e
    join flagged f on f.product_id = e.product_id
    where e.retailer_id not in (11, 25) or f.has_real = false
  ),
  prod as (
    select d.product_id,
           pa.top_category,
           count(*)                                  as n_ret,
           min(d.price)                              as p1,
           max(d.price)                              as pmax,
           (array_agg(d.price order by d.price))[2]  as p2
    from deranked d
    join products_active pa on pa.id = d.product_id
    where pa.top_category is not null
    group by d.product_id, pa.top_category
  ),
  eligible_prod as (
    select top_category,
           ((p2 - p1) / p2) * 100 as saving_pct
    from prod
    where n_ret >= 2
      and p1 > 0
      and pmax / p1 <= 2.5
  )
  insert into public.category_savings
    (top_category, avg_saving_pct, median_saving_pct, sample_size, computed_at)
  select top_category,
         round(avg(saving_pct)::numeric, 1),
         round(percentile_cont(0.5) within group (order by saving_pct)::numeric, 1),
         count(*),
         now()
  from eligible_prod
  group by top_category
  on conflict (top_category) do update
    set avg_saving_pct    = excluded.avg_saving_pct,
        median_saving_pct = excluded.median_saving_pct,
        sample_size       = excluded.sample_size,
        computed_at       = excluded.computed_at;
$$;

-- Non-sensitive aggregate: readable by anon/authenticated (server uses the
-- service-role key and bypasses RLS, but keep a public read policy for parity).
alter table public.category_savings enable row level security;

drop policy if exists "category_savings public read" on public.category_savings;
create policy "category_savings public read"
  on public.category_savings for select using (true);

grant select on public.category_savings to anon, authenticated;

-- Populate immediately so the field is live the moment this ships.
select public.fmb_refresh_category_savings();

-- Refresh weekly (Mondays 03:17 UTC). The distribution is stable, so weekly is
-- ample; unschedule-then-schedule keeps the migration idempotent.
do $$
begin
  perform cron.unschedule('refresh-category-savings');
exception when others then
  null;
end $$;

select cron.schedule(
  'refresh-category-savings',
  '17 3 * * 1',
  $$select public.fmb_refresh_category_savings();$$
);
