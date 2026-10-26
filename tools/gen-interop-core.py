"""Record what Bitcoin Core 31.1 exports for the wallets nullroute claims to read.

Run by tools/gen-interop-core.sh, which starts and stops the node. Python
stdlib only. Nothing here imports or runs nullroute.

  gen-interop-core.py <repository root>        write the Core fixtures
  gen-interop-core.py --pin <repository root>  re-pin spec/interop/SHA256SUMS

Writes into spec/interop/bitcoin-core-31.1/, each file a Core RPC result
written as Core returned it:

  listdescriptors-bip84-bip86.json  `listdescriptors` for a wallet holding the
      BIP-84 and BIP-86 test key, receive and change for each.
  listdescriptors-2of3.json  `listdescriptors` for a 2-of-3 wsh(sortedmulti)
      quorum held by one cosigner, with the other two keys public.
  importdescriptors-2of3.json  the `descriptors` array of the file above, which
      is the shape `importdescriptors` takes. Re-imported here into a fresh
      watch-only wallet, so the file is one Core accepts and not a guess.
  getdescriptorinfo.json  `getdescriptorinfo` for every descriptor above and
      for the BIP-389 multipath form of each pair.
  deriveaddresses.json  `deriveaddresses` for the same, indices 0 to 2.
  deriveaddresses-sparrow.json  `deriveaddresses` for the descriptors in the
      Sparrow fixtures, read by the small readers below.
"""
import base64, hashlib, json, os, re, sys, urllib.error, urllib.request
from decimal import Decimal

RPC = 'http://127.0.0.1:' + os.environ.get('RPCPORT', '39443')
AUTH = base64.b64encode(b'u:p').decode()
CORE_VERSION = 310100


def rpc(method, *params, wallet=None):
    url = RPC + ('' if wallet is None else '/wallet/' + wallet)
    body = json.dumps({'jsonrpc': '1.0', 'id': 1, 'method': method, 'params': list(params)}).encode()
    req = urllib.request.Request(url, body, {'Authorization': 'Basic ' + AUTH, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            out = json.loads(r.read(), parse_float=Decimal)
    except urllib.error.HTTPError as e:
        out = json.loads(e.read(), parse_float=Decimal)
    if out.get('error'):
        raise RuntimeError(f"{method}: {out['error']}")
    return out['result']


# --- base58check, for re-versioning published keys to the regtest prefix ----
B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def b58decode_check(s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    raw = n.to_bytes((n.bit_length() + 7) // 8, 'big')
    raw = b'\0' * (len(s) - len(s.lstrip('1'))) + raw
    payload, check = raw[:-4], raw[-4:]
    assert hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4] == check, s
    return payload


def b58encode_check(payload):
    raw = payload + hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    n = int.from_bytes(raw, 'big')
    out = ''
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return '1' * (len(raw) - len(raw.lstrip(b'\0'))) + out


def reversion(ext, version_hex):
    return b58encode_check(bytes.fromhex(version_hex) + b58decode_check(ext)[4:])


TPRV = '04358394'
TPUB = '043587cf'
# The BIP-84 test vector rootpriv, which is also BIP-86's: mnemonic
# "abandon" x11 "about", the key every conformance context uses.
ABANDON = reversion('zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5', TPRV)
# BIP-32 test vectors 1 and 2, chain m: the other two cosigners.
TV1 = reversion('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi', TPRV)
TV2 = reversion('xprv9s21ZrQH143K31xYSDQpPDxsXRTUcvj2iNHm5NUtrGiGG5e2DtALGdso3pGz6ssrdK4PFmM8NSpSBHNqPqm55Qn3LqFtT2emdEXVYsCzC2U', TPRV)

# Fixed rather than "now", so the timestamps Core records, and therefore the
# files, do not depend on when this ran. Core stores 0 as 1.
TIMESTAMP = 0


def checksummed(desc):
    body = desc.split('#')[0]
    return body + '#' + rpc('getdescriptorinfo', body)['checksum']


def multipath(receive):
    """The BIP-389 form of a receive descriptor, as Core itself accepts it."""
    body = receive.split('#')[0]
    assert body.count('/0/*') >= 1, body
    return body.replace('/0/*', '/<0;1>/*')


def write(out, name, value):
    with open(os.path.join(out, name), 'w') as f:
        json.dump(value, f, indent=2, default=str)
        f.write('\n')


def same_program(mainnet, regtest):
    """Whether a bc1 and a bcrt1 address carry the same witness program.

    The data part of a bech32 or bech32m string encodes the version and the
    program independently of the human-readable part; only the six checksum
    characters at the end depend on it. So the published mainnet address and
    Core's regtest one agree on everything between the separator and the
    checksum exactly when they pay the same script. No bech32 code needed.
    """
    return mainnet.startswith('bc1') and regtest.startswith('bcrt1') and mainnet[3:-6] == regtest[5:-6]


# --- readers for the Sparrow fixtures, independent of nullroute's -----------
def read_coldcard(text):
    """Coldcard's multisig setup file, per its documented format.

    A Derivation line applies to the cosigner lines that follow it, which is how
    Coldcard and Electrum write a quorum whose cosigners use different paths.
    """
    header, keys, derivation = {}, [], None
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#') or ':' not in line:
            continue
        key, value = (part.strip() for part in line.split(':', 1))
        if re.fullmatch(r'[0-9A-Fa-f]{8}', key):
            assert derivation is not None, 'cosigner before any Derivation line'
            keys.append(f"[{key.lower()}{derivation[1:]}]{value}")
        else:
            header[key.lower()] = value
            if key.lower() == 'derivation':
                derivation = value
    m, n = (int(x) for x in re.fullmatch(r'(\d+) of (\d+)', header['policy']).groups())
    assert n == len(keys), 'policy disagrees with cosigner count'
    wrap = {'P2WSH': 'wsh({})', 'P2SH-P2WSH': 'sh(wsh({}))', 'P2WSH-P2SH': 'sh(wsh({}))', 'P2SH': 'sh({})'}[header['format']]
    return [wrap.format(f"sortedmulti({m},{','.join(k + '/' + str(branch) + '/*' for k in keys)})") for branch in (0, 1)]


def read_json(text):
    return [json.loads(text)['descriptor']]


def read_lines(text):
    return [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith('#')]


def read_bsms(text):
    """BIP-129 round two: version, template, path restrictions, first address."""
    lines = [line.strip() for line in text.splitlines()]
    assert lines[0] == 'BSMS 1.0'
    template, restrictions = lines[1], lines[2]
    if '/**' not in template:
        return [template]
    return [template.replace('/**', path) for path in restrictions.split(',')]


SPARROW = [
    ('cc-multisig-export-1.txt', read_coldcard),
    ('cc-multisig-export-2.txt', read_coldcard),
    ('cc-multisig-export-multideriv.txt', read_coldcard),
    ('specter-wallet.json', read_json),
    ('specter-multisig-wallet.json', read_json),
    ('descriptor-receive.txt', read_lines),
    ('descriptor-receive-change1.txt', read_lines),
    ('descriptor-receive-change2.txt', read_lines),
    ('descriptor-multipath.txt', read_lines),
    ('jade-keystore.txt', read_lines),
    ('keystone-singlesig-keystore-1.txt', read_lines),
] + [(f'bsms/multisig-{n}.bsms', read_bsms) for n in (1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14)] + [
    ('bsms/multisig-address-mismatch.bsms', read_bsms),
]

EXTENDED = re.compile(r'\b(xpub|ypub|zpub|Ypub|Zpub|tpub|upub|vpub|Upub|Vpub)[1-9A-HJ-NP-Za-km-z]{100,112}')


def for_regtest(desc):
    """The same descriptor with every extended key re-versioned to tpub.

    Core on regtest accepts only the tpub prefix. The version bytes carry no key
    material, so the derived scripts are unchanged and only the address encoding
    is regtest's.
    """
    return EXTENDED.sub(lambda m: reversion(m.group(0), TPUB), desc.split('#')[0])


def derive(desc, count):
    info = rpc('getdescriptorinfo', desc.split('#')[0])
    full = checksummed(desc)
    result = rpc('deriveaddresses', full, [0, count - 1]) if info['isrange'] else rpc('deriveaddresses', full)
    return full, ([0, count - 1] if info['isrange'] else None), result


def generate(root):
    out = os.path.join(root, 'spec/interop/bitcoin-core-31.1')
    sparrow = os.path.join(root, 'spec/interop/sparrow')
    os.makedirs(out, exist_ok=True)

    network = rpc('getnetworkinfo')
    assert network['version'] == CORE_VERSION, f"this directory is for Core 31.1.0, not {network['subversion']}"

    # One wallet for the BIP-84 and BIP-86 test key, receive and change.
    rpc('createwallet', 'bip84-bip86', False, True, '', False, True)
    requests = []
    for purpose, fn in (('84', 'wpkh'), ('86', 'tr')):
        for branch, internal in (('0', False), ('1', True)):
            requests.append({'desc': checksummed(f'{fn}({ABANDON}/{purpose}h/0h/0h/{branch}/*)'), 'active': True,
                             'internal': internal, 'range': [0, 999], 'timestamp': TIMESTAMP})
    assert all(r['success'] for r in rpc('importdescriptors', requests, wallet='bip84-bip86'))
    single = rpc('listdescriptors', wallet='bip84-bip86')
    assert len(single['descriptors']) == 4
    write(out, 'listdescriptors-bip84-bip86.json', single)

    # Cosigners B and C, each its own Core wallet, export their account keys at
    # m/48h/0h/0h/2h. listdescriptors writes the public form with the origin, so
    # Core computes each fingerprint and account key rather than this script.
    # (getdescriptorinfo does not: it keeps the root key and the hardened path.)
    def account(name, root_key):
        rpc('createwallet', name, False, True, '', False, True)
        request = {'desc': checksummed(f'pkh({root_key}/48h/0h/0h/2h/*)'), 'range': [0, 0], 'timestamp': TIMESTAMP}
        assert all(r['success'] for r in rpc('importdescriptors', [request], wallet=name))
        public = rpc('listdescriptors', wallet=name)['descriptors'][0]['desc']
        return re.fullmatch(r'pkh\((\[[0-9a-f]{8}/48h/0h/0h/2h\]tpub[1-9A-HJ-NP-Za-km-z]+)/\*\)#[a-z0-9]{8}', public).group(1)

    b, c = account('cosigner-b', TV1), account('cosigner-c', TV2)
    # Cosigner A runs Core and holds its own private key; B and C are public.
    rpc('createwallet', '2of3', False, True, '', False, True)
    requests = []
    for branch, internal in (('0', False), ('1', True)):
        desc = f'wsh(sortedmulti(2,{ABANDON}/48h/0h/0h/2h/{branch}/*,{b}/{branch}/*,{c}/{branch}/*))'
        requests.append({'desc': checksummed(desc), 'active': True, 'internal': internal,
                         'range': [0, 999], 'timestamp': TIMESTAMP})
    assert all(r['success'] for r in rpc('importdescriptors', requests, wallet='2of3'))
    quorum = rpc('listdescriptors', wallet='2of3')
    assert len(quorum['descriptors']) == 2
    write(out, 'listdescriptors-2of3.json', quorum)

    # The array importdescriptors takes, proved by having Core take it.
    write(out, 'importdescriptors-2of3.json', quorum['descriptors'])
    rpc('createwallet', 'reimport', True, True, '', False, True)
    assert all(r['success'] for r in rpc('importdescriptors', quorum['descriptors'], wallet='reimport'))
    assert rpc('listdescriptors', wallet='reimport')['descriptors'] == quorum['descriptors']

    exported = [d['desc'] for d in single['descriptors'] + quorum['descriptors']]
    receives = [d['desc'] for d in single['descriptors'] + quorum['descriptors'] if not d['internal']]
    inputs = exported + [multipath(d) for d in receives]

    infos, derived = [], []
    for desc in inputs:
        infos.append({'input': desc, 'result': rpc('getdescriptorinfo', desc.split('#')[0])})
        full, span, result = derive(desc, 3)
        derived.append({'descriptor': full, 'range': span, 'result': result})
    write(out, 'getdescriptorinfo.json', infos)
    write(out, 'deriveaddresses.json', derived)

    # The converted key is the BIP key: Core's regtest addresses carry the
    # witness programs the BIPs publish for mainnet.
    with open(os.path.join(root, 'spec/vectors/bip84-86-addresses.json')) as f:
        published = json.load(f)
    by_desc = {d['descriptor'].split('#')[0]: d['result'] for d in derived}
    for bip, fn, purpose in (('bip84', 'wpkh', '84'), ('bip86', 'tr', '86')):
        for branch, key in (('0', 'receive'), ('1', 'change')):
            body = next(d.split('#')[0] for d in exported if d.startswith(f'{fn}(') and f'/{purpose}h/0h/0h]' in d and d.split('#')[0].endswith(f'/{branch}/*)'))
            for entry in published[bip][key]:
                assert same_program(entry['address'], by_desc[body][entry['index']]), (bip, key, entry)
    print('Core derivation of the converted key matches the BIP-84 and BIP-86 published addresses')

    cross = []
    for name, reader in SPARROW:
        with open(os.path.join(sparrow, name)) as f:
            text = f.read()
        for desc in reader(text):
            full, span, result = derive(for_regtest(desc), 2)
            cross.append({'fixture': f'sparrow/{name}', 'read_as': desc, 'descriptor': full, 'range': span, 'result': result})
    write(out, 'deriveaddresses-sparrow.json', cross)
    print(f"wrote {len(os.listdir(out))} files to {out} with {network['subversion']}")


def pin(root):
    """Re-pin spec/interop/SHA256SUMS in the spec that declares it."""
    spec = os.path.join(root, 'packages/core/src/descriptor/coordinator.spec.yaml')
    with open(os.path.join(root, 'spec/interop/SHA256SUMS'), 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    lines = open(spec).read().split('\n')
    i = lines.index('    file: spec/interop/SHA256SUMS')
    assert re.fullmatch(r'    sha256: [0-9a-f]{64}', lines[i + 1]), 'no sha256 line after the SHA256SUMS pin'
    lines[i + 1] = f'    sha256: {digest}'
    open(spec, 'w').write('\n'.join(lines))
    print(f'spec/interop/SHA256SUMS pinned at {digest}')


if __name__ == '__main__':
    if sys.argv[1] == '--pin':
        pin(sys.argv[2])
    else:
        generate(sys.argv[1])
