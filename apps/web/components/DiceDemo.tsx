'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * The argument, made touchable.
 *
 * Every other way of explaining this project is a claim. This is the claim
 * executed in the reader's own browser: they roll, they see the hash, and they
 * can run the same command in a terminal and get the same string. Nothing here
 * talks to us, and nothing here is a recording.
 *
 * It uses the browser's own SubtleCrypto rather than shipping a hash
 * implementation, so there is nothing of ours between the input and the digest.
 * That is the same reason the device publishes its manifest in `sha256sum`
 * format: the check should not depend on trusting the thing being checked.
 *
 * This is a demonstration, not a wallet. It says so, because a page that let
 * someone believe they had generated a real seed in a browser tab would be
 * doing real harm.
 */

const FACES = ['1', '2', '3', '4', '5', '6'] as const
const BITS_PER_ROLL = Math.log2(6)
const TARGET_BITS = 256
const MIN_ROLLS = Math.ceil(TARGET_BITS / BITS_PER_ROLL) // 100

function chunk(value: string, size = 8): string {
  const groups: string[] = []
  for (let i = 0; i < value.length; i += size) groups.push(value.slice(i, i + size))
  return groups.join(' ')
}

export function DiceDemo() {
  const [rolls, setRolls] = useState('')
  const [digest, setDigest] = useState('')
  const meterRef = useRef<HTMLDivElement | null>(null)

  const bits = Math.floor(rolls.length * BITS_PER_ROLL)
  const enough = rolls.length >= MIN_ROLLS
  const progress = Math.min(100, (bits / TARGET_BITS) * 100)

  useEffect(() => {
    if (rolls.length === 0) {
      setDigest('')
      return
    }
    let cancelled = false
    const run = async (): Promise<void> => {
      // The browser's own implementation. Nothing of ours sits between the
      // bytes and the digest, which is the entire point of the exercise.
      const bytes = new TextEncoder().encode(rolls)
      const hash = await crypto.subtle.digest('SHA-256', bytes)
      if (cancelled) return
      setDigest(
        Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      )
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [rolls])

  // Set imperatively rather than with a style attribute. An inline style in
  // the emitted HTML would force style-src 'unsafe-inline' into the CSP for the
  // whole site, which is a real cost to pay for a progress bar.
  useEffect(() => {
    if (meterRef.current !== null) meterRef.current.style.width = `${String(progress)}%`
  }, [progress])

  const push = useCallback((face: string) => {
    setRolls((current) => (current.length >= 200 ? current : current + face))
  }, [])

  /**
   * The command MUST contain the whole roll string.
   *
   * An earlier version elided it after 24 characters with a literal "...",
   * which meant the command the reader was invited to run hashed different
   * bytes and printed a different digest from the one shown above it. On a
   * panel whose entire purpose is "run this yourself and get the same answer",
   * that turned the one falsifiable thing on the site into a demonstration that
   * the site was wrong. It is shortened visually by scrolling the element, never
   * by editing the bytes.
   */
  const command = useMemo(() => `printf '%s' '${rolls}' | sha256sum`, [rolls])

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-ink-800 flex items-center gap-3">
        <span className="text-xs font-mono text-ink-500">Try it here</span>
        <span className="text-xs text-ink-400">runs entirely in your browser</span>
        {rolls.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setRolls('')
            }}
            className="ml-auto text-xs text-ink-500 hover:text-ink-300 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      <div className="p-4 grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="grid grid-cols-3 gap-2 self-start">
          {FACES.map((face) => (
            <button
              key={face}
              type="button"
              onClick={() => {
                push(face)
              }}
              aria-label={`Roll ${face}`}
              className="w-14 h-14 rounded-md border border-ink-700 bg-ink-850 text-xl font-mono font-semibold text-ink-100 hover:border-signal-500 hover:bg-ink-800 active:bg-signal-500 active:text-ink-950 transition-colors"
            >
              {face}
            </button>
          ))}
        </div>

        <div className="min-w-0 space-y-3">
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <span className="text-xs font-mono uppercase tracking-widest text-ink-500">
                Entropy
              </span>
              <span className="text-sm font-mono text-ink-200">
                {bits} of {TARGET_BITS} bits
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
              <div
                ref={meterRef}
                className={`h-full w-0 rounded-full ${enough ? 'bg-verify-500' : 'bg-signal-500'}`}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-500">
              {rolls.length} rolls.{' '}
              {enough
                ? 'Enough for a 24 word seed.'
                : `${String(MIN_ROLLS - rolls.length)} more for a real seed. 99 is not enough: it is 255.911 bits.`}
            </p>
          </div>

          {rolls.length > 0 && (
            <>
              <div>
                <div className="text-xs font-mono uppercase tracking-widest text-ink-500 mb-1">
                  Your rolls
                </div>
                <div
                  className="hash text-xs text-ink-400 leading-relaxed max-h-16 overflow-y-auto"
                  tabIndex={0}
                  role="region"
                  aria-label="Your rolls"
                >
                  {rolls}
                </div>
              </div>

              <div>
                <div className="text-xs font-mono uppercase tracking-widest text-ink-500 mb-1">
                  SHA-256 of those digits
                </div>
                <div className="hash text-sm text-verify-300 leading-relaxed">{chunk(digest)}</div>
              </div>

              <div className="rounded-md border border-ink-800 bg-ink-950 p-3">
                <div className="text-xs text-ink-500 mb-1.5">
                  Now run this in a terminal. You should get the same string.
                </div>
                <code
                  className="block font-mono text-xs text-ink-300 whitespace-pre overflow-x-auto"
                  tabIndex={0}
                  role="region"
                  aria-label="Command to reproduce this hash"
                >
                  {command}
                </code>
                <p className="mt-2 text-xs text-ink-500">
                  On macOS the command is <code className="font-mono">shasum -a 256</code>.
                </p>
              </div>
            </>
          )}

          {rolls.length === 0 && (
            <p className="text-sm text-ink-400 leading-relaxed">
              Press the numbers. Each one is a roll of a six-sided die. The device does exactly
              this, and nothing else, to turn dice into a seed.
            </p>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-ink-800 text-xs text-ink-500 leading-relaxed">
        <strong className="text-ink-400">This is a demonstration, not a wallet.</strong> Do not use
        anything generated in a browser tab to hold money. On the real device the same arithmetic
        happens on a machine with no network, and the words never leave it.
      </div>
    </div>
  )
}
