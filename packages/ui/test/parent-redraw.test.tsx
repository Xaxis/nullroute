/**
 * Tests that a screen does not start over because the frame around it redrew.
 *
 * App redraws on every heartbeat, and a touch sends one. Several screens listed
 * the callbacks they were handed as dependencies of the effect that loads what
 * they show, and App handed some of them a new function on every draw. So the
 * receive screen re-derived its address whenever somebody touched the panel:
 * the address blanked, came back, and the "Re-derived from this device's keys
 * and it matches" note they had just asked for was gone. The quorum address
 * list emptied the same way. Seen in the screenshots of the receive journey,
 * where the step after "Check it" showed an empty body.
 *
 * The behavioural tests redraw each affected screen with a new but identical
 * callback, which is exactly what App's redraw does. The last test reads the
 * source, because the next screen to make this mistake will not be one of
 * these three.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReceiveScreen } from '../src/screens/ReceiveScreen.js'
import { QuorumAddressesScreen } from '../src/screens/QuorumAddressesScreen.js'
import { MachineEntropyScreen, type HealthReportView } from '../src/screens/MachineEntropyScreen.js'

afterEach(cleanup)

const ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'

const deriveAddress = () =>
  vi.fn(async (index: number) =>
    Promise.resolve({ address: ADDRESS, path: `m/84'/0'/0'/0/${String(index)}`, index })
  )

describe('ui a screen and the frame around it', () => {
  /**
   * INV-UI-109. A redraw of the frame keeps the address on screen and the
   * check the person just made of it.
   */
  it('keeps-a-checked-address-when-the-frame-redraws', async () => {
    const first = deriveAddress()
    const onVerify = vi.fn().mockResolvedValue({ found: true, path: "m/84'/0'/0'/0/0" })
    const onBack = vi.fn()
    const { rerender } = render(
      <ReceiveScreen onAddress={first} onVerify={onVerify} onBack={onBack} />
    )
    await waitFor(() => {
      expect(screen.getByTestId('receive-verify')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('receive-verify'))
    await waitFor(() => {
      expect(screen.getByTestId('receive-verified')).toBeTruthy()
    })

    // What App's heartbeat redraw hands the screen: the same behaviour in a
    // new function.
    const second = deriveAddress()
    rerender(<ReceiveScreen onAddress={second} onVerify={onVerify} onBack={onBack} />)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(second).not.toHaveBeenCalled()
    expect(first).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('receive-address').textContent).not.toBe('')
    expect(screen.getByTestId('receive-verified')).toBeTruthy()
  })

  /** INV-UI-109. The list several devices compare does not empty and refill. */
  it('keeps-the-quorum-addresses-when-the-frame-redraws', async () => {
    const page = () =>
      vi.fn(async (_d: string, change: boolean, start: number, count: number) =>
        Promise.resolve({
          change,
          addresses: Array.from({ length: count }, (_, i) => ({
            address: `recv-${String(start + i)}`,
            index: start + i,
          })),
        })
      )
    const first = page()
    const onBack = vi.fn()
    const props = { descriptor: 'wsh(...)#abcdefgh', position: { ours: 2, of: 3 }, onBack }
    const { rerender } = render(<QuorumAddressesScreen {...props} onAddresses={first} />)
    await waitFor(() => {
      expect(screen.getByText('recv-0')).toBeTruthy()
    })

    const second = page()
    rerender(<QuorumAddressesScreen {...props} onAddresses={second} />)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(second).not.toHaveBeenCalled()
    expect(first).toHaveBeenCalledTimes(1)
    expect(screen.getByText('recv-0')).toBeTruthy()
  })

  /** INV-UI-109. The entropy health check runs once, not once per touch. */
  it('reads-entropy-health-once-however-often-the-frame-redraws', async () => {
    const healthy: HealthReportView = { healthy: true, unknown: false, checks: [] }
    const first = vi.fn().mockResolvedValue(healthy)
    const onGenerate = vi.fn().mockResolvedValue(undefined)
    const onBack = vi.fn()
    const { rerender } = render(
      <MachineEntropyScreen onHealth={first} onGenerate={onGenerate} onBack={onBack} />
    )
    await waitFor(() => {
      expect(screen.getByTestId('machine-health')).toBeTruthy()
    })

    const second = vi.fn().mockResolvedValue(healthy)
    rerender(<MachineEntropyScreen onHealth={second} onGenerate={onGenerate} onBack={onBack} />)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(second).not.toHaveBeenCalled()
    expect(first).toHaveBeenCalledTimes(1)
  })

  /**
   * INV-UI-109. No effect in the UI lists a callback prop as a dependency.
   *
   * Read from the source rather than trusted to review, because whether the
   * mistake shows depends on the parent: an effect keyed on `onSomething` is
   * correct until somebody passes an inline function, and then it reloads on
   * every draw with nothing in the screen's own file having changed. Callbacks
   * an effect calls are read through useEffectEvent instead.
   *
   * It sees a callback prop named in the dependency array, not one reached
   * through a useCallback that wraps it. That shape exists (Screen's `report`)
   * and redoes nothing on a redraw but measure the scroll position again.
   */
  it('keys-no-effect-on-a-callback-prop', () => {
    const root = join(import.meta.dirname, '..', 'src')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.tsx?$/.test(name)) files.push(path)
      }
    }
    walk(root)
    expect(files.length).toBeGreaterThan(20)

    const keyed: string[] = []
    let effects = 0
    for (const file of files) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          (node.expression.text === 'useEffect' || node.expression.text === 'useLayoutEffect')
        ) {
          effects += 1
          const deps = node.arguments[1]
          if (deps !== undefined && ts.isArrayLiteralExpression(deps)) {
            for (const dep of deps.elements) {
              if (ts.isIdentifier(dep) && /^on[A-Z]/.test(dep.text)) {
                const { line } = source.getLineAndCharacterOfPosition(dep.getStart())
                keyed.push(`${file.slice(root.length + 1)}:${String(line + 1)} ${dep.text}`)
              }
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }

    // Proof the walk found effects at all, so an empty list means something.
    expect(effects).toBeGreaterThan(20)
    expect(keyed).toEqual([])
  })
})
