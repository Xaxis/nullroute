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

export default defineConfig({
  plugins: [react(), tailwindcss(), daemonProxy()],
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
