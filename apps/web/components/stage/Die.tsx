/**
 * A six-sided die as a CSS cube, opposite faces summing to seven as on a real
 * one. It tumbles when it scrolls into view and comes to rest showing a face,
 * the step the seed is made from. Decorative: the roll that matters is in the
 * transcript beside it.
 */

// Pip positions on a 3x3 grid, numbered 1 to 9 reading order.
const PIPS: Record<number, readonly number[]> = {
  1: [5],
  2: [3, 7],
  3: [3, 5, 7],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}

export function Die({ className = '' }: { className?: string }) {
  return (
    <span className={`die ${className}`} aria-hidden="true">
      <span className="die__body">
        {[1, 2, 3, 4, 5, 6].map((face) => (
          <span key={face} className={`die__face die__face--${String(face)}`}>
            {(PIPS[face] ?? []).map((cell) => (
              <span key={cell} className={`die__pip die__pip--${String(cell)}`} />
            ))}
          </span>
        ))}
      </span>
    </span>
  )
}
