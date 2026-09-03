#!/usr/bin/env node
/**
 * The no-lock-in drill. INV-INTEROP-1.
 *
 * Takes a wallet nullroute created, hands its descriptor to a real Bitcoin
 * Core on regtest, and proves Core alone can find the money and spend it. No
 * nullroute code is in the recovery path: Core derives the addresses, Core
 * builds the spend, Core finalises and broadcasts it. nullroute's only job is
 * to produce a signature, which is the one thing a signing device is for.
 *
 * This is the most important test in the repository, and it is worth being
 * precise about why. Every other guarantee here is about nullroute behaving
 * correctly. This one is about nullroute being ABANDONABLE: if the project is
 * hit by a bus, if the code is lost, if a future version is backdoored, a user
 * with their mnemonic and a copy of Bitcoin Core still has their coins. A
 * verified wallet you cannot leave is a trap with good paperwork.
 *
 * IT MUST NEVER VACUOUSLY PASS. Without a reachable Core this exits non-zero
 * and says so. A drill that quietly skipped would put a green tick against the
 * one claim that, if false, means somebody's funds are unrecoverable.
 *
 * VERSIONS THIS HAS ACTUALLY BEEN RUN AGAINST, because "works with Bitcoin
 * Core" is not one claim. CI pins 28.0; the quorum drill below was written and
 * verified against 31.1.0. Those two have already disagreed once in this file:
 * `walletcreatefundedpsbt` on 31 refuses to invent a change address where 28
 * would, so the drill passed in CI and failed the first time anybody ran it
 * locally. The version is printed on every run for that reason.
 *
 * Run: make test-recovery-drill
 * Needs: bitcoind on regtest. In CI it is a service container. Locally:
 *   bitcoind -regtest -fallbackfee=0.0002 -rpcuser=nullroute -rpcpassword=drill
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const RPC_URL = process.env['BITCOIN_RPC_URL'] ?? 'http://127.0.0.1:18443'
const RPC_USER = process.env['BITCOIN_RPC_USER'] ?? 'nullroute'
const RPC_PASSWORD = process.env['BITCOIN_RPC_PASSWORD'] ?? 'drill'

/** A wallet nobody should ever fund. The all-zeros BIP-39 vector. */
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/**
 * Two more published vectors, so a quorum has three DISTINCT keys.
 *
 * A 2-of-3 built from one seed three times is not a 2-of-3, and it would pass a
 * drill written carelessly: the addresses derive, Core imports them, and the
 * one device signs twice. These are the other two BIP-39 test vectors, chosen
 * for the same reason as the first: published, worthless, and unmistakable in a
 * block explorer if anybody ever points this at a real chain by accident.
 */
const COSIGNER_MNEMONICS = [
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
]

/**
 * Script types drilled. All four the device will hand you.
 *
 * Taproot was absent for a long time, with a comment here saying signing one
 * "needs taproot PSBT fields the drill does not build yet". That was wrong in
 * two ways. This drill does not build the PSBT at all: Core does, with
 * `walletcreatefundedpsbt`, and Core populates the taproot fields when the
 * descriptor is tr(). And the signing path already handled taproot, because it
 * passes AUX_RAND to a library that does. Nobody had tried it.
 *
 * The gap mattered: the device hands out p2tr addresses, so an address type it
 * will happily give you had no proof that anybody could recover from it. That
 * is exactly the claim INV-INTEROP-1 makes.
 */
const SCRIPT_TYPES = ['p2wpkh', 'p2sh-p2wpkh', 'p2pkh', 'p2tr']

let rpcId = 0

async function rpc(method, params = [], wallet) {
  const url = wallet === undefined ? RPC_URL : `${RPC_URL}/wallet/${wallet}`
  const auth = Buffer.from(`${RPC_USER}:${RPC_PASSWORD}`).toString('base64')

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify({ jsonrpc: '1.0', id: `drill-${String(++rpcId)}`, method, params }),
    })
  } catch (err) {
    throw new Error(
      `Could not reach Bitcoin Core at ${RPC_URL}: ${err.message}\n\n` +
        `  The recovery drill proves that a wallet made here is recoverable with\n` +
        `  Core alone. It cannot be simulated, and it is not allowed to pass\n` +
        `  without running, so this is a failure rather than a skip.\n\n` +
        `  Start one:\n` +
        `    bitcoind -regtest -daemon -fallbackfee=0.0002 \\\n` +
        `      -rpcuser=${RPC_USER} -rpcpassword=${RPC_PASSWORD} -rpcport=18443\n`
    )
  }

  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Bitcoin Core returned non-JSON for ${method}: ${text.slice(0, 200)}`)
  }
  if (body.error !== null && body.error !== undefined) {
    throw new Error(`${method} failed: ${JSON.stringify(body.error)}`)
  }
  return body.result
}

/**
 * Ask nullroute for a wallet's descriptor and addresses.
 *
 * Run in a child process against the built core package, so that what is
 * compared is the code as it ships rather than something this script recreated.
 * The output is the ONLY thing nullroute contributes before signing.
 */
function nullrouteWallet(scriptType, network, count) {
  const script = `
    import { mnemonicToSeed, deriveAccountXpub, deriveAddresses, rootFromSeed,
             accountPath, normalizePath, withChecksum, networkById } from '@nullroute/core'
    const network = networkById(${JSON.stringify(network)})
    const seed = mnemonicToSeed(${JSON.stringify(MNEMONIC)}, '')
    const path = normalizePath(accountPath(${JSON.stringify(scriptType)}, network, 0))
    const account = deriveAccountXpub(seed, network, path)
    const root = rootFromSeed(seed, network)
    const key = root.derive(path)
    const addresses = deriveAddresses(key, {
      scriptType: ${JSON.stringify(scriptType)}, network, change: false, start: 0, count: ${String(count)},
    })
    root.wipePrivateData(); seed.dispose()
    const origin = '[' + account.masterFingerprint + path.slice(1) + ']'
    const wrap = (suffix) => {
      const inner = origin + account.xpub + suffix
      return ${JSON.stringify(scriptType)} === 'p2pkh' ? 'pkh(' + inner + ')'
        : ${JSON.stringify(scriptType)} === 'p2sh-p2wpkh' ? 'sh(wpkh(' + inner + '))'
        : ${JSON.stringify(scriptType)} === 'p2wpkh' ? 'wpkh(' + inner + ')'
        : 'tr(' + inner + ')'
    }
    console.log(JSON.stringify({
      descriptor: withChecksum(wrap('/0/*')),
      changeDescriptor: withChecksum(wrap('/1/*')),
      addresses: addresses.map((a) => a.address),
    }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`nullroute wallet derivation failed:\n${result.stderr}`)
  }
  return JSON.parse(result.stdout.trim())
}

/** Sign a PSBT with nullroute, in a child process against the shipped code. */
function nullrouteSign(psbtBase64, scriptType, network, paths) {
  const script = `
    import { mnemonicToSeed, signTransaction, reviewTransaction, parsePsbt,
             encodePsbt, accountPath, normalizePath, networkById, branchPath } from '@nullroute/core'
    const network = networkById(${JSON.stringify(network)})
    const seed = mnemonicToSeed(${JSON.stringify(MNEMONIC)}, '')
    const tx = parsePsbt(${JSON.stringify(psbtBase64)})
    const review = reviewTransaction(tx, { network, isChange: () => undefined })
    const result = signTransaction(tx, seed, {
      network,
      paths: ${JSON.stringify(paths)},
      review,
      overrideBlockingWarnings: true,
    })
    seed.dispose()
    console.log(JSON.stringify({ psbt: encodePsbt(result.psbt), inputsSigned: result.inputsSigned }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`nullroute signing failed:\n${result.stderr}`)
  }
  return JSON.parse(result.stdout.trim())
}

/**
 * The multisig account key for one mnemonic, as a descriptor key expression.
 *
 * m/48'/1'/0'/2' on regtest, which is BIP-48's native segwit multisig branch.
 * Returned with its origin already attached, because a key without one cannot
 * be traced back to a seed and a device restoring later cannot tell whether it
 * holds it.
 */
function nullrouteQuorumKey(mnemonic, network) {
  const script = `
    import { mnemonicToSeed, deriveAccountXpub, normalizePath, networkById } from '@nullroute/core'
    const network = networkById(${JSON.stringify(network)})
    const seed = mnemonicToSeed(${JSON.stringify(mnemonic)}, '')
    const path = normalizePath("m/48'/" + (network.id === 'mainnet' ? '0' : '1') + "'/0'/2'")
    const account = deriveAccountXpub(seed, network, path)
    seed.dispose()
    console.log(JSON.stringify({
      keyExpression: '[' + account.masterFingerprint + path.slice(1) + ']' + account.xpub,
      fingerprint: account.masterFingerprint,
      path,
    }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`nullroute quorum key derivation failed:\n${result.stderr}`)
  }
  return JSON.parse(result.stdout.trim())
}

/**
 * Assemble a quorum ON THE DEVICE, with the code the device ships.
 *
 * Deliberately assembleQuorum rather than a string built here. The point of the
 * drill is that the artefact the device produces is the one Core accepts, and a
 * descriptor the drill wrote itself would prove the drill can write descriptors.
 */
function nullrouteAssemble(keys, threshold, branch) {
  const script = `
    import { assembleQuorum, withChecksum } from '@nullroute/core'
    const built = assembleQuorum({
      threshold: ${String(threshold)},
      keys: ${JSON.stringify(keys.map((key) => key + '/<0;1>/*'))},
    })
    // The multipath form is what the device holds and what every cosigner
    // compares. Core takes one branch at a time, so both are written out here
    // from the SAME assembled key order rather than assembled twice.
    const single = (index) => withChecksum(
      built.descriptor.slice(0, built.descriptor.lastIndexOf('#'))
        .replaceAll('/<0;1>/*', '/' + index + '/*')
    )
    console.log(JSON.stringify({
      descriptor: built.descriptor,
      checksum: built.checksum,
      receive: single(0),
      change: single(1),
    }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`nullroute quorum assembly failed:\n${result.stderr}`)
  }
  const built = JSON.parse(result.stdout.trim())
  void branch
  return built
}

/**
 * A TAPROOT quorum, as a coordinator writes one.
 *
 * assembleQuorum deliberately builds only wsh and sh(wsh), so this is not the
 * device assembling: it is the device being handed a descriptor to register,
 * derive from and sign, which is how a taproot quorum actually arrives.
 *
 * The internal key is a NUMS point with no known discrete log, which is what
 * makes this script-path only: nobody can spend it through the key path, so the
 * 2-of-3 in the leaf is the only way to move the money.
 */
function nullrouteTaprootQuorum(keys, threshold) {
  const NUMS = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'
  const script = `
    import { withChecksum } from '@nullroute/core'
    const keys = ${JSON.stringify(keys)}
    const wrap = (suffix) => withChecksum(
      'tr(${NUMS},sortedmulti_a(${String(threshold)},' +
        keys.map((k) => k + suffix).join(',') + '))'
    )
    const full = wrap('/<0;1>/*')
    console.log(JSON.stringify({
      descriptor: full,
      checksum: full.slice(full.lastIndexOf('#') + 1),
      receive: wrap('/0/*'),
      change: wrap('/1/*'),
    }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`taproot quorum construction failed:\n${result.stderr}`)
  }
  return JSON.parse(result.stdout.trim())
}

/**
 * Derive quorum addresses with the device's own code, for comparison with Core.
 *
 * Through deriveQuorumAddresses, the one place that dispatches on script kind.
 * The drill used the wsh function unconditionally, which is why it could never
 * have caught a taproot quorum being undisplayable: it could not build one.
 */
function nullrouteQuorumAddresses(descriptor, network, count) {
  const script = `
    import { parseDescriptor, deriveQuorumAddresses, networkById } from '@nullroute/core'
    const network = networkById(${JSON.stringify(network)})
    const parsed = parseDescriptor(${JSON.stringify(descriptor)})
    const derived = deriveQuorumAddresses(parsed, {
      network, change: false, start: 0, count: ${String(count)},
    })
    console.log(JSON.stringify(derived.map((a) => a.address)))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`nullroute quorum address derivation failed:\n${result.stderr}`)
  }
  return JSON.parse(result.stdout.trim())
}

/** Sign a quorum PSBT as ONE cosigner, with that cosigner's mnemonic. */
function nullrouteQuorumSign(psbtBase64, mnemonic, network, paths) {
  const script = `
    import { mnemonicToSeed, signTransaction, reviewTransaction, parsePsbt,
             encodePsbt, networkById } from '@nullroute/core'
    const network = networkById(${JSON.stringify(network)})
    const seed = mnemonicToSeed(${JSON.stringify(mnemonic)}, '')
    const tx = parsePsbt(${JSON.stringify(psbtBase64)})
    const review = reviewTransaction(tx, { network, isChange: () => undefined })
    const result = signTransaction(tx, seed, {
      network,
      paths: ${JSON.stringify(paths)},
      review,
      overrideBlockingWarnings: true,
    })
    seed.dispose()
    console.log(JSON.stringify({ psbt: encodePsbt(result.psbt), inputsSigned: result.inputsSigned }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`nullroute quorum signing failed:\n${result.stderr}`)
  }
  return JSON.parse(result.stdout.trim())
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ensureWallet(name, options = {}) {
  const existing = await rpc('listwallets')
  if (existing.includes(name)) return
  try {
    await rpc('createwallet', [
      name,
      options.disablePrivateKeys ?? false,
      options.blank ?? false,
      '',
      false,
      true,
      true,
    ])
  } catch (err) {
    // Already on disk from a previous run.
    if (!/already exists|Database already/i.test(err.message)) throw err
    await rpc('loadwallet', [name])
  }
}

/**
 * A suffix unique to this run, so every watch-only wallet is a fresh one.
 *
 * Re-importing a descriptor into a wallet that already holds it fails with
 * "new range must include current range", which is Core protecting a keypool
 * and is a confusing way for a drill to fail. Running against a node that has
 * seen an earlier attempt is the normal case on a developer machine, and a
 * check that only passes on a clean node is a check people learn to distrust.
 *
 * Date.now() is fine here and banned in packages/: this is a tool, and nothing
 * it produces goes into the reproducible build.
 */
const RUN = Date.now().toString(36)

async function drill(scriptType) {
  const label = scriptType.padEnd(12)
  const wallet = nullrouteWallet(scriptType, 'regtest', 5)

  // --- Core derives the addresses, and they must be identical -------------
  //
  // This is the heart of the drill. If Core and nullroute disagree here, a
  // user restoring from the descriptor is looking at a different wallet.
  const coreAddresses = await rpc('deriveaddresses', [wallet.descriptor, [0, 4]])
  for (const [i, address] of wallet.addresses.entries()) {
    if (coreAddresses[i] !== address) {
      throw new Error(
        `${scriptType}: Core derived a different address at index ${String(i)}.\n` +
          `  nullroute: ${address}\n  core:      ${coreAddresses[i]}`
      )
    }
  }

  // --- Core imports it as a watch-only wallet ------------------------------
  //
  // BOTH branches, and marked ACTIVE. That is what recovering a wallet actually
  // looks like: the change branch is the one a wallet has to recognise as its
  // own, and a recovery that imported only receive addresses would find the
  // money and then be unable to tell its own change from a stranger's.
  //
  // It also has to be this way for Core to build a spend at all. With only an
  // inactive external descriptor, `walletcreatefundedpsbt` on Core 31 fails
  // with "Transaction needs a change address, but we can't generate it", which
  // is Core correctly refusing to invent a destination for the remainder. Core
  // 28, which CI pins, was more forgiving, so the drill passed there and failed
  // the first time anybody ran it against a newer node.
  const watchName = `drill-${scriptType}-${RUN}`
  await ensureWallet(watchName, { disablePrivateKeys: true, blank: true })
  const imported = await rpc(
    'importdescriptors',
    [
      [
        {
          desc: wallet.descriptor,
          timestamp: 'now',
          range: [0, 20],
          active: true,
          internal: false,
        },
        {
          desc: wallet.changeDescriptor,
          timestamp: 'now',
          range: [0, 20],
          active: true,
          internal: true,
        },
      ],
    ],
    watchName
  )
  if (imported.some((entry) => entry.success !== true)) {
    throw new Error(`${scriptType}: Core refused the descriptor: ${JSON.stringify(imported)}`)
  }

  // --- Fund it -------------------------------------------------------------
  const target = wallet.addresses[0]
  await rpc('sendtoaddress', [target, 0.5], 'drill-funding')
  await rpc(
    'generatetoaddress',
    [6, await rpc('getnewaddress', [], 'drill-funding')],
    'drill-funding'
  )

  // Core, not nullroute, decides what this wallet owns.
  let balance = 0
  for (let attempt = 0; attempt < 20 && balance === 0; attempt += 1) {
    balance = await rpc('getbalance', ['*', 1, true], watchName)
    if (balance === 0) await sleep(250)
  }
  if (balance <= 0) {
    throw new Error(`${scriptType}: Core sees no balance for the imported descriptor.`)
  }

  // --- Core builds the spend ----------------------------------------------
  const destination = await rpc('getnewaddress', [], 'drill-funding')
  // change_type has to match the descriptor, because Core otherwise reaches for
  // a bech32 change address and a wallet holding only sh(wpkh()) descriptors has
  // none. Real recovery has the same constraint: change goes back to the branch
  // that was imported, not to whatever the node would prefer.
  const CHANGE_TYPE = {
    p2pkh: 'legacy',
    'p2sh-p2wpkh': 'p2sh-segwit',
    p2wpkh: 'bech32',
    p2tr: 'bech32m',
  }
  const funded = await rpc(
    'walletcreatefundedpsbt',
    [
      [],
      [{ [destination]: 0.1 }],
      0,
      {
        includeWatching: true,
        subtractFeeFromOutputs: [0],
        change_type: CHANGE_TYPE[scriptType],
      },
    ],
    watchName
  )

  // --- nullroute signs, and that is all it does ---------------------------
  //
  // The index is read out of the PSBT rather than assumed to be 0. Core chooses
  // which UTXO to spend, and on a node that has seen an earlier run it can
  // reasonably choose a different one. A drill that assumed index 0 failed with
  // "none of the derivation paths matched", which reads as a signing bug and is
  // actually the drill telling the device to sign with the wrong key.
  const decoded = await rpc('decodepsbt', [funded.psbt])
  // Taproot writes its derivations under a DIFFERENT key. PSBT v0 has
  // PSBT_IN_BIP32_DERIVATION for everything else and PSBT_IN_TAP_BIP32_DERIVATION
  // for taproot, and Core surfaces them as two separate fields. Reading only the
  // first reports a correctly built taproot PSBT as having no derivations at
  // all, which is what happened here first.
  const derivations = (decoded.inputs ?? []).flatMap((input) => [
    ...(input.bip32_derivs ?? []).map((entry) => entry.path),
    ...(input.taproot_bip32_derivs ?? []).map((entry) => entry.path),
  ])
  if (derivations.length === 0) {
    throw new Error(
      `${scriptType}: Core built a PSBT with no BIP-32 derivations, so nothing identifies which ` +
        `key signs it. That is a broken import rather than a signing problem.`
    )
  }
  const signed = nullrouteSign(funded.psbt, scriptType, 'regtest', derivations)
  if (signed.inputsSigned < 1) {
    throw new Error(`${scriptType}: nullroute signed nothing.`)
  }

  // --- Core finalises and broadcasts --------------------------------------
  const finalised = await rpc('finalizepsbt', [signed.psbt])
  if (finalised.complete !== true) {
    throw new Error(
      `${scriptType}: Core could not finalise the signed PSBT. The signature nullroute ` +
        `produced is not one Core accepts.`
    )
  }
  const txid = await rpc('sendrawtransaction', [finalised.hex])
  await rpc(
    'generatetoaddress',
    [1, await rpc('getnewaddress', [], 'drill-funding')],
    'drill-funding'
  )

  const confirmed = await rpc('gettransaction', [txid, true], watchName)
  if ((confirmed.confirmations ?? 0) < 1) {
    throw new Error(`${scriptType}: the spend did not confirm.`)
  }

  console.log(
    `  ok      ${label} Core derived ${String(coreAddresses.length)} identical addresses, spent ${txid.slice(0, 16)}...`
  )
  return { scriptType, txid, addresses: coreAddresses.length }
}

/**
 * The drill that matters most for a fleet, and the one that did not exist.
 *
 * INV-INTEROP-2. A quorum is recoverable from its descriptor, and its threshold
 * is the one that was asked for.
 *
 * A 2-of-3 CANNOT BE REBUILT FROM MNEMONICS. Holding all three seed phrases is
 * not enough: the other keys, the threshold and the script type live only in
 * the descriptor. So the single-signature drill above, which proves a mnemonic
 * plus Core recovers a wallet, proves nothing at all about a quorum. Every one
 * of the four bugs found in the multisig screens this week lived on a path
 * nothing here exercised.
 *
 * THREE DISTINCT SEEDS, and that is not a detail. A 2-of-3 assembled from one
 * seed three times derives, imports and signs perfectly, and is a 1-of-1 with
 * extra steps. The drill would have passed.
 *
 * TWO DIFFERENT DEVICES SIGN, sequentially, exactly as a fleet does it: the
 * first signs and hands the partial PSBT on, the second signs the same PSBT,
 * and only then does Core finalise. Signing twice with one seed would pass a
 * carelessly written version of this and prove nothing about a quorum.
 *
 * Core does all the recovery: Core derives the addresses, Core builds the
 * spend, Core finalises and broadcasts. nullroute assembles the descriptor and
 * produces two signatures.
 */
async function drillQuorum(kind = 'wsh') {
  const network = 'regtest'
  const mnemonics = [MNEMONIC, ...COSIGNER_MNEMONICS]
  const keys = mnemonics.map((mnemonic) => nullrouteQuorumKey(mnemonic, network))

  // Three distinct seeds produce three distinct fingerprints. Asserted rather
  // than assumed, because the failure it guards against is a drill that looks
  // like it tests a quorum and tests one key.
  const fingerprints = new Set(keys.map((key) => key.fingerprint))
  if (fingerprints.size !== 3) {
    throw new Error(
      `quorum: the three cosigners share a key. ${String(fingerprints.size)} distinct ` +
        `fingerprints among three mnemonics means this drill would be testing a 1-of-1.`
    )
  }

  // wsh is what the device ASSEMBLES. A taproot quorum arrives from a
  // coordinator instead, because assembleQuorum deliberately builds only wsh
  // and sh(wsh), so the drill constructs one the same way a coordinator would
  // and hands it to the device to register, derive and sign.
  const quorum =
    kind === 'tr'
      ? nullrouteTaprootQuorum(
          keys.map((key) => key.keyExpression),
          2
        )
      : nullrouteAssemble(
          keys.map((key) => key.keyExpression),
          2
        )

  // --- Core derives the addresses, and they must be identical --------------
  //
  // The heart of it, same as the single-signature drill. If Core and the device
  // disagree here, money sent to an address the device displayed is invisible
  // to the wallet somebody recovers with.
  const ours = nullrouteQuorumAddresses(quorum.receive, network, 5)
  const theirs = await rpc('deriveaddresses', [quorum.receive, [0, 4]])
  for (const [index, address] of ours.entries()) {
    if (theirs[index] !== address) {
      throw new Error(
        `quorum: Core derived a different address at index ${String(index)}.\n` +
          `  nullroute: ${address}\n  core:      ${theirs[index]}`
      )
    }
  }

  // --- Core imports the quorum as watch-only -------------------------------
  const watchName = `drill-quorum-${RUN}`
  await ensureWallet(watchName, { disablePrivateKeys: true, blank: true })
  const imported = await rpc(
    'importdescriptors',
    [
      [
        { desc: quorum.receive, timestamp: 'now', range: [0, 20], active: true, internal: false },
        { desc: quorum.change, timestamp: 'now', range: [0, 20], active: true, internal: true },
      ],
    ],
    watchName
  )
  if (imported.some((entry) => entry.success !== true)) {
    throw new Error(`quorum: Core refused the descriptor: ${JSON.stringify(imported)}`)
  }

  // --- Fund it -------------------------------------------------------------
  await rpc('sendtoaddress', [ours[0], 0.5], 'drill-funding')
  await rpc(
    'generatetoaddress',
    [6, await rpc('getnewaddress', [], 'drill-funding')],
    'drill-funding'
  )

  let balance = 0
  for (let attempt = 0; attempt < 20 && balance === 0; attempt += 1) {
    balance = await rpc('getbalance', ['*', 1, true], watchName)
    if (balance === 0) await sleep(250)
  }
  if (balance <= 0) {
    throw new Error('quorum: Core sees no balance for the imported quorum descriptor.')
  }

  // --- Core builds the spend ----------------------------------------------
  const destination = await rpc('getnewaddress', [], 'drill-funding')
  const funded = await rpc(
    'walletcreatefundedpsbt',
    [
      [],
      [{ [destination]: 0.1 }],
      0,
      {
        includeWatching: true,
        subtractFeeFromOutputs: [0],
        // P2WSH is bech32; a taproot quorum pays to bech32m.
        change_type: kind === 'tr' ? 'bech32m' : 'bech32',
      },
    ],
    watchName
  )

  const decoded = await rpc('decodepsbt', [funded.psbt])
  // Taproot writes its derivations under a DIFFERENT key, and reading only the
  // classic field reports a correctly built taproot PSBT as having none.
  const derivations = (decoded.inputs ?? []).flatMap((input) => [
    ...(input.bip32_derivs ?? []).map((entry) => ({
      path: entry.path,
      fingerprint: entry.master_fingerprint,
    })),
    ...(input.taproot_bip32_derivs ?? []).map((entry) => ({
      path: entry.path,
      fingerprint: entry.master_fingerprint,
    })),
  ])
  if (derivations.length === 0) {
    throw new Error(
      'quorum: Core built a PSBT with no BIP-32 derivations, so nothing identifies which keys ' +
        'sign it. That is a broken import rather than a signing problem.'
    )
  }

  // --- Two DIFFERENT devices sign, one after the other ---------------------
  //
  // Each is given only the paths belonging to its own fingerprint. Handing a
  // device every path in the PSBT would let one seed appear to satisfy the
  // quorum, which is the thing being disproved.
  let psbt = funded.psbt
  let signedBy = 0
  for (const index of [0, 1]) {
    const key = keys[index]
    const mine = derivations
      .filter((entry) => entry.fingerprint?.toLowerCase() === key.fingerprint.toLowerCase())
      .map((entry) => entry.path)
    if (mine.length === 0) {
      throw new Error(
        `quorum: no input names cosigner ${String(index + 1)}'s fingerprint ${key.fingerprint}, ` +
          `so this device has nothing to sign and the quorum Core imported is not the one built.`
      )
    }
    const result = nullrouteQuorumSign(psbt, mnemonics[index], network, mine)
    if (result.inputsSigned < 1) {
      throw new Error(`quorum: cosigner ${String(index + 1)} signed nothing.`)
    }
    psbt = result.psbt
    signedBy += 1

    // INV-INTEROP-2. After ONE signature a 2-of-3 must not finalise. If it
    // does, the threshold is not what the descriptor says and one device can
    // spend the money.
    if (index === 0) {
      const early = await rpc('finalizepsbt', [psbt])
      if (early.complete === true) {
        throw new Error(
          'quorum: Core finalised a 2-of-3 after ONE signature. The threshold in the built ' +
            'descriptor is not the one that was asked for, and one device can spend this money.'
        )
      }
    }
  }

  // --- Core finalises and broadcasts --------------------------------------
  const finalised = await rpc('finalizepsbt', [psbt])
  if (finalised.complete !== true) {
    throw new Error(
      'quorum: Core could not finalise the PSBT after two signatures. The signatures nullroute ' +
        'produced are not ones Core accepts for this quorum.'
    )
  }
  const txid = await rpc('sendrawtransaction', [finalised.hex])
  await rpc(
    'generatetoaddress',
    [1, await rpc('getnewaddress', [], 'drill-funding')],
    'drill-funding'
  )

  const confirmed = await rpc('gettransaction', [txid, true], watchName)
  if ((confirmed.confirmations ?? 0) < 1) {
    throw new Error('quorum: the spend did not confirm.')
  }

  const label = kind === 'tr' ? '2-of-3 tr  ' : '2-of-3 wsh '
  console.log(
    `  ok      ${label}  checksum ${quorum.checksum}, ${String(ours.length)} identical ` +
      `addresses, ${String(signedBy)} devices signed, spent ${txid.slice(0, 16)}...`
  )
  return { scriptType: `2-of-3 ${kind}`, txid, addresses: ours.length }
}

async function main() {
  console.log('\nnullroute recovery drill (INV-INTEROP-1)\n')

  const info = await rpc('getblockchaininfo')
  if (info.chain !== 'regtest') {
    throw new Error(
      `Refusing to drill against chain "${info.chain}". This funds and spends coins and ` +
        `must only ever run on regtest.`
    )
  }
  const version = await rpc('getnetworkinfo')
  console.log(`  Bitcoin Core ${String(version.subversion ?? version.version)} on regtest\n`)

  // A funding wallet with keys, distinct from every watch-only wallet under
  // test, so nothing in the recovery path can accidentally borrow its keys.
  await ensureWallet('drill-funding')
  const height = (await rpc('getblockchaininfo')).blocks
  if (height < 101) {
    await rpc(
      'generatetoaddress',
      [101 - height + 1, await rpc('getnewaddress', [], 'drill-funding')],
      'drill-funding'
    )
  }

  const results = []
  for (const scriptType of SCRIPT_TYPES) {
    results.push(await drill(scriptType))
  }

  // The quorums, last, because they are the longest and the ones whose failure
  // is most informative once the simple cases are known to work.
  results.push(await drillQuorum('wsh'))
  results.push(await drillQuorum('tr'))

  console.log(
    `\n  ${String(results.length)} of ${String(results.length)} wallet kinds recovered and spent with Core alone.`
  )

  console.log('recovery drill passed\n')
}

main().catch((err) => {
  console.error(`\nrecovery drill FAILED\n\n${err.message}\n`)
  process.exit(1)
})
