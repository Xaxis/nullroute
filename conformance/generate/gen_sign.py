"""Build sign-deterministic.json: the signature bytes SP-SIG-1 fixes.

SP-SIG-1 says Schnorr uses BIP-340 with aux_rand set to 32 zero bytes, and
ECDSA uses RFC 6979 in one of two documented ways: with no additional data, or
ground for a low R exactly as Bitcoin Core grinds. Either way anyone holding
the seed recomputes every signature. These cases give the bytes, from code that
is not nullroute's:

- the private key for each input: BIP-32 from the BIP-84/86 test root, checked
  against the public key Bitcoin Core wrote into the PSBT for that input;
- the sighash: Bitcoin Core's own test framework (test/functional/
  test_framework/script.py, SegwitV0SignatureHash and TaprootSignatureHash);
- plain RFC 6979 and Schnorr: the same framework's key.py, ECKey.sign_ecdsa
  with rfc6979=True and sign_schnorr with its default aux of 32 zero bytes;
- low-R ECDSA: Bitcoin Core's wallet, walletprocesspsbt, which retries RFC 6979
  with additional data LE32(1), LE32(2) and so on until R is below 2^255
  (src/key.cpp, CKey::Sign).

Core's wallet also signs taproot with an all-zero aux_rand (src/script/sign.cpp,
"Use uint256{} as aux_rnd for now"), so its Schnorr bytes must equal the
framework's, and this script stops if they ever differ. Every signed
transaction is finalized by Core and accepted by its testmempoolaccept, so a
wrong sighash or key cannot reach a vector.
"""
import hashlib, hmac, json, sys
from decimal import Decimal

sys.path.insert(0, 'src/core')  # Core's test_framework at a pinned tag, fetched by regenerate.sh
from test_framework.key import ECKey, TaggedHash, compute_xonly_pubkey, sign_schnorr, tweak_add_privkey  # noqa: E402
from test_framework.crypto.secp256k1 import G, GE  # noqa: E402
from test_framework.messages import CTxOut, from_hex, tx_from_hex  # noqa: E402
from test_framework.script import (  # noqa: E402
    CScript, OP_CHECKSIG, OP_DUP, OP_EQUALVERIFY, OP_HASH160, SIGHASH_ALL, SIGHASH_DEFAULT,
    SegwitV0SignatureHash, TaprootSignatureHash, hash160)
from lib import Psbt, b58decode_check, rpc  # noqa: E402

OUT = sys.argv[1]
CORE_TAG = sys.argv[2]
pub = json.load(open('pub.json'))
CORE = rpc('getnetworkinfo')['subversion']
FP = bytes.fromhex('73c5da0a')
ORDER = GE.ORDER

# BIP-84 rootpriv (bip-0084.mediawiki line 70), the master key of "abandon x11 about".
ROOT = b58decode_check('zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5')
ROOT_CHAIN, ROOT_KEY = ROOT[13:45], int.from_bytes(ROOT[46:78], 'big')


def compressed(k):
    p = k * G
    return bytes([2 + (0 if p.y.is_even() else 1)]) + p.to_bytes_xonly()


def derive_priv(path):
    """BIP-32 CKDpriv along `path`, a list of uint32 child numbers."""
    k, c = ROOT_KEY, ROOT_CHAIN
    for i in path:
        data = (b'\0' + k.to_bytes(32, 'big')) if i >= 0x80000000 else compressed(k)
        h = hmac.new(c, data + i.to_bytes(4, 'big'), hashlib.sha512).digest()
        il = int.from_bytes(h[:32], 'big')
        assert il < ORDER
        k, c = (il + k) % ORDER, h[32:]
        assert k != 0
    return k.to_bytes(32, 'big')


def path_of(value):
    """fingerprint || uint32 LE path, as a BIP-174 derivation value carries it."""
    assert value[:4] == FP, value.hex()
    rest = value[4:]
    return [int.from_bytes(rest[j:j + 4], 'little') for j in range(0, len(rest), 4)]


def show_path(path):
    return 'm/' + '/'.join(f"{n & 0x7fffffff}{'h' if n & 0x80000000 else ''}" for n in path)


def derive(key, i):
    return rpc('deriveaddresses', pub[key], [i, i])[0]


def pay(i):
    """A payment destination owned by nobody the signer knows (BIP-32 vector 1 wallet)."""
    return derive('foreign.wpkh.0', 300 + i)


def build(coins, outputs, fee=Decimal('0.0001')):
    total = sum(Decimal(c['amount']) for c in coins)
    fixed = sum(v for _, v in outputs if v != 'rest')
    outputs = [(a, total - fixed - fee if v == 'rest' else v) for a, v in outputs]
    psbt = rpc('createpsbt', [{'txid': c['txid'], 'vout': c['vout']} for c in coins],
               [{a: str(v)} for a, v in outputs], 0, True)
    return rpc('walletprocesspsbt', psbt, False, 'DEFAULT', True, False, wallet='ours')['psbt']


def sign_reference(psbt_b64):
    """Sign every input with Core's test framework. Returns (psbt with signatures, case signatures)."""
    p = Psbt(psbt_b64)
    tx = tx_from_hex([v for k, v in p.glob if k == b'\x00'][0].hex())
    spent = []
    for m in p.inputs:
        wu = [v for k, v in m if k == b'\x01']
        assert len(wu) == 1, 'every input needs PSBT_IN_WITNESS_UTXO'
        spent.append(from_hex(CTxOut(), wu[0].hex()))
    sigs = []
    for i, m in enumerate(p.inputs):
        script = spent[i].scriptPubKey
        if script[:2] == b'\x00\x14':
            (key, value), = [(k, v) for k, v in m if k[0] == 0x06]
            path = path_of(value)
            priv = derive_priv(path)
            assert compressed(int.from_bytes(priv, 'big')) == key[1:], f'input {i}: derived key differs from the PSBT'
            assert hash160(key[1:]) == script[2:], f'input {i}: key does not hash to the script'
            code = CScript([OP_DUP, OP_HASH160, hash160(key[1:]), OP_EQUALVERIFY, OP_CHECKSIG])
            digest = SegwitV0SignatureHash(code, tx, i, SIGHASH_ALL, spent[i].nValue)
            k = ECKey()
            k.set(priv, True)
            sig = k.sign_ecdsa(digest, low_s=True, rfc6979=True) + bytes([SIGHASH_ALL])
            pair = (b'\x02' + key[1:], sig)
            r_len = sig[3]
            sigs.append({'index': i, 'scheme': 'ecdsa', 'path': show_path(path), 'keyHex': pair[0].hex(),
                         'valueHex': sig.hex(), 'sighashHex': digest.hex(), 'rHighBit': r_len == 33})
        elif script[:2] == b'\x51\x20':
            assert not any(k[0] == 0x18 for k, _ in m), 'key path only: no merkle root'
            (key, value), = [(k, v) for k, v in m if k[0] == 0x16]
            n_leaves = value[0]
            assert n_leaves == 0, 'key path only: no leaf hashes'
            path = path_of(value[1:])
            priv = derive_priv(path)
            xonly, _ = compute_xonly_pubkey(priv)
            assert xonly == key[1:], f'input {i}: derived key differs from the PSBT'
            tweaked = tweak_add_privkey(priv, TaggedHash('TapTweak', xonly))
            out_key, _ = compute_xonly_pubkey(tweaked)
            assert out_key == script[2:], f'input {i}: tweaked key is not the output key'
            digest = TaprootSignatureHash(tx, spent, SIGHASH_DEFAULT, i)
            sig = sign_schnorr(tweaked, digest)
            pair = (b'\x13', sig)
            sigs.append({'index': i, 'scheme': 'schnorr', 'path': show_path(path), 'keyHex': '13',
                         'valueHex': sig.hex(), 'sighashHex': digest.hex()})
        else:
            raise AssertionError(f'input {i}: not p2wpkh or p2tr')
        Psbt.put(m, pair[0], pair[1])
    return p.b64(), sigs


def accepted(signed_b64):
    fin = rpc('finalizepsbt', signed_b64)
    assert fin['complete'], fin
    res = rpc('testmempoolaccept', [fin['hex']])[0]
    assert res['allowed'], res
    return fin['hex']


def core_wallet_sigs(psbt_b64):
    """What Core's own wallet writes for each input, and that its transaction is valid."""
    signed = rpc('walletprocesspsbt', psbt_b64, True, 'DEFAULT', True, False, wallet='ours')['psbt']
    accepted(signed)
    out = {}
    for i, m in enumerate(Psbt(signed).inputs):
        for k, v in m:
            if k[0] in (0x02, 0x13):
                out[i] = v.hex()
    return out


# ---------------------------------------------------------------- funding
# One transaction from two matured coinbase outputs pays the addresses the
# cases spend from, so the inputs sit at more than one index and on both
# branches. Its inputs are segwit v0, which Core signs deterministically, so
# the funding txid, and every PSBT after it, is the same on every run.
unspent = rpc('listunspent', 1, 9999999, [], True, wallet='ours')
cb = sorted((u for u in unspent if u['desc'].startswith('wpkh') and Decimal(u['amount']) == 50),
            key=lambda u: (u['txid'], u['vout']))
fund_in = cb[:2]
fund_out = [
    ('w.0.3', derive('ours.wpkh.0', 3)), ('w.0.4', derive('ours.wpkh.0', 4)),
    ('w.0.7', derive('ours.wpkh.0', 7)), ('w.1.2', derive('ours.wpkh.1', 2)),
    ('t.0.5', derive('ours.tr.0', 5)), ('t.0.6', derive('ours.tr.0', 6)),
    ('t.1.1', derive('ours.tr.1', 1)),
]
outs = [{a: '5'} for _, a in fund_out] + [{derive('foreign.wpkh.0', 299): str(Decimal(100) - 5 * len(fund_out) - Decimal('0.001'))}]
raw = rpc('createpsbt', [{'txid': c['txid'], 'vout': c['vout']} for c in fund_in], outs, 0, True)
raw = rpc('walletprocesspsbt', raw, True, 'ALL', True, True, wallet='ours')['psbt']
fin = rpc('finalizepsbt', raw)
assert fin['complete']
fund_txid = rpc('sendrawtransaction', fin['hex'])
rpc('generatetoaddress', 1, derive('foreign.wpkh.0', 298))
coins = {label: {'txid': fund_txid, 'vout': vout, 'amount': Decimal(5)} for vout, (label, _) in enumerate(fund_out)}
mixed_w = cb[2]
mixed_t = sorted((u for u in unspent if u['desc'].startswith('tr')), key=lambda u: (u['txid'], u['vout']))[0]

# ---------------------------------------------------------------- cases
cases = []
SRC = [
    'keys: BIP-32 from the BIP-84 rootpriv (bip-0084.mediawiki line 70), checked against the key Bitcoin '
    f'Core {CORE} wrote into each input\'s derivation record',
    f'sighash: Bitcoin Core {CORE_TAG} test/functional/test_framework/script.py, SegwitV0SignatureHash with '
    'SIGHASH_ALL and TaprootSignatureHash with SIGHASH_DEFAULT',
    f'ECDSA: test_framework/key.py ECKey.sign_ecdsa(low_s=True, rfc6979=True); Schnorr: key.py sign_schnorr '
    'with aux 32 zero bytes, on the key tweaked by TaggedHash("TapTweak", internal key)',
    f'valueHexLowR: Bitcoin Core {CORE} walletprocesspsbt, present only where RFC 6979\'s first R is 2^255 or more; '
    'elsewhere Core\'s wallet wrote valueHex exactly',
    f'validity: every signed transaction, the framework\'s and Core\'s wallet\'s, finalized by Bitcoin Core {CORE} '
    'finalizepsbt and accepted by testmempoolaccept',
]


def add(cid, desc, psbt):
    signed, sigs = sign_reference(psbt)
    accepted(signed)
    core = core_wallet_sigs(psbt)
    assert core == core_wallet_sigs(psbt), 'Core\'s wallet signed the same PSBT two ways'
    for sig in sigs:
        theirs = core[sig['index']]
        if sig['scheme'] == 'schnorr' or not sig['rHighBit']:
            # No grinding happens when the first R is low, and taproot has no R to grind.
            assert theirs == sig['valueHex'], (cid, sig['index'], theirs, sig['valueHex'])
        else:
            assert theirs != sig['valueHex'] and int(theirs[8:10], 16) < 0x80, (cid, sig['index'])
            sig['valueHexLowR'] = theirs
    cases.append({
        'id': cid, 'operation': 'sign', 'requirements': ['SP-SIG-1'], 'level': 'MUST', 'description': desc,
        'input': {'psbt': psbt, 'context': 'abandon-mainnet'},
        'expected': {'verdict': 'signed', 'repeatable': True, 'signatureBytes': sigs},
        'sources': SRC,
        'bitcoinCore': {'fee': format(rpc('decodepsbt', psbt)['fee'], 'f'), 'testmempoolaccept': True}})
    return sigs


def first_with(coin_list, outputs_for, want_high):
    """Vary the payment by one satoshi at a time until the RFC 6979 R has the wanted high bit."""
    for n in range(64):
        psbt = build(coin_list, outputs_for(Decimal(n) / 100_000_000))
        _, sigs = sign_reference(psbt)
        if sigs[0]['rHighBit'] == want_high:
            return psbt
    raise AssertionError('no candidate found')


p = first_with([coins['w.0.3']], lambda d: [(pay(0), Decimal('1') + d), (derive('ours.wpkh.1', 4), 'rest')], False)
add('ecdsa-low-r', 'One p2wpkh input at m/84h/0h/0h/0/3, a payment and change. RFC 6979 gives an R below 2^255 on '
    'the first try, so the plain and low-R schemes write the same bytes.', p)

p = first_with([coins['w.0.4']], lambda d: [(pay(1), Decimal('2') + d), (derive('ours.wpkh.1', 4), 'rest')], True)
add('ecdsa-high-r', 'One p2wpkh input at m/84h/0h/0h/0/4. RFC 6979 gives an R of 2^255 or more, which DER writes '
    'in 33 bytes, so the two schemes part: plain RFC 6979 keeps it, and the low-R scheme retries with additional data '
    'until R is low. A signer matches the scheme it documents.', p)

p = build([coins['w.0.7'], coins['w.1.2']], [(pay(2), Decimal('7')), (derive('ours.wpkh.1', 5), 'rest')])
add('ecdsa-two-keys', 'Two p2wpkh inputs, one on the receive branch and one on the change branch. Each signature '
    'commits to every input, so neither can be computed from a one-input transaction.', p)

p = build([coins['t.0.5']], [(pay(3), Decimal('1.5')), (derive('ours.tr.1', 3), 'rest')])
add('schnorr-key-path', 'One p2tr key-path input at m/86h/0h/0h/0/5. BIP-340 with aux_rand of 32 zero bytes, '
    'SIGHASH_DEFAULT, so the signature is 64 bytes and the same under either ECDSA scheme.', p)

p = build([coins['t.0.6'], coins['t.1.1']], [(pay(4), Decimal('8')), (derive('ours.tr.1', 3), 'rest')])
add('schnorr-two-keys', 'Two p2tr key-path inputs, receive and change branch. BIP-341 commits every input\'s amount '
    'and script, so both signatures change if either input does.', p)

p = build([{'txid': mixed_w['txid'], 'vout': mixed_w['vout'], 'amount': mixed_w['amount']},
           {'txid': mixed_t['txid'], 'vout': mixed_t['vout'], 'amount': mixed_t['amount']}],
          [(pay(5), Decimal('60')), (derive('ours.wpkh.1', 6), 'rest')])
add('mixed-ecdsa-and-schnorr', 'One p2wpkh and one p2tr input in one transaction: an ECDSA signature over the '
    'BIP-143 digest and a Schnorr signature over the BIP-341 digest.', p)

# ---------------------------------------------------------------- write
name = 'sign-deterministic.json'
doc = json.load(open(f'{OUT}/{name}'))
doc['bitcoinCore'] = CORE
doc['contexts'] = {
    'abandon-mainnet': {
        'mnemonic': 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        'passphrase': '',
        'network': 'mainnet',
        'masterFingerprint': FP.hex(),
    }
}
doc['cases'] = cases
json.dump(doc, open(f'{OUT}/{name}', 'w'), indent=2)
open(f'{OUT}/{name}', 'a').write('\n')
print(name, len(cases), [(c['id'], ['lowR' if 'valueHexLowR' in x else x['scheme'] for x in c['expected']['signatureBytes']]) for c in cases])
