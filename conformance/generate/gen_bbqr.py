"""bbqr-psbt.json from Coinkite's reference implementation (coinkite/BBQr,
python/bbqr) and a real Coldcard scan from that repository's test_data.
Nothing here imports nullroute."""
import base64, hashlib, json, sys, zlib

OUT = sys.argv[1]
COMMIT = sys.argv[2]
sys.path.insert(0, 'py')
sys.path.insert(0, 'src/bbqr/python')
from bbqr.split import split_qrs  # noqa: E402
from bbqr.join import join_qrs  # noqa: E402
from bbqr.utils import decode_data  # noqa: E402

REPO = f'coinkite/BBQr at {COMMIT}'


def load(name):
    return open(f'src/bbqr/test_data/{name}', 'rb').read()


def split(raw, enc, **kw):
    ver, parts = split_qrs(raw, 'P', encoding=enc, **(kw or {'max_version': 12}))
    ftype, back = join_qrs(parts)
    assert ftype == 'P' and back == raw
    return parts


def b64(b):
    return base64.b64encode(b).decode()


psbt20 = load('1in20out.psbt')
psbt10 = load('1in10out.psbt')
psbt2 = load('1in2out.psbt')
for p in (psbt20, psbt10, psbt2):
    assert p[:5] == b'psbt\xff'

cases = []
SRC_SPLIT = f'frames: bbqr.split_qrs from {REPO} (python/bbqr/split.py), input file from test_data/'
SRC_DATA = 'dataBase64: the input file itself; bbqr.join_qrs from the same repository returns it byte for byte'


def join_case(cid, reqs, desc, frames, expected, sources, level='MUST'):
    cases.append({'id': cid, 'operation': 'bbqrJoin', 'requirements': reqs, 'level': level,
                  'description': desc, 'input': {'frames': frames}, 'expected': expected, 'sources': sources})


for enc in ('2', 'H', 'Z'):
    frames = split(psbt20, enc)
    assert len(frames) > 1
    join_case(f'reference-{enc}-psbt', ['SP-TX-2', 'SP-TX-3'],
              f'test_data/1in20out.psbt ({len(psbt20)} bytes) split by the reference implementation with encoding {enc} at QR version 12 or below, '
              f'{len(frames)} frames in order.',
              frames, {'verdict': 'complete', 'fileType': 'P', 'dataBase64': b64(psbt20)}, [SRC_SPLIT, SRC_DATA])

lines = [ln.strip() for ln in load('real-scan.txt').decode().splitlines() if ln.strip()]
ftype, data = join_qrs(lines)
# Independent of join.py: rebuild from the unique parts with the standard library.
uniq = {}
for ln in lines:
    uniq.setdefault(int(ln[6:8], 36), ln[8:])
raw = b''.join(base64.b32decode(uniq[i] + '=' * ((8 - len(uniq[i]) % 8) % 8)) for i in sorted(uniq))
assert zlib.decompress(raw, wbits=-10) == data
join_case('coldcard-real-scan', ['SP-TX-3'],
          f'A real camera scan of a Coldcard animation, from test_data/real-scan.txt: {len(lines)} scanned frames of an '
          f'{int(lines[0][4:6], 36)}-part transfer, encoding Z (zlib), file type U, in scan order with repeats.',
          lines, {'verdict': 'complete', 'fileType': ftype, 'dataSha256': hashlib.sha256(data).hexdigest(),
                  'dataLength': len(data)},
          [f'frames: test_data/real-scan.txt from {REPO}',
           'dataSha256: bbqr.join_qrs from the same repository, cross-checked by base32 decoding the unique parts and inflating with Python zlib (wbits=-10)'])

frames = split(psbt2, '2')
shuffled = list(reversed(frames)) + [frames[0]]
join_case('out-of-order-with-identical-repeat', ['SP-TX-3', 'SP-TX-5'],
          'The frames of a reference split of test_data/1in2out.psbt in reverse order, with the first frame repeated '
          'unchanged. Order and identical repeats do not matter.',
          shuffled, {'verdict': 'complete', 'fileType': 'P', 'dataBase64': b64(psbt2)}, [SRC_SPLIT, SRC_DATA])

bad = frames[1][:-1] + ('A' if frames[1][-1] != 'A' else 'B')
join_case('conflicting-repeat', ['SP-TX-5'],
          'Frame 1 arrives twice with different contents (its last character changed) before the transfer completes.',
          [frames[0], frames[1], bad] + frames[2:], {'verdict': 'refuse'},
          ['verdict: SP-TX-5 text; bbqr.join_qrs raises "dup part ... has wrong content" on the same input'])
try:
    join_qrs([frames[0], frames[1], bad] + frames[2:])
    raise SystemExit('reference accepted a conflicting repeat')
except AssertionError:
    pass

a3 = split(psbt10, '2', min_split=3, max_split=3)
b4 = split(psbt20, '2', min_split=4, max_split=4)
join_case('total-differs', ['SP-TX-5'],
          'Frame 0 of a 3-part transfer followed by frames of a 4-part transfer.',
          [a3[0]] + b4, {'verdict': 'refuse'}, [SRC_SPLIT, 'verdict: SP-TX-5 text'])

retyped = b4[1][:3] + 'T' + b4[1][4:]
join_case('file-type-differs', ['SP-TX-5'],
          'A 4-part P transfer in which frame 1 claims file type T.',
          [b4[0], retyped, b4[2], b4[3]], {'verdict': 'refuse'}, [SRC_SPLIT, 'verdict: SP-TX-5 text'])

h4 = split(psbt20, 'H', min_split=4, max_split=4)
assert len(h4) == 4
join_case('encoding-differs', ['SP-TX-5'],
          'Frames 0 and 1 of a 4-part encoding 2 transfer, then frames 2 and 3 of a 4-part encoding H transfer of the same file.',
          [b4[0], b4[1], h4[2], h4[3]], {'verdict': 'refuse'}, [SRC_SPLIT, 'verdict: SP-TX-5 text'])

a4 = split(psbt10, '2', min_split=4, max_split=4)
assert a4[0][:6] == b4[0][:6]
join_case('two-transfers-disjoint-indices', ['SP-TX-5'],
          'Frames 0 and 1 of one 4-part PSBT transfer and frames 2 and 3 of another. Total, file type and encoding '
          'agree and no index repeats, so no header check can tell. SP-TX-5 says frames from two transfers MUST NOT '
          'be assembled into one payload. BBQr carries no whole-payload checksum, so a receiver meets this only by '
          'validating what it assembled. The reference join accepts these frames.',
          [a4[0], a4[1], b4[2], b4[3]], {'verdict': 'refuse'},
          [SRC_SPLIT, 'verdict: SP-TX-5 first sentence'])
ft, franken = join_qrs([a4[0], a4[1], b4[2], b4[3]])
cases[-1]['notes'] = (f'bbqr.join_qrs returns {len(franken)} bytes of type {ft} for these frames; '
                      f'they begin with the PSBT magic: {franken[:5] == b"psbt" + bytes([255])}.')

for name, data in (('1in20out.psbt', psbt20), ('1in2out.psbt', psbt2)):
    cases.append({'id': f'write-{name.replace(".psbt", "")}', 'operation': 'bbqrEncodePsbt',
                  'requirements': ['SP-TX-2', 'SP-TX-4', 'SP-TX-6'], 'level': 'MUST',
                  'description': (f'Ask the signer to show test_data/{name} ({len(data)} bytes) as QR. It needs more than '
                                  'one frame. Every frame MUST be BBQr type P in encoding 2 or H, the joined payload '
                                  'MUST be the binary PSBT, and every frame MUST be in QR alphanumeric mode.'),
                  'input': {'psbtBase64': b64(data)},
                  'expected': {'fileType': 'P', 'encodingIn': ['2', 'H'], 'dataBase64': b64(data),
                               'minFrames': 2, 'qrMode': 'alphanumeric'},
                  'sources': [f'input: test_data/{name} from {REPO}',
                              'dataBase64: the input; type P is "PSBT file" (BBQr.md) and the file form is binary (BIP-174, "Binary PSBT files should use the .psbt file extension")',
                              'encodingIn: SP-TX-4', 'qrMode: BBQr.md line 19, "Your QR MUST use the alphanumeric character encoding"']})

doc = json.load(open(f'{OUT}/bbqr-psbt.json'))
doc['cases'] = cases
json.dump(doc, open(f'{OUT}/bbqr-psbt.json', 'w'), indent=2)
open(f'{OUT}/bbqr-psbt.json', 'a').write('\n')
print('bbqr-psbt.json', len(cases), [len(c['input'].get('frames', [])) for c in cases])
