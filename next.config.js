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
  //
  // public/index.html IS STILL SERVED, at its own path, and it still declares
  // <link rel="canonical" href="https://www.findmybasket.co.uk/"> — i.e. it
  // points at a page that is no longer its own content. 12 hrefs across 8 static
  // pages plus SiteNav.tsx and RoutineBuilder.tsx still link to it. Item 515.
};

module.exports = nextConfig;
