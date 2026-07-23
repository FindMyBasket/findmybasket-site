// Caller gating for admin edge functions.
//
// WHY THIS EXISTS — the trap it closes:
//   `verify_jwt = true` does NOT keep the public out. It requires *a* validly
//   signed project JWT, and the anon key is exactly that. Our anon key ships in
//   the browser bundle (.next/static/chunks/...), so before this check every
//   function — importers included — was invokable by any visitor. Confirmed on
//   2026-07-21: anon JWT + {"retailer_id":999999} reached import-awin-feed's own
//   404 handler, i.e. it executed past the gateway.
//
//   So the gateway gives us "is this a real project token?" and nothing more.
//   Deciding *which* token is the function's own job. That is this file.
//
// TRUST MODEL:
//   We read the JWT payload without verifying its signature, which is only safe
//   because verify_jwt has already verified it upstream. Keep verify_jwt = true
//   on every function that calls this — without it, the role claim below is
//   attacker-controlled and this check is worthless. The direct comparison
//   against SUPABASE_SERVICE_ROLE_KEY runs first and does not depend on that
//   assumption.
//
// KNOWN CALLERS, all of which present service-role (audited 2026-07-21):
//   - pg_cron jobs (all 12)
//   - fmb_invoke_import_slice / fmb_watchdog_stalled_imports, which read
//     service_role_key from vault — this is how sliced imports self-chain
//   - GitHub Actions (refresh-debenhams, sync-adg-feed, sync-bb-feed, and the
//     disabled refresh-stylevana / refresh-superdrug), via SUPABASE_SERVICE_KEY
//   - no app code: nothing in the site invokes functions/v1 at all

function timingSafeEqual(a: string, b: string): boolean {
  // Length is not secret (both are fixed-format tokens), but compare the full
  // span anyway so we never early-return on the first differing byte.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function roleFromJwt(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // base64url -> base64, then pad.
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded))?.role ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns null when the caller is service-role, or a 403 Response to return
 * as-is when it is not. Call it AFTER the OPTIONS preflight early-return, so
 * browser preflights are never gated.
 *
 *   const denied = requireServiceRole(req, corsHeaders);
 *   if (denied) return denied;
 */
export function requireServiceRole(
  req: Request,
  corsHeaders: Record<string, string> = {},
): Response | null {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    // Fail closed. A missing env var must never read as "allow everyone".
    console.error("requireServiceRole: SUPABASE_SERVICE_ROLE_KEY unset — refusing all callers");
    return new Response(
      JSON.stringify({ error: "Server misconfigured: service-role key unavailable" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

  const ok = token.length > 0 &&
    (timingSafeEqual(token, serviceKey) || roleFromJwt(token) === "service_role");

  if (ok) return null;

  console.warn("requireServiceRole: rejected non-service-role caller");
  return new Response(
    JSON.stringify({
      error: "Forbidden: this function requires the service-role key",
      hint: "The anon key is a valid JWT and passes verify_jwt, but is not authorised here.",
    }),
    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
