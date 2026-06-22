-- Product descriptions: store the best available feed description per product,
-- with deterministic retailer-priority resolution.
--
-- Part 1 of the "product page quality" work. Two new nullable columns plus an
-- apply RPC that only overwrites an existing description when the incoming feed
-- has equal-or-higher priority. The priority table mirrors
-- supabase/functions/_shared/description.ts (descriptionPriority) — KEEP IN SYNC.

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table products
  add column if not exists description text;

alter table products
  add column if not exists description_source_retailer_id integer references retailers(id);

-- ── Priority function ────────────────────────────────────────────────────────
-- Lower number = higher priority. Boots / Beauty Flash have editorial UK-English
-- copy; Stylevana / YesStyle are machine-translated and awkward. Ids are live
-- retailers.id values. Mirror of DESCRIPTION_PRIORITY in _shared/description.ts.
create or replace function fmb_description_priority(p_retailer_id integer)
returns integer
language sql
immutable
as $$
  select case p_retailer_id
    when 23 then 1  -- Boots
    when 27 then 2  -- Beauty Flash
    when 8  then 3  -- Escentual
    when 24 then 4  -- The Organic Pharmacy
    when 12 then 5  -- Superdrug
    when 11 then 6  -- Stylevana
    when 25 then 7  -- YesStyle
    when 6  then 8  -- Branded Beauty
    else 9
  end;
$$;

-- ── Apply RPC ────────────────────────────────────────────────────────────────
-- Bulk-set descriptions from a feed. Each element of `updates` is
-- { product_id, description, source_retailer_id }. A description is written only
-- when the product has none yet, or the incoming source ranks equal-or-higher
-- than the stored source. Re-running imports in any order converges to the
-- highest-priority source. Returns the number of rows actually updated.
create or replace function bulk_update_product_descriptions(updates jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with incoming as (
    select *
    from jsonb_to_recordset(updates)
      as x(product_id integer, description text, source_retailer_id integer)
  ),
  upd as (
    update products p
    set description = i.description,
        description_source_retailer_id = i.source_retailer_id
    from incoming i
    where p.id = i.product_id
      and i.description is not null
      and length(btrim(i.description)) > 0
      and (
        p.description is null
        or length(btrim(p.description)) = 0
        or fmb_description_priority(i.source_retailer_id)
             <= fmb_description_priority(p.description_source_retailer_id)
      )
      -- No-op guard: skip when nothing would change (same text, same source).
      and (p.description is distinct from i.description
           or p.description_source_retailer_id is distinct from i.source_retailer_id)
    returning 1
  )
  select count(*) into v_count from upd;
  return v_count;
end;
$$;

grant execute on function fmb_description_priority(integer) to anon, authenticated, service_role;
grant execute on function bulk_update_product_descriptions(jsonb) to anon, authenticated, service_role;

-- ── Expose description on the products_active view ───────────────────────────
-- The frontend reads products via products_active (live, non-merged, non-variant
-- rows). The view lists columns explicitly, so the new column must be added here
-- or it won't be selectable. Column list otherwise unchanged (append-only).
create or replace view products_active as
  select id,
    name,
    brand,
    category,
    image_url,
    ean,
    created_at,
    ingredients,
    concerns,
    subcategory,
    normalised_brand,
    canonical_size,
    match_key,
    tags,
    shade,
    product_type,
    top_category,
    merged_into,
    merged_at,
    description
  from products
  where merged_into is null and parent_product_id is null;
