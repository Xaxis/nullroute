#!/usr/bin/env bash
# Does SeedSigner read the UR frames this device writes?
#
# The other direction is a vector (spec/vectors/signer-profile/ur-psbt.json,
# written by SeedSigner's own encoder and read here by `make conformance`). This
# one cannot be: the frames come from nullroute, so a vector made from them
# would be nullroute agreeing with itself. Instead this feeds them, live, into
# SeedSigner's own decoder (src/seedsigner/helpers/ur2 at a pinned commit) and
# checks the PSBT that comes out: for the frames exactly as the display shows
# them, and for mixed parts alone, which only decode if SeedSigner and this
# device agree on which fragments every mixed part XORs.
#
# Needs the network to fetch SeedSigner and urtypes, so it is `make
# interop-ur`, not part of `make check`.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK=${1:?usage: seedsigner-reads-nullroute.sh <empty scratch directory>}
SEEDSIGNER=088b144eaebc79d12d6336030e943510d7a14f54
URTYPES=7fb280eab3b3563dfc57d2733b0bf5cbc0a96a6a
BBQR=8dc7ef07d0d520763cc0001a885ca8d29ac8719a
RAW=https://raw.githubusercontent.com

mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd)
if [ -n "$(ls -A "$WORK")" ]; then
  echo "seedsigner-reads-nullroute.sh: $WORK is not empty" >&2
  exit 1
fi
mkdir -p "$WORK/ur2" "$WORK/psbt"
for f in __init__.py bytewords.py cbor_lite.py constants.py crc32.py fountain_decoder.py \
  fountain_encoder.py fountain_utils.py random_sampler.py ur.py ur_decoder.py ur_encoder.py \
  utils.py xoshiro256.py; do
  curl -sfL -o "$WORK/ur2/$f" "$RAW/SeedSigner/seedsigner/$SEEDSIGNER/src/seedsigner/helpers/ur2/$f"
done
pip3 install --quiet --target "$WORK/py" "https://github.com/selfcustody/urtypes/archive/$URTYPES.tar.gz"
for f in 1in2out 1in10out 1in20out; do
  curl -sfL -o "$WORK/psbt/$f.psbt" "$RAW/coinkite/BBQr/$BBQR/test_data/$f.psbt"
done

# nullroute's frames, from the built core, exactly as the display draws them.
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs'
import { UrEncoder, PSBT_UR_TYPE, urFramesForPsbt } from '$ROOT/packages/core/dist/index.js'
// A CBOR byte string head, for the mixed stream below: the body of crypto-psbt.
const bstr = (b) => {
  const n = b.length
  const head = n < 24 ? [0x40 | n] : n < 256 ? [0x58, n] : n < 65536 ? [0x59, n >> 8, n & 255]
    : [0x5a, n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  return Uint8Array.from([...head, ...b])
}
const out = {}
for (const name of ['1in2out', '1in10out', '1in20out']) {
  const psbt = readFileSync('$WORK/psbt/' + name + '.psbt')
  // 110 is the fragment QrDisplay uses at version 12, level M; 40 forces many frames.
  for (const fragment of [40, 110]) {
    const shown = urFramesForPsbt(psbt, fragment)
    // Mixed parts only, from the first number past the loop, and plenty of them:
    // whether SeedSigner finishes on these is whether it agrees with this
    // device on which fragments every mixed part XORs.
    const seqLen = new UrEncoder(PSBT_UR_TYPE, bstr(psbt), fragment).seqLen
    const late = new UrEncoder(PSBT_UR_TYPE, bstr(psbt), fragment, seqLen)
    const mixed = Array.from({ length: seqLen * 6 }, () => late.nextPart().toUpperCase())
    out[name + '@' + fragment] = { shown, mixed }
  }
}
writeFileSync('$WORK/frames.json', JSON.stringify(out))
"

cd "$WORK"
python3 - <<'PY' 2>&1 | grep -v -E 'blake2|hashlib|Traceback|File "|raise |return |globals|ValueError|ERROR:root|^\s*\^|During handling|^$'
import json, sys
sys.path.insert(0, 'py')
sys.path.insert(0, '.')
from ur2.ur_decoder import URDecoder
from urtypes.crypto import PSBT as UR_PSBT

frames = json.load(open('frames.json'))
failures = 0
for key, sets in sorted(frames.items()):
    psbt = open(f"psbt/{key.split('@')[0]}.psbt", 'rb').read()
    for label, subset in (('as displayed', sets['shown']), ('mixed parts only', sets['mixed'])):
        d = URDecoder()
        used = 0
        for f in subset:
            d.receive_part(f)
            used += 1
            if d.is_complete():
                break
        ok = (d.is_complete() and d.is_success() and d.result.type == 'crypto-psbt'
              and UR_PSBT.from_cbor(d.result.cbor).data == psbt)
        print(f"  {'ok' if ok else 'FAIL':5} {key:16} {label}: SeedSigner finished after {used} frames")
        failures += 0 if ok else 1
print(f'seedsigner-reads-nullroute: {failures} failure(s)')
sys.exit(1 if failures else 0)
PY
