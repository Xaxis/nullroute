# Threat model

This document states what nullroute defends against, what it partially defends
against, and what it does not defend against at all. The third list is the
important one. A security document that only describes its successes is
marketing.

Read the [Out of scope](#out-of-scope) section before you put money on this
device.

---

## What nullroute is

A signing-only Bitcoin device. It holds keys, displays transactions, and
produces signatures. It has no network stack reachable from outside loopback,
and it moves data across an air gap by QR code or SD card.

It is designed to be **one signer in a vendor-diverse multisig quorum**, not
sole custody. The intended deployment is 2-of-3 or 3-of-5 where the other keys
live on hardware from other vendors, and nullroute is the signer you can fully
audit yourself.

Using it for sole custody of a meaningful amount is a use we do not recommend
and have not designed for. There is no secure element (see below), so a single
nullroute holding everything is a single physical point of failure.

---

## Assets

Ranked by what their loss costs you.

| Asset | Loss means |
| --- | --- |
| Seed / master private key | Total, irreversible loss of funds |
| BIP-39 passphrase | Total loss of the wallets derived under it |
| Signing authority (the ability to make the device sign) | Loss of funds, bounded by quorum |
| Extended public keys and descriptors | Loss of privacy: full transaction graph and balance history |
| Transaction intent (who you are paying, how much) | Loss of privacy, and targeting information |
| The device's integrity claim (manifest root hash) | Loss of the ability to detect any of the above |
| A backup file that carries a seed | Total loss of the wallets in it, under one passphrase rather than under the mnemonic |
| A BIP-85 child seed | Total loss of that child, and it is derivable by anyone holding the parent mnemonic |

The last row is why the verification system exists. If an attacker can make you
believe you are running verified code when you are not, every other defence in
this document is theatre.

---

## In scope: threats the design must defend against

Each row has a corresponding invariant in the codebase and a test that fails
loudly if the defence regresses. Invariant identifiers are listed in the
[Invariants](#invariants) section and enforced by `npm run verify`.

| Threat | Mitigation | Invariant |
| --- | --- | --- |
| Malicious or compromised RNG | Dice-only entropy path, hand-reproducible derivation, HKDF combiner that survives one bad source | INV-ENT-1..4 |
| Key exfiltration through signature nonces | RFC 6979 deterministic ECDSA, BIP-340 Schnorr with `aux_rand` fixed to 32 zero bytes, third-party reproducibility verifier | INV-SIG-1, INV-SIG-2 |
| Change address substitution in a malicious PSBT | Every change output re-derived from a registered descriptor and compared exactly | INV-PSBT-2 |
| Fee drain | Fee shown in sats, BTC, sat/vB, and as a percentage of spend, with a hard warning threshold and a second confirmation | INV-PSBT-2 |
| Sighash abuse | `SIGHASH_ALL` and `SIGHASH_DEFAULT` enforced, anything else refused unless advanced mode is explicitly enabled for that one operation and never persisted | INV-PSBT-3 |
| Hidden timelock or RBF state | `nLockTime` and `nSequence` surfaced in human terms on the review screen | INV-PSBT-2 |
| Signing for a script we do not own | Refuse any input whose script does not match a registered descriptor | INV-PSBT-1 |
| Hostile input parsing (PSBT, QR, SD, snapshot) | Strict size limits, defensive parsers, fuzzing, fail closed | INV-PSBT-1 |
| Network exfiltration | No network code paths at all, enforced by a lint rule and a runtime listener assertion, not by convention | INV-NET-1, INV-NET-2, INV-NET-3 |
| Key material reaching the frontend | Frontend receives only xpubs, addresses, descriptors, and PSBTs. Asserted against serialized responses. | INV-KEY-1 |
| Data remanence in memory | Typed `Secret` wrapper with explicit `dispose()`, raw `Buffer` for secrets banned by lint, heap snapshot test | INV-KEY-2 |
| Data remanence on disk | No swap, tmpfs for scratch, seed encrypted at rest under Argon2id and AES-256-GCM | INV-KEY-2, INV-STORE-1 |
| A coordinator substituting a cosigner key | Registration re-derives this device's key and refuses a quorum it is not in; fingerprints are displayed, never trusted | INV-MULTI-6, INV-MULTI-7 |
| Offline guessing of a stolen card | Argon2id at 64 MiB, parameters authenticated so they cannot be weakened in the file | INV-STORE-3 |
| Supply chain tampering | Exact version pins, committed lockfile, `ignore-scripts=true`, SBOM, dependency review on every lockfile change | INV-BUILD-1 |
| Build tampering | Reproducible builds, manifest root hash displayed at boot and comparable against the published release | INV-BUILD-1 |
| Casual physical access | Seed encrypted under an Argon2id-derived key, passphrase gate, failed-attempt counter that erases the sealed blob | INV-STORE-1, INV-STORE-4 |
| Operator error | Address verification mode, descriptor checksums, forced scroll-through review, fingerprint display before funds actions | INV-INTEROP-1 |
| Vendor lock-in becoming a loss vector | Every wallet recoverable from the mnemonic and a standard descriptor with third-party software, proved in CI against Bitcoin Core | INV-INTEROP-1 |
| A message signature being replayable as a transaction | BIP-322 signs a transaction pair that cannot exist on chain: `to_spend` references an all-zeros outpoint at index `0xffffffff`, so the signature commits to something no consensus rule will ever accept | INV-MSG-5 |
| A message that displays differently from what is signed | Refused before anything is derived, on the review path and on the signing path, rather than signed with a warning | INV-MSG-1, INV-MSG-7 |
| A label rendering as text it does not contain, beside an amount on the signing screen | Refused rather than repaired, so a file that tried is visible as a skipped line instead of being quietly cleaned up | INV-LABEL-3 |
| A backup file being a second copy of the money that nobody realised was one | Seedless by default; including the seed changes the action and states what it means beforehand and again on the written file | INV-BACKUP-1 |
| A backup's outer envelope lying about what is inside it | Network, seed presence and identity are read from inside the ciphertext; the header is authenticated as AAD, so editing it fails the tag rather than changing what is restored | INV-BACKUP-2, INV-BACKUP-3 |
| A BIP-85 child being treated as independent of its parent | The screen states, beside the words themselves, that anyone holding the parent mnemonic derives every child it has produced, and names rolling dice as the alternative | INV-BIP85-2 |

### On the exfiltration threat specifically

A signing device that produces randomised signatures can leak your private key
a few bits at a time, through nothing but valid, correctly verifying
transactions. Grind the nonce until some chosen bits of the signature encode
part of the key, publish the transaction, and an observer who knows the scheme
reads the key off the blockchain over a few dozen spends. Nothing on the device
looks wrong, and the signatures are valid.

The defence is determinism. Given the same key and the same message, the
signature must be byte-identical every time, and any third party who has the
seed must be able to confirm it. There is then no free space in the signature to
hide anything in.

This is why `aux_rand` is fixed to zero for Schnorr rather than randomised. BIP-340
permits randomised `aux_rand` and it defends against certain fault attacks, but it
also reopens exactly the covert channel above. For an air-gapped signer that a
user is expected to be able to audit, verifiability is worth more than fault
resistance. This is a deliberate trade and it is stated here because it is a
real one, not a free win.

---

## Partially in scope: mitigated, but do not rely on it

### Coercion

**Not built yet.** Indistinguishable profiles and a wipe PIN are planned for
phase 7 and no part of either exists in the code today. What the device has
right now is a passphrase and a failed-attempt counter that erases the sealed
blob, and that counter is not a coercion defence: anyone holding the card can
copy it first and guess against the copy forever.

This section describes the intended design so the limits are on record before
anything is built, not after.

**It will not protect you from someone who is willing to hurt you.** The source
code of this project is public. Anyone who reads it will know that multiple
profiles are possible, that an apparently empty device may be hiding one, and
that a wipe PIN exists. An adversary who has done ten minutes of research will
simply keep applying pressure.

What it actually buys you is time and plausibility against an unsophisticated
adversary, for example a thief who wants a quick win and moves on. That is a
real but narrow benefit.

The device says this in the UI, not just in this document. Nothing in the
running system uses the word "duress", because a screen that says "duress PIN"
tells the adversary what to ask for.

**If you are under credible physical threat, give them the money.**

### Device substitution and evil maid

At unlock, the device shows an anti-phishing verification phrase derived from
the seed and the PIN. A swapped or reflashed device shows different words.

This works only if you actually read the words every time, and only if you
noticed and memorised them in the first place. It is a detection aid with a
human in the loop, which means it fails the way humans fail. There is no secure
boot chain in the current design (it is a phase 7 stretch goal), so a
sufficiently prepared attacker who has had the device unattended can replace the
software.

### Malicious QR or SD payloads

Parsers are fuzzed, size-limited, and fail closed, and removable media is
mounted `noexec,nosuid,nodev`. This is real hardening and it raises the bar
considerably.

It is not a proof. These are hand-written parsers in a memory-safe language
processing attacker-controlled input, and the honest claim is "defensively
written and fuzzed", not "cannot be exploited".

---

## Out of scope

nullroute does **not** defend against any of the following. If your threat model
includes one of them, this is the wrong device.

**No secure element.** This is the most important line in this document. The
seed is encrypted at rest with AES-256-GCM under a key stretched from your
passphrase by Argon2id at 64 MiB and three passes, and that is all. An attacker
holding the SD card is limited only by your passphrase strength and that cost,
which is roughly half a second per guess on this class of hardware. There is no
tamper-resistant chip rate-limiting them, no key that never leaves hardware, and
no self-destruct. A Coldcard or a BitBox02 is genuinely better than nullroute on
this specific axis, and that is exactly why the recommended deployment is a
multisig quorum that includes one of them.

**The retry counter is not a defence against a stolen card.** The device erases
its wallet after ten consecutive failed unlocks. That stops a person who picks
up a running device and starts guessing, and nothing else. The counter has to be
readable before the passphrase is known, so it cannot be authenticated: anyone
holding the card can reset it, or copy the sealed blob first and guess against
the copy indefinitely, with no counter involved at all. Treat the ten attempts
as protection against a passer-by, and the passphrase as protection against
everyone else.

**Erasure is not secure erasure.** The sealed blob is overwritten before it is
unlinked, and on flash storage with wear levelling the old blocks survive that.
The property being relied on is that what was written was encrypted before it
reached the card, not that it was destroyed afterwards.

**Sophisticated physical attack on the SD card or the SoC.** Chip decapping,
glitching, cold boot attacks, and direct flash reads are all out of scope.

**Side channel attacks against the Pi.** Power analysis, electromagnetic
emissions, acoustic, and timing attacks against the hardware are not defended
against. The Pi was not designed for this and neither were we. The one exception
is unlock timing, which is deliberately fixed-cost, and that is a defence
against a remote observer of the UI, not against someone with an oscilloscope
attached to the board.

**A compromised host OS image installed before first boot.** If the image you
flashed was already backdoored, the manifest hash it displays is whatever the
backdoor wants it to say. The application verification system defends the
application, and it cannot bootstrap trust in the thing that runs it.

This is being addressed rather than merely conceded, and
[docs/PROVISIONING.md](PROVISIONING.md) states exactly how far each step gets:

- **Tier 0** (phase 2) makes the image reproducible and signed, so you can check
  it against a published hash and signature before flashing, and read the card
  back afterwards. This closes the "was the download tampered with" question and
  leaves the "was the build itself honest" question to reproducing it yourself.
- **Tier 1** (phase 3) puts the system partition under a dm-verity hash tree and
  shows its root hash at boot. Read carefully: **on its own this moves the gap
  rather than closing it.** Without a signed boot chain, an attacker who
  rewrites the boot partition supplies their own root hash and their own
  initramfs, and the device displays whatever number they chose.
- **Tier 2** (phase 7) is what actually closes it, by chaining the verity root
  hash into a boot image the silicon verifies. It burns one-time fuses, cannot
  be undone, and rests on a closed-source BootROM that nobody outside Raspberry
  Pi can audit. It will never be the default.

Until tier 2, treat the operating system as trusted-by-assumption. Build the
image yourself, or verify the signature on a published one.

**Evil maid attacks, absent secure boot.** See above. Tier 1 makes an
unsophisticated modification visible to a user who reads the boot screen. It
does not defeat an attacker who also rewrites the boot partition.

**A determined adversary with unlimited time, you in custody, and knowledge of
this codebase.** Nothing in this repository helps you here. Duress profiles will
not help you here either, when they exist.

**Malicious hardware in the supply chain.** We check the software supply chain.
We cannot check that your Pi is a real Pi.

**Your own operational security.** Photographing your seed, typing your
passphrase into a phone, storing a backup in cloud storage, or telling someone
how much bitcoin you own are all outside what any device can fix.

---

## The trust boundary between the signer and the wallet layer

nullroute ships in two assurance tiers, and which one you are running is visible
in the manifest root hash on the lock screen.

**Tier 1, the signer** (`packages/core`, `packages/daemon`, `packages/ui`) is
small on purpose. Every parser and every branch that runs near a private key is
a place where a bug becomes a loss. This tier is verified to the standard
described in `docs/VERIFICATION.md`, and it is what a default build contains.

**Tier 2, the wallet layer** (`packages/wallet`) adds UTXO tracking, coin
control, and transaction construction. It roughly doubles the code on the
device, and most of that new code processes attacker-influenceable data: UTXO
snapshots, labels, and transaction history that arrived across the air gap from
a machine that is on the internet.

That is an acceptable trade only because the boundary is enforced rather than
promised:

1. `packages/wallet` may import from `packages/core`. Never the reverse. A lint
   rule enforces the direction and CI tests it. (INV-WALLET-1)
2. The wallet layer proposes transactions. It cannot sign them. Signing is
   reached only through the same review and confirmation path as an externally
   supplied PSBT, with no shortcut for self-constructed transactions.
   (INV-WALLET-2)
3. Removing `packages/wallet` from the build yields a fully functional signer
   with no code changes anywhere else, and changes the manifest root hash so you
   can prove which one you are running.
4. Wallet-tier invariants are about correctness and clarity. Key-safety
   invariants live in core and hold regardless of what the wallet layer does.

If you want the smallest attack surface, run a default signer-only build and
keep your wallet software on a separate machine.

---

## Assumptions we are making

Stated so they can be challenged:

- SHA-256, HMAC-SHA-512, and secp256k1 are not broken.
- Argon2id with the configured parameters makes an offline PIN attack expensive
  enough to matter. This assumption weakens over time as hardware improves, and
  it is worthless if your PIN is short.
- The audited implementations we depend on (`@noble/*`, `@scure/*`) are correct.
  We cross-check derivation, address generation, and signing against
  `bitcoinjs-lib` as an independent implementation, which catches disagreement
  but would not catch both being wrong in the same way.
- The user reads the screen. Every display-based defence in this document
  assumes this, and it is the assumption most likely to be false.
- The Raspberry Pi's radios, once removed at the package level and disabled at
  the device tree level, stay off.

---

## Invariants

The full list lives in the spec files and is checked by `make verify`. The
security-critical ones are below.

Every row here is enforced by a spec and its tests unless it is marked
*Planned*, which means the design is on record and nothing implements it yet. A
planned invariant is a statement about a future build and protects you from
nothing today. `make invariant-claims` checks that this page and the spec files
agree about which is which, so a row cannot quietly become a promise the code
does not keep.

| ID | Statement |
| --- | --- |
| INV-NET-1 | The daemon binds only to a Unix domain socket or `127.0.0.1`. No listener exists on any external interface. |
| INV-NET-2 | No source file imports `http`, `https`, `net`, `dgram`, `dns`, or `fetch` outside an allowlisted loopback IPC layer. Enforced by lint. |
| INV-NET-3 | The frontend CSP is `default-src 'none'` with everything else `'self'`. No CDN, no remote fonts, no telemetry. |
| INV-KEY-1 | Private key material and seed bytes never leave the daemon process. |
| INV-KEY-2 | All buffers holding secrets are zeroized after use, through a typed `Secret` wrapper with explicit `dispose()`. |
| INV-SIG-1 | Every ECDSA signature uses RFC 6979 deterministic nonces. Every Schnorr signature uses BIP-340 with `aux_rand` set to 32 zero bytes. |
| INV-SIG-2 | The same seed and the same PSBT produce byte-identical output, confirmed against an independent implementation. |
| INV-PSBT-1 | The device refuses to sign any input whose script cannot be matched to a registered descriptor. |
| INV-PSBT-2 | Any output not provably derivable from a registered descriptor at a known change path is displayed as an external payment. |
| INV-PSBT-3 | Sighash types other than `SIGHASH_ALL` / `SIGHASH_DEFAULT` are refused unless advanced mode is explicitly enabled, per operation, never persisted. |
| INV-BUILD-1 | `npm run verify` must pass before the app starts. On failure the UI shows the error and refuses to load the wallet. |
| INV-WALLET-1 | `packages/wallet` may import `packages/core`, never the reverse. Removing it leaves a functional signer. |
| INV-WALLET-2 | *Planned, phase 5, not enforced today.* The wallet layer proposes but never signs. `packages/wallet` does not exist yet, so there is nothing to constrain. |
| INV-INTEROP-1 | Every wallet is fully recoverable from the BIP-39 mnemonic plus a standard descriptor, with third-party software and no nullroute code. Drilled in CI against a real Bitcoin Core on regtest for p2wpkh, sh(wpkh) and p2pkh. Taproot is not yet drilled. |
| INV-MULTI-6 | A multisig descriptor in which this device holds no key is refused at registration, rather than producing a wallet that can receive and never spend. |
| INV-MULTI-7 | Quorum membership is decided by key material. A key origin claiming this device's fingerprint does not make a stranger's key ours. |
| INV-STORE-1 | A seed is never written to disk in a form readable without the passphrase. |
| INV-STORE-2 | A wrong passphrase fails authentication and returns nothing. It never produces plaintext. |
| INV-STORE-3 | The key derivation parameters are authenticated, so editing them in the file breaks the open rather than weakening the next guess. |
| INV-STORE-4 | Consecutive failed unlocks are counted, and passing the limit erases the sealed blob before the error is raised. |
| INV-STORE-5 | A store is never left half written and an existing wallet is never silently overwritten. |
| INV-DURESS-1 | *Planned, phase 7, not enforced today.* The encrypted store does not reveal how many profiles exist or which slots are in use. |
| INV-DURESS-2 | *Planned, phase 7, not enforced today.* Unlock latency is independent of which PIN was entered and whether it was correct. |

---

## Reporting a vulnerability

See `SECURITY.md`. Please do not open a public issue for anything that affects
key material or signing.
