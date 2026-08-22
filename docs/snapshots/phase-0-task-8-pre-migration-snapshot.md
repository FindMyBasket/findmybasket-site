# Phase 0, Task 8 — pre-migration snapshot of the static pages

**Captured 22 August 2026 from the LIVE site**, not from the repository. The repo is what the
page should be; this records what it is. Discovery only — nothing was changed.

**Purpose.** This is Phase 2's acceptance test and it must predate Phase 2. Phase 2 migrates
`public/index.html` and `public/savings-hub.html` into Next.js routes; the homepage carries
six-figure organic impressions, so the migration needs a mechanical diff rather than an eye.

**Method.** `curl` against `https://www.findmybasket.co.uk`, metadata parsed from the returned
HTML. Every figure below is reproducible from the commands in the appendix.

---

## ⚠️ READ THIS FIRST — the thing most likely to go wrong in Phase 2

> **ONLY `/product/[id]` EMITS OPEN GRAPH AND TWITTER TAGS. EVERY OTHER NEXT.JS ROUTE EMITS
> ZERO. A MIGRATED HOMEPAGE WILL EMIT ZERO UNLESS PHASE 2 ADDS THEM DELIBERATELY — AND THE
> FAILURE IS SILENCE, NOT A MISMATCH.**

Measured on the live site, 22 August 2026:

| Route | OG tags | Twitter tags | JSON-LD blocks |
|---|---:|---:|---:|
| `/finder` | **0** | **0** | 0 |
| `/skincare` | **0** | **0** | 4 |
| `/brands/mediheal` | **0** | **0** | 2 |
| `/product/96761` | 4 | 4 | 4 |
| **`/` — static, today** | **8** | **3** | 1 |
| **`/savings-hub.html` — static, today** | **8** | **3** | 1 |

`/product/[id]` has them because its `generateMetadata` sets `openGraph` and `twitter`
explicitly. Nothing in Next.js supplies them by default, so a route that does not declare them
produces a page with none — **which renders correctly, passes every build check, and looks
entirely normal.**

**Why this is the dangerous one.** A wrong title is visible in a diff and in a browser tab. A
missing `og:image` is visible nowhere except in a social preview nobody generates during a
migration. The homepage carries six-figure organic impressions and eleven OG/Twitter tags; losing
them produces no error, no warning and no visual change.

**This is why the pass condition below is written as it is.** `count must not drop` is the clause
that catches it — a comparison that only checks the tags present on BOTH sides passes trivially
when one side has none.

*(The full route comparison and the two other by-construction differences — tag normalisation and
JSON-LD serialisation — are in section 8.)*

---

## 1. HTTP status and redirect behaviour

| URL | Status | Location | Notes |
|---|---|---|---|
| `https://findmybasket.co.uk/` (apex) | **307** | `https://www.findmybasket.co.uk/` | **Temporary**, not 301/308 |
| `https://www.findmybasket.co.uk/` | 200 | — | serves `public/index.html` |
| `/index.html` | **200** | — | **no redirect to `/`** |
| `/savings-hub.html` | 200 | — | |
| `/app` | 200 | — | |
| `/app.html` | **308** | `/app` | permanent |

Adjacent redirects captured while testing, for completeness:

| URL | Status | Location |
|---|---|---|
| `/savings-hub` | **307** | `/savings-hub.html` |
| `/product-finder` | 308 | `/skincare` |
| `/partners` | 308 | `/work-with-us` |

**`/` and `/index.html` return byte-identical bodies** — 62,280 bytes, md5
`ff42edcd3b502bfed77bd1458e7bcdce`, both HTTP 200 with no redirect between them. The duplicate is
resolved only by the canonical tag, which points at `/`.

| Page | Bytes | md5 |
|---|---:|---|
| `/` and `/index.html` | 62,280 | `ff42edcd3b502bfed77bd1458e7bcdce` |
| `/savings-hub.html` | 33,085 | `bedd6b9842a2142a92a5be8a94deb0c9` |
| `/app` | 23,987 | `e91efca90a0d5d030b5befa6548d95b6` |

---

## 2. `/` and `/index.html` — metadata

| Field | Value |
|---|---|
| `<title>` | `Compare Beauty Prices Across UK Retailers \| FindMyBasket` |
| `meta description` | `Build your beauty routine and compare prices across multiple UK retailers. Delivery thresholds included. Free to use.` |
| `canonical` | `https://www.findmybasket.co.uk/` |
| `robots` meta | **none** |
| `X-Robots-Tag` header | **none** |
| `hreflang` | **none** |

**Open Graph**

| Tag | Value |
|---|---|
| `og:title` | `FindMyBasket: Your beauty routine. Optimised. \| UK Beauty Price Comparison` |
| `og:description` | `Your beauty routine, optimised. FindMyBasket compares skincare, makeup, hair, fragrance, bath & body and supplements prices across multiple UK beauty retailers. Free to use.` |
| `og:url` | `https://www.findmybasket.co.uk/` |
| `og:type` | `website` |
| `og:site_name` | `FindMyBasket` |
| `og:image` | `https://www.findmybasket.co.uk/og-image.jpg` |
| `og:image:width` | `1200` |
| `og:image:height` | `630` |

**Twitter**

| Tag | Value |
|---|---|
| `twitter:card` | `summary_large_image` |
| `twitter:title` | `FindMyBasket: Your beauty routine. Optimised. \| UK Beauty Price Comparison` |
| `twitter:description` | *(same string as `og:description`)* |

**Note:** no `twitter:image`. The card falls back to `og:image`.

**JSON-LD** — 1 block, 475 chars, **minified** (single line):

```json
{"@context":"https://schema.org","@type":"WebSite","name":"FindMyBasket","url":"https://www.findmybasket.co.uk","description":"UK beauty price comparison tool. Compares skincare, makeup, hair, fragrance, bath & body and supplements prices across major retailers to find the best way to buy your whole routine.","potentialAction":{"@type":"SearchAction","target":"https://www.findmybasket.co.uk/search?q={search_term_string}","query-input":"required name=search_term_string"}}
```

---

## 3. `/savings-hub.html` — metadata

| Field | Value |
|---|---|
| `<title>` | `Savings Hub - Skincare Price Guides and Money Saving Tips \| FindMyBasket` |
| `meta description` | `UK skincare price comparisons, retailer guides and expert buying advice. Find the best price on your favourite skincare products across UK retailers.` |
| `canonical` | `https://www.findmybasket.co.uk/savings-hub.html` *(self)* |
| `robots` meta | **none** |
| `X-Robots-Tag` header | **none** |
| `hreflang` | **none** |

**Open Graph**

| Tag | Value |
|---|---|
| `og:title` | `Savings Hub - Skincare Price Guides and Money Saving Tips \| FindMyBasket` |
| `og:description` | `UK skincare price comparisons, retailer guides and expert buying advice. Find the best price on your favourite skincare products across UK retailers.` |
| `og:url` | `https://www.findmybasket.co.uk/savings-hub.html` |
| `og:type` | `website` |
| `og:site_name` | `FindMyBasket` |
| `og:image` | `https://www.findmybasket.co.uk/og-image.jpg` |
| `og:image:width` | `1200` |
| `og:image:height` | `630` |

**Twitter**

| Tag | Value |
|---|---|
| `twitter:card` | **`summary`** — differs from the homepage's `summary_large_image` |
| `twitter:title` | `Savings Hub - Skincare Price Guides and Money Saving Tips \| FindMyBasket` |
| `twitter:description` | *(same string as `og:description`)* |

**JSON-LD** — 1 block, 471 chars, **pretty-printed** with newlines and indentation:

```json
{
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "FindMyBasket",
    "url": "https://www.findmybasket.co.uk",
    "description": "UK skincare price comparison tool that finds the best value way to buy your whole routine across major retailers.",
    "potentialAction": {
      "@type": "SearchAction",
      "target": "https://www.findmybasket.co.uk/app?q={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  }
```

---

## 4. Rendered nav and footer link sets

**They differ from each other**, as the task anticipated.

### `/` and `/index.html` — nav, 14 anchors in one `<nav>`

| href | text |
|---|---|
| `/index.html` | FindMyBasket |
| `/skincare` | Skincare |
| `/makeup` | Makeup |
| `/hair` | Hair |
| `/fragrance` | Fragrance |
| `/bath-and-body` | Bath & Body |
| `/supplements` | Supplements |
| `/edit/k-beauty` | K-Beauty |
| `/savings-hub.html` | Savings Hub |
| `/brands` | Brand Spotlight |
| `/finder` | Find |
| `/search` | *(empty — icon)* |
| `/app` | Build a routine |
| `/search` | *(empty — icon)* |

### `/savings-hub.html` — nav, 9 anchors in one `<nav>`

| href | text |
|---|---|
| `/index.html` | FindMyBasket |
| `/skincare` | Skincare |
| `/makeup` | Makeup |
| `/hair` | Hair |
| `/edit/k-beauty` | K-Beauty |
| `/savings-hub.html` | Savings Hub |
| `/search` | *(empty — icon)* |
| `/app` | Build a routine |
| `/search` | *(empty — icon)* |

**Missing from the hub nav relative to the homepage:** `/fragrance`, `/bath-and-body`,
`/supplements`, `/brands`, `/finder` — five links.

### Footer — IDENTICAL on both pages, 7 anchors

| href | text |
|---|---|
| `/savings-hub.html` | Savings Hub |
| `/app` | Try it now |
| `/about` | About |
| `/work-with-us` | Work with us |
| `/privacy` | Privacy Policy |
| `/terms` | Terms of Use |
| `mailto:hello@findmybasket.co.uk` | Contact |

Neither page has a `<header>` element; nav lives in `<nav>` and footer in `<footer>`.

---

## 5. `http://` references

**No insecure asset references on either page.** The only `http://` strings are the SVG XML
namespace:

| Page | `http://` strings |
|---|---|
| `/` and `/index.html` | `http://www.w3.org/2000/svg` (×1 distinct) |
| `/savings-hub.html` | `http://www.w3.org/2000/svg` (×1 distinct) |
| `/app` | `http://www.w3.org/2000/svg` (×2 distinct, one with a trailing escape) |

**`http://www.w3.org/2000/svg` is an XML namespace identifier, not a fetched asset.** It is
correct as `http://` and must not be "fixed" — changing it breaks SVG rendering. Recorded so a
future insecure-reference sweep does not flag it.

Distinct hosts referenced:

| Page | Hosts |
|---|---|
| `/` and `/index.html` | `fonts.googleapis.com`, `fonts.gstatic.com`, `schema.org`, `www.findmybasket.co.uk`, `www.w3.org` |
| `/savings-hub.html` | `fonts.googleapis.com`, `schema.org`, `www.findmybasket.co.uk`, `www.w3.org` |

**OG image:** `https://www.findmybasket.co.uk/og-image.jpg` → **HTTP 200**, `image/jpeg`,
290,291 bytes. Both pages reference the same file; neither has a page-specific OG image.

---

## 6. robots.txt and sitemap membership

```
User-agent: *
Allow: /
Disallow: /app
Disallow: /app/*
Disallow: /api/*

Sitemap: https://www.findmybasket.co.uk/sitemap.xml
```

`sitemap-pages.xml` holds 2,644 entries. Relevant ones:

| URL | In sitemap | `lastmod` | `changefreq` | `priority` |
|---|---|---|---|---|
| `https://www.findmybasket.co.uk/` | yes | **none** | daily | 1.0 |
| `/savings-hub.html` | yes | **none** | daily | 0.9 |
| `/app.html` | **yes** | **none** | weekly | 0.9 |
| `/index.html` | **no** | — | — | — |

---

## 7. Inconsistencies found — RECORDED, NOT FIXED

Ordered by how much they bear on Phase 2. **None of these were changed.**

| # | Finding | Detail |
|---|---|---|
| 1 | **`/app.html` is in the sitemap, 308s to `/app`, and `/app` is `Disallow`ed** | The sitemap submits a URL that redirects into a path robots.txt forbids. Three artefacts disagreeing about one page. |
| 2 | **`/index.html` returns 200 and is byte-identical to `/`** | Two indexable URLs for one page, separated only by the canonical tag. `/index.html` is also the nav's own logo href on **both** pages, so every internal path to the homepage points at the non-canonical URL. |
| 3 | **apex → www is 307, not 308/301** | A temporary redirect on the primary domain boundary. `/savings-hub` → `/savings-hub.html` is also 307, while `/product-finder` and `/partners` are 308. |
| 4 | **Nav sets differ by five links** | Hub nav lacks `/fragrance`, `/bath-and-body`, `/supplements`, `/brands`, `/finder`. |
| 5 | **`twitter:card` differs** | `summary_large_image` on the homepage, `summary` on the hub, with the same 1200×630 image on both. |
| 6 | **No `twitter:image` on either page** | Falls back to `og:image`; works, but is implicit. |
| 7 | **Homepage `og:title` ≠ `<title>`** | `FindMyBasket: Your beauty routine. Optimised. \| UK Beauty Price Comparison` vs `Compare Beauty Prices Across UK Retailers \| FindMyBasket`. The hub's two match. Divergence may be deliberate. |
| 8 | **The two JSON-LD blocks disagree on the search target** | Homepage `SearchAction` → `/search?q=`; hub → **`/app?q=`**, which is `Disallow`ed. Both claim `@type: WebSite` for the same site with different `description` values. |
| 9 | **No `lastmod` on any sitemap entry** | Including the homepage. |
| 10 | **Neither page sets a `robots` meta or `X-Robots-Tag`** | Indexing is governed entirely by robots.txt and canonicals. |

**Expected, not a discrepancy:** the `/search` nav artefact, the builder URL and the retailer
counts were corrected earlier this week, so this snapshot shows a cleaner state than the
programme document describes. That difference is the corrections landing, not drift.

---

## 8. Can these be diffed against a Next.js route?

**Partly. Three fields are generated differently by construction and cannot be compared byte for
byte.** Measured against the live Next.js routes:

| Route | OG tags | Twitter tags | JSON-LD blocks |
|---|---|---|---|
| `/finder` | **0** | **0** | **0** |
| `/skincare` | **0** | **0** | 4 |
| `/brands/mediheal` | **0** | **0** | 2 |
| `/product/96761` | 4 | 4 | 4 |
| **`/` (static, today)** | **8** | **3** | 1 |
| **`/savings-hub.html` (static, today)** | **8** | **3** | 1 |

**1. OG and Twitter are per-route in Next.js and almost no route defines them.** Only
`/product/[id]` emits them, because its `generateMetadata` sets `openGraph` and `twitter`
explicitly. Category, brand and finder routes emit none. **A migrated homepage will emit zero OG
tags unless Phase 2 adds them deliberately** — the framework does not carry them over.

**2. Next.js normalises what it does emit.** `og:image:width` / `og:image:height` are produced
from the `images` metadata object, and tag order, quoting and self-closing style come from the
framework rather than the source file. Even a correct migration will not produce the current byte
sequence.

**3. JSON-LD serialisation differs by construction.** Next injects via
`dangerouslySetInnerHTML={{ __html: JSON.stringify(obj) }}` — always minified, key order fixed by
the object literal. The homepage's block is already minified; **`/savings-hub.html`'s is
pretty-printed with newlines and four-space indentation.** That block cannot survive migration
unchanged, and a byte diff of it will always fail.

**Diffable byte-for-byte:** `<title>`, `meta description` content, `canonical` href, OG/Twitter
*content strings*, HTTP status codes, redirect targets, nav and footer href sets.

**Not diffable byte-for-byte:** tag order and formatting, JSON-LD whitespace, the presence of OG
and Twitter tags at all.

---

## 9. What a passing Phase 2 diff looks like

**"Matches exactly" cannot be literally true.** The passing condition is a **semantic** diff over
a fixed field list, not a byte comparison of the document.

A Phase 2 diff **passes** when, for each of `/` and `/savings-hub.html`:

1. **`<title>` string is identical.** Byte-for-byte.
2. **`meta description` content is identical.** Byte-for-byte.
3. **`canonical` resolves to the same absolute URL.** The hub's canonical is `.../savings-hub.html`;
   if the route moves to `/savings-hub` the canonical necessarily changes, and **that is a
   deliberate decision to record, not a diff failure to suppress.**
4. **Every OG and Twitter tag present in this snapshot is present after migration, with an
   identical content string.** Order and formatting ignored. Tag *count* must not drop — the
   default Next.js behaviour is zero, so silence here is the expected failure mode.
5. **JSON-LD compares as PARSED OBJECTS, not as text.** `json.loads(before) == json.loads(after)`.
   Whitespace and key order ignored; every key, value and nested object equal.
6. **Nav and footer href sets compare as SETS.** Same hrefs, same anchor text, order ignored. The
   homepage set has 14 nav + 7 footer; the hub 9 + 7. **A migration that unifies the two navs
   changes the hub's set by five links — that is a product decision, and the diff should surface
   it rather than pass it.**
7. **HTTP status and redirect targets unchanged** for all six URLs in section 1, including that
   apex remains a redirect to www and `/app.html` remains 308 → `/app`.
8. **`og:image` still resolves to a 200 image/jpeg.**

A diff **fails** on: any changed title or description string; a missing OG or Twitter tag; a
JSON-LD object that differs on any key or value; a nav or footer href that disappears; any status
code change.

**Explicitly out of scope for pass/fail, and to be reported as informational:** tag ordering,
attribute quoting, self-closing style, JSON-LD whitespace, HTML byte length, and the ten
inconsistencies in section 7 — **several of which a faithful migration will carry across
unchanged, and should.** Fixing them inside Phase 2 would make the diff unreadable, which is the
argument for capturing them here and deciding on them separately.

---

## Appendix — reproduction

```bash
# status and redirects
for u in https://findmybasket.co.uk/ https://www.findmybasket.co.uk/ \
         https://www.findmybasket.co.uk/index.html \
         https://www.findmybasket.co.uk/savings-hub.html \
         https://www.findmybasket.co.uk/app https://www.findmybasket.co.uk/app.html; do
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "$u"
done

# bodies (md5s in section 1)
curl -s https://www.findmybasket.co.uk/            -o root.html
curl -s https://www.findmybasket.co.uk/index.html  -o index.html
curl -s https://www.findmybasket.co.uk/savings-hub.html -o hub.html

# robots and sitemap
curl -s https://www.findmybasket.co.uk/robots.txt
curl -s https://www.findmybasket.co.uk/sitemap-pages.xml
```

Captured 2026-08-22. Live-site capture; re-running later will not reproduce it if the pages change.
