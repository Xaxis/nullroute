"""conformance/fixtures/qr-mode.json: QR symbols from pyqrcode, an encoder that
shares no code with nullroute or with the runner, so the runner can check its
own mode reader before it trusts it with a signer's frames."""
import json, sys

sys.path.insert(0, 'py')
import pyqrcode  # noqa: E402

OUT = sys.argv[1]
samples = []
for mode, text in (('alphanumeric', 'B$2P0400ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
                   ('alphanumeric', 'B$HP0201' + 'DEADBEEF' * 12),
                   ('binary', 'B$2P0400abcdefgh' * 3),
                   ('binary', 'cHNidP8BAP1PAwIAAAAD' * 6),
                   ('numeric', '0123456789' * 5)):
    for level in ('L', 'H'):
        q = pyqrcode.create(text, error=level, mode=mode)
        samples.append({'mode': 'byte' if mode == 'binary' else mode, 'level': level, 'version': q.version,
                        'text': text, 'modules': [''.join('1' if b else '0' for b in row) for row in q.code]})
doc = {'description': 'QR symbols encoded by pyqrcode 1.2.1, used by conformance/run.mjs to check its '
                      'first-segment mode reader at start. Rows of 1 (dark) and 0, no quiet zone.',
       'samples': samples}
with open(OUT, 'w') as f:
    json.dump(doc, f, indent=1)
    f.write('\n')
print('qr-mode.json', len(samples), sorted(set(s['version'] for s in samples)))
