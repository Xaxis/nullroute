import { Die } from './Die'
import { PanelSlab, Slab } from './Slab'

/**
 * The opening scene: the device, as the kit line above the headline lists it.
 * The 7 inch panel showing its lock screen, the USB webcam it reads QR codes
 * with, and the die the seed comes from.
 *
 * ONE OBJECT, LEGIBLE. It used to stage a laptop, a pane of light for the air
 * gap and QR frames flying between them, all small enough that the frames
 * landed on top of the lock screen's text and the labels under the scene
 * pointed at nothing. The crossing is drawn properly in "How you use it";
 * here the panel is large enough to read.
 *
 * WHAT MOVES IS WHAT THE COPY SAYS. The mark that comes and goes on the
 * screen sits on the manifest root, the number the paragraph beside it tells
 * you to compare, and the next section is that number for this build. The
 * render is the real lock screen; its hashes are samples, which the caption
 * under the scene says.
 *
 * Pure CSS 3D (styles/motion.css). No script, no library, nothing the CSP has
 * to make room for, and still under prefers-reduced-motion.
 */
export function HeroScene() {
  return (
    <div className="scene scene--hero" aria-hidden="true">
      <div className="hero__floor" />
      <div className="scene__lens">
        <div className="scene__world hero__world">
          <div className="hero__device">
            <div className="hero__cam">
              <Slab className="slab--hero-cam">
                <span className="hero__lens" />
                <span className="hero__led" />
              </Slab>
            </div>
            <PanelSlab file="lock" className="slab--hero">
              <span className="hero__mark" />
            </PanelSlab>
          </div>
        </div>
      </div>
      <div className="hero__die">
        <Die className="die--hero" />
      </div>
    </div>
  )
}
