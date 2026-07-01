// lib/events.ts
//
// Server-side behavioural event logging for FindMyBasket.
// Writes to Supabase search_events / outbound_clicks tables using the SERVICE ROLE.
// These tables have RLS enabled with no public policy, so only server code with the
// service role can write. Never import this into a client component.
//
// Design goals:
// - Fire-and-forget: logging must never block or break the user request. All writes
//   are wrapped so a logging failure is swallowed (with a console.error) and the
//   user's search / redirect proceeds regardless.
// - No PII: session_id is an anonymous client-generated id, never an email or user id.
// - Cheap: single insert, no reads, indexed for the funnel queries we care about.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The service role key is server-only. It is intentionally NOT in .env.local for the
// frontend build; it must be provided as a server environment variable in Vercel.
// (Standing note: SUPABASE_SERVICE_ROLE_KEY is deliberately absent from .env.local.)
let _client: SupabaseClient | null = null;

function serverClient(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    // Missing config: log once, return null so callers no-op rather than throw.
    console.error("[events] Supabase service credentials missing, event logging disabled");
    return null;
  }
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export type SearchEvent = {
  query: string;
  category?: string | null;
  resultCount?: number | null;
  source?: string | null;   // 'search_page' | 'finder' | 'header' | 'homepage'
  sessionId?: string | null;
  path?: string | null;
};

export type OutboundClick = {
  productId?: number | null;
  retailerId?: number | null;
  awinMid?: string | null;
  price?: number | null;
  source?: string | null;   // 'product_page' | 'search_results' | 'comparison' | 'brand_hub'
  sessionId?: string | null;
  path?: string | null;
};

/**
 * Log a search. Fire-and-forget: awaited internally but never throws to the caller.
 * Call this AFTER you know the result_count, since result_count = 0 is a key signal.
 */
export async function logSearch(e: SearchEvent): Promise<void> {
  const supabase = serverClient();
  if (!supabase) return;
  try {
    await supabase.from("search_events").insert({
      query: e.query,
      category: e.category ?? null,
      result_count: e.resultCount ?? null,
      source: e.source ?? null,
      session_id: e.sessionId ?? null,
      path: e.path ?? null,
    });
  } catch (err) {
    console.error("[events] logSearch failed:", err);
  }
}

/**
 * Log an outbound affiliate click. Fire-and-forget.
 * Call this in the AWIN redirect handler BEFORE issuing the 302, but do not await it
 * in a way that delays the redirect noticeably (see redirect handler example).
 */
export async function logOutboundClick(e: OutboundClick): Promise<void> {
  const supabase = serverClient();
  if (!supabase) return;
  try {
    await supabase.from("outbound_clicks").insert({
      product_id: e.productId ?? null,
      retailer_id: e.retailerId ?? null,
      awin_mid: e.awinMid ?? null,
      price: e.price ?? null,
      source: e.source ?? null,
      session_id: e.sessionId ?? null,
      path: e.path ?? null,
    });
  } catch (err) {
    console.error("[events] logOutboundClick failed:", err);
  }
}
