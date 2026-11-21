import { Mark } from '../Mark'

// Layers stacked front to back give the flat mark its depth.
const LAYERS = Array.from({ length: 14 }, (_, i) => i)

/**
 * The mark as a solid object: fourteen copies of the same outline stacked in
 * depth, the front one lit. The site's one purely emblematic scene, used on
 * the pages that are about the project rather than the device.
 */
export function Emblem() {
  return (
    <div className="scene scene--emblem" aria-hidden="true">
      <div className="scene__lens">
        <div className="scene__world emblem__world">
          <div className="emblem__glow" />
          <div className="emblem">
            {LAYERS.map((layer) => (
              <Mark key={layer} className={`emblem__layer emblem__layer--${String(layer)}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
