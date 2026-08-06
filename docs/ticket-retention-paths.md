# Ticket: the two retention paths, and what unifying them would cost

**Raised:** 6 August 2026, from the alert-delivery investigation.
**Status:** scoped, not built. Direction agreed: **B now, D next, C not yet.**

---

## The shape

Two independent sending paths, serving different users with different products.

| | Signed out — `saved_routines` | Signed in — `tracked_products` |
|---|---|---|
| Cadence | monthly digest, cron 1, `0 9 1 * *` | daily check, cron 37 `fmb-retention-nightly`, `0 11 * * *` |
| Triggered by | the calendar | a price falling below the user's baseline |
| Materiality | none — it sends regardless | ≥10% below baseline, plus a tiered floor (£3 under £50, £5 over) |
| Welcome email | yes, `AFTER INSERT` trigger | no |
| Consent / unsubscribe | `saved_routines.active`, `.unsubscribe_token` | `user_alert_prefs.email_alerts_enabled`, `.unsubscribe_token` |
| Last emailed | `saved_routines.last_emailed_at` | `routine_alerts.delivered_at`, per alert |

**The bridge already exists and is not scoped work.** `app/auth/confirm/route.ts:30` calls
`fmb_claim_legacy_routine()` on every successful magic-link verification. It matches
`saved_routines` on `lower(email) = lower(auth.users.email)`, takes the most recent active
row, resolves each id to its family root via `COALESCE(parent_product_id, id)`, and inserts
one `tracked_products` row per product, `ON CONFLICT (user_id, product_id) DO NOTHING`.

---

## RECORD 1: the auth-time baseline discards the intervening drop, invisibly

**`fmb_claim_legacy_routine` sets the baseline at AUTHENTICATION time, not at save time.**

```sql
SELECT best_price, best_retailer_id INTO v_bp, v_br FROM fmb_family_best_price(v_root);
INSERT INTO tracked_products (…, baseline_price, baseline_retailer_id, baseline_captured_at)
VALUES (v_uid, v_root, now(), v_bp, v_br, CASE WHEN v_bp IS NOT NULL THEN now() END)
```

**This is the right choice and should not be changed.** A save-time baseline would fire an
alert the moment someone authenticates, for a drop they never waited through — the alert
would be true and the experience would be wrong. Starting the clock when identity is proven
is the conservative reading and matches what the alert claims to be.

**The cost, which must be written down because it is otherwise unexplainable.** Any price
drop occurring between the signed-out save and the eventual sign-in is **silently
discarded**. The product is tracked from the sign-in price, so a fall that happened in the
gap is never alerted and never appears anywhere.

**And it is unrecoverable, not merely unreported.** `price_history` has never received a row
(`docs/strategy-amendments.md` A7), so there is no series to reconstruct what the price was
at save time. The drop is not "missed and knowable"; it is **gone**.

> **For whoever investigates a missing alert.** If a user says "it was cheaper last week and
> you didn't tell me", and their `tracked_products.baseline_captured_at` is close to their
> first sign-in rather than to their original save, **this is the explanation and it is
> working as designed.** Do not treat it as a defect in `fmb_generate_alerts`. Check
> `baseline_captured_at` against `saved_routines.created_at` for the same address before
> looking anywhere else.

The function body carries no comment saying this. A `COMMENT ON FUNCTION` would put it where
the next reader stands, and is proposed rather than applied — it is a database write.

---

## RECORD 2: Option C retires a product, and must be decided as one

Recorded **against the option**, so it cannot be reached without being seen.

**If Option C is taken — magic link on every save, no signed-out write — then
`saved_routines` stops being written, and the monthly digest's population goes to zero by
attrition.** Existing rows keep receiving until they unsubscribe or lapse; no new row ever
joins them.

**That is retiring a product, not refactoring one.** The monthly digest is a different thing
from the daily alert — different trigger, different cadence, different promise — and it is
the only thing currently offered to a person who will not authenticate. Removing the write
removes the product for everyone who would have chosen it.

**It must be decided as a product retirement**, with the count of people it would have
served, not as an implementation detail of a login change. The two decisions have different
owners and different evidence.

---

## The four options

| | Effort | Breaks | Friction | Unverified-address protection |
|---|---|---|---|---|
| **A** leave it | none | nothing | none | preserved |
| **B** surface the difference | copy + button hierarchy only | nothing | none at save | preserved — both paths unchanged |
| **C** magic link on every save | moderate | monthly path loses its population (**see Record 2**) | the whole risk | **strengthened** — every address verified |
| **D** upgrade path after save | small | nothing | deferred, not removed | preserved |

**Why B first.** No architectural change. The defect is that the flow hides its better
product: the signed-out button reads "Email me instead" (`RoutineBuilder.tsx:1311`), the
sign-in route is fine print (`:1331-1335`), and neither success message names the cadence
difference (`:1316-1322`). Reversible in a commit.

**Why D second.** `saved_routines` is written first, so nothing is lost if the person never
authenticates; if they do, `fmb_claim_legacy_routine` already migrates them with no new code.
The welcome email is the natural channel and already carries `utm_source=email` (v16), so the
click is attributable without new instrumentation.

**Why not C yet.** It trades a known-working path for an unmeasurable friction bet at a
volume where the result cannot be read. A person who never clicks the link has their routine
only in `localStorage` — nothing emailed, nothing tracked, worse off than today, and
**silently**. It becomes arguable once B and D show what proportion authenticate when asked
plainly.

**`shouldCreateUser` already defaults to true.** `LoginCard.tsx:25` calls `signInWithOtp`
with no options, so an unrecognised address creates an account — "save" and "sign up" can be
one action with no new auth work. `emailRedirectTo` is not passed, so state is not carried
today, but `app/auth/confirm/route.ts:22-23` already reads `?next=` behind an open-redirect
guard, so carrying it is one parameter. *Unknown:* whether the Auth dashboard's new-user
setting is enabled — readable only from the Supabase console.

---

## The baseline B and D would move, measured 6 August 2026

**Zero people have used the account save path from the routine builder.**

| `save_routine` method | count |
|---|---|
| `email` | **13** |
| `account` | **0** |

**How that was established, since GA4 could not answer it.** `method` is referenced nowhere
in `scripts/ga4-diag.mjs` or `ga4-weekly-pull.mjs`, and two parameters on
`load_routine_from_url` were found unregistered on 5 August (work list item 39,
convention 22). It was measured from the database instead:

- **`email` = 13** — `saved_routines` holds 13 rows across 13 distinct addresses, one per
  signed-out save.
- **`account` = 0** — the builder's account save passes `p_slot: item.category`
  (`RoutineBuilder.tsx:863`). **All four `tracked_products` rows have `slot` NULL, and all
  four products carry a non-empty `product_type`** (Mask, Serum, Skincare, Moisturiser), so a
  builder save would have set it. None did.

**Provenance of the four rows.** Three belong to users who also have a `saved_routines` row
— consistent with `fmb_claim_legacy_routine`, which sets slot and note NULL. The fourth
(product 19430, added 2026-08-03 19:24) belongs to a user with **no** `saved_routines` row,
so it cannot be a claim; the remaining writer is `AccountRoutine.track()`
(`AccountRoutine.tsx:145`), which passes only `p_product_id` and fires `track_product`, a
different event from `save_routine`.

**The unprompted upgrade rate is 2 of 13, about 15%** — people who saved signed out and later
authenticated with no prompt to do so. That is the closest thing to a natural experiment
available, and it is the number B and D are trying to move.

*Caveat:* `saved_routines` rows count completed saves, which is what matters here, but may
differ from the GA4 `save_routine` event count where gtag was blocked or a send failed.

---

## What would decide C, and why it cannot be decided yet

**It cannot be decided on evidence at current volume, and waiting does not fix that.** 13
saves in three months is roughly one a week; reading a friction change of the size that would
matter needs on the order of a hundred saves per arm, which at current traffic is years.
**The friction question is a judgement call, and naming it one is more useful than
instrumenting something that will not resolve.**

Readable today, free: the `method` split above, and the 2-of-13 upgrade rate.
Not readable at all: anyone who abandoned at the email box, because nothing records a save
that was not completed.
