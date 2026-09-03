/**
 * Reading a value out of an IPC request, and refusing when it is not there.
 *
 * Every one of these throws rather than defaulting. A request that omits a
 * required parameter is a caller bug, and the daemon's answer to a caller bug
 * is a loud error rather than a plausible result computed from a fallback the
 * caller did not ask for.
 *
 * They were local to handler.ts, which is why they are here now: thirteen
 * method tables need them and none of them should carry its own copy.
 */

import { type ScriptType } from '@nullroute/core'
import { type IpcRequest } from './socket.js'

export function params(request: IpcRequest): Record<string, unknown> {
  const value = request.params
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function requireString(request: IpcRequest, key: string): string {
  const value = params(request)[key]
  if (typeof value !== 'string') {
    throw new Error(`Parameter "${key}" is required and must be a string.`)
  }
  return value
}

export function optionalString(request: IpcRequest, key: string, fallback = ''): string {
  const value = params(request)[key]
  return typeof value === 'string' ? value : fallback
}

export function requireNumber(request: IpcRequest, key: string, fallback?: number): number {
  const value = params(request)[key]
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (fallback !== undefined) return fallback
  throw new Error(`Parameter "${key}" is required and must be an integer.`)
}

export const SCRIPT_TYPES: readonly ScriptType[] = ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr']

export function requireScriptType(request: IpcRequest, key = 'scriptType'): ScriptType {
  const value = requireString(request, key)
  const found = SCRIPT_TYPES.find((s) => s === value)
  if (found === undefined) {
    throw new Error(`Unknown script type "${value}". Expected one of: ${SCRIPT_TYPES.join(', ')}.`)
  }
  return found
}
