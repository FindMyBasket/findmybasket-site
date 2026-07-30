# Ticket: GA4 events fired from mount effects are dropped

**Raised:** 29 July 2026, from Step 4 discovery of the dashboard build.
**Status:** **RESOLVED 29 July. Fixed, verified in a browser, live, boundary
recorded.** Remedy 3, the dataLayer stub. `public/fmb-gtag-stub.js`, wired into
`app/layout.tsx` and all 19 static pages, with `scripts/gtag-stub.test.mjs`
covering the gate, the bound and the replay. Merged as PR #146 (`4c9aa0a`).
Production deploy instant `2026-07-29T14:12:58Z`, recorded as `platform_changes`
id 17 with `status = 'occurred'` (PR #147, migration `20260729200000`).

Verified serving, not merely green: `/fmb-gtag-stub.js` returns 200 (was 404) and
the rendered `<head>` carries it un-deferred on both a static and a
runtime-rendered route. **`en=search` transmits on a cold full-document GET**
(`result_count=151`, `search_source=search_page`), which is the event that read
exactly zero and had been dropping silently since 25 July.

**Consent-decision coverage: 5 of 5 paths TESTED**, none assumed to share
`resolveConsent`: banner-refuse, banner-accept, Cookie-Settings-accept,
stored-consent-at-init, and GPC. Refusal verified genuinely silent: dataLayer 0,
zero collect requests, survived two cold loads, and nothing from the refused
period replayed after a later acceptance.

**GPC verified in a browser on 30 July 2026**, closing the fifth path. Both
branches exercised, and the coverage claim is now stated as measured rather than
routed:

| Path | Result |
|---|---|
| GPC alone, no stored consent | no banner, resolved true, granted **false**, `which` = noop, dataLayer **0**. Correct. |
| Stored accept, then GPC switched on | granted **true**, `which` = pusher, dataLayer **5**. Analytics still running with the signal enabled. |

The second confirms the precedence: **a stored acceptance beats a later GPC
signal.** That is the intended behaviour and is being kept — see the decision
recorded at the foot of this ticket.

See "After the fix" at the foot of this ticket for what the un-suppression
actually required, which was not a straight lift.

> **Three defects were found DURING verification, not during writing.** Recorded
> because each was invisible to the change itself and each would have shipped.
>
> 1. **Accepting after a refusal left analytics dead.** The refusal path set
>    `gtag` to a hard no-op and never restored it, so a later acceptance through
>    Cookie Settings configured nothing. The discard was right; the recovery was
>    missing. Only the refuse-then-accept ORDER exposes it, which is why the gate
>    test is the gate.
> 2. **The inline block was truncated by its own comment.** The file documented
>    the static-page script tag literally, and an HTML parser ends a script
>    element at the first closing-script sequence regardless of JavaScript
>    context. The block was cut before `window.gtag` was ever assigned, silently
>    restoring the exact bug this ticket exists to fix. Found only by reading
>    byte offsets in the emitted HTML. Now guarded three ways: reworded source, a
>    defensive escape in `layout.tsx`, and a test that fails if the sequence
>    reappears.
> 4. **Inlining the stub via `readFileSync` 500'd every runtime-rendered route,
>    and the Vercel check was GREEN throughout.** Reading the file at module
>    scope in the ROOT layout meant the read happened inside the serverless
>    function. Vercel's tracer cannot see a runtime `fs` call, so
>    `public/fmb-gtag-stub.js` was absent from the bundle and the layout threw.
>    Prerendered pages were unaffected because their read happened on the build
>    machine, which is exactly what hid it: cache HITs returned 200 and only
>    cache MISSes failed.
>
>    | Route | Before | After |
>    |---|---|---|
>    | `/search?q=abib` (runtime, MISS) | **500** | 200 |
>    | `/account` (runtime, MISS) | **500** | 200 |
>    | `/app`, `/brands`, `/skincare` (prerendered, HIT) | 200 | 200 |
>    | production `/search` (runtime, no change) | 200 | 200 |
>
>    `outputFileTracingIncludes` did not prevent it. The fix was to remove the
>    dependency rather than debug the config: a plain `<script src>` is
>    parser-blocking, is served from the CDN rather than the function bundle, and
>    is the identical mechanism the static pages already use. **Only fetching a
>    deployed page on a cache MISS finds this class of defect. A green build
>    cannot.**
>
> 3. **`beforeInteractive` does not do what the proposal assumed.** In the App
>    Router it emits a preload link plus a `self.__next_s.push(...)` at the end
>    of `<body>` for Next's own runtime to inject, not a blocking script in the
>    head. Whether that precedes hydration is a framework internal. Replaced with
>    inlining the same file, so the guarantee is visible in the HTML instead of
>    depending on behaviour that could change on a Next.js upgrade.
**Blocked:** six dashboard metrics. Five derive from `view_item` and were
suppressed from display (qualified sessions, commission per qualified session,
comparison views, session to comparison-view rate, and comparison-view to
outbound-click rate); search-to-comparison rate could not be computed at all. See
section 4.1 of `docs/dashboard-build-brief.md`.

Three of those five are leading indicators, so until this landed the panel meant
to be the early-warning system was the part of the dashboard least able to warn.

**Now unblocked, but the suppression lifts by date rather than all at once:** the
five render from `week_start` **2026-08-03**, the first ISO week lying entirely
after the fix. A **seventh** metric turned out to be affected and was missed by
the original list, `consent_ratio`; see the foot of this ticket.

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
| `load_routine_from_url` | `RoutineBuilder.tsx:173` | mount effect, ~~inline~~ **behind an awaited DB call** | ~~**Yes, likely total**~~ **CORRECTED: mostly delivered.** See below |
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

### CORRECTION, 29 July, from the diagnostic: "mount effect" was the wrong axis

The diagnostic contradicted a prediction in the table above, and chasing it
showed the table was classifying on the wrong property.

**`load_routine_from_url` fired 13 times on 4 of 7 days.** This ticket predicted
"likely total loss" on the grounds that it fires from a mount effect and only
ever on emailed `/app?routine=` arrivals, which are always cold loads. Both of
those premises are true. The conclusion was still wrong.

**It is not fired inline.** `RoutineBuilder.tsx:142` opens the effect, but the
`gtag` call at `:172` sits inside an `async` IIFE **after an awaited Supabase
round-trip** (`db.from('products_active').select(...)`, `:155`). A network
round-trip to Supabase reliably takes longer than the gap between hydration and
an `afterInteractive` local script tag. So the banner nearly always wins, and
this event is **mostly delivered**, not mostly lost.

**The right discriminator is not the trigger. It is whether anything AWAITED
sits between hydration and the `gtag` call.**

| Event | Between hydration and `gtag` | Cold-load outcome |
|---|---|---|
| `search` | nothing, inline | lost reliably (observed: 0) |
| `view_item` | nothing, inline (`ProductViewTracker.tsx:33`) | lost reliably |
| `load_routine_from_url` | an awaited Supabase round-trip | **mostly delivered** |
| `basket_optimised` / `auto_shared_link` | `setTimeout(..., 300)` | mostly delivered |
| `retailer_click`, `add_to_cart`, `save_routine` | a human | delivered |

Grouping by "mount effect" put the two awaited cases in with the two inline ones
and mis-predicted both. It is the same error as auditing by module instead of by
call site, one level down: **a category that sounds like the cause, standing in
for the mechanism.** The mechanism is elapsed time against one specific script
tag.

**So 13 is probably close to the true number of emailed-routine arrivals**, not a
biased fraction of it. That is a better outcome than "intermittent, therefore
biased", which was the natural reading of 13-instead-of-0. It is not a guarantee:
an unusually slow banner against an unusually fast cached query could still
invert it, so treat the series as near-complete rather than complete.

**And `view_item` is NOT this pattern.** It fires inline with nothing awaited, so
it belongs with `search` in the reliably-lost class, and its 9 events on 3 of 7
days do not indicate the same "sometimes wins" behaviour. That does not settle
whether the low count is loss or youth, because **both are true at once**: it
shipped on 25 July (`974bcc0`, 18:00 +0100), so the 7-day window ending 28 July
contains roughly 3.5 live days, and it was lossy across all of them.

What settles the residual question is the fix itself, which is a natural
experiment: `view_item` per day either side of `2026-07-29T14:12:58Z`, against
product-page views on the same days. If the inline-loss diagnosis is right it
steps up sharply and then tracks product-page views. **Use `sessions` rather than
`page_view` as the denominator**, because `pageChangesEnabled` is ON and
`page_view` therefore counts SPA route changes as well as document loads. Do not
run this comparison across the boundary as though it were a trend.

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
Cookie Settings, and confirm that no QUEUED event from the refused period is
transmitted.**

> **Word that assertion carefully.** An earlier version of this step said "confirm
> nothing mentioning the refused search terms appears", which is wrong and would
> have produced a false failure. On acceptance, gtag.js initialises and GA4
> **enhanced measurement** fires `view_search_results` off the *current URL*. If
> you are standing on `/search?q=cerave` when you click Save, `cerave` appears in
> a `collect` request immediately, and it is not a replay.
>
> The correct assertion is about the **queue**, not about the terms:
>
> | Must NOT appear | Because |
> |---|---|
> | `en=search` for any term browsed while refused | that is the custom event, and it only fires from the mount effect that was queued |
> | `en=view_item` from a product page visited while refused | same, mount effect |
> | any event carrying a term from a page you have since NAVIGATED AWAY from | a replay would resurrect it; enhanced measurement cannot, it only reads the current page |
>
> | May legitimately appear | Because |
> |---|---|
> | `view_search_results` for the CURRENT url | enhanced measurement, fired by gtag.js on init, reads `?q=` |
> | `page_view`, `scroll`, `user_engagement` | enhanced measurement on the current page |
>
> **Verified 29 July, Run A step 5 PASSED on this reading.** Three collect
> requests after Save: `view_search_results` with `search_term=cerave` (the URL
> the tester was on), `page_view`, and `scroll`. No `en=search` for either term,
> no `view_item` from the product page browsed while refused, and the earlier
> term `abib` appeared nowhere at all. Console confirmed `resolved: true`,
> `granted: true`, `which: pusher`, `dropped: 0`, with steps 3 and 4 having shown
> `dataLayer` at 0, `which: noop`, and zero collect requests throughout.
>
> **The discard holds.**

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

### DONE 29 July, and the warning above turned out to apply to the calendar

The fix did land at once, so the gradual-partial-fix case was avoided in code.
**It arrived anyway, through the week bucket.** 29 July is a Wednesday and weekly
rows are ISO-Monday buckets, so `week_start = 2026-07-27` holds roughly 2.6 days
of broken data and 4.4 days of fixed data. **A blended week is arithmetically a
partial fix**, and it would walk comparison-view to outbound-click down from 522%
to exactly the plausible-looking value this section warns about.

So the un-suppression is **date-gated, not lifted**: the five metrics render only
for weeks whose entire span is after the boundary, first `week_start`
**2026-08-03**. The binding predicate, the two predicates that look right and are
not, and the single-list rule are in section 4.1 of the build brief. The 27 July
week stays absent.

### A seventh affected metric, found during the un-suppression

The fix also moves `consent_ratio` (GA4 `retailer_click` over server-side
`outbound_clicks`), which nobody had it on their list, and the build brief argued
explicitly that it did **not**.

The brief's argument was that the stub does not recover refusing visitors, so the
numerator keeps its meaning. True, and it reasons about the wrong population.
Before the fix `window.gtag` existed only inside `loadAnalytics()`, which runs
**only on a grant**, so the click of a visitor who had **not yet answered** the
banner hit the `typeof gtag !== 'function'` guard and was dropped, while
`sendOutboundBeacon` fired regardless. Numerator lost it, denominator kept it.
After the fix it queues and replays on a later acceptance.

The replay only survives because every outbound path leaves the page alive:
`ClickOutLink` defaults to `target = '_blank'` (`components/ClickOutLink.tsx:34`,
a default parameter, which is why no call site passes it) and the optimiser uses
`window.open(..., '_blank')` (`app/app/RoutineBuilder.tsx:663`). Same-tab
navigation would have killed the queue on unload and made the brief right by
accident.

**So the consent ratio steps UP at the boundary, and that is the dangerous
direction:** a rising consent rate reads as good news. It is also the cross-check
that separates "`view_item` is broken" from "consent is low", so an unrecorded
step in it would have flattered the five metrics in the same week they returned.
Recorded by adding `consent_ratio` to `platform_changes` id 17's
`metrics_affected`, migration `20260729220000`, applied to production.

**The general lesson, which is the same one this ticket keeps teaching:** the
affected-metric list was written from the events the fix was *aimed at*. It
missed the metric the fix changed as a side effect. Enumerate by what the change
touches, not by what it intends, exactly as the call-site audit above had to
replace the module-scoped one.

## GPC: the fifth consent path. VERIFIED 30 July 2026, and the precedence decided.

**Both branches tested in a browser. The analysis below is kept because it is
still the argument for the ordering comment now in
`public/fmb-cookie-banner.js`, not because anything here is outstanding.**

| Path | Observed |
|---|---|
| GPC alone, no stored consent | no banner, resolved true, granted **false**, `which` = noop, dataLayer **0** |
| Stored accept, then GPC on | granted **true**, `which` = pusher, dataLayer **5**, analytics running |

GPC is handled at `public/fmb-cookie-banner.js` and routes through the SAME
`applyConsent()` as banner-refuse, which calls `FMBGtag.resolve(false,
loadAnalytics)`. The discard mechanism is shared and was already covered. **What
needed testing was never the discard, it was the two things GPC does that no
other path does.** Both are now settled.

**1. Precedence: a STORED ACCEPT BEATS GPC. DECIDED — keep it, 30 July 2026.**
`init()` checks `getConsent()` first and only falls through to `hasGPC()` when
there is no stored record, so a visitor who accepted on an earlier visit and has
since turned GPC on stays tracked and sees no banner. **Confirmed by test, and
adopted deliberately: an explicit acceptance is a more specific act than a
browser-wide default, so it wins.** The visitor made a choice about this site;
GPC expresses a preference about sites in general.

**Do NOT swap the order in `init()`.** The alternative — testing `hasGPC()` first,
letting GPC override a prior explicit acceptance — was considered and not
adopted. It is a defensible reading, which is exactly why the rejection is
recorded rather than left implicit.

**This was the finding that mattered most, and not because of the outcome.** The
behaviour was correct before anyone decided it; it was an emergent property of
which line came first, and a reader could not tell a decision from an accident.
It now carries a comment at the ordering site stating the choice, the reasoning
and the rejected alternative. Same treatment as the `ClickOutLink` `target`
default, and for the same reason: a load-bearing default that looks incidental
gets "simplified" by the next reader.

**If this becomes a compliance question, revisit it.** Some regimes may treat GPC
as a binding signal that supersedes an earlier acceptance rather than as a
default an acceptance can override. That would make swapping the order correct.
It is not a reason to swap it now, and the comment in the source says so too.

**2. GPC persists as a durable stored REFUSAL after the signal goes away.** The
branch calls `setConsent({ analytics: false })` before `applyConsent(false)`, so
it writes a refusal to localStorage. On a later visit with GPC switched OFF, the
stored refusal wins at step 1 above and the banner never opens. The visitor can
still change it through Cookie Settings, and refusal is the safe direction, so
this is defensible. It is not obvious, and it means GPC's effect outlives the
GPC signal.

### The test that was run

The plan that stood here specified five steps. The two that carried the real
risk were run and both passed; they are the two recorded in the table above.

**Traps that applied and were respected:** test a COLD load, because client-side
navigation is the path that already works and is a false pass; and read DebugView
rather than same-day GA4 totals, because the 24-48h processing lag is how the
original bug survived from 25 July.

**Consent coverage is now 5 of 5, stated as verified rather than routed.** No
path in this file is assumed to share `resolveConsent` — each was exercised. The
un-suppressed series is fully characterised on this axis, and the "GPC untested"
label is removed everywhere it appeared rather than struck through, per
convention 9 in `supabase/migrations/README.md`.
