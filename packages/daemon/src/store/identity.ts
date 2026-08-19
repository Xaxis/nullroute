/**
 * What this physical device is called.
 *
 * Spec: daemon.store.identity
 *
 * THE PROBLEM. Three nullroute devices holding one 2-of-3 all hold the same
 * wallet, so they all show the same wallet name, the same colour and the same
 * fingerprint. Nothing on any screen says which of the three objects is in your
 * hand. The cosigner position helps and only inside a quorum: it is derived
 * from a registration, so a device with no registrations is anonymous, and a
 * device in two quorums has two positions.
 *
 * So a device gets a name of its own, and it sits above wallets rather than
 * inside one.
 *
 * WHY NOT A "PROFILE". The obvious move is a profile that owns several wallets
 * and unlocks them together. That trades away a property worth more than the
 * organisation: today every wallet is sealed independently under its own
 * passphrase, so compromising one is compromising one. A layer that opened
 * several at once would make a single mistake cost several seeds. The identity
 * here is deliberately the smallest thing that answers "which device is this":
 * a name and a colour, no keys, no authority.
 *
 * WHAT IT IS NOT AUTHENTICATED BY. Nothing. It is a plain file beside the
 * wallets, editable by anyone holding the card, exactly like the wallet hints
 * in registry.ts and for the same reason: it has to be readable before any
 * passphrase is typed, which is the moment you most want to know which device
 * you picked up. It is therefore never used to decide anything, and every
 * screen that shows it says it is not verified. A device that let an editable
 * name influence signing would have turned a convenience into an attack.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { WALLET_COLOURS, stripUndisplayable, type WalletColour } from './registry.js'

export class IdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityError'
  }
}

export interface DeviceIdentity {
  readonly name: string
  readonly colour: WalletColour
}

/** The file, beside the wallets rather than inside any of them. */
const FILE = 'device.json'

/**
 * Longer than a wallet label, because this is read aloud between people
 * standing in different rooms: "the one in the attic", not "attic".
 */
export const MAX_NAME_LENGTH = 48

export function normaliseName(raw: string): string {
  // The same stripping a wallet label gets, from the same function rather than
  // a copy of it. This string is rendered in the header of every screen,
  // including the one where a transaction is authorised, and a bidi override
  // there could reorder what sits beside it.
  const stripped = stripUndisplayable(raw)

  if (stripped.length === 0) {
    throw new IdentityError(
      'A device name cannot be empty, or made only of characters that do not display. ' +
        'It is the first thing you read when you pick this device up.'
    )
  }
  if (stripped.length > MAX_NAME_LENGTH) {
    throw new IdentityError(
      `A device name is at most ${String(MAX_NAME_LENGTH)} characters. That one is ${String(stripped.length)}.`
    )
  }
  return stripped
}

export class DeviceIdentityStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  get path(): string {
    return join(this.#root, FILE)
  }

  /**
   * What this device is called, or nothing.
   *
   * Nothing is a legitimate answer and not an error: a device with one wallet
   * and no siblings has no use for a name, and demanding one during setup would
   * be a screen between somebody and their seed for no benefit.
   *
   * A corrupt or unreadable file also reads as nothing rather than throwing.
   * This value decides nothing, so failing to read it must not stop the device
   * booting, and a device that refused to start because a cosmetic file was
   * damaged would be a bad trade.
   */
  read(): DeviceIdentity | null {
    if (!existsSync(this.path)) return null
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (parsed === null || typeof parsed !== 'object') return null
      const { name, colour } = parsed as { name?: unknown; colour?: unknown }
      if (typeof name !== 'string' || typeof colour !== 'string') return null
      if (!(WALLET_COLOURS as readonly string[]).includes(colour)) return null
      // Normalised on the way out as well as in. The file is editable by
      // anyone holding the card, so what was written is not necessarily what
      // this code wrote.
      return { name: normaliseName(name), colour: colour as WalletColour }
    } catch {
      return null
    }
  }

  /** Name this device. Replaces whatever was there. */
  write(identity: { name: string; colour: string }): DeviceIdentity {
    const colour = WALLET_COLOURS.find((known) => known === identity.colour)
    if (colour === undefined) {
      throw new IdentityError(`Unknown colour. Expected one of: ${WALLET_COLOURS.join(', ')}.`)
    }
    const name = normaliseName(identity.name)

    mkdirSync(dirname(this.path), { recursive: true })
    // Written to a temporary file and renamed, so a power cut during a rename
    // leaves either the old name or the new one rather than half a file. The
    // wallets themselves are far more careful than this; a cosmetic file gets
    // the cheap version of the same idea.
    const temporary = `${this.path}.new`
    writeFileSync(temporary, `${JSON.stringify({ name, colour }, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.path)

    return { name, colour }
  }
}
