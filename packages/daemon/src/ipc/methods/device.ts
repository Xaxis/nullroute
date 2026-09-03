/**
 * Attestation, device identity and which network this wallet is on.
 *
 * Everything a screen asks before it can draw a header: what the device is
 * called, what it verified at boot, and which chain it is pointed at.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { abbreviateHash } from '../../boot/attestation.js'
import { networkById } from '@nullroute/core'
import { requireString, optionalString } from '../params.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function deviceMethods(ctx: HandlerContext): MethodTable {
  const { state, session, requireColour, activeWallet } = ctx

  return {
    'attestation.get': () => {
      return {
        rootHash: state.attestation.rootHash,
        rootHashShort: abbreviateHash(state.attestation.rootHash),
        specCount: state.attestation.specCount,
        invariantCount: state.attestation.invariantCount,
        tier: state.attestation.tier,
        version: state.attestation.version,
        checks: state.attestation.checks,
      }
    },

    'device.status': () => {
      // Reported here, not only where it is set, so a screen entered later in
      // the session still knows nothing is being written.
      return {
        hasWallet: session.hasWallet,
        unlocked: session.unlocked,
        backupConfirmed: session.backupConfirmed,
        fingerprint: session.fingerprint ?? null,
        ephemeral: session.ephemeral,
        activeWallet: activeWallet(),
        network: {
          id: session.network.id,
          label: session.network.label,
          isMainnet: session.network.isMainnet,
        },
      }
    },

    'network.get': () => {
      return {
        id: session.network.id,
        label: session.network.label,
        isMainnet: session.network.isMainnet,
      }
    },

    'network.set': (request) => {
      session.setNetwork(networkById(requireString(request, 'id')))
      return {
        id: session.network.id,
        label: session.network.label,
        isMainnet: session.network.isMainnet,
      }
    },

    /**
     * The health of this device's machine entropy sources.
     *
     * Asked for before offering a machine-only seed, and returned rather than
     * acted on: the screen has to be able to show the user what was and was
     * not observed. See docs/ENTROPY.md.
     */
    /**
     * What this device is called, and whether it has been named.
     *
     * Safe before unlocking, and deliberately so: "which of my three devices
     * is this" is the question you have at the moment you pick one up, which
     * is before any passphrase. Unauthenticated for the same reason, and the
     * response says so in a field rather than leaving a screen to remember.
     */
    'device.identity': () => {
      const stored = state.identity?.read() ?? null
      return {
        identity: stored,
        named: stored !== null,
        // Stated in the payload so a screen cannot forget it.
        verified: false,
        note:
          'This name is read from a file beside the wallets and is not verified. It decides ' +
          'nothing: it exists so you can tell one device from another.',
      }
    },

    /** Name this device, or rename it. */
    'device.setIdentity': (request) => {
      if (state.identity === undefined) {
        throw new Error('This daemon was started without storage, so it cannot be named.')
      }
      const colour = requireColour(request)
      return {
        identity: state.identity.write({
          name: requireString(request, 'name'),
          colour,
          // Carried through. Renaming a device rewrites this file, and
          // dropping the theme would reset the panel to dark as a side
          // effect of changing a name.
          theme: optionalString(request, 'theme', state.identity.read()?.theme ?? 'dark'),
        }),
      }
    },

    /**
     * Which theme the panel renders in.
     *
     * A SEPARATE METHOD from naming, because they are separate acts and one
     * of them happens far more often. Folding a theme into setIdentity would
     * mean every theme change re-validated and rewrote a name.
     *
     * Stored beside the wallets rather than inside one, so the LOCK screen
     * renders in the chosen theme. A preference sealed in a wallet could
     * only be read after unlocking, which means the first screen anybody
     * sees would always be the default and would flicker afterwards.
     *
     * Unauthenticated, and that is fine: it decides nothing. Somebody
     * holding the card can change which colours the panel uses and learn
     * nothing by it.
     */
    'device.setTheme': (request) => {
      if (state.identity === undefined) {
        throw new Error('This daemon was started without storage, so it cannot store a theme.')
      }
      const current = state.identity.read()
      if (current === null) {
        throw new Error(
          'Name this device before choosing a theme, so there is a file to keep it in.'
        )
      }
      return {
        identity: state.identity.write({
          name: current.name,
          colour: current.colour,
          theme: requireString(request, 'theme'),
        }),
      }
    },
  }
}
