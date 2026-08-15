> **HELD — NOT FOR PUBLICATION.** Do not copy this into `public/articles/`. That directory
> is served statically, so putting a file there IS publishing it; there is no draft state
> in it. This file lives in `docs/drafts/` because it is version-controlled, reviewable and
> served to nobody.
>
> **THE GATE IS TOMORROW'S 04:30 READ, NOT TODAY'S FLIP.** Boots' two config values —
> `category_path_must_contain` and `supplements_path_prefixes` — were written on 15 August
> with Baseline A captured first. **The catalogue has not moved yet.** The supplements
> category stands at **93 products, 23 comparable, 19 of those one brand's flavour
> variants**, and these articles route to `/supplements` promising a comparison "across
> multiple stockists". That claim is not currently true. It becomes true when the read
> confirms the move to roughly 1,715, not when the config was written.
>
> **PUBLISH TOGETHER OR NOT AT ALL.** All four cross-link to each other. A partial publish
> leaves dead internal links in whichever went first, so the template's five steps apply to
> all four as a single act.
>
> **STILL TO DO, AND NONE OF IT IS THE COPY** (`docs/article-template.html`):
> 1. convert markdown to HTML on the template
> 2. keep the mandatory `.disclosure` paragraph — this is the affiliate disclosure, compliance rather than styling
> 3. delete the `<meta name="robots" content="noindex">` line
> 4. make the slug match in `<title>`, `canonical`, `og:url` and the JSON-LD `url`
> 5. add a card to `public/savings-hub.html` and a line to `app/sitemap-pages.xml/route.ts`
>
> Copy conventions already satisfied: no em dashes, no "cheaper"/"cheapest", links use
> `/articles/{slug}.html` and `/app`. See work-list item 115.

---

# How to Read a Supplement Label

**SEO title:** How to Read a Supplement Label (UK Guide)
**Meta description:** A plain-English guide to reading a supplement label: serving size, servings per container, NRV percentages and what the front of the pack does not tell you.
**URL slug:** `how-to-read-supplement-label`
**Cluster:** publishes with `supplement-price-per-serving`, `supplement-capsules-vs-powder`, `supplement-dose-explained`

---

A supplement label tells you three things that actually matter when you are choosing between products: what is in it, how much of it is in each serving, and how many servings the pack contains. Everything else on the front of the pack is marketing. Once you can read those three things quickly, you can compare two products properly and work out which is genuinely better value, rather than being swayed by the biggest number or the nicest bottle. This guide walks through each part of the label so you know exactly what you are looking at.

To be clear up front, this is about reading the information on the pack, not about what any supplement does for you. For anything to do with whether a supplement is right for you, your health, or any medication you take, speak to a pharmacist or doctor. Reading the label is the first step; it is not a substitute for that advice.

## The front of the pack: the headline, not the detail

The front is designed to catch your eye, so treat it as a starting point rather than the full picture. It usually shows the product name, the headline ingredient, a strength figure such as a milligram amount, and the pack count. All of that is useful, but none of it is enough on its own, because the front rarely tells you the serving size. A pack might show a large strength number and a big count, but if the serving is two or three units rather than one, the pack contains fewer actual servings than the count implies. The front of the pack raises the questions. The back answers them.

## The supplement information panel: where the real detail lives

Turn the pack over and you will find a structured panel, sometimes called the nutrition or supplement information. This is the part to read carefully. It lists, per serving, each active ingredient and the amount of it. Read that phrase carefully: per serving. Every figure in this panel is expressed for one serving, and the serving may be one unit or several.

Alongside each ingredient amount you will often see a percentage. In the UK this is typically the percentage of the Nutrient Reference Value, or NRV, which is a standard daily reference amount used for labelling. A figure of, say, 100 percent NRV means one serving provides the full reference amount for that nutrient. Not every ingredient has an NRV, so newer or non-vitamin ingredients often show an amount with no percentage next to them, which is normal.

## Serving size and servings per container: the two numbers that decide value

These two figures, usually near the top or bottom of the information panel, are the most important on the whole label for anyone comparing products.

Serving size tells you how many units make up one serving. One capsule, two capsules, a scoop, a sachet. This matters because all the ingredient amounts are stated per serving, so if the serving is two capsules, you take the panel's figures as the amount from two capsules, not one.

Servings per container tells you how many of those servings the pack holds. This is not always the same as the number of units in the pack. A pack of 120 capsules with a two-capsule serving contains 60 servings, not 120. That distinction is the single most common source of confusion when people compare packs, and it is why the [companion piece on comparing supplements per serving](/articles/supplement-price-per-serving.html) exists. Get these two numbers and you can work out how long a pack lasts and what each serving costs.

## The ingredients list

Below the information panel is the full ingredients list, in descending order by weight. This includes not just the actives but the other components: the capsule material, any bulking agents, flow agents, flavourings, sweeteners and colourings. If you avoid particular ingredients, or you want a vegetarian or vegan capsule, this is where you check. The presence of these other ingredients is completely standard and does not indicate quality either way; they are what hold the product together and make it usable.

## Form and directions

The label states the form, whether capsule, tablet, powder, gummy, liquid or sachet, and gives directions for use, typically how many units to take and when. The form affects how many units you take per serving and how the product fits into your day, which in turn affects how long a pack lasts. If you are weighing up formats, the [guide to capsules, powders and gummies](/articles/supplement-capsules-vs-powder.html) covers what the format changes and what it does not.

## The rest: dates, storage, warnings

The remaining information is practical. A best-before or expiry date, storage instructions, and standard warnings such as advice to keep out of reach of children, not to exceed the stated dose, and that supplements are not a substitute for a varied diet. UK products will also carry the manufacturer or distributor details. Warnings and advisory statements are worth reading, particularly if you are pregnant, breastfeeding, taking medication or managing a health condition, in which case checking with a pharmacist or doctor before starting anything is the right move.

## Reading two labels side by side

Once you can read one label, comparing two is straightforward. Line up the serving size, the amount of the active you care about per serving, and the servings per container. Two packs that look similar on the front can differ significantly once you account for serving size and serving count, and that is exactly where a sensible comparison is made. It is also where the front-of-pack strength number can mislead, because a higher figure per serving means less if the serving is larger or the pack holds fewer servings.

If the strength figure itself is what you are trying to interpret, the [guide to what the dose on the front of the pack means](/articles/supplement-dose-explained.html) covers the units and the percentages in more detail.

## Where to go next

Reading the label well is what lets you compare supplements on a fair basis rather than on packaging. When you are ready to compare specific products, you can [browse beauty supplements across UK retailers](/supplements) and see the same product priced across multiple stockists with delivery included, so the comparison reflects what you would actually pay to get it delivered. Once you have chosen, [price your basket](/app).
