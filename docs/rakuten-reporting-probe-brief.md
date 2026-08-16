# Rakuten reporting API — probe brief

**Written 15 August 2026. PARKED until The Fragrance Shop onboards.** Work-list item 121.

**This file is research, not a design.** Nothing here has been observed against the live
API. It exists so that resuming this work is a probe rather than a fortnight of reading,
and so that whoever resumes it does not repeat the reading — **the reading was the
expensive part.**

**Nothing in this document should be built from directly.** Its whole purpose is to make a
probe cheap; the probe is what settles the design. See work-list item 118 for what
happened the last time a table was designed against recollection: every planned column was
right and the primary key was wrong, which is the one error a table cannot absorb.

---

## 1. Authentication — THREE token families, not one scheme

**The question "which credential scheme do we hold" has a false premise, and that is the
single most useful finding here.** Rakuten does not offer one scheme with a legacy
alternative. It has three token types serving three endpoint families, and which you need
depends on which endpoint you call.

| Token | Obtained from | Unlocks |
|---|---|---|
| **Bearer / access token** (short-lived) | Developer portal, via Client ID + Secret + Scope | Core APIs: `/v2/advertisers`, `/events/1.0/transactions`, `/v1/partnerships` |
| **Security token** (separate, long-lived) | Publisher dashboard | **Advanced Reports** (`/advancedreports/1.0`), Consolidated Advertiser Report |
| **Reporting API token** (embedded in a URL) | Inside a saved report's own "Get API" link | Reporting Platform (`ran-reporting.rakutenmarketing.com`) |

Strongest evidence is the [Meltano Singer tap](https://github.com/MeltanoLabs/tap-rakutenadvertising)
— **working code rather than documentation** — which takes all three as *separate config
keys* (`auth_token`, `security_token`, `reporting_api_token`) and routes streams to
whichever applies. Corroborated by [Strackr](https://strackr.com/docs/rakuten-advertising),
[Kleene](https://docs.kleene.ai/docs/rakuten-advertising) and
[Adverity](https://docs.adverity.com/guides/authorizations/rakuten-authorization.html),
each of which documents a *different* one of the three — which is precisely why reading
only one integrator would have produced a confident wrong answer.

### THE TRAP: deprecated as a scheme, mandatory as a parameter

Rakuten's help centre states that the Web Services token **as an authentication parameter**
is deprecated in favour of the OAuth 2.0 access token process. It also states that the
Security token **remains a required parameter** for the Consolidated Advertiser Report API
and for all Advanced Reports requests.

> **An Advanced Reports call needs the OAuth bearer token AND the Security token. Not one
> or the other.** "Deprecated" here describes the auth mechanism, not the credential, and
> reading the deprecation notice alone would lead directly to a 401 that looks like a bad
> client secret.

This is the same shape as AWIN's `AWIN_API_KEY` vs `AWIN_OAUTH_TOKEN`: **two credentials
for one vendor, where using the wrong one fails in a way that reads as the right one being
broken.**

### Token lifetime is CONTRADICTED across sources and must be probed

| Source | Claim |
|---|---|
| [Tealium](https://docs.tealium.com/server-side-connectors/rakuten-advertiser-transaction-api-connector/) | **4 hours** |
| [Antonio Tajuelo's API docs](https://rakuten-api-documentation.antoniotajuelo.com/en/faq/how-to-generate-a-rakuten-api-oauth-token) | **60 minutes**, with a refresh token |
| Meltano tap | "short-lived" |

Not resolvable from outside, and it decides whether the puller exchanges once per run or
re-exchanges per call. **Read `expires_in` off the token response and believe that.**

> **Either way, this is a real structural difference from AWIN, whose token is static.**
> The Rakuten puller needs a token-exchange step that AWIN's has no equivalent of.

---

## 2. Endpoints, as far as they could be established

Confirmed call sites, from the tap:

- `GET /v2/advertisers` — partnered advertisers
- `GET /events/1.0/transactions` — **per-transaction**, carries status
- `/advancedreports/1.0` with **numbered report IDs (1, 2, 3, 22, 23)**
- `GET /{region}/reports/{key}` on the reporting platform — note `{region}`, the same grain
  surprise AWIN produced

**What could NOT be established: which report ID returns what.** They are opaque integers
and no source reached maps them. **First thing the probe should print.**

---

## 3. THE STRUCTURAL FINDING, which survives the parking

**AWIN's table works because ONE endpoint returned the whole grain.**
`/reports/advertiser` gives `(week, advertiser, region)` with clicks and all four
commission statuses as columns of one record. One call, one row, one table.

> **Rakuten appears to have no single equivalent.** Transactions are per-transaction and —
> exactly as with AWIN's transactions endpoint — **carry no click count**. Clicks would
> have to come from a report. That is most likely **two endpoints composed**, which is a
> STRUCTURAL difference rather than a mapping one.

So `metrics_rakuten_weekly` is worse-founded than a column comparison suggests. Its
existing shape:

| Defect | Detail |
|---|---|
| No comments at all | No table comment, no column comments. Names without meanings, the item 111 pattern. |
| **Text advertiser name in the PRIMARY KEY** | `(week_start, advertiser)` with `advertiser` as `text`. **A rename forks the series in two.** Not hypothetical: AWIN's "Branded Beauty" became "Branded Beauty- CLOSED 30/7/2026" mid-series this quarter. AWIN's redesigned table keys on `advertiser_id` for exactly this reason. |
| No `sale_value` | So the **realised commission rate cannot be computed** — the single most valuable figure the AWIN work produced (3.45%). |
| No pending/confirmed split | Rakuten validates over weeks too, so every figure would freeze at its most provisional value. |
| No currency, no region | `{region}` appears in the reporting path, so a region grain may exist here as it did at AWIN. |
| **Grain may match no endpoint** | The one above. |

**Conclusion: the same as AWIN's, but held more strongly. Probe first, design after.**
Do not extend this table. Drop and recreate it against the observed shape, as
`metrics_awin_weekly` was.

---

## 4. What DOES transfer from the AWIN work

**The puller pattern transfers essentially whole**, because it encodes validation lag
rather than any API's shape:

- ISO weeks, Monday-start, matching every other weekly series
- **12-week trailing re-pull with upsert on conflict**, so a later run corrects an earlier
  one instead of appending a second version of the week
- Three acts: dry run → real run → arm the schedule in a diff of its own
- **Event-aware `DRY_RUN` copied verbatim** — manual dispatch defaults dry, scheduled run
  defaults to write. A schedule inheriting the manual default runs dry forever, writes
  nothing and reports success every week.
- `updated_at` as a load-bearing column: the only thing saying how stale a provisional
  figure is

**Plus the token exchange, which is new.**

---

## 5. TWO OPEN QUESTIONS, which only the portal settles

Recorded so this resumes rather than restarts.

**Q1. Are "Web Services token" and "Security token" one credential or two?**
Rakuten's help article is titled as though they are two. Adverity finds the *Security
Token* on the *Web Services* page, which reads as one. **Not resolvable from outside** —
`pubhelp.rakutenadvertising.com` returns **403** to fetching and the developer portal is a
JavaScript shell serving no content to a fetch. Whoever opens the Web Services page should
record **how many token fields appear on it**, which settles it in one glance.

**Q2. Does the portal's Scope ID match our recorded SID `4684964`?**
Worth checking rather than assuming, because **that SID appears in old Stylevana feed
filenames** (`53421_4684964_1_cmp_xml.gz`), so it may be **datafeed-scoped rather than
reporting-scoped**. If the portal shows a different number, one of the two is wrong and
that is a finding before a line is written.

---

## 6. Portal instructions — where to look

**CHECK BEFORE YOU CREATE. "Add Application" GENERATES credentials.** If an application
already exists, read it; do not make a second one on a live account.

**A — Does an OAuth application already exist?**
1. `developers.rakutenadvertising.com`, log in with **publisher** credentials
2. **"Account and Application"**, on the right
3. **Look for an existing application first.** If one exists, its **Client ID** and
   **Client Secret** are on the credentials screen. Only click **"Add Application"**
   (top right) if there is none.

**B — Scope ID** — Rakuten affiliate dashboard, **top right**, labelled **"Scope ID"**.
Compare against `4684964` per Q2.

**C — Security token** — publisher dashboard → hover **"Links"** → **"Web Services"** →
**scroll to the bottom** → **"Security Token"** section. Record how many token fields the
page shows, per Q1.

**D — Reporting API token** — **Reports → Performance** → open the commission report →
**"View Report"** → **"Get API"**. The token is embedded in the URL displayed.
**Treat that URL as a password.**

---

## 7. Sourcing, stated plainly

**Nothing here was read from Rakuten's own documentation directly.** The developer portal
URL serves a JavaScript shell with no content to a fetch, and the publisher help centre
returns **403**. Everything above comes from working third-party code and from search
summaries of Rakuten's pages.

> **This brief is therefore itself carried rather than measured**, and it is the exact
> class of thing item 120 is about: an assumption in a place nobody has looked. It has been
> written to make ONE authenticated call cheap, not to substitute for it.
>
> **Marking something unverified is not the same as verifying it, and the marker has a
> shelf life.** This one starts the day The Fragrance Shop onboards.
