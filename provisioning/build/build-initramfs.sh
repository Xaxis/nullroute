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
# One initramfs per kernel, because the modules inside have to be that
# kernel's. The Pi 4 boots initramfs.img and the Pi 5 initramfs-rpi.img.
NAME="${4:-initramfs.img}"

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

# THE MODULES, RESOLVED FROM THE KERNEL'S OWN DEPENDENCY DATA rather than listed
# by hand. The list used to be eleven names in an order worked out by booting
# and reading which symbols failed to link, and it was right for exactly one
# kernel. Raspberry Pi's kernel builds fat, vfat and both codepages in, and
# 6.18 has no crc32c_generic or libcrc32c at all, so the same list stopped the
# build at the first name it could not find. depmod over the extracted tree and
# `modprobe --show-depends` answer the question for whichever kernel this is:
# every module the named ones need, softdeps included, in an order that loads,
# and "builtin" for what the kernel already has. Against Debian's 6.12.94 that
# is the same eleven modules the list held.
#
# depmod writes its index into the extracted tree. That tree is this build's
# scratch copy, and build-system.sh runs depmod again over the root filesystem
# after copying it, so nothing written here reaches the card.
DEPBASE="$WORK.depmod"
rm -rf "$DEPBASE"
mkdir -p "$DEPBASE/lib"
ln -s "$KERNEL_TREE/usr/lib/modules" "$DEPBASE/lib/modules"
depmod -b "$DEPBASE" "$KVER"

# Adds what module $1 needs to the ordered list $2, decompressed, skipping
# built-ins and anything already carried. Fails when modprobe cannot place $1
# at all. DECOMPRESSED because busybox insmod does not read .ko.xz.
resolve() {
  plan=$(modprobe -d "$DEPBASE" -S "$KVER" --show-depends "$1" 2>/dev/null) || return 1
  for path in $(printf '%s\n' "$plan" | awk '$1 == "insmod" { print $2 }'); do
    name=$(basename "$path" .ko.xz)
    case "$path" in *.ko.xz) : ;; *) echo "build-initramfs: $path is not a .ko.xz" >&2; return 1 ;; esac
    grep -qx "$name" "$WORK/modules/required" "$WORK/modules/storage" 2>/dev/null && continue
    xz -dc "$path" > "$WORK/modules/${name}.ko" || return 1
    echo "$name" >> "$2"
  done
  printf '%s\n' "$plan" | awk '$1 == "builtin" { print $2 }' >> "$WORK/builtin"
}

: > "$WORK/modules/required"
: > "$WORK/modules/storage"
: > "$WORK/builtin"

# What /init cannot do without: the boot partition is FAT and the root hash is
# read off it, vfat refuses to mount without a codepage, and the system
# partition is erofs under dm-verity.
for module in vfat nls_cp437 nls_ascii dm-verity erofs; do
  resolve "$module" "$WORK/modules/required" || {
    echo "build-initramfs: the $KVER tree has no ${module}, as a module or built in" >&2
    exit 1
  }
done

# The storage drivers, one group per thing that can hold the card. Missing is
# tolerated here and in /init, because a Pi has no use for virtio_blk and the
# QEMU harness has no use for sdhci-iproc; carrying both is what lets the same
# initramfs be the one that gets tested and the one that ships. Raspberry Pi's
# kernel builds every one of its SD drivers in and has no virtio at all, so its
# list comes out empty, which is correct.
for module in virtio_mmio virtio_blk mmc_core sdhci sdhci-pltfm sdhci-iproc bcm2835; do
  resolve "$module" "$WORK/modules/storage" || continue
done

echo "  initramfs        $KVER: loads $(tr '\n' ' ' < "$WORK/modules/required")"
echo "                   storage $(tr '\n' ' ' < "$WORK/modules/storage")"
echo "                   built in $(sort -u "$WORK/builtin" | tr '\n' ' ')"
rm -f "$WORK/builtin"
rm -rf "$DEPBASE"

cp /work/provisioning/build/initramfs/init "$WORK/init"
chmod 0755 "$WORK/init"

# Determinism, in the three places an archive picks up the clock.
find "$WORK" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
( cd "$WORK" && find . -print0 | LC_ALL=C sort -z \
    | cpio --null --create --format=newc --quiet --reproducible ) \
  | gzip -9 -n > "$OUT/$NAME"

echo "  initramfs        $NAME, $(wc -c < "$OUT/$NAME") bytes"
