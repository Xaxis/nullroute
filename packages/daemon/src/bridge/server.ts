/**
 * INV-NET-4: the loopback bridge between the kiosk browser and the daemon.
 *
 * Spec: daemon.bridge
 *
 * This and `ipc/socket.ts` are the only files in `packages/` permitted to
 * import a networking module, and the permission comes from an explicit path
 * allowlist in eslint.config.js rather than a disable comment, so widening it
 * shows up in a diff.
 *
 * WHY A LISTENING PORT IS ALLOWED HERE AT ALL. The frontend is a web page in a
 * browser, and a browser talks HTTP. It cannot open a Unix socket. Something
 * has to be on the other side of `fetch('/ipc')`, and in development that has
 * always been Vite; on the device it is this. The safety does not come from the
 * server being small. It comes from `BRIDGE_HOST` being a constant that no
 * caller can change, from 127.0.0.1 having no route off the machine, and from
 * the device having no configured network interface for it to have a route on.
 */

import { createServer as createHttpServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { join, resolve, extname, normalize } from 'node:path'

/**
 * Loopback, as a constant.
 *
 * NOT A PARAMETER, and that is the invariant rather than a style choice. An
 * option would be a way to reach `0.0.0.0` from a config file, an environment
 * variable, or a caller who thought they were being helpful. There is no
 * argument this function takes that can widen where it listens.
 */
export const BRIDGE_HOST = '127.0.0.1'

/** The port the kiosk unit points Chromium at. */
export const BRIDGE_PORT = 5180

/**
 * The same cap the daemon's own socket applies, for the same reason: a body is
 * refused before it is read into memory rather than after.
 */
export const MAX_BRIDGE_REQUEST_BYTES = 4 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
}

/**
 * Resolve a request path inside the static root, or return null.
 *
 * RESOLVED THEN CHECKED, not checked then resolved. Rejecting a path that
 * merely contains `..` is the version of this that people write and that
 * encoded traversal walks straight through. This joins, resolves to an absolute
 * path with every `..` and symlink already collapsed, and then asks whether the
 * answer is still under the root. A path that leaves by any route fails the
 * same way, which is the only property worth asserting.
 */
export function resolveStaticPath(root: string, requestPath: string): string | null {
  let rootReal: string
  try {
    rootReal = realpathSync(resolve(root))
  } catch {
    return null
  }

  // A leading slash would make `join` produce an absolute path outside the
  // root, so the request path is treated as relative before anything else.
  let relative: string
  try {
    relative = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '')
  } catch {
    // A malformed percent-escape is a request nobody legitimately makes.
    return null
  }
  const candidate = resolve(join(rootReal, relative))

  // The cheap lexical rejection first, so an obvious traversal never reaches
  // the filesystem at all.
  if (candidate !== rootReal && !candidate.startsWith(`${rootReal}/`)) return null

  /*
   * AND THEN THE REAL PATH, WHICH IS THE CHECK THAT MATTERS.
   *
   * `path.resolve` is purely lexical: it collapses `..` and nothing else, so a
   * symlink inside the root pointing anywhere on the filesystem resolves to a
   * candidate that is still under the root by string comparison. The first
   * version of this function did exactly that, and its own comment claimed
   * statSync following the link made it safe, which is backwards: following the
   * link is what made it unsafe, because the containment test had already
   * passed on the name rather than on the target.
   *
   * `realpathSync` resolves every link in the chain. Comparing that against the
   * realpath of the root is a question about the file that will actually be
   * opened.
   */
  let real: string
  let stats
  try {
    real = realpathSync(candidate)
    stats = statSync(real)
  } catch {
    return null
  }
  if (real !== rootReal && !real.startsWith(`${rootReal}/`)) return null

  if (stats.isDirectory()) {
    const index = join(real, 'index.html')
    try {
      statSync(index)
    } catch {
      return null
    }
    return index
  }
  return stats.isFile() ? real : null
}

export interface BridgeOptions {
  /** The daemon's Unix socket. */
  readonly socketPath: string
  /** The directory holding the built frontend. */
  readonly staticRoot: string
  readonly port?: number
  /** Reported rather than swallowed. See the handler. */
  readonly onError?: (error: Error) => void
}

/**
 * Carry one request to the daemon and one line back.
 *
 * A CONNECTION PER REQUEST. The daemon's protocol is a line in and a line out
 * with no request ids at the transport layer, so a shared connection would let
 * two browser requests interleave and each read the other's answer. Opening a
 * Unix socket costs nothing worth optimising against that.
 */
function forward(socketPath: string, body: string): Promise<string> {
  return new Promise((resolveWith, reject) => {
    const socket = connect(socketPath)
    let buffer = ''
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      socket.destroy()
      fn()
    }

    socket.on('connect', () => {
      socket.write(`${body.trim()}\n`)
    })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      const line = buffer.slice(0, newline)
      finish(() => {
        resolveWith(line)
      })
    })
    socket.on('error', (err: Error) => {
      finish(() => {
        reject(err)
      })
    })
    socket.on('close', () => {
      finish(() => {
        reject(new Error('the daemon closed the connection without answering'))
      })
    })
  })
}

/**
 * Start the bridge. Resolves once it is listening.
 *
 * Errors reaching the daemon become a 502 with a JSON body rather than a
 * dropped connection: the frontend renders what it is told, and a lock screen
 * with no attestation behind it is the reassurance a user came to check.
 */
export function startBridge(options: BridgeOptions): Promise<Server> {
  const { socketPath, staticRoot, port = BRIDGE_PORT, onError } = options

  const server = createHttpServer((req, res) => {
    const method = req.method ?? 'GET'
    const path = (req.url ?? '/').split('?')[0] ?? '/'

    const fail = (status: number, message: string): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: message }))
    }

    if (method === 'POST') {
      if (path !== '/ipc') {
        fail(404, 'the bridge forwards /ipc and nothing else')
        return
      }
      let body = ''
      let size = 0
      let refused = false
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BRIDGE_REQUEST_BYTES) {
          // Refused before it is forwarded, and the connection is torn down so
          // the rest of the body is never read into this process.
          refused = true
          fail(413, 'that request is larger than the bridge will forward')
          req.destroy()
          return
        }
        body += chunk.toString('utf8')
      })
      req.on('end', () => {
        if (refused) return
        forward(socketPath, body).then(
          (line) => {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(line)
          },
          (err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err))
            onError?.(error)
            fail(502, `the daemon did not answer: ${error.message}`)
          }
        )
      })
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      fail(405, 'the bridge answers GET and POST /ipc')
      return
    }

    const file = resolveStaticPath(staticRoot, path)
    if (file === null) {
      fail(404, 'no such file')
      return
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      // The frontend is served from here, so the policy that constrains it is
      // set here. Matches the device CSP that `make device-csp` asserts.
      'cache-control': 'no-store',
    })
    if (method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file).pipe(res)
  })

  return new Promise((resolveWith, reject) => {
    server.on('error', reject)
    // `BRIDGE_HOST`, never a parameter. This is the line the whole file is about.
    server.listen(port, BRIDGE_HOST, () => {
      resolveWith(server)
    })
  })
}
