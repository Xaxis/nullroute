import type { Metadata } from 'next'
import Link from 'next/link'
import { readFacts } from '../../lib/facts'
import { readParts } from '../../lib/status'
import { readInterop } from '../../lib/interop'
import { OG_IMAGE } from '../../lib/site'
import { Shot, ShotOverlays, checkedScreens } from '../../components/Device'
import { A, C, Figure, InlineMd, Prose, Section, Source } from '../../components/report'

export const metadata: Metadata = {
  title: 'The device',
  description:
    'What you build: a Raspberry Pi 4, the official 7 inch touchscreen, a USB webcam and a card, for roughly $100 to $120. What each screen shows and refuses, and how data crosses the gap with no network at all.',
  openGraph: { title: 'The device | nullroute', images: [OG_IMAGE] },
}

/**
 * The physical thing, before hardware bring-up.
 *
 * NO PHOTOGRAPHS YET, AND NO RENDER STANDING IN FOR ONE. The card has booted
 * under QEMU and not yet on a Pi, so a picture of a finished device would be a
 * claim about something that has not happened. The parts are listed as the
 * README lists them, and the screens are the real frontend on its own plate.
 * Photographs come with bring-up.
 */
export default function DevicePage() {
  const facts = readFacts()
  const { parts, cost } = readParts()
  const interop = readInterop()
  const fixtures = interop.groups.reduce((n, g) => n + g.files, 0)
  const screens = checkedScreens(facts.has)

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="pt-12 pb-12 sm:pt-16">
        <div className="label">The device</div>
        <h1 className="mt-3 font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.5rem] max-w-[24ch]">
          A Raspberry Pi, a 7 inch panel, a webcam, and no network.
        </h1>
        <Prose className="mt-6 text-[1.1875rem]">
          <p>
            The design needs capabilities, not one model: a 64-bit Pi with enough memory for
            Argon2id and a browser with no swap, an 800x480 touchscreen, and a camera the kernel has
            a driver for. The card built today targets the Pi 4 and the official 7 inch panel. Other
            boards follow as each one is brought up.
          </p>
        </Prose>
      </header>

      <Section n="1" kicker="Parts" title={`What you need, for roughly ${cost}.`} id="parts">
        <Figure
          n="1"
          title="Parts list"
          source={
            <>
              the parts table in the README, read when this site was built. Hardware bring-up on the
              Pi 4 is the next milestone, so none of this has run on the board yet.
            </>
          }
        >
          <div className="table-scroll">
            <table className="w-full border-collapse font-sans text-[0.875rem] leading-snug">
              <thead>
                <tr className="bg-sunk text-left">
                  <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink">
                    Part
                  </th>
                  <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink">
                    What to get
                  </th>
                  <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => (
                  <tr key={part.part} className="border-t border-line align-top">
                    <td className="px-3.5 py-3 font-semibold text-ink whitespace-nowrap">
                      {part.part}
                    </td>
                    <td className="px-3.5 py-3 text-ink min-w-[10rem]">{part.what}</td>
                    <td className="px-3.5 py-3 text-body min-w-[18rem]">
                      <InlineMd text={part.notes.replace(/\*\*/g, '')} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Figure>
        <Prose className="mt-8">
          <p>
            You do not need a network connection on the device, ever. The wifi and Bluetooth drivers
            and firmware are removed from the image rather than switched off, so reverting a setting
            does not bring them back. The radio chip itself is still on the board.
          </p>
        </Prose>
      </Section>

      <Section
        n="2"
        kicker="The air gap"
        title="Data crosses by camera, and nothing else."
        id="gap"
      >
        <dl className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line font-sans text-[0.9375rem] sm:grid-cols-3">
          {[
            [
              'In',
              'A PSBT, an address or a descriptor, read by a USB webcam as QR, animated in BBQr or UR when it is too large for one frame. No camera has read a code on a Pi yet.',
            ],
            [
              'Out',
              'The signed PSBT, an xpub or a descriptor, as QR on the panel, for the coordinator to scan.',
            ],
            [
              'Never',
              'Wifi, Bluetooth, USB networking, or any listener outside the device itself. An SD card transport is planned and not built.',
            ],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-4 py-4">
              <dt className="label">{k}</dt>
              <dd className="mt-1.5 text-body leading-relaxed">{v}</dd>
            </div>
          ))}
        </dl>
        <Prose className="mt-8">
          <p>
            Inside the device, the screens are a Chromium kiosk that can reach nothing but the
            signing daemon on its own machine (INV-NET-3), and the daemon holds the keys. The
            screens receive xpubs, addresses, descriptors and transactions, and that is all.{' '}
            <A href="/docs/using#the-two-transports">The two transports</A>.
          </p>
        </Prose>
      </Section>

      <Section
        n="3"
        kicker="Screens"
        title="What each screen is for, and what it refuses."
        id="screens"
      >
        <Prose>
          <p>
            The real frontend at the panel&rsquo;s 800x480, rendered by <C>make device-shots</C>{' '}
            from the gallery the layout and contrast checks measure. Select a screen for the full
            size.
          </p>
        </Prose>
        <ol className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2">
          {screens.map((screen, i) => (
            <li key={screen.file} className="min-w-0">
              <Shot screen={screen} />
              <div className="mt-3 font-sans">
                <div className="flex items-baseline gap-2">
                  <span className="label text-signal">Fig. 2{String.fromCharCode(97 + i)}</span>
                  <span className="text-[0.9375rem] text-ink">{screen.caption}</span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-body">{screen.detail}</p>
                <p className="mt-1.5 font-mono text-[0.75rem] text-muted">
                  Held to {screen.specs.join(', ')}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <Source>
          <C>apps/web/public/device</C>, stamped with the frontend bundle it was rendered from.{' '}
          <C>make device-shots-check</C> fails the build when the frontend changes and these do not.
        </Source>
        <p className="mt-8 font-sans text-[0.9375rem]">
          <Link href="/docs/using" className="link">
            Every screen, and what it refuses
          </Link>{' '}
          <span className="text-muted">&middot;</span>{' '}
          <Link href="/docs/install" className="link">
            Building and flashing a card
          </Link>
        </p>
      </Section>

      <Section n="4" kicker="Interop" title="Tested against what other wallets write." id="interop">
        <Prose>
          <p>
            A signer that sits in a quorum with other makers&rsquo; devices has to read their setup
            files exactly. These are real exports, kept verbatim with their hashes: files from
            Coldcard, Specter, Jade, Keystone, Electrum and Caravan and the BIP-129 vectors as
            Sparrow keeps them for its own importers, and Bitcoin Core 31.1&rsquo;s own output.
            Every address nullroute derives from the files it reads is compared with what Core
            derives from the same file.
          </p>
        </Prose>
        <Figure
          n="3"
          title={`${String(fixtures)} real files, by where they come from`}
          className="mt-8"
          source={
            <>
              <A href="/device/interop">spec/interop/README.md</A>, counted when this site was
              built. It lists each file with its origin, its SHA-256, what Sparrow does with it and
              what nullroute does.
            </>
          }
        >
          <div className="overflow-hidden rounded-[4px] border border-line bg-surface">
            <table className="w-full border-collapse font-sans text-[0.875rem] leading-snug">
              <tbody>
                {interop.groups.map((group) => (
                  <tr key={group.title} className="border-t border-line first:border-t-0">
                    <td className="px-3.5 py-2.5 text-ink">{group.title}</td>
                    <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-body">
                      {group.files}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Figure>
        <Prose className="mt-8">
          <p>
            The README also lists {interop.gaps} gaps, each asserted by a test as it stands: the
            formats nullroute refuses and the checks it leaves to the user. Writing them down is the
            point; a fixture that only ever passed would prove less.{' '}
            <A href="/device/interop">Every file, and every gap</A>.
          </p>
        </Prose>
      </Section>

      <ShotOverlays screens={screens} closeTo="screens" />
    </div>
  )
}
