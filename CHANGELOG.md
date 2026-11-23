# Changelog

Milestones, newest first. Each line names something you can check in the
repository at that date: a test, a vector file, a command, or a document.
Nothing has been released yet, so there are no version numbers here; the first
tagged release will start them.

The full history is `git log`. This file is the part of it worth reading
first, and the website's status page renders it.

The first sentence of each entry says what is true now, because the website
shows it alone: an entry that opens with the bug reads there as a bug still
open. An entry that names nullroute.diy is about the website and stays off its
status and home pages.

## November 2026

- **2026-11-23** `make conformance-krux` runs the signer profile's 158 cases
  against Krux's own source (develop at `9180bbc5`, with the embit commit its
  submodule pins): 82 pass, 44 are listed findings with the Krux lines that
  decide them, and 32 test what Krux does not have or what needs its C
  modules. A PSBT with any OP_RETURN output crashes Krux's review, and an
  input whose derivation record names the wallet's key is signed in a script
  that does not use it. This project wrote the adapter and has not contacted
  Krux.
- **2026-11-23** SP-ENT-8's count of the rolls the device chose is checked by
  a test (INV-UI-76, "1 of 3 rolls came from the device"), and the profile's
  row and the kit's coverage table say so. Both had called it a manual check.
- **2026-11-23** `make conformance` fails when the kit's coverage table or a
  requirement's Check line in the profile leaves out a requirement some vector
  case checks. Both had drifted: the table still filed SP-REV-1 and SP-REV-22
  as checked only by nullroute's own tests and SP-REV-5 as manual, left SP-TX-7
  out, and five Check lines (SP-ENT-7, SP-REV-3, SP-REV-14, SP-REV-23,
  SP-REV-25) did not name a vector that checks them.
- **2026-11-23** Every output on the review screen is shown by its full
  address or, where it has none, by its whole script, and any signer can now be
  checked for that (SP-REV-5). Until today nullroute showed an output with no
  address as the words "no address (raw script)" without the script, and
  showed a witness version no soft fork has defined yet, which BIP-350 gives a
  bech32m address, as having none; the profile's own table said it met the
  requirement. `review-outputs.json` found both, failing nullroute on 6 of 10
  cases, and nullroute passes all 158 cases now. The review takes each address
  from the function the daemon already uses to recognise its own inputs, rather
  than a second copy that could disagree with it. SeedSigner's current `dev`
  shows every payment address in full, shows an OP_RETURN as its payload with
  no amount (so 0.05 BTC on one is shown nowhere), and ends on System Error for
  a bare public key or a future witness version: 75 pass, 54 findings.
- **2026-11-23** The kit now runs against SeedSigner's current `dev` branch,
  commit `5f321768` of 13 November 2026: 68 cases pass, 51 are listed
  findings, and 29 test things SeedSigner does not have. Four findings from
  the previous pin, `088b144e`, no longer hold, because SeedSigner's
  maintainers have since changed its parser: a derivation record that names
  the seed's key on an input whose script does not use that key is refused
  (SeedSigner #1060), outputs that exceed the inputs are refused (#1041), and
  a previous transaction is checked against the txid the input spends and
  against its witness UTXO (#995). This project has not contacted SeedSigner
  about any finding. A segwit v0 amount from the witness UTXO alone is still
  signed, now with SeedSigner's reasons written beside the code, and inputs of
  mixed script types are still refused. The bridge follows the new review
  flow line by line, including its dedicated refusal screens and its one
  warning view.
- **2026-11-23** The receive and quorum address screens show an address only
  under the index it was derived for, and a check's verdict only beside the
  address it checked. Answers that arrived out of order used to win by landing
  last: paging quickly could leave index 0's address under index 1, or page 0
  under the header for index 10, and a check still running when the user moved
  on put its tick on the next address, which nobody had checked (INV-UI-45,
  INV-UI-61). A failed check now says "Not checked" instead of "Not derived".
  Found by `make ui-race`, which delays every answer by 50ms and failed once
  on a late answer.
- **2026-11-23** Any signer can now be checked for refusing input that is not
  a well-formed PSBT (SP-REV-1), which only nullroute's own tests checked
  before. `review-malformed.json` holds
  BIP-174's 20 invalid PSBTs, copied from the BIP; empty input, a descriptor
  and two truncated PSBTs; and BIP-174's two rules on the unsigned transaction
  (empty scriptSigs, no witness serialization) repeated on a coin the signer
  owns. A parser that skips either rule then reaches its review screen instead
  of refusing for want of an owned input. Bitcoin Core's `decodepsbt` refuses
  all 26, and so does nullroute. SeedSigner reviews both own-coin cases,
  because embit 0.8.0 checks neither rule. embit's master has since fixed the
  scriptSig. It still reads the witness form, and also rejects two of BIP-174's
  valid PSBTs, those with no inputs.
- **2026-11-23** The signer profile has its first portable signature vector,
  and the kit has run against a signer this project did not write.
  `sign-deterministic.json` (SP-SIG-1) gives the exact signature bytes for six
  transactions, computed by Bitcoin Core's own test framework and wallet, with
  every signed transaction accepted by Core's mempool. nullroute matches all
  six, the first comparison of its Schnorr signatures with another
  implementation. `make conformance-seedsigner` runs SeedSigner's own code at a
  pinned commit (dice entry, the review screens, signing and its QR decoder)
  against all 122 cases: 40 pass, 53 are findings, each listed with the lines
  of SeedSigner's code that decide it, and 29 test things SeedSigner does not
  have. Three findings changed the profile or its vectors: SP-SIG-1 now allows
  RFC 6979 ground for a low R exactly as Bitcoin Core grinds, which is what
  SeedSigner and Core's wallet produce; SP-REV-7 lets a signer refuse a false
  change claim outright, as SeedSigner does; and a receiver that drops a
  foreign UR part and keeps scanning now passes, as SP-TX-7's text always
  allowed. Others stand: embit signs taproot without an `aux_rand`, so Core
  cannot reproduce SeedSigner's taproot signatures, and no SeedSigner screen
  shows the locktime or the sighash type.
- **2026-11-21** The maintainer's console moved from a subdomain to
  nullroute.diy/admin. It is still its own server project, holding the
  database password and the mail key; the site's deploy passes `/admin`
  through to it and keeps the site's own headers off its pages, and the
  contact form now posts on the site's own origin, so the CSP allows no
  off-origin request beyond the visit counter. `make admin-live-check` also
  asks that the console's redirects stay on nullroute.diy.
- **2026-11-20** nullroute.diy has a contact page, and the maintainer has a
  console at admin.nullroute.diy (`apps/admin`): sign-in by emailed code for
  listed addresses only, grant applications with their milestones, references,
  checklists and documents, and the contact inbox. The console is a server
  with its own lockfile, outside the root workspaces and so outside
  `MANIFEST.lock`, and lint holds it to the website's rule against importing
  device code. The site's CSP gains exactly one URL, the contact endpoint, and
  the page says what the form keeps. `make admin-live-check` asks the deployed
  console what a stranger would.
- **2026-11-20** The daemon can read a Pi's hardware RNG, so the entropy
  health check can pass on a device (INV-PROV-36). It never could: the kernel
  makes `/dev/hwrng` root only, the daemon is not root, and nothing in the
  image said otherwise, so a machine-only seed would have been refused on
  every device. A udev rule now gives the node to the daemon's group, read
  only. Found by checking the entropy guide against the code, before any card
  had booted on a Pi.
- **2026-11-20** The review shows BIP-68 relative locks (INV-PSBT-21). It read
  each input's sequence only for replaceability, so a spend that could not
  confirm for a month after its coin did was shown as merely replaceable.
- **2026-11-20** A backup's label and writing version are restored from inside
  the ciphertext, like its network (INV-BACKUP-3). The outer copy, which anyone
  holding the file can edit, used to name the restored wallet.
- **2026-11-20** The wallet's state partition is taken only from the disk the
  verified system booted from. `prepare-state` took the first partition named
  "state" on any disk, USB included, and the initramfs would take a USB stick's
  first partition as the boot partition if it appeared before the card's.
- **2026-11-20** `make verify` fails when a tracked file under the manifest
  roots is missing from `MANIFEST.lock`, and when nothing is bound to a test;
  both passed before. `make manifest-check`, which CI described as
  regenerating the manifest, now does, and compares it byte for byte.
- **2026-11-20** Message signing refuses an unsignable message or script type
  before deriving the key, not after (INV-MSG-7). The device frontend's policy
  no longer grants `blob:` to media, which nothing used, and `make device-csp`
  now refuses any source it does not name.
- **2026-11-20** The threat model and the entropy guide are checked against the
  code and narrowed where they overstated: the parsers are not fuzzed, Mode B
  is not hand-reproducible and its machine source is not health-gated, there is
  no "advanced mode", the frontend does receive the mnemonic at setup, and the
  daemon checks a build-time report rather than running `verify` at boot. The
  passphrase screen no longer tells you a guess costs an attacker half a
  second: that was never measured, on any board.
- **2026-11-20** The install guide says how to read a Pi 5's boot over its
  debug UART when the panel stays dark, and lists what to record from a first
  boot. Masking the console getty had left no shell to run the commands it
  suggested.

## October 2026

- **2026-10-28** The verification guide is shorter and 23 statements in it
  that the code contradicts are corrected. Among them: the command for
  recomputing the verity salt used version 0.4.0 and could never match a
  build, and the manual Bitcoin Core recovery imported no change descriptor,
  which Core 31 needs to build a spend. `make test-repro` named a test by an
  old name and had silently stopped running the cross-check against
  libsecp256k1; it now fails unless every named test ran. The boot test now
  needs systemd to report starting the daemon, not merely to mention it.
- **2026-10-28** The signer signs only the inputs the review counted as the
  wallet's (INV-SIG-13). It passed each key to a library call that signs every
  input whose script contains the key, so an input locking this device's key
  under another script, as p2pkh or inside a stranger's multisig, was signed
  while the review showed it as someone else's money; that call also dropped
  every per-input error. Found by checking the threat model against the code.
- **2026-10-28** The descriptor parser refuses what BIPs 381 to 387 call
  invalid: a script where its BIP does not allow it, a key its context does
  not allow, and a multisig past its context's limit (INV-DPARSE-12). Twenty
  two of the BIPs' published invalid descriptors used to parse and be refused
  only by the evaluator, and the device's own descriptor.parse method reported
  them as parsed.
- **2026-10-28** The docs on nullroute.diy can be searched (the header, Ctrl
  K, Cmd K or "/"), from an index this build writes, with nothing sent
  anywhere. Code blocks have a copy button. The install guide opens with the three ways in, and the user
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
- **2026-10-27** A heartbeat answered after the screen that sent it has gone
  now updates nothing (INV-UI-98). It used to update that screen anyway, and
  under test that threw "window is not defined" into whichever file ran next,
  which is why `make ui-race` failed about one run in several under load.
- **2026-10-27** No radio driver of any kind is on the card, and INV-PROV-13's
  globs fail a card that still carries one. The prune behind it had removed
  802.11 and Bluetooth only, while both kernels also shipped a Realtek SDIO
  Wi-Fi driver in staging, 802.15.4, NFC, packet radio, cellular modems, two FM
  transmitters and HackRF.
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
- **2026-10-26** nullroute.diy is rebuilt as a report: every figure on it is read
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
