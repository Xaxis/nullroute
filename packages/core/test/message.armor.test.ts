/**
 * Tests for the armoured signed-message block.
 *
 * THE ONE THAT MATTERS is that the message comes out byte for byte. What was
 * signed is a specific sequence of bytes, so a parser that trims a trailing
 * space turns a good proof into "invalid" and sends somebody looking for fraud
 * where there was a space.
 */

import { describe, expect, it } from 'vitest'
import { parseSignedMessageBlock } from '../src/message/armor.js'

const ADDRESS = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
const SIGNATURE = 'H1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/abcd='

function block(message: string): string {
  return [
    '-----BEGIN BITCOIN SIGNED MESSAGE-----',
    message,
    '-----BEGIN SIGNATURE-----',
    ADDRESS,
    SIGNATURE,
    '-----END BITCOIN SIGNED MESSAGE-----',
  ].join('\n')
}

describe('core.message.armor', () => {
  /** INV-MSG-13. All three parts, which is what a proof is. */
  it('reads-the-address-the-message-and-the-signature', () => {
    expect(parseSignedMessageBlock(block('Hello World'))).toEqual({
      address: ADDRESS,
      message: 'Hello World',
      signature: SIGNATURE,
    })
  })

  /**
   * INV-MSG-13. A message may legitimately begin or end with a space, and that
   * space is signed. Trimming it is how a parser turns a good proof into an
   * accusation.
   */
  it('keeps-the-message-byte-for-byte-including-whitespace', () => {
    const message = '  leading and trailing  '
    expect(parseSignedMessageBlock(block(message))?.message).toBe(message)
  })

  /** INV-MSG-13. Multi-line messages are ordinary and must survive intact. */
  it('keeps-every-line-of-a-multi-line-message', () => {
    const message = 'first line\nsecond line\n\nfourth after a blank one'
    expect(parseSignedMessageBlock(block(message))?.message).toBe(message)
  })

  /**
   * INV-MSG-13. A block that travelled through Windows arrives with \r\n
   * throughout, and no signer ever signed the \r.
   */
  it('strips-carriage-returns-that-no-signer-signed', () => {
    const windows = block('Hello World').replaceAll('\n', '\r\n')
    expect(parseSignedMessageBlock(windows)?.message).toBe('Hello World')
  })

  /** INV-MSG-13. Some writers wrap a long signature across lines. */
  it('rejoins-a-signature-wrapped-across-lines', () => {
    const wrapped = [
      '-----BEGIN BITCOIN SIGNED MESSAGE-----',
      'Hello World',
      '-----BEGIN SIGNATURE-----',
      ADDRESS,
      SIGNATURE.slice(0, 30),
      SIGNATURE.slice(30),
      '-----END BITCOIN SIGNED MESSAGE-----',
    ].join('\n')
    expect(parseSignedMessageBlock(wrapped)?.signature).toBe(SIGNATURE)
  })

  /**
   * INV-MSG-14. Not a block is the ordinary case, not an error: the field may
   * simply hold a bare signature somebody pasted.
   */
  it('returns-nothing-rather-than-throwing-on-anything-else', () => {
    for (const text of [
      '',
      'just a signature',
      '-----BEGIN BITCOIN SIGNED MESSAGE-----\nno end marker',
      '-----BEGIN BITCOIN SIGNED MESSAGE-----\nmsg\n-----END BITCOIN SIGNED MESSAGE-----',
      // A signature with no address: proves nothing, so it is not a block.
      [
        '-----BEGIN BITCOIN SIGNED MESSAGE-----',
        'Hello',
        '-----BEGIN SIGNATURE-----',
        ADDRESS,
        '-----END BITCOIN SIGNED MESSAGE-----',
      ].join('\n'),
      'x'.repeat(9000),
    ]) {
      expect(parseSignedMessageBlock(text), text.slice(0, 30)).toBeNull()
    }
  })
})
