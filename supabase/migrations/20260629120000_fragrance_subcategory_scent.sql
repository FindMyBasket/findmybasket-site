-- Fragrance go-live (Task 1): allow the 'scent' subcategory.
--
-- classifyFragranceOrPersonalCare() routes fragrances to subcategory 'scent'
-- (eau de parfum/toilette, cologne, parfum, bare fragrance noun) and 'body'
-- (perfumed body/bath/hand products). 'body' is already permitted by the
-- existing products_subcategory_check; 'scent' is new, so the relabel of the
-- mislabeled-as-skincare fragrance rows fails the constraint without this.
--
-- Additive only: no existing row uses 'scent' yet, so the recreated constraint
-- validates the current table unchanged.
alter table products drop constraint if exists products_subcategory_check;
alter table products add constraint products_subcategory_check
  check (subcategory = any (array[
    'face','body','both','hand','foot','lips','eyes','nails',
    'cleanse','condition','treatment','style','colour',
    'scent'
  ]));
