import type { NextConfig } from 'next'
import { BASE_PATH } from './src/base-path'

// The page policy (script nonces) is set per request in src/proxy.ts; these hold for every response.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  // The site's own value, word for word: these pages are served on its origin, and a browser keeps
  // whichever HSTS header it saw last.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // A private console. Nothing here is for a search engine.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
]

const config: NextConfig = {
  // `next dev` builds into its own folder, so a `next build` cannot empty the
  // directory a running dev server reads from.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  poweredByHeader: false,
  basePath: BASE_PATH,
  experimental: {
    serverActions: {
      // Requests reach this project through nullroute.diy's deploy, so the host it sees can be its
      // own vercel.app address while the browser's Origin is nullroute.diy. src/proxy.ts still
      // refuses an action from any origin but this console's.
      allowedOrigins: ['nullroute.diy'],
    },
  },
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }])
  },
}

export default config
