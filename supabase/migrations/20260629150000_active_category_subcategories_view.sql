-- Distinct (top_category, subcategory) pairs for the sitemap.
--
-- The sitemap previously enumerated subcategories with an un-paginated
-- `select subcategory from products_active where top_category = $1`, which hits
-- PostgREST's default 1,000-row cap. When a category's first 1,000 rows all share
-- one subcategory, the others are silently dropped — e.g. bath_body returned only
-- /bath-and-body/body and missed /bath-and-body/hand (645 products). This view
-- collapses to the handful of distinct pairs so the sitemap reads tens of rows,
-- not tens of thousands, and can never miss a subcategory.

create or replace view active_category_subcategories as
select distinct top_category, subcategory
from products_active
where top_category is not null
  and subcategory is not null;

grant select on active_category_subcategories to anon, authenticated;
