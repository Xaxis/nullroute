/**
 * The device shell.
 *
 * Phase 1 has one screen. It exists so the lock screen can be seen and driven
 * against a real daemon rather than only asserted about in a test, and so the
 * IPC boundary is exercised end to end from the browser the device actually
 * runs.
 *
 * The failure state is deliberate: if the daemon is unreachable, this shows
 * that plainly instead of rendering an empty or optimistic screen. A frontend
 * that renders a lock screen with no attestation behind it would be showing a
 * user exactly the reassurance they came to check.
 */

import { useCallback, useEffect, useState } from 'react'
import { type NetworkId } from '@nullroute/core'
import { LockScreen, type AttestationView } from './screens/LockScreen.js'
import { call } from './lib/client.js'
import { httpTransport } from './lib/transport.js'

interface NetworkView {
  readonly id: NetworkId
  readonly label: string
  readonly isMainnet: boolean
}

type Status =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly attestation: AttestationView; readonly network: NetworkView }
  | { readonly kind: 'unreachable'; readonly message: string }

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [expanded, setExpanded] = useState(false)
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const transport = httpTransport()
        const attestation = await call<AttestationView>(transport, 'attestation.get')
        const network = await call<NetworkView>(transport, 'network.get')
        if (!cancelled) setStatus({ kind: 'ready', attestation, network })
      } catch (err) {
        if (!cancelled) {
          setStatus({ kind: 'unreachable', message: (err as Error).message })
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const onToggle = useCallback(() => {
    setExpanded((value) => !value)
  }, [])
  const onUnlock = useCallback(() => {
    setUnlocked(true)
  }, [])

  if (status.kind === 'loading') {
    return (
      <main className="nr-lock">
        <p className="nr-lock__caveat">Reading the device attestation.</p>
      </main>
    )
  }

  if (status.kind === 'unreachable') {
    return (
      <main className="nr-lock" data-testid="unreachable">
        <header className="nr-lock__head">
          <h1 className="nr-lock__title">nullroute</h1>
        </header>
        <div className="nr-banner nr-banner--testnet">
          <strong>No daemon</strong>
          <span>
            The signing daemon is not reachable, so there is no attestation to show and the wallet
            cannot be unlocked. Start it with <code className="nr-mono">make dev</code>.
          </span>
        </div>
        <p className="nr-lock__caveat nr-mono">{status.message}</p>
      </main>
    )
  }

  if (unlocked) {
    return (
      <main className="nr-lock">
        <header className="nr-lock__head">
          <h1 className="nr-lock__title">nullroute</h1>
        </header>
        <p className="nr-lock__caveat">
          Unlocked. Wallet screens land with phase 2: descriptors, PSBT review, and address
          verification.
        </p>
        <div className="nr-lock__actions">
          <button
            type="button"
            className="nr-button nr-button--primary"
            onClick={() => {
              setUnlocked(false)
            }}
          >
            Lock
          </button>
        </div>
      </main>
    )
  }

  return (
    <LockScreen
      attestation={status.attestation}
      network={status.network}
      onUnlock={onUnlock}
      expanded={expanded}
      onToggleExpanded={onToggle}
    />
  )
}
