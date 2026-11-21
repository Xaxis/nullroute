import { Die } from './Die'
import { PanelSlab, Slab } from './Slab'

/**
 * The parts list as an exploded view: the panel over the board, the card
 * beside its slot, the webcam and the die. It comes apart when it scrolls into
 * view, the way you would lay the parts out before assembling them.
 *
 * Every part named here is a row of the table next to it, which is read from
 * README.md; nothing is drawn that the list does not ask you to buy. The
 * shapes are schematic, not a likeness of any one model, which is why the
 * board carries no maker's marks.
 */
export function ExplodedKit() {
  return (
    <div className="scene scene--kit kit reveal" aria-hidden="true">
      <div className="scene__lens">
        <div className="scene__world kit__world">
          <div className="kit__shadow" />
          <div className="kit__part kit__part--panel">
            <PanelSlab file="lock" className="slab--kit-panel" />
            <span className="kit__tag">Screen</span>
          </div>
          <div className="kit__part kit__part--board">
            <Slab className="slab--board">
              <span className="board__soc" />
              <span className="board__ram" />
              <span className="board__gpio" />
              <span className="board__usb board__usb--1" />
              <span className="board__usb board__usb--2" />
              <span className="board__eth" />
            </Slab>
            <span className="kit__tag">Board</span>
          </div>
          <div className="kit__part kit__part--sd">
            <Slab className="slab--sd" />
            <span className="kit__tag">Card</span>
          </div>
          <div className="kit__part kit__part--cam">
            <Slab className="slab--cam">
              <span className="cam__lens" />
            </Slab>
            <span className="kit__tag">Webcam</span>
          </div>
          <div className="kit__part kit__part--die">
            <Die className="die--kit" />
            <span className="kit__tag">Die</span>
          </div>
        </div>
      </div>
    </div>
  )
}
