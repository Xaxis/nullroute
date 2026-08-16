/**
 * Asset import shapes.
 *
 * Declared here rather than by pulling in `vite/client`, which also declares
 * `import.meta.env` and a pile of other ambient globals this package has no
 * business reading. The device frontend takes no configuration from the
 * environment.
 *
 * `?url` is what keeps the QR decoder's WebAssembly on our own origin: the
 * bundler emits it beside the application instead of leaving the library to
 * fetch it from a CDN. See packages/ui/src/lib/scanner.ts.
 */

declare module '*?url' {
  const url: string
  export default url
}

/** Imported for its side effect. The bundler emits it; nothing reads it. */
declare module '*.css' {}
