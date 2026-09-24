# Air-gapped signer profile

Draft specification, version 0.1, 24 September 2026. Not adopted by anyone,
including by the project that wrote it. It is a proposal for review.

This document says what a device that holds Bitcoin keys offline has to do so
that a user can check, rather than trust, four things: where the seed came
from, what a signature will authorise, which software is asking for the
passphrase, and what hardware the rest of the argument assumes. It names no
board, panel or vendor in a requirement. Where it describes nullroute, it does
so in a conformance column, as one implementation of the profile, and marks
the places nullroute does not meet it.

Every requirement has an identifier and a line saying how it is checked. A
requirement that cannot be checked by a test says so. Vector files named
`spec/vectors/signer-profile/*.json` do not exist yet: they are the output of
the next workstream, and each one is named here so that nothing in this
document relies on a check nobody has written down.

## 1. Conventions

### 1.1 Requirement words

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174)
when, and only when, they appear in all capitals, as shown here.

### 1.2 Terms

| Term | Meaning in this document |
| --- | --- |
| Signer | The device, and the software on it, that holds a seed and produces signatures. |
| Coordinator | Software on a networked machine that builds transactions and collects signatures. Untrusted by this profile. |
| Review | Everything the signer displays about one transaction before it can sign it. |
| Owned | Re-derived by the signer from its own seed, or from a multisig descriptor the user registered on the signer. Nothing a PSBT asserts makes an input or output owned. |
| Blocking condition | A finding that disables signing until the user gives an explicit, single-use override. |
| Manifest | A text file listing the SHA-256 of every file in the signer's declared source roots. |
| Manifest root | SHA-256 of the manifest file's bytes. |
| Tier | One of the provisioning levels in section 4.3. A lower tier is never described in a higher tier's language. |

### 1.3 Requirement identifiers and check lines

Identifiers take the form `SP-<AREA>-<n>`. Areas: `ENT` entropy, `REV` review,
`SIG` signing, `ATT` attestation, `HW` hardware, `TX` transport, `DEP`
dependencies. Review requirements numbered below 20 say what is shown, and
those from 20 say when signing is disabled; the gap leaves room for additions
without renumbering.

Each requirement ends with a **Check** line naming one of:

- a vector file to be produced in Workstream D, under `spec/vectors/signer-profile/`
- an existing nullroute invariant id and its test, where nullroute already checks it
- a manual procedure, stated in full
- **UNTESTABLE**, with the reason

Each section ends with a table stating whether nullroute's current build meets
each requirement. "Met" means an invariant with a bound test exists in this
repository. It does not mean the requirement has been observed on hardware.

## 2. Entropy

### 2.1 The dice rule

The rule is the one nullroute publishes. Quoted from `docs/ENTROPY.md`, section
"The canonical encoding" (lines 91-96):

> 1. Each roll is recorded as a single ASCII digit in `1`-`6`
>    (bytes `0x31` through `0x36`).
> 2. Rolls are concatenated in the order they were entered, with **no separators,
>    no whitespace, no line breaks, and no trailing newline**.
> 3. The result is exactly `N` bytes for `N` rolls.
> 4. The entropy is `SHA-256` of those bytes, which is exactly 32 bytes.

Quoted from `packages/core/src/entropy/dice.spec.yaml` (`core.entropy.dice`,
algorithm, lines 35-39):

> Each roll is one ASCII digit, 0x31 through 0x36. Rolls are concatenated in
> entry order with no separators and no trailing newline, giving exactly N bytes
> for N rolls. The entropy is SHA-256 of those bytes.
>
>   entropy = SHA-256( ascii(roll_1) || ... || ascii(roll_N) )

The 32 bytes are then BIP-39 entropy with ENT = 256, which BIP-39 turns into a
24-word mnemonic (`bip-0039.mediawiki`: "The allowed size of ENT is 128-256
bits", checksum length `CS = ENT / 32`).

**SP-ENT-1.** A signer that offers dice entry MUST encode each roll as one byte,
the ASCII digit `0x31` to `0x36` for faces one to six, and MUST concatenate the
rolls in entry order with no separator, whitespace, line break or terminator.
Check: vector `dice-to-entropy.json` (positive cases, including the worked
example in 2.5); nullroute INV-DICE-3 (`entropy.dice.test.ts::published-worked-example`).

**SP-ENT-2.** The signer MUST compute the entropy as SHA-256 of exactly those
bytes and MUST use the 32-byte digest, unmodified, as BIP-39 entropy for a
24-word mnemonic. No other value MAY enter the derivation in this mode. Mixing
dice with machine entropy is a different mode and MUST be labelled as one.
Check: vector `dice-to-entropy.json` (digest, mnemonic and BIP-39 seed for each
case); nullroute INV-DICE-4, INV-DICE-7.

**SP-ENT-3.** The signer MUST refuse to derive a seed from fewer than 100 rolls
and MUST accept any count of 100 or more. Check: vector `dice-to-entropy.json`
(a 99-roll case that MUST be refused, a 100-roll and a 150-roll case that MUST
succeed); nullroute INV-DICE-1, INV-UI-7.

**SP-ENT-4.** Input that is not canonical MUST be refused, not normalised. That
includes a trailing newline, any whitespace or separator, and any character
other than `1` to `6` (so `0` and `7` are refused, and a d6 read as 0 to 5 is
not accepted by relabelling). Check: vector `dice-to-entropy.json` (negative
cases); nullroute INV-DICE-2.

**SP-ENT-5.** Any running count of collected entropy MUST be `floor(n * log2(6))`
or lower, so the display never claims more than has been collected. Check:
vector `dice-accounting.json`; nullroute INV-DICE-5.

**SP-ENT-6.** The rolls MUST remain visible, in entry order, before the seed is
derived, so the user can compare them with what was rolled and with what they
will hash by hand. Check: nullroute INV-UI-9; manual: enter 100 rolls, confirm
every roll is shown in order before confirmation.

**SP-ENT-7.** The signer MAY warn about suspicious patterns. It MUST NOT
discard, reorder or alter a roll, and a warning MUST NOT block derivation.
Check: nullroute INV-DICE-6, INV-UI-8.

**SP-ENT-8.** If the signer offers to roll on the user's behalf, it MUST draw
each face uniformly (for example by rejection sampling, not by reduction
modulo 6), MUST hash the result by SP-ENT-1 and SP-ENT-2, and MUST state on
screen how many rolls it chose. Check: nullroute INV-ENTMODE-1 for the
sampling; manual for the on-screen count.

**SP-ENT-9.** A seed from machine entropy alone MUST NOT be produced without an
explicit acknowledgement that the result cannot be checked by the user. Check:
nullroute INV-ENTMODE-2.

**SP-ENT-10.** The implementer MUST publish the rule in this section with at
least one worked example (rolls, digest, mnemonic) and MUST keep its
implementation reproducing that example. Check: vector `dice-to-entropy.json`;
manual: the procedure in 2.5.

**SP-ENT-11.** The signer and its documentation MUST NOT state or imply that it
has assessed whether the dice were fair or whether the rolls were observed.
Check: manual review of on-screen copy and documentation. The underlying
property, that the dice were fair and unobserved, is **UNTESTABLE** by the
signer and is a precondition on the user (section 8).

### 2.2 Why 100 rolls: the arithmetic

A fair six-sided die yields log2(6) bits per roll.

```
log2(6) = ln(6) / ln(2) = 1.791759469228055 / 0.693147180559945
        = 2.584962500721156 bits per roll
```

The count needed for 256 bits:

```
256 / 2.584962500721156 = 99.034318652042...
ceil(99.0343...)        = 100
```

What 99 and 100 rolls give:

```
 99 x 2.584962500721156 = 255.911287571394...   short of 256 by 0.089
100 x 2.584962500721156 = 258.496250072115...   over 256 by 2.496
```

The same result without floating point, since 6^N possible roll strings carry
256 bits only if 6^N is at least 2^256:

```
6^99  < 2^256    (99 rolls: fewer roll strings than 256-bit values)
6^100 > 2^256    (100 rolls: more)
```

These four values were computed for this document (Python `math.log2`, and
exact integer comparison of `6**99`, `6**100` and `2**256`). They agree with
`docs/ENTROPY.md` lines 63-78 and `dice.spec.yaml` lines 44-46.

Hashing does not add entropy. SHA-256 of a 258.496-bit input is a 256-bit
value; the profile treats SHA-256 as a random oracle here, as
`dice.spec.yaml` line 125 does, so the output is taken to carry the full 256
bits and no more.

### 2.3 Bias

The count in 2.2 assumes a fair die. It is not a margin against a biased one,
and the profile does not claim 256 bits for dice it cannot see.

For an attacker guessing the seed, what matters is min-entropy: if the likeliest
face comes up with probability p, each roll gives at most `-log2(p)` bits
against the best guesser. For 100 rolls to reach 256 bits of min-entropy:

```
100 x -log2(p) >= 256
      -log2(p) >= 2.56
             p <= 2^-2.56 = 0.169576
```

A fair die has p = 1/6 = 0.166667. So 100 rolls stay at or above 256 bits only
while the likeliest face is within about 0.3 percentage points of fair.

An example of a die that fails this: one face at p = 0.20, the other five at
0.16 each.

```
min-entropy per roll     -log2(0.20)                 = 2.321928 bits
100 rolls                100 x 2.321928              = 232.19 bits
rolls for 256 bits       256 / 2.321928 = 110.25    -> 111
Shannon entropy per roll -(0.2 log2 0.2 + 5 x 0.16 log2 0.16) = 2.579471 bits
```

Consequences written into the profile:

- SP-ENT-3 requires accepting more than 100 rolls, so a user who doubts their
  dice can roll more under the same rule.
- SP-ENT-7 keeps pattern warnings advisory. nullroute's chi-squared band fires
  on about 1 in 1000 fair sequences by design (`dice.spec.yaml` lines 119-123)
  and its own spec calls the detector "a courtesy, not a security control". No
  test over 100 rolls can certify a die, and SP-ENT-11 forbids implying one did.

### 2.4 Agreement with other projects

No BIP defines a dice-to-seed method (`research/00-current-state.md`, section
4.1, "Dice"). The comparison below is taken from that document's section 4.3,
which quotes each project's source at the revision recorded in
`research/handoff-A.md`.

| Project or document | Encoding hashed | Count for 24 words | Agrees with SP-ENT-1 and SP-ENT-2 | Differs |
| --- | --- | --- | --- | --- |
| Coldcard, dice-only path | SHA-256 over the ASCII digits as keyed (`shared/seed.py:455`, `:481`, `:533`) | `threshold = 99` (`shared/seed.py:448`) | Yes | 99 rolls accepted. Its path that mixes dice with the hardware RNG uses a domain-separated hash (`shared/seed.py:694`) and does not agree |
| SeedSigner 0.8.7 | `hashlib.sha256(roll_data.encode())` over `"1"` to `"6"` | `DICE__NUM_ROLLS__24WORD = 99`, exactly | Yes | Takes exactly 99, so a 100-roll seed cannot be re-entered on it |
| Krux | `"".join(self.rolls)` for d6, then SHA-256 | `D6_24W_MIN_ROLLS = 99`, a minimum | Yes, for d6 | 99 accepted; d20 rolls are hyphen-joined; 12 words by truncating the digest |
| BCR-2020-001 (Blockchain Commons, research proposal) | Bytes `0x01` to `0x06`, SHA-256, then used to seed an HKDF-based generator | Not stated | No | Different bytes and a further derivation step. The paper says "Existing third-party tools do *not* use this proposed system" |

What follows for a user cross-checking on a second device:

- A seed made from 100 or more rolls under this profile can be reproduced on
  Coldcard's dice-only path and on Krux, whose counts are minimums.
- It cannot be reproduced on SeedSigner 0.8.7, which accepts exactly 99.
- A 99-roll seed from any of the three cannot be reproduced on a conforming
  signer, because SP-ENT-3 refuses it.
- The profile defines 24 words only. Coldcard, SeedSigner and Krux also offer
  12 words from 50 rolls; whether a later version of this profile should define
  12-word truncation is an open question (`research/handoff-C.md`).

### 2.5 Hand verification

Worked example, from `docs/ENTROPY.md` lines 131-175. **Do not use this seed.**
It is public.

Rolls: `123456` repeated to 100 digits.

```
1234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234
```

Procedure, for a user checking a signer against their own machine:

1. Write down the rolls the signer shows (SP-ENT-6), in order.
2. On a separate computer, check the length. The count MUST be the number of
   rolls:
   ```console
   $ printf '%s' '<rolls>' | wc -c
   ```
3. Hash the string with `printf`, never `echo`, which appends a newline:
   ```console
   $ printf '%s' '<rolls>' | sha256sum
   ```
   On macOS use `shasum -a 256`. For the example the output is
   `e56403e8522ddeae1b44a1e8148b1ba4d3b4c626ccf20980056eedcc7e0c0f35`.
4. Convert that hex value to a mnemonic with any offline BIP-39 tool, as
   entropy, not as a seed.
5. Compare the 24 words with the words the signer showed. For the example:
   `tornado cactus wheel picture target finish home neither trend picture
   shoulder endless deputy glide open oxygen another ability forum swear side
   alcohol devote random`.
6. If they differ, stop and do not use the signer. Check for a mistyped roll
   first, then the software identity (section 5).

The digest, the 24 words and the BIP-39 seed with an empty passphrase
(`e50a4299...98ab8011`, printed in full in `docs/ENTROPY.md` lines 173-174) were
recomputed for this document: the digest with `shasum -a 256`, the mnemonic and
seed with `@scure/bip39`. All three match what `docs/ENTROPY.md` publishes.

### 2.6 nullroute conformance

| Id | Status | Evidence |
| --- | --- | --- |
| SP-ENT-1 | Met | INV-DICE-2, INV-DICE-3 |
| SP-ENT-2 | Met | INV-DICE-3, INV-DICE-4, INV-DICE-7; Mode B is a separate mode (`docs/ENTROPY.md`, Modes) |
| SP-ENT-3 | Met | INV-DICE-1, INV-UI-7; no upper bound in `packages/core/src/entropy/dice.ts` |
| SP-ENT-4 | Met | INV-DICE-2 |
| SP-ENT-5 | Met | INV-DICE-5 |
| SP-ENT-6 | Met | INV-UI-9 |
| SP-ENT-7 | Met | INV-DICE-6, INV-UI-8 |
| SP-ENT-8 | Met for sampling; screen copy manual | INV-ENTMODE-1 |
| SP-ENT-9 | Met | INV-ENTMODE-2 |
| SP-ENT-10 | Met | `docs/ENTROPY.md` worked example, INV-DICE-3 |
| SP-ENT-11 | Manual | `docs/ENTROPY.md`, "What the device does not know" |

## 3. Pre-signing review

### 3.1 Principle

A PSBT is chosen by whoever built it. BIP-174 makes display optional ("The
Signer can additionally compute the addresses and values being sent, and the
transaction fee, optionally showing this data to the user as a confirmation of
intent", `bip-0174.mediawiki` line 421). This profile makes it mandatory, and
it takes every fact on the review from the signer's own computation, never from
a field the PSBT could assert. The requirements are drawn from nullroute's
specs `core.psbt.parse`, `core.psbt.review`, `core.psbt.sign`, `daemon.psbt`
and `ui.screens.lock` in `packages/ui/src/ui.spec.yaml`.

### 3.2 What the review MUST show

**SP-REV-1.** Input that is not a well-formed PSBT MUST be refused before any
review is shown, including empty input, a raw transaction, a descriptor and a
truncated PSBT. Check: nullroute INV-PSBT-9.

**SP-REV-2.** Each input's amount MUST come from the UTXO record in the PSBT
(`PSBT_IN_WITNESS_UTXO` or `PSBT_IN_NON_WITNESS_UTXO`). A PSBT missing an
amount for any input MUST be refused, not reviewed with an assumed value.
Check: vector `review-fee-and-amounts.json`; nullroute INV-PSBT-5.

**SP-REV-3.** Unless every signature the signer will produce for the
transaction is a BIP-341 signature without `SIGHASH_ANYONECANPAY`, the signer
MUST, for every input, either confirm the amount from a
`PSBT_IN_NON_WITNESS_UTXO` whose TXID matches the input's prevout, or show the
fee as unverified and treat that as a blocking condition. Where every signature
is a BIP-341 signature without `ANYONECANPAY`, a witness UTXO is enough,
because each of those signatures commits to every input amount and a false
amount makes it invalid. Check: vector `review-input-amounts.json` (segwit v0
inputs with only a witness UTXO; a witness UTXO contradicting its non-witness
UTXO; a non-witness UTXO whose TXID does not match; an all-taproot case that
needs neither).

Basis, quoted from the BIPs:

- BIP-174, Signer (`bip-0174.mediawiki` line 415): "The sighash algorithm for
  Segwit specified in BIP 143 is known to have an issue where an attacker could
  trick a user to sending Bitcoin to fees if they are able to convince the user
  to sign a malicious transaction multiple times. This is possible because the
  amounts in `PSBT_IN_WITNESS_UTXO` of other segwit inputs can be modified
  without effecting the signature for a particular input."
- BIP-341 (`bip-0341.mediawiki` line 133): "If the `SIGHASH_ANYONECANPAY` flag
  is not set, the message commits to the amounts of *all* transaction inputs",
  with the stated reason "This eliminates the possibility to lie to offline
  signing devices about the fee of a transaction."

**SP-REV-4.** The fee MUST be computed as the sum of input amounts minus the sum
of output amounts, in integer satoshis, and MUST NOT be read from any field. A
transaction whose outputs exceed its inputs MUST be refused. The fee MUST be
displayed in satoshis; other units MAY be added. Check: vector
`review-fee-and-amounts.json`; nullroute INV-PSBT-4, INV-PSBT-8, and
`psbt-screen.test.tsx::shows-the-fee-in-several-units` under INV-UI-12.

**SP-REV-5.** Every output MUST be displayed with its full address, or with its
script where it has no address form, and its exact amount. An address MAY wrap
across lines and MUST NOT be elided. Check: nullroute INV-PSBT-8, INV-PSBT-11;
manual: review a transaction paying a 62-character address (SP-HW-2) and
confirm every character is on screen.

**SP-REV-6.** An output MUST be labelled change only when the signer re-derives
its script from its own seed, or from a multisig descriptor registered on the
signer, at a path it then displays beside the output. No PSBT field, including
`PSBT_OUT_BIP32_DERIVATION`, `PSBT_OUT_TAP_BIP32_DERIVATION`, output position
or amount, MAY contribute to that label. An output beyond the signer's search
bound MUST be shown as a payment, and the bound MUST be documented. Check:
vector `review-change.json` (attacker's address in the change position with a
matching derivation hint; change past the search bound); nullroute INV-PSBT-2,
INV-PSBT-12, INV-PSBT-16, INV-UI-12.

**SP-REV-7.** An output the PSBT claims is the wallet's and which does not
re-derive MUST be presented as money leaving the wallet, and SHOULD say that the
transaction claimed it. Check: vector `review-change.json`; nullroute INV-UI-12
(`says-when-the-transaction-claimed-an-output-was-ours`).

**SP-REV-8.** The sighash type of the signatures to be produced MUST be displayed
in terms of what the signature does not commit to, not only as a number. Check:
vector `review-sighash.json`; nullroute INV-PSBT-6.

**SP-REV-9.** A non-zero `nLockTime` MUST be displayed as the block height or
date before which the transaction cannot confirm, and whether the transaction
signals replaceability (BIP-125) MUST be displayed. Check: vector
`review-timelocks.json`; nullroute INV-PSBT-7.

**SP-REV-10.** When the wallet is not on mainnet, the network MUST be named on
screen throughout. Check: nullroute INV-UI-3.

**SP-REV-11.** Key-value pairs the signer does not model MUST be preserved in
the signed PSBT (BIP-174, Signer: "The Signer must only add data to a PSBT",
line 417) and SHOULD be reported as present. Their presence MUST NOT by itself
block signing. Check: vector `review-unknown-fields.json`; nullroute
INV-PSBT-15.

**SP-REV-12.** Where the signer holds one key of a quorum, the review SHOULD
state how many signatures the transaction needs, how many it has, and whether
this signature completes it, and MUST treat a threshold it cannot read as
unmet. Check: nullroute INV-QUORUM-4, INV-QUORUM-8, INV-UI-37, INV-UI-63.

**SP-REV-13.** A fee that is high against the amount leaving the wallet, or a
high fee rate, SHOULD produce a warning. This profile does not make a high fee
a blocking condition. Check: vector `review-fee-and-amounts.json`; nullroute
`review.ts` (`high-fee`, `high-fee-rate`, non-blocking, defaults 5 percent and
500 sat/vB).

**SP-REV-14.** A payment to one of the wallet's own receive addresses SHOULD be
shown as a payment rather than as change. Check: nullroute INV-PSBT-13.

### 3.3 When signing MUST stay disabled

**SP-REV-20.** Reviewing MUST NOT sign. Signing MUST be a separate action that
exists only after a review of that exact transaction has rendered. Check:
nullroute INV-UI-11.

**SP-REV-21.** Signing MUST stay disabled until the user has brought the whole
review into view, to its end. The surface the transaction was entered on MUST
NOT count. Once reached, the end MAY latch so that scrolling back does not
withdraw it. Check: nullroute INV-UI-103 (three bound tests); manual on
hardware: load a review taller than the screen and confirm Sign stays disabled
until the last element has been shown.

**SP-REV-22.** Any blocking condition MUST disable signing. It MAY be lifted
only by an explicit override that applies to one signature and is never
stored. The reason MUST be stated beside the disabled control. Check: nullroute
INV-UI-13, INV-UI-62, INV-SIG-3.

**SP-REV-23.** Any sighash type other than `SIGHASH_ALL` (0x01) or
`SIGHASH_DEFAULT` (0x00, taproot only) MUST be a blocking condition. That
includes every `ANYONECANPAY` combination, `SIGHASH_NONE`, `SIGHASH_SINGLE`,
any value the signer does not recognise, and a transaction whose inputs do not
all request the same type. BIP-174 requires the refusal where the signer finds
a type unacceptable ("If unacceptable, they must fail", line 435); this profile
fixes which types are acceptable. Check: vector `review-sighash.json` (0x00,
0x01, 0x02, 0x03, 0x81, 0x82, 0x83, an undefined value such as 0x04, and a
mixed set); nullroute INV-PSBT-3.

**SP-REV-24.** A transaction with no input the signer owns MUST NOT be signable,
and the screen MUST say why. A signing attempt that produces no signature MUST
fail visibly rather than return an unsigned PSBT. Check: vector
`review-ownership.json`; nullroute INV-PSBT-14, INV-UI-14, INV-SIG-4.

**SP-REV-25.** Signing keys MUST be found by matching each input's own script
to the signer's derivations, not by trusting a derivation path the PSBT
supplies. Check: vector `review-ownership.json` (a PSBT whose derivation record
names the signer's fingerprint for a script it does not own); nullroute
INV-PSBT-14.

**SP-REV-26.** A failure to review or to sign MUST be displayed, and MUST NOT
leave an earlier review or result on screen. Check: nullroute INV-UI-14.

### 3.4 Signing

**SP-SIG-1.** ECDSA signatures MUST use RFC 6979 nonces. Schnorr signatures MUST
use BIP-340 with `aux_rand` set to 32 zero bytes. Nothing else in the signing
path MAY consume randomness. BIP-340 permits this and names the cost:
"If randomness is not available at all at signing time, a simple counter ...
or even the constant array with 32 null bytes" may be used, and random
`aux_rand` "increases protection against [fault injection attacks]"
(`bip-0340.mediawiki` line 161). The profile accepts that cost so that anyone
holding the seed can recompute every signature byte for byte. Check: nullroute
INV-SIG-1, INV-SIG-2 (differential against bitcoinjs-lib, 120 cases); manual:
`docs/VERIFICATION.md`, section "4. Reproducing a signature".

### 3.5 nullroute conformance

| Id | Status | Evidence |
| --- | --- | --- |
| SP-REV-1 | Met | INV-PSBT-9 |
| SP-REV-2 | Met | INV-PSBT-5 |
| SP-REV-3 | Met, more strictly than required | Review blocks, until the user overrides, whenever any input that is not taproot arrives without its previous transaction (INV-PSBT-17, `packages/core/test/psbt.fee-attack.test.ts`), including one this device does not sign, where the profile would permit a witness UTXO. With the previous transaction present, the signing library rejects one whose TXID or output contradicts the input while parsing (`@scure/btc-signer` 2.3.0, `transaction.js` lines 305-345, 536 and 613), and the test pins that. Bitcoin Core 31's `walletcreatefundedpsbt` includes the previous transaction for segwit v0 inputs, checked on regtest, so a Core-built PSBT passes without a warning |
| SP-REV-4 | Met | INV-PSBT-4, INV-PSBT-8, INV-UI-12 |
| SP-REV-5 | Met in the headless render; unverified on the panel | INV-PSBT-11; screens measured at 800x480 by `tools/checks/check-screen-fit.mjs` |
| SP-REV-6 | Met | INV-PSBT-2, INV-PSBT-12, INV-PSBT-16, INV-UI-12; search bound four script types, two branches, 100 addresses each (`packages/daemon/src/psbt.spec.yaml` lines 77-89) |
| SP-REV-7 | Met | INV-UI-12 |
| SP-REV-8 | Met | INV-PSBT-6 |
| SP-REV-9 | Met | INV-PSBT-7 |
| SP-REV-10 | Met | INV-UI-3 |
| SP-REV-11 | Met | INV-PSBT-15. Global-level pairs are preserved but not counted (`review.spec.yaml` lines 140-144) |
| SP-REV-12 | Met | INV-QUORUM-4, INV-QUORUM-8, INV-UI-37, INV-UI-63 |
| SP-REV-13 | Met | `review.ts` warnings are non-blocking. `docs/THREAT-MODEL.md` line 62 describes "a hard warning threshold and a second confirmation", which the code does not have (see `research/handoff-C.md`) |
| SP-REV-14 | Met | INV-PSBT-13 |
| SP-REV-20 | Met | INV-UI-11 |
| SP-REV-21 | Met in tests; unverified on the panel | INV-UI-103 |
| SP-REV-22 | Met | INV-UI-13, INV-UI-62, INV-SIG-3 |
| SP-REV-23 | Met | INV-PSBT-3 |
| SP-REV-24 | Met | INV-PSBT-14, INV-UI-14, INV-SIG-4 |
| SP-REV-25 | Met | INV-PSBT-14 |
| SP-REV-26 | Met | INV-UI-14 |
| SP-SIG-1 | Met | INV-SIG-1, INV-SIG-2 |

## 4. Attestation: the software identity shown before secrets

### 4.1 What is displayed

Before the user enters a passphrase, PIN or mnemonic, the signer shows a value
that identifies the software it runs, in a form the user can recompute from
source with tools that did not come from the signer's authors.

**SP-ATT-1.** The software identity MUST be displayed before any secret is
entered, and the interface MUST read it before rendering anything else. Check:
nullroute INV-UI-1, INV-UI-64; manual on hardware: power on and confirm the
value is on the first screen that accepts input.

**SP-ATT-2.** The identity MUST be the manifest root, defined exactly as
follows:

1. The manifest lists every file under the implementer's declared source roots
   that is tracked by the implementer's version control.
2. Each line is `<hash><space><space><path><LF>`, where `<hash>` is the file's
   SHA-256 as 64 lowercase hexadecimal characters and `<path>` is relative to
   the repository root. This is the output format of coreutils `sha256sum`.
3. Lines are ordered by path, compared byte by byte, which is `sort` under
   `LC_ALL=C`. Locale-aware ordering MUST NOT be used, because it makes the
   result depend on the verifier's language settings.
4. The manifest root is SHA-256 of the manifest file's bytes, which is
   `sha256sum MANIFEST.lock`.

Check: vector `manifest-root.json` (a small tree whose paths sort differently
under `C` and a common UTF-8 locale, with the expected manifest and root);
nullroute `make manifest-check` and `make manifest-recipe`.

**SP-ATT-3.** A user MUST be able to recompute the root from the published
source using only generic tools. The implementer MUST publish the commands.
For nullroute they are (`docs/VERIFICATION.md`, "Checking it"):

```console
$ sha256sum -c MANIFEST.lock
$ sha256sum MANIFEST.lock
$ git ls-files -z packages spec provisioning | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
```

Check: manual: run the three commands on a clean checkout of the release
commit, on a machine that has never had the signer's tooling installed, and
compare the last two outputs with each other and with the signer's screen.

**SP-ATT-4.** The implementer MUST state which roots the manifest covers and
which executed code it does not cover. Check: manual review of the published
verification document. For nullroute: `docs/VERIFICATION.md`, "What the
manifest deliberately excludes".

**SP-ATT-5.** The manifest SHOULD also cover the dependency lock file, so that
the displayed value changes when a dependency does. Check: vector
`manifest-root.json` does not cover this; manual: confirm the lock file appears
in the manifest.

**SP-ATT-6.** If the signer's own verification fails, or its record of that
verification does not match the manifest on disk, the signer MUST refuse to
unlock and MUST NOT offer a way to proceed. Check: nullroute INV-UI-2,
INV-UI-70 for the screen. The daemon's refusal to start (`daemon.ipc.socket`
algorithm, `packages/daemon/src/daemon.spec.yaml` lines 43-45) has no
invariant id and no test in this repository; see 4.4.

**SP-ATT-7.** Wherever the value is shown, the screen MUST state that it is
reported by the software being checked. Check: nullroute INV-UI-5, INV-UI-69.

**SP-ATT-8.** The full value MUST be viewable on the signer. An abbreviated
form MAY be shown first; nullroute shows the first and last eight characters,
grouped in fours, and expands on tap. Check: nullroute INV-UI-1
(`expands-to-the-full-hash`), INV-UI-6.

**SP-ATT-9.** The value shown after unlocking MUST be the one shown before,
not recomputed or fetched again. Check: nullroute INV-UI-72.

**SP-ATT-10.** Where the signer checks its system partition with a hash tree
(dm-verity or equivalent), the root it displays MUST be read from the mapping
the running kernel enforces, not from a file on a partition the tree does not
cover. Where there is no mapping, the signer MUST show that there is none
rather than a blank or a zero. Check: nullroute INV-BOOT-1.

**SP-ATT-11.** The signer SHOULD show the wallet fingerprint before the
passphrase is confirmed, since a wrong BIP-39 passphrase produces a valid,
different wallet rather than an error. Check: nullroute INV-UI-4, INV-KEY-6.

**SP-ATT-12.** The signer and its documentation MUST name the provisioning tier
(section 4.3) a build reaches and MUST NOT describe it in a higher tier's
terms. A hash tree over the system partition "detects modification of the
system partition"; it does not stop it. Check: manual review of screen copy
and documentation; `make prose` catches a narrow list of absolute claims only.

### 4.2 What this does not prove

Stated as plainly as the requirements, because a reviewer will look here first.

1. **The value is drawn by the software it describes.** Software that has been
   replaced can display any number, including the right one. The check catches
   an accident, a failed write and a crude substitution. It does not catch an
   attacker who replaced the code that draws it. SP-ATT-7 puts this sentence on
   the screen.
2. **The root is a hash of a file, not of the running code.** On nullroute the
   build copies `MANIFEST.lock` into the image
   (`provisioning/build/build-system.sh` line 536) and the lock screen hashes
   that copy. It says which source tree the image claims to come from. That the
   running bundle was built from that tree rests on reproducing the image
   (tier 0) and on the hash tree detecting later modification of the
   partition that holds both (tier 1).
3. **Files are not re-hashed at start.** nullroute's daemon compares the root in
   its verification report with SHA-256 of `MANIFEST.lock`; it opens no source
   file (`packages/daemon/src/boot/attestation.ts`, comment above the staleness
   check). File contents are checked by `sha256sum -c` when the report is
   written, and by dm-verity block by block on a tier 1 build.
4. **Dependencies are outside the root.** nullroute's manifest covers tracked
   files under `packages/`, `spec/` and `provisioning/`. `package-lock.json`,
   the root `package.json` and `node_modules` are not in it, so a changed
   dependency does not move the displayed value (SP-ATT-5). The image checksum
   of tier 0 covers them.
5. **The boot partition is covered by nothing below tier 2.** Neither the
   manifest nor dm-verity covers the boot partition, the kernel command line or
   the initramfs. An attacker who rewrites it supplies their own verity root and
   their own initramfs, and the device displays the number they chose
   (`docs/VERIFICATION.md`, "The three tiers"; `daemon.spec.yaml` lines
   187-193).
6. **Firmware and hardware are not covered.** The SoC boot ROM, GPU firmware
   and any radio silicon sit below every value in this section.
7. **No release value exists to compare against yet.** Nothing has been
   published or signed (`docs/THREAT-MODEL.md` line 74). Today the comparison
   is against a root the user computes from source.

### 4.3 Tier boundaries

| Tier | Establishes | Does not establish |
| --- | --- | --- |
| 0 | The image is byte-identical to one built from the source, checked before flashing and after reading the card back | That the card still holds that image at the next boot |
| 1 | Modification of the system partition after the build is detected as blocks are read, and the root of the enforced mapping is shown at boot | Anything about the boot partition, which supplies that root |
| 2 | The boot chain is verified by the silicon, so the displayed root is not chosen by whoever last wrote the card | Trust in the closed boot ROM that performs the check |

Source: `docs/VERIFICATION.md`, "The three tiers", and `docs/THREAT-MODEL.md`,
"Out of scope". Tier 2 burns one-time fuses and is irreversible; this profile
does not require it.

### 4.4 nullroute conformance

| Id | Status | Evidence |
| --- | --- | --- |
| SP-ATT-1 | Met in tests; unverified on the panel | INV-UI-1, INV-UI-64 |
| SP-ATT-2 | Met | `Makefile` target `manifest`; INV-BUILD-1 |
| SP-ATT-3 | Met | `docs/VERIFICATION.md` recipe, `make manifest-recipe` |
| SP-ATT-4 | Met | `docs/VERIFICATION.md` |
| SP-ATT-5 | **Not met** | `MANIFEST_ROOTS := packages spec provisioning` in `Makefile`; `package-lock.json` is at the repository root |
| SP-ATT-6 | Partly met | Screen half: INV-UI-2, INV-UI-70. Daemon half: implemented in `requirePassingVerification`, no invariant id, no test found by searching the repository for the function name or its error messages |
| SP-ATT-7 | Met | INV-UI-5, INV-UI-69 |
| SP-ATT-8 | Met | INV-UI-1, INV-UI-6 |
| SP-ATT-9 | Met | INV-UI-72 |
| SP-ATT-10 | Met in tests; unverified on hardware | INV-BOOT-1 |
| SP-ATT-11 | Met | INV-UI-4, INV-KEY-6 |
| SP-ATT-12 | Manual | `docs/THREAT-MODEL.md`, `docs/VERIFICATION.md` |

## 5. Hardware requirements

### 5.1 Stated as capabilities

No requirement here names a board, SoC or panel. Where nullroute's current
profile is described, it is the Raspberry Pi 4 (4GB) with the official 7 inch
DSI touchscreen at 800x480, which is the only profile it builds for
(`docs/VERIFICATION.md`, "Hardware"). First boot on that hardware is the next
milestone. Until it happens, anything that depends on the panel, the camera or
the running kernel is recorded below as unverified, and every such line names
the build-time check that already exists.

**SP-HW-1.** The review (section 3) and the software identity (section 4) MUST
be shown on a display that only the signer's software drives. A display
belonging to a networked machine does not satisfy this. Check: manual
inspection of the hardware.

**SP-HW-2.** The display MUST show a full address without elision (SP-REV-5).
The longest address this profile expects is 62 characters, a mainnet P2WSH or
P2TR address: 2 characters of human-readable part, 1 separator, 1 witness
version, 52 for 32 bytes in 5-bit groups (256 / 5 = 51.2, rounded up), and the
6-character checksum BIP-173 defines (`bip-0173.mediawiki` line 127). Check:
manual on hardware; headless layout check where the implementer has one.

**SP-HW-3.** The display MUST render the largest single QR frame the signer
emits at a module size the intended cameras decode, with a quiet zone. The
profile sets no pixel count, since that depends on panel density and camera.
nullroute caps frames at QR version 12 (65 modules across) at error correction
level M, a choice its spec derives from an 800x480 panel
(`packages/core/src/qr/bbqr.spec.yaml` lines 102-106). Check: nullroute
INV-QR-5 against an independent decoder in software; manual on hardware: scan
every frame of a multi-frame export with at least one coordinator's camera.

**SP-HW-4.** The signer MUST have an input method sufficient to enter dice
digits and a passphrase without a networked device. Check: manual on hardware.

**SP-HW-5.** The signer MUST have at least one inbound path that is not a
network: a camera for QR, removable media, or both. A camera SHOULD be
provided, since a card that has been in both machines is a channel in its own
right (`docs/USING.md`, "The two transports"). Check: manual on hardware.

**SP-HW-6.** The signer MUST have no working network path. Radio hardware MUST
be absent, or the drivers, firmware and userspace that operate it MUST be
absent from the image; the implementer MUST say which. No listener MAY exist
outside loopback. Check: nullroute INV-PROV-13 against the built image and a
radio-module count in the boot test, INV-NET-1 to INV-NET-3 for listeners;
manual on hardware: list network interfaces on the running device.

**SP-HW-7.** Where a seed is stored, it MUST be stored only in encrypted form
and there MUST be no swap. Check: nullroute INV-STORE-1, INV-PROV-11.

**SP-HW-8.** The signer SHOULD detect modification of its system partition
(tier 1). Check: nullroute `provisioning/profiles/os-verity.yaml` (INV-PROV-4,
INV-PROV-9 and others), INV-BOOT-1; manual on hardware: modify one block of the
system partition on a card and confirm the device fails to read it.

**SP-HW-9.** A hardware RNG MUST NOT be required for seed generation in dice
mode or for signing: both consume no randomness (SP-ENT-2, SP-SIG-1). A signer
that seals the seed at rest will still use an operating system random source
for salts and nonces, and SHOULD document that dependency. nullroute uses
`node:crypto` `randomBytes` for the Argon2id salt and AES-GCM nonce
(`packages/daemon/src/store/envelope.ts` lines 174-176), and for Modes A', B
and C. Check: vector `dice-to-entropy.json` and INV-SIG-2 for the first
sentence; manual review for the second.

**SP-HW-10.** Cost parameters tuned to one board (key stretching, parse size
limits) SHOULD be re-measured on each board a profile adds. nullroute's
Argon2id at 64 MiB and three passes is stated as "roughly half a second per
guess on a Pi 4" (`packages/daemon/src/store/store.spec.yaml`). Check: manual
timing on the board.

### 5.2 Hardware assumptions already in nullroute

From `research/00-current-state.md` section 3: the hard dependencies are the
Pi 4 device tree and boot files, the DSI panel overlay and its touch
controller, and 800x480 as the only viewport. None of them is in
`packages/core`. A second board needs its own profile entry, device tree and
overlay, and a second panel needs a layout that passes SP-HW-2 at its size.

### 5.3 nullroute conformance

| Id | Status on Pi 4 with the 7 inch panel | What exists before bring-up |
| --- | --- | --- |
| SP-HW-1 | Unverified until bring-up | INV-PROV-25, INV-PROV-26: config.txt names the panel overlay and the overlay is on the card; the build refuses to finish unless the merged tree enables the DSI node and touch controller |
| SP-HW-2 | Met in the headless render; unverified on the panel | `tools/checks/check-screen-fit.mjs` at 800x480 |
| SP-HW-3 | Met against a software decoder; unverified with a camera | INV-QR-5 |
| SP-HW-4 | Unverified until bring-up | FT5406 touch controller in the overlay |
| SP-HW-5 | Unverified until bring-up | Pi Camera Module 3 named as optional; nothing in `provisioning/` names a camera driver, so whether Chromium's `getUserMedia` reaches it is open (`research/00-current-state.md` 3.4). The SD card path in `docs/USING.md` needs checking against `docs/THREAT-MODEL.md`, which says nothing mounts removable media (see `research/handoff-C.md`) |
| SP-HW-6 | Met in the image; unverified on the running device | INV-PROV-13, INV-NET-1 to INV-NET-3. The radio chip remains on the board (`docs/THREAT-MODEL.md`, Assumptions) |
| SP-HW-7 | Met | INV-STORE-1, INV-PROV-11 |
| SP-HW-8 | Met in the build; unverified on hardware | `os-verity.yaml`, INV-BOOT-1 |
| SP-HW-9 | Met | INV-DICE-7, INV-SIG-1, INV-SIG-2 |
| SP-HW-10 | Measured on Pi 4 per its spec | `store.spec.yaml` |

## 6. Transport

### 6.1 QR

**SP-TX-1.** A payload that fits in one QR frame SHOULD be sent bare, without a
multi-frame header, so a generic scanner reads it. Check: nullroute INV-UI-22.

**SP-TX-2.** A payload that does not fit MUST be sent as BBQr frames (Coinkite,
`BBQr.md`; the project README gives its status as "Deployed Widely"). A PSBT
MUST be sent as file type `P` carrying the binary PSBT, which is the form
BIP-174 calls the file ("Binary PSBT files should use the .psbt file
extension"). Check: vector `bbqr-psbt.json`, which MUST include at least one
sequence produced by another implementation; nullroute INV-UI-21
(`sends-a-psbt-as-the-binary-file-bbqr-defines`), INV-QR-2, INV-QR-3.

**SP-TX-3.** A receiver MUST read BBQr encodings `H`, `2` and `Z`, since BBQr
states "The above encodings **must** be implemented by receivers". Check:
vector `bbqr-psbt.json`; nullroute INV-QR-2 and the `Z` read test in
`packages/core/test/qr.bbqr.test.ts`.

**SP-TX-4.** A signer MUST NOT write BBQr encoding `Z`, so that no compressor
sits in the path that emits signed transactions. This is stricter than BBQr,
which permits `Z`. Check: nullroute `bbqr.spec.yaml` lines 36-41 and 108-110;
vector `bbqr-psbt.json` (writer output is `2` or `H` only).

**SP-TX-5.** Frames from two transfers MUST NOT be assembled into one payload.
A receiver MUST refuse a frame whose total, file type or encoding differs from
the transfer in progress, or whose index repeats with different contents.
Because BBQr carries no whole-payload checksum ("All "N" QR codes must be
scanned"), the receiver SHOULD also check a digest of the assembled payload
where the sender provides one. Check: nullroute INV-QR-4; vector
`bbqr-psbt.json` (two transfers sharing total, type and encoding with disjoint
indices, which nullroute's collector would join: gap N5 in
`research/00-current-state.md`).

**SP-TX-6.** BBQr frames MUST use the QR alphanumeric mode, which BBQr states as
"Your QR **MUST** use the "alphanumeric" character encoding". Check: vector
`bbqr-psbt.json` (mode indicator of every emitted frame).

**UR is not supported.** Blockchain Commons UR (`ur:psbt`, `ur:crypto-psbt`,
fountain-coded multipart) is not read or written by nullroute. SeedSigner
writes PSBTs only as UR and Jade reads and writes only UR
(`research/00-current-state.md`, 4.2), so neither shares an animated format
with a signer that implements this section alone. Whether this profile should
add UR as a MAY or a SHOULD is open question 2 in `research/handoff-A.md`, and
is not decided here.

### 6.2 nullroute conformance

| Id | Status | Evidence |
| --- | --- | --- |
| SP-TX-1 | Met | INV-UI-22 |
| SP-TX-2 | Met for nullroute's own reader; no external sequence tested | INV-UI-21; no BBQr vector from another implementation exists in the repository (gap G6) |
| SP-TX-3 | Met | `packages/core/src/qr/bbqr.ts`, read path accepts `2`, `H`, `Z` |
| SP-TX-4 | Met | Writer emits `2` only |
| SP-TX-5 | Partly met | INV-QR-4 covers mismatched headers and conflicting repeats; the disjoint-index case is untested and would be joined (N5) |
| SP-TX-6 | **Not met** | The encoder writes byte mode only (`packages/core/src/qr/encode.spec.yaml` lines 22-25; gap G2) |

## 7. Normative dependencies

Fetched from `github.com/bitcoin/bips` at commit `7c7cb232` on 24 September
2026. Status and version are copied from each file's header. "Draft" and
"Complete" are the BIP process's own words; neither means the same as
Deployed.

| Document | File | Status (version) | Used for | nullroute |
| --- | --- | --- | --- | --- |
| BIP-32 | `bip-0032.mediawiki` | Deployed | Key derivation | Vectors in `spec/vectors/bip32.json` |
| BIP-39 | `bip-0039.mediawiki` | Deployed | Mnemonic, ENT = 256 | Vectors in `spec/vectors/bip39-english.json` |
| BIP-44, 49, 84, 86 | `bip-0044`, `bip-0049`, `bip-0084`, `bip-0086` | Deployed | Single-key account paths | Vectors in `spec/vectors/bip84-86-addresses.json` for 84 and 86 |
| BIP-48 | `bip-0048.mediawiki` | Deployed | Multisig account paths | Used |
| BIP-67 | `bip-0067.mediawiki` | Complete | `sortedmulti` key order | Used |
| BIP-125 | `bip-0125.mediawiki` | Deployed | Replaceability shown in review | SP-REV-9 |
| BIP-143 | `bip-0143.mediawiki` | Deployed | Segwit v0 sighash | SP-REV-3 basis |
| BIP-173, 350 | `bip-0173`, `bip-0350` | Deployed | Address encoding | SP-HW-2 arithmetic |
| BIP-174 | `bip-0174.mediawiki` | Deployed (1.4.4) | PSBT | Required |
| BIP-370 | `bip-0370.mediawiki` | Deployed | PSBT version 2 | Cited by `core.psbt.parse`; no test in this repository feeds a version 2 PSBT, so support is UNVERIFIED and this profile requires version 0 only |
| BIP-340, 341, 342 | `bip-0340`, `bip-0341`, `bip-0342` | Deployed | Taproot signing and scripts | SP-SIG-1, SP-REV-3 |
| BIP-380, 381, 382, 383, 386, 387 | `bip-0380` and the rest | Deployed | Descriptors, including `multi_a` and `sortedmulti_a` | Checksum required unless explicitly overridden (`core.descriptor.parse`); vectors in `spec/vectors/bip380-checksum.json` |
| BIP-389 | `bip-0389.mediawiki` | Draft | Multipath key expressions | A subset: nullroute accepts the multipath element only as the last step before the wildcard, where BIP-389 allows further `/NUM` steps after it (`bip-0389.mediawiki` lines 42-46) |
| BIP-322 | `bip-0322.mediawiki` | Complete (2.0.0) | Message signing | INV-MSG-6 reproduces the ECDSA signature published in `bip-0322/basic-test-vectors.json` byte for byte |
| BIP-329 | `bip-0329.mediawiki` | Draft | Label import and export | Labels never decide ownership (INV-DAEMON-21) |
| BIP-129 | `bip-0129.mediawiki` | Complete | BSMS setup files | Import only |
| BIP-85 | `bip-0085.mediawiki` | Deployed (2.1.0) | Child seeds | Outside this profile |
| BIP-388 | `bip-0388.mediawiki` | Complete (1.1.0) | Wallet policies | Not used |
| BBQr | `coinkite/BBQr`, `BBQr.md` | "Deployed Widely" (README) | Multi-frame QR | Section 6 |
| RFC 2119, RFC 8174 | rfc-editor.org | BCP 14 | Requirement words | Section 1.1 |
| RFC 6979 | rfc-editor.org | Informational RFC | ECDSA nonces | SP-SIG-1. Not fetched for this document; cited as nullroute's specs cite it |

**SP-DEP-1.** A conforming signer MUST implement BIP-32, BIP-39, BIP-174 and
the descriptor documents it claims, and MUST pass the published vectors of each
where the BIP provides them. Check: nullroute's vectors in `spec/vectors/`;
Workstream D to list, per BIP, which published vectors are and are not
included.

## 8. Out of scope

This profile does not defend against the following, and a signer that conforms
to it does not either. Most of the list is `docs/THREAT-MODEL.md`, "Out of
scope", restated without the nullroute specifics.

- **Physical extraction.** No secure element is assumed. An attacker holding
  the storage is limited by the passphrase and the key-stretching cost only.
- **Side channels and fault injection** on the signer's hardware: power,
  electromagnetic, acoustic, timing, glitching. SP-SIG-1 gives up the fault
  injection resistance that random `aux_rand` would add.
- **A signer whose boot chain is not verified by its silicon** (below tier 2),
  where an attacker who rewrites the boot partition controls every value in
  section 4.
- **Evil maid** access without tier 2. Tier 1 makes an unsophisticated change
  visible to a user who reads the boot screen, and nothing more.
- **Malicious hardware** in the supply chain. Nothing in this profile checks
  that the board is what it claims to be.
- **Coercion.** Nothing here helps someone under credible physical threat.
- **Unfair or observed dice.** The signer cannot detect either (SP-ENT-11).
- **A user who does not read the screen.** Every requirement in section 3
  assumes the review is read. SP-REV-21 makes the user scroll through it and
  cannot make them read it.
- **A malicious address the user intended.** The review shows where money goes;
  it cannot know where the user meant it to go. Checking a receive address on
  the signer is the defence against a coordinator showing a different one.
- **Privacy from anyone who sees the screen.** A QR code is a picture, and an
  extended public key reveals every address the wallet will use.
- **Two implementations wrong the same way.** Differential tests catch
  disagreement, not shared error.
- **The user's own operational security.**

## 9. Change log

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 24 September 2026 | First draft, from nullroute at commit `00a460a` |
