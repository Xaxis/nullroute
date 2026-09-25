"""Write the header of each vector file. Generators fill in `cases`."""
import json, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

COMMON = {
    'format': 'signer-profile-vectors',
    'version': 1,
    'profile': 'spec/signer-profile.md, draft specification version 0.1',
}

HEADERS = {
    'dice-to-entropy.json': (
        ['SP-ENT-1', 'SP-ENT-2', 'SP-ENT-3', 'SP-ENT-4', 'SP-ENT-7', 'SP-ENT-10', 'SP-HW-9'],
        'diceToSeed',
        'Dice rolls to BIP-39 entropy, 24-word mnemonic and seed. Each accepted case gives the SHA-256 of '
        'the ASCII roll string (no separator, no trailing newline), the mnemonic for that entropy, and the '
        'BIP-39 seed with an empty passphrase. Each refused case is input the signer MUST refuse rather '
        'than normalise. Running an accepted case twice MUST give the same result (SP-HW-9: no randomness).'),
    'dice-accounting.json': (
        ['SP-ENT-5'],
        'diceBitsShown',
        'The entropy count a signer displays after n rolls MUST NOT exceed floor(n * log2(6)). The '
        'expected ceiling is computed in exact integer arithmetic as the largest k with 2^k <= 6^n, so '
        'floating point cannot round it up. Cases include the counts where n * log2(6) lies closest '
        'below an integer, where a floating-point floor is most likely to overstate.'),
    'review-fee-and-amounts.json': (
        ['SP-REV-2', 'SP-REV-4', 'SP-REV-13'],
        'review',
        'Input amounts come from the UTXO records, the fee is inputs minus outputs in integer satoshis, a '
        'missing amount or outputs above inputs are refused, and a high fee warns without blocking.'),
    'review-input-amounts.json': (
        ['SP-REV-3'],
        'review',
        'Whether each input amount is confirmed. A segwit v0 amount is confirmed only by a '
        'PSBT_IN_NON_WITNESS_UTXO whose TXID matches the prevout; where every signature produced is '
        'BIP-341 without ANYONECANPAY, a witness UTXO is enough.'),
    'review-change.json': (
        ['SP-REV-6', 'SP-REV-7', 'SP-REV-14'],
        'review',
        'Change is established only by re-deriving the output script from the signer\'s own seed. '
        'Derivation records in the PSBT, output position and amount contribute nothing.'),
    'review-sighash.json': (
        ['SP-REV-8', 'SP-REV-23'],
        'review',
        'Only SIGHASH_ALL, and SIGHASH_DEFAULT on taproot, may be signed without an override. The review '
        'describes each type by what the signature does not commit to.'),
    'review-timelocks.json': (
        ['SP-REV-9'],
        'review',
        'nLockTime shown as a block height or a time, and BIP-125 replaceability shown as the BIP defines it.'),
    'review-unknown-fields.json': (
        ['SP-REV-11'],
        'review, sign',
        'Key-value pairs the signer does not model do not block signing and survive it byte for byte.'),
    'review-ownership.json': (
        ['SP-REV-24', 'SP-REV-25'],
        'review, sign',
        'A transaction with no input the signer owns is not signable, and signing keys are found from each '
        'input\'s own script, never from a derivation path the PSBT supplies.'),
    'manifest-root.json': (
        ['SP-ATT-2'],
        'buildManifest',
        'The manifest is `sha256sum` output over the tracked files, one line per file, ordered by path '
        'compared byte by byte (`LC_ALL=C`), and the root is SHA-256 of the manifest bytes. The tree '
        'includes paths that a locale-aware collation orders differently.'),
    'bbqr-psbt.json': (
        ['SP-TX-2', 'SP-TX-3', 'SP-TX-4', 'SP-TX-5', 'SP-TX-6'],
        'bbqrJoin, bbqrEncodePsbt',
        'Reading BBQr sequences produced by Coinkite\'s reference implementation and by a Coldcard, refusing '
        'frames from mixed transfers, and writing a PSBT as binary type P in encoding 2 or H, in QR '
        'alphanumeric mode.'),
    'ur-psbt.json': (
        ['SP-TX-7'],
        'urJoin',
        'Reading PSBTs written as UR by SeedSigner\'s own encoder: in order, from mixed parts alone, under '
        'either registered type name, and refusing frames from two transfers or a message whose checksum '
        'fails. Only for a signer that implements UR, which SP-TX-7 makes optional.'),
}

for name, (reqs, op, desc) in HEADERS.items():
    doc = dict(COMMON)
    doc['file'] = name
    doc['requirements'] = reqs
    doc['operations'] = op
    doc['description'] = desc
    doc['cases'] = []
    with open(os.path.join(OUT, name), 'w') as f:
        json.dump(doc, f, indent=2)
        f.write('\n')
print(len(HEADERS), 'headers written')
