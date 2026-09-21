#!/bin/sh
# Boot the card under QEMU and prove dm-verity does what tier 1 claims.
#
# WHY THIS EXISTS AT ALL. Every other check in provisioning/ reads an artifact
# at rest. None of them can answer the question tier 1 is actually about, which
# is whether a device REFUSES to run a system partition that has been modified.
# That needs a kernel with the dm-verity target, and this repository's build
# container has none, which is why the claim went untested for so long.
#
# A guest kernel is a kernel. qemu-system-aarch64 boots the same Debian kernel
# the card carries, with the same initramfs, against the same image file.
#
# TWO BOOTS, AND THE SECOND IS THE POINT. The first is the card as built and
# must reach SELFTEST OK. The second is a copy with one byte flipped inside the
# system partition and must NOT: dm-verity has to reject the block. A test that
# only ever boots a good image cannot tell a working integrity check from an
# absent one.
#
# WHAT IT DOES NOT PROVE. Raspberry Pi firmware is not involved, so the path
# from power-on to this kernel is unexercised: config.txt, start4.elf and the
# device trees are carried by the card and are not read here. This proves the
# initramfs and the verity mapping, and nothing about the boot chain ahead of
# them. It is also -M virt rather than a Pi, so the storage driver exercised is
# virtio_blk and not sdhci-iproc.
#
# And it stops before switch_root. The selftest halts once it has read the whole
# verified partition, which is where the interesting question is answered, but it
# means the pivot itself is unexercised: the root filesystem has no /sbin/init
# and no systemd yet, so there is nothing to switch into. That is the next gap,
# and it is a gap in the image rather than in this test.
set -eu

IMAGE="${1:?usage: boot-test.sh <card image> <kernel tree> <kernel version>}"
KERNEL_TREE="${2:?usage: boot-test.sh <card image> <kernel tree> <kernel version>}"
KVER="${3:?usage: boot-test.sh <card image> <kernel tree> <kernel version>}"
WORK="${NULLROUTE_BOOTTEST_WORK:-/build-boottest}"

rm -rf "$WORK"
mkdir -p "$WORK"

# THE INITRAMFS OFF THE CARD, not a fresh one built beside it. Rebuilding would
# test the builder; this tests the artifact. They are byte-identical today
# because the build is deterministic, and that is exactly the assumption a boot
# test should not be quietly making on behalf of the thing it is verifying.
BOOT_START=$(
  sfdisk -d "$IMAGE" 2>/dev/null \
    | awk -F'[=,]' '$0 ~ /name="boot"$/ { gsub(/ /, "", $2); print $2 * 512; exit }'
)
[ -n "$BOOT_START" ] || { echo "boot-test: could not read the boot partition offset" >&2; exit 1; }
mcopy -n -i "${IMAGE}@@${BOOT_START}" ::initramfs.img "$WORK/initramfs.img" \
  || { echo "boot-test: no initramfs.img on the card's boot partition" >&2; exit 1; }
echo "  initramfs        $(wc -c < "$WORK/initramfs.img") bytes, read off the card"

# The byte to corrupt, well inside the system partition rather than at a fixed
# guess: the partition table says where it starts, so a layout change moves this
# with it instead of silently corrupting the wrong region.
# BY NAME, NOT BY POSITION, the same rule partition-present follows: a layout
# that gained a partition would otherwise shift this by one and corrupt whatever
# happened to be third. The trailing anchor matters, because `name="system"`
# without it also matches `name="system-hash"`.
SYSTEM_START=$(
  sfdisk -d "$IMAGE" 2>/dev/null \
    | awk -F'[=,]' '$0 ~ /name="system"$/ { gsub(/ /, "", $2); print $2 * 512; exit }'
)
[ -n "$SYSTEM_START" ] || { echo "boot-test: could not read the system partition offset" >&2; exit 1; }

# A TIMEOUT IS A NORMAL ENDING HERE, not a failure. The intact boot pivots into
# systemd, which has no reason to shut down, so the VM runs until it is killed
# and `timeout` exits 124. The verdict comes from what the console said, not
# from qemu's exit status, and `|| true` is what stops set -e turning a
# successful boot into a failed script.
# THE DEFAULT GREW WITH THE IMAGE. The selftest reads every block of the system
# partition through the verity mapping, which is the only way to ask whether the
# card matches its root hash rather than whether the mapping opened. That is
# roughly a gigabyte of sha256 in an emulated arm64 guest, and it got slower
# every time the image gained a package: at 120 seconds the intact boot started
# being killed mid-read and reported as a card that could not open its own
# system partition, which is a harness timeout wearing the costume of a
# catastrophe.
boot() {
  timeout "${2:-420}" qemu-system-aarch64 \
    -M virt -cpu cortex-a72 -m 1024 -nographic -no-reboot -nic none \
    -kernel "$KERNEL_TREE/boot/vmlinuz-$KVER" \
    -initrd "$WORK/initramfs.img" \
    -drive "file=$1,format=raw,if=none,id=d0" \
    -device virtio-blk-device,drive=d0 \
    -device virtio-gpu-pci \
    -append "console=ttyAMA0 nullroute.selftest panic=1 systemd.journald.forward_to_console=1 systemd.log_target=console" 2>&1 || true
}

echo ""
echo "  1. the card as built"
intact=$(boot "$IMAGE")
# KEPT, NOT SUMMARISED AWAY. The filtered view below is for reading; the full
# console goes next to the image, because the last three failures here were all
# diagnosed from lines the filter dropped, and a boot test whose evidence exists
# only inside a container that has exited is a boot test you cannot debug.
mkdir -p /work/out/system
printf '%s\n' "$intact" > /work/out/system/console-intact.log
cp /work/out/system/console-intact.log "$WORK/console-intact.log"
grep -E "^nullroute|nullrouted|Starting nullroute" "$WORK/console-intact.log" | head -24 | sed 's/^/     /'
if ! grep -q "SELFTEST OK" "$WORK/console-intact.log"; then
  echo ""
  echo "  FAILED. The card as built did not reach SELFTEST OK, so the initramfs"
  echo "  could not open its own system partition. Nothing below this line means"
  echo "  anything until that works."
  exit 1
fi

# STARTED, not merely enabled. The unit files shipped for a long time with
# nothing wanting them, so the card booted all the way to a systemd that ran
# neither the daemon nor the frontend. The only proof against that is systemd
# saying it started them.
if ! grep -qE "nullrouted\.service" "$WORK/console-intact.log"; then
  echo ""
  echo "  FAILED. systemd came up and never mentioned nullrouted.service, so the"
  echo "  signing daemon did not start. A unit file under usr/lib/systemd/system"
  echo "  is one systemd knows how to run and will never run on its own."
  echo ""
  echo "  Last of the console:"
  tail -12 "$WORK/console-intact.log" | sed 's/^/     /'
  exit 1
fi

# THE TWO READINGS OF THE ROOT HASH HAVE TO AGREE.
#
# The initramfs reads system.roothash off the boot partition and opens the
# mapping with it. nullroute-attest.service then asks the RUNNING KERNEL what
# the device-mapper table actually says, and that second number is the one the
# lock screen shows. If they ever differ, the device is displaying something
# other than what it is enforcing, which is worse than displaying nothing.
opened=$(grep -oE 'verity_active=[0-9a-f]{64}' "$WORK/console-intact.log" | head -1 | cut -d= -f2)
running=$(grep -oE 'running on verity root hash [0-9a-f]{64}' "$WORK/console-intact.log" | head -1 | awk '{print $NF}')

echo ""
if [ -z "$opened" ] || [ -z "$running" ]; then
  echo "  FAILED. The root hash was not reported twice."
  echo "     initramfs opened with: ${opened:-nothing}"
  echo "     kernel reports:        ${running:-nothing}"
  echo ""
  echo "  The lock screen shows the second one. Without it the device would"
  echo "  display no system partition hash at all, which is tier 1's whole claim."
  exit 1
fi
if [ "$opened" != "$running" ]; then
  echo "  FAILED. The device is enforcing one root hash and would display another."
  echo "     opened with:    $opened"
  echo "     kernel reports: $running"
  exit 1
fi
echo "  the root hash the mapping was opened with is the one the kernel reports"
echo "     $running"

# THE KIOSK IS REPORTED, NOT REQUIRED, and the distinction is the honest one.
# It runs cage on a virtual terminal, and `-M virt` has a serial console and no
# VT, so systemd refuses it with 208/STDIN before the compositor starts. That is
# a fact about this harness: a Pi with a panel has /dev/tty1. Requiring it here
# would mean either a permanently red test or a fake display, and reporting it
# is what lets the line below be true.
if grep -q "Started nullroute-kiosk.service" "$WORK/console-intact.log"; then
  echo ""
  echo "  the kiosk started"
else
  echo ""
  echo "  the kiosk did NOT start, which is expected here and is the one thing"
  echo "  this harness cannot judge: it needs a display and a virtual terminal."
  grep -oE "nullroute-kiosk.service: [A-Za-z ]+, (code|status)=[^ ]+" \
    "$WORK/console-intact.log" | head -1 | sed 's/^/     /'
fi

echo ""
echo "  2. the same card with one byte flipped inside the system partition"
cp "$IMAGE" "$WORK/tampered.img"
printf '\377' | dd of="$WORK/tampered.img" bs=1 seek=$((SYSTEM_START + 40000000)) conv=notrunc status=none
# The tamper boot stops itself as soon as verity rejects a block, so it needs
# far less patience than a full read.
tampered=$(boot "$WORK/tampered.img" 300)
printf '%s\n' "$tampered" > /work/out/system/console-tampered.log
echo "$tampered" | grep -E "^nullroute:|verity:" | sed 's/^/     /'

if echo "$tampered" | grep -q "SELFTEST OK"; then
  echo ""
  echo "  FAILED. A modified system partition booted and reported success."
  echo "  That is the whole of what tier 1 claims to prevent."
  echo ""
  echo "  NOTE, because this is the trap: dm-verity verifies each block as it is"
  echo "  READ, so a corrupted block nobody touches is never checked, and opening"
  echo "  the mapping is not a statement about the partition. The selftest reads"
  echo "  the whole device for that reason. If that read was skipped, this test"
  echo "  passes against a corrupted card."
  exit 1
fi

# POSITIVE EVIDENCE, NOT AN ABSENCE. The line above is necessary and was the
# whole verdict, so this step passed whenever the second boot failed to say
# "SELFTEST OK" for any reason at all: qemu not starting, the 300 second budget
# running out, a kernel panic with nothing to do with verity, a wrong path, the
# guest never reaching the selftest. Every one of those printed "dm-verity
# rejected the modified partition, which is the claim" and exited 0, and the
# louder the failure the more convincing the claim looked.
#
# A real rejection says so twice, and both are on the tampered console this
# harness has been producing all along:
#   device-manager: verity: <dev>: data block N is corrupted   from the kernel
#   SELFTEST verified_whole_partition=NO                       from the guest
# The first is the kernel refusing a block. The second is the guest having read
# the whole partition and noticed, which is the part that distinguishes a
# rejection from a mapping that was opened and never exercised.
if ! echo "$tampered" | grep -qE "device-mapper: verity: .* is corrupted"; then
  echo ""
  echo "  INCONCLUSIVE. The tampered card did not report success, and the kernel"
  echo "  never said it rejected a block either, so this proves nothing about"
  echo "  dm-verity. Read out/system/console-tampered.log: the usual causes are"
  echo "  a boot that did not get as far as mounting, or one that ran out of"
  echo "  the 300 seconds the call above gives it."
  exit 1
fi

if ! echo "$tampered" | grep -q "SELFTEST verified_whole_partition=NO"; then
  echo ""
  echo "  INCONCLUSIVE. The kernel rejected a block, and the guest never reported"
  echo "  on reading the whole partition, so the harness cannot say the read that"
  echo "  makes this meaningful actually happened. dm-verity checks a block when"
  echo "  it is READ, so a mapping that opens is not a statement about the card."
  exit 1
fi

echo ""
echo "  dm-verity rejected the modified partition, which is the claim."
echo "  the kernel refused the block and the guest read the whole partition and"
echo "  reported it, so this is a rejection rather than a boot that failed."
