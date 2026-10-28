/**
 * The device's own screens, rendered at the panel's 800x480 by a real browser
 * from the same gallery the layout and contrast checks measure.
 *
 * `make device-shots` writes them and `make device-shots-check` fails the build
 * when the frontend changes and they do not, so these are the device rather
 * than a picture of one. The hashes in them are samples from the gallery's
 * fixtures, and every caption that shows the lock screen says so.
 *
 * ON A BLACK PLATE, NOT IN A DRAWN BEZEL. The panel is a flat 7 inch rectangle,
 * and a rendered plastic case would be the one dishonest pixel on a page about
 * not being lied to. The plate is the report's convention for a photographed
 * object, and it stays black in both themes because the panel does.
 */

export interface Screen {
  readonly file: string
  readonly caption: string
  readonly detail: string
  /** The spec ids the screen's behaviour is held to. */
  readonly specs: readonly string[]
}

/**
 * Every spec id a screen names must exist in the verification report, or the
 * build stops. A caption that cites a spec nobody wrote is a citation to
 * nothing, and the reader has no way to tell.
 */
export function checkedScreens(has: (specId: string) => boolean): readonly Screen[] {
  for (const screen of SCREENS) {
    for (const id of screen.specs) {
      if (!has(id)) {
        throw new Error(
          `nullroute.diy: the ${screen.file} screen cites ${id}, which the verification report does not list as implemented.`
        )
      }
    }
  }
  return SCREENS
}

export const SCREENS: readonly Screen[] = [
  {
    file: 'lock',
    caption: 'Two hashes, before the PIN',
    detail:
      'The manifest root of the application, and the dm-verity root the kernel is checking every block of the root filesystem against, read from the live device-mapper table rather than from the card. Compare the first against your own build. The values in these pictures are samples, not this build.',
    specs: ['ui.screens.lock'],
  },
  {
    file: 'dice',
    caption: 'A hundred rolls',
    detail:
      'The entropy counter is arithmetic you can repeat. 100 rolls, not 99: 99 is 255.911 bits and this project does not round in its own favour.',
    specs: ['core.entropy.dice'],
  },
  {
    file: 'seed',
    caption: 'The words, once',
    detail:
      'A standard BIP-39 mnemonic. Any wallet can restore it, which is what makes walking away from this project harmless.',
    specs: ['core.bip39.mnemonic'],
  },
  {
    file: 'review',
    caption: 'A transaction it will not sign',
    detail:
      'The fee is 8.4 percent of the spend, so Sign is disabled and the reason sits beside it. An output with no address is flagged rather than guessed at. Signing anyway takes a tick that applies to one signature and is not remembered.',
    specs: ['core.psbt.review', 'core.psbt.sign'],
  },
  {
    file: 'receive',
    caption: 'An address to check',
    detail:
      'Shown with its derivation path and its script type, so you can confirm it on a second device rather than trusting this one.',
    specs: ['core.address.derive'],
  },
  {
    file: 'verify',
    caption: "Somebody else's proof",
    detail:
      'Checking a signature needs no key and works with the wallet locked. Verifying a stranger should not cost the passphrase to your money.',
    specs: ['core.message.bip322'],
  },
]

/** One screen on its plate, linking to the full-size overlay. */
export function Shot({
  screen,
  eager = false,
  link = true,
}: {
  screen: Screen
  eager?: boolean
  /** False where the picture is already large and an overlay adds nothing. */
  link?: boolean
}) {
  const image = (
    <img
      src={`/device/${screen.file}.png`}
      alt={screen.caption}
      width={1600}
      height={960}
      {...(eager ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
      className="block w-full h-auto rounded-[2px]"
    />
  )
  const plate = 'block rounded-[6px] bg-plate p-2 sm:p-2.5 ring-1 ring-plate-line'
  return link ? (
    <a href={`#shot-${screen.file}`} className={`${plate} transition-shadow hover:ring-signal`}>
      {image}
    </a>
  ) : (
    <div className={plate}>{image}</div>
  )
}
