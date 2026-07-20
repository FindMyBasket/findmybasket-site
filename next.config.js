/** @type {import('next').NextConfig} */
const nextConfig = {
  // sanitize-html (brand hub body_html) depends on htmlparser2, which is
  // ESM-only. Bundling it through webpack fails with "ESM packages need to be
  // imported"; leaving it external means Node require()s it at runtime on the
  // server, where it works. It is only ever used server-side.
  experimental: {
    serverComponentsExternalPackages: ['sanitize-html'],
  },
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
