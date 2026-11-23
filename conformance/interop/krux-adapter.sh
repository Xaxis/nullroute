#!/usr/bin/env bash
# Run the signer-profile vectors against Krux's own code.
#
#   conformance/interop/krux-adapter.sh [runner options]
#
# Fetches Krux at a pinned commit of its `develop` branch, and embit at the
# commit Krux's `vendor/embit` submodule names at that commit, both with git,
# so each tree is checked by its commit hash rather than by trusting an
# archive. Only `src/` of each is checked out: the rest of Krux is firmware,
# fonts and translations nothing here reads. The gitlink is read from the
# fetched Krux tree and must equal the embit pin below, so the two pins cannot
# drift apart. Nothing in either tree is built, installed or run here; the
# bridge imports their modules with `python3 -I`, paths passed as arguments.
# Both are kept in a cache outside the repository (KRUX_CACHE, by default
# ~/.cache/nullroute/krux-<commit>) and checked again on every run, so a
# second run needs no network. Then runs conformance/run.mjs with
# conformance/adapters/krux.mjs and the findings in
# conformance/known-failures/krux.json, passing on any runner options.
#
# Needs the network, git, node and python3, so it is `make conformance-krux`,
# not part of `make check`. Nothing here runs nullroute's signer.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
# selfcustody/krux `develop` on 22 November 2026, which descends from the
# release tag v26.09.0 (2b20e337) by 122 commits.
KRUX=9180bbc5abd686babb392042d3ba158830c48cee
KRUX_TAG=v26.09.0
# The `vendor/embit` gitlink at $KRUX: diybitcoinhardware/embit, the head of
# its `hardened` branch, which descends from the release tag v0.8.2 (eb6104fd)
# by 87 commits. Upstream embit, not a fork.
EMBIT=d38d43a05c673ec128dce95d15b109e155e3003b
EMBIT_TAG=v0.8.2
WORK=${KRUX_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/nullroute/krux-${KRUX:0:8}}
mkdir -p "$WORK"

# fetch DIR URL COMMIT: a sparse checkout of COMMIT's src/ into DIR, then a
# check, on every run, that DIR is that commit and nothing in it changed.
fetch() {
  local dir=$1 url=$2 commit=$3
  if [ ! -d "$dir/.git" ]; then
    git -c init.defaultBranch=main init --quiet "$dir"
    git -C "$dir" remote add origin "$url"
    git -C "$dir" sparse-checkout set --no-cone /src/
    git -C "$dir" fetch --quiet --depth 1 --filter=blob:none origin "$commit"
    git -C "$dir" checkout --quiet FETCH_HEAD
  fi
  if [ "$(git -C "$dir" rev-parse HEAD)" != "$commit" ] ||
    [ -n "$(git -C "$dir" status --porcelain --untracked-files=no)" ]; then
    echo "krux-adapter.sh: $dir is not $commit as fetched; delete $WORK and run again" >&2
    exit 1
  fi
}

fetch "$WORK/krux" https://github.com/selfcustody/krux.git "$KRUX"
# The submodule's commit is part of Krux's tree, so it is read from there.
gitlink=$(git -C "$WORK/krux" ls-tree HEAD vendor/embit)
if [ "$gitlink" != "160000 commit $EMBIT	vendor/embit" ]; then
  echo "krux-adapter.sh: Krux $KRUX pins vendor/embit as '$gitlink', not $EMBIT" >&2
  exit 1
fi
fetch "$WORK/embit" https://github.com/diybitcoinhardware/embit.git "$EMBIT"

cd "$ROOT"
KRUX_SRC="$WORK/krux/src" KRUX_EMBIT="$WORK/embit/src" \
  KRUX_COMMIT="${KRUX:0:8}" KRUX_TAG="$KRUX_TAG" \
  KRUX_EMBIT_COMMIT="${EMBIT:0:8}" KRUX_EMBIT_TAG="$EMBIT_TAG" \
  node conformance/run.mjs conformance/adapters/krux.mjs \
  --known-failures conformance/known-failures/krux.json "$@"
