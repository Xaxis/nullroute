"""dice-to-entropy.json and dice-accounting.json.

Digest: Python hashlib, cross-checked against `printf '%s' ROLLS | shasum -a 256`
and `/sbin/sha256sum`. Mnemonic: BIP-39 algorithm written here from
bip-0039.mediawiki with the English list from bitcoin/bips, checked against the
Trezor vectors before use. Seed: PBKDF2-HMAC-SHA512, 2048 rounds, salt
"mnemonic". Accounting ceiling: exact integer arithmetic.
"""
import hashlib, json, subprocess, sys, unicodedata
from fractions import Fraction

OUT = sys.argv[1]
ROOT = sys.argv[2]  # repository root, for the Trezor vectors
WORDS = open('src/english.txt').read().split()
assert len(WORDS) == 2048


def entropy_to_mnemonic(ent):
    bits = bin(int.from_bytes(ent, 'big'))[2:].zfill(len(ent) * 8)
    cs = bin(hashlib.sha256(ent).digest()[0])[2:].zfill(8)[:len(ent) * 8 // 32]
    bits += cs
    return ' '.join(WORDS[int(bits[i:i + 11], 2)] for i in range(0, len(bits), 11))


def mnemonic_to_seed(m, passphrase=''):
    m = unicodedata.normalize('NFKD', m).encode()
    salt = unicodedata.normalize('NFKD', 'mnemonic' + passphrase).encode()
    return hashlib.pbkdf2_hmac('sha512', m, salt, 2048)


trezor = json.load(open(f'{ROOT}/spec/vectors/bip39-english.json'))['english']
for ent, mn, seed, _ in trezor:
    assert entropy_to_mnemonic(bytes.fromhex(ent)) == mn
    assert mnemonic_to_seed(mn, 'TREZOR').hex() == seed
print('BIP-39 implementation matches', len(trezor), 'Trezor vectors')


def shell_digest(rolls):
    a = subprocess.run(['sh', '-c', 'printf "%s" "$1" | shasum -a 256', 'sh', rolls], capture_output=True, text=True).stdout.split()[0]
    b = subprocess.run(['sh', '-c', 'printf "%s" "$1" | /sbin/sha256sum', 'sh', rolls], capture_output=True, text=True).stdout.split()[0]
    assert a == b
    return a


WORKED = '123456' * 16 + '1234'
assert len(WORKED) == 100
seq150 = ''.join(str((i * i + 3 * i) % 6 + 1) for i in range(150))
seq1000 = ''.join(str((i * 7 + i // 5) % 6 + 1) for i in range(1000))

accept = [
    ('published-worked-example', ['SP-ENT-1', 'SP-ENT-2', 'SP-ENT-3', 'SP-ENT-10', 'SP-HW-9'], WORKED,
     'The worked example in section 2.5 of the profile: 123456 repeated to 100 rolls.'),
    ('one-hundred-sixes', ['SP-ENT-1', 'SP-ENT-2', 'SP-ENT-7'], '6' * 100,
     'A pattern any detector would flag. A warning is allowed; refusing or altering the rolls is not.'),
    ('one-hundred-and-one-rolls', ['SP-ENT-2', 'SP-ENT-3'], WORKED + '5', 'One more than the minimum.'),
    ('one-hundred-and-fifty-rolls', ['SP-ENT-2', 'SP-ENT-3'], seq150, 'The 150-roll case section 2.1 names.'),
    ('one-thousand-rolls', ['SP-ENT-2', 'SP-ENT-3'], seq1000, 'There is no upper bound: any count of 100 or more is accepted.'),
]
refuse = [
    ('ninety-nine-rolls', ['SP-ENT-3'], WORKED[:99], '99 rolls carry 255.911 bits, short of 256.'),
    ('trailing-newline', ['SP-ENT-4'], WORKED + '\n', 'What `echo` appends. Refused, not stripped.'),
    ('trailing-crlf', ['SP-ENT-4'], WORKED + '\r\n', 'A Windows line ending.'),
    ('leading-space', ['SP-ENT-4'], ' ' + WORKED, 'Whitespace before the first roll.'),
    ('space-separated', ['SP-ENT-1', 'SP-ENT-4'], ' '.join(WORKED[i:i + 6] for i in range(0, 100, 6)), 'Groups of six separated by spaces.'),
    ('comma-separated', ['SP-ENT-1', 'SP-ENT-4'], ','.join(WORKED), 'Every roll separated by a comma.'),
    ('tab-inside', ['SP-ENT-4'], WORKED[:50] + '\t' + WORKED[50:], 'A tab between roll 50 and roll 51.'),
    ('zero-based-faces', ['SP-ENT-4'], '012345' * 16 + '0123', 'A d6 read as 0 to 5. Not relabelled.'),
    ('face-seven', ['SP-ENT-4'], WORKED[:99] + '7', 'Last roll is 7.'),
    ('face-zero', ['SP-ENT-4'], '0' + WORKED[1:], 'First roll is 0.'),
    ('fullwidth-digits', ['SP-ENT-4'], ''.join(chr(0xFF10 + int(c)) for c in WORKED), 'Unicode full-width digits U+FF11 to U+FF16, which some keyboards produce. Not normalised to ASCII.'),
    ('empty', ['SP-ENT-3', 'SP-ENT-4'], '', 'No rolls.'),
]

cases = []
for cid, reqs, rolls, desc in accept:
    digest = hashlib.sha256(rolls.encode('ascii')).hexdigest()
    assert shell_digest(rolls) == digest
    mn = entropy_to_mnemonic(bytes.fromhex(digest))
    assert len(mn.split()) == 24
    cases.append({'id': cid, 'operation': 'diceToSeed', 'requirements': reqs, 'level': 'MUST', 'description': desc,
                  'input': {'rolls': rolls, 'count': len(rolls)},
                  'expected': {'verdict': 'accept', 'entropyHex': digest, 'mnemonic': mn,
                               'seedHex': mnemonic_to_seed(mn).hex()},
                  'sources': ["entropyHex: printf '%s' ROLLS | shasum -a 256, and /sbin/sha256sum, agreeing with Python hashlib",
                              'mnemonic: BIP-39 (bip-0039.mediawiki, "Generating the mnemonic") with bip-0039/english.txt from bitcoin/bips at 7c7cb232, implementation checked against the 24 Trezor vectors in spec/vectors/bip39-english.json',
                              'seedHex: PBKDF2-HMAC-SHA512, 2048 iterations, salt "mnemonic" (bip-0039.mediawiki, "From mnemonic to seed"), empty passphrase']})
assert cases[0]['expected']['entropyHex'] == 'e56403e8522ddeae1b44a1e8148b1ba4d3b4c626ccf20980056eedcc7e0c0f35'
assert cases[0]['expected']['mnemonic'].startswith('tornado cactus wheel')
assert cases[0]['expected']['seedHex'].startswith('e50a4299') and cases[0]['expected']['seedHex'].endswith('98ab8011')
for cid, reqs, rolls, desc in refuse:
    cases.append({'id': cid, 'operation': 'diceToSeed', 'requirements': reqs, 'level': 'MUST', 'description': desc,
                  'input': {'rolls': rolls, 'count': len(rolls)}, 'expected': {'verdict': 'refuse'},
                  'sources': [f'verdict: {", ".join(reqs)} text']})

doc = json.load(open(f'{OUT}/dice-to-entropy.json'))
doc['cases'] = cases
json.dump(doc, open(f'{OUT}/dice-to-entropy.json', 'w'), indent=2, ensure_ascii=False)
open(f'{OUT}/dice-to-entropy.json', 'a').write('\n')
print('dice-to-entropy.json', len(cases))

# ---------------------------------------------------------------- accounting
def ceiling(n):
    return 0 if n == 0 else (6 ** n).bit_length() - 1


closest = sorted(range(1, 10001), key=lambda n: Fraction(2 ** (ceiling(n) + 1), 6 ** n))[:12]
counts = sorted(set([0, 1, 2, 3, 10, 50, 98, 99, 100, 101, 150, 200, 1000] + closest))
cases = []
for n in counts:
    k = ceiling(n)
    assert 2 ** k <= 6 ** n < 2 ** (k + 1)
    near = n in closest
    cases.append({'id': f'rolls-{n}', 'operation': 'diceBitsShown', 'requirements': ['SP-ENT-5'], 'level': 'MUST',
                  'description': (f'{n} rolls.' + (' n * log2(6) lies just below an integer here, so a floating-point product can round up past it.' if near else '')),
                  'input': {'count': n}, 'expected': {'maxBits': k},
                  'sources': ['maxBits: the largest k with 2^k <= 6^n, by exact integer comparison in Python']})
doc = json.load(open(f'{OUT}/dice-accounting.json'))
doc['cases'] = cases
json.dump(doc, open(f'{OUT}/dice-accounting.json', 'w'), indent=2)
open(f'{OUT}/dice-accounting.json', 'a').write('\n')
print('dice-accounting.json', len(cases), 'closest', closest)
