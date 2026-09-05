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

boot() {
  timeout 300 qemu-system-aarch64 \
    -M virt -cpu cortex-a72 -m 1024 -nographic -no-reboot -nic none \
    -kernel "$KERNEL_TREE/boot/vmlinuz-$KVER" \
    -initrd "$WORK/initramfs.img" \
    -drive "file=$1,format=raw,if=none,id=d0" \
    -device virtio-blk-device,drive=d0 \
    -append "console=ttyAMA0 nullroute.selftest panic=1" 2>&1
}

echo ""
echo "  1. the card as built"
intact=$(boot "$IMAGE")
echo "$intact" | grep -E "^nullroute:" | sed 's/^/     /'
if ! echo "$intact" | grep -q "SELFTEST OK"; then
  echo ""
  echo "  FAILED. The card as built did not reach SELFTEST OK, so the initramfs"
  echo "  could not open its own system partition. Nothing below this line means"
  echo "  anything until that works."
  exit 1
fi

echo ""
echo "  2. the same card with one byte flipped inside the system partition"
cp "$IMAGE" "$WORK/tampered.img"
printf '\377' | dd of="$WORK/tampered.img" bs=1 seek=$((SYSTEM_START + 40000000)) conv=notrunc status=none
tampered=$(boot "$WORK/tampered.img")
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

echo ""
echo "  dm-verity rejected the modified partition, which is the claim."
