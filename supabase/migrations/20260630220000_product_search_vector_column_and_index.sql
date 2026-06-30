-- Product Finder Stage 1: weighted full-text search vector.
-- Generated STORED column (no trigger, never stale) over name (A) > brand /
-- product_type (B) > description (C). Adding it rewrites the table once; the GIN
-- index then supports ~1-10ms lookups across the full catalogue.
ALTER TABLE products ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(brand, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(product_type, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'C')
) STORED;

CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);
