// @ts-check

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Standalone output ships only the files the server needs into .next/standalone,
  // which our Dockerfile copies into the runner stage. Slim image, no node_modules.
  output: 'standalone',

  // Tighten the response headers. Cloudflare adds its own on top; this defends
  // even if traffic ever reaches the origin directly.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },

  experimental: {
    // Catches buggy server actions early.
    typedRoutes: false,
  },
}

export default nextConfig
