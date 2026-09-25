# Which Raspberry Pi boards can run nullroute

Written 25 September 2026 to answer the owner's question: the design does not
depend on a Pi 4, so why does the image name one, and why not support nearly
every Pi with the right screen?

Short answer: the design needs capabilities, not a model. The image built today
targets the Pi 4 because it is the one board where the kernel this image pins
describes both the display and the SoC, and nothing has booted anywhere yet.
Most other 64-bit boards are reachable. Two things decide how fast: which
kernel supplies the device tree, and which camera path works on that kernel.
The camera turned out to be a bigger gap than the display, including on the
Pi 4 (see [The camera gap](#the-camera-gap-applies-to-the-pi-4-too)).

Every external claim below was read from a primary source on 25 September 2026.
Sources are linked inline. Where a claim could not be fetched it says
UNVERIFIED.

## What the device actually needs

| Capability | Why | Where it is pinned |
| --- | --- | --- |
| 64-bit Arm (arm64) | The image is Debian trixie arm64 and the kernel is `linux-image-*-arm64`. | `provisioning/build/build-system.sh` |
| Enough RAM for Argon2id, Node and a Chromium kiosk, with no swap | INV-PROV-11 forbids swap, so a board that runs out of memory kills a process rather than paging. | `KDF_DEFAULTS` in `packages/daemon/src/store/envelope.ts`, INV-PROV-11 in `os-signer.yaml` |
| An 800x480 landscape display with touch | Every screen is laid out and measured at exactly 800x480 (`make screen-fit`). | `packages/ui`, `tools/checks/check-screen-fit.mjs` |
| A camera the kernel has a driver for | Transactions reach the device as QR codes. | `packages/ui/src/screens/ScanScreen.tsx` (`getUserMedia`) |
| A device tree for the board in the pinned kernel | The card carries one `.dtb` per claimed board and `check-profiles` makes the list and `boards:` agree. | `boot-files-exact` in `os-signer.yaml` |

## The pinned kernel

The image pins `linux-image-6.12.94+deb13-arm64_6.12.94-1_arm64.deb`
(`KERNEL_SHA` in `build-system.sh`). I downloaded it from
<https://deb.debian.org/debian/pool/main/l/linux-signed-arm64/linux-image-6.12.94+deb13-arm64_6.12.94-1_arm64.deb>,
confirmed its SHA-256 matches the pin
(`72db7fcf...af06`), and read its `/boot/config-*` and
`usr/lib/linux-image-6.12.94+deb13-arm64/broadcom/`. It ships these Pi trees:

```
bcm2711-rpi-4-b.dtb    bcm2711-rpi-400.dtb     bcm2711-rpi-cm4-io.dtb
bcm2712-rpi-5-b.dtb    bcm2837-rpi-3-a-plus.dtb bcm2837-rpi-3-b-plus.dtb
bcm2837-rpi-3-b.dtb    bcm2837-rpi-cm3-io3.dtb  bcm2837-rpi-zero-2-w.dtb
```

The comments in `os-signer.yaml` and `check-profiles.mjs` said trixie ships
"four Raspberry Pi device trees", and are corrected alongside this document. It
ships nine. Four are
BCM2711/BCM2712; the other five are BCM2837, which the comment did not
consider. The conclusion the comment draws (no CM5 tree) is still true.

The current trixie point release is 6.12.107
([filelist](https://packages.debian.org/trixie/arm64/linux-image-6.12.107+deb13-arm64/filelist))
with the same tree list. trixie-backports carries 7.1.8-1~bpo13+1, which moves
the trees into `linux-base-7.1.8+deb13-arm64` under
`/usr/lib/modules/7.1.8+deb13-arm64/dtb/broadcom/`
([filelist](https://packages.debian.org/trixie-backports/arm64/linux-base-7.1.8+deb13-arm64/filelist))
and adds `bcm2837-rpi-2-b` and `bcm2712-d-rpi-5-b`. A move to backports would
change the path `build-system.sh` extracts from, not only the version.

### What the shipped trees describe

Parsed from the `.dtb` files in the packages, not from source:

| Tree family | HDMI | GPU (vc4 / v3d) | DSI | CSI (unicam / CFE) |
| --- | --- | --- | --- | --- |
| bcm2837 (3B, 3B+, 3A+, Zero 2 W, CM3), 6.12 and 7.1 | `hdmi@7e902000` okay | enabled | `dsi@7e209000`, `dsi@7e700000` present, disabled | two unicam nodes present, disabled |
| bcm2711 (4B, 400, CM4-IO), 6.12 and 7.1 | two HDMI nodes okay | enabled | dsi0, dsi1 present, disabled | two unicam nodes present, disabled |
| bcm2712-rpi-5-b in 6.12 | none | none | none | none |
| bcm2712 (5-b, d-5-b) in 7.1.8 | two HDMI nodes enabled | vc6 HVS and `brcm,2712-v3d` enabled | none | RP1 `rp1-cfe` nodes present, disabled |

The 6.12 Pi 5 tree has CPUs, a UART, SD, GPIO and the interrupt controller and
nothing else: no display, no PCIe, no RP1, so no USB either
([v6.12 bcm2712.dtsi](https://github.com/torvalds/linux/blob/v6.12/arch/arm64/boot/dts/broadcom/bcm2712.dtsi)).
Mainline added Pi 5 HDMI in v6.14, PCIe in v6.16, RP1 base in v6.17, RP1 USB
and Ethernet in v6.19, and v3d and CFE nodes in v7.1
([v7.1 bcm2712.dtsi](https://github.com/torvalds/linux/blob/v7.1/arch/arm64/boot/dts/broadcom/bcm2712.dtsi),
[v7.1 rp1-common.dtsi](https://github.com/torvalds/linux/blob/v7.1/arch/arm64/boot/dts/broadcom/rp1-common.dtsi)).
**Mainline has no RP1 DSI driver or node, even at master (v7.3-rc4)**
([master rp1-common.dtsi](https://github.com/torvalds/linux/blob/master/arch/arm64/boot/dts/broadcom/rp1-common.dtsi));
it exists only in Raspberry Pi's tree
([rpi-6.12.y drivers/gpu/drm/rp1](https://github.com/raspberrypi/linux/tree/rpi-6.12.y/drivers/gpu/drm/rp1)).
**Mainline has no CM5, Pi 500 or Pi 500+ device tree at all**
([master Makefile](https://github.com/torvalds/linux/blob/master/arch/arm64/boot/dts/broadcom/Makefile)).

### Kernel config that matters here

Read from `/boot/config-*` in the pinned 6.12.94 package; 6.12.107 and 7.1.8
match on every line except where noted.

| Symbol | 6.12.94 (pinned) | 7.1.8 (backports) | Meaning |
| --- | --- | --- | --- |
| `DRM_VC4` | m | m | HDMI and DSI host on BCM2837/2711 |
| `DRM_PANEL_RASPBERRYPI_TOUCHSCREEN` | m | m | Touch Display 1 panel |
| `REGULATOR_RASPBERRYPI_TOUCHSCREEN_ATTINY` | m | m | Touch Display 1 power |
| `TOUCHSCREEN_EDT_FT5X06` | m | m | Touch Display 1 touch |
| `DRM_PANEL_ILITEK_ILI9881C` | not set | not set | Touch Display 2 cannot work on either |
| `VIDEO_BCM2835_UNICAM` | **not set** | **not set** | No CSI receiver on BCM2837/2711 |
| `VIDEO_IMX219` | **not set** | **not set** | No Camera Module 2 sensor driver |
| `VIDEO_IMX708` | no such symbol | no such symbol | Camera Module 3's sensor is not in mainline ([404 at master](https://github.com/torvalds/linux/blob/master/drivers/media/i2c/imx708.c)) |
| `VIDEO_RP1_CFE` | absent | m | Pi 5 CSI receiver, 7.1 only |
| `USB_VIDEO_CLASS` | m | m | USB (UVC) cameras |

The image prunes only wireless and Bluetooth modules (`build-system.sh`, the
module prune loop), so `uvcvideo` is on the card. Checked against an exported
root filesystem: `modules.dep` lists it with nine dependencies (four videobuf2
parts, `uvc`, `videodev`, `mc`, `usbcore`, `usb-common`) and all ten files are
present. INV-PROV-29 asserts it.

## The camera gap applies to the Pi 4 too

README.md named the Pi Camera Module 3 as how transactions reach the device
when this was written; it names a USB (UVC) webcam now, after the decision
recorded under Recommendation. On the kernel this image pins, no CSI camera can work on any Pi:

- Camera Module 3 uses the IMX708 sensor, whose driver is in Raspberry Pi's
  kernel only ([rpi-6.12.y imx708.c](https://github.com/raspberrypi/linux/blob/rpi-6.12.y/drivers/media/i2c/imx708.c)).
- The BCM2711 CSI receiver driver (`bcm2835-unicam`, mainline since v6.10) is
  not enabled in Debian's config, and the tree's unicam nodes are disabled.
- `VIDEO_BCM2835` (the staging firmware camera over VCHIQ) is built, but it
  depends on the legacy firmware camera stack, which needs the `start4x.elf`
  firmware variant; the card carries `start4.elf`. Whether the firmware stack
  drives an IMX708 at all is UNVERIFIED and I would not plan on it.

What does work on the pinned kernel: a USB (UVC) camera, on every board that
has USB in its tree. This was not known when the parts table was written. It is
recorded here and in the README's parts table, and it is a bring-up item
alongside the panel, not a reason to stop.

## Per-board table

Hardware facts from the Raspberry Pi documentation
([computers](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html),
[keyboard computers](https://www.raspberrypi.com/documentation/computers/keyboard-computers.html),
[compute modules](https://www.raspberrypi.com/documentation/computers/compute-module.html),
[Touch Display](https://www.raspberrypi.com/documentation/accessories/display.html),
[Touch Display 2](https://www.raspberrypi.com/documentation/accessories/touch-display-2.html)),
read from the documentation source at commit `34dfb87` of
<https://github.com/raspberrypi/documentation>.

"Pinned" means the 6.12.94 kernel the image uses. "TD1" is the original 7 inch
800x480 DSI Touch Display.

| Board | SoC | RAM sold | Tree in pinned kernel | HDMI on pinned kernel | TD1 (DSI) | CSI camera on pinned kernel | Radios | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pi 3B | BCM2837 | 1 GB | yes | yes | connector yes; DSI node disabled, needs an overlay like ours | no | wifi, BT | Reachable. RAM is the risk |
| Pi 3B+ | BCM2837B0 | 1 GB | yes | yes | as 3B | no | wifi, BT | Reachable. RAM is the risk |
| Zero 2 W | RP3A0 | 512 MB | yes | yes (mini HDMI) | no DSI connector | no | wifi, BT | Not recommended: 512 MB |
| CM3 / CM3+ | BCM2837 | 1 GB | CM3 IO3 only | via carrier | two DSI on carrier | no | none on any variant | Possible, CM3 is end of life |
| Pi 4B | BCM2711 | 1, 2, 3, 4, 8 GB | yes | yes | yes, overlay written (`nullroute-7inch-dsi.dts`) | no | wifi, BT | **Targeted today** |
| Pi 400 | BCM2711 | 4 GB | yes | yes | no DSI connector | no CSI connector | wifi, BT | HDMI panel plus USB camera only |
| CM4 | BCM2711 | 1, 2, 4, 8 GB | CM4 IO board only | via carrier | two DSI on carrier | no | wireless-free variants sold | Good fit for an air gap, per carrier tree |
| CM4S | BCM2711 | 1, 2, 4, 8 GB | none | n/a | n/a | n/a | none | Not reachable on Debian |
| Pi 5 | BCM2712 + RP1 | 1, 2, 4, 8, 16 GB | skeleton only | no (yes on 7.1.8 backports) | no mainline DSI driver | no (CFE on 7.1.8, but no IMX708) | wifi, BT | HDMI plus USB camera on backports; DSI needs Raspberry Pi's kernel |
| Pi 500 | BCM2712 + RP1 | 8 GB | none | n/a | no DSI connector | no CSI connector | wifi, BT | No tree anywhere in mainline |
| Pi 500+ | BCM2712 + RP1 | 16 GB | none | n/a | no DSI connector | no CSI connector | wifi, BT | No tree anywhere in mainline |
| CM5 | BCM2712 + RP1 | 2, 4, 8, 16 GB | none | n/a | two DSI on carrier | n/a | wireless-free variants sold | No tree anywhere in mainline |
| CM0 | RP3A0 | 512 MB | none in Debian | n/a | DSI on carrier | n/a | wireless-free variants | Not recommended: 512 MB, no tree |

Nothing newer than the Pi 500+ and CM0 appears in the Raspberry Pi news feed up
to 23 September 2026 ([news](https://www.raspberrypi.com/news/)). The 3 GB Pi 4
([news, 1 April 2026](https://www.raspberrypi.com/news/a-new-3gb-raspberry-pi-4-for-83-75-and-more-memory-driven-price-increases/))
and the 1 GB Pi 5
([news](https://www.raspberrypi.com/news/1gb-raspberry-pi-5-now-available-at-45-and-memory-driven-price-rises/))
are recent additions.

Cables: TD1 on a Pi 5 or a CM IO board needs the separately sold 22 to 15 pin
cable ([display docs](https://www.raspberrypi.com/documentation/accessories/display.html)).

**Touch Display 2 is not an 800x480 panel.** The 5 and 7 inch versions are
720x1280, portrait by default, and the 10 inch is 1200x1920
([Touch Display 2 docs](https://www.raspberrypi.com/documentation/accessories/touch-display-2.html)).
Using it would mean rotating to 1280x720 and letterboxing the 800x480 layout,
and its panel driver (`ili9881c`) is off in every Debian kernel above. It is
out of scope until the UI measures a second size, which is a separate decision.

## Firmware and boot, per family

From [config.txt](https://www.raspberrypi.com/documentation/computers/config_txt.html)
and [boot folder contents](https://www.raspberrypi.com/documentation/computers/configuration.html#boot-folder-contents):

- **Pi 3, Zero 2 W, CM3.** `bootcode.bin`, then `start.elf` and `fixup.dat` from
  the card. `arm_64bit=1` is required, because it defaults to 0 on these boards.
  The card today carries neither `bootcode.bin` nor `start.elf`, so a Pi 3
  needs them added from `raspi-firmware` and the `boot-files-exact` list
  extended.
- **Pi 4, 400, CM4.** Second stage in SPI EEPROM, then `start4.elf` and
  `fixup4.dat` from the card. This is what the image ships.
- **Pi 5, 500, CM5.** No `.elf` on the card. "The firmware is self-contained
  within the bootloader EEPROM" and it loads the kernel directly, preferring
  `kernel_2712.img` and falling back to `kernel8.img`. It needs a non-empty
  `config.txt`, and `os_check` refuses a partition with no compatible device
  tree. RP1 firmware ships inside the EEPROM image
  ([rpi-eeprom release notes](https://github.com/raspberrypi/rpi-eeprom/blob/master/firmware-2712/release-notes.md)).
  That the Pi 5 EEPROM boots a Debian mainline kernel with Debian's tree is
  UNVERIFIED: Raspberry Pi's docs make no statement either way.

One consequence worth stating: on a Pi 5 the firmware that loads the kernel is
not on the card at all, so the image cannot pin or hash it. On a Pi 4 the
EEPROM second stage is also off the card but `start4.elf` is on it.

## Memory

Measured on a Mac (Apple silicon, macOS 15, Node 24.3.0), not on a Pi. These
are an order of magnitude, not a Pi figure.

| Measurement | Result |
| --- | --- |
| Node, idle, `@noble/hashes` loaded | 45 MiB peak RSS (`/usr/bin/time -l`) |
| Node running one Argon2id at `KDF_DEFAULTS` (m=65536 KiB, t=3, p=1) | 125 MiB peak RSS, 64 MiB of it the Argon2 array buffer; 1.15 s |
| Chromium 1243 (Playwright build), headless, the built device UI at 800x480 | about 480 MiB physical footprint summed over 10 processes (`footprint`) |

Summed RSS for the same Chromium read 1.2 GiB, which double counts shared
framework pages; the `footprint` figure is the one to use. A Linux kiosk under
cage has a different process mix and was not measured.

Rough peak on a Pi: 480 (browser) + 125 (daemon during unlock) + a Debian base
and the GPU's CMA reservation (not measured, assume 150 to 250) = 750 to 850
MiB, with no swap.

| RAM | Assessment |
| --- | --- |
| 512 MB (Zero 2 W, CM0) | Does not fit. Not recommended, and not worth bring-up effort. |
| 1 GB (Pi 3B, 3B+, CM3, Pi 4 1 GB, CM4 1 GB, Pi 5 1 GB) | Might fit with little margin. An out-of-memory kill during unlock fails loudly rather than unsafely, but a device that cannot unlock is not usable. Needs a measurement on the board. Argon2id on a Cortex-A53 will also be several times slower than on a Pi 4 (not measured). |
| 2 GB and up | Comfortable on these numbers. |

The README currently says 4 GB. Nothing measured says 2 GB is too little, and
nothing measured on a Pi says it is enough. The README keeps 4 GB until a boot
with the kiosk running gives a real figure.

## Display paths, and a recommendation

### Options

**(a) HDMI 800x480 panels.** Every tree the pinned kernel ships for BCM2837 and
BCM2711 enables HDMI with no overlay, and the 7.1.8 backports tree does the
same on a Pi 5. No overlay, no DSI, and the Pi 400 and Pi 500 become reachable
(with a USB camera, since they have no CSI connector). Costs: Raspberry Pi
sells no 800x480 HDMI panel; the common ones are third party (Waveshare's 5 and
7 inch (B) HDMI LCDs; secondary source,
[Waveshare wiki](https://www.waveshare.com/wiki/7inch_HDMI_LCD_(B))), and their
own instructions use legacy `hdmi_cvt` settings that Raspberry Pi says do not
work under KMS ([legacy config](https://www.raspberrypi.com/documentation/computers/legacy_config_txt.html)).
Whether their EDID advertises 800x480 is UNVERIFIED, so the mode would be
forced with `video=HDMI-A-1:800x480@60` on the kernel command line. Touch on
these panels is USB HID, which Debian handles. Supply chain: a third-party
panel is a USB device with its own microcontroller plugged into the signer,
which belongs in the threat model before it is recommended.

**(b) Raspberry Pi's kernel and trees.** Gets everything: Pi 5 DSI, CM5 and
Pi 500 trees, IMX708, Touch Display 2. Costs, measured against CLAUDE.md:

- A second archive and signing key in the trust root
  (`archive.raspberrypi.com`, [trixie Packages](http://archive.raspberrypi.com/debian/dists/trixie/main/binary-arm64/Packages.gz)),
  whose pool publishes sources but no `.buildinfo` files
  ([pool](http://archive.raspberrypi.com/debian/pool/main/l/linux/)). I found
  no statement that these kernels are reproducible; treat them as not shown to
  be. Debian's kernel comes from the same archive as the rest of the image.
- The kernel pin, its SHA-256, the `KERNEL_DIR` path and the overlay are all in
  `provisioning/build/`, which is a `MANIFEST.lock` root
  (`make print-manifest-roots` prints `packages spec provisioning`). The change
  alters the root hash, as it should, and invalidates the module pruning list,
  the initramfs, the verity chain and the QEMU boot test, which were all built
  and checked against Debian's kernel. `nullroute-7inch-dsi.dts` would be
  replaced by Raspberry Pi's `vc4-kms-dsi-7inch` overlay, which is written
  against their downstream labels.
- A fork of the kernel with a much larger downstream diff to audit.

**(c) A newer Debian kernel (trixie-backports 7.1.8, later forky).** Gets Pi 5
HDMI, v3d and the CFE camera receiver, and nothing else on the list: no Pi 5
DSI, no CM5 or 500 tree, no IMX708, no unicam. Same archive and same build
infrastructure as today, so the supply chain does not widen. Costs: backports
packages are rebuilt from testing by volunteers and do not carry the same
security support as stable (UNVERIFIED as a current policy statement; the
[Debian backports page](https://backports.debian.org/) is the place to check),
and the tree path inside the package changed, so `build-system.sh` changes
shape as well as version. The image's pins, prune list and boot test all get
re-run, which is the normal cost of any kernel bump.

**(d) Mainline overlays.** Mainline carries no Pi display overlays at all; the
only in-tree Raspberry Pi display overlays are for a Renesas board
([arm broadcom Makefile](https://github.com/torvalds/linux/blob/master/arch/arm/boot/dts/broadcom/Makefile)).
This project already writes its own (`nullroute-7inch-dsi.dts`). The same
approach extends to the Pi 3B and 3B+: their trees carry `dsi@7e700000`
disabled and the TD1 panel, regulator and touch drivers are built. It cannot
extend to a Pi 5, because there is no driver for an overlay to bind.

### Recommendation

Stay on Debian's kernel, and widen by capability in this order:

1. **Fix the camera on the Pi 4 first.** DECIDED (2026-09-25): the supported
   camera is a USB (UVC) webcam, and CSI camera modules come later. Getting
   Camera Module 3 working needs either Raspberry Pi's kernel or Debian
   enabling unicam plus an IMX708 driver that is not upstream; neither is
   close. The image now carries what the webcam path needs from the kiosk
   and the browser, each with an assertion: `char-video4linux` in the kiosk's
   device allow list with `videodev` loaded first (INV-PROV-27), a Chromium
   managed policy granting the camera to `http://127.0.0.1:5180` only
   (INV-PROV-28), and `uvcvideo` with its dependencies (INV-PROV-29). Still
   open: the image has no udev (built with `--variant=essential`, and `udev`
   is not in the include list), so nothing loads `uvcvideo` on hotplug and
   `/dev/video0` is created root only. INV-PROV-30 fails until that changes.
   Bring-up should try a webcam alongside the panel; none has streamed yet.
2. **Bring up the Pi 4 as planned**, with the DSI panel, and measure memory
   with the kiosk running. That number decides whether 1 and 2 GB boards are
   claimed.
3. **Add HDMI at 800x480 as a second display path (option a)** on the pinned
   kernel. It covers every BCM2711 and BCM2837 board with no overlay, and lets
   the Pi 400 in with a USB camera. It needs a forced mode on the command line
   and a threat-model note on third-party panels.
4. **Extend the DSI overlay to the Pi 3B and 3B+ (option d)** if the 1 GB
   measurement from step 2 leaves room. Needs `bootcode.bin`, `start.elf`,
   `fixup.dat` and `arm_64bit=1` on the card.
5. **Pi 5 on trixie-backports (option c), HDMI only**, once the Pi 4 is
   proven. The Pi 5 with its DSI panel, the CM5 and the Pi 500 wait for
   mainline to grow an RP1 DSI driver and their device trees.

Option (b) is the only way to reach every board now, and it trades the
property this project exists for: a build a stranger can reproduce from one
archive. Revisit it only if Raspberry Pi publishes reproducible kernel builds,
or if the owner decides the camera is worth it and records that decision in
`docs/THREAT-MODEL.md`.

## What has to happen before a board is claimed

The existing rule stands: a board goes into `boards:` in
`provisioning/profiles/os-signer.yaml` when the image boots on it, and not
before. `check-profiles` then requires the board's `.dtb` in
`boot-files-exact`, and the board in the README and VERIFICATION hardware
tables. Per board, that means:

| Board | Before it can be claimed |
| --- | --- |
| Pi 4 | The card boots, the panel lights, touch works, a camera reads a QR code, and the daemon unlocks at `KDF_DEFAULTS` with the kiosk running. |
| Pi 400 | HDMI display path exists; `bcm2711-rpi-400.dtb` added to the card and to `boot-files-exact`; boots with an 800x480 HDMI panel and a USB camera. |
| CM4 on the IO board | `bcm2711-rpi-cm4-io.dtb` on the card; DSI overlay checked against that tree with `fdtoverlay` the way `build-system.sh` checks the Pi 4; a boot. Other carriers need their own tree. |
| Pi 3B, 3B+ | A 1 GB memory measurement that fits; Pi 3 firmware files and `arm_64bit=1`; the overlay checked against `bcm2837-rpi-3-b*.dtb`; a boot. `BCM2837` added to the `SOC` map in `check-profiles.mjs`, which today maps it only to `raspberrypi-3`. |
| Pi 5 | A move to a kernel with a real Pi 5 tree (7.1.8 backports or later); HDMI path; a boot. DSI waits for mainline RP1 DSI. |
| CM5, Pi 500, Pi 500+ | A device tree in the kernel the image pins. None exists in mainline today. |
| Zero 2 W, CM0 | Not planned: 512 MB. |

## Not verified

- Anything booting on any board. Nothing has.
- Memory on a Pi. The figures above are from a Mac.
- Whether Waveshare's 800x480 HDMI panels advertise 800x480 in EDID.
- Whether the Pi 5 EEPROM boots Debian's kernel with Debian's tree.
- Whether the legacy firmware camera stack (`VIDEO_BCM2835` with
  `start4x.elf`) can drive an IMX708.
- Current Debian policy text on security support for backports.
- Whether upstream libcamera supports IMX708 and PiSP (git.libcamera.org
  returned an anti-bot page).
