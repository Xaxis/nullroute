# Signer profile conformance

Test vectors and a reference runner for [`spec/signer-profile.md`](../spec/signer-profile.md),
a draft specification for air-gapped Bitcoin signers. The profile is at version
0.1. Nobody has adopted it, including the project that wrote it. It is here to
be reviewed and argued with.

The vectors are language-neutral JSON. The runner is one Node file with no
dependencies. You check a signer by writing a small adapter module that calls
your signer and reports what it did, then running the runner against it.

nullroute is one implementation of the profile. Its adapter is in
[`adapters/nullroute.mjs`](adapters/nullroute.mjs). It passes every case today
and has failed some on the way (see [nullroute's results](#nullroutes-results));
a pass says nothing about the requirements no vector checks.

## Layout

| Path | What it is |
| --- | --- |
| `spec/vectors/signer-profile/*.json` | The vector files. One per group of requirements. |
| `spec/vectors/signer-profile/SHA256SUMS` | SHA-256 of every vector file, in `sha256sum` format. |
| `conformance/run.mjs` | The runner. Node built-ins only. |
| `conformance/adapters/nullroute.mjs` | The adapter for nullroute's built packages. |
| `conformance/adapters/seedsigner.mjs` | An adapter for SeedSigner, which runs SeedSigner's own code at a pinned commit (see [Other signers](#other-signers)). |
| `conformance/known-failures/nullroute.json` | The cases nullroute fails today, each with a reason. |
| `conformance/known-failures/seedsigner.json` | The cases SeedSigner fails, each with the line of SeedSigner's code that decides it. |
| `conformance/results/seedsigner.json` | SeedSigner's last run, the report the website reads. |
| `conformance/fixtures/qr-mode.json` | QR symbols from an unrelated encoder, which the runner reads at start to check its own QR mode reader. |
| `conformance/generate/` | The scripts that produced the vectors, kept as a record of where each expected value came from. |

## Running it

1. Check the vector files have not changed since they were pinned. This needs
   no part of this repository's tooling:
   ```console
   $ cd spec/vectors/signer-profile
   $ sha256sum -c SHA256SUMS
   ```
   On macOS use `shasum -a 256 -c SHA256SUMS`.
2. Run the vectors against your adapter:
   ```console
   $ node conformance/run.mjs path/to/your-adapter.mjs
   ```
   The runner makes the same check as step 1 before it runs anything, and
   refuses to continue if a file does not match.

Options:

| Option | Effect |
| --- | --- |
| `--vectors <dir>` | Read vectors from another directory. It needs its own `SHA256SUMS`. |
| `--only <file.json>` | Run one vector file. |
| `--known-failures <file>` | Treat listed failures as known (see [Known failures](#known-failures)). |
| `--verbose` | Print every case, not only those that did not pass. |

For nullroute, `make conformance` builds the packages and runs its adapter with
its known failures list. It takes a few seconds and needs no network and no
Bitcoin node.

## Writing an adapter

An adapter is an ES module. The runner imports it and calls the functions
below. Every function may return a value or a promise. Leave out a function
your signer does not implement: the cases that need it are reported as not
run, and a run with anything not run does not pass.

The adapter reports and never judges. Return what your signer did, even when it
looks wrong. The runner makes every comparison, and where it has to look inside
your signer's output (a signed PSBT, a BBQr frame, a QR symbol) it parses that
output itself.

Adapter functions must not throw for input the signer rejects. A rejection is a
`refuse` verdict. A thrown error is reported as a failure of the case.

### Exports

| Export | Arguments | Returns |
| --- | --- | --- |
| `name` | | A string naming the implementation and version. Optional. |
| `ecdsaNonces` | | `'rfc6979'` or `'rfc6979-low-r'`: which of the two ECDSA nonce schemes SP-SIG-1 allows the signer uses. Required for the ECDSA cases in `sign-deterministic.json`. |
| `changeSearchBound` | | A number: how many addresses on each change branch the signer re-derives when it looks for change. Used by the `change-at-index-*` cases. The profile requires the bound to be documented (SP-REV-6). |
| `diceToSeed(rolls)` | `rolls`: the string exactly as a user typed it | `{ verdict: 'accept', entropyHex, mnemonic, seedHex }` or `{ verdict: 'refuse' }`. `seedHex` is the BIP-39 seed with an empty passphrase. |
| `diceBitsShown(count)` | `count`: a number of valid rolls | The integer number of bits the signer displays after that many rolls. |
| `reviewPsbt(psbt, context)` | `psbt`: base64 PSBT; `context`: see below | A review result, see below. |
| `signPsbt(psbt, context, options)` | as above; `options.override` is `true` only in `sign-override.json`, where it is the explicit single-use override SP-REV-22 describes | `{ verdict: 'signed', psbtBase64 }` or `{ verdict: 'refuse' }`. A taproot key-path signature is read from `PSBT_IN_TAP_KEY_SIG`, or from a one-element `PSBT_IN_FINAL_SCRIPTWITNESS` when the signer finalized the input. |
| `buildManifest(files)` | `files`: `[{ path, bytes }]`, `bytes` a `Uint8Array`, in no particular order | `{ manifest, root }`: the manifest text exactly, and its root as lowercase hex. |
| `urJoin(frames)` | `frames`: scanned UR strings, in scan order | `{ verdict: 'complete', type, data }` with `type` the UR type (`crypto-psbt` or `psbt`) and `data` the binary PSBT, or `{ verdict: 'refuse' }`, or `{ verdict: 'incomplete' }`. Optional: only for a signer that implements UR (SP-TX-7). |
| `bbqrJoin(frames)` | `frames`: the scanned strings, in scan order | `{ verdict: 'complete', fileType, data }` with `fileType` the BBQr letter and `data` a `Uint8Array`, or `{ verdict: 'refuse' }`, or `{ verdict: 'incomplete' }`. |
| `bbqrEncodePsbt(psbt)` | `psbt`: base64 PSBT | `{ frames: [{ text, modules }] }`: every frame the signer would display, in order. `modules` is the QR symbol as an array of strings of `1` (dark) and `0`, one per row, without the quiet zone. |

The `context` for review and signing names the wallet the signer holds:

```json
{ "mnemonic": "abandon ... about", "passphrase": "", "network": "mainnet", "masterFingerprint": "73c5da0a" }
```

It is the BIP-84 and BIP-86 test mnemonic. The funds in these PSBTs exist only
on a regtest chain that no longer exists, and the keys are public.

### Review results

`reviewPsbt` returns an object. `verdict` is required. Report every other field
your signer shows; a case fails if it checks a field you left out.

| Field | Meaning |
| --- | --- |
| `verdict` | `allow`: the user can sign. `block-until-override`: signing is disabled until an explicit single-use override. `refuse`: the transaction cannot be signed at all, including with an override. |
| `feeSats` | The fee shown, in satoshis, as a decimal string. |
| `outputs` | `[{ index, address, script, amountSats, kind, changePath }]`. `kind` is `payment` or `change`. `address` is the full address or `null`. `script` is the scriptPubKey as lowercase hex, reported where the screen shows the script because the output has no address. `changePath` is the path shown beside change, such as `m/84'/0'/0'/1/0`. |
| `claimedOutputs` | Indices of outputs the review says the transaction claimed were the wallet's, and which did not re-derive. |
| `sighash` | `{ outputs, otherInputsMayBeAdded }`. `outputs` is `all`, `none`, `one` or `unrecognised`: which outputs the signature commits to, as the review describes it. |
| `locktime` | `{ kind, value }`. `kind` is `none` (nLockTime is 0), `height` or `time` as the review presents it, or `not-enforced` when nLockTime is set and every input's nSequence is 0xffffffff, so consensus ignores it. |
| `replaceable` | Whether the review says the transaction signals BIP-125 replaceability. |
| `unknownFieldsReported` | How many key-value pairs the review says it does not model. |
| `warnings` | Warning codes shown. The only code the vectors look for is `high-fee`. |

Where a case accepts more than one verdict, the vector lists them in
`verdictIn`. For example, a sighash other than ALL must be a blocking condition,
and SP-REV-22 lets a signer refuse outright instead of offering an override, so
both `block-until-override` and `refuse` pass.

Where a case lets a signer refuse instead of reviewing, the fields a review
would show sit under `ifAllowed` and are checked only when the verdict is
`allow`. A false change claim (SP-REV-7) is the case: showing the output as a
payment passes, and so does refusing the transaction.

## The vector files

Each file has the same header:

| Field | Meaning |
| --- | --- |
| `format`, `version` | `signer-profile-vectors`, `1`. |
| `profile` | The profile version the file was written against. |
| `requirements` | The requirement ids the file covers. |
| `operations` | The adapter functions it calls. |
| `description` | What the file checks, in a sentence or two. |
| `contexts` | Wallets referred to by cases, where needed. |
| `cases` | The cases. |

Each case has an `id`, an `operation`, the `requirements` it checks, a `level`,
a `description`, an `input` and an `expected` value, and `sources`, which says
where each expected value came from. Review cases also carry `bitcoinCore`: what
Bitcoin Core said about the same PSBT (its computed fee, its sighash names, the
error it gave, its mempool's replaceability verdict), recorded for a reader to
compare, not used by the runner.

Amounts are decimal strings of satoshis. PSBTs are base64. Keys, values and
digests are lowercase hex. Text is UTF-8.

### Where the expected values come from

No expected value was produced by running nullroute. Each comes from a source
that shares no code with it.

| File | Cases | Requirements | Source of the expected values |
| --- | --- | --- | --- |
| `dice-to-entropy.json` | 17 | SP-ENT-1 to 4, 7, 10, SP-HW-9 | Digest from `printf '%s' ROLLS \| shasum -a 256` and `sha256sum`. Mnemonic from the BIP-39 algorithm and the English list in `bitcoin/bips`, written for the generator and checked against the 24 Trezor vectors first. Seed from PBKDF2-HMAC-SHA512 as BIP-39 defines it. Refusals from the requirement text. |
| `dice-accounting.json` | 25 | SP-ENT-5 | The largest `k` with `2^k <= 6^n`, by exact integer comparison. |
| `review-malformed.json` | 26 | SP-REV-1 | BIP-174's 20 invalid PSBTs, copied from the BIP and matching the extraction in `spec/vectors/bip174-psbt.json` byte for byte. Empty input, the signer's own descriptor from Core's `listdescriptors`, and a Core PSBT cut in half and by its final byte. BIP-174's two rules on the unsigned transaction (line 102) repeated on a Core PSBT of the signer's own coin. Core's `decodepsbt` refuses all 26; its errors are recorded. |
| `review-outputs.json` | 10 | SP-REV-5 | Core PSBTs paying a taproot and a P2WSH address (62 characters), a P2PKH and a P2SH address (Base58Check with mainnet version bytes), and BIP-350's own valid version 2 and version 16 addresses, checked against the BIP text. OP_RETURN outputs from Core's `createpsbt` with a direct push and with `OP_PUSHDATA1`, one rewritten to carry 0.05 BTC, and an output rewritten to a bare public key. Scripts from `decodepsbt`. Change is left to `review-change.json`. |
| `review-fee-and-amounts.json` | 7 | SP-REV-2, 4, 13 | PSBTs built by Bitcoin Core 31.1 on regtest. Fee from `decodepsbt`. Change from the path `getaddressinfo` reports. Addresses from the scriptPubKey with the BIP-173/350 reference encoder. A negative fee rejected by `testmempoolaccept`. |
| `review-input-amounts.json` | 7 | SP-REV-3 | Core PSBTs with UTXO records removed or altered. Verdicts from the requirement text, BIP-174 and BIP-341. Core's `decodepsbt` error for the mismatched TXID is recorded. |
| `review-change.json` | 9 | SP-REV-6, 7, 14 | Core PSBTs. Change and path from `getaddressinfo`. The wallet key is the published BIP-84 and BIP-86 test key; the generator stops unless Core derives the addresses those BIPs print. Derivation claims use the public keys those BIPs print. |
| `review-sighash.json` | 13 | SP-REV-8, 23 | Core PSBTs with `PSBT_IN_SIGHASH_TYPE` set. Meaning from BIP-143 and BIP-341; Core's names recorded. |
| `review-timelocks.json` | 9 | SP-REV-9 | Core PSBTs. Height or time from `LOCKTIME_THRESHOLD` in Bitcoin Core's source. Not enforced from `IsFinalTx` in Core's source, and from Core accepting that transaction into its mempool far below its locktime. Replaceability from BIP-125, and from Core's own mempool (`getmempoolentry`) for every case it could broadcast. |
| `review-unknown-fields.json` | 2 | SP-REV-11 | A Core PSBT with pairs added. Core's `decodepsbt` lists them as unknown or proprietary. Preservation from BIP-174. |
| `sign-deterministic.json` | 6 | SP-SIG-1 | PSBTs built by Bitcoin Core 31.1. Private keys by BIP-32 from the BIP-84/86 test root, checked against the keys Core wrote into each PSBT. Sighashes from Core's own Python test framework (`test/functional/test_framework/script.py` at `v31.1`); plain RFC 6979 and BIP-340 signatures from its `key.py`, with `aux_rand` of 32 zero bytes. Low-R signatures from Core's wallet (`walletprocesspsbt`), which also wrote the plain bytes wherever the first R was low and every Schnorr signature exactly. Every signed transaction accepted by Core's `testmempoolaccept`. |
| `sign-override.json` | 3 | SP-REV-22 | Core PSBTs blocked by SIGHASH_NONE, by an unconfirmed segwit v0 amount, and by owning no input. Each is signed without an override, with one, and without one again; the expected verdicts are the requirement text. |
| `review-ownership.json` | 5 | SP-REV-24, 25 | Core PSBTs from a second wallet (the BIP-32 test vector 1 key), with derivation records naming the signer's fingerprint. Verdicts from the requirement text. |
| `manifest-root.json` | 2 | SP-ATT-2 | `LC_ALL=C sort -z \| xargs -0 sha256sum` over the files, and `sha256sum` of the result. The forbidden roots are from `LC_ALL=en_US.UTF-8 sort` and from ICU's `en-US` collation. |
| `bbqr-psbt.json` | 12 | SP-TX-2 to 6 | Frames from Coinkite's reference splitter (`coinkite/BBQr`, `python/bbqr`), and a real Coldcard camera scan from that repository's test data. Decoded payloads cross-checked with Python's base32 and zlib. |
| `ur-psbt.json` | 5 | SP-TX-7 | Frames written by SeedSigner's own UR encoder (`SeedSigner/seedsigner`, `src/seedsigner/helpers/ur2`) around PSBT bodies from `selfcustody/urtypes`, and read back by SeedSigner's own decoder. Optional: only for a signer that implements UR. |

Every external document was fetched at a pinned commit: `bitcoin/bips` at
`7c7cb232`, `coinkite/BBQr` at `8dc7ef07`, `sipa/bech32` at `7a7d7ab1`,
`SeedSigner/seedsigner` at `088b144e`, and `selfcustody/urtypes` at `7fb280ea`.

### Levels

A case's `level` is `MUST` or `SHOULD`. Some MUST cases also carry a SHOULD part,
written as `{ "should": ... }` in `expected` (a high fee SHOULD warn; an output
the transaction falsely claimed SHOULD be reported as claimed). A missed SHOULD
is printed as an advisory and never fails a run.

## What the runner reports

Each case ends in one of:

| Result | Meaning |
| --- | --- |
| pass | Every MUST check in the case held. |
| FAIL | A MUST check did not hold. |
| known | Every check that did not hold is listed in the known failures file. |
| not run | The adapter has no function for this case. |
| advisory | A SHOULD check did not hold. Printed beside the case's result. |

The runner exits 0 only when nothing failed, nothing was left unrun, and no
known failure has started passing. It exits 2 if a vector file does not match
`SHA256SUMS` or the runner's own QR check fails.

### Known failures

A known failures file lists `{ file, case, check, requirement, reason }`
entries. It exists so a signer that fails a case today can still use the runner
to catch regressions, and it changes no expected value. A listed failure is
still a failure of the profile. If a listed case starts passing, the run fails
until the entry is removed, so the list cannot go on describing a bug that has
been fixed.

## What passing means

Passing means that on these inputs your signer produced these outputs, as your
adapter reported them. It does not mean:

- That the device shows those outputs. The adapter reports what the signer's
  code decided. Whether the screen displays it, whether it fits, and whether a
  user can read it are checked by the manual procedures in the profile.
- That the signer behaves the same on inputs the vectors do not contain.
- That the adapter reports the signer truthfully. An adapter is code you wrote,
  and a reviewer should read it. nullroute's adapter calls the same functions
  the device's daemon and screens call, and names the file each call mirrors.
- That the signer conforms to the profile. Many requirements have no vector
  (see below).
- That the profile is right. It is a draft.

If two implementations make the same mistake, the vectors catch it only where
the expected value came from outside both, which is why no expected value here
came from nullroute.

## Which requirements the vectors check

| How it is checked | Requirements |
| --- | --- |
| Vector file in this directory | SP-ENT-1, 2, 3, 4, 5, 10; SP-REV-1, 2, 3, 4, 6, 7, 8, 9, 11, 23, 24, 25; SP-SIG-1; SP-ATT-2; SP-TX-2, 3, 4, 5, 6 |
| Vector, SHOULD parts only | SP-REV-13 (high fee warns), SP-REV-7 (claim reported), SP-REV-11 (unknown pairs reported), SP-REV-14 (own receive address shown as a payment) |
| Vector covers part of it | SP-ENT-7 (a flagged pattern still derives; warnings are not checked), SP-HW-9 (dice mode is deterministic; the operating system random source for sealing is manual review), SP-REV-5 (what each output is shown as; that every character fits on the panel is the manual step), SP-REV-22 (the block and the single-use override; the reason stated beside the control is not checked), SP-TX-7 (reading; writing `crypto-psbt` is not checked) |
| An implementation's own tests only (the profile names nullroute invariants) | SP-ENT-8, SP-ENT-9, SP-REV-10, SP-REV-12, SP-REV-20, SP-REV-26, SP-ATT-6, SP-ATT-7, SP-ATT-8, SP-ATT-9, SP-ATT-10, SP-ATT-11, SP-HW-7, SP-TX-1, SP-DEP-1 (the BIPs' own published vectors, run by the implementation's tests) |
| Manual procedure, stated in the profile | SP-ENT-6, SP-REV-21, SP-ATT-1, SP-ATT-3, SP-ATT-4, SP-ATT-5, SP-ATT-12, SP-HW-1 to SP-HW-6, SP-HW-8, SP-HW-10 |
| Untestable by the signer | The property behind SP-ENT-11: that the dice were fair and unobserved |

Several requirements in the "own tests only" row could still have portable
vectors. SP-REV-1 left it on 23 November with `review-malformed.json`, and
SP-REV-5 left the manual row the same day with `review-outputs.json`.
`make conformance` fails when this table, or a requirement's Check line in the
profile, leaves out a requirement some case checks
(`tools/checks/check-conformance-coverage.mjs`).

## nullroute's results

`make conformance` today: all 158 cases pass, with no SHOULD missed, and
[`known-failures/nullroute.json`](known-failures/nullroute.json) is empty.
Five requirements have failed and been fixed, which is what the list is for:

- SP-REV-9 and SP-REV-11 failed when this directory was added and were fixed
  in the next commit.
- SP-TX-6 (frames in QR byte mode, both writer cases) was fixed when the
  encoder gained alphanumeric mode.
- SP-TX-5 (two transfers with disjoint indices joined) was fixed when the join
  began checking that PSBT and transaction frames make exactly one document.
  That check is structural, not a digest, and says so in INV-QR-10.
- SP-REV-5 failed 6 of the 10 cases in `review-outputs.json` when it was
  written: an output with no address was shown as "no address (raw script)"
  without the script, and BIP-350's undefined witness versions as having no
  address. Both were fixed in the same commit, and the profile's table, which
  had said Met, says so.

A false `PSBT_OUT_TAP_BIP32_DERIVATION` claim used to be shown as a payment
without being reported as claimed, while the same claim made with
`PSBT_OUT_BIP32_DERIVATION` was. Both are reported now.

nullroute's signatures in `sign-deterministic.json` equal the bytes Bitcoin
Core's code computes, ECDSA and Schnorr, under plain RFC 6979. That is the
first comparison of its Schnorr signatures with another implementation.

## Other signers

### SeedSigner

```console
$ make conformance-seedsigner
```

[`adapters/seedsigner.mjs`](adapters/seedsigner.mjs) runs SeedSigner's own
Python, fetched with git at commit `5f321768` (its `dev` branch on 13 November
2026), with the embit release and the
urtypes archive its `requirements.txt` pins, each checked against the hash
pinned there. Its bridge, [`adapters/seedsigner/bridge.py`](adapters/seedsigner/bridge.py),
calls SeedSigner's functions in the order its views call them and names the
view and lines it follows: the dice entry screen, the PSBT parser and the
review screens up to "Approve transaction", `sign_with` and `trim`, and the QR
decoder its scan screen drives. The review reports only what SeedSigner's
screens draw. A value no screen shows is left out, and the case that checks it
fails. It needs the network once, so it is not part of `make check`.

The last run, which the website shows, is
[`results/seedsigner.json`](results/seedsigner.json): 75 cases pass, 54 are
listed findings, and 29 are not run, because SeedSigner has no manifest, does
not write BBQr and shows no bit count on its dice screen. Every finding is in
[`known-failures/seedsigner.json`](known-failures/seedsigner.json) with the
lines of SeedSigner's code that decide it.

A pass means SeedSigner's verdict matched, not that it refused for the reason
the case exists. Four QR cases end on SeedSigner's System Error screen: two
from an exception SeedSigner raises on purpose (a BBQr total or file type that
changes mid-transfer) and two from a decoding error (a UR message whose
checksum fails, a BBQr encoding that changes). A spliced BBQr transfer is
refused only because embit cannot parse what it assembled. Two of BIP-174's
invalid PSBTs (a filled scriptSig, a witness-serialized unsigned transaction)
are parsed by embit and refused for an unrelated reason: the first carries no
UTXO record, and the test wallet owns no input of the second. The same two
rules on a coin the wallet owns are findings. Payments to a bare public key
and to the two witness versions no soft fork has defined end on System Error,
because embit's `address()` raises for any script type it does not know; the
vector allows refusing those, so they pass, but the refusal is a crash rather
than a decision. The runner cannot tell those from a designed refusal, which is
a limit of the kit rather than a finding about SeedSigner.

This project wrote the adapter. SeedSigner's maintainers have not checked it,
and until they do, a finding here is a claim about their code that they have
not confirmed.

Four findings at the previous pin, `088b144e` (23 September 2026), no longer
hold on `dev`, where SeedSigner's maintainers have since changed its parser. A
derivation record that names the seed's key on an input whose script does not
use that key is refused (SeedSigner #1060), outputs that exceed the inputs are
refused (#1041), and a previous transaction is checked against the txid the
input spends and against its witness UTXO (#995). This project has not
contacted SeedSigner about any finding.

| Finding | Requirement | What it means for the profile |
| --- | --- | --- |
| ECDSA signatures are RFC 6979 ground for a low R, exactly as Bitcoin Core's wallet grinds | SP-SIG-1 | It changed the profile. SP-SIG-1 said only "RFC 6979" and the vectors were plain, which failed SeedSigner on a rule whose purpose it meets. Either scheme is allowed now, the signer says which, and SeedSigner passes those cases. |
| Taproot signatures use no `aux_rand` at all, so the nonce skips BIP-340's mask | SP-SIG-1 | The rule stands: BIP-340 signs with a 32-byte `aux_rand`, and Bitcoin Core 31.1 uses 32 zero bytes, so Core cannot reproduce these valid, deterministic signatures. The cause is in embit (`embit/util/key.py`; its bundled libsecp256k1 does the same). |
| 24 words come from exactly 99 rolls, never 100 or more | SP-ENT-3 | An open question: 99 rolls are 255.91 bits, short of 256. The encoding is the profile's, SHA-256 of the ASCII rolls; only the count differs. |
| The signed PSBT holds only the transaction and the signatures | SP-REV-11 | An open question: whether a signer that returns its signatures for the coordinator to combine meets the requirement. |
| A segwit v0 input whose amount comes from the witness UTXO alone is signed; a previous transaction, when one is sent, is checked against the txid and the witness UTXO | SP-REV-3 | An open question, and SeedSigner argues its side: the parser names the attack this leaves open (CVE-2020-14199) and accepts it because coordinators seldom send a QR signer the previous transaction (`psbt_parser.py` lines 577-595). The profile treats that amount as the coordinator's word until a previous transaction confirms it. |
| An output falsely claimed as change makes SeedSigner refuse the whole transaction as "Likely an Attack!", except on taproot, where it is shown as a payment because a script tree would make an honest claim fail the same check | SP-REV-7 | It changed the profile. The vector asked for the output to be shown as a payment and failed SeedSigner for being stricter than the requirement. Refusing is allowed now, and SeedSigner passes. The taproot case passes too, without the SHOULD: nothing says the output was claimed. |
| Only an output of the inputs' script type can be change, and an output with no derivation record is shown as a payment | SP-REV-6 | Stricter than the vectors, which expect change. It costs the user a closer look, not money, and the vectors could accept it. |
| Change is checked by re-deriving it, then shown as its first and last seven characters and "change address #n" | SP-REV-5, SP-REV-6 | A difference the profile names: it asks for every address in full and the full path beside change. |
| No screen shows the sighash type, and an input asking for anything but ALL is left unsigned without saying so | SP-REV-8, SP-REV-23 | Safe in effect, since embit signs with no other type, but when one input asks for SINGLE and another for ALL, SeedSigner signs the second and nothing says the first was skipped. |
| No screen shows nLockTime or replaceability | SP-REV-9 | A gap: a transaction that cannot confirm for a month looks like any other. |
| A UR part from another transfer is dropped and scanning goes on | SP-TX-7 | It changed the vector. SP-TX-7's text asks for the part to be refused, which SeedSigner does; the vector demanded the whole transfer be refused. Either is accepted now, and SeedSigner passes. |
| A repeated BBQr frame with different contents is ignored after the first copy | SP-TX-5 | The rule stands: BBQr has no checksum, so keeping whichever copy came first completes a payload nobody can confirm. |
| UR is read only as `crypto-psbt`, and BBQr only as a PSBT | SP-TX-7, SP-TX-3 | Known and stated: SP-TX-7 writes `crypto-psbt` because SeedSigner reads only that, and a real Coldcard scan of file type U is not read. |
| A PSBT whose unsigned transaction has a scriptSig, or is written with a witness, is reviewed like any other | SP-REV-1 | A gap, from embit's parser, and a small one: the review shows the same inputs and outputs. embit's master has since rejected the scriptSig; the witness form is still read. |
| An OP_RETURN output is shown as its payload alone, with no amount and no place in the list of outputs, and only the last one when there are several | SP-REV-5 | A gap where the output carries an amount: 0.05 BTC on one is shown nowhere, and the math screen stops adding up. Whether a payload counts as "its script" is a question for the profile. |
| Inputs of mixed script types are refused | SP-REV-3, SP-REV-4, SP-REV-25, SP-SIG-1 | Nothing: a limit SeedSigner states, with a note that the policy should come from the user's own inputs alone (`psbt_parser.py` lines 699-702). It stops four cases from reaching the check they exist for. |

## Regenerating the vectors

```console
$ conformance/generate/regenerate.sh /some/empty/scratch/dir
```

It needs network access, Python 3, `pip3` and a Bitcoin Core `bitcoind`. It
fetches every reference at its pinned commit into the scratch directory,
Bitcoin Core's Python test framework at `v31.1` among them, starts
a regtest node there, rewrites the vector files, `SHA256SUMS`, and the pins in
nullroute's spec files, then stops the node and deletes its data. Review the
diff before committing it: a changed expected value is a claim that the source
changed, and it needs a reason. `RPCPORT` and `P2PPORT` move the node off its
default ports, and `BITCOIND` and `BITCOIN_CLI` point at a particular build.

The files were first generated on macOS and are now generated on Linux with
GNU coreutils 9.4, glibc 2.39 and Bitcoin Core 31.1.0 from bitcoincore.org.
Every expected value came out the same on both. What changed is what the
sources name, one error string Core words differently on each system, and
one root added to `manifest-root.json`: glibc's `en_US.UTF-8` collation orders
the test paths a third way, unlike both byte order and ICU, so its root is now
listed as one that MUST NOT be produced.

## BIP test vectors (SP-DEP-1)

SP-DEP-1 asks a signer to pass the vectors each BIP publishes. Those are the
BIPs' own files, not part of this directory. Which of them nullroute includes
is listed in [`research/handoff-D.md`](../research/handoff-D.md#bip-vectors-for-sp-dep-1).
