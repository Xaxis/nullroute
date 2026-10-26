# The Linux host the image is built on.
#
# WHY THIS FILE EXISTS. The backend recipe next door has never been run, and its
# README said why: "the build needs mmdebstrap, veritysetup and genimage, which
# are Linux tools, and this repository is developed on macOS. The status changes
# when somebody runs it on Linux."
#
# That premise was about the developer's laptop rather than about the work. A
# pinned Linux container is a Linux machine, and it is a better one than a
# borrowed VM for the same reason the manifest is plain sha256sum output: a
# stranger can reproduce it. The build host stops being a property of whoever
# ran it.
#
# PINNED BY DIGEST, not by tag. `debian:bookworm-slim` moves, and a build host
# that changes underneath a reproducibility assertion is a build host that can
# make that assertion pass or fail for reasons unrelated to this repository.
# The tools are pinned to exact versions for the same reason.
#
# WHAT THIS CONTAINER'S OWN KERNEL CANNOT DO. Docker Desktop's kernel has no
# dm-verity target: `veritysetup format` computes a hash tree and a root hash
# here, and `veritysetup open` fails with "Kernel does not support dm-verity
# mapping". That was measured again rather than assumed.
#
# WHICH IS WHY QEMU IS INSTALLED. The premise used to be that nothing here could
# demonstrate a device BOOTING with an immutable root, and that was a statement
# about this container's kernel rather than about the work. A guest kernel is a
# kernel: qemu-system-aarch64 boots the same Debian kernel the card carries,
# with the same initramfs, against the same image file, and dm-verity works
# there because that kernel has the target.
#
# `make image-boot-test` does exactly that, twice: once against the card as
# built, and once against a copy with one byte flipped inside the system
# partition. The second must fail. See provisioning/build/boot-test.sh.
#
# What it still cannot do is run Raspberry Pi firmware, so the path from
# power-on to this kernel is unexercised. It proves the initramfs and the verity
# mapping, not the boot chain ahead of them.
FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

# THE ARCHIVE AT ONE MOMENT, NOT THE ARCHIVE TODAY. Every package below is
# pinned to an exact version, and pinning a version is not the same as being
# able to fetch it: Debian removes a superseded version from the live mirror at
# the next point release. That happened to ca-certificates 20250419~deb12u1 in
# October 2026 and every build of every commit failed at this line, the device
# code untouched. snapshot.debian.org serves the archive as it was at a given
# timestamp, permanently, so the pins stay fetchable and the build stops being
# a function of the date.
#
# ONE VALUE FOR THE WHOLE IMAGE. build-system.sh reads NULLROUTE_SNAPSHOT for
# the system partition and the kernel and firmware it extracts, so the build
# host and the card come from the same moment. This file is under MANIFEST.lock,
# so moving the timestamp moves the root hash a user compares.
#
# Check-Valid-Until is off because a snapshot's Release file carries the expiry
# it had on the day, which has passed. The signatures are still checked against
# the keyring in the base image; only the freshness window is waived, which is
# the point of asking for an old archive.
ENV NULLROUTE_SNAPSHOT=20261017T000000Z
RUN printf '%s\n' \
      'Types: deb' \
      "URIs: http://snapshot.debian.org/archive/debian/${NULLROUTE_SNAPSHOT}" \
      'Suites: bookworm bookworm-updates' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      '' \
      'Types: deb' \
      "URIs: http://snapshot.debian.org/archive/debian-security/${NULLROUTE_SNAPSHOT}" \
      'Suites: bookworm-security' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      > /etc/apt/sources.list.d/debian.sources \
 && printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/10snapshot

# One layer, so the version pins and the cleanup cannot drift apart.
#
# --no-install-recommends because a recommended package is a package nobody
# chose, and this image is the thing that decides what a signer contains.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      mmdebstrap=1.3.5-7 \
      genimage=16-2 \
      cryptsetup-bin=2:2.6.1-4~deb12u2 \
      fdisk=2.38.1-5+deb12u3 \
      git=1:2.39.5-0+deb12u3 \
      ca-certificates=20250419~deb12u1 \
      python3=3.11.2-1+b1 \
      zstd=1.5.4+dfsg2-5 \
      erofs-utils=1.5-1 \
      mtools=4.0.33-1+really4.0.32-1 \
      device-tree-compiler=1.6.1-4+b1 \
      e2fsprogs \
      dosfstools=4.2-1 \
      uuid-runtime \
      busybox-static=1:1.35.0-4+deb12u1+b1 \
      cpio=2.13+dfsg-7.1 \
      xz-utils=5.4.1-1+deb12u1 \
      qemu-system-arm=1:7.2+dfsg-7+deb12u18+b3 \
      curl=7.88.1-10+deb12u15 \
      kmod=30+20221128-1 \
 && rm -rf /var/lib/apt/lists/*

# Reproducible builds read this. Overridden by the caller with the repository's
# own last commit time, so the same source produces the same bytes rather than
# the same source at two o'clock producing different bytes than at three.
ENV SOURCE_DATE_EPOCH=0

WORKDIR /work
