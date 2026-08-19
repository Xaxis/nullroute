/**
 * The armoured block that wallets pass signed messages around in.
 *
 * Spec: core.message.armor
 *
 * A proof is three things: an address, a message, and a signature. Handing
 * somebody a signature alone is handing them nothing, so wallets wrap all three
 * in a block that looks like this:
 *
 *     -----BEGIN BITCOIN SIGNED MESSAGE-----
 *     the message, which may run to several lines
 *     -----BEGIN SIGNATURE-----
 *     the address
 *     the base64 signature
 *     -----END BITCOIN SIGNED MESSAGE-----
 *
 * NOT INVENTED HERE. This is what Electrum writes and what Bitcoin Knots reads,
 * and supporting it is the difference between scanning one QR and typing three
 * fields on a panel with no keyboard. A format this device made up would be a
 * format nothing else can produce.
 *
 * THE MESSAGE IS TAKEN VERBATIM, and that is the whole difficulty. What was
 * signed is a specific sequence of bytes, so trimming a trailing space or
 * normalising a line ending changes the message into one the signature does not
 * cover, and the user sees "invalid" for a proof that was fine. Only the block
 * framing is stripped. Line endings are normalised to \n exactly once, on the
 * whole input, because a block that travelled through Windows arrives with \r\n
 * throughout and no signer ever signs the \r.
 *
 * NOTHING HERE VERIFIES ANYTHING. This is text handling. It returns three
 * strings and has no opinion about whether they are a proof: that is decided by
 * the verifier, from the address, and this module must not be able to influence
 * it.
 */

export interface SignedMessageBlock {
  readonly address: string
  readonly message: string
  readonly signature: string
}

const BEGIN = '-----BEGIN BITCOIN SIGNED MESSAGE-----'
const SIGNATURE = '-----BEGIN SIGNATURE-----'
const END = '-----END BITCOIN SIGNED MESSAGE-----'

/** A block this size is not something a person is checking by eye. */
const MAX_BLOCK_BYTES = 8192

/**
 * Read an armoured block, or return null if the text is not one.
 *
 * Null rather than a throw, because the caller is a screen handling whatever
 * the camera read: text that is not a block is the ordinary case, not an error,
 * and the field it came from may simply be a bare signature.
 */
export function parseSignedMessageBlock(text: string): SignedMessageBlock | null {
  if (text.length > MAX_BLOCK_BYTES) return null

  // Once, on the whole input. A block written on Windows carries \r\n on every
  // line and no signer signs the \r.
  const normalised = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')

  const begin = normalised.indexOf(BEGIN)
  if (begin === -1) return null
  const sigMarker = normalised.indexOf(SIGNATURE, begin)
  if (sigMarker === -1) return null
  const end = normalised.indexOf(END, sigMarker)
  if (end === -1) return null

  // Between the first marker and the second, minus the newline that ends the
  // marker line and the one that begins the next marker line. Sliced rather
  // than trimmed: a message may legitimately begin or end with a space, and
  // that space is signed.
  const messageStart = begin + BEGIN.length + 1
  const message = normalised.slice(messageStart, Math.max(messageStart, sigMarker - 1))

  const tail = normalised
    .slice(sigMarker + SIGNATURE.length, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  // An address and a signature. A block with one line has no address, and a
  // signature without the address it is about proves nothing.
  const [address, ...rest] = tail
  if (address === undefined || rest.length === 0) return null

  // Joined, because some writers wrap a long base64 signature across lines.
  return { address, message, signature: rest.join('') }
}
