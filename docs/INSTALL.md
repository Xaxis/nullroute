# Installing it, and what happens at first boot

## Where this stands today

There is a card you can build and flash. There is no download: you build it,
which is the point, and `make image` prints the checksum you verify it with.

**Nothing here has run on a Raspberry Pi.** The image boots under QEMU and the
signing daemon starts on it, which is a real thing to have proven and is not the
same as your board coming up. The firmware path from power-on to the kernel is
carried on the card and has never been executed, and the kiosk browser has never
had a display to draw on. Flash a spare card. Expect to debug.

| What you can do | State |
| --- | --- |
| Run the whole device on your computer | Works today. `make dev`. |
| Build a card and check it is reproducible | Works today, needs Docker. `make image`, `make image-repro`. |
| Boot that card in an emulator, including a tampered copy | Works today. `make image-boot-test`. |
| Boot it on a Pi | Untested. You would be the first. |

## What you need

The parts list is in the README, under
[What you need to build one](../README.md#what-you-need-to-build-one). One line of it matters here: the
device never uses a network, so you do not need to give it one, and the wifi and
Bluetooth firmware are removed from the image rather than switched off.

## Running it on your computer

```console
$ git clone https://github.com/Xaxis/nullroute
$ cd nullroute
$ npm ci
$ make dev
```

That builds everything, runs the verification system, and opens the frontend at
`127.0.0.1:5180`. It refuses to start if the code and the specifications
disagree, which is the same refusal the device makes at boot.

Your wallet goes in `.nullroute-store/` in the checkout. It is encrypted the
same way it is on the device, and it is not a device: your computer has a
network, a swap file and a browser, so treat anything you create here as a toy.


## Building a card

Needs Docker, and builds for arm64. On Apple silicon this runs natively; on an
Intel machine it runs under emulation and takes considerably longer.

```console
$ make image
```

That builds the root filesystem, makes the erofs system partition, computes the
dm-verity hash tree over it, assembles the four partitions, and writes:

```
out/release/nullroute-0.1.0.img    the card
out/release/system.roothash        the dm-verity root hash
out/release/SHA256SUMS             checksums over both
```

Two other targets are worth running before you flash anything.

```console
$ make image-repro       # builds it twice, in separate containers, and compares
$ make image-boot-test   # boots it, then boots a copy with one byte changed
```

The second one is the one that matters. It opens the dm-verity mapping, mounts
the root through it, reads every block, and starts the daemon; then it corrupts
a single byte inside the system partition and requires that boot to fail. A
device that cannot tell those apart is a device whose integrity check is
decoration.

## Flashing it

Find the card. On macOS `diskutil list`, on Linux `lsblk`. Get this wrong and
you will overwrite something else, so read the size and confirm it is the card.

```console
$ cd out/release
$ shasum -a 256 -c SHA256SUMS
$ diskutil unmountDisk /dev/diskN          # macOS
$ sudo dd if=nullroute-0.1.0.img of=/dev/rdiskN bs=4m status=progress
```

On Linux the device is `/dev/sdX` or `/dev/mmcblkN` and the block size flag is
`bs=4M`. Read the card back and compare it before you boot it:

```console
$ sudo dd if=/dev/rdiskN bs=4m count=<image size in 4MB blocks> | shasum -a 256
```

That is provisioning tier 0: you verified the bytes you wrote. It costs nothing
irreversible and it is the only tier that works on any board.

## What the device does at boot

Nothing is typed and nothing is configured.

1. The Pi firmware reads `config.txt`, loads `kernel8.img` and the device tree
   for your board, and hands over to the kernel with `initramfs.img`.
2. The initramfs loads dm-verity and erofs, reads `system.roothash` off the boot
   partition, opens the system partition through a verity mapping, and mounts it
   read only. If the partition does not match that hash, it stops here and says
   so rather than continuing.
3. `nullroute-state.service` finds the fourth partition, makes a filesystem on
   it the first time only, and mounts it at `/var/lib`.
4. `nullrouted.service` checks its own verification report against the build it
   is running from, prints the manifest root, and listens on a Unix socket. It
   refuses to start if the report is missing or does not describe this build.
5. `nullroute-bridge.service` serves the frontend on `127.0.0.1:5180` and
   forwards to that socket.
6. `nullroute-kiosk.service` starts Chromium against it, full screen.

The lock screen is what you should see, showing the manifest root before you
type a passphrase, so you can compare it against what `make image` printed.

**The screen is the part nothing here has tested.** Everything above is proven
under QEMU; step 6 is not, because the emulator has a serial console and no
virtual terminal, so the compositor never starts there. On your board it should:
`cage` takes `/dev/tty1`, Chromium draws into it through Wayland, and there is
no getty competing for the console because both `getty@tty1` and `getty.target`
are masked in the image.

If the panel stays dark and everything else worked, that is the piece to look
at, and these are the questions in order:

```console
$ systemctl status nullroute-kiosk.service
$ journalctl -u nullroute-kiosk.service -b
$ ls -l /dev/dri/            # a card0 should be here
$ ls -l /dev/tty1            # and a virtual terminal
```

`208/STDIN` means no `/dev/tty1`. `216/GROUP` means an account or group is
missing. A `cage` error about a seat means logind did not give it one, which is
what `PAMName=login` in the unit is for.

**If it does not boot at all,** attach a serial console and read where it
stopped. Every failure path in the initramfs prints a sentence saying what it
was looking for. That is deliberate: a signer that fails silently is worse than
one that fails loudly.

## Verifying before you flash, and the tiers

Building the card yourself, checking its hash, and reading it back after writing
is provisioning tier 0. It works on any board, it costs nothing irreversible,
and it is what the commands above are.

Tier 1 is the dm-verity tree the device opens at boot, and it is on this card.
It DETECTS modification of the system partition and does not prevent it: the
boot partition holds the root hash and cannot be under the tree that hash
describes, so an attacker who rewrites that partition supplies their own number
and the device displays exactly what they chose. Only tier 2, a signed boot
chain, closes that, and it burns one-time fuses and stays in phase 7.

[docs/VERIFICATION.md](VERIFICATION.md#building-a-device) has what each tier
actually proves. Read it before relying on any of them.

For what you can check without a Pi at all, see
[Check it yourself](../README.md#check-it-yourself).
