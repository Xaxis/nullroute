/**
 * INV-NET-1: the daemon listens on a Unix domain socket and nothing else.
 *
 * Spec: daemon.ipc.socket
 *
 * This is the ONE file in packages/ permitted to import `node:net`, and the
 * permission is granted by an explicit path allowlist in eslint.config.js
 * rather than by a disable comment, so widening it shows up in a diff.
 *
 * A Unix domain socket is not a network socket. It has no address family that
 * can reach off the machine, no port, and no route. It is in `node:net` only
 * because that is where the API lives. The distinction matters enough to be
 * enforced rather than explained: `listen({ path })` is a filesystem object,
 * `listen({ port })` is a listener the outside world can reach, and the second
 * form is what this whole apparatus exists to make impossible.
 *
 * Two defences beyond the lint rule:
 *
 *   1. `assertNoNetworkListeners` inspects the process's own handles after
 *      binding and throws if anything is listening on a TCP or UDP address.
 *      The lint rule proves no source file CAN open a socket; this proves
 *      nothing HAS. They fail differently and that is the point.
 *   2. The socket file is created with mode 0600 in a directory the daemon
 *      owns, so another user on the machine cannot connect to it. On the device
 *      there is one user, but the daemon should not depend on that.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'

/** Refuse a request larger than this, before parsing any of it. */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024

export class IpcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpcError'
  }
}

export interface IpcRequest {
  readonly id: string
  readonly method: string
  readonly params?: unknown
}

export interface IpcResponse {
  readonly id: string
  readonly result?: unknown
  readonly error?: { readonly code: string; readonly message: string }
}

export type IpcHandler = (request: IpcRequest) => Promise<unknown>

/**
 * Assert the process holds no listener on any network address family.
 *
 * Reads the process's own active handles. A Unix socket handle reports an
 * address of the socket PATH (a string); a TCP handle reports an object with a
 * port. Anything with a port is a violation.
 *
 * This exists because INV-NET-1 is a claim about the running process, and a
 * lint rule is a claim about source text. A dependency could open a listener
 * without any of our files mentioning `net`.
 */
export function assertNoNetworkListeners(): void {
  // Node exposes this for exactly this kind of introspection. It is not a
  // public API, so its absence is tolerated rather than fatal: the lint rule
  // and the systemd RestrictAddressFamilies backstop still hold.
  const getHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })
    ._getActiveHandles
  if (typeof getHandles !== 'function') return

  const offenders: string[] = []
  for (const handle of getHandles.call(process)) {
    const candidate = handle as { address?: () => unknown }
    if (typeof candidate.address !== 'function') continue
    let address: unknown
    try {
      address = candidate.address()
    } catch {
      continue
    }
    // A Unix socket's address is the path string. A TCP or UDP listener's is an
    // object carrying a port.
    if (address !== null && typeof address === 'object' && 'port' in address) {
      offenders.push(JSON.stringify(address))
    }
  }

  if (offenders.length > 0) {
    throw new IpcError(
      `INV-NET-1 violated: this process holds ${String(offenders.length)} network listener(s): ` +
        `${offenders.join(', ')}. The daemon must listen on a Unix domain socket and nothing else.`
    )
  }
}

export interface IpcServerOptions {
  readonly socketPath: string
  readonly handler: IpcHandler
  /** Called for anything that would otherwise be swallowed. */
  readonly onError?: (error: Error) => void
}

/**
 * Start the IPC server on a Unix domain socket.
 *
 * Requests and responses are newline-delimited JSON. A line is a complete
 * message, which keeps framing trivial and means a truncated message can never
 * be interpreted as a shorter valid one.
 */
export function startIpcServer(options: IpcServerOptions): Promise<Server> {
  const { socketPath, handler, onError } = options

  // A leftover socket file from an unclean shutdown makes bind fail with
  // EADDRINUSE. Removing it is safe only because the path is ours by
  // convention; a stale file is far more likely than a second daemon.
  if (existsSync(socketPath)) unlinkSync(socketPath)

  const server = createServer((socket: Socket) => {
    let buffer = ''

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')

      if (buffer.length > MAX_REQUEST_BYTES) {
        // Destroy rather than respond: at this point the message is
        // attacker-influenced and unparsed, and there is nothing useful to say.
        socket.destroy()
        onError?.(new IpcError(`Request exceeded ${String(MAX_REQUEST_BYTES)} bytes.`))
        return
      }

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        void dispatch(socket, line, handler, onError)
        newline = buffer.indexOf('\n')
      }
    })

    socket.on('error', (err: Error) => {
      onError?.(err)
    })
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    // `path`, never `port`. This is the line the whole file is about.
    server.listen({ path: socketPath }, () => {
      // Owner only. There is one user on the device, and the daemon should not
      // rely on that being true.
      chmodSync(socketPath, 0o600)
      try {
        assertNoNetworkListeners()
      } catch (err) {
        server.close()
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      resolve(server)
    })
  })
}

async function dispatch(
  socket: Socket,
  line: string,
  handler: IpcHandler,
  onError?: (error: Error) => void
): Promise<void> {
  if (line.trim().length === 0) return

  let request: IpcRequest
  try {
    const parsed: unknown = JSON.parse(line)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as IpcRequest).id !== 'string' ||
      typeof (parsed as IpcRequest).method !== 'string'
    ) {
      throw new Error('a request needs a string id and a string method')
    }
    request = parsed as IpcRequest
  } catch (err) {
    // No id to correlate with, so this cannot be a normal error response.
    onError?.(new IpcError(`Malformed request: ${(err as Error).message}`))
    write(socket, {
      id: 'unknown',
      error: { code: 'malformed', message: 'Request was not valid JSON with id and method.' },
    })
    return
  }

  try {
    const result = await handler(request)
    write(socket, { id: request.id, result })
  } catch (err) {
    // Reported, never swallowed. A silently caught error in a signing path is
    // how someone signs a transaction they did not review.
    const error = err instanceof Error ? err : new Error(String(err))
    onError?.(error)
    write(socket, {
      id: request.id,
      error: { code: error.name, message: error.message },
    })
  }
}

function write(socket: Socket, response: IpcResponse): void {
  if (socket.destroyed) return
  socket.write(`${JSON.stringify(response)}\n`)
}
