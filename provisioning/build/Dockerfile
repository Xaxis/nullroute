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
# WHAT THIS CANNOT DO, and it is the more important half. Docker Desktop's
# kernel has no dm-verity target: `veritysetup format` computes a hash tree and
# a root hash here, which is the build-time half of tier 1, and `veritysetup
# open` fails with "Kernel does not support dm-verity mapping". Nothing in this
# container can demonstrate that a device BOOTS with an immutable root. See
# provisioning/README.md for which assertions that leaves uncounted, and
# docs/THREAT-MODEL.md for why the distinction is the whole point of tier 1.
FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

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
      e2fsprogs \
      dosfstools \
      uuid-runtime \
 && rm -rf /var/lib/apt/lists/*

# Reproducible builds read this. Overridden by the caller with the repository's
# own last commit time, so the same source produces the same bytes rather than
# the same source at two o'clock producing different bytes than at three.
ENV SOURCE_DATE_EPOCH=0

WORKDIR /work
