# The detection gap: what the freeze check does not catch

**Recorded:** 2 August 2026, alongside `20260802210000_frozen_feed_detection.sql`.

This file exists because the limits of a check are more useful than the check.
A monitor that is trusted beyond its reach is worse than no monitor, because it
converts "we do not know" into "we are fine".

## What the check proves

**That a feed CHANGED. Never that it is CORRECT.**

`fmb_detect_frozen_feeds` compares `inflated_bytes` day to day. A feed whose bytes
move has, by that measure, passed — regardless of what the bytes say.

## What it does not catch

### 1. A feed that updates daily with stale or wrong prices

**The largest hole, and the most likely real failure.** A retailer whose feed is
regenerated every night but whose price fields are not refreshed produces a
different byte count daily and sails through. So does one that publishes prices
that are simply wrong.

This is not hypothetical. **The Organic Pharmacy, 2 August 2026:** we held £36.95
for Arnica Massage Oil 100ml; the retailer's own page carried `og:price:amount`
of **£18.47**. We were advertising roughly double the real price. That was caught
by fetching the live retailer page and comparing, **not by anything in the
database**, and nothing in the freeze check would have found it.

Two of three products sampled matched exactly, so it was not systematic — which is
precisely why a byte check cannot see it. The feed did not need to be frozen for
this to happen; it only needed to be wrong.

### 2. Same-length price changes

A subtle one worth stating. `36.95` and `18.47` are both five characters. A price
change that preserves digit count changes **no bytes at all**. Byte identity is
therefore weaker evidence of content identity than it looks — it is a good
heuristic across a whole feed, and no evidence at all for a single row.

### 3. The first three days of any freeze

By construction, at `p_min_days = 4`.

### 4. Anything not in `feed_size_history`

Coverage is whatever writes there — 11 retailers as at 2 August 2026. A newly
onboarded retailer is invisible until its first row lands. Nothing warns that a
retailer is missing from the table.

### 5. Links that die behind an HTTP 200

Different mechanism entirely. The Branded Beauty AWIN deep links resolved to
`awin1.com/closedMerchant.html` with **HTTP 200 and an 87-byte body** while the
feed was still importing cleanly. A feed check cannot see a dead link, and a link
check cannot see a frozen feed. They are two monitors, and only one exists.

Note for whoever builds the second: a naive check flags live retailers. Measured
1 August 2026, Boots and Beauty Bay both returned anti-bot interstitials to an
automated request (6,182 and 5,226 bytes), and substring matching on body text
produced two more false positives from i18n bundles and per-variant availability
text. A workable check needs the size floor **plus** a same-host assertion: a
closed-merchant redirect leaves the retailer's domain, an anti-bot page does not.

### 6. Values fabricated at runtime

No feed monitor can detect a value that was never in the database. See the
fabricated-state section of `docs/standing-rule-frozen-catalogue-state.md`:
`delivery_threshold ?? '25'` and `delivery_cost ?? '3.95'`, eight occurrences in
the app plus three in the email path.

### 7. A retailer whose importer is deliberately disabled

The check skips `enabled = false` on purpose, so a retailer parked mid-decision
does not alert daily. The cost is that a retailer left disabled by accident is
also silent.

## What would close hole 1

**Not in scope, and not designed here.** The shape that would work is a periodic
sample: take N products per retailer, fetch the live retailer page, compare the
structured price against what we hold, and surface the disagreements.

The Organic Pharmacy investigation is a worked example of the method at n=3, and
of its cost — it needs a live HTTP fetch per product, per retailer, and it must
handle the anti-bot problem from item 5. Sampling is what makes it affordable:
enough products to detect a systematic drift, not enough to verify the catalogue.

That is a separate brief. **Until it exists, nothing in this system verifies that
a price is right — only that it moved.**
