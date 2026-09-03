import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { connect } from 'node:net'

const SOCKET = process.env['NULLROUTE_SOCKET'] ?? '/tmp/nullrouted.sock'

/**
 * Forward POST /ipc to the daemon's Unix socket.
 *
 * The browser cannot open a Unix socket, and it must not be able to reach
 * anything else, so a proxy is required rather than convenient. This one is the
 * development stand-in for the small local forwarder that runs beside the kiosk
 * on the device. Both bind to loopback only, and neither is reachable from off
 * the machine.
 *
 * Written as a plugin rather than using Vite's `server.proxy` because that
 * proxies HTTP to HTTP, and the daemon speaks newline-delimited JSON over a
 * Unix socket. One request, one line, one response line.
 */
function daemonProxy(): Plugin {
  return {
    name: 'nullroute-daemon-proxy',
    configureServer(server) {
      server.middlewares.use('/ipc', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
        })

        req.on('end', () => {
          const socket = connect(SOCKET)
          let buffer = ''

          socket.on('connect', () => {
            socket.write(`${body.trim()}\n`)
          })

          socket.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8')
            const newline = buffer.indexOf('\n')
            if (newline === -1) return
            socket.end()
            res.setHeader('content-type', 'application/json')
            res.end(buffer.slice(0, newline))
          })

          socket.on('error', (err: Error) => {
            // Reported plainly. A proxy that swallowed this would leave the UI
            // rendering a lock screen with no attestation behind it, which is
            // the reassurance a user came to check.
            res.statusCode = 502
            res.setHeader('content-type', 'application/json')
            res.end(
              JSON.stringify({
                error: {
                  code: 'daemon-unreachable',
                  message: `Could not reach the daemon at ${SOCKET}: ${err.message}`,
                },
              })
            )
          })
        })
      })
    },
  }
}

/**
 * Relax the document's CSP for the dev server, and only for the dev server.
 *
 * packages/ui/index.html carries the device's real policy, and it is strict on
 * purpose: `default-src 'none'`, no `unsafe-inline` anywhere. That works for the
 * production build, where Vite emits external script and style files.
 *
 * It does not work for `vite dev`, which injects CSS as inline <style> elements
 * and opens a WebSocket for hot reload. Under the shipped policy both are
 * blocked, so `make dev` rendered the whole device UI with no stylesheet at all:
 * black text on a transparent background, every screen structurally correct and
 * visually broken. The console said so and nothing else did, because every CSP
 * check in this repository reads the PRODUCTION build.
 *
 * WHAT THIS TRADES. Dev now differs from the device in one specific way, which
 * means a component that used an inline style would work here and be blocked
 * there. That is why tools/checks/check-device-ui.mjs loads the built bundle under the
 * real policy and fails on any violation: this relaxation is invisible to it.
 *
 * The replacement is deliberately narrow and deliberately noisy. It rewrites the
 * two directives Vite needs and leaves the rest of the policy exactly as
 * shipped, so a directive that gets weakened in index.html is weakened in dev
 * too rather than being masked here.
 */
function devCsp(): Plugin {
  const DEV_ORIGIN = `ws://127.0.0.1:${String(5180)}`
  return {
    name: 'nullroute-dev-csp',
    // Serve only. The production HTML is emitted untouched.
    apply: 'serve',
    transformIndexHtml(html) {
      const relaxed = html
        // Vite injects <style> elements for every CSS module in dev.
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        // The hot reload socket. A different scheme, so 'self' does not cover it.
        .replace("connect-src 'self'", `connect-src 'self' ${DEV_ORIGIN}`)
      if (relaxed === html) {
        // The directives moved or were renamed. Failing here is right: the
        // alternative is a dev server that silently renders unstyled again.
        throw new Error(
          'nullroute-dev-csp: could not find the style-src and connect-src directives in ' +
            'packages/ui/index.html. The dev server needs both relaxed, and the device needs ' +
            'neither, so fix this rather than deleting it.'
        )
      }
      return relaxed
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), daemonProxy(), devCsp()],
  server: {
    // Loopback only. The device UI is never served to anything but itself, and
    // a dev server listening on 0.0.0.0 in a project like this would be an
    // embarrassing default to inherit.
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
  },
  build: {
    outDir: 'dist-app',
    // The device build has to be reproducible: its hash is covered by
    // MANIFEST.lock and displayed at boot.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Deterministic chunk names rather than content-hash suffixes that vary
        // with unrelated changes.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
