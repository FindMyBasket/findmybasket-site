-- Shade-collapse durability: ongoing re-grouping of shade strays.
--
-- Imports create new shade-variant products without parent_product_id (shade
-- suppression is within-run only), so every import strands new shade tiles on
-- listing pages and their prices outside the family modal (PR #120). The
-- 2026-07-22 catch-up pass re-parented 1,030 strays (backup rows operation=
-- 'regroup_catchup'); this migration makes the strict tier of that pass a
-- nightly job so the backlog stops recurring.
--
-- Conservative by design: ONLY the highest-precision tier is automated —
-- exact case-insensitive stem-prefix match to a unique existing family, with
-- type/size/residual guards. Format-divergent matching, new-family formation
-- (rootless clusters) and ambiguous ties stay manual.
--
-- Applied to prod via the management API (db push blocked by migration-history
-- drift — see importer-merged-redirect note); this file is the in-repo record.

-- Family stems: longest common prefix (case-insensitive) of each family's
-- member names, trimmed to a word boundary, kept only when distinctive
-- (>= 8 alphanumeric chars beyond the brand). Refreshed nightly.
create table if not exists shade_family_stems (
  root    bigint primary key,
  brand   text,
  members int,
  stem    text
);

-- Durable audit of every automated re-parent (revert = set parent back to null).
create table if not exists shade_regroup_log (
  stray_id   bigint not null,
  root       bigint not null,
  stray_name text,
  applied_at timestamptz not null default now(),
  dry_run    boolean not null default false
);

create or replace function public.fmb_refresh_shade_family_stems()
returns int
language plpgsql
security definer
set search_path to ''
as $$
declare
  n int;
begin
  -- separate statements: a data-modifying CTE's DELETE is invisible to the
  -- INSERT in the same statement (same snapshot) and dup-keys on refresh
  delete from public.shade_family_stems;
  with members as (
    select coalesce(p.parent_product_id, p.id) as root, lower(p.name) as lname, p.normalised_brand
    from public.products p
    where p.parent_product_id is not null
       or exists (select 1 from public.products c where c.parent_product_id = p.id)
  ),
  mm as (
    select root, min(lname) as lo, max(lname) as hi, count(*) as members, min(normalised_brand) as brand
    from members group by root
  ),
  lcp as (
    select root, brand, members,
      (select coalesce(max(k), 0) from generate_series(1, least(length(lo), length(hi))) k
        where left(lo, k) = left(hi, k)) as lcp_len, lo
    from mm
  ),
  stemmed as (
    select root, brand, members, trim(regexp_replace(left(lo, lcp_len), '[-,/ ]+[^ ]*$', '')) as stem
    from lcp where lcp_len >= 20
  ),
  ins as (
    insert into public.shade_family_stems (root, brand, members, stem)
    select root, brand, members, stem from stemmed
    where length(regexp_replace(stem, '[^a-z0-9]', '', 'g'))
          >= length(regexp_replace(coalesce(brand,''), '[^a-z0-9]', '', 'g')) + 8
      and length(stem) >= 15
    returning 1
  )
  select count(*)::int into n from ins;
  return n;
end;
$$;

-- Nightly strict-tier regroup. dry_run=true sizes without writing (rows are
-- still logged with dry_run=true for inspection, product rows untouched).
create or replace function public.fmb_regroup_shade_strays(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  n_matched  int;
  n_applied  int := 0;
  touched    bigint[];
begin
  create temp table _candidates on commit drop as
  with dup_stems as (
    select stem, brand from public.shade_family_stems group by stem, brand having count(*) > 1
  ),
  strays as (
    select p.id, p.name, p.normalised_brand, p.product_type, p.canonical_size
    from public.products p
    where p.parent_product_id is null and p.merged_into is null
      and not exists (select 1 from public.products c where c.parent_product_id = p.id)
      and p.normalised_brand in (select distinct brand from public.shade_family_stems)
  ),
  matches as (
    select s.id as stray_id, s.name as stray_name, f.root, f.stem,
      s.product_type as stray_type, s.canonical_size as stray_size,
      (f.stem, f.brand) in (select stem, brand from dup_stems) as dup_stem,
      trim(leading '-,/ ' from substr(s.name, length(f.stem)+1)) as residual,
      length(f.stem) as stem_len
    from strays s
    join public.shade_family_stems f
      on f.brand = s.normalised_brand
      and lower(left(s.name, length(f.stem))) = f.stem
      and s.id <> f.root
  ),
  best as (
    select *, rank() over (partition by stray_id order by stem_len desc) as rk
    from matches
  ),
  uniq as (
    select b.*, count(*) over (partition by stray_id) as ties,
      rp.product_type as root_type, rp.canonical_size as root_size, rp.name as root_name,
      rp.parent_product_id as root_parent, rp.merged_into as root_merged
    from best b join public.products rp on rp.id = b.root
    where rk = 1
  )
  select stray_id, stray_name, root from uniq
  where ties = 1 and not dup_stem
    and root_parent is null and root_merged is null
    -- type guard: specific-vs-specific mismatch blocks; catchall stray types
    -- (known categoriser contamination) defer to the name-level guard below
    and not (stray_type is not null and root_type is not null
             and stray_type <> root_type
             and stray_type not in ('Skincare','Makeup','Moisturiser'))
    and not (nullif(stray_size,'') is not null and nullif(root_size,'') is not null
             and stray_size <> root_size)
    -- residual must look like a shade, not a different product or a bundle
    and length(residual) between 1 and 45
    and residual !~* '\y\d+(\.\d+)?\s?(ml|g|kg|oz|pc|pcs|pair|pairs)\y'
    and residual !~* '\y(refill|refills|set|sets|duo|trio|kit|kits|gift|bundle|mini|travel|christmas|advent|palette|pump|brush|brushes|sponge|applicator|case|holder|sample|tester)\y'
    -- line-extension guard: a type word present in the stray's name but absent
    -- from the root's name signals a sibling product line, not a shade
    and not exists (
      select 1 from unnest(array['lipstick','liner','pencil','gel','gloss','balm','stick','crayon',
                                 'powder','serum','concealer','foundation','mascara','tint','shadow']) w
      where lower(stray_name) ~ ('\y' || w || '\y') and lower(root_name) !~ ('\y' || w || '\y')
    );

  select count(*) into n_matched from _candidates;

  insert into public.shade_regroup_log (stray_id, root, stray_name, dry_run)
  select stray_id, root, stray_name, p_dry_run from _candidates;

  if not p_dry_run and n_matched > 0 then
    update public.products p set parent_product_id = c.root
    from _candidates c
    where p.id = c.stray_id
      and p.parent_product_id is null and p.merged_into is null;
    get diagnostics n_applied = row_count;

    select array_agg(stray_id) into touched from _candidates;
    perform public.fmb_revalidate_product_listings(touched);
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'matched', n_matched, 'applied', n_applied);
end;
$$;

revoke execute on function public.fmb_refresh_shade_family_stems() from public, anon, authenticated;
revoke execute on function public.fmb_regroup_shade_strays(boolean) from public, anon, authenticated;

-- Nightly at 07:45 UTC — after the retailer import crons (05:00–06:30) so the
-- strays each import creates are attached the same morning.
select cron.schedule(
  'regroup-shade-strays',
  '45 7 * * *',
  $cron$
  select public.fmb_refresh_shade_family_stems();
  select public.fmb_regroup_shade_strays(false);
  $cron$
);
