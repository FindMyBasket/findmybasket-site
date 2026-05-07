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
  // Tell Next.js the existing /api directory is for our static API routes,
  // not for Next.js to manage. Vercel handles them as serverless functions
  // independently.
  async rewrites() {
    return [];
  },
};

module.exports = nextConfig;
