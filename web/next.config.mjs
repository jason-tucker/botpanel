// @ts-check

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Standalone output ships only the files the server needs into .next/standalone,
  // which our Dockerfile copies into the runner stage. Slim image, no node_modules.
  output: 'standalone',

  // basePath is set per-image at build time so internal `<Link>` navigation
  // preserves the /dev prefix on the dev clone. CI passes
  // NEXT_PUBLIC_BASE_PATH=/dev for the dev branch build, no value for main.
  // Read in next.config so the value is baked into the bundle (basePath is
  // a build-time concern in Next.js — can't be flipped at runtime).
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,

  // Allowlist Discord's CDN so <Image> can serve avatars with auto-WebP,
  // lazy loading, and srcset for high-DPI. Without this Next.js refuses to
  // optimize the URL and we fall back to raw <img> which skips all of that.
  // Next 15+ prefers remotePatterns over the legacy `domains` array.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.discordapp.com', pathname: '/**' },
    ],
  },

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
