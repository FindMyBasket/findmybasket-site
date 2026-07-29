# Ticket: GA4 events fired from mount effects are dropped

**Raised:** 29 July 2026, from Step 4 discovery of the dashboard build.
**Status:** OPEN, not started. Diagnosis complete. **Remedy chosen 29 July: the
dataLayer stub (remedy 3).** Implementation approach proposed and awaiting review;
no code written.
**Blocks:** six dashboard metrics. Five derive from `view_item` and are
suppressed from display (qualified sessions, commission per qualified session,
comparison views, session to comparison-view rate, and comparison-view to
outbound-click rate); search-to-comparison rate cannot be computed at all. See
section 4.1 of `docs/dashboard-build-brief.md`.

Three of those five are leading indicators, so until this lands the panel meant
to be the early-warning system is the part of the dashboard least able to warn.

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

## Method: audit by call site, never by module

**This audit is scoped to every `gtag(` and every `dataLayer.push` in the
repository, of any file type. It is deliberately not scoped to
`lib/analytics.ts`.**

The first pass was module-scoped and reported complete. It missed
`load_routine_from_url` for one reason only: the event is not in the analytics
module. **Scoping a search to the module that *should* contain a thing can only
ever find the instances that are already where they belong.** It is the same
shape as a repo grep for a credential, which can only ever answer "what
references this", never "does this exist".

The re-run by call site found **fifteen distinct GA4 events, not seven**. The
module-scoped method undercounted the inventory by more than half. It happened
not to change which events are affected, and that is luck rather than
vindication: the method was wrong either way, and the next time it is wrong it
may be wrong about something that matters.

**If a later pass finds a sixteenth, the same conclusion applies.** Re-run the
grep rather than trusting this table, and re-run it after any change that adds
an event.

```
grep -rn "gtag(" --include="*.ts" --include="*.tsx" --include="*.js" \
  --include="*.jsx" --include="*.html" . | grep -v node_modules
grep -rn "dataLayer" --include="*.ts" --include="*.tsx" --include="*.js" \
  --include="*.jsx" --include="*.html" . | grep -v node_modules
```

## Two script-loading models, and only one has the bug

Worth knowing before choosing a remedy, because a fix applied to one leaves the
other inconsistent.

| Surface | How the banner loads | React hydration | Race |
|---|---|---|---|
| Next.js app (`app/**`) | `app/layout.tsx:41`, `strategy="afterInteractive"` | yes | **yes** |
| Static pages (`public/*.html`) | `<script src="/fmb-cookie-banner.js" defer>` | none | no |

The static pages fire their events from form submits and fetch handlers, long
after a deferred script has run, so they are unaffected. Any remedy that changes
how or when consent state is established must be applied to **both**, or the two
surfaces will report on different rules.

## Scope: every event, audited by call site

Requested explicitly, because fixing the two we happened to notice would leave
the same defect in place elsewhere.

### In `lib/analytics.ts`

| Event | Call site | Trigger | Affected |
|---|---|---|---|
| `retailer_click` | `ClickOutLink.tsx:73`, `RoutineBuilder.tsx:672/784/802` | user click | No |
| `affiliate_clickout` | `lib/analytics.ts:13` | user click | No |
| `add_to_cart` | `SaveToRoutineButton.tsx:33` | `handleClick` | **No** |
| `view_item` | `ProductViewTracker.tsx:33` | mount effect | **Yes, partial** |
| `search` | `SearchEventTracker.tsx:30` | mount effect | **Yes, total** |
| `basket_optimised` | `RoutineBuilder.tsx:547` | *both* | **Yes, one path** |

### Inline `window.gtag` calls in `app/**`, absent from the analytics module

| Event | Call site | Trigger | Affected |
|---|---|---|---|
| `load_routine_from_url` | `RoutineBuilder.tsx:173` | mount effect | **Yes, likely total** |
| `save_routine` | `RoutineBuilder.tsx:585` (account), `:635` (email) | after a user-initiated save | No |
| `open_all_products` | `RoutineBuilder.tsx:698` | user click | No |
| `track_product` | `AccountRoutine.tsx:155` | after a user-initiated RPC | No |

### Static pages, `public/*.html`

Unaffected as a class: no React hydration, and the banner is a plain `defer`
script that has run long before any of these fire. Listed so the inventory is
complete and so a remedy is not applied to one surface only.

| Event | Call site | Trigger |
|---|---|---|
| `category_interest_signup` | `index.html:638` | form submit |
| `unsubscribe_success` / `unsubscribe_error` | `unsubscribe.html:291-323` | fetch handler |
| `alert_unsubscribe_success` / `alert_unsubscribe_error` | `unsubscribe-alerts.html:292-323` | fetch handler |

### Findings

Two beyond the original two, and both came from the call-site method:

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

4. **Google Consent Mode v2.** Load gtag early with consent state `denied` by
   default, then `gtag('consent','update', ...)` on acceptance. It is designed
   for exactly this race and it is what Google expects for UK traffic, so it is
   the option most likely to still be correct in a year.

   **It looks like it addresses a second problem.** Today a refusing visitor is
   lost entirely, which is the 20 to 40% gap between GA4 and the server-side
   table. Consent Mode still sends cookieless pings, so those hits are not lost.

   **But it probably does not help the metric this ticket exists for, and this is
   the decisive point.** The two halves behave differently:

   - **Event-scoped counts improve.** With `analytics_storage` denied, cookieless
     pings still carry the event, so `retailer_click` and similar event counts
     recover most of the gap directly.
   - **Session-scoped and user-scoped metrics do not.** They cannot be counted
     from cookieless pings, because there is no identifier to group them by. They
     are reconstructed by Google's *behavioural modelling*, which only activates
     once the property meets a minimum data threshold.

   **`qualified_sessions` is session-scoped.** It is the count of sessions
   containing a `view_item`. So it lands squarely in the half that depends on
   modelling, and modelling is the half this property is least likely to qualify
   for. At roughly 47 `retailer_click` a week, the shortfall against the
   published thresholds is not marginal, it is orders of magnitude, which is why
   the conclusion holds even if the exact figures have moved.

   **Verify the current threshold against Google's live documentation rather than
   against this ticket or anyone's recollection.** The published requirements
   have historically been stated as daily-event and daily-user minimums sustained
   over a trailing window, and both the numbers and the wording have changed more
   than once. What matters for the decision is only whether this property clears
   them, and on any plausible reading it does not.

   **If that holds, remedy 4 does not solve the problem it appeared to solve.**
   It would improve outbound-click counts, which are already healthy, and leave
   qualified sessions, the metric under suppression, exactly as unusable. It may
   still be worth adopting on its own merits, as the option Google expects for UK
   traffic and the one most likely to still be correct in a year. It should not
   be adopted *as the fix for this ticket*.

   Two further caveats, neither of which is a technical question:

   - **Whether modelled conversions are acceptable for decision-making here is a
     judgement call.** At this volume the modelling has little to work with, and
     a modelled number carries the same hazard as the biased `view_item` figure
     this ticket exists to suppress: it is present, plausible, and wrong by an
     unknown amount. Decide deliberately, not by adopting the default.
   - **It changes what the Step 6 consent-ratio indicator measures.** That
     indicator is currently GA4 clicks over server-side clicks, and its whole
     value is that GA4 counts only consenting visitors. Under Consent Mode the
     numerator would include modelled non-consenting sessions, so the ratio would
     drift toward 1 and stop measuring consent at all. **This remedy and that
     indicator have to be decided together, not separately**, or the indicator
     will silently become a measurement of something else while keeping its name.

## DECISION, 29 July: remedy 3, the dataLayer stub

**Remedies 1, 3 and 4 evaluated; 3 chosen. 1 declined, 4 deferred.**

**It does not change the legal position.** Nothing touches the device before
consent, exactly as today. The stub defines a function and an array in memory; it
sets no cookie and makes no network request. PECR is therefore not engaged and no
UK GDPR question arises.

- **Remedy 1, `beforeInteractive` on the banner, declined.** It would load gtag.js
  and set `_ga` cookies before consent, which is what PECR Regulation 6
  prohibits.
- **Remedy 4, Consent Mode v2, deferred rather than rejected.** Its cookieless
  pings raise an unresolved UK GDPR question that would need a legal opinion,
  which is not affordable at this stage. It is *also* declined on value: its
  benefit is modelled data from refusing visitors, and at roughly 47
  `retailer_click` a week the property is below the threshold at which modelling
  produces anything usable. **Record as revisit-when-volume-supports-it, not as
  rejected. Both conditions change together**, since the volume that would make
  the modelling useful is also the volume that would justify the legal opinion.

**It is the only remedy that addresses the mechanism.** The race is that events
fire before `gtag` exists. The stub means `gtag` always exists. The other three
change *when consent is established* and leave the ordering to chance.

> **Do not read "the stub loads before hydration" as a reversal of remedy 1.**
> What was declined is loading *gtag.js* early. What is adopted is defining the
> *queue* early. They differ on precisely the point that matters: one transmits
> and stores, the other does neither.

**Evaluate all four. Pick none yet.** *(Superseded by the decision above. Kept so
the reasoning that led to it stays legible.)*

**The PECR read applies to all four, not only to option 1.** Every one of them
changes when something is loaded or what is sent before consent, so each needs
the same check: that no analytics cookie is set and no identifying data is
transmitted until consent is given. Option 3's queue must be cleared rather than
flushed on refusal, and option 4's cookieless pings need confirming as acceptable
under PECR for this property rather than assumed acceptable because Google
supplies them.

Option 3 is closest to how the guard was presumably intended to work, and option
4 is the most future-proof, but all four need the consent behaviour verified
rather than assumed.

## Proposed implementation, NOT APPROVED, reported for review

Read against `public/fmb-cookie-banner.js` as it stands.

### 1. Split the stub into its own file

New `public/fmb-gtag-stub.js`, roughly fifteen lines: define
`window.dataLayer = window.dataLayer || []` and `window.gtag` as a function that
pushes its `arguments` onto it. Nothing else. No network request, no cookie, no
reading of stored consent.

Loaded on both surfaces from the one file, so they cannot drift:

| Surface | How |
|---|---|
| Next.js app | `<Script src="/fmb-gtag-stub.js" strategy="beforeInteractive" />` in the **root** layout (App Router requires root; it does not work in a nested layout) |
| Static pages | `<script src="/fmb-gtag-stub.js"></script>` in `<head>`, ordered **before** the existing banner tag |

`public/fmb-cookie-banner.js` keeps its current loading strategy on both
surfaces. It continues to own the consent UI and the decision.

### 2. Centralise the consent outcome in one function

This is the part that most wants review, because the current code has **four
independent decision points** and only the granting ones do anything:

| Line | Path | Today | Needs |
|---|---|---|---|
| `:206` | `commitConsent`, granted | `loadAnalytics()` | replay |
| `:206` | `commitConsent`, refused | *nothing* | **discard** |
| `:233` | returning visitor, granted | `loadAnalytics()` | replay |
| `:233` | returning visitor, refused | *nothing* | **discard** |
| `:236` | GPC auto-reject | `setConsent(false)` | **discard** |

Three paths currently do nothing and must now actively discard. Leaving any one
of them doing nothing leaves a live queue, and it would fail silently, which is
the exact shape this repo has hit four times in a week.

**So: one `resolveConsent(granted)` called from every decision point, rather than
discard logic added at each.** One place to read, one place to test.

### 3. Grant path: capture, clear, replay in order

```
var queued = window.dataLayer.slice();   // capture what accumulated
window.dataLayer.length = 0;             // clear so gtag.js starts clean
loadAnalytics();                         // js + config pushed here, in order
for (var i = 0; i < queued.length; i++) window.dataLayer.push(queued[i]);
```

Order is load-bearing. `gtag.js` processes `dataLayer` in sequence, so `js` and
`config` must precede the replayed events or they are mis-attributed or dropped.
Capture-and-replay rather than letting `gtag.js` find the queue in place, because
the queue would otherwise sit *ahead* of `config`.

**Hazard in the existing code:** `loadAnalytics()` at `:78` does
`window.dataLayer = window.dataLayer || []`, which is idempotent and safe. It
must stay that way. Anyone "tidying" it to `window.dataLayer = []` destroys the
queue, and the tests would still pass for a returning visitor.

### 4. Refusal path: discard, and stop accepting

```
window.dataLayer.length = 0;   // drop what accumulated
window.gtag = function () {};  // discard everything from here
// gtag.js is never loaded
```

**Both halves are required.** Truncating alone leaves the stub still queueing, so
a later acceptance through Cookie Settings would transmit events gathered during
the refused period. That is the UK GDPR problem this ticket is most concerned
with, arriving by a back door.

### 5. Bound the queue

Cap it, in the region of 50 entries, dropping newest once full. A visitor who
never answers the banner and browses at length would otherwise grow it without
limit. Dropping rather than transmitting is the safe direction.

### 6. Leave the tracker guards in place

`if (typeof gtag !== 'function') return` in `lib/analytics.ts` becomes inert once
the stub always exists. **Do not remove it.** It is the backstop if the stub ever
fails to load, and without it that failure would be a crash instead of a silent
no-op.

### Known limitation, to accept knowingly

Replayed events are timestamped by GA4 at replay time, not at occurrence time.
For the common case, a returning visitor with stored consent, that is a few
hundred milliseconds. For a first-time visitor who leaves the banner up and then
accepts, every queued event lands at the moment of acceptance. Event *counts* are
correct; intra-session timing for that visitor is not. Acceptable, but it should
be a known limitation rather than a surprise.

**What this does not do, by design:** it does not recover refusing visitors. The
Step 6 consent ratio therefore keeps measuring exactly what it measures today,
which is a point in this remedy's favour given that remedy 4 would have quietly
changed it.

### Verification, per the three traps

1. **Cold load, not client-side navigation.** Open `/search?q=...` directly in a
   fresh tab with consent already granted. Client-side navigation is the path
   that already works and would show a false pass on every affected event.
2. **DebugView, not same-day GA4 totals.** The 24 to 48 hour processing lag is
   how this survived from 25 July.
3. **Re-run the call-site grep**, do not trust the fifteen-event table.

Plus the paths that need deliberate exercise, because ordinary browsing never
reaches them: an emailed `/app?routine=1,2,3` link, for
`load_routine_from_url` and the `auto_shared_link` path of `basket_optimised`.

And the one that matters most: **refuse consent, browse, then accept through
Cookie Settings, and confirm in DebugView that nothing from the refused period
is transmitted.**

## After the fix

Record it as a `platform_changes` boundary with `status = 'occurred'`, then
un-suppress the five metrics in section 4.1 of the build brief. They are only
trustworthy from that date forward, and comparing across the fix would show the
correction as a traffic increase. Search-to-comparison rate becomes computable
for the first time.

**Watch the comparison-view to outbound-click rate specifically as the fix
lands.** It is currently inflated to roughly 522% because only its denominator is
broken, and a figure that absurd is self-evidently wrong. A partial fix would
walk it down through entirely plausible values on its way to the truth, and there
is nothing on the page that would distinguish that from a genuine improvement.
Prefer a fix that lands at once over one that lands gradually, and if it must be
gradual, keep the metric suppressed until it is complete.
