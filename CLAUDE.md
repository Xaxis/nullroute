# nullroute

An air-gapped Bitcoin signing device (software, runs on a Raspberry Pi), plus
the website that documents it. Site at **nullroute.diy**, deployed on Vercel.
The GitHub repo is `Xaxis/nullroute` and the local checkout is
`~/Projects/nullroute`.

Website stack conventions follow `~/Projects/oapogee.space`: workspaces
monorepo, Next.js App Router, React 19, Tailwind v4, TypeScript, flat-file
content through unified/remark/rehype, everything driven by `make`. The device
packages do not follow that; they follow the rules below.

## The rule everything else follows from

**The device must refuse to run unless code, specs, and tests all agree.**

The distinguishing feature of this project is not the wallet. Good wallets
exist. It is that every module ships with a machine-checkable specification, and
the verification system is load-bearing rather than documentation. Treat
`spec/` and `packages/verify` as first-class deliverables.

The corollary that governs day-to-day work: **a feature whose spec is
incomplete does not ship.** Not behind a flag, not "temporarily".

## Things that will get someone's money stolen

**Never invent cryptography.** Every primitive comes from `@noble/*` or
`@scure/*`. If you are writing a modular arithmetic loop, a hash, a cipher, or
anything that produces randomness, stop.

**Never add a dependency without asking.** Every package is attack surface and
goes into the reproducible build manifest. `.npmrc` sets `ignore-scripts=true`
and `save-exact=true`, and both are load-bearing. A package that needs an
install script does not go on this device, which has already ruled out
otherwise-reasonable options.

**Never add network capability to `packages/`.** Not for updates, not for fee
estimation, not for fonts. A custom ESLint rule bans `node:http`, `node:https`,
`node:net`, `node:dgram`, `node:dns`, and `fetch` outside the allowlisted
loopback IPC layer. If you find yourself wanting to disable that rule, the
answer is no.

**Never let secrets reach the frontend.** The daemon holds key material. The UI
receives xpubs, addresses, descriptors, and PSBTs, and that is all (INV-KEY-1).
Secrets use the `Secret` wrapper with explicit `dispose()`, never a raw
`Uint8Array` (INV-KEY-2). No lint rule enforces this yet, so review does, and a
seed must not pass through a pooled `Buffer` on its way in or out
(INV-STORE-9).

**Never randomise a signature.** RFC 6979 for ECDSA, BIP-340 with `aux_rand`
fixed to 32 zero bytes for Schnorr. A randomised signature has room in it to
leak the private key a few bits per transaction, and the user cannot tell. This
is the reason the whole determinism apparatus exists.

**Never silently catch an error in a signing path.** Fail loudly. A swallowed
exception is how someone signs a transaction they did not review.

**`Math.random()` is banned** in `packages/core` and `packages/daemon`.

## Layout

```
docs/       Threat model, verification, entropy, air gap, interop, recovery.
            A deliverable, not an afterthought. The website renders these files.
spec/       schema.json, official BIP vectors, real interop fixtures
packages/
  core/     Pure crypto and Bitcoin logic. Zero I/O, zero side effects. Must run
            identically in Node and a browser so a reviewer can load it standalone.
  daemon/   Node backend. ALL file, socket, and hardware access lives here.
  ui/       React frontend, kiosk Chromium on localhost
  verify/   The spec verification CLI
  wallet/   Phase 5. Lower assurance tier. Compile-time removable.
  bridge/   Phase 6. Runs on a NETWORKED machine. Never on the device.
apps/web/   nullroute.diy. Never ships to the device.
tools/      check-prose, gen-sbom, check-reproducible, build-image
```

## Commands

```bash
make check       # everything CI runs
make check-fast  # the same without the slow suites
make verify      # the spec system: coverage, invariants, vectors, integrity
make manifest    # regenerate MANIFEST.lock and print the root hash
make web         # the website, locally
```

## Things that will bite you

**The website is not the device, and the boundary is enforced.** `apps/web` is
a Next.js site that obviously uses the network. It never ships to the Pi,
`MANIFEST.lock` covers `packages/`, `spec/` and `provisioning/` only, and the no-network lint
rule does not apply to it. `apps/web` must never import from `packages/daemon`.
If you want to show device behaviour on the site, generate a static artifact
into `docs/`, do not import the code.

**Excluding the website from the manifest is a security decision.** Folding it
in would mean a change to a marketing page altered the hash a user compares
before entering their PIN.

**`packages/core` may never import `packages/wallet`.** The dependency direction
is enforced by lint and tested in CI (INV-WALLET-1). Removing `packages/wallet`
must leave a fully functional signer with no other code changes. The wallet
layer proposes transactions and cannot sign them (INV-WALLET-2).

**The manifest format is plain `sha256sum` output on purpose.** Sorted under
`LC_ALL=C`, and the root hash is `sha256sum MANIFEST.lock`. This means a third
party checks our tool with coreutils rather than with our tool. Do not "improve"
it into a Merkle tree: no one needs inclusion proofs here, and a Merkle root has
no standard command line equivalent, which would destroy the entire point.
`LC_ALL=C` is not optional, because locale-aware sort makes the root hash depend
on the verifier's language settings.

**100 dice rolls, not 99.** 99 rolls is 255.911 bits, which is short of 256. The
original project brief says 99 is enough and it is wrong by 0.089 bits.
Academically irrelevant, but a project whose whole claim is checkable arithmetic
does not round in its own favour.

**Dice entropy is `SHA-256` of the ASCII roll string with no trailing newline.**
`printf`, not `echo`. This exact encoding is published in `docs/ENTROPY.md` with
a worked example users check by hand, so changing it silently breaks a promise
rather than just a test.

**Do not pull later phases forward.** The feature list runs through phase 7. The
phase ordering and the tier boundary in `docs/THREAT-MODEL.md` are what keep a
large feature set from eroding the assurance of the small part that holds keys.
Finish and verify each phase before opening the next.

**Provisioning has three tiers and they are not interchangeable.** Tier 0
(reproducible signed image, verify before flashing) lands in phase 2 and costs
nothing irreversible. Tier 1 (dm-verity plus boot attestation) lands in phase 3.
Tier 2 (signed boot chain) stays in phase 7 because it burns one-time fuses and
losing the key bricks every device provisioned with it. Never describe a lower
tier using a higher tier's language.

**dm-verity on its own moves the OS-integrity gap rather than closing it.**
Without a signed boot chain, an attacker who rewrites the boot partition
supplies their own `roothash=` and their own initramfs, and the device displays
whatever number they chose. Say "detects modification of the system partition",
never "prevents tampering".

**Overclaiming in the docs is a security bug, and `make prose` checks for it.**
This project's value rests on being honest about its boundaries. A defence that
is partial gets described as partial. `docs/THREAT-MODEL.md` has a long
out-of-scope list and it is supposed to be long.

**Three hardening measures look applied and are not, on this hardware.**
`lockdown=` is a no-op on stock Pi kernels (no `CONFIG_SECURITY_LOCKDOWN_LSM`).
AppArmor is compiled in but inert without `lsm=apparmor`. And
`MemoryDenyWriteExecute=true` crashes Node, because V8's baseline compiler needs
writable-then-executable pages; it works under `node --jitless`, but that
changes code paths and every constant-time assumption in the crypto layer has to
be re-validated first. Do not write any of these into docs as applied.

**Offline compliance scanning of a built image emits false passes.** A scan of
an unbooted rootfs reports `noexec` and `nosuid` mount options as passing while
the same scan reports the partition does not exist, because `/proc/mounts` is
absent. Mount options and kernel parameters are verified on the running device
or not counted. Build-time unit hardening is checked with
`systemd-analyze security --offline=true --root=<rootfs> --json=short`, which
measures declared directives rather than enforced behaviour, and that limit gets
stated wherever the score is.

**Never imply the device protects someone under credible physical threat.** The
duress features buy time against an unsophisticated adversary and nothing more,
because this codebase is public. The word "duress" appears nowhere in the
running system, only in the docs.

## Environment

`.env` at repo root, never committed, documented by `.env.example`. It holds
`NEXT_PUBLIC_SITE_URL` and a Vercel CLI token, and that is all it should hold.
Nothing in `packages/` reads environment variables for anything security
relevant.

## Commits

**Every commit is the user's alone.** Never add a `Co-Authored-By` trailer, a
`Claude-Session` line, a "Generated with" footer, or any other attribution to an
assistant, in a commit message or a pull request description. This holds
regardless of tooling defaults that say otherwise.

## Style

No em dashes anywhere: not in docs, comments, commit messages, or UI copy. Use a
comma, a colon, parentheses, or two sentences. Enforced by `make prose`.

Second person, imperative in procedures. Direct and unhyped. Sentence case
headings. Short paragraphs, numbered steps for procedures, tables for reference.

**Comments explain why, not what.** Security-relevant code names the spec id it
implements, so whoever changes it later knows which spec they are about to
falsify. Commit messages reference spec ids where applicable.

TypeScript strict, ESM, no default exports.
