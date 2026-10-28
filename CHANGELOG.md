# Changelog

Milestones, newest first. Each line names something you can check in the
repository at that date: a test, a vector file, a command, or a document.
Nothing has been released yet, so there are no version numbers here; the first
tagged release will start them.

The full history is `git log`. This file is the part of it worth reading
first, and the website's status page renders it.

## October 2026

- **2026-10-28** The docs can be searched (the header, Ctrl K, Cmd K or "/"),
  from an index this build writes, with nothing sent anywhere. Code blocks have
  a copy button. The install guide opens with the three ways in, and the user
  manual is a third shorter with every refusal kept. Condensing it surfaced
  seven statements the code contradicts, now corrected. Two were also on the
  device's own screens: five places offered an SD card transport that is not
  built, and one said every device in a quorum holds the same wallet. The read-back
  command in the install and verification guides could never match, because
  it read whole 4 MB blocks of an image that is not a multiple of 4 MB; it now
  reads exactly the image's length.
- **2026-10-28** nullroute.diy is a product page and a documentation set. The
  home page says what the device is, how using it goes, how to check it and
  what to buy, in that order. The docs are ten chapters in five groups with a
  sidebar, one page per section: 84 pages cut from the same repository files,
  keeping the anchors GitHub gives them, so every cross-reference resolves.
  The check, device and profile sub-pages folded into the docs, with redirects.
- **2026-10-27** A heartbeat answered after the screen that sent it had gone
  updated that screen anyway. Under test that threw "window is not defined"
  into whichever file ran next, which is why `make ui-race` failed about one
  run in several under load. The answer now updates nothing (INV-UI-98).
- **2026-10-27** INV-PROV-13 says no wireless kernel module is on the card,
  and the prune behind it removed 802.11 and Bluetooth only. Both kernels also
  shipped a Realtek SDIO Wi-Fi driver in staging, 802.15.4, NFC, packet radio,
  cellular modems, two FM transmitters and HackRF. All are removed now, and the
  assertion's globs fail a card that still carries any of them.
- **2026-10-27** The card carries a Pi 5 bring-up path beside the Pi 4's. A
  Pi 5 boots Raspberry Pi's 6.18.50 kernel, pinned by digest, because only that
  kernel drives the official 7 inch panel there; `config.txt` gives each board
  its own section. The Pi 5 is listed under `bring_up:` and not `boards:`
  until it boots with the panel lit. The initramfs now asks the kernel's own
  dependency data which modules to load. The boot partition is typed FAT and
  marked bootable, as Raspberry Pi's builder marks it (INV-PROV-35); every
  earlier card had it typed "Linux filesystem".
- **2026-10-27** BIP-387 and BIP-389's published descriptor vectors are run,
  so every descriptor document the signer profile claims now has its vectors
  run. BIP-389's found a defect: multipath elements of different lengths, and
  a repeated value such as `<1;1>`, parsed and derived addresses. Both are
  refused (INV-DPARSE-11). SP-DEP-1 has a conformance row for the first time.
- **2026-10-27** BIP-174's published Input Finalizer PSBT and Transaction
  Extractor transaction are reproduced byte for byte by the call the signer
  finalises with (INV-SIG-12). The vector file carried them unchecked, on the
  grounds that the device did not play those roles; it plays both whenever its
  signature completes a quorum.
- **2026-10-27** A BSMS file's first address is checked against this device's
  own derivation, and a file stating another is refused (INV-COORD-7), as
  BIP-129 asks of a signer. It had been shown as an unchecked claim, so two of
  Sparrow's tampered test files were read; they are refused now.
- **2026-10-27** Whether to sign is decided by one function, `signVerdict`, that
  the signer, the review screen's Sign button and the conformance adapter all
  call (INV-SIG-11). The signer had read `signable` alone; it now also holds a
  review that carries a blocking warning, as the screen already did.
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
