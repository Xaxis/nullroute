/**
 * Backup and restore of a whole wallet.
 *
 * Spec: daemon.store.backup
 *
 * The store is one device's copy. A backup is what survives that device being
 * lost, dropped or wiped, and it has to be restorable onto hardware that has
 * never seen the original. So this is a versioned, self-describing document
 * rather than a dump of internal state: a third party should be able to write a
 * restore tool from the spec alone, and nothing about the format should require
 * reading this code.
 *
 * WHAT GOES IN, AND THE ONE REAL DECISION. Registrations, the network, the
 * label, and OPTIONALLY the seed. Seedless is the default and it is the safer
 * one: a backup without a seed restores a watch-only device that can verify
 * addresses and check change, and it is worth nothing to whoever finds it. A
 * backup WITH a seed is a second copy of the money, under one passphrase, and
 * every place that offers it says so in those words.
 *
 * It reuses the sealed envelope rather than inventing a second format. The
 * threat is identical: a file, at rest, that an attacker may hold indefinitely.
 * A backup format with its own crypto would be a second thing to get right and
 * a second thing to review.
 */

import { bytesToHex } from '@noble/hashes/utils.js'
import { Secret, type Network, networkById } from '@nullroute/core'
import { open, seal, seedFromHex, StoreError, type Envelope, type KdfCost } from './envelope.js'

/** Bumped when the payload shape changes in a way a reader must notice. */
const BACKUP_VERSION = 1
const FORMAT = 'nullroute-backup'

export interface BackupContents {
  readonly network: Network
  readonly registrations: readonly string[]
  readonly label: string
  /** Absent for a watch-only backup, which is the default. */
  readonly seed?: Secret
  /**
   * Whether the seed was derived with a BIP-39 passphrase. Meaningful only
   * with a seed, and sealed with it.
   */
  readonly bip39Passphrase?: boolean
}

export interface RestoredBackup {
  readonly network: Network
  readonly registrations: readonly string[]
  readonly label: string
  /** Present only when the backup carried one. */
  readonly seed?: Secret
  /** True when this restores a spending wallet rather than a watching one. */
  readonly hasSeed: boolean
  /**
   * Whether the restored seed carries a BIP-39 passphrase. False for a backup
   * written before the flag was sealed, which is what those always said.
   */
  readonly bip39Passphrase: boolean
  readonly createdWith: string
}

/** The document, as it appears on a card or in a QR sequence. */
interface BackupDocument {
  readonly format: typeof FORMAT
  readonly version: number
  /**
   * Plaintext, deliberately.
   *
   * Someone holding an unlabelled encrypted file and three passphrases needs to
   * know which is which, and the alternative is trying each against every file.
   * It leaks that a nullroute backup exists and what its owner called it, which
   * a file named `wallet-backup.json` on an SD card leaks anyway.
   */
  readonly label: string
  readonly network: string
  readonly hasSeed: boolean
  readonly createdWith: string
  readonly envelope: Envelope
}

interface SealedBackup {
  readonly v: number
  /**
   * Inside the ciphertext, and authenticated.
   *
   * The outer document carries a copy for a human to read before typing a
   * passphrase, and that copy is editable by anyone holding the file. Restoring
   * from it would let someone flip a signet backup to mainnet with a text
   * editor, which is a way to get a user treating real addresses as worthless
   * test ones.
   */
  readonly network: string
  readonly registrations: readonly string[]
  /** Hex, because JSON has no bytes. Absent for a watch-only backup. */
  readonly seed?: string
  /**
   * SEALED WITH THE SEED, because it decides a warning. A wallet made with a
   * BIP-39 passphrase is shown that the passphrase matters, since the words
   * alone restore a different, empty wallet. The backup did not carry the
   * flag, so a restored copy of exactly that wallet came back saying it had no
   * passphrase and the warning was off on the wallets it exists for. The same
   * class of bug as 8cb9494 and fed1a51, by a third route.
   */
  readonly bip39Passphrase?: boolean
}

/**
 * Write a backup.
 *
 * The seed is borrowed, never consumed: the caller still owns it.
 */
export function createBackup(
  contents: BackupContents,
  passphrase: string,
  version: string,
  kdf?: KdfCost
): string {
  if (passphrase.length === 0) {
    throw new StoreError('Refusing to write a backup with an empty passphrase.')
  }

  const payload: SealedBackup = {
    v: BACKUP_VERSION,
    network: contents.network.id,
    registrations: contents.registrations,
    // bytesToHex, not Buffer.from: a Buffer copy of the seed lands in Node's
    // shared pool and outlives this call (INV-STORE-9).
    ...(contents.seed === undefined
      ? {}
      : {
          seed: bytesToHex(contents.seed.bytes),
          bip39Passphrase: contents.bip39Passphrase === true,
        }),
  }

  using plaintext = Secret.fromBytes(
    new TextEncoder().encode(JSON.stringify(payload)),
    'backup-payload'
  )

  const document: BackupDocument = {
    format: FORMAT,
    version: BACKUP_VERSION,
    label: contents.label,
    network: contents.network.id,
    // Outside the ciphertext so a user can tell, before typing a passphrase,
    // whether this file is worth the care a seed backup deserves. It is also
    // inside it implicitly, since the sealed payload either has a seed or does
    // not, and the restore trusts that one rather than this.
    hasSeed: contents.seed !== undefined,
    createdWith: version,
    envelope: seal(plaintext, passphrase, kdf),
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * Read a backup.
 *
 * Everything about the outer document is a hint until the envelope opens.
 * `hasSeed` and `network` sit in plaintext and an attacker with the file can
 * edit them, so the restored values come from the sealed payload and the outer
 * ones are used only to explain the file before a passphrase is entered.
 */
export function restoreBackup(text: string, passphrase: string): RestoredBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new StoreError(`That backup file is not readable. ${(err as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new StoreError('That backup file is not an object.')
  }
  const document = parsed as Record<string, unknown>

  if (document['format'] !== FORMAT) {
    throw new StoreError(
      `That is not a ${FORMAT} file (found ${JSON.stringify(document['format'])}).`
    )
  }
  if (document['version'] !== BACKUP_VERSION) {
    throw new StoreError(
      `That backup is version ${String(document['version'])} and this build reads version ` +
        `${String(BACKUP_VERSION)}. A newer nullroute wrote it.`
    )
  }

  const envelope = document['envelope']
  if (typeof envelope !== 'object' || envelope === null) {
    throw new StoreError('That backup file has no envelope.')
  }

  using plaintext = open(envelope as Envelope, passphrase)

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext.bytes))
  } catch {
    throw new StoreError('The backup opened but its contents are not readable.')
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new StoreError('The backup opened but its contents are not an object.')
  }
  const sealed = payload as Record<string, unknown>

  if (sealed['v'] !== BACKUP_VERSION) {
    throw new StoreError('The backup contents are not in a layout this build understands.')
  }

  const registrations = sealed['registrations']
  if (!Array.isArray(registrations) || registrations.some((r) => typeof r !== 'string')) {
    throw new StoreError('The backup holds a registration list this build cannot read.')
  }

  // The network comes from inside the ciphertext. The copy in the outer
  // document is convenience for a human and is not authenticated, so restoring
  // from it would let someone flip a signet backup to mainnet by editing a
  // file, which is a good way to get a user to treat real addresses as test
  // ones.
  const networkId = sealed['network']
  if (typeof networkId !== 'string') {
    throw new StoreError('The backup does not name a network inside its ciphertext.')
  }

  const seedHex = sealed['seed']
  const hasSeed = typeof seedHex === 'string'
  if (seedHex !== undefined && !hasSeed) {
    throw new StoreError('The backup holds a seed field this build cannot read.')
  }

  // Refused if present and not a boolean, like every other sealed field: it
  // decides whether a warning is shown. Absent is a backup from before the
  // flag was sealed, which never said anything else.
  const flag = sealed['bip39Passphrase']
  if (flag !== undefined && typeof flag !== 'boolean') {
    throw new StoreError('The backup holds a passphrase flag this build cannot read.')
  }

  const label = typeof document['label'] === 'string' ? document['label'] : 'restored wallet'
  const createdWith =
    typeof document['createdWith'] === 'string' ? document['createdWith'] : 'unknown'

  return {
    network: networkById(networkId),
    registrations: registrations as readonly string[],
    label,
    hasSeed,
    bip39Passphrase: hasSeed && flag === true,
    createdWith,
    ...(hasSeed ? { seed: Secret.fromBytes(seedFromHex(seedHex), 'restored-seed') } : {}),
  }
}

/**
 * What a backup says about itself, without opening it.
 *
 * So a screen can say "this is a seed backup of Family Vault on signet" before
 * asking for a passphrase. Every field here is unauthenticated and the caller
 * must present it as such: it is a label on a box, not the contents.
 */
export function describeBackup(text: string): {
  readonly label: string
  readonly network: string
  readonly hasSeed: boolean
  readonly createdWith: string
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new StoreError('That backup file is not readable.')
  }
  const document = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >
  if (document['format'] !== FORMAT) {
    throw new StoreError(`That is not a ${FORMAT} file.`)
  }
  return {
    label: typeof document['label'] === 'string' ? document['label'] : 'unnamed',
    network: typeof document['network'] === 'string' ? document['network'] : 'unknown',
    hasSeed: document['hasSeed'] === true,
    createdWith: typeof document['createdWith'] === 'string' ? document['createdWith'] : 'unknown',
  }
}
