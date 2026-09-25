# UR notes for an in-tree implementation

Research for checking a TypeScript UR codec against Blockchain Commons' own
sources. The vectors live in `spec/vectors/ur-bcr.json`. Every claim below cites
a file and line at a pinned commit. Nothing here is from memory.

## Pinned sources

| Short name | Repository | Commit |
| --- | --- | --- |
| `bc-ur` | BlockchainCommons/bc-ur (C++ reference), branch `master` | `4479fb81b2350ae8bafa042a5572b9c64c2c32ca` |
| `Research` | BlockchainCommons/Research, branch `master` | `e4a4fbb186e2e7625ccdf7149aec4f0a5adaf850` |
| `seedsigner` | SeedSigner/seedsigner, branch `dev` (default) | `088b144eaebc79d12d6336030e943510d7a14f54` |
| `sparrow` | sparrowwallet/sparrow, branch `master` | `0d2dec40850330d7802b4e1422eff9ba09aa7877` |
| `hummingbird` | sparrowwallet/hummingbird, branch `master` | `022bf00dab0bc7ad17b7fb88efa02ded5de492a2` |
| `jade` | Blockstream/Jade, branch `master` | `b39a7a2054cd8148d9ad930126cdaddfc3065e3c` |
| `keystone` | KeystoneHQ/keystone3-firmware, branch `master` | `0c0ae4675c436b1dbbb322cd707d80f06f311182` |

Paths under `Research` are in `papers/`. The multipart paper is
`bcr-2024-001-multipart-ur.md` (the "MUR Implementation Guide"). BCR-2020-005
links to it as the authority for multipart (`bcr-2020-005-ur.md:47`, `:192`).

BCR-2020-005 says compliant codecs "MUST pass the unit tests from the reference
implementations" and names `bc-ur` `test/test.cpp` as one of them
(`bcr-2020-005-ur.md:54`, `:62`).

## String grammar

A single-part UR is `ur:<type>/<message>` and a multipart UR is
`ur:<type>/<seq>/<fragment>`, where `<seq>` is `<seqNum>-<seqLen>`
(`bcr-2020-005-ur.md:150-180`). `seqNum` is 1-based. Values past `seqLen`, such
as `11-10`, are normal and mark rateless parts (`bcr-2020-005-ur.md:182-184`).

The decoder tells the two forms apart only by whether a `seq` component is
present (`bcr-2020-005-ur.md:176`). In `bc-ur` that is a count of path
components: one means single part, two means multipart, anything else is an
error (`bc-ur src/ur-decoder.cpp:86-93`).

`<message>` and `<fragment>` are both minimal Bytewords: the first and last
letter of each word, two characters per byte, with a 4-byte CRC-32 appended
before encoding (`bc-ur src/ur-encoder.cpp:15-18`, `:35-39`;
`src/bytewords.cpp:77-84`, `:109-118`). For a single part the bytes are the
untagged CBOR of the object. For a multipart part they are the CBOR part array
described below.

`<type>` is letters, digits and `-` (`bcr-2020-005-ur.md:98`). `bc-ur` accepts
only lowercase `a-z`, `0-9` and `-` (`src/utils.cpp:150-159`), but lowercases the
whole string before checking (`src/ur-decoder.cpp:32-33`), so any case is
accepted on input. The type `bytes` exists only for testing and "MUST NOT be
used for any other purpose" (`bcr-2020-005-ur.md:100`).

### Case

The format is case-agnostic: all uppercase for QR, all lowercase as canonical
for display and URIs (`bcr-2020-005-ur.md:43`). The QR alphanumeric set has no
lowercase letters (`bcr-2020-005-ur.md:21-27`), and the stated goal is to use
alphanumeric mode rather than byte mode (`:41-42`). `bc-ur` always emits
lowercase and has no uppercase helper, so uppercasing for a QR is the caller's
job. On input, Bytewords decoding lowercases each letter
(`src/bytewords.cpp:47-48`, `:61-62`).

### Parser quirks in `bc-ur` a strict parser may reject

- `split` skips empty components (`src/utils.cpp:94-112`), so
  `ur:bytes//body` parses as if the double slash were one.
- `seqNum` and `seqLen` go through `stoul` (`src/ur-decoder.cpp:57-58`), which
  tolerates leading whitespace and a `+`. Both must be at least 1 (`:59`).
- The `seq` in the string must equal `seqNum` and `seqLen` inside the CBOR, or
  the part is dropped (`src/ur-decoder.cpp:102`).
- After the first part, a part whose type differs from the first is dropped
  (`src/ur-decoder.cpp:66-74`).

## Bytewords

Each byte maps to one of 256 four-letter words
(`src/bytewords.cpp:17`). Standard style joins full words with a space, URI
style with `-`, and minimal style concatenates the first and last letter of each
word (`src/bytewords.cpp:143-154`). All three append the CRC-32 of the body in
network byte order before encoding (`src/bytewords.cpp:97-102`,
`bcr-2020-012-bytewords.md:110-114`).

Decoding looks up each word by its first and last letter. For four-letter words
it also checks the middle two letters (`src/bytewords.cpp:19-70`). It rejects
fewer than 5 decoded bytes, then checks the trailing 4 bytes against the CRC-32
of the rest (`src/bytewords.cpp:120-141`).

## CRC-32

Standard reflected CRC-32: polynomial `0xEDB88320`, initial value `~0`, final
complement (`src/crc32.c:19-39`). Two forms are used. `crc32_int` returns the
`uint32` (`src/utils.cpp:39-41`). `crc32_bytes` returns it as 4 big-endian bytes
(`src/utils.cpp:32-37` with `htonl` at `src/crc32.c:41-43`). Bytewords appends
the bytes form. The fountain encoder uses the integer form.

## Multipart part structure

Each part is a CBOR array of five items
(`bcr-2024-001-multipart-ur.md:719-729`; `src/fountain-encoder.cpp:85-98`):

```
[seqNum: uint32, seqLen: uint, messageLen: uint, checksum: uint32, data: bytes]
```

- `seqNum` counts from 1 and wraps at 2^32 (`bcr-2024-001-multipart-ur.md:753`;
  `src/fountain-encoder.cpp:116`).
- `seqLen` is the number of fragments (`src/fountain-encoder.hpp:57`).
- `messageLen` is the message length before padding
  (`bcr-2024-001-multipart-ur.md:731`, `:755`).
- `checksum` is the CRC-32 of the whole message, as an integer
  (`src/fountain-encoder.cpp:103`).
- `data` is one fragment, or several XORed together, always exactly
  `fragmentLen` bytes.

The "message" here is the UR's CBOR, not the payload inside it. `UREncoder`
feeds `ur.cbor()` to the fountain encoder (`src/ur-encoder.cpp:20-24`). For a
PSBT that means the CBOR byte-string header plus the PSBT bytes.

Decoding the part in `bc-ur` checks the array length is 5 and that each integer
fits its C++ type, then reads the byte string (`src/fountain-encoder.cpp:53-83`).
It does not reject trailing bytes and does not ask CborLite for minimal
encodings (the `requireMinimalEncoding` flag exists at `src/cbor-lite.hpp:111`
but is not passed). BCR-2020-005 separately says every UR payload MUST be dCBOR
(`bcr-2020-005-ur.md:84-88`), which is stricter than the reference decoder.

### Fragment length

`find_nominal_fragment_length(messageLen, minFragmentLen, maxFragmentLen)` tries
`fragmentCount = 1, 2, ...` up to `messageLen / minFragmentLen` (integer
division) and returns the first `ceil(double(messageLen) / fragmentCount)` that is
at most `maxFragmentLen` (`src/fountain-encoder.cpp:20-34`;
`bcr-2024-001-multipart-ur.md:410-431`). `minFragmentLen` defaults to 10
(`src/fountain-encoder.hpp:50`). The paper says the choice of fragment length
does not affect interop and MAY be chosen by the implementer
(`bcr-2024-001-multipart-ur.md:404`), but matching the vectors needs this exact
search.

### Padding

The message is cut into `fragmentLen` chunks and the last one is right-padded
with zero bytes (`src/fountain-encoder.cpp:36-51`;
`bcr-2024-001-multipart-ur.md:442-465`). The decoder joins fragments in index
order and truncates to `messageLen` (`src/fountain-decoder.cpp:34-37`).

### Which fragments go into a part

For `seqNum <= seqLen` the part is just fragment `seqNum - 1`
(`src/fountain-utils.cpp:29-30`). So the first `seqLen` parts alone are enough to
decode.

For `seqNum > seqLen` (`src/fountain-utils.cpp:31-40`;
`bcr-2024-001-multipart-ur.md:602-640`):

1. Seed = 4 big-endian bytes of `seqNum`, then 4 big-endian bytes of `checksum`
   (`src/utils.cpp:61-69`).
2. `rng = Xoshiro256(seed)`, meaning SHA-256 of those 8 bytes.
3. `degree = choose_degree(seqLen, rng)`.
4. Shuffle the indexes `0 .. seqLen-1` with the same `rng` and take the first
   `degree`.
5. XOR those fragments into a zeroed buffer of `fragmentLen` bytes
   (`src/fountain-encoder.cpp:109-113`).

The order of RNG calls matters. The degree is drawn first (two `next_double`
calls), then the shuffle draws continue from the same state.

## Xoshiro256**

Seeding (`src/xoshiro256.cpp:43-78`):

- From a string: SHA-256 of its bytes (UTF-8 for the ASCII test seeds).
- From bytes: SHA-256 of the bytes.
- From a `uint32` (CRC): SHA-256 of its 4 big-endian bytes.
- The 32-byte digest maps to state as `s[i]` = big-endian `uint64` of digest
  bytes `[8i, 8i+8)`, for `i = 0..3`.

`next()` is the published xoshiro256** 1.0 with 64-bit wrapping arithmetic
(`src/xoshiro256.cpp:102-117`):

```
result = rotl(s[1] * 5, 7) * 9
t = s[1] << 17
s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]
s[2] ^= t
s[3] = rotl(s[3], 45)
return result
```

Derived values (`src/xoshiro256.cpp:80-100`):

- `next_double() = double(next()) / (double(UINT64_MAX) + 1)`. The divisor is
  exactly 2^64. The numerator is a `uint64` rounded to the nearest `double`.
- `next_int(low, high) = uint64(next_double() * double(high - low + 1)) + low`,
  truncating toward zero.
- `next_byte() = uint8(next_int(0, 255))`. This is the top bits of `next()` by way
  of a double, not its low byte.
- `next_data(n)` is `n` calls to `next_byte()`.

Details that change results in TypeScript:

- `next()` must be done in `BigInt` masked to 64 bits, or in 32-bit halves.
  `Number` loses bits.
- `double(next())` rounds to the nearest double. `Number(bigint)` in JavaScript
  also rounds to nearest, ties to even. A value within 2^10 of 2^64 rounds up to
  2^64, making `next_double()` exactly 1.0. Neither source guards this, so
  `next_int(0, n-1)` could in principle return `n`. It is astronomically rare,
  and no vector exercises it. Match the C++ rather than "fix" it, or any fix
  changes which fragments are chosen when it happens.
- The multiply before truncation is one IEEE-754 double multiply. The paper
  requires IEEE-754 doubles for the sampler (`bcr-2024-001-multipart-ur.md:299`).

## Random sampler (Walker-Vose alias)

Construction (`src/random-sampler.cpp:17-74`;
`bcr-2024-001-multipart-ur.md:301-375`):

1. `sum` = left-to-right sum of `probs`, starting from `0.0`.
2. `P[i] = probs[i] * double(n) / sum`, evaluated as `(probs[i] * n) / sum`.
3. For `i` from `n-1` down to `0`: push `i` onto `S` if `P[i] < 1`, else onto
   `L`. The reversed order is a stated departure from Schwarz (`:36-37`).
4. While both are non-empty: `a = S.pop()`, `g = L.pop()` (both from the back),
   `prob[a] = P[a]`, `alias[a] = g`, `P[g] += P[a] - 1`, then push `g` onto `S`
   if `P[g] < 1`, else onto `L`.
5. Everything left in `L`, then in `S`, gets `prob = 1`.

Sampling (`src/random-sampler.cpp:76-82`): draw `r1`, then `r2`, from
`next_double`. `i = int(double(n) * r1)`. Return `i` if `r2 < prob[i]`, else
`alias[i]`.

## Degree and shuffle

`choose_degree(seqLen, rng)` builds a sampler over `1.0 / i` for `i = 1..seqLen`
and returns `sample + 1` (`src/fountain-utils.cpp:16-23`). The sampler is rebuilt
on every call in C++. The Swift reference builds it once per message
(`bcr-2024-001-multipart-ur.md:508-523`). That is the same output, because
construction is deterministic.

`shuffled(items, rng)` (`src/fountain-utils.hpp:25-35`): while items remain,
`index = next_int(0, remaining.size() - 1)`, remove that item and append it.
The Swift version stops after `count` items (`bcr-2024-001-multipart-ur.md:556-566`).
That gives the same prefix and fewer RNG calls, and nothing is drawn from the RNG
afterwards, so both give the same fragment set.

## Decoder

(`src/fountain-decoder.cpp`; `bcr-2024-001-multipart-ur.md:1056-1390`)

**Validation.** The first valid part fixes `seqLen`, `messageLen`, `checksum` and
`data.size()`. Any later part that differs in any of them is dropped, not fatal
(`src/fountain-decoder.cpp:185-203`). The paper makes that a MUST
(`bcr-2024-001-multipart-ur.md:759`).

**Indexes.** Each received part gets its fragment set from `choose_fragments`
(`src/fountain-decoder.cpp:22-26`) and goes on a FIFO queue. The queue is drained
until empty or complete (`:46-69`).

**Simple part** (one index). Ignore it if that index is already held. Otherwise
store it. If all indexes `0..seqLen-1` are now held, join, truncate to
`messageLen`, and compare the CRC-32 with the expected checksum. A match is
success. A mismatch is a terminal `InvalidChecksum` failure. If not yet complete,
reduce every mixed part by this one (`:127-161`).

**Mixed part.** Ignore it if a mixed part with the identical index set is already
held. Otherwise reduce it by every simple part, then every mixed part. If it
became simple, queue it. If not, reduce all held mixed parts by it and store it
(`:163-183`).

**Reduction.** Part `a` is reduced by `b` only when `b`'s index set is a strict
subset of `a`'s. The result has indexes `a - b` and data `a XOR b`
(`:113-125`). Reduced mixed parts that become simple go back on the queue
(`:91-111`).

**Completion.** `is_complete` means a result exists, success or failure
(`src/fountain-decoder.hpp:37`). After that, further parts are refused
(`src/fountain-decoder.cpp:48`).

**UR layer.** `URDecoder::receive_part` catches every exception and returns
`false` (`src/ur-decoder.cpp:76-117`). A malformed frame is silently dropped
rather than ending the session. For nullroute this is the scanning layer, not a
signing path, but the caller still has to surface a checksum failure, which
arrives as `is_failure()` (`src/ur-decoder.hpp:45`).

## PSBT types

The registry lists CBOR tag 40310 with UR type `psbt`, and the struck-through
deprecated tag 310 with UR type `crypto-psbt`
(`bcr-2020-006-urtypes.md:89`). Software should "only read the deprecated types
and tags and not write them" (`bcr-2020-006-urtypes.md:39`). That is RECOMMENDED,
not MUST.

The body of `psbt` is a single CBOR byte string holding BIP-174 binary
(`bcr-2020-006-urtypes.md:217-225`). As a top-level UR it is untagged
(`bcr-2020-005-ur.md:128`; `bcr-2020-006-urtypes.md:35`). The registry has no
separate section for `crypto-psbt`, only the struck-through name on the same row.
So the registry implies the same body under both names without saying so in
words. Hummingbird treats them as the same body: `URPSBT` (type `psbt`) extends
`CryptoPSBT` (type `crypto-psbt`) and both are a bare `ByteString`
(`hummingbird registry/URPSBT.java:6-17`, `registry/CryptoPSBT.java:3-27`,
`registry/RegistryType.java:26`, `:36`).

What wallets write and accept, from source at the pinned commits:

| Wallet | Writes | Accepts | Citation |
| --- | --- | --- | --- |
| SeedSigner (`dev`) | `crypto-psbt` | `crypto-psbt` only. The QR sniffer matches `^UR:CRYPTO-PSBT/`, case-insensitive. A `ur:psbt/` frame is not routed to the PSBT decoder. | `src/seedsigner/models/encode_qr.py:405`; `src/seedsigner/models/decode_qr.py:348-349` |
| Sparrow | `crypto-psbt` (`CryptoPSBT.toUR()` when showing a PSBT QR) | both `crypto-psbt` and `psbt` | `src/main/java/com/sparrowwallet/sparrow/transaction/HeadersController.java:1141-1143`; `control/QRScanDialog.java:468`, `:505` |
| Jade | `crypto-psbt` | `crypto-psbt` (case-insensitive compare). No `psbt` constant exists in `bcur.c`, so `ur:psbt` falls to "Unhandled UR message". | `main/bcur.c:24`; `main/qrmode.c:1124`, `:1273`, `:1303-1306` |
| Keystone 3 | UNVERIFIED which string. Uses `CryptoPSBT` from the external `ur_registry` crate, which was not fetched. | `crypto-psbt` confirmed by test fixture `UR:CRYPTO-PSBT/...`. `psbt` UNVERIFIED. | `rust/rust_c/src/bitcoin/psbt.rs:24`; `rust/rust_c/src/common/ur.rs:470`; `rust/rust_c/src/test_cmd/btc_test_cmd.rs` (`test_decode_crypto_psbt`) |

In practice, every device checked writes the deprecated `crypto-psbt`. SeedSigner
and Jade reject `psbt`. A signer that follows the registry's "write `psbt`"
recommendation would fail to hand a signed PSBT back through SeedSigner or Jade.
Sparrow is the only coordinator checked that reads both. Emitting `crypto-psbt`
and accepting both is the interoperable choice. That is a design call for the
owner, not something the registry says.

## What a byte-string-only implementation can omit

Safe to omit:

- Any CBOR beyond: the byte string (major type 2) for the payload, and the
  5-element array of unsigned integers plus one byte string for the part
  header. `psbt` and `crypto-psbt` bodies are bare byte strings.
- CBOR tags. Top-level UR objects MUST NOT be tagged (`bcr-2020-005-ur.md:128`).
- Standard and URI Bytewords styles, since URs use only minimal style
  (`src/ur-encoder.cpp:16`, `:37`; `src/ur-decoder.cpp:27`, `:100`). They are
  still the easiest way to check the word table against the vectors.
- The `jump` and `long_jump` functions (`src/xoshiro256.cpp:119-174`), which
  nothing in UR calls.
- `estimated_percent_complete` and the debug printers
  (`src/fountain-decoder.cpp:39-44`, `:205-251`).
- A fragment-length policy other than `find_nominal_fragment_length`, if only
  decoding. The decoder takes `fragmentLen` from the first part.

Must not omit:

- The rateless path in the decoder. Coordinators animate past `seqLen`, and a
  receiver that joins late may see only mixed parts. The reference decoder test
  starts at `first_seq_num = 100` for exactly this reason (`test/test.cpp:341`).
- Bit-exact Xoshiro256**, sampler and shuffle, including the float steps above.
  One wrong index means wrong XORs and a checksum failure.
- The Bytewords CRC-32 on every frame, and the whole-message CRC-32 before
  returning a result.
- Rejecting parts whose `seqLen`, `messageLen`, `checksum` or fragment length
  differ from the first part. Without that, frames from two different PSBTs can
  be mixed into one payload.
- The `seq` versus CBOR consistency check (`src/ur-decoder.cpp:102`).
- Case-insensitive input, since QR frames arrive uppercase.
- Truncating to `messageLen` after joining, so padding never reaches the PSBT
  parser.

## Where the sources differ

- **Degree-chooser vectors are different tests.** `test.cpp` seeds a fresh
  `Xoshiro256("Wolf-<n>")` for each of 200 calls (`test/test.cpp:187-198`). The
  paper uses one `Xoshiro256("Wolf")` for 1000 calls
  (`bcr-2024-001-multipart-ur.md:528-547`). Both are in the JSON. They do not
  conflict.
- **Shuffle vectors are different tests.** `test.cpp` reuses one RNG for ten full
  shuffles (`test/test.cpp:141-161`). The paper uses a fresh RNG per row with
  increasing counts (`bcr-2024-001-multipart-ur.md:571-593`). Every paper row is
  a prefix of `test.cpp`'s first row (checked mechanically).
- **Fragment chooser.** The paper lists 50 `seqNum`s and `test.cpp` lists 30. The
  first 30 are identical (checked mechanically).
- **Values only the paper lists.** A second CRC-32 vector (`0x2f19f3bb`,
  `bcr-2024-001-multipart-ur.md:161-166`), a SHA-256 vector (`:175-181`), the
  sampler totals (`:397`) and the part CBOR hex `850c0818641a12345678450105030305`
  (`:767`). `test.cpp` only round-trips that part (`test/test.cpp:356-362`).
- **Paper typo.** `bcr-2024-001-multipart-ur.md:535` repeats
  `let degrees = (1...1000).map`. The intent is clear.
- **Single-part `next_part`.** Swift asserts it is never called twice on a
  single-part encoder (`bcr-2024-001-multipart-ur.md:889`). `bc-ur` returns the
  same single-part string every time (`src/ur-encoder.cpp:26-33`).
- **dCBOR strictness.** BCR-2020-005 requires dCBOR (`:84-88`). The `bc-ur` part
  decoder accepts non-minimal integer encodings and trailing bytes
  (`src/fountain-encoder.cpp:53-83`).
- **Registry versus practice.** The registry says to write `psbt`. Every wallet
  checked writes `crypto-psbt` (table above).

## Not found

- Raw `uint64` Xoshiro outputs. Both sources list only `next() % 100` and
  `next_int(1, 10)`.
- The CBOR hex of `make_message_ur(50)` and full `make_message(256 | 1024 | 32767)`
  outputs. They are built at runtime.
- The number of parts the 32767-byte decoder tests need. Both only assert
  eventual success.
- A multipart `psbt` or `crypto-psbt` vector in either primary source. The only
  multipart UR string vectors are `ur:bytes`.

## Interop, measured

Both directions against SeedSigner's own UR code
(`src/seedsigner/helpers/ur2` at `088b144e`) and the `urtypes` archive its
requirements pin (`7fb280ea`), on 2026-09-25.

- **SeedSigner writes, nullroute reads.** `spec/vectors/signer-profile/ur-psbt.json`,
  generated by `conformance/generate/gen_ur.py`: in order, mixed parts alone,
  the `psbt` type name, two transfers, and a message whose CRC-32 fails. SeedSigner's
  decoder checks each case as it is written. `make conformance`: 5 of 5.
- **nullroute writes, SeedSigner reads.** `make interop-ur`: coinkite's 1in2out,
  1in10out and 1in20out PSBTs at 40 and 110 byte fragments, as the display
  shows them and as mixed parts alone from the first number past the loop.
  12 of 12 decoded to the same PSBT. The mixed-only runs are the ones that
  matter: they decode only if both sides choose the same fragments for every
  mixed part.

No physical SeedSigner or Jade has scanned a frame from this device. This is
their code, not their camera.

