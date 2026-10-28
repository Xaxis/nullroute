#!/bin/sh
# Build the system partition, reproducibly, and print its dm-verity root hash.
#
# Runs inside provisioning/build/Dockerfile. See that file for why a pinned
# container counts as the Linux machine the backend README was waiting for.
#
# WHAT THIS PRODUCES
#   $OUT/system.erofs   the read-only system image
#   $OUT/system.verity  its hash tree
#   $OUT/root-hash      the number the device displays and a user compares
#
# WHERE THE PINNED IDENTIFIERS COME FROM. Not from here. The salt, the
# filesystem UUID and the partition GUIDs are derived by
# provisioning/checks/identifiers.mjs, whose own header states the rule: one
# definition, two consumers, the backend to SET them and the verifier to CHECK
# them. This script runs in a container with no Node, so it spends the values
# and never computes one; provisioning/build/identifiers.mjs prints them on the
# host and the Makefile passes them in.
#
# The first draft of this file did derive them in shell, and got the filesystem
# UUID wrong: it invented a domain string of its own and sliced the digest by
# hand without setting the UUID version bits. It produced a value the verifier
# would have rejected, which is the failure mode a second definition always has.
#
# WHAT IT DOES NOT DO. It does not prove a device boots with an immutable root.
# `veritysetup format` computes a hash tree; `veritysetup open` needs a kernel
# with the dm-verity target and Docker Desktop's does not have one. This closes
# the build half of tier 1 and cannot close the boot half. See
# provisioning/README.md.
set -eu

OUT="${1:?usage: build-system.sh <output directory>}"
# THE SUITE THE PROFILE DECLARES, not the one the build host happens to be.
#
# This said bookworm while provisioning/profiles/os-signer.yaml declared
# `distribution: debian-trixie` and the backend recipe next door built from
# `trixie-minbase`. Three places, two answers, and the artifact followed the one
# nobody had written down as a decision.
#
# It is not a cosmetic disagreement. The profile lists raspberrypi-5 among its
# boards and bookworm ships Linux 6.1, which has no Pi 5 support at all; trixie
# ships 6.12, which does. The build was producing a root filesystem for a
# distribution that cannot serve one of the three boards the profile claims.
#
# check-backends now reads this line and the profile together, so the next
# disagreement is a failure rather than a discovery.
SUITE="${NULLROUTE_SUITE:-trixie}"
# The archive at the moment the Dockerfile names, not the archive today, so a
# package Debian supersedes cannot change the card or stop it building. See
# NULLROUTE_SNAPSHOT in the Dockerfile; the apt configuration it writes there
# waives the expired Release dates for every apt call below as well.
MIRROR="${NULLROUTE_MIRROR:-http://snapshot.debian.org/archive/debian/${NULLROUTE_SNAPSHOT:?set by the Dockerfile}}"
VARIANT="${NULLROUTE_VARIANT:-essential}"

: "${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH must be set, or the build is not reproducible}"

: "${NULLROUTE_VERITY_SALT:?run through the Makefile, which sets the pinned identifiers}"
: "${NULLROUTE_SYSTEM_FS_UUID:?run through the Makefile, which sets the pinned identifiers}"

VERITY_SALT="$NULLROUTE_VERITY_SALT"
FS_UUID="$NULLROUTE_SYSTEM_FS_UUID"

# The verity superblock carries a UUID of its own, which veritysetup generates
# randomly per invocation. It is not the root hash, which is computed over the
# data, but the hash tree ships on the card and differs between builds without
# this. Reusing the system partition's GUID keeps it one pinned value rather
# than adding another domain to derive.
VERITY_UUID="${NULLROUTE_SYSTEM_HASH_PART_GUID:?run through the Makefile}"

# BUILT IN THE CONTAINER'S OWN FILESYSTEM, NOT IN THE OUTPUT DIRECTORY.
#
# The output usually sits on a bind mount from the host, and mmdebstrap has to
# chroot into what it is building to run dpkg. On a macOS bind mount that fails
# part way through unpacking, with an error naming sixty packages and not the
# reason. Everything happens under /build and only the artifacts are copied out.
WORK="${NULLROUTE_WORK:-/build}"
ROOTFS="$WORK/rootfs"
rm -rf "$WORK"
mkdir -p "$ROOTFS" "$OUT"

echo "  suite            $SUITE"
echo "  SOURCE_DATE_EPOCH $SOURCE_DATE_EPOCH"

# systemd, because the initramfs pivots into /sbin/init and there was none, and
# chromium, because nullroute-kiosk.service names /usr/bin/chromium; e2fsprogs
# and kmod, because the state partition needs mkfs.ext4 and the ext4 module has
# to be loaded by a modprobe that was not in the image.
#
# cryptsetup-bin so the device can ask its own kernel which dm-verity root
# hash it is running on. The initramfs has veritysetup and the image did not,
# so the attestation unit was reporting "no mapping" about a mapping that was
# open: it is the difference between a number read from the kernel and a number
# read from a file somebody wrote on the boot partition.
#
# chromium-sandbox is a SEPARATE PACKAGE in Debian and holds the setuid helper
# Chromium's own sandbox needs. Without it the browser aborts with "No usable
# sandbox", which is the whole design of nullroute-kiosk.service defeated: that
# unit accepts an exposure of 3.0 rather than 0.5 SPECIFICALLY so Chromium can
# keep its sandbox, and the image was shipping without one. INV-PROV-24 checks
# it now. Both were
# asserted about by the profile and absent from the image: INV-PROV-18 was
# scoring the sandbox of a daemon that could not start.
#
# --no-install-recommends is not optional here. Recommends would pull
# systemd-timesyncd, which INV-PROV-16 forbids by name, and this image is the
# thing that decides what a signer contains.
# fonts-dejavu-core AND fonts-dejavu-mono ARE ASKED FOR RATHER THAN INHERITED.
# They were already here, as a dependency of chromium that nobody chose, and
# they are the only fonts on this device: everything the stylesheet names ahead
# of them fell through to a generic and landed on DejaVu. That makes the typeface
# the panel is laid out in, and every 800x480 measurement taken against it, a
# property of chromium's dependency list. Named here so it is a decision, and so
# a future chromium that stops recommending them fails the build rather than
# silently reflowing every screen on the device.
#
# UDEV, BECAUSE THE ESSENTIAL VARIANT DOES NOT CARRY IT AND NOTHING ELSE PULLED
# IT IN. Without systemd-udevd nothing loads a driver when hardware appears and
# nothing applies a device node's group or logind's seat tags: a plugged-in USB
# camera got no uvcvideo and a /dev/video0 only root could open, and the
# panel's /dev/dri and the touchscreen's input nodes depend on the same rules
# on real hardware. The QEMU boot stops before the kiosk, so nothing had shown
# it. Checked by INV-PROV-30. Same Debian systemd source as `systemd` above.
#
# THE COMMENT GOES ABOVE THE COMMAND AND NOT INSIDE IT. Put between a line
# ending in a backslash and the line it continues onto, it ends the command:
# mmdebstrap ran with no suite and no target and said so, in a job nobody had
# been able to run for three days.
mmdebstrap --variant="$VARIANT" --mode=root --format=directory \
  --include=systemd,systemd-sysv,udev,dbus,chromium,chromium-sandbox,cage,cryptsetup-bin,e2fsprogs,kmod,iproute2,fonts-dejavu-core,fonts-dejavu-mono \
  --aptopt='APT::Install-Recommends "false"' \
  --aptopt='Acquire::Check-Valid-Until "false"' \
  "$SUITE" "$ROOTFS" "$MIRROR" >/dev/null 2>&1

# THE USERS AND GROUPS THE PACKAGES DECLARE, MADE NOW RATHER THAN AT BOOT.
#
# Debian packages ship sysusers.d fragments and systemd-sysusers creates the
# accounts from them on first boot. That cannot work here: the root filesystem
# is read-only erofs under a hash tree, /etc/group is part of it, and nothing at
# runtime can add a line. The image had `video` and not `input` or `render`,
# because those two come from systemd's own fragment and nobody had run it.
#
# The symptom was a long way from the cause. The kiosk unit names
# SupplementaryGroups and systemd refused to start it with 216/GROUP, which is
# a permissions-looking error about an account that simply did not exist.
#
# Run in the chroot rather than with --root, so it is the image's own
# systemd-sysusers reading the image's own fragments.
chroot "$ROOTFS" /usr/bin/systemd-sysusers >/dev/null 2>&1 || true
echo "  accounts         $(wc -l < "$ROOTFS/etc/group" | tr -d ' ') groups after systemd-sysusers"

# The units the profiles assert about.
#
# provisioning/profiles/os-signer.yaml has held assertions about
# nullrouted.service and nullroute-kiosk.service since the profile system was
# written, and neither file existed, so INV-PROV-18 and INV-PROV-19 had nothing
# to measure even on a machine with systemd-analyze. They are real files now and
# they ship in the image.
#
# This does NOT make the image bootable. There is no kernel, no firmware, no
# initramfs and no nullroute binary here: what the units give is something for
# the exposure verifiers to read.
mkdir -p "$ROOTFS/usr/lib/systemd/system"
cp /work/provisioning/units/nullrouted.service "$ROOTFS/usr/lib/systemd/system/"
cp /work/provisioning/units/nullroute-kiosk.service "$ROOTFS/usr/lib/systemd/system/"
cp /work/provisioning/units/nullroute-state.service "$ROOTFS/usr/lib/systemd/system/"
cp /work/provisioning/units/nullroute-bridge.service "$ROOTFS/usr/lib/systemd/system/"
cp /work/provisioning/units/nullroute-attest.service "$ROOTFS/usr/lib/systemd/system/"
cp /work/provisioning/units/nullroute-runtime-facts.service "$ROOTFS/usr/lib/systemd/system/"

# THE CAMERA WITHOUT A PERMISSION PROMPT, AND ONLY FOR THE FRONTEND'S ORIGIN.
# The camera is a USB (UVC) webcam and the frontend reads QR codes through
# getUserMedia, which in kiosk mode raises a prompt nothing on the device can
# reliably answer. A managed policy settles it: VideoCaptureAllowed=false turns
# the prompt off and leaves capture available only to the origins in
# VideoCaptureAllowedUrls, which is the loopback origin the kiosk loads and
# nothing else. Audio is refused outright, since nothing here listens.
#
# /etc/chromium/policies/managed is where Chromium-branded Linux builds read
# managed policy (kPolicyPath in components/policy/core/common/policy_paths.cc).
# Chromium merges every .json file in that directory, so INV-PROV-28 checks
# that this is the only one and that it says exactly these three things.
mkdir -p "$ROOTFS/etc/chromium/policies/managed"
cp /work/provisioning/chromium/nullroute.json "$ROOTFS/etc/chromium/policies/managed/"
chmod 0644 "$ROOTFS/etc/chromium/policies/managed/nullroute.json"

# ENABLED, WHICH IS NOT THE SAME AS INSTALLED. A unit file under
# usr/lib/systemd/system is a file systemd knows how to run and will never run
# on its own; it starts when something wants it. Both of these declared
# WantedBy= and neither was enabled, so the card booted all the way to a
# systemd that started nothing: no signing daemon, no frontend, a device that
# reaches a login prompt it has no accounts for.
#
# The symlink IS the enablement, which is all `systemctl enable` does with a
# WantedBy. Made directly because systemctl in a chroot wants a running
# systemd, and because a symlink is deterministic and a maintainer script is
# not. INV-PROV-23 checks it, so this cannot silently stop happening.
for pair in nullroute-state.service:multi-user nullroute-attest.service:multi-user \
            nullrouted.service:multi-user nullroute-bridge.service:multi-user \
            nullroute-runtime-facts.service:multi-user \
            nullroute-kiosk.service:graphical; do
  unit="${pair%%:*}"
  target="${pair##*:}.target"
  mkdir -p "$ROOTFS/etc/systemd/system/${target}.wants"
  ln -sf "/usr/lib/systemd/system/${unit}" "$ROOTFS/etc/systemd/system/${target}.wants/${unit}"
done
# The kiosk is wanted by graphical.target, so that has to be what boot aims for.
ln -sf /usr/lib/systemd/system/graphical.target "$ROOTFS/etc/systemd/system/default.target"

# NO LOGIN PROMPT ON THE SCREEN THE KIOSK OWNS, and it is a hardening point as
# well as a fix. systemd starts getty@tty1 by default, it takes the virtual
# terminal, and the kiosk unit then cannot open it: systemd refuses the service
# with 208/STDIN, which reads as a stdin configuration problem and is actually
# another process holding the console.
#
# It should not be there regardless. No account on this device has a password
# hash and none has a shell, so the prompt is an invitation that cannot be
# accepted, drawn on the panel a user is meant to read a transaction from.
# Masked rather than disabled, because a mask cannot be undone by something
# else wanting it.
ln -sf /dev/null "$ROOTFS/etc/systemd/system/getty@tty1.service"
ln -sf /dev/null "$ROOTFS/etc/systemd/system/getty.target"

# NOEXEC ON THE SCRATCH FILESYSTEMS, WHICH INV-PROV-12 HAS ALWAYS CLAIMED AND
# THE IMAGE HAS NEVER DONE.
#
# Found by booting the card and reading /proc/self/mountinfo, which is the only
# thing that can answer this: the assertion says these three are noexec, and
# nothing in the image made them so. Debian ships tmp.mount with
# mode=1777,strictatime,nosuid,nodev and no noexec, /var/tmp was just a
# directory on the read-only root, and /run is whatever PID 1 mounted it as.
# Every offline check passed the whole time, because there is no /proc/mounts
# in an unbooted rootfs to disagree with.
#
# An fstab entry beats the static tmp.mount: systemd-fstab-generator writes a
# unit from it, and a generated unit takes precedence over the shipped one.
cat > "$ROOTFS/etc/fstab" <<'FSTAB'
# Scratch space, and the reason it is here rather than left to systemd's
# defaults. INV-PROV-12 in provisioning/profiles/os-signer.yaml asserts that
# these are tmpfs and noexec: they hold decrypted material in the ordinary
# course of operation, they must not survive a power cut, and nothing on this
# device has any business executing out of them.
#
# Sizes are capped so a runaway write cannot exhaust memory on a board that has
# no swap to fall back on, which is INV-PROV-11's other half.
tmpfs /tmp     tmpfs rw,nosuid,nodev,noexec,mode=1777,size=128M 0 0
tmpfs /var/tmp tmpfs rw,nosuid,nodev,noexec,mode=1777,size=64M  0 0
FSTAB

# /run IS NOT IN FSTAB, BECAUSE IT CANNOT BE. PID 1 mounts /run itself before
# it reads any configuration at all, so the only way to change its flags is to
# remount after the fact. This is the smallest unit that does it, ordered
# before anything that matters and before the daemon exists.
#
# Nothing on this device executes from /run: the units run programs out of
# /usr/lib/nullroute/bin and /usr/bin, and what lives under /run is sockets and
# the two attestation files. If that ever stops being true this unit is where
# the boot will fail, loudly, which is the right place for it to.
cat > "$ROOTFS/usr/lib/systemd/system/nullroute-harden-run.service" <<'UNIT'
[Unit]
Description=Remount /run noexec
DefaultDependencies=no
After=systemd-remount-fs.service
Before=sysinit.target nullrouted.service
ConditionPathIsMountPoint=/run

[Service]
Type=oneshot
RemainAfterExit=yes
# nodev and nosuid are already set by PID 1 and are restated so a future
# systemd changing its defaults cannot quietly drop one.
ExecStart=/usr/bin/mount -o remount,nosuid,nodev,noexec /run

[Install]
WantedBy=sysinit.target
UNIT
mkdir -p "$ROOTFS/etc/systemd/system/sysinit.target.wants"
ln -sf /usr/lib/systemd/system/nullroute-harden-run.service \
  "$ROOTFS/etc/systemd/system/sysinit.target.wants/nullroute-harden-run.service"

# THE HOSTNAME, PINNED, AND THIS IS THE ONE THAT MATTERED.
#
# mmdebstrap writes the BUILD MACHINE's hostname into /etc/hostname. Under
# Docker that is a fresh random container id on every `docker run`, so the root
# filesystem contained a different byte string every time, and therefore so did
# the erofs image, and therefore so did the dm-verity root hash. The number the
# lock screen displays, the number docs/VERIFICATION.md tells a stranger to
# compare against a published value, was a function of a Docker container id.
#
# Measured across four separate runs: four different root hashes, and a diff of
# two exported root filesystems found exactly one file of 5,046 differing.
#
# `make image-repro` passed throughout, because it ran both builds inside ONE
# container, which is the single configuration where this defect cannot appear.
# That target now uses two separate runs for exactly this reason.
printf 'nullroute\n' > "$ROOTFS/etc/hostname"

# --- what the firmware needs, extracted rather than installed ----------------
#
# EXTRACT, DO NOT INSTALL, and that is a rule rather than a convenience. The Pi
# needs GPU firmware on the boot partition before it will start a kernel, and
# the package that carries it, Debian's raspi-firmware, ALSO ships six files
# under lib/firmware/brcm/. Those are Broadcom radio firmware, and INV-PROV-13
# forbids them: the profile's position is that the radio is removed rather than
# disabled, so reverting a device tree overlay is not enough to bring it back.
# Installing the package into the root filesystem fails that assertion. Taking
# two files out of the .deb does not.
#
# PINNED BY VERSION AND BY HASH. `apt-get download <name>` fetches whatever the
# archive holds, which made the card a function of the date. The versions below
# are exact and the digests are checked, so a changed upstream is a loud failure
# here rather than a different root hash nobody can explain. They come from the
# snapshot MIRROR names, so a version Debian has since superseded stays
# fetchable; a digest that differs still stops the build.
KERNEL_DEB=linux-image-6.12.94+deb13-arm64_6.12.94-1_arm64.deb
KERNEL_SHA=72db7fcfb443a4b03448bda98f4e7c1a1fa0d6c21fc57f0b119d704442f8ad49
FIRMWARE_DEB=raspi-firmware_1.20240424+ds-6_all.deb
FIRMWARE_SHA=f95a3d3c41df10bac33580be91b595efa1e126ad5e4b7eca75ce26fbbc69af06
KERNEL_VERSION=6.12.94+deb13-arm64
KERNEL_DIR=usr/lib/linux-image-6.12.94+deb13-arm64/broadcom

# THE PI 5 BOOTS RASPBERRY PI'S KERNEL, and this is the one place the card
# trusts an archive other than Debian's. The device is built around the
# official 7 inch panel, and on a Pi 5 that panel hangs off RP1's DSI block,
# which only Raspberry Pi's kernel drives: mainline has no RP1 DSI driver,
# binding or node in any release or in linux-next (research/pi-boards.md).
# The owner runs a Pi 5 with that panel, so the choice was this or no screen.
#
# The rpi-v8 flavour, not rpi-2712. Both carry the RP1 DSI driver and the
# Pi 5 trees, and Raspberry Pi's firmware documents kernel8.img as a kernel
# the Pi 5 boots. rpi-v8 uses 4K pages, as Debian's kernel does on the Pi 4,
# so the Debian userland on this card runs on one page size on both boards
# rather than meeting 16K pages for the first time on hardware.
#
# WHERE THE PIN CAME FROM. archive.raspberrypi.com has no snapshot service, so
# the digest is the whole pin. It was read on 27 October 2026 from the trixie
# arm64 Packages.gz, whose SHA-256 (c845dbaf...281f) is listed in an InRelease
# that verifies under the Raspberry Pi Archive Signing Key,
# CF8A 1AF5 02A2 AA2D 763B AE7E 82B1 2992 7FA3 303E. When Raspberry Pi drops
# this version from its pool the download fails here, loudly, and moving the
# pin is a decision rather than a drift.
RPI_KERNEL_DEB=linux-image-6.18.50+rpt-rpi-v8_6.18.50-1+rpt1_arm64.deb
RPI_KERNEL_SHA=8d44827fea22875e0f801252bdbc0f541c03144e970caafa3115bf485ff3c4bd
RPI_KERNEL_VERSION=6.18.50+rpt-rpi-v8
RPI_POOL=https://archive.raspberrypi.com/debian/pool/main/l/linux

BOOT="$WORK/boot"
mkdir -p "$BOOT" "$WORK/debs"

echo "deb $MIRROR $SUITE main non-free-firmware" > /etc/apt/sources.list
apt-get update >/dev/null 2>&1
( cd "$WORK/debs" && apt-get download \
    "linux-image-6.12.94+deb13-arm64=6.12.94-1" \
    "raspi-firmware=1.20240424+ds-6" >/dev/null 2>&1 )
curl -fsSL -o "$WORK/debs/$RPI_KERNEL_DEB" "$RPI_POOL/$RPI_KERNEL_DEB"

for pair in "$KERNEL_DEB:$KERNEL_SHA" "$FIRMWARE_DEB:$FIRMWARE_SHA" "$RPI_KERNEL_DEB:$RPI_KERNEL_SHA"; do
  file="${pair%%:*}"
  want="${pair##*:}"
  got=$(sha256sum "$WORK/debs/$file" | cut -d" " -f1)
  if [ "$got" != "$want" ]; then
    echo "  FAIL  $file" >&2
    echo "        expected $want" >&2
    echo "        got      $got" >&2
    echo "        The archive served something other than the pinned package." >&2
    exit 1
  fi
done

dpkg-deb -x "$WORK/debs/$KERNEL_DEB" "$WORK/kernel"
dpkg-deb -x "$WORK/debs/$FIRMWARE_DEB" "$WORK/firmware"
dpkg-deb -x "$WORK/debs/$RPI_KERNEL_DEB" "$WORK/rpi-kernel"
RPI_DTB="$WORK/rpi-kernel/usr/lib/modules/$RPI_KERNEL_VERSION/dtb"

# The kernel, under the name the firmware looks for and config.txt names.
cp "$WORK/kernel/boot/vmlinuz-$KERNEL_VERSION" "$BOOT/kernel8.img"

# ONLY THE BOARDS THE PROFILE CLAIMS OR IS BRINGING UP, and for the Pi 4 the
# tree Debian's own kernel ships. `boards` used to list raspberrypi-cm5 and
# this kernel has no bcm2712-rpi-cm5 device tree among the nine Pi trees it
# carries. A board named in a profile that the artifact cannot start is the
# same class of claim as a hardening rule nobody applies.
cp "$WORK/kernel/$KERNEL_DIR/bcm2711-rpi-4-b.dtb" "$BOOT/"

# Pi 4 loads its GPU firmware from the card. Pi 5 does not: its bootloader lives
# in SPI EEPROM and reads config.txt directly, so these two files are there for
# the 4 and are inert on the 5.
cp "$WORK/firmware/usr/lib/raspi-firmware/start4.elf" "$BOOT/"
cp "$WORK/firmware/usr/lib/raspi-firmware/fixup4.dat" "$BOOT/"

# THE PANEL, COMPILED FROM SOURCE IN THIS REPOSITORY rather than taken as a blob.
# `-@` keeps the symbol table the firmware needs to resolve &dsi1 and &i2c0_1
# against the base tree. dtc warns rather than fails on a bad overlay, so the
# exit status is not enough on its own: the file has to exist afterwards.
mkdir -p "$BOOT/overlays"
dtc -@ -I dts -O dtb -o "$BOOT/overlays/nullroute-7inch-dsi.dtbo" \
  /work/provisioning/build/overlays/nullroute-7inch-dsi.dts
test -s "$BOOT/overlays/nullroute-7inch-dsi.dtbo" || {
  echo "the panel overlay did not compile, and a device with no screen is not a device" >&2
  exit 1
}

# IT COMPILED IS NOT IT APPLIES, and the difference is the whole panel. dtc
# checks this overlay's own syntax and knows nothing about the tree it will be
# merged into. Debian ships mainline device trees and the Raspberry Pi overlays
# are written against Raspberry Pi's, so a label targeted here can simply not
# exist in the base tree: the overlay compiles, reaches the card, satisfies
# INV-PROV-26, and the firmware then declines to apply it and boots to a dark
# panel with nothing logged anywhere to say why.
#
# fdtoverlay resolves &dsi1 and &i2c0_1 against the real bcm2711-rpi-4-b.dtb
# this image ships. Its exit status is necessary and not sufficient, so the
# merged tree is read back: applying cleanly and actually turning the display on
# are different claims, and only the second one is the product.
fdtoverlay -i "$BOOT/bcm2711-rpi-4-b.dtb" -o "$WORK/merged-check.dtb" \
  "$BOOT/overlays/nullroute-7inch-dsi.dtbo" || {
  echo "the panel overlay does not apply to bcm2711-rpi-4-b.dtb" >&2
  exit 1
}

# dsi@7e700000 ships disabled in the mainline tree. If it is still disabled
# after the merge, cage starts, finds a card, and draws onto nothing.
dsi_status=$(fdtget -t s "$WORK/merged-check.dtb" /soc/dsi@7e700000 status 2>/dev/null || true)
test "$dsi_status" = "okay" || {
  echo "overlay applied and dsi@7e700000 is \"$dsi_status\", not \"okay\"" >&2
  exit 1
}

dtc -I dtb -O dts "$WORK/merged-check.dtb" > "$WORK/merged-check.dts" 2>/dev/null
grep -q 'raspberrypi,7inch-touchscreen-panel' "$WORK/merged-check.dts" || {
  echo "overlay applied and the merged tree describes no 7 inch panel" >&2
  exit 1
}
grep -q 'edt,edt-ft5406' "$WORK/merged-check.dts" || {
  echo "overlay applied and the merged tree describes no touch controller" >&2
  exit 1
}
rm -f "$WORK/merged-check.dtb" "$WORK/merged-check.dts"
echo "panel overlay: applies to bcm2711-rpi-4-b.dtb, dsi1 okay, panel and touch present"

# --- the Pi 5 -----------------------------------------------------------------
#
# Raspberry Pi's kernel, under a name of its own so the Pi 4's kernel8.img is
# untouched; config.txt points each board at its own. Gzip-compressed, as
# Raspberry Pi ships it and as its firmware decompresses it.
cp "$WORK/rpi-kernel/boot/vmlinuz-$RPI_KERNEL_VERSION" "$BOOT/kernel8-rpi.img"

# THREE TREES FOR ONE BOARD. A C1-stepping Pi 5 loads bcm2712-rpi-5-b.dtb. A
# D0 board loads bcm2712d0-rpi-5-b.dtb, except under bootloader EEPROMs from
# 21 October 2026 on the latest channel, which ask for bcm2712-d-rpi-5-b.dtb
# instead. Which stepping and which EEPROM a given Pi 5 has is not knowable
# from here, and a Pi 5 that finds no tree does not boot.
for tree in bcm2712-rpi-5-b.dtb bcm2712d0-rpi-5-b.dtb bcm2712-d-rpi-5-b.dtb; do
  cp "$RPI_DTB/broadcom/$tree" "$BOOT/"
done

# RASPBERRY PI'S OVERLAYS, FROM THE SAME PACKAGE AS THE TREES, rather than one
# written here as the Pi 4's is. The Pi 4's base tree is mainline, which the
# Raspberry Pi overlays are not written against, so that overlay had to be
# ours. The Pi 5's tree is Raspberry Pi's, built in the same tree as these.
#
# vc4-kms-v3d-pi5 turns on the GPU, which this tree ships disabled: without it
# there is no v3d for Mesa to render with. The panel overlay is not named in
# config.txt at all. The firmware detects an official DSI display and loads its
# overlay itself (display_auto_detect), which is what lets one card serve
# Touch Display 1 and Touch Display 2 on either DSI connector. Both overlays it
# can choose for a 7 inch panel are here, because a detected panel whose
# overlay is missing is a dark screen with nothing logged.
for overlay in vc4-kms-v3d-pi5 vc4-kms-dsi-7inch vc4-kms-dsi-ili9881-7inch; do
  cp "$RPI_DTB/overlays/$overlay.dtbo" "$BOOT/overlays/"
done

# EVERY LABEL THEY REFERENCE EXISTS IN EVERY PI 5 TREE ON THE CARD. That is the
# failure the Pi 4 check above exists for: an overlay that compiles and names a
# label the base tree lacks, which the firmware skips without a word.
#
# Not a merge, as the Pi 4's check is, because fdtoverlay cannot apply these:
# they use the firmware's own extensions (symbols that name fragments,
# fragments that target the overlay's own nodes, parameter tables), and libfdt
# refuses vc4-kms-dsi-7inch with FDT_ERR_NOTFOUND. Raspberry Pi's dtmerge
# implements those semantics and this build does not carry it. What a merge
# would add is the status of each node afterwards, and only the board answers
# whether the panel lights up in any case.
for tree in bcm2712-rpi-5-b.dtb bcm2712d0-rpi-5-b.dtb bcm2712-d-rpi-5-b.dtb; do
  for overlay in vc4-kms-v3d-pi5 vc4-kms-dsi-7inch vc4-kms-dsi-ili9881-7inch; do
    labels=$(fdtget -p "$BOOT/overlays/$overlay.dtbo" /__fixups__) || {
      echo "$overlay.dtbo has no __fixups__ node, so what it targets cannot be checked" >&2
      exit 1
    }
    for label in $labels; do
      fdtget -t s "$BOOT/$tree" /__symbols__ "$label" >/dev/null 2>&1 || {
        echo "$overlay targets &$label and $tree has no such label" >&2
        exit 1
      }
    done
  done
done
echo "pi 5 overlays:  every label resolves in all three Pi 5 trees"

# The initramfs that opens the dm-verity mapping, one per kernel. Each is built
# from the kernel tree it boots with, so its modules and the kernel cannot be a
# version apart, which is a boot failure with no console to read it on.
/work/provisioning/build/build-initramfs.sh "$BOOT" "$WORK/kernel" "$KERNEL_VERSION"
/work/provisioning/build/build-initramfs.sh "$BOOT" "$WORK/rpi-kernel" "$RPI_KERNEL_VERSION" initramfs-rpi.img

# No splash, for the same reason the kernel command line has no `quiet`: a
# device whose whole claim is that you can watch it verify itself should not
# hide its own boot behind a picture.
#
# `followkernel` places the initramfs after the kernel in memory rather than at
# a fixed address, which is what the Pi firmware expects when it is loading both.
#
# WRITTEN TO BOTH PLACES FROM ONE STRING, the way the kernel command line below
# is, so what the firmware reads and what the verifier reads cannot drift. On a
# Raspberry Pi /boot/firmware is where this partition is mounted, so the copy in
# the root filesystem is what the running device sees and is where INV-PROV-25's
# verifier looks.
# dtoverlay: THE SCREEN. Without it dsi@7e700000 ships disabled and nothing
# describes the panel or its touch controller, so cage starts, finds a card and
# draws onto nothing. See provisioning/build/overlays/nullroute-7inch-dsi.dts
# for why the overlay is written here rather than taken from Raspberry Pi, and
# INV-PROV-25 for the assertion that this line exists at all.
#
# No vc4-kms-v3d line for the Pi 4, deliberately: the mainline tree Debian's
# kernel ships already has the GPU node at status okay, so KMS is on without
# it. The Pi 5's tree is Raspberry Pi's, which ships the GPU disabled, so there
# it is needed and named.
#
# ONE SECTION PER BOARD. The firmware applies [pi4] on a Pi 4 and [pi5] on a
# Pi 5, so each board gets its own kernel, initramfs and display setup and
# neither sees the other's. The Pi 4's overlay targets labels only the mainline
# tree has, and display_auto_detect on a Pi 4 would load Raspberry Pi's DSI
# overlay into that same mainline tree; both are kept to the board they fit.
CONFIG_TXT='arm_64bit=1
disable_splash=1

[pi4]
kernel=kernel8.img
initramfs initramfs.img followkernel
dtoverlay=nullroute-7inch-dsi

[pi5]
kernel=kernel8-rpi.img
initramfs initramfs-rpi.img followkernel
dtoverlay=vc4-kms-v3d-pi5
display_auto_detect=1'

printf '%s\n' "$CONFIG_TXT" > "$BOOT/config.txt"
mkdir -p "$ROOTFS/boot/firmware"
printf '%s\n' "$CONFIG_TXT" > "$ROOTFS/boot/firmware/config.txt"



# The pinned kernel command line, at the path the device will read it from.
#
# On a Raspberry Pi /boot/firmware is where the FAT boot partition is mounted,
# so a file at that path in the root filesystem is what the running device sees
# and is where INV-PROV-21's verifier looks. The same string is written to the
# boot partition itself further down, from the same variable, so the two cannot
# drift: what the firmware reads and what the verifier reads are one value
# derived from provisioning/profiles/os-signer.yaml.
mkdir -p "$ROOTFS/boot/firmware"
printf '%s\n' "${NULLROUTE_CMDLINE:?run through the Makefile}" > "$ROOTFS/boot/firmware/cmdline.txt"

# The kernel modules, pruned of what the profile forbids.
#
# WHY THE ROOT FILESYSTEM CARRIED NO MODULES AT ALL until now, and why that was
# worse than it looks. INV-PROV-13 asserts that no wireless kernel module is
# present, and an image with no modules whatsoever satisfies that for the wrong
# reason. The assertion only means something once there are modules for it to be
# absent from.
#
# Debian's generic arm64 kernel ships the wireless drivers, so they are deleted
# here rather than avoided. That is the same extract-and-prune discipline the
# firmware uses one block up, and for the same reason: the package that carries
# what this device needs also carries what it must not have.
cp -a "$WORK/kernel/usr/lib/modules" "$ROOTFS/usr/lib/"
# The Pi 5's modules beside the Pi 4's, each under its own kernel version, so
# whichever kernel booted finds its own tree. Without the device trees and
# overlays the package keeps under the same directory: the firmware reads
# those off the boot partition, and four hundred of them in the root
# filesystem would be files nothing opens.
cp -a "$WORK/rpi-kernel/usr/lib/modules/$RPI_KERNEL_VERSION" "$ROOTFS/usr/lib/modules/"
rm -rf "$ROOTFS/usr/lib/modules/$RPI_KERNEL_VERSION/dtb"

# THE STACK AND THE RADIO, not just the drivers. Removing
# drivers/net/wireless was the obvious half and it left cfg80211, mac80211,
# lib80211 and the whole of Bluetooth in place: 28 modules, in an image whose
# profile says "No wireless or Bluetooth kernel module is present". That was
# found by booting the card under QEMU and asking the mounted root filesystem,
# which is a thing no amount of reading the build script would have shown.
for tree in \
  kernel/drivers/net/wireless \
  kernel/net/wireless \
  kernel/net/mac80211 \
  kernel/net/bluetooth \
  kernel/drivers/bluetooth \
  kernel/net/6lowpan \
  kernel/net/nfc
do
  rm -rf "$ROOTFS/usr/lib/modules"/*/"$tree"
done
rm -rf "$ROOTFS/usr/lib/firmware/brcm"

# Named, not counted. A silent prune that stopped matching would leave the
# drivers in place and nothing would say so; INV-PROV-13 is what catches that,
# and this line is what tells you it had something to do.
# depmod, WITHOUT WHICH modprobe CANNOT WORK AT ALL. Debian runs depmod from
# the kernel package's postinst, and this build extracts rather than installs,
# so the tree shipped with no modules.dep and no modules.alias. Nothing noticed
# until the state partition failed to mount with "unknown filesystem type
# 'ext4'": ext4 is a module, modprobe had no dependency database to consult, and
# a device that boots an erofs root still needs ext4 for the partition its
# wallet lives on.
depmod -b "$ROOTFS" "$KERNEL_VERSION"
depmod -b "$ROOTFS" "$RPI_KERNEL_VERSION"

echo "  modules          $(du -sh "$ROOTFS/usr/lib/modules" | cut -f1) for $KERNEL_VERSION and $RPI_KERNEL_VERSION, wireless drivers removed, depmod run"

# --- the application ---------------------------------------------------------
#
# NODE FROM nodejs.org, NOT FROM DEBIAN. package.json requires 24.x and trixie
# ships 20.19, and the version the daemon runs on is not a detail: the crypto
# layer's constant-time assumptions were validated against a particular V8.
# Pinned by version and by the digest nodejs.org publishes for that exact
# tarball, checked before anything is unpacked, so a substituted download is a
# failed build rather than a different binary holding the keys.
NODE_VERSION=24.3.0
NODE_SHA=9729d0ecc69fad6591e4e19b46854881e8cc9d865cf03fc951a8abc567854f5e
NODE_TAR="node-v${NODE_VERSION}-linux-arm64.tar.xz"

mkdir -p "$WORK/node"
curl -fsSL -o "$WORK/$NODE_TAR" "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}"
got=$(sha256sum "$WORK/$NODE_TAR" | cut -d' ' -f1)
if [ "$got" != "$NODE_SHA" ]; then
  echo "  FAIL  $NODE_TAR" >&2
  echo "        expected $NODE_SHA" >&2
  echo "        got      $got" >&2
  exit 1
fi
tar -xJf "$WORK/$NODE_TAR" -C "$WORK/node" --strip-components=1

# At the path nullrouted.service names. Just the interpreter: npm, npx and the
# bundled headers are a package manager and a build toolchain, and neither
# belongs on a device that never installs anything.
mkdir -p "$ROOTFS/usr/lib/nullroute/bin"
cp "$WORK/node/bin/node" "$ROOTFS/usr/lib/nullroute/bin/node"
for helper in prepare-state wait-for-daemon attest-verity runtime-facts; do
  cp "/work/provisioning/units/$helper" "$ROOTFS/usr/lib/nullroute/bin/$helper"
  chmod 0755 "$ROOTFS/usr/lib/nullroute/bin/$helper"
done

# The mountpoint, which cannot be created at runtime on a read-only root.
mkdir -p "$ROOTFS/var/lib/nullroute"

# The daemon and the frontend, built on the host by `make build` and
# `make build-app`. Built there rather than here because the build needs the
# whole workspace and its dev dependencies, none of which belong in the image.
[ -f /work/packages/daemon/dist/main.js ] || {
  echo "  FAIL  packages/daemon/dist/main.js is missing. Run 'make build' first." >&2
  exit 1
}
[ -f /work/packages/ui/dist-app/index.html ] || {
  echo "  FAIL  packages/ui/dist-app/index.html is missing. Run 'make build-app' first." >&2
  exit 1
}
# THE EVIDENCE THE DAEMON REFUSES TO START WITHOUT, at NULLROUTE_ROOT. The
# verification report, the manifest it hashes to get the root hash the lock
# screen shows, and the version. Copied from the build, so the report in the
# image is the one for this exact tree; a stale one fails the daemon's own check
# rather than passing quietly.
[ -f /work/verification-report.json ] || {
  echo "  FAIL  verification-report.json is missing. Run 'make verify' first." >&2
  exit 1
}
cp /work/verification-report.json /work/MANIFEST.lock /work/VERSION "$ROOTFS/usr/lib/nullroute/"

mkdir -p "$ROOTFS/usr/lib/nullroute/daemon" "$ROOTFS/usr/lib/nullroute/ui" "$ROOTFS/usr/lib/nullroute/bridge"
cp -a /work/packages/daemon/dist/. "$ROOTFS/usr/lib/nullroute/daemon/"
cp -a /work/packages/ui/dist-app/. "$ROOTFS/usr/lib/nullroute/ui/"
# The bridge is built from the same tree as the daemon and shares its runtime
# closure, so it is a copy of dist/bridge rather than a second bundle.
cp -a /work/packages/daemon/dist/bridge/. "$ROOTFS/usr/lib/nullroute/bridge/"

# The runtime closure, and nothing else. The daemon imports @nullroute/core and
# node: builtins; core reaches @noble and @scure. Listed rather than copied
# wholesale, because node_modules on the build host also holds vitest, eslint
# and typescript, and an image is not a place to leave a compiler.
mkdir -p "$ROOTFS/usr/lib/nullroute/node_modules/@nullroute/core"
cp -a /work/packages/core/dist "$ROOTFS/usr/lib/nullroute/node_modules/@nullroute/core/"
cp /work/packages/core/package.json "$ROOTFS/usr/lib/nullroute/node_modules/@nullroute/core/"
for dep in @noble/hashes @noble/curves @scure/base @scure/bip32 @scure/bip39 @scure/btc-signer micro-packed; do
  [ -d "/work/node_modules/$dep" ] || { echo "  FAIL  node_modules/$dep is missing" >&2; exit 1; }
  mkdir -p "$ROOTFS/usr/lib/nullroute/node_modules/$(dirname "$dep")"
  cp -a "/work/node_modules/$dep" "$ROOTFS/usr/lib/nullroute/node_modules/$dep"
done

# THE ACCOUNTS THE UNITS RUN AS, with fixed ids.
#
# Fixed because everything else here is: an id allocated by whatever order the
# packages happened to install in would change the passwd file between builds
# and take the root hash with it. 900 and 901 are below the 1000 where login
# accounts start, and neither can log in: no shell, no password hash, no home.
# input and render, WHICH systemd-sysusers DOES NOT CREATE. They come from
# udev's postinst on a normal Debian install (`addgroup --system input`), and a
# postinst is exactly what an image assembled with mmdebstrap and never booted
# does not run. udev's rules chown the touchscreen to `input` and the render
# node to `render` by NAME, so the names have to exist; the ids only have to be
# stable, and fixed ones keep /etc/group identical between two builds.
for group in input:992 render:993; do
  name="${group%%:*}"
  gid="${group##*:}"
  grep -q "^${name}:" "$ROOTFS/etc/group" || echo "${name}:x:${gid}:" >> "$ROOTFS/etc/group"
done

for account in nullroute:900 nullroute-ui:901 nullroute-bridge:902; do
  name="${account%%:*}"
  id="${account##*:}"
  grep -q "^${name}:" "$ROOTFS/etc/passwd" && continue
  echo "${name}:x:${id}:${id}::/nonexistent:/usr/sbin/nologin" >> "$ROOTFS/etc/passwd"
  echo "${name}:!:${id}:" >> "$ROOTFS/etc/group"
  echo "${name}:!*::" >> "$ROOTFS/etc/shadow"
done

# THE ONE GROUP MEMBERSHIP ON THE DEVICE, and it is the whole access control
# story. The daemon's socket is 0660 owned by nullroute:nullroute; putting
# nullroute-bridge in that group is what lets the bridge open it, and leaving
# nullroute-ui out is what keeps the browser away from it. The state directory
# stays 0700, so the bridge can talk to the daemon and cannot read the store.
sed -i 's/^nullroute:!:900:$/nullroute:!:900:nullroute-bridge/' "$ROOTFS/etc/group"

echo "  application      node $NODE_VERSION, daemon, frontend, and 2 accounts"

# EROFS RATHER THAN EXT4, and this reverses what the backend recipe asked for.
#
# The recipe chose ext4 and said why: erofs is the better choice for an
# immutable partition and its reproducibility had not been established here.
# It has been now, in both directions.
#
# ext4 does not reproduce. mkfs.ext4 stamps wall-clock time into three
# superblock fields and e2fsprogs 1.47.0 ignores SOURCE_DATE_EPOCH, so two
# builds of identical content produce different images and therefore different
# root hashes. Pinning the UUID and the hash seed, which is what the recipe's
# two patches do, does not reach this: measured, 75 bytes still differed, and
# they were the timestamps and the superblock checksums over them. Setting them
# afterwards with debugfs does not work either, because debugfs stamps the last
# write time again as it closes.
#
# erofs takes the build time as an argument, and two builds two seconds apart
# are byte-identical. It is also the right filesystem for the job: read-only by
# design, under a hash tree that already guarantees integrity.
mkfs.erofs -T "$SOURCE_DATE_EPOCH" -U "$FS_UUID" "$WORK/system.erofs" "$ROOTFS" >/dev/null

veritysetup format "$WORK/system.erofs" "$WORK/system.verity" \
  --salt="$VERITY_SALT" --uuid="$VERITY_UUID" \
  | awk '/Root hash/ { print $3 }' > "$WORK/root-hash"

cp "$WORK/system.erofs" "$WORK/system.verity" "$WORK/root-hash" "$OUT/"

# THE ROOT HASH, ON THE BOOT PARTITION, AS ITS OWN FILE.
#
# Not on the kernel command line, and the reason is INV-PROV-21: that assertion
# pins the command line EXACTLY, which is what lets it catch an addition as well
# as a removal. A `roothash=` token changes with every change to the system
# partition's contents, so putting it there would mean either re-pinning the
# assertion on every build or loosening it to a pattern, and a pinned value that
# has to be regenerated is one nobody reads.
#
# A separate file keeps the command line a constant and puts the varying number
# where docs/VERIFICATION.md already says a release publishes it, as
# `system.roothash`. INV-PROV-22 lists it, so it cannot appear or vanish from
# the unprotected partition without the profile changing.
#
# It being readable and rewritable by anyone holding the card is the tier 1 gap,
# not an oversight: the boot partition is outside the hash tree by construction.
cp "$WORK/root-hash" "$BOOT/system.roothash"

echo "  boot files       $(ls "$BOOT" | tr '\n' ' ')"

# The root filesystem itself, for `make verify-image ROOT=`, when asked for.
#
# WITHOUT /dev, and that is a real limitation rather than a tidy-up. Device
# nodes cannot be created on a bind mount from macOS, so they are left behind
# rather than silently arriving as empty files. No verifier in
# provisioning/checks/ reads /dev today; if one ever does, it will find nothing
# here and must say so rather than pass. The exclusion is printed for that
# reason.
if [ "${NULLROUTE_EXPORT_ROOTFS:-0}" = "1" ]; then
  rm -rf "$OUT/rootfs"
  mkdir -p "$OUT/rootfs"
  ( cd "$ROOTFS" && tar --exclude=./dev -cf - . ) | ( cd "$OUT/rootfs" && tar -xf - ) 2>/dev/null || true
  # AND WITHOUT setuid, on a macOS host. A bind mount there drops the bit: the
  # Chromium sandbox helper is 4755 in the image and 0755 in this copy, and so
  # are su and mount. Printed rather than left to be discovered, because a
  # verifier reading this tree would otherwise report the export as an image
  # defect. INV-PROV-24's verifier detects it and says it cannot answer.
  setuid_count=$(find "$OUT/rootfs" -perm -4000 2>/dev/null | wc -l | tr -d ' ')
  echo "  rootfs exported  $OUT/rootfs (without /dev, ${setuid_count} setuid files preserved)"
elif [ -d "$OUT/rootfs" ]; then
  # A tree exported by an earlier build would sit beside this image and answer
  # `make verify-image ROOT=` for it. It did: an export from 14 September was
  # checked in place of a 25 September image, and failed camera assertions that
  # image passes. No tree is better than a tree from a different build.
  rm -rf "$OUT/rootfs"
  echo "  rootfs removed   $OUT/rootfs was from an earlier build; set NULLROUTE_EXPORT_ROOTFS=1 to export this one"
fi

echo "  system image     $(wc -c < "$OUT/system.erofs") bytes"
echo "  root hash        $(cat "$OUT/root-hash")"

# --- the card ---------------------------------------------------------------
#
# A GPT disk with the three partitions the profiles name: boot, system, and the
# verity hash tree beside it. Built with genimage, which is the tool the backend
# recipe uses, so the layout is produced the way the recipe would produce it
# rather than by a second mechanism that might differ.
#
# This said "NOT A BOOTABLE CARD" for a month after the card gained firmware, a
# kernel and an initramfs, and `make image-boot-test` boots it. What has never
# happened is a boot on a Pi; that is the limit to state, not this one.
GEN="$WORK/gen"
mkdir -p "$GEN/input" "$GEN/images" "$GEN/root"

# The pinned command line, from provisioning/profiles/os-signer.yaml. Passed in
# rather than written here, for the same reason the identifiers are.
printf '%s\n' "${NULLROUTE_CMDLINE:?run through the Makefile}" > "$GEN/input/cmdline.txt"
# -a, because the boot partition has a subdirectory now: overlays/ holds the
# device tree overlay that switches the panel on. A plain cp skips it with
# "omitting directory" and carries on, which would build a card whose config.txt
# names an overlay that is not on it.
cp -a "$BOOT"/* "$GEN/input/"
cp "$WORK/system.erofs" "$GEN/input/system.img"

# PADDED TO 8 MiB. The hash tree for a 150MiB system partition is about 1.2MiB,
# and INV-PROV-9 requires the partition to be at least 8. That is not padding
# for its own sake: the partition has to hold the tree for a system image that
# grows, and repartitioning a card in the field is not a thing this device asks
# anybody to do. The verifier reads the partition, so the partition is what has
# to be right.
cp "$WORK/system.verity" "$GEN/input/hash.img"
HASH_MIN=$((8 * 1024 * 1024))
HASH_NOW=$(wc -c < "$GEN/input/hash.img")
if [ "$HASH_NOW" -lt "$HASH_MIN" ]; then
  dd if=/dev/zero bs=1 count=$((HASH_MIN - HASH_NOW)) >> "$GEN/input/hash.img" 2>/dev/null
fi


cat > "$GEN/genimage.cfg" <<CFG
image boot.vfat {
  vfat {
    # NO VOLUME LABEL, AND THAT IS A TRADE RATHER THAN AN OVERSIGHT.
    #
    # A label is stored as a directory entry, and mkfs.vfat stamps that entry
    # with the wall clock. dosfstools 4.2 does not honour SOURCE_DATE_EPOCH, so
    # two builds of one commit differed by exactly two bytes, both inside the
    # label's timestamp. Without a label there is no such entry and the
    # filesystem is byte-identical.
    #
    # What is lost is a human-readable name when the card is plugged into
    # another machine. What is kept is a card image that reproduces, which is
    # what the whole verification story rests on. Nothing on the device reads
    # the label: the kernel command line names the root partition by device.
    # -i pins the FAT volume id. Without it mkfs.vfat derives one from the
    # clock, which fails INV-PROV-5 and, more quietly, makes the card image
    # differ between two builds of one commit. A four byte serial nobody looks
    # at is exactly the kind of thing that breaks reproducibility invisibly.
    extraargs = "-i ${NULLROUTE_BOOT_VOLUME_ID:?}"
    file "cmdline.txt" { image = "cmdline.txt" }
    file "config.txt" { image = "config.txt" }
    file "kernel8.img" { image = "kernel8.img" }
    file "bcm2711-rpi-4-b.dtb" { image = "bcm2711-rpi-4-b.dtb" }
    file "start4.elf" { image = "start4.elf" }
    file "fixup4.dat" { image = "fixup4.dat" }
    file "system.roothash" { image = "system.roothash" }
    file "initramfs.img" { image = "initramfs.img" }
    # The panel. The firmware looks for dtoverlay= names under overlays/, so
    # this one file is the difference between a screen and a dark rectangle.
    file "overlays/nullroute-7inch-dsi.dtbo" { image = "overlays/nullroute-7inch-dsi.dtbo" }
    # The Pi 5: Raspberry Pi's kernel, its initramfs, a tree per stepping and
    # EEPROM generation, the GPU overlay config.txt names and the two panel
    # overlays display_auto_detect can choose between.
    file "kernel8-rpi.img" { image = "kernel8-rpi.img" }
    file "initramfs-rpi.img" { image = "initramfs-rpi.img" }
    file "bcm2712-rpi-5-b.dtb" { image = "bcm2712-rpi-5-b.dtb" }
    file "bcm2712d0-rpi-5-b.dtb" { image = "bcm2712d0-rpi-5-b.dtb" }
    file "bcm2712-d-rpi-5-b.dtb" { image = "bcm2712-d-rpi-5-b.dtb" }
    file "overlays/vc4-kms-v3d-pi5.dtbo" { image = "overlays/vc4-kms-v3d-pi5.dtbo" }
    file "overlays/vc4-kms-dsi-7inch.dtbo" { image = "overlays/vc4-kms-dsi-7inch.dtbo" }
    file "overlays/vc4-kms-dsi-ili9881-7inch.dtbo" { image = "overlays/vc4-kms-dsi-ili9881-7inch.dtbo" }
  }
  # 128M, up from 64M when the Pi 5's kernel arrived. Two kernels, two
  # initramfs and the Pi 4's GPU firmware come to about 61MB, which would have
  # left one kernel update of room.
  size = 128M
}
image nullroute.img {
  hdimage {
    partition-table-type = "gpt"
    gpt-location = 1M
    disk-uuid = "${NULLROUTE_DISK_GUID:?}"
  }
  # TYPED AS FAT AND MARKED BOOTABLE, as Raspberry Pi's own builder marks its
  # boot partitions (rpi-image-gen, image/gpt/ab_userdata: partition-type-uuid F
  # and bootable = true). Left to genimage's default this was "Linux filesystem"
  # with no attributes, on the one partition the bootloader has to recognise
  # before anything else happens, and no card had been put in a Pi to find out
  # whether it minds. INV-PROV-35 checks both.
  partition boot {
    image = "boot.vfat"
    partition-uuid = "${NULLROUTE_BOOT_PART_GUID:?}"
    partition-type-uuid = "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7"
    bootable = true
  }
  partition system {
    image = "system.img"
    partition-uuid = "${NULLROUTE_SYSTEM_PART_GUID:?}"
  }
  partition system-hash {
    image = "hash.img"
    partition-uuid = "${NULLROUTE_SYSTEM_HASH_PART_GUID:?}"
  }
  # EMPTY ON PURPOSE. The wallet lives here and nothing on a freshly built card
  # should. nullroute-state.service makes a filesystem in it the first time the
  # device boots, which is also the only thing on the card that differs between
  # two devices built from one image.
  partition state {
    partition-type-uuid = "0FC63DAF-8483-4772-8E79-3D69D8477DE4"
    partition-uuid = "${NULLROUTE_STATE_PART_GUID:?}"
    size = 512M
  }
}
CFG

# Every input file's mtime to SOURCE_DATE_EPOCH before genimage runs.
#
# mcopy writes the source file's modification time into the FAT directory
# entry, so a cmdline.txt stamped with the build clock puts the build clock on
# the card. Measured: two builds of one commit differed by exactly two bytes,
# both inside that directory entry.
find "$GEN/input" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +

( cd "$GEN" && genimage --config genimage.cfg \
    --inputpath input --outputpath images --rootpath root --tmppath tmp ) >/dev/null 2>&1

cp "$GEN/images/nullroute.img" "$OUT/nullroute.img"
echo "  card image       $(wc -c < "$OUT/nullroute.img") bytes"
