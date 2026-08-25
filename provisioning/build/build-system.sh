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
# WHY EVERY CONSTANT IS A HASH OF A STRING. The salt, the filesystem UUID and
# the verity UUID all have to be pinned or the output moves between builds, and
# a pinned constant that is just a random-looking literal is a constant nobody
# can check. These are sha256 of a namespaced string, so a third party recomputes
# them with coreutils exactly the way they check MANIFEST.lock:
#
#   printf 'nullroute/verity-salt/0.1.0' | sha256sum
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

hex32() { printf '%s' "$1" | sha256sum | cut -c1-32; }
as_uuid() { echo "$1" | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12})$/\1-\2-\3-\4-\5/'; }

VERITY_SALT=$(printf 'nullroute/verity-salt/0.1.0' | sha256sum | cut -d' ' -f1)
FS_UUID=$(as_uuid "$(hex32 'nullroute/erofs-uuid/0.1.0')")
VERITY_UUID=$(as_uuid "$(hex32 'nullroute/verity-uuid/0.1.0')")

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
