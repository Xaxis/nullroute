# nullroute

An air-gapped Bitcoin signing device you can actually verify.

You roll 100 dice. The device turns them into a seed by a rule you can repeat on
any laptop. It never touches a network, it shows you every detail of a
transaction before signing, and it refuses to start unless its own code matches
a published hash.

> **Pre-1.0, unaudited, and not finished. Do not put money on this yet.**
> Phases 1, 2 and 4 are complete and phase 3 is in progress. See
> [Status](#status).

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
earlier run is still going. `make dev` refuses rather than stepping on it, and
names the process; to stop it and start clean in one step:

```bash
make restart           # stop whatever is running, rebuild, start again
make restart FRESH=1   # the same, and erase the local wallets first
```

`make restart` keeps your wallets unless you ask otherwise, and tells you how
many it is keeping. `FRESH=1` names the directory and counts what it is about to
erase, because a restart that silently threw away wallets would be one nobody
could trust.

**`make deploy` is not part of this.** It publishes the website to nullroute.diy
and has nothing to do with running the device locally.

To run alongside an existing instance instead of replacing it, set the port:

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
harmless. CI runs the same drill on every commit against a real regtest Core,
for all four address types including taproot, and for a 2-of-3 quorum in both
native segwit and taproot, built from three distinct seeds, where two separate
devices sign in sequence. Run it yourself with
`make test-recovery-drill`. If it ever fails, that is a security report.

Full procedure: [docs/VERIFICATION.md](docs/VERIFICATION.md), written for
someone who does not trust this project and should not have to.

---

## The operating system

A verified application on an unverifiable operating system is a lock on a door
in a paper wall, so nullroute is designed around its own image rather than
asking you to harden Raspberry Pi OS yourself.

**None of it is published yet, and there is nothing to flash.** The system
partition builds and is reproducible; the boot partition and the installer are
not written. `make image` says so and exits. See
[Installing it](docs/INSTALL.md) for what you can actually run today, which is
the whole device on your computer.

**What it is.** A Debian bookworm image built with `mmdebstrap` and `genimage`
in a digest-pinned container, so the build host is itself a fixed artifact. The
system partition is a read-only erofs filesystem with a dm-verity hash tree over
it; your wallet lives on a separate LUKS2-encrypted partition. No swap, no SSH,
no network daemons, and the wifi and Bluetooth firmware packages are removed
rather than merely disabled.

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
[docs/VERIFICATION.md](docs/VERIFICATION.md#building-a-device).

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

**Phases 1, 2 and 4 complete. Phase 3 in progress.**

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Spec system, entropy, BIP-39/32, daemon, lock screen, networks | **Complete** |
| 2 | Descriptors, addresses, PSBT review, signing. **Provisioning tier 0.** | **Complete** |
| 3 | Encrypted store, passphrase, multisig and cosigner registration done. **Tier 1** outstanding. | In progress |
| 4 | BIP-322 message signing and verification, BIP-85 child seeds, BIP-329 labels | **Complete** |
| 5 | Wallet layer, optional and lower assurance | Not started |
| 6 | Bridge companion, runs on a networked machine | Not started |
| 7 | Miniscript, taproot script paths, SeedXOR. **Tier 2.** | Not started |

Phase 4 landing before phase 3 finishes is not phases being pulled forward. It
is one item inside phase 3, the dm-verity attestation of tier 1, waiting on an
image build system that does not exist yet. Everything in phase 3 that is
software is done.

**Working today.**

*Keys.* Dice entropy end to end, BIP-39 and BIP-32 against the official
vectors, all four address types, BIP-85 child seeds derived from one master.

*Spending.* Descriptor parsing with BIP-380 checksums, address verification,
PSBT review, and deterministic signing cross-checked against libsecp256k1.

*Several devices.* Multisig with cosigner registration that refuses a quorum
this device holds no key in, coordinator file import and bundle export, and a
screen for comparing a quorum's addresses across devices, which is the cheap
proof they all registered the same descriptor.

*Living with it.* An encrypted store so a wallet survives a reboot, several
named wallets on one device, encrypted backup and restore, BIP-329 labels that
appear beside the outputs on the screen you read before signing, and guided
flows that put the screens in order for what you are trying to do. The wallet
closes itself after ten minutes with nobody touching the screen, which defends
against the device being left and nothing else.

*Proving.* BIP-322 message signing for segwit and taproot, the older
signmessage scheme for legacy addresses, and a screen for checking somebody
else's proof. Verification needs no key and works with the wallet locked:
checking a stranger's signature should not cost the passphrase to your money.

*Building one.* Not a flashable device yet. `make image` still refuses, because
the boot firmware, the kernel and the initramfs are not wired up. What does
exist is the half that can be checked: `make image-system` builds a Debian root
filesystem in a digest-pinned container and produces a system partition with a
dm-verity root hash, and `make verify-image` then judges it against the profiles,
satisfying seven assertions including the one that catches a verity salt
regenerated per build. Twelve of the fifteen verifiers are written, and CI builds
the artifact and runs them on every commit. `make fixture-image` runs the image
verifiers against a synthetic card, and runs one that fails on purpose.

**Not working yet, and needed before this is safe for funds:** the dm-verity
boot attestation of tier 1. The seed is encrypted
at rest under a passphrase, and that passphrase is the only thing protecting a
stolen card: there is no secure element, and the retry counter does not survive
someone copying the card.

Nothing later is pulled forward. That ordering, and the irreversible work
staying last, is what keeps a large feature list from eroding the small part
that holds keys.

---

## Documentation

Start with whichever question you have:

| Document | Answers |
| --- | --- |
| [Threat model](docs/THREAT-MODEL.md) | What is this safe against, and what is it not? |
| [Installing it](docs/INSTALL.md) | How do I get this onto a device? |
| [Checking and building](docs/VERIFICATION.md) | How do I check the device is honest, and build one? |
| [Using it](docs/USING.md) | What are the screens, and what does each one refuse? |
| [Entropy](docs/ENTROPY.md) | How do dice become a seed, and how do I check it? |

All of them are rendered at [nullroute.diy](https://nullroute.diy) directly
from this repository, so the published page and the file that ships with the
code are the same bytes.

This table used to list four of them, and two documents were reachable only by
guessing the URL. `make docs-reachable` fails the build on that now.

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
