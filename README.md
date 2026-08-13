# nullroute

An air-gapped Bitcoin signing device you can actually verify.

You roll 100 dice. The device turns them into a seed by a rule you can repeat on
any laptop. It never touches a network, it shows you every detail of a
transaction before signing, and it refuses to start unless its own code matches
a published hash.

> **Pre-1.0, unaudited, and not finished. Do not put money on this yet.**
> Phase 1 is complete and phase 2 is in progress. See [Status](#status).

---

## Table of contents

- [Is this for you?](#is-this-for-you)
- [Why it exists](#why-it-exists)
- [What you need](#what-you-need)
- [Try it on your computer](#try-it-on-your-computer)
- [How you verify it](#how-you-verify-it)
- [The operating system](#the-operating-system)
- [What it does not do](#what-it-does-not-do)
- [Status](#status)
- [Documentation](#documentation)
- [Contributing](#contributing)

---

## Is this for you?

**Probably yes if:** you want one signer in a multisig quorum that you can audit
end to end, you are comfortable with a terminal, and you like the idea of
checking your device's claims rather than trusting them.

**Probably no if:** you want a polished consumer product today, you want to hold
everything on one device, or you want something audited. Buy a Coldcard or a
BitBox02 for those, genuinely.

**The honest framing:** nullroute is designed to be *one key of three*, sitting
next to hardware from other vendors, and to be the one you can take apart.

---

## Why it exists

Good wallets already exist. This is not a better wallet.

A device that generates your seed inside a black box is asking you to trust the
box. You cannot inspect it, and a correct generator and a backdoored one look
identical from outside: both hand you 24 words. The usual answer is a better
black box. That is the wrong response: **you should not have to take anyone's
word for where your key came from.**

So nullroute does something different. You roll the dice yourself, and the
device shows you the arithmetic:

```console
$ printf '%s' '1234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234' | sha256sum
e56403e8522ddeae1b44a1e8148b1ba4d3b4c626ccf20980056eedcc7e0c0f35  -
```

That is the whole trick. If your device shows a different value for the same
rolls, it is lying to you, and now you know. No special tooling, no trust in us,
just `sha256sum` and a hundred dice rolls. That is 100 rolls exactly, not 99:
99 rolls is 255.911 bits, which is short of 256. On macOS use `shasum -a 256`.
The full procedure with a worked example is in
[docs/ENTROPY.md](docs/ENTROPY.md).

The same idea runs through everything else: the device publishes a hash of its
own code, its signatures are byte-for-byte reproducible and cross-checked against
libsecp256k1, and every wallet it creates is a standard mnemonic plus a standard
descriptor, so Bitcoin Core alone can restore it.

---

## What you need

Roughly $100 to $120.

| Part | What to get | Notes |
| --- | --- | --- |
| Board | Raspberry Pi 5, or Pi 4 (4GB) | The Pi 5 can do a signed boot chain later. The Pi 4 cannot. |
| Screen | 7 inch 800x480 touchscreen | Any small HDMI display works. |
| Storage | 16GB+ A2 SD card | The image is small. |
| Dice | One d6 | Casino grade if you care. Any die works. |
| Camera | Pi Camera Module 3 | Optional. Skip it and use an SD card to move data. |
| Case, PSU | Anything, official PSU | An underpowered supply causes strange slowness. |

You do **not** need a network connection on the device, ever. That is the point.

---

## Try it on your computer

You do not need a Raspberry Pi to look at this. The whole device runs on a Mac
or Linux machine.

**Requires Node 24.**

```bash
git clone git@github.com:Xaxis/nullroute.git
cd nullroute
make install     # npm ci, exact versions from the committed lockfile
make dev         # the device, at http://127.0.0.1:5180
```

That starts the signing daemon on a Unix socket and serves the device UI against
it. You will see the real lock screen, with the real hash of the code you just
built. From there you can roll dice, create a wallet, and browse addresses
exactly as you would on hardware.

Ctrl-C stops both halves. If it ever reports that port 5180 is in use, an
earlier run is still going; the message names the process and how to stop it.
To run alongside one instead, set the port:

```bash
NULLROUTE_UI_PORT=5181 make dev
```

Try this once it is running: press **Unlock**, pick **Signet** (a test network,
so nothing is real), and roll some dice. Watch the entropy counter. Then try
entering the same digit a hundred times and read what it says.

Other things worth running:

```bash
make verify      # the five checks, and the hash the lock screen shows
make check       # everything CI runs, about a minute
make test        # the whole suite
make web         # the nullroute.diy website, at localhost:3000
```

`make` on its own lists every target.

---

## How you verify it

This is the part that makes nullroute different, so it is worth doing at least
once. Every step uses tools that are not ours.

**1. Check the code is the code.** `MANIFEST.lock` is a SHA-256 of every source
file, in the exact output format of `sha256sum`, so you check it with
`sha256sum` rather than with our tool:

```console
$ sha256sum -c MANIFEST.lock      # every file matches
$ sha256sum MANIFEST.lock         # the number the device shows at boot
```

**2. Check the device agrees.** The lock screen displays that same hash before
you enter a PIN. Three values should match: what you computed, what the device
shows, and what the release published.

**3. Check your seed.** Roll the dice, then hash the same digits on another
machine. If the two disagree, stop.

**4. Check a signature.** Signatures are deterministic (RFC 6979 and BIP-340
with `aux_rand` fixed to zero), so the same key and transaction always produce
identical bytes. Anyone with the seed can recompute them. There is no room in a
deterministic signature to hide a leaked key.

**5. Check you do not need us.** Take your mnemonic and descriptor to Bitcoin
Core and confirm it sees the same addresses. Doing this by hand is the check
that matters, and it is the one that makes walking away from this project
harmless. The CI job that would automate it is written and disabled (`if:
false`), because phase 2 does not yet persist a wallet to recover. If the hand
procedure ever fails, that is a security report.

Full procedure: [docs/VERIFICATION.md](docs/VERIFICATION.md), written for
someone who does not trust this project and should not have to.

---

## The operating system

A verified application on an unverifiable operating system is a lock on a door
in a paper wall, so nullroute ships its own image rather than asking you to
harden Raspberry Pi OS yourself.

**What it is.** A Debian trixie image built with
[rpi-image-gen](https://github.com/raspberrypi/rpi-image-gen), the official
Raspberry Pi builder, pinned to an exact commit. The system partition is a
read-only erofs filesystem with a dm-verity hash tree over it; your wallet lives
on a separate LUKS2-encrypted partition. No swap, no SSH, no network daemons, and
the wifi and Bluetooth firmware packages are removed rather than merely disabled.

**Why not roll our own from scratch?** Buildroot with SeedSigner's approach is
philosophically nicer, because the whole OS becomes a single file you can hash.
It is unavailable to us: the Pi's boot ramdisk limit is 180 MB, and a Chromium
kiosk plus a Node daemon does not fit. The two-partition split is forced by the
platform, not chosen.

**Verifying it comes in three tiers,** and the difference between them matters:

| Tier | What you get | Cost |
| --- | --- | --- |
| **0** | Reproducible image, signed release, verify the hash before you flash and read the card back after. Works on any board. | Nothing. This is the default. |
| **1** | The system partition is under a dm-verity hash tree, and its root hash shows at boot beside the application hash. | A more involved build. Still reversible. |
| **2** | The silicon itself verifies the boot chain, so the hash the device shows cannot be chosen by an attacker. | **Irreversible.** Burns one-time fuses. Lose the key and every device is bricked. |

**Read this bit carefully:** tier 1 on its own *moves* the problem rather than
solving it. The boot partition is not covered by the hash tree, and that is
where the root hash is read from. An attacker who rewrites it supplies their own
number and the device displays exactly what they chose. Only tier 2 closes that,
and tier 2's own root of trust is closed-source silicon nobody outside Raspberry
Pi can audit.

Other distributions are meant to be possible later. The build system is designed
so a hardening profile is a set of **assertions checked against the built
image**, not a recipe, which means a second backend is correct when the
unchanged checks pass against its output rather than when someone reviewed its
config. See [provisioning/](provisioning/README.md) and
[docs/PROVISIONING.md](docs/PROVISIONING.md).

---

## What it does not do

Please read [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) before trusting this
with anything. The headlines:

**There is no secure element.** Your keys are encrypted with a key derived from
your PIN, and that is the entire physical defence. Someone holding your SD card
is limited only by how good your PIN is. A Coldcard or BitBox02 is genuinely
better on this specific point, which is exactly why the recommended setup puts
one of them next to nullroute in a quorum.

**It is one signer, not your whole wallet.** Designed for 2-of-3 or 3-of-5
alongside other vendors' hardware.

**Duress features buy time, not safety.** This code is public, so anyone who has
read it knows hidden profiles exist. Under real threat, give them the money.

**Also out of scope:** side channel attacks, sophisticated physical attacks on
the chip, evil maid attacks without secure boot, and a backdoored OS image
flashed before you ever started.

**Deliberately absent:** price display, fiat conversion, Lightning, coinjoin,
and anything involving a cloud.

---

## Status

**Phase 1 complete. Phase 2 in progress.**

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Spec system, entropy, BIP-39/32, daemon, lock screen, networks | **Complete** |
| 2 | Descriptors, addresses, PSBT review, signing. **Provisioning tier 0.** | In progress |
| 3 | Multisig, cosigner registration, encrypted store, PIN. **Tier 1.** | Not started |
| 4 | BIP-322 message signing, BIP-85, BIP-329 labels | Not started |
| 5 | Wallet layer, optional and lower assurance | Not started |
| 6 | Bridge companion, runs on a networked machine | Not started |
| 7 | Miniscript, taproot script paths, SeedXOR. **Tier 2.** | Not started |

Working today: dice entropy end to end, BIP-39 and BIP-32 against the official
vectors, all four address types, descriptor parsing with BIP-380 checksums,
address verification, and the daemon and UI that tie them together.

Not working yet, and needed before this is safe for funds: the encrypted store,
the PIN gate, PSBT signing, and multisig. **There is nowhere to persist a wallet
yet**, which is why phase 3 exists.

Nothing later is pulled forward. That ordering, and the irreversible work
staying last, is what keeps a large feature list from eroding the small part
that holds keys.

---

## Documentation

Start with whichever question you have:

| Document | Answers |
| --- | --- |
| [Threat model](docs/THREAT-MODEL.md) | What is this safe against, and what is it not? |
| [Verification](docs/VERIFICATION.md) | How do I check the device is honest? |
| [Entropy](docs/ENTROPY.md) | How do dice become a seed, and how do I check it? |
| [Provisioning](docs/PROVISIONING.md) | How do I build and verify the device image? |

All four are rendered at [nullroute.diy](https://nullroute.diy) directly
from this repository, so the published page and the file that ships with the
code are the same bytes.

---

## Repository layout

```
docs/          The documents above. A deliverable, not an afterthought.
spec/          Machine-readable spec schema and official BIP test vectors
provisioning/  Hardening profiles, as assertions with verifiers
packages/
  core/        Crypto and Bitcoin logic. Pure, no I/O, runs in a browser too.
  daemon/      Holds the keys. Unix socket only. Refuses to start unverified.
  ui/          The device screens
  verify/      The tool that checks code, specs and tests agree
apps/web/      nullroute.diy. Never ships to the device.
```

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). The rules that will surprise you: no new
dependency without sign-off, no feature without a passing spec, no network
capability anywhere in `packages/`, and no em dashes.

Security issues go through [SECURITY.md](SECURITY.md), never the public issue
tracker.

---

## Licence

MIT. See [LICENSE](LICENSE).

MIT is the Bitcoin ecosystem's norm (Bitcoin Core, bitcoinjs-lib and the whole
noble/scure stack this depends on are all MIT), and its attribution requirement
keeps provenance traceable when security code gets vendored into something else.
