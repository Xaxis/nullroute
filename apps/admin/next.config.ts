import type { NextConfig } from 'next'

// The page policy (script nonces) is set per request in src/proxy.ts; these hold for every response.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // A private console. Nothing here is for a search engine.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
]

const config: NextConfig = {
  // `next dev` builds into its own folder, so a `next build` cannot empty the
  // directory a running dev server reads from.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }])
  },
}

export default config
