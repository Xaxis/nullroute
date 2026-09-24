"""Build the review-*.json vector files from Bitcoin Core on regtest.

Every expected value is read from Core's own RPCs (decodepsbt, getaddressinfo,
testmempoolaccept, getmempoolentry) or taken from BIP text. Nothing here runs
nullroute code.
"""
import json, sys
from decimal import Decimal
from lib import rpc, rpc_error, sats, Psbt, mainnet_address, path_bytes

OUT = sys.argv[1]
pub = json.load(open('pub.json'))
CORE = rpc('getnetworkinfo')['subversion']
FP = '73c5da0a'

# BIP-84 and BIP-86 published keys for mnemonic "abandon x11 about".
PK_84_0_0 = '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c'
PK_84_1_0 = '03025324888e429ab8e3dbaf1f7802648b9cd01e9b418485c5fa4c1b9b5700e1a6'
XO_86_0_0 = 'cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115'
XO_86_1_0 = '399f1b2f4393f29a18c937859c5dd8a77350103157eb880f02e8c08214277cef'


def derive(key, i):
    return rpc('deriveaddresses', pub[key], [i, i])[0]


unspent = {w: rpc('listunspent', 1, 9999999, [], True, wallet=w) for w in ('ours', 'foreign')}
pools = {
    'ours.w': [u for u in unspent['ours'] if u['desc'].startswith('wpkh')],
    'ours.t': [u for u in unspent['ours'] if u['desc'].startswith('tr')],
    'foreign.w': [u for u in unspent['foreign'] if u['desc'].startswith('wpkh')],
    'foreign.t': [u for u in unspent['foreign'] if u['desc'].startswith('tr')],
}
for p in pools.values():
    p.sort(key=lambda u: (u['txid'], u['vout']))


def coin(pool):
    u = pools[pool].pop(0)
    return {'txid': u['txid'], 'vout': u['vout'], 'amount': u['amount']}


def build(coins, outputs, locktime=0, sequences=None, wallets=('ours',), fee=Decimal('0.0001')):
    """`'rest'` as an amount means everything the inputs hold, less the other outputs and `fee`."""
    total = sum(Decimal(c['amount']) for c in coins)
    fixed = sum(v for _, v in outputs if v != 'rest')
    outputs = [(a, total - fixed - fee if v == 'rest' else v) for a, v in outputs]
    ins = []
    for i, c in enumerate(coins):
        x = {'txid': c['txid'], 'vout': c['vout']}
        if sequences is not None:
            x['sequence'] = sequences[i]
        ins.append(x)
    psbt = rpc('createpsbt', ins, [{a: str(v)} for a, v in outputs], locktime, sequences is None)
    for w in wallets:
        psbt = rpc('walletprocesspsbt', psbt, False, 'DEFAULT', True, False, wallet=w)['psbt']
    return psbt


def pay(i):
    """A payment destination owned by nobody the signer knows (BIP-32 vector 1 wallet)."""
    return derive('foreign.wpkh.0', 100 + i)


def outputs_of(psbt):
    d = rpc('decodepsbt', psbt)
    out = []
    for v in d['tx']['vout']:
        addr = v['scriptPubKey'].get('address')
        info = rpc('getaddressinfo', addr, wallet='ours') if addr else {'ismine': False}
        entry = {'index': v['n'], 'script': v['scriptPubKey']['hex'],
                 'address': mainnet_address(addr) if addr else None,
                 'amountSats': str(sats(v['value']))}
        # Not `ischange`: Core reports that for any owned script missing from
        # its address book, receive addresses included. The branch in the path
        # Core derives the script at is what decides.
        path = info.get('hdkeypath', '').replace('h', "'") if info['ismine'] else ''
        if path.split('/')[-2:-1] == ['1']:
            entry['kind'] = 'change'
            entry['changePath'] = path
        else:
            entry['kind'] = 'payment'
            if info['ismine']:
                entry['ownReceive'] = path
        out.append(entry)
    return out


def fee_of(psbt):
    d = rpc('decodepsbt', psbt)
    return None if 'fee' not in d else str(sats(d['fee']))


def strip(psbt, input_index, keytype):
    p = Psbt(psbt)
    Psbt.drop(p.inputs[input_index], keytype)
    return p.b64()


def set_sighash(psbt, values):
    p = Psbt(psbt)
    for i, v in enumerate(values):
        if v is None:
            Psbt.drop(p.inputs[i], 0x03)
        else:
            Psbt.put(p.inputs[i], b'\x03', v.to_bytes(4, 'little'))
    return p.b64()


def core_view(psbt):
    err = rpc_error('decodepsbt', psbt)
    if err:
        return {'decodepsbt': 'error: ' + err.split("'message': ")[-1].rstrip('}')}
    d = rpc('decodepsbt', psbt)
    view = {'fee': format(d['fee'], 'f') if 'fee' in d else None}
    sig = [i.get('sighash') for i in d['inputs']]
    if any(s is not None for s in sig):
        view['sighash'] = sig
    return view


def broadcast_view(psbt):
    """Sign with Core, then ask its mempool what it thinks."""
    signed = rpc('walletprocesspsbt', psbt, True, 'DEFAULT', True, True, wallet='ours')['psbt']
    fin = rpc('finalizepsbt', signed)
    assert fin['complete'], fin
    accept = rpc('testmempoolaccept', [fin['hex']])[0]
    if not accept['allowed']:
        return {'testmempoolaccept': accept['reject-reason']}
    txid = rpc('sendrawtransaction', fin['hex'])
    return {'bip125-replaceable': rpc('getmempoolentry', txid)['bip125-replaceable']}


CONTEXT = {
    'abandon-mainnet': {
        'mnemonic': 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        'passphrase': '',
        'network': 'mainnet',
        'masterFingerprint': FP,
    }
}

files = {}


def case(file, cid, reqs, desc, psbt, expected, sources, core=None, level='MUST', op='review'):
    c = {'id': cid, 'operation': op, 'requirements': reqs, 'level': level, 'description': desc,
         'input': {'psbt': psbt, 'context': 'abandon-mainnet'}, 'expected': expected,
         'sources': sources}
    c['bitcoinCore'] = core if core is not None else core_view(psbt)
    files.setdefault(file, []).append(c)


def kinds(outs, keep=('index', 'address', 'amountSats', 'kind', 'changePath')):
    return [{k: v for k, v in o.items() if k in keep} for o in outs]


SRC_FEE = f'fee: Bitcoin Core {CORE} decodepsbt field "fee", converted from BTC to satoshis'
SRC_KIND = (f'kind and changePath: Bitcoin Core {CORE} getaddressinfo (ismine, hdkeypath); change when Core derives the script on branch 1, '
            'in a descriptor wallet holding the BIP-84 and BIP-86 test key, imported with range 0 to 1000')
SRC_ADDR = ('address: scriptPubKey from decodepsbt, encoded with hrp "bc" by the BIP-173/350 reference '
            'code (sipa/bech32 ref/python/segwit_addr.py)')

# ---------------------------------------------------------------- fee and amounts
F = 'review-fee-and-amounts.json'
c1 = coin('ours.w')
p = build([c1], [(pay(0), Decimal('10')), (derive('ours.wpkh.1', 0), 'rest')])
case(F, 'fee-one-input', ['SP-REV-2', 'SP-REV-4'],
     'One segwit v0 input with both UTXO records, a payment and change. The fee is inputs minus outputs.',
     p, {'verdict': 'allow', 'feeSats': fee_of(p), 'outputs': kinds(outputs_of(p))}, [SRC_FEE, SRC_KIND, SRC_ADDR])

p = build([coin('ours.w'), coin('ours.t')], [(pay(1), Decimal('30')), (derive('ours.tr.1', 0), 'rest')], fee=Decimal('0.00005'))
case(F, 'fee-two-input-types', ['SP-REV-2', 'SP-REV-4'],
     'A segwit v0 input and a taproot input, both from the UTXO records, change to the taproot change branch.',
     p, {'verdict': 'allow', 'feeSats': fee_of(p), 'outputs': kinds(outputs_of(p))}, [SRC_FEE, SRC_KIND, SRC_ADDR])

c = coin('ours.w')
p = rpc('createpsbt', [{'txid': c['txid'], 'vout': c['vout']}], [{pay(2): '49.9999'}])
case(F, 'no-utxo-records', ['SP-REV-2'],
     'A PSBT straight from createpsbt, with no UTXO record for its only input. No amount is known, so it '
     'MUST be refused rather than reviewed.',
     p, {'verdict': 'refuse'}, ['verdict: SP-REV-2 text; Core decodepsbt reports no fee for this PSBT'],
     core={**core_view(p), 'analyzepsbt.next': rpc('analyzepsbt', p)['next']})

p = build([coin('ours.w'), coin('ours.t')], [(pay(3), 'rest')])
p = strip(strip(p, 1, 0x01), 1, 0x00)
case(F, 'one-input-without-utxo', ['SP-REV-2'],
     'Two inputs, the second stripped of both UTXO records. One missing amount is enough to refuse.',
     p, {'verdict': 'refuse'}, ['verdict: SP-REV-2 text; Core decodepsbt reports no fee for this PSBT'])

c = coin('ours.w')
p = build([c], [(pay(4), Decimal(c['amount']) + Decimal('0.1'))])
core = core_view(p)
core.update(broadcast_view(p))
case(F, 'outputs-exceed-inputs', ['SP-REV-4'],
     'Outputs total 0.1 BTC more than the only input. The transaction is invalid and MUST be refused.',
     p, {'verdict': 'refuse'},
     ['verdict: SP-REV-4 text; Core decodepsbt reports a negative fee and testmempoolaccept rejects the signed transaction'],
     core=core)

p = build([coin('ours.w')], [(pay(5), Decimal('1')), (derive('ours.wpkh.1', 1), 'rest')], fee=Decimal('4'))
case(F, 'high-fee-warns-and-does-not-block', ['SP-REV-4', 'SP-REV-13'],
     'A 4 BTC fee on a 1 BTC payment. The profile does not make a high fee blocking, so the verdict is allow; '
     'SP-REV-13 says it SHOULD warn.',
     p, {'verdict': 'allow', 'feeSats': fee_of(p), 'warnings': {'should': ['high-fee']}},
     [SRC_FEE, 'verdict and warning: SP-REV-13 text'])

p = build([coin('ours.w')], [(pay(6), 'rest')], fee=Decimal('0'))
case(F, 'zero-fee', ['SP-REV-4'],
     'Outputs equal inputs. A zero fee is valid arithmetic and is shown as 0.',
     p, {'verdict': 'allow', 'feeSats': fee_of(p)}, [SRC_FEE])

# ---------------------------------------------------------------- input amounts (SP-REV-3)
A = 'review-input-amounts.json'
NOT_ALLOW = ['block-until-override', 'refuse']
p = build([coin('ours.w')], [(pay(10), 'rest')])
case(A, 'segwit-v0-with-previous-transaction', ['SP-REV-3'],
     'A segwit v0 input carrying both PSBT_IN_WITNESS_UTXO and a matching PSBT_IN_NON_WITNESS_UTXO. The amount is confirmed.',
     p, {'verdict': 'allow'}, ['verdict: SP-REV-3 text'])

p = strip(build([coin('ours.w')], [(pay(11), 'rest')]), 0, 0x00)
case(A, 'segwit-v0-witness-utxo-only', ['SP-REV-3'],
     'A segwit v0 input with only PSBT_IN_WITNESS_UTXO. The amount is the coordinator\'s word (BIP-174, Signer), '
     'so the fee is unverified and signing MUST be blocked.',
     p, {'verdictIn': NOT_ALLOW}, ['verdict: SP-REV-3 text, BIP-174 line 415'])

p = build([coin('ours.w')], [(pay(12), 'rest')])
pp = Psbt(p)
for kv in pp.inputs[0]:
    if kv[0] == b'\x01':
        kv[1] = (int.from_bytes(kv[1][:8], 'little') - 10_000_000).to_bytes(8, 'little') + kv[1][8:]
p = pp.b64()
case(A, 'witness-utxo-contradicts-previous-transaction', ['SP-REV-3'],
     'PSBT_IN_WITNESS_UTXO states 0.1 BTC less than the output of the PSBT_IN_NON_WITNESS_UTXO it spends. '
     'The amount cannot be confirmed, so the verdict MUST NOT be allow.',
     p, {'verdictIn': NOT_ALLOW}, ['verdict: SP-REV-3 text'])

ca, cb = coin('ours.w'), coin('ours.w')
pa = build([ca], [(pay(13), 'rest')])
pb = build([cb], [(pay(13), 'rest')])
wrong = [v for k, v in Psbt(pb).inputs[0] if k == b'\x00'][0]
pp = Psbt(pa)
Psbt.put(pp.inputs[0], b'\x00', wrong)
p = pp.b64()
case(A, 'previous-transaction-txid-mismatch', ['SP-REV-3'],
     'PSBT_IN_NON_WITNESS_UTXO holds a different transaction from the one the input spends. Bitcoin Core refuses to decode it.',
     p, {'verdictIn': NOT_ALLOW}, ['verdict: SP-REV-3 text; Core decodepsbt error recorded below'])

p = build([coin('ours.t'), coin('ours.t')], [(pay(14), 'rest')])
p = strip(strip(p, 0, 0x00), 1, 0x00)
case(A, 'all-taproot-witness-utxo-only', ['SP-REV-3'],
     'Two taproot inputs with only PSBT_IN_WITNESS_UTXO. Every signature is BIP-341 without ANYONECANPAY, so it '
     'commits to every input amount (bip-0341.mediawiki line 133) and no previous transaction is needed.',
     p, {'verdict': 'allow'}, ['verdict: SP-REV-3 text, BIP-341 line 133'])

p = build([coin('ours.t'), coin('foreign.w')], [(pay(15), 'rest')], wallets=('ours', 'foreign'))
p = strip(strip(p, 0, 0x00), 1, 0x00)
case(A, 'taproot-signer-foreign-segwit-v0-witness-only', ['SP-REV-3'],
     'The signer owns only the taproot input; the segwit v0 input belongs to someone else and has only a witness UTXO. '
     'The only signature produced is BIP-341, which commits to every amount, so the profile permits allow. '
     'Blocking is stricter than required and also conforms.',
     p, {'verdictIn': ['allow', 'block-until-override']}, ['verdict: SP-REV-3 text'])

p = build([coin('ours.w'), coin('ours.w')], [(pay(16), 'rest')])
p = strip(p, 1, 0x00)
case(A, 'one-of-two-segwit-v0-unverified', ['SP-REV-3'],
     'Two owned segwit v0 inputs; the second has lost its previous transaction. One unconfirmed amount is enough.',
     p, {'verdictIn': NOT_ALLOW}, ['verdict: SP-REV-3 text'])

# ---------------------------------------------------------------- sighash
S = 'review-sighash.json'
SEM = {
    0x00: {'outputs': 'all', 'otherInputsMayBeAdded': False},
    0x01: {'outputs': 'all', 'otherInputsMayBeAdded': False},
    0x02: {'outputs': 'none', 'otherInputsMayBeAdded': False},
    0x03: {'outputs': 'one', 'otherInputsMayBeAdded': False},
    0x81: {'outputs': 'all', 'otherInputsMayBeAdded': True},
    0x82: {'outputs': 'none', 'otherInputsMayBeAdded': True},
    0x83: {'outputs': 'one', 'otherInputsMayBeAdded': True},
    0x04: {'outputs': 'unrecognised'},
}
SRC_SEM = ('sighash meaning: BIP-143 (hashPrevouts, hashOutputs, lines 58-68) for segwit v0 and BIP-341 '
           '(hash_type rules, lines 93-127) for taproot; Core decodepsbt names the type as recorded below')
for value, pool, name in ((0x00, 'ours.t', 'taproot-default'), (0x01, 'ours.w', 'segwit-v0-all'),
                          (0x01, 'ours.t', 'taproot-all'), (0x02, 'ours.w', 'segwit-v0-none'),
                          (0x03, 'ours.w', 'segwit-v0-single'), (0x81, 'ours.w', 'segwit-v0-all-anyonecanpay'),
                          (0x82, 'ours.w', 'segwit-v0-none-anyonecanpay'), (0x83, 'ours.w', 'segwit-v0-single-anyonecanpay'),
                          (0x02, 'ours.t', 'taproot-none'), (0x83, 'ours.t', 'taproot-single-anyonecanpay'),
                          (0x04, 'ours.w', 'segwit-v0-undefined-0x04')):
    p = set_sighash(build([coin(pool)], [(pay(20), 'rest')]), [value])
    ok = value in (0x00, 0x01)
    case(S, f'{name}', ['SP-REV-8', 'SP-REV-23'],
         f'One owned input requesting sighash type 0x{value:02x}.' + ('' if ok else ' Anything other than ALL or DEFAULT MUST block signing.'),
         p, {'verdict': 'allow' if ok else None, 'verdictIn': None if ok else NOT_ALLOW, 'sighash': SEM[value]},
         ['verdict: SP-REV-23 text', SRC_SEM])
p = set_sighash(build([coin('ours.w'), coin('ours.w')], [(pay(21), 'rest')]), [0x01, 0x03])
case(S, 'mixed-all-and-single', ['SP-REV-23'],
     'Two owned inputs, one requesting ALL and one SINGLE. A transaction whose inputs do not all request the same type MUST block.',
     p, {'verdictIn': NOT_ALLOW}, ['verdict: SP-REV-23 text'])
p = set_sighash(build([coin('ours.w'), coin('ours.w')], [(pay(22), 'rest')]), [0x01, 0x01])
case(S, 'two-inputs-both-all', ['SP-REV-23'],
     'Two owned inputs, both explicitly ALL. Agreement is not a blocking condition.',
     p, {'verdict': 'allow', 'sighash': SEM[0x01]}, ['verdict: SP-REV-23 text', SRC_SEM])

# ---------------------------------------------------------------- timelocks
T = 'review-timelocks.json'
SRC_LOCK = ('locktime kind: values below 500000000 are block heights, others are UNIX times '
            '(Bitcoin Core v31.1 src/script/script.h line 47, LOCKTIME_THRESHOLD)')
SRC_RBF = 'replaceable: BIP-125 line 40, explicit signalling if any input has nSequence below 0xfffffffe'
for name, lt, seqs, broadcast in (
        ('no-locktime-signals-rbf', 0, [0xfffffffd], True),
        ('height-locktime', 840000, [0xfffffffd], False),
        ('largest-height', 499999999, [0xfffffffd], False),
        ('smallest-time', 500000000, [0xfffffffd], True),
        ('time-locktime-final-sequence-minus-one', 1767225600, [0xfffffffe], True),
        ('no-locktime-final-sequence', 0, [0xffffffff], True),
        ('one-of-two-inputs-signals', 0, [0xfffffffd, 0xffffffff], True),
        ('second-of-two-inputs-signals', 0, [0xffffffff, 0x00000000], True)):
    coins = [coin('ours.w') for _ in seqs]
    total = sum(Decimal(c['amount']) for c in coins)
    p = build(coins, [(pay(30), total - Decimal('0.0001'))], locktime=lt, sequences=seqs)
    core = core_view(p)
    d = rpc('decodepsbt', p)
    core['tx.locktime'] = d['tx']['locktime']
    core['tx.sequence'] = [i['sequence'] for i in d['tx']['vin']]
    if broadcast:
        core.update(broadcast_view(p))
    kind = 'none' if lt == 0 else ('height' if lt < 500000000 else 'time')
    rbf = any(s < 0xfffffffe for s in seqs)
    if broadcast:
        assert core['bip125-replaceable'] == rbf, (name, core)
    exp = {'verdict': 'allow', 'locktime': {'kind': kind, 'value': lt}, 'replaceable': rbf}
    srcs = [SRC_LOCK, SRC_RBF + ('; Core getmempoolentry bip125-replaceable agrees, recorded below' if broadcast else '')]
    case(T, name, ['SP-REV-9'],
         f'nLockTime {lt}, input sequences {", ".join(hex(s) for s in seqs)}.', p, exp, srcs, core=core)

# ---------------------------------------------------------------- change
C = 'review-change.json'


def add_out(psbt, index, key, value):
    pp = Psbt(psbt)
    Psbt.put(pp.outputs[index], key, value)
    return pp.b64()


def drop_out(psbt, index, keytype):
    pp = Psbt(psbt)
    Psbt.drop(pp.outputs[index], keytype)
    return pp.b64()


p = build([coin('ours.w')], [(pay(40), Decimal('10')), (derive('ours.wpkh.1', 0), 'rest')])
case(C, 'genuine-change-segwit-v0', ['SP-REV-6'],
     'Change to m/84\'/0\'/0\'/1/0, the BIP-84 first change address. It re-derives, so it is change and its path is shown.',
     p, {'verdict': 'allow', 'outputs': kinds(outputs_of(p))}, [SRC_KIND, SRC_ADDR, 'BIP-84 lines 87-90 publish this change address'])

p = build([coin('ours.w')], [(pay(41), Decimal('10')), (derive('ours.tr.1', 0), 'rest')])
case(C, 'genuine-change-taproot', ['SP-REV-6'],
     'Change to m/86\'/0\'/0\'/1/0, the BIP-86 first change address.',
     p, {'verdict': 'allow', 'outputs': kinds(outputs_of(p))}, [SRC_KIND, SRC_ADDR, 'BIP-86 lines 110-116 publish this change address'])

p = build([coin('ours.w')], [(pay(42), Decimal('10')), (derive('ours.wpkh.1', 0), 'rest')])
p = drop_out(p, 1, 0x02)
case(C, 'change-without-derivation-record', ['SP-REV-6'],
     'The same change output with its PSBT_OUT_BIP32_DERIVATION removed. Change is found by re-deriving the script, '
     'so the missing hint changes nothing.',
     p, {'verdict': 'allow', 'outputs': kinds(outputs_of(p))}, [SRC_KIND])

attacker = derive('foreign.wpkh.1', 7)
p = build([coin('ours.w')], [(pay(43), Decimal('10')), (attacker, 'rest')])
p = add_out(p, 1, b'\x02' + bytes.fromhex(PK_84_1_0), path_bytes(FP, "m/84'/0'/0'/1/0"))
outs = outputs_of(p)
case(C, 'attacker-in-change-position-with-derivation-claim', ['SP-REV-6', 'SP-REV-7'],
     'Output 1 pays an address the signer does not own, and carries a PSBT_OUT_BIP32_DERIVATION naming the signer\'s '
     'fingerprint, the path m/84\'/0\'/0\'/1/0 and that path\'s public key. It MUST be shown as a payment, and SHOULD '
     'say the transaction claimed it.',
     p, {'verdict': 'allow', 'outputs': kinds(outs), 'claimedOutputs': {'should': [1]}},
     [SRC_KIND, SRC_ADDR, 'claim: public key from BIP-84 line 89, fingerprint from Core listdescriptors'])

attacker = derive('foreign.tr.1', 7)
p = build([coin('ours.w')], [(pay(44), Decimal('10')), (attacker, 'rest')])
p = add_out(p, 1, b'\x07' + bytes.fromhex(XO_86_1_0), b'\x00' + path_bytes(FP, "m/86'/0'/0'/1/0"))
case(C, 'attacker-in-change-position-with-taproot-derivation-claim', ['SP-REV-6', 'SP-REV-7'],
     'As above with PSBT_OUT_TAP_BIP32_DERIVATION naming the BIP-86 first change key. MUST be a payment; SHOULD be reported as claimed.',
     p, {'verdict': 'allow', 'outputs': kinds(outputs_of(p)), 'claimedOutputs': {'should': [1]}},
     [SRC_KIND, SRC_ADDR, 'claim: x-only key from BIP-86 line 113'])

for idx in (99, 100, 999):
    p = build([coin('ours.w')], [(pay(45), Decimal('10')), (derive('ours.wpkh.1', idx), 'rest')])
    outs = kinds(outputs_of(p))
    outs[1]['kind'] = {'changeIfIndexBelowBound': idx}
    case(C, f'change-at-index-{idx}', ['SP-REV-6'],
         f'Change at m/84\'/0\'/0\'/1/{idx}. It is change if the signer searches that far and a payment if it does not. '
         'The runner compares against the search bound the adapter declares.',
         p, {'verdict': 'allow', 'outputs': outs}, [SRC_KIND])

p = build([coin('ours.w')], [(derive('ours.wpkh.0', 1), Decimal('10')), (derive('ours.wpkh.1', 2), 'rest')])
outs = kinds(outputs_of(p))
case(C, 'payment-to-own-receive-address', ['SP-REV-6', 'SP-REV-14'],
     'Output 0 pays the signer\'s own receive address m/84\'/0\'/0\'/0/1 (BIP-84 lines 82-85). SP-REV-14 says it SHOULD '
     'be shown as a payment rather than change.',
     p, {'verdict': 'allow', 'outputs': [outs[1]], 'shouldOutputs': [outs[0]]}, [SRC_KIND, SRC_ADDR])

# ---------------------------------------------------------------- unknown fields
U = 'review-unknown-fields.json'
p = build([coin('ours.w')], [(pay(50), Decimal('10')), (derive('ours.wpkh.1', 3), 'rest')])
pp = Psbt(p)
extra = [
    ('global', None, bytes.fromhex('a00102'), bytes.fromhex('deadbeef')),
    ('input', 0, bytes.fromhex('a00304'), bytes.fromhex('cafebabe')),
    ('output', 0, bytes.fromhex('a00506'), bytes.fromhex('0badf00d')),
    ('input', 0, b'\xfc\x05nulls\x00\x01', bytes.fromhex('01020304')),
]
for where, i, k, v in extra:
    m = pp.glob if where == 'global' else (pp.inputs[i] if where == 'input' else pp.outputs[i])
    Psbt.put(m, k, v)
p = pp.b64()
d = rpc('decodepsbt', p)
core = core_view(p)
core['unknown'] = {'global': d.get('unknown'), 'input0': d['inputs'][0].get('unknown'),
                   'output0': d['outputs'][0].get('unknown'), 'input0.proprietary': d['inputs'][0].get('proprietary')}
preserved = [{'map': w, 'index': i, 'keyHex': k.hex(), 'valueHex': v.hex()} for w, i, k, v in extra]
case(U, 'unknown-pairs-do-not-block-review', ['SP-REV-11'],
     'Unknown key-value pairs in the global map, an input and an output, plus one proprietary pair. Their presence '
     'MUST NOT block signing, and SHOULD be reported.',
     p, {'verdict': 'allow', 'unknownFieldsReported': {'should': 2}},
     ['verdict: SP-REV-11 text; Core decodepsbt lists the pairs as unknown or proprietary, recorded below'], core=core)
case(U, 'unknown-pairs-survive-signing', ['SP-REV-11'],
     'The same PSBT signed. Every pair MUST be in the signed PSBT with the same key and value (BIP-174 line 417, '
     '"The Signer must only add data to a PSBT").',
     p, {'verdict': 'signed', 'preserved': preserved, 'signatures': {'0': True}},
     ['BIP-174 line 417', 'pairs as written by this generator'], core=core, op='sign')

# ---------------------------------------------------------------- ownership
O = 'review-ownership.json'
p = build([coin('foreign.w')], [(pay(60), 'rest')], wallets=('foreign',))
case(O, 'no-owned-input-review', ['SP-REV-24'],
     'Every input belongs to another wallet (BIP-32 test vector 1). The transaction MUST NOT be signable.',
     p, {'verdict': 'refuse'}, ['verdict: SP-REV-24 text; Core getaddressinfo ismine=false for the input address'])
case(O, 'no-owned-input-sign', ['SP-REV-24'],
     'Asking to sign it anyway MUST fail visibly, not return an unsigned PSBT.',
     p, {'verdict': 'refuse'}, ['verdict: SP-REV-24 text'], op='sign')

p = build([coin('foreign.w')], [(pay(61), 'rest')], wallets=('foreign',))
pp = Psbt(p)
Psbt.put(pp.inputs[0], b'\x06' + bytes.fromhex(PK_84_0_0), path_bytes(FP, "m/84'/0'/0'/0/0"))
p = pp.b64()
case(O, 'foreign-input-with-our-derivation-claim', ['SP-REV-24', 'SP-REV-25'],
     'A foreign segwit v0 input whose PSBT_IN_BIP32_DERIVATION names the signer\'s fingerprint, the path '
     'm/84\'/0\'/0\'/0/0 and its public key (BIP-84 line 79). The script is not the signer\'s, so it MUST NOT sign.',
     p, {'verdict': 'refuse'}, ['verdict: SP-REV-25 text'], op='sign')

p = build([coin('foreign.t')], [(pay(62), 'rest')], wallets=('foreign',))
pp = Psbt(p)
Psbt.put(pp.inputs[0], b'\x16' + bytes.fromhex(XO_86_0_0), b'\x00' + path_bytes(FP, "m/86'/0'/0'/0/0"))
p = pp.b64()
case(O, 'foreign-taproot-input-with-our-derivation-claim', ['SP-REV-24', 'SP-REV-25'],
     'As above for a foreign taproot input carrying PSBT_IN_TAP_BIP32_DERIVATION for the BIP-86 key at m/86\'/0\'/0\'/0/0.',
     p, {'verdict': 'refuse'}, ['verdict: SP-REV-25 text; key from BIP-86 line 97'], op='sign')

p = build([coin('ours.t'), coin('foreign.w')], [(pay(63), 'rest')], wallets=('ours', 'foreign'))
pp = Psbt(p)
Psbt.put(pp.inputs[1], b'\x06' + bytes.fromhex(PK_84_0_0), path_bytes(FP, "m/84'/0'/0'/0/0"))
p = pp.b64()
case(O, 'sign-only-the-owned-input', ['SP-REV-25'],
     'Input 0 is the signer\'s taproot input. Input 1 is foreign and carries a derivation record naming the signer. '
     'Only input 0 may receive a signature.',
     p, {'verdict': 'signed', 'signatures': {'0': True, '1': False}}, ['verdict: SP-REV-25 text'], op='sign')

for name, cases in files.items():
    doc = json.load(open(f'{OUT}/{name}'))
    doc['bitcoinCore'] = CORE
    doc['contexts'] = CONTEXT
    for c in cases:
        c['expected'] = {k: v for k, v in c['expected'].items() if v is not None}
    doc['cases'] = cases
    json.dump(doc, open(f'{OUT}/{name}', 'w'), indent=2)
    open(f'{OUT}/{name}', 'a').write('\n')
    print(name, len(cases))
