/**
 * A QR code's anatomy, drawn: three finder squares, the timing rows, the
 * alignment block of a version 2 symbol, and data modules from a fixed seed.
 *
 * DRAWN, NOT ENCODED. These stand for the frames a transaction crosses the air
 * gap in, inside an animation; a scannable code would need an encoder this
 * site does not carry, and pointing a phone at a picture of a PSBT achieves
 * nothing. The seed is fixed so the build is byte-for-byte repeatable, which
 * the CSP's pinned hashes depend on.
 */
const SIZE = 25

function finder(x: number, y: number, cx: number, cy: number): boolean | undefined {
  const dx = x - cx
  const dy = y - cy
  if (dx < -1 || dx > 7 || dy < -1 || dy > 7) return undefined
  if (dx === -1 || dx === 7 || dy === -1 || dy === 7) return false
  const ring = Math.min(dx, dy, 6 - dx, 6 - dy)
  return ring !== 1
}

function modules(seed: number): readonly (readonly boolean[])[] {
  let state = seed >>> 0
  // A 32-bit LCG: the art needs a fixed sequence, not randomness.
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state >>> 24
  }
  const grid: boolean[][] = []
  for (let y = 0; y < SIZE; y += 1) {
    const row: boolean[] = []
    for (let x = 0; x < SIZE; x += 1) {
      const f = finder(x, y, 0, 0) ?? finder(x, y, SIZE - 7, 0) ?? finder(x, y, 0, SIZE - 7)
      if (f !== undefined) {
        row.push(f)
        continue
      }
      const ax = x - 18
      const ay = y - 18
      if (Math.abs(ax) <= 2 && Math.abs(ay) <= 2) {
        row.push(Math.max(Math.abs(ax), Math.abs(ay)) !== 1)
        continue
      }
      if (y === 6 || x === 6) {
        row.push((x + y) % 2 === 0)
        continue
      }
      row.push(next() < 118)
    }
    grid.push(row)
  }
  return grid
}

export function QrMark({ seed, className = '' }: { seed: number; className?: string }) {
  const grid = modules(seed)
  let d = ''
  grid.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) d += `M${String(x)} ${String(y)}h1v1h-1z`
    })
  })
  return (
    <svg
      viewBox={`-2 -2 ${String(SIZE + 4)} ${String(SIZE + 4)}`}
      className={`qr ${className}`}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      <rect className="qr__bg" x="-2" y="-2" width={SIZE + 4} height={SIZE + 4} rx="1.5" />
      <path className="qr__mod" d={d} />
    </svg>
  )
}
