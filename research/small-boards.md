# Small boards and small panels

Written 24 November 2026, in answer to the owner: make the device work on
smaller Raspberry Pis with much smaller touch screens, "like a Pico 2 or maybe
a bit more than that". This document says which boards and panels that turned
out to mean, what changed to support them, and what is still unproven.
It updates [pi-boards.md](pi-boards.md), which said in September that 512 MB
"does not fit" and that Touch Display 2 was out of scope until the interface
measured a second size. Both are answered below.

## Short answer

- **A Pico 2 cannot run this device**, and no change to it would make it one.
  See [the Pico 2](#the-pico-2).
- **The smallest build is a Zero 2 W behind a Pimoroni HyperPixel 4.0**, a
  4 inch 480x800 panel that sits on the GPIO header. The board and panel
  together are about the size of a deck of cards.
- **A Pi 3B or 3B+ takes the 5 inch Touch Display 2**, as do a Pi 4 and a Pi 5.
- All of these are in bring-up, like the Pi 4 and the Pi 5: the card carries
  what each needs, the build checks it, and none has booted it yet.

What changed to get there:

1. The interface is laid out and measured at four sizes instead of one, and
   refuses to draw below the smallest (INV-UI-110).
2. The kiosk reads which panel is attached from the running device tree and
   starts the browser at that panel's scale.
3. The card boots the Pi 3 family on the Pi 5's kernel, with Raspberry Pi's
   firmware pinned by digest.
4. A board with less than 800 MB gets swap made of compressed memory, and
   INV-PROV-11 now says what swap may be rather than that there is none.

## The Pico 2

The RP2350 on the Pico 2 has 520 KB of SRAM and the board 4 MB of flash, with
two Cortex-M33 or Hazard3 cores at 150 MHz and no MMU
([Pico-series documentation](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html),
[RP2350 datasheet](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf)).
The device as built is Linux, a Node daemon and a Chromium kiosk, checked by a
manifest and a dm-verity hash tree. Chromium alone needs about 400 MiB. None
of that has a version that fits in 520 KB, and the assurance story (a
reproducible Debian image a user hashes with coreutils) does not survive a
port to firmware.

A signer on a microcontroller is a different product with a different
verification story, and it exists elsewhere already. What the RP2350 has that
is interesting here, signed boot in OTP and Arm TrustZone, is the subject of
tier 2 (`docs/THREAT-MODEL.md`), not of this device's current tiers.

"A bit more than that" is the Zero 2 W, and it is the floor.

## Panels

Every panel below is natively portrait. cage 0.2.0, the compositor the kiosk
runs under, has no option to rotate or scale an output, and wlroots does not
apply a panel's orientation by itself. So the interface is laid out for
portrait rather than rotated into landscape, and the scale comes from
Chromium's `--force-device-scale-factor`, which takes precedence over the
compositor's.

| Panel | Interface | Pixels | Diagonal | Scale | CSS viewport | CSS pixel on the glass | 44 px target | Boards |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Touch Display (7 inch) | DSI | 800x480 | 7 in | 1 | 800x480 | 0.19 mm | 8.5 mm | Pi 3, 4, 5 |
| Touch Display 2, 7 inch | DSI | 720x1280 | 7 in | 1.5 | 480x853 | 0.18 mm | 8.0 mm | Pi 3, 4, 5 |
| Touch Display 2, 5 inch | DSI | 720x1280 | 5 in | 2 | 360x640 | 0.17 mm | 7.6 mm | Pi 3, 4, 5 |
| Pimoroni HyperPixel 4.0 | DPI on GPIO | 480x800 | 4 in | 1.33 | 360x601 | 0.15 mm | 6.4 mm | Zero 2 W, Pi 3 |

Millimetres per CSS pixel are the diagonal divided by the diagonal in pixels,
times the scale. The 44 pixel target is the size every control is held to.

The scales are in one table, `provisioning/units/panels.tsv`, keyed by the
compatible string of the panel's node in the device tree. The kiosk wrapper
(`provisioning/units/chromium-for-panel`) reads it on the device, and
`tools/checks/check-screen-fit.mjs` reads the same file to choose the sizes it
measures. Two Touch Display 2 sizes have the same pixels, so pixels alone
cannot choose a scale.

The HyperPixel is at 1.33 and not 1.5. At 1.5 it is 320 pixels wide, and the
passphrase keyboard needs six 44 pixel keys and their gaps in a row, which with
the body's margins is 324 pixels in a 296 pixel body. At 1.33 it is 360.9
pixels wide, a fraction over the 360 the interface refuses to draw below, and
its targets are the smallest in the table at 6.4 mm. That is under the 7 mm a
phone platform asks for, and the reason the HyperPixel is the smallest panel
listed rather than a starting point for smaller ones.

**Not listed, and refused.** 3.5 inch SPI panels at 480x320 (the piscreen and
PiTFT families) are below the 480 pixel height floor at any scale that keeps
targets a finger can hit. The interface draws a refusal on them rather than a
layout nobody measured. The HyperPixel 4.0 Square (720x720) has an overlay in
Raspberry Pi's kernel and would be 541x541 at 1.33; it is not listed because
nothing has measured the interface at that size.

### What the narrow layout changes

At 599 pixels wide and under:

- The header puts the brand or the step counter, the wallet and the menu on
  one row, with the title and subtitle below it.
- Two column layouts stack. A QR code moves to the top of its stack with CSS
  `order`, so a camera finds it without scrolling and a screen reader still
  meets what it encodes first.
- Action bars wrap rather than overflow. The primary action is last in every
  bar, so it is the one that takes the second row.
- The passphrase keyboard is six keys across. The readout of what has been
  typed shares a row with Show and Enter, and the control keys have fixed
  cells, so no key moves under a finger that has just switched layers.
- The word keyboard is seven keys across, four rows. Seven 44 pixel keys
  and their gaps are 344 pixels, which the keyboard takes from the body's
  side margins. The readout above it is a fixed height and scrolls to the
  newest word, because a third word wrapping onto a new line moved every
  key down under a finger.
- Receive puts the code beside the address rather than above it, with the
  address at 15 pixels so three groups of four fit per line. With quorum
  tabs above it, the warning keeps its heading ("Read it from this screen")
  and drops the sentence explaining why: a quorum's 62 character address,
  the tabs, the code and the whole warning do not fit a 4 inch panel.
- A checkbox in an action bar takes the full width above the buttons it
  gates, and banner headings wrap.
- A split whose columns scroll on their own becomes one scroller when it
  stacks, so the attestation and quorum address screens scroll as one
  column.
- The readout of typed text stays one line and shows the end of a long
  value, with an ellipsis where the start was cut. The verify screen shows
  the whole of each value once it has checked them.
- A row of fields above a keyboard stays a row, because it is also the
  selector for which field the keys fill. Their labels are written to fit
  one line of a third of the panel ("Current", "New", "New again"), and a
  note beside a label (the guessing cost on the unlock gate) holds one line
  and ends in an ellipsis rather than wrapping on the first keystroke.
- On a screen with a keyboard, padding and gaps are 8 pixels rather than 12.
  The network strip is the chip itself, flat, at 25 pixels rather than 35.
- The warnings above the confirm-by-typing keyboards (forgetting a quorum,
  erasing a wallet) are two lines at 360 pixels.

What a 4 inch panel costs, in numbers: a text keyboard is six rows of 44
pixel keys and 6 pixel gaps, 294 pixels, in a body of about 380 with the
network strip on screen. Everything above the keys on any screen that types
has about 80 pixels.

Three rules were added to `check-screen-fit` by this work, each after a
defect that every existing rule passed:

| Rule | Fails when | Found |
| --- | --- | --- |
| `text-cut-off` | a run of text passes the panel's edge, or the side of a box that clips it, with no ellipsis; or a line is cut above or below by a box that hides its overflow, ellipsis or not | a banner heading under the bezel; at 800x480, the export tab's QR part counter clipped to "2 /"; the passphrase's guessing cost squeezed to zero pixels tall |
| `text-over-text` | two runs of text cross with nothing opaque between them | the attestation checks drawn over the manifest card, the quorum note over the address table |
| `fill-squeezed` | a body holding a scrolling region is itself too tall, so the region has no room | at 800x480, a quorum wallet's export QR at zero pixels, and a failed proof check's values in a 26 pixel sliver |

Each was proven by putting the defect back and watching it fail: the
stacking fix switched off for the second, the export tab's old layout for
the third, and the note's `flex-shrink: 0` removed for the vertical half of
the first.

The harness itself had been scrolling every box whose content overflowed,
including boxes that hide their overflow. Script can scroll those and a
finger cannot, so the harness reached content no person could and reported
it fitting. That is how the export tab and the proof check passed; it now
scrolls only what a person can.

The keyboard rules had a hole of this work's own making. They measured the
box of the keys' container, and the narrow passphrase layout dissolves that
container (`display: contents`) so its keys can share a grid with the
readout. An element that generates no box has an empty rect, so every
passphrase keyboard below 600 pixels reported its keys ending at 0 and
passed, while the message check had two rows under the action bar. The rules
now measure the keys. The message check's field hints moved into the
readout as its placeholder, and its tabs share one row.

## Boards

| Board | SoC | RAM | Tree on the card | Firmware on the card | Panels | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Zero 2 W | RP3A0 (BCM2710A1) | 512 MB | `bcm2710-rpi-zero-2-w.dtb` | `bootcode.bin`, `start_cd.elf`, `fixup_cd.dat` | HyperPixel 4.0, named in `[pi02]` | bring-up |
| Pi 3B | BCM2837 | 1 GB | `bcm2710-rpi-3-b.dtb` | `bootcode.bin`, `start.elf`, `fixup.dat` | detected DSI panels | bring-up |
| Pi 3B+ | BCM2837B0 | 1 GB | `bcm2710-rpi-3-b-plus.dtb` | as 3B | detected DSI panels | bring-up |
| Pi 3A+ | BCM2837B0 | 512 MB | none named for it | | | not carried |

The Zero 2 W has no DSI connector, so its panel is the HyperPixel. A Pi 3
detects an official DSI panel (`display_auto_detect=1`) as the Pi 5 does, and
takes the HyperPixel with one `dtoverlay=` line.

The 3A+ is left out. Raspberry Pi's kernel ships a tree for every other board
here under a `bcm2710` name and has only the mainline `bcm2837-rpi-3-a-plus`
for the 3A+. Which tree the firmware asks a 3A+ for has not been confirmed.

### The kernel

These boards boot the same Raspberry Pi kernel as the Pi 5,
`linux-image-6.18.50+rpt-rpi-v8`, pinned by digest in
`provisioning/build/build-system.sh`. Its `rpi-v8` flavour is built for the
BCM2837 as much as for the BCM2712, and the drivers and overlays for the small
panels exist only in Raspberry Pi's tree: `panel-ilitek-ili9806e-spi` and
`goodix_ts` for the HyperPixel, `panel-ilitek-ili9881c` and
`rpi-panel-v2-regulator` for Touch Display 2. INV-PROV-37 checks that they and
their dependencies are in the image.

The build checks that every label each overlay targets exists in every tree it
can be applied to, and that every compatible string in `panels.tsv` is
described by an overlay on the card. The SD card is `mmc0` in all three trees,
so it comes up as `/dev/mmcblk0`, where the initramfs looks.

### The firmware

The Pi 3 family reads its firmware off the card, which the Pi 4 does for
`start4.elf` and the Pi 5 does not at all. It comes from Raspberry Pi's
archive, the same archive and signing key as the kernel:

| | |
| --- | --- |
| Package | `raspi-firmware_1.20260915-1_all.deb` |
| SHA-256 | `56b6f8792fb27bcc22f101a5a0d27af637e0d13e85dfc0fde5ff140abc929b0f` |
| From | `archive.raspberrypi.com/debian/pool/main/r/raspi-firmware/` |
| Checked | The digest is the one in the trixie arm64 `Packages.gz`, whose own digest is in an `InRelease` that `gpgv` verifies under key `CF8A 1AF5 02A2 AA2D 763B AE7E 82B1 2992 7FA3 303E` |

Raspberry Pi's firmware rather than Debian's, which the Pi 4 uses, because the
firmware is what applies the overlays, and these overlays are Raspberry Pi's
from September 2026. Debian's firmware is from April 2024.

On the Zero 2 W, `gpu_mem=16` selects the cut-down firmware. With the KMS
driver the GPU's own memory pool is used for nothing this device does, and on
a 512 MB board the default 64 MB is an eighth of the memory.

## Memory

Measured on x86_64 Linux with Chromium 1248 under Xvfb, the kiosk's flags, and
the screen gallery's PSBT review at 360x640. Proportional set size summed over
the browser's processes from `/proc/PID/smaps_rollup`, 12 seconds after launch.
Not on a Pi, and not arm64.

| Configuration | PSS | Anonymous |
| --- | --- | --- |
| Headed, the kiosk's flags | 463 to 475 MiB | 256 MiB |
| Headed, low-end device mode and one renderer | 448 MiB | |
| Headed, as lean as Chromium's flags go | 395 MiB | 198 MiB |
| Headless | about 406 MiB | |

The daemon is 45 MiB idle and 125 MiB during an Argon2id unlock
([pi-boards.md](pi-boards.md#memory)). A Zero 2 W has about 430 MB once the
firmware has taken its share at the default split.

So the browser needs about 200 MiB that only swap can move, plus about 200 MiB
of file pages the kernel can drop and read back off the card. On a 512 MB board
there is room for both and the daemon only if the cold part of the anonymous
memory has somewhere to go.

### Swap made of memory

`nullroute-zram.service` runs on a board with less than 800 MB and nowhere
else. It makes one zram device of half the memory, compressed with zstd, and
turns it on as swap. A zram device is a block device made of RAM: what is
swapped to it is held compressed in memory and lost at power off, exactly as
the page it came from would have been.

INV-PROV-11 banned swap because swap is how a seed reaches storage without
anyone deciding that it should. That property still holds. The one route from
zram to storage is writeback to a backing device, which the Raspberry Pi kernel
is built with (`CONFIG_ZRAM_WRITEBACK=y`). The helper refuses to turn swap on
over a device that names one, the runtime facts print each zram device's
`backing_dev`, and `no-swap-to-storage` fails anything but `none`.

What it does not do: keep the daemon's pages out of zram. That needs the
memory cgroup, and Raspberry Pi's kernel carries a `cgroup_enable=` switch
because it leaves that controller off by default on at least some boards.
Nothing here has checked a running one, and a `MemorySwapMax=0` on a
controller that is not there would look applied and not be. So the profile
says the daemon's pages can be compressed into RAM, and that a compressed copy
can outlive the `dispose()` that zeroed the original until its slot is reused.

## Not verified

- No Zero 2 W or Pi 3 has booted the card. The build checks what can be checked
  off the hardware: trees, overlays, labels, modules and the file list.
- That `gpu_mem=16` and the cut-down firmware leave the KMS display path
  working on a Zero 2 W.
- That the HyperPixel 4.0's touch coordinates match its portrait output
  without a rotation parameter.
- That a Pi 3 detects Touch Display 2 with this firmware.
- Chromium's memory on arm64, and whether the Zero 2 W unlocks without the OOM
  killer with zram on. An out-of-memory kill during unlock fails loudly.
- Argon2id at the shipped cost on a Cortex-A53. Expect several seconds.
- Whether the memory cgroup is on in this kernel on these boards.
- Which device tree a 3A+'s firmware asks for.
