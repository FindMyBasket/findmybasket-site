# Dashboard data access

How the data-quality dashboard must read its sources. Written 28 July 2026,
during the Tier 2/3 security remediation, so that a deliberate revoke does not
turn into a debugging session weeks later.

## `brand_index_health` — server-side only, via `service_role`

The dashboard is specified to surface brand index staleness: behind-by duration
and brand count gap. Both come from the `brand_index_health` view.

**`anon` and `authenticated` are both revoked on that view** (migration
`20260728160000`). A read from the browser, or through an authenticated Supabase
client, **will fail with permission denied**. That is deliberate.

Read it server-side with the existing service-role client:

```ts
import { supabase } from '@/lib/supabase';   // built from SUPABASE_SERVICE_ROLE_KEY

const { data, error } = await supabase
  .from('brand_index_health')
  .select('brand_count_gap, watermark_behind, minutes_since_refresh')
  .single();
```

No new plumbing is needed. The dashboard route is authenticated and
server-rendered already, and `lib/supabase.ts` exists precisely to bypass RLS for
this class of read. Never import it from a Client Component.

### Why not just grant `authenticated`

It was considered and rejected. Widening a diagnostic view for one consumer
re-opens it for every authenticated session, including any future one that has no
business seeing catalogue watermarks. The view stays closed and the single
consumer reads it with a credential that never reaches the browser.

## The same applies to

`feed_size_growth_trend` and `saved_routines_stats` are revoked from `anon` and
`authenticated` by the same migration. Neither has a dashboard consumer today. If
one is added, read it server-side the same way.

`saved_routines_stats` deserves a note if it is ever surfaced: it is
aggregate-only (`count`, `count(DISTINCT email)`, `avg`, `max`, single row, no
`GROUP BY`), so it exposes no routine bodies and no email addresses. What it does
expose is business metrics including the unique user count, which is why it is not
public.

## Still readable by `anon`, by decision

`catalog_health_current` was reviewed in the same pass and left open. It reads
`products` and `retailer_prices` — **not** `catalog_health_history`, despite the
name — and both of those already carry `USING (true)` SELECT policies, so anon can
compute the same figures directly. Revoking the view would not deny anything it
does not already have.

It does publish derived operational metrics (orphan count, missing images,
`importer_status`) to anyone holding the anon key. That is a live choice, not an
oversight; revisit it if those figures become commercially sensitive.

Related: `supabase/migrations/README.md` for the migration conventions, and
`supabase/migrations/20260728160000_revoke_diagnostic_view_grants.sql` for the
full reasoning on why a grant revoke was preferred to `security_invoker`.
