/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow product images from all known retailer CDNs
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.superdrug.com' },
      { protocol: 'https', hostname: '**.scene7.com' },
      { protocol: 'https', hostname: '**.shopify.com' },
      { protocol: 'https', hostname: '**.bigcommerce.com' },
      { protocol: 'https', hostname: '**.escentual.com' },
      { protocol: 'https', hostname: '**.brandedbeauty.co.uk' },
      { protocol: 'https', hostname: '**.stylevana.com' },
      { protocol: 'https', hostname: '**.theorganicpharmacy.com' },
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: '**.cloudfront.net' },
    ],
  },
  // NO REWRITE AT `/` ANY MORE. Until item 513 this file carried
  //   beforeFiles: [{ source: '/', destination: '/index.html' }]
  // which served the hand-written public/index.html at `/` with a 200 and made
  // app/page.tsx unreachable. `/` is now app/page.tsx — the React homepage,
  // ISR at 3600s, metadata from socialTags().

  // AND `/index.html` NOW REDIRECTS TO IT. Item 515.
  //
  // The flip is what turned 515 from cosmetic into a defect. While the rewrite
  // stood, `/` and `/index.html` served the same bytes and a link to either was
  // the same link. The moment `/` became the route, the 14 references below all
  // pointed at the homepage the route had just replaced — including the site
  // logo in SiteNav.tsx:91, which is on every React page.
  //
  //   12 hrefs across 8 static pages in public/
  //    1 SiteNav.tsx:91          the logo, on every React page
  //    1 RoutineBuilder.tsx:1412 `/index.html#waitlist`
  //
  // ONE REDIRECT CLOSES ALL 14 rather than 14 edits across two languages, and it
  // also catches the ones outside the repo: public/index.html has been the
  // homepage's real URL for months and is in inbound links and bookmarks.
  //
  // NO LOOP: the rewrite that pointed `/` back at this file is gone, so `/` is
  // resolved by app/page.tsx and never re-enters this rule. Next.js evaluates
  // redirects BEFORE the public/ filesystem, so the static file stops being
  // reachable rather than being served alongside a redirect.
  //
  // `#waitlist` WAS ALREADY DEAD. RoutineBuilder's fragment has no matching id in
  // public/index.html either -- verified, 0 occurrences -- so this changes where
  // a broken anchor lands, not whether it was broken. Its own defect, not this one.
  async redirects() {
    return [{ source: '/index.html', destination: '/', permanent: true }];
  },
};

module.exports = nextConfig;
