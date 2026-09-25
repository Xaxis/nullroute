# Signer profile conformance

Test vectors and a reference runner for [`spec/signer-profile.md`](../spec/signer-profile.md),
a draft specification for air-gapped Bitcoin signers. The profile is at version
0.1. Nobody has adopted it, including the project that wrote it. It is here to
be reviewed and argued with.

The vectors are language-neutral JSON. The runner is one Node file with no
dependencies. You check a signer by writing a small adapter module that calls
your signer and reports what it did, then running the runner against it.

nullroute is one implementation of the profile. Its adapter is in
[`adapters/nullroute.mjs`](adapters/nullroute.mjs), and it does not pass every
case (see [nullroute's results](#nullroutes-results)).

## Layout

| Path | What it is |
| --- | --- |
| `spec/vectors/signer-profile/*.json` | The vector files. One per group of requirements. |
| `spec/vectors/signer-profile/SHA256SUMS` | SHA-256 of every vector file, in `sha256sum` format. |
| `conformance/run.mjs` | The runner. Node built-ins only. |
| `conformance/adapters/nullroute.mjs` | The adapter for nullroute's built packages. |
| `conformance/known-failures/nullroute.json` | The cases nullroute fails today, each with a reason. |
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
| `changeSearchBound` | | A number: how many addresses on each change branch the signer re-derives when it looks for change. Used by the `change-at-index-*` cases. The profile requires the bound to be documented (SP-REV-6). |
| `diceToSeed(rolls)` | `rolls`: the string exactly as a user typed it | `{ verdict: 'accept', entropyHex, mnemonic, seedHex }` or `{ verdict: 'refuse' }`. `seedHex` is the BIP-39 seed with an empty passphrase. |
| `diceBitsShown(count)` | `count`: a number of valid rolls | The integer number of bits the signer displays after that many rolls. |
| `reviewPsbt(psbt, context)` | `psbt`: base64 PSBT; `context`: see below | A review result, see below. |
| `signPsbt(psbt, context, options)` | as above; `options.override` is always `false` in this version | `{ verdict: 'signed', psbtBase64 }` or `{ verdict: 'refuse' }`. |
| `buildManifest(files)` | `files`: `[{ path, bytes }]`, `bytes` a `Uint8Array`, in no particular order | `{ manifest, root }`: the manifest text exactly, and its root as lowercase hex. |
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
| `outputs` | `[{ index, address, amountSats, kind, changePath }]`. `kind` is `payment` or `change`. `address` is the full address or `null`. `changePath` is the path shown beside change, such as `m/84'/0'/0'/1/0`. |
| `claimedOutputs` | Indices of outputs the review says the transaction claimed were the wallet's, and which did not re-derive. |
| `sighash` | `{ outputs, otherInputsMayBeAdded }`. `outputs` is `all`, `none`, `one` or `unrecognised`: which outputs the signature commits to, as the review describes it. |
| `locktime` | `{ kind, value }`. `kind` is `none` (nLockTime is 0), `height` or `time`, as the review presents it. |
| `replaceable` | Whether the review says the transaction signals BIP-125 replaceability. |
| `unknownFieldsReported` | How many key-value pairs the review says it does not model. |
| `warnings` | Warning codes shown. The only code the vectors look for is `high-fee`. |

Where a case accepts more than one verdict, the vector lists them in
`verdictIn`. For example, a sighash other than ALL must be a blocking condition,
and SP-REV-22 lets a signer refuse outright instead of offering an override, so
both `block-until-override` and `refuse` pass.

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
| `review-fee-and-amounts.json` | 7 | SP-REV-2, 4, 13 | PSBTs built by Bitcoin Core 31.1 on regtest. Fee from `decodepsbt`. Change from the path `getaddressinfo` reports. Addresses from the scriptPubKey with the BIP-173/350 reference encoder. A negative fee rejected by `testmempoolaccept`. |
| `review-input-amounts.json` | 7 | SP-REV-3 | Core PSBTs with UTXO records removed or altered. Verdicts from the requirement text, BIP-174 and BIP-341. Core's `decodepsbt` error for the mismatched TXID is recorded. |
| `review-change.json` | 9 | SP-REV-6, 7, 14 | Core PSBTs. Change and path from `getaddressinfo`. The wallet key is the published BIP-84 and BIP-86 test key; the generator stops unless Core derives the addresses those BIPs print. Derivation claims use the public keys those BIPs print. |
| `review-sighash.json` | 13 | SP-REV-8, 23 | Core PSBTs with `PSBT_IN_SIGHASH_TYPE` set. Meaning from BIP-143 and BIP-341; Core's names recorded. |
| `review-timelocks.json` | 8 | SP-REV-9 | Core PSBTs. Height or time from `LOCKTIME_THRESHOLD` in Bitcoin Core's source. Replaceability from BIP-125, and from Core's own mempool (`getmempoolentry`) for every case it could broadcast. |
| `review-unknown-fields.json` | 2 | SP-REV-11 | A Core PSBT with pairs added. Core's `decodepsbt` lists them as unknown or proprietary. Preservation from BIP-174. |
| `review-ownership.json` | 5 | SP-REV-24, 25 | Core PSBTs from a second wallet (the BIP-32 test vector 1 key), with derivation records naming the signer's fingerprint. Verdicts from the requirement text. |
| `manifest-root.json` | 2 | SP-ATT-2 | `LC_ALL=C sort -z \| xargs -0 sha256sum` over the files, and `sha256sum` of the result. The forbidden roots are from `LC_ALL=en_US.UTF-8 sort` and from ICU's `en-US` collation. |
| `bbqr-psbt.json` | 12 | SP-TX-2 to 6 | Frames from Coinkite's reference splitter (`coinkite/BBQr`, `python/bbqr`), and a real Coldcard camera scan from that repository's test data. Decoded payloads cross-checked with Python's base32 and zlib. |

Every external document was fetched at a pinned commit: `bitcoin/bips` at
`7c7cb232`, `coinkite/BBQr` at `8dc7ef07`, and `sipa/bech32` at `7a7d7ab1`.

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
| Vector file in this directory | SP-ENT-1, 2, 3, 4, 5, 10; SP-REV-2, 3, 4, 6, 7, 8, 9, 11, 23, 24, 25; SP-ATT-2; SP-TX-2, 3, 4, 5, 6 |
| Vector, SHOULD parts only | SP-REV-13 (high fee warns), SP-REV-7 (claim reported), SP-REV-11 (unknown pairs reported), SP-REV-14 (own receive address shown as a payment) |
| Vector covers part of it | SP-ENT-7 (a flagged pattern still derives; warnings are not checked), SP-HW-9 (dice mode is deterministic; the operating system random source for sealing is manual review) |
| An implementation's own tests only (the profile names nullroute invariants) | SP-ENT-9, SP-REV-1, SP-REV-10, SP-REV-12, SP-REV-20, SP-REV-22, SP-REV-26, SP-ATT-6, SP-ATT-7, SP-ATT-8, SP-ATT-9, SP-ATT-10, SP-ATT-11, SP-HW-7, SP-TX-1 |
| Manual procedure, stated in the profile | SP-ENT-6, SP-ENT-8 (on-screen count), SP-REV-5, SP-REV-21, SP-SIG-1, SP-ATT-1, SP-ATT-3, SP-ATT-4, SP-ATT-5, SP-ATT-12, SP-HW-1 to SP-HW-6, SP-HW-8, SP-HW-10, SP-DEP-1 |
| Untestable by the signer | The property behind SP-ENT-11: that the dice were fair and unobserved |

Several requirements in the "own tests only" row could have portable vectors.
SP-REV-1 (malformed input refused) and SP-SIG-1 (deterministic signatures that
another implementation reproduces byte for byte) are the obvious next ones.
They are not in this version because the profile does not name a vector file
for them.

## nullroute's results

`make conformance` today: all 107 cases pass, with no SHOULD missed, and
[`known-failures/nullroute.json`](known-failures/nullroute.json) is empty.
Four requirements have failed and been fixed, which is what the list is for:

- SP-REV-9 and SP-REV-11 failed when this directory was added and were fixed
  in the next commit.
- SP-TX-6 (frames in QR byte mode, both writer cases) was fixed when the
  encoder gained alphanumeric mode.
- SP-TX-5 (two transfers with disjoint indices joined) was fixed when the join
  began checking that PSBT and transaction frames make exactly one document.
  That check is structural, not a digest, and says so in INV-QR-10.

A false `PSBT_OUT_TAP_BIP32_DERIVATION` claim used to be shown as a payment
without being reported as claimed, while the same claim made with
`PSBT_OUT_BIP32_DERIVATION` was. Both are reported now.

## Regenerating the vectors

```console
$ conformance/generate/regenerate.sh /some/empty/scratch/dir
```

It needs network access, Python 3, `pip3` and a Bitcoin Core `bitcoind`. It
fetches every reference at its pinned commit into the scratch directory, starts
a regtest node there, rewrites the vector files, `SHA256SUMS`, and the pins in
nullroute's spec files, then stops the node and deletes its data. Review the
diff before committing it: a changed expected value is a claim that the source
changed, and it needs a reason.

## BIP test vectors (SP-DEP-1)

SP-DEP-1 asks a signer to pass the vectors each BIP publishes. Those are the
BIPs' own files, not part of this directory. Which of them nullroute includes
is listed in [`research/handoff-D.md`](../research/handoff-D.md#bip-vectors-for-sp-dep-1).
