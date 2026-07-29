-- Abib brand spotlight seed.
-- Apply AFTER migration 20260720120000_brand_hubs_body_html.sql.
--
-- Slug is 'abib-spotlight', NOT 'abib'. Dispatch in
-- app/brands/[slug]/page.tsx is hub-first, so seeding at 'abib' would
-- shadow the live 147-product comparison page that this body links to.
--
-- single_path_note is deliberately NULL: that note states the brand is
-- sold direct only, which is false for Abib (3 active retailers).

begin;

insert into public.brand_hubs (
  slug, display_name, accent_treatment, logo_path, eyebrow, lede, pillars,
  show_comparison, single_path_note, offer, disclosure, zone_note, range_sub,
  range_title, range_cta_label, range_cta_url,
  body_html, seo_title, meta_description, headline
) values (
  'abib-spotlight',
  'Abib',
  'dark-wellness',
  '/brand-assets/abib/logo.png',
  'Brand Spotlight',
  'How a single soothing ingredient became one of Korea’s most talked-about skincare stories',
  '[{"title": "Mild acidic", "body": "Formulated close to the natural pH of healthy skin, so reactive and blemish-prone skin can tolerate the range day after day."}, {"title": "The heartleaf core", "body": "Houttuynia Cordata at high concentration through the signature line, for calming redness and settling stressed skin."}, {"title": "Jericho Rose collagen", "body": "Built around the resurrection plant, used to help skin hold onto moisture and bounce back."}]'::jsonb,
  false,
  null,
  null,
  'Abib is a brand partner. This spotlight is presented with the brand, and sits separately from our independent price comparison, which is never influenced by a partnership.',
  'In partnership with Abib',
  'Three favourites to start with. We compare 147 Abib products across UK retailers, see the full range.',
  -- Frames the three cards as a curation. Without this the heading reads
  -- "The range" over three products on a brand where we carry 147.
  'Three to start with',
  'View all 147 Abib products',
  -- The comparison page, NOT the affiliate link: internal, no nofollow.
  '/brands/abib',
  '<p>Every so often a K-beauty brand arrives with a single, clear idea and builds something quietly convincing around it. Abib is one of those. The name means <em>the first month</em>, a fresh start, and that is more or less the promise: skincare that returns reactive, tired skin to a calm, healthy baseline. No noise, no ten-step theatrics. Just a small set of well-made products organised around soothing.</p>

<p>If you have spent any time on beauty TikTok, you have almost certainly seen Abib without knowing it was Abib. The brand took heartleaf, an ingredient most shoppers outside Korea had never heard of, and made it a household word. You can <a href="https://www.awin1.com/cread.php?awinmid=122652&amp;awinaffid=2841268&amp;ued=https%3A%2F%2Fabib.global%2F" rel="sponsored nofollow noopener" target="_blank">explore Abib''s full range at their own store</a>, or <a href="/brands/abib">compare prices across the UK retailers that stock it</a> for the lines carried by more than one. Here is what is worth knowing, and what is worth reaching for.</p>

<h2>The idea: mild acidic, gently effective</h2>

<p>Abib''s guiding principle is a formulation one: most of its products are built around a mild acidic pH, close to the natural pH of healthy skin. It sounds technical, but the point is simple. Skin that sits at its natural pH tends to be calmer, better protected and less easily irritated. Formulate to that, use restrained, purposeful ingredient lists, and you get products that reactive and blemish-prone skin can tolerate day after day. That discipline, more than any single hero, is what makes the range hang together.</p>

<h2>The heartleaf core</h2>

<p>Heartleaf, or <em>Houttuynia Cordata</em>, is the ingredient Abib is known for. It is a soothing botanical, prized for calming redness and settling stressed, blemish-prone skin, and Abib puts it at high concentration through its signature line. This is the part of the range to start with.</p>

<p><strong>Heartleaf Calming Toner.</strong> A hydrating, soothing toner-essence with a high dose of heartleaf extract, made to bring instant relief to tired or irritated skin and prep it for everything that follows. It is the natural first step in an Abib routine and the easiest entry point to the brand. <a href="/product/2744">Compare it across UK retailers.</a></p>

<p><strong>Heartleaf Calming Spot Patch.</strong> Hypoallergenic soothing patches infused with heartleaf, for gentle daily use on blemishes and reactive spots. They calm and lightly refine without stripping, the kind of low-effort step that quietly improves reactive skin over a few weeks. <a href="/product/9015">See the best price across three retailers.</a></p>

<p><strong>Heartleaf Crème and cleansers.</strong> The line extends into a calming <a href="/product/5641">Heartleaf Crème</a> and gentle <a href="/product/1606">heartleaf cleansers</a>, so you can keep the soothing thread running through the whole routine if your skin responds well to it. <a href="https://www.awin1.com/cread.php?awinmid=122652&amp;awinaffid=2841268&amp;ued=https%3A%2F%2Fabib.global%2F" rel="sponsored nofollow noopener" target="_blank">Shop the heartleaf line at Abib.</a></p>

<h2>The Jericho Rose collagen edit</h2>

<p>Abib''s second act is its collagen line, and it comes with one of the loveliest bits of ingredient storytelling in K-beauty. These products are built around Rose of Jericho extract, a plant known as the resurrection plant because it can survive near-total dryness and spring back to life when it meets water. In skincare, it is used to help skin hold onto moisture and bounce back, which is a rather perfect metaphor for what this line is trying to do.</p>

<p><strong>Collagen Eye Patch Jericho Rose Jelly.</strong> A small daily joy: jelly eye patches that hydrate and firm the under-eye area. They are one of the brand''s most loved products, and an easy, pleasurable way into the collagen range. <a href="/product/16160">Compare across three UK retailers.</a></p>

<p><strong>PDRN Collagen Overnight Mask.</strong> For a deeper treatment, the <a href="/product/2750">overnight firming mask</a> delivers intense hydration and a plumper, firmer finish by morning. A proper treat-night product. <a href="https://www.awin1.com/cread.php?awinmid=122652&amp;awinaffid=2841268&amp;ued=https%3A%2F%2Fabib.global%2F" rel="sponsored nofollow noopener" target="_blank">Shop the collagen line at Abib.</a></p>

<h2>Brightening, barrier and the newer lines</h2>

<p>More recently Abib has widened out, and two directions are worth knowing. The <strong>Glutathiosome dark-spot range</strong> targets uneven tone with a lightweight, layered approach that stays true to the brand''s gentle character, the <a href="/product/2738">Dark Spot Serum</a> and <a href="/product/5640">Dark Spot Pad</a> are both well stocked. And the newer <strong>PDRN and Ectoin barrier</strong> products lean into skin-strengthening and resilience, for anyone whose routine has matured past pure soothing. These newest lines are easiest to find <a href="https://www.awin1.com/cread.php?awinmid=122652&amp;awinaffid=2841268&amp;ued=https%3A%2F%2Fabib.global%2F" rel="sponsored nofollow noopener" target="_blank">direct from Abib</a>.</p>

<p>A word of honest guidance, because the range has grown quickly: the heartleaf and collagen lines are the coherent, proven heart of the brand. If you are new to Abib, start there. The newer and more trend-led pieces are worth exploring once you know how your skin responds to the core.</p>

<h2>How to build an Abib routine</h2>

<p>A simple, soothing routine reads like this: cleanse with a gentle heartleaf cleanser, tone with the Heartleaf Calming Toner, treat with a serum suited to your concern (soothing heartleaf, or the Glutathiosome line for tone), and seal with the Heartleaf Crème. Add the Collagen Eye Patches as a twice-weekly treat. Reactive, red-prone and blemish-prone skin tends to do especially well on this kind of considered, gentle regimen.</p>

<p><a href="https://www.awin1.com/cread.php?awinmid=122652&amp;awinaffid=2841268&amp;ued=https%3A%2F%2Fabib.global%2F" rel="sponsored nofollow noopener" target="_blank">Shop the full Abib range direct</a>, or <a href="/app">build your routine and compare it across UK retailers</a> with delivery included.</p>',
  'Abib: the K-beauty brand built on calm | FindMyBasket',
  'A brand spotlight on Abib, the K-beauty label built on heartleaf and mild-acidic soothing. What each line does, which to start with, and where to compare prices across UK retailers.',
  'Abib: the K-beauty brand built on calm'
)
on conflict (slug) do update set
  display_name = excluded.display_name,
  accent_treatment = excluded.accent_treatment,
  logo_path = excluded.logo_path,
  eyebrow = excluded.eyebrow,
  lede = excluded.lede,
  pillars = excluded.pillars,
  show_comparison = excluded.show_comparison,
  single_path_note = excluded.single_path_note,
  offer = excluded.offer,
  disclosure = excluded.disclosure,
  zone_note = excluded.zone_note,
  range_sub = excluded.range_sub,
  range_title = excluded.range_title,
  range_cta_label = excluded.range_cta_label,
  range_cta_url = excluded.range_cta_url,
  body_html = excluded.body_html,
  seo_title = excluded.seo_title,
  meta_description = excluded.meta_description,
  headline = excluded.headline;

-- Cards point at our own comparison pages, not the affiliate link: we carry
-- Abib across 3 active retailers, so per-product the comparison is the
-- better destination. BrandHubRange renders a relative buy_url as an
-- internal 'Compare prices' link with no sponsored/nofollow.
delete from public.brand_hub_products where brand_slug = 'abib-spotlight';
insert into public.brand_hub_products
  (brand_slug, name, category, benefit_tags, description, price, volume, image_path, buy_url, sort_order)
values
  ('abib-spotlight', 'Collagen Eye Patch Jericho Rose Jelly', 'Collagen', 'Hydrating · Firming · Daily', 'Jelly eye patches that hydrate and firm the under-eye area. One of the brand’s most loved products, and an easy way into the collagen range.', null, '60 patches', '/brand-assets/abib/collagen-eye-patch-jericho-rose-jelly.webp', '/product/16160', 1),
  ('abib-spotlight', 'Heartleaf Calming Spot Patch', 'Heartleaf', 'Soothing · Hypoallergenic · Gentle', 'Hypoallergenic soothing patches infused with heartleaf, for gentle daily use on blemishes and reactive spots.', null, '78 patches', '/brand-assets/abib/heartleaf-calming-spot-patch.webp', '/product/9015', 2),
  ('abib-spotlight', 'PDRN Collagen Overnight Mask', 'Collagen', 'Firming · Plumping · Overnight', 'A deeper treatment that delivers intense hydration and a plumper, firmer finish by morning.', null, '80ml', '/brand-assets/abib/pdrn-collagen-overnight-mask.webp', '/product/2750', 3);

commit;
