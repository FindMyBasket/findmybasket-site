// lib/session.ts
//
// READS an anonymous session id from a first-party cookie. DOES NOT WRITE ONE, and
// deliberately provides no way to. `session_id` is NULL on every row of both
// outbound_clicks and search_events and is expected to stay that way.
//
// WHY THERE IS NO WRITER. This file used to export ensureSessionId(), which set a
// 180-day httpOnly cookie. It was never called from anywhere, and it was REMOVED on
// 13 August 2026 rather than left inert. Two reasons:
//
//   1. public/privacy.html section 2.2 states that the click record "sets no cookies
//      of its own". An unused function that sets a 180-day cookie sits one call site
//      away from falsifying a published sentence, and inert code that TOUCHES a cookie
//      is what made an earlier draft of that sentence false in intent.
//   2. Populating session_id was considered in full and rejected. See work-list item
//      82. Briefly: a consented cookie gates on the same `analytics` toggle GA4 does,
//      so it covers exactly the population GA4 already covers — and GA4 already
//      stitches sessions natively for those visitors. Its one distinguishing property,
//      covering refusers, is precisely what the consent gate removes. Meanwhile the
//      consenting share moved 65% -> 52% -> 34% in three weeks, so a funnel visible
//      only to that subset cannot separate a falling conversion rate from falling
//      consent.
//
// WHAT ANSWERS THE FUNNEL QUESTION INSTEAD. For consenting visitors, GA4: trackSearch
// fires `search` and retailer_click fires on the clickout, both behind the same
// toggle, and GA4 sessionises them. For refusing visitors it is NOT AVAILABLE BY ANY
// MEANS WE WOULD ACCEPT — that is a limit, not a gap, and a missing refuser funnel is
// not a defect owed work.
//
// getSessionId() is kept so the two call sites keep their shape without reintroducing
// a writer. It reads a cookie nothing sets and returns null.

import { cookies } from "next/headers";

const COOKIE = "fmb_sid";

/**
 * Read the current session id from the request cookie, or null if none.
 *
 * Returns null on every request today: nothing sets this cookie, by decision rather
 * than by omission. Do not "fix" that by adding a writer — read work-list item 82
 * first, and privacy.html section 2.2 second.
 */
export function getSessionId(): string | null {
  try {
    return cookies().get(COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}
