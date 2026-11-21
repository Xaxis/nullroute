import { QrMark } from './QrMark'
import { PanelSlab, Slab } from './Slab'

/**
 * The opening scene: a computer on the online side showing a transaction as a
 * QR code, the device's lock screen on the offline side, and the frame
 * crossing between them through the air gap, then coming back signed.
 *
 * IT SHOWS THE MECHANISM, NOT A MOOD. Every moving part is something the docs
 * describe: frames leave the online side, pass a gap nothing else crosses,
 * and the signed frame returns the same way. The panel shows the real render
 * of the lock screen, whose sample hashes the caption below says are samples.
 *
 * Pure CSS 3D (styles/motion.css). No script, no library, nothing the CSP has
 * to make room for, and still under prefers-reduced-motion.
 */
export function HeroScene() {
  return (
    <div className="scene scene--hero" aria-hidden="true">
      <div className="scene__lens">
        <div className="scene__world">
          <div className="scene__pool" />
          <div className="scene__laptop">
            <Slab className="slab--lid">
              <span className="laptop__screen">
                <span className="laptop__bar" />
                <span className="laptop__qr">
                  <QrMark seed={7} />
                </span>
              </span>
            </Slab>
            <Slab className="slab--base" />
          </div>
          <div className="scene__gap" />
          <div className="qr-card qr-card--out">
            <QrMark seed={7} />
          </div>
          <div className="qr-card qr-card--back">
            <QrMark seed={19} />
            <span className="qr-card__stamp">Signed</span>
          </div>
          <div className="scene__device">
            <PanelSlab file="lock" />
          </div>
        </div>
      </div>
      <div className="scene__legend">
        <span>Online</span>
        <span>Air gap</span>
        <span>Offline</span>
      </div>
    </div>
  )
}
