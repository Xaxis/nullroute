#!/bin/sh
# Rebuild spec/interop/bitcoin-core-31.1/ from a real Bitcoin Core.
#
#   tools/gen-interop-core.sh <empty scratch directory>
#
# Needs python3 and Bitcoin Core 31.1.0, as bitcoind and bitcoin-cli on PATH or
# named by BITCOIND and BITCOIN_CLI. It is a record of where the Core fixtures
# came from, not part of any check: the files are committed, pinned in
# spec/interop/SHA256SUMS, and nothing in `make` runs this.
#
# Offline. Core runs on regtest with its own datadir inside the scratch
# directory, RPC on port 39443 and P2P on 39444 (nothing listens on the P2P
# port, it is fixed so a second node started by hand does not collide), and is
# stopped on exit whatever happened. Every key is a published test vector and
# every timestamp is fixed, so a run with Core 31.1.0 reproduces the committed
# files byte for byte. The generator refuses any other Core version, because
# the directory is named for this one.
#
# Nothing here imports or runs nullroute. The generator reads the Sparrow
# fixtures under spec/interop/sparrow/ with its own small readers, so the
# addresses Core derives for them are an answer nullroute's code had no part in.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
INTEROP="$ROOT/spec/interop"
OUT="$INTEROP/bitcoin-core-31.1"
WORK=${1:?usage: gen-interop-core.sh <empty scratch directory>}
BITCOIND=${BITCOIND:-bitcoind}
BITCOIN_CLI=${BITCOIN_CLI:-bitcoin-cli}
RPCPORT=39443
P2PPORT=39444
export RPCPORT

mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd)
if [ -n "$(ls -A "$WORK")" ]; then
  echo "gen-interop-core.sh: $WORK is not empty" >&2
  exit 1
fi

CLI="$BITCOIN_CLI -regtest -datadir=$WORK/regtest -rpcport=$RPCPORT -rpcuser=u -rpcpassword=p"
stop() {
  $CLI stop >/dev/null 2>&1 || true
  i=0
  while [ -f "$WORK/regtest/regtest/bitcoind.pid" ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done
  rm -rf "$WORK/regtest"
}
trap stop EXIT
mkdir -p "$WORK/regtest"
"$BITCOIND" -regtest -datadir="$WORK/regtest" -port="$P2PPORT" -rpcport="$RPCPORT" \
  -rpcuser=u -rpcpassword=p -listen=0 -dnsseed=0 -daemon >/dev/null
i=0
until $CLI getblockcount >/dev/null 2>&1; do
  i=$((i + 1))
  [ $i -lt 30 ] || { echo 'bitcoind did not start' >&2; exit 1; }
  sleep 1
done

mkdir -p "$OUT"
# -I: the generator reads fixture files, and an isolated interpreter loads no
# module from beside them or from the current directory.
python3 -I "$HERE/gen-interop-core.py" "$ROOT"

# The whole tree's sums, so one pinned file covers every fixture. LC_ALL=C for
# the same reason MANIFEST.lock uses it: a locale-aware sort would make the file
# depend on the language of whoever ran this.
cd "$INTEROP"
find . -type f ! -name SHA256SUMS ! -name README.md | sed 's#^\./##' | LC_ALL=C sort \
  | xargs sha256sum > SHA256SUMS
python3 -I "$HERE/gen-interop-core.py" --pin "$ROOT"
