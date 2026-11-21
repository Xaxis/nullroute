import type { ReactNode } from 'react'

/**
 * A flat object with thickness, in CSS 3D: a front face, a back and four
 * edges. The device's panel, a laptop lid, a circuit board and an SD card are
 * all one of these at a different size, which is what keeps the site's 3D
 * pieces looking like parts of one world rather than four illustrations.
 *
 * Its size, thickness and finish come from the class the caller passes; the
 * geometry rules are `.slab` in styles/motion.css. Decorative throughout, so
 * hidden from assistive technology by the scene that holds it.
 */
export function Slab({ className = '', children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={`slab ${className}`}>
      <div className="slab__face slab__face--front">{children}</div>
      <div className="slab__face slab__face--back" />
      <div className="slab__edge slab__edge--top" />
      <div className="slab__edge slab__edge--bottom" />
      <div className="slab__edge slab__edge--left" />
      <div className="slab__edge slab__edge--right" />
    </div>
  )
}

/** The device's panel: the real 800x480 render on its black glass, as an object. */
export function PanelSlab({ file, className = '' }: { file: string; className?: string }) {
  return (
    <Slab className={`slab--panel ${className}`}>
      <img
        src={`/device/${file}.png`}
        alt=""
        width={1600}
        height={960}
        className="slab__screen"
        decoding="async"
      />
      <span className="slab__glare" />
    </Slab>
  )
}
