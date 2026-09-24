"""Create two descriptor wallets on regtest and fund them with coinbase outputs."""
import json
from lib import rpc, reversion, mainnet_address

TPRV = '04358394'
# BIP-84 test vector rootpriv (bip-0084.mediawiki line 70) and BIP-86 rootpriv
# (bip-0086.mediawiki line 87): the same key, mnemonic "abandon x11 about".
ours_a = reversion('zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5', TPRV)
ours_b = reversion('xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu', TPRV)
assert ours_a == ours_b, 'BIP-84 and BIP-86 roots disagree'
# BIP-32 test vector 1, chain m (bip-0032.mediawiki), seed 000102..0f.
foreign = reversion('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi', TPRV)


def desc(d):
    return d + '#' + rpc('getdescriptorinfo', d)['checksum']


def wallet(name, root):
    rpc('createwallet', name, False, True, '', False, True)
    reqs = []
    for purpose, fn in (('84', 'wpkh'), ('86', 'tr')):
        for branch, internal in (('0', False), ('1', True)):
            reqs.append({'desc': desc(f'{fn}({root}/{purpose}h/0h/0h/{branch}/*)'), 'active': True,
                         'internal': internal, 'range': [0, 1000], 'timestamp': 'now'})
    res = rpc('importdescriptors', reqs, wallet=name)
    assert all(r['success'] for r in res), res


wallet('ours', ours_a)
wallet('foreign', foreign)

pub = {}
for w in ('ours', 'foreign'):
    for fn, root_purpose in (('wpkh', '84'), ('tr', '86')):
        for branch in ('0', '1'):
            d = rpc('listdescriptors', wallet=w)['descriptors']
            match = [x['desc'] for x in d if x['desc'].startswith(fn + '(') and f'/{root_purpose}h/0h/0h]' in x['desc'] and x['desc'].split('#')[0].endswith(f'/{branch}/*)')]
            assert len(match) == 1, (w, fn, branch, d)
            pub[f'{w}.{fn}.{branch}'] = match[0]

# Cross-check Core's derivation from the converted key against the addresses
# the BIPs publish.
def addr(key, i):
    return rpc('deriveaddresses', pub[key], [i, i])[0]

assert mainnet_address(addr('ours.wpkh.0', 0)) == 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
assert mainnet_address(addr('ours.wpkh.0', 1)) == 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'
assert mainnet_address(addr('ours.wpkh.1', 0)) == 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el'
assert mainnet_address(addr('ours.tr.0', 0)) == 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'
assert mainnet_address(addr('ours.tr.0', 1)) == 'bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh'
assert mainnet_address(addr('ours.tr.1', 0)) == 'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7'
print('Core derivation matches BIP-84 and BIP-86 published addresses')

rpc('generatetoaddress', 70, addr('ours.wpkh.0', 0))
rpc('generatetoaddress', 16, addr('ours.tr.0', 0))
rpc('generatetoaddress', 6, addr('foreign.wpkh.0', 0))
rpc('generatetoaddress', 4, addr('foreign.tr.0', 0))
rpc('generatetoaddress', 101, addr('foreign.wpkh.0', 5))
json.dump(pub, open('pub.json', 'w'), indent=1)
print(rpc('getbalances', wallet='ours'))
