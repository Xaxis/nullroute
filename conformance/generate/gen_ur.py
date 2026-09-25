"""ur-psbt.json from SeedSigner's own UR code (src/seedsigner/helpers/ur2, a
vendored descendant of Foundation's foundation-ur-py) and selfcustody/urtypes,
the two pieces SeedSigner uses to write a PSBT as UR. The PSBTs are coinkite/BBQr
test_data, fetched for gen_bbqr.py. Nothing here imports nullroute."""
import base64, json, sys

OUT = sys.argv[1]
SEEDSIGNER = sys.argv[2]
URTYPES = sys.argv[3]
sys.path.insert(0, 'py')
sys.path.insert(0, 'src/seedsigner')
from ur2.ur import UR  # noqa: E402
from ur2.ur_encoder import UREncoder  # noqa: E402
from ur2.ur_decoder import URDecoder  # noqa: E402
from ur2.fountain_encoder import Part  # noqa: E402
from urtypes.crypto import PSBT as UR_PSBT  # noqa: E402

SS = f'SeedSigner/seedsigner at {SEEDSIGNER}, src/seedsigner/helpers/ur2'
UT = f'selfcustody/urtypes at {URTYPES}'
# SeedSigner's medium density, its default (src/seedsigner/models/encode_qr.py,
# qr_max_fragment_size: LOW 40, MEDIUM 65, HIGH 90).
FRAGMENT = 65


def load(name):
    return open(f'src/bbqr/test_data/{name}', 'rb').read()


def b64(b):
    return base64.b64encode(b).decode()


def encoder(psbt, type_name='crypto-psbt', first=0):
    # Exactly how SeedSigner writes a PSBT (models/encode_qr.py, UrPsbtQrEncoder).
    return UREncoder(UR(type_name, UR_PSBT(psbt).to_cbor()), FRAGMENT, first)


def decodes(frames, psbt, type_name='crypto-psbt'):
    """SeedSigner's decoder agrees before a frame goes in a vector."""
    d = URDecoder()
    for f in frames:
        d.receive_part(f)
    assert d.is_complete() and d.is_success(), 'reference decoder did not finish'
    assert d.result.type == type_name
    assert UR_PSBT.from_cbor(d.result.cbor).data == psbt
    return True


psbt20 = load('1in20out.psbt')
psbt10 = load('1in10out.psbt')
psbt2 = load('1in2out.psbt')
cases = []


def case(cid, desc, frames, expected, sources, notes=None):
    c = {'id': cid, 'operation': 'urJoin', 'requirements': ['SP-TX-7'], 'level': 'MUST',
         'description': desc, 'input': {'frames': frames}, 'expected': expected, 'sources': sources}
    if notes:
        c['notes'] = notes
    cases.append(c)


enc = encoder(psbt20)
first_loop = [enc.next_part().upper() for _ in range(enc.fountain_encoder.seq_len())]
decodes(first_loop, psbt20)
case('seedsigner-writes-1in20out',
     f'test_data/1in20out.psbt ({len(psbt20)} bytes) as SeedSigner writes it: crypto-psbt, {FRAGMENT}-byte '
     f'fragments, the first {len(first_loop)} frames in order, uppercase as a QR carries them.',
     first_loop, {'verdict': 'complete', 'type': 'crypto-psbt', 'dataBase64': b64(psbt20)},
     [f'frames: UREncoder from {SS}, body UR_PSBT(...).to_cbor() from {UT}',
      f'dataBase64: the input, and {SS} ur_decoder.URDecoder reads these frames back to it'])

# A camera that joins after the first loop sees only mixed parts. Take them from
# there until SeedSigner's own decoder finishes on exactly that list.
late = encoder(psbt20)
for _ in range(late.fountain_encoder.seq_len()):
    late.next_part()
d = URDecoder()
mixed = []
while not d.is_complete():
    part = late.next_part().upper()
    mixed.append(part)
    d.receive_part(part)
    assert len(mixed) < 500
decodes(mixed, psbt20)
case('seedsigner-mixed-parts-only',
     f'The same PSBT, joined after the first loop: the {len(mixed)} frames from number '
     f'{late.fountain_encoder.seq_len() + 1} on, every one XORing several fragments, which is exactly as many as '
     'SeedSigner\'s own decoder needed. A reader that only takes simple parts never finishes.',
     mixed, {'verdict': 'complete', 'type': 'crypto-psbt', 'dataBase64': b64(psbt20)},
     [f'frames: UREncoder from {SS}, parts {late.fountain_encoder.seq_len() + 1} onward',
      f'dataBase64: the input; the count is where {SS} URDecoder reported complete'])

named = encoder(psbt2, 'psbt')
frames = [named.next_part().upper() for _ in range(named.fountain_encoder.seq_len())]
decodes(frames, psbt2, 'psbt')
case('registry-type-name-psbt',
     f'test_data/1in2out.psbt under the UR type the registry recommends writing, `psbt`, rather than the '
     f'`crypto-psbt` wallets write. SP-TX-7: a reader MUST accept both.',
     frames, {'verdict': 'complete', 'type': 'psbt', 'dataBase64': b64(psbt2)},
     [f'frames: UREncoder from {SS} with the type name psbt (BCR-2020-006, tag 40310)',
      'verdict: SP-TX-7, "MUST read a PSBT under both crypto-psbt and psbt"'])

a = encoder(psbt20)
b = encoder(psbt10)
two = [a.next_part().upper(), b.next_part().upper(), a.next_part().upper()]
case('two-transfers',
     'Frame 1 of 1in20out.psbt, then frame 1 of 1in10out.psbt, then frame 2 of the first. Both are crypto-psbt at '
     'the same fragment size; the message length and checksum in each part differ.',
     two, {'verdict': 'refuse'},
     [f'frames: UREncoder from {SS}', 'verdict: SP-TX-7, "MUST refuse a part whose sequence length, message '
      'length, checksum or fragment length differs from the transfer in progress"'])

# A message that joins with the wrong checksum. Every frame is well formed, its
# Bytewords checksum correct, but one fragment's data is changed inside the part,
# so the joined message no longer matches the checksum every part carries.
bad = encoder(psbt2)
parts = [bad.fountain_encoder.next_part() for _ in range(bad.fountain_encoder.seq_len())]
p = parts[1]
data = bytearray(p.data)
data[0] ^= 0x01
parts[1] = Part(p.seq_num, p.seq_len, p.message_len, p.checksum, bytes(data))
tampered = [UREncoder.encode_part('crypto-psbt', q).upper() for q in parts]
d = URDecoder()
for f in tampered:
    d.receive_part(f)
assert d.is_complete() and not d.is_success(), 'reference decoder accepted a tampered message'
case('message-checksum-mismatch',
     'test_data/1in2out.psbt in order, with one byte of fragment 2 flipped inside its part and the frame '
     're-encoded, so every frame passes its own Bytewords checksum and the joined message fails the CRC-32 '
     'every part carries.',
     tampered, {'verdict': 'refuse'},
     [f'frames: fountain parts from {SS}, one re-encoded with UREncoder.encode_part after the change',
      f'verdict: SP-TX-7, "MUST NOT return a message whose CRC-32 does not match"; {SS} URDecoder also fails it'])

doc = json.load(open(f'{OUT}/ur-psbt.json'))
doc['cases'] = cases
json.dump(doc, open(f'{OUT}/ur-psbt.json', 'w'), indent=2)
open(f'{OUT}/ur-psbt.json', 'a').write('\n')
print('ur-psbt.json', len(cases), [len(c['input']['frames']) for c in cases])
