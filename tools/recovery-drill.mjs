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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ensureWallet(name, options = {}) {
  const existing = await rpc('listwallets')
  if (existing.includes(name)) return
  try {
    await rpc('createwallet', [name, options.disablePrivateKeys ?? false, options.blank ?? false, '', false, true, true])
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
  await rpc('generatetoaddress', [6, await rpc('getnewaddress', [], 'drill-funding')], 'drill-funding')

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
  await rpc('generatetoaddress', [1, await rpc('getnewaddress', [], 'drill-funding')], 'drill-funding')

  const confirmed = await rpc('gettransaction', [txid, true], watchName)
  if ((confirmed.confirmations ?? 0) < 1) {
    throw new Error(`${scriptType}: the spend did not confirm.`)
  }

  console.log(`  ok      ${label} Core derived ${String(coreAddresses.length)} identical addresses, spent ${txid.slice(0, 16)}...`)
  return { scriptType, txid, addresses: coreAddresses.length }
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
    await rpc('generatetoaddress', [101 - height + 1, await rpc('getnewaddress', [], 'drill-funding')], 'drill-funding')
  }

  const results = []
  for (const scriptType of SCRIPT_TYPES) {
    results.push(await drill(scriptType))
  }

  console.log(`\n  ${String(results.length)} of ${String(results.length)} script types recovered and spent with Core alone.`)

  console.log('recovery drill passed\n')
}

main().catch((err) => {
  console.error(`\nrecovery drill FAILED\n\n${err.message}\n`)
  process.exit(1)
})
