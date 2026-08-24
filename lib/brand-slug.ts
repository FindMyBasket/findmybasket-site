// Brand slug derivation, in its own module SO IT CAN BE TESTED.
//
// It previously lived in lib/queries.ts, which imports the Supabase client -- so any test
// touching brandSlug pulled a database dependency into the test runner and failed to resolve.
// MOVED, NOT COPIED: a second implementation is the drift hazard item 267 records, where two
// expressions of one rule become two rules and the disagreement surfaces on a page. queries.ts
// re-exports from here, so every existing import is unchanged. Item 271.
//
// THIS FUNCTION IS THE REASON A RENAME ORPHANS A URL: the slug is DERIVED from the brand
// string and nothing stores it, so changing the brand changes the address. brand_aliases is
// what recovers the old one -- see resolveBrandAliasSlug in lib/brand-queries.ts.
export function brandSlug(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
