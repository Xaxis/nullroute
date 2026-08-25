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
SUITE="${NULLROUTE_SUITE:-bookworm}"
MIRROR="${NULLROUTE_MIRROR:-http://deb.debian.org/debian}"
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

mmdebstrap --variant="$VARIANT" --mode=root --format=directory \
  "$SUITE" "$ROOTFS" "$MIRROR" >/dev/null 2>&1

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
  echo "  rootfs exported  $OUT/rootfs (without /dev: see build-system.sh)"
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
# NOT A BOOTABLE CARD. There is no firmware, no kernel and no initramfs here:
# this exists so the image-level verifiers have a real artifact to read instead
# of a synthetic fixture. What it does carry is the partition table, the pinned
# GUIDs, the verity superblock and the pinned kernel command line, which is
# every byte those four assertions read.
GEN="$WORK/gen"
mkdir -p "$GEN/input" "$GEN/images" "$GEN/root"

# The pinned command line, from provisioning/profiles/os-signer.yaml. Passed in
# rather than written here, for the same reason the identifiers are.
printf '%s\n' "${NULLROUTE_CMDLINE:?run through the Makefile}" > "$GEN/input/cmdline.txt"
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
  }
  size = 64M
}
image nullroute.img {
  hdimage {
    partition-table-type = "gpt"
    gpt-location = 1M
    disk-uuid = "${NULLROUTE_DISK_GUID:?}"
  }
  partition boot {
    image = "boot.vfat"
    partition-uuid = "${NULLROUTE_BOOT_PART_GUID:?}"
  }
  partition system {
    image = "system.img"
    partition-uuid = "${NULLROUTE_SYSTEM_PART_GUID:?}"
  }
  partition system-hash {
    image = "hash.img"
    partition-uuid = "${NULLROUTE_SYSTEM_HASH_PART_GUID:?}"
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
