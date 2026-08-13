import dynamic from 'next/dynamic'
import type { Facts } from '../../lib/facts'

// Dynamically imported so three.js never blocks first paint. The page is
// complete and correct without it: the scene is a diagram of something the
// prose already says, not a carrier of information found nowhere else.
const AirGapScene = dynamic(() =>
  import('./AirGapScene').then((m) => ({ default: m.AirGapScene }))
)

/**
 * There are no buttons here on purpose.
 *
 * A pair of accented calls to action is the grammar of a page trying to convert
 * a visitor, and this page is not. Someone who wants the source will find the
 * link in the header. What the top of the page owes a reader is a plain
 * statement of what the thing is and an equally plain statement that it is not
 * being recommended to them.
 */
export function Hero({ facts }: { facts: Facts }) {
  return (
    <section className="relative pt-20 pb-16 sm:pt-28 sm:pb-24">
      {/* Full bleed: the section sits inside a max-w-5xl column, and a backdrop
          clipped to that column reads as a panel rather than as a backdrop. The
          scene's own composition is built for a wide box. */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-screen -z-10 overflow-hidden">
        {/* Sits under the canvas and shows through when there is no canvas.
            Three audiences never see the scene: browsers without WebGL, people
            who have asked their system for reduced motion, and anyone whose GPU
            process has died. Without this the right half of the hero is a plain
            black rectangle for all of them. It is a wash of colour rather than a
            still of the diagram, because a static picture of an animation is
            usually worse than neither. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(60%_75%_at_78%_50%,color-mix(in_srgb,var(--color-signal-500)_7%,transparent)_0%,transparent_70%)]"
        />
        <AirGapScene />
        {/* Keeps the copy legible without erasing the scene. The stop positions
            are explicit rather than the default even split: the text column
            ends around 62% across, so the cover stays solid to just past that
            and then falls away quickly. A symmetric gradient put the halfway
            point in the middle of the diagram and dimmed the half of it that
            was supposed to be visible. */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-ink-950)_0%,var(--color-ink-950)_54%,color-mix(in_srgb,var(--color-ink-950)_55%,transparent)_74%,transparent_92%)]" />
        {/* Softens the join with the section below. */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink-950 to-transparent" />
      </div>

      <div className="relative">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-ink-500">
          Air-gapped Bitcoin signer
        </p>

        <h1 className="mt-5 text-[2.5rem] leading-[1.05] sm:text-6xl sm:leading-[1.03] font-semibold tracking-[-0.03em] text-ink-100">
          Built to be checked,
          <span className="block text-ink-500">not to be trusted.</span>
        </h1>

        <p className="mt-7 text-lg sm:text-xl text-ink-300 max-w-2xl leading-relaxed">
          A Raspberry Pi that turns dice into a seed and signs transactions without ever touching
          a network. Every module carries a machine-checkable specification, and the device
          refuses to boot when the code, the specs and the tests disagree.
        </p>

        <p className="mt-5 text-lg text-ink-400 max-w-2xl leading-relaxed">
          It is one person&rsquo;s build, published because the method is worth arguing with.{' '}
          <span className="text-ink-200">You should not use it.</span> Read it, disagree with it,
          and go build your own.
        </p>

        {/* A specimen strip rather than a stat block. These are read out of the
            verification report at build time, so they are the current numbers
            or the build fails. */}
        <dl className="mt-12 flex flex-wrap gap-x-10 gap-y-5 font-mono text-xs">
          {[
            { k: 'specs', v: String(facts.specs) },
            { k: 'invariants', v: String(facts.invariants) },
            { k: 'tests', v: String(facts.tests) },
            // Two distinct fields. An earlier version put `exports` on both
            // sides of the slash, which renders a perfect ratio by construction
            // and can never show anything else, on a page that is otherwise
            // about not doing that.
            { k: 'exports covered', v: `${String(facts.covered)}/${String(facts.exports)}` },
          ].map((item) => (
            <div key={item.k}>
              {/* ink-400, not ink-600. ink-600 is a border colour and sits at
                  2.02:1 against the page, which is unreadable rather than
                  understated. */}
              <dt className="uppercase tracking-[0.16em] text-ink-400">{item.k}</dt>
              <dd className="mt-1.5 text-xl text-ink-200 tabular-nums">{item.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
