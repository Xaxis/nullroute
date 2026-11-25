/**
 * The panels the device is laid out for, read from the table the image ships.
 *
 * provisioning/units/panels.tsv is what the kiosk reads on the device to pick
 * its scale, so the layout checks read the same file to pick the sizes they
 * measure at. A screen measured at a size no panel draws it at proves nothing,
 * and a panel added to the table is measured from the next run on without
 * anyone remembering to add it here.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TABLE = fileURLToPath(new URL('../../provisioning/units/panels.tsv', import.meta.url))

/**
 * Every row of the table, parsed.
 *
 * @returns {{ compatible: string, scale: number, pixels: [number, number], name: string, viewport: { width: number, height: number } }[]}
 */
export function panels() {
  const rows = []
  for (const [index, line] of readFileSync(TABLE, 'utf8').split('\n').entries()) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const cells = line.split('\t')
    const where = `provisioning/units/panels.tsv line ${String(index + 1)}`
    if (cells.length !== 4) {
      throw new Error(`${where} has ${String(cells.length)} tab-separated columns, not 4`)
    }
    const [compatible, scaleText, pixelsText, name] = cells
    const scale = Number(scaleText)
    const pixels = /^(\d+)x(\d+)$/.exec(pixelsText)
    if (!Number.isFinite(scale) || scale < 1 || pixels === null) {
      throw new Error(`${where}: scale "${scaleText}" or pixels "${pixelsText}" is not usable`)
    }
    const width = Number(pixels[1])
    const height = Number(pixels[2])
    rows.push({
      compatible,
      scale,
      pixels: [width, height],
      name,
      // Rounded down: a fraction of a pixel the browser does not have is room
      // a layout must not be measured as having.
      viewport: { width: Math.floor(width / scale), height: Math.floor(height / scale) },
    })
  }
  if (rows.length === 0) throw new Error('provisioning/units/panels.tsv lists no panels')
  return rows
}

/**
 * The distinct CSS viewports, widest first, each with the panels drawn at it.
 *
 * @returns {{ width: number, height: number, label: string, names: string[] }[]}
 */
export function viewports() {
  const seen = new Map()
  for (const panel of panels()) {
    const key = `${String(panel.viewport.width)}x${String(panel.viewport.height)}`
    const entry = seen.get(key) ?? { ...panel.viewport, label: key, names: [] }
    if (!entry.names.includes(panel.name)) entry.names.push(panel.name)
    seen.set(key, entry)
  }
  return [...seen.values()].sort((a, b) => b.width - a.width || a.height - b.height)
}

/**
 * The smallest width and the smallest height any panel lays out at.
 *
 * Not one viewport: the narrowest panel and the shortest are different panels.
 * The interface refuses to draw below this (INV-UI-110), because a layout
 * nobody has measured is the thing this device does not ship.
 */
export function floor() {
  const all = panels().map((panel) => panel.viewport)
  return {
    width: Math.min(...all.map((v) => v.width)),
    height: Math.min(...all.map((v) => v.height)),
  }
}

/**
 * The viewports a check should measure, honouring `--panel WxH`.
 *
 * `--panel` narrows a run to one size while working on it. It refuses a size
 * the table does not draw at, so it cannot become a way to measure something
 * no panel shows.
 */
export function viewportsFromArgs(argv = process.argv) {
  const all = viewports()
  const at = argv.indexOf('--panel')
  if (at === -1) return all
  const wanted = argv[at + 1]
  const match = all.find((v) => v.label === wanted)
  if (match === undefined) {
    throw new Error(
      `--panel ${String(wanted)} is not a size any panel draws at. ` +
        `provisioning/units/panels.tsv gives: ${all.map((v) => v.label).join(', ')}`
    )
  }
  return [match]
}
