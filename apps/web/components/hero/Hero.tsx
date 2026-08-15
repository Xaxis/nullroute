import type { Facts } from '../../lib/facts'
import { DiceDemo } from '../DiceDemo'

/**
 * The first screen, and the argument in miniature.
 *
 * The dice demo is HERE rather than in a section further down, and that is the
 * single most important decision on this page. It is the only object on the
 * site that is not a claim: the reader rolls, the browser hashes, and they
 * check the answer in their own terminal. Sitting below several hundred words
 * of caveats, as it used to, meant a reader with twenty seconds of patience
 * never reached it and left having read only assertions.
 *
 * There are no buttons here on purpose. A pair of accented calls to action is
 * the grammar of a page trying to convert a visitor, and this page is not.
 * Someone who wants the source will find the link in the header.
 *
 * A three.js scene used to occupy the right half. Its own comment conceded it
 * was a diagram of something the prose already said, and it cost a dependency,
 * a WebGL context and about 350 lines to say it. The demo says something the
 * prose cannot say at all, so it got the space.
 */
export function Hero({ facts }: { facts: Facts }) {
  return (
    <section className="relative pt-16 pb-14 sm:pt-24 sm:pb-20">
      {/* A wash rather than a picture. Full bleed because the section sits in a
          max-w-5xl column and a backdrop clipped to that column reads as a
          panel. An arbitrary Tailwind value, compiled into the stylesheet, so
          no inline style reaches the CSP. */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-screen -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,color-mix(in_srgb,var(--color-signal-500)_6%,transparent)_0%,transparent_70%)]" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink-950 to-transparent" />
      </div>

      <div className="relative">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-ink-500">
          Air-gapped Bitcoin signer
        </p>

        {/* Both lines at full contrast. Dimming the second half would fade the
            half that carries the stance; the line break does that work. */}
        <h1 className="mt-5 text-[2.5rem] leading-[1.05] sm:text-6xl sm:leading-[1.03] font-semibold tracking-[-0.03em] text-ink-100 max-w-3xl">
          Built to be checked,
          <span className="block">not to be trusted.</span>
        </h1>

        <div className="mt-9 lg:mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-14 lg:items-start">
          <div className="min-w-0">
            <p className="text-lg sm:text-xl text-ink-300 leading-relaxed">
              A Raspberry Pi that turns dice into a seed and signs transactions with no network of
              any kind: not for updates, not for fee estimation, not for fonts. Signatures are
              deterministic, so there is nothing random inside one for a key to leak through. Every
              module ships a machine-checkable specification, and the build fails when the code,
              the specs and the tests stop agreeing.
            </p>

            <p className="mt-5 text-lg text-ink-400 leading-relaxed">
              It is one person&rsquo;s build, published because the method is worth arguing with.{' '}
              <span className="text-ink-200">You should not use it.</span> Read it, disagree with
              it, and go build your own.
            </p>

            {/*
              Read out of the verification report at build time, so these are the
              current numbers or the build fails.

              `tests bound to invariants` rather than `exports covered`: the
              coverage check fails the build on any uncovered export, so
              covered/exports is pinned at parity for as long as this site is
              buildable at all. It reads as a measurement and cannot render
              anything but perfection, which is the defect this strip exists to
              avoid. boundTests/tests is gated by nothing and can go down.
            */}
            <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-5 font-mono text-xs">
              {[
                { k: 'specs', v: String(facts.specs) },
                { k: 'invariants', v: String(facts.invariants) },
                {
                  k: 'tests bound to invariants',
                  v: `${String(facts.boundTests)} of ${String(facts.tests)}`,
                },
              ].map((item) => (
                <div key={item.k}>
                  <dt className="uppercase tracking-[0.16em] text-ink-400">{item.k}</dt>
                  <dd className="mt-1.5 text-xl text-ink-200 tabular-nums">{item.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="min-w-0">
            <p className="mb-4 text-sm text-ink-400 leading-relaxed">
              Start with the smallest claim here. Roll some dice, then run the command it hands you
              and check that your own terminal agrees.
            </p>
            <DiceDemo />
          </div>
        </div>
      </div>
    </section>
  )
}
