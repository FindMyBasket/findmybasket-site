# The barcode merge programme

**Status: PAUSED, mid-programme.** Resumes in weeks rather than days.

**Written 31 August 2026 as a handover.** Everything needed to run the next sitting is here.
The work-list items (496–512) hold the reasoning and the evidence; this holds the state.
**If the two disagree, the work list is the record and this is the summary.**

---

## 1. What the problem is

Comparison happens **within a product row**. When one product exists as several rows, every page is
correct and the page that would compare them does not exist.

```
barcode 33984013186 — Solgar Extra Strength Glucosamine Chondroitin MSM
  Boots £48.00 · Beauty Flash £47.50 · Gorgeous Shop £47.50 · Beauty Bay £53.50 · Healf £38.82
  Five live product rows. Five pages. No comparison.
```

The merge joins rows that share a barcode, so one page carries every price.

---

## 2. The population, and how to measure it

**Measure with `r.active = true`.** Item 503: the first measurement omitted it and counted Superdrug,
Branded Beauty and Atelier De Glow — retailers the site does not show. Headline figures were ~1.2%
inflated; **tier counts were wrong by most of their value** (83 groups at "6+" was really 26).

```sql
-- the canonical population query
with le as (
  select distinct rp.ean_normalised ean, rp.product_id, r.name retailer
  from retailer_prices rp
  join products_active pa on pa.id = rp.product_id
  join retailers r on r.id = rp.retailer_id
  where rp.ean_normalised is not null and rp.ean_normalised <> ''
    and r.active = true                       -- NOT OPTIONAL
),
perret as (select ean, retailer, count(distinct product_id) n from le group by 1,2),
g as (
  select le.ean,
         count(distinct le.product_id) rows_n,
         count(distinct le.retailer)   ra,          -- retailer count = the batching axis
         max(per.n)                    m1,          -- >1 means same-retailer contamination
         count(distinct lower(coalesce(p.normalised_brand,p.brand))) bn,
         min(coalesce(p.normalised_brand,p.brand))  brand
  from le join perret per on per.ean = le.ean and per.retailer = le.retailer
          join products p on p.id = le.product_id
  group by le.ean having count(distinct le.product_id) > 1
)
select * from g where m1 = 1 and bn = 1;   -- the CLEAN class
```

### The four classes (item 496)

| class | test | treatment |
|---|---|---|
| **clean** | one brand, no retailer holding two rows | **mergeable** — the programme's target |
| **same-retailer contamination** | `m1 > 1` | **never merge.** A retailer selling one product twice is selling a product and a bundle — *or* a cross-brand collision, or a variant pair. The verdict holds; the bundle rationale does not always. |
| **cross-brand** | `bn > 1` | four sub-classes: spelling variant → `brand_aliases`; **brand attribution** (parent/sub-brand) → an *ownership* claim, directional, can go stale; retailer name in the brand field → feed defect; **genuine collision** → never merge |
| — | — | **Only reading names separates a wrong brand from a wrong barcode.** `it cosmetics :: "Urban Decay 24/7 Lip Pencil"` disagrees on brand and agrees on product; `nuud` vs `ouai` disagrees on both. |

---

## 3. The method

**Batches are BRAND-COMPLETE and read group by group. This is not optional and it is not ceremony.**

Four of the first week's holds were provable *only* because a whole brand was present at once:

```
Tootsie group + a "Hemp Milk" row   …and Hemp Milk has its OWN barcode
High Profile  + a "Space Cowboy" row …and Space Cowboy has its OWN barcode
Dermalogica 500ml + a 250ml row      …and the 500ml has its OWN barcode
```

**The evidence is not in the group. It is in the set.** A sample holding one and not the other shows
nothing — the misplaced row reads as an ordinary naming variant.

### The keeper rule — stated once, applied to every group

```
1. prefer a name that does NOT double the brand
2. prefer a name that CARRIES a size token        <- earned from a read, not a principle
3. tie-break on lowest id                          (oldest row, most indexed)
```

**Rule 2 was earned** (item 503): three `Mugler Alien Extraintense` rows carry the identical size-less
string in three different-size groups, so a size-less name cannot verify anything and must not become
the surviving URL.

**Rule 2 is CATEGORY-DEPENDENT** (items 507, 508): keepers carrying a size token —
`haircare 49/49 and 30/30 · skincare 33/33 · makeup 30/36`. Makeup names are shade-bearing, so the
rule falls through to the id tie-break. Correct behaviour, less work done.

**Exceptions are NAMED, never a fourth clause.** Two so far — `Ralph Lauren Polo 67` "Toillette" →
113358, `Some By Mi Retinol` "MiRetinol" → 38287. *A fourth clause would need its own complement test;
two named rows do not.* Beauty of Joseon's "Camilia" keeper STANDS: the correctly-spelled alternatives
carry no size, so rule 2 rejected them correctly.

### Running a batch

1. Build a plan table `fmb_merge_batch_<name>_<date>` with `ean, keeper, keeper_name, removed[]`.
2. **Verify the plan before running**: `keeper = any(removed)` must be 0, `removed` must be non-null,
   no id removed twice. *Item 503: the first plan put the keeper inside its own removed array because
   the member set had one row per retailer. `fmb_soft_merge_group` would have refused it — it was
   caught by reading the output, one step earlier.*
3. `alter table product_merge_log disable trigger trg_revalidate_on_merge_log;`
4. Loop `fmb_soft_merge_group(keeper, removed, note)`.
5. Re-enable the trigger.
6. **ONE** `fmb_revalidate_paths(...)` with the distinct brand slugs **and the product paths**.
7. **Read the response**: `select status_code, content from net._http_response where id = <returned id>`.
8. Verify on production: a keeper's offers, a removed id returning 308, the brand page.

**Why suppress the trigger.** `trg_revalidate_on_merge_log` fires **per row**, posts one brand path,
and swallows every failure (`EXCEPTION WHEN OTHERS THEN NULL` — item 502). A 66-row Redken batch would
have posted `/brands/redken` sixty-six times. **Batching by brand collapses the redundancy by
construction.** And the trigger never revalidates *product* paths, so before this programme every merge
left the removed page serving a cached 200 instead of its 308 for up to an hour (item 501, 4,790 rows
of history).

**Batching is for observability, not throughput.** `net.http_post` is async: an unbatched merge reports
success in seconds and the queue drains against production with every failure discarded.

---

## 4. The category model

**Holds come from what an individual NAME must adjudicate.**

| batch | groups | held | rate | shape |
|---|---:|---:|---:|---|
| mixed, fragrance-heavy | 82 | 9 | 11.0% | flankers, concentrations, refillables |
| Urban Decay | 42 | 6 | 14.3% | shades, finishes |
| Elizabeth Arden | 29 | 1 | 3.4% | 38% makeup — **the hold fell IN the makeup groups** |
| Dermalogica | 34 | 1 | 2.9% | skincare — deep range, no shades |
| Redken | 49 | 0 | 0.0% | systematic haircare range |
| L'Oréal Professionnel | 30 | 0 | 0.0% | **replication of Redken** |
| sitting 1 (PK/Ultrasun/Kérastase) | 68 | 0 | 0.0% | hair + skincare |

**Every prediction was committed to git BEFORE the batch was read.** That is what makes them checkable.

### Two falsifiers named in advance and weakened by measurement

| alternative | its best case | result |
|---|---|---|
| **range density** — deep lines hold | Dermalogica BioLumin-C: serum 30/59ml, eye serum, gel moisturiser, night restore, protector ×2 | **1 of 34** |
| **shared vocabulary** — lines sharing descriptors hold | L'Oréal Prof: `Serie Expert` on nearly everything, `Absolut Repair Molecular` across 5 product types | **0 of 30** |

**Worth more than the confirmations.** A confirmation adds a point to a curve the model already fits;
killing a rival removes an explanation that fitted the same points.

### And one result confirms the MECHANISM rather than the output

Elizabeth Arden, the only genuinely mixed brand: **makeup 1 of 11 (9.1%), skincare 0 of 16.**
The total alone could not separate *proportional* from *dominant-category* — 1 and 0 are both small on
29 groups. **The location does.** *A rate weakens a model; a clustering supports one.*

### Planning consequence

**PLAN THE READING BUDGET BY CATEGORY, NOT BY COUNT.** A fragrance batch of 49 is roughly eleven times
the adjudication of a haircare batch of 49.

---

## 5. The batching decision (item 511)

**Low-prediction brands (skincare, haircare, bath & body) are grouped into one sitting of ~60–80
groups. Makeup and fragrance brands stay one at a time.**

**This is not about trust.** Trust would justify reading *less*. **Grouping reduces ceremony and not
reading** — the plan table, the suppression, the revalidation call and the production check happen once
instead of three times, and every group is still read.

**The unit stays the BRAND and the sitting holds several.** A sitting that pooled brands would keep the
group count and lose the property that found all four provable holds.

**Report holds PER BRAND, never as a sitting total.** A total of 2 is consistent with 0/0/2 and with
1/1/0, and the first would mean a brand behaving unlike its category — the only interesting result
available.

---

## 6. Running totals, 31 August 2026

```
groups merged                317        rows removed        477
live products            105,689

REMAINING
  clean, 4+ active retailers      544     across ~100 brands, mean ~5–6
  clean, exactly 3              1,775
  clean, exactly 2              3,543
  clean, total                  5,862
  same-retailer contamination     121     never merge
  cross-brand                     631     needs reading; 4 sub-classes
```

> **It is a PROGRAMME for the 544 and a LONG TAIL below it.** The 4+ tier finishes in a few sittings.
> **5,318 of 5,862 — 91% — sit at two or three retailers**, where a merge yields a comparison of two
> prices that will often barely differ. **Value is front-loaded by retailer count, not spread evenly.**

### Brands remaining at 4+ (largest, with shape)

```
bareMinerals 27  78% MAKEUP   -> one at a time, Urban-Decay-shaped
Clarins      27  skincare     -> sitting
Avène        15  skincare     -> sitting
Pureology    13  hair         -> sitting
Weleda       13  bath_body    -> sitting
Color Wow    11  hair         -> sitting
Matrix       10  hair         -> sitting
Goldwell     10  hair         -> sitting
Mugler       22  91% FRAGRANCE-> one at a time
```

---

## 7. Open decisions — neither is answered

### (a) Is a 2-retailer merge worth a read?

**Do not answer this until the 4+ tier is done.** 3,543 groups sit at exactly two retailers. Answering
now would be **deciding the cheap work's fate from inside the expensive work's momentum.**

### (b) Item 503's remaining holds, and the symmetry argument

**The symmetry test:** does the odd name's distinctive token ever appear on a barcode **of its own**?
If it only ever appears *paired at the same size*, it is a naming convention, not a product.

| hold | token appears alone? | verdict |
|---|---|---|
| **Spicebomb "Black Leather" ×2** (`3614274158113`, `...120`) | **no** — 2 barcodes, both paired; "Dark Leather" has a solo 150ml | **RELEASABLE — not released** |
| **Black Opium "Red"** (`3614274076585`) | **no** — 2 barcodes, both paired; "Over Red" has a solo 90ml | **RELEASABLE — not released** |
| Angel vs **Angel Star** (`3439600056655`) | only 1 barcode total | **insufficient evidence** — no symmetry either way |
| Angel vs **Seducing Offer** (`3614273606417`) | only 1 barcode total | **insufficient evidence** |
| **Alien Extraintense** ×3 (`...289466/473/497`) | size-less name across 4 size-barcodes | **HOLD STANDS** — that is ambiguity, not convention |

**Insufficient evidence is not evidence of sameness.** Two of the nine are neither confirmed nor
releasable, and should stay held.

---

## 8. ★ THE UNBUILT THING THAT CAUSED A PROCESS FAILURE

**Holds live only in work-list prose. Nothing in the batch-building path reads them.**

On 31 August, sitting 1 selected every Ultrasun group at 4+ and **swept up `756848462363` — a group
item 503 had explicitly held.** It merged under the sitting's note. The outcome is correct (the hold
was wrong, and the six-for-six symmetry proves it), **but it was never a decision.** A `WHERE` clause
that did not know about a recorded judgement overrode it.

**Every batch so far excluded its own holds by hand-listing eans in whichever query built it.** That
works while one person builds one batch from a fresh read. **It does not survive a sitting, and it will
not survive a handover.**

> **BUILD THIS BEFORE THE NEXT SITTING:**
>
> ```sql
> create table fmb_merge_holds (
>   ean text primary key,
>   held_at timestamptz not null default now(),
>   item text not null,          -- 'item 503'
>   reason text not null,        -- the names that disagree
>   released_at timestamptz,
>   released_reason text
> );
> ```
>
> Batch queries exclude by `left join ... where h.ean is null`, **never by literal.** A release becomes
> an explicit update with a reason and **cannot happen by omission.**
>
> **Seed it with the eight remaining holds from item 503 before anything else runs.** The Spicebomb and
> Black Opium groups are at exactly the same risk today: the next V&R or YSL sitting would sweep them
> up the same way.

---

## 9. ★ The finding worth carrying: reading also RELEASES holds

Ultrasun looked like three holds — `Family SPF30` against **`Super Sensitive Family SPF30`** at 100ml,
150ml and 400ml. Item 503 held exactly that pattern.

```
756848462301  Family SPF30 100ml   +  Super Sensitive Family SPF 30 100ml
756848462318  Family SPF30 150ml   +  Super Sensitive Family SPF30 150ml
756848462363  Family SPF30 400ml   +  Super Sensitive Family SPF 30 400ml
756848462707  Extreme SPF50+ 100ml +  Ultra Sensitive Extreme SPF50+ 100ml
756848462714  Extreme SPF50+ 150ml +  Ultra Sensitive Extreme SPF50+ 150ml
756848462769  Extreme SPF50+ 400ml +  Ultra Sensitive Extreme SPF 50+ 400ml
```

**Six groups. Every one paired. Every pair at the same size. Two product lines, three sizes each.**
If `Super Sensitive Family` were a separate SKU it would have its own barcode and at least one group
would carry one variant alone. **Six-for-six symmetry is a naming convention.**

> **THE SAME MECHANISM AS THE TOOTSIE PROOF, RUNNING THE OTHER WAY. The evidence is not in the group,
> it is in the set** — and where Tootsie's set *created* a hold, Ultrasun's set *dissolved* three.
>
> **AND THE EPISTEMICS SHOULD NOT BE COLLAPSED. The hold was CORRECT on the information available and
> WRONG on the facts.** Reading one group, `Family` against `Super Sensitive Family` is genuinely
> ambiguous and holding was the right call. **A decision that was right to make and produced the wrong
> answer is a different thing from a mistake**, and the difference is what tells you whether to change
> the process or the judgement. Here: change the process (read the brand), not the judgement.
