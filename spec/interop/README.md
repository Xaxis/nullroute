# Interop fixtures

Real files from other wallets, kept so that nullroute's coordinator import
(`packages/core/src/descriptor/coordinator.ts`, spec
`core.descriptor.coordinator`) is tested against what those programs actually
write rather than against files its own tests made up.

Nothing here is edited. Every file is either a verbatim copy of a file another
project keeps as a test fixture, or the output of a real Bitcoin Core run that
anyone can repeat. Each file's SHA-256 is in `SHA256SUMS`, which `sha256sum -c`
reads, and the hash of `SHA256SUMS` itself is pinned in
`packages/core/src/descriptor/coordinator.spec.yaml`, so `make verify` fails if
any of it changes without the spec changing too.

```sh
cd spec/interop && sha256sum -c SHA256SUMS
```

The tests are in `packages/core/test/interop.fixtures.test.ts` and bind to
INV-COORD-1 to INV-COORD-6. Every expected value in them comes from somewhere
other than nullroute's code: a value Sparrow's own test asserts for that file,
an address BIP-129, BIP-84 or BIP-86 publishes, or what Bitcoin Core derived.

## Sparrow test resources

| Field | Value |
| --- | --- |
| Origin | [sparrowwallet/sparrow](https://github.com/sparrowwallet/sparrow) |
| Commit | `d61b2a6ad3df1ec5a8c933cff5896c9445f78075`, master on 2026-10-26 |
| Original path | `src/test/resources/com/sparrowwallet/sparrow/io/` plus the file name below (and `LICENSE` at the repository root) |
| Licence | Apache License 2.0 |
| Fetch again | `tools/fetch-interop-fixtures.sh <empty directory>` downloads every file at that commit and checks it against `SHA256SUMS` |

These files are from Sparrow Wallet, by the Sparrow Wallet project and its
contributors, and are redistributed unmodified under the Apache License 2.0.
Sparrow's licence is copied verbatim to `sparrow/LICENSE`, as section 4 of that
licence requires. Sparrow has no NOTICE file at this commit and the files carry
no copyright notices of their own. They are licensed under Apache 2.0 here
too, not under this repository's MIT licence.

"Written by" is what Sparrow's own test or the file's own header says produced
it. "Sparrow" is what Sparrow's test at the pinned commit does with the file.
"nullroute" is what `importCoordinatorFile` does, as asserted in
`interop.fixtures.test.ts`.

### Coldcard setup files

| File | SHA-256 | Written by | Sparrow | nullroute |
| --- | --- | --- | --- | --- |
| `sparrow/cc-multisig-export-1.txt` | `8fcef73372e025a9bc094a6a73a62ba060ef4f7a5645f692d58156e254dc6762` | Coldcard ("Coldcard Multisig setup file (created on 0F056943)"), ColdcardMultisigTest.importWallet1 | Reads a P2WSH 2-of-4 named CC-2-of-4 | Reads the same: `wsh(sortedmulti(2,...))`, four cosigners at m/48'/0'/0'/2', receive and change. Addresses match Core |
| `sparrow/cc-multisig-export-2.txt` | `22b0d21023bf6f5ce40a618cd7e9a2438eb8f331631e04b1281c808224a9d0cd` | Coldcard, testnet keys, `Format: P2WSH-P2SH`, importWallet2 | Reads a P2SH-P2WSH 2-of-4 | Reads the same: `sh(wsh(sortedmulti(2,...)))` at m/48'/1'/0'/1'. Addresses match Core |
| `sparrow/cc-multisig-export-multideriv.txt` | `e56942ec550e175ddbc855cb72333511030cff25b125eee5897cbd209c987d5a` | Electrum's Coldcard-format export ("Exported from Electrum"), a Derivation line above each cosigner, importWalletMultiDeriv | Reads a 3-of-3; first key at m/48'/0'/0'/2', third at m/47'/0'/0'/1' | Reads the same origins (INV-COORD-5). Before this fixture it gave every key the last Derivation line, m/47'/0'/0'/1'. Addresses match Core |
| `sparrow/cc-multisig-export-missingkey.txt` | `9abafcf136cebdd4fef5d2fcf175156569281e4ddb04308e64351c6b8791207f` | Coldcard, one cosigner line removed, importWalletMissingCosigner | Refuses | Refuses: the policy says 4 cosigners and the file lists 3 (INV-COORD-2) |
| `sparrow/cc-multisig-export-nopolicy.txt` | `22cf4e6ebc80c1b26e580b8ca500985aa53fae76e24f03bd43fcf1216324ad9c` | Electrum's export with no Policy line, importWalletMissingPolicy | Refuses | Refuses: missing Policy, and it is not guessed (INV-COORD-2) |

### Specter Desktop JSON

Sparrow both reads this format and writes it (Export, Specter Desktop).

| File | SHA-256 | Written by | Sparrow | nullroute |
| --- | --- | --- | --- | --- |
| `sparrow/specter-wallet.json` | `d8715c06667ba526fb117550f9b72424978ba20302fd4b45f43fdeef2d04b117` | Specter Desktop, 2020, SpecterDesktopTest.testImport | Reads a P2SH-P2WPKH account, 4df18faa at m/49'/0'/0', with receive and change branches | Reads the descriptor as written: `sh(wpkh(...))` with the same origin and key, and no wildcard, so one address. Core reads it the same way |
| `sparrow/specter-multisig-wallet.json` | `5e720b09840a7ca6f79ffceadb807ab84782ebc542711e41613505ce92fc63f4` | Specter Desktop, 2020, testMultisigImport | Reads a P2WSH 3-of-4 as `sortedmulti`, with receive and change branches | Reads it as written: `wsh(multi(3,...))`, keys in the order given, no wildcard. Same origins and keys as Sparrow asserts, different addresses from Sparrow. Core agrees with nullroute |

### Descriptor files

| File | SHA-256 | Written by | Sparrow | nullroute |
| --- | --- | --- | --- | --- |
| `sparrow/descriptor-receive.txt` | `ebbbc623545825644a47e257411395c004875381009158fb9ef67a7932120b70` | Output descriptor text; the test names no producer. DescriptorTest.testImport | Reads a262308d at m/84'/0'/0' | Reads the same. Addresses match Core |
| `sparrow/descriptor-receive-change1.txt` | `7efe8546519dd16b367c6c4edbeb0e60beae7735d0a21b9bcec7acf9c8846950` | Receive and change descriptors on separate lines, the pair Sparrow's own exporter writes (testExport). testImportSeparateDescriptors | Reads it | Reads both descriptors. Before this fixture it refused the file as "altered since it was written" (INV-COORD-1). Addresses match Core |
| `sparrow/descriptor-receive-change2.txt` | `e362c472216a5632d516a5fa4c7e3c044f982b8d020ac8ff50dd2dd1261abbde` | As above, no blank line between. testImportSeparateDescriptorsNoBlankLine | Reads it | Reads both, as above |
| `sparrow/descriptor-multipath.txt` | `444aadd26fd6fee4d4ff26476506611b72e18eaa7fadb3d442adadda908db9d6` | BIP-389 `/<0;1>/*`, what Sparrow's exporter writes first (testExport). testImportMultipath | Reads it | Reads it as one multipath descriptor. Receive and change addresses match Core |
| `sparrow/descriptor-labelled.txt` | `df40d8fe0c34b4287a9fbe36e624acfc89918887d5e48c076bc59cd5784f9a5a` | A descriptor behind a `Receive:` label. testImportLabelled | Reads it, stripping the label | Refuses: `Receive: wpkh` is not a descriptor function. A gap, below |
| `sparrow/jade-keystore.txt` | `7622498994f4d1fc466f018cae9efc70d03c9cd554db3ef5f457d508c93d5158` | Blockstream Jade's descriptor export, JadeTest.testImport | Reads 73c5da0a at m/84'/0'/0', the BIP-84 test key | Reads the same key. Addresses match Core and the ones BIP-84 publishes |
| `sparrow/keystone-singlesig-keystore-1.txt` | `8ebd99cb389ef6b5f23ccfb190f0b2bd8ba76ecd34204a63a482c8fe075dda1c` | Keystone's descriptor export, a zpub and an uppercase fingerprint, KeystoneSinglesigTest.testImport | Reads 5271c071 at m/84'/0'/0' | Reads the same origin and key. Keeps the zpub and the uppercase fingerprint in the descriptor text and recomputes only the checksum. Addresses match Core |

### BIP-129 BSMS files

`bsms/multisig-2.bsms` and `bsms/multisig-3.bsms` are the two round-two test
vectors BIP-129 publishes, identical to lines 287 to 289 and 430 to 432 of
`bip-0129.mediawiki` at bitcoin/bips `100ba872c808946155b1eeb8c4568058f2eea0a7`.
The rest are Sparrow's variations on them, for Bip129Test. Every one this
device reads derives the same addresses as Core.

| File | SHA-256 | Sparrow | nullroute |
| --- | --- | --- | --- |
| `sparrow/bsms/multisig-1.bsms` | `295bdeee42b412bc09a347acb6cc268e47b6d8440eaddb361fdccfb3d8315222` | Reads; first receive address bc1qfagqa8... (importWallet1) | Reads; derives the same first address |
| `sparrow/bsms/multisig-2.bsms` | `2fdc121f5d3655e5de266708486a83c6934421fa4d55e1b24fdf2e55271334f5` | Reads; bc1qrgc6p3... (importWallet2) | Reads; derives the address BIP-129 publishes |
| `sparrow/bsms/multisig-3.bsms` | `258ed2684da014289df95c6f7ab4367530f01223654e3995371dbc0bac4cfd57` | Refuses: reads `multi()` as sorted, which derives another address (importWallet3) | Reads `multi()` as written and derives 3GzMtF..., the address BIP-129 publishes |
| `sparrow/bsms/multisig-4.bsms` | `b8ad2bd0bba218ec7de0753e53d18722bb7331a32b50d2d0261a61a9b141436b` | Reads; the stated address is uppercase (importWallet4) | Reads; derives the same address |
| `sparrow/bsms/multisig-5.bsms` | `d8d09bf2de19d00254a09e194e52de8b1000e57682a241659b8003350572d06a` | Refuses restrictions /2/*,/3/* | Expands to /2/* and /3/* and labels the second change. The stated address is for /0/0 and is surfaced, not checked |
| `sparrow/bsms/multisig-6.bsms` | `098d545bc60d890b13a805574cc840185b24f9ca85958989cc72cc31a4be647a` | Reads, treating a template with "No path restrictions" as /0/*,/1/* | Refuses: BIP-129 requires a template to come with restrictions (INV-COORD-3) |
| `sparrow/bsms/multisig-7.bsms` | `db149a6451eb51b4591bb1b32cae64e3661eed5b983c2d643373e9640e3f2229` | Refuses /2/*,/3/* | Expands to /2/* and /3/*; there is no first address to surface |
| `sparrow/bsms/multisig-8.bsms` | `3d359d1fe97ee152539101a01d8f9ccaa1c2fbebddcd1f9e383a35ef8eeffca0` | Reads a fixed /0/0 descriptor | Reads it as one fixed address, the one stated |
| `sparrow/bsms/multisig-9.bsms` | `1148c93a7a029c698ac4c36741b88c48ce00a7efa455f928b34f9a11b37a368d` | Refuses: the stated address is not the descriptor's | Reads it and surfaces the stated address as unverified; its own address differs (INV-COORD-4) |
| `sparrow/bsms/multisig-10.bsms` | `bfdec2a801ba09ba83c2c50471084e4dfefc776f85c59d966667d6dab035a7a3` | Reads a fixed P2SH-P2WSH descriptor | Reads it; derives the stated 3MmNkJ... |
| `sparrow/bsms/multisig-11.bsms` | `712fae55f188d70f88999cdc9a73a9cae513eebf474ea181e7321a54ec0e88d6` | Refuses: fixed on /5/7, outside its receive and change chains | Reads it as one fixed address |
| `sparrow/bsms/multisig-12.bsms` | `d8959c13601a5ccffab2f26e220a99e3076e0892d23bd35d55a489877826b71f` | Reads; change address 3 is bc1qr47z3t... | Reads it as one fixed address, that one |
| `sparrow/bsms/multisig-13.bsms` | `b4aac21ed5a598e9d8efb8b0930e450b1d2b8df6efab5c321c4b08181da5f2a8` | Refuses: fixed at /0, a chain rather than an address | Reads it as one fixed address |
| `sparrow/bsms/multisig-14.bsms` | `1688ac204d3c0f15da1dd252a3768631e2de5311c200f3c44a440dd4ba35305f` | Refuses: no first address | Reads it; there is no first address to surface |
| `sparrow/bsms/multisig-15.bsms` | `b55d777cb23ef7e27c14fb750ac3a09588d1d365a9da2e07b3355e95332071c4` | Refuses: the stated address is for different keys | Refuses: template without restrictions (INV-COORD-3) |
| `sparrow/bsms/multisig-16.bsms` | `2be959323123943f81b06be32fbface5a5ac9a74df5c71a5bfd96e23889542de` | Reads, treating the blank restrictions line as none | Refuses: template without restrictions (INV-COORD-3) |
| `sparrow/bsms/multisig-17.bsms` | `5ecfd3674741d5fb0a44ad160456390284f7ee759b6e875b48c5a8bd909ed372` | Refuses: "not-an-address" | Refuses: template without restrictions (INV-COORD-3) |
| `sparrow/bsms/multisig-address-mismatch.bsms` | `b500aeab7ee1f09958a50b918334bf71d157b28603004446a2a39db2d55ea070` | Refuses: the stated address is not the descriptor's | Reads it and surfaces the stated address as unverified; its own address differs (INV-COORD-4) |
| `sparrow/bsms/multisig-threshold-zero.bsms` | `40385c0217217cee789b93b0c6109331c926546a27279f3ed9e42453770888c7` | Refuses | Refuses: threshold 0 is out of range |

### Formats nullroute does not read

| File | SHA-256 | Written by | Sparrow | nullroute |
| --- | --- | --- | --- | --- |
| `sparrow/caravan-multisig-export-1.json` | `8d40d0b5190f7850af320f9b8b2475f7785c0ccfb78404a5fe25e1f74235d0b0` | Caravan's wallet configuration, CaravanMultisigTest.importWallet1 | Reads a P2WSH 2-of-3 | Refuses: no descriptor in it |
| `sparrow/electrum-multisig-wallet.json` | `3694a0edfffebddf39cc395c312acbeb03c68ec787a71aa190917fb51ab3a7c4` | Electrum's wallet file for a Coldcard 2-of-4, ElectrumTest | Reads a P2SH-P2WSH 2-of-4 | Refuses: no descriptor in it |
| `sparrow/specter-diy-export.txt` | `a3abf71de97676d446b110706edd3bb242a12ca8d829134ed71a4065d2a06006` | Sparrow's own Specter DIY exporter (SpecterDIYTest.testExport compares its output with this file byte for byte) | Writes it | Refuses: `addwallet name&descriptor` is a device command, not a descriptor |
| `sparrow/LICENSE` | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` | Sparrow's licence, from the repository root | Not applicable | Not read; kept for the licence |

## Bitcoin Core 31.1 exports

| Field | Value |
| --- | --- |
| Program | Bitcoin Core v31.1.0 (`getnetworkinfo` version 310100, `/Satoshi:31.1.0/`); the generator refuses any other version |
| Generator | `tools/gen-interop-core.sh <empty directory>`, which runs `tools/gen-interop-core.py` |
| Network | regtest, its own datadir, RPC port 39443, P2P port 39444, stopped afterwards |
| Keys | The BIP-84 and BIP-86 test key (`abandon` x11 `about`, the key the conformance contexts use), and BIP-32 test vectors 1 and 2 as the other two cosigners |
| Reproducible | Fixed keys and fixed timestamps; two runs wrote byte-identical files |
| Licence | Generated by this project; MIT, like the rest of this repository |

Each file is a Core RPC result, written as Core returned it. Core on regtest
writes `tpub` keys and `bcrt1` addresses; nullroute ignores an extended key's
version bytes, and the tests derive on regtest to compare.

| File | SHA-256 | What Core was asked | nullroute |
| --- | --- | --- | --- |
| `bitcoin-core-31.1/listdescriptors-bip84-bip86.json` | `4bb57021598cb0e195ce0e9362fea5ff7038b0bbc6d8761f4fa8cc5b0784a8f9` | `listdescriptors` for a wallet holding the test key as `wpkh` at m/84'/0'/0' and `tr` at m/86'/0'/0', receive and change | Reads four descriptors identical to Core's, checksums included, with the branch from `internal`. Extracts 73c5da0a and the account keys BIP-84 and BIP-86 publish. Derives Core's addresses on regtest and the BIPs' on mainnet |
| `bitcoin-core-31.1/listdescriptors-2of3.json` | `9178095b76bc4af175323c4a97b89ca43a97b46498c91a3d8caac5573ffec6c7` | `listdescriptors` for cosigner A's wallet in a 2-of-3 `wsh(sortedmulti)` quorum, with B and C's account keys exported by their own Core wallets | Reads both branches, named 2of3: 2-of-3, sorted, fingerprints 73c5da0a, 3442193e and bd16bee5 at m/48'/0'/0'/2'. Derives Core's addresses |
| `bitcoin-core-31.1/importdescriptors-2of3.json` | `8518d8a10046033ba149764689a509c001478e3f5edee762415c307c772d9e95` | The `descriptors` array of the file above, the shape `importdescriptors` takes; the generator imported it into a fresh watch-only wallet and Core accepted it | Reads it as `core-importdescriptors`, the same descriptors, receive then change |
| `bitcoin-core-31.1/getdescriptorinfo.json` | `f3a49eb5875ce7418df4bc329bca4e3ac28b453ebf66f940563803505c1ac063` | `getdescriptorinfo` for each descriptor above and for the BIP-389 `/<0;1>/*` form of each receive descriptor | Computes Core's checksum for each multipath form |
| `bitcoin-core-31.1/deriveaddresses.json` | `a8b09a4d8bc436d0f8eac98840dc09d40ce8ceafa51f7c42372f3fd7ff73e80e` | `deriveaddresses` for the same descriptors, indices 0 to 2 | Derives the same addresses, receive and change for the multipath forms |
| `bitcoin-core-31.1/deriveaddresses-sparrow.json` | `91ba200ae6bf4f64ca39a5cd87d749bf2d5fa81bffe6ae8862e59f7bbfc159da` | `deriveaddresses` for every descriptor in the Sparrow fixtures nullroute reads, read by the generator's own small readers, keys re-versioned to `tpub` | Derives the same addresses from its own reading of each file |

Before writing anything, the generator checks that Core's regtest addresses for
the converted test key carry the witness programs BIP-84 and BIP-86 publish, so
the conversion is known to be the BIP key.

## Gaps

What these fixtures show nullroute does not do, or does differently. None of
these is hidden by a test: each is asserted as it is.

1. **Caravan and Electrum wallet files are refused.** They carry extended keys
   and a policy but no descriptor, and this module reads descriptors and the
   Coldcard format only. Sparrow reads both.
2. **Specter DIY's `addwallet` text and a `Receive:`-labelled descriptor are
   refused.** Both wrap a descriptor this device would read on its own.
3. **The first address in a BSMS file is not compared.** BIP-129 has the signer
   check it. This module surfaces it as an unverified claim, and the comparison
   is left to the user on the import screen. Sparrow refuses
   `multisig-9.bsms` and `multisig-address-mismatch.bsms` for the mismatch;
   nullroute reads them.
4. **A BSMS file without a first address is read** (`multisig-14.bsms`), though
   BIP-129 says the line must be there.
5. **BSMS restrictions other than /0/*,/1/* are expanded as given** and the
   second is labelled change, which BIP-129 does not say. Fixed descriptors on
   other chains are read as one fixed address. Sparrow refuses all of these.
6. **A descriptor is read as written.** The 2020 Specter exports have no
   wildcard and the multisig one uses `multi()`. Sparrow reads them as an
   account with receive and change branches and as `sortedmulti()`; nullroute
   and Core read one fixed address and the keys in the order given. The two
   programs derive different addresses from `specter-multisig-wallet.json`.
   Current Specter Desktop writes its receive descriptor, with `/0/*` and a
   checksum (`Wallet.account_map` at cryptoadvance/specter-desktop
   `5d3d5b91e614991c2dedb87c0e0e608e2c6382ae`), so a current export has a
   wildcard to read.
7. **Keystone's zpub and uppercase fingerprint are kept as written.** The
   checksum is recomputed over that text, so it differs from the checksum of
   the same descriptor written with an xpub and a lowercase fingerprint.
8. **No file here comes from Nunchuk or from Sparrow's current descriptor
   export.** Nunchuk exports BSMS, which is covered as a format but not by a
   file Nunchuk wrote. Sparrow's current descriptor export puts `#` headings
   above its descriptors; that layout was misread as a Coldcard file, and is
   tested in `descriptor.coordinator.test.ts` with a file reconstructed from
   Sparrow's exporter source at the pinned commit, not captured.
