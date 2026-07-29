# Ticket: the GA4 stub sits at the end of body on the 19 static pages

**Raised:** 29 July 2026, from verifying the gtag hydration race fix.
**Status:** OPEN, low priority. **No defect today.** Latent trap.
**Related:** `docs/ticket-gtag-hydration-race.md`

## What

`public/fmb-gtag-stub.js` is loaded on all 19 static pages by a plain
`<script src>` tag placed immediately before the consent banner tag, which sits
at the **end of `<body>`**. On `public/about.html` that is byte 20888 of 20999.

The Next.js app loads the same file as the **first child of `<body>`**, because
there it has to beat React hydration. The static pages have no hydration, so the
position was chosen to sit next to the banner rather than to beat anything.

## Why it is not a defect today

Verified on the deployed preview, not assumed:

- No `gtag(` call on any of the 19 pages executes at parse time. All of them sit
  inside submit or fetch handlers, so they run on user interaction, long after
  the parser has passed the stub tag.
- Every one is additionally wrapped in `if (typeof gtag === 'function')`.
- Measured directly: **zero** `gtag(` call sites appear before the stub tag's
  offset on any of the 19 files.

Three pages do have `gtag(` calls positioned *earlier in the document* than the
stub tag (`index.html`, `unsubscribe.html`, `unsubscribe-alerts.html`, nine calls
in total). Textual position is not execution order, and all nine are inside
handlers. This is worth knowing before someone re-runs the check and thinks they
have found something.

## Why it is a trap

The safety rests on a property nobody has written down anywhere near the code:
*no static page may call gtag at parse time*. Anyone adding an inline
`gtag('event', ...)` above the stub tag, which looks entirely reasonable, gets
the same silent no-op this project has just spent a day diagnosing. It fails the
same way: no error, no warning, nothing in GA4, and a guard
(`typeof gtag === 'function'`) that makes the failure look deliberate.

It is the identical shape to the original bug. The original was an *ordering*
assumption in the framework; this would be an *ordering* assumption in hand-written
HTML.

## Fix

Move the stub tag into `<head>` on all 19 files, before anything else. It is a
7KB same-origin request and the pages are static, so the cost is one parser-block
early rather than one late. The banner tag stays where it is, since it must not
load gtag.js before consent and its position is deliberate.

Mechanical change, 19 files, one line moved in each. Worth doing when someone is
next in those files rather than as a standalone pass.

## Do not

Do not "simplify" by removing the stub from static pages on the grounds that they
have no hydration race. It is what makes the two surfaces establish consent on
the same rules, and it is why a refusal discards the queue identically on both.
Without it, the static pages would silently drop events before consent while the
app queued them, and the consent ratio would then be measuring two different
things depending on entry point.
