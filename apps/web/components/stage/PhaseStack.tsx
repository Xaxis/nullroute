import type { Phase } from '../../lib/status'
import { Slab } from './Slab'

/**
 * The roadmap as a stack of slabs, phase 1 at the bottom. A complete phase is
 * solid, one complete with exceptions is solid with the signal colour on its
 * edge, and one not started is an outline: the shape of what is planned, with
 * nothing in it. Read from README.md like the table below it, so the picture
 * cannot claim more than the table does.
 */
export function PhaseStack({ phases }: { phases: readonly Phase[] }) {
  return (
    <div className="scene scene--stack" aria-hidden="true">
      <div className="scene__lens">
        <div className="scene__world stack__world">
          <div className="stack__shadow" />
          {phases.map((phase) => (
            <div
              key={phase.number}
              className={`stack__layer stack__layer--${String(phase.number)} stack__layer--${phase.kind}`}
            >
              <Slab className="slab--phase">
                <span className="stack__label">Phase {phase.number}</span>
              </Slab>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
