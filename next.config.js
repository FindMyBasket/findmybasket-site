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
  // app/layout.tsx reads public/fmb-gtag-stub.js with readFileSync at module
  // scope and inlines it into the server-rendered HTML. Vercel bundles only the
  // files its dependency tracer can see, and a runtime readFileSync is not an
  // import, so without this the file can be absent from the serverless bundle
  // and the ROOT LAYOUT throws, which is every page on the site rather than one.
  // It builds and runs fine locally either way, so this is a deploy-only failure
  // mode. Do not remove it while that readFileSync exists.
  outputFileTracingIncludes: {
    '/**/*': ['./public/fmb-gtag-stub.js'],
  },
  // Tell Next.js the existing /api directory is for our static API routes,
  // not for Next.js to manage. Vercel handles them as serverless functions
  // independently.
  async rewrites() {
    // Serve the static homepage at `/` with a 200 (no redirect). `beforeFiles`
    // runs before Next.js page resolution, so it intercepts `/` and serves the
    // canonical static index.html in place. Replaces the old app/page.tsx
    // redirect('/index.html'), which served `/` as a broken 307 (no Location).
    return {
      beforeFiles: [{ source: '/', destination: '/index.html' }],
    };
  },
};

module.exports = nextConfig;
