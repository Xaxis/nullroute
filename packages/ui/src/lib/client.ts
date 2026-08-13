/**
 * The frontend's side of the IPC boundary.
 *
 * Spec: ui.lib.client
 *
 * Deliberately dumb. It knows how to ask the daemon a question and how to
 * surface the answer, and it knows nothing about keys, seeds or signing,
 * because it never receives any of those (INV-KEY-1).
 *
 * The transport is a same-origin request to a loopback proxy that forwards to
 * the daemon's Unix socket. The frontend cannot reach the socket directly, and
 * the CSP restricts connect-src to 'self', so this is the only channel the page
 * has to anything at all.
 */

export interface IpcFailure {
  readonly code: string
  readonly message: string
}

export class IpcCallError extends Error {
  readonly code: string
  constructor(failure: IpcFailure) {
    super(failure.message)
    this.name = 'IpcCallError'
    this.code = failure.code
  }
}

export interface IpcTransport {
  send(method: string, params?: unknown): Promise<unknown>
}

/**
 * Call the daemon.
 *
 * Errors are thrown rather than returned, so a caller cannot render a result
 * that was never produced. A silently ignored failure on this boundary is how a
 * screen shows stale or empty data as though it were current.
 */
export async function call<T>(
  transport: IpcTransport,
  method: string,
  params?: unknown
): Promise<T> {
  const response = await transport.send(method, params)
  if (response !== null && typeof response === 'object' && 'error' in response) {
    throw new IpcCallError((response as { error: IpcFailure }).error)
  }
  if (response === null || typeof response !== 'object' || !('result' in response)) {
    throw new IpcCallError({
      code: 'malformed',
      message: `The daemon returned no result for "${method}".`,
    })
  }
  return (response as { result: T }).result
}
