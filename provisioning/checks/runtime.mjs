/**
 * The verifiers that can only be answered by a device that has booted.
 *
 * WHY THESE ARE LAST. Fifteen of the eighteen verifiers read an artifact at
 * rest. These three cannot, and provisioning/README.md has always said so:
 * mount flags, swap and listening sockets are properties of a running kernel,
 * and an offline scan of a root filesystem answers all three confidently and
 * wrongly. CLAUDE.md records the specific failure: the scan reports `noexec`
 * and `nosuid` as passing while the same scan reports the partition does not
 * exist, because there is no /proc/mounts for it to disagree with.
 *
 * SO THE EVIDENCE COMES FROM A BOOT AND THE VERDICT IS REACHED HERE. The guest
 * runs provisioning/units/runtime-facts, which prints six kernel files to the
 * console and judges nothing. This module parses that console log and decides.
 * The split is the point: the image is the artifact under test, and an artifact
 * that grades itself has been asked the one question it cannot be trusted to
 * answer. Raw evidence in a log can be re-judged by anyone; a PASS printed by a
 * script inside the image can only be believed.
 *
 * It also keeps node out of the build container, which has none. The container
 * boots the card and saves the console; the host reads it.
 */

/**
 * @typedef {object} Verdict
 * @property {string} check
 * @property {boolean} ok
 * @property {string} detail
 * @property {string[]} limits
 * @property {boolean} [unavailable]
 */

/** @returns {Verdict} */
function verdict(check, ok, detail, limits = []) {
  return { check, ok, detail, limits }
}

/**
 * Could-not-run, which is never a pass. Same three-state contract as rootfs.mjs:
 * "no console log was given" and "the device has swap on" must not print the
 * same colour, because the pressure to clear a red that means "you did not run
 * this" is pressure to make not running it succeed.
 *
 * @returns {Verdict}
 */
function unavailable(check, detail, limits = []) {
  return { check, ok: false, unavailable: true, detail, limits }
}

/**
 * Console output carries systemd's colour codes.
 *
 * Written as \u001b rather than the byte itself, so the source has no invisible
 * character in it: the literal form is what made an earlier version of this
 * file impossible to paste through a shell, and a control character nobody can
 * see is a poor thing to leave in a regex somebody will edit later.
 */
// eslint-disable-next-line no-control-regex -- matching them is the point
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

/**
 * Pull the runtime facts out of a boot console log.
 *
 * THE MARKER IS SEARCHED FOR ANYWHERE IN A LINE, not anchored to the start,
 * because by the time this text reaches a console it has a kernel timestamp, a
 * program name, a pid and possibly a colour escape in front of it:
 *
 *   [   96.2969] runtime-facts[301]: nullroute-facts swaps| Filename ...
 *
 * TRUNCATION IS THE FAILURE THIS GUARDS AGAINST. A log cut off mid-dump, by a
 * harness timeout or a panic, is indistinguishable from a device with no swap
 * and no listening sockets: both have zero rows. So each section is only
 * usable if its "complete" line arrived AND the count in that line matches the
 * number of rows actually parsed. A short read is an error, never an empty set.
 *
 * @param {string} text
 */
export function parseFacts(text) {
  const sections = new Map()
  const claimed = new Map()
  let began = false
  let ended = false

  for (const raw of text.split('\n')) {
    // THE CARRIAGE RETURN, WHICH COST A WHOLE BOOT TO FIND. A serial console
    // ends its lines CRLF, so splitting on \n leaves \r on the end of every
    // one. In JavaScript `.` does not match \r, it is a line terminator like
    // \n, so the `(.*)$` below matched NOTHING on a real log: every section
    // parsed as zero rows against a count the device had printed correctly,
    // and all three verifiers reported the log as truncated.
    //
    // Forty-five tests passed throughout, because every fixture in them was
    // built by joining strings with \n. The device was the only thing that
    // produced the real bytes, which is the argument for booting it.
    const line = raw.replace(/\r/g, '').replace(ANSI, '')

    if (line.includes('nullroute-facts: begin')) {
      began = true
      continue
    }
    if (line.includes('nullroute-facts: end')) {
      ended = true
      continue
    }

    const complete = /nullroute-facts: section ([a-z0-9]+) complete, (\d+) line\(s\)/.exec(line)
    if (complete !== null) {
      claimed.set(complete[1], Number(complete[2]))
      continue
    }

    const row = /nullroute-facts ([a-z0-9]+)\| (.*)$/.exec(line)
    if (row !== null) {
      const name = row[1]
      if (!sections.has(name)) sections.set(name, [])
      sections.get(name).push(row[2])
    }
  }

  /**
   * A section is only readable if the guest said it finished and the arithmetic
   * agrees. Returns null otherwise, and every verifier treats null as
   * could-not-run rather than as an empty file.
   */
  const section = (name) => {
    if (!claimed.has(name)) return null
    const rows = sections.get(name) ?? []
    return claimed.get(name) === rows.length ? rows : null
  }

  return { began, ended, section, claimed }
}

/** Shared preamble check: was this log produced by a boot that ran the dumper? */
function usable(check, facts, name) {
  if (!facts.began || !facts.ended) {
    return unavailable(
      check,
      'the console log has no complete nullroute-facts block, so the device ' +
        'either did not run nullroute-runtime-facts.service or did not finish booting'
    )
  }
  const rows = facts.section(name)
  if (rows === null) {
    const claimed = facts.claimed.get(name)
    return unavailable(
      check,
      claimed === undefined
        ? `the facts block carries no ${name} section`
        : `the ${name} section is truncated: the device said ${String(claimed)} line(s) and the log holds fewer`
    )
  }
  // AN EMPTY SECTION IS AN UNREADABLE FILE, NOT AN EMPTY ONE, and this was a
  // false pass sitting in the file written to prevent false passes.
  //
  // The dumper skips a /proc file it cannot read and still prints "section
  // swaps complete, 0 line(s)", which is well-formed and internally consistent.
  // The line-count guard above cannot catch it, because zero lines claimed and
  // zero lines parsed agree perfectly. no-swap then read that as "no swap area
  // is active" and no-listening-sockets as "nothing listens outside AF_UNIX",
  // both green, both about a device nothing had looked at.
  //
  // All six files are non-empty on any booted Linux: /proc/swaps and the four
  // socket tables each carry a header row even when they hold nothing, and
  // /proc/self/mountinfo cannot be empty in a process that has a root. So zero
  // rows is not a state the device can legitimately be in.
  if (rows.length === 0) {
    return unavailable(
      check,
      `the ${name} section is empty, and it cannot legitimately be: every one of ` +
        'these files carries at least a header row on a booted system. The device ' +
        'could not read it.'
    )
  }
  return null
}

/** Sampling is the limit every verifier here shares, and it is a real one. */
const SAMPLED = [
  'one sample, taken once, after the bridge started. A mount remounted later, ' +
    'a swap file enabled later, or a socket opened only while signing would not appear in it.',
]

/**
 * INV-PROV-12. The named mounts are the named filesystem with the named flags.
 *
 * READS mountinfo RATHER THAN /proc/mounts, because /proc/mounts folds the
 * per-mount flags and the superblock's options into one field and the enforced
 * one is the per-mount flag. mountinfo keeps them apart: field 6 is the mount's
 * own, everything after the "-" belongs to the superblock. A filesystem mounted
 * twice with different flags is only describable in the second form.
 */
export function mountOptions(facts, params = {}) {
  const check = 'mount-options'
  const blocked = usable(check, facts, 'mountinfo')
  if (blocked !== null) return blocked

  const wanted = params.mounts ?? []
  if (wanted.length === 0) return unavailable(check, 'the assertion named no mounts to check')

  const rows = facts.section('mountinfo')
  const parsed = []
  for (const row of rows) {
    const fields = row.split(' ')
    const dash = fields.indexOf('-')
    if (dash === -1 || fields.length < dash + 2) continue
    parsed.push({
      point: unoctal(fields[4] ?? ''),
      options: (fields[5] ?? '').split(','),
      fstype: fields[dash + 1] ?? '',
    })
  }

  const problems = []
  for (const want of wanted) {
    // THE LAST ONE, NOT THE FIRST. Mounts shadow: if something is mounted over
    // /tmp after the tmpfs, the later mount is what a process writing to /tmp
    // gets, and checking the first match would report the flags of a filesystem
    // nobody can reach any more.
    const found = parsed.filter((entry) => entry.point === want.path).at(-1)
    if (found === undefined) {
      problems.push(`${want.path} is not mounted at all`)
      continue
    }
    if (want.fstype !== undefined && found.fstype !== want.fstype) {
      problems.push(`${want.path} is ${found.fstype}, not ${want.fstype}`)
    }
    const missing = (want.options ?? []).filter((option) => !found.options.includes(option))
    if (missing.length > 0) {
      problems.push(
        `${want.path} is missing ${missing.join(', ')} (has ${found.options.join(',')})`
      )
    }
  }

  const summary = wanted.map((want) => want.path).join(', ')
  return problems.length === 0
    ? verdict(
        check,
        true,
        `${summary}: each is the expected filesystem with the expected flags`,
        SAMPLED
      )
    : verdict(check, false, problems.join('; '), SAMPLED)
}

/**
 * mountinfo octal-escapes space, tab, newline and backslash in paths. Nothing
 * on this device has such a path, which is exactly why it is decoded here: the
 * day one appears, a raw comparison would silently stop matching.
 */
function unoctal(value) {
  return value.replace(/\\(\d{3})/g, (_, digits) => String.fromCharCode(parseInt(digits, 8)))
}

/**
 * INV-PROV-11. No swap is active.
 *
 * /proc/swaps is a header line and one row per active area. Zero rows is the
 * claim. A swap file that exists on disk but was never swapped on is not here,
 * and that is correct: this asks what the kernel is using, and the file's
 * existence is INV-PROV-11's build-time half, checked by absent-paths.
 */
export function noSwap(facts) {
  const check = 'no-swap'
  const blocked = usable(check, facts, 'swaps')
  if (blocked !== null) return blocked

  const rows = facts.section('swaps')
  const active = rows.slice(1).filter((row) => row.trim() !== '')

  return active.length === 0
    ? verdict(check, true, 'no swap area is active', SAMPLED)
    : verdict(
        check,
        false,
        `${String(active.length)} swap area(s) active: ${active.join(' | ')}`,
        SAMPLED
      )
}

/** TCP_LISTEN, the only state in /proc/net/tcp that means a server. */
const TCP_LISTEN = '0A'

/**
 * INV-PROV-15. Exactly the permitted sockets listen outside AF_UNIX.
 *
 * WHAT THIS ASSERTION USED TO SAY, because the correction is the finding: "zero
 * sockets listen on any address family other than AF_UNIX". No device that
 * boots can satisfy that. The kiosk browser loads http://127.0.0.1:5180/ and
 * nullroute-bridge.service answers it, because Chromium cannot be pointed at a
 * Unix socket. The assertion had been asserting the negation of a thing the
 * image is built to do, and it survived precisely because this verifier did not
 * exist. An assertion nothing runs is unchecked, not weakly checked.
 *
 * BOTH DIRECTIONS ARE CHECKED. Every listener found must be permitted, and
 * every permitted listener must be found. The second half is not symmetry for
 * its own sake: without it, a log taken before the bridge binds shows no
 * listeners at all and passes, which is the false pass this file was written to
 * avoid rather than to demonstrate.
 */
export function noListeningSockets(facts, params = {}) {
  const check = 'no-listening-sockets'
  for (const name of ['tcp', 'tcp6', 'udp', 'udp6']) {
    const blocked = usable(check, facts, name)
    if (blocked !== null) return blocked
  }

  const found = []
  // AN ADDRESS THIS CANNOT DECODE IS A FAILURE, NOT A SKIP, and that is a
  // correction. The first version dropped an unparseable local_address and
  // carried on, so a listening socket whose address field was any length other
  // than 8 or 32 characters became invisible and the check passed with
  // "nothing listens outside AF_UNIX". Found by fumbling a test fixture into 34
  // characters and watching a listener disappear.
  //
  // Silently ignoring the row you failed to understand is how a verifier
  // reports on the sockets it happened to recognise while claiming to report on
  // all of them.
  const undecodable = []

  for (const name of ['tcp', 'tcp6']) {
    for (const row of facts.section(name).slice(1)) {
      const fields = row.trim().split(/\s+/)
      if (fields[3] !== TCP_LISTEN) continue
      const local = decodeAddress(fields[1] ?? '')
      if (local === null) undecodable.push(`${name} ${fields[1] ?? '(no address field)'}`)
      else found.push({ ...local, proto: name })
    }
  }
  // UDP HAS NO LISTEN STATE. A bound UDP socket receives whatever arrives at
  // it, so every row here is a socket the outside could reach if there were a
  // route. Treating them all as listeners is the strict reading, and on a
  // device with no network the honest expectation is that there are none.
  for (const name of ['udp', 'udp6']) {
    for (const row of facts.section(name).slice(1)) {
      const fields = row.trim().split(/\s+/)
      const local = decodeAddress(fields[1] ?? '')
      if (local === null) undecodable.push(`${name} ${fields[1] ?? '(no address field)'}`)
      else if (local.port !== 0) found.push({ ...local, proto: name })
    }
  }

  const allow = params.allow ?? []
  const permitted = (entry) =>
    allow.some((rule) => rule.address === entry.address && Number(rule.port) === entry.port)

  const routable = found.filter((entry) => !isLoopback(entry.address))
  const unexpected = found.filter((entry) => !permitted(entry) && isLoopback(entry.address))
  const absent = allow.filter(
    (rule) =>
      !found.some((entry) => entry.address === rule.address && entry.port === Number(rule.port))
  )

  const problems = []
  for (const entry of undecodable) {
    problems.push(
      `could not decode the local address of a listening socket: ${entry}. ` +
        'This is reported rather than ignored because an unreadable socket is ' +
        'not an absent one.'
    )
  }
  // Named first and named differently, because a listener on a routable address
  // is a different severity from an unexpected one on loopback, and a verdict
  // that reads the same for both trains whoever sees it to skim.
  for (const entry of routable) {
    problems.push(
      `${entry.proto} listening on ${entry.address}:${String(entry.port)}, which is not loopback`
    )
  }
  for (const entry of unexpected) {
    problems.push(
      `${entry.proto} listening on ${entry.address}:${String(entry.port)}, which no assertion permits`
    )
  }
  for (const rule of absent) {
    problems.push(
      `nothing is listening on the permitted ${rule.address}:${String(rule.port)} ` +
        `(${rule.why ?? 'no reason given'}), so this log was taken before the device ` +
        'finished starting and proves nothing'
    )
  }

  const summary =
    found.length === 0
      ? 'nothing listens outside AF_UNIX'
      : found.map((entry) => `${entry.proto} ${entry.address}:${String(entry.port)}`).join(', ')

  return problems.length === 0
    ? verdict(check, true, `${summary}, which is exactly what is permitted`, [
        ...SAMPLED,
        'AF_UNIX sockets are outside this assertion entirely: the daemon listens on one by design.',
      ])
    : verdict(check, false, problems.join('; '), SAMPLED)
}

/** 127.0.0.0/8 and ::1. A wildcard bind is not loopback: it answers every interface. */
function isLoopback(address) {
  return address.startsWith('127.') || address === '::1'
}

/**
 * "0100007F:143C" into 127.0.0.1 and 5180.
 *
 * The kernel prints these words in HOST byte order, which on every machine this
 * runs on is little-endian, so the bytes come out reversed. IPv6 is four such
 * words, each reversed independently, which is why this is not one big reversal.
 */
function decodeAddress(field) {
  const [address, port] = field.split(':')
  if (address === undefined || port === undefined) return null
  if (address.length === 8) {
    const bytes = address.match(/../g) ?? []
    return {
      address: bytes
        .reverse()
        .map((byte) => parseInt(byte, 16))
        .join('.'),
      port: parseInt(port, 16),
    }
  }
  if (address.length === 32) {
    const bytes = []
    for (let word = 0; word < 4; word += 1) {
      const octets = (address.slice(word * 8, word * 8 + 8).match(/../g) ?? []).reverse()
      bytes.push(...octets)
    }
    const groups = []
    for (let index = 0; index < 16; index += 2) groups.push(`${bytes[index]}${bytes[index + 1]}`)
    return { address: compressV6(groups), port: parseInt(port, 16) }
  }
  return null
}

/**
 * RFC 5952 zero compression, so ::1 and :: read as themselves in a verdict.
 *
 * WRITTEN TWICE. The first version found the longest run of zeroes with a
 * regex and deleted it from the joined string, which turns ::1 into ":1" and ::
 * into "". Both then failed isLoopback and were reported as listening on a
 * routable address: a FAIL, so it would not have shipped silently, but a FAIL
 * naming an address that does not exist is a bug report pointed at the wrong
 * thing. Found by decoding the two addresses whose whole point is that they
 * compress.
 *
 * Indices, not string surgery: the run is located in the array and the two
 * sides are rejoined around it, which makes a run at either end fall out
 * correctly instead of being a special case somebody has to remember.
 */
function compressV6(groups) {
  const trimmed = groups.map((group) => group.replace(/^0+(?=.)/, '').toLowerCase())

  let bestStart = -1
  let bestLength = 0
  let runStart = -1
  for (let index = 0; index <= trimmed.length; index += 1) {
    if (trimmed[index] === '0') {
      if (runStart === -1) runStart = index
      continue
    }
    if (runStart !== -1) {
      const length = index - runStart
      if (length > bestLength) {
        bestStart = runStart
        bestLength = length
      }
      runStart = -1
    }
  }

  // A single zero group is written as "0". Compressing it saves nothing and
  // RFC 5952 forbids it, which matters because "::" for one group is ambiguous.
  if (bestLength < 2) return trimmed.join(':')
  return `${trimmed.slice(0, bestStart).join(':')}::${trimmed.slice(bestStart + bestLength).join(':')}`
}

export const RUNTIME_VERIFIERS = {
  'mount-options': mountOptions,
  'no-swap': noSwap,
  'no-listening-sockets': noListeningSockets,
}
