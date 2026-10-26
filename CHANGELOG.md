# Changelog

Milestones, newest first. Each line names something you can check in the
repository at that date: a test, a vector file, a command, or a document.
Nothing has been released yet, so there are no version numbers here; the first
tagged release will start them.

The full history is `git log`. This file is the part of it worth reading
first, and the website's status page renders it.

## October 2026

- **2026-10-26** The website is rebuilt as a report: every figure on it is read
  from the repository at build time, the signer profile and conformance kit
  have their own pages, and every document states the SHA-256 of its source.
- **2026-10-26** The conformance kit checks the single-use override
  (SP-REV-22, `sign-override.json`). Two deliberately broken signers, one that
  remembers an override and one that ignores blocks, each fail it.
- **2026-10-26** A locktime that every input being final leaves unenforced is
  reported as ignored, never as a delay (INV-PSBT-20). The profile's SP-REV-9
  is amended to match, with Bitcoin Core's own mempool as the vector's evidence.
- **2026-10-26** Version 2 PSBTs are refused at parse, proven against BIP-370's
  own published vectors (INV-PSBT-19).
- **2026-10-26** The image build reads Debian from one snapshot.debian.org
  timestamp, after a superseded package stopped every build.
- **2026-10-26** The conformance vectors are regenerated on Linux with GNU
  coreutils and glibc. Every expected value is unchanged, and glibc's locale
  order adds a third manifest root that must not be produced.

## September 2026

- **2026-09-25** SeedSigner and nullroute read each other's animated UR, checked
  by `make interop-ur` against SeedSigner's own encoder and decoder.
- **2026-09-25** UR is read and written alongside BBQr, so SeedSigner and Jade
  users share a format with the device (SP-TX-7).
- **2026-09-25** BBQr frames use QR alphanumeric mode, and frames from two
  transfers can no longer join into one payload (SP-TX-5, SP-TX-6).
- **2026-09-25** The card carries a USB webcam's driver and the permission to
  use it; no camera has streamed on a Pi yet.
- **2026-09-24** The draft signer profile and its conformance kit are published:
  requirements for any air-gapped signer, and vectors whose expected values come
  from Bitcoin Core, the BIP texts, coreutils and Coinkite's BBQr code.
- **2026-09-24** BIP-322 proofs match the finished BIP, and the published
  BIP-174, BIP-340 and BIP-341 vectors are checked. BIP-143's follow a day
  later.
- **2026-09-20** The "sign anyway, this once" override is no longer remembered
  between signatures.
- **2026-09-08** The lock screen shows the dm-verity root the kernel is
  checking, read from the live device-mapper table.
- **2026-09-04** The card boots under QEMU, dm-verity opens it, a copy with one
  byte changed is refused, and the signing daemon runs on the booted image.

## August 2026

- **2026-08-25** The card image builds, and its root hash reproduces across two
  builds.
- **2026-08-19** BIP-322 message signing is complete: taproot, verification of
  others' proofs, and the legacy scheme. Multisig recovery is drilled against a
  real Bitcoin Core.
- **2026-08-17** Phase 4: BIP-85 child seeds, BIP-329 labels and BIP-322.
- **2026-08-15** Multisig and taproot multisig, encrypted backup and restore,
  and BBQr. The recovery drill runs, so INV-INTEROP-1 stops being a promise.
- **2026-08-13** The spec system, the daemon that refuses to start without a
  passing verification report, and the lock screen. Phase 1 complete.
