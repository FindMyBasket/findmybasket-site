**FindMyBasket**

*Your beauty routine. Optimised.*

**Overall Strategy Document**

Project context reference, compiled 3 August 2026. Converted to markdown and amended 3 August 2026.

> **Provenance.** This document was held as a Word file outside version control until 3 August
> 2026. This is now the canonical copy. Nine amendments plus two corrections from
> `docs/strategy-amendments.md` are applied and marked inline as **[Amended 3 Aug 2026]**.

| **What this document is** A single consolidated strategy reference for the FindMyBasket project, synthesised from the performance measurement, engineering, social operations, partnership and long-term product conversations. It is intended to be added to the project as standing context so that any new chat starts from the same strategic picture. It records position, model, constraints, principles and open questions. It is not a task list. The action list and the Claude Code briefs remain the execution layer. |
| --- |

| **Coverage note** Section 13 incorporates the FindMyLook concept and competitor analysis, working draft v0.2 dated 13 June 2026, alongside the FindMyLook material that arose in the partnership and retention conversations. Where the two diverge, the working draft is treated as the authoritative statement of the concept and the partnership conversations as the record of how it affects decisions being made today. |
| --- |

# **1. Purpose and how to use this document**

FindMyBasket is a solo operation carried alongside a full time public sector transformation role. That single fact shapes everything below. There is no team to absorb context loss, no marketing function to run channels in parallel, and no engineering capacity to hold two large workstreams open at once. Strategy therefore has to do more work than it would in a resourced business: it has to say what is deliberately not being done, and why, so that finite attention lands where it compounds.

Three layers sit beneath this document. Strategy, held here. Planning and decisions, held in chat. Execution, held in Claude Code, the Supabase project and the operating workbooks. This document should be updated when a strategic position changes, not when a task completes.

## **Reading order for a new chat**

- Sections 2 to 4 give the proposition, the competitive position and the current state. Enough to answer most questions.

- Sections 5 and 6 give the strategic spine and the single biggest constraint on the business. These are the sections that should govern prioritisation calls.

- Sections 7 to 12 are the working models: commercial, partnership, measurement, channel, data quality and product.

- Sections 13 to 15 cover FindMyLook, the long term platform vision, and what both mean for decisions being made now.

- Sections 16 and 17 cover the operating principles and the live open questions.

# **2. The proposition and the wedge**

FindMyBasket is a free UK beauty price comparison platform covering skincare, hair and makeup. The user builds a full routine as a basket, and the platform works out the best value way to buy that basket across multiple UK retailers, including delivery costs and delivery thresholds.

| **The wedge, stated precisely** Whole basket optimisation including delivery. Not single product comparison. Every competitor in the UK beauty comparison space solves the single product question. None of them solve the basket question, and the basket question is where the money actually sits for a shopper buying a routine rather than a bottle. |
| --- |

This distinction matters more than it first appears, and it has survived several attempts to soften it. An early suggestion to reposition the brand around routine building rather than savings was correctly rejected: the basket comparison mechanic is the differentiator, and weakening the claim would have removed the reason to exist. The proposition holds because delivery thresholds bite hardest exactly where unit prices are low and thresholds are high, which is the K-beauty specialists rather than bulky categories.

**[Amended 3 Aug 2026] When the wedge became evidenced.** The delivery half of this claim had no
data behind it until 1 August 2026. The optimiser coerced a missing threshold to 25 and a missing
cost to 3.95 at four call sites, and five of eleven live retailers had neither recorded, including
Boots. 54.3 per cent of in-stock rows were behind fabricated numbers, and a sixth retailer,
Escentual, held values wrong on both fields. Eleven retailers now carry terms read from their own
sites on 1 August, with an explicit `delivery_model` column and a CHECK constraint making a
malformed shape impossible. The code still carries the fallbacks, so Debenhams is understated by
£3.99 on baskets over £25 until that lands. The point is not self-criticism: the differentiator was
asserted for months before it was true, and this document is where it is recorded which claims are
supported.

**[Amended 3 Aug 2026] The wedge is EVIDENCED, not merely predicted. Found easily, on the first
search against true inputs.** The paragraph above predicts on reasoning that thresholds bite hardest
where unit prices are low and thresholds are high, in the K-beauty specialists. That prediction is
now measured. Work-list item 12 asked whether a basket exists where the goods-optimal split and the
delivery-optimal split are genuinely different arrangements. It does, and they are not rare.

A verified three-item instance, every single-retailer option and every retailer pair evaluated
exhaustively: goods-optimal is Beauty Bay plus Debenhams at £47.20 of goods, which is truly the
cheapest arrangement on goods. Delivered it costs £51.19, because the Debenhams leg is `flat` and
never free. Consolidating everything at Beauty Bay costs £48.00 of goods and **£48.00 delivered**,
free over its £30 threshold. Two different arrangements, £3.19 apart. An £0.80 unit saving bought at
a cost of £3.99 in postage.

The population, measured 3 August 2026:

| Pairing | Qualifying items | Kind |
|---|---|---|
| YesStyle to Stylevana | **1,050** | tiered, leg falls below threshold |
| Beauty Flash to Gorgeous Shop | 678 | tiered |
| Stylevana to YesStyle | 501 | tiered |
| Debenhams cheapest by under its £3.99 flat charge | **673**, of which **435** pair with Beauty Bay alone | flat retailer, never free |

**The K-beauty specialists dominate the tiered list, which is the prediction above confirmed rather
than restated.** Two qualifications, both material. First, per the amendment above, this is the first
search run against real delivery terms; every earlier one would have measured the fallbacks. Second,
the wedge only bites where two retailers stock the same product, so **the erosion recorded in
section 6 is erosion of the ground this mechanism stands on**: the comparable set was 11,449 in
`products_active` on the evening of 3 August, having lost 86 to the Boots step-down that afternoon.
The mechanism is real and the surface it operates on is shrinking.

`public/work-with-us.html:329` and this section are therefore **supported by measurement**, not
merely defensible in principle.

## **What the platform does**

- Routine builder at /app. The user assembles a basket, the optimiser runs, and the result is either a single retailer or a split across retailers, delivery included.

- Product Finder. Search by ingredient, concern or product across the catalogue.

- Saved routines with change alerts. The retention loop, covering price, stock and best value retailer changes.

- Editorial and category edits. The K-Beauty Edit and article clusters route readers into the comparison.

- Brand Spotlight hubs at /brands. Brand partner surfaces, kept visibly distinct from the independent comparison.

## **Positioning register**

Premium throughout. FindMyBasket is not a discount destination and should never be framed as one. The tagline carries the register; feed facing copy uses plain verbs instead, since "optimise" tested as too highbrow for advertising. Claims are durable and range based rather than point in time, because prices refresh and specific pairs go stale within days.

# **3. Competitive position**

The UK beauty comparison landscape divides into four clusters, and the useful finding is that almost every player competes on finding the best price for a single product. That leaves the basket and delivery question genuinely uncontested.

| **Player** | **What they own** | **Why it is not the same job** |
| --- | --- | --- |
| Cosmetify | Single product best price, with a unified checkout where they are merchant of record. Largest catalogue, deepest retailer integration, now used as infrastructure by other sites. | Their checkout is built to simplify the split, not to minimise the total. They do not optimise a multi item basket for cost including delivery. |
| SKIN | A saved shelf of favourite products with price drop notifications. Dragons' Den backed, app first, connected to prestige retailers. | Closest competitor to the saved routine concept, but still product by product and social shelf led. Execution pace has been quiet since 2024. |
| Beauty-Shelf | Creator monetisation. Routines shared by creators with affiliate integration, routing through Cosmetify for product data. | Competes for the influencer routine audience, not the price conscious self server. Not comparison at heart. |
| PriceSpy, PriceRunner, Kelkoo, BuyBox17 | Broad generalist aggregation, health and beauty as one category among hundreds. | Broad, shallow, not beauty native, and single product. |

Two adjacent tools are worth knowing without treating as competitors: SkinSort, a large ingredient analysis and routine tracking community, and Sourcerie, review led product matching. Both are recommendation rather than price.

### **The strategic flag worth holding**

Beauty-Shelf routes through Cosmetify. That is the shape of how this market consolidates: someone becomes infrastructure and others build on top. The question of whether FindMyBasket ever becomes an infrastructure provider rather than a consumer destination is premature today, but it is the right question to revisit once catalogue depth and matching quality are strong.

# **4. Current state, August 2026**

The platform launched on 8 June 2026. Supply side infrastructure is substantially de-risked: automated feed refresh, cross retailer matching, dedup, watchdog and freeze detection are all live. The primary challenge is now distribution and behaviour change, because beauty price comparison is not yet an established consumer habit in the way flight or insurance comparison is.

## **Platform**

- Eleven live UK retailers as at 3 August 2026, becoming ten once Branded Beauty's flag is flipped.
Skincare, hair, makeup, fragrance and bath and body all live. Beauty supplements are the next
category.

- **[Amended 3 Aug 2026] Catalogue figures, each on a stated denominator.** Measured 3 August 2026.
Any figure quoted externally must name its basis; this project has twice had a number disputed
because the basis was unstated.

| Measure | Value |
| --- | --- |
| All product rows | 119,946 |
| Canonical (not merged, not variant child) | 106,117 |
| In `products_active` (canonical, imaged, live offer) | 84,780 |
| Distinct brands in `products_active` | 2,066 |
| Comparable at 2+ active retailers **and in `products_active`** | 11,535 |

The last row carries its qualifier deliberately. Counting product ids with in-stock rows at two or
more active retailers gives 12,010; restricting to those also in `products_active` gives 11,535, and
only that phrasing shares a denominator with the 84,780 it is divided into. The comparison-depth
figure also carries two other defensible readings, 11,888 root-only against 12,433 including shade
children.

- Stack: Next.js on Vercel, Supabase Pro, AWIN and Rakuten as primary affiliate networks, Amazon Associates as a supporting channel.

- Note the homepage is static HTML while the rest of the site is Next.js. Not a problem to fix now, but it is the cause of several small recurring frictions including duplicated nav and styling edits.

## **Retailer roster movements**

The roster is not static and has lost names as well as gained them. Skin Cupid closed its programme.
Superdrug was retired in July. Branded Beauty closed its AWIN programme and was parked. Niche Beauty
was approved in late July and awaits onboarding, and The Fragrance Shop was accepted via Rakuten on
3 August and is queued behind it. Debenhams, Beauty Bay, Beauty Flash, Escentual, YesStyle,
Stylevana, Gorgeous Shop, Perfume Click, Atelier De Glow, The Organic Pharmacy and Boots carry the
roster, with Boots as the anchor.

**[Amended 3 Aug 2026] Churn is measurable and it is frequent.** Four departures or rotations in ten
weeks, from three distinct causes across two networks.

| Date | Retailer | Event | Caught by |
| --- | --- | --- | --- |
| 21 May to 11 Jun | Skin Cupid | programme closed, feed id nulled | nobody, 52 days |
| 19 Jul | Superdrug | Rakuten feed died | retired 27 Jul |
| 2 Aug | Gorgeous Shop | AWIN rotated the feed id | monitor, ~3 hours |
| 2 Aug | Branded Beauty | programme closed | parked, flip held |

| **Losing a retailer is less damaging than it feels** The pitch to a prospective retailer was never carried by any single logo. It is carried by Boots as the anchor, by live brand partnerships, by organic traction and by platform quality. When presenting the roster externally, present the story rather than the list: an established anchor, a department store, a beauty destination, specialist K-beauty depth, and a growing set of brand partnerships. Nobody pitching lists who they have lost. |
| --- |

## **Traction**

Traffic and revenue are early. Tracked affiliate sales are in single digits per month. Pinterest organic impressions are in the low thousands with very few outbound clicks and no saves. Instagram posts average double digit reach. Two Pinterest paid campaigns totalling roughly sixty pounds returned under one percent on spend. Organic search impressions have reached six figures, which is the most encouraging early signal because it implies future traffic rather than current traffic.

# **5. The strategic spine**

This is the most important strategic conclusion the project has reached, and it came from a correction rather than an insight. The original premise was that surfacing could be tilted toward higher commission partners to improve the blended rate. That premise is wrong, and it was right to reject it. Users choose the best value routine, the comparison results cannot be hidden or manipulated, and any attempt to do so destroys the only asset the platform has.

| **The spine** Commission mix cannot be engineered inside a comparison. It can only be engineered upstream of it. Editorial content and Brand Spotlights attract higher value shoppers and route them into an independent comparison. The comparison stays neutral; the economics are shaped by who arrives at it and what is in their basket. |
| --- |

## **Why this holds**

- It preserves trust, which is the whole business. A comparison that can be bought is worthless to a user and, in short order, worthless to a retailer.

- It gives brand partners something they can actually buy. Brands like Clarins cannot compete on price against the retailers carrying them, so price comparison has nothing to sell them. Surfacing and editorial does.

- It gives editorial a commercial purpose without corrupting it. Editorial decides the products; affiliate links follow. Never the reverse.

- It creates a clean firewall: a brand can earn a hub through partnership on CPA, or buy enhanced placement through a fee, but money never buys a better comparison result.

## **Editorial register**

Articles should be commercially constructive: equip the reader to choose and buy confidently and route them to the whole basket comparison, without overstating product claims. Helpful first, honest always. Never sceptical for its own sake, never a hard sell. This was set after a draft came back too sceptical in tone, and it is now the standing instruction.

# **6. The core constraint**

A clickout diagnosis on 1 August 2026 produced the single most important number in the business, and it reframes what growth work is worth doing.

| **Finding** | **Figure** | **What it means** |
| --- | --- | --- |
| Sessions reaching a retailer | 4.7% | The on site journey, not the traffic volume, is the binding constraint. More traffic into the current funnel mostly leaks. |
| Clickouts from the whole basket optimiser | 5 of 288 | The differentiating feature is barely being used. Almost all value is being taken from single product pages. |
| Buyable catalogue with a single stockist | 86.2% | On most baskets the optimiser has nothing to decide. Comparison depth, not optimiser quality, is the limiting factor. |
| Click to sale rate, tracked affiliate | around 3.3% | The hand off to retailers works. The bottleneck is not conversion after the click. |

**[Amended 3 Aug 2026] These figures are not safe to quote as measured.** A hydration race meant
several GA4 events never fired on cold loads until it was fixed on 29 July. `view_item`, which
qualified sessions and comparison views both depend on, was systematically undercounting by the
share of product views arriving as cold loads, which for search-engine landings is most of them. The
4.7 per cent clickout rate used comparison views as its denominator, and that denominator was
broken. The conclusion may well hold; the number should be re-derived from the week beginning
3 August before it is quoted.

**[Amended 3 Aug 2026] Comparison depth is being actively eroded, not holding steady.** Measured
3 August: 11,535 products comparable at two or more active retailers and in `products_active`,
against 84,780, so 86.4 per cent single-stockist. Consistent with the 86.2 per cent above and
restated on a named denominator. But the Superdrug retirement removed 29,525 in-stock rows and the
Branded Beauty parking removed 1,868 more, of which 1,623 were the only live offer on their product.
Roughly 8,100 products lost their only offer across the two. The constraint is not static. Every
departure worsens it, and departures now run at roughly one every two and a half weeks.

Read together these say something uncomfortable and useful. The platform converts well once a user clicks out, and gets very few users to that point. The feature that differentiates the product is the feature almost nobody reaches. And a large majority of the catalogue cannot demonstrate the mechanic at all because only one retailer stocks the item.

## **What follows from this**

- Comparison depth is a strategic priority, not a data quality chore. Every retailer added and every matching improvement moves the share of catalogue where the optimiser has something to say.

- Arrival experience matters more than reach. The preload work, where /app?routine=IDs lands with a routine pre-populated and the optimiser auto-running, is the right shape of fix: put the visitor inside the mechanic rather than in front of a blank builder.

- Paid acquisition is not viable yet. Two campaigns confirmed it. Spending to push traffic into a funnel that leaks at 4.7% converts budget into nothing. Revisit paid only after the clickout rate moves.

- Content should demonstrate the mechanic on baskets where it genuinely wins, evidenced against real optimiser output, rather than assert it generically.

| **The prioritisation test** For any proposed piece of work, ask which of three things it moves: the share of catalogue with real comparison depth, the share of visitors who reach the mechanic, or the share of visitors who click out. Work that moves none of these is probably not the next thing to do, however satisfying it is. |
| --- |

# **7. Commercial model**

## **Revenue architecture**

The platform is free to users and funded by affiliate commission, with brand partnership income as the developing second line. There are three distinct revenue mechanics, and they should be kept conceptually separate because they behave differently.

| **Line** | **Mechanic** | **Character** |
| --- | --- | --- |
| Retailer affiliate CPA | Comparison and product pages route to retailers through AWIN, Rakuten and Amazon. Commission on tracked sales. | Volume driven, low rate, uncontrollable mix. Scales only with qualified clicks. |
| Brand direct CPA | Brand partners at a higher rate, routed direct where a product is exclusive or single stockist. | Higher rate, controllable through editorial and hub surfacing. This is where mix improves. |
| Brand Spotlight placement | Flat placement fee plus CPA for net new prestige brands buying prominence they do not currently have. | The only line not dependent on traffic volume alone. Requires traffic as proof, but sells a surface rather than a click. |

### [Amended 3 Aug 2026] Amazon is a conditionally available option, not a manual one

Product data access cleared on 3 August. The Creators API returns real item data where it previously
returned `AssociateNotEligible`, so per-product lookups are possible for the first time. Feed access
remains a separate entitlement returning 403, escalated to Amazon's technical team and unresolved.

Access is conditional and rolling, and the trigger is not fully understood. The widely reported rule
is at least ten qualifying sales in a trailing thirty days, but it is community-reconstructed from an
undocumented November 2025 change, Amazon's own onboarding page returns a 404, and the 3 August
evidence rules out a threshold of thirteen or higher without establishing ten. The account stands at
twelve shipped items. Treat the margin as unknown rather than as two.

That uncertainty strengthens rather than weakens the strategic conclusion. Any feature built on
Amazon product data is least robust exactly where it would be most valuable, on the 86 per cent of
catalogue with a single stockist, because losing access reverts those pages from a comparison to a
listing. Nothing user-facing should depend on it without a defined behaviour for its absence.

One open question worth recording rather than acting on: a Prime toggle would make Amazon's
user-dependent delivery threshold knowable, which is the objection that otherwise excludes Amazon
from basket optimisation. Cosmetify includes Amazon in the US and not the UK, which is a deliberate
choice worth understanding before treating the UK gap as an opportunity.

## **Two tier retailer model**

A useful reframe emerged in the partnership work. Retailers fall into two tiers with different roles, and treating only the first as valid was leaving value on the table.

- Feed retailers. AWIN, Rakuten or Impact with a usable product feed. These power the comparison engine. Subject to the standing rule that no retailer enters the catalogue without a refresh path.

- Links only retailers. Typically self hosted K-beauty specialists that cannot supply a feed. These power editorial recommendations and carry affiliate links inside articles and hubs. A specialist without a feed is no longer a dead end.

Editorial affiliate links are standard and reader expected, subject to three conditions: clear disclosure that the piece contains affiliate links, editorial integrity so that recommendations drive the links rather than the reverse, and visible separation from the neutral comparison surfaces.

## **Two tier brand hub model**

Brand hubs also exist on two commercial bases, and the distinction protects both the revenue and the firewall.

- Existing affiliate partners receive a hub funded by nothing more than the CPA already being earned. No placement fee. The hub earns affiliate income and serves as the proof case shown to prospective paying brands.

- Net new prestige brands buy a Spotlight: flat placement fee plus CPA. The fee is justified because they are buying prominence they do not currently have, not being upsold on an existing relationship.

- The paid tier must carry extras the baseline hub does not, or a paying brand will reasonably ask why it should pay. Committed editorial cadence, category tile placement, routine builder surfacing and homepage level prominence are the candidates.

## **Unit economics**

**[Measured 15 August 2026] The commission rate is no longer an assumption.** The AWIN publisher API was read for the first time on 15 August, twelve trailing weeks back to 25 May: 993 outbound clicks, sixteen tracked sales, five hundred and twenty seven pounds seventy two of sale value, eighteen pounds twenty three of commission. **The realised blended rate is 3.45 percent.** Every commission figure below this line is now measured rather than carried.

Two P&L versions exist. The conservative version assumes a two percent blended rate, roughly eighty pence per sale on a forty pound average order value, monthly costs around two hundred and sixty eight pounds and break even near three hundred and thirty five sales a month. The optimistic version assumes eight percent, three pounds twenty per sale, costs near a hundred and sixty pounds and break even near fifty sales a month. Year one runs August 2026 to July 2027 and the base case does not reach break even within it.

**Neither break even figure survives the measurement, and both were wrong in the same direction on two separate inputs.**

- **The rate sat between them, nearer the pessimistic end.** 3.45 percent against assumptions of two and eight.
- **Average order value is thirty two pounds ninety eight, not forty.** This was wrong in both versions and it compounds with the rate, because commission per sale is the product of the two. An eighteen percent error in order value is worth as much as a large error in the rate and nobody was arguing about it.
- **Commission per sale is therefore one pound fourteen**, against eighty pence conservative and three pounds twenty optimistic.

Substituting one pound fourteen, and holding each version's own cost base: **break even is two hundred and thirty five sales a month on the conservative cost base and a hundred and forty on the optimistic one.** The range narrows from fifty to three hundred and thirty five, a factor of nearly seven, down to a hundred and forty to two hundred and thirty five, a factor of one point seven.

**What remains uncertain is now the cost base rather than the commission rate.** The two versions differed on both, and that was never stated: a four times rate difference multiplied by a one point seven times cost difference is what produced the seven times spread. Resolving the commission question was always going to leave most of the cost question untouched, and it has.

**The measurement rests on sixteen sales and should be read with that in mind.** A single hundred and eighty two pound order at The Organic Pharmacy is a third of all sale value; removing it moves commission per sale to eighty five pence and break even back to three hundred and fifteen. Taking confirmed sales only gives one pound thirty five and a hundred and ninety nine. The defensible range is roughly a hundred and twenty to three hundred and fifteen sales a month, and it will narrow on its own as the weekly pull accumulates.

**Sales are the wrong instrument for steering in any case, because nothing upstream controls them directly.** The measured figure is one point eight four pence of commission per outbound click. Break even is therefore between eight thousand seven hundred and fourteen thousand six hundred outbound clicks a month, against a current run rate near three hundred and sixty. **That is a twenty four to forty times increase in qualified clicks, and it is the binding constraint by a wide margin.** No achievable improvement in commission rate closes a gap of that size; only traffic does.

**[Verified 15 August 2026] Brand partner rates at fifteen percent are real.** The AWIN commission group endpoint was read for every joined advertiser on 15 August. Abib, iLĀPOTHECARY and Evolve Beauty all carry fifteen percent; Beauty Bay, YesStyle, Niche-Beauty and Forever Feeling carry ten. This is the first time the benchmark has been read rather than recalled, and it holds. The optimistic end is reachable in the sense that the rates exist.

**But the card also shows why the realised rate is 3.45 and not eight, and the reason is not the one the mix argument predicts.** Boots is the anchor: fifty eight of its eighty seven commission groups pay two percent, twenty six pay nothing, and Boots produced seven of the sixteen sales. The conservative two percent assumption was never a pessimistic guess. **It was Boots's rate, and Boots is the mix.**

**The finding that outranks both is that the high rate advertisers convert nothing at all.** YesStyle, Beauty Bay, Perfume Click, Beauty Flash, Gorgeous Shop and Niche-Beauty carry card rates of six and a half to ten percent, took four hundred and forty four outbound clicks between them across twelve weeks, and produced **zero sales**. At the conversion rate the rest of the estate achieves, those clicks should have produced around thirteen. Zero is not a small sample looking unlucky; it is around a one in five hundred thousand outcome, and something structural is more likely than something random.

> **This changes the shape of the mix argument.** The blended rate is not low because high commission partners receive too little traffic. They receive forty five percent of all outbound clicks and convert none of it.

That is a conversion or tracking failure wearing a mix problem's clothes, and it is worth more than the rate question: if those clicks converted at the estate's own rate and earned their card rates, commission per click would roughly triple, which is close to the entire distance between the two P&L versions' commission assumptions. **Whether the cause is broken tracking, broken deeplinks, or genuinely lower intent traffic is unknown and is the single highest value open question in the unit economics.** It should be answered before any further argument about commission mix.

The strategic spine still holds — the blended rate improves through the mix of who arrives, not through anything done inside the comparison — but it now has a precondition that was invisible before this measurement: **the high rate partners have to convert at all.**

# **8. Partnership strategy**

## **The qualifying rules**

- No retailer enters the catalogue without a refresh path: a usable network feed, a scheduled SFTP feed, a maintained scraper or a structured API. If the answer is that refresh will be figured out later, the answer is no. Stale prices erode trust faster than missing retailers do.

- Only genuinely live retailers are named as proof points in outreach. Pending applications are referenced as pipeline, never as partners.

- Explicit permission is required before building any brand hub. Never build speculatively, and never for a brand that has specified advertiser supplied creative only.

- Commission rate benchmarks are internal only and are never disclosed externally.

- **[Amended 3 Aug 2026] Losing a retailer is an expected event with a defined sequence.** Four
departures or rotations in ten weeks from three distinct causes. The runbook at
`docs/superdrug-removal-plan.md` carries the sequence, including the copy sweep that was missed on
27 July and went eight days unnoticed. The principle worth holding: anything that only works when a
departure is treated as exceptional will fail on the next one.

## **Volume gating and the reapplication doctrine**

Several rejections were not structural. LOOKFANTASTIC, Very, iHerb and others declined on traffic volume. Others, including LOOKFANTASTIC and Cult Beauty as THG properties, look like group level policy, and Sephora through Partnerize was a process barrier rather than a judgement. The correct response in every volume gated case is the same: do not re-approach on spec. Let traffic and tracked transactions accumulate, then reapply with proof.

| **Traffic earns re-engagement** This applies to quiet brand contacts as well as to rejections. When Clarins went quiet, the right response was not to chase but to let traffic growth do the work, with the Prestige Edit launch as the one legitimate reason to make contact. Re-approach with evidence, never on spec. |
| --- |

## **Strategic applications**

Some applications are worth making for reasons beyond their beauty value. Marks and Spencer, Very and TK Maxx are all cases where an established, live, converting relationship built through the beauty door becomes a warm extension when FindMyLook launches, rather than a cold start. Two conditions apply. First, do not mention the future product during the first relationship; land what is in front of them and let the extension come later. Second, the beauty use case must be genuine. A dormant approval where the feed was filtered away to nothing is worth very little later.

## **Live brand partnerships and pipeline**

- Live: iLĀPOTHECARY with a dedicated hub at fifteen percent, and Abib at fifteen percent without a product feed.

- In discussion: The Organic Pharmacy through Jess Dixon at Glass Digital, with a Brand Spotlight conversation open, and Evolve Organic Beauty with asset supply agreed.

- Clarins: quiet. The Prestige Edit is the legitimate re-engagement trigger. No price comparison framing and no basket optimisation language in any Clarins facing material.

- The Organic Pharmacy is the hub most likely to be built with comparison enabled, since they are more widely stocked. That is the case that will finally exercise the two zone hub path.

The Relationship Tracker in Google Drive is the source of truth for partnership status, but it may lag verbal updates and should always be reconciled against the current stated position. The Drive connector can read it but cannot write back to cells.

# **9. Measurement framework**

The funnel is: GA4 sessions, then comparison views, then outbound affiliate clicks by network, then tracked sales, then commission. At current volume the sale count is too sparse to steer by on a weekly basis, so the leading indicators carry the signal.

**[Amended 3 Aug 2026] Boundary: the instrument was broken until 29 July 2026.** A hydration race
dropped GA4 events fired from mount effects on cold loads. The custom `search` event returned zero
for the entire preceding period despite the server-side table recording searches, and `view_item`
undercounted by the share of product views arriving cold. Five derived metrics are date-gated and
first render from the week beginning 3 August. Any figure taken before that date is subject to the
undercount. Dated boundaries are recorded in the `platform_changes` table and should be rendered as
markers on every trend chart.

## **Headline KPIs**

- Tracked affiliate clicks per week, as the working proxy toward the sales milestone.

- Click to sale rate across all networks, rolling four week.

- Qualified sessions per week, meaning sessions that reach a comparison view.

- Commission per qualified session, which is the true unit economic.

## **Leading indicators, which move first**

- Qualified sessions per week and trend.

- Session to comparison view rate.

- Comparison view to outbound click rate. This is the 4.7% number and the one to watch hardest.

- Outbound clicks per week by network.

- Zero result search rate and search to comparison rate.

## **Lagging and milestone, watched monthly**

- Tracked sales and commission per week by network, and average order value.

- Trailing four week sales run rate against the two hundred tracked sales per month milestone.

| **The milestone maths** Two hundred tracked AWIN sales a month is the publisher eligibility threshold that Very applies, adopted here as a general maturity marker because it likely gates other mid tier programmes too. At a click to sale rate of roughly 3.3%, reaching it requires in the order of six thousand tracked outbound clicks a month. Current volume is single digit sales, so this is a medium term goal roughly twenty to forty times away, not a near term target. Very itself is a general marketplace with weak beauty fit, so qualifying matters as a signal rather than as a retailer worth heavy integration. |
| --- |

## **Data sources and automation**

| **Source** | **Automation** | **Notes** |
| --- | --- | --- |
| GA4 | Fully automated | Analytics Data API, service account, weekly cron into Supabase. |
| AWIN | Fully automated | Publisher API, weekly by advertiser, pulling both pending and confirmed since commission validates over weeks. |
| Rakuten | Semi automated | API pull where reliable, otherwise monthly CSV, since reporting lags. |
| Amazon Associates | Manual | No usable earnings API at this scale. Monthly CSV export, upserted. |
| Social | Manual weekly | Pinterest primary, Instagram secondary. Buffer provides platform aggregates. |

A data quality panel sits alongside the revenue view with a calibration loop, plus Brand Spotlight analysis with a client facing export. The data quality panel was sequenced first because it needs no external credential.

# **10. Channel strategy**

Channels are ranked by return per unit of founder attention, not by audience size. A solo operator running five channels badly loses to one running two well.

| **Channel** | **Status** | **Rationale** |
| --- | --- | --- |
| Pinterest | Primary | Best fit for outbound links and evergreen search intent. Audience is over eighty percent UK. Pin bank now runs to well over a hundred concepts with routing per pin and pre-loaded routine destinations. Cadence rises as the bank deepens. |
| SEO and editorial | Primary | The compounding channel and the one that feeds the spine. Cluster strategy centred on K-beauty routines on a UK budget, ingredient explainers and category edits, all routing to the comparison. |
| Instagram | Secondary | Brand credibility surface. Two to three posts a week, static and carousel by default. Screen recordings of the pre-loaded arrival are the only reels worth making. No active growth effort. |
| LinkedIn | Secondary | Serves partner outreach and founder credibility, which the consumer channels cannot. Building in public, industry observation and product angles on rotation. |
| Reddit | Slow burn | Talking points only. The founder writes every reply personally after moderators flagged AI generated text. No platform mentions during account warming, rare and genuinely contextual after. |
| TikTok | Parked | Not deleted. Views declined significantly, high effort and low return. |
| Paid | Suspended | Two Pinterest campaigns returned under one percent on spend. Not viable until on site conversion improves. |

## **Measurement corrections worth remembering**

- Pinterest saves were abandoned as a primary metric. Near zero saves across tens of thousands of impressions is a category constraint for a comparison utility, not a content failure. Outbound clicks are the metric.

- Video appeared to outperform static by a wide margin, but that gap was a launch boost artefact. In settled periods the advantage is modest.

- Single promoted pins should never be read as organic signal.

## **Social operating system**

All social planning lives in one consolidated workbook rather than several drifting copies. The consolidation was necessary because maintaining duplicate banks produced structural drift and contradictory versions of the same pin. The workbook covers strategy, an idea inbox for new concepts and strategic changes, the calendar, the Pinterest bank, the Instagram bank, the reels bank, the article backlog, product links, paid tests, the AWIN tracker and performance analytics. New ideas and strategic changes enter through the idea inbox rather than being written into a bank directly.

# **11. Data quality as a strategic asset**

Data quality is not a hygiene workstream on this platform. It is the product. A comparison that shows a stale or wrong price is worse than no comparison, because it converts a trust building moment into a trust destroying one.

## **Standing risks**

- **[Amended 3 Aug 2026] No price history exists.** There is no record of what any price was on any
past day. `retailer_prices` is overwritten in place on every import. A `price_history` table exists,
has never received a row, and has three maintenance functions written to keep consistent a set of
rows that has never existed. No savings figure before 27 July can be reconstructed, price-drop
alerts have a single baseline number per saved product rather than a series, and every day without a
writer is permanently unrecoverable. This is the largest structural gap found and it accrues loss
daily.

- **[Amended 3 Aug 2026] Fabricated delivery data.** Until 1 August the optimiser invented a
threshold and a cost for any retailer missing them, covering 54.3 per cent of in-stock rows. See
section 2. It is the largest data-quality finding to date because it sat directly under the
differentiating claim.

- Silent freezes. Most retailers use passthrough staging where a successful import of a stale file reads as healthy. Two live freezes were found this way, one running for weeks with prices up to double the real values. Freeze detection now exists and should be treated as core infrastructure.

- Feed quality varies enormously. Escentual is the cleanest. Some large retailer feeds supply recommended retail price rather than promotional price, which produced roughly forty percent discrepancy on one sample. Feed quality should be assumed poor until measured.

- Identifier handling. A GTIN and EAN field mismatch was discarding tens of thousands of identifiers per import, degrading matching quality across several retailers. Matching quality feeds directly into comparison depth, which is the core constraint.

- Cache staleness. Brand pages can render stale after imports and merges unless explicitly revalidated.

- Fabricated defaults. Delivery data was found to be defaulting for a majority of in stock rows. Defaults that look like data are more dangerous than missing data.

| **Verification discipline** A recurring lesson across the engineering work is that reported state diverges from actual state. Claims should be verified against the live database rather than accepted, assertions should be proved to bite before being trusted, and a check that does not run is not a check. Measure before shipping a clean architectural fix: at least one elegant category gate was disproved by measurement because it would have deleted legitimate products. |
| --- |

## **Claims discipline**

- Savings claims are range based only. No specific price pairs, no point in time figures, nothing that goes stale within a week.

- Product level gaps and routine level averages are different claims and must not be conflated. A gap that applies to one product does not apply to a whole routine.

- Externally facing figures should be verified live before publication, not carried forward from an older deck.

# **12. Retention and product roadmap**

Retention was identified early as a structural weakness. A comparison tool that is used once and forgotten has no compounding value, and the affiliate model rewards repeat visits far more than it rewards first visits. The retention loop is the answer.

## **The loop**

- Saved routines, now fixed and live after the earlier row level security and upsert bugs were resolved.

- Product level tracking rather than retailer level, consistent with the whole basket philosophy.

- Change detection covering price, stock and best value retailer, with materiality tagging so that alerts do not become noise. Log everything, alert on material.

- Identity moving to magic link authentication rather than email as identity, because routines change often as trends shift and persistent sessions suit that better.

- Delivery channel deliberately deferred until real change event volume is visible.

## **Scanner as an input, not a feature**

The barcode scanner is an input method for the retention loop, not a product in its own right. It lets someone add what they already own into a routine and opt into alerts. It is browser based rather than an app. Because identifier coverage is uneven, the scanner needs a graceful fallback: optical character recognition on the packaging, with cloud recognition preferred over on device on accuracy grounds at negligible cost, and unresolved scans captured as a demand log.

## **Category roadmap**

The original staged plan was abandoned in favour of launching skincare, hair and makeup together. Fragrance and bath and body followed. Beauty supplements are next. The roadmap principle is that a new category earns its place when it adds comparison depth, not when it adds catalogue size, because depth is the constraint and size is not.

# **13. FindMyLook: the second product**

FindMyLook is an AI wardrobe stylist and shoppable closet, delivered as a mobile app. It is the second product in the family, currently unlaunched, and it is already shaping decisions being made today. It is not a feature of FindMyBasket and should never be built as one.

| **The concept in one line** Upload your wardrobe, get an AI picked outfit each morning, and shop new pieces that match your real style, with everything you buy added back into your digital closet automatically. Lead tagline: Your wardrobe, styled daily. Alternative, leaning on the loop: The closet that styles itself. |
| --- |

## **The problem and the loop**

People own plenty of clothes and still struggle daily with what they actually own and what goes with it. Pieces get forgotten, duplicates get bought, good outfits get lost. Existing wardrobe apps prove the demand but mostly stop at organising the closet. They are weak at intelligent styling and weaker still at turning that into shopping that fits the person's taste.

The product loop is: style profile, then daily outfit pick from owned items with weather and occasion awareness, then shoppable recommendations genuinely in that style, then automatic addition of anything bought back into the closet. That last step is the retention engine and the thing no competitor has made central.

## **The wedge**

Do not launch as digitise your whole wardrobe. That is the friction wall where most apps lose users, and every market source agrees on it. Launch instead as: tell us your style, we pick today's outfit and what to buy next. The closet then fills passively through purchases plus occasional light photo sessions. Lower friction, faster perceived value, and it leads with the differentiator rather than the chore.

## **Brand and naming status**

- Name chosen: FindMyLook. It keeps the FindMy lineage, sits in the styling first lane, and avoids the pitfalls of the alternatives. FindMyFit risked fitness and sizing confusion, FindMyStyle had a deadpooled predecessor in the exact category, FindMyWardrobe implied an organiser which is the crowded space to avoid, and FindMyFashion was too generic to rank.

- findmylook.co.uk is secured. The .com and .app are worth taking to block squatters.

- Handle convention is @findmylookapp across platforms, since the exact match is taken on Instagram and TikTok.

- No formal trademark clearance has been done. A UK IPO search is needed across classes 9, 35 and 42.

| **The larger exposure is FindMyBasket, not FindMyLook** FindMyBasket is the established, revenue relevant brand and is currently unregistered. Trading builds unregistered passing off rights, but registration is far stronger and much less costly to enforce. Registering FindMyBasket is the more urgent of the two trademark actions, and it belongs on the near term list rather than the long horizon one. |
| --- |

## **Brand voice**

Style leads, always. Retailer tier stays in the background. Fast fashion partnerships will drive early affiliate revenue because of volume, breadth and easy onboarding, but the app must never read as a fast fashion app, or premium brands will not want to be associated and the styling first positioning collapses.

- Lead with the look, not the label. Sell the outfit and the answer to what to wear today, not the retailer or the price tag.

- Tier neutral language. Avoid words that pin the brand to a price point at either end, whether bargain flavoured or luxury flavoured. Let the style speak so that any retailer can sit comfortably alongside any other.

- Aspirational but accessible. Clean, confident and editorial, without alienating the shopper who funds early growth.

- Human, not algorithmic. Warm and direct, like a stylist friend rather than a recommendation engine. No AI flavoured filler.

- No em dashes, as with everything else.

## **Revenue model**

- Affiliate commission on items bought through the app. Fashion rates run in low single digit percentages, so volume and conversion quality matter far more than headline rate.

- Premium subscription for unlimited AI outfits, planning, analytics such as cost per wear and wardrobe value, look previews and priority styling. Market comparators sit around three to eight pounds a month with pro tiers up to roughly fifteen.

- Later options: clearly labelled brand sponsored placements, and a resale or circular angle.

Note the tension here, because it needs deciding before pricing. Affiliate revenue rewards sending people out to buy; subscription revenue rewards making the owned wardrobe endlessly useful. Those pull in different directions and the pricing should be designed with the tension made explicit rather than discovered later.

## **Platform: app first, and why that is a real departure**

FindMyLook is primarily a mobile app. The web presence is a marketing site plus the API and edge layer. The product lives on iOS and Android, built with React Native or Expo on Supabase. This is a meaningful departure from the FindMyBasket web stack and should be budgeted as one rather than assumed to carry over.

| **Consideration** | **Implication** |
| --- | --- |
| Native camera access | Makes wardrobe capture, bulk photographing and background removal far smoother than web. The onboarding wedge gets stronger, not weaker. |
| Affiliate tracking in app | Link based tracking that is trivial on web needs in app browser handling, deep links and network SDKs. AWIN and others support app traffic, but it is more setup. |
| Purchase detection | Auto populating the closet is harder in app than on web. May need order confirmation parsing, or manual confirmation at MVP. |
| Platform commission | Affiliate redirects to a retailer normally sidestep the fifteen to thirty percent store fees, but commerce flowing through the app itself could trigger them. Keep buying flows as external redirects. |

## **The hard parts**

- Onboarding friction. Photographing fifty or more items kills activation. Needs effortless bulk upload, automatic background removal and automatic tagging.

- Recommendation quality. What looks good together is subjective and culturally loaded, and weak versions feel gimmicky fast. This is the single biggest product risk and the most common complaint about competitors.

- Style matched shopping. In your style requires style embeddings covering silhouette, palette, formality and vibe, not category tags. This is the technical moat if it is done well.

- Catalogue and links. Keeping a clean, in stock, correctly attributed product feed across many retailers. The FindMyBasket experience transfers directly here.

## **MVP scope and early metrics**

Ship the loop, not the feature list. The ninety day scope is: style onboarding quiz producing a basic profile; in app capture and bulk upload with automatic background removal and tagging; a weather aware daily outfit from owned items; a shop your style feed with affiliate links to three to five retailers; automatic addition of purchased items with manual confirmation as the fallback; and a free tier with a soft limit plus one paid tier. Explicitly out of scope: social feed, virtual try on, resale, men and family modes, multi language.

- Activation: share of signups reaching ten or more wardrobe items in week one.

- Stickiness: share opening the daily outfit four or more days a week.

- Monetisation: affiliate click through and conversion, and free to paid conversion.

- The loop metric that matters most: share of purchases that auto populate the closet and then get worn.

## **Competitive position**

Snapshot from market sources, May to June 2026. Pricing and features move fast, so treat as a dated reference.

| **App** | **Core strength** | **Shopping built in?** |
| --- | --- | --- |
| Whering | Free first, sustainability and cost per wear, resale through Vestiaire. | Resale leaning, not style shopping. |
| Acloset | Detailed AI assisted closet setup, social outfit feed. Tiered by closet size. | Limited. |
| Indyx | Wardrobe analytics plus human stylists on a premium tier. | Human styling, not automatic shopping. |
| Cladwell | Prescriptive capsule philosophy with AI outfits and a human tier. | No strong automatic shopping loop. |
| Stylebook | Manual classic, deep control, no AI. One time payment. | No. |
| Newer AI entrants | On model look preview, weather awareness, free AI tier. | Emerging. |

### **Where the market is weak, which is the opening**

- AI styling is mostly shallow. Even the category leader produces basic combinations rather than recommendations built on colour harmony or visual coherence. Users report nonsensical pairings and the same items restyled repeatedly.

- Shopping is bolted on rather than native. Few make buy in style and auto add to closet the central loop. That loop is the differentiator.

- The upload wall is universal. Digitisation is where every app loses users, and a passive purchase fed closet sidesteps the part everyone does badly.

### **Where the market is strong, which should be respected**

- Whering owns the free plus sustainability position with real credibility. Competing head on as the best free organiser is a losing game.

- Acloset's social layer drives engagement that will not be matched at launch.

- Indyx's human stylist hybrid serves the high intent, willing to pay segment.

| **Positioning conclusion** There is a genuine gap for a styling and shopping first app where the wardrobe builds itself through what you buy. Compete on recommendation quality and the shoppable auto closet loop, not on being the best free organiser. The risk is execution on the styling intelligence: if the outfits feel dumb, this is just another closet app. Engineering effort should concentrate there. |
| --- |

# **14. The FindMy platform: long term vision**

This section is forward looking context, not near term scope. FindMyLook still ships as a standalone app first. What follows records where the family of products is heading and what triggers the move from solo bootstrap to funded platform.

## **North star**

The naming direction clarifies what the brand actually is: not a lifestyle everything app, but a comparison and recommendation super brand. The through line is find me the right one, and the best deal on it, under one identity and one preference profile. FindMyBasket compares beauty. FindMyLook styles and shops. Travel, insurance and utilities are classic comparison and switch plays. The moat is the shared profile: one login that knows the user and finds them the best of everything.

| **The discipline that makes the ambition survivable** Everything app for lifestyle is also the phrase that has sunk countless products, because breadth without depth means no reason to exist in any one category. Every successful super app started as one thing done extremely well, earned the user, then expanded from strength. FindMyBasket and FindMyLook must be genuinely good on their own before the platform is more than a deck. |
| --- |

## **Why FindMyLook is the flagship**

Most FindMy verticals would be pure comparison tools. FindMyLook is the only one that is a styling and creation product rather than a price table, and that is a feature rather than an inconsistency. It is the most defensible expression of the brand and the product that makes the family feel distinctive rather than utilitarian. It earns the user and the preference profile that the comparison verticals then monetise.

## **The core capability and the real moat**

Visual AI is the enabling technology, not a product. It does three distinct jobs: automatic tagging on upload to solve onboarding friction, visual similarity search through embeddings to power shop your style and match to buy, and background removal for clean product shots. In practice that is a combination of a vision service for tagging, an embeddings model for similarity, and a background removal tool, chosen at build time because the options move fast.

| **The defensible asset is not the wardrobe** It is the aesthetic profile: an engine that learns a person's taste from images and recommends things that fit it. Clothes are simply the first and highest frequency application. That is a stronger account of why the lenses connect than a shared affiliate spine, which is merely mechanical. Own the embeddings layer rather than depending on one large platform's visual search product, which is a risk on pricing, access and competitive alignment. Do not build the moat on someone else's API. |
| --- |

## **Sequencing discipline**

- Grow FindMyBasket, then FindMyLook, then connect them. The platform emerges from successful verticals; it is not the starting point.

- Each product must stand alone and earn users before any cross sell is worth anything.

- Build the shared spine deliberately even while the products look separate. If they quietly share the user profile and affiliate engine from early on, the claim that it is already a platform is real at raise time rather than retrofitted.

## **The holiday keystone**

A holiday is the event that pulls every vertical together. Somewhere warm means summer outfits, sun protection and travel skincare, and the trip itself. A shop for your holiday flow is the natural moment the products stop being separate apps and become one platform. It is an ownable wedge and a far clearer story than comparing everything.

## **Future lenses, long horizon**

| **Lens** | **Assessment** |
| --- | --- |
| Travel comparison | Harder vertical. Flights and hotels are dominated by incumbents with deep inventory deals and thin margins. Long horizon, and validate demand before committing. |
| Holiday insurance | Fits the affiliate model well mechanically, since insurers pay referral commission that slots into the existing engine, but it is FCA regulated. Even introducing customers can require authorisation depending on structure, and a comparison of policies is more likely to need it than a bare referral. Citizens Advice board experience is directly relevant founder credibility here. |
| Home and furniture | The machinery transfers, including catalogue, affiliate and visual AI, but the self building closet loop does not. Nobody dresses from their sofa each morning and homeware is not a weekly purchase, so the daily use engagement is absent. Belongs as its own focused surface after FindMyLook has won its space, never bolted onto the fashion app. |
| Insurance and utilities generally | Large, established, heavily advertised markets with deep provider panel deals. Strong monetisation per conversion, high barrier, high regulatory load. Post raise, with a team, with compliance. |

## **Resale**

Peer to peer resale closes the full lifecycle: buy through the app, item enters the closet, stops being worn, gets resold, leaves the closet. The structural advantage is real, because users have already photographed and catalogued the item, so listing is a tiny step where Vinted and Depop sellers start from scratch.

But it is the heaviest thing on the list, heavier than insurance. Two sided cold start, payments and money handling including escrow and chargebacks, trust and safety with an ongoing moderation cost, shipping, and entrenched incumbents. The revenue mechanic also differs, being commission on sales rather than affiliate. Full peer to peer is a post raise, with a team build.

| **The lighter interim option, potentially near term** A list this on an existing marketplace action that deep links and pre fills the listing from wardrobe data. It delivers much of the circular loop value and the convenience edge without taking on payments, shipping or disputes, and it tests whether users actually want to resell before the heavy machinery gets built. |
| --- |

## **The investment inflection point**

The move to a connected, multi vertical, partly regulated platform is the natural point to raise. The verticals are bootstrapped solo while they are single products; the step change needs capital and a team.

- Bootstrapping to real users and real affiliate revenue first means raising on traction plus a credible expansion rather than on an idea. The slow path de-risks the raise.

- Knowing the limits of a solo founder, on engineering scale, compliance and travel partnerships, reads as maturity to investors rather than weakness.

- Keep structure and equity clean now. Reaching the raise with one wholly owned entity, clear intellectual property and a simple cap table avoids the most common first raise problem.

- Track investor metrics from day one: users, activation, affiliate conversion, retention and revenue per user. Low cost to capture early, painful to reconstruct later.

| **The arc** Bootstrap the verticals, connect them into the holiday keystone, and that is the raise. Capital then funds the team, the travel vertical, the regulated insurance layer and the full resale marketplace. The lighter list to external marketplace option can come sooner. |
| --- |

# **15. What FindMyLook means for decisions today**

FindMyLook currently justifies choices without consuming build capacity, and that balance is worth protecting deliberately. The following are the live implications.

## **Partnerships**

- Partner selection carries option value. A retailer with modest beauty relevance may still be worth pursuing if it is central to the later product. Marks and Spencer, Very and TK Maxx are all in that category, and TK Maxx in particular may fit FindMyLook better than FindMyBasket, with the current beauty conversation as the foot in the door.

- Do not mention FindMyLook in first substantive partner conversations. Introducing a second unlaunched project before delivering on the first reads as getting ahead of yourself. Land the relationship, then extend it.

- Honesty on volumes now is what makes the later conversation possible. Declining to invent forecasts builds the credibility that makes a partner willing to work with you again on a new product.

- Every relationship taken for FindMyLook reasons must be made genuinely active on beauty. A dormant approval is not an asset.

- Confirm whether existing affiliate agreements cover a new property. On AWIN, findmylook.co.uk and the app would be added as a new property with per merchant applications; direct agreements need checking for approved site and category scope.

## **Architecture**

Anything built for the retention loop should be assessed on whether it generalises, because the shared spine is the platform story and it has to be real rather than retrofitted. Product tracking, change detection, materiality rules, magic link identity, the shelf concept and the scanner with visual fallback are all reusable across a fashion product. Anything hard coded to beauty categories in those layers is a cost paid twice.

Two things transfer with particular force. The catalogue normalisation discipline built for shade, size and brand deduplication maps directly onto clothing attributes. And the Supabase data layer with scheduled imports carries over, while the front end does not, since FindMyLook is app first and the web layer becomes marketing and API surface rather than the product.

## **Legal and structure**

- Register FindMyBasket as a trademark. It is the established revenue relevant brand and is currently unprotected, which is the larger of the two exposures.

- Run a formal UK IPO search for FindMyLook across classes 9, 35 and 42 before committing further to the name publicly.

- One entity with FindMyLook as a trading brand is the simplest start. Separating later would ring fence liability and allow raising against one product without entangling the other. Revisit before any outside money.

- Claim the social handles, and take the additional domains if the cost is low enough to be worth blocking squatters.

## **Validation before build**

- Pressure test the wedge with ten to fifteen target users before building anything. The specific question is whether they would accept a closet that builds through purchases rather than uploads.

- Prototype the style embedding recommender on a small clothing dataset, and prove pairing quality is meaningfully better than what the market currently ships. This is the make or break, and it can be tested at low cost.

- Confirm affiliate networks and rates for target fashion retailers.

- Decide the subscription against affiliate tension before pricing.

# **16. Operating principles**

## **Working method**

- Discover first. Every Claude Code prompt investigates and reports before any edits. Mutating steps are gated actions triggered deliberately, never by the agent.

- Dry run before destructive steps. Select before update. Stop and report before anything irreversible.

- Quality before scale. Fix trust critical issues before any marketing push, so that poor metrics are attributable to messaging rather than to the product.

- Never run two large category expansions at once.

- Whenever work is agreed for execution, produce the Claude Code brief as a downloadable document without being asked. Briefs follow discover first discipline, list mutating steps as gated actions requiring explicit approval, include dry run selects before updates, and state acceptance criteria plus explicit out of scope items.

- Downloadable file deliverables are preferred over inline text for anything substantial.

- Planning and decisions happen in chat; code, database operations and deployments happen in Claude Code via a paste prompt workflow.

## [Amended 3 Aug 2026] Verification conventions

Nine conventions established over the fortnight to 3 August 2026, each from a real failure. They
govern how work is done rather than what work is done, and each is recorded with its instances in
`supabase/migrations/README.md`.

- A defensive clause never fails loudly when it is a no-op. Only reading the resulting state proves
it did something. Five instances: a GRANT that restricted nothing, a REVOKE that left PUBLIC, an
ALTER DEFAULT PRIVILEGES that cannot strip PUBLIC EXECUTE, an ON CONFLICT naming no constraint, and
a test suite that ran no tests.

- A check that does not run is not a check, and a guard nobody has watched fail is not known to be a
guard. Prove it bites before trusting it, and prove it passes as well, or a permanently red check
becomes noise.

- A guard that fires wrongly is as damaging as one that never fires, and worse in one way: it trains
the habit of dismissal, and the habit outlives the fix.

- Anything phrased pending, awaiting, open or not yet done carries the date it was written. A stale
finding is believed; a stale request solicits, and converts a reader's diligence into rework.

- Delete a stale request. Retitle a stale finding that still justifies something live. The test is
not whether it is still true but whether anything still standing depends on its reasoning.

- Absent records are found only by looking; stale ones by tripping over them. Discussing a thing at
length produces the same familiarity as having documented it.

- A migration must never compute its own scope. Explicit lists, not predicates, because a migration
is replayed against a schema that has moved.

- Code written to tolerate a data condition is a record that the condition exists, and it is the
record nobody reads as one.

- Reported state diverges from actual state. Verify against the live system, not against a summary.

## **House style, applying to every output**

- Never use the common word for lowest price. Use best value, best price, or costs less.

- No em dashes anywhere. Use commas, full stops, colons, or restructure.

- Savings claims in ranges only. No specific price pairs, no point in time figures.

- Multiple UK retailers, never every UK retailer.

- British English throughout. Premium register. Never a discount destination.

- No retailer names and no price figures in social captions or on screen overlays.

- For press, PR and social: Hampshire based, background described as public sector transformation only, no employer, no certifications.

## **Founder constraints to design around**

- Solo operator with a full time role. Sequential workstreams, not parallel ones.

- Direct working style, fast to catch factual errors, expects errors to be owned and corrected rather than qualified.

- Strategic and commercial decisions are made by the founder. The role of analysis is to make the trade offs visible, not to make the call.

# **17. Open strategic questions**

These are unresolved positions rather than tasks. Each one changes the shape of the plan depending on how it is answered.

| **Question** | **Why it matters** |
| --- | --- |
| ~~Which P&L commission assumption is correct, two percent or eight percent?~~ **ANSWERED 15 August 2026: neither. The realised blended rate is 3.45 percent and average order value is thirty two pounds ninety eight rather than forty, giving one pound fourteen per sale and break even between a hundred and forty and two hundred and thirty five sales a month.** | Kept visible rather than deleted, because the answer moved the question. Resolving the rate left the cost base unresolved, and the two versions always differed on both. See section 6. |
| Which cost base is real, a hundred and sixty pounds a month or two hundred and sixty eight? | This is now the whole of the remaining spread in the break even figure, and it is the half of the disagreement nobody was arguing about. |
| Why do the high commission advertisers convert nothing? | Four hundred and forty four outbound clicks across twelve weeks to advertisers paying six and a half to ten percent, and zero tracked sales. Broken tracking, broken deeplinks and low intent traffic imply completely different responses, and the difference is worth more than the commission rate question was. |
| What lifts comparison depth fastest: more retailers, better matching, or narrowing the catalogue to items with real depth? | 86.2% single stockist coverage is the core constraint. These three routes have very different costs and very different timelines. |
| Should the paid Spotlight tier be defined and priced now, or after the first hub proves out? | Defining it early risks selling something undelivered. Defining it late means the Prestige Edit launches without a price. |
| Does the platform stay a consumer destination, or eventually become infrastructure others route through? | Beauty-Shelf routing through Cosmetify shows that consolidation shape exists. Premature today, but it changes what is worth building. |
| When does FindMyLook move from strategic background to active build? | It currently justifies partner choices without consuming build capacity. That balance holds only while it stays unbuilt, and the app first stack is a real departure to budget for. |
| Subscription or affiliate as the primary FindMyLook revenue line? | They pull in opposite directions: one rewards sending people out to buy, the other rewards making the owned wardrobe endlessly useful. This has to be settled before pricing, not discovered after. |
| One entity or two? | One entity with FindMyLook as a trading brand is the simplest start. Separating later ring fences liability and allows raising against one product. The decision has to be revisited before any outside money. |
| What is the brand architecture with six lenses rather than two? | With two products the FindMy prefix is a portfolio touch. With six it is a branding system: one app with modes, a family under a parent, or a master brand with sub brands. It affects entity structure, domains, app store presence and how a raise is framed. |
| Is the static homepage worth migrating into the Next.js app? | Not urgent, but it is the source of recurring duplicate work and canonical URL friction. |

| **Maintaining this document** Update it when a strategic position changes: a new revenue line, a channel promoted or demoted, a constraint resolved, an open question closed. Do not update it for completed tasks. If a section starts describing what was done rather than what is believed, it has drifted into being an action list and should be trimmed back. |
| --- |

FindMyBasket Strategy  |  August 2026  |