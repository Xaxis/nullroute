/**
 * How a transaction crosses the gap: built online, carried by QR code, read
 * and signed offline, carried back. The one diagram on the front page.
 *
 * HTML, not an SVG picture. A drawing scaled to a phone shrinks its labels to
 * a few pixels; this reflows to a column instead, with the arrows turned to
 * match. The wallets named are the ones docs/USING.md lists as reading the
 * device's animated formats (BBQr and UR), and no others.
 */

function Crossing({ toDevice, label, note }: { toDevice: boolean; label: string; note: string }) {
  return (
    <div className="min-w-0">
      <div
        aria-hidden="true"
        className={`hidden lg:flex items-center text-ink ${toDevice ? '' : 'flex-row-reverse'}`}
      >
        <span className="h-px flex-1 bg-current" />
        <svg
          viewBox="0 0 10 10"
          className={`size-2.5 shrink-0 fill-current ${toDevice ? '' : 'rotate-180'}`}
        >
          <path d="M0 0 L10 5 L0 10 Z" />
        </svg>
      </div>
      <p className="lg:mt-2.5 flex items-baseline gap-2 text-[0.9375rem] font-semibold text-ink">
        <span aria-hidden="true" className="lg:hidden font-mono text-signal">
          {toDevice ? '↓' : '↑'}
        </span>
        {label}
      </p>
      <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">{note}</p>
    </div>
  )
}

export function SigningLoop() {
  return (
    <figure className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-8 lg:items-center">
      <div className="rounded-[6px] border border-border bg-surface px-5 py-5">
        <p className="font-mono text-[0.75rem] uppercase tracking-[0.08em] text-muted">Online</p>
        <p className="mt-1.5 text-[1.0625rem] font-semibold text-ink">Your computer</p>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">
          Sparrow, Nunchuk or another coordinator builds the transaction, and broadcasts it once it
          comes back signed. It never holds a key.
        </p>
      </div>

      <div className="grid gap-5 px-1 lg:px-0">
        <Crossing
          toDevice
          label="The unsigned transaction"
          note="A QR code on your screen, read by the device's webcam."
        />
        <p className="hidden lg:block text-center font-mono text-[0.75rem] uppercase tracking-[0.08em] text-muted">
          air gap
        </p>
        <Crossing
          toDevice={false}
          label="The signed transaction"
          note="A QR code on the device, read by your computer's camera."
        />
      </div>

      <div className="rounded-[6px] border border-ink bg-paper px-5 py-5">
        <p className="font-mono text-[0.75rem] uppercase tracking-[0.08em] text-signal">Offline</p>
        <p className="mt-1.5 text-[1.0625rem] font-semibold text-ink">nullroute</p>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">
          Holds the keys. Shows every output and the fee on its own screen before it will sign.
          Nothing is broadcast here; the device has no network.
        </p>
      </div>
      <figcaption className="sr-only">
        The transaction is built on an online computer, crosses to the offline device as a QR code,
        is reviewed and signed there, and crosses back as a QR code.
      </figcaption>
    </figure>
  )
}
