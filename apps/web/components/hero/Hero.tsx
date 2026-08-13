import dynamic from 'next/dynamic'
import Link from 'next/link'

// Dynamically imported so three.js never blocks first paint. The page is
// complete and correct without it: the scene is a diagram of something the
// prose already says, not a carrier of information found nowhere else.
const AirGapScene = dynamic(() =>
  import('./AirGapScene').then((m) => ({ default: m.AirGapScene }))
)

export function Hero() {
  return (
    <section className="relative pt-16 pb-20 border-b border-ink-800">
      {/* Full bleed: the section sits inside a max-w-5xl column, and a backdrop
          clipped to that column reads as a panel rather than as a backdrop. The
          scene's own composition is built for a wide box. */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-screen -z-10 overflow-hidden">
        <AirGapScene />
        {/* Keeps the copy legible over the scene without hiding it. Weighted to
            the left, where the text is, and clear on the right, where the
            device sits. */}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/90 to-ink-950/20" />
        {/* Softens the join with the sections above and below. */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-950 to-transparent" />
      </div>

      <div className="relative">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-ink-100 leading-[1.1]">
          An air-gapped Bitcoin signing device{' '}
          <span className="block sm:inline">you can actually verify.</span>
        </h1>

        <p className="mt-6 text-lg text-ink-300 max-w-2xl leading-relaxed">
          Runs on a Raspberry Pi. Generates seeds from dice you rolled yourself. Signs PSBTs
          across an air gap. Every module ships with a machine-checkable specification, and the
          device refuses to run unless code, specs, and tests all agree.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/docs/verification"
            className="px-4 py-2 rounded bg-signal-500 text-ink-950 font-medium text-sm hover:bg-signal-400 transition-colors"
          >
            How to verify it
          </Link>
          <Link
            href="/docs/threat-model"
            className="px-4 py-2 rounded border border-ink-700 text-ink-200 text-sm hover:border-ink-500 hover:text-ink-100 transition-colors"
          >
            What it does not do
          </Link>
        </div>
      </div>
    </section>
  )
}
