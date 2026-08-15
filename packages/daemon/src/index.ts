/**
 * @nullroute/daemon: the process that holds key material.
 *
 * Everything with a socket, a file handle or a hardware device lives here.
 * packages/core stays pure so a reviewer can load it standalone; this package
 * is where the impurity is concentrated and audited.
 */

export {
  AttestationError,
  requirePassingVerification,
  manifestRootHash,
  abbreviateHash,
} from './boot/attestation.js'
export type { BootAttestation, VerificationReport, VerificationCheck } from './boot/attestation.js'

export {
  IpcError,
  MAX_REQUEST_BYTES,
  startIpcServer,
  assertNoNetworkListeners,
} from './ipc/socket.js'
export type { IpcRequest, IpcResponse, IpcHandler, IpcServerOptions } from './ipc/socket.js'

export { createHandler } from './handler.js'
export type { DaemonState } from './handler.js'

export { SCRIPT_TYPES, buildOwnedIndex, changeLookup, signingPathsFor } from './psbt.js'
export type { OwnedAddress } from './psbt.js'

export {
  BadPassphraseError,
  KDF_DEFAULTS,
  StoreError,
  assertEnvelope,
  equalBytes,
  open,
  seal,
} from './store/envelope.js'
export type { Envelope, KdfCost, KdfParams } from './store/envelope.js'

export { MAX_ATTEMPTS, WalletStore } from './store/store.js'
export type { StoreStatus } from './store/store.js'

export { Session, SessionError } from './session.js'
export type { WalletSession, SeedProvenance } from './session.js'
