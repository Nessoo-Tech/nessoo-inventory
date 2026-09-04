/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    const security = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ]

    return [
      // Content-hashed build assets carry no user data and are immutable, so
      // they keep normal caching. Applying no-store here (as a blanket /:path*
      // rule does) would re-download every chunk on every page load.
      {
        source: '/_next/static/:path*',
        headers: security,
      },
      {
        source: '/:path*',
        headers: [
          ...security,
          // Every other response can contain real user data. Keep it out of
          // shared caches and out of the browser's back/forward cache.
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
        ],
      },
    ]
  },
}

export default nextConfig
