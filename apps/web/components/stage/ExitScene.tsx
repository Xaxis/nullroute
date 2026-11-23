import { Slab } from './Slab'

/**
 * What the About page says happens if the project stops, as an object rather
 * than a logo: the wallet leaves the device as two plain-text cards, a BIP-39
 * mnemonic and a BIP-380 descriptor, and they land on Bitcoin Core, which
 * restores and spends with nothing from nullroute in the path
 * (INV-INTEROP-1). The device they leave is an outline.
 *
 * The words and the fingerprint are the BIP-84 test wallet's, the one the
 * recovery drill restores and the conformance kit signs with. Its keys are
 * public, so nothing here is a secret drawn as decoration.
 */
const WORDS = [...Array.from({ length: 11 }, () => 'abandon'), 'about']

export function ExitScene() {
  return (
    <div className="scene scene--exit" aria-hidden="true">
      <div className="scene__lens">
        <div className="scene__world exit__world">
          <div className="exit__shadow" />
          <div className="exit__device">
            <Slab className="slab--ghost">
              <span className="exit__label">nullroute</span>
            </Slab>
          </div>
          <div className="exit__core">
            <Slab className="slab--core">
              <span className="exit__label exit__label--core">Bitcoin Core</span>
              <span className="exit__cmd">importdescriptors</span>
            </Slab>
          </div>
          <div className="exit__card exit__card--words">
            <Slab className="slab--paper">
              <span className="exit__label exit__label--paper">BIP-39</span>
              <span className="exit__words">
                {WORDS.map((word, i) => (
                  <span key={String(i)}>
                    {i + 1}. {word}
                  </span>
                ))}
              </span>
            </Slab>
          </div>
          <div className="exit__card exit__card--descriptor">
            <Slab className="slab--paper">
              <span className="exit__label exit__label--paper">Descriptor</span>
              <span className="exit__desc">
                wpkh([73c5da0a/84h/0h/0h]xpub&hellip;/&lt;0;1&gt;/*)
              </span>
            </Slab>
          </div>
        </div>
      </div>
    </div>
  )
}
