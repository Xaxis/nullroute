#!/usr/bin/env bash
# Run the signer-profile vectors against SeedSigner's own code.
#
#   conformance/interop/seedsigner-adapter.sh [runner options]
#
# Fetches SeedSigner at a pinned commit with git, so the tree is checked by its
# commit hash rather than by trusting an archive, and installs the embit
# release SeedSigner's requirements.txt pins, with the hash it pins. urtypes,
# which SeedSigner's QR decoder imports, is pinned there as a source archive;
# it is fetched, checked against that hash and unpacked, never built or
# installed, so none of its code runs until SeedSigner imports it. All are
# kept in a cache outside the repository (SEEDSIGNER_CACHE, by default
# ~/.cache/nullroute/seedsigner-<commit>) and checked again on every run, so a
# second run needs no network. Then runs conformance/run.mjs with
# conformance/adapters/seedsigner.mjs and the findings in
# conformance/known-failures/seedsigner.json, passing on any runner options.
#
# Needs the network, git, node and python3 with pip3, so it is `make
# conformance-seedsigner`, not part of `make check`. Nothing here runs
# nullroute's signer.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
SEEDSIGNER=5f321768bad3861522c25b533261d2b573c06076
EMBIT_VERSION=0.8.0
# requirements.txt at $SEEDSIGNER, the embit line.
EMBIT_SHA256=8bf4b10073c67400370ce523fb16f035fe759f6fdd987c579bdcc268d75ed770
# The same file, the urtypes line.
URTYPES_URL=https://github.com/selfcustody/urtypes/archive/7fb280eab3b3563dfc57d2733b0bf5cbc0a96a6a.tar.gz
URTYPES_SHA256=bab06f952d9c93c8756068e2252751840b3c7ba102cdb273c4325c57e991bd2e
WORK=${SEEDSIGNER_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/nullroute/seedsigner-${SEEDSIGNER:0:8}}
mkdir -p "$WORK"

if [ ! -d "$WORK/seedsigner/.git" ]; then
  git -c init.defaultBranch=main init --quiet "$WORK/seedsigner"
  git -C "$WORK/seedsigner" fetch --quiet --depth 1 https://github.com/SeedSigner/seedsigner.git "$SEEDSIGNER"
  git -C "$WORK/seedsigner" checkout --quiet FETCH_HEAD
fi
# Every run, cached or not: the tree is that commit and nothing in it changed.
if [ "$(git -C "$WORK/seedsigner" rev-parse HEAD)" != "$SEEDSIGNER" ] ||
  [ -n "$(git -C "$WORK/seedsigner" status --porcelain --untracked-files=no)" ]; then
  echo "seedsigner-adapter.sh: $WORK/seedsigner is not SeedSigner $SEEDSIGNER as fetched; delete $WORK and run again" >&2
  exit 1
fi
grep -q "^embit==$EMBIT_VERSION " "$WORK/seedsigner/requirements.txt"
grep -q "sha256:$EMBIT_SHA256" "$WORK/seedsigner/requirements.txt"

if [ ! -d "$WORK/embit-$EMBIT_VERSION/embit" ]; then
  printf 'embit==%s --hash=sha256:%s\n' "$EMBIT_VERSION" "$EMBIT_SHA256" > "$WORK/embit-requirements.txt"
  pip3 install --quiet --require-hashes --no-deps --target "$WORK/embit-$EMBIT_VERSION" -r "$WORK/embit-requirements.txt"
fi

grep -q "^urtypes @ $URTYPES_URL " "$WORK/seedsigner/requirements.txt"
grep -q "sha256:$URTYPES_SHA256" "$WORK/seedsigner/requirements.txt"
if [ ! -d "$WORK/urtypes/src/urtypes" ]; then
  curl -fsSL -o "$WORK/urtypes.tar.gz" "$URTYPES_URL"
  echo "$URTYPES_SHA256  $WORK/urtypes.tar.gz" | sha256sum -c --quiet -
  mkdir -p "$WORK/urtypes"
  tar -xzf "$WORK/urtypes.tar.gz" -C "$WORK/urtypes" --strip-components=1
fi

cd "$ROOT"
SEEDSIGNER_SRC="$WORK/seedsigner/src" SEEDSIGNER_EMBIT="$WORK/embit-$EMBIT_VERSION" \
  SEEDSIGNER_URTYPES="$WORK/urtypes/src" \
  SEEDSIGNER_COMMIT="${SEEDSIGNER:0:8}" SEEDSIGNER_EMBIT_VERSION="$EMBIT_VERSION" \
  node conformance/run.mjs conformance/adapters/seedsigner.mjs \
  --known-failures conformance/known-failures/seedsigner.json "$@"
