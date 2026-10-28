# Installing it, and what happens at first boot

This device is pre-release and unaudited. Hardware bring-up is next, starting
on a Pi 5. If you flash a card now, use a spare and expect to be part of that
bring-up.

Pick a way in:

1. [Run it on your computer](#running-it-on-your-computer) with `make dev`.
2. Take the UNSIGNED card CI built: [A card from CI](#a-card-from-ci-for-bring-up).
3. [Build a card yourself](#building-a-card) with Docker.

For a card, check [What you need](#what-you-need), then
[flash it](#flashing-it) and [boot it](#what-the-device-does-at-boot).

## Running it on your computer

Needs Node 24 and git.

```console
$ git clone https://github.com/Xaxis/nullroute
$ cd nullroute
$ npm ci
$ make dev
```

That builds everything, runs the verification system, and opens the frontend at
`127.0.0.1:5180`. Like the device at boot, it refuses to start if the code and
the specifications disagree.

Your wallet goes in `.nullroute-store/` in the checkout. Your computer has a
network, a swap file and a browser, so treat anything you create here as a toy.

## What you need

The parts list is in the README, under
[What you need to build one](../README.md#what-you-need-to-build-one).

- **Board.** One card serves a Pi 4 or a Pi 5. The Pi 4 is the board the
  profile claims. The Pi 5 is in bring-up until a card boots on one with the
  panel lit. Other boards come once the image boots on them.
- **Screen.** The official 7 inch panel. Touch Display 2 is not supported.
- **Camera.** A USB (UVC) webcam. A Pi camera module on the CSI connector does
  not work: the pinned kernel has no driver for it. No camera has streamed on a
  Pi yet.
- **No network.** The device never uses one. Every radio driver is removed from
  the image, not switched off.

## A card from CI, for bring-up

Every push to `main` that touches `provisioning/` builds the card with the same
`make image-system` you would run. CI boots it under QEMU, requires a copy with
one byte changed to be refused, and keeps the card for 14 days as
`nullroute-card-UNSIGNED-<commit>`. No Docker needed.

```console
$ gh run list --workflow card --branch main --status success --limit 1
$ gh run download <run id> --dir card
$ cd card/nullroute-card-UNSIGNED-*
$ sha256sum -c SHA256SUMS
```

You get `nullroute.img`, its dm-verity `root-hash` and the QEMU boot log. Flash
`nullroute.img` as in [Flashing it](#flashing-it).

**UNSIGNED is the point of the name.** Only CI built it. It answers "does this
boot on my board" and nothing about whether it is the card it should be. For
that, build it yourself and check with `make image-repro`.

## Building a card

Needs Docker. It builds for arm64: native on Apple silicon, much slower under
emulation on Intel.

```console
$ make image
```

That writes:

```
out/release/nullroute-0.1.0.img    the card
out/release/system.roothash        the dm-verity root hash
out/release/SHA256SUMS             checksums over both
```

Run both before you flash. The second matters most: a device that cannot tell
those two boots apart has an integrity check for decoration.

```console
$ make image-repro       # builds it twice, in separate containers, and compares
$ make image-boot-test   # boots it, then boots a copy with one byte changed
```

## Flashing it

Find the card first: `diskutil list` on macOS, `lsblk` on Linux. **Get this
wrong and you will overwrite something else.** Read the size and confirm it is
the card.

1. Check the image and write it. On Linux the device is `/dev/sdX` or
   `/dev/mmcblkN` and the flag is `bs=4M`. For the card from CI, the image is
   `nullroute.img` in the folder you downloaded.

```console
$ cd out/release
$ shasum -a 256 -c SHA256SUMS
$ diskutil unmountDisk /dev/diskN          # macOS
$ sudo dd if=nullroute-0.1.0.img of=/dev/rdiskN bs=4m status=progress
```

2. Read back exactly as many bytes as the image holds, and compare the hash
   with the image's line in `SHA256SUMS` before you boot it. A whole number of
   4 MB blocks would not do: the image is not a multiple of 4 MB, so the extra
   bytes would change the hash.

```console
$ sudo head -c "$(stat -f %z nullroute-0.1.0.img)" /dev/rdiskN | shasum -a 256    # macOS
$ sudo head -c "$(stat -c %s nullroute-0.1.0.img)" /dev/sdX | sha256sum            # Linux
```

That is provisioning tier 0. See
[the tiers](#verifying-before-you-flash-and-the-tiers).

## What the device does at boot

You type nothing and configure nothing.

1. The Pi firmware reads `config.txt` and starts your board's kernel,
   `kernel8.img` on a Pi 4 or `kernel8-rpi.img` on a Pi 5.
2. The initramfs mounts the system partition read only through dm-verity,
   against `system.roothash`. On a mismatch it stops and says so.
3. `nullroute-state.service` mounts the fourth partition at `/var/lib`,
   making its filesystem the first time only.
4. `nullrouted.service` checks its verification report and prints the manifest
   root. It refuses to start if the report is missing or not for this build.
5. `nullroute-bridge.service` serves the frontend on `127.0.0.1:5180`.
6. `nullroute-kiosk.service` starts Chromium against it, full screen.

The lock screen should appear, showing the manifest root before you type a
passphrase. Compare it with what `make image` printed.

**Steps 2 to 5 are proven under QEMU, on the Pi 4's kernel.** Step 1 and step 6
are not: QEMU loads the kernel itself, so the firmware and `config.txt` are
never read, and it has no virtual terminal for the screen. The Pi 5's kernel
has not booted anywhere yet.
`getty@tty1` and `getty.target` are masked, so no getty competes for the
console. If the panel stays dark and the rest worked, ask these in order:

```console
$ systemctl status nullroute-kiosk.service
$ journalctl -u nullroute-kiosk.service -b
$ ls -l /dev/dri/            # a card per GPU and display; on a Pi 5 the panel is the last
$ ls -l /dev/tty1            # and a virtual terminal
```

- `208/STDIN`: no `/dev/tty1`.
- `216/GROUP`: an account or group is missing.
- A `cage` error about a seat: logind gave it none, which `PAMName=login` in
  the unit is for.

**If it does not boot at all,** attach a serial console. Every failure path in
the initramfs prints what it was looking for.

## Verifying before you flash, and the tiers

**Tier 0** is building the card yourself, checking its hash, and reading it
back after writing. It costs nothing irreversible and is the only tier that
works on any board.

**Tier 1** is the dm-verity tree on this card. It DETECTS modification of the
system partition and does not prevent it. The root hash sits on the boot
partition, outside the tree, so an attacker who rewrites that partition
supplies their own hash and the device displays it.

Only **tier 2**, a signed boot chain, closes that. It burns one-time fuses and
stays in phase 7.

[docs/VERIFICATION.md](VERIFICATION.md#building-a-device) says what each tier
actually proves. Read it before relying on one. To check without a Pi, see
[Check it yourself](../README.md#check-it-yourself).

## Where this stands today

**Hardware bring-up is the next milestone, starting on a Pi 5.** The image
boots under QEMU and the signing daemon starts on it. The firmware path from
power-on to the kernel, and the kiosk display, get their first run on a Pi.
Boot it on a Pi and you would be among the first.
