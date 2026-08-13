# Verifying nullroute

This document is written for someone who does not trust this project and should
not have to. It describes how to check, yourself, that a nullroute device is
running the code it claims to be running, and that the code does what its
specifications say.

Nothing here requires you to run a nullroute tool to check a nullroute build.
Every step has an equivalent you can perform with coreutils and a Bitcoin Core
node, because a verification tool that only its own author can run is not
verification.

---

## The five things you can check

| What | How | Catches |
| --- | --- | --- |
| The build matches the source | Reproduce it and compare hashes | Build tampering, a backdoored release binary |
| The device runs that build | Compare the lock screen root hash | A swapped or reflashed device |
| The code matches its specs | `make verify` and read the report | Code that quietly stopped doing what it documents |
| A signature hides nothing | Recompute it from the seed | Key exfiltration through nonce grinding |
| Your funds do not depend on us | Recover in Bitcoin Core | Lock-in, and nullroute disappearing |

The last one is the most important, and it is the one people skip.

---

## 1. The manifest and the root hash

### What the manifest is

`MANIFEST.lock` is a SHA-256 of every tracked source file that ships to the
device, one per line, sorted by path. It is deliberately in the exact output
format of `sha256sum`, so you can check it with `sha256sum` itself rather than
with our tool:

```
f5603a6435f46cecb5040b2afb318027528b4e87b81afade0c260cf7ed7066b2  packages/core/src/entropy/combine.ts
e4c81d6e661b430d874616bb2f2bbf7d5546cfd34097840a4a077991e80ef0dc  packages/core/src/entropy/dice.ts
...
```

**The root hash is the SHA-256 of `MANIFEST.lock` itself.** That is the value
the device shows on its lock screen and the value published with each release.

### Checking it

Verify that every file on disk matches the manifest:

```console
$ sha256sum -c MANIFEST.lock
packages/core/src/entropy/combine.ts: OK
packages/core/src/entropy/dice.ts: OK
...
```

Compute the root hash:

```console
$ sha256sum MANIFEST.lock
70fe6285eb5c67d1d22508a69637167e221406f92d6d17465f9fc7ac7acb39df  MANIFEST.lock
```

Regenerate the manifest from scratch and confirm it matches what is committed:

```console
$ find packages spec -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
70fe6285eb5c67d1d22508a69637167e221406f92d6d17465f9fc7ac7acb39df  -
```

On macOS use `shasum -a 256` in place of `sha256sum`. The values are identical.

If any of those three disagree, stop.

### Why sorted concatenation and not a Merkle tree

A Merkle tree buys you compact inclusion proofs for individual files. Nobody
needs that here: the verifier always has the whole tree, because they have the
whole repository.

What a Merkle tree costs is exactly the property that matters. There is no
standard command line tool that computes a Merkle root over a directory, so a
Merkle design would force you to run our implementation to check our
implementation. A sorted concatenation is reproducible with three coreutils
commands that predate this project by forty years, and that is worth more than
an inclusion proof nobody will use.

`LC_ALL=C` in the sort is not optional. Locale-aware sorting orders paths
differently between machines, which would make the root hash depend on your
system's language settings.

### What the manifest deliberately excludes

The manifest covers `packages/` and `spec/`. It does not cover:

- `apps/web`, the public website, which never ships to the device
- `node_modules`, which is covered separately by the lockfile's integrity hashes
- `.tsbuildinfo` and other incremental build caches, which are not reproducible
  and are not shipped
- `docs/`, which is prose and does not execute

Excluding the website is a security decision, not a convenience. The website is
a networked Next.js application, and folding it into the device's integrity
claim would mean a change to a marketing page altered the hash a user compares
before entering their PIN. The two artifacts are independent and their hashes
are independent.

---

## 2. Reproducing the build

Identical inputs must produce a byte-identical `dist/`. If they do not, the
manifest root hash means nothing, because you could not have checked it.

```bash
git clone git@github.com:Xaxis/nullroute.git
cd nullroute
git checkout v0.1.0            # the release you are verifying
make install                   # npm ci, exact versions from the lockfile
make build
make manifest-check            # regenerates the manifest, diffs against committed
```

Then compare the root hash against the one published with the release and the
one displayed on your device's lock screen. Three values, all equal, or
something is wrong.

CI runs a double build on every commit and fails if the two differ, so a
reproducibility regression is caught at the commit that caused it rather than at
the release.

### What makes it reproducible

- Every dependency pinned exactly, `npm ci` only, lockfile committed
- `ignore-scripts=true`, so no package can run arbitrary code at install time
  and change the tree underneath you
- `SOURCE_DATE_EPOCH` set from the commit timestamp
- File ordering sorted rather than filesystem-dependent
- Build ids pinned rather than randomly generated

---

## 3. The verification report

`make verify` performs six checks and writes `verification-report.json`.

**The daemon refuses to start if that report is missing, stale, or failing**
(INV-BUILD-1). This is the mechanism that makes the specs load-bearing rather
than decorative: a spec that stops matching its code stops the device from
booting.

| Check | What it asserts |
| --- | --- |
| Coverage | Every exported symbol in `packages/core` appears in some spec's `covers` list. An uncovered export is a hard failure. |
| Invariant binding | Every declared invariant names at least one test, that test exists, and it passed. |
| Vectors | All official BIP test vectors in `spec/vectors/` pass. |
| Differential | The cross-implementation suite agrees with `bitcoinjs-lib` on derivation, addresses, and signatures. |
| Integrity | Every tracked source file matches `MANIFEST.lock`, and the root hash recomputes. |
| Report | Spec count, invariant count, test results, dependency tree hash, assurance tier, and root hash are emitted. |

The report records which assurance tier was built (signer only, or signer plus
wallet layer), and the tier is part of what the root hash covers. A signer-only
build and a full build have different root hashes by construction, so you can
prove from the lock screen which one you are holding.

### Reading it yourself

`verification-report.json` is plain JSON. The fields that matter:

- `rootHash`: compare against the lock screen and the published release
- `tier`: `signer` or `signer+wallet`
- `coverage.uncovered`: must be empty
- `invariants[].tests[].status`: every one must be `passed`
- `dependencyTreeHash`: compare against the published value to confirm your
  `node_modules` resolved identically

A report that says everything passed is only as trustworthy as the build that
produced it, which is why step 2 comes first.

---

## 4. Reproducing a signature

This is the check that catches key exfiltration, and it is the one that is
unique to how this device signs.

A signing device that produces randomised signatures can leak your private key
through nothing but valid transactions. Grind the nonce until chosen bits of the
signature encode part of the key, publish, repeat. Every signature verifies.
Nothing on the device looks wrong.

nullroute closes this by being deterministic:

- ECDSA nonces come from RFC 6979
- Schnorr signing uses BIP-340 with `aux_rand` fixed to 32 zero bytes

So given the seed and the PSBT, **the signature bytes are fully determined**.
There is no free space to hide anything in.

To check it, take the seed and the unsigned PSBT to any independent
implementation that does RFC 6979 and BIP-340 the same way, sign, and compare
bytes. If they differ, the device put something in your signature that it did
not have to.

The device's own test suite signs the same PSBT one hundred times and asserts
byte-identical output every time, and the differential suite checks the bytes
against `bitcoinjs-lib`. Both run in CI. Neither is a substitute for checking a
signature you actually care about.

Note the trade being made here. BIP-340 permits a randomised `aux_rand`, which
defends against certain fault injection attacks. Fixing it to zero gives that up
in exchange for verifiability. For a device whose premise is that you can audit
it, that is the right side of the trade, but it is a real trade and this
document is not going to pretend otherwise.

---

## 5. Recovering without nullroute

**This is the most important check in this document.** If it fails, your funds
depend on this project continuing to exist, which is a worse failure than any
bug.

The rule (INV-INTEROP-1) is that every wallet nullroute creates is fully
recoverable from the BIP-39 mnemonic (plus passphrase, if you set one) and a
standard output descriptor, using third-party software, with no nullroute code
in the path.

To confirm it for your own wallet, against a Bitcoin Core node:

1. Export the descriptor from nullroute. It is a canonical BIP-380 descriptor
   with a checksum.
2. In Bitcoin Core, create a fresh wallet and import the descriptor:

   ```console
   $ bitcoin-cli createwallet "recovery-check" true true "" false true
   $ bitcoin-cli -rpcwallet=recovery-check importdescriptors '[{"desc":"<your descriptor>","timestamp":0,"active":true}]'
   ```

3. Confirm Core derives the same addresses nullroute shows you:

   ```console
   $ bitcoin-cli -rpcwallet=recovery-check deriveaddresses "<your descriptor>" "[0,5]"
   ```

4. Confirm the balance matches, and that Core can construct a spend.

Do this on a testnet or signet wallet first, with the same script type as your
real one.

CI runs exactly this drill against a regtest Bitcoin Core, for every supported
wallet type, on every commit: create the wallet, receive funds, export the
descriptor, import into Core, assert identical addresses and identical balance,
and spend. Any mismatch fails the build.

If you ever cannot reproduce this by hand, that is a security report, not a
support question. See [SECURITY.md](../SECURITY.md).

---

## What verification does not give you

Being precise about this, because the whole document is an argument for
trusting arithmetic instead of people, and that argument has limits.

**It does not verify the operating system.** The manifest covers the
application. If the Raspberry Pi OS image you flashed was already backdoored,
the root hash it displays is whatever the backdoor wants it to say. Build the
image yourself from `tools/build-image/`, or check the signature on a published
one. Verification defends the application and cannot bootstrap trust in the
thing that runs it.

**It does not verify the hardware.** We check the software supply chain. We
cannot check that your Pi is a real Pi.

**It does not prove the specs are the right specs.** `make verify` proves that
the code does what the specifications say. Whether the specifications describe a
secure design is a question for human review, and the specs are written in a
readable format specifically so that review is possible.

**It does not prove the dependencies are correct.** We cross-check against an
independent implementation, which catches disagreement. It would not catch both
implementations being wrong in the same way.

**It does not prove the absence of bugs.** It proves the absence of a specific
class of drift: code that no longer matches its documented behaviour, and builds
that no longer match their sources.

---

## Reporting a verification failure

If any check in this document fails on a released build, treat it as a security
issue and report it privately. See [SECURITY.md](../SECURITY.md).

Include the release tag, the root hash you computed, the root hash the device
displayed, and the exact commands you ran.
