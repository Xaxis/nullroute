/**
 * @nullroute/core: pure crypto and Bitcoin logic.
 *
 * Zero I/O and zero side effects, so this package runs identically in Node and
 * in a browser. That is deliberate: a reviewer can load it standalone and
 * reproduce every result the device claims, without running the device.
 *
 * Every exported symbol here must appear in some spec's `covers` list, or
 * `make verify` fails. See docs/VERIFICATION.md.
 */

export { Secret, SecretDisposedError } from './util/secret.js'
export * from './entropy/index.js'
export * from './network/index.js'
export * from './bip39/index.js'
export * from './derive/index.js'
export * from './address/index.js'
export * from './descriptor/index.js'
export * from './psbt/index.js'
export * from './qr/index.js'
