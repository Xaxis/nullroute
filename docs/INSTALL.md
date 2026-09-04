# Installing it, and what happens at first boot

## Where this stands today

There is no image to download. The build system that turns this repository into
a flashable card is half written: the system partition builds and is
reproducible, the boot partition and the installer are not. `make image` says
so and exits rather than pretending otherwise.

So there are two honest things you can do now, and one you cannot.

| | |
| --- | --- |
| **Run the whole device on your computer** | Works today. `make dev`. |
| **Build the system partition and check it is reproducible** | Works today, needs Docker. `make image-system`. |
| **Flash a card and boot a Pi** | Not yet. No published image, and no installer. |

If you want to try the interface, use the first one. It is the same daemon and
the same frontend the device runs, on a loopback socket instead of a panel.

## What you need

The parts list is in the README, under
[What you need](../README.md#what-you-need). One line of it matters here: the
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

## Building the system partition

Needs Docker, and builds for arm64.

```console
$ make image-system     # builds it, prints the dm-verity root hash
$ make image-repro      # builds it twice and checks the two agree
```

The second one is the point. A root hash that changes between two builds of the
same commit is a number nobody can compare against anything, which would make
the hash on the lock screen decorative.

## What the device does at boot

Nothing is typed and nothing is configured. Two services start, in order:

1. **`nullrouted.service`**, the signing daemon. It holds the key material, runs
   as its own user with no network access of any kind, and listens on one Unix
   socket.
2. **`nullroute-kiosk.service`**, the frontend, as Chromium in kiosk mode at
   800x480 with updates, sync and background networking switched off.

The second cannot start before the first, and the lock screen is what you see.
It shows the hash of the application before you type a passphrase, so you can
compare it against the release. The daemon holds the keys and the browser
receives xpubs, addresses, descriptors and PSBTs, and nothing else.

## Verifying before you flash

Once there is an image to flash, the sequence is: check the signature on the
release, compare the hash you compute against the published one, flash, then
read the card back and compare it again. That is provisioning tier 0, it works
on any board, and it costs nothing irreversible.

Two tiers above it are described in
[docs/VERIFICATION.md](VERIFICATION.md#building-a-device), along with what each
one actually proves. Tier 1 detects modification of the system partition and
does not prevent it, and the difference matters: read that page before relying
on either.

For what you can check today, see [How you verify it](../README.md#how-you-verify-it).
