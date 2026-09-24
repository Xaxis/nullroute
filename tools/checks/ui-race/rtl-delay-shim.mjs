/**
 * @testing-library/react, with every async answer arriving late.
 *
 * The UI tests mock the daemon with functions passed as props, and a mock that
 * resolves in the same microtask hides a whole class of test bug: a `waitFor`
 * whose condition is already true before the answer lands, followed by an
 * assertion about the answer. The dice screen test waited for "of 256 bits",
 * which its placeholder already said, then asserted "5 of 256", and lost that
 * race only when the machine was busy. Twenty-one more had the same shape.
 * Each passed alone and failed one run in several under `make check`.
 *
 * This wraps every function prop, and `fetch`, so a returned promise settles
 * DELAY milliseconds late. A test that waits for the thing it then asserts is
 * unaffected. A test that races its fixture fails every time, which is when it
 * is cheap to fix.
 */
import { cloneElement, isValidElement } from 'react'
import * as RTL from '../../../node_modules/@testing-library/react/dist/index.js'

export * from '../../../node_modules/@testing-library/react/dist/index.js'

const DELAY = Number(process.env['RACE_DELAY'] ?? 50)
const wrapped = new WeakMap()

const late = () => new Promise((resolve) => setTimeout(resolve, DELAY))

/** @param {unknown} value */
function isThenable(value) {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (/** @type {{ then?: unknown }} */ (value).then) === 'function'
  )
}

/** @param {(...args: unknown[]) => unknown} fn */
function delayed(fn) {
  const known = wrapped.get(fn)
  if (known !== undefined) return known
  /** @this {unknown} @param {unknown[]} args */
  const wrapper = function (...args) {
    const out = fn.apply(this, args)
    if (!isThenable(out)) return out
    return (async () => {
      const [settled] = await Promise.allSettled([out])
      await late()
      if (settled.status === 'fulfilled') return settled.value
      throw settled.reason
    })()
  }
  wrapped.set(fn, wrapper)
  wrapped.set(wrapper, wrapper)
  return wrapper
}

/** @param {unknown} value @param {number} depth */
function wrapValue(value, depth) {
  if (typeof value === 'function') return delayed(/** @type {never} */ (value))
  if (isValidElement(value)) return wrapElement(value, depth)
  if (Array.isArray(value)) {
    return value.map((item) => (isValidElement(item) ? wrapElement(item, depth) : item))
  }
  return value
}

/** @param {import('react').ReactElement} element @param {number} depth */
function wrapElement(element, depth = 0) {
  if (depth > 6) return element
  const props = /** @type {Record<string, unknown>} */ (element.props)
  /** @type {Record<string, unknown>} */
  const next = {}
  let changed = false
  for (const [key, value] of Object.entries(props)) {
    const replaced = wrapValue(value, depth + 1)
    if (replaced !== value) changed = true
    next[key] = replaced
  }
  return changed ? cloneElement(element, next) : element
}

/** @param {import('react').ReactElement} ui @param {unknown} [options] */
export function render(ui, options) {
  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = /** @type {typeof fetch} */ (
      delayed(/** @type {never} */ (globalThis.fetch))
    )
  }
  const result = RTL.render(wrapElement(ui), /** @type {never} */ (options))
  const rerender = result.rerender
  return {
    ...result,
    /** @param {import('react').ReactElement} next */
    rerender: (next) => rerender(wrapElement(next)),
  }
}
