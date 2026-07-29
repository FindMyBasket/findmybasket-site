# Ticket: GA4 events fired from mount effects are dropped

**Raised:** 29 July 2026, from Step 4 discovery of the dashboard build.
**Status:** OPEN, not started. Diagnosis complete, remedy not chosen.
**Blocks:** qualified sessions, commission per qualified session, and
search-to-comparison rate. See `docs/dashboard-build-brief.md`.

## The defect

`app/layout.tsx:41` loads the consent banner with `strategy="afterInteractive"`,
which Next.js runs **after** React hydration. `window.gtag` is defined by that
banner (`public/fmb-cookie-banner.js:79`, inside `loadAnalytics()`). Every
tracker in `lib/analytics.ts` opens with:

```ts
const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
if (typeof gtag !== 'function') return;
```

So an event fired from a mount effect runs during hydration, finds no `gtag`,
and returns. **The event is dropped silently.** There is no error, no console
warning, and no retry. The guard is correct in isolation; it is the ordering
that is wrong.

This is not a consent problem. It occurs for users who have already consented.

## Evidence

GA4 against the server-side tables, 7-day window ending 29 July:

| Event | Fires from | GA4 | Server-side | Verdict |
|---|---|---|---|---|
| `retailer_click` | user click | 47 | 267 lifetime | healthy |
| `view_item` | mount effect | 9 | n/a | **partial loss** |
| `search` | mount effect | **0** | 41 in the same window | **total loss** |

Consent scales a count down. It cannot zero one event while another fires
through the same gate. The split is by *how the event is triggered*, not by
volume.

`search` is a total loss rather than a partial one because every entry to
`/search` is a full-document GET: `public/index.html:281` (static homepage hero
form) and `app/search/page.tsx:67` (the results page's own form). There is no
`router.push` to `/search` anywhere in the codebase. Every arrival is a cold
load, so the effect always loses the race.

`view_item` survives only where a product page is reached by client-side
navigation, because `gtag` is already defined from the previous page. Cold loads
lose it.

## Scope: every event, audited

Requested explicitly, because fixing the two we happened to notice would leave
the same defect in place elsewhere.

| Event | Call site | Trigger | Affected |
|---|---|---|---|
| `retailer_click` | `ClickOutLink.tsx:73`, `RoutineBuilder.tsx:672/784/802` | user click | No |
| `affiliate_clickout` | `lib/analytics.ts:13` | user click | No |
| `add_to_cart` | `SaveToRoutineButton.tsx:33` | `handleClick` | **No** |
| `view_item` | `ProductViewTracker.tsx:33` | mount effect | **Yes, partial** |
| `search` | `SearchEventTracker.tsx:30` | mount effect | **Yes, total** |
| `basket_optimised` | `RoutineBuilder.tsx:547` | *both* | **Yes, one path** |
| `load_routine_from_url` | `RoutineBuilder.tsx:172` | mount effect | **Yes, likely total** |

Two findings beyond the original two:

**`basket_optimised` is affected on one path only.** The `user_action` path
(`RoutineBuilder.tsx:846`, an `onClick`) is safe. The `auto_shared_link` path is
fired from inside the URL-param mount effect via
`setTimeout(() => runOptimiser('auto_shared_link'), 300)` at
`RoutineBuilder.tsx:180`. The 300 ms delay probably wins the race most of the
time, which makes this the worst kind of affected path: intermittent, and
skewed toward slow connections. That path serves `/app?routine=1,2,3` links
from saved-routine emails, which are always cold loads.

**`load_routine_from_url` was not on anyone's list.** `RoutineBuilder.tsx:172`
fires it with an inline `window.gtag` call carrying the same early-return guard,
inside the same mount effect and *before* the 300 ms timeout. It only ever fires
on `/app?routine=...` arrivals from email, so 100% of its occurrences are cold
loads. Expect it to be at or near zero in GA4. It is not defined in
`lib/analytics.ts` at all, which is why an audit of that module alone would have
missed it.

## What to check when fixing

**Verify against a cold load, not a client-side navigation.** Client-side
navigation is the path that already works, so testing that way produces a false
pass on every affected event. Reproduce by opening `/search?q=...` directly in a
fresh tab, or by following an emailed `/app?routine=...` link, with consent
already granted.

**Verify `load_routine_from_url` and the `auto_shared_link` path specifically.**
Both need an emailed-link arrival to exercise at all, and neither will show up
in ordinary browsing.

**Do not verify by reading GA4 totals the same day.** GA4 processing lags 24 to
48 hours. Use DebugView, which is realtime, and which was never completed for
PR #129, which is how this survived since 25 July in the first place.

## Candidate remedies, not yet chosen

Listed for the person who picks this up. Each has a cost worth weighing rather
than an obvious winner.

1. **Move the banner to `strategy="beforeInteractive"`.** Smallest change,
   restores the ordering the trackers assume. Needs checking against the PECR
   requirement that GA4 does not load before consent: the banner script itself
   running early is fine, since `loadAnalytics()` is still gated on stored
   consent, but that gating must be re-read carefully before relying on it.
2. **Queue events until `gtag` exists.** Buffer in the tracker and flush when the
   banner defines `window.gtag`. Robust against any script-ordering change and
   fixes all seven events at once, including any added later. More code, and the
   buffer must be dropped rather than flushed when consent is refused.
3. **Define the `dataLayer` stub early, load gtag.js late.** `window.gtag` only
   pushes to `window.dataLayer` (`fmb-cookie-banner.js:79-81`), so the stub could
   be defined synchronously while the network request for gtag.js stays gated on
   consent. Events would queue in `dataLayer` naturally. This needs care: pushing
   to `dataLayer` before consent, then loading gtag.js after, would transmit the
   queued events, so the queue must be cleared on refusal.

Option 3 is closest to how the guard was presumably intended to work, but all
three need the consent behaviour verified rather than assumed.

## After the fix

Record it as a `platform_changes` boundary with `status = 'occurred'`. The
qualified-sessions series is only trustworthy from that date forward, and
comparing across the fix would show the correction as a traffic increase. The
same applies to search-to-comparison rate, which cannot be computed at all until
`search` fires.
