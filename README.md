# nullroute

An air-gapped Bitcoin signing device you can actually verify.

Runs on a Raspberry Pi. Generates seeds from dice you rolled yourself. Signs
PSBTs across an air gap by QR code or SD card. Ships with a machine-checkable
specification for every module, and refuses to run unless the code, the specs,
and the tests all agree.

> **Pre-1.0 and unaudited. Do not put material funds on this.**
> Every release before 1.0 is experimental. See [Status](#status).

---

## Why this exists

Good wallets already exist. The distinguishing feature here is not the wallet.

It is that **every module ships with a machine-checkable specification, and the
device refuses to boot unless code, specs, and tests all agree.** The lock
screen shows a manifest root hash. You can compare it against the published
release hash, and you can recompute it yourself from the source.

The motivating context is a 2024 disclosure that a widely used hardware wallet
had shipped a random number generator that did not behave as documented. The
industry's answer was to promise a better black box. That is the wrong answer.
You should not have to take anyone's word for where your key came from.

So: roll 100 dice. The device shows you the arithmetic. Check it on any laptop:

```console
$ printf '%s' '1234561...' | sha256sum
e56403e8522ddeae1b44a1e8148b1ba4d3b4c626ccf20980056eedcc7e0c0f35  -
```

If the device shows a different value, it is lying to you, and you now know.
The full procedure with a complete worked example is in
[docs/ENTROPY.md](docs/ENTROPY.md).

---

## What it does

- **Entropy you can reproduce by hand.** Dice-only by default, with an HKDF
  combiner for mixed-source mode that stays safe if any one source is good.
- **Signs without leaking.** RFC 6979 deterministic ECDSA and BIP-340 Schnorr
  with `aux_rand` fixed to zero, so signatures are byte-identical every time and
  a third party can confirm nothing was smuggled out through nonce grinding.
- **Shows you the whole transaction.** Every input and output, change verified
  by re-derivation against a registered descriptor rather than taken on the
  PSBT's word, fees in sats and sat/vB and as a percentage of spend, timelocks
  and RBF state in plain language.
- **Refuses what it cannot verify.** No signing an input that does not match a
  registered descriptor. No sighash flag other than `SIGHASH_ALL` without an
  explicit, per-operation, non-persisting override.
- **No network. At all.** Not for updates, not for fee estimation, not for
  fonts. Enforced by a lint rule and a runtime assertion, not by convention.
- **No lock-in, proved in CI.** Every wallet is recoverable from the BIP-39
  mnemonic plus a standard output descriptor, using Bitcoin Core and no
  nullroute code. There is a test that does exactly this against regtest, and it
  is the most important test in the suite.

---

## What it does not do

Read [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) before trusting this with
anything. The short version:

**There is no secure element.** Keys are encrypted at rest under a key derived
from your PIN with Argon2id, and that is the entire physical defence. An
attacker holding your SD card is limited only by your PIN strength. A Coldcard
or a BitBox02 is genuinely better than nullroute on this specific axis.

**It is designed to be one signer in a multisig quorum, not sole custody.** The
intended deployment is 2-of-3 or 3-of-5 with hardware from other vendors, where
nullroute is the signer you can fully audit yourself. Using it alone for
meaningful funds is a use we have not designed for.

**Duress features buy time, not safety.** This codebase is public, so an
adversary who has read it knows hidden profiles are possible. If you are under
credible physical threat, give them the money.

Also out of scope, on purpose: side channel attacks, sophisticated physical
attacks on the SoC, evil maid attacks absent secure boot, and a compromised OS
image installed before first boot.

No price display, no fiat conversion, no Lightning, no coinjoin, no cloud
anything.

---

## Two assurance tiers

The default build is a **signer** and nothing else. It is small on purpose,
because every parser near a private key is a place where a bug becomes a loss.

An optional **wallet layer** (`packages/wallet`) adds UTXO tracking, coin
control, and transaction construction. It roughly doubles the code on the
device, and most of that code parses data that arrived from a networked machine.

The boundary is enforced, not promised:

- `packages/wallet` imports `packages/core`, never the reverse, checked by lint
- the wallet layer proposes transactions but cannot sign them, signing always
  routes through the same review path as an external PSBT
- removing the wallet layer leaves a working signer with no other code changes,
  and **changes the manifest root hash**, so you can prove from the lock screen
  which one you are running

Pick the minimal signer if you want the smallest attack surface, and keep your
wallet software on a separate machine.

---

## Repository layout

```
docs/            Threat model, verification procedure, entropy, air gap, interop,
                 recovery. The product as much as the code is.
spec/            schema.json, official BIP test vectors, real interop fixtures
packages/
  core/          Pure crypto and Bitcoin logic. Zero I/O. Runs in Node and in a
                 browser so a reviewer can load it standalone and reproduce results.
  daemon/        Node backend, Unix socket IPC, storage, hardware access
  ui/            React frontend, kiosk Chromium on localhost
  verify/        The spec verification CLI
  wallet/        Optional, phase 5, lower assurance tier, compile-time removable
  bridge/        Optional, phase 6. Runs on a NETWORKED machine. Never on the device.
apps/
  web/           nullroute.space. The public website. Never ships to the device.
tools/
  build-image/   Raspberry Pi image builder
MANIFEST.lock    SHA-256 of every source file, plus the root hash
```

`packages/core` is pure and side effect free. All file, socket, and hardware
access lives in `daemon`.

---

## Getting started

Requires Node 24 LTS.

```bash
git clone git@github.com:Xaxis/nullroute.git
cd nullroute
make install     # npm ci, exact versions from the committed lockfile
make check       # everything CI runs: verify, tests, vectors, differential
```

Run `make` with no arguments to list every target.

To verify a build rather than develop on it, follow
[docs/VERIFICATION.md](docs/VERIFICATION.md). It is written for someone who does
not trust us and should not have to.

---

## Verifying a device

The claim this project makes is that you do not have to trust it. Making that
real means:

1. **Reproduce the build.** Identical inputs produce a byte-identical `dist/`.
   Build it yourself and compare hashes against the published release.
2. **Recompute the manifest.** `MANIFEST.lock` holds a SHA-256 for every source
   file and a root hash over all of them. The algorithm is documented and
   reproducible with coreutils, so you are not trusting our tool to check our
   tool.
3. **Check the lock screen.** The device displays the root hash before you
   unlock. If it does not match what you built, do not enter your PIN.
4. **Reproduce a signature.** Given the seed and the PSBT, any third party can
   recompute the exact signature bytes the device produced. Nothing can hide in
   a deterministic signature.
5. **Recover without us.** Take the mnemonic and the descriptor to Bitcoin Core
   and confirm you see the same addresses and can spend. CI does this on every
   commit for every supported wallet type, and so can you.

---

## Status

**Phase 1 complete.** The signer is being built before the wallet, and the
verification system was built before the signer.

Phase 1's definition of done, all green: `verify` passes and emits a root hash,
spec coverage is 100 percent of every package's public API, the official BIP-32
and BIP-39 vectors pass, the dice path is reproducible by hand with `sha256sum`,
the daemon binds only to a Unix socket and refuses to start without a passing
report, the lock screen displays the root hash, network selection carries
correct version bytes with a persistent non-mainnet banner, and two clean builds
produce identical output.

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Spec system, verify CLI, entropy, BIP-39/32, daemon, lock screen, network selection | **Complete** |
| 2 | Single-sig signing, descriptors, PSBT review, address verification. **Provisioning tier 0.** | Not started |
| 3 | Multisig, cosigner registration, multi-wallet, encrypted backup. **Provisioning tier 1.** | Not started |
| 4 | BIP-322 message signing, BIP-85, BIP-329 labels | Not started |
| 5 | Wallet layer, optional and lower assurance | Not started |
| 6 | Bridge companion, runs on a networked machine | Not started |
| 7 | Miniscript, taproot script paths, SeedXOR, silent payments. **Provisioning tier 2.** | Not started |

Nothing later is pulled forward. The phase ordering and the tier boundary are
what keep a large feature set from eroding the assurance of the small part that
holds keys.

### Provisioning moved earlier, on purpose

The original plan treated the operating system as a build script and put secure
boot in phase 7 as a stretch goal. That was wrong. An application verification
system running on an unverifiable operating system is a lock on a door in a
paper wall: the manifest root hash on the lock screen is only as trustworthy as
the code drawing it.

So provisioning is now three tiers, and the first one lands as soon as there is
something worth running on hardware:

| Tier | What you get | Cost | Lands |
| --- | --- | --- | --- |
| 0 | Reproducible image, signed release, verify before and after flashing. Works on any supported board. | None. No irreversible changes. | Phase 2 |
| 1 | Immutable system partition under a dm-verity hash tree, with its root hash displayed at boot beside the application manifest hash. | Slightly more involved build. | Phase 3 |
| 2 | Signed boot chain from silicon: the BootROM verifies a signed image, and the verity root hash is carried inside it. | **Irreversible.** Burns one-time fuses. Losing the key bricks every device provisioned with it. | Phase 7 |

Tier 0 is what "spin up another one quickly, in a way I can check" actually
means, and it needs no fuses burned and no key custody. **Tier 2 stays late
precisely because it cannot be undone.**

Be clear about what tier 1 buys on its own: **dm-verity moves the gap rather
than closing it.** Without a signed boot chain, an attacker who rewrites the
boot partition supplies their own root hash and their own initramfs, and the
device displays whatever number they chose. Only tier 2 closes it. See
[docs/PROVISIONING.md](docs/PROVISIONING.md).

The build system is layered so the hardening profile is a set of assertions
checked against the built artifact rather than a recipe, which is what makes
supporting a second distribution a matter of adding a backend rather than
rewriting the tooling.

---

## Hardware

Target build is under $120:

- Raspberry Pi 4, Pi 5, or Pi Zero 2 W (radios disabled at the package and
  device tree level, not just switched off in software)
- 7 inch 800x480 touchscreen, or any small HDMI display
- Camera module for QR decode, optional if you use SD card transport
- A case

Full bill of materials and the hardening checklist are in
[docs/PROVISIONING.md](docs/PROVISIONING.md).

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. The rules that will surprise you:
no new dependency without sign-off, no feature without a passing spec, no
network capability of any kind, and no em dashes.

Security issues go through [SECURITY.md](SECURITY.md), not the public issue
tracker.

---

## Licence

MIT. See [LICENSE](LICENSE).

MIT is the Bitcoin ecosystem's norm (Bitcoin Core, bitcoinjs-lib, and the entire
noble/scure stack this depends on are all MIT), and its attribution requirement
keeps provenance traceable when security code gets vendored into something else.
