// lib/session.ts
//
// Anonymous session id for stitching funnel events (search -> clickout) without PII.
// A random opaque id stored in a first-party cookie. No email, no user id, no fingerprint.
// This lets you answer "of the sessions that searched, how many clicked out" without
// identifying anyone. Safe under UK GDPR as first-party, non-identifying analytics, but
// confirm your cookie/consent posture (see note at bottom).

import { cookies } from "next/headers";

const COOKIE = "fmb_sid";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days

/**
 * Read the current session id from the request cookie, or null if none.
 * Use in server components / route handlers.
 */
export function getSessionId(): string | null {
  try {
    return cookies().get(COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensure a session id exists, setting the cookie if absent. Returns the id.
 * Call from a route handler or middleware where setting cookies is allowed.
 */
export function ensureSessionId(): string {
  const store = cookies();
  const existing = store.get(COOKIE)?.value;
  if (existing) return existing;
  const id = crypto.randomUUID();
  store.set(COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
  return id;
}

// CONSENT NOTE:
// This is a first-party, httpOnly, non-identifying id used purely for funnel analytics.
// It is not shared with third parties and carries no personal data. Under PECR/UK GDPR
// this is a lower-risk cookie than marketing/tracking cookies, but if your cookie banner
// currently blocks all non-essential cookies until consent, gate ensureSessionId() behind
// that consent, or classify it as strictly-necessary analytics per your privacy policy.
// When in doubt, ship the event logging WITHOUT the cookie first (session_id = null);
// you still get totals (searches, clickouts, zero-result rate), just not per-session
// stitching. Add the cookie once consent handling is confirmed.
