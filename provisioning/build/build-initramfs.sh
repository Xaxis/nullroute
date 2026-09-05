#!/bin/sh
# Assemble the initramfs that opens the dm-verity mapping.
#
# Runs inside provisioning/build/Dockerfile, like build-system.sh, and takes the
# same view of determinism: every file gets SOURCE_DATE_EPOCH, the cpio is
# written with a sorted file list, and gzip is given -n so it does not stamp the
# archive with the wall clock. Two builds of one commit produce one initramfs.
#
# STATICALLY LINKED WHERE IT CAN BE. busybox-static needs no loader at all.
# veritysetup does, so its libraries are copied beside it, resolved with ldd
# rather than listed by hand: a list would go stale silently and the failure
# would be an initramfs that cannot open the root filesystem, discovered at
# boot on a device with no shell.
set -eu

OUT="${1:?usage: build-initramfs.sh <output directory>}"
KERNEL_TREE="${2:?usage: build-initramfs.sh <output directory> <extracted kernel tree>}"
KVER="${3:?usage: build-initramfs.sh <out> <kernel tree> <kernel version>}"

: "${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH must be set, or the build is not reproducible}"

WORK="${NULLROUTE_INITRAMFS_WORK:-/build-initramfs}"
rm -rf "$WORK"
mkdir -p "$WORK/bin" "$WORK/sbin" "$WORK/lib" "$WORK/modules" \
         "$WORK/proc" "$WORK/sys" "$WORK/dev" "$WORK/boot" "$WORK/sysroot"

cp /bin/busybox "$WORK/bin/busybox"
cp /sbin/veritysetup "$WORK/sbin/veritysetup"

# Resolved, not enumerated. See the header.
for lib in $(ldd /sbin/veritysetup | awk '/=> \//{print $3} /^\t\//{print $1}'); do
  [ -f "$lib" ] || continue
  mkdir -p "$WORK$(dirname "$lib")"
  cp -L "$lib" "$WORK$lib"
done
# The loader itself is named in the ELF header rather than by ldd's => form.
for loader in /lib/ld-linux-aarch64.so.1 /lib64/ld-linux-aarch64.so.1; do
  [ -f "$loader" ] || continue
  mkdir -p "$WORK$(dirname "$loader")"
  cp -L "$loader" "$WORK$loader"
done

# DECOMPRESSED, because busybox insmod does not read .ko.xz. Loading them is the
# first thing /init does and a module it cannot read is a boot that stops.
for module in fat vfat nls_cp437 nls_ascii dm-mod dm-bufio reed_solomon dm-verity crc32c_generic libcrc32c erofs; do
  found=$(find "$KERNEL_TREE/usr/lib/modules/$KVER" -name "${module}.ko.xz" | head -1)
  [ -n "$found" ] || { echo "build-initramfs: no ${module}.ko.xz in the kernel tree" >&2; exit 1; }
  xz -dc "$found" > "$WORK/modules/${module}.ko"
done

# The storage drivers, one group per thing that can hold the card. Missing is
# tolerated here and in /init, because a Pi has no use for virtio_blk and the
# QEMU harness has no use for sdhci-iproc; carrying both is what lets the same
# initramfs be the one that gets tested and the one that ships.
for module in virtio_mmio virtio_blk mmc_core sdhci sdhci-pltfm sdhci-iproc bcm2835; do
  found=$(find "$KERNEL_TREE/usr/lib/modules/$KVER" -name "${module}.ko.xz" | head -1)
  [ -n "$found" ] || continue
  xz -dc "$found" > "$WORK/modules/${module}.ko"
done

cp /work/provisioning/build/initramfs/init "$WORK/init"
chmod 0755 "$WORK/init"

# Determinism, in the three places an archive picks up the clock.
find "$WORK" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
( cd "$WORK" && find . -print0 | LC_ALL=C sort -z \
    | cpio --null --create --format=newc --quiet --reproducible ) \
  | gzip -9 -n > "$OUT/initramfs.img"

echo "  initramfs        $(wc -c < "$OUT/initramfs.img") bytes"
