/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Fully static. There is no server, no API route, and no runtime: the site is
  // a folder of files. That is the correct shape for documentation, and it also
  // means the deployed artifact cannot do anything the source does not show.
  output: 'export',

  // `next dev` and `next build` share an output directory by default, so a dev
  // server left running while CI builds rewrites the build's manifests
  // underneath it. The failures that produces are baffling: a stylesheet that
  // 404s, or a page the build swears does not exist.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',

  // docs/ lives at the repository root, outside this workspace, because the
  // documentation is the product and this site is one renderer of it. Next
  // needs the tracing root or it infers the wrong one in a monorepo.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  // A pinned build id. Next generates a random one by default, which lands in
  // the output and makes two builds of the same commit differ. The site is not
  // in MANIFEST.lock, but a reproducible site is still worth having: it is how
  // you check that a deployed page matches the source it claims to come from.
  generateBuildId: () => 'nullroute',

  images: {
    // No optimiser at all under `output: export`, and no remote patterns are
    // configured, so nothing off-origin can reach it.
    unoptimized: true,
  },
}

export default nextConfig
