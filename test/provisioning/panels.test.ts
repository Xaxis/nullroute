/**
 * Tests for how the kiosk chooses the scale it draws at, and for the table it
 * chooses from.
 *
 * The scale is the whole difference between a 4 inch panel showing the 360
 * pixel layout every screen was measured at and showing a 480 pixel layout
 * nobody measured, with targets a finger misses. It is chosen on the device, by
 * a shell script reading the running device tree, which is the one place no
 * layout check can see. So the script is run here against device trees built
 * on disk, with the Chromium it would exec replaced by something that prints
 * its arguments.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { floor, panels, viewports } from '../../tools/lib/panels.mjs'
import { PANEL_FLOOR } from '../../packages/ui/src/lib/panel.js'

const ROOT = join(import.meta.dirname, '..', '..')
const SCRIPT = join(ROOT, 'provisioning/units/chromium-for-panel')
const TABLE = join(ROOT, 'provisioning/units/panels.tsv')

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Node {
  readonly path: string
  readonly compatible: readonly string[]
  readonly status?: string
}

/**
 * Run the script against a device tree written to disk.
 *
 * The three absolute paths it reads are swapped for ones under a temporary
 * directory, and the exec at the end for `echo`, so what comes back is the
 * argument list Chromium would have been started with. Nothing else in the
 * script is touched.
 */
function launch(
  nodes: readonly Node[],
  args: readonly string[] = ['--kiosk', 'http://127.0.0.1:5180/']
) {
  const dir = mkdtempSync(join(tmpdir(), 'nullroute-panel-'))
  made.push(dir)
  const tree = join(dir, 'tree')
  mkdirSync(tree)
  for (const node of nodes) {
    const at = join(tree, node.path)
    mkdirSync(at, { recursive: true })
    writeFileSync(at + '/compatible', node.compatible.map((c) => `${c}\0`).join(''))
    if (node.status !== undefined) writeFileSync(at + '/status', `${node.status}\0`)
  }
  const source = readFileSync(SCRIPT, 'utf8')
  const swapped = source
    .replace('TABLE=/usr/lib/nullroute/panels.tsv', `TABLE=${TABLE}`)
    .replace('TREE=/sys/firmware/devicetree/base', `TREE=${tree}`)
    .replace('exec /usr/lib/chromium/chromium', 'exec echo')
  // Each replacement has to have happened, or this is testing a script that
  // would exec the real browser or read the real tree.
  expect(swapped).not.toContain('/usr/lib/chromium/chromium')
  expect(swapped).not.toContain('/sys/firmware/devicetree/base')
  expect(swapped).not.toContain('TABLE=/usr/lib/nullroute/panels.tsv')
  const script = join(dir, 'chromium-for-panel')
  writeFileSync(script, swapped)
  chmodSync(script, 0o755)
  const out = execFileSync(script, [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return out.trim().split(' ')
}

describe('provisioning the kiosk draws each panel at its own scale', () => {
  /** INV-UI-110. The 5 inch Touch Display 2 is drawn at 2, so it is 360x640. */
  it('draws-a-listed-panel-at-its-scale', () => {
    const argv = launch([
      { path: 'soc/dsi@7e700000', compatible: ['brcm,bcm2835-dsi1'] },
      {
        path: 'soc/dsi@7e700000/dsi_panel@0',
        compatible: ['raspberrypi,dsi-5inch'],
        status: 'okay',
      },
    ])
    expect(argv[0]).toBe('--force-device-scale-factor=2')
  })

  /**
   * INV-UI-110. The same pixels at a different size get a different scale,
   * which is why the table is keyed on the compatible string and not on the
   * resolution.
   */
  it('tells-two-panels-with-the-same-pixels-apart', () => {
    expect(launch([{ path: 'panel', compatible: ['raspberrypi,dsi-7inch'] }])[0]).toBe(
      '--force-device-scale-factor=1.5'
    )
    expect(launch([{ path: 'panel', compatible: ['raspberrypi,dsi-5inch'] }])[0]).toBe(
      '--force-device-scale-factor=2'
    )
  })

  /**
   * INV-UI-110. A node the overlay left disabled is not a panel on this
   * device, so it does not choose the scale.
   */
  it('ignores-a-panel-node-that-is-disabled', () => {
    const argv = launch([
      { path: 'spi/display@0', compatible: ['pimoroni,hyperpixel4'], status: 'disabled' },
    ])
    expect(argv[0]).toBe('--force-device-scale-factor=1')
  })

  /** INV-UI-110. An unknown display is drawn at 1, as before there was a table. */
  it('draws-an-unlisted-display-at-one', () => {
    const argv = launch([{ path: 'hdmi@7ef00700', compatible: ['brcm,bcm2711-hdmi0'] }])
    expect(argv[0]).toBe('--force-device-scale-factor=1')
  })

  /**
   * INV-UI-110. Exactly one flag is added and the unit's own list follows it
   * untouched, so the comment in nullroute-kiosk.service that the unit's flags
   * are the whole list stays true with one named exception.
   */
  it('adds-one-flag-and-passes-the-rest-through', () => {
    const argv = launch(
      [{ path: 'spi/display@0', compatible: ['pimoroni,hyperpixel4'] }],
      ['--kiosk', '--incognito', 'http://127.0.0.1:5180/']
    )
    expect(argv).toEqual([
      '--force-device-scale-factor=1.33',
      '--kiosk',
      '--incognito',
      'http://127.0.0.1:5180/',
    ])
  })

  /**
   * INV-UI-110. The table the device reads gives the viewports the layout
   * checks measure. Four panels, four sizes, and the smallest width and
   * height are the floor the interface refuses to draw below.
   */
  it('gives-the-sizes-the-layout-checks-measure', () => {
    expect(viewports().map((v) => v.label)).toEqual(['800x480', '480x853', '360x601', '360x640'])
    expect(floor()).toEqual({ width: 360, height: 480 })
    // The interface's own copy, which it refuses to draw below. A smaller
    // panel added to the table fails here until the UI is measured at it.
    expect(PANEL_FLOOR).toEqual(floor())
    for (const panel of panels()) {
      expect(panel.viewport.width).toBeGreaterThanOrEqual(360)
      // Every compatible is one string the kernel could match, with no tab or
      // space that would make the shell script split it.
      expect(panel.compatible).toMatch(/^[a-z0-9-]+,[a-z0-9-]+$/)
    }
  })
})
