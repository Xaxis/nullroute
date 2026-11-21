import type { RequirementArea } from '../../lib/profile'
import { Slab } from './Slab'

/**
 * The profile's areas as a hand of cards, fanned: one card per area, each
 * with its prefix, its title and how many requirements it holds, all read
 * from the profile itself, the first area on top. The fan opens when the
 * page does.
 */
export function AreaDeck({ areas }: { areas: readonly RequirementArea[] }) {
  return (
    <div className="scene scene--deck" aria-hidden="true">
      <div className="scene__lens">
        <div className="scene__world deck__world">
          {/* Reversed, so the profile's first area is the card on top. */}
          {[...areas].reverse().map((area, i) => (
            <div key={area.prefix} className={`deck__card deck__card--${String(i + 1)}`}>
              <Slab className="slab--card">
                <span className="card__prefix">{area.prefix}</span>
                <span className="card__title">{area.title}</span>
                <span className="card__count">
                  {area.requirements.length}{' '}
                  {area.requirements.length === 1 ? 'requirement' : 'requirements'}
                </span>
              </Slab>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
