-- Applied via MCP apply_migration 2026-07-03 (supabase db push blocked by
-- migration-history drift; file kept for the record).
--
-- Nullable direct-ASIN hard-link for products with a verified Amazon listing.
-- When set, the product page renders a direct amazon.co.uk/dp/{ASIN} link (with the
-- findmybasket-21 associate tag) instead of the generic tagged-search link.
ALTER TABLE products ADD COLUMN IF NOT EXISTS amazon_asin text;

-- Recreate products_active to expose the new column (explicit-column view; column
-- appended at the end so CREATE OR REPLACE is valid). Definition otherwise verbatim.
CREATE OR REPLACE VIEW products_active AS
 SELECT id, name, brand, category, image_url, ean, created_at, ingredients, concerns,
        subcategory, normalised_brand, canonical_size, match_key, tags, shade, product_type,
        top_category, merged_into, merged_at, description, search_vector, amazon_asin
   FROM products p
  WHERE merged_into IS NULL AND parent_product_id IS NULL AND image_url IS NOT NULL
        AND image_url <> ''::text
        AND (EXISTS (SELECT 1 FROM retailer_prices rp WHERE rp.product_id = p.id));

-- Populate the 41 verified FMB product_id -> ASIN mappings.
UPDATE products p SET amazon_asin = v.asin
FROM (VALUES
  (70338,'B0H5K6L4D7'),(16160,'B01CVXSPBO'),(788,'B0CRKW57B8'),(794,'B0DL8Y8N4G'),
  (2797,'B0DL92QM79'),(7092,'B09JVNZVH3'),(3077,'B09XQBCSD8'),(3082,'B0B45LL4DD'),
  (1276,'B0D8B9MKMV'),(123,'B00PBX3L7K'),(124,'B0CCGVMN4N'),(1028,'B07Y32L357'),
  (1027,'B07RD7TC95'),(6965,'B0DRZ8GBDM'),(7197,'B09TGP4SGQ'),(6180,'B09V7Z4TJG'),
  (983,'B0DBF65JYY'),(192,'B0BRMYHMS5'),(1177,'B0915K6WD3'),(6256,'B0C61CJ66L'),
  (54733,'B08FM5BTF6'),(6800,'B081VS3F27'),(978,'B0F18LKNSW'),(1499,'B09JB71319'),
  (971,'B0B881GN1P'),(639,'B07BYJF7L7'),(6767,'B082SYXKFH'),(93648,'B07WZ2YTDP'),
  (6174,'B0DGTMR754'),(1782,'B0B3R661JP'),(3995,'B09ZB7GDJL'),(692,'B07THCMGFP'),
  (1773,'B0CCJ3SRB9'),(7741,'B01LEJ5MSK'),(586,'B06XHLGL6N'),(6391,'B09B221Q7K'),
  (1488,'B07T5BN3P2'),(3079,'B086VKZZZY'),(609,'B08WJQ3XJD'),(1788,'B08RLZ28QK'),
  (1783,'B0BJPKX14D')
) v(id, asin)
WHERE p.id = v.id;
