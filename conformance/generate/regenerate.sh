#!/bin/sh
# Rebuild spec/vectors/signer-profile/ from independent sources.
#
#   conformance/generate/regenerate.sh <empty scratch directory>
#
# Needs network access, python3, pip3 and a Bitcoin Core bitcoind. It is a
# record of where every expected value came from, not part of any check: the
# vectors are committed and pinned, and nothing in `make` runs this.
#
# Every reference is fetched at a pinned commit into the scratch directory.
# Nothing here imports or runs nullroute. With the same tool versions a run
# reproduces the committed files byte for byte: regtest coinbase transactions
# depend on block height and address, not on the time, so the PSBTs come out
# the same. The files record the Bitcoin Core and Node versions used, so a
# different version changes those strings and SHA256SUMS has to be re-pinned.
set -eu
# No __pycache__ in the repository.
export PYTHONDONTWRITEBYTECODE=1

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT="$ROOT/spec/vectors/signer-profile"
WORK=${1:?usage: regenerate.sh <empty scratch directory>}
BITCOIND=${BITCOIND:-bitcoind}
BITCOIN_CLI=${BITCOIN_CLI:-bitcoin-cli}
RPCPORT=${RPCPORT:-28443}
P2PPORT=${P2PPORT:-28444}

BIPS=7c7cb232c228b258616ef64a3a079aa82996da8c
BBQR=8dc7ef07d0d520763cc0001a885ca8d29ac8719a
BECH32=7a7d7ab158db7078a333384e0e918c90dbc42917
RAW=https://raw.githubusercontent.com

mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd)
if [ -n "$(ls -A "$WORK")" ]; then
  echo "regenerate.sh: $WORK is not empty" >&2
  exit 1
fi

mkdir -p "$WORK/src/bbqr/python/bbqr" "$WORK/src/bbqr/test_data"
curl -sfL -o "$WORK/src/english.txt" "$RAW/bitcoin/bips/$BIPS/bip-0039/english.txt"
curl -sfL -o "$WORK/src/segwit_addr.py" "$RAW/sipa/bech32/$BECH32/ref/python/segwit_addr.py"
for f in python/bbqr/split.py python/bbqr/join.py python/bbqr/utils.py python/bbqr/consts.py \
  test_data/real-scan.txt test_data/1in2out.psbt test_data/1in10out.psbt test_data/1in20out.psbt; do
  curl -sfL -o "$WORK/src/bbqr/$f" "$RAW/coinkite/BBQr/$BBQR/$f"
done
# pyqrcode supplies the QR capacity table the BBQr reference splitter reads.
pip3 install --quiet --target "$WORK/py" pyqrcode==1.2.1

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
  -rpcuser=u -rpcpassword=p -fallbackfee=0.0001 -listen=0 -dnsseed=0 -daemon >/dev/null
i=0
until $CLI getblockcount >/dev/null 2>&1; do
  i=$((i + 1))
  [ $i -lt 30 ] || { echo 'bitcoind did not start' >&2; exit 1; }
  sleep 1
done

cd "$WORK"
python3 "$HERE/headers.py" "$OUT"
python3 "$HERE/core_setup.py"
python3 "$HERE/gen_review.py" "$OUT"
python3 "$HERE/gen_dice.py" "$OUT" "$ROOT"
python3 "$HERE/gen_manifest.py" "$OUT"
python3 "$HERE/gen_bbqr.py" "$OUT" "$BBQR"
python3 "$HERE/gen_qr_fixture.py" "$ROOT/conformance/fixtures/qr-mode.json"

cd "$OUT"
printf '%s\n' *.json | LC_ALL=C sort | xargs shasum -a 256 > SHA256SUMS
cat SHA256SUMS
python3 "$HERE/pin_specs.py" "$ROOT"
