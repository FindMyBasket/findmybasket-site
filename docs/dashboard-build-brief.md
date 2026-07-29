# Performance Measurement Dashboard: Build Brief

**Version:** v3, 28 July 2026
**Status:** Blocking prerequisite (section 2.1) MET as of 28 July. Steps 2, 3 and 7 are unblocked.
**Supersedes:** all earlier versions and all amendment documents. If you hold another copy, discard it.

> This file is the canonical brief. It lives in the repo deliberately: earlier versions
> were passed around as Word documents, which is how a brief naming events that did not
> exist survived several review passes. Amend this file, do not fork it.

## Progress log

Appended as steps complete, so the brief and its state never diverge.

| Step | Status | Evidence |
|---|---|---|
| 1 | COMPLETE | Findings in section 3.1. Do not re-run. |
| 2 | COMPLETE, approved 28 Jul | Schema proposed; eleven tables, not ten. |
| 3 | COMPLETE, applied 28 Jul | `supabase/migrations/20260728180000_dashboard_schema.sql`. All eleven verified `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` by reading `relacl`. |
| 7 | COMPLETE, approved 28 Jul | Queries confirmed; three premises corrected, see "Corrections from Step 7" below. |
| 4 | DISCOVERY COMPLETE, 29 Jul. Puller NOT built. | Diagnostic dispatched, design holds. Results in "Step 4 discovery results" below. By-network start **2026-06-24** recorded as `platform_changes` id 7 (`20260729140000`). `outbound_clicks_other` APPLIED (`20260729120000`). Google Signals disabled, no thresholding. **Open bug: the GA4 `search` event never fires**, and `view_item` undercounts for the same reason. No puller, no schedule. |
| 5, 6, 8-15 | NOT STARTED | |

## Corrections from Step 7, adopted 28 July

These override the step text further down. The step text is left intact so the
original reasoning is still legible.

1. **`cron_window_missed` is not a boolean and does not read `import_run_state`.**
   That table is a transient scratchpad: the importer deletes its own rows on
   successful completion (18,167 inserts against 18,167 deletes, 0 rows resident).
   A successful run and a never-started run both leave nothing, so the specified
   detector could not distinguish them. Replaced by `cron_window_state`, a
   five-value column computed from `cron.job` + `cron.job_run_details` +
   `retailer_import_config`. See the column comment on
   `metrics_retailer_quality_weekly.cron_window_state`.

2. **`review_queue` keys on `(product_id, retailer_id, reason, week_start)`.**
   `retailer_prices.id` survives import cycles but not merges, which delete rows.
   `retailer_price_id` is kept as a drill-through column with **no foreign key**;
   see its column comment before considering adding one.

3. **The two search indicators live in leading indicators, not the quality panel.**
   Section 7 was right and Step 7 contradicted it. Zero-result rate is
   Supabase-only. Search-to-comparison needs GA4 and must render "not measured"
   until then: `session_id` is 100% NULL in both `search_events` (0 of 479) and
   `outbound_clicks` (0 of 261), so there is no server-side proxy and none should
   be invented.

4. **Eleven tables, not ten.** Section 9 announces ten and lists eleven.

5. **`platform_changes.changed_at` is nullable, with `status IN ('expected','occurred')`**
   and a CHECK forbidding occurred-without-a-date. Three of the five boundaries
   have no date yet and a fourth is not yet established, so a NOT NULL column
   could only have held them by inventing dates. Seeded with four; the GA4
   registration boundary is added by Step 4 once its date is known.

## Corrections from Step 4 discovery, adopted 29 July

Same convention as the Step 7 block: these override the step text further down,
and the step text is left intact so the original reasoning stays legible.

1. **`G-Q3J7LSJFLQ` is a measurement id, not a property id, and the Data API
   cannot accept it.** It is the gtag config target in
   `public/fmb-cookie-banner.js:25`. `runReport` addresses
   `properties/{numeric}`. **The numeric property id is `415465396`.** Every
   Data API and Admin API call uses `properties/415465396`. The measurement id
   is never passed to either API. v3 carried the measurement id under the word
   "property", which would have failed the first query in Step 4; the two are
   now named separately everywhere in this file, and `scripts/ga4-diag.mjs`
   rejects a `G-` string rather than sending it.

2. **The week-semantics rationale in v3 was wrong, not only imprecise.** v3
   recommended ISO Monday weeks "since it matches GA4's own week dimension".
   **GA4's `week` dimension starts on SUNDAY.** The Monday-based one is
   `isoWeek` / `yearIsoWeek`. The conclusion survives, the reasoning does not,
   and the reasoning is the dangerous half: a reader following it would reach
   for `week`, shift every bucket by a day, and silently break the AWIN
   reconciliation the Monday choice exists to serve.

   **Adopted: pull the `date` dimension and bucket to Monday in code. Do not use
   any GA4 week dimension.** It is re-derivable from the raw days, auditable,
   and immune to the ambiguity. Verified equal to Postgres
   `date_trunc('week', ...)` across a full week boundary, Sunday 26 July through
   Monday 3 August, before the workflow was committed.

3. **`metrics_ga4_weekly` needs a fourth by-network column.**
   `AffiliateNetwork` in `lib/analytics.ts:37` has five values: `awin`,
   `rakuten`, `amazon`, `ebay`, `other`. The table as built has three columns,
   so the parts could never sum to the total, for a reason entirely separate
   from the pre-registration boundary in section 4.1. eBay clicks are real, not
   hypothetical: 6 rows carry `source='ebay_search'` in the server-side
   `outbound_clicks` table.

   **Adopted: add `outbound_clicks_other integer NULL`, catching `ebay` and
   `other`, so four columns cover all five values and sum exactly.** A column
   comment was considered and rejected: a metric that cannot sum to its own
   total is a permanent explanation burden, and the table is empty today, so the
   migration is trivial now and awkward once there is history.

   > **APPLIED 29 July**, `supabase/migrations/20260729120000_ga4_weekly_outbound_clicks_other.sql`.
   > Independent of every discovery outcome: whatever 2.3 returns, the enum has
   > five values and the table had three columns. Dry-run twice inside a rolled-back
   > transaction, then applied twice. Verified by reading the catalogue:
   > `outbound_clicks_other integer NULL`, four by-network columns present,
   > `relacl` still `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`,
   > RLS unchanged, 0 rows.
   >
   > Both assertions were proved to bite before applying, per convention 6: the
   > column check raised with the column absent, and the privilege check raised
   > against a deliberately re-opened table, both inside rolled-back
   > transactions. A guard that has never been seen to fail is not known to work.

4. **GA4 systematically undercounts against the server-side pipeline, and the
   ratio is a metric, not noise.** `public/fmb-cookie-banner.js:75` does not
   load gtag.js at all until cookie consent is given, and every emitter in
   `lib/analytics.ts` returns early when `window.gtag` is absent. So GA4 sees
   consenting visitors only, while `lib/events.ts` writes `outbound_clicks`
   server-side regardless. The gap is a consent-plus-blocker rate.

   **Adopted: surface it as its own indicator at Step 6, not only as the section
   3.5 sanity check.** It also means every GA4 figure on the dashboard is a
   consenting-visitor figure and should be labelled as one. This is the reading
   that separates the two causes of a low `view_item` count: if `page_view` is
   healthy and `view_item` is zero, that is a bug; if both are proportionally
   low, that is consent. Neither figure means anything reported alone.

## Step 4 discovery results, 29 July

First dispatch of `ga4-diag.yml`. **The design holds.** Property 415465396.

### Settled, and safe to build on

| Question | Result |
|---|---|
| Google Signals (2.3) | **Disabled.** No thresholding notice in either report. The risk most likely to invalidate the design is absent, so no sixth `platform_changes` row is needed for it. |
| By-network start (2.5) | **2026-06-24**, established empirically. Recorded as `platform_changes` id 7, status `occurred`, migration `20260729140000`. |
| Retention guard | **Cleared it properly.** Events exist from 2026-04-05, well before the start, and with 14-month retention the start sits 391 days inside the window. A real dimension boundary, not a retention edge. |
| Network values | `amazon`, `awin`, `ebay`, `rakuten`. No `other` yet and no stray casing, so the four columns cover everything observed. |
| Time zone | `Etc/GMT`, which is UTC. See 8.1: no offset exists, nothing to fix. |
| BigQuery export (2.4) | **Off.** With 14-month retention this is no longer urgent, but it is the only thing that makes history permanent and it is not retroactive. Operator's call, not a blocker. |

### The consent ratio, now measured

GA4 `retailer_click` against the server-side `outbound_clicks` table, same ISO
weeks. This is the Step 6 indicator, seeded:

| Week (Mon) | GA4 | Server-side | Ratio |
|---|---|---|---|
| 29 Jun | 36 | 39 | 92% |
| 6 Jul | 13 | 21 | 62% |
| 13 Jul | 47 | 58 | 81% |
| 20 Jul | 85 | 128 | 66% |

Consent plus blockers costs roughly a fifth to a third of clicks, and it is not
stable week to week, which is the argument for showing it rather than applying a
fixed correction factor.

> **The 29 June week is not comparable and should not anchor the range.**
> Server-side logging shipped 2026-07-01 (`2b54593`, first row 11:13:42 UTC),
> so that week is 7 GA4 days against roughly 4.5 server-side days. The
> denominator is short, which inflates the ratio. Across the three clean weeks
> the spread is 62% to 81%, so the cost is nearer a fifth to two fifths than the
> 8% the first week implies.
>
> **Recommended, not yet done:** a sixth `platform_changes` row for the
> server-side event-logging start on 2026-07-01, since it bounds every
> cross-check that uses `outbound_clicks` or `search_events` as a denominator,
> and this is the second time it has needed explaining. Gated; not inserted
> without approval.

### Open bug, reported not fixed

**The GA4 `search` event is broken. It is not low volume.** GA4 returned 0 for
the 7-day window while server-side `search_events` recorded 41 rows in the same
window, 18 in the last two days, most recent 07:48 on 29 July. Consent cannot
explain it: consent scales a count down rather than zeroing one event while
`retailer_click` keeps firing through the same gate.

**Diagnosed cause, from the code:** `app/layout.tsx:41` loads the consent banner
with `strategy="afterInteractive"`, which runs *after* React hydration.
`window.gtag` is defined by that banner (`fmb-cookie-banner.js:79`), and every
tracker in `lib/analytics.ts` returns early when `gtag` is not yet a function. So
a mount effect that fires during hydration finds no `gtag` and drops its event
silently.

That predicts the exact pattern observed:

| Event | Fires from | Observed | Why |
|---|---|---|---|
| `retailer_click` | user click, seconds after load | healthy (47) | banner has long since defined `gtag` |
| `view_item` | mount effect | low but non-zero (9) | survives only on client-side navigation, where `gtag` already exists from the previous page |
| `search` | mount effect | **exactly 0** | every entry to `/search` is a full-document GET (`public/index.html:281` and `app/search/page.tsx:67`; there is no `router.push` to `/search` anywhere), so the effect always loses the race |

**Consequence for this build, beyond the search indicators.** `view_item` is
subject to the same race, so it is not merely young, it is *systematically
undercounting* by whatever share of product views are cold loads. For a
comparison site taking search-engine landings straight onto product pages that
share is likely the majority. **Qualified sessions and commission per qualified
session are therefore understated by an unknown factor, not just sparse.** Label
them accordingly until this is fixed.

**Impact on the specified indicators.** Zero-result search rate is Supabase-only
and unaffected. Search-to-comparison needs GA4, and with `session_id` 100% NULL
server-side there is no proxy, so that indicator **cannot be built at all** until
the event fires. It must render "not measured" and must not be approximated.

**Ticket raised: `docs/ticket-gtag-hydration-race.md`.** It carries the full
call-site audit, three verification traps, and four candidate remedies (including
Google Consent Mode v2, which is coupled to the Step 6 consent-ratio indicator
and must be decided together with it). Findings worth surfacing here:

> **The audit method changed, and that is the bigger lesson than the bug.** The
> first pass was scoped to `lib/analytics.ts` and reported complete. Re-run by
> call site, meaning every `gtag(` and every `dataLayer.push` in the repository,
> it found **fifteen distinct GA4 events, not seven**. Scoping a search to the
> module that *should* contain a thing can only ever find the instances already
> where they belong. It is the same shape as a repo grep for a credential, which
> answers "what references this" and never "does this exist".
>
> It happened not to change which events are affected. That is luck, not
> vindication: the method was wrong either way.

- **`add_to_cart` is safe**, since it fires from a click handler
  (`SaveToRoutineButton.tsx:33`).
- **`basket_optimised` is affected on one path only.** The `user_action` path is
  a click and is safe; the `auto_shared_link` path fires from a mount effect via
  `setTimeout(..., 300)` at `RoutineBuilder.tsx:180`. The delay probably wins the
  race most of the time, which makes it the worst kind of affected path:
  intermittent and skewed toward slow connections.
- **`load_routine_from_url` was on nobody's list** and is likely a total loss.
  `RoutineBuilder.tsx:172` fires it inline with the same guard, inside the same
  mount effect, and it only ever fires on emailed `/app?routine=...` arrivals,
  which are always cold loads. It is not defined in `lib/analytics.ts`, which is
  why auditing that module alone would have missed it.

**Consequence for the headline tiles: both qualified-sessions tiles are
suppressed, not shown as "not measured". See section 4.1.**

## 0. Corrections carried in this version

- v1 named two GA4 events that do not exist: `outbound_click` and `view_comparison`.
  The real names are in section 3.1. Likely origin of the error: `outbound_clicks` is a
  real Supabase table, written server-side by `lib/events.ts` via service role and keyed
  on `fmb_sid`. It is a different pipeline from GA4, and the plural table name appears to
  have leaked into the brief as a singular GA4 event. `view_comparison` looks like the
  same class of slip.
- Step 1 is COMPLETE. Its findings are recorded in section 3.1. Do not re-run it.
- v1 placed Steps 7, 8 and 9 ahead of the schema on the grounds that they had no GA4
  dependency. Wrong: Step 8 creates `review_queue` and Step 9 writes to it, so they sat
  behind the same default-privileges fix as Steps 2 and 3.
- The custom dimensions `affiliate_network`, `retailer_name` and `brand_slug` were
  registered before 27 July, so the by-network series has more history than v1 assumed.

---

## 1. Purpose and working discipline

Build a live performance dashboard as a new authenticated route in the Next.js app, reading from Supabase, plus the weekly cron pullers that feed it. Four layers: revenue KPIs, funnel leading indicators, a data-quality panel with a calibration loop, and Brand Spotlight analysis with a live view and a client-facing PDF export.

Discover-first throughout. Every step investigates and reports before any edit. All mutating steps are gated and require explicit approval. Dry-run SELECT before any UPDATE. Stop and report before anything irreversible. Do not run two large operations at once.

**Challenge this brief. It has been wrong before. If a step rests on a premise you can check, check it, and report a contradiction rather than working around it.**

Environment: Supabase project crtrjoescntlcjiwdtrt. **GA4 property id 415465396**, used as `properties/415465396` for every Data API and Admin API call. **GA4 measurement id G-Q3J7LSJFLQ**, used only by gtag config in `public/fmb-cookie-banner.js`; it is never passed to `runReport`. AWIN publisher 2841268. Rakuten SID 4684964. Amazon Associates tag findmybasket-21. Brand kit blue #4A90D9, navy #1A2E4A.

## 2. Two blocking prerequisites

### 2.1 Default privileges must be fixed before any table is created

This build creates ten new tables. None currently exist.

In this project, default privileges grant broadly on creation. That is how brand_search_index shipped writable by anyone holding the public anon key, and why 57 existing tables carry anon INSERT, UPDATE and DELETE. If the schema migration runs first, this build adds ten new publicly writable tables, including review_queue and every metrics table the dashboard depends on.

**The ALTER DEFAULT PRIVILEGES fix from the outstanding security remediation must land BEFORE the schema migration in Step 3.**

Every new table must REVOKE before it GRANTs, and be verified by reading pg_class.relacl or pg_proc.proacl directly. An additive GRANT does not restrict, and has_table_privilege rolls up the PUBLIC grant, so both report success on a table that is still open. Include PUBLIC in every REVOKE.

> **Status 28 July:** MET, `5dafe2b` / PR #137. The "57 existing tables" figure is now
> zero (PRs #137-#139). Note the fix does NOT protect functions: Postgres re-merges
> `acldefault()` on creation, so every new function still needs its own
> `REVOKE ... FROM PUBLIC`. See `supabase/migrations/README.md`.

### 2.2 The dashboard route must be authenticated

The page renders commission by advertiser, tracked sales, revenue per qualified session, and per-retailer conversion. Commission rates are internal only and are never disclosed externally. A public route would publish your commercial terms with every affiliate partner.

**Authenticate the whole route, not only the review controls. An unauthenticated request must return no data.**

## 3. Credential and configuration status

Single statement of fact as at 27 July 2026. Do not treat any other source as current.

| **GA4 prerequisite** | **Status** |
|---|---|
| 1. Clickout parameters confirmed | DONE via Step 1. See 3.1 for real names. |
| 2. Custom dimensions registered | REGISTERED 27 July, but names MUST be verified. See 3.2. |
| 3. Comparison-view event exists | DONE. It is view_item, not view_comparison. See 3.1. |
| 4. Key events marked | OPEN. Mark view_item and retailer_click. |
| 5. Data API enabled, service account with Viewer | DONE |

### 3.1 The real event and parameter names

v1 of this brief named events that do not exist. Corrected:

| **v1 called it** | **Actually is** | **Notes** |
|---|---|---|
| outbound_click | retailer_click | lib/analytics.ts:138 |
| network | affiliate_network | |
| retailer | retailer_name | retailer_id also present |
| brand | brand_slug | brand-hub clicks only |
| product_id | item_id | |
| view_comparison | view_item | components/ProductViewTracker.tsx |

**A second clickout event, affiliate_clickout at lib/analytics.ts:13, fires on the same user action as retailer_click. Any outbound-click total must use retailer_click only. Summing both double-counts, and only retailer_click carries affiliate_network.**

Do not create a view_comparison event. The product page is the comparison page and view_item already carries items, value and num_retailers. Qualified sessions are sessions containing view_item. A stricter definition using num_retailers >= 2 is better in principle but per-event metric filtering is awkward in the Data API, so keep it as a secondary metric, not the headline.

The outbound_clicks table in Supabase, written server-side by lib/events.ts, is a separate pipeline from GA4. Use it as a consent-undercount cross-check. Never sum it with GA4 clicks.

> **Measured 29 July, 267 rows, first click 1 Jul 11:15 UTC, last 29 Jul 08:17 UTC.**
> ISO Monday weeks, network derived from `awin_mid` and `source`. `session_id` is
> NULL on all 267 rows, confirming correction 3 above.
>
> | Week (Mon) | awin | amazon | ebay | rakuten/other | total |
> |---|---|---|---|---|---|
> | 29 Jun | 29 | 7 | 1 | 2 | 39 |
> | 6 Jul | 12 | 5 | 2 | 2 | 21 |
> | 13 Jul | 43 | 10 | 2 | 3 | 58 |
> | 20 Jul | 120 | 7 | 1 | 0 | 128 |
> | 27 Jul (partial) | 17 | 4 | 0 | 0 | 21 |
>
> **"Roughly 50 outbound clicks a week" is not the shape of this data and should
> not be used as an expectation.** The weekly figures are 39, 21, 58, 128, so the
> week of 20 July is more than double any prior week. Anyone reading the first GA4
> pull needs this in front of them, or a normal week after a spike reads as a
> collapse. Note also that these are server-side totals; the GA4 figures will sit
> BELOW them by the consent-plus-blocker rate, per Step 4 correction 4.

### 3.2 Dimension registration, resolved

affiliate_network, retailer_name and brand_slug were registered some time before 27 July and are collecting correctly. The by-network series therefore has more history than v2 of this brief assumed.

Three further dimensions were registered on 27 July under the v1 shorthand: network, retailer and brand. No event sends parameters by those names, so they will never collect anything. They are inert, not harmful, but they should be archived so nobody later assumes network works and builds on it.

**Discovery item for Step 4: establish the true start of the by-network series empirically. Query backwards and find the earliest date on which customEvent:affiliate_network returns non-null values. That date, not 27 July, is the boundary to record in platform_changes.**

GA4 is installed and firing on production, confirmed by live network inspection: the page_view beacon reaches Google with measurement ID G-Q3J7LSJFLQ and debug mode works. A single intermittent 503 was seen on one collection POST. Not a blocker, but note it if event volumes later look lower than expected.

Credentials in secrets. Confirm which context you read from, Actions or Codespaces. The GA4 service-account JSON is in GOOGLE_APPLICATION_CREDENTIALS_JSON as raw JSON, not a file path.

**AWIN credential naming must be resolved before Step 5. Two names are in circulation, AWIN_API_KEY and AWIN_OAUTH_TOKEN. Establish which secret holds the OAuth2 reporting token for api.awin.com, and confirm whether AWIN_API_KEY already exists as a separate feed-pipeline credential. Do not conflate them. Report before building the puller.**

> **RESOLVED 28 July. Two distinct credentials, do not conflate them.**
>
> **`AWIN_API_KEY` is the FEED credential. Never overwrite it.** Eight live
> references, all on the feed-download path against `productdata.awin.com`, where
> the key is embedded in the URL path rather than sent as a header:
> `.github/workflows/refresh-debenhams.yml:45`, `.github/workflows/feed-diag.yml:77`,
> `supabase/functions/import-awin-feed/index.ts:484`,
> `supabase/functions/awin-feed-count/index.ts:77`. The Debenhams workflow comment
> confirms the GitHub secret and the edge-function secret hold the same value.
> Overwriting it with a reporting token breaks nightly imports.
>
> **`AWIN_OAUTH_TOKEN` exists in the secret store, has no reader yet, and is
> intended for the api.awin.com reporting integration in Step 5.** Created ahead of
> that step. It has zero repo references, which is expected and is NOT evidence
> about whether it exists: secrets live in the GitHub Actions and Supabase secret
> stores, so a repo search only ever shows what *references* a credential. Confirm
> existence with the operator or the platform UI, never by grepping.
>
> **Step 5 is greenfield on this front:** nothing in the codebase calls
> `api.awin.com` at all today, so there is no existing auth pattern to follow and
> none to break.
>
> Incidental, and now a separate ticket: `scripts/secret-divergence-check.sh:65`
> lists `AWIN_API_KEY` in `SKEW_IGNORE`, so nothing verifies its two copies still
> match. Establish why it was excluded before removing it, then rotate.

AWIN rate limit is 20 calls per minute per user, so batch per-advertiser pulls sensibly. Allow up to 10 minutes for a newly generated token to propagate if the first call returns empty.

### 3.3 Establishing the by-network start date

The dimensions predate 27 July, so the by-network series begins on their registration date, not on the deploy date of the events. Establish it empirically: query backwards and find the earliest date on which `customEvent:affiliate_network` returns non-null values.

Two cautions on that discovery, both to be tested rather than assumed:

- GA4 does not apply a dimension definition retroactively to data already collected, so the series can start later than the events began firing. Registration was manual with no backfill.
- Check whether BigQuery export is enabled on the property. Raw event parameters survive in BigQuery even when standard reports and the Data API cannot surface them, so history that appears lost through the Data API may be recoverable there. Treat this as a hypothesis to test, not a finding.
- **Separate the registration boundary from the retention edge before recording anything.** A first-non-null date only means "the dimension started collecting here" if the property holds data from before it. GA4 standard retention is 2 or 14 months, so if the dimensions were registered before the retention window opens, the empirical scan returns the retention edge and nothing distinguishes it from a registration boundary. That would be a permanently wrong marker on every trend chart, arrived at by a method that looked rigorous.

  `scripts/ga4-diag.mjs` **reports the declared `eventDataRetention` setting alongside the observed earliest day and the by-network start, so the three can be compared rather than one inferred from another.** It refuses to call the result a boundary when the by-network start coincides with the earliest data of any kind, warns when the start sits within a week of the declared retention edge or beyond it, and flags when the scan window rather than the property is the binding constraint. Widen `HISTORY_START` and re-run in any of those cases. The retention case is the one BigQuery export would resolve, per 2.4, since raw event parameters survive there after the Data API window closes.

## 4. Known data boundaries

Five dated changes affect the series this dashboard records. Three have happened, two are expected. Recording them in prose and relying on a future reader to remember them is not a plan: each will otherwise be rediscovered as an unexplained step and investigated as a bug.

| **Boundary** | **Date** | **Affects** |
|---|---|---|
| Savings and catalogue baseline reset | 27 Jul 2026, 11:06 UTC | savings, comparison depth |
| GA4 custom dimensions registered | 27 Jul 2026 | outbound clicks by network |
| Browse search total_count cutover | pending | search_events.result_count |
| AWIN product_GTIN importer fix, if confirmed | after 4 Aug | matching, comparison depth, EAN coverage |
| Niche Beauty retailer go-live | after 4 Aug | catalogue size, comparison depth, brands |

**Required: create a platform_changes table, one row per dated change with a description and the metrics affected, and render its entries as vertical markers on every trend chart. Seed with the five above. This makes the sixth change cost nothing.**

### 4.0 The boundary class most likely to be missed

A general rule, arrived at from the server-side logging boundary but not specific
to it. Record it here because the next instance will not look like that one.

**A boundary that makes a metric look BETTER rather than emptier is the kind
nobody questions.** Missing data announces itself: a gap in a chart, a zero, a
count that fell. It gets investigated. A boundary that improves a figure gets
congratulated.

**The common mechanism is a short denominator.** When a ratio's denominator
starts collecting later than its numerator, or stops early, or covers fewer days
than the period it is charted against, the ratio does not read as incomplete. It
reads as unusually good performance. Nothing about the number looks wrong.

The worked example is in section 3.1: the ISO week beginning 2026-06-29 shows a
92% consent ratio against 62%, 81% and 66% for the three complete weeks that
follow. It is not a good week. It is 7 GA4 days measured against roughly 4.5
server-side days, because `lib/events.ts` shipped on 1 July.

**So, whenever a metric is a ratio, record a boundary for the start of the
DENOMINATOR as well as the numerator.** Both are dated changes even when only one
of them is a change to the product. The two rarely start on the same day, and the
window where they disagree is exactly the window that will be quoted approvingly.

**Corollary for reading any trend on this dashboard: an unexplained improvement
deserves the same scrutiny as an unexplained drop.** The platform_changes markers
exist to make that scrutiny quick, and they only work if boundaries are recorded
for the flattering direction too.

### 4.1 What each boundary means in practice

Savings reset. dq_dashboard_log row 3, 27 July 11:06 UTC, is the reference: avg_saving_pct 17.23%, total_savings_pool £71,898.74, biggest_saving £184.50. Rows 1 and 2 are from 3 May and are not comparable. Anchor the savings trend to row 3 as its zero point. The earlier figures (avg 23.20%, pool £180,111) were inflated by dead Superdrug r12 rows and must never be quoted as a prior level or a regression.

GA4 dimensions are not retroactive, so the by-network breakdown begins on the registration date and cannot be extended earlier. That date predates 27 July and must be established empirically per 3.2. For every week before it, outbound_clicks_awin, _rakuten, _amazon and _other have no value while total outbound clicks does, so the four will not sum to the total. **After that date they must sum exactly**, which is what the fourth column exists to guarantee (Step 4 correction 3). A gap after the boundary is a defect, not the boundary showing through.

**Store NULL, not zero, for unmeasured periods, and render as "not measured". Writing zero records a measurement never taken as a measurement of nothing, and the distinction cannot be recovered later.**

~~**Qualified sessions has almost no history. view_item shipped in PR #129, merged 27 July as 974bcc0, and DebugView verification was never completed. So qualified sessions per week and commission per qualified session will be near-empty at launch. Ship both tiles showing "not measured" rather than holding them: the null-not-zero convention and the platform_changes markers already handle this, and holding them means changing the dashboard shape later.**~~

> **REVERSED 29 July, on the Step 4 discovery. Suppress both tiles entirely.**
>
> The decision above rested on `view_item` being *young*. It is not young, it is
> *biased*: the hydration race in `docs/ticket-gtag-hydration-race.md` drops the
> event on every cold page load, so `view_item` undercounts by the share of
> product views that arrive directly. For a site taking search-engine landings
> straight onto product pages, that is likely most of them.
>
> **"Not measured" and "measured wrong by an unknown factor" call for opposite
> handling.** A missing number invites nobody to act on it. A present number
> biased in an unknown direction invites exactly that, and it would sit on two of
> the four headline tiles. The null-not-zero convention does not help here,
> because the value is neither null nor zero, it is wrong.
>
> **So: everything derived from `view_item` is ABSENT from the page until the
> race is fixed.** Not "not measured", not a caveat in a tooltip.
>
> **Scope corrected 29 July: five metrics, not two.** The first version of this
> reversal suppressed the two headline tiles and stopped there, which was
> under-scoped: every metric derived from `view_item` carries the same
> contamination.
>
> | Metric | Where | Direction of error |
> |---|---|---|
> | `qualified_sessions` | headline tile + leading indicator | depressed |
> | Commission per qualified session | headline tile | inflated (broken denominator) |
> | `comparison_views` | column and tile | depressed |
> | Session to comparison-view rate | leading indicator | depressed |
> | Comparison-view to outbound-click rate | leading indicator | **inflated, badly** |
>
> **The last one is the worst.** Its denominator is the broken event while its
> numerator, `retailer_click`, is healthy. On the last seven days it would read
> 47 over 9, which is **522%**.
>
> That absurdity is the only reason it is currently safe: nobody would believe
> it. **But it is not stable, and that is the real argument for suppressing
> rather than caveating.** As the cold-load share shifts, or if a partial fix
> lands, the ratio drifts down through entirely plausible territory. A number
> that reads 522% gets questioned. The same broken number reading 85% does not,
> and there is nothing on the page that would distinguish it from a real
> improvement.
>
> **Worth stating plainly rather than leaving as five separate suppressions: the
> leading indicators, which exist to be the early-warning system, are themselves
> built on the broken event.** Three of the five are leading indicators. The
> panel meant to catch a problem early is, until this is fixed, the part of the
> dashboard least able to.
>
> **Still write the column. Still pull the data.** Suppress the DISPLAY only, so
> the series accumulates and becomes readable from whatever date the fix lands.
> `metrics_ga4_weekly.qualified_sessions` and `.comparison_views` keep being
> written by the puller exactly as specified; nothing about the schema or the
> NULL-not-zero convention changes. What changes is that the dashboard does not
> render them.
>
> Also corrected while checking this: `974bcc0` landed on main on **25 July at
> 18:00 +0100**, not 27 July. Third date error of the week, and the reason the
> diagnostic derives its active window from the data rather than from any recorded
> date.
>
> **Sequence to unblock, in order:**
> 1. Fix the gtag race under its own ticket.
> 2. Record the fix as a `platform_changes` boundary, `status = 'occurred'`.
> 3. Only then is the qualified-sessions series trustworthy, and only from that
>    date forward. Comparing across the fix would show the correction as a
>    traffic increase.

Search cutover. The browse search recall fix changes total_count for 19 of the 127 distinct queries in search_events, all currently returning fewer than 3 results. total_count writes to search_events.result_count, accumulating since 1 July. Rows with result_count < 3 before the cutover are not comparable with the same rows after it. Record the cutover timestamp when it deploys.

Catalogue baseline. The early-August cluster moves exactly the metrics this dashboard records. Build the panel now and let it record, but do not treat pre-August catalogue figures as a baseline to compare against.

## 5. Current-state constraints

- Read catalogue metrics through the view. retailer_prices_live exists with security_invoker=true, joining retailer_prices to active retailers only. Every metric touching catalogue, comparison depth or savings reads through it, never retailer_prices directly.
- Superdrug r12 is retired. Its Rakuten feed died 19 July. 29,547 rows retained, all in_stock=false. The live view already excludes them. A pre-19-July figure compared to a current one shows an apparent drop that is the correction landing, not a regression.
- Comparison depth has two honest figures. Roughly 11,888 root products only, or 12,433 including shade children and merged rows. Use the root figure for anything user-facing or partner-facing, including Spotlight client PDFs. Label every figure on screen with which definition it uses.
- brand_search_index exists, roughly 2,053 rows, refreshed when the catalogue watermark moves, with a brand_index_health view exposing catalogue brand count, index rows, the difference, last refresh time and how far behind it is. It is a derived cache and can drift silently.
- **GA4 event timestamps within a session are not exact for first-time visitors, by design.** From the hydration-race fix (`public/fmb-gtag-stub.js`), events fired before a consent decision are held in an in-memory queue and replayed once consent is granted. GA4 stamps them at replay time, not at the moment they occurred. For the common case, a returning visitor with stored consent, the difference is a few hundred milliseconds. For a first-time visitor who leaves the banner up and then accepts, every queued event lands at the moment of acceptance, so they appear simultaneous. **Event counts are correct; intra-session ordering and timing for that visitor class are not.** Anyone querying time-between-events, session duration or event sequence will meet this and should find the explanation here rather than treat it as a data fault. It is the accepted trade: counts correct with timing wrong for one visitor class beats counts wrong for everyone. A maximum of 50 events queue before a decision, after which further pre-consent events are dropped rather than transmitted.
- search_events contains 7 occurrences of the literal {search_term_string}, the homepage JSON-LD SearchAction template submitted verbatim, most likely by a crawler. Roughly 1.5 per cent of logged searches are not human. Filter this literal from every search metric. Fixing the markup is a separate ticket.

## 6. Build order

Step 1 is COMPLETE. Its findings are recorded in section 3.1.

**Correction to v1: Steps 7, 8 and 9 do NOT run ahead of the schema. Step 8 creates review_queue and Step 9 writes state to it, so they sit behind the same default-privileges fix as Steps 2 and 3. v1 checked only for a GA4 dependency and missed this.**

1. BLOCKED until ALTER DEFAULT PRIVILEGES lands: Steps 2 and 3 (schema), then 7, 8, 9 (quality panel and review queue). Run 2, 3 and 7 together once unblocked.
2. Available now, outside the agent: archive the three inert shorthand dimensions, mark view_item and retailer_click as key events, resolve the AWIN secret name.
3. Then: Steps 4, 5, 6 (GA4 and AWIN pullers, revenue tiles).
4. Last: Steps 10 to 13 (Brand Spotlight and client PDF). Optional Steps 14 and 15 (social pullers).

The browse-search cutover to fmb_resolve_product runs concurrently as separate agent work. It shares no critical path with this build and should land before the catalogue baseline is established. It is not specified here.

## 7. Measurement funnel and KPI framework

Funnel: GA4 sessions, comparison views, outbound affiliate clicks by network, tracked sales, commission.

Headline KPIs, four tiles

- Tracked AWIN clicks per week, as progress proxy toward the 200 tracked sales per month milestone.
- Click-to-sale rate across all networks, rolling 4-week, since weekly sales are sparse at current volume.
- Qualified sessions per week, meaning sessions reaching a comparison view.
- Commission per qualified session, the true unit economic.

Leading indicators

> **Three of the five below are suppressed at launch, because they derive from
> `view_item`, which the hydration race breaks. See section 4.1.** The
> early-warning panel is, until that ticket lands, the part of the dashboard
> least able to warn. Only outbound clicks by network and zero-result search rate
> render.

- Qualified sessions per week and trend. **SUPPRESSED, derives from view_item.**
- Session to comparison-view rate. **SUPPRESSED, derives from view_item.**
- Comparison-view to outbound-click rate. **SUPPRESSED, derives from view_item,
  and inflated rather than depressed because only its denominator is broken. It
  would currently read 522%.**
- Outbound clicks per week by network.
- Zero-result search rate and search-to-comparison rate. Search is a major entry path and is currently defective, for example "loreal revitalift" returns 1 result against a true 96. These belong here, not in the quality panel, and give the browse-search cutover a measurable before and after.

Lagging and milestone, monthly not weekly

- Tracked sales per week by network, commission per week by network, AOV.
- Milestone bar: trailing 4-week sales run-rate against 200 per month. Currently single-digit sales, so this is a maturity signal roughly 20 to 40 times off.

## 8. Data sources and automation

- GA4: fully automated. Analytics Data API v1, service account, weekly cron into Supabase.
- AWIN: fully automated. Publisher API, weekly by advertiser, pulling both pending and confirmed.
- Rakuten: semi-automated. API pull if reliable, else monthly CSV paste.
- Amazon: manual. No usable earnings API. Monthly CSV export from the Associates UI, upserted.
- Social: manual weekly paste, Pinterest primary. Optional pullers at Steps 14 and 15.

GA4 Data API query shapes, weekly runReport calls against `properties/415465396`: sessions by week; qualified sessions as sessions containing view_item; comparison views as eventCount filtered to view_item; outbound clicks as eventCount filtered to retailer_click with dimensions date and customEvent:affiliate_network. customEvent:network returns nothing and must not be used. The last query is what reconciles GA4 against the affiliate reports.

### 8.1 Week semantics, binding on every puller

`week_start` is the **ISO week start, Monday**, and the same definition binds
every puller in this build. Two pullers disagreeing here does not produce a
visible error, it produces tables that will not join.

**Pull the GA4 `date` dimension and bucket to Monday in code. Do not use GA4's
`week` dimension: it starts on SUNDAY.** See Step 4 correction 2 for why the
original rationale for this choice was wrong even though the choice was right.
`isoWeek` / `yearIsoWeek` are the Monday-based GA4 dimensions and are an
acceptable alternative, but bucketing from `date` is preferred because it stays
re-derivable from the raw days.

This matches Postgres `date_trunc('week', ...)`, which is already ISO Monday and
is how every server-side table here buckets, so the GA4 and Supabase pipelines
line up for the section 3.5 cross-check without a conversion step.

**Open item for the first diagnostic run: the GA4 `date` dimension is expressed
in the property's reporting time zone, while `date_trunc` on `outbound_clicks`
buckets in UTC.** If the property is not on UTC, events near midnight land on
different days in the two pipelines, and at a week edge in different weeks. The
diagnostic reports the property time zone for exactly this reason.

> **RESOLVED 29 July, and there is nothing to fix. The property reporting time
> zone is `Etc/GMT`, which is UTC.** Zero offset, no daylight saving, year round.
> GA4's `date` dimension and Postgres `date_trunc('week', ...)` therefore agree on
> every day boundary, always. Verified across the BST switch: `Etc/GMT` reads the
> same hour as `UTC` in both January and July, while `Europe/London` diverges by
> an hour in July.
>
> **No offset exists and none should be introduced.** An earlier draft of this
> section recorded a fix direction, "convert `outbound_clicks` to the property
> time zone before bucketing", which came from the diagnostic string-comparing the
> time zone against the literal `UTC` and reporting `Etc/GMT` as a mismatch. That
> was a false positive in the guard, now fixed to treat `Etc/GMT`, `Etc/UTC`,
> `GMT` and the other fixed zero-offset zones as equivalent.
>
> **The correction matters beyond the cosmetic.** Acting on that fix direction
> would be a no-op at best, and anyone reading "the property time zone" as
> `Europe/London` would *introduce* the BST offset that does not currently exist,
> turning a guard into the cause of the defect it was watching for. For the
> record, had the property been on `Europe/London` the scale would have been
> small: of 267 server-side clicks exactly 1 falls in the 23:00 UTC hour, so 1
> would land on a different day and 0 would cross a week boundary.
>
> **Keep the guard.** It is correct now and the property time zone is a setting
> that can be changed later, which is exactly when nobody would think to re-check
> it.

## 9. Supabase schema

Eleven tables. Apply only after the default-privileges fix in section 2.1.

> **As built, 28 July:** `supabase/migrations/20260728180000_dashboard_schema.sql`.
> Deviations from the text below are listed under "Corrections from Step 7" at the top.

```
metrics_ga4_weekly (week_start date pk, sessions, qualified_sessions,
comparison_views, outbound_clicks_awin, outbound_clicks_rakuten,
outbound_clicks_amazon, outbound_clicks_other, updated_at)
-- nullable ints, see 4.1
-- outbound_clicks_other added by Step 4 (correction 3), NOT YET APPLIED:
-- catches the ebay and other values of AffiliateNetwork so the four
-- by-network columns sum exactly to total outbound clicks.

metrics_awin_weekly (week_start, advertiser, clicks, sales, commission,
status, updated_at, pk(week_start, advertiser, status))

metrics_rakuten_weekly (week_start, advertiser, clicks, sales,
commission, updated_at, pk(week_start, advertiser))

metrics_amazon_monthly (month_start pk, clicks, ordered_items,
shipped_items, commission, updated_at)

metrics_social_weekly (week_start, channel, impressions,
outbound_clicks, updated_at, pk(week_start, channel))

metrics_quality_weekly (week_start pk, suspect_price_count,
placeholder_ean_count, null_ean_product_pct, unmatched_row_rate,
bad_price_count, ean_coverage_pct, comparison_depth_pct, updated_at)

metrics_retailer_quality_weekly (week_start, retailer_id, retailer_name,
last_import_at, cron_window_missed, imported_rows, unmatched_rows,
skipped_multipack_mismatch, multipack_name_unresolved, clicks, sales,
updated_at, pk(week_start, retailer_id))

review_queue (id identity pk, flagged_at, week_start, reason,
retailer_price_id, product_id, retailer_id, row_price, peer_median,
price_ratio, row_ean, matched_product_ean, state default unreviewed,
reviewed_at, note, unique(<stable key chosen in Step 7>, reason, week_start))

brand_spotlight_config (brand_slug pk, display_name, network,
advertiser_id, exclusive_code, suppress_comparison_framing, launched_on)

metrics_brand_spotlight_weekly (week_start, brand_slug, hub_sessions,
hub_to_comparison, outbound_clicks, sales, commission, code_redemptions,
avg_time_on_hub, updated_at, pk(week_start, brand_slug))

platform_changes (id pk, changed_at, title, description,
metrics_affected text[])
```

AWIN keys on status so pending and confirmed commission do not overwrite each other, since AWIN commission validates over weeks.

**metrics_retailer_quality_weekly keys on retailer_id with the name denormalised alongside. Do not key on retailer name. Name-keyed logic is precisely what caused the Superdrug suppression to survive in RoutineBuilder, and a rename would silently split the historical series.**

## 10. Build steps

Step 1, COMPLETE. Findings recorded in section 3.1. No further action. Do not re-run.

Step 2, REPORT ONLY. Propose the tables as a migration. Do not apply. Confirm the default-privileges fix from section 2.1 has landed first, and state explicitly whether it has.

Step 3, GATED. On approval, apply the schema migration. Then verify by reading relacl for each new table that anon and authenticated hold no write privilege and that PUBLIC holds nothing. Report the ACLs, do not assert success.

Step 4, GATED. Build the GA4 Data API weekly puller writing to metrics_ga4_weekly using the query shapes in section 8. Write NULL for periods before the empirically determined dimension start date on the by-network columns. Dry-run and show pulled numbers before first write.

> **Runtime, settled 29 July: GitHub Actions, not pg_cron to an edge function.**
> `GOOGLE_APPLICATION_CREDENTIALS_JSON` is confirmed by the operator to live in
> the GitHub Actions secret store, and it is confirmed absent from the Supabase
> edge-secret store by reading the full listing. Reasons, in order:
>
> 1. Copying it into Supabase to suit a pg_cron design would create a second
>    unverified copy with nothing checking the two match. That is the
>    `AWIN_API_KEY` / `SKEW_IGNORE` pattern this project already decided not to
>    repeat.
> 2. Service-account auth needs an RS256-signed JWT exchanged for an OAuth
>    token. In Actions that is `node:crypto` in a few lines, or
>    `google-auth-library`. In a Deno edge function it means hand-rolling
>    RSA-SHA256 through WebCrypto and importing a PKCS#8 key by hand.
> 3. pg_cron to edge exists here for imports that must run inside the DB's window
>    against feed endpoints. A weekly analytics pull has no such constraint.
> 4. Writing back uses `SUPABASE_SERVICE_KEY`, already an Actions secret used by
>    `refresh-debenhams.yml`. The whole job runs on secrets that already exist in
>    one store and adds nothing to either.
> 5. No `WORKER_RESOURCE_LIMIT` / 546 class of failure, which this project has hit
>    repeatedly on edge functions.
>
> **Discovery instrument:** `.github/workflows/ga4-diag.yml` and
> `scripts/ga4-diag.mjs`, committed 29 July, read-only, `workflow_dispatch` only,
> following the `feed-diag.yml` precedent of running where the key already is
> rather than moving the key. Scope `analytics.readonly` only, so it cannot
> mutate a property setting even by accident. Zero npm dependencies on purpose.
> It answers 2.2 through 2.5 in one run and adds two guards that change how the
> puller must read: the **retention floor** (a series start that coincides with
> the earliest data of any kind is ambiguous between "dimension registered here"
> and "retention truncates here", and those demand opposite conclusions) and the
> **reporting time zone** (section 8.1).

Step 5, GATED. Build the AWIN Publisher API weekly puller writing clicks, sales, commission by advertiser and status. Pull both pending and confirmed. Resolve the secret name question in section 3 first. Dry-run first.

Step 6, GATED. Build the dashboard page at a new authenticated route: four headline tiles, funnel view, leading-indicator trends including the two search indicators, milestone bar, and platform_changes markers on every trend chart. Add a manual-input upsert form for Amazon monthly and social weekly. An unauthenticated request must return no data.

> **Added 29 July: measured consent rate as a leading indicator.** GA4 outbound
> clicks divided by server-side `outbound_clicks` for the same ISO week, rendered
> as a percentage with both raw figures beside it. gtag.js does not load until
> cookie consent
> (`public/fmb-cookie-banner.js:75`) while `lib/events.ts` writes regardless, so
> the gap is a real measured consent-plus-blocker rate rather than a discrepancy
> to reconcile. It is worth its own indicator on three grounds: it is the
> correction factor for every other GA4 figure on the page, a sudden move in it
> is a consent-banner or tracking regression that nothing else on the dashboard
> would catch, and displaying it stops a future reader treating the two pipelines
> disagreeing as a bug.
>
> **The two are still never summed and neither is ever substituted for the
> other.** This is a ratio of two independently sourced figures, both shown.
>
> **The chosen remedy leaves this indicator's definition intact, which is a real
> advantage even though it was not part of the decision.** The dataLayer stub
> recovers events that were being dropped before consent was decided; it does not
> recover refusing visitors, and it is not meant to. So the numerator stays "GA4
> clicks, consenting visitors only" and the denominator stays "server-side
> clicks, everyone", exactly as today. **The fix therefore does not become a
> seventh boundary on this particular series**, and consent ratios measured
> before and after it remain directly comparable. Given how much of this build is
> boundary bookkeeping, an indicator that survives a change to the pipeline
> without one is worth noting.
>
> **Coupled to remedy 4 in the hydration-race ticket.** This indicator works only
> because GA4 counts consenting visitors while the server-side table counts
> everyone. Adopting Google Consent Mode v2 would put modelled non-consenting
> sessions into the numerator, so the ratio would drift toward 1 and stop
> measuring consent while keeping its name. **Decide the remedy and this
> indicator together.** If Consent Mode is adopted, this indicator must either be
> redefined or retired deliberately, not left to change meaning quietly.
>
> **Denominator boundary applies:** the server-side series starts 2026-07-01
> (`platform_changes` id 12), so any week straddling that date is unusable here
> rather than good. See section 4.0.
>
> **Label every GA4-sourced figure on the dashboard as a consenting-visitor
> figure.** Sessions, qualified sessions and comparison views are all subject to
> the same gate, not only clicks.

Step 7, REPORT ONLY. Confirm source tables and exact queries for every quality metric: suspect-price, placeholder or garbage EAN count, null-EAN product percentage, unmatched-row rate, bad-price count, EAN coverage, comparison depth, brand index staleness, and the two search indicators. Report each query before building.

**Per-metric source. Do NOT simply align to dq_snapshot. It references retailer_prices_live in some places and the bare table in others, and that split is deliberate: headline metrics were migrated, per-retailer diagnostics were intentionally left on the bare table. Copying it wholesale can faithfully copy the wrong half. Catalogue, comparison depth and savings read retailer_prices_live. Per-retailer diagnostics may read the bare table, and where they do the dashboard must label them as including inactive retailers.**

**cron_window_missed. Define it as expected schedule slot versus existence of an import_run_state row for that slot, computed from the pg_cron schedule, NOT from anything the watchdog produces.** *(Superseded: see correction 1 at the top. `import_run_state` cannot support this.)*

**review_queue key stability. Confirm every write path upserts on a stable key rather than delete-and-reinsert.** *(Resolved: see correction 2 at the top.)*

Do not compute an EAN-disagreement metric as a headline. Keep it as an internal debug count only if trivial.

Step 8, GATED. Build the weekly quality puller and create review_queue. Upsert flagged rows as unreviewed respecting the key chosen in Step 7 so unreviewed rows are not duplicated across runs. Never overwrite the state of already-reviewed rows. Re-insert a row that recurs in a new week.

**Suspect-price volume. Do not expect any specific pre-named rows. Re-measure the flag count at three thresholds against retailer_prices_live and report before building: under 25%, under 35% and under 50% of peer median. Measured on 27 July these were roughly 44, 150 and 599 rows against 27,743 rows having peers. Set the alert threshold from the measured baseline. Starting point to confirm: alert when the weekly count exceeds 250, or rises more than 50 per cent week on week, both anchored to the measured 150 at the 35% threshold rather than chosen for roundness. The backlog must stay small enough for one person to review in a sitting, or the calibration loop never accumulates reviewed rows.**

> Re-measured 28 July at build time: **41 / 147 / 567** against **27,015** rows with
> peers. Roughly 2% below the 27 July figures, consistent with a day of imports plus the
> r12 retirement settling. Set thresholds from a measurement taken at build time, never
> from a number quoted in a brief.

Comparison depth: store the definition, not the number. Root products only, meaning merged_into IS NULL and parent_product_id IS NULL, in stock, two or more distinct retailers, read through retailer_prices_live. Use today's figure as a build-time sanity check within a 10 per cent tolerance band, never as a fixed acceptance target.

Dry-run and show current values plus the first flagged batch before any write.

Step 9, GATED. Add the data-quality panel above the revenue tiles. Lead with suspect-price count as a trended line with the alert threshold from Step 8. Below it the diagnostic pair: placeholder-EAN count and null-EAN product percentage, both trended. EAN coverage and comparison depth as gauges. Brand index staleness showing behind-by duration and brand count difference. Per-retailer contribution table joining integrity (staleness, skips, cron window state) with conversion (clicks, sales), labelling any bare-table diagnostics as including inactive retailers.

> **Keep the bad_price_count tile even though it reads 0.** A metric that is zero today
> and non-zero later is a regression detector; dropping it because it looks empty is how
> you lose the alarm before the fire.
>
> **State on the panel what placeholder-EAN actually measures.** At 1,260 rows it is
> wrong-length EANs alone, with zero sentinel values and zero repeated-digit patterns. It
> measures feed sloppiness, not deliberate junk, and that changes what a rising number
> would imply.

**Precision readout guard. Precision is confirmed_bug divided by (confirmed_bug + confirmed_discount), which is 0/0 until rows are reviewed. Guard the division explicitly. Suppress the retune prompt until at least 20 rows carry a reviewed state, displaying "insufficient sample" until then. Only once the sample is met does the 40 to 85 per cent retune band apply.**

Build a minimal authenticated review interface to set row state to confirmed_bug, confirmed_discount or dismissed with an optional note.

Layout: suspect-price and its diagnostic pair must be visible at a glance without scrolling. The panel's failure mode is "retention sagged and we could not see why", so these belong above the fold.

Step 10, REPORT ONLY. Confirm brand attribution flow: the brand_slug custom dimension on retailer_click, the /brands/{slug} route for hub sessions, brand-to-advertiser mapping in AWIN and Rakuten, and whether FMB15 code redemptions are capturable from any source. Report before building.

Step 11, GATED. Create brand_spotlight_config and metrics_brand_spotlight_weekly. Seed iLAPOTHECARY (awin, advertiser 125272, code FMB15, suppress_comparison_framing false) and Clarins (rakuten, suppress_comparison_framing true). Build the weekly Spotlight puller. Dry-run and show current values before write.

Step 12, GATED. Add the live Brand Spotlight panel: one card per live Spotlight showing hub sessions trend alongside social outbound clicks side by side, outbound clicks, sales and commission, code redemptions, and hub-to-comparison. No suppression on the live view, which is an internal instrument. Side-by-side trends only, not the full overlay.

Step 13, GATED. Build the client PDF generator: per brand, per date range, styled to the brand kit with the tagline "Your beauty routine. Optimised." Enforce structurally: ranges only with no point-in-time figures, never the banned discount word (use best value, best price, or costs less), British English, no em dashes. Any comparison-depth figure uses the root-products definition. Where suppress_comparison_framing is true, strip all comparison, basket-optimisation and savings language and omit hub-to-comparison. Render a preview before finalising.

**Clarins is not yet a live brand partner. The Prestige Edit launch in August is the trigger for that relationship. The Clarins case here is a suppression test against synthetic or internal data only. No client-facing Clarins PDF is produced until the partnership is live and permission is explicit.**

Steps 14 and 15, GATED, optional.

Step 14, Pinterest weekly puller writing to metrics_social_weekly with channel=pinterest. Requires a Pinterest business account and an app approved to Standard access, since Trial tokens expire after 24 hours and will not sustain a cron. Store derived weekly totals only, not raw cached API responses, to respect Pinterest's data-storage rule. Confirm against the Developer Guidelines current at build time, noting a revision takes effect 18 August 2026.

Step 15, Instagram weekly puller, same table, channel=instagram, via the Instagram Graph API. Instagram exposes no meaningful outbound-click attribution, so this is a reach and impressions surface only and is lower value than Pinterest. Until built, Instagram stays manual weekly paste.

The social puller must be channel-pluggable: adding a channel is a new writer against the same table, not a schema change.

## 11. Acceptance criteria

- The default-privileges fix landed before the schema migration, and every new table shows no anon or authenticated write privilege and no PUBLIC grant, verified by reading relacl.
- An unauthenticated request to the dashboard route returns no data.
- The quality panel builds and functions without the GA4 credential.
- Every catalogue, comparison-depth and savings metric reads through retailer_prices_live. Per-retailer diagnostics on the bare table are labelled as including inactive retailers.
- Comparison-depth acceptance asserts the definition, not a fixed count. Today's figure is a sanity check within a 10 per cent band. Every figure on screen is labelled with its definition, and user- and partner-facing surfaces use the root figure.
- The savings trend anchors to the 27 July reset. The 3 May rows are not plotted as a comparable prior level, and the r12-inflated figures are never quoted.
- By-network columns are NULL, not zero, for weeks before the empirically determined dimension start date, and render as "not measured". The same applies to qualified sessions and commission per qualified session, which have days of history at most.
- Outbound clicks are sourced from retailer_click only. affiliate_clickout is never counted, and the Supabase outbound_clicks table is never summed with GA4.
- Every GA4 query uses customEvent:affiliate_network, never customEvent:network.
- Every Data API call addresses properties/415465396. The measurement id G-Q3J7LSJFLQ is never passed to runReport.
- week_start is ISO Monday everywhere, derived by bucketing the GA4 date dimension in code. No GA4 week dimension is used, and the semantics are stated in the week_start column comment along with the time-zone convention.
- The four by-network columns, including outbound_clicks_other, sum exactly to total outbound clicks for every week after the by-network start date.
- The puller upserts on week_start and re-pulls a trailing window of at least three weeks, so GA4's 24 to 48 hour processing lag cannot permanently understate the most recent week.
- The measured consent rate renders as its own indicator with both source figures shown, and every GA4-sourced figure is labelled as a consenting-visitor figure.
- platform_changes is seeded with the known boundaries and its entries render as markers on every trend chart.
- The suspect-price alert threshold is set from the measured baseline, and the review backlog stays reviewable by one person in a sitting.
- The precision retune prompt is suppressed until at least 20 reviewed rows exist, showing "insufficient sample" until then, with the division guarded.
- cron window state is computed from the pg_cron schedule and cron.job_run_details against retailer_import_config, distinguishes a never-fired trigger from a fired-but-never-began import, and is not collapsed to a boolean.
- review_queue keys on an identifier confirmed not to churn across import cycles.
- Zero-result search rate appears with the leading indicators, with {search_term_string} filtered out. Search-to-comparison rate renders "not measured" until GA4 supplies it.
- Brand index staleness appears in the quality panel.
- Headline tiles, funnel, leading indicators and milestone bar all populate from stored weekly rows, except the five view_item-derived metrics suppressed per section 4.1. Those five are ABSENT from the rendered page, not shown as "not measured", while their columns continue to be written by the puller so the series accumulates.
- No metric whose numerator or denominator is view_item renders anywhere on the page until the hydration-race ticket lands and its fix is recorded as a platform_changes boundary.
- review_queue populates on the weekly run, reviewed states are never overwritten, and precision computes over reviewed suspect-price flags only.
- A Clarins PDF contains no comparison, basket-optimisation or savings framing and omits hub-to-comparison. An iLAPOTHECARY PDF may include comparison framing.
- All generated copy: British English, no em dashes, no banned discount word, savings as ranges only.

## 12. Out of scope

- The full social-to-hub causal overlay. Side-by-side trends only.
- Live Amazon or Rakuten earnings API integration.
- An EAN-disagreement headline metric.
- The browse-search cutover itself, which is separate agent work sequenced concurrently.
- The AWIN product_GTIN importer fix, which is on the import path and must not go near a deploy before the 4 August Boots step-down decision is settled.
- Fixing the JSON-LD SearchAction markup. Filter the literal here, fix the markup separately.
- Any change to import crons, matcher logic, or production data beyond read-only measurement queries. Matcher fixes are separate work.
- Anything touching Boots, r23, the absence-handling threshold, or the import path.

*Brand rules for any copy arising from this work: never use the word beginning "cheap" for lowest cost, use best value or best price or costs less. No em dashes. British English. Multiple UK retailers, not every UK retailer. Savings as ranges only. Commission rates are internal only and never disclosed externally.*
